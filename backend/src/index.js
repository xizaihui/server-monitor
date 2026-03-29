import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';

const app = express();
const PORT = process.env.PORT || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'monitor.db');
const OFFLINE_AFTER_SECONDS = Number(process.env.OFFLINE_AFTER_SECONDS || 180);
const METRICS_RETENTION_DAYS = Number(process.env.METRICS_RETENTION_DAYS || 30);
const DEFAULT_GROUP = '未分组';
const DEFAULT_RULES = {
  cpu: { enabled: true, threshold: 85, consecutive: 1 },
  memory: { enabled: true, threshold: 90, consecutive: 1 },
  disk: { enabled: true, threshold: 90, consecutive: 1 },
  port_443: { enabled: true, consecutive: 1 },
  port_6379: { enabled: true, consecutive: 1 },
  port_8888: { enabled: true, consecutive: 1 },
  port_8789: { enabled: true, consecutive: 1 },
};

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, sort_order INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS servers (id INTEGER PRIMARY KEY AUTOINCREMENT, server_id TEXT NOT NULL UNIQUE, hostname TEXT, display_name TEXT, ip TEXT, instance_id TEXT, os TEXT, arch TEXT, group_name TEXT DEFAULT '未分组', tags TEXT DEFAULT '[]', metadata TEXT DEFAULT '{}', status TEXT DEFAULT 'unknown', issue_count INTEGER DEFAULT 0, stable_order INTEGER, last_seen TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS metrics (id INTEGER PRIMARY KEY AUTOINCREMENT, server_id TEXT NOT NULL, cpu_usage REAL DEFAULT 0, memory_usage REAL DEFAULT 0, memory_used INTEGER DEFAULT 0, memory_total INTEGER DEFAULT 0, disk_usage REAL DEFAULT 0, disk_used INTEGER DEFAULT 0, disk_total INTEGER DEFAULT 0, port_443 INTEGER DEFAULT 0, port_6379 INTEGER DEFAULT 0, port_8888 INTEGER DEFAULT 0, port_8789 INTEGER DEFAULT 0, issues TEXT DEFAULT '[]', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);
try { db.exec(`ALTER TABLE servers ADD COLUMN stable_order INTEGER`); } catch {}
try { db.exec(`ALTER TABLE servers ADD COLUMN instance_id TEXT`); } catch {}
db.prepare(`UPDATE servers SET stable_order = id WHERE stable_order IS NULL`).run();

const ensureGroup = db.prepare(`INSERT OR IGNORE INTO groups(name, sort_order) VALUES (?, ?)`);
try { db.prepare(`UPDATE servers SET group_name = ? WHERE group_name = 'Ungrouped'`).run(DEFAULT_GROUP); db.prepare(`DELETE FROM groups WHERE name = 'Ungrouped'`).run(); } catch {}
[DEFAULT_GROUP, '美国', '韩国', '日本'].forEach((name, i) => ensureGroup.run(name, i));
const ensureSetting = db.prepare(`INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)`);
ensureSetting.run('monitor_rules', JSON.stringify(DEFAULT_RULES));

function getRules() { const row = db.prepare(`SELECT value FROM settings WHERE key = 'monitor_rules'`).get(); if (!row) return DEFAULT_RULES; try { const parsed = JSON.parse(row.value); return Object.fromEntries(Object.entries(DEFAULT_RULES).map(([key, val]) => [key, { ...val, ...(parsed[key] || {}) }])); } catch { return DEFAULT_RULES; } }
function cleanupOldMetrics() { db.prepare(`DELETE FROM metrics WHERE created_at < datetime('now', ?)`).run(`-${Math.max(1, METRICS_RETENTION_DAYS)} days`); }
cleanupOldMetrics();

app.use(cors());
app.use(express.json({ limit: '1mb' }));
const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN || '';
function authMiddleware(req, res, next) { if (!DASHBOARD_TOKEN) return next(); const auth = req.headers.authorization || ''; const cookie = req.headers.cookie || ''; const tokenFromHeader = auth.startsWith('Bearer ') ? auth.slice(7) : ''; const tokenFromCookie = (cookie.match(/dashboard_token=([^;]+)/) || [])[1] || ''; const tokenFromQuery = req.query?.token || ''; if (tokenFromHeader === DASHBOARD_TOKEN || tokenFromCookie === DASHBOARD_TOKEN || tokenFromQuery === DASHBOARD_TOKEN) return next(); return res.status(401).json({ error: 'unauthorized' }); }
function checkMetricConsecutive(serverId, column, predicate, consecutive) { const rows = db.prepare(`SELECT ${column} AS value FROM metrics WHERE server_id = ? ORDER BY id DESC LIMIT ?`).all(serverId, consecutive); if (rows.length < consecutive) return false; return rows.every((row) => predicate(Number(row.value || 0))); }
function calculateStatus(payload) {
  const rules = getRules(); const issues = []; const cpu = Number(payload.cpu_usage || 0), memory = Number(payload.memory_usage || 0), disk = Number(payload.disk_usage || 0), ports = payload.ports || {};
  if (rules.cpu.enabled && cpu > rules.cpu.threshold && checkMetricConsecutive(payload.server_id, 'cpu_usage', (v) => v > Number(rules.cpu.threshold || 0), Number(rules.cpu.consecutive || 1))) issues.push(`CPU 连续${rules.cpu.consecutive}次 > ${rules.cpu.threshold}%`);
  if (rules.memory.enabled && memory > rules.memory.threshold && checkMetricConsecutive(payload.server_id, 'memory_usage', (v) => v > Number(rules.memory.threshold || 0), Number(rules.memory.consecutive || 1))) issues.push(`内存 连续${rules.memory.consecutive}次 > ${rules.memory.threshold}%`);
  if (rules.disk.enabled && disk > rules.disk.threshold && checkMetricConsecutive(payload.server_id, 'disk_usage', (v) => v > Number(rules.disk.threshold || 0), Number(rules.disk.consecutive || 1))) issues.push(`磁盘 连续${rules.disk.consecutive}次 > ${rules.disk.threshold}%`);
  for (const port of [443, 6379, 8888, 8789]) { const key = `port_${port}`; if (rules[key]?.enabled && !ports[String(port)] && checkMetricConsecutive(payload.server_id, key, (v) => Number(v) === 0, Number(rules[key]?.consecutive || 1))) issues.push(`端口 ${port} 连续${rules[key].consecutive}次 DOWN`); }
  return { status: issues.length ? 'problem' : 'healthy', issues, issue_count: issues.length };
}
app.get('/api/health', (req, res) => res.json({ ok: true, hostname: os.hostname(), port: PORT, offlineAfterSeconds: OFFLINE_AFTER_SECONDS, metricsRetentionDays: METRICS_RETENTION_DAYS }));
app.get('/api/settings/monitor-rules', authMiddleware, (req, res) => res.json(getRules()));
app.patch('/api/settings/monitor-rules', authMiddleware, (req, res) => { const body = req.body || {}; const nextRules = Object.fromEntries(Object.entries(DEFAULT_RULES).map(([key, val]) => [key, { ...val, ...(body[key] || {}) }])); db.prepare(`UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = 'monitor_rules'`).run(JSON.stringify(nextRules)); res.json({ ok: true, rules: nextRules }); });
app.post('/api/agent/register', (req, res) => { const body = req.body || {}, serverId = body.server_id; if (!serverId) return res.status(400).json({ error: 'server_id required' }); ensureGroup.run(DEFAULT_GROUP, 0); const now = new Date().toISOString(); const existing = db.prepare(`SELECT id FROM servers WHERE server_id = ?`).get(serverId); const sameHostOffline = db.prepare(`SELECT id, server_id FROM servers WHERE hostname = ? AND server_id <> ? ORDER BY last_seen DESC, id DESC LIMIT 1`).get(body.hostname || '', serverId); if (!existing && sameHostOffline) { db.prepare(`UPDATE metrics SET server_id = ? WHERE server_id = ?`).run(serverId, sameHostOffline.server_id); db.prepare(`UPDATE servers SET server_id = ?, hostname = ?, display_name = ?, ip = ?, instance_id = ?, os = ?, arch = ?, metadata = ?, last_seen = ?, updated_at = ? WHERE id = ?`).run(serverId, body.hostname || serverId, body.display_name || body.hostname || serverId, body.ip || '', body.instance_id || '', body.os || '', body.arch || '', JSON.stringify(body.metadata || {}), now, now, sameHostOffline.id); } else if (!existing) { const result = db.prepare(`INSERT INTO servers (server_id, hostname, display_name, ip, instance_id, os, arch, group_name, tags, metadata, status, issue_count, stable_order, last_seen, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'healthy', 0, NULL, ?, ?)`).run(serverId, body.hostname || serverId, body.display_name || body.hostname || serverId, body.ip || '', body.instance_id || '', body.os || '', body.arch || '', DEFAULT_GROUP, JSON.stringify(body.tags || []), JSON.stringify(body.metadata || {}), now, now); db.prepare(`UPDATE servers SET stable_order = id WHERE id = ?`).run(result.lastInsertRowid); } else { db.prepare(`UPDATE servers SET hostname = ?, display_name = ?, ip = ?, instance_id = ?, os = ?, arch = ?, metadata = ?, last_seen = ?, updated_at = ? WHERE server_id = ?`).run(body.hostname || serverId, body.display_name || body.hostname || serverId, body.ip || '', body.instance_id || '', body.os || '', body.arch || '', JSON.stringify(body.metadata || {}), now, now, serverId); } db.prepare(`INSERT INTO metrics (server_id, cpu_usage, memory_usage, memory_used, memory_total, disk_usage, disk_used, disk_total, port_443, port_6379, port_8888, port_8789, issues) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]')`).run(serverId, Number(body.cpu_usage || 0), Number(body.memory_usage || 0), Number(body.memory_used || 0), Number(body.memory_total || 0), Number(body.disk_usage || 0), Number(body.disk_used || 0), Number(body.disk_total || 0), body.ports?.['443'] ? 1 : 0, body.ports?.['6379'] ? 1 : 0, body.ports?.['8888'] ? 1 : 0, body.ports?.['8789'] ? 1 : 0); const derived = calculateStatus(body); db.prepare(`UPDATE servers SET status = ?, issue_count = ?, updated_at = ? WHERE server_id = ?`).run(derived.status, derived.issue_count, now, serverId); db.prepare(`UPDATE metrics SET issues = ? WHERE id = (SELECT id FROM metrics WHERE server_id = ? ORDER BY id DESC LIMIT 1)`).run(JSON.stringify(derived.issues), serverId); res.json({ ok: true, status: derived.status, issues: derived.issues, assigned_group: DEFAULT_GROUP }); });
app.post('/api/groups', authMiddleware, (req, res) => { const { name } = req.body || {}; if (!name) return res.status(400).json({ error: 'name required' }); ensureGroup.run(name, 999); res.json({ ok: true }); });
app.patch('/api/groups/reorder', authMiddleware, (req, res) => { const { ids } = req.body || {}; if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids required' }); const stmt = db.prepare(`UPDATE groups SET sort_order = ? WHERE id = ?`); ids.forEach((id, idx) => stmt.run(idx, id)); res.json({ ok: true }); });
app.get('/api/groups', authMiddleware, (req, res) => res.json(db.prepare(`SELECT id, name, sort_order, created_at FROM groups ORDER BY sort_order ASC, id ASC`).all()));
app.patch('/api/groups/:id', authMiddleware, (req, res) => { const id = req.params.id; const { name } = req.body || {}; if (!name) return res.status(400).json({ error: 'name required' }); const old = db.prepare(`SELECT name FROM groups WHERE id = ?`).get(id); if (!old) return res.status(404).json({ error: 'group not found' }); db.prepare(`UPDATE groups SET name = ? WHERE id = ?`).run(name, id); db.prepare(`UPDATE servers SET group_name = ? WHERE group_name = ?`).run(name, old.name); res.json({ ok: true }); });
app.delete('/api/groups/:id', authMiddleware, (req, res) => { const id = req.params.id; const row = db.prepare(`SELECT name FROM groups WHERE id = ?`).get(id); if (!row) return res.status(404).json({ error: 'group not found' }); if (row.name === DEFAULT_GROUP) return res.status(400).json({ error: `cannot delete ${DEFAULT_GROUP}` }); db.prepare(`UPDATE servers SET group_name = ? WHERE group_name = ?`).run(DEFAULT_GROUP, row.name); db.prepare(`DELETE FROM groups WHERE id = ?`).run(id); res.json({ ok: true }); });
app.patch('/api/servers/:serverId', authMiddleware, (req, res) => { const serverId = req.params.serverId; const { display_name, group_name } = req.body || {}; if (group_name) ensureGroup.run(group_name, 999); db.prepare(`UPDATE servers SET display_name = COALESCE(?, display_name), group_name = COALESCE(?, group_name), updated_at = ? WHERE server_id = ?`).run(display_name || null, group_name || null, new Date().toISOString(), serverId); res.json({ ok: true }); });
app.delete('/api/servers/:serverId', authMiddleware, (req, res) => { const serverId = req.params.serverId; const deletedMetricRows = db.prepare(`DELETE FROM metrics WHERE server_id = ?`).run(serverId).changes; const deletedServerRows = db.prepare(`DELETE FROM servers WHERE server_id = ?`).run(serverId).changes; res.json({ ok: deletedServerRows > 0, deletedServerRows, deletedMetricRows, serverId }); });
app.get('/api/servers', authMiddleware, (req, res) => { const { group } = req.query; const sql = group && group !== 'ALL' ? `SELECT s.*, m.cpu_usage, m.memory_usage, m.disk_usage, m.port_443, m.port_6379, m.port_8888, m.port_8789, m.issues FROM servers s LEFT JOIN metrics m ON m.id = (SELECT id FROM metrics WHERE server_id = s.server_id ORDER BY id DESC LIMIT 1) WHERE s.group_name = ? ORDER BY CASE WHEN s.status IN ('problem','offline') THEN 0 ELSE 1 END ASC, s.stable_order ASC` : `SELECT s.*, m.cpu_usage, m.memory_usage, m.disk_usage, m.port_443, m.port_6379, m.port_8888, m.port_8789, m.issues FROM servers s LEFT JOIN metrics m ON m.id = (SELECT id FROM metrics WHERE server_id = s.server_id ORDER BY id DESC LIMIT 1) ORDER BY CASE WHEN s.status IN ('problem','offline') THEN 0 ELSE 1 END ASC, s.stable_order ASC`; const rows = group && group !== 'ALL' ? db.prepare(sql).all(group) : db.prepare(sql).all(); const now = Date.now(), offlineMs = OFFLINE_AFTER_SECONDS * 1000; const mapped = rows.filter((row) => row.server_id !== 'manual-test-node' && row.ip !== '127.0.0.2').map((row) => { const lastSeenMs = row.last_seen ? new Date(row.last_seen).getTime() : 0; const offline = !lastSeenMs || now - lastSeenMs > offlineMs; const issues = JSON.parse(row.issues || '[]'); const metadata = JSON.parse(row.metadata || '{}'); return { ...row, metadata, status: offline ? 'offline' : row.status, issues: offline ? [...issues, 'Heartbeat timeout'] : issues, stale: offline, offline_seconds: lastSeenMs ? Math.max(0, Math.floor((now - lastSeenMs) / 1000)) : null }; }).sort((a, b) => { const aProblem = a.status === 'problem' || a.status === 'offline' ? 0 : 1; const bProblem = b.status === 'problem' || b.status === 'offline' ? 0 : 1; return aProblem - bProblem || (a.stable_order || a.id) - (b.stable_order || b.id); }); res.json(mapped); });
app.listen(PORT, () => console.log(`server-monitor backend running on :${PORT}`));
