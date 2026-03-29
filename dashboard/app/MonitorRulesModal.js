'use client';

import { useEffect, useState } from 'react';

const EMPTY = {
  cpu: { enabled: true, threshold: 85, consecutive: 1 },
  memory: { enabled: true, threshold: 90, consecutive: 1 },
  disk: { enabled: true, threshold: 90, consecutive: 1 },
  port_443: { enabled: true, consecutive: 1 },
  port_6379: { enabled: true, consecutive: 1 },
  port_8888: { enabled: true, consecutive: 1 },
  port_8789: { enabled: true, consecutive: 1 },
};

export default function MonitorRulesModal({ open, onClose, onSaved, reportInterval = 10 }) {
  const [rules, setRules] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch('/api/proxy/settings/monitor-rules', { cache: 'no-store' }).then((r) => r.json()).then((data) => setRules({ ...EMPTY, ...data })).catch(() => setRules(EMPTY));
  }, [open]);

  if (!open) return null;
  function patchRule(key, field, value) { setRules((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } })); }
  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/proxy/settings/monitor-rules', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rules) });
      const data = await res.json().catch(() => ({}));
      setSaving(false);
      if (res.ok) { onSaved?.(data.rules || rules); onClose(); return; }
      window.alert(data.error || '保存规则失败');
    } catch { setSaving(false); window.alert('保存规则失败，请稍后重试'); }
  }
  const items = [['cpu', 'CPU', '%'], ['memory', '内存', '%'], ['disk', '硬盘', '%']];
  const ports = [['port_443', '443'], ['port_6379', '6379'], ['port_8888', '8888'], ['port_8789', '8789']];
  return (
    <div className="drawerOverlay" onClick={onClose}>
      <div className="modalCard largeModal" onClick={(e) => e.stopPropagation()}>
        <div className="drawerHeader"><div><div className="drawerTitle">监控规则配置</div><div className="drawerSub">当前 agent 上报间隔约 {reportInterval} 秒；连续 5 次约等于 {reportInterval * 5} 秒</div></div><button className="iconButton" type="button" onClick={onClose}>×</button></div>
        <div className="modalBody">
          <div className="groupList">{items.map(([key, label, unit]) => <div className="groupItem" key={key}><div><div className="groupTitle">{label}</div><div className="small">超过阈值且连续命中 N 次后，节点标记为异常并自动置顶</div></div><div className="toolbarGroup"><label className="small"><input type="checkbox" checked={!!rules[key]?.enabled} onChange={(e) => patchRule(key, 'enabled', e.target.checked)} /> 启用</label><input className="input" style={{ width: 90 }} value={rules[key]?.threshold ?? ''} onChange={(e) => patchRule(key, 'threshold', Number(e.target.value || 0))} placeholder={`阈值${unit}`} /><input className="input" style={{ width: 90 }} value={rules[key]?.consecutive ?? ''} onChange={(e) => patchRule(key, 'consecutive', Number(e.target.value || 1))} placeholder="连续次数" /></div></div>)}</div>
          <div className="drawerSection"><div className="drawerSectionTitle">端口连续判定</div><div className="groupList">{ports.map(([key, label]) => <div className="groupItem" key={key}><div><div className="groupTitle">端口 {label}</div><div className="small">端口连续 DOWN N 次后标记异常</div></div><div className="toolbarGroup"><label className="small"><input type="checkbox" checked={!!rules[key]?.enabled} onChange={(e) => patchRule(key, 'enabled', e.target.checked)} /> 启用</label><input className="input" style={{ width: 90 }} value={rules[key]?.consecutive ?? ''} onChange={(e) => patchRule(key, 'consecutive', Number(e.target.value || 1))} placeholder="连续次数" /></div></div>)}</div></div>
          <div className="modalActions"><button className="pageBtn" type="button" onClick={onClose} disabled={saving}>取消</button><button className="primaryBtn" type="button" onClick={save} disabled={saving}>{saving ? '保存中...' : '保存规则'}</button></div>
        </div>
      </div>
    </div>
  );
}
