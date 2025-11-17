# 🚀 CI/CD Setup Guide

Complete guide for deploying GemmaVoice-SpeechAPI to your VM with GitHub Actions.

---

## 📁 Project Structure

```
GemmaVoice-SpeechAPI/
├── .github/
│   └── workflows/              # CI/CD pipeline definitions
│       ├── backend-ci-cd.yml   # Backend deployment workflow
│       ├── frontend-ci-cd.yml  # Frontend deployment workflow
│       └── tests.yml           # Automated testing (optional)
├── deploy/
│   ├── deploy.sh               # Main deployment script
│   └── README.md               # Deployment documentation
├── backend/                # Backend application
│   ├── app/
│   ├── Dockerfile              # Production Dockerfile
│   └── requirements.txt
├── frontend/                   # Frontend application
│   ├── src/
│   ├── Dockerfile.prod         # Production Dockerfile
│   └── nginx.conf              # Nginx configuration
├── docker-compose.prod.yml     # Production compose file
└── .env.production.example     # Production env template
```

**Separation Achieved:**
- ✅ CI/CD configs in `.github/workflows/` (isolated from app code)
- ✅ Deployment scripts in `deploy/` (reusable, version-controlled)
- ✅ Production configs separate from development
- ✅ Environment-specific settings in `.env.production`

---

## 🎯 Prerequisites

### On Your Local Machine
- Git with SSH access to GitHub
- GitHub account with repository access

### On Your VM (Production Server)
- Docker Engine 24+ with NVIDIA Container Toolkit
- Docker Compose v2+
- SSH access configured
- Sufficient resources:
  - **CPU**: 8+ cores
  - **RAM**: 32GB+
  - **GPU**: NVIDIA with 16GB+ VRAM (or use separate GPUs for services)
  - **Disk**: 100GB+ free space

### DevOps Requirements
Ask your DevOps team to configure:
- **Domain routing**:
  - `yourdomain.com` → `VM_IP:5173` (Frontend)
  - `api.yourdomain.com` → `VM_IP:6666` (Backend)
