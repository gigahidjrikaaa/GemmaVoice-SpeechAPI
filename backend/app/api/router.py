"""Root API router wiring."""

from fastapi import APIRouter

from app.api.v1 import generation, speech, health


api_router = APIRouter()
api_router.include_router(generation.router, prefix="/v1")
api_router.include_router(speech.router, prefix="/v1")
api_router.include_router(health.router)

