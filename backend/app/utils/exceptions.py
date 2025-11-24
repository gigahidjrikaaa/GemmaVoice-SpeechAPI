"""Custom exception hierarchy for LLM service errors."""

from __future__ import annotations

from typing import Any, Optional


class LLMServiceError(Exception):
    """Base exception for all LLM service errors.
    
    Attributes:
        message: Human-readable error message
        error_code: Unique error code for programmatic handling
        details: Additional context about the error
    """

    def __init__(
        self,
        message: str,
        error_code: str = "LLM_ERROR",
        details: Optional[dict[str, Any]] = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.error_code = error_code
        self.details = details or {}

    def to_dict(self) -> dict[str, Any]:
        """Convert exception to dictionary for JSON serialization."""
        return {
            "error": self.error_code,
            "message": self.message,
            "details": self.details,
        }


class ModelNotLoadedError(LLMServiceError):
    """Raised when attempting to use a model that hasn't been loaded."""

    def __init__(
        self,
        message: str = "LLM model is not loaded or available",
        details: Optional[dict[str, Any]] = None,
    ) -> None:
        super().__init__(
            message=message,
            error_code="MODEL_NOT_LOADED",
            details=details,
        )


class GenerationError(LLMServiceError):
    """Raised when text generation fails."""

    def __init__(
        self,
        message: str,
        details: Optional[dict[str, Any]] = None,
        cause: Optional[Exception] = None,
    ) -> None:
        if cause and not details:
            details = {"cause": str(cause), "cause_type": type(cause).__name__}
        elif cause and details:
            details["cause"] = str(cause)
            details["cause_type"] = type(cause).__name__
        
        super().__init__(
            message=message,
            error_code="GENERATION_FAILED",
            details=details,
        )
        self.__cause__ = cause


class GenerationTimeoutError(LLMServiceError):
    """Raised when a generation request exceeds the timeout."""

    def __init__(
        self,
        timeout_seconds: float,
        details: Optional[dict[str, Any]] = None,
    ) -> None:
        message = f"Generation request timed out after {timeout_seconds} seconds"
        if not details:
            details = {}
        details["timeout_seconds"] = timeout_seconds
        
        super().__init__(
            message=message,
            error_code="GENERATION_TIMEOUT",
            details=details,
        )


class StreamCancelledError(LLMServiceError):
    """Raised when a streaming request is cancelled by the client."""

    def __init__(
        self,
        message: str = "Stream was cancelled by client",
        details: Optional[dict[str, Any]] = None,
    ) -> None:
        super().__init__(
            message=message,
            error_code="STREAM_CANCELLED",
            details=details,
        )


class ValidationError(LLMServiceError):
    """Raised when request validation fails."""

    def __init__(
        self,
        message: str,
        field: Optional[str] = None,
        details: Optional[dict[str, Any]] = None,
    ) -> None:
        if field and not details:
            details = {"field": field}
        elif field and details:
            details["field"] = field
            
        super().__init__(
            message=message,
            error_code="VALIDATION_ERROR",
            details=details,
        )
