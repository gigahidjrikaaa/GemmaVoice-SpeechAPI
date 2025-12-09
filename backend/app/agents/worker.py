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
import logging
import os
from typing import Optional

from livekit.agents import (
    AutoSubscribe,
    JobContext,
    JobProcess,
    WorkerOptions,
    cli,
    llm,
)
from livekit.agents.pipeline import VoicePipelineAgent

from app.config.settings import get_settings
from app.agents.voice_agent import GemmaVoiceAgent, ServiceFactory, create_agent_session

logger = logging.getLogger(__name__)

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
    logger.info(
        "Starting agent job - Room: %s, Participant: %s",
        ctx.room.name,
        ctx.job.participant.identity if ctx.job.participant else "unknown",
    )
    
    # Wait for participant to join (with timeout)
    try:
        await ctx.wait_for_participant(timeout=30.0)
    except asyncio.TimeoutError:
        logger.warning("No participant joined within timeout, exiting")
        return
    
    # Get service factory
    factory = await get_service_factory()
    
    # Extract options from job metadata or use defaults
    job_metadata = ctx.job.metadata or {}
    instructions = job_metadata.get("instructions", None)
    reference_id = job_metadata.get("voice_reference_id", None)
    language = job_metadata.get("language", None)
    
    # Create agent for this session
    agent = factory.create_agent(
        instructions=instructions or None,
        reference_id=reference_id,
        language=language,
    )
    
    # Start agent session
    try:
        session = await create_agent_session(agent, ctx)
        
        # Keep session alive until room closes
        async def on_disconnect():
            logger.info("Participant disconnected")
            await session.close()
        
        ctx.room.on("participant_disconnected", lambda p: asyncio.create_task(on_disconnect()))
        
        # Wait for session to complete
        await session.wait_for_close()
        
    except Exception as e:
        logger.exception("Agent session error: %s", e)
        raise
    finally:
        logger.info("Agent job completed - Room: %s", ctx.room.name)


def prewarm(proc: JobProcess) -> None:
    """Prewarm function called when worker starts.
    
    Used to load models and initialize services before
    receiving any jobs.
    
    Args:
        proc: The worker process
    """
    logger.info("Prewarming worker process...")
    
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
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            agent_name="gemma-voice-agent",
        )
    )


if __name__ == "__main__":
    main()
