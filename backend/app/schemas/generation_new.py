"""Pydantic models for text generation endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Any, List, Optional

from pydantic import BaseModel, Field


class GenerationRequest(BaseModel):
    """Request schema for text generation."""
    
    prompt: str = Field(..., description="Input prompt for text generation")
    max_tokens: int = Field(default=512, ge=1, le=4096, description="Maximum number of tokens to generate")
    temperature: float = Field(default=0.7, ge=0.0, le=2.0, description="Sampling temperature")
    top_p: float = Field(default=0.95, ge=0.0, le=1.0, description="Nucleus sampling threshold")
    top_k: int = Field(default=40, ge=0, description="Top-k sampling parameter")
    repeat_penalty: float = Field(default=1.1, ge=0.0, description="Penalty for repeating tokens")
    stop: Optional[List[str]] = Field(default_factory=lambda: ["
