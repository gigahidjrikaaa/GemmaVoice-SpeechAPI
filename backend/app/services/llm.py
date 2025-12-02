"""Async llama.cpp based LLM service with streaming support."""

from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Dict, Optional

from huggingface_hub import hf_hub_download
from llama_cpp import Llama

from app.config.settings import Settings
from app.utils.exceptions import (
    GenerationError,
    GenerationTimeoutError,
    ModelNotLoadedError,
    StreamCancelledError,
)

logger = logging.getLogger(__name__)


class LLMService:
    """Async lifecycle manager for the Gemma llama.cpp model.
    
    Provides async methods for text generation with proper error handling,
    timeouts, and streaming support.
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._llm: Optional[Llama] = None
        self._model_path: Optional[str] = None
        self._is_loading = False
        self._load_lock = asyncio.Lock()

    async def startup(self) -> None:
        """Download and load the configured model if required.
        
        This method is async to prevent blocking the event loop during
        model download and initialization.
        """
        async with self._load_lock:
            if self._llm is not None:
                logger.debug("LLMService.startup invoked but model already loaded")
                return

            if self._is_loading:
                logger.debug("Model is currently loading, waiting...")
                return

            self._is_loading = True
            try:
                await self._download_and_load_model()
            finally:
                self._is_loading = False

    async def _download_and_load_model(self) -> None:
        """Internal method to download and load model."""
        logger.info(
            "Downloading model '%s' from repo '%s'...",
            self._settings.llm_model_filename,
            self._settings.llm_repo_id,
        )

        # Run download in thread pool to avoid blocking
        try:
            self._model_path = await asyncio.to_thread(
                hf_hub_download,
                repo_id=self._settings.llm_repo_id,
                filename=self._settings.llm_model_filename,
                token=self._settings.hugging_face_hub_token,
            )
        except Exception as exc:
            logger.exception("Failed to download model")
            raise ModelNotLoadedError(
                f"Failed to download model: {exc}",
                details={"repo_id": self._settings.llm_repo_id},
            ) from exc

        logger.info("Model downloaded to: %s", self._model_path)
        logger.info("Loading model into memory via llama.cpp...")

        # Load model in thread pool to avoid blocking
        try:
            self._llm = await asyncio.to_thread(
                self._load_llama_model,
                self._model_path,
            )
        except Exception as exc:
            logger.exception("Failed to load model")
            raise ModelNotLoadedError(
                f"Failed to load model: {exc}",
                details={"model_path": self._model_path},
            ) from exc

        logger.info("Model loaded successfully.")

    def _load_llama_model(self, model_path: str) -> Llama:
        """Load the llama.cpp model (runs in thread pool)."""
        return Llama(
            model_path=model_path,
            n_gpu_layers=self._settings.llm_gpu_layers,
            n_batch=self._settings.llm_batch_size,
            n_threads=self._settings.llm_n_threads,
            n_ctx=self._settings.llm_context_size,
            verbose=True,
        )

    async def shutdown(self) -> None:
        """Release model resources."""
        async with self._load_lock:
            if self._llm is not None:
                logger.info("Releasing llama.cpp model instance")
                # Release in thread pool to avoid blocking
                await asyncio.to_thread(self._release_model)
            self._llm = None
            self._model_path = None

    def _release_model(self) -> None:
        """Release model resources (runs in thread pool)."""
        # llama.cpp doesn't have explicit cleanup, but we can del the object
        if self._llm is not None:
            del self._llm

    @property
    def model(self) -> Llama:
        """Get the underlying llama.cpp model.
        
        Raises:
            ModelNotLoadedError: If model is not loaded
        """
        if self._llm is None:
            raise ModelNotLoadedError("LLM model is not loaded")
        return self._llm

    @property
    def is_ready(self) -> bool:
        """Check if model is loaded and ready."""
        return self._llm is not None

    async def generate(
        self,
        prompt: str,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """Generate text completion asynchronously.
        
        Args:
            prompt: Input prompt
            **kwargs: Additional parameters for llama.cpp
            
        Returns:
            Generation result dictionary
            
        Raises:
            ModelNotLoadedError: If model is not loaded
            GenerationError: If generation fails
            GenerationTimeoutError: If generation times out
        """
        if not self.is_ready:
            logger.info("Model not loaded, triggering lazy load...")
            await self.startup()

        # Extract timeout if provided, otherwise use default
        timeout = kwargs.pop("timeout", getattr(self._settings, "llm_request_timeout", 120.0))
        
        try:
            # Run generation in thread pool with timeout
            logger.debug("Calling llama.cpp with prompt length %d and params: %s", len(prompt), kwargs)
            result = await asyncio.wait_for(
                asyncio.to_thread(self._llm, prompt, **kwargs),
                timeout=timeout,
            )
            logger.debug("llama.cpp result: %s", result)
            return result
        except asyncio.TimeoutError as exc:
            logger.error("Generation timed out after %s seconds", timeout)
            raise GenerationTimeoutError(timeout) from exc
        except Exception as exc:
            logger.exception("Generation failed")
            raise GenerationError(
                f"Text generation failed: {exc}",
                cause=exc,
            ) from exc

    async def generate_stream(
        self,
        prompt: str,
        **kwargs: Any,
    ) -> AsyncIterator[Dict[str, Any]]:
        """Generate text with streaming support.
        
        Args:
            prompt: Input prompt
            **kwargs: Additional parameters for llama.cpp
            
        Yields:
            Streaming chunks from llama.cpp
            
        Raises:
            ModelNotLoadedError: If model is not loaded
            GenerationError: If generation fails
            StreamCancelledError: If stream is cancelled
        """
        if not self.is_ready:
            logger.info("Model not loaded, triggering lazy load...")
            await self.startup()

        # Ensure streaming is enabled
        kwargs["stream"] = True
        
        try:
            # Create async iterator from sync generator
            async for chunk in self._stream_generator(prompt, **kwargs):
                yield chunk
        except asyncio.CancelledError:
            logger.info("Stream generation cancelled")
            raise StreamCancelledError("Generation stream was cancelled")
        except Exception as exc:
            logger.exception("Streaming generation failed")
            raise GenerationError(
                f"Streaming generation failed: {exc}",
                cause=exc,
            ) from exc

    async def _stream_generator(
        self,
        prompt: str,
        **kwargs: Any,
    ) -> AsyncIterator[Dict[str, Any]]:
        """Internal async generator for streaming.
        
        Wraps the synchronous llama.cpp stream in an async iterator.
        """
        loop = asyncio.get_event_loop()
        
        # Run the streaming generation in a thread pool
        def _sync_stream():
            try:
                for chunk in self._llm(prompt, **kwargs):
                    yield chunk
            except GeneratorExit:
                logger.debug("Stream generator closed")
                return

        # Create the generator in thread pool
        stream_gen = await asyncio.to_thread(_sync_stream)
        
        # Yield chunks asynchronously
        try:
            while True:
                try:
                    # Get next chunk from thread pool
                    chunk = await asyncio.to_thread(next, stream_gen, None)
                    if chunk is None:
                        break
                    yield chunk
                except StopIteration:
                    break
        finally:
            # Ensure generator is closed
            try:
                await asyncio.to_thread(stream_gen.close)
            except Exception:
                pass

    @asynccontextmanager
    async def generation_context(self, **kwargs: Any):
        """Context manager for generation with automatic cleanup.
        
        Usage:
            async with llm_service.generation_context() as gen:
                result = await gen(prompt="Hello")
        """
        start_time = time.perf_counter()
        try:
            yield self.generate
        finally:
            duration = time.perf_counter() - start_time
            logger.debug("Generation completed in %.2f seconds", duration)

