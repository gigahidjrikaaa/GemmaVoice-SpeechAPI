"""
Shared pytest fixtures and configuration for the GemmaVoice backend test suite.

This module provides mock services, test clients, and common fixtures used
across all test modules.
"""

import asyncio
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any, AsyncIterator, Dict, Iterator, List, Optional
from unittest.mock import MagicMock

import pytest

# Ensure backend module is importable
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Set test-specific environment variables BEFORE importing app modules
# This prevents issues with .env file parsing during tests
os.environ["API_KEY_ENABLED"] = "false"
os.environ["RATE_LIMIT_ENABLED"] = "false"
os.environ["LOG_LEVEL"] = "DEBUG"
# For list fields in pydantic-settings, we need valid JSON or completely unset
# Empty string is parsed as JSON which fails, so use "[]" for empty list
os.environ["API_KEYS"] = "[]"
os.environ["TESTING"] = "true"

# Now import app modules after environment is configured
from fastapi import FastAPI
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient
from starlette.datastructures import Headers

from app.config.settings import Settings
from app.security import RateLimiter
from app.services.openaudio import OpenAudioSynthesisResult, OpenAudioSynthesisStream
from app.services.whisper import WhisperTranscription, WhisperTranscriptionSegment


# ============================================================================
# Event Loop Configuration
# ============================================================================

@pytest.fixture(scope="session")
def event_loop():
    """Create an event loop for the entire test session."""
    policy = asyncio.get_event_loop_policy()
    loop = policy.new_event_loop()
    yield loop
    loop.close()


# ============================================================================
# Settings Fixtures
# ============================================================================

@pytest.fixture
def test_settings() -> Settings:
    """Create test-specific settings with security disabled."""
    return Settings(
        _env_file=None,  # type: ignore[call-arg]  # Skip .env file to avoid parsing issues
        api_key_enabled=False,
        rate_limit_enabled=False,
        log_level="DEBUG",
        llm_repo_id="test/model",
        llm_model_filename="test.gguf",
        openaudio_api_base="http://localhost:21251",
        enable_faster_whisper=False,
    )


@pytest.fixture
def secure_settings() -> Settings:
    """Create settings with security features enabled for auth tests."""
    return Settings(
        _env_file=None,  # type: ignore[call-arg]  # Skip .env file to avoid parsing issues
        api_key_enabled=True,
        api_keys=["test-api-key", "another-key"],
        rate_limit_enabled=True,
        rate_limit_requests=10,
        rate_limit_window_seconds=60,
        log_level="DEBUG",
    )


# ============================================================================
# Mock Service Classes
# ============================================================================

class MockLLMModel:
    """Mock llama.cpp Llama model for testing."""

    def __init__(self, response_text: str = "Mock generated response"):
        self._response_text = response_text
        self._call_count = 0

    def __call__(
        self,
        prompt: str = "",
        max_tokens: int = 100,
        temperature: float = 0.7,
        stream: bool = False,
        **kwargs: Any,
    ) -> Dict[str, Any] | Iterator[Dict[str, Any]]:
        self._call_count += 1
        
        if stream:
            return self._stream_response()
        
        return {
            "choices": [{"text": self._response_text}],
            "usage": {
                "prompt_tokens": len(prompt.split()),
                "completion_tokens": len(self._response_text.split()),
                "total_tokens": len(prompt.split()) + len(self._response_text.split()),
            },
        }

    def _stream_response(self) -> Iterator[Dict[str, Any]]:
        """Yield mock streaming chunks."""
        words = self._response_text.split()
        for i, word in enumerate(words):
            yield {
                "choices": [{"text": word + " "}],
                "usage": None,
            }
        yield {
            "choices": [{"text": ""}],
            "usage": {
                "prompt_tokens": 5,
                "completion_tokens": len(words),
                "total_tokens": 5 + len(words),
            },
        }


