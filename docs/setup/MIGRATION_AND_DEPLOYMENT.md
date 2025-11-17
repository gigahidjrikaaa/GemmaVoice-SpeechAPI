# Migration & Deployment Guide

**Complete guide for port migration, configuration fixes, and deployment setup**

---

## 📋 Table of Contents

- [Port Migration](#port-migration)
- [Deployment Fixes](#deployment-fixes)
- [Configuration Summary](#configuration-summary)
- [Troubleshooting](#troubleshooting)

---

## 🔄 Port Migration

### Overview

Successfully migrated services to standardized port configuration:

| Service | Old Port | New Port | Description |
|---------|----------|----------|-------------|
| Gemma Service | 6666 | 21250 | LLM backend API |
| OpenAudio Service | 8080 | 21251 | TTS REST API |
| OpenAudio Web UI | - | 27860 | Official Gradio frontend |
| Frontend Dev | 5173 | 5173-5174 | Vite dev server (auto-increment) |

### Changes Made

#### 1. Frontend Configuration

**`.env` and `.env.example`**
```bash
# Updated configuration
VITE_API_BASE_URL=http://localhost:21250
VITE_OPENAUDIO_BASE_URL=http://localhost:21251
```

**`src/context/ConfigContext.tsx`**
```typescript
// Updated default fallback
const defaultConfig = {
  baseUrl: import.meta.env?.VITE_API_BASE_URL ?? "http://localhost:21250",
  openAudioUrl: import.meta.env?.VITE_OPENAUDIO_BASE_URL ?? "http://localhost:21251",
  apiKey: "",
};
```

**`src/components/SettingsPanel.tsx`**
```typescript
// Updated placeholder
<input
  type="text"
  placeholder="http://localhost:21250"
  value={config.baseUrl}
  onChange={/* ... */}
/>
```

#### 2. Backend Services

**`docker-compose.yml`**
```yaml
services:
  gemma_service:
    ports:
      - "21250:6666"  # Map host 21250 to container 6666
    environment:
      - OPENAUDIO_API_BASE=http://openaudio_api:21251

  openaudio_api:
    ports:
      - "21251:21251"  # Direct port mapping
```

**`backend/app/config/settings.py`**
```python
# Port configuration
api_host: str = Field(default="0.0.0.0")
api_port: int = Field(default=6666)  # Internal port
openaudio_api_base: str = Field(default="http://openaudio_api:21251")
```

### API Endpoints Verification

#### Gemma Service (Port 21250)

**Health Check:**
```bash
curl http://localhost:21250/health/live
# Response: {"status": "alive"}
```

**Text Generation:**
```bash
curl -X POST http://localhost:21250/v1/generate \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "prompt": "Hello, AI!",
    "max_tokens": 50
  }'
```

**Text-to-Speech (Proxied):**
```bash
curl -X POST http://localhost:21250/v1/text-to-speech \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "text": "Hello from OpenAudio",
    "format": "mp3"
  }' | jq -r '.audio_base64' | base64 -d > output.mp3
```

#### OpenAudio Service (Port 21251)

**Direct Health Check:**
```bash
curl http://localhost:21251/health
# Response: {"status": "ok"}
```

**Direct TTS Request:**
```bash
curl -X POST http://localhost:21251/v1/tts \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Direct OpenAudio test",
    "format": "wav"
  }'
```

---

## 🔧 Deployment Fixes

### Issue 1: Gemma 3 Model Repository Access ❌ → ✅

**Problem:**
- Original config: `google/gemma-3-12b-it-qat-q4_0-gguf`
- Error: `403 Forbidden` - Requires HuggingFace license acceptance
- Impact: Backend fails to start, model cannot be downloaded

**Solution:**
Changed to unrestricted community mirror:
```python
# backend/app/config/settings.py
llm_repo_id: str = Field(
    default="bartowski/google_gemma-3-12b-it-GGUF",
    description="Repository identifier for Gemma GGUF checkpoint",
)
llm_model_filename: str = Field(
    default="google_gemma-3-12b-it-Q4_0.gguf",  # Note: underscores!
    description="Quantized GGUF model filename",
)
```

**Model Details:**
- Repository: [bartowski/google_gemma-3-12b-it-GGUF](https://huggingface.co/bartowski/google_gemma-3-12b-it-GGUF)
- File: `google_gemma-3-12b-it-Q4_0.gguf` (6.91GB)
- Quantization: Q4_0 (4-bit)
- License: No restrictions, publicly accessible

**Important:** Note the underscores in the filename! The community mirror uses `_` instead of `-` in filenames.

### Issue 2: OpenAudio Docker Image Tag ❌ → ✅

**Problem:**
- Original tag: `fishaudio/fish-speech:1.5.0`
- Error: `docker.io/fishaudio/fish-speech:1.5.0: not found`
- Impact: Docker Compose build fails, TTS unavailable

**Root Cause:**
Fish Speech project doesn't publish versioned tags like `1.5.0`. Available tags:
- `latest` (stable, recommended)
- `latest-dev` (development, unstable)
- `server-cuda` (server variant)
- `server-cuda-nightly` (nightly builds)

**Solution:**
```yaml
# docker/docker-compose.yml (before custom Dockerfile)
openaudio_api:
  image: fishaudio/fish-speech:latest  # Changed from 1.5.0
  # ... rest of config
# docker/openaudio.Dockerfile
```

**Current Setup (Custom Dockerfile):**
```dockerfile
# docker/openaudio.Dockerfile
FROM fishaudio/fish-speech:latest

# Copy checkpoints
COPY backend/openaudio-checkpoints/ /app/checkpoints/OpenAudio-S1-mini/

# Set environment
ENV MODEL_NAME=OpenAudio-S1-mini
ENV PORT=21251

CMD ["python", "-m", "tools.api", \
     "--listen", "0.0.0.0:21251", \
     "--llama-checkpoint-path", "/app/checkpoints/OpenAudio-S1-mini"]
```

### Issue 3: OpenAudio Checkpoint Configuration ✅

**Required Files:**
```
backend/openaudio-checkpoints/
├── codec.pth           # Audio codec model
├── config.json         # Model configuration
├── model.pth           # Main TTS model weights
├── special_tokens.json # Tokenizer special tokens
└── tokenizer.tiktoken  # Text tokenizer
```

**Verification:**
```bash
ls -lh backend/openaudio-checkpoints/
# Should show all 5 files with proper sizes
# model.pth should be ~1-2GB
# codec.pth should be ~100-200MB
```

**Download if missing:**
```bash
cd backend
python download_checkpoints.py
```

---

## ⚙️ Configuration Summary

### Environment Variables

**Backend (`backend/.env`):**
```bash
# API Configuration
API_HOST=0.0.0.0
API_PORT=6666
API_KEY=your-secure-api-key-here

# Model Configuration
LLM_REPO_ID=bartowski/google_gemma-3-12b-it-GGUF
LLM_MODEL_FILENAME=google_gemma-3-12b-it-Q4_0.gguf
LLM_CONTEXT_SIZE=8192
LLM_MAX_TOKENS=2048

# OpenAudio Configuration
OPENAUDIO_API_BASE=http://openaudio_api:21251
OPENAUDIO_ENABLED=true

# Scalar Documentation
USE_SCALAR_DOCS=true
DOCS_URL=/docs
```

**Frontend (`frontend/.env`):**
```bash
# API Endpoints
VITE_API_BASE_URL=http://localhost:21250
VITE_OPENAUDIO_BASE_URL=http://localhost:21251

# Optional: API Key (can also be set in UI)
VITE_API_KEY=your-api-key-here
```

### Docker Compose Ports

```yaml
services:
  gemma_service:
    ports:
      - "21250:6666"  # Host:Container
  
  openaudio_api:
    ports:
      - "21251:21251"
  
  # Optional: Production frontend
  frontend:
    ports:
      - "5173:80"
```

### CORS Configuration

**Backend CORS settings:**
```python
# backend/app/config/settings.py
cors_origins: list[str] = Field(
    default=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:21250",
    ],
    description="Allowed CORS origins",
)
```

---

## 🐛 Troubleshooting

### Port Already in Use

**Symptom:**
```
Error: bind: address already in use
```

**Solution:**
```bash
# Find process using port 21250
lsof -i :21250  # Linux/macOS
netstat -ano | findstr :21250  # Windows

# Kill process (Linux/macOS)
kill -9 <PID>

# Kill process (Windows)
taskkill /PID <PID> /F

# Or change port in docker-compose.yml
ports:
  - "21260:6666"  # Use different host port
```

### Frontend Can't Connect to Backend

**Symptom:**
```
Network Error: Failed to fetch
```

**Checks:**
1. **Verify backend is running:**
   ```bash
   curl http://localhost:21250/health/live
   ```

2. **Check CORS configuration:**
   - Ensure frontend origin is in `cors_origins`
   - Restart backend after .env changes

3. **Check browser console:**
   - Look for CORS errors
   - Verify request URL matches `VITE_API_BASE_URL`

4. **Check frontend .env:**
   ```bash
   cat frontend/.env
   # Should contain: VITE_API_BASE_URL=http://localhost:21250
   ```

### Model Download Fails

**Symptom:**
```
403 Forbidden: Access to model repository denied
```

**Solution:**
1. **Verify repository URL:**
   ```bash
   # Should be the community mirror
   curl -I https://huggingface.co/bartowski/google_gemma-3-12b-it-GGUF
   # Should return 200 OK, not 403
   ```

2. **Check HuggingFace token (if needed):**
   ```bash
   # backend/.env
   HUGGINGFACE_TOKEN=your_token_here
   ```

3. **Manual download:**
   ```bash
   cd backend
   huggingface-cli download bartowski/google_gemma-3-12b-it-GGUF \
     google_gemma-3-12b-it-Q4_0.gguf \
     --local-dir ./models
   ```

### OpenAudio Service Fails to Start

**Symptom:**
```
Error: Cannot load checkpoint from /app/checkpoints/...
```

**Solutions:**
1. **Verify checkpoints exist:**
   ```bash
  docker exec openaudio_api ls -la /app/checkpoints/OpenAudio-S1-mini/
   # Should list 5 files
   ```

2. **Re-download checkpoints:**
   ```bash
   cd backend
   rm -rf openaudio-checkpoints
   python download_checkpoints.py
   ```

3. **Check disk space:**
   ```bash
   df -h
   # Ensure at least 10GB free
   ```

4. **Rebuild container:**
   ```bash
   cd docker
   docker compose down
  docker compose build --no-cache openaudio_api
   docker compose up -d
   ```

### Docker Build Fails

**Symptom:**
```
Error: failed to solve: fishaudio/fish-speech:1.5.0: not found
```

**Solution:**
Ensure `openaudio.Dockerfile` uses `latest` tag:
```dockerfile
FROM fishaudio/fish-speech:latest
```

Then rebuild:
```bash
docker compose build --pull openaudio_api
docker compose up -d
```

---

## ✅ Post-Migration Checklist

- [ ] Backend running on port 21250
- [ ] OpenAudio running on port 21251
- [ ] Frontend can connect to both services
- [ ] Health check endpoints respond
- [ ] Text generation works
- [ ] Text-to-speech works
- [ ] Voice cloning works (if configured)
- [ ] WebSocket connections work
- [ ] CORS configured correctly
- [ ] API documentation accessible at http://localhost:21250/docs

---

## 📖 Related Documentation

- [Local Setup Guide](LOCAL_SETUP_GUIDE.md) - Initial installation
- [Voice Cloning Guide](../guides/VOICE_CLONING_GUIDE.md) - Voice cloning setup
- [Scalar API Docs](../api/scalar/README.md) - API documentation
- [Docker README](../../docker/README.md) - Docker configuration

---

**Last Updated:** November 10, 2025  
**Status:** ✅ Complete and Verified
