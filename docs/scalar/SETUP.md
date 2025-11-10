# 🚀 Quick Setup: Scalar API Documentation

This guide will help you set up beautiful, modern API documentation for GemmaVoice using Scalar.

## Prerequisites

- Docker & Docker Compose installed
- Node.js (optional, for Scalar CLI)
- Python 3.11+ (for backend development)

## 📖 Step 1: View Documentation (Easiest)

The documentation is already integrated! Just start your services:

```bash
# Start all services
cd docker
docker compose up

# Open documentation in browser
# Windows
start http://localhost:21250/docs

# macOS
open http://localhost:21250/docs

# Linux
xdg-open http://localhost:21250/docs
```

**That's it!** You now have beautiful, interactive API docs at `http://localhost:21250/docs`

## 🎨 Step 2: Customize (Optional)

### Switch Between Scalar and Swagger UI

Create or edit `.env` in the `backend/` directory:

```bash
# Use Scalar (modern, beautiful)
USE_SCALAR_DOCS=true

# Use Swagger UI (FastAPI default)
USE_SCALAR_DOCS=false
```

Restart your services:

```bash
docker compose restart gemma_service
```

### Change Theme

Edit `docs/scalar/index.html` for the standalone version:

```html
<script
    id="api-reference"
    data-url="./openapi.yaml"
    data-configuration='{
        "theme": "purple",
        "darkMode": true,
        "layout": "modern"
    }'
></script>
```

Available themes: `default`, `purple`, `blue`, `green`, `alternate`, `moon`, `saturn`

## 🛠️ Step 3: Install Scalar Package (For Development)

If you're developing the backend locally (not in Docker):

```bash
# Navigate to backend directory
cd backend

# Install dependencies including Scalar
pip install -r requirements.txt

# Run the server
uvicorn app.main:app --host 0.0.0.0 --port 6666

# Open docs
open http://localhost:6666/docs
```

## 📝 Step 4: Use Scalar CLI (For Static Docs)

The Scalar CLI lets you preview documentation without running the backend:

```bash
# Install globally (one-time)
npm install --global @scalar/cli

# Preview with hot-reload
scalar preview docs/scalar/openapi.yaml

# Open http://localhost:9025
```

## 🌐 Step 5: Deploy Static Docs (Optional)

### Option A: Standalone HTML

The simplest option - just open the HTML file:

```bash
cd docs/scalar
open index.html
```

Share this file with your team - it works without any server!

### Option B: Build Static Site

For hosting on GitHub Pages, Netlify, etc:

```bash
# Build production-ready static site
scalar build docs/scalar/openapi.yaml --out docs/scalar/dist

# Deploy the 'dist' folder to any static host
```

### Option C: GitHub Pages

```bash
# 1. Build the docs
scalar build docs/scalar/openapi.yaml --out docs/public

# 2. Commit and push
git add docs/public
git commit -m "Add API documentation"
git push

# 3. Enable GitHub Pages
# Go to: Repository Settings → Pages
# Source: Deploy from branch
# Branch: main → Folder: /docs/public
```

Your docs will be live at: `https://[username].github.io/[repo]/`

## 🎯 What You Get

### Integrated Documentation (Default Setup)

- ✅ **Auto-updates** - Always in sync with your code
- ✅ **Interactive testing** - Try API calls directly in the browser
- ✅ **Authentication** - Built-in API key support
- ✅ **WebSocket support** - Test real-time endpoints
- ✅ **Dark mode** - Easy on the eyes
- ✅ **Search** - Find endpoints quickly
- ✅ **Mobile-friendly** - Works on all devices

### What's Documented

**Gemma Service API (Main API):**
- `GET /health/live` - Health checks
- `GET /health/ready` - Readiness checks
- `GET /metrics` - Prometheus metrics
- `GET /v1/models` - List available models
- `POST /v1/generate` - Text generation
- `POST /v1/generate/stream` - Streaming generation
- `WS /v1/generate/ws` - WebSocket generation
- `POST /v1/speech-to-text` - Audio transcription
- `WS /v1/speech-to-text/ws` - Live transcription
- `POST /v1/text-to-speech` - Speech synthesis
- `POST /v1/text-to-speech/stream` - Streaming TTS
- `WS /v1/text-to-speech/ws` - WebSocket TTS
- `POST /v1/dialogue` - Complete voice conversation

**OpenAudio Integration:**
- Direct TTS endpoint: `http://localhost:21251/v1/tts`
- Voice cloning with reference audio
- Multiple audio formats (WAV, MP3, OGG, FLAC)
- Configurable sample rates
- Streaming support

## 🔍 Troubleshooting

### "Cannot connect to localhost:21250"

**Solution**: Start the Docker services:

```bash
cd docker
docker compose up
```

### "Scalar not found" error

**Solution**: Install the package:

```bash
cd backend
pip install scalar-fastapi
docker compose restart gemma_service
```

### Docs show Swagger UI instead of Scalar

**Solution**: Set environment variable:

```bash
echo "USE_SCALAR_DOCS=true" >> backend/.env
docker compose restart gemma_service
```

### Changes to openapi.yaml not reflected

**Solution**: The integrated docs use FastAPI's auto-generated schema. To use your custom YAML:

1. Edit `backend/app/main.py`
2. Point to your YAML file instead of auto-generated schema
3. Or use the standalone HTML (`docs/scalar/index.html`)

## 📚 Next Steps

1. **Explore the docs**: Visit `http://localhost:21250/docs`
2. **Try the API**: Use the "Try it" button on any endpoint
3. **Add your API key**: If `API_KEY_ENABLED=true`, click the lock icon
4. **Test WebSockets**: Try the `/v1/generate/ws` endpoint
5. **Clone voices**: Upload reference audio to `/v1/text-to-speech`

## 🤝 Need Help?

- **Scalar Issues**: https://github.com/scalar/scalar/issues
- **FastAPI Docs**: https://fastapi.tiangolo.com/
- **Project Issues**: https://github.com/gigahidjrikaaa/GemmaVoice-SpeechAPI/issues

Happy documenting! 🎉
