"""Text generation API endpoints with async support and SSE streaming."""

from __future__ import annotations

import asyncio
import logging
from typing import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect
from pydantic import ValidationError as PydanticValidationError

from app.api.dependencies import LLMServiceDep
from app.schemas.generation import (
    GenerationRequest,
    GenerationResponse,
    ModelInfo,
    ModelListResponse,
)
from app.security import (
    enforce_rate_limit,
    enforce_websocket_api_key,
    enforce_websocket_rate_limit,
    require_api_key,
)
from app.utils.streaming import (
    SSEFormatter,
    create_sse_response,
    create_token_stream,
)
from app.utils.exceptions import (
    GenerationError,
    ModelNotLoadedError,
    ValidationError,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    tags=["generation"],
    dependencies=[Depends(require_api_key), Depends(enforce_rate_limit)],
)


def _apply_chat_template(prompt: str, system_prompt: str | None = None) -> tuple[str, bool]:
    """Apply Gemma 3 chat template if needed.
    
    Args:
        prompt: Input prompt
        system_prompt: Optional system instructions
        
    Returns:
        Tuple of (formatted_prompt, was_template_applied)
    """
    if "<start_of_turn>" in prompt:
        return prompt, False
    
    parts = []
    if system_prompt:
        parts.append(f"<start_of_turn>system\n{system_prompt}<end_of_turn>\n")
    
    parts.append(f"<start_of_turn>user\n{prompt}<end_of_turn>\n")
    parts.append(f"<start_of_turn>model\n")
    
    return "".join(parts), True


@router.post("/generate", response_model=GenerationResponse)
async def generate_text(
    payload: GenerationRequest,
    request: Request,
    llm_service: LLMServiceDep,
) -> GenerationResponse:
    """Synchronous text generation endpoint.
    
    Generates text completion using the LLM service. Automatically applies
    Gemma 3 chat template if the prompt doesn't already use it.
    
    Args:
        payload: Generation request parameters
        request: FastAPI request object
        llm_service: LLM service dependency
        
    Returns:
        Generation response with generated text
        
    Raises:
        HTTPException: If generation fails
    """
    logger.info("Generating text for prompt: '%s...'", payload.prompt[:50])
    
    # Apply chat template if needed
    prompt, template_applied = _apply_chat_template(payload.prompt, payload.system_prompt)
    if template_applied:
        logger.debug("Applied Gemma 3 chat template to raw prompt")
    
    # Prepare generation parameters
    generation_params = payload.model_dump()
    generation_params["prompt"] = prompt
    
    # Filter out empty stop sequences
    if "stop" in generation_params and generation_params["stop"]:
        generation_params["stop"] = [s for s in generation_params["stop"] if s]
        if not generation_params["stop"]:
            del generation_params["stop"]
    
    try:
        # Use async generate method
        output = await llm_service.generate(**generation_params)
        
        logger.debug("Generation completed successfully")
        result_text = output["choices"][0]["text"]
        
        return GenerationResponse(generated_text=result_text)
        
    except ModelNotLoadedError:
        raise HTTPException(status_code=503, detail="Model is not loaded")
    except GenerationError as exc:
        logger.exception("Generation failed")
        raise HTTPException(status_code=500, detail=str(exc.message))
    except Exception as exc:
        logger.exception("Unexpected error during generation")
        raise HTTPException(status_code=500, detail="Failed to generate text")


@router.post("/generate_stream")
async def generate_text_stream(
    payload: GenerationRequest,
    request: Request,
    llm_service: LLMServiceDep,
):
    """Stream text generation using Server-Sent Events (SSE).
    
    Streams generated tokens in real-time using SSE format. Each event
    includes the token text, and the stream ends with usage statistics.
    
    Event types:
    - text: Individual token
    - usage: Token usage statistics
    - done: Stream completion
    - error: Error occurred during generation
    
    Args:
        payload: Generation request parameters
        request: FastAPI request object
        llm_service: LLM service dependency
        
    Returns:
        StreamingResponse with SSE events
    """
    logger.info("Starting SSE stream for prompt: '%s...'", payload.prompt[:50])
    
    # Apply chat template if needed
    prompt, template_applied = _apply_chat_template(payload.prompt, payload.system_prompt)
    if template_applied:
        logger.debug("Applied Gemma 3 chat template to raw prompt")
    
    # Prepare generation parameters
    generation_params = payload.model_dump()
    generation_params["prompt"] = prompt
    
    # Filter out empty stop sequences
    if "stop" in generation_params and generation_params["stop"]:
        generation_params["stop"] = [s for s in generation_params["stop"] if s]
        if not generation_params["stop"]:
            del generation_params["stop"]
    
    async def sse_generator() -> AsyncIterator[str]:
        """Generate SSE-formatted events."""
        try:
            # Create streaming generator
            llm_stream = llm_service.generate_stream(**generation_params)
            
            # Convert to SSE format
            async for sse_event in create_token_stream(llm_stream, include_usage=True):
                yield sse_event
                
        except asyncio.CancelledError:
            logger.info("SSE stream cancelled by client")
            yield SSEFormatter.format_error("Stream cancelled", "STREAM_CANCELLED")
            raise
        except ModelNotLoadedError:
            logger.error("Model not loaded during streaming")
            yield SSEFormatter.format_error("Model is not loaded", "MODEL_NOT_LOADED")
        except GenerationError as exc:
            logger.exception("Generation error during streaming")
            yield SSEFormatter.format_error(exc.message, exc.error_code)
        except Exception as exc:
            logger.exception("Unexpected error during streaming")
            yield SSEFormatter.format_error(str(exc), "STREAM_ERROR")
    
    # Return SSE response with cancellation support
    return await create_sse_response(sse_generator(), request)


