'use client';

import { useEffect, useMemo, useState } from 'react';

export default function ActionTaskModal({ open, server, onClose, onCreated }) {
  const [definitions, setDefinitions] = useState([]);
  const [loadingDefs, setLoadingDefs] = useState(false);
  const [actionKey, setActionKey] = useState('');
  const [form, setForm] = useState({ server_id: '', xagent_download_url: '', server_ip: '', download_url: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!server || !open) return;
    setForm({ server_id: server.instance_id || '', xagent_download_url: '', server_ip: server.ip || '', download_url: '' });
  }, [server, open]);

  useEffect(() => {
    if (!open) return;
    setLoadingDefs(true);
    fetch('/api/proxy/actions/definitions', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setDefinitions(list);
        if (list.length && !actionKey) setActionKey(list[0].action_key);
      })
      .catch(() => setDefinitions([]))
      .finally(() => setLoadingDefs(false));
  }, [open]);

  const currentDef = useMemo(() => definitions.find((x) => x.action_key === actionKey) || null, [definitions, actionKey]);

  const fields = useMemo(() => {
    if (actionKey === 'install_ixvpn') {
      return [
        { key: 'server_id', label: '业务 server_id', placeholder: '例如 1018' },
        { key: 'xagent_download_url', label: 'xagent 下载地址', placeholder: 'https://...' },
        { key: 'server_ip', label: '服务器 IP', placeholder: '例如 1.2.3.4' },
      ];
    }
    if (actionKey === 'install_xnftables') {
      return [
        { key: 'server_id', label: '业务 server_id', placeholder: '例如 1018' },
        { key: 'download_url', label: 'bridge 下载地址', placeholder: 'https://...' },
      ];
    }
    return [];
  }, [actionKey]);

  if (!open || !server) return null;

  function patchField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function buildParams() {
    if (actionKey === 'install_ixvpn') {
      return { server_id: form.server_id, xagent_download_url: form.xagent_download_url, server_ip: form.server_ip };
    }
    if (actionKey === 'install_xnftables') {
      return { server_id: form.server_id, download_url: form.download_url };
    }
    return {};
  }

  async function submit() {
    setSubmitting(true);
    setError('');
    try {
      const payload = { server_id: server.server_id, action_key: actionKey, params: buildParams(), source: 'dashboard', created_by: 'dashboard' };
      const res = await fetch('/api/proxy/actions/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json().catch(() => ({}));
      setSubmitting(false);
      if (!res.ok) { setError(data.error || '创建任务失败'); return; }
      onCreated?.(data.task);
      onClose?.();
    } catch {
      setSubmitting(false);
      setError('创建任务失败，请稍后重试');
    }
  }

  return (
    <div className="drawerOverlay" onClick={onClose}>
      <div className="modalCard largeModal" onClick={(e) => e.stopPropagation()}>
        <div className="drawerHeader">
          <div>
            <div className="drawerTitle">执行任务</div>
            <div className="drawerSub">{server.ip || server.server_id}</div>
          </div>
          <button className="iconButton" type="button" onClick={onClose}>×</button>
        </div>
        <div className="modalBody">
          <label className="fieldLabel">动作类型</label>
          <select className="select fullInput" value={actionKey} onChange={(e) => setActionKey(e.target.value)} disabled={loadingDefs}>
            {definitions.map((item) => (
              <option key={item.action_key} value={item.action_key}>
                {item.display_name || item.name}
              </option>
            ))}
          </select>
          {currentDef ? (
            <div className="small" style={{ lineHeight: 1.6 }}>
              分类：{currentDef.category || '-'} · 风险：{currentDef.risk_level || '-'} · 执行器：{currentDef.executor_type || '-'}
              <br />
              {currentDef.description || ''}
            </div>
          ) : null}
          {fields.map((field) => (
            <div key={field.key} style={{ marginTop: 12 }}>
              <label className="fieldLabel">{field.label}</label>
              <input className="input fullInput" value={form[field.key] || ''} placeholder={field.placeholder} onChange={(e) => patchField(field.key, e.target.value)} />
            </div>
          ))}
          {error ? <div className="small" style={{ color: '#b42318', marginTop: 12 }}>{error}</div> : null}
          <div className="modalActions">
            <button className="pageBtn" type="button" onClick={onClose} disabled={submitting}>取消</button>
            <button className="primaryBtn" type="button" onClick={submit} disabled={submitting || !actionKey}>{submitting ? '提交中...' : '创建任务'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
