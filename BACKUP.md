# 备份与恢复

## 需要备份的内容

核心数据：
- `backend/data/monitor.db`
- `backend/data/monitor.db-wal`
- `backend/data/monitor.db-shm`

如需完整保留部署状态，也可一并备份：
- `/etc/systemd/system/server-monitor-backend.service`
- `/etc/systemd/system/server-monitor-dashboard.service`
- `/etc/nginx/sites-available/server-monitor`
- `/etc/nginx/sites-enabled/server-monitor`

## 推荐策略

### 轻量方案（适合当前项目）

- 每日备份一次 SQLite 数据库文件
- 保留最近 7~30 天
- 在低峰期执行

### 建议频率

- 监控数据重要但可重建：每天 1 次
- 如节点变更频繁：每天 2~4 次

## 备份前注意

SQLite 在 WAL 模式下，备份时不要只复制 `monitor.db`，应同时处理：
- `monitor.db`
- `monitor.db-wal`
- `monitor.db-shm`

更稳妥的方法：
- 暂停 backend 后复制
- 或使用 SQLite 在线备份方式（后续可再脚本化）

## 简单备份示例

```bash
systemctl stop server-monitor-backend.service
mkdir -p /opt/backups/server-monitor/$(date +%F-%H%M%S)
cp -a /opt/server-monitor/backend/data/* /opt/backups/server-monitor/$(date +%F-%H%M%S)/
systemctl start server-monitor-backend.service
```

## 恢复示例

```bash
systemctl stop server-monitor-backend.service
cp -a /opt/backups/server-monitor/<backup-dir>/* /opt/server-monitor/backend/data/
chown -R root:root /opt/server-monitor/backend/data
systemctl start server-monitor-backend.service
```

## 恢复后检查

```bash
systemctl status server-monitor-backend.service --no-pager -l
curl http://127.0.0.1:8080/api/health
curl -I http://127.0.0.1/
```

## 额外建议

- 定期抽查备份目录是否真的存在
- 至少做过一次实际恢复演练
- 若未来节点规模增大，可考虑把 SQLite 备份改成定时任务或对象存储归档
