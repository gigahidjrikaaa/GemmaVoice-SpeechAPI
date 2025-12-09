"""Custom LiveKit LLM plugin wrapping our Gemma llama.cpp service.

This plugin adapts our existing LLMService to work with LiveKit's
agent framework, providing streaming chat completions.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass
from typing import Any, AsyncIterable, AsyncIterator

from livekit.agents import llm
from livekit.agents.llm import (
    ChatChunk,
    ChatContext,
    ChoiceDelta,
    CompletionUsage,
    FunctionTool,
    FunctionToolCall,
    LLMStream,
    RawFunctionTool,
    ToolChoice,
)
from livekit.agents.types import (
    DEFAULT_API_CONNECT_OPTIONS,
    NOT_GIVEN,
    APIConnectOptions,
    NotGivenOr,
)

from app.services.llm import LLMService
from app.config.settings import get_settings

logger = logging.getLogger(__name__)


@dataclass
class GemmaLLMOptions:
    """Options for the Gemma LLM plugin."""
    temperature: float = 0.7
    max_tokens: int = 1024
    top_p: float = 0.95
    top_k: int = 40
    repeat_penalty: float = 1.1


class GemmaLLM(llm.LLM):
    """LiveKit LLM plugin that wraps our Gemma llama.cpp service.
    
    This allows the existing LLMService to be used seamlessly with
    LiveKit's voice agent framework.
    
    Usage:
        llm_service = LLMService(settings)
        await llm_service.startup()
        
        gemma_llm = GemmaLLM(llm_service=llm_service)
        
        session = AgentSession(
            llm=gemma_llm,
            stt=...,
            tts=...,
        )
    """

    def __init__(
        self,
        *,
        llm_service: LLMService,
        temperature: float = 0.7,
        max_tokens: int = 1024,
        top_p: float = 0.95,
        top_k: int = 40,
        repeat_penalty: float = 1.1,
    ) -> None:
        """Initialize the Gemma LLM plugin.
        
        Args:
            llm_service: The underlying LLMService instance
            temperature: Sampling temperature (0.0 - 2.0)
            max_tokens: Maximum tokens to generate
            top_p: Nucleus sampling parameter
            top_k: Top-k sampling parameter
            repeat_penalty: Repetition penalty factor
        """
        super().__init__()
        self._llm_service = llm_service
        self._opts = GemmaLLMOptions(
            temperature=temperature,
            max_tokens=max_tokens,
            top_p=top_p,
            top_k=top_k,
            repeat_penalty=repeat_penalty,
        )

    @property
    def model(self) -> str:
        """Return the model name."""
        settings = get_settings()
        return settings.llm_model_filename

    @property
    def provider(self) -> str:
        """Return the provider name."""
        return "gemma-llama-cpp"

    def update_options(
        self,
        *,
        temperature: NotGivenOr[float] = NOT_GIVEN,
        max_tokens: NotGivenOr[int] = NOT_GIVEN,
        top_p: NotGivenOr[float] = NOT_GIVEN,
        top_k: NotGivenOr[int] = NOT_GIVEN,
        repeat_penalty: NotGivenOr[float] = NOT_GIVEN,
    ) -> None:
        """Update generation options."""
        from livekit.agents.utils import is_given
        
        if is_given(temperature):
            self._opts.temperature = temperature
        if is_given(max_tokens):
            self._opts.max_tokens = max_tokens
        if is_given(top_p):
            self._opts.top_p = top_p
        if is_given(top_k):
            self._opts.top_k = top_k
        if is_given(repeat_penalty):
            self._opts.repeat_penalty = repeat_penalty

    def chat(
        self,
        *,
        chat_ctx: ChatContext,
        tools: list[FunctionTool | RawFunctionTool] | None = None,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
        parallel_tool_calls: NotGivenOr[bool] = NOT_GIVEN,
        tool_choice: NotGivenOr[ToolChoice] = NOT_GIVEN,
        extra_kwargs: NotGivenOr[dict[str, Any]] = NOT_GIVEN,
    ) -> "GemmaLLMStream":
        """Create a streaming chat completion.
        
        Args:
            chat_ctx: The chat context with conversation history
            tools: Optional function tools (not supported by Gemma)
            conn_options: Connection options
            parallel_tool_calls: Not used
            tool_choice: Not used
            extra_kwargs: Additional generation parameters
            
        Returns:
            A streaming response
        """
        return GemmaLLMStream(
            llm=self,
            llm_service=self._llm_service,
            opts=self._opts,
            chat_ctx=chat_ctx,
            tools=tools or [],
            conn_options=conn_options,
        )

    async def aclose(self) -> None:
        """Close the LLM (no-op as LLMService lifecycle is managed separately)."""
        pass


class GemmaLLMStream(LLMStream):
    """Streaming response from the Gemma LLM."""

    def __init__(
        self,
        llm: GemmaLLM,
        *,
        llm_service: LLMService,
        opts: GemmaLLMOptions,
        chat_ctx: ChatContext,
        tools: list[FunctionTool | RawFunctionTool],
        conn_options: APIConnectOptions,
    ) -> None:
        super().__init__(llm, chat_ctx=chat_ctx, tools=tools, conn_options=conn_options)
        self._llm_service = llm_service
        self._opts = opts
        self._request_id = str(uuid.uuid4())

    async def _run(self) -> None:
        """Execute the streaming chat completion."""
        # Build prompt from chat context
        prompt = self._build_prompt()
        
        logger.debug(
            "GemmaLLMStream starting generation with prompt length %d",
            len(prompt)
        )
        
        start_time = time.perf_counter()
        generated_tokens = 0
        generated_text = ""
        
        try:
            # Stream tokens from llama.cpp
            async for chunk in self._llm_service.generate_stream(
                prompt,
                max_tokens=self._opts.max_tokens,
                temperature=self._opts.temperature,
                top_p=self._opts.top_p,
                top_k=self._opts.top_k,
                repeat_penalty=self._opts.repeat_penalty,
            ):
                # Extract the generated text from the chunk
                choices = chunk.get("choices", [])
                if not choices:
                    continue
                
                delta_text = choices[0].get("text", "")
                if not delta_text:
                    continue
                
                generated_text += delta_text
                generated_tokens += 1
                
                # Emit chat chunk
                chat_chunk = ChatChunk(
                    request_id=self._request_id,
                    choices=[
                        ChoiceDelta(
                            index=0,
                            delta=llm.ChoiceDelta(
                                role="assistant",
                                content=delta_text,
                            ),
                        )
                    ],
                )
                self._event_ch.send_nowait(chat_chunk)
            
            # Send final chunk with usage info
            duration = time.perf_counter() - start_time
            
            final_chunk = ChatChunk(
                request_id=self._request_id,
                choices=[],
                usage=CompletionUsage(
                    completion_tokens=generated_tokens,
                    prompt_tokens=len(prompt.split()),  # Approximate
                    total_tokens=generated_tokens + len(prompt.split()),
                ),
            )
            self._event_ch.send_nowait(final_chunk)
            
            logger.debug(
                "GemmaLLMStream completed: %d tokens in %.2fs",
                generated_tokens,
                duration,
            )
            
        except asyncio.CancelledError:
            logger.info("GemmaLLMStream cancelled")
            raise
        except Exception as e:
            logger.exception("GemmaLLMStream failed")
            raise

    def _build_prompt(self) -> str:
        """Build a prompt string from the chat context.
        
        Converts the ChatContext to a Gemma-style prompt format.
        """
        parts = []
        
        for item in self._chat_ctx.items:
            if not hasattr(item, 'role'):
                continue
                
            role = item.role
            content = item.text_content if hasattr(item, 'text_content') else str(item.content)
            
            if content is None:
                continue
            
            if role == "system":
                parts.append(f"<start_of_turn>system\n{content}<end_of_turn>")
            elif role == "user":
                parts.append(f"<start_of_turn>user\n{content}<end_of_turn>")
            elif role == "assistant":
                parts.append(f"<start_of_turn>model\n{content}<end_of_turn>")
        
        # Add the model turn marker for generation
        parts.append("<start_of_turn>model\n")
        
        return "\n".join(parts)
