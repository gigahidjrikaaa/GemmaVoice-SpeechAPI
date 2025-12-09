"""Client wrapper for the OpenAudio-S1-mini text-to-speech service."""

from __future__ import annotations

import asyncio
import base64
import logging
import time
from dataclasses import dataclass
from typing import Any, AsyncIterator, Callable, Dict, Optional, Sequence

import httpx

try:
    import ormsgpack
    HAS_MSGPACK = True
except ImportError:
    HAS_MSGPACK = False

from app.config.settings import Settings
from app.observability.metrics import record_external_call

logger = logging.getLogger(__name__)


def _media_type_for_format(response_format: str) -> str:
    mapping = {
        "pcm": "audio/pcm",
        "wav": "audio/wav",
        "mp3": "audio/mpeg",
        "ogg": "audio/ogg",
        "flac": "audio/flac",
    }
    return mapping.get(response_format.lower(), "application/octet-stream")


@dataclass(slots=True)
class OpenAudioSynthesisResult:
    """Blocking synthesis payload."""

    audio: bytes
    response_format: str
    sample_rate: int
    reference_id: Optional[str]
    media_type: str

    def as_base64(self) -> str:
        return base64.b64encode(self.audio).decode("ascii")


@dataclass(slots=True)
class OpenAudioSynthesisStream:
    """Streaming synthesis payload."""

    iterator_factory: Callable[[], AsyncIterator[bytes]]
    response_format: str
    sample_rate: int
    reference_id: Optional[str]
    media_type: str