class MockLLMService:
    """Mock LLMService for testing without actual model loading."""

    def __init__(self, response_text: str = "Hello from mock Gemma") -> None:
        self._response_text = response_text
        self._model = MockLLMModel(response_text)
        self._is_ready = True
        self._settings = Settings(_env_file=None)  # type: ignore[call-arg]

    @property
    def model(self) -> MockLLMModel:
        return self._model

    @property
    def is_ready(self) -> bool:
        return self._is_ready

    async def startup(self) -> None:
        pass

    async def shutdown(self) -> None:
        pass

    async def generate(self, prompt: str, **kwargs: Any) -> Dict[str, Any]:
        """Async generation that delegates to the mock model."""
        return self._model(prompt=prompt, stream=False, **kwargs)

    def generate_stream(self, prompt: str, **kwargs: Any) -> Iterator[Dict[str, Any]]:
        """Streaming generation."""
        return self._model(prompt=prompt, stream=True, **kwargs)


class MockWhisperService:
    """Mock WhisperService for testing without actual transcription."""

    def __init__(self, transcription_text: str = "This is transcribed text") -> None:
        self._transcription_text = transcription_text
        self._is_ready = True

    @property
    def is_ready(self) -> bool:
        return self._is_ready

    async def startup(self) -> None:
        pass

    async def shutdown(self) -> None:
        pass

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
        return WhisperTranscription(
            text=self._transcription_text,
            language=language or "en",
            segments=[
                WhisperTranscriptionSegment(
                    id=1,
                    start=0.0,
                    end=1.5,
                    text=self._transcription_text,
                ),
            ],
        )


class MockOpenAudioService:
    """Mock OpenAudioService for testing without actual TTS."""

    def __init__(self) -> None:
        self._is_ready = True
        self._synthesis_calls: List[Dict[str, Any]] = []

    @property
    def is_ready(self) -> bool:
        return self._is_ready

    async def startup(self) -> None:
        pass

    async def shutdown(self) -> None:
        pass

    async def synthesize(
        self,
        *,
        text: str,
        response_format: Optional[str] = None,
        sample_rate: Optional[int] = None,
        reference_id: Optional[str] = None,
        **kwargs: Any,
    ) -> OpenAudioSynthesisResult:
        self._synthesis_calls.append({"text": text, **kwargs})
        
        # Create a simple WAV-like header for testing
        mock_audio = b"RIFF" + b"\x00" * 40 + b"data" + b"\x00" * 100
        
        return OpenAudioSynthesisResult(
            audio=mock_audio,
            response_format=response_format or "wav",
            sample_rate=sample_rate or 44100,
            reference_id=reference_id or "test-ref",
            media_type="audio/wav",
        )

    async def synthesize_stream(
        self,
        *,
        text: str,
        **kwargs: Any,
    ) -> OpenAudioSynthesisStream:
        self._synthesis_calls.append({"text": text, "stream": True, **kwargs})

        async def iterator() -> AsyncIterator[bytes]:
            yield b"audio-chunk-1"
            yield b"audio-chunk-2"
            yield b"audio-chunk-3"

        return OpenAudioSynthesisStream(
            iterator_factory=iterator,
            response_format="pcm",
            sample_rate=16000,
            reference_id="test-ref",
            media_type="audio/pcm",
        )


# ============================================================================
# Service Fixtures
# ============================================================================

@pytest.fixture
def mock_llm_service() -> MockLLMService:
    """Provide a mock LLM service."""
    return MockLLMService()


@pytest.fixture
def mock_whisper_service() -> MockWhisperService:
    """Provide a mock Whisper service."""
    return MockWhisperService()


@pytest.fixture
def mock_openaudio_service() -> MockOpenAudioService:
    """Provide a mock OpenAudio service."""
    return MockOpenAudioService()


@pytest.fixture
def rate_limiter(test_settings: Settings) -> RateLimiter:
    """Provide a rate limiter with test settings."""
    return RateLimiter(settings=test_settings)


# ============================================================================
# Application Fixtures
# ============================================================================

