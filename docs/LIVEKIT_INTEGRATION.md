# LiveKit Agents Integration - Phase 1 Summary

This document summarizes the LiveKit Agents integration implemented for GemmaVoice Speech API.

## Overview

Phase 1 implements custom LiveKit plugins that wrap the existing services (Gemma LLM, OpenAudio TTS, Whisper STT) and provides a voice agent infrastructure for real-time voice conversations.

## Backend Components Created

### 1. Custom Plugins (`backend/app/agents/plugins/`)

#### `gemma_llm.py` - Custom LLM Plugin
- **Class**: `GemmaLLM` (extends `llm.LLM`)
- **Purpose**: Wraps the existing `LLMService` (llama.cpp) for LiveKit
- **Features**:
  - Streaming chat completions via `GemmaLLMStream`
  - ChatContext to Gemma prompt format conversion
  - Async iterator wrapping for sync generator
  - Temperature, max_tokens configuration

#### `openaudio_tts.py` - Custom TTS Plugin  
- **Class**: `OpenAudioTTS` (extends `tts.TTS`)
- **Purpose**: Wraps the existing `OpenAudioService` for LiveKit
- **Features**:
  - `OpenAudioChunkedStream` for streaming audio
  - PCM s16le format at 24kHz sample rate
  - Voice reference ID support
  - Async streaming via `synthesize_stream()`

#### `whisper_stt.py` - Custom STT Plugin
- **Class**: `WhisperSTT` (extends `stt.STT`)
- **Purpose**: Wraps the existing `WhisperService` for LiveKit
- **Features**:
  - `WhisperRecognizeStream` for VAD-integrated recognition
  - Batch recognition via `_recognize_impl()`
  - Language detection and confidence scores
  - StreamAdapter pattern for VAD integration

### 2. Voice Agent (`backend/app/agents/voice_agent.py`)
- **Class**: `GemmaVoiceAgent` (extends `Agent`)
- **Purpose**: Orchestrates LLM, TTS, and STT for voice conversations
- **Features**:
  - System prompt configuration
  - Turn detection with interruption handling
  - Pre-connect buffering for low latency
  - Factory function `create_agent_session()`

### 3. Worker Entry Point (`backend/app/agents/worker.py`)
- **Purpose**: Standalone LiveKit worker process
- **Usage**:
  ```bash
  # Development mode
  python -m app.agents.worker dev
  
  # Production mode  
  python -m app.agents.worker start
  ```
- **Features**:
  - Environment-based configuration
  - Request handler for room events
  - Graceful shutdown handling

### 4. Token Endpoint (`backend/app/api/v1/livekit.py`)
- **Endpoints**:
  - `GET /v1/livekit/status` - Check if LiveKit is configured
  - `POST /v1/livekit/token` - Generate user access token
  - `POST /v1/livekit/agent-token` - Generate agent access token
- **Features**:
  - JWT token generation with VideoGrants
  - Configurable TTL (default 24 hours)
  - Room name and participant identity management

### 5. Configuration (`backend/app/config/settings.py`)
New settings added:
```python
livekit_url: Optional[str]         # LiveKit server WebSocket URL
livekit_api_key: Optional[str]     # API key for token generation
livekit_api_secret: Optional[str]  # API secret for token generation
livekit_room_name: str             # Default room name (gemma-voice-room)
livekit_token_ttl: int             # Token TTL in seconds (86400)
```

## Frontend Components Created

### 1. LiveKit Voice Chat (`frontend/src/components/LiveKitVoiceChat.tsx`)
- **Purpose**: React component for LiveKit-based voice conversations
- **Features**:
  - Connection status management
  - Token fetching from backend
  - Room controls (mute/unmute, disconnect)
  - Voice assistant state visualization
  - Audio track rendering via `RoomAudioRenderer`

### 2. Mode Toggle (Updated `VoiceChatPanel.tsx`)
- **Purpose**: Switch between WebSocket and LiveKit connection modes
- **Features**:
  - Connection mode selector (WebSocket / LiveKit)
  - Conditional rendering based on mode
  - Maintains existing WebSocket functionality

## Dependencies Added

### Backend (`backend/requirements.txt`)
```
livekit>=0.17.0
livekit-agents>=0.12.0
livekit-plugins-silero>=0.7.0
```

### Frontend (`frontend/package.json`)
```json
"@livekit/components-react": "^2.6.0",
"livekit-client": "^2.6.0"
```

## Environment Variables Required

```bash
# LiveKit Server Configuration
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-api-secret

# Optional
LIVEKIT_ROOM_NAME=gemma-voice-room
LIVEKIT_TOKEN_TTL=86400
```

## Architecture Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Frontend (React)                             │
│  ┌─────────────────┐    ┌─────────────────────────────────────────┐ │
│  │ VoiceChatPanel  │───▶│ Mode Toggle: WebSocket | LiveKit        │ │
│  └─────────────────┘    └─────────────────────────────────────────┘ │
│           │                              │                           │
│           ▼                              ▼                           │
│  ┌─────────────────┐           ┌─────────────────────┐              │
│  │ WebSocket Mode  │           │ LiveKitVoiceChat    │              │
│  │ (Existing)      │           │ - Token fetch       │              │
│  └─────────────────┘           │ - Room connection   │              │
│                                │ - Audio controls    │              │
│                                └─────────────────────┘              │
└─────────────────────────────────────────────────────────────────────┘
                                       │
                                       │ HTTP/WebSocket
                                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Backend (FastAPI)                            │
│  ┌─────────────────┐    ┌─────────────────────────────────────────┐ │
│  │ /v1/livekit/*   │───▶│ Token Generation (livekit.api)          │ │
│  └─────────────────┘    └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                                       │
                                       │ LiveKit Protocol
                                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    LiveKit Server (SFU)                              │
│  ┌─────────────────┐    ┌─────────────────────────────────────────┐ │
│  │ Room: gemma-... │◀──▶│ Media Routing                           │ │
│  └─────────────────┘    └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
          ▲                           ▲
          │                           │
          │ LiveKit Protocol          │ LiveKit Protocol
          │                           │
          ▼                           ▼
┌─────────────────────┐    ┌─────────────────────────────────────────┐
│ Frontend Client     │    │ Voice Agent Worker                       │
│ (Browser)           │    │ ┌─────────────┐ ┌────────────┐          │
│                     │    │ │ GemmaLLM    │ │ OpenAudio  │          │
│                     │    │ │ Plugin      │ │ TTS Plugin │          │
│                     │    │ └─────────────┘ └────────────┘          │
│                     │    │ ┌─────────────┐                         │
│                     │    │ │ WhisperSTT  │                         │
│                     │    │ │ Plugin      │                         │
│                     │    │ └─────────────┘                         │
│                     │    │        │                                 │
│                     │    │        ▼                                 │
│                     │    │ ┌─────────────────────────────────────┐ │
│                     │    │ │ Existing Services (app.state)       │ │
│                     │    │ │ - LLMService (llama.cpp)            │ │
│                     │    │ │ - OpenAudioService (httpx)          │ │
│                     │    │ │ - WhisperService (faster-whisper)   │ │
│                     │    │ └─────────────────────────────────────┘ │
└─────────────────────┘    └─────────────────────────────────────────┘
```

## Next Steps (Phase 2)

1. **Docker Configuration**: Add LiveKit server container to docker-compose
2. **Worker Integration**: Optionally run worker alongside FastAPI
3. **Testing**: Add unit tests for plugins and endpoints
4. **Documentation**: Update README with LiveKit setup instructions
5. **Production Deployment**: Configure LiveKit Cloud or self-hosted server