class OpenAudioService:
    """Adapter used to interact with a running OpenAudio deployment."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client: Optional[httpx.AsyncClient] = None
        self._client_lock = asyncio.Lock()

    async def startup(self) -> None:
        """Initialise the HTTP client."""

        timeout = httpx.Timeout(self._settings.openaudio_timeout_seconds)
        self._client = httpx.AsyncClient(
            base_url=self._settings.openaudio_api_base,
            timeout=timeout,
        )
        logger.info(
            "Initialised OpenAudio client with timeout %.1fs",
            self._settings.openaudio_timeout_seconds,
        )

    async def shutdown(self) -> None:
        """Close the HTTP client."""

        async with self._client_lock:
            if self._client is not None:
                await self._client.aclose()
                self._client = None

    @property
    def is_ready(self) -> bool:
        return self._client is not None

    async def synthesize(
        self,
        *,
        text: str,
        response_format: Optional[str] = None,
        sample_rate: Optional[int] = None,
        reference_id: Optional[str] = None,
        normalize: Optional[bool] = None,
        references: Optional[Sequence[str]] = None,
        top_p: Optional[float] = None,
        temperature: Optional[float] = None,
        chunk_length: Optional[int] = None,
        latency: Optional[str] = None,
        speed: Optional[float] = None,
        volume: Optional[float] = None,
    ) -> OpenAudioSynthesisResult:
        """Perform blocking TTS synthesis."""

        client = await self._require_client()
        
        # Use msgpack for voice cloning (with references) if available
        use_msgpack = bool(references) and HAS_MSGPACK
        
        payload = self._build_payload(
            text=text,
            response_format=response_format,
            sample_rate=sample_rate,
            reference_id=reference_id,
            normalize=normalize,
            references=references,
            top_p=top_p,
            temperature=temperature,
            chunk_length=chunk_length,
            latency=latency,
            speed=speed,
            volume=volume,
            use_msgpack=use_msgpack,
        )

        headers = self._auth_headers()
        
        # Log payload details (without the full audio data)
        payload_summary = {k: v for k, v in payload.items() if k != "references"}
        if "references" in payload:
            payload_summary["references"] = f"[{len(payload['references'])} reference(s)]"
        logger.debug("Requesting OpenAudio synthesis with payload: %s, use_msgpack=%s", payload_summary, use_msgpack)
        
        start = time.perf_counter()
        try:
            if use_msgpack:
                # Use msgpack for voice cloning requests
                headers["Content-Type"] = "application/msgpack"
                data = ormsgpack.packb(payload)
                response = await client.post(
                    self._settings.openaudio_tts_path,
                    content=data,
                    headers=headers,
                )
            else:
                # Use JSON for regular requests
                response = await client.post(
                    self._settings.openaudio_tts_path,
                    json=payload,
                    headers=headers,
                )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            # Log the error response body for debugging
            error_body = exc.response.text[:1000] if exc.response.text else "No response body"
            logger.error(
                "OpenAudio synthesis failed: status=%d, body=%s",
                exc.response.status_code,
                error_body
            )
            record_external_call("openaudio_synthesize", time.perf_counter() - start, success=False)
            raise RuntimeError(f"OpenAudio synthesis failed: {error_body}") from exc
        except httpx.HTTPError as exc:  # pragma: no cover - network failure
            logger.exception("OpenAudio synthesis failed (network error)")
            record_external_call("openaudio_synthesize", time.perf_counter() - start, success=False)
            raise RuntimeError("OpenAudio synthesis failed") from exc

        if response.headers.get("content-type", "").startswith("application/json"):
            data = response.json()
            audio_b64 = data.get("audio") or data.get("audio_base64")
            if not audio_b64:
                raise RuntimeError("OpenAudio response missing audio payload")
            audio_bytes = base64.b64decode(audio_b64)
            response_format_val = data.get("format", payload.get("format"))
            sample_rate_val = data.get("sample_rate") or payload.get(
                "sample_rate", self._settings.default_audio_sample_rate
            )
        else:
            audio_bytes = await response.aread()
            response_format_val = payload.get("format", self._settings.openaudio_default_format)
            sample_rate_header = response.headers.get(
                "x-sample-rate",
                payload.get("sample_rate", self._settings.default_audio_sample_rate),
            )
            try:
                sample_rate_val = int(sample_rate_header)
            except (TypeError, ValueError):  # pragma: no cover - malformed headers
                logger.warning(
                    "Falling back to default sample rate due to malformed header: %s",
                    sample_rate_header,
                )
                sample_rate_val = self._settings.default_audio_sample_rate

        try:
            sample_rate_int = int(sample_rate_val)
        except (TypeError, ValueError):  # pragma: no cover - malformed payload
            logger.warning(
                "Invalid sample rate '%s' detected; defaulting to %s",
                sample_rate_val,
                self._settings.default_audio_sample_rate,
            )
            sample_rate_int = self._settings.default_audio_sample_rate

        record_external_call("openaudio_synthesize", time.perf_counter() - start, success=True)

        return OpenAudioSynthesisResult(
            audio=audio_bytes,
            response_format=response_format_val,
            sample_rate=sample_rate_int,
            reference_id=payload.get("reference_id"),
            media_type=_media_type_for_format(response_format_val),
        )

    async def synthesize_stream(
        self,
        *,
        text: str,
        response_format: Optional[str] = None,
        sample_rate: Optional[int] = None,
        reference_id: Optional[str] = None,
        normalize: Optional[bool] = None,
        references: Optional[Sequence[str]] = None,
        top_p: Optional[float] = None,
        temperature: Optional[float] = None,
        chunk_length: Optional[int] = None,
        latency: Optional[str] = None,
        speed: Optional[float] = None,
        volume: Optional[float] = None,
    ) -> OpenAudioSynthesisStream:
        """Return an asynchronous iterator that streams synthesis bytes."""

        client = await self._require_client()
        
        # Use msgpack for voice cloning (with references) if available
        use_msgpack = bool(references) and HAS_MSGPACK
        
        payload = self._build_payload(
            text=text,
            response_format=response_format,
            sample_rate=sample_rate,
            reference_id=reference_id,
            normalize=normalize,
            references=references,
            top_p=top_p,
            temperature=temperature,
            chunk_length=chunk_length,
            latency=latency,
            speed=speed,
            volume=volume,
            use_msgpack=use_msgpack,
        )
        payload["streaming"] = True
        headers = self._auth_headers()
        
        # Log payload details for debugging
        payload_summary = {k: v for k, v in payload.items() if k != "references"}
        if "references" in payload:
            payload_summary["references"] = f"[{len(payload['references'])} reference(s)]"
        logger.debug("Streaming synthesis request: %s, use_msgpack=%s", payload_summary, use_msgpack)
        
        # Prepare msgpack data if needed
        msgpack_data = None
        if use_msgpack:
            headers["Content-Type"] = "application/msgpack"
            msgpack_data = ormsgpack.packb(payload)

        async def iterator() -> AsyncIterator[bytes]:
            retries = self._settings.openaudio_max_retries
            attempt = 0
            while True:
                attempt += 1
                try:
                    start = time.perf_counter()
                    # Choose between msgpack and JSON based on voice cloning
                    if use_msgpack and msgpack_data:
                        stream_ctx = client.stream(
                            "POST",
                            self._settings.openaudio_tts_path,
                            content=msgpack_data,
                            headers=headers,
                        )
                    else:
                        stream_ctx = client.stream(
                            "POST",
                            self._settings.openaudio_tts_path,
                            json=payload,
                            headers=headers,
                        )
                    async with stream_ctx as response:
                        if response.status_code >= 400:
                            error_body = await response.aread()
                            error_text = error_body.decode('utf-8', errors='replace')[:1000]
                            logger.error(
                                "Streaming synthesis failed: status=%d, body=%s",
                                response.status_code,
                                error_text
                            )
                            raise RuntimeError(f"OpenAudio streaming failed: {error_text}")
                        async for chunk in response.aiter_bytes():
                            if chunk:
                                yield chunk
                    record_external_call("openaudio_stream", time.perf_counter() - start, success=True)
                    break
                except httpx.HTTPError as exc:  # pragma: no cover - network instability
                    record_external_call("openaudio_stream", time.perf_counter() - start, success=False)
                    if attempt > retries:
                        logger.exception("Streaming synthesis failed after %s attempts", attempt)
                        raise RuntimeError("OpenAudio streaming synthesis failed") from exc
                    backoff = min(2 ** attempt, 10)
                    logger.warning(
                        "Streaming synthesis error (attempt %s/%s), retrying in %ss",
                        attempt,
                        retries,
                        backoff,
                    )
                    await asyncio.sleep(backoff)

        response_format_val = payload.get("format", self._settings.openaudio_default_format)
        sample_rate_val = payload.get("sample_rate", self._settings.default_audio_sample_rate)
        return OpenAudioSynthesisStream(
            iterator_factory=iterator,
            response_format=response_format_val,
            sample_rate=int(sample_rate_val),
            reference_id=payload.get("reference_id"),
            media_type=_media_type_for_format(response_format_val),
        )

    async def _require_client(self) -> httpx.AsyncClient:
        async with self._client_lock:
            if self._client is None:
                await self.startup()
            assert self._client is not None
            return self._client

    def _auth_headers(self) -> Dict[str, str]:
        headers: Dict[str, str] = {}
        if self._settings.openaudio_api_key:
            headers["Authorization"] = f"Bearer {self._settings.openaudio_api_key}"
        return headers

    def _build_payload(
        self,
        *,
        text: str,
        response_format: Optional[str],
        sample_rate: Optional[int],
        reference_id: Optional[str],
        normalize: Optional[bool],
        references: Optional[Sequence[str]],
        top_p: Optional[float],
        temperature: Optional[float],
        chunk_length: Optional[int],
        latency: Optional[str],
        speed: Optional[float],
        volume: Optional[float],
        use_msgpack: bool = False,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "text": text,
            "format": response_format or self._settings.openaudio_default_format,
            "streaming": False,
        }

        chosen_reference = reference_id or self._settings.openaudio_default_reference_id
        if chosen_reference:
            payload["reference_id"] = chosen_reference
        if sample_rate is not None:
            payload["sample_rate"] = sample_rate
        if normalize is not None:
            payload["normalize"] = normalize
        else:
            payload["normalize"] = self._settings.openaudio_default_normalize
        
        # Convert base64 reference strings to the format expected by Fish Speech API
        # Fish Speech expects: [{"audio": <bytes>, "text": <str>}]
        if references:
            formatted_refs = []
            for ref_b64 in references:
                try:
                    # Decode base64 to raw bytes
                    audio_bytes = base64.b64decode(ref_b64)
                    logger.debug(
                        "Processing reference audio: base64_len=%d, decoded_bytes=%d",
                        len(ref_b64), len(audio_bytes)
                    )
                    if use_msgpack:
                        # For msgpack, send raw bytes
                        formatted_refs.append({
                            "audio": audio_bytes,
                            "text": "",  # Empty text - zero-shot cloning
                        })
                    else:
                        # For JSON, keep as base64 string (Fish Speech will decode it)
                        formatted_refs.append({
                            "audio": ref_b64,
                            "text": "",
                        })
                except Exception as e:
                    logger.warning("Failed to process reference audio: %s", e)
                    continue
            if formatted_refs:
                payload["references"] = formatted_refs
                logger.info(
                    "Voice cloning request with %d reference(s), use_msgpack=%s",
                    len(formatted_refs),
                    use_msgpack
                )
        
        if top_p is not None:
            payload["top_p"] = top_p
        if temperature is not None:
            payload["temperature"] = temperature
        if chunk_length is not None:
            payload["chunk_length"] = chunk_length
        if latency is not None:
            payload["latency"] = latency

        prosody: Dict[str, Any] = {}
        if speed is not None:
            prosody["speed"] = speed
        if volume is not None:
            prosody["volume"] = volume
        if prosody:
            payload["prosody"] = prosody

        return payload

