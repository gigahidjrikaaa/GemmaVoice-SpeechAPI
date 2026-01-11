"""LiveKit token generation endpoint.

This module provides the API endpoint for generating LiveKit access tokens
that allow clients to connect to LiveKit rooms for voice agent sessions.
"""

import datetime
import json
import logging
import time
import uuid
from collections import deque
from typing import Optional

from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.config.settings import Settings, get_settings
from app.security.api_key import require_api_key

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/livekit", tags=["LiveKit"])


# --- Agent status/event store (in-memory, for troubleshooting) ---


class _AgentEventStore:
    """Process-local ring buffer storing agent lifecycle events.

    This is intentionally simple for local troubleshooting.
    In production, you may want to persist this to a proper store.
    """

    def __init__(self, max_events: int = 2000) -> None:
        self._events: deque[dict] = deque(maxlen=max_events)

    def add(self, event: dict) -> None:
        self._events.append(event)

    def latest_for_room(self, room_name: str) -> Optional[dict]:
        for item in reversed(self._events):
            if item.get("room_name") == room_name:
                return item
        return None

    def list_for_room(self, room_name: str, limit: int) -> list[dict]:
        items: list[dict] = []
        for item in reversed(self._events):
            if item.get("room_name") == room_name:
                items.append(item)
                if len(items) >= limit:
                    break
        return list(reversed(items))


_agent_events = _AgentEventStore()


class TokenRequest(BaseModel):
    """Request body for token generation."""

    room_name: Optional[str] = Field(
        default=None,
        description="Room name to join. If not provided, uses the default room.",
        min_length=1,
        max_length=128,
    )
    participant_name: Optional[str] = Field(
        default=None,
        description="Display name for the participant. Auto-generated if not provided.",
        min_length=1,
        max_length=128,
    )
    participant_identity: Optional[str] = Field(
        default=None,
        description="Unique identity for the participant. Auto-generated if not provided.",
        min_length=1,
        max_length=128,
    )

    # Agent dispatch metadata (optional)
    agent_instructions: Optional[str] = Field(
        default=None,
        description="Optional system instructions passed to the agent job.",
        min_length=1,
        max_length=2000,
    )
    agent_voice_reference_id: Optional[str] = Field(
        default=None,
        description="Optional OpenAudio voice reference ID for the agent job.",
        min_length=1,
        max_length=128,
    )
    agent_language: Optional[str] = Field(
        default=None,
        description="Optional language hint for STT (e.g., 'en', 'id').",
        min_length=1,
        max_length=32,
    )


class TokenResponse(BaseModel):
    """Response containing the LiveKit access token."""

    token: str = Field(description="JWT access token for LiveKit connection.")
    url: str = Field(description="LiveKit server WebSocket URL.")
    room_name: str = Field(description="Name of the room to join.")
    participant_identity: str = Field(description="Assigned participant identity.")


class LiveKitStatusResponse(BaseModel):
    """LiveKit configuration status."""

    enabled: bool = Field(description="Whether LiveKit is configured and enabled.")
    url: Optional[str] = Field(default=None, description="LiveKit server URL (if enabled).")
    default_room: Optional[str] = Field(default=None, description="Default room name.")


class KickAgentRequest(BaseModel):
    """Request body for kicking the agent participant from a room."""

    room_name: Optional[str] = Field(
        default=None,
        description="Room name to operate on. If not provided, uses the default room.",
        min_length=1,
        max_length=128,
    )


class KickAgentResponse(BaseModel):
    """Response for agent kick operation."""

    room_name: str = Field(description="Room name that was targeted.")
    agent_identity: str = Field(description="Agent identity that was targeted.")
    kicked: bool = Field(description="Whether the agent participant was removed.")
    detail: Optional[str] = Field(default=None, description="Additional info about the operation.")


