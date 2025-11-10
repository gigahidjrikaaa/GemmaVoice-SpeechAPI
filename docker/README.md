# Docker Configuration

This directory contains all Docker-related files for the GemmaVoice Speech API project.

## 📁 Directory Contents

```
docker/
├── Dockerfile                      # Backend API (FastAPI + Gemma LLM + Faster-Whisper)
├── docker-compose.yml              # Base compose (local development with GPU)
├── docker-compose.cpu.yml          # CPU-only mode (no GPU required)
├── docker-compose.prod.yml         # Production configuration
├── docker-compose.test.yml         # Integration testing
└── docker-compose.monitoring.yml   # Observability stack (Prometheus, Grafana, Loki)
```

**Note:** The `openaudio.Dockerfile` has been removed. OpenAudio now uses the official `fishaudio/fish-speech` Docker images.

## 🚀 Quick Start

### Local Development (GPU)

```bash
cd docker/
docker compose up --build -d
```

### Local Development (CPU only)

```bash
cd docker/
docker compose -f docker-compose.cpu.yml up --build -d
```

### Production Deployment

```bash
cd docker/
docker compose -f docker-compose.prod.yml up -d
```

### With Monitoring Stack

```bash
cd docker/
docker compose -f docker-compose.prod.yml -f docker-compose.monitoring.yml up -d
```

## 📋 Configuration Files

### `Dockerfile`

- Multi-stage build for backend API
- Base: NVIDIA CUDA 12.4.1 with cuDNN
- Runtime: Python 3.11, llama-cpp-python with CUDA support, Faster-Whisper
- Non-root user for security
- Prebuilt llama-cpp-python wheel for faster builds

### OpenAudio Service

- **Architecture:** Uses official `fishaudio/fish-speech` Docker images
- **Images:** 
  - GPU: `fishaudio/fish-speech:server-cuda`
  - CPU: `fishaudio/fish-speech:server-cpu`
- **Checkpoints:** Mounted from `backend/openaudio-checkpoints/`
- **Setup:** See [Voice Cloning Guide](../backend/VOICE_CLONING_GUIDE.md)
- **Benefits:** 
  - No custom build required
  - All dependencies pre-installed
  - Official support from Fish Audio team
  - Automatic environment setup via entrypoint

### `docker-compose.yml`

- **Purpose:** Local development with GPU acceleration
- **Services:** gemma_service, openaudio
- **GPU:** Enabled for both services
- **Ports:** 6666 (API), 8080 (TTS)

### `docker-compose.cpu.yml`

- **Purpose:** CPU-only mode for systems without GPU
- **GPU:** Disabled
- **Compute:** Faster-Whisper uses int8 quantization for CPU
- **Use case:** Windows/WSL without NVIDIA drivers

### `docker-compose.prod.yml`

- **Purpose:** Production deployment via CI/CD
- **Images:** Pre-built from GitHub Container Registry (backend), official Fish-Speech (OpenAudio)
- **Features:** Resource limits, health checks, logging, persistent volumes
- **Security:** API keys, rate limiting enabled

### `docker-compose.test.yml`

- **Purpose:** Integration testing in CI/CD
- **Features:** Mock services, test-specific config, isolated network
- **Usage:** `pytest backend/tests/integration/`

### `docker-compose.monitoring.yml`

- **Purpose:** Observability stack
- **Services:** Prometheus, Grafana, Loki, Promtail, Node Exporter, cAdvisor
- **Dashboards:** Metrics, logs, alerts
- **See:** [Security & Monitoring Guide](../SECURITY_MONITORING_GUIDE.md)

## 🔧 Build Contexts

All Docker Compose files use relative paths from the `docker/` directory:

```yaml
services:
  gemma_service:
    build:
      context: ../backend      # Application code
      dockerfile: ../docker/Dockerfile  # Build instructions
```

This structure allows:
- ✅ Clean separation of concerns
- ✅ Single source of truth for Docker configs
- ✅ Easy comparison between environments
- ✅ Model-agnostic naming (backend, not gemma-3-api)

## 🛠️ Common Commands

### View Logs
```bash
cd docker/
docker compose logs -f
docker compose logs -f gemma_service
docker compose logs -f openaudio
```

### Restart Services
```bash
cd docker/
docker compose restart
docker compose restart gemma_service
```

### Stop Services
```bash
cd docker/
docker compose down
docker compose down -v  # Remove volumes too
```

### Rebuild After Code Changes
```bash
cd docker/
docker compose up --build -d
```

### Check Service Status
```bash
cd docker/
docker compose ps
```

## 📊 Resource Requirements

### GPU Mode (Recommended)
- **GPU:** NVIDIA GPU with 8GB+ VRAM
- **RAM:** 16GB+
- **Disk:** 50GB+ (models + checkpoints)
- **CUDA:** 12.4+ with cuDNN

### CPU Mode
- **RAM:** 16GB+ (32GB recommended)
- **Disk:** 50GB+
- **CPU:** 8+ cores recommended
- **Note:** Slower inference, especially for Whisper

## 🔐 Environment Variables

Environment variables are configured in `backend/.env`:

```bash
# Copy example
cp backend/.env.example backend/.env

# Edit configuration
nano backend/.env
```

See `backend/README.md` for full list of environment variables.

## 📚 Related Documentation

- **[Backend README](../backend/README.md)** - API documentation and configuration
- **[GPU Setup Guide](../backend/GPU_SETUP.md)** - CUDA, drivers, WSL configuration
- **[Voice Cloning Guide](../backend/VOICE_CLONING_GUIDE.md)** - Custom TTS voices
- **[Security & Monitoring](../SECURITY_MONITORING_GUIDE.md)** - Observability setup
- **[Deployment Guide](../deploy/README.md)** - Production CI/CD setup

## 🐛 Troubleshooting

### Build Fails
1. Check Docker version: `docker --version` (need 24.0+)
2. Check Docker Compose: `docker compose version` (need v2)
3. Clean build cache: `docker builder prune -a`

### GPU Not Detected
1. Check NVIDIA drivers: `nvidia-smi`
2. Check Docker GPU support: `docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi`
3. See [GPU Setup Guide](../backend/GPU_SETUP.md)
4. Use CPU mode: `docker compose -f docker-compose.cpu.yml up -d`

### Service Won't Start
1. Check logs: `docker compose logs gemma_service`
2. Check health: `docker compose ps`
3. Verify ports free: `netstat -ano | grep 6666`
4. Check .env file exists: `ls -la backend/.env`

### Out of Memory
1. Reduce model size in `.env`: `FASTER_WHISPER_MODEL_SIZE=base`
2. Limit Docker resources in Docker Desktop
3. Use CPU mode with int8 quantization

## 🎯 Best Practices

1. **Always run from `docker/` directory** for correct build contexts
2. **Use `.env` file** for configuration, never hardcode secrets
3. **Use GPU mode** when available for best performance
4. **Monitor resources** with monitoring stack in production
5. **Keep images updated** but test in staging first
6. **Use named volumes** for persistent data
7. **Enable health checks** in production
8. **Set resource limits** to prevent OOM

## 📝 Notes

- Docker Compose V2 syntax (no hyphen: `docker compose` not `docker-compose`)
- Build context is `../backend` so Dockerfile can access application code
- OpenAudio checkpoints must be downloaded separately (see Voice Cloning Guide)
- Production images are built in CI/CD and pushed to GitHub Container Registry
- Monitoring stack requires additional 2GB RAM and 10GB disk
