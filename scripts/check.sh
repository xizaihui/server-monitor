#!/usr/bin/env bash
set -euo pipefail

echo '== service status =='
systemctl is-active server-monitor-backend.service
systemctl is-active server-monitor-dashboard.service
systemctl is-active nginx

echo
echo '== port listeners =='
ss -ltnp | grep -E ':80|:3000|:8080' || true

echo
echo '== backend health =='
curl -fsS http://127.0.0.1:8080/api/health

echo
echo '== nginx root headers =='
curl -I -fsS http://127.0.0.1/ | sed -n '1,20p'

echo
echo '== done =='
