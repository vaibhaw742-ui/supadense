#!/bin/bash
set -e
cd /root/supadense
git pull origin main
cd deployment
docker-compose-v2 -f docker-compose.prod.yml build frontend
docker-compose-v2 -f docker-compose.prod.yml stop frontend
docker-compose-v2 -f docker-compose.prod.yml rm -f frontend
docker-compose-v2 -f docker-compose.prod.yml up -d frontend
echo "Frontend deployed successfully"
