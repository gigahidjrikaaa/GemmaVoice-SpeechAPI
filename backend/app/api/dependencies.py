"""Dependency injection for FastAPI endpoints."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, Request

from app.services.llm import LLMService
from app.services.conversation import ConversationService
from app.services.whisper import WhisperService
from app.services.openaudio import OpenAudioService
from app.utils.exceptions import ModelNotLoadedError


def get_llm_service(request: Request) -> LLMService:
    """Get LLM service from application state.
    
    Args:
        request: FastAPI request object
        
    Returns:
        LLM service instance
        
    Raises:
        HTTPException: If service is not available
    """
    service: LLMService | None = getattr(request.app.state, "llm_service", None)
    if service is None:
        raise HTTPException(
            status_code=503,
            detail="LLM service is not available",
        )
    # Note: We don't check is_ready here to allow lazy loading in generate()
    return service


def get_conversation_service(request: Request) -> ConversationService:
    """Get conversation service from application state.
    
    Args:
        request: FastAPI request object
        
    Returns:
        Conversation service instance
        
    Raises:
        HTTPException: If service is not available
    """
    service: ConversationService | None = getattr(request.app.state, "conversation_service", None)
    if service is None:
        raise HTTPException(
            status_code=503,
            detail="Conversation service is not available",
        )
    return service


def get_whisper_service(request: Request) -> WhisperService:
    """Get Whisper service from application state.
    
    Args:
        request: FastAPI request object
        
    Returns:
        Whisper service instance
        
    Raises:
        HTTPException: If service is not available
    """
    service: WhisperService | None = getattr(request.app.state, "whisper_service", None)
    if service is None:
        raise HTTPException(
            status_code=503,
            detail="Whisper service is not available",
        )
    return service


def get_openaudio_service(request: Request) -> OpenAudioService:
    """Get OpenAudio service from application state.
    
    Args:
        request: FastAPI request object
        
    Returns:
        OpenAudio service instance
        
    Raises:
        HTTPException: If service is not available
    """
    service: OpenAudioService | None = getattr(request.app.state, "openaudio_service", None)
    if service is None:
        raise HTTPException(
            status_code=503,
            detail="OpenAudio service is not available",
        )
    return service


# Type annotations for cleaner endpoint signatures
LLMServiceDep = Annotated[LLMService, Depends(get_llm_service)]
ConversationServiceDep = Annotated[ConversationService, Depends(get_conversation_service)]
WhisperServiceDep = Annotated[WhisperService, Depends(get_whisper_service)]
OpenAudioServiceDep = Annotated[OpenAudioService, Depends(get_openaudio_service)]
