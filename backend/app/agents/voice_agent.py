"""GemmaVoice Agent - LiveKit Voice Agent implementation.

This module provides the main voice agent that combines our custom
LLM, TTS, and STT plugins into a conversational voice agent.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, AsyncIterable, Optional

from livekit.agents import Agent, AgentSession, JobContext
from livekit.agents.llm import ChatContext, FunctionTool
from livekit.agents.voice import ModelSettings

from app.config.settings import Settings, get_settings
from app.services.llm import LLMService
from app.services.openaudio import OpenAudioService
from app.services.whisper import WhisperService

from .plugins import GemmaLLM, OpenAudioTTS, WhisperSTT

logger = logging.getLogger(__name__)

# Default system prompt for the voice agent
DEFAULT_SYSTEM_PROMPT = """You are a helpful AI voice assistant powered by Gemma.
Be concise and natural in your responses since this is a voice conversation.
Keep your answers brief unless the user asks for more detail.
Respond in the same language the user speaks to you."""


class GemmaVoiceAgent(Agent):
    """Voice agent combining Gemma LLM, OpenAudio TTS, and Whisper STT.
    
    This agent provides a complete voice conversation experience using
    our custom LiveKit plugins that wrap the underlying services.
    
    Usage:
        # Create services
        llm_service = LLMService(settings)
        openaudio_service = OpenAudioService(settings)
        whisper_service = WhisperService(settings)
        
        # Start services
        await llm_service.startup()
        await openaudio_service.startup()
        await whisper_service.startup()
        
        # Create agent
        agent = GemmaVoiceAgent(
            llm_service=llm_service,
            openaudio_service=openaudio_service,
            whisper_service=whisper_service,
        )
        
        # Start session
        session = await create_agent_session(agent, ctx)
    """

    def __init__(
        self,
        *,
        llm_service: LLMService,
        openaudio_service: OpenAudioService,
        whisper_service: WhisperService,
        instructions: str = DEFAULT_SYSTEM_PROMPT,
        # LLM options
        temperature: float = 0.7,
        max_tokens: int = 512,
        # TTS options
        reference_id: Optional[str] = None,
        tts_speed: float = 1.0,
        # STT options
        language: Optional[str] = None,
    ) -> None:
        """Initialize the GemmaVoice agent.
        
        Args:
            llm_service: Initialized LLMService instance
            openaudio_service: Initialized OpenAudioService instance
            whisper_service: Initialized WhisperService instance
            instructions: System prompt for the agent
            temperature: LLM sampling temperature
            max_tokens: Maximum tokens to generate
            reference_id: Voice reference ID for TTS
            tts_speed: Speech speed multiplier
            language: Language code for STT
        """
        # Create plugin instances
        llm = GemmaLLM(
            llm_service=llm_service,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        
        tts = OpenAudioTTS(
            openaudio_service=openaudio_service,
            reference_id=reference_id,
            speed=tts_speed,
        )
        
        stt = WhisperSTT(
            whisper_service=whisper_service,
            language=language,
        )
        
        super().__init__(
            instructions=instructions,
            llm=llm,
            tts=tts,
            stt=stt,
        )
        
        self._llm_service = llm_service
        self._openaudio_service = openaudio_service
        self._whisper_service = whisper_service

    async def on_enter(self) -> None:
        """Called when the agent enters a conversation."""
        logger.info("GemmaVoiceAgent entered conversation")

    async def on_exit(self) -> None:
        """Called when the agent exits a conversation."""
        logger.info("GemmaVoiceAgent exited conversation")


async def create_agent_session(
    agent: GemmaVoiceAgent,
    ctx: JobContext,
    *,
    allow_interruptions: bool = True,
    min_endpointing_delay: float = 0.5,
    max_endpointing_delay: float = 3.0,
) -> AgentSession:
    """Create and start an AgentSession with the given agent.
    
    Args:
        agent: The GemmaVoiceAgent instance
        ctx: LiveKit JobContext
        allow_interruptions: Whether to allow user interruptions
        min_endpointing_delay: Minimum delay before end of turn
        max_endpointing_delay: Maximum delay before end of turn
        
    Returns:
        Started AgentSession
    """
    session = AgentSession(
        stt=agent.stt,
        llm=agent.llm,
        tts=agent.tts,
        
        # Turn detection settings
        allow_interruptions=allow_interruptions,
        min_endpointing_delay=min_endpointing_delay,
        max_endpointing_delay=max_endpointing_delay,
    )
    
    await session.start(
        agent=agent,
        room=ctx.room,
    )
    
    logger.info("GemmaVoiceAgent session started in room %s", ctx.room.name)
    
    return session


# Service factory for standalone worker usage
class ServiceFactory:
    """Factory for creating and managing services.
    
    This is useful for standalone LiveKit worker processes that
    need to manage service lifecycles independently.
    """
    
    def __init__(self, settings: Optional[Settings] = None) -> None:
        self._settings = settings or get_settings()
        self._llm_service: Optional[LLMService] = None
        self._openaudio_service: Optional[OpenAudioService] = None
        self._whisper_service: Optional[WhisperService] = None
        self._started = False

    async def startup(self) -> None:
        """Initialize all services."""
        if self._started:
            return
        
        logger.info("Starting services...")
        
        # Create services
        self._llm_service = LLMService(self._settings)
        self._openaudio_service = OpenAudioService(self._settings)
        self._whisper_service = WhisperService(self._settings)
        
        # Start services concurrently
        await asyncio.gather(
            self._llm_service.startup(),
            self._openaudio_service.startup(),
            self._whisper_service.startup(),
        )
        
        self._started = True
        logger.info("All services started successfully")

    async def shutdown(self) -> None:
        """Shutdown all services."""
        if not self._started:
            return
        
        logger.info("Shutting down services...")
        
        tasks = []
        if self._llm_service:
            tasks.append(self._llm_service.shutdown())
        if self._openaudio_service:
            tasks.append(self._openaudio_service.shutdown())
        if self._whisper_service:
            tasks.append(self._whisper_service.shutdown())
        
        await asyncio.gather(*tasks, return_exceptions=True)
        
        self._started = False
        logger.info("All services shut down")

    def create_agent(
        self,
        *,
        instructions: str = DEFAULT_SYSTEM_PROMPT,
        temperature: float = 0.7,
        max_tokens: int = 512,
        reference_id: Optional[str] = None,
        language: Optional[str] = None,
    ) -> GemmaVoiceAgent:
        """Create a new GemmaVoiceAgent.
        
        Args:
            instructions: System prompt
            temperature: LLM temperature
            max_tokens: Max tokens to generate
            reference_id: Voice reference ID
            language: STT language code
            
        Returns:
            Configured GemmaVoiceAgent
            
        Raises:
            RuntimeError: If services haven't been started
        """
        if not self._started:
            raise RuntimeError("Services not started. Call startup() first.")
        
        return GemmaVoiceAgent(
            llm_service=self._llm_service,
            openaudio_service=self._openaudio_service,
            whisper_service=self._whisper_service,
            instructions=instructions,
            temperature=temperature,
            max_tokens=max_tokens,
            reference_id=reference_id,
            language=language,
        )

    @property
    def llm_service(self) -> Optional[LLMService]:
        return self._llm_service

    @property
    def openaudio_service(self) -> Optional[OpenAudioService]:
        return self._openaudio_service

    @property
    def whisper_service(self) -> Optional[WhisperService]:
        return self._whisper_service