class AgentEventIn(BaseModel):
    """Event payload sent by the LiveKit worker for troubleshooting."""

    ts_ms: int = Field(description="Event timestamp (epoch ms).")
    room_name: str = Field(min_length=1, max_length=128)
    job_id: Optional[str] = Field(default=None, description="LiveKit job ID, if available.")
    job_type: Optional[str] = Field(default=None, description="LiveKit job type, if available.")
    agent_identity: str = Field(default="gemma-voice-agent", min_length=1, max_length=128)
    participant_identity: Optional[str] = Field(default=None, description="User participant identity, if known.")
    status: str = Field(
        description="Machine-readable status (e.g., JOB_RECEIVED, CONNECTED, SESSION_STARTED, ERROR).",
        min_length=1,
        max_length=64,
    )
    message: Optional[str] = Field(default=None, max_length=1000)
    data: Optional[dict] = Field(default=None, description="Optional structured context.")


class AgentEventOut(AgentEventIn):
    pass


class AgentStatusResponse(BaseModel):
    room_name: str
    agent_identity: str
    agent_present: bool
    agent_tracks: int = 0
    last_event: Optional[AgentEventOut] = None
    recent_events: list[AgentEventOut] = Field(default_factory=list)


class RoomSnapshotResponse(BaseModel):
    room_name: str
    participants: list[dict]
    fetched_at_ms: int


def _get_livekit_api():
    """Lazily import livekit-api to avoid import errors if not installed."""
    try:
        from livekit import api
        return api
    except ImportError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="LiveKit SDK not installed. Install with: pip install livekit",
        )


def _validate_livekit_api_url(settings: Settings) -> str:
    """Validate and normalize the LiveKit Server API URL.

    This is separate from LIVEKIT_URL (WebSocket URL returned to the browser).
    """
    if not settings.livekit_api_url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "LiveKit API URL not configured. Set LIVEKIT_API_URL (e.g. http://livekit:7880 in Docker "
                "or http://localhost:21254 on the host)."
            ),
        )

    parsed = urlparse(settings.livekit_api_url)
    if parsed.scheme not in {"http", "https"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="LIVEKIT_API_URL must be an http(s) URL",
        )
    if not parsed.netloc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="LIVEKIT_API_URL must include host:port",
        )
    return settings.livekit_api_url


def _new_session_room_name(base_room: str) -> str:
    """Create a unique room name for a new voice session.

    This helps avoid reusing a previously-created room where token-based agent
    dispatch may not retrigger reliably.
    """
    suffix = uuid.uuid4().hex[:8]
    # Keep within 128 chars.
    max_base_len = 128 - (1 + len(suffix))
    base_room = (base_room or "room")[:max_base_len]
    return f"{base_room}-{suffix}"


@router.get(
    "/status",
    response_model=LiveKitStatusResponse,
    summary="Get LiveKit configuration status",
    description="Check if LiveKit is properly configured and available.",
)
async def get_livekit_status(
    settings: Settings = Depends(get_settings),
) -> LiveKitStatusResponse:
    """Check LiveKit configuration status."""
    is_enabled = bool(
        settings.livekit_url
        and settings.livekit_api_key
        and settings.livekit_api_secret
    )

    return LiveKitStatusResponse(
        enabled=is_enabled,
        url=settings.livekit_url if is_enabled else None,
        default_room=settings.livekit_room_name if is_enabled else None,
    )


@router.post(
    "/agent/events",
    response_model=AgentEventOut,
    summary="Ingest agent lifecycle event (internal)",
    description="Worker posts job lifecycle events here for troubleshooting.",
    # Keep the same auth behavior as other endpoints: enforced when API keys are enabled.
    dependencies=[Depends(require_api_key)],
)
async def ingest_agent_event(payload: AgentEventIn) -> AgentEventOut:
    event = payload.model_dump()
    _agent_events.add(event)
    return AgentEventOut(**event)


