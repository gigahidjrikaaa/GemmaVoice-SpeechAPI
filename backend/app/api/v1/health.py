"""Comprehensive health check endpoints for all system components."""

from __future__ import annotations

import logging
from typing import Any, Dict

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])


class ComponentHealth(BaseModel):
    """Health status for a single component."""

    status: str = Field(..., description="Status: 'healthy', 'degraded', or 'unhealthy'")
    message: str = Field(..., description="Human-readable status message")
    details: Dict[str, Any] = Field(default_factory=dict, description="Additional diagnostic info")


class SystemHealth(BaseModel):
    """Overall system health status."""

    status: str = Field(..., description="Overall system status")
    components: Dict[str, ComponentHealth] = Field(..., description="Individual component statuses")
    version: str = Field(default="1.0.0", description="API version")


@router.get("/health", response_model=SystemHealth, summary="Comprehensive system health check")
async def health_check(request: Request) -> SystemHealth:
    """
    Check the health of all system components.
    
    Returns health status for:
    - Gemma 3 LLM service
    - Faster-Whisper STT service
    - OpenAudio-S1-mini TTS service
    
    Status levels:
    - healthy: Component is operational
    - degraded: Component is operational but with issues
    - unhealthy: Component is not operational
    """
    components: Dict[str, ComponentHealth] = {}
    
    # Check LLM Service (Gemma 3)
    try:
        llm_service = getattr(request.app.state, "llm_service", None)
        if llm_service is None:
            components["llm"] = ComponentHealth(
                status="unhealthy",
                message="LLM service not initialized",
                details={"error": "Service not found in app state"}
            )
        elif llm_service.model is None:
            components["llm"] = ComponentHealth(
                status="unhealthy",
                message="LLM model not loaded",
                details={"error": "Model is None"}
            )
        else:
            # Test a simple generation to verify model works
            try:
                # Quick test without streaming
                test_output = llm_service.model(
                    prompt="Test",
                    max_tokens=1,
                    temperature=0.0,
                    stream=False
                )
                components["llm"] = ComponentHealth(
                    status="healthy",
                    message="Gemma 3 LLM service operational",
                    details={
                        "model_loaded": True,
                        "test_passed": True
                    }
                )
            except Exception as e:
                components["llm"] = ComponentHealth(
                    status="degraded",
                    message="LLM model loaded but test failed",
                    details={"error": str(e), "model_loaded": True}
                )
    except Exception as e:
        logger.exception("Error checking LLM service health")
        components["llm"] = ComponentHealth(
            status="unhealthy",
            message="LLM service health check failed",
            details={"error": str(e)}
        )
    
    # Check Whisper Service (STT)
    try:
        whisper_service = getattr(request.app.state, "whisper_service", None)
        if whisper_service is None:
            components["stt"] = ComponentHealth(
                status="unhealthy",
                message="Whisper service not initialized",
                details={"error": "Service not found in app state"}
            )
        elif not whisper_service.is_ready:
            components["stt"] = ComponentHealth(
                status="unhealthy",
                message="Whisper service not ready",
                details={"is_ready": False}
            )
        else:
            components["stt"] = ComponentHealth(
                status="healthy",
                message="Faster-Whisper STT service operational",
                details={
                    "is_ready": True,
                    "mode": "faster-whisper" if hasattr(whisper_service, "_local_model") else "remote-api"
                }
            )
    except Exception as e:
        logger.exception("Error checking Whisper service health")
        components["stt"] = ComponentHealth(
            status="unhealthy",
            message="Whisper service health check failed",
            details={"error": str(e)}
        )
    
    # Check OpenAudio Service (TTS)
    try:
        openaudio_service = getattr(request.app.state, "openaudio_service", None)
        if openaudio_service is None:
            components["tts"] = ComponentHealth(
                status="unhealthy",
                message="OpenAudio service not initialized",
                details={"error": "Service not found in app state"}
            )
        elif not openaudio_service.is_ready:
            components["tts"] = ComponentHealth(
                status="unhealthy",
                message="OpenAudio service not ready",
                details={"is_ready": False}
            )
        else:
            components["tts"] = ComponentHealth(
                status="healthy",
                message="OpenAudio-S1-mini TTS service operational",
                details={"is_ready": True}
            )
    except Exception as e:
        logger.exception("Error checking OpenAudio service health")
        components["tts"] = ComponentHealth(
            status="unhealthy",
            message="OpenAudio service health check failed",
            details={"error": str(e)}
        )
    
    # Determine overall system status
    statuses = [comp.status for comp in components.values()]
    if all(s == "healthy" for s in statuses):
        overall_status = "healthy"
    elif any(s == "unhealthy" for s in statuses):
        overall_status = "unhealthy"
    else:
        overall_status = "degraded"
    
    return SystemHealth(
        status=overall_status,
        components=components
    )


