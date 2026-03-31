import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execFileSync } from 'child_process';

const app = express();
const PORT = process.env.PORT || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'monitor.db');
const OFFLINE_AFTER_SECONDS = Number(process.env.OFFLINE_AFTER_SECONDS || 180);
const METRICS_RETENTION_DAYS = Number(process.env.METRICS_RETENTION_DAYS || 30);
const DEFAULT_GROUP = '未分组';
const DOWNLOAD_BASE_URL = process.env.DOWNLOAD_BASE_URL || 'http://43.165.172.3/downloads';
const DOWNLOAD_ROOT = process.env.DOWNLOAD_ROOT || '/var/www/server-monitor-downloads';

function getNotificationSettings() {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'notification_settings'`).get();
  if (!row) return { enabled: false, webhook_urls: [], notify_on: ['open', 'failed'] };
  try { return JSON.parse(row.value); } catch { return { enabled: false, webhook_urls: [], notify_on: ['open', 'failed'] }; }
}

async function sendIncidentNotification(incident, event) {
  const settings = getNotificationSettings();
  if (!settings.enabled || !Array.isArray(settings.webhook_urls) || !settings.webhook_urls.length) return;
  if (Array.isArray(settings.notify_on) && !settings.notify_on.includes(event)) return;
  const payload = {
    event,
    timestamp: new Date().toISOString(),
    incident: {
      id: incident.id,
      server_id: incident.server_id,
      fault_type: incident.fault_type,
      severity: incident.severity,
      status: incident.status,
      title: incident.title,
      details: incident.details,
      suggested_action: incident.suggested_action,
      first_seen_at: incident.first_seen_at,
      last_seen_at: incident.last_seen_at,
    }
  };
  for (const url of settings.webhook_urls) {
    if (!url || typeof url !== 'string') continue;
    try {
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => {});
    } catch {}
  }
}
const DEFAULT_RULES = {
  cpu: { enabled: true, threshold: 85, consecutive: 1 },
  memory: { enabled: true, threshold: 90, consecutive: 1 },
  disk: { enabled: true, threshold: 90, consecutive: 1 },
  port_443: { enabled: true, consecutive: 1 },
  port_6379: { enabled: true, consecutive: 1 },
  port_8888: { enabled: true, consecutive: 1 },
  port_8789: { enabled: true, consecutive: 1 },
};
const DEFAULT_ACTION_DEFINITIONS = [
  {
    action_key: 'restart_xagent', name: '重启 xagent', display_name: '重启 xagent', category: 'safe', description: '重启 xagent 服务并校验 8888 端口',
    script_path: '/opt/core-service/scripts/restart_xagent.sh', param_schema: JSON.stringify({ required: [], properties: {} }), role_scope: JSON.stringify(['xagent']),
    risk_level: 'safe', timeout_seconds: 120, executor_type: 'agent', cooldown_seconds: 1800, max_retries: 1, auto_enabled: 1, requires_approval: 0, batch_enabled: 1,
    trigger_faults: JSON.stringify(['port_8888_down', 'agent_heartbeat_timeout']), success_criteria: JSON.stringify({ services_active: ['xagent'], ports_up: [8888] }), fallback_action_key: 'install_ixvpn', priority: 10, metadata: JSON.stringify({})
  },
  {
    action_key: 'restart_xbridge', name: '重启 xbridge', display_name: '重启 xbridge', category: 'safe', description: '重启 xvpn-bridge-server 服务并校验 8789 端口',
    script_path: '/opt/core-service/scripts/restart_xbridge.sh', param_schema: JSON.stringify({ required: [], properties: {} }), role_scope: JSON.stringify(['xbridge']),
    risk_level: 'safe', timeout_seconds: 120, executor_type: 'agent', cooldown_seconds: 1800, max_retries: 1, auto_enabled: 1, requires_approval: 0, batch_enabled: 1,
    trigger_faults: JSON.stringify(['port_8789_down']), success_criteria: JSON.stringify({ services_active: ['xvpn-bridge-server'], ports_up: [8789] }), fallback_action_key: 'install_xnftables', priority: 10, metadata: JSON.stringify({})
  },
  {
    action_key: 'restart_redis', name: '重启 redis', display_name: '重启 redis', category: 'safe', description: '重启 redis 服务并校验 6379 端口',
    script_path: '/opt/core-service/scripts/restart_redis.sh', param_schema: JSON.stringify({ required: [], properties: {} }), role_scope: JSON.stringify(['xagent', 'redis']),
    risk_level: 'safe', timeout_seconds: 120, executor_type: 'agent', cooldown_seconds: 1800, max_retries: 1, auto_enabled: 1, requires_approval: 0, batch_enabled: 1,
    trigger_faults: JSON.stringify(['port_6379_down']), success_criteria: JSON.stringify({ ports_up: [6379] }), fallback_action_key: 'install_redis', priority: 10, metadata: JSON.stringify({})
  },
  {
    action_key: 'update_xcore', name: '更新 xcore 内核', display_name: '更新 xcore 内核', category: 'update', description: '增量更新 xcore 内核并重启 xagent 服务',
    script_path: '/opt/core-service/scripts/update_xcore.sh', param_schema: JSON.stringify({ required: [], properties: {} }), role_scope: JSON.stringify(['xagent']),
    risk_level: 'guarded', timeout_seconds: 300, executor_type: 'agent', cooldown_seconds: 3600, max_retries: 1, auto_enabled: 0, requires_approval: 1, batch_enabled: 0,
    trigger_faults: JSON.stringify(['port_443_down']), success_criteria: JSON.stringify({ ports_up: [443] }), fallback_action_key: 'install_ixvpn', priority: 20, metadata: JSON.stringify({ download_url: `${DOWNLOAD_BASE_URL}/packages/xcore/stable/current/xcore.zip`, restart_service: 'xagent.service' })
  },
  {
    action_key: 'install_ixvpn', name: '安装 xagent', display_name: '安装 xagent', category: 'install', description: '安装/重建 xagent，并由 xagent 自动拉起 xcore 内核',
    script_path: '/opt/core-service/scripts/install_ixvpn.sh',
    param_schema: JSON.stringify({ required: ['server_id', 'xagent_download_url', 'server_ip'], properties: { server_id: { type: 'string', maxLength: 128 }, xagent_download_url: { type: 'string', format: 'url' }, server_ip: { type: 'string', format: 'ipv4' } } }),
    role_scope: JSON.stringify(['xagent']), risk_level: 'guarded', timeout_seconds: 600, executor_type: 'agent', cooldown_seconds: 7200, max_retries: 0, auto_enabled: 0, requires_approval: 1, batch_enabled: 0,
    trigger_faults: JSON.stringify(['port_8888_down', 'port_443_down', 'component_missing']), success_criteria: JSON.stringify({ services_active: ['xagent'], ports_up: [8888] }), fallback_action_key: '', priority: 100, metadata: JSON.stringify({ download_url: `${DOWNLOAD_BASE_URL}/packages/xagent/stable/current/xagent-server.zip` })
  },
  {
    action_key: 'install_xnftables', name: '安装 xnftables', display_name: '安装 xnftables', category: 'install', description: '安装/重建 xvpn-bridge-server',
    script_path: '/opt/core-service/scripts/install_xnftables.sh',
    param_schema: JSON.stringify({ required: ['server_id', 'download_url'], properties: { server_id: { type: 'string', maxLength: 128 }, download_url: { type: 'string', format: 'url' } } }),
    role_scope: JSON.stringify(['xbridge']), risk_level: 'guarded', timeout_seconds: 600, executor_type: 'agent', cooldown_seconds: 7200, max_retries: 0, auto_enabled: 0, requires_approval: 1, batch_enabled: 0,
    trigger_faults: JSON.stringify(['port_8789_down', 'component_missing']), success_criteria: JSON.stringify({ services_active: ['xvpn-bridge-server'], ports_up: [8789, 8610] }), fallback_action_key: '', priority: 100, metadata: JSON.stringify({ download_url: `${DOWNLOAD_BASE_URL}/packages/xbridge/stable/current/xbridge-server.zip` })
  },
  {
    action_key: 'install_redis', name: '安装 redis', display_name: '安装 redis', category: 'install', description: '在线安装 redis 并校验 6379 端口',
    script_path: '/opt/core-service/scripts/install_redis.sh', param_schema: JSON.stringify({ required: [], properties: {} }), role_scope: JSON.stringify(['xagent', 'redis']),
    risk_level: 'guarded', timeout_seconds: 600, executor_type: 'agent', cooldown_seconds: 7200, max_retries: 0, auto_enabled: 0, requires_approval: 1, batch_enabled: 0,
    trigger_faults: JSON.stringify(['port_6379_down', 'component_missing']), success_criteria: JSON.stringify({ ports_up: [6379] }), fallback_action_key: 'restart_redis', priority: 100, metadata: JSON.stringify({ install_url: `${DOWNLOAD_BASE_URL}/packages/redis/stable/current/install_redis.sh` })
  },
  {
    action_key: 'apply_cert', name: '申请证书', display_name: '申请证书', category: 'repair', description: '生成自签名证书并检查证书文件',
    script_path: '/opt/core-service/scripts/apply_cert.sh',
    param_schema: JSON.stringify({ required: ['server_ip'], properties: { server_ip: { type: 'string', format: 'ipv4' } } }),
    role_scope: JSON.stringify(['xagent', 'xbridge']), risk_level: 'guarded', timeout_seconds: 600, executor_type: 'agent', cooldown_seconds: 7200, max_retries: 0, auto_enabled: 0, requires_approval: 1, batch_enabled: 0,
    trigger_faults: JSON.stringify(['component_missing']), success_criteria: JSON.stringify({ files_exist_any: ['/home/cert/Self-visa-certificate-no-domain-name-exists/server.crt', '/home/cert/Self-visa-certificate-no-domain-name-exists/server.key'] }), fallback_action_key: '', priority: 80, metadata: JSON.stringify({})
  },
  {
    action_key: 'init_ops_scripts', name: '初始化脚本', display_name: '初始化脚本', category: 'setup', description: '下载并初始化 /opt/core-service/scripts 运维脚本资产',
    script_path: '/opt/core-service/scripts/init_ops_scripts.sh',
    param_schema: JSON.stringify({ required: ['ops_scripts_url'], properties: { ops_scripts_url: { type: 'string', format: 'url' } } }),
    role_scope: JSON.stringify(['xagent', 'xbridge', 'redis']), risk_level: 'safe', timeout_seconds: 600, executor_type: 'agent', cooldown_seconds: 600, max_retries: 1, auto_enabled: 0, requires_approval: 0, batch_enabled: 1,
    trigger_faults: JSON.stringify(['component_missing']), success_criteria: JSON.stringify({ files_exist_any: ['/opt/core-service/scripts/restart_xagent.sh', '/opt/core-service/scripts/update_xcore.sh'] }), fallback_action_key: '', priority: 5, metadata: JSON.stringify({ ops_scripts_url: `${DOWNLOAD_BASE_URL}/packages/ops/stable/current/ops-scripts.zip` })
  },
  {
    action_key: 'upgrade_agent', name: '升级 Agent', display_name: '升级 Agent', category: 'maintenance', description: '下载最新 agent 二进制并重启',
    script_path: '/opt/core-service/scripts/upgrade_agent.sh',
    param_schema: JSON.stringify({ required: ['download_base'], properties: { download_base: { type: 'string', format: 'url' } } }),
    role_scope: JSON.stringify(['xagent', 'xbridge', 'redis']), risk_level: 'guarded', timeout_seconds: 300, executor_type: 'agent', cooldown_seconds: 300, max_retries: 0, auto_enabled: 0, requires_approval: 0, batch_enabled: 1,
    trigger_faults: JSON.stringify([]), success_criteria: JSON.stringify({}), fallback_action_key: '', priority: 10, metadata: JSON.stringify({ download_base: `${DOWNLOAD_BASE_URL}` })
  },
  {
    action_key: 'create_temp_user', name: '创建临时用户', display_name: '创建临时用户', category: 'takeover', description: '为 OpenClaw 接管创建临时 sudo 用户',
    script_path: '/opt/core-service/scripts/create_temp_user.sh',
    param_schema: JSON.stringify({ required: ['public_key'], properties: { public_key: { type: 'string' } } }),
    role_scope: JSON.stringify([]), risk_level: 'critical', timeout_seconds: 60, executor_type: 'agent', cooldown_seconds: 60, max_retries: 0, auto_enabled: 0, requires_approval: 0, batch_enabled: 0,
    trigger_faults: JSON.stringify([]), success_criteria: JSON.stringify({}), fallback_action_key: '', priority: 1, metadata: JSON.stringify({})
  },
  {
    action_key: 'delete_temp_user', name: '删除临时用户', display_name: '删除临时用户', category: 'takeover', description: '删除 OpenClaw 接管创建的临时用户',
    script_path: '/opt/core-service/scripts/delete_temp_user.sh',
    param_schema: JSON.stringify({ required: ['username'], properties: { username: { type: 'string' } } }),
    role_scope: JSON.stringify([]), risk_level: 'safe', timeout_seconds: 15, executor_type: 'agent', cooldown_seconds: 0, max_retries: 1, auto_enabled: 0, requires_approval: 0, batch_enabled: 0,
    trigger_faults: JSON.stringify([]), success_criteria: JSON.stringify({}), fallback_action_key: '', priority: 1, metadata: JSON.stringify({})
  }
];

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, sort_order INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS servers (id INTEGER PRIMARY KEY AUTOINCREMENT, server_id TEXT NOT NULL UNIQUE, hostname TEXT, display_name TEXT, ip TEXT, instance_id TEXT, os TEXT, arch TEXT, group_name TEXT DEFAULT '未分组', tags TEXT DEFAULT '[]', metadata TEXT DEFAULT '{}', status TEXT DEFAULT 'unknown', issue_count INTEGER DEFAULT 0, stable_order INTEGER, last_seen TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS metrics (id INTEGER PRIMARY KEY AUTOINCREMENT, server_id TEXT NOT NULL, cpu_usage REAL DEFAULT 0, memory_usage REAL DEFAULT 0, memory_used INTEGER DEFAULT 0, memory_total INTEGER DEFAULT 0, disk_usage REAL DEFAULT 0, disk_used INTEGER DEFAULT 0, disk_total INTEGER DEFAULT 0, port_443 INTEGER DEFAULT 0, port_6379 INTEGER DEFAULT 0, port_8888 INTEGER DEFAULT 0, port_8789 INTEGER DEFAULT 0, issues TEXT DEFAULT '[]', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS action_definitions (id INTEGER PRIMARY KEY AUTOINCREMENT, action_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT DEFAULT '', script_path TEXT NOT NULL, param_schema TEXT NOT NULL DEFAULT '{}', role_scope TEXT NOT NULL DEFAULT '[]', risk_level TEXT NOT NULL DEFAULT 'safe', timeout_seconds INTEGER NOT NULL DEFAULT 300, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS action_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL UNIQUE, server_id TEXT NOT NULL, action_key TEXT NOT NULL, params_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'pending', source TEXT NOT NULL DEFAULT 'dashboard', created_by TEXT DEFAULT '', priority INTEGER NOT NULL DEFAULT 100, timeout_seconds INTEGER NOT NULL DEFAULT 300, lease_token TEXT DEFAULT '', lease_expires_at TEXT DEFAULT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, started_at TEXT DEFAULT NULL, finished_at TEXT DEFAULT NULL, result_code TEXT DEFAULT '', exit_code INTEGER DEFAULT NULL, result_summary TEXT DEFAULT '', log_excerpt TEXT DEFAULT '', error_message TEXT DEFAULT '', retry_count INTEGER NOT NULL DEFAULT 0, parent_incident_id TEXT DEFAULT '', metadata TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS incidents (id INTEGER PRIMARY KEY AUTOINCREMENT, incident_key TEXT NOT NULL UNIQUE, dedupe_key TEXT NOT NULL, server_id TEXT NOT NULL, fault_type TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'warning', status TEXT NOT NULL DEFAULT 'open', title TEXT DEFAULT '', details TEXT DEFAULT '', suggested_action TEXT DEFAULT '', first_seen_at TEXT DEFAULT CURRENT_TIMESTAMP, last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP, resolved_at TEXT DEFAULT NULL, action_task_id TEXT DEFAULT '', metadata TEXT NOT NULL DEFAULT '{}');
CREATE INDEX IF NOT EXISTS idx_action_tasks_server_status ON action_tasks(server_id, status);
CREATE INDEX IF NOT EXISTS idx_action_tasks_status_priority_created ON action_tasks(status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_action_tasks_action_key ON action_tasks(action_key);
CREATE INDEX IF NOT EXISTS idx_incidents_server_status ON incidents(server_id, status);
CREATE INDEX IF NOT EXISTS idx_incidents_fault_status ON incidents(fault_type, status);
`);
for (const sql of [
  `ALTER TABLE servers ADD COLUMN stable_order INTEGER`,
  `ALTER TABLE servers ADD COLUMN instance_id TEXT`,
  `ALTER TABLE action_definitions ADD COLUMN display_name TEXT DEFAULT ''`,
  `ALTER TABLE action_definitions ADD COLUMN category TEXT DEFAULT 'safe'`,
  `ALTER TABLE action_definitions ADD COLUMN executor_type TEXT DEFAULT 'agent'`,
  `ALTER TABLE action_definitions ADD COLUMN cooldown_seconds INTEGER DEFAULT 1800`,
  `ALTER TABLE action_definitions ADD COLUMN max_retries INTEGER DEFAULT 0`,
  `ALTER TABLE action_definitions ADD COLUMN auto_enabled INTEGER DEFAULT 0`,
  `ALTER TABLE action_definitions ADD COLUMN requires_approval INTEGER DEFAULT 0`,
  `ALTER TABLE action_definitions ADD COLUMN batch_enabled INTEGER DEFAULT 0`,
  `ALTER TABLE action_definitions ADD COLUMN trigger_faults TEXT DEFAULT '[]'`,
  `ALTER TABLE action_definitions ADD COLUMN success_criteria TEXT DEFAULT '{}'`,
  `ALTER TABLE action_definitions ADD COLUMN fallback_action_key TEXT DEFAULT ''`,
  `ALTER TABLE action_definitions ADD COLUMN priority INTEGER DEFAULT 100`,
  `ALTER TABLE action_definitions ADD COLUMN metadata TEXT DEFAULT '{}'`
]) { try { db.exec(sql); } catch {} }
// Add diagnostics column
try { db.exec(`ALTER TABLE servers ADD COLUMN diagnostics TEXT DEFAULT '{}'`); } catch {}
db.prepare(`UPDATE servers SET stable_order = id WHERE stable_order IS NULL`).run();