async def _get_room_snapshot(
    *,
    api,
    api_url: str,
    api_key: str,
    api_secret: str,
    room_name: str,
) -> list[dict]:
    lkapi = api.LiveKitAPI(api_url, api_key, api_secret)
    try:
        resp = await lkapi.room.list_participants(api.ListParticipantsRequest(room=room_name))
        participants: list[dict] = []
        for p in resp.participants:
            track_count = len(getattr(p, "tracks", []) or [])
            participants.append(
                {
                    "identity": getattr(p, "identity", None),
                    "name": getattr(p, "name", None),
                    "sid": getattr(p, "sid", None),
                    "state": getattr(p, "state", None),
                    "metadata": getattr(p, "metadata", None),
                    "track_count": track_count,
                }
            )
        return participants
    finally:
        await lkapi.aclose()


@router.get(
    "/debug/room",
    response_model=RoomSnapshotResponse,
    summary="Room snapshot (participants)",
    description="Fetch current room participants from LiveKit Server API for troubleshooting.",
    dependencies=[Depends(require_api_key)],
)
async def debug_room_snapshot(
    room_name: Optional[str] = None,
    settings: Settings = Depends(get_settings),
) -> RoomSnapshotResponse:
    api = _get_livekit_api()
    api_url = _validate_livekit_api_url(settings)

    if not settings.livekit_api_key or not settings.livekit_api_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="LiveKit credentials not configured. Set LIVEKIT_API_KEY and LIVEKIT_API_SECRET.",
        )

    target_room = room_name or settings.livekit_room_name
    participants = await _get_room_snapshot(
        api=api,
        api_url=api_url,
        api_key=settings.livekit_api_key,
        api_secret=settings.livekit_api_secret,
        room_name=target_room,
    )
    return RoomSnapshotResponse(
        room_name=target_room,
        participants=participants,
        fetched_at_ms=int(time.time() * 1000),
    )


@router.get(
    "/agent/status",
    response_model=AgentStatusResponse,
    summary="Get agent status for a room",
    description=(
        "Returns whether the agent participant is present in the room (via LiveKit Server API) "
        "plus recent worker-reported lifecycle events for troubleshooting."
    ),
    dependencies=[Depends(require_api_key)],
)
async def get_agent_status(
    room_name: Optional[str] = None,
    limit: int = 25,
    settings: Settings = Depends(get_settings),
) -> AgentStatusResponse:
    api = _get_livekit_api()
    api_url = _validate_livekit_api_url(settings)

    if not settings.livekit_api_key or not settings.livekit_api_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="LiveKit credentials not configured. Set LIVEKIT_API_KEY and LIVEKIT_API_SECRET.",
        )

    target_room = room_name or settings.livekit_room_name
    limit = max(1, min(int(limit), 200))
    agent_identity = "gemma-voice-agent"

    participants = await _get_room_snapshot(
        api=api,
        api_url=api_url,
        api_key=settings.livekit_api_key,
        api_secret=settings.livekit_api_secret,
        room_name=target_room,
    )

    agent = next((p for p in participants if p.get("identity") == agent_identity), None)
    agent_present = agent is not None
    agent_tracks = int(agent.get("track_count", 0)) if agent_present else 0

    recent = [AgentEventOut(**e) for e in _agent_events.list_for_room(target_room, limit=limit)]
    last = _agent_events.latest_for_room(target_room)

    return AgentStatusResponse(
        room_name=target_room,
        agent_identity=agent_identity,
        agent_present=agent_present,
        agent_tracks=agent_tracks,
        last_event=AgentEventOut(**last) if last else None,
        recent_events=recent,
    )


