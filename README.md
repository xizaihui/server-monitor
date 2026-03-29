# Server Monitor

轻量级服务器监控与任务执行平台：
- Go agent：采集 CPU / 内存 / 磁盘 / 端口探活，并拉取后端任务执行本地动作
- Node.js API：接收 agent 上报、自动注册、任务编排、事件建模、包上传与动作定义管理
- Next.js Dashboard：统一节点控制台，支持单节点/批量任务、任务历史、包上传、紧凑运维视图

## 目录

- `agent/` Go agent 源码
- `backend/` Node.js + Express API
- `dashboard/` Next.js 前端
- `scripts/` 本地构建和远程部署脚本
- `deploy/` systemd / nginx 模板

## 当前能力

### Agent
- 周期性采集：
  - CPU 使用率
  - 内存使用率
  - 磁盘使用率
  - 端口检测：443 / 6379 / 8888 / 8789
- 自动注册到监控平台
- 周期性心跳上报
- 任务拉取与执行
- 白名单动作执行（本地脚本 + 内置初始化能力）
- 支持 Linux amd64 / arm64 编译

### Backend
- SQLite 持久化
- 节点注册、状态快照、分组与监控规则管理
- 动作定义与任务下发：
  - `restart_xagent`
  - `restart_xbridge`
  - `restart_redis`
  - `update_xcore`
  - `install_ixvpn`（对外展示为安装 xagent）
  - `install_xnftables`
  - `install_redis`
  - `apply_cert`
  - `init_ops_scripts`
- 事件模型：`incidents`
- 故障到动作建议映射
- 本机包仓库上传接口

### Dashboard
- OpenAI 风格倾向的紧凑控制台 UI
- 节点列表、异常置顶、分组筛选
- 统一任务入口：
  - 单节点任务
  - 批量任务
- 任务历史与任务详情
- 包上传入口（上传到本机文件服务）
- 端口状态、健康态、分页与分类管理

## 本机包仓库

默认通过 nginx 暴露：

- `/downloads/packages/agents/`
- `/downloads/packages/xagent/`
- `/downloads/packages/xbridge/`
- `/downloads/packages/xcore/`
- `/downloads/packages/redis/`
- `/downloads/packages/ops/`

### 已使用的关键文件
- `downloads/packages/agents/server-monitor-agent`
- `downloads/packages/agents/install-agent.sh`
- `downloads/packages/xagent/xagent-server.zip`
- `downloads/packages/xbridge/xbridge-server.zip`
- `downloads/packages/xcore/xcore.zip`
- `downloads/packages/redis/install_redis.sh`
- `downloads/packages/ops/ops-scripts.zip`

### 覆盖上传逻辑
同名包上传时会先备份旧文件到：

- `/var/www/server-monitor-downloads/backups/...`

然后再覆盖当前发布文件，便于回滚。

## 关键运行语义

- 对外功能名统一收口到 `xagent`
- `xcore` 是由 `xagent.service` 拉起的内核能力
- 更新 `xcore` 后，重启 `xagent.service` 即可
- `init_ops_scripts` 为 agent 内置动作，不依赖目标节点预先存在 `/opt/core-service/scripts`

## 默认接口
- Backend API：`8080`
- Dashboard：`3000`
- Nginx：`80`

## 运行环境
- 推荐 Node.js：`22.x`
- Go：`1.22.x`

> 说明：backend 依赖 `better-sqlite3` 原生模块。若 Node.js 大版本发生变化，需在 `backend/` 下执行 `npm rebuild better-sqlite3 --build-from-source`，否则 backend 可能因 ABI 不匹配而启动失败。

## 工程化文档
- 部署说明：`DEPLOY.md`
- 运维排障：`OPERATIONS.md`
- 环境变量：`ENV.md`
- 架构说明：`ARCHITECTURE.md`
- 备份恢复：`BACKUP.md`
- 变更记录：`CHANGELOG.md`
- systemd 模板：`deploy/systemd/`
- Nginx 模板：`deploy/nginx/`
- 常用命令：`Makefile`
- 健康检查脚本：`scripts/check.sh`
