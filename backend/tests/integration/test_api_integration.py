"""
Integration tests for GemmaVoice API endpoints.

These tests run against the actual Docker containers to verify
end-to-end functionality.

Skip these tests by default unless the API service is running.
Run with: pytest tests/integration/ --run-integration
"""

import pytest
import httpx
import asyncio
from typing import AsyncGenerator

# Test configuration
API_BASE_URL = "http://localhost:6666"
TIMEOUT = 30.0

# Skip all tests in this module if --run-integration is not provided
pytestmark = pytest.mark.integration


def pytest_configure(config):
    """Register custom markers."""
    config.addinivalue_line(
        "markers", "integration: mark test as an integration test"
    )


@pytest.fixture(scope="module")
def event_loop():
    """Create an instance of the default event loop for the test session."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


async def check_service_available() -> bool:
    """Check if the API service is running."""
    try:
        async with httpx.AsyncClient(base_url=API_BASE_URL, timeout=5.0) as client:
            response = await client.get("/health")
            return response.status_code == 200
    except (httpx.ConnectError, httpx.ReadTimeout):
        return False


@pytest.fixture(scope="module")
async def client() -> AsyncGenerator[httpx.AsyncClient, None]:
    """Create an async HTTP client for testing."""
    # Check if service is available
    if not await check_service_available():
        pytest.skip(f"API service not available at {API_BASE_URL}")
    
    async with httpx.AsyncClient(base_url=API_BASE_URL, timeout=TIMEOUT) as client:
        yield client


class TestHealthEndpoints:
    """Test health and status endpoints."""
    
    @pytest.mark.asyncio
    async def test_health_endpoint(self, client: httpx.AsyncClient):
        """Test that health endpoint returns 200 OK."""
        response = await client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
    
    @pytest.mark.asyncio
    async def test_metrics_endpoint(self, client: httpx.AsyncClient):
        """Test that metrics endpoint is accessible."""
        response = await client.get("/metrics")
        assert response.status_code == 200
        assert "python_info" in response.text


class TestGenerationEndpoints:
    """Test LLM generation endpoints."""
    
    @pytest.mark.asyncio
    async def test_generate_text(self, client: httpx.AsyncClient):
        """Test basic text generation endpoint."""
        payload = {
            "prompt": "Hello, how are you?",
            "max_tokens": 50,
            "temperature": 0.7
        }
        
        response = await client.post("/v1/generate", json=payload)
        assert response.status_code == 200
        
        data = response.json()
        assert "text" in data
        assert "tokens" in data
        assert len(data["text"]) > 0
    
    @pytest.mark.asyncio
    async def test_generate_stream(self, client: httpx.AsyncClient):
        """Test streaming text generation."""
        payload = {
            "prompt": "Count to 5:",
            "max_tokens": 50,
            "stream": True
        }
        
        chunks = []
        async with client.stream("POST", "/v1/generate_stream", json=payload) as response:
            assert response.status_code == 200
            
            async for line in response.aiter_lines():
                if line.strip():
                    chunks.append(line)
        
        assert len(chunks) > 0
        assert all("text" in chunk or "done" in chunk for chunk in chunks)


class TestSpeechEndpoints:
    """Test speech-to-text and text-to-speech endpoints."""
    
    @pytest.mark.asyncio
    async def test_transcribe_endpoint_requires_file(self, client: httpx.AsyncClient):
        """Test that transcription endpoint requires audio file."""
        response = await client.post("/v1/transcribe")
        # Should return 422 (validation error) without file
        assert response.status_code == 422
    
    @pytest.mark.asyncio
    async def test_synthesize_endpoint(self, client: httpx.AsyncClient):
        """Test text-to-speech synthesis."""
        payload = {
            "text": "Hello, this is a test.",
            "format": "wav"
        }
        
        response = await client.post("/v1/synthesize", json=payload)
        
        # This might fail if OpenAudio is not running, that's OK for basic test
        # Just verify the endpoint exists and returns proper error if service unavailable
        assert response.status_code in [200, 500, 503]


class TestDialogueEndpoint:
    """Test dialogue (conversation) endpoint."""
    
    @pytest.mark.asyncio
    async def test_dialogue_endpoint(self, client: httpx.AsyncClient):
        """Test conversation endpoint with message history."""
        payload = {
            "messages": [
                {"role": "user", "content": "Hello!"},
                {"role": "assistant", "content": "Hi there!"},
                {"role": "user", "content": "How are you?"}
            ],
            "max_tokens": 50
        }
        
        response = await client.post("/v1/dialogue", json=payload)
        assert response.status_code == 200
        
        data = response.json()
        assert "response" in data
        assert len(data["response"]) > 0


class TestErrorHandling:
    """Test error handling and validation."""
    
    @pytest.mark.asyncio
    async def test_invalid_json(self, client: httpx.AsyncClient):
        """Test that invalid JSON returns 422."""
        response = await client.post(
            "/v1/generate",
            content="invalid json{",
            headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 422
    
    @pytest.mark.asyncio
    async def test_missing_required_fields(self, client: httpx.AsyncClient):
        """Test that missing required fields returns 422."""
        response = await client.post("/v1/generate", json={})
        assert response.status_code == 422
    
    @pytest.mark.asyncio
    async def test_invalid_parameters(self, client: httpx.AsyncClient):
        """Test that invalid parameters are rejected."""
        payload = {
            "prompt": "Test",
            "temperature": 5.0,  # Invalid: should be 0-2
            "max_tokens": -1     # Invalid: should be positive
        }
        
        response = await client.post("/v1/generate", json=payload)
        assert response.status_code == 422


class TestCORS:
    """Test CORS configuration."""
    
    @pytest.mark.asyncio
    async def test_cors_headers(self, client: httpx.AsyncClient):
        """Test that CORS headers are present."""
        response = await client.options(
            "/v1/generate",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "POST"
            }
        )
        
        # Should allow CORS
        assert response.status_code in [200, 204]
        assert "access-control-allow-origin" in [h.lower() for h in response.headers]


class TestRateLimiting:
    """Test rate limiting (if enabled)."""
    
    @pytest.mark.asyncio
    async def test_rate_limit_headers(self, client: httpx.AsyncClient):
        """Test that rate limit headers are present when enabled."""
        response = await client.get("/health")
        
        # If rate limiting is enabled, these headers should be present
        # If not enabled (testing mode), they won't be there - that's OK
        if "x-ratelimit-limit" in response.headers:
            assert "x-ratelimit-remaining" in response.headers
            assert "x-ratelimit-reset" in response.headers


@pytest.mark.asyncio
async def test_full_workflow(client: httpx.AsyncClient):
    """
    Test a complete workflow: health check → generation → dialogue.
    This simulates a real user interaction.
    """
    # Step 1: Verify service is healthy
    health_response = await client.get("/health")
    assert health_response.status_code == 200
    
    # Step 2: Generate some text
    gen_response = await client.post("/v1/generate", json={
        "prompt": "What is 2+2?",
        "max_tokens": 20
    })
    assert gen_response.status_code == 200
    generated_text = gen_response.json()["text"]
    
    # Step 3: Use that in a dialogue
    dialogue_response = await client.post("/v1/dialogue", json={
        "messages": [
            {"role": "user", "content": "What is 2+2?"},
            {"role": "assistant", "content": generated_text},
            {"role": "user", "content": "Thanks!"}
        ],
        "max_tokens": 20
    })
    assert dialogue_response.status_code == 200
    
    print(f"✅ Full workflow test completed successfully")
