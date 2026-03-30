# 运维知识库 (OPS Knowledge Base)
# 供 OpenClaw AI 接管修复时参考

## 一、节点服务架构

每台节点运行以下核心服务：

### 1. XAgent (端口 8888) — 代理核心
- **二进制**: `/opt/core-service/xagent-server/xagent`
- **配置文件**: `/opt/core-service/xagent-server/etc/xagent.yaml`
- **日志**: `/opt/core-service/xagent-server/output.log`
- **工作目录**: `/opt/core-service/xagent-server/`
- **systemd 服务**: `xagent.service`
- **启动命令**: `systemctl start xagent`
- **重启命令**: `systemctl restart xagent`
- **查看状态**: `systemctl status xagent`
- **查看日志**: `tail -100 /opt/core-service/xagent-server/output.log` 或 `journalctl -u xagent -n 50`
- **验证方式**: `ss -tlnp | grep :8888`
- **依赖**: xcore (xray/singbox 在端口 443)、Redis (端口 6379)、SSL 证书
- **配置关键字段**: 
  - `InstanceId`: 节点标识（不同节点不同）
  - `Port: 8888`
  - `Redis.Addrs: ["127.0.0.1:6379"]`
  - `CoreConfig.CoreWorkDir: /opt/core-service`

### 2. XCore 内核 (端口 443) — xray + singbox
- **目录**: `/opt/core-service/xcore/`
- **二进制**: `xray`, `singbox`（由 xagent 进程管理启动，不是独立 systemd 服务）
- **配置**: 由 xagent 动态生成到 `/opt/core-service/xconfig/`
  - `xray.json` — xray 运行配置
  - `xray_node_config.json` — 节点配置
  - `nf_table_config.json` — nftables 规则配置
- **Geo 数据**: `geoip.dat`, `geosite.dat`（在 xcore 目录下）
- **验证方式**: `ss -tlnp | grep :443`
- **注意**: xcore 不是独立服务，由 xagent 管理。重启 xagent 会带起 xcore。

### 3. XBridge (端口 8789) — 桥接服务
- **二进制**: `/opt/core-service/xbrigde-server/xvpn-bridge-server`
  （注意目录名拼写: xbrigde 不是 xbridge）
- **配置文件**: `/opt/core-service/xbrigde-server/etc/bridge.yaml`
- **日志**: `/opt/core-service/xbrigde-server/output.log`
- **工作目录**: `/opt/core-service/xbrigde-server/`
- **systemd 服务**: `xvpn-bridge-server.service`
- **启动命令**: `systemctl start xvpn-bridge-server`
- **重启命令**: `systemctl restart xvpn-bridge-server`
- **查看状态**: `systemctl status xvpn-bridge-server`
- **查看日志**: `tail -100 /opt/core-service/xbrigde-server/output.log`
- **验证方式**: `ss -tlnp | grep :8789`
- **端口**: 8789 (pprof/管理), 8610 (HTTP)
- **配置关键字段**: `NodeId` — 节点标识

### 4. Redis (端口 6379) — 缓存
- **systemd 服务**: `redis-server.service`（或 `redis.service` 别名）
- **启动命令**: `systemctl start redis-server`
- **重启命令**: `systemctl restart redis-server`
- **验证方式**: `ss -tlnp | grep :6379` 或 `redis-cli ping`
- **配置**: `/etc/redis/redis.conf`
- **日志**: `/var/log/redis/redis-server.log`

### 5. Server-Monitor Agent (监控探针)
- **二进制**: `/opt/server-monitor/agent/server-monitor-agent`
- **配置**: `/opt/server-monitor/agent/agent.env`
  - `MONITOR_API=http://43.165.172.3:8080`（指向监控后端）
  - `REPORT_INTERVAL=10`（每 10 秒上报一次）
- **systemd 服务**: `server-monitor-agent.service`（部分节点可能用 nohup）
- **日志**: `/tmp/sm-agent.log`

## 二、目录结构

```
/opt/core-service/
├── scripts/           # 运维脚本（由 ops-scripts 管理）
│   ├── VERSION        # 脚本版本号
│   ├── restart_xagent.sh
│   ├── restart_xbridge.sh
│   ├── restart_redis.sh
│   ├── update_xcore.sh
│   ├── install_ixvpn.sh
│   ├── install_xnftables.sh
│   ├── install_redis.sh
│   ├── apply_cert.sh
│   ├── upgrade_agent.sh
│   ├── create_temp_user.sh
│   └── delete_temp_user.sh
├── xagent-server/     # XAgent 主程序
│   ├── xagent         # 二进制
│   ├── etc/xagent.yaml
│   ├── logs/
│   └── output.log
├── xcore/             # xray + singbox 内核
│   ├── xray
│   ├── singbox
│   ├── geoip.dat
│   └── geosite.dat
├── xbrigde-server/    # XBridge（注意拼写 xbrigde）
│   ├── xvpn-bridge-server
│   ├── etc/bridge.yaml
│   ├── conf/          # nftables 配置
│   ├── logs/
│   └── output.log
├── xconfig/           # 运行时配置（xagent 动态生成）
│   ├── xray.json
│   ├── xray_node_config.json
│   ├── nf_table_config.json
│   └── xray.pid
└── backups/           # ops-scripts 更新前的备份
```

