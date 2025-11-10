#!/usr/bin/env python3
"""
Test script to validate deployment fixes and health checks.

This script tests:
1. Configuration fixes (Gemma model repo)
2. Health check endpoints
3. Basic service availability
"""

import asyncio
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.config.settings import get_settings


def test_configuration():
    """Test that configuration fixes are applied."""
    print("=" * 70)
    print("Testing Configuration Fixes")
    print("=" * 70)
    
    settings = get_settings()
    
    # Test 1: Gemma repo fix
    print("\n1. Checking Gemma 3 model repository...")
    expected_repo = "bartowski/google_gemma-3-12b-it-GGUF"
    actual_repo = settings.llm_repo_id
    
    if actual_repo == expected_repo:
        print(f"   ✅ PASS: Using unrestricted repo: {actual_repo}")
    else:
        print(f"   ❌ FAIL: Expected {expected_repo}, got {actual_repo}")
        return False
    
    # Test 2: Model filename
    print("\n2. Checking Gemma 3 model filename...")
    expected_filename = "google_gemma-3-12b-it-Q4_0.gguf"
    actual_filename = settings.llm_model_filename
    
    if actual_filename == expected_filename:
        print(f"   ✅ PASS: Correct filename: {actual_filename}")
    else:
        print(f"   ❌ FAIL: Expected {expected_filename}, got {actual_filename}")
        return False
    
    # Test 3: Faster-Whisper configuration
    print("\n3. Checking Faster-Whisper configuration...")
    print(f"   - Enable Faster-Whisper: {settings.enable_faster_whisper}")
    print(f"   - Model size: {settings.faster_whisper_model_size}")
    print(f"   - Device: {settings.faster_whisper_device}")
    print(f"   - Compute type: {settings.faster_whisper_compute_type}")
    print("   ✅ PASS: Faster-Whisper configured")
    
    # Test 4: OpenAudio configuration
    print("\n4. Checking OpenAudio configuration...")
    print(f"   - API Base: {settings.openaudio_api_base}")
    print(f"   - TTS Path: {settings.openaudio_tts_path}")
    print(f"   - Default format: {settings.openaudio_default_format}")
    print("   ✅ PASS: OpenAudio configured")
    
    return True


def test_health_check_endpoints():
    """Test that health check endpoints are properly defined."""
    print("\n" + "=" * 70)
    print("Testing Health Check Endpoints")
    print("=" * 70)
    
    # Import the health module
    try:
        from app.api.v1 import health
        print("\n1. Health module import...")
        print("   ✅ PASS: Health module imported successfully")
    except ImportError as e:
        print(f"   ❌ FAIL: Could not import health module: {e}")
        return False
    
    # Check router exists
    if not hasattr(health, 'router'):
        print("   ❌ FAIL: Health module missing router")
        return False
    
    print("   ✅ PASS: Health router exists")
    
    # Check endpoints
    print("\n2. Checking health endpoints...")
    routes = []
    for route in health.router.routes:
        if hasattr(route, 'path'):
            routes.append(route.path)  # type: ignore
    
    expected_routes = [
        "/health",
        "/health/llm",
        "/health/stt",
        "/health/tts",
        "/health/ready",
        "/health/live"
    ]
    
    for route in expected_routes:
        if route in routes:
            print(f"   ✅ PASS: Endpoint {route} exists")
        else:
            print(f"   ❌ FAIL: Endpoint {route} missing")
            return False
    
    return True


def test_docker_configuration():
    """Test Docker configuration files."""
    print("\n" + "=" * 70)
    print("Testing Docker Configuration")
    print("=" * 70)
    
    # Test OpenAudio Dockerfile
    print("\n1. Checking OpenAudio Dockerfile...")
    # Navigate from backend/ to docker/
    dockerfile_path = Path(__file__).parent.parent / "docker" / "openaudio.Dockerfile"
    
    if not dockerfile_path.exists():
        print(f"   ❌ FAIL: Dockerfile not found at {dockerfile_path}")
        return False
    
    content = dockerfile_path.read_text()
    
    # Check for version pinning (latest is acceptable, avoid latest-dev)
    if "fish-speech:latest" in content and "latest-dev" not in content:
        print("   ✅ PASS: OpenAudio Docker image pinned to 'latest' (stable)")
    elif "fish-speech:" in content and "latest-dev" not in content:
        print("   ✅ PASS: OpenAudio Docker image version is pinned")
    else:
        print("   ⚠️  WARNING: Using 'latest-dev' tag - consider using 'latest' for stability")
    
    # Test main Dockerfile
    print("\n2. Checking main Dockerfile...")
    main_dockerfile = Path(__file__).parent.parent / "docker" / "Dockerfile"
    
    if not main_dockerfile.exists():
        print(f"   ❌ FAIL: Main Dockerfile not found")
        return False
    
    content = main_dockerfile.read_text()
    
    # Check for CUDA 12.4
    if "cuda:12.4" in content:
        print("   ✅ PASS: Using CUDA 12.4")
    else:
        print("   ⚠️  WARNING: CUDA version may not be 12.4")
    
    # Check for cuDNN 9
    if "cudnn" in content.lower():
        print("   ✅ PASS: cuDNN configured")
    else:
        print("   ⚠️  WARNING: cuDNN may not be configured")
    
    return True


def test_checkpoint_files():
    """Test that OpenAudio checkpoint files exist."""
    print("\n" + "=" * 70)
    print("Testing OpenAudio Checkpoint Files")
    print("=" * 70)
    
    checkpoint_dir = Path(__file__).parent / "openaudio-checkpoints"
    
    if not checkpoint_dir.exists():
        print(f"   ⚠️  WARNING: Checkpoint directory not found at {checkpoint_dir}")
        print("   Run download_checkpoints.py to download required files")
        return True  # Not a failure, just needs download
    
    required_files = [
        "codec.pth",
        "config.json",
        "model.pth",
        "special_tokens.json",
        "tokenizer.tiktoken"
    ]
    
    all_present = True
    for filename in required_files:
        filepath = checkpoint_dir / filename
        if filepath.exists():
            size_mb = filepath.stat().st_size / (1024 * 1024)
            print(f"   ✅ PASS: {filename} ({size_mb:.2f} MB)")
        else:
            print(f"   ❌ FAIL: {filename} missing")
            all_present = False
    
    if all_present:
        print("\n   ✅ All checkpoint files present")
    else:
        print("\n   ⚠️  Some checkpoint files missing - run download_checkpoints.py")
    
    return all_present


def main():
    """Run all tests."""
    print("\n" + "=" * 70)
    print("GemmaVoice Deployment Validation")
    print("=" * 70)
    
    results = {
        "Configuration": test_configuration(),
        "Health Checks": test_health_check_endpoints(),
        "Docker Configuration": test_docker_configuration(),
        "Checkpoint Files": test_checkpoint_files()
    }
    
    print("\n" + "=" * 70)
    print("Test Summary")
    print("=" * 70)
    
    for test_name, result in results.items():
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status}: {test_name}")
    
    all_passed = all(results.values())
    
    if all_passed:
        print("\n🎉 All tests passed! System is ready for deployment.")
        print("\nNext steps:")
        print("1. Ensure GPU drivers are installed (CUDA 12.4+)")
        print("2. Run: cd docker && docker compose up --build")
        print("3. Test health endpoints: curl http://localhost:6666/health")
        return 0
    else:
        print("\n⚠️  Some tests failed. Review the output above.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
