#!/bin/bash
set -e
cd /root/supadense
git pull origin main
cd deployment
docker-compose-v2 -f docker-compose.prod.yml build backend frontend web
docker-compose-v2 -f docker-compose.prod.yml stop backend frontend web
docker-compose-v2 -f docker-compose.prod.yml rm -f backend frontend web
docker-compose-v2 -f docker-compose.prod.yml up -d
echo "All services deployed successfully"
