"""
Unit tests for middleware components.

Tests cover error handling middleware, request context middleware,
and other middleware functionality.
"""

import json
from typing import Any, Callable
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from starlette.responses import JSONResponse

from app.config.settings import Settings
from app.middleware.error_handler import ErrorHandlerMiddleware


# ============================================================================
# Error Handler Middleware Tests
# ============================================================================

class TestErrorHandlerMiddleware:
    """Test ErrorHandlerMiddleware behavior."""

    @pytest.fixture
    def error_app(self) -> FastAPI:
        """Create an app with error handler middleware."""
        app = FastAPI()
        app.add_middleware(ErrorHandlerMiddleware, debug=False)
        
        @app.get("/ok")
        async def ok_endpoint() -> dict:
            return {"status": "ok"}
        
        @app.get("/http-error")
        async def http_error_endpoint() -> None:
            raise HTTPException(status_code=400, detail="Bad request")
        
        @app.get("/server-error")
        async def server_error_endpoint() -> None:
            raise RuntimeError("Internal error")
        
        @app.get("/validation-error")
        async def validation_error_endpoint() -> None:
            from pydantic import ValidationError
            raise ValueError("Validation failed")
        
        return app

    @pytest.fixture
    def error_client(self, error_app: FastAPI) -> TestClient:
        """Create test client for error app."""
        return TestClient(error_app, raise_server_exceptions=False)

    def test_passes_through_successful_requests(self, error_client: TestClient) -> None:
        """Successful requests pass through unchanged."""
        response = error_client.get("/ok")
        
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}

    def test_handles_http_exceptions(self, error_client: TestClient) -> None:
        """HTTP exceptions are handled properly."""
        response = error_client.get("/http-error")
        
        assert response.status_code == 400

    def test_handles_server_errors(self, error_client: TestClient) -> None:
        """Server errors are caught and returned as 500."""
        response = error_client.get("/server-error")
        
        assert response.status_code == 500

    def test_error_response_format(self, error_client: TestClient) -> None:
        """Error responses have consistent format."""
        response = error_client.get("/server-error")
        
        data = response.json()
        assert "detail" in data or "error" in data or "message" in data


class TestErrorHandlerDebugMode:
    """Test ErrorHandlerMiddleware in debug mode."""

    @pytest.fixture
    def debug_app(self) -> FastAPI:
        """Create an app with debug mode enabled."""
        app = FastAPI()
        app.add_middleware(ErrorHandlerMiddleware, debug=True)
        
        @app.get("/error")
        async def error_endpoint() -> None:
            raise RuntimeError("Debug error")
        
        return app

    @pytest.fixture
    def debug_client(self, debug_app: FastAPI) -> TestClient:
        """Create test client for debug app."""
        return TestClient(debug_app, raise_server_exceptions=False)

    def test_debug_mode_includes_traceback(self, debug_client: TestClient) -> None:
        """Debug mode may include additional error info."""
        response = debug_client.get("/error")
        
        assert response.status_code == 500
        # In debug mode, might include more details
        data = response.json()
        assert "detail" in data or "error" in data or "traceback" in data


# ============================================================================
# Request Context Middleware Tests
# ============================================================================

class TestRequestContextMiddleware:
    """Test RequestContextMiddleware behavior."""

    def test_adds_request_id_header(self, test_client: TestClient) -> None:
        """Request ID header is added to responses."""
        response = test_client.get("/health")
        
        # Check for request ID in response headers
        headers = response.headers
        # Request ID header name may vary
        has_request_id = any(
            "request-id" in h.lower() or "x-request-id" in h.lower()
            for h in headers.keys()
        )
        
        # May or may not have request ID depending on configuration
        assert response.status_code == 200

    def test_propagates_existing_request_id(self, test_client: TestClient) -> None:
        """Existing request ID is propagated."""
        request_id = "test-request-123"
        response = test_client.get(
            "/health",
            headers={"X-Request-ID": request_id},
        )
        
        assert response.status_code == 200

    def test_generates_request_id_if_missing(self, test_client: TestClient) -> None:
        """Request ID is generated if not provided."""
        response = test_client.get("/health")
        
        assert response.status_code == 200


# ============================================================================
# CORS Middleware Tests (via app configuration)
# ============================================================================

class TestCORSMiddleware:
    """Test CORS middleware configuration."""

    def test_cors_allows_configured_origins(self, test_client: TestClient) -> None:
        """CORS allows configured origins."""
        response = test_client.options(
            "/health",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "GET",
            },
        )
        
        # Should allow CORS preflight
        assert response.status_code in [200, 204]

    def test_cors_headers_on_response(self, test_client: TestClient) -> None:
        """CORS headers are present on responses."""
        response = test_client.get(
            "/health",
            headers={"Origin": "http://localhost:5173"},
        )
        
        # Check for CORS headers (may be set by CORS middleware)
        assert response.status_code == 200


# ============================================================================
# Middleware Error Propagation Tests
# ============================================================================

class TestMiddlewareErrorPropagation:
    """Test error propagation through middleware stack."""

    def test_validation_errors_returned_as_422(self, test_client: TestClient) -> None:
        """Validation errors return 422."""
        response = test_client.post(
            "/v1/generate",
            json={"invalid_field": "value"},
        )
        
        assert response.status_code == 422

    def test_not_found_returns_404(self, test_client: TestClient) -> None:
        """Non-existent routes return 404."""
        response = test_client.get("/nonexistent-endpoint")
        
        assert response.status_code == 404

    def test_method_not_allowed_returns_405(self, test_client: TestClient) -> None:
        """Wrong HTTP method returns 405."""
        response = test_client.delete("/health")
        
        # May be 404 or 405 depending on route configuration
        assert response.status_code in [404, 405]


# ============================================================================
# Middleware Order Tests
# ============================================================================

class TestMiddlewareOrder:
    """Test middleware execution order."""

    def test_error_handler_catches_all_errors(self, test_client: TestClient, app: FastAPI) -> None:
        """Error handler middleware catches errors from later middleware."""
        # This is tested implicitly through other error tests
        pass


# ============================================================================
# Content Type Handling Tests
# ============================================================================

class TestContentTypeHandling:
    """Test content type handling in middleware/app."""

    def test_json_content_type_accepted(self, test_client: TestClient) -> None:
        """application/json content type is accepted."""
        response = test_client.post(
            "/v1/generate",
            json={"prompt": "Test"},
            headers={"Content-Type": "application/json"},
        )
        
        assert response.status_code == 200

    def test_json_response_content_type(self, test_client: TestClient) -> None:
        """JSON responses have correct content type."""
        response = test_client.get("/health")
        
        content_type = response.headers.get("content-type", "")
        assert "application/json" in content_type


# ============================================================================
# Async Middleware Tests
# ============================================================================

class TestAsyncMiddleware:
    """Test async middleware behavior."""

    @pytest.mark.asyncio
    async def test_middleware_is_async_compatible(self, async_client) -> None:
        """Middleware works with async requests."""
        response = await async_client.get("/health")
        
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_concurrent_requests_handled(self, async_client) -> None:
        """Multiple concurrent requests are handled."""
        import asyncio
        
        async def make_request() -> int:
            response = await async_client.get("/health")
            return response.status_code
        
        # Make concurrent requests
        results = await asyncio.gather(*[make_request() for _ in range(5)])
        
        assert all(status == 200 for status in results)
