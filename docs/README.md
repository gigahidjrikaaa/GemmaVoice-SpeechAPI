# 📚 GemmaVoice Documentation

**Complete documentation for the GemmaVoice Speech API project**

---

## 🚀 Quick Start

New to GemmaVoice? Start here:

1. **[Local Setup Guide](setup/LOCAL_SETUP_GUIDE.md)** - Complete installation and configuration
2. **[Migration & Deployment](setup/MIGRATION_AND_DEPLOYMENT.md)** - Port configuration and deployment fixes
3. **[API Documentation](http://localhost:21250/docs)** - Interactive Scalar API docs (after starting services)

---

## 📖 Documentation Structure

### 🔧 Setup & Configuration

Essential guides for getting started and deploying GemmaVoice:

- **[Local Setup Guide](setup/LOCAL_SETUP_GUIDE.md)** - Step-by-step installation
  - Prerequisites and dependencies
  - Docker setup
  - Model downloads
  - Environment configuration
  - Running services

- **[Migration & Deployment Guide](setup/MIGRATION_AND_DEPLOYMENT.md)** - Port migration and deployment
  - Port configuration (21250, 21251)
  - Deployment fixes (model access, Docker tags)
  - Environment variables
  - Troubleshooting

### 📘 Feature Guides

In-depth guides for specific features:

- **[Voice Cloning Guide](guides/VOICE_CLONING_GUIDE.md)** - Custom voice synthesis
  - Overview and methods
  - Inline Base64 references (recommended for API)
  - Server-side reference storage (recommended for production)
  - Multiple reference voices
  - Fine-tuning parameters
  - WebSocket streaming with voice cloning
  - Best practices and troubleshooting

### 🌐 API Documentation

- **[Scalar API Docs](scalar/README.md)** - Modern interactive API documentation
  - Quick setup guide
  - 3 usage options (integrated, standalone, CLI)
  - Customization and configuration
  - Deployment guides

- **[OpenAPI Specification](scalar/openapi.yaml)** - Complete API schema
  - Gemma 3 text generation endpoints
  - Whisper speech-to-text endpoints
  - OpenAudio text-to-speech endpoints
  - WebSocket endpoints
  - Authentication and rate limiting

- **[Scalar Setup Guide](scalar/SETUP.md)** - Detailed Scalar integration
  - FastAPI integration
  - Configuration options
  - Theme customization
  - Multiple access methods

### 💻 Frontend Development

Guides for frontend development and enhancements:

- **[Frontend Enhancements](FRONTEND_ENHANCEMENTS.md)** - Latest UI/UX improvements
  - Error logging system
  - Instructions panel component
  - Enhanced components (Generation, Transcription, Synthesis)
  - User-friendly error messages
  - Testing and deployment

- **[Frontend Code Review](FRONTEND_CODE_REVIEW.md)** - Code analysis and recommendations
  - Code duplication issues
  - Missing features
  - Improvement suggestions
  - Refactoring opportunities

### 🐳 Docker & Infrastructure

- **[Docker README](../docker/README.md)** - Container configuration
  - Docker Compose setup
  - Service definitions
  - Volume mounts
  - Network configuration

- **[Docker Troubleshooting](../docker/TROUBLESHOOTING.md)** - Common Docker issues
  - Build failures
  - Container startup issues
  - Network problems
  - Volume permission errors

### 🚀 Deployment

- **[Deployment README](../deploy/README.md)** - Production deployment
  - Monitoring setup (Prometheus, Grafana, Loki)
  - Alert configuration
  - Log aggregation
  - Performance monitoring

### 🔙 Backend Development

- **[Backend README](../backend/README.md)** - Backend API documentation
  - FastAPI application structure
  - Services architecture
  - Configuration management
  - Testing and development

- **[GPU Setup Guide](../backend/GPU_SETUP.md)** - GPU configuration
  - CUDA setup
  - Driver installation
  - GPU memory management
  - Performance optimization

### 🎨 Frontend Development

- **[Frontend README](../frontend/README.md)** - Frontend application
  - React + TypeScript + Vite setup
  - Component structure
  - State management
  - Development workflow

- **[Live Conversation Guide](../frontend/LIVE_CONVERSATION_GUIDE.md)** - Real-time conversation features
  - WebSocket integration
  - Voice activity detection
  - Streaming transcription
  - Conversation flow

- **[Quick Start Recording](../frontend/QUICK_START_RECORDING.md)** - Recording features
  - Microphone setup
  - Audio capture
  - Real-time transcription
  - File upload

---

## 🎯 Use Case Scenarios

### Scenario 1: First Time Setup

**I'm setting up GemmaVoice for the first time**

1. Follow **[Local Setup Guide](setup/LOCAL_SETUP_GUIDE.md)**
2. Download models using the provided scripts
3. Start services with Docker Compose
4. Test with **[API Documentation](http://localhost:21250/docs)**
5. Explore frontend at http://localhost:5173

### Scenario 2: Voice Cloning

**I want to use my own voice for Bahasa Indonesia TTS**

1. Read **[Voice Cloning Guide](guides/VOICE_CLONING_GUIDE.md)**
2. Prepare 5-7 second audio samples
3. Choose method: Inline Base64 (API) or Reference ID (production)
4. Test with provided code examples
5. Integrate into your application

### Scenario 3: API Integration

**I need to integrate GemmaVoice API into my app**

1. Start services locally
2. Explore **[Scalar API Docs](http://localhost:21250/docs)**
3. Review **[OpenAPI Specification](api/scalar/openapi.yaml)**
4. Use example requests in the docs
5. Check **[Backend README](../backend/README.md)** for advanced features

### Scenario 4: Deployment

**I'm deploying to production**

1. Review **[Migration & Deployment Guide](setup/MIGRATION_AND_DEPLOYMENT.md)**
2. Configure environment variables
3. Set up monitoring with **[Deployment README](../deploy/README.md)**
4. Review **[Docker README](../docker/README.md)** for container config
5. Test all endpoints with **[API Documentation](http://localhost:21250/docs)**

### Scenario 5: Troubleshooting

**Something isn't working**

1. Check **[Migration & Deployment - Troubleshooting](setup/MIGRATION_AND_DEPLOYMENT.md#-troubleshooting)**
2. Review **[Docker Troubleshooting](../docker/TROUBLESHOOTING.md)**
3. Check logs: `docker compose logs -f`
4. Verify health endpoints: `curl http://localhost:21250/health/live`
5. Review service-specific docs (Backend, Frontend, Docker)

### Scenario 6: Frontend Development

**I'm working on the frontend**

1. Read **[Frontend README](../frontend/README.md)**
2. Review **[Frontend Enhancements](FRONTEND_ENHANCEMENTS.md)** for latest features
3. Check **[Frontend Code Review](FRONTEND_CODE_REVIEW.md)** for best practices
4. Test with **[Quick Start Recording](../frontend/QUICK_START_RECORDING.md)**
5. Use **[Live Conversation Guide](../frontend/LIVE_CONVERSATION_GUIDE.md)** for real-time features

---

## 🔑 Key Services & Ports

| Service | Port | URL | Purpose |
|---------|------|-----|---------|
| **Gemma Service** | 21250 | http://localhost:21250 | LLM text generation API |
| **OpenAudio Service** | 21251 | http://localhost:21251 | Text-to-speech API |
| **Frontend Dev** | 5173 | http://localhost:5173 | React UI (development) |
| **API Docs** | 21250 | http://localhost:21250/docs | Scalar interactive docs |
| **Health Check** | 21250 | http://localhost:21250/health/live | Service health |

---

## 🛠️ Technology Stack

### Backend
- **FastAPI** - Modern Python web framework
- **llama-cpp-python** - Gemma 3 LLM inference
- **faster-whisper** - Speech-to-text transcription
- **Fish Speech (OpenAudio)** - Neural TTS with voice cloning

### Frontend
- **React 18** - UI library
- **TypeScript** - Type-safe JavaScript
- **Vite** - Fast build tool
- **TanStack Query** - Data fetching and caching
- **Tailwind CSS** - Utility-first styling

### Infrastructure
- **Docker & Docker Compose** - Containerization
- **Prometheus** - Metrics collection
- **Grafana** - Visualization dashboards
- **Loki** - Log aggregation
- **Git LFS** - Large model file storage

---

## 📂 Project Structure

```
aicare-gemma-3-api/
├── backend/                    # FastAPI backend
│   ├── app/                    # Application code
│   │   ├── api/               # API routes
│   │   ├── config/            # Configuration
│   │   ├── observability/     # Logging, metrics
│   │   ├── schemas/           # Pydantic models
│   │   ├── security/          # Auth, rate limiting
│   │   └── services/          # Business logic
│   ├── openaudio-checkpoints/ # TTS model weights (Git LFS)
│   └── tests/                 # Backend tests
│
├── frontend/                   # React frontend
│   ├── src/
│   │   ├── components/        # React components
│   │   ├── context/           # React context
│   │   ├── hooks/             # Custom hooks
│   │   └── lib/               # Utilities
│   └── tests/                 # Frontend tests
│
├── docker/                     # Docker configuration
│   ├── docker-compose.yml     # Main compose file
│   ├── Dockerfile             # Gemma service image
│   └── openaudio.Dockerfile   # OpenAudio image
│
├── deploy/                     # Deployment configs
│   ├── prometheus.yml         # Metrics config
│   ├── loki-config.yml        # Logs config
│   └── grafana/               # Dashboard configs
│
└── docs/                       # Documentation (you are here!)
    ├── README.md              # This file
    ├── setup/                 # Setup guides
    ├── guides/                # Feature guides
    ├── api/                   # API documentation
    ├── FRONTEND_ENHANCEMENTS.md
    └── FRONTEND_CODE_REVIEW.md
```

---

## 🤝 Contributing

When adding new features or fixing bugs:

1. **Document your changes** - Update relevant docs
2. **Follow conventions** - Check existing code style
3. **Test thoroughly** - Run tests before committing
4. **Update API docs** - Keep OpenAPI spec current
5. **Write clear commit messages** - Explain what and why

---

## 📞 Support & Resources

- **GitHub Repository**: [GemmaVoice-SpeechAPI](https://github.com/gigahidjrikaaa/GemmaVoice-SpeechAPI)
- **API Documentation**: http://localhost:21250/docs (when running)
- **Issues**: Report bugs and request features on GitHub

---

## 🔄 Recent Updates

- **November 10, 2025**: Documentation reorganization
  - Moved all docs to `/docs` folder
  - Merged duplicate guides
  - Created comprehensive index
  - Enhanced frontend with error logging and instructions

- **Previous Updates**:
  - Scalar API documentation integration
  - Port migration to 21250/21251
  - Voice cloning support
  - Frontend error handling enhancements
  - Live conversation features

---

## 📋 Quick Reference Card

### Start Services
```bash
cd docker
docker compose up -d
```

### View Logs
```bash
docker compose logs -f
```

### Stop Services
```bash
docker compose down
```

### Check Health
```bash
curl http://localhost:21250/health/live
```

### Test API
Open http://localhost:21250/docs in your browser

### Frontend Dev
```bash
cd frontend
npm run dev
```

---

**Last Updated**: November 10, 2025  
**Version**: 1.0.0  
**Status**: ✅ Active Development
