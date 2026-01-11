"""Remote LLM service used by the LiveKit worker.

Why this exists:
- The Docker Compose setup runs the API server (gemma_service) and a LiveKit agent worker.
- Loading the GGUF model in both processes can exhaust GPU memory (CUDA OOM), which prevents
  the worker from registering with LiveKit.

This service proxies generation to the existing FastAPI endpoints instead of loading
llama.cpp in the worker process.

Streaming:
- The backend exposes `/v1/generate_stream` as Server-Sent Events (SSE).
- We parse SSE `text` events and adapt them to the dict format expected by `GemmaLLMStream`.
"""

from __future__ import annotations

import json
import logging
from typing import Any, AsyncIterator, Optional

import httpx

logger = logging.getLogger(__name__)


class RemoteLLMService:
    """A minimal LLMService-like adapter that calls the API server over HTTP."""

    def __init__(
        self,
        *,
        api_base_url: str,
        api_key_header: str = "X-API-Key",
        api_key: Optional[str] = None,
        timeout_s: float = 120.0,
    ) -> None:
        self._api_base_url = api_base_url.rstrip("/")
        self._api_key_header = api_key_header
        self._api_key = api_key
        self._timeout_s = timeout_s
        self._client: Optional[httpx.AsyncClient] = None

    async def startup(self) -> None:
        if self._client is None:
            self._client = httpx.AsyncClient(base_url=self._api_base_url, timeout=self._timeout_s)

    async def shutdown(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    def _headers(self) -> dict[str, str]:
        if self._api_key:
            return {self._api_key_header: self._api_key}
        return {}

    async def generate(
        self,
        prompt: str,
        *,
        max_tokens: int = 512,
        temperature: float = 0.7,
        top_p: float = 0.95,
        top_k: int = 40,
        repeat_penalty: float = 1.1,
    ) -> dict[str, Any]:
        """Non-streaming generation via `/v1/generate`.

        Returns the backend JSON as-is.
        """
        if self._client is None:
            await self.startup()
        assert self._client is not None

        payload = {
            "prompt": prompt,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "top_p": top_p,
            "top_k": top_k,
            "repeat_penalty": repeat_penalty,
        }
        resp = await self._client.post("/v1/generate", json=payload, headers=self._headers())
        resp.raise_for_status()
        return resp.json()

    async def generate_stream(
        self,
        prompt: str,
        *,
        max_tokens: int = 512,
        temperature: float = 0.7,
        top_p: float = 0.95,
        top_k: int = 40,
        repeat_penalty: float = 1.1,
    ) -> AsyncIterator[dict[str, Any]]:
        """Streaming generation via `/v1/generate_stream` (SSE).

        Adapts SSE `text` events to the dict structure expected by `GemmaLLMStream`:
        `{ "choices": [{"text": "..."}] }`.
        """
        if self._client is None:
            await self.startup()
        assert self._client is not None

        payload = {
            "prompt": prompt,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "top_p": top_p,
            "top_k": top_k,
            "repeat_penalty": repeat_penalty,
            "stream": True,
        }

        async with self._client.stream(
            "POST",
            "/v1/generate_stream",
            json=payload,
            headers={
                **self._headers(),
                "Accept": "text/event-stream",
            },
        ) as resp:
            resp.raise_for_status()

            event_name: Optional[str] = None
            data_lines: list[str] = []

            async for line in resp.aiter_lines():
                # SSE frames are separated by a blank line
                if line == "":
                    if event_name and data_lines:
                        raw = "\n".join(data_lines)
                        try:
                            data = json.loads(raw)
                        except json.JSONDecodeError:
                            logger.debug("Failed to decode SSE data JSON: %s", raw)
                            data = None

                        if event_name == "text" and isinstance(data, dict):
                            text = str(data.get("text", ""))
                            if text:
                                yield {"choices": [{"text": text}]}
                        elif event_name == "error" and isinstance(data, dict):
                            message = data.get("message")
                            raise RuntimeError(f"Remote LLM error: {message}")

                    event_name = None
                    data_lines = []
                    continue

                if line.startswith("event:"):
                    event_name = line.split(":", 1)[1].strip()
                    continue

                if line.startswith("data:"):
                    data_lines.append(line.split(":", 1)[1].lstrip())
                    continue

                # Ignore other SSE fields (id:, retry:)