```
/opt/server-monitor/
├── agent/
│   ├── server-monitor-agent   # 监控探针二进制
│   └── agent.env              # 环境变量
├── backend/                   # 监控后端 (仅在 43.165.172.3 运行)
└── dashboard/                 # 监控面板 (仅在 43.165.172.3 运行)
```

```
/home/cert/Self-visa-certificate-no-domain-name-exists/
├── server.crt    # 自签 SSL 证书
└── server.key    # 私钥
```

## 三、故障诊断与修复手册

### 故障类型 → 对应端口 → 推荐修复

| 故障类型 | 端口 | 服务 | 一键修复 | 升级修复 |
|---------|------|------|---------|---------|
| port_8888_down | 8888 | xagent | restart_xagent | install_ixvpn（完整重装） |
| port_443_down | 443 | xray (xcore) | update_xcore | install_ixvpn |
| port_8789_down | 8789 | xvpn-bridge | restart_xbridge | install_xnftables |
| port_6379_down | 6379 | redis | restart_redis | install_redis |
| server_offline | - | agent 离线 | - | 需要 SSH 介入 |

### 端口 8888 不通 (XAgent)

**诊断步骤:**
```bash
# 1. 检查 xagent 服务状态
systemctl status xagent

# 2. 检查进程
ps aux | grep xagent | grep -v grep

# 3. 检查端口
ss -tlnp | grep :8888

# 4. 检查日志（看最后错误）
tail -50 /opt/core-service/xagent-server/output.log

# 5. 检查二进制是否存在且可执行
ls -la /opt/core-service/xagent-server/xagent
file /opt/core-service/xagent-server/xagent

# 6. 检查配置
cat /opt/core-service/xagent-server/etc/xagent.yaml

# 7. 检查依赖（redis 是否正常）
redis-cli ping
ss -tlnp | grep :6379

# 8. 检查证书
ls -la /home/cert/Self-visa-certificate-no-domain-name-exists/
```

**修复方案（由简到复杂）:**
1. `systemctl restart xagent` — 尝试重启
2. 如果启动失败，查看日志定位错误
3. 如果二进制损坏 → 重新下载 xagent-server.zip:
   ```bash
   curl -fsSL http://43.165.172.3/downloads/packages/xagent/xagent-server.zip -o /tmp/xagent-server.zip
   unzip -o /tmp/xagent-server.zip -d /tmp/xagent-extract
   cp /tmp/xagent-extract/xagent-server/xagent /opt/core-service/xagent-server/xagent
   chmod +x /opt/core-service/xagent-server/xagent
   systemctl restart xagent
   ```
4. 如果配置损坏 → 检查 xagent.yaml 的 InstanceId 和端口配置
5. 如果证书丢失 → 重新生成:
   ```bash
   SERVER_IP=$(curl -s https://api.ipify.org)
   bash /opt/core-service/scripts/apply_cert.sh "$SERVER_IP"
   systemctl restart xagent
   ```
6. 如果 Redis 不通 → 先修复 Redis（见 6379 修复方案）
7. 完整重装: `bash /opt/core-service/scripts/install_ixvpn.sh <server_id> <xagent_download_url> <server_ip>`

### 端口 443 不通 (XCore/xray)

**诊断步骤:**
```bash
# 1. 检查 xray 进程
ps aux | grep xray | grep -v grep

# 2. 检查端口
ss -tlnp | grep :443

# 3. 检查 xray 二进制
ls -la /opt/core-service/xcore/xray
file /opt/core-service/xcore/xray

# 4. 检查 xray 配置
cat /opt/core-service/xconfig/xray.json

# 5. 手动尝试启动 xray（测试）
cd /opt/core-service/xcore && ./xray version
```

**修复方案:**
1. `systemctl restart xagent` — xagent 管理 xcore，重启 xagent 会重启 xray
2. 如果 xray 二进制损坏 → 重新下载 xcore:
   ```bash
   curl -fsSL http://43.165.172.3/downloads/packages/xcore/xcore.zip -o /tmp/xcore.zip
   unzip -o /tmp/xcore.zip -d /tmp/xcore-extract
   rm -rf /opt/core-service/xcore
   mv /tmp/xcore-extract/xcore /opt/core-service/xcore
   chmod +x /opt/core-service/xcore/xray /opt/core-service/xcore/singbox
   systemctl restart xagent
   ```
3. 检查端口是否被其他进程占用: `ss -tlnp | grep :443`
4. 如果僵尸进程占用端口: `kill -9 $(lsof -ti:443)`，然后重启

