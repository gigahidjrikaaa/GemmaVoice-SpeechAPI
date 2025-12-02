"""
Unit tests for Pydantic schemas.

Tests cover validation rules, default values, serialization,
and field constraints for all API schemas.
"""

import pytest
from pydantic import ValidationError

from app.schemas.generation import (
    GenerationRequest,
    GenerationResponse,
    ModelInfo,
    ModelListResponse,
)
from app.schemas.speech import (
    SpeechSynthesisRequest,
    SpeechSynthesisResponse,
    SpeechTranscriptionOptions,
    SpeechTranscriptionResponse,
    SpeechTranscriptionSegment,
)


# ============================================================================
# GenerationRequest Tests
# ============================================================================

class TestGenerationRequest:
    """Test GenerationRequest schema."""

    def test_minimal_request(self) -> None:
        """Request with only required fields."""
        request = GenerationRequest(prompt="Hello")
        
        assert request.prompt == "Hello"
        assert request.max_tokens == 512  # default
        assert request.temperature == 0.7  # default

    def test_all_fields(self) -> None:
        """Request with all fields specified."""
        request = GenerationRequest(
            prompt="Test prompt",
            system_prompt="Be helpful",
            max_tokens=100,
            temperature=0.5,
            top_p=0.9,
            top_k=50,
            repeat_penalty=1.2,
            stop=["\n", "."],
            seed=42,
            min_p=0.1,
            tfs_z=0.95,
            typical_p=0.9,
        )
        
        assert request.prompt == "Test prompt"
        assert request.system_prompt == "Be helpful"
        assert request.max_tokens == 100
        assert request.temperature == 0.5
        assert request.stop == ["\n", "."]
        assert request.seed == 42

    def test_temperature_validation(self) -> None:
        """Temperature must be between 0 and 2."""
        # Valid
        GenerationRequest(prompt="Test", temperature=0.0)
        GenerationRequest(prompt="Test", temperature=2.0)
        
        # Invalid
        with pytest.raises(ValidationError):
            GenerationRequest(prompt="Test", temperature=-0.1)
        
        with pytest.raises(ValidationError):
            GenerationRequest(prompt="Test", temperature=2.1)

    def test_max_tokens_validation(self) -> None:
        """max_tokens must be between 1 and 4096."""
        # Valid
        GenerationRequest(prompt="Test", max_tokens=1)
        GenerationRequest(prompt="Test", max_tokens=4096)
        
        # Invalid
        with pytest.raises(ValidationError):
            GenerationRequest(prompt="Test", max_tokens=0)
        
        with pytest.raises(ValidationError):
            GenerationRequest(prompt="Test", max_tokens=5000)

    def test_top_p_validation(self) -> None:
        """top_p must be between 0 and 1."""
        # Valid
        GenerationRequest(prompt="Test", top_p=0.0)
        GenerationRequest(prompt="Test", top_p=1.0)
        
        # Invalid
        with pytest.raises(ValidationError):
            GenerationRequest(prompt="Test", top_p=-0.1)
        
        with pytest.raises(ValidationError):
            GenerationRequest(prompt="Test", top_p=1.1)

    def test_top_k_validation(self) -> None:
        """top_k must be non-negative."""
        # Valid
        GenerationRequest(prompt="Test", top_k=0)
        GenerationRequest(prompt="Test", top_k=100)
        
        # Invalid
        with pytest.raises(ValidationError):
            GenerationRequest(prompt="Test", top_k=-1)

    def test_seed_validation(self) -> None:
        """seed must be non-negative if provided."""
        # Valid
        GenerationRequest(prompt="Test", seed=0)
        GenerationRequest(prompt="Test", seed=None)
        
        # Invalid
        with pytest.raises(ValidationError):
            GenerationRequest(prompt="Test", seed=-1)

    def test_serialization(self) -> None:
        """Request serializes correctly."""
        request = GenerationRequest(prompt="Test", max_tokens=50)
        data = request.model_dump()
        
        assert data["prompt"] == "Test"
        assert data["max_tokens"] == 50


# ============================================================================
# GenerationResponse Tests
# ============================================================================

class TestGenerationResponse:
    """Test GenerationResponse schema."""

    def test_response_creation(self) -> None:
        """Response is created with generated text."""
        response = GenerationResponse(generated_text="Hello, world!")
        
        assert response.generated_text == "Hello, world!"

    def test_serialization(self) -> None:
        """Response serializes correctly."""
        response = GenerationResponse(generated_text="Test")
        data = response.model_dump()
        
        assert data == {"generated_text": "Test"}


# ============================================================================
# ModelInfo Tests
# ============================================================================

