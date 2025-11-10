# Frontend API Integration Guide

This frontend playground tests all three AI services in the GemmaVoice Speech API:

## Service Endpoints

### 1. Text Generation (Gemma 3 LLM)
**Component**: `GenerationPanel.tsx`

**REST Endpoints**:
- `POST /v1/generate` - Single generation
- `POST /v1/generate_stream` - Streaming generation

**Request**:
```json
{
  "prompt": "Hello!",
  "max_output_tokens": 256,
  "temperature": 0.7,
  "top_p": 0.95,
  "top_k": 40
}
```

**Response**:
```json
{
  "id": "req-xxx",
  "output": "Generated text...",
  "metadata": {}
}
```

---

### 2. Speech-to-Text (Faster-Whisper)
**Component**: `TranscriptionPanel.tsx`

**REST Endpoint**:
- `POST /v1/speech-to-text` - Transcribe audio file

**Request** (multipart/form-data):
- `file`: Audio file (wav, mp3, m4a, etc.)
- `model`: "whisper-large-v3" (default)
- `response_format`: "json" | "text" | "verbose_json"
- `temperature`: 0-1 (default: 0)

**Response**:
```json
{
  "text": "Transcribed text",
  "language": "en",
  "segments": [
    {
      "start": 0.0,
      "end": 2.5,
      "text": "Segment text"
    }
  ]
}
```

---

### 3. Text-to-Speech (OpenAudio-S1-mini)
**Component**: `SynthesisPanel.tsx`

**REST Endpoints**:
- `POST /v1/text-to-speech` - Generate audio (base64)
- `POST /v1/text-to-speech/stream` - Stream audio chunks

**Request**:
```json
{
  "text": "Hello world!",
  "reference_id": "default_speaker",
  "reference_audio_base64": null,
  "reference_text": null,
  "max_new_tokens": 1024,
  "chunk_length": 150,
  "top_p": 0.7,
  "repetition_penalty": 1.2,
  "temperature": 0.7,
  "normalize": false
}
```

**Response**:
```json
{
  "audio_base64": "UklGRiQAAABXQVZF...",
  "sample_rate": 44100,
  "duration": 2.5
}
```

---

### 4. Dialogue Pipeline (Speech → LLM → Speech)
**Component**: `DialoguePanel.tsx`

**REST Endpoints**:
- `POST /v1/dialogue` - Full dialogue pipeline

**Request** (multipart/form-data):
- `audio`: User audio file
- `instructions`: System prompt for LLM
- `stream_audio`: boolean (stream assistant speech)

**Response**:
```json
{
  "transcript": "User said...",
  "assistant_text": "Assistant response",
  "audio_base64": "UklGRiQAAABXQVZF...",
  "metadata": {
    "transcription_time": 0.5,
    "generation_time": 1.2,
    "synthesis_time": 0.8
  }
}
```

---

## Configuration

The frontend uses `ConfigContext` to manage:
- **Base URL**: Default `http://localhost:6666`
- **API Key**: Optional (set `API_KEY_ENABLED=true` in backend)
- **Streaming Mode**: "rest" or "websocket"

Settings are persisted in `localStorage` and can be changed via the Settings panel.

---

## Testing Flow

1. **Text Generation**: Test Gemma 3 LLM with various prompts and parameters
2. **Speech-to-Text**: Upload audio files to test Whisper transcription
3. **Text-to-Speech**: Generate speech from text with voice cloning options
4. **Dialogue**: Test the full pipeline (speak → transcribe → generate → synthesize)

---

## Health Checks

All services can be monitored via:
- `GET /health` - Overall system health
- `GET /health/llm` - Gemma 3 status
- `GET /health/stt` - Whisper status
- `GET /health/tts` - OpenAudio status
- `GET /health/ready` - Readiness probe
- `GET /health/live` - Liveness probe
