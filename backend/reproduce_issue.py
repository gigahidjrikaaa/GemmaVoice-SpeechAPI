import requests
import json
import time

BASE_URL = "http://localhost:21250"

def run_test(name, payload):
    print(f"\n--- Test: {name} ---")
    print(f"Payload: {json.dumps(payload, indent=2)}")
    try:
        start = time.time()
        response = requests.post(f"{BASE_URL}/v1/generate", json=payload)
        duration = time.time() - start
        print(f"Status: {response.status_code}")
        print(f"Duration: {duration:.2f}s")
        try:
            print(f"Response: {json.dumps(response.json(), indent=2)}")
        except:
            print(f"Raw Response: {response.text}")
    except Exception as e:
        print(f"Error: {e}")

def main():
    # Test 1: Health Check
    print("\n--- Test: Health Check ---")
    try:
        resp = requests.get(f"{BASE_URL}/health/live")
        print(f"Status: {resp.status_code}")
        print(f"Response: {resp.json()}")
    except Exception as e:
        print(f"Error: {e}")

    # Test 2: Raw Prompt (Should be auto-templated by backend)
    run_test("Raw Prompt", {
        "prompt": "Halo!",
        "max_tokens": 128,
        "temperature": 0.7
    })

    # Test 3: Explicit Template
    run_test("Explicit Template", {
        "prompt": "<start_of_turn>user\nHello, explain quantum physics in one sentence.<end_of_turn>\n<start_of_turn>model\n",
        "max_tokens": 128,
        "temperature": 0.7
    })

    # Test 4: No Stop Tokens
    run_test("No Stop Tokens", {
        "prompt": "Halo!",
        "max_tokens": 128,
        "temperature": 0.7,
        "stop": []
    })

if __name__ == "__main__":
    main()