### 端口 8789 不通 (XBridge)

**诊断步骤:**
```bash
systemctl status xvpn-bridge-server
ps aux | grep xvpn-bridge | grep -v grep
ss -tlnp | grep :8789
tail -50 /opt/core-service/xbrigde-server/output.log
ls -la /opt/core-service/xbrigde-server/xvpn-bridge-server
```

**修复方案:**
1. `systemctl restart xvpn-bridge-server`
2. 如果二进制损坏 → 重新下载:
   ```bash
   curl -fsSL http://43.165.172.3/downloads/packages/xbridge/xbridge-server.zip -o /tmp/xbridge.zip
   unzip -o /tmp/xbridge.zip -d /tmp/xbridge-extract
   cp /tmp/xbridge-extract/xbrigde-server/xvpn-bridge-server /opt/core-service/xbrigde-server/xvpn-bridge-server
   chmod +x /opt/core-service/xbrigde-server/xvpn-bridge-server
   systemctl restart xvpn-bridge-server
   ```
3. 检查配置: `cat /opt/core-service/xbrigde-server/etc/bridge.yaml` — NodeId 应正确

### 端口 6379 不通 (Redis)

**诊断步骤:**
```bash
systemctl status redis-server
redis-cli ping
ss -tlnp | grep :6379
tail -20 /var/log/redis/redis-server.log
```

**修复方案:**
1. `systemctl restart redis-server`
2. 如果 Redis 未安装 → `bash /opt/core-service/scripts/install_redis.sh`
3. 如果端口被占用: `kill -9 $(lsof -ti:6379)` → `systemctl start redis-server`
4. 如果磁盘满导致 Redis 崩溃 → 先清理磁盘

### 节点离线

**可能原因:**
1. 监控 agent 进程死了
2. 网络不可达
3. 服务器宕机

**修复方案:**
```bash
# 检查 agent
ps aux | grep server-monitor-agent | grep -v grep
systemctl status server-monitor-agent

# 重启 agent
systemctl restart server-monitor-agent
# 或者
cd /opt/server-monitor/agent && source agent.env && nohup ./server-monitor-agent > /tmp/sm-agent.log 2>&1 &
```

### 磁盘使用率过高

**诊断步骤:**
```bash
df -h
du -sh /opt/core-service/*/output.log
du -sh /var/log/*
du -sh /tmp/*
```

**修复方案:**
```bash
# 清理服务日志（通常是最大的）
truncate -s 0 /opt/core-service/xagent-server/output.log
truncate -s 0 /opt/core-service/xbrigde-server/output.log

# 清理系统日志
journalctl --vacuum-size=100M

# 清理 apt 缓存
apt-get clean

# 清理临时文件
rm -rf /tmp/xcore* /tmp/xagent* /tmp/xbridge* /tmp/ops-scripts*
```

## 四、下载资源

所有安装包都可从管理节点（43.165.172.3）下载:

| 资源 | URL |
|------|-----|
| XAgent 包 | `http://43.165.172.3/downloads/packages/xagent/xagent-server.zip` |
| XCore 内核 | `http://43.165.172.3/downloads/packages/xcore/xcore.zip` |
| XBridge 包 | `http://43.165.172.3/downloads/packages/xbridge/xbridge-server.zip` |
| Monitor Agent (amd64) | `http://43.165.172.3/downloads/agent-linux-amd64` |
| Monitor Agent (arm64) | `http://43.165.172.3/downloads/agent-linux-arm64` |
| Ops 脚本包 | `http://43.165.172.3/downloads/packages/ops/stable/current/ops-scripts.zip` |

## 五、注意事项

1. **不要直接 `rm -rf /opt/core-service`** — 这会删掉所有服务
2. **修改配置前先备份**: `cp file file.bak`
3. **xagent.yaml 中的 InstanceId 是唯一的**，不要用别的节点的配置覆盖
4. **bridge.yaml 中的 NodeId 同理**
5. **xcore 目录（xray/singbox）不是独立服务**，由 xagent 管理
6. **目录拼写**: `xbrigde-server` 不是 `xbridge-server`（历史原因）
7. **SSL 证书路径**: `/home/cert/Self-visa-certificate-no-domain-name-exists/`（固定路径）
8. **中国大陆 IP 的节点不安装 xcore**（install_ixvpn.sh 会自动跳过）
9. **修复完成后务必验证端口**: `ss -tlnp | grep :<port>`
10. **修复完成后调用回报接口** 通知监控系统

## 六、服务依赖关系

```
Redis (6379) ← XAgent (8888) ← XCore/xray (443)
                                XBridge (8789)
SSL 证书 ← XAgent
```

- XAgent 依赖 Redis，如果 Redis 挂了，XAgent 也会出问题
- XCore (xray) 由 XAgent 管理启动
- XBridge 独立运行，不依赖其他服务
- SSL 证书被 XAgent 使用
