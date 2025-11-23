# Scalar API Documentation

This folder hosts comprehensive OpenAPI 3.1 specifications for the **GemmaVoice Speech API**, rendered with [Scalar](https://github.com/scalar/scalar) - a modern, beautiful API documentation tool.

## 🚀 Quick Start

### Option 1: View Live Docs (Integrated with FastAPI)

The **easiest way** to view the documentation is through the integrated Scalar interface:

```bash
# Start your backend services
cd docker
docker compose up

# Open your browser
# Gemma Service API docs: http://localhost:21250/docs
# OpenAPI JSON: http://localhost:21250/openapi.json
```

The live documentation automatically reflects your current API configuration and is always in sync with your code.

**Features:**
- ✅ Always up-to-date with your code
- ✅ Interactive API testing built-in
- ✅ Automatic authentication (uses your API keys)
- ✅ Dark mode support
- ✅ Mobile-friendly

### Option 2: Standalone HTML (No Server Required)

Open the static HTML file in your browser:

```bash
# From the project root
cd docs/scalar

# Windows
start index.html

# macOS
open index.html

# Linux
xdg-open index.html
```

This loads the documentation from `openapi.yaml` without needing a running server.

### Option 3: Scalar CLI Preview (Hot Reload)

Use the Scalar CLI for development with live updates:

```bash
# Install the Scalar CLI globally (one-time)
npm install --global @scalar/cli

# Launch interactive preview with hot-reload
scalar preview docs/scalar/openapi.yaml

# Or specify a custom port
scalar preview docs/scalar/openapi.yaml --port 3000
```

The CLI serves documentation at `http://localhost:9025` by default. Any changes to `openapi.yaml` will automatically refresh the preview.

## 🎨 Customization

### Toggle Between Swagger UI and Scalar

You can switch between Swagger UI (FastAPI default) and Scalar:

```bash
# Use Scalar (default)
USE_SCALAR_DOCS=true

# Use Swagger UI
USE_SCALAR_DOCS=false
```

Set this in your `.env` file or export as an environment variable.

### Customize Scalar Theme

Edit `index.html` and modify the configuration:

```html
<script
    id="api-reference"
    data-url="./openapi.yaml"
    data-configuration='{
        "theme": "purple",
        "darkMode": true,
        "layout": "modern",
        "showSidebar": true,
        "hideModels": false,
        "searchHotKey": "k"
    }'
></script>
```

**Available themes:**
- `default` - Clean, minimal
- `purple` - Purple accents (current)
- `blue` - Blue accents
- `green` - Green accents
- `alternate` - Alternative color scheme
- `moon` - Dark theme optimized
- `saturn` - Cosmic theme

**Layout options:**
- `modern` - Two-column with sidebar (current)
- `classic` - Traditional three-column

## 📦 Export Static Documentation

Generate a production-ready static site for deployment:

```bash
# Build to default output directory
scalar build docs/scalar/openapi.yaml

# Build to custom directory
scalar build docs/scalar/openapi.yaml --out docs/scalar/dist

# Build with custom configuration
scalar build docs/scalar/openapi.yaml --config docs/scalar/scalar.config.json --out dist
```

The generated `index.html` and assets can be deployed to:
- **GitHub Pages** - Free hosting for public repos
- **Netlify** - Automatic deploys from git
- **Vercel** - Edge-optimized hosting
- **S3 + CloudFront** - AWS static hosting
- **Azure Static Web Apps** - Microsoft cloud hosting
- **Cloudflare Pages** - Edge hosting

### Deploy to GitHub Pages

```bash
# Build the docs
scalar build docs/scalar/openapi.yaml --out docs/scalar/dist

# Commit and push
git add docs/scalar/dist
git commit -m "Update API documentation"
git push

# Enable GitHub Pages in repo settings:
# Settings → Pages → Source: Deploy from branch → Branch: main → Folder: /docs/scalar/dist
```

Your docs will be available at: `https://[username].github.io/[repo]/`

## 📚 Documentation Structure

### Files

- **`openapi.yaml`** - Complete OpenAPI 3.1 specification (1500+ lines)
  - All REST endpoints
  - WebSocket endpoints
  - Request/response schemas
  - Authentication details
  - Code examples in multiple languages
  
- **`index.html`** - Standalone Scalar viewer
  - Self-contained documentation page
  - No build step required
  - Works offline with local YAML file
  
- **`README.md`** - This file
  - Setup instructions
  - Configuration guide
  - Deployment options

## 🔧 Configuration Reference

### Environment Variables

```bash
# API Documentation
USE_SCALAR_DOCS=true           # Use Scalar instead of Swagger UI
DOCS_URL=/docs                 # Path to serve documentation
OPENAPI_URL=/openapi.json      # Path to OpenAPI schema

# API Metadata
API_TITLE="Gemma 3 API Service"
API_VERSION="1.0.0"

# OpenAudio Integration
OPENAUDIO_API_BASE=http://localhost:21251
OPENAUDIO_TTS_PATH=/v1/tts
OPENAUDIO_TIMEOUT_SECONDS=120
OPENAUDIO_MAX_RETRIES=3
OPENAUDIO_DEFAULT_FORMAT=wav
OPENAUDIO_DEFAULT_NORMALIZE=true
```

### Scalar Configuration Options

Create `scalar.config.json` for advanced customization:

```json
{
  "theme": "purple",
  "darkMode": true,
  "layout": "modern",
  "showSidebar": true,
  "hideModels": false,
  "searchHotKey": "k",
  "customCss": "",
  "authentication": {
    "preferredSecurityScheme": "ApiKeyAuth"
  },
  "servers": [
    {
      "url": "http://localhost:21250",
      "description": "Local gemma-service"
    }
  ]
}
```

## 🎯 Documenting OpenAudio API

The `openapi.yaml` includes detailed documentation for OpenAudio integration:

### Architecture Diagram

```
┌─────────────────┐
│   Frontend      │
│  (Port 5174)    │
└────────┬────────┘
         │ HTTP/WS
         ▼
┌─────────────────┐
│  Gemma Service  │  ← Main API (this documentation)
│  (Port 21250)   │
└────────┬────────┘
         │ HTTP
         ▼
┌─────────────────┐
│  OpenAudio-S1   │  ← Text-to-Speech Service
│  (Port 21251)   │
└─────────────────┘
```

### OpenAudio Endpoints

**Via Gemma Service (Recommended):**
- `POST /v1/text-to-speech` - Synthesize speech
- `POST /v1/text-to-speech/stream` - Streaming synthesis
- `WS /v1/text-to-speech/ws` - WebSocket synthesis
- `POST /v1/dialogue` - Complete STT → LLM → TTS pipeline

**Direct OpenAudio (Advanced):**
- `POST http://localhost:21251/v1/tts` - Direct TTS
- `GET http://localhost:21251/v1/health` - Health check

### Voice Cloning Example

```bash
curl -X POST http://localhost:21250/v1/text-to-speech \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello! This is a custom voice.",
    "format": "wav",
    "sample_rate": 22050,
    "normalize": true,
    "references": [
      "base64_encoded_audio_1",
      "base64_encoded_audio_2",
      "base64_encoded_audio_3"
    ]
  }'
```

## 🛠️ Development Workflow

### 1. Edit OpenAPI Spec

```bash
# Edit the spec
code docs/scalar/openapi.yaml

# Preview with hot reload
scalar preview docs/scalar/openapi.yaml
```

### 2. Validate Schema

```bash
# Install validator
npm install -g @apidevtools/swagger-cli

# Validate
swagger-cli validate docs/scalar/openapi.yaml
```

### 3. Test Live Integration

```bash
# Start services
cd docker && docker compose up

# Check integrated docs
curl http://localhost:21250/openapi.json | jq

# Open in browser
open http://localhost:21250/docs
```

### 4. Sync with Code

The FastAPI integration automatically generates OpenAPI schema from your code. To keep `openapi.yaml` in sync:

```bash
# Export current schema
curl http://localhost:21250/openapi.json > docs/scalar/openapi-generated.json

# Convert to YAML (requires yq)
yq eval -P docs/scalar/openapi-generated.json > docs/scalar/openapi-auto.yaml

# Manually merge enhancements from openapi.yaml
# (Examples, descriptions, etc.)
```

## 📖 Additional Resources

- **Scalar Documentation**: https://github.com/scalar/scalar
- **OpenAPI 3.1 Spec**: https://spec.openapis.org/oas/v3.1.0
- **FastAPI OpenAPI**: https://fastapi.tiangolo.com/tutorial/metadata/
- **Scalar FastAPI Plugin**: https://github.com/scalar/scalar/tree/main/packages/scalar_fastapi

## 🤝 Contributing

When adding new endpoints:

1. **Update the code** - Add endpoint in `backend/app/api/`
2. **Test locally** - Verify at `http://localhost:21250/docs`
3. **Export schema** - `curl http://localhost:21250/openapi.json`
4. **Enhance docs** - Add examples and descriptions to `openapi.yaml`
5. **Validate** - `swagger-cli validate docs/scalar/openapi.yaml`

## 🎉 Features Showcase

The Scalar documentation includes:

- ✅ **Complete API reference** - All endpoints documented
- ✅ **Code examples** - Python, JavaScript, cURL
- ✅ **Interactive testing** - Try API calls directly
- ✅ **Authentication guide** - API key setup
- ✅ **WebSocket examples** - Real-time streaming
- ✅ **Voice cloning guide** - Reference audio upload
- ✅ **Error handling** - Status codes and responses
- ✅ **Rate limiting info** - Quota and throttling details
- ✅ **OpenAudio integration** - Direct TTS documentation

Enjoy beautiful, modern API documentation! 🚀
### Deploy to GitHub Pages

```bash
# 1. Build the documentation
scalar build docs/scalar/openapi.yaml --out docs

# 2. Commit and push
git add docs/
git commit -m "docs: update API documentation"
git push

# 3. Enable GitHub Pages in repository settings
# Settings → Pages → Source: Deploy from a branch → main → /docs
```

## 🎨 Scalar Features Used

### OpenAPI Extensions

Our specification uses Scalar-specific extensions for enhanced documentation:

#### 1. **Code Samples** (`x-codeSamples`)
Custom code examples in multiple languages for each endpoint:

```yaml
paths:
  /v1/generate:
    post:
      x-codeSamples:
        - lang: cURL
          label: Basic Request
          source: |
            curl -X POST ...
        - lang: Python
          label: Python Example
          source: |
            import requests ...
```

#### 2. **SDK Installation** (`x-scalar-sdk-installation`)
Installation instructions for different platforms:

```yaml
info:
  x-scalar-sdk-installation:
    - lang: Python
      description: Install required packages
      source: pip install requests httpx
```

#### 3. **Display Names** (`x-displayName`)
Friendly names for tags with emojis:

```yaml
tags:
  - name: Generation
    x-displayName: 🤖 Text Generation
```

#### 4. **WebSocket Support** (`x-scalar-websocket`)
Mark WebSocket endpoints:

```yaml
/v1/generate_ws:
  get:
    x-scalar-websocket: true
```

### Configuration Options

The `scalar.config.json` file provides customization:

```json
{
  "theme": "default",
  "layout": "modern",
  "darkMode": true,
  "authentication": {
    "preferredSecurityScheme": "ApiKeyAuth"
  },
  "metadata": {
    "title": "GemmaVoice Speech API",
    "ogImage": "https://example.com/og-image.png"
  }
}
```

**Available Layouts:**
- `modern` - Clean, contemporary design (recommended)
- `default` - Classic three-column layout

**Themes:**
- `default` - Scalar's default theme
- Custom CSS can be injected via `customCss` field

## 📝 Keeping Documentation Fresh

### 1. Update Schemas

When request/response models change:

```yaml
components:
  schemas:
    YourNewSchema:
      type: object
      properties:
        field_name:
          type: string
          description: Clear description
          example: sample_value
```

### 2. Add New Endpoints

For new REST routes:

```yaml
paths:
  /v1/new-endpoint:
    post:
      tags:
        - YourTag
      summary: Short description
      description: |
        Detailed markdown description
      x-codeSamples:
        - lang: cURL
          source: ...
```

### 3. Document Voice Cloning Features

Include examples showing `references` parameter:

```yaml
examples:
  voiceCloning:
    value:
      text: "Sample text"
      references: ["base64_audio_1", "base64_audio_2"]
```

### 4. Add Code Samples

Provide examples in multiple languages:
- **cURL** - For testing and CLI users
- **Python** - requests/httpx examples
- **JavaScript** - fetch/axios examples

## 🔍 Best Practices

### Security Documentation

✅ **DO:**
- Document all security requirements clearly
- Provide example API keys (non-functional)
- Explain rate limiting behavior
- Show error responses

❌ **DON'T:**
- Include real API keys in examples
- Skip error response documentation
- Forget to document authentication headers

### Example Quality

✅ **DO:**
- Use realistic, meaningful examples
- Show complete request/response cycles
- Include edge cases and error scenarios
- Provide copy-paste ready code

❌ **DON'T:**
- Use generic "foo/bar" examples
- Skip optional parameters
- Forget to encode binary data properly

### Description Writing

✅ **DO:**
- Use Markdown for formatting
- Include use cases
- Explain when to use each parameter
- Link related endpoints

❌ **DON'T:**
- Write vague descriptions
- Use jargon without explanation
- Skip parameter constraints

## 🛠️ Customization Examples

### Custom Branding

Update `scalar.config.json`:

```json
{
  "customCss": ".scalar-app { --scalar-color-1: #your-brand-color; }",
  "metadata": {
    "ogImage": "https://yourdomain.com/api-preview.png",
    "favicon": "/favicon.ico"
  }
}
```

### Multiple Environments

Add environment-specific servers:

```yaml
servers:
  - url: http://localhost:8000
    description: Local Development
  - url: https://staging-api.example.com
    description: Staging Environment
  - url: https://api.example.com
    description: Production
```

### Custom OAuth Configuration

For OAuth2 authentication:

```yaml
components:
  securitySchemes:
    OAuth2:
      type: oauth2
      flows:
        authorizationCode:
          authorizationUrl: https://auth.example.com/oauth/authorize
          tokenUrl: https://auth.example.com/oauth/token
          scopes:
            read: Read access
            write: Write access
```

## 🧪 Testing the Documentation

### Validate OpenAPI Spec

```bash
# Using Scalar CLI
scalar document lint docs/scalar/openapi.yaml

# Using Redocly CLI
npx @redocly/cli lint docs/scalar/openapi.yaml

# Using Spectral
npm install -g @stoplight/spectral-cli
spectral lint docs/scalar/openapi.yaml
```

### Test Code Examples

Ensure all code samples work:

```bash
# Test cURL examples
bash docs/scalar/examples/test-curl.sh

# Test Python examples
python docs/scalar/examples/test-python.py

# Test JavaScript examples
node docs/scalar/examples/test-javascript.js
```

## 📚 Additional Resources

- [Scalar Documentation](https://github.com/scalar/scalar)
- [OpenAPI Specification](https://spec.openapis.org/oas/latest.html)
- [Scalar Extensions](https://github.com/scalar/scalar#openapi-extensions)
- [API Design Best Practices](https://github.com/microsoft/api-guidelines)

## 🆘 Troubleshooting

### Preview Not Loading

```bash
# Clear Scalar cache
rm -rf ~/.scalar/cache

# Reinstall Scalar CLI
npm uninstall -g @scalar/cli
npm install -g @scalar/cli
```

### Build Errors

```bash
# Validate YAML syntax
npx js-yaml docs/scalar/openapi.yaml

# Check for schema errors
scalar document lint docs/scalar/openapi.yaml --rule docs/scalar/.spectral.yaml
```

### Code Samples Not Showing

Ensure proper syntax:
```yaml
x-codeSamples:
  - lang: Python  # Capital P
    label: Example Name
    source: |-
      # Use literal block scalar (|-)
      import requests
```

## 📄 License

This documentation follows the same license as the main project (MIT).

