# 部署说明

## 组件

- `agent/`：Go 采集端
- `backend/`：Node.js + Express + SQLite API
- `dashboard/`：Next.js 控制台
- `nginx`：80 端口统一入口

## 推荐环境

- Ubuntu 22.04/24.04
- Node.js 22.x
- npm 10.x
- Go 1.22.x
- nginx 1.24+

## 端口规划

- `80`：Nginx 入口
- `3000`：Dashboard（本机监听）
- `8080`：Backend API（本机监听）

## 首次部署

可参考：
- `scripts/remote-deploy.sh`
- `deploy/systemd/`
- `deploy/nginx/`
- `ENV.md`

该脚本会：
- 安装 Node.js / Go / nginx（缺失时）
- 安装 backend 与 dashboard 依赖
- 构建 dashboard
- 构建 agent 下载产物
- 生成 systemd 服务
- 写入 nginx 站点配置

## 关键注意事项

### 1. better-sqlite3 与 Node ABI

backend 依赖 `better-sqlite3` 原生模块。
如果 Node.js 大版本变化，可能出现 ABI 不兼容，表现为 backend 启动失败。

常用修复命令：

```bash
cd /opt/server-monitor/backend
npm rebuild better-sqlite3 --build-from-source
```

当前 systemd 已包含 `ExecStartPre` 自动重建逻辑，但首次排障时仍建议人工确认。

### 2. Dashboard Token

如果为 backend 配置了 `DASHBOARD_TOKEN`：
- 访问 dashboard 时需要先在 `/login` 输入 token
- token 通常放在 systemd 环境变量中，不建议直接写入仓库源码

### 3. Next standalone 启动

当前 dashboard 使用：
- `output: 'standalone'`

生产环境建议使用：

```bash
node /opt/server-monitor/dashboard/.next/standalone/server.js
```

而不是 `next start`。

## 常见部署后检查

```bash
systemctl status server-monitor-backend.service
systemctl status server-monitor-dashboard.service
/usr/sbin/nginx -t
curl http://127.0.0.1:8080/api/health
curl -I http://127.0.0.1/
```

## 目录说明

- 数据库：`/opt/server-monitor/backend/data/monitor.db`
- backend rebuild 日志：`/var/log/server-monitor-backend-rebuild.log`
- 下载目录：`/var/www/server-monitor-downloads/`
