"""Root API router wiring."""

from fastapi import APIRouter

from app.api.v1 import generation, speech, health, conversation, livekit


api_router = APIRouter()
api_router.include_router(generation.router, prefix="/v1")
api_router.include_router(speech.router, prefix="/v1")
api_router.include_router(conversation.router, prefix="/v1")
api_router.include_router(livekit.router, prefix="/v1")
api_router.include_router(health.router)
