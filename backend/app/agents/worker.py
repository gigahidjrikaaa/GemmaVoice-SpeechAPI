"""LiveKit Agent Worker Entry Point.

This is the main entry point for running the GemmaVoice agent as a
standalone LiveKit worker process.

Usage:
    python -m app.agents.worker dev     # Development mode
    python -m app.agents.worker start   # Production mode
    
Environment Variables Required:
    LIVEKIT_URL - LiveKit server URL (e.g., ws://localhost:7880)
    LIVEKIT_API_KEY - API key for LiveKit
    LIVEKIT_API_SECRET - API secret for LiveKit
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import time
from typing import Optional

import httpx

from livekit.agents import (
    AutoSubscribe,
    JobContext,
    JobProcess,
    JobExecutorType,
    WorkerOptions,
    cli,
    llm,
)

from app.config.settings import get_settings
from app.agents.voice_agent import GemmaVoiceAgent, ServiceFactory, create_agent_session
from app.agents import telemetry

logger = logging.getLogger(__name__)

# IMPORTANT: LiveKit plugins register at import time and must be registered on the
# main thread. Job entrypoints may run in background threads, so we force plugin
# registration during module import (which happens on the job process main thread).
from livekit.plugins import silero as _livekit_silero  # noqa: F401

# Global service factory - initialized once per worker
_service_factory: Optional[ServiceFactory] = None


async def get_service_factory() -> ServiceFactory:
    """Get or create the global service factory."""
    global _service_factory
    
    if _service_factory is None:
        settings = get_settings()
        _service_factory = ServiceFactory(settings)
        await _service_factory.startup()
    
    return _service_factory


async def entrypoint(ctx: JobContext) -> None:
    """Main entrypoint for LiveKit agent jobs.
    
    This function is called for each new room/conversation.
    It creates an agent instance and manages its lifecycle.
    
    Args:
        ctx: LiveKit job context with room information
    """
    webhook_url = (os.environ.get("AGENT_STATUS_WEBHOOK_URL") or "").strip()
    webhook_api_key = (os.environ.get("AGENT_STATUS_WEBHOOK_API_KEY") or "").strip() or None
    webhook_api_key_header = (os.environ.get("AGENT_STATUS_WEBHOOK_API_KEY_HEADER") or "X-API-Key").strip()

    async def emit(status: str, message: Optional[str] = None, data: Optional[dict] = None) -> None:
        if not webhook_url:
            return
        payload = {
            "ts_ms": int(time.time() * 1000),
            "room_name": getattr(ctx.room, "name", "<unknown>"),
            "job_id": str(getattr(ctx.job, "id", "")) or None,
            "job_type": str(getattr(ctx.job, "type", "")) or None,
            "agent_identity": "gemma-voice-agent",
            "participant_identity": ctx.job.participant.identity if ctx.job.participant else None,
            "status": status,
            "message": message,
            "data": data,
        }
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                headers = {}
                if webhook_api_key:
                    headers[webhook_api_key_header] = webhook_api_key
                await client.post(webhook_url, json=payload, headers=headers)
        except Exception:
            # Best-effort only; never block agent startup due to telemetry.
            logger.debug("Failed to emit agent status event", exc_info=True)

    # Make the emitter available to plugins/services for this job.
    telemetry.set_emitter(emit)

    job_id = getattr(ctx.job, "id", None)
    job_type = getattr(ctx.job, "type", None)
    logger.info(
        "Job received - id=%s type=%s room=%s participant=%s metadata_type=%s",
        job_id,
        job_type,
        getattr(ctx.room, "name", "<unknown>"),
        ctx.job.participant.identity if ctx.job.participant else "unknown",
        type(ctx.job.metadata).__name__,
    )
    await emit(
        "JOB_RECEIVED",
        data={"metadata_type": type(ctx.job.metadata).__name__},
    )

    connect_started = time.monotonic()
    # Ensure the worker is connected to the room before interacting with participants.
    # Without this, the agent may never join/subscribe correctly.
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    logger.info("Connected to room - id=%s elapsed=%.2fs", job_id, time.monotonic() - connect_started)
    await emit(
        "CONNECTED",
        data={"connect_elapsed_s": round(time.monotonic() - connect_started, 3)},
    )
    
    # Wait for participant to join (with timeout)
    try:
        wait_started = time.monotonic()
        await emit("WAITING_FOR_PARTICIPANT")
        target_identity = ctx.job.participant.identity if ctx.job.participant else None
        # NOTE: livekit-agents versions differ here. Some versions don't accept
        # a timeout kwarg, so we wrap with asyncio.wait_for for compatibility.
        participant = await asyncio.wait_for(ctx.wait_for_participant(), timeout=30.0)
        detected_identity = getattr(participant, "identity", None) if participant is not None else None
        logger.info("Participant detected - id=%s elapsed=%.2fs", job_id, time.monotonic() - wait_started)
        await emit(
            "PARTICIPANT_DETECTED",
            data={
                "wait_elapsed_s": round(time.monotonic() - wait_started, 3),
                "target_identity": target_identity,
                "detected_identity": detected_identity,
            },
        )
    except asyncio.TimeoutError:
        logger.warning("No participant joined within timeout, exiting")
        await emit(
            "TIMEOUT_WAITING_FOR_PARTICIPANT",
            data={"target_identity": ctx.job.participant.identity if ctx.job.participant else None},
        )
        return
    
    # Get service factory
    factory = await get_service_factory()
    
    # Extract options from job metadata or use defaults.
    # Depending on how the job is dispatched, metadata may arrive as a dict or a JSON string.
    job_metadata_raw = ctx.job.metadata or {}
    if isinstance(job_metadata_raw, str):
        try:
            job_metadata = json.loads(job_metadata_raw) if job_metadata_raw.strip() else {}
        except json.JSONDecodeError:
            logger.warning("Invalid job metadata JSON; ignoring")
            job_metadata = {}
    elif isinstance(job_metadata_raw, dict):
        job_metadata = job_metadata_raw
    else:
        job_metadata = {}

    instructions = job_metadata.get("instructions", None)
    reference_id = job_metadata.get("voice_reference_id", None)
    language = job_metadata.get("language", None)
    
    # Create agent for this session
    agent_kwargs = {
        "reference_id": reference_id,
        "language": language,
    }
    # Only pass optional fields when present; the factory/agent expect instructions as a string.
    if isinstance(instructions, str) and instructions.strip():
        agent_kwargs["instructions"] = instructions

    agent = factory.create_agent(**agent_kwargs)
    
    # Start agent session
    try:
        await emit(
            "SESSION_STARTING",
            data={
                "has_instructions": bool(agent_kwargs.get("instructions")),
                "reference_id": reference_id,
                "language": language,
            },
        )
        session = await create_agent_session(agent, ctx)
        await emit("SESSION_STARTED")

        # Keep session alive until the participant disconnects, or the room disconnects.
        # NOTE: livekit-agents versions differ; some do not provide wait_for_close().
        # We implement our own lifecycle wait using an Event.
        done = asyncio.Event()

        async def shutdown(reason: str, *, data: Optional[dict] = None) -> None:
            if done.is_set():
                return
            logger.info("Shutting down agent session (%s)", reason)
            await emit("SESSION_ENDING", message=reason, data=data)
            try:
                await session.aclose()
            finally:
                done.set()

        def _extract_identity_from_event_args(args: tuple[object, ...]) -> Optional[str]:
            for arg in args:
                identity = getattr(arg, "identity", None)
                if isinstance(identity, str) and identity:
                    return identity
            return None

        def on_participant_disconnected(*args: object, **_kwargs: object) -> None:
            # Only terminate the job when the *target* participant for this job leaves.
            # Otherwise any unrelated disconnect (e.g. a different peer or a reconnect) would kill the session.
            identity = _extract_identity_from_event_args(args)
            if target_identity and identity is None:
                return
            if target_identity and identity and identity != target_identity:
                return
            asyncio.create_task(
                shutdown(
                    "participant_disconnected",
                    data={
                        "target_identity": target_identity,
                        "disconnected_identity": identity,
                    },
                )
            )

        ctx.room.on("participant_disconnected", on_participant_disconnected)

        async def monitor_room_disconnect() -> None:
            # Fallback: if LiveKit terminates the job / connection drops,
            # ensure we close the session.
            while True:
                try:
                    if not ctx.room.isconnected():
                        break
                except Exception:
                    break
                await asyncio.sleep(0.5)
            await shutdown(
                "room_disconnected",
                data={"target_identity": target_identity},
            )

        asyncio.create_task(monitor_room_disconnect())

        # Block this job until shutdown is triggered.
        await done.wait()
        
    except Exception as e:
        logger.exception("Agent session error: %s", e)
        await emit("ERROR", message=str(e))
        raise
    finally:
        logger.info("Agent job completed - Room: %s", ctx.room.name)
        await emit("JOB_COMPLETED")
        telemetry.set_emitter(None)


def prewarm(proc: JobProcess) -> None:
    """Prewarm function called when worker starts.
    
    Used to load models and initialize services before
    receiving any jobs.
    
    Args:
        proc: The worker process
    """
    logger.info("Prewarming worker context...")

    # IMPORTANT: LiveKit plugins (e.g., Silero VAD) register themselves at import time
    # and must be imported on the main thread. If the worker uses THREAD executor,
    # job entrypoints run in background threads.
    try:
        from app.agents.voice_agent import prewarm_livekit_plugins

        prewarm_livekit_plugins()
    except Exception:
        logger.exception("Failed to prewarm LiveKit plugins")
        raise
    
    # Run async initialization
    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(get_service_factory())
        logger.info("Worker prewarmed successfully")
    except Exception as e:
        logger.exception("Prewarm failed: %s", e)
        raise
    finally:
        loop.close()


def main():
    """Main entry point for the worker CLI."""

    def _parse_job_executor_type() -> JobExecutorType:
        """Pick the job executor type.

        Why this exists:
        - With PROCESS executor, each job starts a fresh process and may reload large models,
          which can make the UI appear stuck at 'Waiting for agent...' for a long time.
        - With THREAD executor, the worker can keep models warm in-memory in dev.

        Selection order:
        1) LIVEKIT_JOB_EXECUTOR_TYPE env var: 'thread' or 'process'
        2) If running the 'dev' CLI subcommand: THREAD
        3) Otherwise: PROCESS
        """
        env_value = (os.environ.get("LIVEKIT_JOB_EXECUTOR_TYPE") or "").strip().lower()
        if env_value in {"thread", "threads"}:
            return JobExecutorType.THREAD
        if env_value in {"process", "proc"}:
            return JobExecutorType.PROCESS

        argv = [a.lower() for a in sys.argv[1:]]
        if "dev" in argv:
            return JobExecutorType.THREAD
        return JobExecutorType.PROCESS
    
    # Configure logging
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )
    
    # Validate environment
    required_vars = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"]
    missing = [v for v in required_vars if not os.environ.get(v)]
    
    if missing:
        logger.warning(
            "Missing environment variables: %s. "
            "The worker may not connect properly.",
            ", ".join(missing)
        )
    
    # Run the CLI
    executor_type = _parse_job_executor_type()
    logger.info("Worker configuration - agent_name=%s executor=%s", "gemma-voice-agent", executor_type.name)

    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            agent_name="gemma-voice-agent",
            # The default init timeout (10s) is too low for large-model loads.
            # If the worker is killed during process init, the agent will never join the room.
            initialize_process_timeout=600.0,
            job_executor_type=executor_type,
        )
    )


if __name__ == "__main__":
    main()
