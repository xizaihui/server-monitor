# Server Monitor

轻量级服务器监控系统：
- Go agent：采集 CPU / 内存 / 磁盘 / Load Average / 端口探活
- Node.js API：接收 agent 上报、自动注册、分组管理、状态排序
- Next.js Dashboard：列表式大盘，异常自动置顶，支持分类筛选与手动移动分类

## 目录

- `agent/` Go agent 源码
- `backend/` Node.js + Express API
- `dashboard/` Next.js 前端
- `scripts/` 本地构建和远程部署脚本
- `dist/` 编译产物输出目录

## 功能

### Agent
- 自动采集：
  - CPU 使用率
  - 内存使用率
  - 磁盘空间使用率
  - 端口检测：443 / 6379 / 8888 / 8789
  - 实例标识（从业务配置中读取 `instance_id`，若存在）
- 自动注册到监控平台
- 周期性心跳上报
- 支持 Linux amd64 / arm64 编译
- 单文件二进制，适合大规模部署

### Dashboard
- 列表形式展示全部服务器
- 有问题的机器自动置顶
- 支持按分类筛选：美国 / 韩国 / 日本 / 自定义
- 支持手动把服务器移动到某分类
- 状态颜色清晰
- UI 风格参考 OpenAI / shadcn-ui 的简洁专业风格

## 默认接口
- API 默认端口：`8080`
- Dashboard 默认端口：`3000`

## 快速启动
详见各目录下说明。
