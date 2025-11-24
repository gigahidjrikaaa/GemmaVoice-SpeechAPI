"""Streaming utilities for SSE and WebSocket responses."""

from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator, AsyncIterator, Optional

from fastapi import Request
from fastapi.responses import StreamingResponse

logger = logging.getLogger(__name__)


class SSEFormatter:
    """Formats data for Server-Sent Events (SSE) protocol.
    
    SSE format specification:
    - Each message starts with "event: <event_type>\n"
    - Followed by "data: <json_data>\n"
    - Terminated with "\n\n"
    """

    @staticmethod
    def format(event: str, data: dict[str, Any], event_id: Optional[str] = None) -> str:
        """Format a single SSE event.
        
        Args:
            event: Event type (e.g., "text", "done", "error")
            data: Data payload to send
            event_id: Optional event ID for client-side tracking
            
        Returns:
            Formatted SSE message string
        """
        lines = []
        
        if event_id:
            lines.append(f"id: {event_id}")
        
        lines.append(f"event: {event}")
        
        # Serialize data to JSON and handle multiline
        json_data = json.dumps(data, ensure_ascii=False)
        for line in json_data.split("\n"):
            lines.append(f"data: {line}")
        
        # SSE messages end with double newline
        return "\n".join(lines) + "\n\n"

    @staticmethod
    def format_text(text: str, event_id: Optional[str] = None) -> str:
        """Format a text chunk event."""
        return SSEFormatter.format("text", {"text": text}, event_id)

    @staticmethod
    def format_usage(usage_data: dict[str, Any], event_id: Optional[str] = None) -> str:
        """Format a usage statistics event."""
        return SSEFormatter.format("usage", usage_data, event_id)

    @staticmethod
    def format_done(event_id: Optional[str] = None) -> str:
        """Format a stream completion event."""
        return SSEFormatter.format("done", {}, event_id)

    @staticmethod
    def format_error(error_message: str, error_code: str = "ERROR", event_id: Optional[str] = None) -> str:
        """Format an error event."""
        return SSEFormatter.format("error", {"error": error_code, "message": error_message}, event_id)


async def create_sse_response(
    generator: AsyncIterator[str],
    request: Request,
    media_type: str = "text/event-stream",
) -> StreamingResponse:
    """Create a streaming response for SSE with cancellation support.
    
    Args:
        generator: Async generator yielding SSE-formatted strings
        request: FastAPI request object for disconnect detection
        media_type: Response media type
        
    Returns:
        StreamingResponse configured for SSE
    """
    async def event_stream() -> AsyncGenerator[str, None]:
        """Wrap generator with disconnect detection."""
        try:
            async for chunk in generator:
                if await request.is_disconnected():
                    logger.info("Client disconnected, stopping stream")
                    break
                yield chunk
        except asyncio.CancelledError:
            logger.info("Stream cancelled")
            raise
        except Exception as exc:
            logger.exception("Error in SSE stream")
            # Send error event before closing
            yield SSEFormatter.format_error(str(exc), "STREAM_ERROR")
            raise

    return StreamingResponse(
        event_stream(),
        media_type=media_type,
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
            "Connection": "keep-alive",
        },
    )


@asynccontextmanager
async def handle_stream_cancellation():
    """Context manager to handle stream cancellation gracefully.
    
    Usage:
        async with handle_stream_cancellation():
            async for chunk in stream:
                yield chunk
    """
    try:
        yield
    except asyncio.CancelledError:
        logger.info("Stream cancelled by client or timeout")
        raise
    except GeneratorExit:
        logger.info("Stream generator closed")
        raise
    except Exception as exc:
        logger.exception("Unexpected error in stream")
        raise


async def create_token_stream(
    llm_stream: AsyncIterator[dict[str, Any]],
    include_usage: bool = True,
) -> AsyncGenerator[str, None]:
    """Convert llama.cpp stream to SSE format.
    
    Args:
        llm_stream: Async iterator yielding llama.cpp response chunks
        include_usage: Whether to include usage statistics
        
    Yields:
        SSE-formatted strings
    """
    total_tokens = 0
    
    try:
        async for chunk in llm_stream:
            # Extract token from llama.cpp response format
            if "choices" in chunk and len(chunk["choices"]) > 0:
                choice = chunk["choices"][0]
                token = choice.get("text", "")
                
                if token:
                    total_tokens += 1
                    yield SSEFormatter.format_text(token)
                
                # Check if generation is complete
                if choice.get("finish_reason"):
                    if include_usage:
                        usage_data = {
                            "total_tokens": total_tokens,
                            "finish_reason": choice["finish_reason"],
                        }
                        # Include usage stats if available
                        if "usage" in chunk:
                            usage_data.update(chunk["usage"])
                        yield SSEFormatter.format_usage(usage_data)
                    break
        
        # Send done event
        yield SSEFormatter.format_done()
        
    except Exception as exc:
        logger.exception("Error in token stream conversion")
        yield SSEFormatter.format_error(str(exc), "STREAM_ERROR")
        raise


class StreamBuffer:
    """Buffered stream to handle backpressure."""

    def __init__(self, max_size: int = 100):
        self.queue: asyncio.Queue[Optional[str]] = asyncio.Queue(maxsize=max_size)
        self._closed = False

    async def put(self, item: str) -> None:
        """Add item to buffer."""
        if self._closed:
            raise RuntimeError("Stream buffer is closed")
        await self.queue.put(item)

    async def get(self) -> Optional[str]:
        """Get item from buffer."""
        return await self.queue.get()

    async def close(self) -> None:
        """Close the buffer."""
        self._closed = True
        await self.queue.put(None)  # Sentinel value

    async def __aiter__(self) -> AsyncIterator[str]:
        """Async iterator interface."""
        while True:
            item = await self.get()
            if item is None:  # Sentinel value indicates end
                break
            yield item
