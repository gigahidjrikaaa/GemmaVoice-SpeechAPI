"""FastAPI application entrypoint."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from scalar_fastapi import get_scalar_api_reference

from app.api.router import api_router
from app.config.settings import Settings, get_settings
from app.middleware.error_handler import ErrorHandlerMiddleware
from app.observability import (
    RequestContextMiddleware,
    configure_logging,
    register_metrics_endpoint,
)
from app.security import RateLimiter
from app.services.conversation import ConversationService
from app.services.openaudio import OpenAudioService
from app.services.llm import LLMService
from app.services.whisper import WhisperService

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Application startup...")

    settings = get_settings()
    
    # Initialize LLM service with async startup (lazy loading)
    llm_service = LLMService(settings=settings)
    # await llm_service.startup()  # Removed for lazy loading
    app.state.llm_service = llm_service

    whisper_service = WhisperService(settings=settings)
    await whisper_service.startup()  # Initialize remote client (fast, no model loading)
    app.state.whisper_service = whisper_service

    openaudio_service = OpenAudioService(settings=settings)
    await openaudio_service.startup()
    app.state.openaudio_service = openaudio_service

    rate_limiter = RateLimiter(settings=settings)
    app.state.rate_limiter = rate_limiter

    conversation_service = ConversationService(
        llm_service=llm_service,
        whisper_service=whisper_service,
        openaudio_service=openaudio_service,
    )
    app.state.conversation_service = conversation_service

    try:
        yield
    finally:
        logger.info("Application shutdown...")
        if hasattr(app.state, "conversation_service") and app.state.conversation_service is not None:
            app.state.conversation_service = None
        if hasattr(app.state, "openaudio_service") and app.state.openaudio_service is not None:
            await app.state.openaudio_service.shutdown()
            app.state.openaudio_service = None
        if hasattr(app.state, "whisper_service") and app.state.whisper_service is not None:
            await app.state.whisper_service.shutdown()
            app.state.whisper_service = None
        if hasattr(app.state, "rate_limiter") and app.state.rate_limiter is not None:
            app.state.rate_limiter = None
        if hasattr(app.state, "llm_service") and app.state.llm_service is not None:
            await llm_service.shutdown()
            app.state.llm_service = None


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    configure_logging(settings)

    # Conditionally set docs_url and redoc_url based on whether we're using Scalar
    docs_url = None if settings.use_scalar_docs else settings.docs_url
    redoc_url = None if settings.use_scalar_docs else "/redoc"
    
    application = FastAPI(
        title=settings.api_title,
        version=settings.api_version,
        lifespan=lifespan,
        docs_url=docs_url,
        redoc_url=redoc_url,
        openapi_url=settings.openapi_url,
        description=(
            "# 🎙️ GemmaVoice Speech API\n\n"
            "A production-ready FastAPI deployment that combines:\n"
            "- **🤖 Gemma 3 LLM** - Text generation with llama.cpp\n"
            "- **🎧 OpenAI Whisper** - Speech-to-text transcription\n"
            "- **🔊 OpenAudio** - High-quality text-to-speech synthesis\n"
            "- **🎭 Voice Cloning** - Custom voice synthesis with reference audio\n\n"
            "## Features\n\n"
            "- REST and WebSocket APIs\n"
            "- API key authentication\n"
            "- Rate limiting\n"
            "- Streaming responses\n"
            "- Voice cloning support\n"
            "- Multi-format audio support"
        ),
        contact={
            "name": "API Support",
            "url": "https://github.com/gigahidjrikaaa/GemmaVoice-SpeechAPI",
        },
        license_info={
            "name": "MIT",
            "url": "https://opensource.org/licenses/MIT",
        },
    )
    
    # Add CORS middleware to allow frontend connections
    application.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://localhost:5174",
            "http://127.0.0.1:5173",
            "http://127.0.0.1:5174",
            "http://localhost:3000",  # Common React dev port
            "*"  # Allow all origins in development
        ],
        allow_credentials=True,
        allow_methods=["*"],  # Allow all HTTP methods
        allow_headers=["*"],  # Allow all headers
    )
    
    # Add error handling middleware
    debug_mode = settings.log_level.upper() == "DEBUG"
    application.add_middleware(ErrorHandlerMiddleware, debug=debug_mode)
    
    # Add request context middleware
    application.add_middleware(RequestContextMiddleware, settings=settings)
    application.include_router(api_router)
    register_metrics_endpoint(application)
    
    # Add Scalar API documentation if enabled
    if settings.use_scalar_docs:
        @application.get(settings.docs_url, include_in_schema=False)
        async def scalar_html():
            return get_scalar_api_reference(
                openapi_url=application.openapi_url,
                title=application.title,
            )

    return application


app = create_app()