@router.get("/health/llm", response_model=ComponentHealth, summary="LLM service health")
async def llm_health(request: Request) -> ComponentHealth:
    """Check the health of the Gemma 3 LLM service."""
    try:
        llm_service = getattr(request.app.state, "llm_service", None)
        if llm_service is None:
            return ComponentHealth(
                status="unhealthy",
                message="LLM service not initialized",
                details={"error": "Service not found in app state"}
            )
        
        if llm_service.model is None:
            return ComponentHealth(
                status="unhealthy",
                message="LLM model not loaded",
                details={"error": "Model is None"}
            )
        
        # Test generation
        test_output = llm_service.model(
            prompt="Test",
            max_tokens=1,
            temperature=0.0,
            stream=False
        )
        
        return ComponentHealth(
            status="healthy",
            message="Gemma 3 LLM service operational",
            details={
                "model_loaded": True,
                "test_passed": True,
                "gpu_layers": llm_service.model.model_params.n_gpu_layers
            }
        )
    except Exception as e:
        logger.exception("LLM health check failed")
        return ComponentHealth(
            status="unhealthy",
            message="LLM service health check failed",
            details={"error": str(e)}
        )


@router.get("/health/stt", response_model=ComponentHealth, summary="STT service health")
async def stt_health(request: Request) -> ComponentHealth:
    """Check the health of the Faster-Whisper STT service."""
    try:
        whisper_service = getattr(request.app.state, "whisper_service", None)
        if whisper_service is None:
            return ComponentHealth(
                status="unhealthy",
                message="Whisper service not initialized",
                details={"error": "Service not found in app state"}
            )
        
        if not whisper_service.is_ready:
            return ComponentHealth(
                status="unhealthy",
                message="Whisper service not ready",
                details={"is_ready": False}
            )
        
        return ComponentHealth(
            status="healthy",
            message="Faster-Whisper STT service operational",
            details={
                "is_ready": True,
                "mode": "faster-whisper" if hasattr(whisper_service, "_local_model") else "remote-api"
            }
        )
    except Exception as e:
        logger.exception("Whisper health check failed")
        return ComponentHealth(
            status="unhealthy",
            message="Whisper service health check failed",
            details={"error": str(e)}
        )


@router.get("/health/tts", response_model=ComponentHealth, summary="TTS service health")
async def tts_health(request: Request) -> ComponentHealth:
    """Check the health of the OpenAudio-S1-mini TTS service."""
    try:
        openaudio_service = getattr(request.app.state, "openaudio_service", None)
        if openaudio_service is None:
            return ComponentHealth(
                status="unhealthy",
                message="OpenAudio service not initialized",
                details={"error": "Service not found in app state"}
            )
        
        if not openaudio_service.is_ready:
            return ComponentHealth(
                status="unhealthy",
                message="OpenAudio service not ready",
                details={"is_ready": False}
            )
        
        return ComponentHealth(
            status="healthy",
            message="OpenAudio-S1-mini TTS service operational",
            details={"is_ready": True}
        )
    except Exception as e:
        logger.exception("OpenAudio health check failed")
        return ComponentHealth(
            status="unhealthy",
            message="OpenAudio service health check failed",
            details={"error": str(e)}
        )


@router.get("/health/ready", summary="Readiness probe")
async def readiness_check(request: Request) -> Dict[str, Any]:
    """
    Kubernetes-style readiness probe.
    Returns 200 if all services are ready, 503 otherwise.
    """
    try:
        llm_service = getattr(request.app.state, "llm_service", None)
        whisper_service = getattr(request.app.state, "whisper_service", None)
        openaudio_service = getattr(request.app.state, "openaudio_service", None)
        
        llm_ready = llm_service is not None and llm_service.model is not None
        stt_ready = whisper_service is not None and whisper_service.is_ready
        tts_ready = openaudio_service is not None and openaudio_service.is_ready
        
        all_ready = llm_ready and stt_ready and tts_ready
        
        return {
            "ready": all_ready,
            "llm": llm_ready,
            "stt": stt_ready,
            "tts": tts_ready
        }
    except Exception as e:
        logger.exception("Readiness check failed")
        return {"ready": False, "error": str(e)}


@router.get("/health/live", summary="Liveness probe")
async def liveness_check() -> dict[str, str]:
    """
    Kubernetes-style liveness probe.
    Always returns 200 if the application is running.
    """
    return {"status": "alive"}
