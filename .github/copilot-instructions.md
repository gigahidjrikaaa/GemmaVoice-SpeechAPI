## GemmaVoice (Gemma 3 Speech API) — Copilot instructions

This file gives focused, actionable context for an AI coding agent working in this repo so it can make safe, correct edits quickly.

- Big picture
  - Backend: FastAPI service under `backend/app`. Entrypoint: `app/main.py` — services for LLM, Whisper, and OpenAudio are created during the FastAPI lifespan and stored on `app.state`.
  - Frontend: Vite + React app under `frontend/` used as a test playground for API endpoints (see `frontend/package.json`).
  - Deployment: Docker / Docker Compose in `docker/`. Model checkpoints are kept under `backend/openaudio-checkpoints` and managed with Git LFS.

- Key integration patterns to respect
  - Lifespan-loaded services: LLMService, WhisperService, OpenAudioService are initialised in `app/main.py`. Prefer using the `request.app.state` objects rather than creating new service instances inside handlers.
  - Model loading: `app/services/llm.py` downloads checkpoints via `hf_hub_download` and constructs a `llama_cpp.Llama` instance synchronously; avoid reloading on every request.
  - Async HTTP client: `OpenAudioService` uses an `httpx.AsyncClient` and exposes both blocking and streaming synth APIs (`synthesize` and `synthesize_stream`) — respect retry/backoff and streaming iterator semantics.
  - Security: API key is enforced by `app/security/api_key.py`. WebSocket handlers must call `enforce_websocket_api_key` and `enforce_websocket_rate_limit` before accepting.
  - Rate limiting: the `RateLimiter` is placed on `app.state` and `enforce_rate_limit` and friends are used as dependencies in routers (see `app/api/v1/generation.py`).
  - Streaming contracts: HTTP streaming endpoints emit newline-delimited JSON (e.g., `/v1/generate_stream`) and WebSocket endpoints stream tokens/events — preserve those exact formats when editing.

- Developer workflows (commands you can run)
  - Backend (local, dev):
    - Create venv & install: `python -m venv .venv && source .venv/bin/activate && pip install -r backend/requirements.txt`
    - Run: `uvicorn app.main:app --host 0.0.0.0 --port 6666` (or use Docker Compose below)
  - Backend (Docker Compose): from `docker/` run `docker compose up --build` (check `backend/README.md` for model download steps).
  - Frontend: `cd frontend && cp .env.example .env && npm install && npm run dev` (Vite dev server, defaults to port 5173).
  - Tests: backend: `pytest` (root of repo or `backend/`); frontend: `npm run test` (Vitest).

- Important repo conventions & notes
  - Config via environment and `pydantic-settings`: many behaviours toggle via env vars (see `backend/README.md` for the common list). Avoid hardcoding secrets — use env vars and `get_settings()`.
  - Model and checkpoint handling: LLM model download uses Hugging Face hub tokens and saves to a path loaded by `llama_cpp`. OpenAudio checkpoints must be placed in `backend/openaudio-checkpoints` (Git LFS used).
  - Error handling: llama.cpp errors are surfaced as 500 and guarded with try/except in `generation.py` — keep the same behavior for backward compatibility and tests.
  - Observability: request ID middleware and `/metrics` endpoint exist; do not remove or bypass metrics instrumentation.

- Files to inspect when changing behavior
  - `backend/app/main.py` — service lifecycle and app creation
  - `backend/app/api/v1/generation.py` and `backend/app/api/v1/speech.py` — REST + WebSocket handlers and streaming formats
  - `backend/app/security/api_key.py` — API key enforcement
  - `backend/app/services/*` — LLM, Whisper, OpenAudio service implementations and lifecycle
  - `backend/requirements.txt` and `docker/Dockerfile`/`docker/docker-compose.yml` — dependency and runtime constraints
  - `frontend/package.json` and `frontend/src/*` — frontend playground for manual testing

- Small examples (do this, not that)
  - Do: use `request.app.state.llm_service` to access the model. See `_get_llm_service` in `backend/app/api/v1/generation.py` for the pattern.
  - Do: when adding a WebSocket route, call `await enforce_websocket_api_key(websocket)` and `await enforce_websocket_rate_limit(websocket)` before `await websocket.accept()`.
  - Don't: instantiate a new LLM/OpenAudio client per request — prefer lifecycle-managed services on app.state.

If anything is unclear or you want the instructions expanded (CI, PR checks, or a list of environment variables copied to a single doc), tell me which area to expand and I'll update this file.
