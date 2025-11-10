# GemmaVoice Speech API

**Fully local GPU-accelerated speech API with Gemma 3, Faster-Whisper, and OpenAudio-S1-mini**

[![CI/CD](https://github.com/gigahidjrikaaa/GemmaVoice-SpeechAPI/actions/workflows/backend-ci-cd.yml/badge.svg)](https://github.com/gigahidjrikaaa/GemmaVoice-SpeechAPI/actions)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Complete speech pipeline combining:
- 🤖 **LLM**: Gemma 3 12B (via llama-cpp-python)
- 🎤 **STT**: Faster-Whisper (CTranslate2 with GPU)
- 🔊 **TTS**: OpenAudio-S1-mini (Fish-speech)

---

## 📚 Documentation

**[📖 Complete Documentation Index](docs/README.md)** - Start here for all guides and references

### Quick Links

#### 🚀 Getting Started
- **[Local Setup Guide](docs/setup/LOCAL_SETUP_GUIDE.md)** - Complete development setup
- **[Migration & Deployment](docs/setup/MIGRATION_AND_DEPLOYMENT.md)** - Port configuration and deployment fixes
- **[GPU Configuration](backend/GPU_SETUP.md)** - Windows/WSL GPU setup

#### 📖 API Documentation
- **[Interactive API Docs](http://localhost:21250/docs)** - Scalar documentation (after starting services)
- **[Scalar Setup Guide](docs/scalar/SETUP.md)** - Get Scalar running
- **[OpenAPI Specification](docs/scalar/openapi.yaml)** - Complete API reference

#### 🎤 Features & Guides
- **[Voice Cloning Guide](docs/guides/VOICE_CLONING_GUIDE.md)** - Custom voice references for Bahasa Indonesia
- **[Frontend Enhancements](docs/FRONTEND_ENHANCEMENTS.md)** - Error logging and UI improvements
- **[Live Conversation Guide](frontend/LIVE_CONVERSATION_GUIDE.md)** - Real-time conversation features

#### 🚢 Production & Operations
- **[CI/CD Setup](deploy/README.md)** - Production deployment with GitHub Actions
- **[Docker Configuration](docker/README.md)** - Container setup and troubleshooting

---

## Scalar API reference

Interactive API documentation is maintained under [`docs/scalar`](docs/scalar). Use the
[Scalar CLI](https://github.com/scalar/scalar) to preview the full OpenAPI 3.1 contract that
covers the text, speech, and dialogue endpoints:

```bash
scalar preview docs/scalar/openapi.yaml
```

The generated reference includes concrete parameter examples for every route so testers can copy
requests directly into their automation suites.

## Frontend playground

The repository now includes a Vite + React SPA under [`frontend/`](frontend/) for manual testing of the
text generation, speech-to-text, text-to-speech, and dialogue APIs. To run it locally:

```bash
cd frontend
cp .env.example .env   # set VITE_API_BASE_URL to your FastAPI deployment
npm install
npm run dev
```

The app defaults to `http://localhost:8000` but you can override the base URL and API key from the
"Connection settings" drawer in the UI. Build artifacts are emitted to `frontend/dist` via
`npm run build` and can be hosted on any static site provider or mounted behind the FastAPI service.

## Speech Stack Roadmap

The team is extending the text-only Gemma 3 API into a speech-capable platform powered by OpenAI Whisper for speech-to-text (STT) and OpenAudio-S1-mini for text-to-speech (TTS). The roadmap below focuses on compatibility with the upstream projects and our existing FastAPI/Docker deployment.

### Phase 0 — Technical due diligence

1. **Repository alignment**
   - Track the upstream release branches for [OpenAI Whisper](https://github.com/openai/whisper) and [Fish Audio / OpenAudio](https://github.com/fishaudio/fish-speech) to understand Python version requirements and CUDA expectations.
   - Decide whether Whisper will run through the `openai` client (managed service) or via local inference (`pip install -U openai-whisper`) to simplify dependency management inside our container.
   - Validate that Fish Audio’s server and model checkpoints can be installed directly in our base image, noting PyTorch + torchaudio requirements and GPU memory expectations for OpenAudio-S1-mini.
2. **Container baseline updates**
   - Extend the Docker image with FFmpeg (via `apt-get install ffmpeg`) and audio codecs required by Whisper and OpenAudio examples.
   - Confirm CUDA toolkit/library compatibility between Whisper, OpenAudio, and the existing Gemma runtime to avoid conflicting `torch` builds.

### Phase 1 — Application scaffolding

1. **Service decomposition**
   - Refactor `backend/app/main.py` into a modular layout (`app/services`, `app/api`, `app/config`) so the speech services can share FastAPI lifespan hooks with the current LLM loader without repeated initialization.
   - Define Pydantic models for audio payloads (binary uploads, base64 JSON envelopes, and WebSocket frames) plus transcript/voice settings.
2. **Configuration and secrets**
   - Introduce `pydantic-settings` for managing OpenAI API keys, OpenAudio authentication (token, Hugging Face access if running local checkpoints), default sample rates, and feature flags.
   - Add schema validation for environment variables so misconfigured GPU IDs, missing checkpoints, or absent API keys fail fast at startup.

### Phase 2 — STT integration with Faster Whisper

1. **Local inference path**
   - Package Faster Whisper as a callable service that loads the desired model tier (`base`, `large-v3`, or the faster `tiny.en`) once during lifespan startup, exposing async helpers that offload CPU-heavy work with `asyncio.to_thread` to retain non-blocking FastAPI handlers.
   - Provide preprocessing utilities that normalize audio to 16 kHz mono PCM using `soundfile`/`torchaudio`, mirroring Whisper’s reference scripts for compatibility.
   - Support both file uploads and streaming (chunk assembly plus VAD-driven segmentation) so we can reuse the service for REST and WebSocket routes.
2. **Managed API fallback**
   - Implement an adapter for OpenAI’s hosted Whisper (`client.audio.transcriptions.create`) with retry/backoff logic and consistent response schemas, so deployments without GPUs can switch via configuration.

### Phase 3 — TTS integration with OpenAudio-S1-mini

1. **Model loading**
   - Vendor or download the `fishaudio/OpenAudio-S1-mini` checkpoint during container build, or allow runtime fetch from Hugging Face with cached volumes to respect licensing.
   - Initialize the Fish Audio API server once per process, making device placement configurable (`cuda:{id}` vs. CPU fallback for development) and preloading reference embeddings when samples are provided.
2. **Synthesis services**
   - Offer both blocking synthesis endpoints returning `audio/wav` via `StreamingResponse` and streaming synthesis over WebSocket using chunked PCM/Opus packets assembled from the server response.
   - Implement guardrails for maximum token/audio duration, reference validation, and automatic sample-rate conversion to match client expectations.

### Phase 4 — Conversational orchestration

1. **Pipeline coordinator**
   - Build an orchestration layer that chains STT → Gemma LLM → TTS with structured metadata (timestamps, confidences, latencies) and configurable prompt templates per modality.
   - Support memory persistence (in Redis or an in-process store) keyed by session IDs so dialogue context flows through the pipeline.
2. **API design**
   - Add REST endpoints `/v1/speech-to-text`, `/v1/text-to-speech`, and `/v1/dialogue`, plus WebSocket channels for live transcription (`/ws/stt`) and synthesis (`/ws/tts`).
   - Provide consistent error envelopes and partial-result streaming semantics so clients can degrade gracefully (e.g., text-only fallback when OpenAudio synthesis fails).

### Phase 5 — Reliability, testing, and documentation

1. **Observability**
   - Extend structured logging to include audio payload metadata, stage-level latency metrics, and GPU utilization snapshots. Wire metrics into Prometheus/Grafana if available.
2. **Testing strategy**
   - Create unit tests that mock Whisper/OpenAudio clients, contract tests for the new FastAPI routes (using `httpx.AsyncClient`), and end-to-end smoke tests with small audio fixtures executed under `pytest -m e2e`.
   - Add load-test scripts (Locust/K6) to validate concurrent streaming sessions and ensure GPU memory usage stays within safe thresholds.
3. **Operational playbooks**
   - Document new environment variables, Docker volume mounts for Hugging Face caches, and emergency procedures (e.g., clearing stuck GPU contexts, rotating API keys).
   - Provide sample client snippets (Python/JavaScript) demonstrating batch uploads and WebSocket streaming to accelerate integration by downstream teams.

---

## Phase 2 Implementation Snapshot — Whisper & OpenAudio Services

The FastAPI application now ships with production-ready service wrappers for OpenAI Whisper (speech-to-text) and the OpenAudio-S1-mini API server (text-to-speech). These components are initialised during the application lifespan and exposed through dedicated `/v1/speech` routes.

### Configuration

Set the following environment variables (or update `.env`) to enable the integrations:

| Variable | Description |
| --- | --- |
| `OPENAI_API_KEY` | Required when using the hosted Whisper API. |
| `OPENAI_API_BASE` | Optional override for the OpenAI endpoint (proxies/self-hosted gateways). |
| `OPENAI_WHISPER_MODEL` | Whisper-compatible model to invoke, defaults to `gpt-4o-mini-transcribe`. |
| `OPENAI_WHISPER_RESPONSE_FORMAT` | Response format (e.g. `verbose_json`, `json`, `srt`). |
| `ENABLE_FASTER_WHISPER` | Set to `true` to run the open-source Faster Whisper locally; ensure `pip install -U faster-whisper` is included in requirements. |
| `FASTER_WHISPER_MODEL_SIZE` | Model size used when running Faster Whisper locally (e.g. `tiny`, `base`, `large-v3`). |
| `FASTER_WHISPER_DEVICE` | Device to use for Faster Whisper inference (e.g. `cpu`, `cuda`). |
| `FASTER_WHISPER_COMPUTE_TYPE` | Compute type for Faster Whisper inference (e.g. `int8`, `float16`, `float32`). |
| `OPENAUDIO_API_BASE` | Base URL for the OpenAudio deployment (defaults to `http://localhost:8080`). |
| `OPENAUDIO_API_KEY` | Bearer token forwarded to OpenAudio when authentication is required. |
| `OPENAUDIO_TTS_PATH` | Path to the OpenAudio synthesis endpoint (defaults to `/v1/tts`). |
| `OPENAUDIO_DEFAULT_FORMAT` | Default audio container (`wav`, `mp3`, etc.). |
| `OPENAUDIO_DEFAULT_REFERENCE_ID` | Reference identifier requested when none is supplied by the client. |
| `OPENAUDIO_DEFAULT_NORMALIZE` | Whether to request loudness normalisation by default. |
| `OPENAUDIO_TIMEOUT_SECONDS` | Timeout applied to OpenAudio requests. |
| `OPENAUDIO_MAX_RETRIES` | Retry attempts for transient OpenAudio failures. |
| `DEFAULT_AUDIO_SAMPLE_RATE` | Sample rate (Hz) assumed for both Whisper preprocessing and OpenAudio output. |

### REST endpoints

1. **`POST /v1/speech-to-text`** — accepts multipart form uploads under the `file` field and streams the payload through Whisper. Optional form fields: `language`, `prompt`, `response_format`, `temperature`.

   ```bash
   curl -X POST "http://localhost:6666/v1/speech-to-text" \
     -H "Authorization: Bearer $OPENAI_API_KEY" \
     -F "file=@sample.wav" \
     -F "language=en" | jq
   ```

2. **`POST /v1/text-to-speech`** — accepts JSON matching the `SpeechSynthesisRequest` schema and returns either base64 audio or a streaming response when `"stream": true`.

   ```bash
   curl -X POST "http://localhost:6666/v1/text-to-speech" \
     -H "Content-Type: application/json" \
     -d '{
       "text": "Today is a wonderful day to build something people love!",
       "format": "wav",
       "reference_id": "default"
     }' | jq -r '.audio_base64' | base64 --decode > speech.wav
   ```

   To stream directly to a file:

   ```bash
   curl -X POST "http://localhost:6666/v1/text-to-speech" \
     -H "Content-Type: application/json" \
     -d '{
       "text": "Welcome to the OpenAudio powered API!",
       "stream": true,
       "format": "wav"
     }' --output speech.wav
   ```

### Service lifecycle

- `app.services.whisper.WhisperService` lazily loads the requested Whisper backend (remote or local `faster-whisper`) and exposes a unified transcription interface used by the API router.
- `app.services.openaudio.OpenAudioService` manages an `httpx.AsyncClient`, performs retries for transient network issues, and supports both blocking and streaming synthesis flows.
- Both services are initialised in `app/main.py` alongside the existing Gemma 3 LLM service and are stored on `app.state` for reuse across requests.

## Phase 4 Implementation Snapshot — Observability, Security & Quality

Recent changes harden the platform for production operations:

- Structured logging with request identifiers via a middleware that also records latency metrics for each HTTP request.
- Prometheus-compatible metrics exposed on `/metrics`, including histograms for HTTP requests, external dependencies (Whisper, OpenAudio, Gemma), and end-to-end dialogue orchestration.
- Configurable API key enforcement applied to REST endpoints and validated during WebSocket handshakes.
- Expanded configuration options for log level, request ID propagation, and API key management backed by `pydantic-settings` parsing.
- Automated tests (run with `pytest`) covering the conversation service helpers and API key guardrails.

### New configuration knobs

| Variable | Description |
| --- | --- |
| `LOG_LEVEL` | Controls structured logging verbosity (defaults to `INFO`). |
| `REQUEST_ID_HEADER` | Response header that carries the request identifier (defaults to `X-Request-ID`). |
| `API_KEY_ENABLED` | Enables API key authentication for REST and WebSocket routes. |
| `API_KEY_HEADER_NAME` | Header inspected for API keys (defaults to `X-API-Key`). |
| `API_KEYS` | Comma-separated list of valid API keys. |

### Operational reminders

- Scrape the `/metrics` endpoint from Prometheus to monitor request latency and speech pipeline timings.
- Rotate API keys by updating the `API_KEYS` environment variable and reloading the service.
- Run `pytest` locally or in CI to exercise the new quality gates before deployment.

---

## 1. Host Machine Prerequisites

This service is designed to run within a Docker container but relies on host-level hardware support. Before you begin, ensure the following are installed and correctly configured on the host machine.

1.  **NVIDIA Drivers:** The host must have the correct proprietary NVIDIA drivers installed.
    * **Verification:**
        ```bash
        nvidia-smi
        ```
        This command should successfully display information about the installed GPUs (Tesla P40, Quadro M4000) without errors.

2.  **Docker Engine:** The containerization platform.
    * **Verification:**
        ```bash
        docker --version
        ```

3.  **NVIDIA Container Toolkit:** The bridge that allows Docker containers to access the host's GPUs.
    * **Verification:** This command runs a temporary container and asks it to execute `nvidia-smi`. A successful run confirms the toolkit is correctly configured.
        ```bash
        sudo docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi
        ```

---

## 2. Running with Docker Compose



**Prerequisite: Install Git LFS**



This repository uses [Git LFS](https://git-lfs.github.com/) to manage large model files. Before you can run the application, you need to install Git LFS on your system. You can find installation instructions on the [Git LFS website](https://git-lfs.github.com/).



The entire application stack, including the `backend` service and the `openaudio` TTS service, is managed via Docker Compose. This is the recommended way to run the application for both development and production.



**A. Download Model Weights**



Before starting the services, you need to download the OpenAudio-S1-mini model weights from Hugging Face.



1.  Create a directory for the model weights:



    ```bash

    mkdir -p backend/openaudio-checkpoints

    ```



2.  Download the model weights from the [OpenAudio-S1-mini Hugging Face repository](https://huggingface.co/fishaudio/OpenAudio-S1-mini) and place them in the `backend/openaudio-checkpoints` directory.



**B. Start the Services**



From the `docker/` directory, run:



```bash

docker-compose up --build -d

```



This command will build the `backend` image, pull the `fishaudio/fish-speech` image, and start both services in detached mode.



**C. Stop the Services**



To stop the services, run:



```bash

docker-compose down

```

Key Flags:

-d or --detach: Runs the container in the background.

--restart always: A powerful policy that makes the container a persistent service.

4. Managing the Live Service
Once the service is running in detached mode, use these standard Docker commands to manage its lifecycle.

Check Status of Running Containers:

```bash
docker ps
```

View Service Logs (Most Important):
This is how you monitor the API server's output in the background.

```bash
# View a snapshot of the most recent logs
docker logs gemma_service

# Follow the logs live (similar to `tail -f`). Press Ctrl+C to exit.
docker logs -f gemma_service
```

Stop the Service:

```bash
docker stop gemma_service

Start a Stopped Service:

docker start gemma_service
```

Permanently Remove the Service:
You must stop the container before you can remove it.

```bash
docker stop gemma_service
docker rm gemma_service
```

5. Testing the API
With the service running, you can test its endpoints from the host machine's command line using curl.

A. Health Check
This is the quickest way to verify that the API server is up and responsive.

```bash
curl http://localhost:6666/health
```

Expected Output: {"status":"ok"}

B. Full Inference Test
This sends a real prompt to the model to verify the entire end-to-end functionality.

```bash
curl -X POST http://localhost:6666/v1/generate \
-H "Content-Type: application/json" \
-d '{
  "prompt": "What is the significance of the GGUF model format in the local LLM community?",
  "max_tokens": 256
}'
```

Expected Output: A JSON object containing the model's generated text, for example: {"generated_text":"The GGUF (GPT-Generated Unified Format) model format is highly significant..."}.

6. Standard Update Procedure
To deploy new code or dependency changes, follow this three-step "rebuild and replace" process for a clean update.

Build the new image version with your changes:

```bash
docker build --build-arg UID=$(id -u) --build-arg GID=$(id -g) -t backend .
```

Stop and remove the old running container:

```bash
docker stop gemma_service
docker rm gemma_service
```

Start a new container using the freshly built image:
(Use the production run command from Section 3B)

```bash
docker run -d --restart always --gpus all -p 6666:6666 ... backend
```
