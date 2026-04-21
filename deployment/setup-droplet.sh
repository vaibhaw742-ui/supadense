#!/bin/bash
# Run this once on a fresh Ubuntu 24.04 droplet as root.
# Usage: bash setup-droplet.sh your-domain.com

set -euo pipefail

DOMAIN="${1:?Usage: $0 <domain>}"
DEPLOY_USER="deploy"

echo "==> [1/7] System update"
apt-get update -qq && apt-get upgrade -y -qq

echo "==> [2/7] Install dependencies"
apt-get install -y -qq \
    curl git ufw fail2ban unattended-upgrades \
    nginx certbot python3-certbot-nginx

echo "==> [3/7] Create deploy user"
if ! id "$DEPLOY_USER" &>/dev/null; then
    adduser --disabled-password --gecos "" "$DEPLOY_USER"
    usermod -aG sudo "$DEPLOY_USER"
    # Copy root's authorized_keys so the same SSH key works for deploy user
    mkdir -p /home/$DEPLOY_USER/.ssh
    cp /root/.ssh/authorized_keys /home/$DEPLOY_USER/.ssh/
    chown -R $DEPLOY_USER:$DEPLOY_USER /home/$DEPLOY_USER/.ssh
    chmod 700 /home/$DEPLOY_USER/.ssh
    chmod 600 /home/$DEPLOY_USER/.ssh/authorized_keys
    echo "$DEPLOY_USER ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers.d/$DEPLOY_USER
fi

echo "==> [4/7] Harden SSH"
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd

echo "==> [5/7] Firewall (UFW)"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> [6/7] Install Docker"
curl -fsSL https://get.docker.com | sh
usermod -aG docker "$DEPLOY_USER"

echo "==> [7/7] SSL certificate"
# Make sure DNS A record points to this server before running certbot
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "admin@$DOMAIN" || \
    echo "WARNING: certbot failed — ensure DNS is pointing to this server first"

echo ""
echo "==> Setup complete!"
echo ""
echo "Next steps (as the deploy user):"
echo "  ssh $DEPLOY_USER@$DOMAIN"
echo "  git clone git@github.com:vaibhaw742-ui/supadense.git"
echo "  cd supadense/deployment"
echo "  cp .env.prod.example .env.prod && nano .env.prod   # fill in real values"
echo "  mkdir -p /home/deploy/workspaces                   # put KB folders here"
echo "  docker compose -f docker-compose.prod.yml up -d --build"
echo ""
echo "  Then copy nginx.prod.conf to /etc/nginx/sites-available/$DOMAIN"
echo "  Replace YOUR_DOMAIN with $DOMAIN in the config"
echo "  ln -s /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/"
echo "  nginx -t && systemctl reload nginx"
