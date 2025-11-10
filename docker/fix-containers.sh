#!/bin/bash
# Script to clear HuggingFace cache and rebuild containers
# This fixes the "416 Requested Range Not Satisfiable" error

set -e

echo "🧹 Clearing HuggingFace cache..."

# Stop containers
echo "Stopping Docker containers..."
cd docker
docker compose down

# Remove HuggingFace cache from the Gemma service container
echo "Clearing HuggingFace cache volume..."
docker volume rm -f docker_huggingface_cache 2>/dev/null || echo "Volume doesn't exist, skipping..."

# Alternative: Clear cache from host if mounted
# Uncomment if you're mounting a local cache directory
# rm -rf ~/.cache/huggingface/hub/models--bartowski--google_gemma-3-12b-it-GGUF

echo "✅ Cache cleared!"
echo ""
echo "🔨 Rebuilding containers..."

# Rebuild with no cache to ensure fresh builds
docker compose build --no-cache openaudio-service
docker compose build gemma-service

echo "✅ Containers rebuilt!"
echo ""
echo "🚀 Starting services..."
docker compose up -d

echo ""
echo "✅ Done! Services are starting up..."
echo "📊 Monitor logs with:"
echo "   docker compose logs -f gemma-service"
echo "   docker compose logs -f openaudio-service"
