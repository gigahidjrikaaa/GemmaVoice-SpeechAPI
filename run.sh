#!/bin/bash

# GemmaVoice-SpeechAPI Interactive Launcher

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check for .env
ENV_FILE="backend/.env"
ENV_FILE_ARG=""

if [ -f "$ENV_FILE" ]; then
    ENV_FILE_ARG="--env-file $ENV_FILE"
else
    echo -e "${YELLOW}Warning: $ENV_FILE not found. Using default values or environment variables.${NC}"
    # Check if example exists
    if [ -f "backend/.env.example" ]; then
        echo -e "${YELLOW}Tip: You can copy backend/.env.example to backend/.env${NC}"
    fi
fi

# Defaults
HW_CHOICE=1
ENV_CHOICE=1
MON_CHOICE=1
ACTION_CHOICE=1
INTERACTIVE=true

# Parse Arguments
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --dev) ENV_CHOICE=1; MON_CHOICE=1; INTERACTIVE=false ;;
        --prod) ENV_CHOICE=2; INTERACTIVE=false ;;
        --test) ENV_CHOICE=3; INTERACTIVE=false ;;
        --cpu) HW_CHOICE=2; INTERACTIVE=false ;;
        --gpu) HW_CHOICE=1; INTERACTIVE=false ;;
        --mon) MON_CHOICE=2; INTERACTIVE=false ;;
        --no-mon) MON_CHOICE=1; INTERACTIVE=false ;;
        --up) ACTION_CHOICE=1; INTERACTIVE=false ;;
        --down) ACTION_CHOICE=2; INTERACTIVE=false ;;
        --logs) ACTION_CHOICE=3; INTERACTIVE=false ;;
        --restart) ACTION_CHOICE=4; INTERACTIVE=false ;;
        --build) ACTION_CHOICE=5; INTERACTIVE=false ;;
        --help)
            echo "Usage: ./run.sh [options]"
            echo "Options:"
            echo "  --dev       Development mode (default)"
            echo "  --prod      Production mode"
            echo "  --test      Test mode"
            echo "  --cpu       Use CPU only"
            echo "  --gpu       Use GPU (default)"
            echo "  --mon       Enable monitoring"
            echo "  --no-mon    Disable monitoring (default)"
            echo "  --up        Build & Start (default)"
            echo "  --down      Stop & Remove"
            echo "  --logs      View logs"
            echo "  --restart   Restart services"
            echo "  --build     Build only"
            exit 0
            ;;
        *) echo "Unknown parameter: $1"; exit 1 ;;
    esac
    shift
done

echo -e "${BLUE}=========================================${NC}"
echo -e "${BLUE}   GemmaVoice-SpeechAPI Launcher         ${NC}"
echo -e "${BLUE}=========================================${NC}"

if [ "$INTERACTIVE" = true ]; then
    # 1. Select Hardware Mode
    echo -e "\n${YELLOW}Select Hardware Mode:${NC}"
    echo "1) GPU (NVIDIA CUDA) - Recommended"
    echo "2) CPU Only (Slower)"
    read -p "Enter choice [1-2] (default 1): " HW_CHOICE
    HW_CHOICE=${HW_CHOICE:-1}

    # 2. Select Environment
    echo -e "\n${YELLOW}Select Environment:${NC}"
    echo "1) Development (Hot-reload, local config)"
    echo "2) Production (Optimized, no hot-reload)"
    echo "3) Test (Run tests)"
    read -p "Enter choice [1-3] (default 1): " ENV_CHOICE
    ENV_CHOICE=${ENV_CHOICE:-1}

    # 3. Monitoring
    echo -e "\n${YELLOW}Enable Monitoring? (Prometheus, Grafana, Loki)${NC}"
    echo "1) No"
    echo "2) Yes"
    read -p "Enter choice [1-2] (default 1): " MON_CHOICE
    MON_CHOICE=${MON_CHOICE:-1}

    # 4. Action
    echo -e "\n${YELLOW}Select Action:${NC}"
    echo "1) Up (Build & Start)"
    echo "2) Down (Stop & Remove)"
    echo "3) Logs"
    echo "4) Restart"
    echo "5) Build only"
    read -p "Enter choice [1-5] (default 1): " ACTION_CHOICE
    ACTION_CHOICE=${ACTION_CHOICE:-1}
fi

# Apply Configuration
if [ "$HW_CHOICE" == "2" ]; then
    BASE_COMPOSE="-f docker/docker-compose.cpu.yml"
    echo -e "${GREEN}Hardware: CPU Mode${NC}"
else
    BASE_COMPOSE="-f docker/docker-compose.yml"
    echo -e "${GREEN}Hardware: GPU Mode${NC}"
fi

ENV_COMPOSE=""
if [ "$ENV_CHOICE" == "2" ]; then
    ENV_COMPOSE="-f docker/docker-compose.prod.yml"
    echo -e "${GREEN}Environment: Production${NC}"
elif [ "$ENV_CHOICE" == "3" ]; then
    ENV_COMPOSE="-f docker/docker-compose.test.yml"
    echo -e "${GREEN}Environment: Test${NC}"
else
    echo -e "${GREEN}Environment: Development${NC}"
fi

MON_COMPOSE=""
if [ "$MON_CHOICE" == "2" ]; then
    MON_COMPOSE="-f docker/docker-compose.monitoring.yml"
    echo -e "${GREEN}Monitoring: Enabled${NC}"
else
    echo -e "${GREEN}Monitoring: Disabled${NC}"
fi

CMD_ARGS=""
case $ACTION_CHOICE in
    1) CMD_ARGS="up --build -d" ;;
    2) CMD_ARGS="down" ;;
    3) CMD_ARGS="logs -f" ;;
    4) CMD_ARGS="restart" ;;
    5) CMD_ARGS="build" ;;
    *) CMD_ARGS="up --build -d" ;;
esac

# Construct Final Command
DOCKER_CMD="docker compose $ENV_FILE_ARG $BASE_COMPOSE $ENV_COMPOSE $MON_COMPOSE $CMD_ARGS"

echo -e "\n${BLUE}Running command:${NC}"
echo -e "${YELLOW}$DOCKER_CMD${NC}\n"

# Execute
eval $DOCKER_CMD
