#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOYMENT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Rebuilding entire app (backend + frontend)..."
docker compose -f "$DEPLOYMENT_DIR/docker-compose.yml" up -d --build
echo "All services rebuilt and restarted."
