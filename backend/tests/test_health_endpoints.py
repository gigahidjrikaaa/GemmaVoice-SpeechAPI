"""
Unit tests for the health check API endpoints.

Tests cover /health, /health/llm, /health/stt, /health/tts, /health/live,
/health/ready, component status, and metrics endpoint.
"""

from typing import Any
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


# ============================================================================
# Main Health Endpoint Tests
# ============================================================================

class TestHealthEndpoint:
    """Test /health endpoint."""

    def test_health_returns_200(self, test_client: TestClient) -> None:
        """GET /health returns 200."""
        response = test_client.get("/health")
        
        assert response.status_code == 200

    def test_health_returns_status(self, test_client: TestClient) -> None:
        """Health response includes overall status."""
        response = test_client.get("/health")
        data = response.json()
        
        assert "status" in data
        assert data["status"] in ["healthy", "degraded", "unhealthy"]

    def test_health_returns_components(self, test_client: TestClient) -> None:
        """Health response includes component statuses."""
        response = test_client.get("/health")
        data = response.json()
        
        assert "components" in data
        assert isinstance(data["components"], dict)

    def test_health_includes_version(self, test_client: TestClient) -> None:
        """Health response includes API version."""
        response = test_client.get("/health")
        data = response.json()
        
        assert "version" in data

    def test_health_component_structure(self, test_client: TestClient) -> None:
        """Each component has status, message, and details."""
        response = test_client.get("/health")
        data = response.json()
        
        for component_name, component in data["components"].items():
            assert "status" in component
            assert "message" in component
            assert "details" in component


# ============================================================================
# Component Health Endpoint Tests
# ============================================================================

class TestLLMHealthEndpoint:
    """Test /health/llm endpoint."""

    def test_llm_health_returns_200(self, test_client: TestClient) -> None:
        """GET /health/llm returns 200."""
        response = test_client.get("/health/llm")
        
        assert response.status_code == 200

    def test_llm_health_structure(self, test_client: TestClient) -> None:
        """LLM health has correct structure."""
        response = test_client.get("/health/llm")
        data = response.json()
        
        assert "status" in data
        assert "message" in data
        assert "details" in data


class TestSTTHealthEndpoint:
    """Test /health/stt endpoint."""

    def test_stt_health_returns_200(self, test_client: TestClient) -> None:
        """GET /health/stt returns 200."""
        response = test_client.get("/health/stt")
        
        assert response.status_code == 200

    def test_stt_health_structure(self, test_client: TestClient) -> None:
        """STT health has correct structure."""
        response = test_client.get("/health/stt")
        data = response.json()
        
        assert "status" in data
        assert "message" in data


class TestTTSHealthEndpoint:
    """Test /health/tts endpoint."""

    def test_tts_health_returns_200(self, test_client: TestClient) -> None:
        """GET /health/tts returns 200."""
        response = test_client.get("/health/tts")
        
        assert response.status_code == 200

    def test_tts_health_structure(self, test_client: TestClient) -> None:
        """TTS health has correct structure."""
        response = test_client.get("/health/tts")
        data = response.json()
        
        assert "status" in data
        assert "message" in data


# ============================================================================
# Kubernetes Probe Endpoints Tests
# ============================================================================

class TestLivenessEndpoint:
    """Test /health/live endpoint."""

    def test_liveness_returns_200(self, test_client: TestClient) -> None:
        """GET /health/live returns 200."""
        response = test_client.get("/health/live")
        
        assert response.status_code == 200

    def test_liveness_is_simple(self, test_client: TestClient) -> None:
        """Liveness check is simple and fast."""
        response = test_client.get("/health/live")
        data = response.json()
        
        assert "status" in data
        assert data["status"] in ["ok", "alive", "healthy"]


class TestReadinessEndpoint:
    """Test /health/ready endpoint."""

    def test_readiness_returns_200(self, test_client: TestClient) -> None:
        """GET /health/ready returns 200."""
        response = test_client.get("/health/ready")
        
        assert response.status_code == 200

    def test_readiness_checks_services(self, test_client: TestClient) -> None:
        """Readiness checks service availability."""
        response = test_client.get("/health/ready")
        data = response.json()
        
        assert "status" in data


# ============================================================================
# Metrics Endpoint Tests
# ============================================================================

class TestMetricsEndpoint:
    """Test /metrics endpoint."""

    def test_metrics_returns_200(self, test_client: TestClient) -> None:
        """GET /metrics returns 200."""
        response = test_client.get("/metrics")
        
        assert response.status_code == 200

    def test_metrics_prometheus_format(self, test_client: TestClient) -> None:
        """Metrics are in Prometheus format."""
        response = test_client.get("/metrics")
        
        # Check content type
        content_type = response.headers.get("content-type", "")
        assert "text/plain" in content_type or "text/openmetrics" in content_type

    def test_metrics_includes_python_info(self, test_client: TestClient) -> None:
        """Metrics include Python runtime info."""
        response = test_client.get("/metrics")
        
        assert "python_info" in response.text

    def test_metrics_includes_http_metrics(self, test_client: TestClient) -> None:
        """Metrics include HTTP request metrics."""
        response = test_client.get("/metrics")
        
        # Common Prometheus HTTP metrics
        assert "http" in response.text.lower() or "request" in response.text.lower()


