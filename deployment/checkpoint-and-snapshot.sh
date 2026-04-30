#!/bin/bash
# Checkpoint the SQLite WAL then trigger a DigitalOcean droplet snapshot.
# Run manually before deploys, or schedule via cron:
#   0 2 * * * /root/supadense/deployment/checkpoint-and-snapshot.sh >> /var/log/snapshot.log 2>&1

set -e

DO_API_TOKEN="${DO_API_TOKEN:-}"
DROPLET_ID="${DROPLET_ID:-}"
SNAPSHOT_NAME="supadense-$(date +%Y%m%d-%H%M)"

echo "[$(date)] Starting checkpoint and snapshot: $SNAPSHOT_NAME"

# 1. Flush WAL to main DB file so snapshot captures a consistent state
echo "[$(date)] Checkpointing SQLite WAL..."
docker exec deployment-backend-1 bun -e "
const { Database } = require('bun:sqlite');
const db = new Database('/root/.local/share/opencode/opencode-local.db');
db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
db.close();
console.log('WAL checkpointed');
"

# 2. Trigger DigitalOcean snapshot via API (requires DO_API_TOKEN and DROPLET_ID)
if [ -n "$DO_API_TOKEN" ] && [ -n "$DROPLET_ID" ]; then
  echo "[$(date)] Triggering DigitalOcean snapshot: $SNAPSHOT_NAME"
  curl -s -X POST \
    -H "Authorization: Bearer $DO_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"type\":\"snapshot\",\"name\":\"$SNAPSHOT_NAME\"}" \
    "https://api.digitalocean.com/v2/droplets/$DROPLET_ID/actions"
  echo ""
  echo "[$(date)] Snapshot triggered. Check DigitalOcean dashboard for status."
else
  echo "[$(date)] DO_API_TOKEN or DROPLET_ID not set — skipping DO snapshot."
  echo "  Set them in /etc/environment or export before running this script."
fi

echo "[$(date)] Done."
