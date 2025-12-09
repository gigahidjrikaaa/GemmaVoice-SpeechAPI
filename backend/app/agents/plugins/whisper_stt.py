"""Custom LiveKit STT plugin wrapping our Whisper service.

This plugin adapts our existing WhisperService to work with LiveKit's
agent framework, providing both streaming and non-streaming recognition.

Note: This plugin uses the Faster-Whisper server running as a container
for actual transcription. The server exposes an OpenAI-compatible API.
"""

from __future__ import annotations

import asyncio
import io
import logging
import time
import uuid
import wave
from dataclasses import dataclass
from typing import Any, AsyncIterator, Optional

from livekit import rtc
from livekit.agents import stt
from livekit.agents.stt import (
    STT,
    RecognizeStream,
    RecognitionUsage,
    SpeechData,
    SpeechEvent,
    SpeechEventType,
    STTCapabilities,
)
from livekit.agents.types import (
    DEFAULT_API_CONNECT_OPTIONS,
    NOT_GIVEN,
    APIConnectOptions,
    NotGivenOr,
)
from livekit.agents.utils import AudioBuffer, is_given

from app.services.whisper import WhisperService
from app.config.settings import get_settings

logger = logging.getLogger(__name__)

# Default audio parameters for Whisper
DEFAULT_SAMPLE_RATE = 16000
DEFAULT_NUM_CHANNELS = 1


@dataclass
class WhisperSTTOptions:
    """Options for the Whisper STT plugin."""
    language: Optional[str] = None
    prompt: Optional[str] = None
    temperature: float = 0.0
    sample_rate: int = DEFAULT_SAMPLE_RATE


