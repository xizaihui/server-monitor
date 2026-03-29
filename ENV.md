# 环境变量说明

## backend

示例文件：`backend/.env.example`

支持变量：

- `PORT`
  - 默认：`8080`
  - backend 监听端口

- `DATA_DIR`
  - 默认：`./data`
  - SQLite 数据目录

- `DASHBOARD_TOKEN`
  - 默认：空
  - 如设置，则 dashboard 与相关 API 需要访问令牌

- `OFFLINE_AFTER_SECONDS`
  - 默认：`180`
  - 节点多久未上报后视为离线

- `METRICS_RETENTION_DAYS`
  - 默认：`30`
  - 指标数据保留天数

## dashboard

示例文件：`dashboard/.env.example`

支持变量：

- `NEXT_PUBLIC_API_BASE`
  - 默认：`http://127.0.0.1:8080`
  - dashboard 服务端拉取 backend 数据的目标地址

- `PORT`
  - 生产中通常由 systemd 设置为 `3000`

## agent

示例文件：`agent/agent.env.example`

支持变量：

- `MONITOR_API`
  - 默认：`http://127.0.0.1:8080`
  - agent 上报目标 backend 地址

- `REPORT_INTERVAL`
  - 默认：`10`
  - 采集与上报间隔，单位秒

- `DISPLAY_NAME`
  - 默认：空
  - 节点显示名称，未设置时回退为 hostname

## 建议

- 生产环境的真实敏感值不要直接提交到仓库
- 优先通过 systemd `Environment=` 或环境文件注入
- 如使用 token，请记录其保管方式与轮换流程
