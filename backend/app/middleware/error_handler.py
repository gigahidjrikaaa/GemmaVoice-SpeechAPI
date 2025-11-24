"""Global error handling middleware."""

from __future__ import annotations

import logging
import traceback
from typing import Callable

from fastapi import Request, Response, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.utils.exceptions import (
    LLMServiceError,
    ModelNotLoadedError,
    GenerationError,
    GenerationTimeoutError,
    StreamCancelledError,
    ValidationError,
)

logger = logging.getLogger(__name__)


class ErrorHandlerMiddleware(BaseHTTPMiddleware):
    """Global error handler middleware for consistent error responses.
    
    Catches all exceptions and returns consistent JSON error responses
    with appropriate HTTP status codes.
    """

    def __init__(self, app, debug: bool = False):
        super().__init__(app)
        self.debug = debug

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """Process request and handle any exceptions."""
        try:
            response = await call_next(request)
            return response
        except Exception as exc:
            return await self.handle_exception(request, exc)

    async def handle_exception(self, request: Request, exc: Exception) -> JSONResponse:
        """Convert exceptions to JSON responses.
        
        Args:
            request: The incoming request
            exc: The exception that occurred
            
        Returns:
            JSON response with error details
        """
        # Get request ID from state if available
        request_id = getattr(request.state, "request_id", None)
        
        # Handle custom LLM exceptions
        if isinstance(exc, ModelNotLoadedError):
            return self._create_error_response(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                error_code=exc.error_code,
                message=exc.message,
                details=exc.details if self.debug else {},
                request_id=request_id,
            )
        
        if isinstance(exc, GenerationTimeoutError):
            return self._create_error_response(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                error_code=exc.error_code,
                message=exc.message,
                details=exc.details if self.debug else {},
                request_id=request_id,
            )
        
        if isinstance(exc, StreamCancelledError):
            return self._create_error_response(
                status_code=status.HTTP_499_CLIENT_CLOSED_REQUEST,
                error_code=exc.error_code,
                message=exc.message,
                details=exc.details if self.debug else {},
                request_id=request_id,
            )
        
        if isinstance(exc, ValidationError):
            return self._create_error_response(
                status_code=status.HTTP_400_BAD_REQUEST,
                error_code=exc.error_code,
                message=exc.message,
                details=exc.details if self.debug else {},
                request_id=request_id,
            )
        
        if isinstance(exc, GenerationError):
            return self._create_error_response(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                error_code=exc.error_code,
                message=exc.message,
                details=exc.details if self.debug else {},
                request_id=request_id,
            )
        
        if isinstance(exc, LLMServiceError):
            return self._create_error_response(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                error_code=exc.error_code,
                message=exc.message,
                details=exc.details if self.debug else {},
                request_id=request_id,
            )
        
        # Handle unknown exceptions
        logger.exception("Unhandled exception occurred")
        
        details = {}
        if self.debug:
            details = {
                "type": type(exc).__name__,
               "traceback": traceback.format_exc(),
            }
        
        return self._create_error_response(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            error_code="INTERNAL_ERROR",
            message="An internal error occurred",
            details=details,
            request_id=request_id,
        )

    def _create_error_response(
        self,
        status_code: int,
        error_code: str,
        message: str,
        details: dict = None,
        request_id: str | None = None,
    ) -> JSONResponse:
        """Create standardized error response.
        
        Args:
            status_code: HTTP status code
            error_code: Application error code
            message: Human-readable error message
            details: Additional error details
            request_id: Request correlation ID
            
        Returns:
            JSON response with error information
        """
        content = {
            "error": error_code,
            "message": message,
        }
        
        if details:
            content["details"] = details
        
        headers = {}
        if request_id:
            headers["X-Request-ID"] = request_id
        
        return JSONResponse(
            status_code=status_code,
            content=content,
            headers=headers,
        )
