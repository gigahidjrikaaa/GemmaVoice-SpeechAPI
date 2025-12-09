"""
Unit tests for the Whisper service module.

Tests cover local (Faster Whisper) and remote (OpenAI API) transcription,
service lifecycle, and error handling.
"""

import asyncio
from typing import Any, Dict, List, Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.config.settings import Settings
from app.services.whisper import (
    WhisperService,
    WhisperTranscription,
    WhisperTranscriptionSegment,
)


def create_test_settings(**kwargs: Any) -> Settings:
    """Create Settings instance for tests, bypassing env file loading.
    
    pydantic-settings accepts _env_file as a constructor parameter to
    control env file loading, but Pylance doesn't recognize it.
    """
    return Settings(_env_file=None, **kwargs)  # type: ignore[call-arg]


# ============================================================================
# Data Model Tests
# ============================================================================

class TestWhisperTranscriptionSegment:
    """Test WhisperTranscriptionSegment dataclass."""

    def test_segment_creation(self) -> None:
        """Segment is created with all fields."""
        segment = WhisperTranscriptionSegment(
            id=1,
            start=0.0,
            end=2.5,
            text="Hello world",
        )
        
        assert segment.id == 1
        assert segment.start == 0.0
        assert segment.end == 2.5
        assert segment.text == "Hello world"

    def test_segment_with_optional_fields(self) -> None:
        """Segment works with None for optional fields."""
        segment = WhisperTranscriptionSegment(
            id=None,
            start=None,
            end=None,
            text="Test",
        )
        
        assert segment.id is None
        assert segment.start is None
        assert segment.end is None
        assert segment.text == "Test"


class TestWhisperTranscription:
    """Test WhisperTranscription dataclass."""

    def test_transcription_creation(self) -> None:
        """Transcription is created with all fields."""
        segments = [
            WhisperTranscriptionSegment(id=1, start=0.0, end=1.0, text="Hello"),
            WhisperTranscriptionSegment(id=2, start=1.0, end=2.0, text=" world"),
        ]
        
        transcription = WhisperTranscription(
            text="Hello world",
            language="en",
            segments=segments,
        )
        
        assert transcription.text == "Hello world"
        assert transcription.language == "en"
        assert len(transcription.segments) == 2

    def test_from_segments_factory(self) -> None:
        """from_segments() creates transcription from segment list."""
        segments = [
            WhisperTranscriptionSegment(id=1, start=0.0, end=1.0, text="Hello"),
            WhisperTranscriptionSegment(id=2, start=1.0, end=2.0, text=" world"),
        ]
        
        transcription = WhisperTranscription.from_segments(segments, "en")
        
        assert transcription.text == "Hello world"
        assert transcription.language == "en"
        assert transcription.segments == segments


# ============================================================================
# Service Initialization Tests
# ============================================================================

class TestWhisperServiceInit:
    """Test WhisperService initialization."""

    def test_init_with_default_settings(self) -> None:
        """Service initializes with default settings."""
        settings = create_test_settings()
        service = WhisperService(settings=settings)
        
        assert service._settings == settings
        assert service._client is None
        assert service._local_model is None

    def test_init_for_faster_whisper(self) -> None:
        """Service configures for local Faster Whisper."""
        settings = create_test_settings( enable_faster_whisper=True)
        service = WhisperService(settings=settings)
        
        assert service._settings.enable_faster_whisper is True

    def test_init_for_remote_api(self) -> None:
        """Service configures for remote OpenAI API."""
        settings = create_test_settings(
            enable_faster_whisper=False,
            openai_api_key="test-key",
        )
        service = WhisperService(settings=settings)
        
        assert service._settings.enable_faster_whisper is False
        assert service._settings.openai_api_key == "test-key"


# ============================================================================
# Startup Tests
# ============================================================================

