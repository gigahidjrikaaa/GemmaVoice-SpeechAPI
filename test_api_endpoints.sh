#!/bin/bash
# API Endpoint Test Script
# Tests all major endpoints on new ports (21250 for Gemma, 21251 for OpenAudio)

echo "========================================="
echo "API ENDPOINT TESTS - NEW PORT CONFIGURATION"
echo "========================================="
echo ""

# Test 1: Health Check
echo "1. Testing Health Endpoint (Port 21250)"
echo "   curl http://localhost:21250/health/live"
curl -s http://localhost:21250/health/live
echo -e "\n"

# Test 2: Generate Text (Synchronous)
echo "2. Testing Generate Endpoint (Synchronous)"
echo "   curl -X POST http://localhost:21250/v1/generate ..."
curl -s -X POST http://localhost:21250/v1/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Hello, world!", "max_tokens": 20}'
echo -e "\n"

# Test 3: Text-to-Speech
echo "3. Testing Text-to-Speech Endpoint"
echo "   curl -X POST http://localhost:21250/v1/text-to-speech ..."
TTS_RESPONSE=$(curl -s -X POST http://localhost:21250/v1/text-to-speech \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello from OpenAudio", "response_format": "mp3"}')

if echo "$TTS_RESPONSE" | grep -q "audio_base64"; then
  AUDIO_LENGTH=$(echo "$TTS_RESPONSE" | grep -o '"audio_base64":"[^"]*"' | wc -c)
  echo "   ✓ TTS successful (audio_base64 field present, ~$AUDIO_LENGTH chars)"
else
  echo "   ✗ TTS failed or returned unexpected format"
  echo "   Response: $TTS_RESPONSE"
fi
echo ""

# Test 4: API Documentation
echo "4. Testing API Documentation"
echo "   Swagger UI: http://localhost:21250/docs"
DOCS_CHECK=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:21250/docs)
if [ "$DOCS_CHECK" = "200" ]; then
  echo "   ✓ Documentation available"
else
  echo "   ✗ Documentation not available (HTTP $DOCS_CHECK)"
fi
echo ""

echo "========================================="
echo "TEST SUMMARY"
echo "========================================="
echo "Gemma Service Port: 21250"
echo "OpenAudio Service Port: 21251 (proxied through Gemma)"
echo "Frontend Dev Server: http://localhost:5174"
echo ""
echo "All tests completed!"
