import requests
import json

BASE_URL = "http://localhost:21250"

def test_generate():
    print("Testing /v1/generate...")
    payload = {
        "prompt": "Hello, explain quantum physics in one sentence.",
        "max_tokens": 128,
        "temperature": 0.7
    }
    try:
        response = requests.post(f"{BASE_URL}/v1/generate", json=payload)
        print(f"Status: {response.status_code}")
        print(f"Response: {response.json()}")
    except Exception as e:
        print(f"Error: {e}")

def test_health():
    print("\nTesting /health/live...")
    try:
        response = requests.get(f"{BASE_URL}/health/live")
        print(f"Status: {response.status_code}")
        print(f"Response: {response.json()}")
    except Exception as e:
        print(f"Error: {e}")

def test_generate_with_template():
    print("\nTesting /v1/generate with Gemma 3 template...")
    prompt = "<start_of_turn>user\nHello, explain quantum physics in one sentence.<end_of_turn>\n<start_of_turn>model\n"
    payload = {
        "prompt": prompt,
        "max_tokens": 128,
        "temperature": 0.7
    }
    try:
        response = requests.post(f"{BASE_URL}/v1/generate", json=payload)
        print(f"Status: {response.status_code}")
        print(f"Response: {response.json()}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_health()
    test_generate()
    test_generate_with_template()
