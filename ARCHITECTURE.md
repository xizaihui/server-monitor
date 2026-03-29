# 架构说明

## 总体结构

该项目由四部分组成：

1. `agent/`
   - Go 编写
   - 部署在被监控节点
   - 负责采集 CPU / 内存 / 磁盘 / 端口状态
   - 周期性上报到 backend

2. `backend/`
   - Node.js + Express + SQLite
   - 接收 agent 上报
   - 存储节点信息与监控指标
   - 根据规则计算 `healthy / problem / offline`
   - 提供 dashboard 所需 API

3. `dashboard/`
   - Next.js 控制台
   - 提供节点列表、筛选、分组、规则管理等 UI
   - 通过 backend API 获取数据

4. `nginx`
   - 暴露 80 端口
   - 统一代理 dashboard 与 backend API

## 数据流

### 1. Agent 上报

agent 按固定周期：
- 采集本机指标
- 采集固定端口状态
- 生成 payload
- POST 到：`/api/agent/register`

### 2. Backend 处理

backend 收到数据后：
- 自动注册/更新服务器信息
- 写入 `servers` 与 `metrics`
- 根据监控规则计算状态
- 在查询时结合 `last_seen` 判断是否离线

### 3. Dashboard 展示

dashboard 页面会：
- 服务端请求 backend API
- 渲染首屏列表
- 前端周期调用 `/api/proxy/snapshot` 刷新数据

### 4. Nginx 路由

- `/` → dashboard
- `/api/` → backend
- `/api/proxy/` → dashboard 内部代理路由
- `/downloads/` → agent 下载目录

## 主要存储

SQLite 数据库：
- 路径：`backend/data/monitor.db`
- 模式：WAL

主要表：
- `groups`
- `servers`
- `metrics`
- `settings`

## 状态计算

节点状态主要分为：
- `healthy`
- `problem`
- `offline`

判定来源：
- CPU / 内存 / 磁盘阈值
- 端口连续 DOWN 次数
- 心跳超时（`OFFLINE_AFTER_SECONDS`）

## 当前特点

- 单机部署，轻量
- SQLite 适合中小规模节点场景
- agent 监控端口当前是固定值
- dashboard 对 backend 可用性依赖较强

## 当前已做的工程化补强

- Node 22 版本策略
- `better-sqlite3` 启动前自动重建
- systemd 模板入库
- nginx 模板入库
- Makefile / DEPLOY / OPERATIONS / ENV 等文档补齐