const ensureGroup = db.prepare(`INSERT OR IGNORE INTO groups(name, sort_order) VALUES (?, ?)`);
try { db.prepare(`UPDATE servers SET group_name = ? WHERE group_name = 'Ungrouped'`).run(DEFAULT_GROUP); db.prepare(`DELETE FROM groups WHERE name = 'Ungrouped'`).run(); } catch {}
[DEFAULT_GROUP, '美国', '韩国', '日本'].forEach((name, i) => ensureGroup.run(name, i));
const ensureSetting = db.prepare(`INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)`);
ensureSetting.run('monitor_rules', JSON.stringify(DEFAULT_RULES));
const ensureAction = db.prepare(`INSERT OR IGNORE INTO action_definitions(action_key, name, description, script_path, param_schema, role_scope, risk_level, timeout_seconds, enabled, display_name, category, executor_type, cooldown_seconds, max_retries, auto_enabled, requires_approval, batch_enabled, trigger_faults, success_criteria, fallback_action_key, priority, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const updateAction = db.prepare(`UPDATE action_definitions SET name=?, description=?, script_path=?, param_schema=?, role_scope=?, risk_level=?, timeout_seconds=?, display_name=?, category=?, executor_type=?, cooldown_seconds=?, max_retries=?, auto_enabled=?, requires_approval=?, batch_enabled=?, trigger_faults=?, success_criteria=?, fallback_action_key=?, priority=?, metadata=?, updated_at=CURRENT_TIMESTAMP WHERE action_key=?`);
DEFAULT_ACTION_DEFINITIONS.forEach((a) => { ensureAction.run(a.action_key, a.name, a.description, a.script_path, a.param_schema, a.role_scope, a.risk_level, a.timeout_seconds, a.display_name, a.category, a.executor_type, a.cooldown_seconds, a.max_retries, a.auto_enabled, a.requires_approval, a.batch_enabled, a.trigger_faults, a.success_criteria, a.fallback_action_key, a.priority, a.metadata); updateAction.run(a.name, a.description, a.script_path, a.param_schema, a.role_scope, a.risk_level, a.timeout_seconds, a.display_name, a.category, a.executor_type, a.cooldown_seconds, a.max_retries, a.auto_enabled, a.requires_approval, a.batch_enabled, a.trigger_faults, a.success_criteria, a.fallback_action_key, a.priority, a.metadata, a.action_key); });

function getRules() { const row = db.prepare(`SELECT value FROM settings WHERE key = 'monitor_rules'`).get(); if (!row) return DEFAULT_RULES; try { const parsed = JSON.parse(row.value); return Object.fromEntries(Object.entries(DEFAULT_RULES).map(([key, val]) => [key, { ...val, ...(parsed[key] || {}) }])); } catch { return DEFAULT_RULES; } }
function cleanupOldMetrics() { db.prepare(`DELETE FROM metrics WHERE created_at < datetime('now', ?)`).run(`-${Math.max(1, METRICS_RETENTION_DAYS)} days`); }
function cleanupExpiredActionTasks() { const now = new Date().toISOString(); db.prepare(`UPDATE action_tasks SET status = 'expired', error_message = CASE WHEN error_message = '' THEN 'lease expired' ELSE error_message END, finished_at = COALESCE(finished_at, ?), lease_token = '', lease_expires_at = NULL WHERE status = 'leased' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?`).run(now, now); db.prepare(`UPDATE action_tasks SET status = 'timeout', error_message = CASE WHEN error_message = '' THEN 'task execution timeout' ELSE error_message END, finished_at = COALESCE(finished_at, ?), lease_token = '', lease_expires_at = NULL WHERE status = 'running' AND started_at IS NOT NULL AND datetime(started_at, '+' || timeout_seconds || ' seconds') < datetime(?)`).run(now, now); }
cleanupOldMetrics();
setInterval(cleanupExpiredActionTasks, 15000);

app.use(cors());
app.use(express.json({ limit: '1mb' }));
fs.mkdirSync(path.join(DOWNLOAD_ROOT, 'packages', 'agents'), { recursive: true });
fs.mkdirSync(path.join(DOWNLOAD_ROOT, 'packages', 'xagent'), { recursive: true });
fs.mkdirSync(path.join(DOWNLOAD_ROOT, 'packages', 'xbridge'), { recursive: true });
fs.mkdirSync(path.join(DOWNLOAD_ROOT, 'packages', 'xcore'), { recursive: true });
fs.mkdirSync(path.join(DOWNLOAD_ROOT, 'packages', 'redis'), { recursive: true });
const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN || '';
function authMiddleware(req, res, next) { if (!DASHBOARD_TOKEN) return next(); const auth = req.headers.authorization || ''; const cookie = req.headers.cookie || ''; const tokenFromHeader = auth.startsWith('Bearer ') ? auth.slice(7) : ''; const tokenFromCookie = (cookie.match(/dashboard_token=([^;]+)/) || [])[1] || ''; const tokenFromQuery = req.query?.token || ''; if (tokenFromHeader === DASHBOARD_TOKEN || tokenFromCookie === DASHBOARD_TOKEN || tokenFromQuery === DASHBOARD_TOKEN) return next(); return res.status(401).json({ error: 'unauthorized' }); }
function checkMetricConsecutive(serverId, column, predicate, consecutive) { const rows = db.prepare(`SELECT ${column} AS value FROM metrics WHERE server_id = ? ORDER BY id DESC LIMIT ?`).all(serverId, consecutive); if (rows.length < consecutive) return false; return rows.every((row) => predicate(Number(row.value || 0))); }
function calculateStatus(payload) { const rules = getRules(); const issues = []; const cpu = Number(payload.cpu_usage || 0), memory = Number(payload.memory_usage || 0), disk = Number(payload.disk_usage || 0), ports = payload.ports || {}; if (rules.cpu.enabled && cpu > rules.cpu.threshold && checkMetricConsecutive(payload.server_id, 'cpu_usage', (v) => v > Number(rules.cpu.threshold || 0), Number(rules.cpu.consecutive || 1))) issues.push(`CPU 连续${rules.cpu.consecutive}次 > ${rules.cpu.threshold}%`); if (rules.memory.enabled && memory > rules.memory.threshold && checkMetricConsecutive(payload.server_id, 'memory_usage', (v) => v > Number(rules.memory.threshold || 0), Number(rules.memory.consecutive || 1))) issues.push(`内存 连续${rules.memory.consecutive}次 > ${rules.memory.threshold}%`); if (rules.disk.enabled && disk > rules.disk.threshold && checkMetricConsecutive(payload.server_id, 'disk_usage', (v) => v > Number(rules.disk.threshold || 0), Number(rules.disk.consecutive || 1))) issues.push(`磁盘 连续${rules.disk.consecutive}次 > ${rules.disk.threshold}%`); for (const port of [443, 6379, 8888, 8789]) { const key = `port_${port}`; if (rules[key]?.enabled && !ports[String(port)] && checkMetricConsecutive(payload.server_id, key, (v) => Number(v) === 0, Number(rules[key]?.consecutive || 1))) issues.push(`端口 ${port} 连续${rules[key].consecutive}次 DOWN`); } return { status: issues.length ? 'problem' : 'healthy', issues, issue_count: issues.length }; }
function isValidIPv4(value) { return /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(String(value || '')); }
function isValidUrl(value) { try { new URL(String(value || '')); return true; } catch { return false; } }
function validateParams(definition, params = {}) { let schema = {}; try { schema = JSON.parse(definition.param_schema || '{}'); } catch { return { ok: false, error: 'invalid param_schema' }; } const required = Array.isArray(schema.required) ? schema.required : []; const properties = schema.properties || {}; for (const key of required) { const val = params[key]; if (val == null || String(val).trim() === '') return { ok: false, error: `missing param: ${key}` }; } for (const [key, rule] of Object.entries(properties)) { const val = params[key]; if (val == null) continue; const str = String(val); if (rule.maxLength && str.length > rule.maxLength) return { ok: false, error: `param too long: ${key}` }; if (rule.format === 'url' && !isValidUrl(str)) return { ok: false, error: `invalid url: ${key}` }; if (rule.format === 'ipv4' && !isValidIPv4(str)) return { ok: false, error: `invalid ipv4: ${key}` }; } return { ok: true }; }
function fileSha256(filePath) { const hash = crypto.createHash('sha256'); hash.update(fs.readFileSync(filePath)); return hash.digest('hex'); }
function fileMd5(filePath) { const hash = crypto.createHash('md5'); hash.update(fs.readFileSync(filePath)); return hash.digest('hex'); }
function genTaskId() { return `task_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`; }
function genLeaseToken() { return `lease_${crypto.randomBytes(12).toString('hex')}`; }
function faultSeverity(faultType) { if (faultType === 'server_offline') return 'critical'; return 'warning'; }
function faultTitle(serverId, faultType) { const map = { port_443_down: '内核端口 443 异常', port_6379_down: 'Redis 端口 6379 异常', port_8888_down: 'XAgent 端口 8888 异常', port_8789_down: 'XBridge 端口 8789 异常', server_offline: '节点离线' }; return `${serverId} · ${map[faultType] || faultType}`; }
function suggestAction(faultType) { const map = { port_443_down: 'update_xcore', port_6379_down: 'restart_redis', port_8888_down: 'restart_xagent', port_8789_down: 'restart_xbridge', server_offline: '' }; return map[faultType] || ''; }
function upsertIncidentsForServer(serverId, serverStatus, issues, metadata = {}) {
  const activeFaults = new Set();
  for (const issue of issues || []) {
    let faultType = '';
    if (String(issue).includes('端口 443')) faultType = 'port_443_down';
    else if (String(issue).includes('端口 6379')) faultType = 'port_6379_down';
    else if (String(issue).includes('端口 8888')) faultType = 'port_8888_down';
    else if (String(issue).includes('端口 8789')) faultType = 'port_8789_down';
    else if (String(issue).includes('Heartbeat timeout')) faultType = 'server_offline';
    if (!faultType) continue;
    activeFaults.add(faultType);
    const dedupeKey = `${serverId}:${faultType}`;
    const incidentKey = crypto.createHash('sha1').update(dedupeKey).digest('hex').slice(0, 24);
    const existing = db.prepare(`SELECT id, status FROM incidents WHERE dedupe_key = ? AND status IN ('open','acknowledged','auto_remediating','failed','takeover_pending','takeover_active') ORDER BY id DESC LIMIT 1`).get(dedupeKey);
    if (existing) {
      // Don't overwrite metadata for takeover-related statuses (they contain takeover_user etc)
      if (existing.status === 'takeover_pending' || existing.status === 'takeover_active') {
        db.prepare(`UPDATE incidents SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?`).run(existing.id);
      } else {
        db.prepare(`UPDATE incidents SET last_seen_at = CURRENT_TIMESTAMP, details = ?, suggested_action = ?, metadata = ? WHERE id = ?`).run(String(issue), suggestAction(faultType), JSON.stringify(metadata || {}), existing.id);
      }
    } else {
      const resolvedExisting = db.prepare(`SELECT id FROM incidents WHERE dedupe_key = ? AND status = 'resolved' ORDER BY id DESC LIMIT 1`).get(dedupeKey);
      if (resolvedExisting) {
        db.prepare(`UPDATE incidents SET status = 'open', resolved_at = NULL, last_seen_at = CURRENT_TIMESTAMP, details = ?, suggested_action = ?, action_task_id = '', metadata = ? WHERE id = ?`).run(String(issue), suggestAction(faultType), JSON.stringify(metadata || {}), resolvedExisting.id);
        const reopened = db.prepare(`SELECT * FROM incidents WHERE id = ?`).get(resolvedExisting.id);
        if (reopened) sendIncidentNotification(reopened, 'open');
      } else {
        const inserted = db.prepare(`INSERT OR IGNORE INTO incidents(incident_key, dedupe_key, server_id, fault_type, severity, status, title, details, suggested_action, metadata) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`).run(incidentKey, dedupeKey, serverId, faultType, faultSeverity(faultType), faultTitle(serverId, faultType), String(issue), suggestAction(faultType), JSON.stringify(metadata || {}));
        if (inserted.changes) {
          const newInc = db.prepare(`SELECT * FROM incidents WHERE incident_key = ?`).get(incidentKey);
          if (newInc) sendIncidentNotification(newInc, 'open');
        }
        if (!inserted.changes) {
          const current = db.prepare(`SELECT id FROM incidents WHERE dedupe_key = ? ORDER BY id DESC LIMIT 1`).get(dedupeKey);
          if (current) {
            db.prepare(`UPDATE incidents SET status = 'open', resolved_at = NULL, last_seen_at = CURRENT_TIMESTAMP, details = ?, suggested_action = ?, action_task_id = '', metadata = ? WHERE id = ?`).run(String(issue), suggestAction(faultType), JSON.stringify(metadata || {}), current.id);
          }
        }
      }
    }
  }
  const openRows = db.prepare(`SELECT id, fault_type, status FROM incidents WHERE server_id = ? AND status IN ('open','acknowledged','auto_remediating','failed')`).all(serverId);
  for (const row of openRows) {
    if (!activeFaults.has(row.fault_type) && !(row.fault_type === 'server_offline' && serverStatus === 'offline')) {
      db.prepare(`UPDATE incidents SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP, last_seen_at = CURRENT_TIMESTAMP WHERE id = ?`).run(row.id);
    }
  }
}

app.get('/api/health', (req, res) => res.json({ ok: true, hostname: os.hostname(), port: PORT, offlineAfterSeconds: OFFLINE_AFTER_SECONDS, metricsRetentionDays: METRICS_RETENTION_DAYS }));
app.get('/api/settings/monitor-rules', authMiddleware, (req, res) => res.json(getRules()));
app.patch('/api/settings/monitor-rules', authMiddleware, (req, res) => { const body = req.body || {}; const nextRules = Object.fromEntries(Object.entries(DEFAULT_RULES).map(([key, val]) => [key, { ...val, ...(body[key] || {}) }])); db.prepare(`UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = 'monitor_rules'`).run(JSON.stringify(nextRules)); res.json({ ok: true, rules: nextRules }); });

app.get('/api/settings/notifications', authMiddleware, (req, res) => res.json(getNotificationSettings()));
app.patch('/api/settings/notifications', authMiddleware, (req, res) => {
  const body = req.body || {};
  const current = getNotificationSettings();
  const next = {
    enabled: body.enabled !== undefined ? !!body.enabled : current.enabled,
    webhook_urls: Array.isArray(body.webhook_urls) ? body.webhook_urls.filter(u => typeof u === 'string' && u.trim()) : current.webhook_urls,
    notify_on: Array.isArray(body.notify_on) ? body.notify_on : current.notify_on,
  };
  const existing = db.prepare(`SELECT key FROM settings WHERE key = 'notification_settings'`).get();
  if (existing) {
    db.prepare(`UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = 'notification_settings'`).run(JSON.stringify(next));
  } else {
    db.prepare(`INSERT INTO settings(key, value) VALUES ('notification_settings', ?)`).run(JSON.stringify(next));
  }
  res.json({ ok: true, settings: next });
});
app.get('/api/actions/definitions', authMiddleware, (req, res) => { const rows = db.prepare(`SELECT action_key, name, display_name, category, description, param_schema, role_scope, risk_level, timeout_seconds, executor_type, cooldown_seconds, max_retries, auto_enabled, requires_approval, batch_enabled, trigger_faults, success_criteria, fallback_action_key, priority, metadata FROM action_definitions WHERE enabled = 1 ORDER BY priority ASC, id ASC`).all(); res.json(rows.map((row) => ({ ...row, role_scope: JSON.parse(row.role_scope || '[]'), param_schema: JSON.parse(row.param_schema || '{}'), trigger_faults: JSON.parse(row.trigger_faults || '[]'), success_criteria: JSON.parse(row.success_criteria || '{}'), metadata: JSON.parse(row.metadata || '{}') }))); });
app.get('/api/incidents', authMiddleware, (req, res) => { const { status, server_id, limit } = req.query || {}; const where = []; const params = []; if (status) { where.push('status = ?'); params.push(status); } if (server_id) { where.push('server_id = ?'); params.push(server_id); } const sql = `SELECT * FROM incidents ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY last_seen_at DESC, id DESC LIMIT ?`; params.push(Math.max(1, Math.min(Number(limit || 50), 200))); res.json(db.prepare(sql).all(...params)); });

app.get('/api/incidents/stats', authMiddleware, (req, res) => {
  const days = Math.max(1, Math.min(Number(req.query.days || 7), 30));
  const rows = db.prepare(`
    SELECT
      date(first_seen_at) as day,
      COUNT(*) as total,
      SUM(CASE WHEN status = 'open' OR status = 'acknowledged' THEN 1 ELSE 0 END) as open_count,
      SUM(CASE WHEN status = 'auto_remediating' THEN 1 ELSE 0 END) as remediating_count,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count,
      SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved_count
    FROM incidents
    WHERE first_seen_at >= date('now', '-' || ? || ' days')
    GROUP BY date(first_seen_at)
    ORDER BY day ASC
  `).all(days);
  const byFault = db.prepare(`
    SELECT fault_type, COUNT(*) as count
    FROM incidents
    WHERE first_seen_at >= date('now', '-' || ? || ' days')
    GROUP BY fault_type
    ORDER BY count DESC
  `).all(days);
  const totalAll = db.prepare(`SELECT COUNT(*) as count FROM incidents`).get();
  res.json({ days: rows, byFault, totalIncidents: totalAll.count });
});

app.get('/api/incidents/export', authMiddleware, (req, res) => {
  const all = db.prepare(`SELECT * FROM incidents ORDER BY first_seen_at DESC`).all();
  const header = 'id,incident_key,server_id,fault_type,severity,status,title,details,suggested_action,first_seen_at,last_seen_at,resolved_at,action_task_id';
  const csvRows = all.map(r => [
    r.id, r.incident_key, r.server_id, r.fault_type, r.severity, r.status,
    `"${(r.title || '').replace(/"/g, '""')}"`,
    `"${(r.details || '').replace(/"/g, '""')}"`,
    r.suggested_action, r.first_seen_at, r.last_seen_at, r.resolved_at || '', r.action_task_id || ''
  ].join(','));
  const csv = [header, ...csvRows].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=incidents_export.csv');
  res.send(csv);
});
app.get('/api/packages/checksums', authMiddleware, (req, res) => {
  try {
    const xray = path.join(DOWNLOAD_ROOT, 'packages', 'xcore', 'xcore.zip');
    const result = {
      xcore_zip: fs.existsSync(xray) ? { md5: fileMd5(xray), sha256: fileSha256(xray) } : null,
      xagent_zip: (() => { const p = path.join(DOWNLOAD_ROOT, 'packages', 'xagent', 'xagent-server.zip'); return fs.existsSync(p) ? { md5: fileMd5(p), sha256: fileSha256(p) } : null; })(),
      xbridge_zip: (() => { const p = path.join(DOWNLOAD_ROOT, 'packages', 'xbridge', 'xbridge-server.zip'); return fs.existsSync(p) ? { md5: fileMd5(p), sha256: fileSha256(p) } : null; })(),
      redis_script: (() => { const p = path.join(DOWNLOAD_ROOT, 'packages', 'redis', 'install_redis.sh'); return fs.existsSync(p) ? { md5: fileMd5(p), sha256: fileSha256(p) } : null; })(),
      ops_scripts_zip: (() => { const p = path.join(DOWNLOAD_ROOT, 'packages', 'ops', 'ops-scripts.zip'); return fs.existsSync(p) ? { md5: fileMd5(p), sha256: fileSha256(p) } : null; })(),
    };
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || 'checksum failed' });
  }
});

