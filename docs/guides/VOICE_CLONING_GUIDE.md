# 🎤 Voice Cloning Guide for OpenAudio-S1-mini

**Complete guide to use your own voice reference for Bahasa Indonesia TTS**

---

## 📋 Overview

OpenAudio-S1-mini supports **voice cloning** with custom reference audio. This is essential for:
- ✅ Bahasa Indonesia synthesis (limited pre-trained voices)
- ✅ Custom speaker identity
- ✅ Matching specific voice characteristics (tone, accent, speaking style)

There are **two methods** to provide reference audio:

### Method 1: **Inline Base64** (Recommended for API calls)
- Send base64-encoded audio directly in each API request
- No server-side storage needed
- Best for dynamic voice selection

### Method 2: **Reference ID** (Recommended for Docker/Production)
- Store reference audio files on the server
- Use `reference_id` to reference them
- Best for frequently-used voices

---

## 🎯 Method 1: Inline Base64 Reference Audio

### Step 1: Prepare Your Reference Audio

**Requirements:**
- **Duration**: 3-10 seconds (optimal: 5-7 seconds)
- **Format**: WAV, MP3, FLAC, or OGG
- **Quality**: Clean speech, minimal background noise
- **Content**: Natural speech in Bahasa Indonesia
- **Sample Rate**: 24kHz or 44.1kHz recommended

**Tips for best results:**
- Use a quiet room
- Speak naturally (not reading/robotic)
- Include varied intonation
- Avoid music or other speakers

### Step 2: Convert Audio to Base64

**Using Python:**

```python
import base64

def audio_to_base64(audio_path: str) -> str:
    """Convert audio file to base64 string."""
    with open(audio_path, "rb") as f:
        audio_bytes = f.read()
    return base64.b64encode(audio_bytes).decode("utf-8")

# Example
reference_b64 = audio_to_base64("my_voice_bahasa.wav")
print(f"Base64 length: {len(reference_b64)} characters")
```

**Using bash/PowerShell:**

```bash
# Linux/macOS
base64 -w 0 my_voice_bahasa.wav > reference.txt

# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("my_voice_bahasa.wav")) | Out-File reference.txt
```

### Step 3: Make API Request with Reference Audio

**Using curl:**

```bash
# Read base64 from file
REFERENCE_AUDIO=$(cat reference.txt)

# Send TTS request with reference
curl -X POST http://localhost:6666/v1/text-to-speech \
  -H "Content-Type: application/json" \
  -d "{
    \"text\": \"Selamat pagi, bagaimana kabar Anda hari ini?\",
    \"format\": \"wav\",
    \"references\": [\"${REFERENCE_AUDIO}\"],
    \"normalize\": true,
    \"sample_rate\": 24000
  }" \
  | jq -r '.audio_base64' | base64 -d > output_cloned.wav
```

**Using Python (requests):**

```python
import requests
import base64

# Load your reference audio
with open("my_voice_bahasa.wav", "rb") as f:
    reference_audio = base64.b64encode(f.read()).decode("utf-8")

# Make TTS request
response = requests.post(
    "http://localhost:6666/v1/text-to-speech",
    json={
        "text": "Selamat pagi, bagaimana kabar Anda hari ini?",
        "format": "wav",
        "references": [reference_audio],  # List of base64 strings
        "normalize": True,
        "sample_rate": 24000,
    }
)

# Save output audio
if response.status_code == 200:
    result = response.json()
    audio_bytes = base64.b64decode(result["audio_base64"])
    with open("output_cloned.wav", "wb") as f:
        f.write(audio_bytes)
    print("✓ Voice cloned successfully!")
else:
    print(f"Error: {response.status_code} - {response.text}")
```

**Using Frontend (React/TypeScript):**

```typescript
// Upload reference audio file
const handleVoiceCloning = async (
  text: string,
  referenceFile: File
) => {
  // Convert file to base64
  const reader = new FileReader();
  const referenceBase64 = await new Promise<string>((resolve) => {
    reader.onload = () => {
      const base64 = reader.result as string;
      // Remove data URL prefix (data:audio/wav;base64,)
      const base64Audio = base64.split(',')[1];
      resolve(base64Audio);
    };
    reader.readAsDataURL(referenceFile);
  });

  // Make TTS request
  const response = await fetch('http://localhost:6666/v1/text-to-speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      format: 'wav',
      references: [referenceBase64],
      normalize: true,
      sample_rate: 24000,
    }),
  });

  const result = await response.json();
  
  // Play or download the audio
  const audioBlob = new Blob(
    [Uint8Array.from(atob(result.audio_base64), c => c.charCodeAt(0))],
    { type: result.media_type }
  );
  const audioUrl = URL.createObjectURL(audioBlob);
  
  return audioUrl;
};
```

---

