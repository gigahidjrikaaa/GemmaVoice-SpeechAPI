@echo off
setlocal enabledelayedexpansion

:: Defaults
set HW_CHOICE=1
set ENV_CHOICE=1
set MON_CHOICE=1
set ACTION_CHOICE=1
set INTERACTIVE=true

:: Parse Arguments
:parse_args
if "%~1"=="" goto check_interactive
if "%~1"=="--dev" (
    set ENV_CHOICE=1
    set MON_CHOICE=1
    set INTERACTIVE=false
) else if "%~1"=="--prod" (
    set ENV_CHOICE=2
    set INTERACTIVE=false
) else if "%~1"=="--test" (
    set ENV_CHOICE=3
    set INTERACTIVE=false
) else if "%~1"=="--cpu" (
    set HW_CHOICE=2
    set INTERACTIVE=false
) else if "%~1"=="--gpu" (
    set HW_CHOICE=1
    set INTERACTIVE=false
) else if "%~1"=="--mon" (
    set MON_CHOICE=2
    set INTERACTIVE=false
) else if "%~1"=="--no-mon" (
    set MON_CHOICE=1
    set INTERACTIVE=false
) else if "%~1"=="--up" (
    set ACTION_CHOICE=1
    set INTERACTIVE=false
) else if "%~1"=="--down" (
    set ACTION_CHOICE=2
    set INTERACTIVE=false
) else if "%~1"=="--logs" (
    set ACTION_CHOICE=3
    set INTERACTIVE=false
) else if "%~1"=="--restart" (
    set ACTION_CHOICE=4
    set INTERACTIVE=false
) else if "%~1"=="--build" (
    set ACTION_CHOICE=5
    set INTERACTIVE=false
) else if "%~1"=="--help" (
    echo Usage: run.bat [options]
    echo Options:
    echo   --dev       Development mode (default)
    echo   --prod      Production mode
    echo   --test      Test mode
    echo   --cpu       Use CPU only
    echo   --gpu       Use GPU (default)
    echo   --mon       Enable monitoring
    echo   --no-mon    Disable monitoring (default)
    echo   --up        Build ^& Start (default)
    echo   --down      Stop ^& Remove
    echo   --logs      View logs
    echo   --restart   Restart services
    echo   --build     Build only
    goto :eof
) else (
    echo Unknown parameter: %~1
    exit /b 1
)
shift
goto parse_args

:check_interactive
echo =========================================
echo    GemmaVoice-SpeechAPI Launcher
echo =========================================

:: Check for .env
if exist "backend\.env" (
    set ENV_FILE_ARG=--env-file backend\.env
) else (
    echo Warning: backend\.env not found. Using default values.
    set ENV_FILE_ARG=
)

if "%INTERACTIVE%"=="true" (
    :: 1. Select Hardware Mode
    echo.
    echo Select Hardware Mode:
    echo 1) GPU (NVIDIA CUDA) - Recommended
    echo 2) CPU Only (Slower)
    set /p HW_CHOICE="Enter choice [1-2] (default 1): "

    :: 2. Select Environment
    echo.
    echo Select Environment:
    echo 1) Development (Hot-reload, local config)
    echo 2) Production (Optimized, no hot-reload)
    echo 3) Test (Run tests)
    set /p ENV_CHOICE="Enter choice [1-3] (default 1): "

    :: 3. Monitoring
    echo.
    echo Enable Monitoring? (Prometheus, Grafana, Loki)
    echo 1) No
    echo 2) Yes
    set /p MON_CHOICE="Enter choice [1-2] (default 1): "

    :: 4. Action
    echo.
    echo Select Action:
    echo 1) Up (Build ^& Start)
    echo 2) Down (Stop ^& Remove)
    echo 3) Logs
    echo 4) Restart
    echo 5) Build only
    set /p ACTION_CHOICE="Enter choice [1-5] (default 1): "
)

:: Apply Configuration
if "%HW_CHOICE%"=="2" (
    set BASE_COMPOSE=-f docker/docker-compose.cpu.yml
    echo Hardware: CPU Mode
) else (
    set BASE_COMPOSE=-f docker/docker-compose.yml
    echo Hardware: GPU Mode
)

set ENV_COMPOSE=
if "%ENV_CHOICE%"=="2" (
    set ENV_COMPOSE=-f docker/docker-compose.prod.yml
    echo Environment: Production
) else if "%ENV_CHOICE%"=="3" (
    set ENV_COMPOSE=-f docker/docker-compose.test.yml
    echo Environment: Test
) else (
    echo Environment: Development
)

set MON_COMPOSE=
if "%MON_CHOICE%"=="2" (
    set MON_COMPOSE=-f docker/docker-compose.monitoring.yml
    echo Monitoring: Enabled
) else (
    echo Monitoring: Disabled
)

set CMD_ARGS=
if "%ACTION_CHOICE%"=="2" (
    set CMD_ARGS=down
) else if "%ACTION_CHOICE%"=="3" (
    set CMD_ARGS=logs -f
) else if "%ACTION_CHOICE%"=="4" (
    set CMD_ARGS=restart
) else if "%ACTION_CHOICE%"=="5" (
    set CMD_ARGS=build
) else (
    set CMD_ARGS=up --build -d
)

:: Construct Final Command
set DOCKER_CMD=docker compose %ENV_FILE_ARG% %BASE_COMPOSE% %ENV_COMPOSE% %MON_COMPOSE% %CMD_ARGS%

echo.
echo Running command:
echo %DOCKER_CMD%
echo.

:: Execute
%DOCKER_CMD%

endlocal
