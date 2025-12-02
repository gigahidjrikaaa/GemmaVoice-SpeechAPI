"""
Unit tests for the speech API endpoints.

Tests cover /v1/speech-to-text, /v1/text-to-speech, /v1/encode-reference,
voice cloning, streaming audio, and error handling.
"""

import base64
import io
from typing import Any, Dict
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


# ============================================================================
# Speech-to-Text Endpoint Tests
# ============================================================================

class TestSpeechToTextEndpoint:
    """Test /v1/speech-to-text endpoint."""

    def test_stt_returns_200_with_audio(
        self,
        test_client: TestClient,
        sample_audio_bytes: bytes,
    ) -> None:
        """POST /v1/speech-to-text returns 200 with valid audio."""
        response = test_client.post(
            "/v1/speech-to-text",
            files={"file": ("test.wav", sample_audio_bytes, "audio/wav")},
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "text" in data

    def test_stt_returns_transcription_structure(
        self,
        test_client: TestClient,
        sample_audio_bytes: bytes,
    ) -> None:
        """Transcription response has correct structure."""
        response = test_client.post(
            "/v1/speech-to-text",
            files={"file": ("test.wav", sample_audio_bytes, "audio/wav")},
        )
        
        data = response.json()
        assert "text" in data
        assert "language" in data
        assert "segments" in data

    def test_stt_requires_file(self, test_client: TestClient) -> None:
        """Endpoint requires audio file."""
        response = test_client.post("/v1/speech-to-text")
        
        assert response.status_code == 422

    def test_stt_accepts_language_hint(
        self,
        test_client: TestClient,
        sample_audio_bytes: bytes,
    ) -> None:
        """Language hint is accepted."""
        response = test_client.post(
            "/v1/speech-to-text",
            files={"file": ("test.wav", sample_audio_bytes, "audio/wav")},
            data={"language": "es"},
        )
        
        assert response.status_code == 200

    def test_stt_accepts_prompt(
        self,
        test_client: TestClient,
        sample_audio_bytes: bytes,
    ) -> None:
        """Priming prompt is accepted."""
        response = test_client.post(
            "/v1/speech-to-text",
            files={"file": ("test.wav", sample_audio_bytes, "audio/wav")},
            data={"prompt": "Previous context"},
        )
        
        assert response.status_code == 200

    def test_stt_accepts_temperature(
        self,
        test_client: TestClient,
        sample_audio_bytes: bytes,
    ) -> None:
        """Temperature parameter is accepted."""
        response = test_client.post(
            "/v1/speech-to-text",
            files={"file": ("test.wav", sample_audio_bytes, "audio/wav")},
            data={"temperature": "0.5"},
        )
        
        assert response.status_code == 200

    def test_stt_rejects_empty_file(self, test_client: TestClient) -> None:
        """Empty audio file is rejected."""
        response = test_client.post(
            "/v1/speech-to-text",
            files={"file": ("empty.wav", b"", "audio/wav")},
        )
        
        assert response.status_code == 400


# ============================================================================
# Text-to-Speech Endpoint Tests
# ============================================================================

class TestTextToSpeechEndpoint:
    """Test /v1/text-to-speech endpoint."""

    def test_tts_returns_200(self, test_client: TestClient) -> None:
        """POST /v1/text-to-speech returns 200."""
        response = test_client.post(
            "/v1/text-to-speech",
            json={"text": "Hello, world!"},
        )
        
        assert response.status_code == 200

    def test_tts_returns_audio_data(self, test_client: TestClient) -> None:
        """TTS response contains audio data."""
        response = test_client.post(
            "/v1/text-to-speech",
            json={"text": "Test speech"},
        )
        
        data = response.json()
        # Either base64 audio or binary
        assert "audio_base64" in data or response.headers.get("content-type", "").startswith("audio/")

    def test_tts_requires_text(self, test_client: TestClient) -> None:
        """Endpoint requires text field."""
        response = test_client.post(
            "/v1/text-to-speech",
            json={},
        )
        
        assert response.status_code == 422

    def test_tts_accepts_format(self, test_client: TestClient) -> None:
        """Format parameter is accepted."""
        response = test_client.post(
            "/v1/text-to-speech",
            json={
                "text": "Test",
                "format": "wav",
            },
        )
        
        assert response.status_code == 200

    def test_tts_accepts_sample_rate(self, test_client: TestClient) -> None:
        """Sample rate parameter is accepted."""
        response = test_client.post(
            "/v1/text-to-speech",
            json={
                "text": "Test",
                "sample_rate": 44100,
            },
        )
        
        assert response.status_code == 200

    def test_tts_accepts_reference_id(self, test_client: TestClient) -> None:
        """Reference ID parameter is accepted."""
        response = test_client.post(
            "/v1/text-to-speech",
            json={
                "text": "Test",
                "reference_id": "speaker-1",
            },
        )
        
        assert response.status_code == 200

    def test_tts_streaming_mode(self, test_client: TestClient) -> None:
        """Streaming mode returns audio stream."""
        response = test_client.post(
            "/v1/text-to-speech",
            json={
                "text": "Test streaming",
                "stream": True,
            },
        )
        
        assert response.status_code == 200
        # Streaming returns binary audio
        content_type = response.headers.get("content-type", "")
        assert "audio" in content_type or "octet-stream" in content_type


# ============================================================================
# Voice Cloning Tests
# ============================================================================

class TestVoiceCloning:
    """Test voice cloning with reference audio."""

    def test_tts_accepts_references(
        self,
        test_client: TestClient,
        sample_audio_bytes: bytes,
    ) -> None:
        """References parameter is accepted for voice cloning."""
        encoded_audio = base64.b64encode(sample_audio_bytes).decode("ascii")
        
        response = test_client.post(
            "/v1/text-to-speech",
            json={
                "text": "Clone this voice",
                "references": [encoded_audio],
            },
        )
        
        assert response.status_code == 200

    def test_tts_with_multiple_references(
        self,
        test_client: TestClient,
        sample_audio_bytes: bytes,
    ) -> None:
        """Multiple reference audio samples are accepted."""
        encoded_audio = base64.b64encode(sample_audio_bytes).decode("ascii")
        
        response = test_client.post(
            "/v1/text-to-speech",
            json={
                "text": "Clone with multiple samples",
                "references": [encoded_audio, encoded_audio],
            },
        )
        
        assert response.status_code == 200


# ============================================================================
# Encode Reference Endpoint Tests
# ============================================================================

class TestEncodeReferenceEndpoint:
    """Test /v1/encode-reference endpoint."""

    def test_encode_returns_200(
        self,
        test_client: TestClient,
        sample_audio_bytes: bytes,
    ) -> None:
        """POST /v1/encode-reference returns 200."""
        response = test_client.post(
            "/v1/encode-reference",
            files={"file": ("ref.wav", sample_audio_bytes, "audio/wav")},
        )
        
        assert response.status_code == 200

    def test_encode_returns_base64(
        self,
        test_client: TestClient,
        sample_audio_bytes: bytes,
    ) -> None:
        """Encode endpoint returns base64 string."""
        response = test_client.post(
            "/v1/encode-reference",
            files={"file": ("ref.wav", sample_audio_bytes, "audio/wav")},
        )
        
        data = response.json()
        assert "reference_base64" in data
        
        # Verify it's valid base64
        decoded = base64.b64decode(data["reference_base64"])
        assert decoded == sample_audio_bytes

    def test_encode_requires_file(self, test_client: TestClient) -> None:
        """Endpoint requires audio file."""
        response = test_client.post("/v1/encode-reference")
        
        assert response.status_code == 422

    def test_encode_rejects_empty_file(self, test_client: TestClient) -> None:
        """Empty file is rejected."""
        response = test_client.post(
            "/v1/encode-reference",
            files={"file": ("empty.wav", b"", "audio/wav")},
        )
        
        assert response.status_code == 400


# ============================================================================
# TTS Parameter Validation Tests
# ============================================================================

class TestTTSParameterValidation:
    """Test TTS parameter validation."""

    def test_validates_temperature(self, test_client: TestClient) -> None:
        """Temperature must be in valid range."""
        response = test_client.post(
            "/v1/text-to-speech",
            json={
                "text": "Test",
                "temperature": 5.0,
            },
        )
        
        assert response.status_code == 422

    def test_validates_top_p(self, test_client: TestClient) -> None:
        """top_p must be in valid range."""
        response = test_client.post(
            "/v1/text-to-speech",
            json={
                "text": "Test",
                "top_p": 1.5,
            },
        )
        
        assert response.status_code == 422


# ============================================================================
# Service Unavailable Tests
# ============================================================================

class TestServiceUnavailable:
    """Test 503 responses when services are unavailable."""

    def test_stt_503_when_whisper_unavailable(
        self,
        test_client: TestClient,
        app: FastAPI,
        sample_audio_bytes: bytes,
    ) -> None:
        """503 returned when Whisper service is unavailable."""
        app.state.whisper_service._is_ready = False
        
        response = test_client.post(
            "/v1/speech-to-text",
            files={"file": ("test.wav", sample_audio_bytes, "audio/wav")},
        )
        
        assert response.status_code == 503
        
        # Restore
        app.state.whisper_service._is_ready = True

    def test_tts_503_when_openaudio_unavailable(
        self,
        test_client: TestClient,
        app: FastAPI,
    ) -> None:
        """503 returned when OpenAudio service is unavailable."""
        app.state.openaudio_service._is_ready = False
        
        response = test_client.post(
            "/v1/text-to-speech",
            json={"text": "Test"},
        )
        
        assert response.status_code == 503
        
        # Restore
        app.state.openaudio_service._is_ready = True


# ============================================================================
# Accept Header Tests
# ============================================================================

class TestAcceptHeaders:
    """Test Accept header handling for TTS."""

    def test_tts_json_accept_returns_base64(self, test_client: TestClient) -> None:
        """application/json Accept returns base64 audio."""
        response = test_client.post(
            "/v1/text-to-speech",
            json={"text": "Test"},
            headers={"Accept": "application/json"},
        )
        
        assert response.status_code == 200
        assert "application/json" in response.headers.get("content-type", "")

    def test_tts_audio_accept_returns_binary(self, test_client: TestClient) -> None:
        """audio/* Accept returns binary audio."""
        response = test_client.post(
            "/v1/text-to-speech",
            json={"text": "Test", "stream": True},
            headers={"Accept": "audio/wav"},
        )
        
        assert response.status_code == 200


# ============================================================================
# TTS Prosody Tests
# ============================================================================

class TestTTSProsody:
    """Test TTS prosody parameters."""

    def test_tts_accepts_speed(self, test_client: TestClient) -> None:
        """Speed parameter is accepted."""
        response = test_client.post(
            "/v1/text-to-speech",
            json={
                "text": "Test",
                "speed": 1.5,
            },
        )
        
        assert response.status_code == 200

    def test_tts_accepts_volume(self, test_client: TestClient) -> None:
        """Volume parameter is accepted."""
        response = test_client.post(
            "/v1/text-to-speech",
            json={
                "text": "Test",
                "volume": 0.5,
            },
        )
        
        assert response.status_code == 200

    def test_tts_accepts_chunk_length(self, test_client: TestClient) -> None:
        """Chunk length parameter is accepted."""
        response = test_client.post(
            "/v1/text-to-speech",
            json={
                "text": "Test",
                "chunk_length": 100,
            },
        )
        
        assert response.status_code == 200

    def test_tts_accepts_latency(self, test_client: TestClient) -> None:
        """Latency parameter is accepted."""
        response = test_client.post(
            "/v1/text-to-speech",
            json={
                "text": "Test",
                "latency": "balanced",
            },
        )
        
        assert response.status_code == 200