class TestWhisperServiceStartup:
    """Test service startup behavior."""

    @pytest.mark.asyncio
    async def test_startup_with_faster_whisper(self) -> None:
        """startup() loads local model when Faster Whisper is enabled."""
        settings = create_test_settings(
            enable_faster_whisper=True,
            faster_whisper_model_size="base",
            faster_whisper_device="cpu",
        )
        service = WhisperService(settings=settings)
        
        mock_model = MagicMock()
        
        with patch("app.services.whisper.WhisperModel", return_value=mock_model):
            await service.startup()
        
        assert service._local_model is mock_model
        assert service.is_ready is True

    @pytest.mark.asyncio
    async def test_startup_with_remote_api(self) -> None:
        """startup() initializes OpenAI client when API key is provided."""
        settings = create_test_settings(
            enable_faster_whisper=False,
            openai_api_key="sk-test",
            openai_api_base="https://api.openai.com/v1",
        )
        service = WhisperService(settings=settings)
        
        with patch("app.services.whisper.AsyncOpenAI") as mock_openai:
            mock_client = MagicMock()
            mock_openai.return_value = mock_client
            await service.startup()
        
        assert service._client is mock_client
        assert service.is_ready is True

    @pytest.mark.asyncio
    async def test_startup_without_configuration(self) -> None:
        """startup() with no backend configured doesn't crash."""
        settings = create_test_settings(
            enable_faster_whisper=False,
            openai_api_key=None,
        )
        service = WhisperService(settings=settings)
        
        await service.startup()
        
        assert service.is_ready is False


# ============================================================================
# Shutdown Tests
# ============================================================================

class TestWhisperServiceShutdown:
    """Test service shutdown behavior."""

    @pytest.mark.asyncio
    async def test_shutdown_clears_resources(self) -> None:
        """shutdown() releases all resources."""
        settings = create_test_settings()
        service = WhisperService(settings=settings)
        service._client = MagicMock()
        service._local_model = MagicMock()
        
        await service.shutdown()
        
        assert service._client is None
        assert service._local_model is None

    @pytest.mark.asyncio
    async def test_shutdown_is_idempotent(self) -> None:
        """Multiple shutdown calls are safe."""
        service = WhisperService(settings=create_test_settings())
        
        await service.shutdown()
        await service.shutdown()  # Should not raise


# ============================================================================
# Transcription Tests - Remote API
# ============================================================================

class TestWhisperServiceRemoteTranscription:
    """Test transcription via remote OpenAI API."""

    @pytest.fixture
    def remote_service(self) -> WhisperService:
        """Provide a service with mocked remote client."""
        settings = create_test_settings(
            enable_faster_whisper=False,
            openai_api_key="sk-test",
        )
        service = WhisperService(settings=settings)
        
        mock_response = MagicMock()
        mock_response.model_dump.return_value = {
            "text": "Transcribed text",
            "language": "en",
            "segments": [
                {"id": 1, "start": 0.0, "end": 1.5, "text": "Transcribed text"}
            ],
        }
        
        mock_client = AsyncMock()
        mock_client.audio.transcriptions.create = AsyncMock(return_value=mock_response)
        service._client = mock_client
        
        return service

    @pytest.mark.asyncio
    async def test_transcribe_returns_result(self, remote_service: WhisperService) -> None:
        """transcribe() returns transcription result."""
        result = await remote_service.transcribe(
            audio_bytes=b"fake-audio",
            filename="test.wav",
            content_type="audio/wav",
        )
        
        assert isinstance(result, WhisperTranscription)
        assert result.text == "Transcribed text"
        assert result.language == "en"
        assert len(result.segments) == 1

    @pytest.mark.asyncio
    async def test_transcribe_passes_options(self, remote_service: WhisperService) -> None:
        """transcribe() forwards options to the API."""
        await remote_service.transcribe(
            audio_bytes=b"fake-audio",
            filename="test.wav",
            language="es",
            prompt="Previous context",
            temperature=0.3,
        )
        
        call_kwargs = remote_service._client.audio.transcriptions.create.call_args.kwargs  # type: ignore[union-attr]
        assert call_kwargs["language"] == "es"
        assert call_kwargs["prompt"] == "Previous context"
        assert call_kwargs["temperature"] == 0.3