@router.websocket("/generate_ws")
async def generate_ws(websocket: WebSocket) -> None:
    """WebSocket text generation endpoint.
    
    Provides bidirectional streaming text generation over WebSocket.
    Client sends generation requests as JSON and receives token-by-token
    responses.
    
    Message format (client -> server):
        {
            "prompt": "Your prompt here",
            "max_tokens": 512,
            ...
        }
    
    Message format (server -> client):
        {
            "token": "generated token"
        }
        or
        {
            "status": "done"
        }
        or
        {
            "error": "error message"
        }
    """
    # Enforce security
    if not await enforce_websocket_api_key(websocket):
        return
    if not await enforce_websocket_rate_limit(websocket):
        return
    
    await websocket.accept()
    logger.info("WebSocket connection established")
    
    try:
        # Get LLM service
        llm_service = getattr(websocket.app.state, "llm_service", None)
        if llm_service is None or not llm_service.is_ready:
            await websocket.close(code=1011, reason="Model is not available")
            return
        
        # Handle multiple requests over same connection
        while True:
            # Receive request
            data = await websocket.receive_json()
            
            try:
                payload = GenerationRequest(**data)
            except PydanticValidationError as exc:
                await websocket.send_json({
                    "error": "VALIDATION_ERROR",
                    "message": str(exc),
                })
                continue
            
            logger.info("WebSocket generation for prompt: '%s...'", payload.prompt[:50])
            
            # Apply chat template if needed
            prompt, template_applied = _apply_chat_template(payload.prompt, payload.system_prompt)
            
            # Prepare generation parameters
            generation_params = payload.model_dump()
            generation_params["prompt"] = prompt
            
            # Filter out empty stop sequences
            if "stop" in generation_params and generation_params["stop"]:
                generation_params["stop"] = [s for s in generation_params["stop"] if s]
                if not generation_params["stop"]:
                    del generation_params["stop"]
            
            try:
                # Stream tokens
                async for chunk in llm_service.generate_stream(**generation_params):
                    if "choices" in chunk and len(chunk["choices"]) > 0:
                        choice = chunk["choices"][0]
                        token = choice.get("text", "")
                        
                        if token:
                            await websocket.send_json({"token": token})
                        
                        # Check if generation is complete
                        if choice.get("finish_reason"):
                            break
                
                # Send completion message
                await websocket.send_json({"status": "done"})
                
            except ModelNotLoadedError:
                await websocket.send_json({
                    "error": "MODEL_NOT_LOADED",
                    "message": "Model is not loaded",
                })
            except GenerationError as exc:
                await websocket.send_json({
                    "error": exc.error_code,
                    "message": exc.message,
                })
            except Exception as exc:
                logger.exception("Error during WebSocket generation")
                await websocket.send_json({
                    "error": "GENERATION_ERROR",
                    "message": str(exc),
                })
    
    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except Exception as exc:
        logger.exception("Unexpected error in WebSocket handler")
        try:
            await websocket.close(code=1011, reason="Internal error occurred")
        except Exception:
            pass


@router.get("/models", response_model=ModelListResponse)
async def list_models() -> ModelListResponse:
    """List available LLM models.
    
    Returns:
        List of available model information
    """
    return ModelListResponse(
        models=[
            ModelInfo(
                id="google/gemma-3-12b-it-qat-q4_0-gguf",
                name="Gemma 3 12B Q4_0 GGUF",
                description="Google's Gemma 3 model, 12B parameters, quantized to 4-bit.",
            )
        ]
    )


@router.get("/models/{model_id}", response_model=ModelInfo)
async def get_model_info(model_id: str) -> ModelInfo:
    """Get information about a specific model.
    
    Args:
        model_id: Model identifier
        
    Returns:
        Model information
        
    Raises:
        HTTPException: If model not found
    """
    if model_id != "google/gemma-3-12b-it-qat-q4_0-gguf":
        raise HTTPException(status_code=404, detail="Model not found")
    
    return ModelInfo(
        id=model_id,
        name="Gemma 3 12B Q4_0 GGUF",
        description="Google's Gemma 3 model, 12B parameters, quantized to 4-bit.",
    )

