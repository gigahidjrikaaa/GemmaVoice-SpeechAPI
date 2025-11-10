# 🚀 GemmaVoice Local Setup Guide (GPU Accelerated)

**Complete guide to run a fully local speech API with GPU acceleration**

---

## 📋 Prerequisites

### Hardware Requirements
- NVIDIA GPU with at least 8GB VRAM (recommended: 12GB+)
- CUDA 12.4 compatible GPU (RTX 20xx series or newer)
- 32GB RAM recommended (minimum 16GB)
- 50GB free disk space for models

### Software Requirements
- Docker Engine with NVIDIA Container Runtime
- Docker Compose v2
- Git with Git LFS

---

## 🔧 Part 1: Download OpenAudio-S1-mini Checkpoints

### Option A: Using HuggingFace CLI (Recommended for Large Files)

1. **Install HuggingFace CLI**:
   ```bash
   pip install -U "huggingface_hub[cli]"
   ```

2. **Login with your HuggingFace token** (get token from https://huggingface.co/settings/tokens):
   ```bash
   huggingface-cli login
   # Paste your token when prompted
   ```

3. **Download OpenAudio-S1-mini checkpoints**:
   ```bash
   cd backend
   
   # Download all checkpoint files directly to openaudio-checkpoints/
   huggingface-cli download fishaudio/openaudio-s1-mini \
     --local-dir openaudio-checkpoints \
     --local-dir-use-symlinks False
   
   # This downloads: codec.pth, model.pth, config.json, special_tokens.json, tokenizer.tiktoken
   # Total size: ~9.5GB, may take 15-30 minutes depending on connection
   ```

4. **Verify checkpoint files** (should have these 5 files):
   ```bash
   ls -lh openaudio-checkpoints/
   ```
   
   Expected output:
   ```
   codec.pth              (~1.5GB)
   config.json            (~2KB)
   model.pth              (~8GB)
   special_tokens.json    (~1KB)
   tokenizer.tiktoken     (~3MB)
   ```

### Option B: Using Git Clone with HuggingFace Token

1. **Get your HuggingFace token**:
   - Visit: https://huggingface.co/settings/tokens
   - Create a new token with `read` permissions
   - Copy the token (starts with `hf_...`)

2. **Install Git LFS** (if not already installed):
   ```bash
   # Ubuntu/Debian
   sudo apt-get install git-lfs
   
   # Windows (via winget)
   winget install GitHub.GitLFS
   
   # macOS
   brew install git-lfs
   
   # Initialize
   git lfs install
   ```

3. **Clone with authentication**:
   ```bash
   cd backend
   
   # Option 1: Use token in URL (replace YOUR_TOKEN)
   git clone https://YOUR_TOKEN@huggingface.co/fishaudio/openaudio-s1-mini openaudio-checkpoints-temp
   
   # Option 2: Or configure git credential helper first
   git config --global credential.helper store
   # Then clone normally (will prompt for username and token):
   # Username: your_hf_username
   # Password: hf_YourTokenHere
   git clone https://huggingface.co/fishaudio/openaudio-s1-mini openaudio-checkpoints-temp
   
   # Wait for LFS files to download
   cd openaudio-checkpoints-temp
   git lfs pull
   
   # Copy checkpoint files
   cd ..
   cp openaudio-checkpoints-temp/*.pth openaudio-checkpoints/
   cp openaudio-checkpoints-temp/*.json openaudio-checkpoints/
   cp openaudio-checkpoints-temp/*.tiktoken openaudio-checkpoints/
   
   # Clean up
   rm -rf openaudio-checkpoints-temp
   ```

### Option B: Manual Download from HuggingFace

1. Visit: https://huggingface.co/fishaudio/openaudio-s1-mini/tree/main

2. Download these 5 files directly:
   - `codec.pth`
   - `config.json`
   - `model.pth`
   - `special_tokens.json`
   - `tokenizer.tiktoken`

3. Place all files in `backend/openaudio-checkpoints/`

---

## 🐳 Part 2: Configure and Start Services

### 1. Create Environment File

```bash
cd backend
cp .env.example .env
```

### 2. Edit `.env` File

Open `.env` and configure (the defaults are already set for fully local GPU mode):

```bash
# ============================================================================
# FULLY LOCAL GPU-ACCELERATED CONFIGURATION
# ============================================================================

# Hugging Face token (optional, only for gated/private models)
HUGGING_FACE_HUB_TOKEN=

# Faster-Whisper (Speech-to-Text) - FULLY LOCAL
ENABLE_FASTER_WHISPER=true
FASTER_WHISPER_MODEL_SIZE=base        # Options: tiny, base, small, medium, large-v3
FASTER_WHISPER_DEVICE=cuda            # GPU acceleration
FASTER_WHISPER_COMPUTE_TYPE=float16   # GPU optimal

# OpenAudio (Text-to-Speech) - FULLY LOCAL
OPENAUDIO_API_BASE=http://openaudio:8080
OPENAUDIO_DEFAULT_FORMAT=wav
OPENAUDIO_DEFAULT_NORMALIZE=true

# Security (optional for local testing)
API_KEY_ENABLED=false
RATE_LIMIT_ENABLED=false

# Logging
LOG_LEVEL=INFO
```

**Model Size Recommendations:**
- `tiny` - Fastest, lowest quality (~75MB VRAM, ~1-2s/min audio)
- `base` - **Recommended** - Good balance (~145MB VRAM, ~3-4s/min audio)
- `small` - Better quality (~470MB VRAM, ~5-6s/min audio)
- `medium` - High quality (~1.5GB VRAM, ~10-12s/min audio)
- `large-v3` - Best quality (~3GB VRAM, ~20-25s/min audio)

### 3. Create Docker Network

```bash
docker network create shared_services_network
```

### 4. Build and Start Services

```bash
# From backend directory
docker compose up --build

# Or run in detached mode:
docker compose up --build -d

# View logs:
docker compose logs -f
```

**First-time startup will:**
1. Download Gemma 3 model from HuggingFace (~7GB)
2. Download Faster-Whisper model (~145MB for base model)
3. Load OpenAudio-S1-mini checkpoints from local files
4. Compile models with torch.compile (may take 2-5 minutes)

---

## ✅ Part 3: Verify Services

### 1. Check Service Health

```bash
# Check if containers are running
docker ps

# Expected output:
# CONTAINER ID   IMAGE              STATUS         PORTS                    NAMES
# xxxxxxxxxxxx   backend        Up 2 minutes   0.0.0.0:6666->6666/tcp   gemma_service
# xxxxxxxxxxxx   openaudio          Up 2 minutes   0.0.0.0:8080->8080/tcp   openaudio
```

### 2. Test Gemma Service

```bash
# Health check
curl http://localhost:6666/health

# Text generation
curl -X POST http://localhost:6666/v1/generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Explain quantum computing in simple terms.",
    "max_tokens": 100,
    "temperature": 0.7
  }'
```

### 3. Test OpenAudio Service (Direct)

```bash
# Test TTS directly on OpenAudio container
curl -X POST http://localhost:8080/v1/tts \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello world, this is a test of the OpenAudio text to speech system.",
    "format": "wav"
  }' \
  --output test_speech.wav

# Play the audio (Linux)
aplay test_speech.wav

# Play the audio (macOS)
afplay test_speech.wav

# Play the audio (Windows)
# Use Windows Media Player or: start test_speech.wav
```

### 4. Test Speech-to-Text (Faster-Whisper)

```bash
# Create a test audio file or use an existing one
# Test transcription
curl -X POST http://localhost:6666/v1/speech-to-text \
  -F "file=@your_audio.wav" \
  -F "language=en"
```

### 5. Test Full Dialogue Pipeline (STT → LLM → TTS)

```bash
# Upload audio, get AI response as synthesized speech
curl -X POST http://localhost:6666/v1/dialogue \
  -F "file=@your_audio.wav" \
  -F "instructions=You are a friendly AI assistant." \
  -F "stream_audio=false" \
  | jq -r '.audio_base64' | base64 -d > response.wav

# Play the response
aplay response.wav  # Linux
afplay response.wav # macOS
```

---

## 🎨 Part 4: Test with Frontend Playground

### 1. Setup Frontend

```bash
cd ../frontend
cp .env.example .env
```

### 2. Edit Frontend `.env`

```bash
VITE_API_BASE_URL=http://localhost:6666
VITE_API_KEY=
```

### 3. Start Frontend

```bash
npm install
npm run dev
```

### 4. Open Browser

Navigate to: http://localhost:5173

**Frontend Features:**
- **Generation Panel** - Test text generation with Gemma 3
- **Transcription Panel** - Upload audio files for STT
- **Synthesis Panel** - Convert text to speech
- **Dialogue Panel** - Full STT → LLM → TTS pipeline
- **Settings Panel** - Configure API URL and key at runtime

---

## 🔍 Troubleshooting

### Issue: OpenAudio container fails to start

**Check logs:**
```bash
docker logs openaudio
```

**Common issues:**
1. **Missing checkpoint files** - Verify all 5 files exist in `openaudio-checkpoints/`
2. **Incorrect file structure** - Ensure files are directly in `openaudio-checkpoints/`, not in a subdirectory
3. **CUDA out of memory** - OpenAudio-S1-mini needs ~10GB VRAM. Close other GPU applications.

**Fix:**
```bash
# Stop and remove containers
docker compose down

# Verify checkpoints
ls -lh backend/openaudio-checkpoints/

# Rebuild
docker compose up --build
```

### Issue: Faster-Whisper "CUDA not available" or slow inference

**Check CUDA libraries:**
```bash
docker exec gemma_service python -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}')"
```

**If False:**
1. Verify NVIDIA drivers on host: `nvidia-smi`
2. Check Docker GPU access: `docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi`
3. Rebuild container: `docker compose up --build`

**Switch to CPU mode temporarily:**
Edit `.env`:
```bash
FASTER_WHISPER_DEVICE=cpu
FASTER_WHISPER_COMPUTE_TYPE=int8
```

### Issue: Gemma service crashes or OOM

**Check logs:**
```bash
docker logs gemma_service
```

**Reduce GPU memory usage** - Edit `.env`:
```bash
# In docker-compose.yml, add:
environment:
  - LLM_GPU_LAYERS=30  # Reduce from default -1 (all layers)
  - LLM_CONTEXT_SIZE=16384  # Reduce from 32768
```

### Issue: "Module not found" errors in tests

```bash
# Install dependencies in local environment
cd backend
pip install -r requirements.txt
pytest tests/ -v
```

### Issue: Services start but API calls timeout

**Check if models are loading:**
```bash
# Watch logs during startup
docker compose logs -f gemma_service

# Should see:
# "Downloading model..."
# "Model loaded successfully."
# "Application startup..."
```

**First startup takes 5-10 minutes** for:
- Downloading models
- torch.compile optimization
- GPU warm-up

---

## 📊 Performance Benchmarks

### Expected Performance (RTX 3080 10GB, Base Models)

| Operation | Latency | Notes |
|-----------|---------|-------|
| Text Generation (50 tokens) | ~2-3s | Gemma 3 12B Q4 |
| Speech-to-Text (1 min audio) | ~3-4s | Faster-Whisper base, GPU |
| Text-to-Speech (1 sentence) | ~1-2s | OpenAudio-S1-mini |
| Full Dialogue Pipeline | ~6-10s | STT + LLM + TTS combined |

### VRAM Usage (Typical)

| Component | VRAM | Can Share |
|-----------|------|-----------|
| Gemma 3 12B Q4 | ~7GB | - |
| OpenAudio-S1-mini | ~10GB | With Gemma if 16GB+ VRAM |
| Faster-Whisper base | ~200MB | Yes |
| **Total (separate GPUs)** | ~17GB | Use 2 GPUs if available |
| **Total (single GPU, sequential)** | ~10GB peak | Models load on-demand |

**Optimization for single GPU:**
- Gemma and OpenAudio can't run simultaneously on <16GB VRAM
- Backend manages this by loading/unloading as needed
- Consider running OpenAudio on CPU if needed

---

## 🚀 Next Steps

1. ✅ Services running? Test with `curl` commands above
2. ✅ Frontend working? Open http://localhost:5173
3. ⏭️ Add API authentication - Set `API_KEY_ENABLED=true` in `.env`
4. ⏭️ Enable rate limiting for production
5. ⏭️ Write integration tests - See `IMPLEMENTATION_STATUS.md`
6. ⏭️ Deploy to production - Add HTTPS, monitoring, backups

---

## 📖 API Documentation

Interactive API docs available at:
- Swagger UI: http://localhost:6666/docs
- ReDoc: http://localhost:6666/redoc
- Prometheus metrics: http://localhost:6666/metrics

---

## 🛠️ Development Tips

### Hot-reload development (no Docker)

```bash
# Backend
cd backend
source .venv/bin/activate  # or .venv\Scripts\activate on Windows
uvicorn app.main:app --reload --host 0.0.0.0 --port 6666

# Frontend
cd frontend
npm run dev
```

### Run tests

```bash
cd backend
pytest tests/ -v --cov=app
```

### Update models

```bash
# Clear caches
rm -rf ~/.cache/huggingface/*
rm -rf ~/.cache/whisper/*

# Rebuild
docker compose up --build
```

---

## 📞 Support

- Issues: https://github.com/gigahidjrikaaa/GemmaVoice-SpeechAPI/issues
- Discussions: https://github.com/gigahidjrikaaa/GemmaVoice-SpeechAPI/discussions

**Common questions:**
- Faster-Whisper: https://github.com/SYSTRAN/faster-whisper
- OpenAudio/Fish-Speech: https://github.com/fishaudio/fish-speech
- Gemma models: https://huggingface.co/google/gemma-3-12b-it-qat-q4_0-gguf