@router.post(
    "/agent/kick",
    response_model=KickAgentResponse,
    summary="Kick the agent from a room",
    description=(
        "Force-remove the current agent participant (identity 'gemma-voice-agent') from a room. "
        "Useful when the UI is stuck and you want to kill the agent job and re-dispatch a new one by rejoining."
    ),
    dependencies=[Depends(require_api_key)],
)
async def kick_agent_from_room(
    request: KickAgentRequest,
    settings: Settings = Depends(get_settings),
) -> KickAgentResponse:
    api = _get_livekit_api()

    # Validate required LiveKit configuration
    if not settings.livekit_api_key or not settings.livekit_api_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="LiveKit credentials not configured. Set LIVEKIT_API_KEY and LIVEKIT_API_SECRET.",
        )

    api_url = _validate_livekit_api_url(settings)
    room_name = request.room_name or settings.livekit_room_name
    agent_identity = "gemma-voice-agent"

    # LiveKitAPI is async; it needs a running event loop and must be closed.
    lkapi = api.LiveKitAPI(
        api_url,
        settings.livekit_api_key,
        settings.livekit_api_secret,
    )
    try:
        await lkapi.room.remove_participant(
            api.RoomParticipantIdentity(room=room_name, identity=agent_identity)
        )
        logger.info("Kicked agent '%s' from room '%s'", agent_identity, room_name)
        return KickAgentResponse(room_name=room_name, agent_identity=agent_identity, kicked=True)
    except Exception as exc:
        # Not-found is fine (agent not currently present). Treat as non-fatal.
        try:
            from livekit.api.twirp_client import TwirpError

            if isinstance(exc, TwirpError) and (exc.code == "not_found" or exc.status == 404):
                return KickAgentResponse(
                    room_name=room_name,
                    agent_identity=agent_identity,
                    kicked=False,
                    detail="Agent was not in the room.",
                )
        except Exception:
            # Fall through to generic error handling.
            pass

        logger.exception("Failed to kick agent from room")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to contact LiveKit Server API to kick agent.",
        ) from exc
    finally:
        await lkapi.aclose()


@router.post(
    "/token",
    response_model=TokenResponse,
    summary="Generate LiveKit access token",
    description="""
Generate a JWT access token for connecting to a LiveKit room.

The token grants permissions to:
- Join the specified room
- Publish audio/video tracks
- Subscribe to other participants' tracks
- Use data channels

The token expires after the configured TTL (default 24 hours).
""",
    dependencies=[Depends(require_api_key)],
)
async def generate_token(
    request: TokenRequest,
    settings: Settings = Depends(get_settings),
) -> TokenResponse:
    """Generate a LiveKit access token for room connection."""
    # Validate LiveKit configuration
    if not settings.livekit_url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="LiveKit URL not configured. Set LIVEKIT_URL environment variable.",
        )
    if not settings.livekit_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="LiveKit API key not configured. Set LIVEKIT_API_KEY environment variable.",
        )
    if not settings.livekit_api_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="LiveKit API secret not configured. Set LIVEKIT_API_SECRET environment variable.",
        )

    # Get livekit API module
    api = _get_livekit_api()

    # Determine room name.
    # If none is provided, generate a unique per-session room.
    # This avoids reusing a stale room where dispatch may not retrigger.
    if isinstance(request.room_name, str) and request.room_name.strip():
        room_name = request.room_name.strip()
    else:
        room_name = _new_session_room_name(settings.livekit_room_name)

    # Generate participant identity if not provided
    participant_identity = request.participant_identity or f"user-{uuid.uuid4().hex[:8]}"
    participant_name = request.participant_name or participant_identity

    try:
        ttl = datetime.timedelta(seconds=int(settings.livekit_token_ttl))
        grants = api.VideoGrants(
            room_join=True,
            room=room_name,
            can_publish=True,
            can_subscribe=True,
            can_publish_data=True,
        )

        # Token-based agent dispatch:
        # When the participant joins, LiveKit will dispatch the specified agent worker
        # into the room (matching WorkerOptions.agent_name).
        agent_job_metadata: dict[str, str] = {}
        if isinstance(request.agent_instructions, str) and request.agent_instructions.strip():
            agent_job_metadata["instructions"] = request.agent_instructions.strip()
        if isinstance(request.agent_voice_reference_id, str) and request.agent_voice_reference_id.strip():
            agent_job_metadata["voice_reference_id"] = request.agent_voice_reference_id.strip()
        if isinstance(request.agent_language, str) and request.agent_language.strip():
            agent_job_metadata["language"] = request.agent_language.strip()

        try:
            room_config = api.RoomConfiguration(
                agents=[
                    api.RoomAgentDispatch(
                        agent_name="gemma-voice-agent",
                        metadata=json.dumps(agent_job_metadata) if agent_job_metadata else "{}",
                    )
                ]
            )
        except AttributeError as e:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    "Installed LiveKit SDK does not support token-based agent dispatch. "
                    "Upgrade livekit to a newer version."
                ),
            ) from e

        token = (
            api.AccessToken(
                api_key=settings.livekit_api_key,
                api_secret=settings.livekit_api_secret,
            )
            .with_identity(participant_identity)
            .with_name(participant_name)
            .with_ttl(ttl)
            .with_grants(grants)
        )

        if hasattr(token, "with_room_config"):
            token = token.with_room_config(room_config)
        else:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    "Installed LiveKit SDK does not support token-based agent dispatch. "
                    "Upgrade livekit to a newer version."
                ),
            )

        jwt_token = token.to_jwt()

        logger.info(
            "Generated LiveKit token for participant %s in room %s",
            participant_identity,
            room_name,
        )

        return TokenResponse(
            token=jwt_token,
            url=settings.livekit_url,
            room_name=room_name,
            participant_identity=participant_identity,
        )

    except Exception as e:
        logger.error("Failed to generate LiveKit token: %s", str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate token: {str(e)}",
        )


