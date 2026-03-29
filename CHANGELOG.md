# Changelog

## Unreleased

### Added
- 动作定义、任务执行与任务历史能力覆盖 backend / agent / dashboard
- `incidents` 事件模型与故障到动作建议映射
- 新动作：
  - `restart_xagent`
  - `restart_xbridge`
  - `restart_redis`
  - `update_xcore`
  - `install_ixvpn`（对外展示为安装 xagent）
  - `install_xnftables`
  - `install_redis`
  - `apply_cert`
  - `init_ops_scripts`
- Dashboard 统一任务入口，支持单节点 / 批量任务
- Dashboard 任务历史详情视图
- 本机包仓库上传入口与后端上传接口
- 本机包仓库目录：agents / xagent / xbridge / xcore / redis / ops
- `ops-scripts.zip` 脚本包与初始化脚本能力

### Changed
- Dashboard 启动方式切回 `npm run start`，修复 CSS 静态资源异常
- 任务入口从表格行内移到顶部统一入口
- Dashboard 字体、字号、字重与整体视觉风格朝更克制的控制台方向重构
- 端口状态胶囊改为更宽的 pill，避免 `DOWN` 文本溢出
- 对外命名逐步从 `ixvpn` 收口为 `xagent`
- 安装类任务默认预填本机包仓库地址，但保留手动编辑能力
- 上传同名包时，先备份旧包再覆盖新包
- agent 发布入口统一切到最新包仓库路径
- `init_ops_scripts` 从依赖本地脚本改为 agent 内置动作，解决新节点初始化自依赖问题

### Fixed
- 修复 backend 因 `better-sqlite3` Node ABI 不匹配导致的持续重启
- 修复 dashboard CSS 404 导致页面无样式
- 修复任务历史详情代理与布局异常问题
- 修复本机业务节点动作 pending 根因：正式安装本机 agent 服务后可正常领取任务
- 修复 `DOWN` 端口胶囊显示溢出
- 修复新节点执行 `init_ops_scripts` 时因 `/opt/core-service/scripts/init_ops_scripts.sh` 不存在导致失败的问题