class WhisperSTT(STT):
    """LiveKit STT plugin that wraps our Whisper service.
    
    This allows the existing WhisperService to be used seamlessly with
    LiveKit's voice agent framework. It supports both single-shot
    recognition and streaming (via a VAD-based adapter).
    
    Usage:
        whisper_service = WhisperService(settings)
        await whisper_service.startup()
        
        stt = WhisperSTT(whisper_service=whisper_service)
        
        session = AgentSession(
            stt=stt,
            llm=...,
            tts=...,
        )
    """

    def __init__(
        self,
        *,
        whisper_service: WhisperService,
        language: NotGivenOr[str] = NOT_GIVEN,
        prompt: NotGivenOr[str] = NOT_GIVEN,
        temperature: float = 0.0,
        sample_rate: int = DEFAULT_SAMPLE_RATE,
    ) -> None:
        """Initialize the Whisper STT plugin.
        
        Args:
            whisper_service: The underlying WhisperService instance
            language: Language code for transcription (e.g., "en", "id")
            prompt: Optional prompt for context
            temperature: Sampling temperature for transcription
            sample_rate: Expected input sample rate
        """
        super().__init__(
            capabilities=STTCapabilities(streaming=False, interim_results=False)
        )
        
        self._whisper_service = whisper_service
        self._opts = WhisperSTTOptions(
            language=language if is_given(language) else None,
            prompt=prompt if is_given(prompt) else None,
            temperature=temperature,
            sample_rate=sample_rate,
        )

    @property
    def model(self) -> str:
        """Return the model name."""
        settings = get_settings()
        return settings.faster_whisper_model_size or "whisper-large-v3"

    @property
    def provider(self) -> str:
        """Return the provider name."""
        return "faster-whisper"

    def update_options(
        self,
        *,
        language: NotGivenOr[str] = NOT_GIVEN,
        prompt: NotGivenOr[str] = NOT_GIVEN,
        temperature: NotGivenOr[float] = NOT_GIVEN,
    ) -> None:
        """Update STT options."""
        if is_given(language):
            self._opts.language = language
        if is_given(prompt):
            self._opts.prompt = prompt
        if is_given(temperature):
            self._opts.temperature = temperature

    async def _recognize_impl(
        self,
        buffer: AudioBuffer,
        *,
        language: NotGivenOr[str] = NOT_GIVEN,
        conn_options: APIConnectOptions,
    ) -> SpeechEvent:
        """Recognize speech from an audio buffer.
        
        Args:
            buffer: Audio frames to transcribe
            language: Override language for this request
            conn_options: Connection options
            
        Returns:
            SpeechEvent with transcription results
        """
        request_id = str(uuid.uuid4())
        start_time = time.perf_counter()
        
        # Combine audio frames into a single buffer
        combined_frame = rtc.combine_audio_frames(buffer)
        audio_bytes = self._audio_frame_to_wav(combined_frame)
        
        logger.debug(
            "WhisperSTT recognizing %d bytes of audio",
            len(audio_bytes),
        )
        
        # Determine language to use
        lang = language if is_given(language) else self._opts.language
        
        try:
            # Call the Whisper service
            result = await self._whisper_service.transcribe(
                audio_bytes,
                filename="audio.wav",
                content_type="audio/wav",
                language=lang,
                prompt=self._opts.prompt,
                temperature=self._opts.temperature,
            )
            
            duration = time.perf_counter() - start_time
            
            logger.debug(
                "WhisperSTT transcription completed in %.2fs: '%s'",
                duration,
                result.text[:100] if result.text else "(empty)",
            )
            
            # Build speech event
            return SpeechEvent(
                type=SpeechEventType.FINAL_TRANSCRIPT,
                request_id=request_id,
                alternatives=[
                    SpeechData(
                        language=result.language or lang or "en",
                        text=result.text,
                        confidence=1.0,  # Whisper doesn't provide confidence
                        start_time=0.0,
                        end_time=duration,
                    )
                ],
            )
            
        except Exception as e:
            logger.exception("WhisperSTT transcription failed")
            raise

    def stream(
        self,
        *,
        language: NotGivenOr[str] = NOT_GIVEN,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> "WhisperSpeechStream":
        """Create a streaming recognition session.
        
        Note: Whisper doesn't support true streaming, so this uses
        VAD to segment audio and batch-process segments.
        
        Args:
            language: Language code for transcription
            conn_options: Connection options
            
        Returns:
            A streaming recognition session
        """
        return WhisperSpeechStream(
            stt=self,
            whisper_service=self._whisper_service,
            opts=self._opts,
            language=language if is_given(language) else self._opts.language,
            conn_options=conn_options,
        )

    def _audio_frame_to_wav(self, frame: rtc.AudioFrame) -> bytes:
        """Convert an AudioFrame to WAV format bytes."""
        buffer = io.BytesIO()
        
        with wave.open(buffer, "wb") as wav_file:
            wav_file.setnchannels(frame.num_channels)
            wav_file.setsampwidth(2)  # 16-bit audio
            wav_file.setframerate(frame.sample_rate)
            wav_file.writeframes(frame.data)
        
        return buffer.getvalue()

    async def aclose(self) -> None:
        """Close the STT (no-op as WhisperService lifecycle is managed separately)."""
        pass


class WhisperSpeechStream(RecognizeStream):
    """Streaming recognition using Whisper.
    
    Since Whisper doesn't support true streaming, this collects audio
    frames and processes them in batches. For best results, use with
    a VAD (Voice Activity Detection) to segment audio into utterances.
    """

    def __init__(
        self,
        *,
        stt: WhisperSTT,
        whisper_service: WhisperService,
        opts: WhisperSTTOptions,
        language: Optional[str],
        conn_options: APIConnectOptions,
    ) -> None:
        super().__init__(
            stt=stt,
            conn_options=conn_options,
            sample_rate=opts.sample_rate,
        )
        self._stt: WhisperSTT = stt
        self._whisper_service = whisper_service
        self._opts = opts
        self._language = language
        self._speech_duration: float = 0
        self._frames: list[rtc.AudioFrame] = []

    async def _run(self) -> None:
        """Process incoming audio frames."""
        
        async for item in self._input_ch:
            if isinstance(item, self._FlushSentinel):
                # Process accumulated frames on flush
                if self._frames:
                    await self._process_frames()
                    self._frames = []
            elif isinstance(item, rtc.AudioFrame):
                self._frames.append(item)
                # Track speech duration
                self._speech_duration += item.samples_per_channel / item.sample_rate
        
        # Process any remaining frames
        if self._frames:
            await self._process_frames()

    async def _process_frames(self) -> None:
        """Process accumulated audio frames."""
        if not self._frames:
            return
        
        request_id = str(uuid.uuid4())
        
        # Emit start of speech
        self._event_ch.send_nowait(
            SpeechEvent(type=SpeechEventType.START_OF_SPEECH)
        )
        
        # Combine frames
        combined_frame = rtc.combine_audio_frames(self._frames)
        audio_bytes = self._stt._audio_frame_to_wav(combined_frame)
        
        logger.debug(
            "WhisperSpeechStream processing %d frames (%d bytes)",
            len(self._frames),
            len(audio_bytes),
        )
        
        try:
            # Call the Whisper service
            result = await self._whisper_service.transcribe(
                audio_bytes,
                filename="audio.wav",
                content_type="audio/wav",
                language=self._language,
                prompt=self._opts.prompt,
                temperature=self._opts.temperature,
            )
            
            # Emit transcription result
            if result.text.strip():
                self._event_ch.send_nowait(
                    SpeechEvent(
                        type=SpeechEventType.FINAL_TRANSCRIPT,
                        request_id=request_id,
                        alternatives=[
                            SpeechData(
                                language=result.language or self._language or "en",
                                text=result.text,
                                confidence=1.0,
                            )
                        ],
                    )
                )
            
            # Emit end of speech
            self._event_ch.send_nowait(
                SpeechEvent(type=SpeechEventType.END_OF_SPEECH)
            )
            
            # Emit usage metrics
            self._event_ch.send_nowait(
                SpeechEvent(
                    type=SpeechEventType.RECOGNITION_USAGE,
                    request_id=request_id,
                    recognition_usage=RecognitionUsage(
                        audio_duration=self._speech_duration,
                    ),
                )
            )
            
            # Reset duration for next segment
            self._speech_duration = 0
            
            logger.debug(
                "WhisperSpeechStream transcription: '%s'",
                result.text[:100] if result.text else "(empty)",
            )
            
        except Exception as e:
            logger.exception("WhisperSpeechStream transcription failed")
            # Still emit end of speech on error
            self._event_ch.send_nowait(
                SpeechEvent(type=SpeechEventType.END_OF_SPEECH)
            )
            raise
