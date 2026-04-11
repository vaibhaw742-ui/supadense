#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOYMENT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Rebuilding frontend..."
docker compose -f "$DEPLOYMENT_DIR/docker-compose.yml" up -d --build frontend
echo "Frontend rebuilt and restarted."
