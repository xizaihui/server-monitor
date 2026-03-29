SHELL := /bin/bash
APP_DIR := /opt/server-monitor
BACKEND_DIR := $(APP_DIR)/backend
DASHBOARD_DIR := $(APP_DIR)/dashboard
NGINX_SITE := /etc/nginx/sites-available/server-monitor

.PHONY: help backend-install dashboard-install build-dashboard rebuild-backend-native restart status logs-backend logs-dashboard health nginx-test

help:
	@echo "Available targets:"
	@echo "  make backend-install         # 安装 backend 依赖"
	@echo "  make rebuild-backend-native  # 重建 better-sqlite3 原生模块"
	@echo "  make dashboard-install       # 安装 dashboard 依赖"
	@echo "  make build-dashboard         # 构建 dashboard"
	@echo "  make restart                 # 重启 backend/dashboard/nginx"
	@echo "  make status                  # 查看服务状态"
	@echo "  make logs-backend            # 查看 backend 最近日志"
	@echo "  make logs-dashboard          # 查看 dashboard 最近日志"
	@echo "  make health                  # 检查 backend 与 nginx 入口"
	@echo "  make nginx-test              # 检查 nginx 配置"

backend-install:
	cd $(BACKEND_DIR) && npm install

rebuild-backend-native:
	cd $(BACKEND_DIR) && npm rebuild better-sqlite3 --build-from-source

dashboard-install:
	cd $(DASHBOARD_DIR) && npm install

build-dashboard:
	cd $(DASHBOARD_DIR) && NEXT_PUBLIC_API_BASE=http://127.0.0.1:8080 npm run build

restart:
	systemctl restart server-monitor-backend.service
	systemctl restart server-monitor-dashboard.service
	systemctl restart nginx

status:
	@systemctl status server-monitor-backend.service --no-pager -l | sed -n '1,30p'
	@echo
	@systemctl status server-monitor-dashboard.service --no-pager -l | sed -n '1,30p'
	@echo
	@systemctl status nginx --no-pager -l | sed -n '1,20p'

logs-backend:
	journalctl -u server-monitor-backend.service -n 100 --no-pager

logs-dashboard:
	journalctl -u server-monitor-dashboard.service -n 100 --no-pager

health:
	@echo '--- backend health ---'
	@curl -s http://127.0.0.1:8080/api/health || true
	@echo
	@echo '--- nginx root ---'
	@curl -I -s http://127.0.0.1/ | sed -n '1,20p' || true

nginx-test:
	/usr/sbin/nginx -t
