# 运维与排障

## 常用状态检查

```bash
systemctl status server-monitor-backend.service --no-pager -l
systemctl status server-monitor-dashboard.service --no-pager -l
journalctl -u server-monitor-backend.service -n 100 --no-pager
journalctl -u server-monitor-dashboard.service -n 100 --no-pager
ss -ltnp | grep -E ':80|:3000|:8080'
```

> 若当前 shell 环境中 `nginx` 不在 PATH，请直接使用 `/usr/sbin/nginx -t`。

## 健康检查

### Backend

```bash
curl http://127.0.0.1:8080/api/health
```

### Nginx 入口

```bash
curl -I http://127.0.0.1/
curl http://127.0.0.1/api/health
```

## 常见故障

### 1. backend 不断重启

优先查看：

```bash
journalctl -u server-monitor-backend.service -n 100 --no-pager
cat /var/log/server-monitor-backend-rebuild.log
```

高概率原因：
- Node 大版本变化后，`better-sqlite3` ABI 不匹配

手工修复：

```bash
cd /opt/server-monitor/backend
npm rebuild better-sqlite3 --build-from-source
systemctl restart server-monitor-backend.service
```

### 2. 首页 500 / Nginx 502

检查 backend 是否可用：

```bash
curl http://127.0.0.1:8080/api/health
```

如果 backend 不通：
- dashboard SSR 会失败
- Nginx `/api/*` 代理也会失败

### 3. Dashboard 打得开，但数据为空/401

检查：
- 是否配置了 `DASHBOARD_TOKEN`
- 浏览器是否已在 `/login` 正确写入 cookie
- backend 是否正常处理授权

### 4. 节点显示 offline

排查方向：
- agent 是否仍在上报
- `MONITOR_API` 是否指向正确 backend
- `OFFLINE_AFTER_SECONDS` 是否设置过小

## 建议的变更流程

1. 先改代码
2. 重建 backend/dashboard 依赖或产物
3. 重启 systemd 服务
4. 用 curl 验证 backend 与 Nginx 入口
5. 再打开页面验证

## 常用 Makefile 命令

```bash
make status
make health
make rebuild-backend-native
make build-dashboard
make restart
```

## 健康检查脚本

```bash
bash scripts/check.sh
```