class TestModelInfo:
    """Test ModelInfo schema."""

    def test_model_info_creation(self) -> None:
        """ModelInfo is created with all fields."""
        info = ModelInfo(
            id="gemma-3-12b",
            name="Gemma 3 12B",
            description="Large language model",
        )
        
        assert info.id == "gemma-3-12b"
        assert info.name == "Gemma 3 12B"
        assert info.description == "Large language model"


class TestModelListResponse:
    """Test ModelListResponse schema."""

    def test_model_list_creation(self) -> None:
        """ModelListResponse is created with models list."""
        models = [
            ModelInfo(id="model1", name="Model 1", description="First model"),
            ModelInfo(id="model2", name="Model 2", description="Second model"),
        ]
        response = ModelListResponse(models=models)
        
        assert len(response.models) == 2
        assert response.models[0].id == "model1"


# ============================================================================
# SpeechTranscriptionSegment Tests
# ============================================================================

class TestSpeechTranscriptionSegment:
    """Test SpeechTranscriptionSegment schema."""

    def test_segment_creation(self) -> None:
        """Segment is created with all fields."""
        segment = SpeechTranscriptionSegment(
            id=1,
            start=0.0,
            end=2.5,
            text="Hello world",
        )
        
        assert segment.id == 1
        assert segment.start == 0.0
        assert segment.end == 2.5
        assert segment.text == "Hello world"

    def test_segment_optional_fields(self) -> None:
        """Segment works with optional fields as None."""
        segment = SpeechTranscriptionSegment(text="Test")
        
        assert segment.id is None
        assert segment.start is None
        assert segment.end is None
        assert segment.text == "Test"


# ============================================================================
# SpeechTranscriptionResponse Tests
# ============================================================================

class TestSpeechTranscriptionResponse:
    """Test SpeechTranscriptionResponse schema."""

    def test_response_creation(self) -> None:
        """Response is created with required fields."""
        response = SpeechTranscriptionResponse(
            text="Transcribed text",
            language="en",
            segments=[],
        )
        
        assert response.text == "Transcribed text"
        assert response.language == "en"
        assert response.segments == []

    def test_response_with_segments(self) -> None:
        """Response includes segments."""
        segments = [
            SpeechTranscriptionSegment(id=1, start=0.0, end=1.0, text="Hello"),
            SpeechTranscriptionSegment(id=2, start=1.0, end=2.0, text="world"),
        ]
        response = SpeechTranscriptionResponse(
            text="Hello world",
            language="en",
            segments=segments,
        )
        
        assert len(response.segments) == 2


# ============================================================================
# SpeechTranscriptionOptions Tests
# ============================================================================

class TestSpeechTranscriptionOptions:
    """Test SpeechTranscriptionOptions schema."""

    def test_options_all_optional(self) -> None:
        """All options are optional."""
        options = SpeechTranscriptionOptions()
        
        assert options.language is None
        assert options.prompt is None
        assert options.response_format is None
        assert options.temperature is None

    def test_options_with_values(self) -> None:
        """Options accept provided values."""
        options = SpeechTranscriptionOptions(
            language="es",
            prompt="Previous context",
            response_format="verbose_json",
            temperature=0.3,
        )
        
        assert options.language == "es"
        assert options.prompt == "Previous context"
        assert options.temperature == 0.3

    def test_temperature_validation(self) -> None:
        """Temperature must be between 0 and 1."""
        # Valid
        SpeechTranscriptionOptions(temperature=0.0)
        SpeechTranscriptionOptions(temperature=1.0)
        
        # Invalid
        with pytest.raises(ValidationError):
            SpeechTranscriptionOptions(temperature=-0.1)
        
        with pytest.raises(ValidationError):
            SpeechTranscriptionOptions(temperature=1.1)


# ============================================================================
# SpeechSynthesisRequest Tests
# ============================================================================

