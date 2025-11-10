"""
GemmaVoice API Python Examples

Complete integration examples for the GemmaVoice Speech API.
Requires: pip install requests httpx python-dotenv
"""

import os
import base64
import json
import requests
from typing import Optional, Dict, Any

# Load API configuration
API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000")
API_KEY = os.getenv("API_KEY", "your-api-key-here")

def get_headers() -> Dict[str, str]:
    """Get common request headers with API key."""
    return {
        "X-API-Key": API_KEY,
        "Content-Type": "application/json"
    }

# =============================================================================
# TEXT GENERATION
# =============================================================================

def generate_text(prompt: str, max_tokens: int = 512, temperature: float = 0.7) -> str:
    """
    Generate text using Gemma 3 LLM.
    
    Args:
        prompt: Input prompt for generation
        max_tokens: Maximum tokens to generate
        temperature: Sampling temperature (0.0-2.0)
    
    Returns:
        Generated text string
    """
    response = requests.post(
        f"{API_BASE_URL}/v1/generate",
        headers=get_headers(),
        json={
            "prompt": prompt,
            "max_tokens": max_tokens,
            "temperature": temperature
        }
    )
    response.raise_for_status()
    return response.json()["generated_text"]

# =============================================================================
# SPEECH-TO-TEXT
# =============================================================================

def transcribe_audio(
    audio_path: str,
    language: Optional[str] = None
) -> Dict[str, Any]:
    """
    Transcribe audio file using Whisper.
    
    Args:
        audio_path: Path to audio file (WAV, MP3, OGG, WebM)
        language: Optional language code (e.g., 'en', 'es')
    
    Returns:
        Transcription result with text and segments
    """
    with open(audio_path, 'rb') as audio_file:
        files = {'file': audio_file}
        data = {}
        if language:
            data['language'] = language
        
        response = requests.post(
            f"{API_BASE_URL}/v1/speech-to-text",
            headers={"X-API-Key": API_KEY},
            files=files,
            data=data
        )
        response.raise_for_status()
        return response.json()

# =============================================================================
# TEXT-TO-SPEECH
# =============================================================================

def synthesize_speech(
    text: str,
    output_path: str,
    format: str = "wav",
    sample_rate: int = 22050
) -> None:
    """
    Synthesize speech from text using OpenAudio.
    
    Args:
        text: Text to synthesize
        output_path: Path to save output audio file
        format: Audio format (wav, mp3, ogg, flac)
        sample_rate: Sample rate in Hz
    """
    response = requests.post(
        f"{API_BASE_URL}/v1/text-to-speech",
        headers=get_headers(),
        json={
            "text": text,
            "format": format,
            "sample_rate": sample_rate
        }
    )
    response.raise_for_status()
    
    result = response.json()
    audio_data = base64.b64decode(result['audio_base64'])
    
    with open(output_path, 'wb') as f:
        f.write(audio_data)
    
    print(f"✅ Audio saved to {output_path}")
    print(f"   Format: {result['response_format']}")
    print(f"   Sample rate: {result['sample_rate']} Hz")

# =============================================================================
# VOICE CLONING
# =============================================================================

def synthesize_with_voice_cloning(
    text: str,
    reference_audio_paths: list[str],
    output_path: str,
    format: str = "wav"
) -> None:
    """
    Synthesize speech with voice cloning using reference audio.
    
    Args:
        text: Text to synthesize
        reference_audio_paths: List of paths to reference audio files (3-10 sec each)
        output_path: Path to save output audio
        format: Audio format (wav, mp3, ogg, flac)
    """
    # Encode reference audio to base64
    references = []
    for ref_path in reference_audio_paths:
        with open(ref_path, 'rb') as f:
            ref_b64 = base64.b64encode(f.read()).decode('utf-8')
            references.append(ref_b64)
    
    response = requests.post(
        f"{API_BASE_URL}/v1/text-to-speech",
        headers=get_headers(),
        json={
            "text": text,
            "format": format,
            "references": references
        }
    )
    response.raise_for_status()
    
    result = response.json()
    audio_data = base64.b64decode(result['audio_base64'])
    
    with open(output_path, 'wb') as f:
        f.write(audio_data)
    
    print(f"✅ Voice-cloned audio saved to {output_path}")

# =============================================================================
# END-TO-END DIALOGUE
# =============================================================================

def run_dialogue(
    audio_path: str,
    output_path: str,
    instructions: str = "You are a helpful assistant",
    temperature: float = 0.7,
    max_tokens: int = 256
) -> Dict[str, Any]:
    """
    Run complete voice-to-voice dialogue pipeline.
    
    Args:
        audio_path: Path to user audio file
        output_path: Path to save assistant audio response
        instructions: System instructions for the AI
        temperature: LLM sampling temperature
        max_tokens: Maximum tokens for LLM response
    
    Returns:
        Complete dialogue result with transcript, text, and audio
    """
    with open(audio_path, 'rb') as audio_file:
        response = requests.post(
            f"{API_BASE_URL}/v1/dialogue",
            headers={"X-API-Key": API_KEY},
            files={'file': audio_file},
            data={
                'instructions': instructions,
                'generation_config': json.dumps({
                    'temperature': temperature,
                    'max_tokens': max_tokens
                }),
                'synthesis_config': json.dumps({
                    'format': 'wav'
                })
            }
        )
        response.raise_for_status()
    
    result = response.json()
    
    # Save assistant audio
    audio_data = base64.b64decode(result['audio_base64'])
    with open(output_path, 'wb') as f:
        f.write(audio_data)
    
    print(f"🎙️ User said: {result['transcript']['text']}")
    print(f"🤖 AI replied: {result['response_text']}")
    print(f"🔊 Audio saved to {output_path}")
    
    return result

# =============================================================================
# EXAMPLE USAGE
# =============================================================================

if __name__ == "__main__":
    print("🚀 GemmaVoice API Examples\n")
    
    # Example 1: Text Generation
    print("1️⃣ Text Generation")
    text = generate_text("Write a haiku about AI", max_tokens=50)
    print(f"Generated: {text}\n")
    
    # Example 2: Speech-to-Text
    print("2️⃣ Speech-to-Text")
    # transcript = transcribe_audio("user_audio.wav", language="en")
    # print(f"Transcript: {transcript['text']}\n")
    
    # Example 3: Text-to-Speech
    print("3️⃣ Text-to-Speech")
    # synthesize_speech("Hello from GemmaVoice!", "output.wav")
    
    # Example 4: Voice Cloning
    print("4️⃣ Voice Cloning")
    # synthesize_with_voice_cloning(
    #     "This will sound like the reference voice",
    #     ["reference1.wav", "reference2.wav"],
    #     "cloned_output.wav"
    # )
    
    # Example 5: Complete Dialogue
    print("5️⃣ End-to-End Dialogue")
    # result = run_dialogue(
    #     "user_question.wav",
    #     "assistant_reply.wav",
    #     instructions="You are a friendly assistant"
    # )
    
    print("✅ All examples completed!")
