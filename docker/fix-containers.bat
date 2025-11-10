@echo off
REM Script to clear HuggingFace cache and rebuild containers
REM This fixes the "416 Requested Range Not Satisfiable" error

echo 🧹 Clearing HuggingFace cache...
echo.

REM Stop containers
echo Stopping Docker containers...
cd docker
docker compose down

echo.
echo Clearing HuggingFace cache from host...
echo.

REM Clear the corrupted model cache from Windows host
REM The cache path on Windows is %USERPROFILE%\.cache\huggingface
if exist "%USERPROFILE%\.cache\huggingface\hub\models--bartowski--google_gemma-3-12b-it-GGUF" (
    echo Removing corrupted model cache...
    rmdir /s /q "%USERPROFILE%\.cache\huggingface\hub\models--bartowski--google_gemma-3-12b-it-GGUF"
    echo ✅ Cache cleared!
) else (
    echo ℹ️  Model cache doesn't exist, skipping...
)

echo.
echo 🔨 Rebuilding containers...
echo.

REM Rebuild with no cache to ensure fresh builds
docker compose build --no-cache openaudio-service
docker compose build gemma-service

echo.
echo ✅ Containers rebuilt!
echo.
echo 🚀 Starting services...
docker compose up -d

echo.
echo ✅ Done! Services are starting up...
echo.
echo 📊 Monitor logs with:
echo    docker compose logs -f gemma-service
echo    docker compose logs -f openaudio-service
echo.
pause
