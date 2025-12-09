"""Service wrapper around OpenAI Whisper and optional local inference."""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from io import BytesIO
from typing import Any, Dict, List, Optional

from app.config.settings import Settings
from app.observability.metrics import record_external_call

try:  # pragma: no cover - optional dependency
    from faster_whisper import WhisperModel
except ImportError:  # pragma: no cover - handled gracefully at runtime
    WhisperModel = None  # type: ignore[assignment]

try:  # pragma: no cover - optional dependency
    from openai import AsyncOpenAI
    from openai import APIError as OpenAIAPIError
except ImportError:  # pragma: no cover - handled gracefully at runtime
    AsyncOpenAI = None  # type: ignore[assignment]
    OpenAIAPIError = Exception  # type: ignore[assignment]

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class WhisperTranscriptionSegment:
    """Normalized representation of a transcription segment."""

    id: Optional[int]
    start: Optional[float]
    end: Optional[float]
    text: str


@dataclass(slots=True)
class WhisperTranscription:
    """Container returned by the Whisper service."""

    text: str
    language: Optional[str]
    segments: List[WhisperTranscriptionSegment]

    @classmethod
    def from_segments(cls, segments: list, language: Optional[str]) -> "WhisperTranscription":
        """Create a transcription from a list of segments."""
        text = "".join(segment.text for segment in segments)
        return cls(text=text, language=language, segments=segments)


class WhisperService:
    """High-level speech-to-text adapter supporting remote and local inference."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client: Optional[AsyncOpenAI] = None
        self._local_model: Any | None = None
        self._local_model_lock = asyncio.Lock()

    async def startup(self) -> None:
        """Initialise the configured Whisper backend."""

        if self._settings.enable_faster_whisper:
            await self._load_faster_whisper_model()
            return

        if self._settings.openai_api_key is None:
            logger.warning("WhisperService configured without API key; remote transcription disabled")
            return

        if AsyncOpenAI is None:  # pragma: no cover - dependency is optional
            raise RuntimeError("The 'openai' package is required for remote Whisper usage.")

        timeout = self._settings.openai_timeout_seconds
        self._client = AsyncOpenAI(
            api_key=self._settings.openai_api_key,
            base_url=self._settings.openai_api_base,
            timeout=timeout,
        )
        logger.info("Initialised AsyncOpenAI Whisper client with timeout %.1fs", timeout)

    async def shutdown(self) -> None:
        """Release any allocated resources."""

        self._client = None
        self._local_model = None

    @property
    def is_ready(self) -> bool:
        """Return True when a backend is available."""

        return bool(self._client or self._local_model)

    async def transcribe(
        self,
        audio_bytes: bytes,
        *,
        filename: str,
        content_type: Optional[str] = None,
        language: Optional[str] = None,
        prompt: Optional[str] = None,
        response_format: Optional[str] = None,
        temperature: Optional[float] = None,
    ) -> WhisperTranscription:
        """Transcribe the provided audio payload."""

        if self._settings.enable_faster_whisper:
            start = time.perf_counter()
            try:
                result = await self._transcribe_with_faster_whisper(
                    audio_bytes,
                    language=language,
                    prompt=prompt,
                    temperature=temperature,
                )
            except Exception:
                record_external_call("faster_whisper_local", time.perf_counter() - start, success=False)
                raise
            record_external_call("faster_whisper_local", time.perf_counter() - start, success=True)
            return result

        if self._client is None:
            raise RuntimeError("Whisper remote backend is not configured.")

        file_tuple = (filename, audio_bytes, content_type or "application/octet-stream")
        request_kwargs: Dict[str, Any] = {
            "model": self._settings.openai_whisper_model,
            "file": file_tuple,
            "response_format": response_format or self._settings.openai_whisper_response_format,
        }
        if language:
            request_kwargs["language"] = language
        if prompt:
            request_kwargs["prompt"] = prompt
        if temperature is not None:
            request_kwargs["temperature"] = temperature

        logger.debug("Dispatching Whisper transcription via OpenAI: model=%s", request_kwargs["model"])

        start = time.perf_counter()
        try:
            response = await self._client.audio.transcriptions.create(**request_kwargs)
        except OpenAIAPIError as exc:  # pragma: no cover - network failure
            logger.exception("Remote Whisper transcription failed")
            record_external_call("whisper_remote", time.perf_counter() - start, success=False)
            raise RuntimeError("Remote Whisper transcription failed") from exc

        payload = response if isinstance(response, dict) else response.model_dump()
        logger.debug("Whisper response payload: %s", payload)
        record_external_call("whisper_remote", time.perf_counter() - start, success=True)
        
        # Extract text - some response formats return text directly, others via segments
        raw_text = payload.get("text", "")
        
        # Build segments if available
        segments = [
            WhisperTranscriptionSegment(
                id=segment.get("id", i),
                start=segment.get("start", 0.0),
                end=segment.get("end", 0.0),
                text=segment.get("text", ""),
            )
            for i, segment in enumerate(payload.get("segments", []))
        ]
        
        # If no segments but we have text, create a single segment
        if not segments and raw_text:
            segments = [
                WhisperTranscriptionSegment(
                    id=0,
                    start=0.0,
                    end=payload.get("duration", 0.0),
                    text=raw_text,
                )
            ]
        
        # Prefer raw text if available, otherwise construct from segments
        text = raw_text if raw_text else "".join(seg.text for seg in segments)
        language = payload.get("language")
        
        return WhisperTranscription(text=text, language=language, segments=segments)

    async def _load_faster_whisper_model(self) -> None:
        """Load Faster Whisper locally in a background thread."""

        if WhisperModel is None:
            raise RuntimeError(
                "Local Faster Whisper inference requested but the 'faster-whisper' package is not installed."
            )

        model_size = self._settings.faster_whisper_model_size
        device = self._settings.faster_whisper_device
        compute_type = self._settings.faster_whisper_compute_type

        async with self._local_model_lock:
            if self._local_model is not None:
                return
            logger.info(
                "Loading local Faster Whisper model '%s' on device '%s' with compute type '%s'",
                model_size,
                device,
                compute_type,
            )
            self._local_model = await asyncio.to_thread(
                WhisperModel, model_size, device=device, compute_type=compute_type
            )

    async def _transcribe_with_faster_whisper(
        self,
        audio_bytes: bytes,
        *,
        language: Optional[str],
        prompt: Optional[str],
        temperature: Optional[float],
    ) -> WhisperTranscription:
        """Run the locally loaded Faster Whisper model against the audio payload."""

        if self._local_model is None:
            await self._load_faster_whisper_model()

        assert self._local_model is not None  # for type-checkers

        kwargs: Dict[str, Any] = {}
        if language:
            kwargs["language"] = language
        if prompt:
            kwargs["initial_prompt"] = prompt
        if temperature is not None:
            kwargs["temperature"] = temperature

        model_name = self._settings.faster_whisper_model_size
        logger.debug("Dispatching Faster Whisper transcription locally: model=%s", model_name)

        segments_generator, info = await asyncio.to_thread(
            self._local_model.transcribe, BytesIO(audio_bytes), **kwargs
        )
        
        segments = [
            WhisperTranscriptionSegment(
                id=segment.id,
                start=segment.start,
                end=segment.end,
                text=segment.text,
            )
for segment in segments_generator
        ]

        return WhisperTranscription.from_segments(segments, info.language)