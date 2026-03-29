# Changelog

## Unreleased

### Added
- 初始化 Git 仓库并纳入 agent/backend/dashboard 源码
- 增加 `.gitignore`、`.nvmrc`、`.node-version`
- 增加部署与运维文档占位
- 增加 systemd 服务模板目录

### Changed
- 统一推荐运行环境为 Node.js 22.x / Go 1.22.x
- backend 启动前自动重建 `better-sqlite3`，降低 Node ABI 变化导致的启动失败风险
- dashboard systemd 启动方式改为 Next standalone server
- 更新 README，使其更贴近当前实现

### Fixed
- 修复 backend 因 `better-sqlite3` Node ABI 不匹配导致的持续重启
- 修复 backend 不可用时经由 Nginx 暴露出的 500/502 入口故障
