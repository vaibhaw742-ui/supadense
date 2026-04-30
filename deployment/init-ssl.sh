#!/bin/bash
# Run this ONCE on the droplet to get your first SSL certificate.
# Usage: ./init-ssl.sh yourdomain.com your@email.com

set -e

DOMAIN=$1
EMAIL=$2

if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
  echo "Usage: $0 <domain> <email>"
  exit 1
fi

# Create data directories (bind mounts must exist before containers start)
mkdir -p /root/data/opencode
mkdir -p /root/data/opencode-config
mkdir -p /root/data/workspaces

# Replace YOUR_DOMAIN placeholder in nginx config
sed -i "s/YOUR_DOMAIN/$DOMAIN/g" nginx/nginx.conf

# Start nginx on HTTP only (no SSL yet) so certbot can answer the ACME challenge
docker compose -f docker-compose.prod.yml up -d nginx

# Get the certificate
docker compose -f docker-compose.prod.yml run --rm certbot certonly \
  --webroot \
  --webroot-path /var/www/certbot \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  -d "$DOMAIN"

# Reload nginx to pick up the cert
docker compose -f docker-compose.prod.yml exec nginx nginx -s reload

echo "SSL certificate issued for $DOMAIN. Bring up the full stack with:"
echo "  docker compose -f docker-compose.prod.yml up -d"
