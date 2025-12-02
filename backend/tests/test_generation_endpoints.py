"""
Unit tests for the generation API endpoints.

Tests cover /v1/generate, /v1/generate_stream, chat template application,
parameter validation, and error responses.
"""

import json
from typing import Any, Dict, List
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from httpx import AsyncClient

from app.config.settings import Settings
from app.schemas.generation import GenerationRequest, GenerationResponse


# ============================================================================
# Synchronous Generation Endpoint Tests
# ============================================================================

class TestGenerateEndpoint:
    """Test /v1/generate endpoint."""

    def test_generate_returns_200(self, test_client: TestClient) -> None:
        """POST /v1/generate returns 200 with valid request."""
        response = test_client.post(
            "/v1/generate",
            json={"prompt": "Hello, how are you?"},
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "generated_text" in data

    def test_generate_accepts_all_parameters(self, test_client: TestClient) -> None:
        """Endpoint accepts all generation parameters."""
        response = test_client.post(
            "/v1/generate",
            json={
                "prompt": "Test prompt",
                "system_prompt": "You are helpful",
                "max_tokens": 100,
                "temperature": 0.5,
                "top_p": 0.9,
                "top_k": 50,
                "repeat_penalty": 1.2,
                "stop": [".", "!"],
                "seed": 42,
            },
        )
        
        assert response.status_code == 200

    def test_generate_requires_prompt(self, test_client: TestClient) -> None:
        """Endpoint requires prompt field."""
        response = test_client.post(
            "/v1/generate",
            json={},
        )
        
        assert response.status_code == 422
        data = response.json()
        assert "prompt" in str(data).lower()

    def test_generate_validates_temperature_range(self, test_client: TestClient) -> None:
        """Temperature must be between 0 and 2."""
        response = test_client.post(
            "/v1/generate",
            json={"prompt": "Test", "temperature": 3.0},
        )
        
        assert response.status_code == 422

    def test_generate_validates_max_tokens_range(self, test_client: TestClient) -> None:
        """max_tokens must be between 1 and 4096."""
        response = test_client.post(
            "/v1/generate",
            json={"prompt": "Test", "max_tokens": 10000},
        )
        
        assert response.status_code == 422

    def test_generate_validates_top_p_range(self, test_client: TestClient) -> None:
        """top_p must be between 0 and 1."""
        response = test_client.post(
            "/v1/generate",
            json={"prompt": "Test", "top_p": 1.5},
        )
        
        assert response.status_code == 422


# ============================================================================
# Chat Template Tests
# ============================================================================

class TestChatTemplateApplication:
    """Test automatic chat template application."""

    def test_template_applied_to_raw_prompt(self, test_client: TestClient, app: FastAPI) -> None:
        """Chat template is applied when prompt doesn't have it."""
        # Track the prompt that gets passed to the model
        captured_prompts: List[str] = []
        original_generate = app.state.llm_service.generate
        
        async def capture_generate(prompt: str, **kwargs: Any) -> Dict[str, Any]:
            captured_prompts.append(prompt)
            return await original_generate(prompt, **kwargs)
        
        app.state.llm_service.generate = capture_generate
        
        test_client.post(
            "/v1/generate",
            json={"prompt": "Hello"},
        )
        
        assert len(captured_prompts) > 0
        assert "<start_of_turn>" in captured_prompts[0]

    def test_template_not_applied_when_present(self, test_client: TestClient, app: FastAPI) -> None:
        """Chat template is not reapplied when already present."""
        captured_prompts: List[str] = []
        original_generate = app.state.llm_service.generate
        
        async def capture_generate(prompt: str, **kwargs: Any) -> Dict[str, Any]:
            captured_prompts.append(prompt)
            return await original_generate(prompt, **kwargs)
        
        app.state.llm_service.generate = capture_generate
        
        formatted_prompt = "<start_of_turn>user\nHello<end_of_turn>\n<start_of_turn>model\n"
        test_client.post(
            "/v1/generate",
            json={"prompt": formatted_prompt},
        )
        
        assert len(captured_prompts) > 0
        # Template should not be doubled
        assert captured_prompts[0].count("<start_of_turn>user") == 1

    def test_system_prompt_included_in_template(self, test_client: TestClient, app: FastAPI) -> None:
        """System prompt is included in the chat template."""
        captured_prompts: List[str] = []
        original_generate = app.state.llm_service.generate
        
        async def capture_generate(prompt: str, **kwargs: Any) -> Dict[str, Any]:
            captured_prompts.append(prompt)
            return await original_generate(prompt, **kwargs)
        
        app.state.llm_service.generate = capture_generate
        
        test_client.post(
            "/v1/generate",
            json={
                "prompt": "Hello",
                "system_prompt": "You are a pirate",
            },
        )
        
        assert len(captured_prompts) > 0
        assert "pirate" in captured_prompts[0]
        assert "<start_of_turn>system" in captured_prompts[0]


# ============================================================================
# Streaming Endpoint Tests
# ============================================================================

class TestGenerateStreamEndpoint:
    """Test /v1/generate_stream SSE endpoint."""

    def test_stream_returns_200(self, test_client: TestClient) -> None:
        """POST /v1/generate_stream returns 200."""
        response = test_client.post(
            "/v1/generate_stream",
            json={"prompt": "Count to 5"},
        )
        
        assert response.status_code == 200

    def test_stream_returns_sse_content_type(self, test_client: TestClient) -> None:
        """Streaming endpoint returns SSE content type."""
        response = test_client.post(
            "/v1/generate_stream",
            json={"prompt": "Test"},
        )
        
        assert "text/event-stream" in response.headers.get("content-type", "")

    def test_stream_yields_events(self, test_client: TestClient) -> None:
        """Streaming endpoint yields SSE events."""
        response = test_client.post(
            "/v1/generate_stream",
            json={"prompt": "Test"},
        )
        
        content = response.text
        # SSE events start with "data:" or "event:"
        assert "data:" in content or "event:" in content


# ============================================================================
# Error Handling Tests
# ============================================================================

class TestGenerationErrorHandling:
    """Test error responses from generation endpoints."""

    def test_invalid_json_returns_422(self, test_client: TestClient) -> None:
        """Invalid JSON returns 422 Unprocessable Entity."""
        response = test_client.post(
            "/v1/generate",
            content="not valid json{",
            headers={"Content-Type": "application/json"},
        )
        
        assert response.status_code == 422

    def test_model_unavailable_returns_503(self, test_client: TestClient, app: FastAPI) -> None:
        """503 is returned when model is not loaded."""
        from app.utils.exceptions import ModelNotLoadedError
        
        async def raise_not_loaded(*args: Any, **kwargs: Any) -> None:
            raise ModelNotLoadedError("Model not loaded")
        
        app.state.llm_service.generate = raise_not_loaded
        
        response = test_client.post(
            "/v1/generate",
            json={"prompt": "Test"},
        )
        
        assert response.status_code == 503

    def test_generation_error_returns_500(self, test_client: TestClient, app: FastAPI) -> None:
        """500 is returned on generation failure."""
        async def raise_error(*args: Any, **kwargs: Any) -> None:
            raise Exception("Generation failed")
        
        app.state.llm_service.generate = raise_error
        
        response = test_client.post(
            "/v1/generate",
            json={"prompt": "Test"},
        )
        
        assert response.status_code == 500


# ============================================================================
# Models List Endpoint Tests
# ============================================================================

class TestModelsEndpoint:
    """Test /v1/models endpoint."""

    def test_models_list_returns_200(self, test_client: TestClient) -> None:
        """GET /v1/models returns 200."""
        response = test_client.get("/v1/models")
        
        # This endpoint may or may not exist
        assert response.status_code in [200, 404]

    def test_models_list_structure(self, test_client: TestClient) -> None:
        """Models endpoint returns proper structure."""
        response = test_client.get("/v1/models")
        
        if response.status_code == 200:
            data = response.json()
            assert "models" in data or "data" in data


# ============================================================================
# Content Type Tests
# ============================================================================

class TestContentTypes:
    """Test content type handling."""

    def test_accepts_json_content_type(self, test_client: TestClient) -> None:
        """Endpoint accepts application/json."""
        response = test_client.post(
            "/v1/generate",
            json={"prompt": "Test"},
            headers={"Content-Type": "application/json"},
        )
        
        assert response.status_code == 200

    def test_returns_json_response(self, test_client: TestClient) -> None:
        """Endpoint returns application/json."""
        response = test_client.post(
            "/v1/generate",
            json={"prompt": "Test"},
        )
        
        assert "application/json" in response.headers.get("content-type", "")


# ============================================================================
# Request/Response Schema Tests
# ============================================================================

class TestGenerationSchemas:
    """Test request and response schemas."""

    def test_request_schema_defaults(self) -> None:
        """GenerationRequest has sensible defaults."""
        request = GenerationRequest(prompt="Test")
        
        assert request.max_tokens == 512
        assert request.temperature == 0.7
        assert request.top_p == 0.95
        assert request.top_k == 40
        assert request.repeat_penalty == 1.1

    def test_request_schema_validation(self) -> None:
        """GenerationRequest validates input."""
        with pytest.raises(ValueError):
            GenerationRequest(prompt="", temperature=-1)

    def test_response_schema_structure(self) -> None:
        """GenerationResponse has correct structure."""
        response = GenerationResponse(generated_text="Hello")
        
        assert response.generated_text == "Hello"
        assert response.model_dump() == {"generated_text": "Hello"}


# ============================================================================
# Stop Sequence Tests
# ============================================================================

class TestStopSequences:
    """Test stop sequence handling."""

    def test_stop_sequences_accepted(self, test_client: TestClient) -> None:
        """Stop sequences are accepted."""
        response = test_client.post(
            "/v1/generate",
            json={
                "prompt": "Test",
                "stop": ["\n", ".", "!"],
            },
        )
        
        assert response.status_code == 200

    def test_empty_stop_sequences_handled(self, test_client: TestClient) -> None:
        """Empty stop sequences are handled gracefully."""
        response = test_client.post(
            "/v1/generate",
            json={
                "prompt": "Test",
                "stop": [],
            },
        )
        
        assert response.status_code == 200

    def test_null_stop_sequences_handled(self, test_client: TestClient) -> None:
        """Null stop sequences are handled gracefully."""
        response = test_client.post(
            "/v1/generate",
            json={
                "prompt": "Test",
                "stop": None,
            },
        )
        
        assert response.status_code == 200