- **SSL/TLS certificates** (Let's Encrypt recommended)
- **Firewall rules** to allow ports 5173, 6666, 8080
- **Optional**: Load balancer for high availability

---

## 🔧 Step 1: GitHub Repository Secrets

Add these secrets to your GitHub repository:

### Navigate to: `Settings` → `Secrets and variables` → `Actions` → `New repository secret`

#### **For Staging Environment:**
```
STAGING_SSH_KEY          # Private SSH key for staging VM
STAGING_HOST             # Staging VM IP/hostname
STAGING_USER             # SSH username (e.g., ubuntu)
STAGING_DEPLOY_PATH      # Deploy directory (e.g., /opt/gemmavoice)
```

#### **For Production Environment:**
```
PRODUCTION_SSH_KEY       # Private SSH key for production VM
PRODUCTION_HOST          # Production VM IP/hostname
PRODUCTION_USER          # SSH username
PRODUCTION_DEPLOY_PATH   # Deploy directory (e.g., /opt/gemmavoice)
```

#### **Application Secrets:**
```
HUGGING_FACE_HUB_TOKEN   # From https://huggingface.co/settings/tokens
VITE_API_BASE_URL        # Frontend API URL (e.g., https://api.yourdomain.com)
CODECOV_TOKEN            # (Optional) For code coverage reports
```

---

## 🖥️ Step 2: VM Setup

### 2.1 Connect to Your VM

```bash
ssh your_user@your_vm_ip
```

### 2.2 Install Docker and NVIDIA Container Toolkit

```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Install NVIDIA Container Toolkit
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | \
  sudo tee /etc/apt/sources.list.d/nvidia-docker.list

sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit
sudo systemctl restart docker

# Verify GPU access
docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi
```

### 2.3 Create Deployment Directory

```bash
sudo mkdir -p /opt/gemmavoice
sudo chown $USER:$USER /opt/gemmavoice
cd /opt/gemmavoice
```

### 2.4 Setup GitHub Container Registry Authentication

```bash
# Create a Personal Access Token (PAT) with read:packages scope
# From: https://github.com/settings/tokens

echo $YOUR_GITHUB_TOKEN | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

### 2.5 Create Production Environment File

```bash
cd /opt/gemmavoice
nano .env.production
```

Copy from `.env.production.example` and fill in your values:

```bash
# Critical values to set:
HUGGING_FACE_HUB_TOKEN=hf_your_token_here
API_KEYS=your_secure_random_key_here
VITE_API_BASE_URL=https://api.yourdomain.com
VITE_API_KEY=your_frontend_key_here
```

### 2.6 Create Log Directories

```bash
mkdir -p /opt/gemmavoice/logs/backend
mkdir -p /opt/gemmavoice/logs/frontend
```

---

## 🚀 Step 3: Initial Manual Deployment (First Time Only)

Before CI/CD, perform initial setup:

```bash
cd /opt/gemmavoice

# Clone repository
git clone https://github.com/gigahidjrikaaa/GemmaVoice-SpeechAPI.git temp
cp temp/docker-compose.prod.yml ./docker-compose.yml
cp temp/deploy/deploy.sh ./deploy.sh
rm -rf temp

# Make deploy script executable
chmod +x deploy.sh

# Build OpenAudio locally (has local checkpoints)
cd ~/GemmaVoice-SpeechAPI/backend
docker build -f openaudio.Dockerfile -t backend-openaudio:latest ..

# Start services
cd /opt/gemmavoice
./deploy.sh deploy
```

**Wait for services to start** (may take 5-10 minutes on first run):

```bash
# Monitor logs
docker compose logs -f

# Check status
docker compose ps
```

---

## 🔄 Step 4: Configure GitHub Actions

### 4.1 Branch Strategy

This setup uses **GitFlow**:
- `main` → Production deployments
- `develop` → Staging deployments
- `feature/*` → Feature branches (no auto-deploy)

### 4.2 Workflow Triggers

**Backend CI/CD** (`.github/workflows/backend-ci-cd.yml`):
- Triggers on push to `main` or `develop` affecting `backend/**`
- Runs tests → Builds Docker image → Deploys to environment
- Manual trigger via Actions tab

**Frontend CI/CD** (`.github/workflows/frontend-ci-cd.yml`):
- Triggers on push to `main` or `develop` affecting `frontend/**`
- Runs tests → Builds Docker image → Deploys to environment
- Manual trigger via Actions tab

### 4.3 Deployment Flow

```
┌─────────────┐
│ Push to     │
│ main/develop│
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Run Tests   │
│ (lint, test)│
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Build Docker│
│ Image       │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Push to GHCR│
│ (ghcr.io)   │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ SSH to VM   │
│ Run deploy  │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Health Check│
│ Verify      │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Success! 🚀 │
└─────────────┘
```

---

## 🧪 Step 5: Test CI/CD Pipeline

### 5.1 Test Backend Deployment

```bash
# Make a small change to backend
cd backend
echo "# Test" >> README.md
git add .
git commit -m "test: trigger backend CI/CD"
git push origin develop
```

### 5.2 Monitor GitHub Actions

1. Go to: `https://github.com/gigahidjrikaaa/GemmaVoice-SpeechAPI/actions`
2. Watch the "Backend CI/CD" workflow
3. Check each step for success ✅

### 5.3 Verify Deployment on VM

```bash
ssh your_user@your_vm_ip
cd /opt/gemmavoice
docker compose ps
docker compose logs gemma_service --tail=50
```

---

## 🛡️ Step 6: Security Best Practices

### 6.1 Secure Secrets

```bash
# On VM, restrict .env.production permissions
chmod 600 /opt/gemmavoice/.env.production

# Never commit production env files
echo ".env.production" >> .gitignore
```

### 6.2 Enable API Authentication

In `.env.production`:

```bash
API_KEY_ENABLED=true
API_KEYS=generate_strong_random_key_here
```

Generate strong keys:

```bash
# Generate 32-byte random key
openssl rand -hex 32
```

### 6.3 Rate Limiting

```bash
RATE_LIMIT_ENABLED=true
RATE_LIMIT_REQUESTS=100
RATE_LIMIT_WINDOW_SECONDS=60
```

---

## 📊 Step 7: Monitoring & Observability

### 7.1 Check Logs

```bash
# Backend logs
docker compose logs gemma_service -f

# Frontend logs
docker compose logs frontend -f

# OpenAudio logs
docker compose logs openaudio_api -f

# All services
docker compose logs -f
```

### 7.2 Resource Monitoring

```bash
# Real-time stats
docker stats

# GPU monitoring
watch -n 1 nvidia-smi
```

### 7.3 Health Checks

```bash
# Backend health
curl http://localhost:6666/health

# Frontend health
curl http://localhost:5173/health

# Via domain (after DevOps setup)
curl https://api.yourdomain.com/health
curl https://yourdomain.com/health
```

---

## 🔄 Step 8: Manual Operations

### Deploy Specific Version

```bash
# On VM
cd /opt/gemmavoice
export BACKEND_IMAGE=ghcr.io/gigahidjrikaaa/gemmavoice-speechapi/gemma-api:v1.2.3
docker compose pull
docker compose up -d
```

### Rollback to Previous Version

```bash
cd /opt/gemmavoice
./deploy.sh rollback
```

### View Deployment Status

```bash
./deploy.sh status
```

### Stream Logs

```bash
./deploy.sh logs
```

---

## 🌐 Step 9: Domain Configuration (For DevOps)

### Nginx Reverse Proxy Example

```nginx
# /etc/nginx/sites-available/gemmavoice

# Backend API
server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:6666;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Increase timeout for long-running AI requests
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }
}

# Frontend
server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:5173;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## ❌ Troubleshooting

### Issue: CI/CD fails at SSH step

**Solution:**
```bash
# Ensure SSH key is properly formatted (no extra newlines)
# In GitHub Secrets, paste exactly the output of:
cat ~/.ssh/id_rsa
```

### Issue: Docker image pull fails

**Solution:**
```bash
# Re-authenticate with GHCR
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin
```

### Issue: Health check fails

**Solution:**
```bash
# Check if services are running
docker compose ps

# Check logs for errors
docker compose logs gemma_service --tail=100

# Manually test health endpoint
curl -v http://localhost:6666/health
```

### Issue: Out of GPU memory

**Solution:**
```bash
# Stop OpenAudio if not needed
docker compose stop openaudio_api

# Or reduce model sizes in .env.production
FASTER_WHISPER_MODEL_SIZE=tiny
LLM_GPU_LAYERS=20  # Instead of -1
```

---

## 📚 Additional Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Docker Compose Production Guide](https://docs.docker.com/compose/production/)
- [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html)
- [Let's Encrypt SSL Setup](https://letsencrypt.org/getting-started/)

---

## 🎯 Quick Reference Commands

```bash
# On VM - Common operations
cd /opt/gemmavoice

# Deploy latest
./deploy.sh deploy

# Rollback
./deploy.sh rollback

# View status
./deploy.sh status

# Stream logs
./deploy.sh logs

# Restart services
docker compose restart

# Update images
docker compose pull && docker compose up -d

# Clean old images
docker image prune -f
```

---

## ✅ Checklist

- [ ] GitHub secrets configured
- [ ] VM setup complete (Docker + NVIDIA toolkit)
- [ ] Deployment directory created (`/opt/gemmavoice`)
- [ ] `.env.production` configured with secrets
- [ ] Initial manual deployment successful
- [ ] CI/CD pipeline tested (push to develop)
- [ ] Health checks passing
- [ ] DevOps configured domain routing
- [ ] SSL certificates installed
- [ ] Monitoring setup (logs, metrics)
- [ ] Rollback procedure tested

---

**Need Help?** Open an issue or check the [Troubleshooting](#-troubleshooting) section.
