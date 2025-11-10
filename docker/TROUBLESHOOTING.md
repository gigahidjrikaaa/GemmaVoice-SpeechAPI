# Container Troubleshooting Guide

This guide helps you fix common Docker container issues in this project.

## 🐛 Issue 1: OpenAudio Service - "ModuleNotFoundError: No module named 'uvicorn'"

**Symptom:**
```
ModuleNotFoundError: No module named 'uvicorn'
File "/app/tools/api_server.py", line 5, in <module>
  import uvicorn
```

**Cause:** Missing Python dependencies in the OpenAudio container.

**Solution:** 
The Dockerfile has been updated to install `uvicorn` and `fastapi`. Rebuild the container:

```bash
cd docker
docker compose build --no-cache openaudio-service
docker compose up -d openaudio-service
```

**Verify the fix:**
```bash
docker compose logs -f openaudio-service
```

You should see the server starting on port 8080.

---

## 🐛 Issue 2: Gemma Service - "416 Client Error: Requested Range Not Satisfiable"

**Symptom:**
```
requests.exceptions.HTTPError: 416 Client Error: Requested Range Not Satisfiable for url: https://cas-bridge.xethub.hf.co/...
huggingface_hub.utils._errors.HfHubHTTPError: 416 Client Error
```

**Cause:** Corrupted or partially downloaded model file in HuggingFace cache.

**Solution Options:**

### Option A: Use the automated fix script (Recommended)

**Windows:**
```bash
cd docker
fix-containers.bat
```

**Linux/Mac:**
```bash
cd docker
chmod +x fix-containers.sh
./fix-containers.sh
```

### Option B: Manual fix

1. **Stop the containers:**
   ```bash
   cd docker
   docker compose down
   ```

2. **Clear the corrupted cache:**
   
   **Windows:**
   ```cmd
   rmdir /s /q "%USERPROFILE%\.cache\huggingface\hub\models--bartowski--google_gemma-3-12b-it-GGUF"
   ```
   
   **Linux/Mac:**
   ```bash
   rm -rf ~/.cache/huggingface/hub/models--bartowski--google_gemma-3-12b-it-GGUF
   ```

3. **Rebuild and restart:**
   ```bash
   docker compose build --no-cache gemma-service
   docker compose up -d
   ```

4. **Monitor the download:**
   ```bash
   docker compose logs -f gemma-service
   ```

**Verify the fix:**
You should see:
```
INFO | app.services.llm | Downloading model 'google_gemma-3-12b-it-Q4_0.gguf'...
INFO | app.services.llm | Model loaded successfully
INFO | uvicorn.error | Application startup complete.
```

---

## 🔍 General Debugging Commands

### Check container status
```bash
docker compose ps
```

### View logs for all services
```bash
docker compose logs -f
```

### View logs for specific service
```bash
docker compose logs -f gemma-service
docker compose logs -f openaudio-service
```

### Restart a specific service
```bash
docker compose restart gemma-service
```

### Full reset (nuclear option)
```bash
docker compose down -v  # Remove volumes
docker compose build --no-cache
docker compose up -d
```

### Check disk space (model files are large!)
```bash
# Windows (PowerShell)
Get-PSDrive C

# Linux/Mac
df -h
```

### Check HuggingFace cache size
```bash
# Windows (PowerShell)
(Get-ChildItem -Path "$env:USERPROFILE\.cache\huggingface" -Recurse | Measure-Object -Property Length -Sum).Sum / 1GB

# Linux/Mac
du -sh ~/.cache/huggingface
```

---

## 📋 Prerequisites Checklist

Before running the containers, ensure:

- [ ] **Docker Desktop** installed and running
- [ ] **Sufficient disk space** (>20GB for model + containers)
- [ ] **Internet connection** for model download
- [ ] **GPU drivers** installed (for CUDA containers)
- [ ] **Ports available:** 6666 (Gemma), 8080 (OpenAudio), 5173 (Frontend)
- [ ] **OpenAudio checkpoints** downloaded to `backend/openaudio-checkpoints/`

---

## 🚀 First-Time Setup

1. **Download OpenAudio checkpoints:**
   ```bash
   cd backend
   python download_checkpoints.py
   ```

2. **Build all containers:**
   ```bash
   cd docker
   docker compose build
   ```

3. **Start services:**
   ```bash
   docker compose up -d
   ```

4. **Monitor startup:**
   ```bash
   docker compose logs -f
   ```

5. **Wait for models to download** (first time only, ~10GB+)

6. **Access the app:**
   - API: http://localhost:6666
   - Docs: http://localhost:6666/docs
   - Frontend: http://localhost:5173

---

## 🆘 Still Having Issues?

1. **Check the logs carefully** - error messages are usually descriptive
2. **Verify environment variables** in `docker-compose.yml`
3. **Check network connectivity** - firewalls may block model downloads
4. **Try CPU-only mode** if GPU issues persist (use `docker-compose.cpu.yml`)
5. **Open an issue** on GitHub with full error logs

---

## 📚 Related Documentation

- [Backend README](../backend/README.md) - Environment variables and configuration
- [Docker README](./README.md) - Docker Compose setup and commands
- [GPU Setup Guide](../backend/GPU_SETUP.md) - CUDA troubleshooting