# ============================================================================
# Transcription Tests - Local Faster Whisper
# ============================================================================

class TestWhisperServiceLocalTranscription:
    """Test transcription via local Faster Whisper."""

    @pytest.fixture
    def local_service(self) -> WhisperService:
        """Provide a service with mocked local model."""
        settings = create_test_settings( enable_faster_whisper=True)
        service = WhisperService(settings=settings)
        
        # Mock transcription result
        mock_segment = MagicMock()
        mock_segment.id = 1
        mock_segment.start = 0.0
        mock_segment.end = 1.5
        mock_segment.text = "Local transcription"
        
        mock_info = MagicMock()
        mock_info.language = "en"
        
        mock_model = MagicMock()
        mock_model.transcribe.return_value = ([mock_segment], mock_info)
        service._local_model = mock_model
        
        return service

    @pytest.mark.asyncio
    async def test_local_transcribe_returns_result(self, local_service: WhisperService) -> None:
        """Local transcription returns properly formatted result."""
        result = await local_service.transcribe(
            audio_bytes=b"fake-audio",
            filename="test.wav",
        )
        
        assert isinstance(result, WhisperTranscription)
        assert "transcription" in result.text.lower() or len(result.segments) > 0

    @pytest.mark.asyncio
    async def test_local_transcribe_handles_language_hint(self, local_service: WhisperService) -> None:
        """Local transcription accepts language parameter."""
        await local_service.transcribe(
            audio_bytes=b"fake-audio",
            filename="test.wav",
            language="ja",
        )
        
        call_kwargs = local_service._local_model.transcribe.call_args  # type: ignore[union-attr]
        assert call_kwargs is not None


# ============================================================================
# Error Handling Tests
# ============================================================================

class TestWhisperServiceErrors:
    """Test error handling in Whisper service."""

    @pytest.mark.asyncio
    async def test_transcribe_without_backend_raises(self) -> None:
        """transcribe() raises when no backend is configured."""
        service = WhisperService(settings=create_test_settings( enable_faster_whisper=False))
        
        with pytest.raises(RuntimeError, match="not configured"):
            await service.transcribe(
                audio_bytes=b"fake",
                filename="test.wav",
            )

    @pytest.mark.asyncio
    async def test_remote_api_error_is_handled(self) -> None:
        """Remote API errors are wrapped appropriately."""
        settings = create_test_settings(
            enable_faster_whisper=False,
            openai_api_key="sk-test",
        )
        service = WhisperService(settings=settings)
        
        mock_client = AsyncMock()
        mock_client.audio.transcriptions.create = AsyncMock(
            side_effect=Exception("API Error")
        )
        service._client = mock_client
        
        with pytest.raises(RuntimeError, match="transcription failed"):
            await service.transcribe(
                audio_bytes=b"fake",
                filename="test.wav",
            )


# ============================================================================
# Is Ready Property Tests
# ============================================================================

class TestWhisperServiceIsReady:
    """Test is_ready property behavior."""

    def test_is_ready_false_initially(self) -> None:
        """is_ready is False when no backend is configured."""
        service = WhisperService(settings=create_test_settings())
        assert service.is_ready is False

    def test_is_ready_true_with_client(self) -> None:
        """is_ready is True when remote client is configured."""
        service = WhisperService(settings=create_test_settings())
        service._client = MagicMock()
        assert service.is_ready is True

    def test_is_ready_true_with_local_model(self) -> None:
        """is_ready is True when local model is loaded."""
        service = WhisperService(settings=create_test_settings())
        service._local_model = MagicMock()
        assert service.is_ready is True
