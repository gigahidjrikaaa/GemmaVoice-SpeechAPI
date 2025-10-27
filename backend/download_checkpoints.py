#!/usr/bin/env python3
"""
Download OpenAudio-S1-mini checkpoints from HuggingFace.

This script downloads all required checkpoint files for OpenAudio-S1-mini
directly into the openaudio-checkpoints/ directory.

Usage:
    python download_checkpoints.py

You'll be prompted to enter your HuggingFace token on first run.
Get your token from: https://huggingface.co/settings/tokens
"""

import os
from pathlib import Path
from huggingface_hub import hf_hub_download, login

# Configuration
REPO_ID = "fishaudio/openaudio-s1-mini"
LOCAL_DIR = Path(__file__).parent / "openaudio-checkpoints"
FILES_TO_DOWNLOAD = [
    "codec.pth",
    "config.json",
    "model.pth",
    "special_tokens.json",
    "tokenizer.tiktoken",
]


def main():
    print("=" * 70)
    print("OpenAudio-S1-mini Checkpoint Downloader")
    print("=" * 70)
    print()
    
    # Ensure local directory exists
    LOCAL_DIR.mkdir(exist_ok=True)
    print(f"📁 Download directory: {LOCAL_DIR.absolute()}")
    print()
    
    # Check if user is already logged in
    try:
        from huggingface_hub import whoami
        user_info = whoami()
        print(f"✓ Already logged in as: {user_info['name']}")
        print()
    except Exception:
        print("⚠️  Not logged in to HuggingFace")
        print()
        print("Please enter your HuggingFace token.")
        print("Get it from: https://huggingface.co/settings/tokens")
        print("(Create a token with 'read' permissions)")
        print()
        
        token = input("Enter your HuggingFace token: ").strip()
        if not token:
            print("❌ No token provided. Exiting.")
            return
        
        try:
            login(token=token)
            print("✓ Login successful!")
            print()
        except Exception as e:
            print(f"❌ Login failed: {e}")
            return
    
    # Download each file
    print("📥 Downloading checkpoint files...")
    print(f"Repository: {REPO_ID}")
    print(f"Total files: {len(FILES_TO_DOWNLOAD)}")
    print()
    
    for i, filename in enumerate(FILES_TO_DOWNLOAD, 1):
        print(f"[{i}/{len(FILES_TO_DOWNLOAD)}] Downloading {filename}...", end=" ", flush=True)
        
        try:
            downloaded_path = hf_hub_download(
                repo_id=REPO_ID,
                filename=filename,
                local_dir=LOCAL_DIR,
                local_dir_use_symlinks=False,
            )
            
            # Get file size
            file_size = Path(downloaded_path).stat().st_size
            size_mb = file_size / (1024 * 1024)
            print(f"✓ ({size_mb:.1f} MB)")
            
        except Exception as e:
            print(f"❌ Failed: {e}")
            return
    
    print()
    print("=" * 70)
    print("✅ All checkpoint files downloaded successfully!")
    print("=" * 70)
    print()
    print("Files in openaudio-checkpoints/:")
    for file in sorted(LOCAL_DIR.glob("*")):
        if file.is_file():
            size_mb = file.stat().st_size / (1024 * 1024)
            print(f"  • {file.name:25s} ({size_mb:>8.1f} MB)")
    
    print()
    print("🚀 Next steps:")
    print("  1. Run: docker compose up --build")
    print("  2. Test: curl -X POST http://localhost:8080/v1/tts \\")
    print("           -H 'Content-Type: application/json' \\")
    print("           -d '{\"text\": \"Hello world\", \"format\": \"wav\"}' \\")
    print("           --output test.wav")
    print()


if __name__ == "__main__":
    main()
