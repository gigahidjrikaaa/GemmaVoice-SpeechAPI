"""
Unit tests for the LLM service module.

Tests cover model loading, generation (sync and async), streaming,
error handling, and resource lifecycle management.
"""

import asyncio
from typing import Any, Dict, Iterator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.config.settings import Settings
from app.services.llm import LLMService
from app.utils.exceptions import (
    GenerationError,
    GenerationTimeoutError,
    ModelNotLoadedError,
)


def create_test_settings(**kwargs: Any) -> Settings:
    """Create Settings instance for tests, bypassing env file loading.
    
    pydantic-settings accepts _env_file as a constructor parameter to
    control env file loading, but Pylance doesn't recognize it.
    """
    return Settings(_env_file=None, **kwargs)  # type: ignore[call-arg]


# ============================================================================
# Service Initialization Tests
# ============================================================================

class TestLLMServiceInit:
    """Test LLMService initialization and configuration."""

    def test_init_with_default_settings(self) -> None:
        """Service initializes correctly with default settings."""
        settings = create_test_settings()
        service = LLMService(settings=settings)
        
        assert service._settings == settings
        assert service._llm is None
        assert service._model_path is None
        assert service._is_loading is False

    def test_init_with_custom_settings(self) -> None:
        """Service accepts custom model configuration."""
        settings = create_test_settings(
            llm_repo_id="custom/model",
            llm_model_filename="custom.gguf",
            llm_context_size=4096,
            llm_gpu_layers=10,
        )
        service = LLMService(settings=settings)
        
        assert service._settings.llm_repo_id == "custom/model"
        assert service._settings.llm_model_filename == "custom.gguf"
        assert service._settings.llm_context_size == 4096

    def test_is_ready_false_initially(self) -> None:
        """Service reports not ready before model is loaded."""
        service = LLMService(settings=create_test_settings())
        assert service.is_ready is False

    def test_model_property_raises_when_not_loaded(self) -> None:
        """Accessing model before loading raises ModelNotLoadedError."""
        service = LLMService(settings=create_test_settings())
        
        with pytest.raises(ModelNotLoadedError):
            _ = service.model


# ============================================================================
# Model Loading Tests
# ============================================================================

class TestLLMServiceStartup:
    """Test model download and loading."""

    @pytest.mark.asyncio
    async def test_startup_downloads_and_loads_model(self) -> None:
        """startup() downloads model from HuggingFace and loads it."""
        settings = create_test_settings(
            llm_repo_id="test/repo",
            llm_model_filename="test.gguf",
        )
        service = LLMService(settings=settings)
        
        mock_llama = MagicMock()
        
        with patch("app.services.llm.hf_hub_download", return_value="/tmp/model.gguf") as mock_download, \
             patch.object(service, "_load_llama_model", return_value=mock_llama):
            await service.startup()
        
        mock_download.assert_called_once()
        assert service._model_path == "/tmp/model.gguf"
        assert service._llm is mock_llama
        assert service.is_ready is True

    @pytest.mark.asyncio
    async def test_startup_is_idempotent(self) -> None:
        """Multiple startup calls don't reload the model."""
        settings = create_test_settings()
        service = LLMService(settings=settings)
        
        mock_llama = MagicMock()
        
        with patch("app.services.llm.hf_hub_download", return_value="/tmp/model.gguf") as mock_download, \
             patch.object(service, "_load_llama_model", return_value=mock_llama):
            await service.startup()
            await service.startup()
        
        # Should only be called once
        mock_download.assert_called_once()

    @pytest.mark.asyncio
    async def test_startup_handles_download_failure(self) -> None:
        """Download failure raises ModelNotLoadedError."""
        settings = create_test_settings()
        service = LLMService(settings=settings)
        
        with patch("app.services.llm.hf_hub_download", side_effect=Exception("Network error")):
            with pytest.raises(ModelNotLoadedError) as exc_info:
                await service.startup()
        
        assert "Failed to download model" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_startup_handles_load_failure(self) -> None:
        """Model loading failure raises ModelNotLoadedError."""
        settings = create_test_settings()
        service = LLMService(settings=settings)
        
        with patch("app.services.llm.hf_hub_download", return_value="/tmp/model.gguf"), \
             patch.object(service, "_load_llama_model", side_effect=Exception("CUDA error")):
            with pytest.raises(ModelNotLoadedError) as exc_info:
                await service.startup()
        
        assert "Failed to load model" in str(exc_info.value)


# ============================================================================
# Shutdown Tests
# ============================================================================

class TestLLMServiceShutdown:
    """Test resource cleanup on shutdown."""

    @pytest.mark.asyncio
    async def test_shutdown_releases_model(self) -> None:
        """shutdown() releases model resources."""
        settings = create_test_settings()
        service = LLMService(settings=settings)
        
        # Manually set up loaded state
        service._llm = MagicMock()
        service._model_path = "/tmp/model.gguf"
        
        await service.shutdown()
        
        assert service._llm is None
        assert service._model_path is None

    @pytest.mark.asyncio
    async def test_shutdown_is_safe_when_not_loaded(self) -> None:
        """shutdown() is safe to call when model isn't loaded."""
        service = LLMService(settings=create_test_settings())
        
        # Should not raise
        await service.shutdown()
        assert service._llm is None


