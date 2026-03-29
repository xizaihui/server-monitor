# P0 Acceptance Checklist

_Status: closing / final verification_

## Goal
Bring `/opt/server-monitor` to a production-usable P0 baseline for:
- node bootstrap
- agent management
- ops scripts initialization
- local package repository
- stable/release control
- dashboard visibility for readiness and package state

## Acceptance Checklist

### A. Node Bootstrap
- [x] `install-agent.sh` installs/updates agent as a systemd service
- [x] `INIT_OPS_SCRIPTS=1` optionally initializes `/opt/core-service/scripts`
- [x] bootstrap self-check verifies service active and scripts/VERSION when enabled

### B. Ops Scripts Initialization
- [x] `init_ops_scripts` is implemented as an agent builtin action
- [x] does not depend on pre-existing `/opt/core-service/scripts/init_ops_scripts.sh`
- [x] creates `/opt/core-service/scripts` and `/opt/core-service/backups` when missing
- [x] supports VERSION-based skip (`already_current`)

### C. Package Repository
- [x] local packages stored under `/var/www/server-monitor-downloads/packages`
- [x] categories include `agents`, `xagent`, `xbridge`, `xcore`, `redis`, `ops`
- [x] upload creates a release under `releases/<version>/`
- [x] upload can optionally publish release to `stable/current`
- [x] stable switch supported
- [x] rollback to previous release supported when previous release exists
- [x] checksum APIs available

### D. Stable Paths in Runtime Logic
- [x] install/update/init actions default to `stable/current` package URLs
- [x] xcore md5 source switched to local backend API

### E. Agent / Node Visibility
- [x] agent reports `agent_version`
- [x] agent reports `ops_scripts_version`
- [x] dashboard shows scripts version
- [x] dashboard shows readiness state and target gap
- [x] dashboard supports filtering `脚本未初始化` / `脚本需更新`

### F. Package Visibility in Dashboard
- [x] dashboard shows package catalog
- [x] dashboard shows stable / latest / releases / checksum
- [x] dashboard highlights unpublished releases
- [x] dashboard allows stable switch
- [x] dashboard allows rollback to previous release

### G. Validation
- [x] local bootstrap path re-run successfully after business-side cleanup
- [x] local `init_ops_scripts` action returns `success` or `already_current`
- [x] multiple remote nodes reached `agent_version=1.6.0` and `ops_scripts_version=2026.03.29-1`
- [ ] backend `/api/agent/register` no longer throws 500 during normal agent report path (final tail check)

## Exit Criteria for P0
P0 is considered complete when all items above are checked, especially the final backend register/report-path stability item.
