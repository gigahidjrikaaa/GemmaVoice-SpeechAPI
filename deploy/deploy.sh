#!/bin/bash

# ============================================================================
# GemmaVoice Deployment Script
# ============================================================================
# Usage: ./deploy.sh [rollback]
#
# This script handles deployment and rollback for GemmaVoice services.
# It performs health checks, maintains backups, and supports rollback.
# ============================================================================

set -euo pipefail

# Configuration
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
ENVIRONMENT="${ENVIRONMENT:-production}"
BACKUP_DIR="./backups"
MAX_BACKUPS=5
HEALTH_CHECK_TIMEOUT=60
HEALTH_CHECK_INTERVAL=5

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ============================================================================
# Helper Functions
# ============================================================================

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_prerequisites() {
    log_info "Checking prerequisites..."
    
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed"
        exit 1
    fi
    
    if ! command -v docker compose &> /dev/null; then
        log_error "Docker Compose is not installed"
        exit 1
    fi
    
    if [ ! -f "$COMPOSE_FILE" ]; then
        log_error "Compose file not found: $COMPOSE_FILE"
        exit 1
    fi
    
    log_info "Prerequisites check passed"
}

create_backup() {
    log_info "Creating backup..."
    
    mkdir -p "$BACKUP_DIR"
    
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    BACKUP_NAME="backup_${ENVIRONMENT}_${TIMESTAMP}"
    BACKUP_PATH="${BACKUP_DIR}/${BACKUP_NAME}"
    
    # Save current container IDs
    docker compose -f "$COMPOSE_FILE" ps -q > "${BACKUP_PATH}.containers"
    
    # Save current image tags
    docker compose -f "$COMPOSE_FILE" images --format json > "${BACKUP_PATH}.images"
    
    # Save environment variables
    if [ -f ".env" ]; then
        cp .env "${BACKUP_PATH}.env"
    fi
    
    log_info "Backup created: $BACKUP_NAME"
    
    # Clean old backups
    cleanup_old_backups
}

cleanup_old_backups() {
    log_info "Cleaning old backups (keeping last $MAX_BACKUPS)..."
    
    cd "$BACKUP_DIR"
    ls -t backup_${ENVIRONMENT}_*.containers 2>/dev/null | tail -n +$((MAX_BACKUPS + 1)) | while read -r backup; do
        BASE_NAME="${backup%.containers}"
        rm -f "${BASE_NAME}."*
        log_info "Removed old backup: $BASE_NAME"
    done
    cd - > /dev/null
}

health_check() {
    local service=$1
    local url=$2
    local elapsed=0
    
    log_info "Performing health check for $service..."
    
    while [ $elapsed -lt $HEALTH_CHECK_TIMEOUT ]; do
        if curl -sf "$url" > /dev/null 2>&1; then
            log_info "$service is healthy"
            return 0
        fi
        
        sleep $HEALTH_CHECK_INTERVAL
        elapsed=$((elapsed + HEALTH_CHECK_INTERVAL))
        echo -n "."
    done
    
    echo ""
    log_error "$service health check failed after ${HEALTH_CHECK_TIMEOUT}s"
    return 1
}

deploy() {
    log_info "Starting deployment for environment: $ENVIRONMENT"
    
    # Create backup before deployment
    create_backup
    
    # Pull latest images
    log_info "Pulling latest images..."
    docker compose -f "$COMPOSE_FILE" pull
    
    # Stop old containers gracefully
    log_info "Stopping old containers..."
    docker compose -f "$COMPOSE_FILE" down --remove-orphans
    
    # Start new containers
    log_info "Starting new containers..."
    docker compose -f "$COMPOSE_FILE" up -d
    
    # Wait for services to be ready
    sleep 5
    
    # Health checks
    log_info "Running health checks..."
    
    BACKEND_URL="${BACKEND_HEALTH_URL:-http://localhost:6666/health}"
    FRONTEND_URL="${FRONTEND_HEALTH_URL:-http://localhost:5173}"
    
    if ! health_check "Backend" "$BACKEND_URL"; then
        log_error "Backend health check failed. Rolling back..."
        rollback
        exit 1
    fi
    
    if ! health_check "Frontend" "$FRONTEND_URL"; then
        log_warn "Frontend health check failed, but continuing (static assets may need time)"
    fi
    
    # Cleanup old images
    log_info "Cleaning up old images..."
    docker image prune -f
    
    log_info "Deployment completed successfully! 🚀"
    
    # Show running containers
    docker compose -f "$COMPOSE_FILE" ps
}

rollback() {
    log_warn "Rolling back to previous deployment..."
    
    # Find latest backup
    LATEST_BACKUP=$(ls -t "${BACKUP_DIR}/backup_${ENVIRONMENT}_"*.containers 2>/dev/null | head -n1)
    
    if [ -z "$LATEST_BACKUP" ]; then
        log_error "No backup found for rollback"
        exit 1
    fi
    
    BASE_NAME="${LATEST_BACKUP%.containers}"
    
    log_info "Restoring from backup: $(basename $BASE_NAME)"
    
    # Restore environment
    if [ -f "${BASE_NAME}.env" ]; then
        cp "${BASE_NAME}.env" .env
    fi
    
    # Stop current containers
    docker compose -f "$COMPOSE_FILE" down
    
    # Restore images from backup
    # Note: This assumes images are still available locally
    # For production, consider pushing/pulling specific tags
    
    # Start with backed up configuration
    docker compose -f "$COMPOSE_FILE" up -d
    
    log_info "Rollback completed"
    docker compose -f "$COMPOSE_FILE" ps
}

show_logs() {
    log_info "Showing recent logs..."
    docker compose -f "$COMPOSE_FILE" logs --tail=50 --follow
}

show_status() {
    log_info "Current deployment status:"
    docker compose -f "$COMPOSE_FILE" ps
    
    echo ""
    log_info "Resource usage:"
    docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"
}

# ============================================================================
# Main Script
# ============================================================================

main() {
    check_prerequisites
    
    case "${1:-deploy}" in
        deploy)
            deploy
            ;;
        rollback)
            rollback
            ;;
        logs)
            show_logs
            ;;
        status)
            show_status
            ;;
        *)
            echo "Usage: $0 {deploy|rollback|logs|status}"
            exit 1
            ;;
    esac
}

main "$@"
