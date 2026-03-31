'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import ServerActions from './ServerActions';
import NodeDrawer from './NodeDrawer';
import ServerModal from './ServerModal';
import GroupManagerModal from './GroupManagerModal';
import BulkMoveModal from './BulkMoveModal';
import MonitorRulesModal from './MonitorRulesModal';
import ActionTaskModal from './ActionTaskModal';
import TaskHistoryModal from './TaskHistoryModal';
import PackageUploadModal from './PackageUploadModal';
import PackageRepoModal from './PackageRepoModal';
import IncidentPanel from './IncidentPanel';
import NotificationSettingsModal from './NotificationSettingsModal';
import IncidentHistoryModal from './IncidentHistoryModal';

const CURRENT_OPS_VERSION = '2026.03.31-3';

function pct(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function componentBadge(md5Reported, md5Expected, label) {
  if (!md5Reported) return { text: '未安装', tone: 'offline', outdated: false };
  if (!md5Expected) return { text: '已安装', tone: 'healthy', outdated: false };
  if (md5Reported === md5Expected) return { text: '最新', tone: 'healthy', outdated: false };
  return { text: '需更新', tone: 'problem', outdated: true };
}

function MetricBar({ value, alert = false, offline = false }) {
  if (offline) {
    return (
      <div className="metricCellTight">
        <div className="metric metricValueAligned">-</div>
        <div className="barTrack barTrackAligned" style={{ opacity: 0.35 }} />
      </div>
    );
  }

  const safe = Math.max(0, Math.min(100, Number(value || 0)));
  const tone = alert ? 'danger' : safe >= 90 ? 'danger' : safe >= 75 ? 'warning' : 'normal';

  return (
    <div className={`metricCellTight ${alert ? 'metricAlertCell' : ''}`}>
      <div className={`metric metricValueAligned ${alert ? 'metricAlertText' : ''}`}>{pct(safe)}</div>
      <div className="barTrack barTrackAligned">
        <div className={`barFill ${tone} ${alert ? 'metricAlertFill' : ''}`} style={{ width: `${safe}%` }} />
      </div>
    </div>
  );
}

function isProblem(item) {
  return item.status === 'problem' || item.status === 'offline';
}

function hasIssue(server, keyword) {
  return Array.isArray(server?.issues) && server.issues.some((x) => String(x).includes(keyword));
}

function scriptsBadge(server) {
  const version = server?.metadata?.ops_scripts_version || '';
  if (!version) return { text: '未初始化', tone: 'offline' };
  if (version !== CURRENT_OPS_VERSION) return { text: `需更新 ${version}`, tone: 'problem' };
  return { text: version, tone: 'healthy' };
}

function readinessBadge(server) {
  const scriptsVersion = server?.metadata?.ops_scripts_version || '';
  if (!scriptsVersion) return { text: '待初始化', tone: 'offline', rank: 0 };
  if (scriptsVersion !== CURRENT_OPS_VERSION) return { text: '待更新', tone: 'problem', rank: 1 };
  return { text: '可执行动作', tone: 'healthy', rank: 2 };
}

function targetGap(server) {
  const scriptsVersion = server?.metadata?.ops_scripts_version || '';
  if (!scriptsVersion) return '未达到目标';
  if (scriptsVersion !== CURRENT_OPS_VERSION) return `目标 ${CURRENT_OPS_VERSION}`;
  return '已对齐目标';
}

function readinessFilter(status, server, expectedChecksums) {
  const rb = readinessBadge(server);
  if (status === 'scripts_missing') return rb.rank === 0;
  if (status === 'scripts_outdated') return rb.rank === 1;
  if (status === 'component_outdated') {
    const m = server?.metadata || {};
    const ec = expectedChecksums || {};
    return (m.xagent_md5 && ec.xagent_md5 && m.xagent_md5 !== ec.xagent_md5)
      || (m.xbridge_md5 && ec.xbridge_md5 && m.xbridge_md5 !== ec.xbridge_md5)
      || (m.xray_md5 && ec.xray_md5 && m.xray_md5 !== ec.xray_md5)
      || (m.singbox_md5 && ec.singbox_md5 && m.singbox_md5 !== ec.singbox_md5);
  }
  return server.status === status;
}

/* ── Alert sound via HTML Audio element ── */
let _alertAudio = null;
function getAlertAudio() {
  if (!_alertAudio) {
    _alertAudio = new Audio('/alert.wav');
    _alertAudio.volume = 1.0;
  }
  return _alertAudio;
}

function playAlertSound() {
  try {
    const audio = getAlertAudio();
    audio.currentTime = 0;
    const p = audio.play();
    if (p && p.catch) p.catch(() => {}); // ignore autoplay rejection
  } catch {}
}

export default function DashboardClient({ servers: initialServers, groups, selectedGroup = 'ALL', initialRules }) {
  const [servers, setServers] = useState(initialServers.filter((x) => x.ip !== '127.0.0.2' && x.server_id !== 'manual-test-node'));
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedServer, setSelectedServer] = useState(null);
  const [editServer, setEditServer] = useState(null);
  const [deleteServer, setDeleteServer] = useState(null);
  const [taskServers, setTaskServers] = useState([]);
  const [taskInitialActionKey, setTaskInitialActionKey] = useState('');
  const [taskHistoryServer, setTaskHistoryServer] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [groupManagerOpen, setGroupManagerOpen] = useState(false);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [packageUploadOpen, setPackageUploadOpen] = useState(false);
  const [packageRepoOpen, setPackageRepoOpen] = useState(false);
  const [incidentPanelOpen, setIncidentPanelOpen] = useState(false);
  const [incidentServerFilter, setIncidentServerFilter] = useState('');
  const [notifSettingsOpen, setNotifSettingsOpen] = useState(false);
  const [incidentHistoryOpen, setIncidentHistoryOpen] = useState(false);
  const [packageRepoRefreshKey, setPackageRepoRefreshKey] = useState(0);
  const [expectedChecksums, setExpectedChecksums] = useState(null);
  const [rules, setRules] = useState(initialRules);
  const [toast, setToast] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [incidentStats, setIncidentStats] = useState({ open: 0, remediating: 0, failed: 0, resolved: 0 });
  const [alertSoundEnabled, setAlertSoundEnabled] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('alertSoundEnabled');
      if (saved !== null) return saved === '1';
    }
    return true;
  });
  const [alertAcknowledged, setAlertAcknowledged] = useState(false);
  const [hasActiveProblems, setHasActiveProblems] = useState(false);
  const alertSoundRef = useRef(true);
  const alertAckRef = useRef(false);
  const prevProblemIdsRef = useRef(null);
  const alertIntervalRef = useRef(null);
  const hasProblemRef = useRef(false);

  useEffect(() => { alertSoundRef.current = alertSoundEnabled; }, [alertSoundEnabled]);
  useEffect(() => { alertAckRef.current = alertAcknowledged; }, [alertAcknowledged]);

  // Continuous alarm loop: plays every 8s while problems exist and not acknowledged
  useEffect(() => {
    alertIntervalRef.current = setInterval(() => {
      if (hasProblemRef.current && alertSoundRef.current && !alertAckRef.current) {
        playAlertSound();
      }
    }, 8000);
    return () => clearInterval(alertIntervalRef.current);
  }, []);

  // Unlock audio on first user click (Chrome autoplay policy)
  useEffect(() => {
    const handler = () => {
      try {
        const a = getAlertAudio();
        a.volume = 0;
        const p = a.play();
        if (p && p.then) p.then(() => { a.pause(); a.volume = 1.0; a.currentTime = 0; }).catch(() => {});
      } catch {}
    };
    document.addEventListener('click', handler, { once: true });
    return () => document.removeEventListener('click', handler);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(timer);
  }, [toast]);

  function normalizeIncoming(list) {
    const incoming = list.filter((item) => item.ip !== '127.0.0.2' && item.server_id !== 'manual-test-node');
    const problems = incoming.filter(isProblem);
    const healthy = incoming.filter((x) => !isProblem(x));
    return [...problems, ...healthy];
  }

  async function copyText(text) {
    const value = String(text || '');
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        setToast({ type: 'success', text: `已复制：${text}` });
        return;
      }
    } catch {}

    try {
      const el = document.createElement('textarea');
      el.value = value;
      el.setAttribute('readonly', 'readonly');
      el.style.position = 'fixed';
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      document.body.appendChild(el);
      el.focus();
      el.select();
      el.setSelectionRange(0, el.value.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      if (ok) {
        setToast({ type: 'success', text: `已复制：${text}` });
        return;
      }
    } catch {}

    setToast({ type: 'warning', text: '复制失败，请手动复制' });
  }

  async function refreshNow() {
    try {
      const res = await fetch(`/api/proxy/snapshot?group=${encodeURIComponent(selectedGroup)}&_t=${Date.now()}`, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'include',
        headers: { 'Cache-Control': 'no-cache' }
      });
      if (res.status === 401) { window.location.href = '/login'; return; }
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data.servers)) return;
      const normalized = normalizeIncoming(data.servers);
      setServers(normalized);

      // Track problem nodes for continuous alarm
      const currentProblemIds = new Set(normalized.filter(isProblem).map(s => s.server_id));
      hasProblemRef.current = currentProblemIds.size > 0;
      setHasActiveProblems(currentProblemIds.size > 0);

      if (prevProblemIdsRef.current !== null) {
        // If NEW problem nodes appeared, reset acknowledge so alarm resumes
        const hasNewProblem = [...currentProblemIds].some(id => !prevProblemIdsRef.current.has(id));
        if (hasNewProblem) {
          setAlertAcknowledged(false);
          // Play immediately on new problem detection
          if (alertSoundRef.current) playAlertSound();
        }
      } else if (currentProblemIds.size > 0) {
        // First load with existing problems — start alarm immediately
        if (alertSoundRef.current) playAlertSound();
      }
      // If all problems resolved, auto-reset acknowledge for next time
      if (currentProblemIds.size === 0) setAlertAcknowledged(false);
      prevProblemIdsRef.current = currentProblemIds;
    } catch {}
    try {
      const incRes = await fetch('/api/proxy/incidents?limit=200', { cache: 'no-store' });
      if (incRes.ok) {
        const incidents = await incRes.json();
        if (Array.isArray(incidents)) {
          const s = { open: 0, remediating: 0, failed: 0, resolved: 0 };
          for (const inc of incidents) {
            if (inc.status === 'open' || inc.status === 'acknowledged') s.open++;
            else if (inc.status === 'auto_remediating') s.remediating++;
            else if (inc.status === 'failed') s.failed++;
            else if (inc.status === 'resolved') s.resolved++;
          }
          setIncidentStats(s);
        }
      }
    } catch {}
  }

  useEffect(() => {
    refreshNow();
    const timer = setInterval(refreshNow, 10000);
    return () => clearInterval(timer);
  }, [selectedGroup]);

  useEffect(() => {
    async function fetchExpected() {
      try {
        const res = await fetch('/api/proxy/packages/expected-checksums', { cache: 'no-store' });
        if (res.ok) setExpectedChecksums(await res.json());
      } catch {}
    }
    fetchExpected();
    const timer = setInterval(fetchExpected, 60000);
    return () => clearInterval(timer);
  }, []);

  const stats = useMemo(() => ({
    total: servers.length,
    healthy: servers.filter((s) => s.status === 'healthy').length,
    problem: servers.filter((s) => s.status === 'problem').length,
    offline: servers.filter((s) => s.status === 'offline').length,
  }), [servers]);

  const filtered = useMemo(() => servers.filter((s) => {
    const matchesStatus = status === 'ALL' ? true : readinessFilter(status, s, expectedChecksums);
    const q = query.trim().toLowerCase();
    const matchesQuery = !q ? true : [s.ip, s.instance_id, s.display_name, s.hostname, s.group_name, s.server_id, s.metadata?.agent_version, s.metadata?.ops_scripts_version]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q));
    return matchesStatus && matchesQuery;
  }), [servers, query, status, expectedChecksums]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paged = useMemo(() => filtered.slice((currentPage - 1) * pageSize, (currentPage - 1) * pageSize + pageSize), [filtered, currentPage, pageSize]);
  const pageNumbers = useMemo(() => {
    const arr = [];
    const start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, start + 4);
    for (let i = start; i <= end; i++) arr.push(i);
    return arr;
  }, [currentPage, totalPages]);
  const allPageSelected = paged.length > 0 && paged.every((s) => selectedIds.includes(s.server_id));
  const selectedServers = useMemo(() => servers.filter((s) => selectedIds.includes(s.server_id)), [servers, selectedIds]);
  const scriptActionableServers = useMemo(() => filtered.filter((s) => !s.metadata?.ops_scripts_version || s.metadata?.ops_scripts_version !== CURRENT_OPS_VERSION), [filtered]);

  function onChangeStatus(next) { setStatus(next); setPage(1); }
  function onChangeQuery(v) { setQuery(v); setPage(1); }
  function onChangePageSize(v) { setPageSize(Number(v)); setPage(1); setSelectedIds([]); }
  function toggleOne(id) { setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]); }
  function toggleAllPage() {
    const ids = paged.map((s) => s.server_id);
    const allSelected = ids.every((id) => selectedIds.includes(id));
    setSelectedIds((prev) => allSelected ? prev.filter((id) => !ids.includes(id)) : Array.from(new Set([...prev, ...ids])));
  }

  async function bulkMove(groupName) {
    setBulkBusy(true);
    await Promise.all(selectedIds.map((id) => fetch(`/api/proxy/servers/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_name: groupName })
    })));
    setBulkBusy(false);
    setToast({ type: 'success', text: `已批量移动 ${selectedIds.length} 个节点` });
    location.reload();
  }

  async function bulkDelete() {
    if (!selectedIds.length) return;
    const ok = window.confirm(`确认彻底删除 ${selectedIds.length} 个节点吗？\n\n这会同时删除节点记录和历史监控数据。`);
    if (!ok) return;
    setBulkBusy(true);
    const results = await Promise.all(selectedIds.map((id) => fetch(`/api/proxy/servers/${id}`, { method: 'DELETE' }).then((r) => r.json().catch(() => ({ ok: false })))))
    const success = results.filter((x) => x.ok).length;
    const metricRows = results.reduce((sum, item) => sum + Number(item.deletedMetricRows || 0), 0);
    setServers((prev) => prev.filter((item) => !selectedIds.includes(item.server_id)));
    setSelectedIds([]);
    setDeleteServer(null);
    setSelectedServer(null);
    setBulkBusy(false);
    setToast({ type: success === results.length ? 'success' : 'warning', text: `批量删除完成：节点 ${success}/${results.length}，监控数据 ${metricRows} 条` });
  }

  function goPage(nextPage) {
    setPage(nextPage);
  }

  function handleDeleted(server, data) {
    setServers((prev) => prev.filter((item) => item.server_id !== server.server_id));
    setSelectedIds((prev) => prev.filter((id) => id !== server.server_id));
    setDeleteServer(null);
    if (selectedServer?.server_id === server.server_id) setSelectedServer(null);
    setToast({ type: 'success', text: `已彻底删除节点 1 条，监控数据 ${Number(data?.deletedMetricRows || 0)} 条` });
  }

  return (
    <>
      {toast ? <div className={`toast ${toast.type}`}>{toast.text}</div> : null}

      <section className="statsGrid">
        <div className="statCard"><span>总节点</span><strong>{stats.total}</strong></div>
        <div className="statCard healthy"><span>Healthy</span><strong>{stats.healthy}</strong></div>
        <div className="statCard problem"><span>Problem</span><strong>{stats.problem}</strong></div>
        <div className="statCard offline"><span>Offline</span><strong>{stats.offline}</strong></div>
      </section>

      <section className="statsGrid incidentStatsGrid">
        <div className={`statCard ${incidentStats.open > 0 ? 'problem' : 'healthy'}`} style={{ cursor: 'pointer' }} onClick={() => { setIncidentServerFilter(''); setIncidentPanelOpen(true); }}>
          <span>🚨 Open Incidents</span><strong>{incidentStats.open}</strong>
        </div>
        <div className={`statCard ${incidentStats.remediating > 0 ? 'problem' : ''}`} style={{ cursor: 'pointer' }} onClick={() => { setIncidentServerFilter(''); setIncidentPanelOpen(true); }}>
          <span>🔧 Remediating</span><strong>{incidentStats.remediating}</strong>
        </div>
        <div className={`statCard ${incidentStats.failed > 0 ? 'offline' : ''}`} style={{ cursor: 'pointer' }} onClick={() => { setIncidentServerFilter(''); setIncidentPanelOpen(true); }}>
          <span>❌ Failed</span><strong>{incidentStats.failed}</strong>
        </div>
        <div className="statCard" style={{ cursor: 'pointer' }} onClick={() => { setIncidentServerFilter(''); setIncidentPanelOpen(true); }}>
          <span>✅ Resolved</span><strong>{incidentStats.resolved}</strong>
        </div>
      </section>

      <section className="toolbar compactToolbar cleanToolbar liveToolbar">
        <div className="toolbarGroup">
          <input className="input searchInput compactInput" placeholder="搜索 IP / server-id / 节点名 / 分类 / ID / 版本" value={query} onChange={(e) => onChangeQuery(e.target.value)} />
          <div className="segmented compactSegmented">
            {[['ALL', '全部'], ['problem', '异常'], ['offline', '离线'], ['healthy', '健康'], ['scripts_missing', '脚本未初始化'], ['scripts_outdated', '脚本需更新'], ['component_outdated', '组件需更新']].map(([value, label]) => (
              <button key={value} type="button" className={`segment compactSegment ${status === value ? 'active' : ''}`} onClick={() => onChangeStatus(value)}>{label}</button>
            ))}
          </div>
          <button className="pageBtn compactPageBtn" type="button" onClick={() => setGroupManagerOpen(true)}>分类管理</button>
          <button className="pageBtn compactPageBtn" type="button" onClick={() => setRulesOpen(true)}>监控规则</button>
          <button className="primaryBtn compactPageBtn incidentBtn" type="button" onClick={() => { setIncidentServerFilter(''); setIncidentPanelOpen(true); }}>🚨 Incidents{incidentStats.open > 0 ? ` (${incidentStats.open})` : ''}</button>
          <button className="pageBtn compactPageBtn" type="button" onClick={() => setNotifSettingsOpen(true)}>🔔 通知</button>
          <button className="pageBtn compactPageBtn" type="button" onClick={() => setIncidentHistoryOpen(true)}>📊 趋势</button>
          <button className="pageBtn compactPageBtn" type="button" onClick={() => setPackageRepoOpen(true)}>包仓库</button>
          <button className="pageBtn compactPageBtn" type="button" onClick={() => setPackageUploadOpen(true)}>上传安装包</button>
          <button className="pageBtn compactPageBtn" type="button" onClick={refreshNow}>立即刷新</button>
        </div>
        <div className="toolbarGroup small liveInfo">
          <span className="liveDot"></span>
          <span>自动刷新 10s</span>
          <button
            type="button"
            className={`alertSoundToggle ${alertSoundEnabled ? 'on' : 'off'}`}
            title={alertSoundEnabled ? '报警声音已开启，点击关闭' : '报警声音已关闭，点击开启'}
            onClick={() => {
              const next = !alertSoundEnabled;
              setAlertSoundEnabled(next);
              localStorage.setItem('alertSoundEnabled', next ? '1' : '0');
              if (next) { setTimeout(playAlertSound, 100); }
              if (!next) setAlertAcknowledged(true);
            }}
          >
            {alertSoundEnabled ? '🔔' : '🔕'}
          </button>
          {alertSoundEnabled && hasActiveProblems && !alertAcknowledged && (
            <button
              type="button"
              className="ackBtn"
              onClick={() => setAlertAcknowledged(true)}
            >
              静音
            </button>
          )}
          <span>每页</span>
          <select className="select compactSelect" value={pageSize} onChange={(e) => onChangePageSize(e.target.value)}>
            {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <span>脚本目标版本 {CURRENT_OPS_VERSION}</span>
          {expectedChecksums?.xagent_version ? <span>xagent {expectedChecksums.xagent_version}</span> : null}
          {expectedChecksums?.xcore_version ? <span>xcore {expectedChecksums.xcore_version}</span> : null}
          {expectedChecksums?.xbridge_version ? <span>xbridge {expectedChecksums.xbridge_version}</span> : null}
          <span>共 {filtered.length} 台</span>
        </div>
      </section>

      <section className="bulkBar unifiedBulkBar taskSubmitBar">
        <div className="toolbarGroup">
          <div className="small">统一部署入口：先勾选节点，再点击提交</div>
          {selectedIds.length > 0 ? <div className="small">当前已选 {selectedIds.length} 个节点</div> : <div className="small">当前未选择节点</div>}
        </div>
        <div className="toolbarGroup">
          <button className="primaryBtn compactPageBtn" type="button" onClick={() => { setTaskInitialActionKey(''); setTaskServers(selectedServers); }} disabled={!selectedServers.length || bulkBusy}>递交</button>
          <button className="pageBtn compactPageBtn" type="button" onClick={() => { setTaskInitialActionKey('init_ops_scripts'); setTaskServers(selectedServers); }} disabled={!selectedServers.length || bulkBusy}>初始化脚本</button>
          <button className="pageBtn compactPageBtn" type="button" onClick={() => { setTaskInitialActionKey('init_ops_scripts'); setTaskServers(scriptActionableServers); }} disabled={!scriptActionableServers.length || bulkBusy}>初始化未就绪节点</button>
          <button className="pageBtn compactPageBtn" type="button" onClick={() => setBulkMoveOpen(true)} disabled={bulkBusy || !selectedIds.length}>移动分类</button>
          <button className="dangerBtn compactPageBtn" type="button" onClick={bulkDelete} disabled={bulkBusy || !selectedIds.length}>{bulkBusy ? '处理中...' : '删除节点'}</button>
        </div>
      </section>

      <section className="panel compactPanel cleanPanel">
        <div className="tableHeader compactTableHeader">
          <div><div className="tableTitle highContrastTitle">节点列表</div></div>
          <div className="paginationWrap compactPaginationWrap">
            <button className="pageBtn compactPageBtn" type="button" onClick={() => goPage(Math.max(1, currentPage - 1))} disabled={currentPage <= 1}>上一页</button>
            {pageNumbers.map((n) => <button key={n} className={`pageBtn compactPageBtn ${currentPage === n ? 'activePageBtn' : ''}`} type="button" onClick={() => goPage(n)}>{n}</button>)}
            <button className="pageBtn compactPageBtn" type="button" onClick={() => goPage(Math.min(totalPages, currentPage + 1))} disabled={currentPage >= totalPages}>下一页</button>
          </div>
        </div>

        <div className="tableWrap denseTableWrap pagedTableWrap cleanerTableWrap">
          <table className="denseTable cleanerTable compactMainTable noTaskColTable">
            <thead>
              <tr>
                <th className="stickyCol checkboxCol"><input type="checkbox" checked={allPageSelected} onChange={toggleAllPage} /></th>
                <th className="stickyCol highContrastHead">服务器</th>
                <th className="highContrastHead">server-id</th>
                <th className="highContrastHead">状态</th>
                <th className="highContrastHead">脚本版本</th>
                <th className="highContrastHead">CPU</th>
                <th className="highContrastHead">内存</th>
                <th className="highContrastHead">磁盘</th>
                <th className="portHead highContrastHead">xray</th>
                <th className="portHead highContrastHead">redis</th>
                <th className="portHead highContrastHead">xagent</th>
                <th className="portHead highContrastHead">xbridge</th>
                <th className="highContrastHead">操作</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((s) => {
                const sb = scriptsBadge(s);
                const rb = readinessBadge(s);
                const m = s.metadata || {};
                const ec = expectedChecksums || {};
                const xagentBadge = componentBadge(m.xagent_md5, ec.xagent_md5, 'xagent');
                const xbridgeBadge = componentBadge(m.xbridge_md5, ec.xbridge_md5, 'xbridge');
                const xrayBadge = componentBadge(m.xray_md5, ec.xray_md5, 'xray');
                const singboxBadge = componentBadge(m.singbox_md5, ec.singbox_md5, 'singbox');
                return (
                <tr key={s.server_id} className={`${s.status === 'problem' ? 'problemRow' : s.status === 'offline' ? 'offlineRow' : ''} compactRow`}>
                  <td className="stickyCol stickyBodyCol checkboxCol"><input type="checkbox" checked={selectedIds.includes(s.server_id)} onChange={() => toggleOne(s.server_id)} /></td>
                  <td className="stickyCol stickyBodyCol compactStickyCol stickyOffsetCol">
                    <div className="ipActionRow">
                      <button type="button" className="nodeLinkBtn cleanNodeLinkBtn" onClick={() => setSelectedServer(s)}>
                        <div className="ipCell compactIpCell onlyIpCell sharpText">{s.ip || '-'}</div>
                      </button>
                      {s.ip ? <button type="button" className="miniCopyBtn inlineCopyBtn" onClick={() => copyText(s.ip)}>复制</button> : null}
                    </div>
                    <div className="small versionSubline">agent {s.metadata?.agent_version || '-'} · <span className={`inlineReadiness ${rb.tone}`}>{rb.text}</span>{singboxBadge.outdated ? <span className="inlineReadiness problem"> · singbox需更新</span> : null}</div>
                    <div className="small versionSubline">{targetGap(s)}</div>
                  </td>
                  <td className="metric sharpText slimTextCell">{s.instance_id || '-'}</td>
                  <td>
                    <button type="button" className="statusStack compactStatusStack statusClickable" onClick={() => setSelectedServer(s)}>
                      <span className={`statusDot ${s.status}`}></span>
                      <span className={`badge ${s.status} compactBadge`}>{s.status === 'healthy' ? 'Healthy' : s.status === 'problem' ? 'Problem' : 'Offline'}</span>
                    </button>
                  </td>
                  <td><span className={`badge ${sb.tone}`}>{sb.text}</span></td>
                  <td><MetricBar value={s.cpu_usage} alert={hasIssue(s, 'CPU')} offline={s.status === 'offline'} /></td>
                  <td><MetricBar value={s.memory_usage} alert={hasIssue(s, '内存')} offline={s.status === 'offline'} /></td>
                  <td><MetricBar value={s.disk_usage} alert={hasIssue(s, '磁盘')} offline={s.status === 'offline'} /></td>
                  <td className="portCell">{s.status === 'offline' ? '-' : <><span className={`portSquare compactPortSquare ${s.port_443 ? 'up' : 'down'}`}>{s.port_443 ? 'UP' : 'DOWN'}</span>{xrayBadge.outdated ? <div className="compVerBadge problem">需更新</div> : null}</>}</td>
                  <td className="portCell">{s.status === 'offline' ? '-' : <span className={`portSquare compactPortSquare ${s.port_6379 ? 'up' : 'down'}`}>{s.port_6379 ? 'UP' : 'DOWN'}</span>}</td>
                  <td className="portCell">{s.status === 'offline' ? '-' : <><span className={`portSquare compactPortSquare ${s.port_8888 ? 'up' : 'down'}`}>{s.port_8888 ? 'UP' : 'DOWN'}</span>{xagentBadge.outdated ? <div className="compVerBadge problem">需更新</div> : null}</>}</td>
                  <td className="portCell">{s.status === 'offline' ? '-' : <><span className={`portSquare compactPortSquare ${s.port_8789 ? 'up' : 'down'}`}>{s.port_8789 ? 'UP' : 'DOWN'}</span>{xbridgeBadge.outdated ? <div className="compVerBadge problem">需更新</div> : null}</>}</td>
                  <td>
                    <ServerActions server={s} compact onEdit={setEditServer} onDelete={setDeleteServer} onTaskHistory={setTaskHistoryServer} />
                  </td>
                </tr>
              )})}
              {paged.length === 0 ? <tr><td colSpan="13" className="emptyStateCell">当前筛选下暂无节点</td></tr> : null}
            </tbody>
          </table>
        </div>

        <div className="paginationFooter compactPaginationFooter">
          <div className="small">显示 {(currentPage - 1) * pageSize + (paged.length ? 1 : 0)} - {(currentPage - 1) * pageSize + paged.length} / {filtered.length}</div>
          <div className="paginationWrap compactPaginationWrap">
            <button className="pageBtn compactPageBtn" type="button" onClick={() => goPage(Math.max(1, currentPage - 1))} disabled={currentPage <= 1}>上一页</button>
            {pageNumbers.map((n) => <button key={n} className={`pageBtn compactPageBtn ${currentPage === n ? 'activePageBtn' : ''}`} type="button" onClick={() => goPage(n)}>{n}</button>)}
            <button className="pageBtn compactPageBtn" type="button" onClick={() => goPage(Math.min(totalPages, currentPage + 1))} disabled={currentPage >= totalPages}>下一页</button>
          </div>
        </div>
      </section>

      <NodeDrawer server={selectedServer} onClose={() => setSelectedServer(null)} onCopy={copyText} onViewIncidents={(sid) => { setSelectedServer(null); setIncidentServerFilter(sid); setIncidentPanelOpen(true); }} />
      <ServerModal open={!!editServer} mode="edit" server={editServer} groups={groups} onClose={() => setEditServer(null)} onSaved={() => { setToast({ type: 'success', text: '节点修改已保存' }); location.reload(); }} />
      <ServerModal open={!!deleteServer} mode="delete" server={deleteServer} groups={groups} onClose={() => setDeleteServer(null)} onDeleted={handleDeleted} />
      <GroupManagerModal open={groupManagerOpen} groups={groups} onClose={() => setGroupManagerOpen(false)} />
      <MonitorRulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} reportInterval={10} onSaved={(nextRules) => { setRules(nextRules); setToast({ type: 'success', text: '监控规则已保存' }); }} />
      <BulkMoveModal open={bulkMoveOpen} groups={groups} count={selectedIds.length} onClose={() => setBulkMoveOpen(false)} onConfirm={bulkMove} />
      <ActionTaskModal
        open={taskServers.length > 0}
        servers={taskServers}
        initialActionKey={taskInitialActionKey}
        onClose={() => { setTaskServers([]); setTaskInitialActionKey(''); }}
        onCreated={(result) => {
          setTaskServers([]);
          if (result?.total) {
            setToast({ type: result.failed ? 'warning' : 'success', text: `批量任务已创建：成功 ${result.success}/${result.total}` });
          } else {
            setToast({ type: 'success', text: '任务已创建' });
          }
        }}
      />
      <TaskHistoryModal open={!!taskHistoryServer} server={taskHistoryServer} onClose={() => setTaskHistoryServer(null)} />
      <PackageRepoModal open={packageRepoOpen} refreshKey={packageRepoRefreshKey} onClose={() => setPackageRepoOpen(false)} />
      <PackageUploadModal open={packageUploadOpen} onClose={() => setPackageUploadOpen(false)} onUploaded={(data) => { setPackageRepoRefreshKey((x) => x + 1); setPackageRepoOpen(true); setToast({ type: 'success', text: `上传成功：release=${data.release || '-'}${data.stable_url ? '，已发布为 stable' : ''}` }); }} />
      <IncidentPanel open={incidentPanelOpen} onClose={() => { setIncidentPanelOpen(false); setIncidentServerFilter(''); }} initialServerFilter={incidentServerFilter} />
      <NotificationSettingsModal open={notifSettingsOpen} onClose={() => setNotifSettingsOpen(false)} onSaved={() => setToast({ type: 'success', text: '通知设置已保存' })} />
      <IncidentHistoryModal open={incidentHistoryOpen} onClose={() => setIncidentHistoryOpen(false)} />
    </>
  );
}