## 🗄️ Method 2: Server-Side Reference Storage (Reference ID)

### Step 1: Create Reference Audio Directory

```bash
cd backend

# Create directory for reference voices
mkdir -p reference-voices

# Add your Bahasa Indonesia reference audio
cp ~/my_voice_bahasa.wav reference-voices/bahasa_voice_1.wav
```

### Step 2: Update OpenAudio Dockerfile

Edit `openaudio.Dockerfile` to mount reference voices:

```dockerfile
# Copy the local OpenAudio-S1-mini checkpoints
COPY backend/openaudio-checkpoints/ /app/checkpoints/OpenAudio-S1-mini/

# Copy reference voice files
COPY backend/reference-voices/ /app/references/

# Set environment variables
ENV REFERENCE_DIR=/app/references
```

### Step 3: Update docker-compose.yml

Add volume mount for reference voices:

```yaml
services:
  openaudio_api:
    build:
      context: ..
      dockerfile: backend/openaudio.Dockerfile
    volumes:
      # Mount reference voices (hot-reload without rebuild)
      - ./reference-voices:/app/references:ro
    environment:
      - MODEL_NAME=OpenAudio-S1-mini
      - REFERENCE_DIR=/app/references
```

### Step 4: Configure Default Reference in .env

Edit `backend/.env`:

```bash
# Default reference voice for TTS
OPENAUDIO_DEFAULT_REFERENCE_ID=bahasa_voice_1

# Or leave empty to require explicit reference in each request
# OPENAUDIO_DEFAULT_REFERENCE_ID=
```

### Step 5: Use Reference ID in API Calls

**With default reference (set in .env):**

```bash
# Uses OPENAUDIO_DEFAULT_REFERENCE_ID automatically
curl -X POST http://localhost:6666/v1/text-to-speech \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Selamat pagi, bagaimana kabar Anda hari ini?",
    "format": "wav"
  }' \
  | jq -r '.audio_base64' | base64 -d > output.wav
```

**With explicit reference_id:**

```bash
curl -X POST http://localhost:6666/v1/text-to-speech \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Selamat siang, apa kabar?",
    "format": "wav",
    "reference_id": "bahasa_voice_2"
  }' \
  | jq -r '.audio_base64' | base64 -d > output.wav
```

**Note:** The `reference_id` implementation depends on how fish-speech handles reference storage. You may need to check the fish-speech documentation for the exact API.

---

## 🔧 Advanced: Multiple Reference Voices

You can provide **multiple reference audio samples** to improve voice consistency:

```python
import base64

# Load multiple reference samples (different intonations/emotions)
references = []
for i in range(1, 4):
    with open(f"reference_{i}.wav", "rb") as f:
        ref_b64 = base64.b64encode(f.read()).decode("utf-8")
        references.append(ref_b64)

# Send request with multiple references
response = requests.post(
    "http://localhost:6666/v1/text-to-speech",
    json={
        "text": "Halo, nama saya adalah asisten AI",
        "format": "wav",
        "references": references,  # Multiple base64 samples
        "normalize": True,
    }
)
```

**Benefits:**
- Better voice quality
- More consistent timbre
- Handles different speaking styles

---

## 🎛️ Fine-Tuning Parameters

### `normalize` (Boolean, default: true)
- Normalizes output audio loudness
- Recommended for consistent volume across generations

### `top_p` (Float, 0.0-1.0, default: 0.95)
- Nucleus sampling parameter
- Lower values (0.7-0.8): More consistent, less variation
- Higher values (0.95-1.0): More natural, more variation

### `sample_rate` (Integer, default: 24000)
- Output audio sample rate in Hz
- Options: 16000, 22050, 24000, 44100, 48000
- Higher = better quality but larger files

**Example with tuning:**

```json
{
  "text": "Selamat pagi, bagaimana kabar Anda hari ini?",
  "format": "wav",
  "references": ["<base64_audio>"],
  "normalize": true,
  "top_p": 0.85,
  "sample_rate": 44100
}
```

---

## 🧪 Testing Your Voice Clone

### Test Script

Create `test_voice_clone.py`:

```python
#!/usr/bin/env python3
"""Test voice cloning with Bahasa Indonesia reference audio."""

import requests
import base64
import sys
from pathlib import Path

def test_voice_clone(reference_path: str, text: str, output_path: str):
    """Test TTS with custom voice reference."""
    
    print(f"📤 Loading reference audio: {reference_path}")
    with open(reference_path, "rb") as f:
        reference_b64 = base64.b64encode(f.read()).decode("utf-8")
    
    print(f"🎤 Synthesizing text: {text[:50]}...")
    response = requests.post(
        "http://localhost:6666/v1/text-to-speech",
        json={
            "text": text,
            "format": "wav",
            "references": [reference_b64],
            "normalize": True,
            "sample_rate": 24000,
        },
        timeout=120,
    )
    
    if response.status_code != 200:
        print(f"❌ Error {response.status_code}: {response.text}")
        sys.exit(1)
    
    result = response.json()
    audio_bytes = base64.b64decode(result["audio_base64"])
    
    print(f"💾 Saving output: {output_path}")
    with open(output_path, "wb") as f:
        f.write(audio_bytes)
    
    print(f"✅ Success! Generated {len(audio_bytes)} bytes")
    print(f"   Format: {result['response_format']}")
    print(f"   Sample Rate: {result['sample_rate']} Hz")
    print(f"   MIME Type: {result['media_type']}")

if __name__ == "__main__":
    test_voice_clone(
        reference_path="reference-voices/bahasa_voice_1.wav",
        text="Selamat pagi, saya adalah asisten AI yang dapat berbicara dalam bahasa Indonesia dengan suara Anda.",
        output_path="test_output_cloned.wav"
    )
```

Run test:

```bash
python test_voice_clone.py
```

---

## 🌐 WebSocket Streaming with Voice Cloning

For real-time TTS with voice cloning:

```python
import asyncio
import websockets
import base64
import json

async def stream_voice_clone():
    # Load reference audio
    with open("reference-voices/bahasa_voice_1.wav", "rb") as f:
        reference_b64 = base64.b64encode(f.read()).decode("utf-8")
    
    uri = "ws://localhost:6666/v1/text-to-speech/ws"
    
    async with websockets.connect(uri) as websocket:
        # Send synthesis request
        await websocket.send(json.dumps({
            "text": "Halo, ini adalah tes streaming dengan voice cloning",
            "format": "wav",
            "references": [reference_b64],
            "stream": True,
        }))
        
        # Receive audio chunks
        audio_chunks = []
        async for message in websocket:
            data = json.loads(message)
            
            if data.get("event") == "chunk":
                chunk_b64 = data.get("data", "")
                audio_chunks.append(base64.b64decode(chunk_b64))
                print(".", end="", flush=True)
            
            elif data.get("event") == "done":
                print("\n✓ Streaming complete")
                break
        
        # Save complete audio
        full_audio = b"".join(audio_chunks)
        with open("streaming_output.wav", "wb") as f:
            f.write(full_audio)

asyncio.run(stream_voice_clone())
```

---

## ⚠️ Troubleshooting

### Issue: Voice doesn't match reference

**Solutions:**
1. Use longer reference audio (5-10 seconds)
2. Ensure reference audio is clean (no background noise)
3. Use multiple reference samples
4. Try different `top_p` values (0.7-0.95)
5. Ensure reference is in the same language as synthesis text

### Issue: Poor audio quality

**Solutions:**
1. Increase `sample_rate` to 44100 or 48000
2. Use higher quality reference audio (24kHz+ WAV/FLAC)
3. Enable `normalize: true`
4. Check OpenAudio service logs for errors

### Issue: Base64 payload too large

**Solutions:**
1. Use Method 2 (Reference ID) instead
2. Compress reference audio (use MP3 instead of WAV)
3. Trim reference to 5-7 seconds
4. Use lower sample rate for reference (16kHz sufficient)

### Issue: OpenAudio container fails to start

**Check logs:**
```bash
docker logs openaudio_api
```

**Common fixes:**
1. Verify checkpoints are complete (5 files)
2. Check GPU memory (needs ~10GB VRAM)
3. Rebuild with `docker compose build --no-cache`

---

## 📊 Best Practices Summary

| Aspect | Recommendation |
|--------|----------------|
| **Reference Duration** | 5-7 seconds |
| **Reference Quality** | 24kHz+ WAV/FLAC, clean speech |
| **Number of References** | 1-3 samples (varied intonation) |
| **Method Choice** | Base64 for dynamic, Reference ID for production |
| **Sample Rate** | 24000 Hz (balance of quality/size) |
| **Normalize** | Always `true` |
| **top_p** | 0.85-0.90 for most cases |

---

## 🚀 Quick Start Checklist

- [ ] Prepare 5-7 second Bahasa Indonesia voice sample
- [ ] Convert to base64 or save in `reference-voices/`
- [ ] Test with simple text: "Halo, apa kabar?"
- [ ] Verify output matches reference voice
- [ ] Integrate into your application
- [ ] Tune `top_p` and `sample_rate` if needed

---

## 📖 Related Documentation

- [LOCAL_SETUP_GUIDE.md](../LOCAL_SETUP_GUIDE.md) - Initial setup
- [fish-speech Documentation](https://github.com/fishaudio/fish-speech) - OpenAudio upstream
- [API Documentation](http://localhost:6666/docs) - Interactive API docs

---

**Need help?** Check the [Troubleshooting](#-troubleshooting) section or open an issue on GitHub.