class TestSpeechSynthesisRequest:
    """Test SpeechSynthesisRequest schema."""

    def test_minimal_request(self) -> None:
        """Request with only required fields."""
        request = SpeechSynthesisRequest(text="Hello")
        
        assert request.text == "Hello"
        assert request.stream is False  # default

    def test_all_fields(self) -> None:
        """Request with all fields specified."""
        request = SpeechSynthesisRequest(
            text="Test speech",
            format="wav",
            sample_rate=44100,
            reference_id="speaker-1",
            normalize=True,
            references=["base64data"],
            top_p=0.8,
            temperature=0.7,
            chunk_length=200,
            latency="normal",
            speed=1.0,
            volume=0.5,
            stream=True,
        )
        
        assert request.text == "Test speech"
        assert request.format == "wav"
        assert request.sample_rate == 44100
        assert request.stream is True

    def test_text_alias(self) -> None:
        """Text field accepts 'input' alias."""
        request = SpeechSynthesisRequest.model_validate({"input": "Hello"})
        
        assert request.text == "Hello"

    def test_format_alias(self) -> None:
        """Format field accepts 'response_format' alias."""
        request = SpeechSynthesisRequest.model_validate({
            "text": "Hello",
            "response_format": "mp3",
        })
        
        assert request.format == "mp3"

    def test_temperature_validation(self) -> None:
        """Temperature must be between 0 and 2."""
        # Valid
        SpeechSynthesisRequest(text="Test", temperature=0.0)
        SpeechSynthesisRequest(text="Test", temperature=2.0)
        
        # Invalid
        with pytest.raises(ValidationError):
            SpeechSynthesisRequest(text="Test", temperature=-0.1)
        
        with pytest.raises(ValidationError):
            SpeechSynthesisRequest(text="Test", temperature=2.1)

    def test_top_p_validation(self) -> None:
        """top_p must be between 0 and 1."""
        # Valid
        SpeechSynthesisRequest(text="Test", top_p=0.0)
        SpeechSynthesisRequest(text="Test", top_p=1.0)
        
        # Invalid
        with pytest.raises(ValidationError):
            SpeechSynthesisRequest(text="Test", top_p=-0.1)
        
        with pytest.raises(ValidationError):
            SpeechSynthesisRequest(text="Test", top_p=1.1)


# ============================================================================
# SpeechSynthesisResponse Tests
# ============================================================================

class TestSpeechSynthesisResponse:
    """Test SpeechSynthesisResponse schema."""

    def test_response_creation(self) -> None:
        """Response is created with audio data."""
        from app.schemas.speech import SpeechSynthesisResponse
        
        response = SpeechSynthesisResponse(
            audio_base64="base64encodedaudio",
            response_format="wav",
            media_type="audio/wav",
            sample_rate=44100,
        )
        
        assert response.audio_base64 == "base64encodedaudio"
        assert response.response_format == "wav"
        assert response.media_type == "audio/wav"
        assert response.sample_rate == 44100


# ============================================================================
# Default Values Tests
# ============================================================================

class TestSchemaDefaults:
    """Test default values across schemas."""

    def test_generation_defaults(self) -> None:
        """GenerationRequest has sensible defaults."""
        request = GenerationRequest(prompt="Test")
        
        assert request.max_tokens == 512
        assert request.temperature == 0.7
        assert request.top_p == 0.95
        assert request.top_k == 40
        assert request.repeat_penalty == 1.1
        assert request.min_p == 0.05
        assert request.tfs_z == 1.0
        assert request.typical_p == 1.0

    def test_synthesis_defaults(self) -> None:
        """SpeechSynthesisRequest has sensible defaults."""
        request = SpeechSynthesisRequest(text="Test")
        
        assert request.temperature == 0.7
        assert request.chunk_length == 200
        assert request.latency == "normal"
        assert request.speed == 1.0
        assert request.volume == 0.0
        assert request.stream is False


# ============================================================================
# Serialization Round-Trip Tests
# ============================================================================

class TestSerialization:
    """Test schema serialization and deserialization."""

    def test_generation_request_round_trip(self) -> None:
        """GenerationRequest survives round-trip."""
        original = GenerationRequest(
            prompt="Test",
            max_tokens=100,
            temperature=0.5,
            stop=["\n"],
        )
        
        data = original.model_dump()
        restored = GenerationRequest.model_validate(data)
        
        assert restored.prompt == original.prompt
        assert restored.max_tokens == original.max_tokens
        assert restored.temperature == original.temperature
        assert restored.stop == original.stop

    def test_synthesis_request_round_trip(self) -> None:
        """SpeechSynthesisRequest survives round-trip."""
        original = SpeechSynthesisRequest(
            text="Test",
            format="wav",
            sample_rate=44100,
            stream=True,
        )
        
        data = original.model_dump()
        restored = SpeechSynthesisRequest.model_validate(data)
        
        assert restored.text == original.text
        assert restored.format == original.format
        assert restored.sample_rate == original.sample_rate
        assert restored.stream == original.stream

    def test_transcription_response_round_trip(self) -> None:
        """SpeechTranscriptionResponse survives round-trip."""
        original = SpeechTranscriptionResponse(
            text="Hello world",
            language="en",
            segments=[
                SpeechTranscriptionSegment(id=1, start=0.0, end=1.0, text="Hello"),
            ],
        )
        
        data = original.model_dump()
        restored = SpeechTranscriptionResponse.model_validate(data)
        
        assert restored.text == original.text
        assert restored.language == original.language
        assert len(restored.segments) == len(original.segments)
