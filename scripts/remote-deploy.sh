#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/opt/server-monitor
BACKEND_DIR=$APP_DIR/backend
DASHBOARD_DIR=$APP_DIR/dashboard
AGENT_DIR=$APP_DIR/agent
PUBLIC_DIR=/var/www/server-monitor-downloads
NGINX_SITE=/etc/nginx/sites-available/server-monitor

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y curl ca-certificates gnupg nginx tar build-essential

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

if ! command -v go >/dev/null 2>&1; then
  GO_VERSION=1.22.6
  cd /tmp
  curl -LO https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz
  rm -rf /usr/local/go
  tar -C /usr/local -xzf go${GO_VERSION}.linux-amd64.tar.gz
  ln -sf /usr/local/go/bin/go /usr/local/bin/go
  ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt
fi

mkdir -p $BACKEND_DIR $DASHBOARD_DIR $AGENT_DIR $PUBLIC_DIR

cd $BACKEND_DIR
npm install
npm rebuild better-sqlite3 --build-from-source

cd $DASHBOARD_DIR
npm install
NEXT_PUBLIC_API_BASE=http://127.0.0.1:8080 npm run build

cd $AGENT_DIR
/usr/local/bin/go build -ldflags='-s -w' -o $PUBLIC_DIR/agent-linux-amd64 .
GOOS=linux GOARCH=arm64 /usr/local/bin/go build -ldflags='-s -w' -o $PUBLIC_DIR/agent-linux-arm64 .

cat >/etc/systemd/system/server-monitor-backend.service <<'EOF'
[Unit]
Description=Server Monitor Backend
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/server-monitor/backend
Environment=PORT=8080
Environment=DATA_DIR=/opt/server-monitor/backend/data
ExecStart=/usr/bin/node /opt/server-monitor/backend/src/index.js
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
EOF

cat >/etc/systemd/system/server-monitor-dashboard.service <<'EOF'
[Unit]
Description=Server Monitor Dashboard
After=network.target server-monitor-backend.service

[Service]
Type=simple
WorkingDirectory=/opt/server-monitor/dashboard
Environment=PORT=3000
Environment=NEXT_PUBLIC_API_BASE=http://127.0.0.1:8080
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
EOF

cat >$NGINX_SITE <<'EOF'
server {
    listen 80;
    server_name _;

    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /downloads/ {
        alias /var/www/server-monitor-downloads/;
        autoindex on;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

rm -f /etc/nginx/sites-enabled/default
ln -sf $NGINX_SITE /etc/nginx/sites-enabled/server-monitor
nginx -t
systemctl daemon-reload
systemctl enable --now server-monitor-backend.service
systemctl enable --now server-monitor-dashboard.service
systemctl enable --now nginx
systemctl restart server-monitor-backend.service
systemctl restart server-monitor-dashboard.service
systemctl restart nginx

echo 'REMOTE_DEPLOY_DONE'
