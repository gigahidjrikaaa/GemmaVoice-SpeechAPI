"""Agent telemetry helpers (per-job context).

This module provides a lightweight way for deep callsites (plugins, services)
inside a LiveKit agent job to emit lifecycle/progress events without needing to
thread an `emit()` callback through every stack frame.

We intentionally scope telemetry to the *current job* using `contextvars`.
That way, multiple concurrent jobs in the same worker process don't cross-talk.
"""

from __future__ import annotations

import contextvars
from typing import Awaitable, Callable, Optional


Emitter = Callable[[str, Optional[str], Optional[dict]], Awaitable[None]]


_emitter_var: contextvars.ContextVar[Optional[Emitter]] = contextvars.ContextVar(
    "gemmavoice_agent_emitter",
    default=None,
)


def set_emitter(emitter: Optional[Emitter]) -> None:
    """Set the emitter for the current job context."""

    _emitter_var.set(emitter)


async def emit(status: str, message: Optional[str] = None, data: Optional[dict] = None) -> None:
    """Emit a telemetry event if an emitter is configured.

    This is best-effort and must never raise.
    """

    emitter = _emitter_var.get()
    if emitter is None:
        return

    try:
        await emitter(status, message, data)
    except Exception:
        # Best-effort only; never break the agent pipeline.
        return