// Expected binary MD5s from stable packages — used by frontend to compare with agent-reported checksums
let _expectedMd5Cache = { data: null, ts: 0 };
function zipEntryMd5(zipPath, entryPath) {
  try {
    const buf = execFileSync('unzip', ['-p', zipPath, entryPath], { maxBuffer: 200 * 1024 * 1024, timeout: 30000 });
    const hash = crypto.createHash('md5'); hash.update(buf); return hash.digest('hex');
  } catch { return ''; }
}
function computeExpectedMd5s() {
  const now = Date.now();
  if (_expectedMd5Cache.data && now - _expectedMd5Cache.ts < 60000) return _expectedMd5Cache.data;
  const stableXagent = path.join(DOWNLOAD_ROOT, 'packages', 'xagent', 'stable', 'current', 'xagent-server.zip');
  const stableXbridge = path.join(DOWNLOAD_ROOT, 'packages', 'xbridge', 'stable', 'current', 'xbridge-server.zip');
  const stableXcore = path.join(DOWNLOAD_ROOT, 'packages', 'xcore', 'stable', 'current', 'xcore.zip');
  const result = {
    xagent_md5: fs.existsSync(stableXagent) ? zipEntryMd5(stableXagent, 'xagent-server/xagent') : '',
    xbridge_md5: fs.existsSync(stableXbridge) ? zipEntryMd5(stableXbridge, 'xbrigde-server/xvpn-bridge-server') : '',
    xray_md5: fs.existsSync(stableXcore) ? zipEntryMd5(stableXcore, 'xcore/xray') : '',
    singbox_md5: fs.existsSync(stableXcore) ? zipEntryMd5(stableXcore, 'xcore/singbox') : '',
    xagent_version: (() => { try { return fs.readlinkSync(path.join(DOWNLOAD_ROOT, 'packages', 'xagent', 'stable', 'current')).replace(/^\.\.\/releases\//, ''); } catch { return ''; } })(),
    xbridge_version: (() => { try { return fs.readlinkSync(path.join(DOWNLOAD_ROOT, 'packages', 'xbridge', 'stable', 'current')).replace(/^\.\.\/releases\//, ''); } catch { return ''; } })(),
    xcore_version: (() => { try { return fs.readlinkSync(path.join(DOWNLOAD_ROOT, 'packages', 'xcore', 'stable', 'current')).replace(/^\.\.\/releases\//, ''); } catch { return ''; } })(),
  };
  _expectedMd5Cache = { data: result, ts: now };
  return result;
}
app.get('/api/packages/expected-checksums', authMiddleware, (req, res) => {
  try { res.json(computeExpectedMd5s()); } catch (error) { res.status(500).json({ error: error.message }); }
});
app.get('/api/packages/catalog', authMiddleware, (req, res) => {
  try {
    const names = ['agents', 'xagent', 'xbridge', 'xcore', 'redis', 'ops'];
    const catalog = names.map((name) => {
      const stable = path.join(DOWNLOAD_ROOT, 'packages', name, 'stable', 'current');
      let stableTarget = '';
      try { stableTarget = fs.readlinkSync(stable); } catch {}
      const stableVersion = stableTarget.replace(/^\.\.\/releases\//, '');
      const releasesDir = path.join(DOWNLOAD_ROOT, 'packages', name, 'releases');
      const releases = fs.existsSync(releasesDir) ? fs.readdirSync(releasesDir).sort().reverse() : [];
      const latest = releases[0] || '';
      return { name, stable: stableVersion, latest, releases, hasUnpublished: !!latest && !!stableVersion && latest !== stableVersion };
    });
    res.json(catalog);
  } catch (error) {
    res.status(500).json({ error: error.message || 'catalog failed' });
  }
});
function switchStableRelease(name, release) {
  const releaseDir = path.join(DOWNLOAD_ROOT, 'packages', name, 'releases', release);
  if (!fs.existsSync(releaseDir)) throw new Error('release not found');
  const stableDir = path.join(DOWNLOAD_ROOT, 'packages', name, 'stable');
  fs.mkdirSync(stableDir, { recursive: true });
  const stableLink = path.join(stableDir, 'current');
  try { fs.rmSync(stableLink, { force: true, recursive: true }); } catch {}
  fs.symlinkSync(`../releases/${release}`, stableLink);
}
app.post('/api/packages/:name/stable', authMiddleware, (req, res) => {
  try {
    const name = String(req.params.name || '').trim();
    const release = String(req.body?.release || '').trim();
    if (!['agents', 'xagent', 'xbridge', 'xcore', 'redis', 'ops'].includes(name)) return res.status(400).json({ error: 'invalid package name' });
    if (!release) return res.status(400).json({ error: 'release required' });
    switchStableRelease(name, release);
    return res.json({ ok: true, name, stable: release });
  } catch (error) {
    return res.status(error.message === 'release not found' ? 404 : 500).json({ error: error.message || 'switch stable failed' });
  }
});
app.post('/api/packages/:name/rollback', authMiddleware, (req, res) => {
  try {
    const name = String(req.params.name || '').trim();
    if (!['agents', 'xagent', 'xbridge', 'xcore', 'redis', 'ops'].includes(name)) return res.status(400).json({ error: 'invalid package name' });
    const releasesDir = path.join(DOWNLOAD_ROOT, 'packages', name, 'releases');
    const releases = fs.existsSync(releasesDir) ? fs.readdirSync(releasesDir).sort().reverse() : [];
    const stable = path.join(DOWNLOAD_ROOT, 'packages', name, 'stable', 'current');
    let current = '';
    try { current = fs.readlinkSync(stable).replace(/^\.\.\/releases\//, ''); } catch {}
    const idx = releases.indexOf(current);
    const target = idx >= 0 && releases[idx + 1] ? releases[idx + 1] : releases[1];
    if (!target) return res.status(400).json({ error: 'no previous release' });
    switchStableRelease(name, target);
    return res.json({ ok: true, name, stable: target, previous: current });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'rollback failed' });
  }
});
app.get('/api/packages/md5', (req, res) => {
  try {
    const expected = computeExpectedMd5s();
    const xrayMd5 = expected.xray_md5 || 'NOT_FOUND';
    const singboxMd5 = expected.singbox_md5 || 'NOT_FOUND';
    res.type('text/plain').send(`xray=${xrayMd5}\nsingbox=${singboxMd5}\n`);
  } catch (error) {
    res.status(500).type('text/plain').send('xray=ERROR\nsingbox=ERROR\n');
  }
});
app.post('/api/uploads/packages', authMiddleware, (req, res) => {
  const contentType = String(req.headers['content-type'] || '');
  const match = contentType.match(/boundary=(.+)$/);
  if (!match) return res.status(400).json({ error: 'multipart boundary missing' });
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    try {
      const buffer = Buffer.concat(chunks);
      const boundary = Buffer.from(`--${match[1]}`);
      const parts = buffer.toString('binary').split(boundary.toString('binary')).filter((part) => part.includes('Content-Disposition'));
      let folder = 'packages/xagent';
      let fileName = '';
      let fileBuffer = null;
      let release = '';
      let publishStable = '0';
      for (const part of parts) {
        const [rawHeaders, rawBody] = part.split('\r\n\r\n');
        if (!rawHeaders || !rawBody) continue;
        const disposition = rawHeaders.match(/name="([^"]+)"(?:; filename="([^"]+)")?/);
        if (!disposition) continue;
        const fieldName = disposition[1];
        const originalName = disposition[2];
        const bodyBinary = rawBody.replace(/\r\n--$/, '').replace(/\r\n$/, '');
        if (fieldName === 'folder') folder = bodyBinary.trim().replace(/^\/+/, '').replace(/\.\./g, '');
        if (fieldName === 'release') release = bodyBinary.trim().replace(/[^a-zA-Z0-9._-]/g, '');
        if (fieldName === 'publish_stable') publishStable = bodyBinary.trim();
        if (fieldName === 'file' && originalName) {
          fileName = path.basename(originalName).replace(/[^a-zA-Z0-9._-]/g, '_');
          fileBuffer = Buffer.from(bodyBinary, 'binary');
        }
      }
      if (!fileName || !fileBuffer) return res.status(400).json({ error: 'file missing' });
      if (!['packages/agents','packages/xagent','packages/xbridge','packages/xcore','packages/redis','packages/ops'].includes(folder)) folder = 'packages/xagent';
      if (!release) release = new Date().toISOString().slice(0, 10).replace(/-/g, '.') + '-auto';
      const pkgName = folder.replace(/^packages\//, '');
      const releasesDir = path.join(DOWNLOAD_ROOT, folder, 'releases', release);
      const currentDir = path.join(DOWNLOAD_ROOT, folder);
      const backupDir = path.join(DOWNLOAD_ROOT, 'backups', pkgName);
      fs.mkdirSync(releasesDir, { recursive: true });
      fs.mkdirSync(currentDir, { recursive: true });
      fs.mkdirSync(backupDir, { recursive: true });
      const releasePath = path.join(releasesDir, fileName);
      fs.writeFileSync(releasePath, fileBuffer);
      fs.chmodSync(releasePath, 0o644);
      const currentPath = path.join(currentDir, fileName);
      let backupPath = '';
      if (fs.existsSync(currentPath)) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        backupPath = path.join(backupDir, `${stamp}__${fileName}`);
        fs.copyFileSync(currentPath, backupPath);
      }
      fs.copyFileSync(releasePath, currentPath);
      if (publishStable === '1') switchStableRelease(pkgName, release);
      return res.json({ ok: true, file_name: fileName, release, path: releasePath, url: `${DOWNLOAD_BASE_URL}/${folder}/releases/${release}/${fileName}`, current_url: `${DOWNLOAD_BASE_URL}/${folder}/${fileName}`, stable_url: publishStable === '1' ? `${DOWNLOAD_BASE_URL}/${folder}/stable/current/${fileName}` : null, backup_path: backupPath || null });
    } catch (error) {
      return res.status(500).json({ error: error.message || 'upload failed' });
    }
  });
});
app.post('/api/agent/register', (req, res) => {
  const body = req.body || {}, serverId = body.server_id;
  if (!serverId) return res.status(400).json({ error: 'server_id required' });
  ensureGroup.run(DEFAULT_GROUP, 0);
  const now = new Date().toISOString();
  const diagJson = body.diagnostics ? JSON.stringify(body.diagnostics) : '{}';
  const existing = db.prepare(`SELECT id FROM servers WHERE server_id = ?`).get(serverId);
  const sameHostOffline = db.prepare(`SELECT id, server_id FROM servers WHERE hostname = ? AND server_id <> ? ORDER BY last_seen DESC, id DESC LIMIT 1`).get(body.hostname || '', serverId);
  if (!existing && sameHostOffline) {
    db.prepare(`UPDATE metrics SET server_id = ? WHERE server_id = ?`).run(serverId, sameHostOffline.server_id);
    db.prepare(`UPDATE servers SET server_id = ?, hostname = ?, display_name = ?, ip = ?, instance_id = ?, os = ?, arch = ?, metadata = ?, diagnostics = ?, last_seen = ?, updated_at = ? WHERE id = ?`).run(serverId, body.hostname || serverId, body.display_name || body.hostname || serverId, body.ip || '', body.instance_id || '', body.os || '', body.arch || '', JSON.stringify(body.metadata || {}), diagJson, now, now, sameHostOffline.id);
  } else if (!existing) {
    const result = db.prepare(`INSERT INTO servers (server_id, hostname, display_name, ip, instance_id, os, arch, group_name, tags, metadata, diagnostics, status, issue_count, stable_order, last_seen, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'healthy', 0, NULL, ?, ?)`).run(serverId, body.hostname || serverId, body.display_name || body.hostname || serverId, body.ip || '', body.instance_id || '', body.os || '', body.arch || '', DEFAULT_GROUP, JSON.stringify(body.tags || []), JSON.stringify(body.metadata || {}), diagJson, now, now);
    db.prepare(`UPDATE servers SET stable_order = id WHERE id = ?`).run(result.lastInsertRowid);
  } else {
    db.prepare(`UPDATE servers SET hostname = ?, display_name = ?, ip = ?, instance_id = ?, os = ?, arch = ?, metadata = ?, diagnostics = ?, last_seen = ?, updated_at = ? WHERE server_id = ?`).run(body.hostname || serverId, body.display_name || body.hostname || serverId, body.ip || '', body.instance_id || '', body.os || '', body.arch || '', JSON.stringify(body.metadata || {}), diagJson, now, now, serverId);
  }
  db.prepare(`INSERT INTO metrics (server_id, cpu_usage, memory_usage, memory_used, memory_total, disk_usage, disk_used, disk_total, port_443, port_6379, port_8888, port_8789, issues) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]')`).run(serverId, Number(body.cpu_usage || 0), Number(body.memory_usage || 0), Number(body.memory_used || 0), Number(body.memory_total || 0), Number(body.disk_usage || 0), Number(body.disk_used || 0), Number(body.disk_total || 0), body.ports?.['443'] ? 1 : 0, body.ports?.['6379'] ? 1 : 0, body.ports?.['8888'] ? 1 : 0, body.ports?.['8789'] ? 1 : 0);
  const derived = calculateStatus(body);
  db.prepare(`UPDATE servers SET status = ?, issue_count = ?, updated_at = ? WHERE server_id = ?`).run(derived.status, derived.issue_count, now, serverId);
  db.prepare(`UPDATE metrics SET issues = ? WHERE id = (SELECT id FROM metrics WHERE server_id = ? ORDER BY id DESC LIMIT 1)`).run(JSON.stringify(derived.issues), serverId);
  upsertIncidentsForServer(serverId, derived.status, derived.issues, { ip: body.ip || '', hostname: body.hostname || '', instance_id: body.instance_id || '' });
  res.json({ ok: true, status: derived.status, issues: derived.issues, assigned_group: DEFAULT_GROUP });
});
app.post('/api/actions/tasks', authMiddleware, (req, res) => { const body = req.body || {}; const serverId = String(body.server_id || '').trim(); const actionKey = String(body.action_key || '').trim(); const params = body.params || {}; const source = String(body.source || 'dashboard'); const createdBy = String(body.created_by || 'dashboard'); if (!serverId || !actionKey) return res.status(400).json({ error: 'server_id and action_key required' }); const def = db.prepare(`SELECT * FROM action_definitions WHERE action_key = ? AND enabled = 1`).get(actionKey); if (!def) return res.status(404).json({ error: 'action definition not found' }); const activeTask = db.prepare(`SELECT task_id, status FROM action_tasks WHERE server_id = ? AND status IN ('pending', 'leased', 'running') ORDER BY created_at ASC LIMIT 1`).get(serverId); if (activeTask) return res.status(409).json({ error: 'server already has active task', activeTask }); const v = validateParams(def, params); if (!v.ok) return res.status(400).json({ error: v.error }); const taskId = genTaskId(); db.prepare(`INSERT INTO action_tasks(task_id, server_id, action_key, params_json, status, source, created_by, priority, timeout_seconds, metadata) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, '{}')`).run(taskId, serverId, actionKey, JSON.stringify(params), source, createdBy, Number(def.priority || 100), Number(def.timeout_seconds || 300)); return res.json({ ok: true, task: { task_id: taskId, status: 'pending' } }); });
app.get('/api/actions/tasks', authMiddleware, (req, res) => { const { server_id, status, action_key, limit } = req.query || {}; const where = []; const params = []; if (server_id) { where.push(`server_id = ?`); params.push(server_id); } if (status) { where.push(`status = ?`); params.push(status); } if (action_key) { where.push(`action_key = ?`); params.push(action_key); } const sql = `SELECT * FROM action_tasks ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC, id DESC LIMIT ?`; params.push(Math.max(1, Math.min(Number(limit || 50), 200))); res.json(db.prepare(sql).all(...params)); });
app.get('/api/actions/tasks/:taskId', authMiddleware, (req, res) => { const row = db.prepare(`SELECT * FROM action_tasks WHERE task_id = ?`).get(req.params.taskId); if (!row) return res.status(404).json({ error: 'task not found' }); res.json(row); });
app.post('/api/agent/tasks/next', (req, res) => { const body = req.body || {}; const serverId = String(body.server_id || '').trim(); const capabilities = Array.isArray(body.capabilities) ? body.capabilities.map(String) : []; if (!serverId) return res.status(400).json({ error: 'server_id required' }); const active = db.prepare(`SELECT * FROM action_tasks WHERE server_id = ? AND status IN ('leased', 'running') ORDER BY created_at ASC LIMIT 1`).get(serverId); if (active) return res.json({ ok: true, task: null }); const candidates = db.prepare(`SELECT t.* FROM action_tasks t JOIN action_definitions d ON d.action_key = t.action_key WHERE t.server_id = ? AND t.status = 'pending' AND d.enabled = 1 ORDER BY COALESCE(d.priority, t.priority) ASC, t.created_at ASC, t.id ASC LIMIT 20`).all(serverId); const picked = candidates.find((task) => capabilities.includes(task.action_key) || task.action_key === 'upgrade_agent'); if (!picked) return res.json({ ok: true, task: null }); const leaseToken = genLeaseToken(); const leaseExpiresAt = new Date(Date.now() + 60 * 1000).toISOString(); const result = db.prepare(`UPDATE action_tasks SET status = 'leased', lease_token = ?, lease_expires_at = ? WHERE task_id = ? AND status = 'pending'`).run(leaseToken, leaseExpiresAt, picked.task_id); if (!result.changes) return res.json({ ok: true, task: null }); const task = db.prepare(`SELECT * FROM action_tasks WHERE task_id = ?`).get(picked.task_id); return res.json({ ok: true, task: { task_id: task.task_id, action_key: task.action_key, params: JSON.parse(task.params_json || '{}'), timeout_seconds: task.timeout_seconds, lease_token: leaseToken } }); });
app.post('/api/agent/tasks/:taskId/start', (req, res) => { const taskId = req.params.taskId; const body = req.body || {}; const serverId = String(body.server_id || '').trim(); const leaseToken = String(body.lease_token || '').trim(); const task = db.prepare(`SELECT * FROM action_tasks WHERE task_id = ?`).get(taskId); if (!task) return res.status(404).json({ error: 'task not found' }); if (task.server_id !== serverId || task.lease_token !== leaseToken) return res.status(403).json({ error: 'invalid lease' }); db.prepare(`UPDATE action_tasks SET status = 'running', started_at = COALESCE(started_at, ?) WHERE task_id = ?`).run(new Date().toISOString(), taskId); res.json({ ok: true }); });
app.post('/api/incidents/:id/trigger', authMiddleware, (req, res) => {
  const incidentId = req.params.id;
  const body = req.body || {};
  const incident = db.prepare(`SELECT * FROM incidents WHERE id = ?`).get(incidentId);
  if (!incident) return res.status(404).json({ error: 'incident not found' });
  if (incident.status === 'resolved') return res.status(400).json({ error: 'incident already resolved' });
  const actionKey = String(body.action_key || incident.suggested_action || '').trim();
  if (!actionKey) return res.status(400).json({ error: 'no suggested action for this incident' });
  const def = db.prepare(`SELECT * FROM action_definitions WHERE action_key = ? AND enabled = 1`).get(actionKey);
  if (!def) return res.status(404).json({ error: 'action definition not found: ' + actionKey });
  const serverId = incident.server_id;
  const activeTask = db.prepare(`SELECT task_id, status FROM action_tasks WHERE server_id = ? AND status IN ('pending', 'leased', 'running') ORDER BY created_at ASC LIMIT 1`).get(serverId);
  if (activeTask) return res.status(409).json({ error: 'server already has active task', activeTask });
  const incidentMeta = JSON.parse(incident.metadata || '{}');
  const params = { ...(body.params || {}) };
  if (!params.server_ip && incidentMeta.ip) params.server_ip = incidentMeta.ip;
  const v = validateParams(def, params);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const taskId = genTaskId();
  db.prepare(`INSERT INTO action_tasks(task_id, server_id, action_key, params_json, status, source, created_by, priority, timeout_seconds, parent_incident_id, metadata) VALUES (?, ?, ?, ?, 'pending', 'incident-trigger', 'incident-panel', ?, ?, ?, '{}')`).run(taskId, serverId, actionKey, JSON.stringify(params), Number(def.priority || 100), Number(def.timeout_seconds || 300), String(incident.incident_key || ''));
  db.prepare(`UPDATE incidents SET action_task_id = ?, status = 'auto_remediating', last_seen_at = CURRENT_TIMESTAMP WHERE id = ?`).run(taskId, incidentId);
  return res.json({ ok: true, task_id: taskId, status: 'pending', incident_status: 'auto_remediating' });
});

/* ── OpenClaw Takeover orchestration ── */
const OPENCLAW_HOOKS_URL = process.env.OPENCLAW_HOOKS_URL || 'http://127.0.0.1:18789/hooks/agent';
const OPENCLAW_HOOKS_TOKEN = process.env.OPENCLAW_HOOKS_TOKEN || 'd016de478d281af6298258bc6c079c71c38c9966a07bda09';
const OPENCLAW_PUBLIC_KEY = process.env.OPENCLAW_PUBLIC_KEY || 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBWoDH7XZftj7ijIvQXXd4JMFJRP/wI0d9XSaXcOkV3Q server-monitor';

app.post('/api/incidents/:id/takeover', authMiddleware, async (req, res) => {
  const incidentId = req.params.id;
  const incident = db.prepare(`SELECT * FROM incidents WHERE id = ?`).get(incidentId);
  if (!incident) return res.status(404).json({ error: 'incident not found' });
  if (incident.status === 'resolved') return res.status(400).json({ error: 'incident already resolved' });

  const serverId = incident.server_id;
  const server = db.prepare(`SELECT * FROM servers WHERE server_id = ?`).get(serverId);
  if (!server) return res.status(404).json({ error: 'server not found' });

  // Check no active task on this server
  const activeTask = db.prepare(`SELECT task_id, status, action_key FROM action_tasks WHERE server_id = ? AND status IN ('pending', 'leased', 'running') LIMIT 1`).get(serverId);
  if (activeTask) return res.status(409).json({ error: 'server has active task', activeTask });

  // Gather diagnostics
  const serverMeta = JSON.parse(server.metadata || '{}');
  const serverDiag = JSON.parse(server.diagnostics || '{}');
  const incidentMeta = JSON.parse(incident.metadata || '{}');
  const recentMetrics = db.prepare(`SELECT cpu_usage, memory_usage, disk_usage, issues, created_at FROM metrics WHERE server_id = ? ORDER BY id DESC LIMIT 5`).all(serverId);
  const recentTasks = db.prepare(`SELECT action_key, status, result_code, result_summary, finished_at FROM action_tasks WHERE server_id = ? ORDER BY created_at DESC LIMIT 5`).all(serverId);

  // Step 1: Create temp user task
  const createTaskId = genTaskId();
  db.prepare(`INSERT INTO action_tasks(task_id, server_id, action_key, params_json, status, source, created_by, priority, timeout_seconds, parent_incident_id, metadata) VALUES (?, ?, 'create_temp_user', ?, 'pending', 'takeover', 'openclaw-takeover', 1, 60, ?, ?)`).run(
    createTaskId, serverId, JSON.stringify({ public_key: OPENCLAW_PUBLIC_KEY }), String(incident.incident_key || ''),
    JSON.stringify({ takeover_incident_id: incidentId, phase: 'create_user' })
  );

  // Update incident status
  db.prepare(`UPDATE incidents SET status = 'takeover_pending', action_task_id = ?, last_seen_at = CURRENT_TIMESTAMP WHERE id = ?`).run(createTaskId, incidentId);

  // Store takeover context for later use when user is created
  const takeoverContext = {
    incident_id: incidentId,
    incident_key: incident.incident_key,
    server_id: serverId,
    server_ip: server.ip,
    hostname: server.hostname,
    fault_type: incident.fault_type,
    title: incident.title,
    details: incident.details,
    issues: JSON.parse(db.prepare(`SELECT issues FROM metrics WHERE server_id = ? ORDER BY id DESC LIMIT 1`).get(serverId)?.issues || '[]'),
    diagnostics: serverDiag,
    recent_tasks: recentTasks,
    agent_version: serverMeta.agent_version || '',
    create_task_id: createTaskId,
  };
  // Store takeover context in the task's metadata (survives backend restart)
  db.prepare(`UPDATE action_tasks SET metadata = ? WHERE task_id = ?`).run(JSON.stringify({ takeover_incident_id: incidentId, phase: 'create_user', takeover_context: takeoverContext }), createTaskId);

  res.json({ ok: true, phase: 'create_user', task_id: createTaskId, message: 'Takeover initiated, creating temp user on node...' });
});
app.post('/api/agent/tasks/:taskId/result', (req, res) => { const taskId = req.params.taskId; const body = req.body || {}; const serverId = String(body.server_id || '').trim(); const leaseToken = String(body.lease_token || '').trim(); const status = String(body.status || '').trim(); if (!['success', 'failed', 'timeout', 'cancelled'].includes(status)) return res.status(400).json({ error: 'invalid status' }); const task = db.prepare(`SELECT * FROM action_tasks WHERE task_id = ?`).get(taskId); if (!task) return res.status(404).json({ error: 'task not found' }); if (task.server_id !== serverId || task.lease_token !== leaseToken) return res.status(403).json({ error: 'invalid lease' }); db.prepare(`UPDATE action_tasks SET status = ?, exit_code = ?, result_code = ?, result_summary = ?, log_excerpt = ?, error_message = ?, finished_at = ?, lease_token = '', lease_expires_at = NULL WHERE task_id = ?`).run(status, body.exit_code == null ? null : Number(body.exit_code), String(body.result_code || ''), String(body.result_summary || ''), String(body.log_excerpt || '').slice(-8000), String(body.error_message || ''), new Date().toISOString(), taskId);
  const linkedIncident = db.prepare(`SELECT * FROM incidents WHERE action_task_id = ? AND status = 'auto_remediating'`).get(taskId);
  if (linkedIncident) {
    if (status === 'success') {
      db.prepare(`UPDATE incidents SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP, last_seen_at = CURRENT_TIMESTAMP WHERE id = ?`).run(linkedIncident.id);
    } else {
      db.prepare(`UPDATE incidents SET status = 'failed', last_seen_at = CURRENT_TIMESTAMP WHERE id = ?`).run(linkedIncident.id);
      sendIncidentNotification({ ...linkedIncident, status: 'failed' }, 'failed');
    }
  }
  res.json({ ok: true });

  // Takeover orchestration: when create_temp_user succeeds, call OpenClaw
  if (task.action_key === 'create_temp_user' && status === 'success') {
    console.log('takeover: create_temp_user succeeded for task', taskId);
    (async () => {
      try {
        // Read takeover context from task metadata (survives backend restart)
        const taskRow = db.prepare(`SELECT metadata FROM action_tasks WHERE task_id = ?`).get(taskId);
        const taskMeta = JSON.parse(taskRow?.metadata || '{}');
        const ctx = taskMeta.takeover_context;
        if (!ctx) { console.log('takeover: no context in task metadata for', taskId, 'meta:', taskRow?.metadata?.slice(0,100)); return; }

        // Extract username from task output
        const logs = String(body.log_excerpt || '');
        console.log('takeover: log_excerpt:', logs.slice(0, 200));
        const userMatch = logs.match(/TAKEOVER_USER=(\S+)/);
        if (!userMatch) { console.log('takeover: could not extract username from logs'); return; }
        const tmpUser = userMatch[1];
        console.log('takeover: temp user created:', tmpUser, 'on', ctx.server_ip);

        // Store cleanup info on the incident
        db.prepare(`UPDATE incidents SET status = 'takeover_active', metadata = ? WHERE id = ?`).run(
          JSON.stringify({ ...JSON.parse(db.prepare(`SELECT metadata FROM incidents WHERE id = ?`).get(ctx.incident_id)?.metadata || '{}'), takeover_user: tmpUser, takeover_started: new Date().toISOString() }),
          ctx.incident_id
        );

        // Build prompt for OpenClaw
        // Load ops knowledge base
        let knowledgeBase = '';
        try { knowledgeBase = fs.readFileSync('/opt/server-monitor/ops-knowledge-base.md', 'utf-8'); } catch (e) { console.log('takeover: knowledge base not found at /opt/server-monitor/ops-knowledge-base.md'); }

        const prompt = `你是服务器故障修复专家。一个监控系统检测到故障，agent 的脚本修复失败，现在由你通过 SSH 远程接管修复。

## 故障信息
- **节点 IP**: ${ctx.server_ip}
- **主机名**: ${ctx.hostname}
- **Server ID**: ${ctx.server_id}
- **故障类型**: ${ctx.fault_type}
- **故障详情**: ${ctx.title || ctx.details || ''}
- **当前 issues**: ${JSON.stringify(ctx.issues)}
- **Agent 版本**: ${ctx.agent_version}

## 诊断报告
${JSON.stringify(ctx.diagnostics, null, 2)}

## 最近任务执行记录（这些是之前尝试自动修复的记录，已失败）
${ctx.recent_tasks.map(t => `${t.action_key}: ${t.status} (${t.result_code}) ${t.result_summary}`).join('\n')}

## SSH 连接信息
- **用户名**: ${tmpUser}
- **IP**: ${ctx.server_ip}
- **认证方式**: SSH 密钥（已配置）
- **sudo 权限**: 已授权 (NOPASSWD)
- **用户有效期**: 30 分钟后自动删除

## 运维知识库
${knowledgeBase}

## 你的任务
1. 通过 SSH 连接到节点: \`ssh -o StrictHostKeyChecking=no ${tmpUser}@${ctx.server_ip}\`
2. 使用 \`sudo\` 执行需要 root 权限的命令（如 \`sudo systemctl restart xagent\`）
3. 按照上面知识库中对应故障类型的诊断步骤排查
4. 按修复方案由简到复杂逐步尝试
5. 每一步都验证结果
6. 修复完成后验证端口恢复: \`sudo ss -tlnp | grep :<端口>\`

## 约束
- 不要删除重要数据和配置文件
- 不要修改 SSH 配置
- 修改配置前先备份: \`sudo cp file file.bak\`
- 不要改 xagent.yaml 中的 InstanceId（每个节点唯一）
- 修复完成后确认服务正常运行

## 完成后
在修复完成后，调用以下接口通知监控系统清理临时用户：
\`\`\`
curl -X POST http://43.165.172.3:8080/api/takeover/${ctx.incident_id}/complete \\
  -H "Content-Type: application/json" \\
  -d '{"username": "${tmpUser}", "server_id": "${ctx.server_id}", "result": "success 或 failed", "summary": "修复摘要"}'
\`\`\``;

        // Call OpenClaw webhook
        const hookPayload = JSON.stringify({
          message: prompt,
          name: `takeover-${ctx.server_ip}`,
          deliver: true,
          channel: 'whatsapp',
          to: '+8618611713878',
          timeoutSeconds: 300,
        });

        const hookRes = await fetch(OPENCLAW_HOOKS_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENCLAW_HOOKS_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: hookPayload,
        });
        console.log('takeover: OpenClaw webhook response:', hookRes.status);
      } catch (err) {
        console.error('takeover: OpenClaw call failed:', err.message);
      }
    })();
  }

  // Takeover orchestration: when create_temp_user fails, revert incident
  if (task.action_key === 'create_temp_user' && status !== 'success') {
    const taskMeta = JSON.parse(task.metadata || '{}');
    if (taskMeta.takeover_incident_id) {
      db.prepare(`UPDATE incidents SET status = 'failed', last_seen_at = CURRENT_TIMESTAMP WHERE id = ?`).run(taskMeta.takeover_incident_id);
    }
  }
});

/* ── Takeover complete callback (called by OpenClaw after repair) ── */
app.post('/api/takeover/:incidentId/complete', (req, res) => {
  const incidentId = req.params.incidentId;
  const body = req.body || {};
  const username = String(body.username || '').trim();
  const serverId = String(body.server_id || '').trim();
  const result = String(body.result || 'unknown');
  const summary = String(body.summary || '');

  const incident = db.prepare(`SELECT * FROM incidents WHERE id = ?`).get(incidentId);
  if (!incident) return res.status(404).json({ error: 'incident not found' });

  // Update incident
  const newStatus = result === 'success' ? 'resolved' : 'failed';
  db.prepare(`UPDATE incidents SET status = ?, resolved_at = CASE WHEN ? = 'resolved' THEN CURRENT_TIMESTAMP ELSE resolved_at END, details = ?, last_seen_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
    newStatus, newStatus, `[OpenClaw 接管修复] ${summary}`, incidentId
  );

  // Dispatch delete_temp_user task to clean up
  if (username && serverId && username.startsWith('oclaw_')) {
    const deleteTaskId = genTaskId();
    db.prepare(`INSERT INTO action_tasks(task_id, server_id, action_key, params_json, status, source, created_by, priority, timeout_seconds, metadata) VALUES (?, ?, 'delete_temp_user', ?, 'pending', 'takeover-cleanup', 'openclaw', 1, 15, '{}')`).run(
      deleteTaskId, serverId, JSON.stringify({ username })
    );
    console.log('takeover: cleanup task created:', deleteTaskId, 'for user', username);
  }

  res.json({ ok: true, incident_status: newStatus, message: 'Takeover complete, cleanup dispatched' });
});

app.post('/api/groups', authMiddleware, (req, res) => { const { name } = req.body || {}; if (!name) return res.status(400).json({ error: 'name required' }); ensureGroup.run(name, 999); res.json({ ok: true }); });
app.patch('/api/groups/reorder', authMiddleware, (req, res) => { const { ids } = req.body || {}; if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids required' }); const stmt = db.prepare(`UPDATE groups SET sort_order = ? WHERE id = ?`); ids.forEach((id, idx) => stmt.run(idx, id)); res.json({ ok: true }); });
app.get('/api/groups', authMiddleware, (req, res) => res.json(db.prepare(`SELECT id, name, sort_order, created_at FROM groups ORDER BY sort_order ASC, id ASC`).all()));
app.patch('/api/groups/:id', authMiddleware, (req, res) => { const id = req.params.id; const { name } = req.body || {}; if (!name) return res.status(400).json({ error: 'name required' }); const old = db.prepare(`SELECT name FROM groups WHERE id = ?`).get(id); if (!old) return res.status(404).json({ error: 'group not found' }); db.prepare(`UPDATE groups SET name = ? WHERE id = ?`).run(name, id); db.prepare(`UPDATE servers SET group_name = ? WHERE group_name = ?`).run(name, old.name); res.json({ ok: true }); });
app.delete('/api/groups/:id', authMiddleware, (req, res) => { const id = req.params.id; const row = db.prepare(`SELECT name FROM groups WHERE id = ?`).get(id); if (!row) return res.status(404).json({ error: 'group not found' }); if (row.name === DEFAULT_GROUP) return res.status(400).json({ error: `cannot delete ${DEFAULT_GROUP}` }); db.prepare(`UPDATE servers SET group_name = ? WHERE group_name = ?`).run(DEFAULT_GROUP, row.name); db.prepare(`DELETE FROM groups WHERE id = ?`).run(id); res.json({ ok: true }); });
app.patch('/api/servers/:serverId', authMiddleware, (req, res) => { const serverId = req.params.serverId; const { display_name, group_name } = req.body || {}; if (group_name) ensureGroup.run(group_name, 999); db.prepare(`UPDATE servers SET display_name = COALESCE(?, display_name), group_name = COALESCE(?, group_name), updated_at = ? WHERE server_id = ?`).run(display_name || null, group_name || null, new Date().toISOString(), serverId); res.json({ ok: true }); });
app.delete('/api/servers/:serverId', authMiddleware, (req, res) => { const serverId = req.params.serverId; const deletedMetricRows = db.prepare(`DELETE FROM metrics WHERE server_id = ?`).run(serverId).changes; const deletedServerRows = db.prepare(`DELETE FROM servers WHERE server_id = ?`).run(serverId).changes; res.json({ ok: deletedServerRows > 0, deletedServerRows, deletedMetricRows, serverId }); });
app.get('/api/servers', authMiddleware, (req, res) => { const { group } = req.query; const sql = group && group !== 'ALL' ? `SELECT s.*, m.cpu_usage, m.memory_usage, m.disk_usage, m.port_443, m.port_6379, m.port_8888, m.port_8789, m.issues FROM servers s LEFT JOIN metrics m ON m.id = (SELECT id FROM metrics WHERE server_id = s.server_id ORDER BY id DESC LIMIT 1) WHERE s.group_name = ? ORDER BY CASE WHEN s.status IN ('problem','offline') THEN 0 ELSE 1 END ASC, s.stable_order ASC` : `SELECT s.*, m.cpu_usage, m.memory_usage, m.disk_usage, m.port_443, m.port_6379, m.port_8888, m.port_8789, m.issues FROM servers s LEFT JOIN metrics m ON m.id = (SELECT id FROM metrics WHERE server_id = s.server_id ORDER BY id DESC LIMIT 1) ORDER BY CASE WHEN s.status IN ('problem','offline') THEN 0 ELSE 1 END ASC, s.stable_order ASC`; const rows = group && group !== 'ALL' ? db.prepare(sql).all(group) : db.prepare(sql).all(); const now = Date.now(), offlineMs = OFFLINE_AFTER_SECONDS * 1000; const mapped = rows.filter((row) => row.server_id !== 'manual-test-node' && row.ip !== '127.0.0.2').map((row) => { const lastSeenMs = row.last_seen ? new Date(row.last_seen).getTime() : 0; const offline = !lastSeenMs || now - lastSeenMs > offlineMs; const issues = JSON.parse(row.issues || '[]'); const metadata = JSON.parse(row.metadata || '{}'); const diagnostics = JSON.parse(row.diagnostics || '{}'); return { ...row, metadata, diagnostics, status: offline ? 'offline' : row.status, issues: offline ? [...issues, 'Heartbeat timeout'] : issues, stale: offline, offline_seconds: lastSeenMs ? Math.max(0, Math.floor((now - lastSeenMs) / 1000)) : null }; }).sort((a, b) => { const aProblem = a.status === 'problem' || a.status === 'offline' ? 0 : 1; const bProblem = b.status === 'problem' || b.status === 'offline' ? 0 : 1; return aProblem - bProblem || (a.stable_order || a.id) - (b.stable_order || b.id); }); res.json(mapped); });
app.listen(PORT, () => console.log(`server-monitor backend running on :${PORT}`));