@pytest.fixture
def app(
    test_settings: Settings,
    mock_llm_service: MockLLMService,
    mock_whisper_service: MockWhisperService,
    mock_openaudio_service: MockOpenAudioService,
) -> FastAPI:
    """Create a test FastAPI app with mock services."""
    # Import create_app lazily to avoid issues with module-level app creation
    from app.main import create_app
    
    application = create_app(settings=test_settings)
    
    # Override services with mocks
    application.state.llm_service = mock_llm_service
    application.state.whisper_service = mock_whisper_service
    application.state.openaudio_service = mock_openaudio_service
    application.state.rate_limiter = RateLimiter(settings=test_settings)
    
    # Create mock conversation service
    from app.services.conversation import ConversationService
    application.state.conversation_service = ConversationService(
        llm_service=mock_llm_service,
        whisper_service=mock_whisper_service,
        openaudio_service=mock_openaudio_service,
    )
    
    return application


@pytest.fixture
def test_client(app: FastAPI) -> TestClient:
    """Create a synchronous test client."""
    return TestClient(app)


@pytest.fixture
async def async_client(app: FastAPI) -> AsyncIterator[AsyncClient]:
    """Create an async test client for async endpoint testing."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


# ============================================================================
# WebSocket Test Helpers
# ============================================================================

class DummyWebSocket:
    """Minimal WebSocket mock for testing security enforcement."""

    def __init__(
        self,
        headers: Dict[str, str],
        host: str = "127.0.0.1",
        rate_limiter: Optional[RateLimiter] = None,
    ) -> None:
        self.headers = Headers(headers)
        self.client = SimpleNamespace(host=host, port=1234)
        self.app = SimpleNamespace(
            state=SimpleNamespace(rate_limiter=rate_limiter)
        )
        self.closed = False
        self.close_args: List[tuple] = []
        self.accepted = False

    async def accept(self) -> None:
        self.accepted = True

    async def close(self, code: int = 1000, reason: str = "") -> None:
        self.closed = True
        self.close_args.append((code, reason))

    async def send_text(self, data: str) -> None:
        pass

    async def send_bytes(self, data: bytes) -> None:
        pass

    async def receive_text(self) -> str:
        return "{}"

    async def receive_bytes(self) -> bytes:
        return b""


@pytest.fixture
def dummy_websocket(rate_limiter: RateLimiter) -> DummyWebSocket:
    """Provide a dummy WebSocket for testing."""
    return DummyWebSocket(headers={}, rate_limiter=rate_limiter)


# ============================================================================
# Audio Test Data
# ============================================================================

@pytest.fixture
def sample_audio_bytes() -> bytes:
    """Provide minimal WAV audio bytes for testing."""
    # Minimal valid WAV header
    return (
        b"RIFF"
        b"\x24\x00\x00\x00"  # File size
        b"WAVE"
        b"fmt "
        b"\x10\x00\x00\x00"  # Subchunk1Size
        b"\x01\x00"          # AudioFormat (PCM)
        b"\x01\x00"          # NumChannels (mono)
        b"\x44\xac\x00\x00"  # SampleRate (44100)
        b"\x88\x58\x01\x00"  # ByteRate
        b"\x02\x00"          # BlockAlign
        b"\x10\x00"          # BitsPerSample
        b"data"
        b"\x00\x00\x00\x00"  # Data size
    )


# ============================================================================
# Request Builder Helpers
# ============================================================================

def build_mock_request(
    headers: Optional[Dict[str, str]] = None,
    method: str = "GET",
    path: str = "/test",
    host: str = "127.0.0.1",
    app_state: Optional[SimpleNamespace] = None,
) -> MagicMock:
    """Build a mock FastAPI Request object for testing."""
    from starlette.requests import Request
    
    encoded_headers = [
        (name.lower().encode("latin-1"), value.encode("latin-1"))
        for name, value in (headers or {}).items()
    ]
    
    scope = {
        "type": "http",
        "method": method,
        "path": path,
        "headers": encoded_headers,
        "client": (host, 1234),
        "app": SimpleNamespace(state=app_state or SimpleNamespace()),
    }
    
    return Request(scope)
