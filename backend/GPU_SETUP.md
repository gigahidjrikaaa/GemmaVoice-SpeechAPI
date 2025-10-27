# GPU Configuration for Windows/WSL and Linux

This directory contains multiple Docker Compose configurations for different environments.

## 🖥️ Environment Detection

### Windows/WSL without GPU Support
**Symptom:** `nvidia-container-cli: initialization error: WSL environment detected but no adapters were found`

**Solution:** Use CPU-only mode or configure WSL GPU support

### Linux with NVIDIA GPU
**Symptom:** GPU detected and working
**Solution:** Use default GPU configuration

---

## 🚀 Quick Start Commands

### Option 1: Auto-detect (Recommended)
```bash
docker compose up
```
Uses `docker-compose.yml` + `docker-compose.override.yml` (GPU-optional)

### Option 2: CPU-only (Safe for Windows/WSL)
```bash
docker compose -f docker-compose.cpu.yml up
```
Explicitly uses CPU mode for all services

### Option 3: GPU-only (Linux with NVIDIA)
```bash
docker compose -f docker-compose.yml up
```
Requires NVIDIA GPU and nvidia-docker2 installed

---

## 📋 Configuration Files

| File | Purpose | Use When |
|------|---------|----------|
| `docker-compose.yml` | Base configuration with GPU | Linux with NVIDIA GPU |
| `docker-compose.override.yml` | Removes GPU requirements | Auto-merged, makes GPU optional |
| `docker-compose.cpu.yml` | CPU-only mode | Windows/WSL without GPU |
| `docker-compose.prod.yml` | Production config (root dir) | VM deployment with GPU |

---

## 🛠️ Fixing GPU Support in WSL2 (Windows)

### Step 1: Check WSL Version
```powershell
wsl --list --verbose
```
Must be WSL 2 (not WSL 1)

### Step 2: Update NVIDIA Driver (Windows)
- Download latest **NVIDIA GPU Driver for Windows** (not WSL driver)
- Must be version 470+ for WSL GPU support
- Link: https://www.nvidia.com/Download/index.aspx

### Step 3: Install NVIDIA Container Toolkit (Inside WSL)
```bash
# Add NVIDIA package repository
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | \
  sudo tee /etc/apt/sources.list.d/nvidia-docker.list

# Install nvidia-docker2
sudo apt-get update
sudo apt-get install -y nvidia-docker2

# Restart Docker daemon
sudo systemctl restart docker

# Test GPU access
docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi
```

### Step 4: Configure Docker Desktop (Windows)
1. Open Docker Desktop settings
2. Go to **Resources** → **WSL Integration**
3. Enable integration with your WSL distro
4. Restart Docker Desktop

### Step 5: Test
```bash
cd backend
docker compose up
```

---

## 🐛 Troubleshooting

### Error: `nvidia-container-cli: initialization error`
**Cause:** GPU not configured or not available

**Solutions:**
1. Use CPU mode: `docker compose -f docker-compose.cpu.yml up`
2. Or fix GPU support (see steps above)

### Error: `could not select device driver "nvidia"`
**Cause:** nvidia-docker2 not installed or Docker daemon not restarted

**Solution:**
```bash
# Inside WSL
sudo apt-get install -y nvidia-docker2
sudo systemctl restart docker
```

### Error: Network "shared_services_network" not found
**Cause:** External network not created

**Solution:**
```bash
docker network create shared_services_network
```

### Slower performance on CPU
**Expected:** CPU inference is 10-50x slower than GPU

**Options:**
1. Fix GPU support (recommended for development)
2. Use smaller models:
   - Whisper: `tiny` or `base` instead of `small`/`medium`
   - Gemma: Use smaller quantization (Q4_0 is good)
3. Deploy to cloud VM with GPU for production

---

## 📊 Performance Comparison

| Component | GPU (CUDA) | CPU |
|-----------|-----------|-----|
| **Whisper (base)** | ~1-2s | ~10-20s |
| **Gemma 3 (Q4_0)** | ~2-5s per response | ~20-60s per response |
| **OpenAudio TTS** | ~2-3s per sentence | ~10-30s per sentence |

---

## 🎯 Recommended Configurations

### Local Development (Windows/WSL without GPU)
```bash
docker compose -f docker-compose.cpu.yml up
```
- Slower but works everywhere
- Good for testing API endpoints
- Use small models

### Local Development (Linux with GPU)
```bash
docker compose up
```
- Fast inference
- Good for end-to-end testing
- Use larger models for quality

### Production (VM/Server with GPU)
```bash
docker compose -f docker-compose.prod.yml up
```
- Optimized for production
- GPU required
- Health checks and monitoring

---

## 📝 Environment Variables for GPU/CPU

Edit `.env` file:

```bash
# CPU Mode (Windows/WSL)
FASTER_WHISPER_DEVICE=cpu
FASTER_WHISPER_COMPUTE_TYPE=int8

# GPU Mode (Linux)
FASTER_WHISPER_DEVICE=cuda
FASTER_WHISPER_COMPUTE_TYPE=float16
```

The services will automatically use the correct mode based on these variables.

---

## 🆘 Still Having Issues?

1. **Check Docker logs:**
   ```bash
   docker compose logs gemma_service
   docker compose logs openaudio
   ```

2. **Verify GPU availability:**
   ```bash
   nvidia-smi  # Should show your GPU
   ```

3. **Test with simple container:**
   ```bash
   docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi
   ```

4. **Use CPU mode while troubleshooting:**
   ```bash
   docker compose -f docker-compose.cpu.yml up
   ```

---

**Next Steps:** Once containers are running, test the API at http://localhost:6666/docs
