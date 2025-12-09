"""LiveKit token generation endpoint.

This module provides the API endpoint for generating LiveKit access tokens
that allow clients to connect to LiveKit rooms for voice agent sessions.
"""

import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.config.settings import Settings, get_settings
from app.security.api_key import require_api_key

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/livekit", tags=["LiveKit"])


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

    # Determine room name
    room_name = request.room_name or settings.livekit_room_name

    # Generate participant identity if not provided
    participant_identity = request.participant_identity or f"user-{uuid.uuid4().hex[:8]}"
    participant_name = request.participant_name or participant_identity

    try:
        # Create access token with video grants
        token = api.AccessToken(
            api_key=settings.livekit_api_key,
            api_secret=settings.livekit_api_secret,
        )

        # Set token identity and name
        token.identity = participant_identity
        token.name = participant_name

        # Set TTL
        token.ttl = settings.livekit_token_ttl

        # Add video grants for full room access
        token.add_grant(
            api.VideoGrants(
                room_join=True,
                room=room_name,
                can_publish=True,
                can_subscribe=True,
                can_publish_data=True,
            )
        )

        # Generate JWT
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
        # Create access token with agent grants
        token = api.AccessToken(
            api_key=settings.livekit_api_key,
            api_secret=settings.livekit_api_secret,
        )

        # Set token identity and name
        token.identity = agent_identity
        token.name = agent_name

        # Set TTL
        token.ttl = settings.livekit_token_ttl

        # Add video grants for agent
        token.add_grant(
            api.VideoGrants(
                room_join=True,
                room=room_name,
                can_publish=True,
                can_subscribe=True,
                can_publish_data=True,
                # Agent-specific: can update participant metadata
                can_update_own_metadata=True,
            )
        )

        # Add agent grant
        token.add_grant(api.grants.SIPGrants())  # Enable SIP if needed

        # Generate JWT
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
