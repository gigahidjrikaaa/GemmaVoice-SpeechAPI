"""Pydantic models for text generation endpoints."""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class GenerationRequest(BaseModel):
    """Request schema for text generation."""
    
    prompt: str = Field(..., description="Input prompt for text generation")
    system_prompt: Optional[str] = Field(default=None, description="System instructions for the model")
    max_tokens: int = Field(default=512, ge=1, le=4096)
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    top_p: float = Field(default=0.95, ge=0.0, le=1.0)
    top_k: int = Field(default=40, ge=0)
    repeat_penalty: float = Field(default=1.1, ge=0.0)
    stop: Optional[List[str]] = Field(default=None, description="Stop sequences")
    seed: Optional[int] = Field(default=None, ge=0)
    min_p: float = Field(default=0.05, ge=0.0)
    tfs_z: float = Field(default=1.0, ge=0.0)
    typical_p: float = Field(default=1.0, ge=0.0)


class GenerationResponse(BaseModel):
    """Response schema for text generation."""
    
    generated_text: str


class ModelInfo(BaseModel):
    """Information about an available model."""
    
    id: str
    name: str
    description: str


class ModelListResponse(BaseModel):
    """Response schema for model listing."""
    
    models: List[ModelInfo]
