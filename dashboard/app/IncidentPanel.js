'use client';

import { useEffect, useMemo, useState } from 'react';

function formatShanghai(input) {
  if (!input) return '-';
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return input;
  const f = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d);
  const get = (t) => f.find((x) => x.type === t)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'open', label: '🔴 Open' },
  { value: 'acknowledged', label: '🟡 Acknowledged' },
  { value: 'auto_remediating', label: '🔧 Remediating' },
  { value: 'takeover_pending', label: '🤖 接管中' },
  { value: 'takeover_active', label: '🤖 AI修复中' },
  { value: 'failed', label: '❌ Failed' },
  { value: 'resolved', label: '✅ Resolved' },
];

const SEVERITY_BADGE = { critical: 'offline', warning: 'problem', info: 'healthy' };

function statusBadgeClass(status) {
  if (status === 'open') return 'offline';
  if (status === 'acknowledged' || status === 'auto_remediating') return 'problem';
  if (status === 'takeover_pending' || status === 'takeover_active') return 'problem';
  if (status === 'failed') return 'offline';
  if (status === 'resolved') return 'healthy';
  return '';
}

export default function IncidentPanel({ open, onClose, onTriggerAction, initialServerFilter }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [serverFilter, setServerFilter] = useState(initialServerFilter || '');
  const [triggerBusy, setTriggerBusy] = useState({});
  const [triggerResult, setTriggerResult] = useState({});
  const [taskDetail, setTaskDetail] = useState(null);
  const [taskDetailLoading, setTaskDetailLoading] = useState(false);
  const [selectedIncidentIds, setSelectedIncidentIds] = useState([]);
  const [batchBusy, setBatchBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setServerFilter(initialServerFilter || '');
  }, [open, initialServerFilter]);

  useEffect(() => {
    if (!open) return;
    loadIncidents();
    const timer = setInterval(loadIncidents, 15000);
    return () => clearInterval(timer);
  }, [open, statusFilter, serverFilter]);

  async function loadIncidents() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (serverFilter.trim()) params.set('server_id', serverFilter.trim());
      params.set('limit', '100');
      const res = await fetch(`/api/proxy/incidents?${params}`, { cache: 'no-store' });
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleTakeover(incident) {
    if (!confirm(`确认由 OpenClaw 远程接管修复此故障？\n\n节点: ${incident.server_id}\n故障: ${incident.fault_type}\n\n将创建临时 sudo 用户，AI 通过 SSH 远程修复，修复后自动清理。`)) return;
    setTriggerBusy((prev) => ({ ...prev, [incident.id]: true }));
    setTriggerResult((prev) => ({ ...prev, [incident.id]: null }));
    try {
      const res = await fetch('/api/proxy/incidents/' + incident.id + '/takeover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setTriggerResult((prev) => ({ ...prev, [incident.id]: { ok: true, task_id: data.task_id, status: 'takeover: ' + data.phase } }));
        setTimeout(loadIncidents, 2000);
      } else {
        setTriggerResult((prev) => ({ ...prev, [incident.id]: { ok: false, error: data.error || '接管失败' } }));
      }
    } catch (e) {
      setTriggerResult((prev) => ({ ...prev, [incident.id]: { ok: false, error: e.message } }));
    } finally {
      setTriggerBusy((prev) => ({ ...prev, [incident.id]: false }));
    }
  }

  async function handleTriggerAction(incident) {
    if (!incident.suggested_action) return;
    setTriggerBusy((prev) => ({ ...prev, [incident.id]: true }));
    setTriggerResult((prev) => ({ ...prev, [incident.id]: null }));
    try {
      const meta = JSON.parse(incident.metadata || '{}');
      const params = {};
      if (meta.ip) params.server_ip = meta.ip;

      const res = await fetch('/api/proxy/incidents/' + incident.id + '/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action_key: incident.suggested_action, params }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setTriggerResult((prev) => ({ ...prev, [incident.id]: { ok: true, task_id: data.task_id, status: data.status } }));
        setTimeout(loadIncidents, 1500);
      } else {
        setTriggerResult((prev) => ({ ...prev, [incident.id]: { ok: false, error: data.error || '执行失败' } }));
      }
    } catch {
      setTriggerResult((prev) => ({ ...prev, [incident.id]: { ok: false, error: '网络错误' } }));
    } finally {
      setTriggerBusy((prev) => ({ ...prev, [incident.id]: false }));
    }
  }

  async function loadTaskDetail(taskId) {
    if (!taskId) return;
    setTaskDetailLoading(true);
    setTaskDetail(null);
    try {
      const res = await fetch(`/api/proxy/actions/tasks/${taskId}`, { cache: 'no-store' });
      const data = await res.json();
      if (res.ok && data.task_id) {
        setTaskDetail(data);
      }
    } catch {} finally {
      setTaskDetailLoading(false);
    }
  }

  const actionableItems = items.filter((i) => i.suggested_action && i.status !== 'resolved');
  const selectedActionable = actionableItems.filter((i) => selectedIncidentIds.includes(i.id));

  function toggleIncident(id) {
    setSelectedIncidentIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }
  function toggleAllActionable() {
    const ids = actionableItems.map((i) => i.id);
    const allSelected = ids.every((id) => selectedIncidentIds.includes(id));
    setSelectedIncidentIds(allSelected ? [] : ids);
  }

  async function batchTrigger() {
    if (!selectedActionable.length) return;
    setBatchBusy(true);
    const results = [];
    for (const inc of selectedActionable) {
      try {
        const meta = JSON.parse(inc.metadata || '{}');
        const params = {};
        if (meta.ip) params.server_ip = meta.ip;
        const res = await fetch('/api/proxy/incidents/' + inc.id + '/trigger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action_key: inc.suggested_action, params }),
        });
        const data = await res.json();
        results.push({ id: inc.id, ok: res.ok && data.ok, error: data.error });
      } catch {
        results.push({ id: inc.id, ok: false, error: '网络错误' });
      }
    }
    setBatchBusy(false);
    setSelectedIncidentIds([]);
    const success = results.filter((r) => r.ok).length;
    setTriggerResult((prev) => ({
      ...prev,
      _batch: { ok: success > 0, text: `批量执行完成：成功 ${success}/${results.length}` }
    }));
    setTimeout(loadIncidents, 1500);
  }

  if (!open) return null;

  return (
    <div className="drawerOverlay" onClick={onClose}>
      <div className="modalCard incidentPanelModal" onClick={(e) => e.stopPropagation()}>
        <div className="drawerHeader">
          <div>
            <div className="drawerTitle">🚨 Incident 面板</div>
            <div className="drawerSub">故障事件与一键处置</div>
          </div>
          <button className="iconButton" type="button" onClick={onClose}>×</button>
        </div>

        <div className="incidentToolbar">
          <select className="select compactSelect" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input className="input compactInput" placeholder="按 server_id 过滤" value={serverFilter} onChange={(e) => setServerFilter(e.target.value)} style={{ maxWidth: 200 }} />
          <button className="pageBtn compactPageBtn" type="button" onClick={loadIncidents}>刷新</button>
          <span className="small">共 {items.length} 条{loading ? ' · 加载中...' : ''}</span>
        </div>

        <div className="modalBody">

        {actionableItems.length > 0 ? (
          <div className="incidentBatchBar">
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={actionableItems.length > 0 && actionableItems.every((i) => selectedIncidentIds.includes(i.id))} onChange={toggleAllActionable} />
              <span className="small">全选可操作 ({actionableItems.length})</span>
            </label>
            {selectedActionable.length > 0 ? (
              <button className="primaryBtn compactPageBtn" type="button" disabled={batchBusy} onClick={batchTrigger}>
                {batchBusy ? '批量执行中...' : `⚡ 批量执行 ${selectedActionable.length} 条`}
              </button>
            ) : null}
            {triggerResult._batch ? (
              <span className={`small ${triggerResult._batch.ok ? 'okText' : 'badText'}`}>{triggerResult._batch.text}</span>
            ) : null}
          </div>
        ) : null}

        <div className="incidentListWrap">
          {items.length === 0 && !loading ? <div className="small" style={{ padding: 20, textAlign: 'center' }}>暂无 incident 记录</div> : null}

          {items.map((item) => {
            const result = triggerResult[item.id];
            const busy = triggerBusy[item.id];
            const hasTask = !!item.action_task_id;
            return (
              <div key={item.id} className={`incidentCard incidentCard--${item.status}`}>
                <div className="incidentCardHeader">
                  <div className="incidentCardTitle">
                    {item.suggested_action && item.status !== 'resolved' ? (
                      <input type="checkbox" checked={selectedIncidentIds.includes(item.id)} onChange={() => toggleIncident(item.id)} />
                    ) : null}
                    <span className={`badge ${SEVERITY_BADGE[item.severity] || ''}`}>{item.severity}</span>
                    <span className={`badge ${statusBadgeClass(item.status)}`}>{item.status}</span>
                    <strong>{item.title || item.fault_type}</strong>
                  </div>
                  <div className="incidentCardMeta small">
                    <span>节点：{item.server_id}</span>
                    <span>首次：{formatShanghai(item.first_seen_at)}</span>
                    <span>最近：{formatShanghai(item.last_seen_at)}</span>
                    {item.resolved_at ? <span>恢复：{formatShanghai(item.resolved_at)}</span> : null}
                  </div>
                </div>

                <div className="incidentCardBody">
                  {item.details ? <div className="small">{item.details}</div> : null}

                  <div className="incidentActionRow">
                    {item.suggested_action && item.status !== 'resolved' ? (
                      <button
                        className="primaryBtn compactPageBtn"
                        type="button"
                        disabled={busy}
                        onClick={() => handleTriggerAction(item)}
                      >
                        {busy ? '执行中...' : item.status === 'failed' ? `🔄 重试 ${item.suggested_action}` : `⚡ 一键 ${item.suggested_action}`}
                      </button>
                    ) : null}

                    {hasTask ? (
                      <button
                        className="pageBtn compactPageBtn"
                        type="button"
                        onClick={() => loadTaskDetail(item.action_task_id)}
                      >
                        查看关联任务
                      </button>
                    ) : null}

                    {(item.status === 'failed' || item.status === 'open') ? (
                      <button
                        className="dangerBtn compactPageBtn takeoverBtn"
                        type="button"
                        disabled={busy}
                        onClick={() => handleTakeover(item)}
                      >
                        {busy ? '接管中...' : 'OpenClaw 接管'}
                      </button>
                    ) : null}

                    {!item.suggested_action && item.status !== 'resolved' && item.status !== 'failed' ? (
                      <span className="small" style={{ opacity: 0.5 }}>暂无建议动作</span>
                    ) : null}
                  </div>

                  {result ? (
                    <div className={`incidentTriggerResult small ${result.ok ? 'okText' : 'badText'}`}>
                      {result.ok ? `✅ 任务已创建 task_id=${result.task_id} status=${result.status}` : `❌ ${result.error}`}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        {taskDetail ? (
          <div className="incidentTaskDetail">
            <div className="drawerSectionTitle">
              关联任务详情
              <button className="iconButton" type="button" onClick={() => setTaskDetail(null)} style={{ marginLeft: 8 }}>×</button>
            </div>
            <div className="drawerList">
              <div className="drawerRow"><span>task_id</span><strong>{taskDetail.task_id}</strong></div>
              <div className="drawerRow"><span>动作</span><strong>{taskDetail.action_key}</strong></div>
              <div className="drawerRow"><span>状态</span><strong><span className={`badge ${taskDetail.status === 'success' ? 'healthy' : taskDetail.status === 'failed' || taskDetail.status === 'timeout' ? 'offline' : 'problem'}`}>{taskDetail.status}</span></strong></div>
              <div className="drawerRow"><span>exit_code</span><strong>{String(taskDetail.exit_code ?? '-')}</strong></div>
              <div className="drawerRow"><span>result_code</span><strong>{taskDetail.result_code || '-'}</strong></div>
              <div className="drawerRow"><span>摘要</span><strong>{taskDetail.result_summary || '-'}</strong></div>
              <div className="drawerRow"><span>错误</span><strong>{taskDetail.error_message || '-'}</strong></div>
              <div className="drawerRow"><span>创建</span><strong>{formatShanghai(taskDetail.created_at)}</strong></div>
              <div className="drawerRow"><span>完成</span><strong>{formatShanghai(taskDetail.finished_at)}</strong></div>
            </div>
            {taskDetail.log_excerpt ? (
              <div style={{ marginTop: 12 }}>
                <div className="fieldLabel">日志</div>
                <pre className="small taskDetailPre taskDetailLog">{taskDetail.log_excerpt}</pre>
              </div>
            ) : null}
          </div>
        ) : null}

        {taskDetailLoading ? <div className="small" style={{ padding: 12 }}>加载任务详情中...</div> : null}
        </div>
      </div>
    </div>
  );
}
