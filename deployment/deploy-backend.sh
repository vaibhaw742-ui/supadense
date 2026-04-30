#!/bin/bash
set -e
cd /root/supadense
git pull origin main
cd deployment
docker-compose-v2 -f docker-compose.prod.yml build backend
docker-compose-v2 -f docker-compose.prod.yml stop backend
docker-compose-v2 -f docker-compose.prod.yml rm -f backend
docker-compose-v2 -f docker-compose.prod.yml up -d backend
echo "Backend deployed successfully"