# ============================================================================
# Generation Tests
# ============================================================================

class TestLLMServiceGenerate:
    """Test text generation functionality."""

    @pytest.fixture
    def loaded_service(self) -> LLMService:
        """Provide a service with a mock-loaded model."""
        settings = create_test_settings()
        service = LLMService(settings=settings)
        
        mock_model = MagicMock()
        mock_model.return_value = {
            "choices": [{"text": "Generated response"}],
            "usage": {"prompt_tokens": 5, "completion_tokens": 10, "total_tokens": 15},
        }
        service._llm = mock_model
        
        return service

    @pytest.mark.asyncio
    async def test_generate_returns_response(self, loaded_service: LLMService) -> None:
        """generate() returns model output."""
        result = await loaded_service.generate(
            prompt="Hello, world!",
            max_tokens=50,
            temperature=0.7,
        )
        
        assert "choices" in result
        assert result["choices"][0]["text"] == "Generated response"

    @pytest.mark.asyncio
    async def test_generate_passes_parameters(self, loaded_service: LLMService) -> None:
        """generate() forwards parameters to the model."""
        await loaded_service.generate(
            prompt="Test prompt",
            max_tokens=100,
            temperature=0.5,
            top_p=0.9,
        )
        
        loaded_service._llm.assert_called()  # type: ignore[union-attr]
        call_kwargs = loaded_service._llm.call_args.kwargs  # type: ignore[union-attr]
        assert call_kwargs["prompt"] == "Test prompt"
        assert call_kwargs["max_tokens"] == 100
        assert call_kwargs["temperature"] == 0.5

    @pytest.mark.asyncio
    async def test_generate_raises_when_model_not_loaded(self) -> None:
        """generate() raises ModelNotLoadedError when model isn't loaded."""
        service = LLMService(settings=create_test_settings())
        
        with pytest.raises(ModelNotLoadedError):
            await service.generate(prompt="Test")


# ============================================================================
# Streaming Generation Tests
# ============================================================================

class TestLLMServiceStreaming:
    """Test streaming text generation."""

    @pytest.fixture
    def streaming_service(self) -> LLMService:
        """Provide a service with mock streaming capability."""
        settings = create_test_settings()
        service = LLMService(settings=settings)
        
        def mock_stream(*args: Any, **kwargs: Any) -> Iterator[Dict[str, Any]]:
            yield {"choices": [{"text": "Hello "}]}
            yield {"choices": [{"text": "world"}]}
            yield {"choices": [{"text": "!"}]}
        
        mock_model = MagicMock()
        mock_model.side_effect = mock_stream
        service._llm = mock_model  # type: ignore[assignment]
        
        return service

    def test_generate_stream_yields_tokens(self, streaming_service: LLMService) -> None:
        """generate_stream() yields token chunks."""
        chunks = list(streaming_service.generate_stream(
            prompt="Test",
            max_tokens=50,
        ))
        
        assert len(chunks) == 3
        assert chunks[0]["choices"][0]["text"] == "Hello "
        assert chunks[1]["choices"][0]["text"] == "world"
        assert chunks[2]["choices"][0]["text"] == "!"


# ============================================================================
# Error Handling Tests
# ============================================================================

class TestLLMServiceErrorHandling:
    """Test error handling during generation."""

    @pytest.fixture
    def error_service(self) -> LLMService:
        """Provide a service that raises errors."""
        settings = create_test_settings()
        service = LLMService(settings=settings)
        service._llm = MagicMock()  # type: ignore[assignment]
        return service

    @pytest.mark.asyncio
    async def test_generation_error_is_wrapped(self, error_service: LLMService) -> None:
        """Model errors are wrapped in GenerationError."""
        error_service._llm.side_effect = RuntimeError("Model crashed")  # type: ignore[union-attr]
        
        with pytest.raises(GenerationError):
            await error_service.generate(prompt="Test")

    @pytest.mark.asyncio
    async def test_timeout_error_handling(self, error_service: LLMService) -> None:
        """Timeouts are handled gracefully."""
        error_service._llm.side_effect = asyncio.TimeoutError()  # type: ignore[union-attr]
        
        with pytest.raises(GenerationTimeoutError):
            await error_service.generate(prompt="Test", timeout=1.0)


# ============================================================================
# Thread Safety Tests
# ============================================================================

class TestLLMServiceConcurrency:
    """Test concurrent access patterns."""

    @pytest.mark.asyncio
    async def test_concurrent_startup_is_safe(self) -> None:
        """Multiple concurrent startup calls don't cause issues."""
        settings = create_test_settings()
        service = LLMService(settings=settings)
        
        mock_llama = MagicMock()
        call_count = 0
        
        async def slow_download(*args: Any, **kwargs: Any) -> str:
            nonlocal call_count
            call_count += 1
            await asyncio.sleep(0.1)
            return "/tmp/model.gguf"
        
        with patch("app.services.llm.hf_hub_download", side_effect=slow_download), \
             patch.object(service, "_load_llama_model", return_value=mock_llama):
            # Start multiple concurrent startups
            await asyncio.gather(
                service.startup(),
                service.startup(),
                service.startup(),
            )
        
        # Should only actually download once due to lock
        assert call_count == 1
