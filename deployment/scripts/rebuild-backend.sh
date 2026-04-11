#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOYMENT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Rebuilding backend..."
docker compose -f "$DEPLOYMENT_DIR/docker-compose.yml" up -d --build backend
echo "Backend rebuilt and restarted."
