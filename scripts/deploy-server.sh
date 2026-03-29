#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="43.165.172.3"
REMOTE_USER="root"
REMOTE_DIR="/opt/server-monitor"

mkdir -p .deploytmp
rsync -av --delete backend dashboard "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/"
ssh "$REMOTE_USER@$REMOTE_HOST" "bash -s" <<'EOF'
set -euo pipefail
cd /opt/server-monitor/backend
npm install
npm rebuild better-sqlite3 --build-from-source
nohup node src/index.js > /var/log/server-monitor-backend.log 2>&1 &
cd /opt/server-monitor/dashboard
npm install
npm run build
nohup npm run start > /var/log/server-monitor-dashboard.log 2>&1 &
EOF

echo 'deployed'