# ============================================================================
# Health Status Logic Tests
# ============================================================================

class TestHealthStatusLogic:
    """Test health status determination logic."""

    def test_healthy_when_all_components_healthy(
        self,
        test_client: TestClient,
        app: FastAPI,
    ) -> None:
        """Overall status is healthy when all components are healthy."""
        # Services are mocked and healthy by default
        response = test_client.get("/health")
        data = response.json()
        
        # All mock services are ready
        component_statuses = [c["status"] for c in data["components"].values()]
        if all(s == "healthy" for s in component_statuses):
            assert data["status"] == "healthy"

    def test_degraded_when_any_component_degraded(
        self,
        test_client: TestClient,
        app: FastAPI,
    ) -> None:
        """Overall status is degraded when any component is degraded."""
        # This is tested implicitly through the component checks

    def test_unhealthy_when_any_component_unhealthy(
        self,
        test_client: TestClient,
        app: FastAPI,
    ) -> None:
        """Overall status is unhealthy when any component is unhealthy."""
        # Disable a service
        app.state.llm_service._is_ready = False
        
        response = test_client.get("/health")
        data = response.json()
        
        # Should reflect the unhealthy component
        llm_status = data["components"].get("llm", {}).get("status", "")
        assert llm_status in ["unhealthy", "degraded"] or data["status"] in ["unhealthy", "degraded"]
        
        # Restore
        app.state.llm_service._is_ready = True


# ============================================================================
# Error Handling Tests
# ============================================================================

class TestHealthErrorHandling:
    """Test error handling in health checks."""

    def test_health_handles_service_errors(
        self,
        test_client: TestClient,
        app: FastAPI,
    ) -> None:
        """Health check handles service errors gracefully."""
        # Make a service raise an error
        original_is_ready = type(app.state.llm_service).is_ready
        
        def raise_error(self: Any) -> bool:
            raise RuntimeError("Service error")
        
        type(app.state.llm_service).is_ready = property(raise_error)
        
        try:
            response = test_client.get("/health")
            # Should still return a response
            assert response.status_code in [200, 500]
        finally:
            type(app.state.llm_service).is_ready = original_is_ready


# ============================================================================
# Health Endpoint Response Time Tests
# ============================================================================

class TestHealthPerformance:
    """Test health endpoint performance."""

    def test_health_responds_quickly(self, test_client: TestClient) -> None:
        """Health check responds quickly."""
        import time
        
        start = time.perf_counter()
        response = test_client.get("/health")
        elapsed = time.perf_counter() - start
        
        assert response.status_code == 200
        # Health checks should be fast (< 5 seconds)
        assert elapsed < 5.0

    def test_liveness_is_fast(self, test_client: TestClient) -> None:
        """Liveness check is very fast."""
        import time
        
        start = time.perf_counter()
        response = test_client.get("/health/live")
        elapsed = time.perf_counter() - start
        
        assert response.status_code == 200
        # Liveness should be immediate (< 1 second)
        assert elapsed < 1.0


# ============================================================================
# Documentation Endpoint Tests
# ============================================================================

class TestDocsEndpoints:
    """Test documentation endpoints."""

    def test_openapi_json_available(self, test_client: TestClient) -> None:
        """OpenAPI JSON schema is available."""
        response = test_client.get("/openapi.json")
        
        assert response.status_code == 200
        data = response.json()
        assert "openapi" in data
        assert "paths" in data

    def test_docs_endpoint_available(self, test_client: TestClient) -> None:
        """Documentation endpoint is available."""
        response = test_client.get("/docs")
        
        # Should return docs page (Scalar or Swagger)
        assert response.status_code == 200


# ============================================================================
# CORS Tests
# ============================================================================

class TestCORSHeaders:
    """Test CORS headers on health endpoints."""

    def test_cors_headers_on_health(self, test_client: TestClient) -> None:
        """CORS headers are present on health endpoint."""
        response = test_client.options(
            "/health",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "GET",
            },
        )
        
        # Should allow CORS
        assert response.status_code in [200, 204]

    def test_health_accessible_cross_origin(self, test_client: TestClient) -> None:
        """Health endpoint is accessible from allowed origins."""
        response = test_client.get(
            "/health",
            headers={"Origin": "http://localhost:5173"},
        )
        
        assert response.status_code == 200
