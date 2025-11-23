import asyncio
import httpx
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

OPENAUDIO_API_BASE = os.getenv("OPENAUDIO_API_BASE", "http://localhost:21251")
OPENAUDIO_TTS_PATH = os.getenv("OPENAUDIO_TTS_PATH", "/v1/tts")

async def test_openaudio_connection():
    print(f"Testing connection to OpenAudio at {OPENAUDIO_API_BASE}...")
    async with httpx.AsyncClient(base_url=OPENAUDIO_API_BASE, timeout=5.0) as client:
        try:
            # Try health check first if available, otherwise just check if we can connect
            # The official fish-speech api has /v1/health or similar, but let's try root or just a simple request
            response = await client.get("/v1/health")
            print(f"Health check status: {response.status_code}")
            print(f"Health check response: {response.text}")
        except httpx.ConnectError:
            print("❌ Failed to connect to OpenAudio server. Is it running?")
        except Exception as e:
            print(f"❌ An error occurred: {e}")

if __name__ == "__main__":
    asyncio.run(test_openaudio_connection())
