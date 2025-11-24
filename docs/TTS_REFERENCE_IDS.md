# Text-to-Speech Reference IDs

## Overview
The `reference_id` parameter in TTS requests allows you to specify different voice presets or voice cloning references. This parameter is optional and will use the default voice if not specified.

## Available Reference IDs

### Default Voice
- **ID**: `default` or leave empty
- **Description**: The base voice model without any specific reference
- **Usage**: Best for general-purpose speech synthesis

### Custom Reference IDs
Reference IDs can be any string identifier that you configure in your OpenAudio system. Common examples include:

- `voice_1`, `voice_2`, `voice_3` - Numbered voice presets
- `demo`, `demo-ref` - Demo/test voices
- `male_1`, `female_1` - Gender-specific voices
- Any custom string you define

## Configuration

The system default reference ID is configured via the environment variable:
```bash
OPENAUDIO_DEFAULT_REFERENCE_ID=default
```

## Voice Cloning Alternative

Instead of using pre-configured reference IDs, you can use **voice cloning** by providing reference audio samples:

1. Encode your reference audio using `/v1/encode-reference`
2. Use the returned `reference_base64` in the `references` array parameter
3. Do NOT set `reference_id` when using voice cloning - the two are mutually exclusive

## Example Usage

### Using a Reference ID:
```bash
curl -X POST http://localhost:6666/v1/text-to-speech \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello! This is a test.",
    "reference_id": "default",
    "format": "wav"
  }'
```

### Using Voice Cloning (No Reference ID):
```bash
curl -X POST http://localhost:6666/v1/text-to-speech \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello! This is a test.",
    "references": ["<base64_audio_data>"],
    "format": "wav"
  }'
```

## Notes

- If you don't have specific voice references configured in your OpenAudio service, use `"default"` or omit the parameter entirely
- The OpenAudio service determines which voices are available
- Reference IDs are case-sensitive
- When using voice cloning (`references` array), do not specify a `reference_id`
