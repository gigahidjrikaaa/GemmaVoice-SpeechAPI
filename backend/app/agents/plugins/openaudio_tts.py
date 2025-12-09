"""Custom LiveKit TTS plugin wrapping our OpenAudio S1 service.

This plugin adapts our existing OpenAudioService to work with LiveKit's
agent framework, providing both streaming and non-streaming synthesis.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass, replace
from typing import Any, AsyncIterator, Optional

from livekit import rtc
from livekit.agents import tts
from livekit.agents.tts import (
    TTS,
    AudioEmitter,
    ChunkedStream,
    SynthesizeStream,
    SynthesizedAudio,
    TTSCapabilities,
)
from livekit.agents.types import (
    DEFAULT_API_CONNECT_OPTIONS,
    NOT_GIVEN,
    APIConnectOptions,
    NotGivenOr,
)
from livekit.agents.utils import is_given

from app.services.openaudio import OpenAudioService
from app.config.settings import get_settings

logger = logging.getLogger(__name__)

# Default sample rate for OpenAudio S1
DEFAULT_SAMPLE_RATE = 44100
DEFAULT_NUM_CHANNELS = 1


@dataclass
class OpenAudioTTSOptions:
    """Options for the OpenAudio TTS plugin."""
    reference_id: Optional[str] = None
    response_format: str = "wav"
    sample_rate: int = DEFAULT_SAMPLE_RATE
    normalize: bool = True
    top_p: float = 0.95
    temperature: float = 0.7
    chunk_length: int = 200
    latency: str = "balanced"
    speed: float = 1.0
    volume: float = 1.0


class OpenAudioTTS(TTS):
    """LiveKit TTS plugin that wraps our OpenAudio S1 service.
    
    This allows the existing OpenAudioService to be used seamlessly with
    LiveKit's voice agent framework.
    
    Usage:
        openaudio_service = OpenAudioService(settings)
        await openaudio_service.startup()
        
        tts = OpenAudioTTS(openaudio_service=openaudio_service)
        
        session = AgentSession(
            tts=tts,
            stt=...,
            llm=...,
        )
    """

    def __init__(
        self,
        *,
        openaudio_service: OpenAudioService,
        reference_id: NotGivenOr[str] = NOT_GIVEN,
        response_format: str = "wav",
        sample_rate: int = DEFAULT_SAMPLE_RATE,
        normalize: bool = True,
        top_p: float = 0.95,
        temperature: float = 0.7,
        chunk_length: int = 200,
        latency: str = "balanced",
        speed: float = 1.0,
        volume: float = 1.0,
    ) -> None:
        """Initialize the OpenAudio TTS plugin.
        
        Args:
            openaudio_service: The underlying OpenAudioService instance
            reference_id: Reference voice ID for cloning
            response_format: Audio format (wav, mp3, pcm, etc.)
            sample_rate: Output sample rate
            normalize: Whether to normalize audio
            top_p: Nucleus sampling parameter
            temperature: Sampling temperature
            chunk_length: Chunk length for streaming
            latency: Latency mode (normal, balanced, low)
            speed: Speech speed multiplier
            volume: Volume level
        """
        super().__init__(
            capabilities=TTSCapabilities(streaming=True),
            sample_rate=sample_rate,
            num_channels=DEFAULT_NUM_CHANNELS,
        )
        
        self._openaudio_service = openaudio_service
        self._opts = OpenAudioTTSOptions(
            reference_id=reference_id if is_given(reference_id) else None,
            response_format=response_format,
            sample_rate=sample_rate,
            normalize=normalize,
            top_p=top_p,
            temperature=temperature,
            chunk_length=chunk_length,
            latency=latency,
            speed=speed,
            volume=volume,
        )
        self._streams: set[OpenAudioSynthesizeStream] = set()

    @property
    def model(self) -> str:
        """Return the model name."""
        return "openaudio-s1-mini"

    @property
    def provider(self) -> str:
        """Return the provider name."""
        return "openaudio"

    def update_options(
        self,
        *,
        reference_id: NotGivenOr[str] = NOT_GIVEN,
        response_format: NotGivenOr[str] = NOT_GIVEN,
        sample_rate: NotGivenOr[int] = NOT_GIVEN,
        normalize: NotGivenOr[bool] = NOT_GIVEN,
        top_p: NotGivenOr[float] = NOT_GIVEN,
        temperature: NotGivenOr[float] = NOT_GIVEN,
        chunk_length: NotGivenOr[int] = NOT_GIVEN,
        latency: NotGivenOr[str] = NOT_GIVEN,
        speed: NotGivenOr[float] = NOT_GIVEN,
        volume: NotGivenOr[float] = NOT_GIVEN,
    ) -> None:
        """Update TTS options."""
        if is_given(reference_id):
            self._opts.reference_id = reference_id
        if is_given(response_format):
            self._opts.response_format = response_format
        if is_given(sample_rate):
            self._opts.sample_rate = sample_rate
        if is_given(normalize):
            self._opts.normalize = normalize
        if is_given(top_p):
            self._opts.top_p = top_p
        if is_given(temperature):
            self._opts.temperature = temperature
        if is_given(chunk_length):
            self._opts.chunk_length = chunk_length
        if is_given(latency):
            self._opts.latency = latency
        if is_given(speed):
            self._opts.speed = speed
        if is_given(volume):
            self._opts.volume = volume

    def synthesize(
        self,
        text: str,
        *,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> "OpenAudioChunkedStream":
        """Synthesize speech from text (non-streaming).
        
        Args:
            text: The text to synthesize
            conn_options: Connection options
            
        Returns:
            A chunked stream of audio data
        """
        return OpenAudioChunkedStream(
            tts=self,
            openaudio_service=self._openaudio_service,
            opts=self._opts,
            input_text=text,
            conn_options=conn_options,
        )

    def stream(
        self,
        *,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> "OpenAudioSynthesizeStream":
        """Create a streaming TTS session.
        
        Args:
            conn_options: Connection options
            
        Returns:
            A streaming synthesis session
        """
        stream = OpenAudioSynthesizeStream(
            tts=self,
            openaudio_service=self._openaudio_service,
            opts=self._opts,
            conn_options=conn_options,
        )
        self._streams.add(stream)
        return stream

    async def aclose(self) -> None:
        """Close all active streams."""
        for stream in list(self._streams):
            await stream.aclose()
        self._streams.clear()


class OpenAudioChunkedStream(ChunkedStream):
    """Non-streaming synthesis using OpenAudio S1."""

    def __init__(
        self,
        *,
        tts: OpenAudioTTS,
        openaudio_service: OpenAudioService,
        opts: OpenAudioTTSOptions,
        input_text: str,
        conn_options: APIConnectOptions,
    ) -> None:
        super().__init__(tts=tts, input_text=input_text, conn_options=conn_options)
        self._openaudio_service = openaudio_service
        self._opts = replace(opts)
        self._request_id = str(uuid.uuid4())

    async def _run(self, output_emitter: AudioEmitter) -> None:
        """Execute the synthesis and emit audio chunks."""
        logger.debug(
            "OpenAudioChunkedStream synthesizing text of length %d",
            len(self._input_text),
        )
        
        try:
            # Call the OpenAudio service
            result = await self._openaudio_service.synthesize(
                text=self._input_text,
                response_format=self._opts.response_format,
                sample_rate=self._opts.sample_rate,
                reference_id=self._opts.reference_id,
                normalize=self._opts.normalize,
                top_p=self._opts.top_p,
                temperature=self._opts.temperature,
                chunk_length=self._opts.chunk_length,
                latency=self._opts.latency,
                speed=self._opts.speed,
                volume=self._opts.volume,
            )
            
            # Initialize the emitter
            output_emitter.initialize(
                request_id=self._request_id,
                sample_rate=result.sample_rate,
                num_channels=DEFAULT_NUM_CHANNELS,
                mime_type=result.media_type,
            )
            
            # Create audio frame from result
            # Note: For WAV format, we need to skip the header (44 bytes)
            audio_data = result.audio
            if self._opts.response_format.lower() == "wav" and len(audio_data) > 44:
                audio_data = audio_data[44:]  # Skip WAV header for raw PCM
            
            # Push the complete audio as a single frame
            frame = rtc.AudioFrame(
                data=audio_data,
                sample_rate=result.sample_rate,
                num_channels=DEFAULT_NUM_CHANNELS,
                samples_per_channel=len(audio_data) // 2,  # 16-bit audio = 2 bytes per sample
            )
            output_emitter.push_frame(frame)
            
            logger.debug(
                "OpenAudioChunkedStream completed: %d bytes",
                len(result.audio),
            )
            
        except Exception as e:
            logger.exception("OpenAudioChunkedStream synthesis failed")
            raise


class OpenAudioSynthesizeStream(SynthesizeStream):
    """Streaming synthesis using OpenAudio S1."""

    def __init__(
        self,
        *,
        tts: OpenAudioTTS,
        openaudio_service: OpenAudioService,
        opts: OpenAudioTTSOptions,
        conn_options: APIConnectOptions,
    ) -> None:
        super().__init__(tts=tts, conn_options=conn_options)
        self._tts: OpenAudioTTS = tts
        self._openaudio_service = openaudio_service
        self._opts = replace(opts)
        self._request_id = str(uuid.uuid4())

    async def _run(self, output_emitter: AudioEmitter) -> None:
        """Execute streaming synthesis."""
        # Collect text from the input stream
        text_buffer = ""
        
        async for item in self._input_ch:
            if isinstance(item, self._FlushSentinel):
                # Process accumulated text
                if text_buffer.strip():
                    await self._synthesize_segment(text_buffer, output_emitter)
                    text_buffer = ""
            else:
                text_buffer += item
        
        # Process any remaining text
        if text_buffer.strip():
            await self._synthesize_segment(text_buffer, output_emitter)

    async def _synthesize_segment(
        self,
        text: str,
        output_emitter: AudioEmitter,
    ) -> None:
        """Synthesize a segment of text and emit audio chunks."""
        logger.debug(
            "OpenAudioSynthesizeStream synthesizing segment of length %d",
            len(text),
        )
        
        try:
            # Get streaming synthesis from OpenAudio
            stream_result = await self._openaudio_service.synthesize_stream(
                text=text,
                response_format=self._opts.response_format,
                sample_rate=self._opts.sample_rate,
                reference_id=self._opts.reference_id,
                normalize=self._opts.normalize,
                top_p=self._opts.top_p,
                temperature=self._opts.temperature,
                chunk_length=self._opts.chunk_length,
                latency=self._opts.latency,
                speed=self._opts.speed,
                volume=self._opts.volume,
            )
            
            # Initialize emitter for this segment
            segment_id = str(uuid.uuid4())
            output_emitter.initialize(
                request_id=self._request_id,
                sample_rate=stream_result.sample_rate,
                num_channels=DEFAULT_NUM_CHANNELS,
                stream=True,
                mime_type=stream_result.media_type,
            )
            output_emitter.start_segment(segment_id=segment_id)
            
            # Stream audio chunks
            audio_buffer = bytearray()
            async for chunk in stream_result.iterator_factory():
                audio_buffer.extend(chunk)
                
                # Emit chunks when we have enough data
                # (at least 1024 bytes for reasonable audio frames)
                while len(audio_buffer) >= 1024:
                    chunk_data = bytes(audio_buffer[:1024])
                    audio_buffer = audio_buffer[1024:]
                    
                    frame = rtc.AudioFrame(
                        data=chunk_data,
                        sample_rate=stream_result.sample_rate,
                        num_channels=DEFAULT_NUM_CHANNELS,
                        samples_per_channel=len(chunk_data) // 2,
                    )
                    output_emitter.push_frame(frame)
            
            # Emit any remaining audio
            if audio_buffer:
                frame = rtc.AudioFrame(
                    data=bytes(audio_buffer),
                    sample_rate=stream_result.sample_rate,
                    num_channels=DEFAULT_NUM_CHANNELS,
                    samples_per_channel=len(audio_buffer) // 2,
                )
                output_emitter.push_frame(frame)
            
            output_emitter.end_segment()
            
            logger.debug("OpenAudioSynthesizeStream segment completed")
            
        except Exception as e:
            logger.exception("OpenAudioSynthesizeStream synthesis failed")
            raise