@router.post(
    "/agent-token",
    response_model=TokenResponse,
    summary="Generate agent access token",
    description="""
Generate a JWT access token for the voice agent to join a room.

This endpoint is intended for internal use by the agent worker process.
The agent token has additional permissions for agent-specific operations.
""",
    dependencies=[Depends(require_api_key)],
)
async def generate_agent_token(
    request: TokenRequest,
    settings: Settings = Depends(get_settings),
) -> TokenResponse:
    """Generate a LiveKit access token for the voice agent."""
    # Validate LiveKit configuration
    if not settings.livekit_url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="LiveKit URL not configured. Set LIVEKIT_URL environment variable.",
        )
    if not settings.livekit_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="LiveKit API key not configured. Set LIVEKIT_API_KEY environment variable.",
        )
    if not settings.livekit_api_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="LiveKit API secret not configured. Set LIVEKIT_API_SECRET environment variable.",
        )

    # Get livekit API module
    api = _get_livekit_api()

    # Determine room name
    room_name = request.room_name or settings.livekit_room_name

    # Agent identity
    agent_identity = "gemma-voice-agent"
    agent_name = "Gemma Voice Agent"

    try:
        ttl = datetime.timedelta(seconds=int(settings.livekit_token_ttl))
        grants = api.VideoGrants(
            room_join=True,
            room=room_name,
            can_publish=True,
            can_subscribe=True,
            can_publish_data=True,
            can_update_own_metadata=True,
        )

        token = (
            api.AccessToken(
                api_key=settings.livekit_api_key,
                api_secret=settings.livekit_api_secret,
            )
            .with_identity(agent_identity)
            .with_name(agent_name)
            .with_ttl(ttl)
            .with_grants(grants)
            # Enable SIP if needed
            .with_sip_grants(api.SIPGrants(call=True))
        )

        jwt_token = token.to_jwt()

        logger.info(
            "Generated agent token for room %s",
            room_name,
        )

        return TokenResponse(
            token=jwt_token,
            url=settings.livekit_url,
            room_name=room_name,
            participant_identity=agent_identity,
        )

    except Exception as e:
        logger.error("Failed to generate agent token: %s", str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate token: {str(e)}",
        )
