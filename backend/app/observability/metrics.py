"""Prometheus metrics utilities."""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import FastAPI
from fastapi.responses import Response
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest

logger = logging.getLogger(__name__)

_http_request_latency = Histogram(
    "app_http_request_duration_seconds",
    "Latency of processed HTTP requests",
    labelnames=("method", "route"),
)
_http_request_total = Counter(
    "app_http_requests_total",
    "Total number of processed HTTP requests",
    labelnames=("method", "route", "status"),
)
_http_request_errors = Counter(
    "app_http_request_errors_total",
    "Total number of HTTP requests that raised server errors",
    labelnames=("method", "route", "status"),
)
_external_call_latency = Histogram(
    "app_external_call_duration_seconds",
    "Duration of external service interactions",
    labelnames=("service",),
)
_external_call_errors = Counter(
    "app_external_call_errors_total",
    "Number of failed external service interactions",
    labelnames=("service",),
)
_pipeline_latency = Histogram(
    "app_pipeline_duration_seconds",
    "Duration of high-level pipeline orchestrations",
    labelnames=("pipeline",),
)
_pipeline_errors = Counter(
    "app_pipeline_errors_total",
    "Number of failed high-level pipeline orchestrations",
    labelnames=("pipeline",),
)
_rate_limit_rejections = Counter(
    "app_rate_limit_rejections_total",
    "Number of requests rejected by rate limiting",
    labelnames=("scope",),
)


# --- WebSocket / streaming metrics ---

_ws_stt_stream_connections_total = Counter(
    "app_ws_stt_stream_connections_total",
    "Total number of STT streaming WebSocket connections",
)
_ws_stt_stream_active = Gauge(
    "app_ws_stt_stream_active",
    "Number of active STT streaming WebSocket connections",
)
_ws_stt_stream_audio_bytes_total = Counter(
    "app_ws_stt_stream_audio_bytes_total",
    "Total number of audio bytes received over the STT streaming WebSocket",
)
_ws_stt_stream_events_total = Counter(
    "app_ws_stt_stream_events_total",
    "Total number of STT streaming WebSocket events sent to clients",
    labelnames=("event",),
)
_stt_stream_conversion_latency = Histogram(
    "app_stt_stream_conversion_duration_seconds",
    "Duration of WebM-to-WAV conversion during STT streaming",
    labelnames=("result",),
)
_stt_stream_transcription_latency = Histogram(
    "app_stt_stream_transcription_duration_seconds",
    "Duration of Whisper transcription during STT streaming",
    labelnames=("result",),
)


def record_ws_stt_stream_connection(*, opened: bool) -> None:
    """Record lifecycle metrics for the STT streaming WebSocket."""

    if opened:
        _ws_stt_stream_connections_total.inc()
        _ws_stt_stream_active.inc()
    else:
        _ws_stt_stream_active.dec()


def record_ws_stt_stream_audio_bytes(byte_count: int) -> None:
    """Accumulate total audio bytes received from streaming clients."""

    if byte_count > 0:
        _ws_stt_stream_audio_bytes_total.inc(byte_count)


def record_ws_stt_stream_event(event: str) -> None:
    """Count outbound STT streaming events by type (e.g., interim/final/error)."""

    if not event:
        event = "unknown"
    _ws_stt_stream_events_total.labels(event=event).inc()


def record_stt_stream_conversion(duration_seconds: float, *, success: bool) -> None:
    _stt_stream_conversion_latency.labels(result="success" if success else "error").observe(
        duration_seconds
    )


def record_stt_stream_transcription(duration_seconds: float, *, success: bool) -> None:
    _stt_stream_transcription_latency.labels(result="success" if success else "error").observe(
        duration_seconds
    )


def _normalise_route(route: Optional[str]) -> str:
    if not route:
        return "unknown"
    return route


def record_http_request(method: str, route: Optional[str], status_code: int, duration_seconds: float) -> None:
    """Record metrics for a handled HTTP request."""

    normalized_route = _normalise_route(route)
    _http_request_latency.labels(method=method, route=normalized_route).observe(duration_seconds)
    status_str = str(status_code)
    _http_request_total.labels(method=method, route=normalized_route, status=status_str).inc()
    if status_code >= 500:
        _http_request_errors.labels(method=method, route=normalized_route, status=status_str).inc()


def record_external_call(service: str, duration_seconds: float, *, success: bool) -> None:
    """Record metrics for a call to an external dependency."""

    _external_call_latency.labels(service=service).observe(duration_seconds)
    if not success:
        _external_call_errors.labels(service=service).inc()


def record_pipeline(pipeline: str, duration_seconds: float, *, success: bool) -> None:
    """Record metrics for a full orchestration pipeline."""

    _pipeline_latency.labels(pipeline=pipeline).observe(duration_seconds)
    if not success:
        _pipeline_errors.labels(pipeline=pipeline).inc()


def record_rate_limit_rejection(scope: str) -> None:
    """Increment the counter for throttled requests."""

    _rate_limit_rejections.labels(scope=scope).inc()


def register_metrics_endpoint(app: FastAPI) -> None:
    """Expose a Prometheus scrape endpoint on ``/metrics``."""

    @app.get("/metrics")
    async def metrics_endpoint() -> Response:  # pragma: no cover - exercised in integration tests
        payload = generate_latest()
        return Response(payload, media_type=CONTENT_TYPE_LATEST)

    logger.info("Registered /metrics endpoint for Prometheus scraping")
