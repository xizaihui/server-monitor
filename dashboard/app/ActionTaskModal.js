'use client';

import { useEffect, useMemo, useState } from 'react';

export default function ActionTaskModal({ open, server, servers, onClose, onCreated }) {
  const targetServers = useMemo(() => {
    if (Array.isArray(servers) && servers.length) return servers;
    if (server) return [server];
    return [];
  }, [server, servers]);

  const singleServer = targetServers.length === 1 ? targetServers[0] : null;
  const [definitions, setDefinitions] = useState([]);
  const [loadingDefs, setLoadingDefs] = useState(false);
  const [actionKey, setActionKey] = useState('');
  const [form, setForm] = useState({ server_id: '', xagent_download_url: '', server_ip: '', download_url: '', ops_scripts_url: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoadingDefs(true);
    fetch('/api/proxy/actions/definitions', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setDefinitions(list);
        setActionKey((prev) => prev || list[0]?.action_key || '');
      })
      .catch(() => setDefinitions([]))
      .finally(() => setLoadingDefs(false));
  }, [open]);

  const currentDef = useMemo(() => definitions.find((x) => x.action_key === actionKey) || null, [definitions, actionKey]);
  const isBulk = targetServers.length > 1;

  useEffect(() => {
    if (!open || !targetServers.length) return;
    const seed = singleServer || targetServers[0];
    const meta = currentDef?.metadata || {};
    setForm((prev) => ({
      ...prev,
      server_id: seed?.instance_id || prev.server_id || '',
      server_ip: seed?.ip || prev.server_ip || '',
      xagent_download_url: actionKey === 'install_ixvpn' ? (prev.xagent_download_url || meta.download_url || 'http://43.165.172.3/downloads/packages/xagent/xagent-server.zip') : prev.xagent_download_url,
      download_url: actionKey === 'install_xnftables' ? (prev.download_url || meta.download_url || 'http://43.165.172.3/downloads/packages/xbridge/xbridge-server.zip') : prev.download_url,
      ops_scripts_url: actionKey === 'init_ops_scripts' ? (prev.ops_scripts_url || meta.ops_scripts_url || 'http://43.165.172.3/downloads/packages/ops/ops-scripts.zip') : prev.ops_scripts_url,
    }));
  }, [open, singleServer, targetServers, currentDef, actionKey]);

  const fields = useMemo(() => {
    if (actionKey === 'install_ixvpn') {
      return [
        { key: 'server_id', label: isBulk ? '业务 server_id（批量默认值，可按需统一下发）' : '业务 server_id', placeholder: '例如 1018' },
        { key: 'xagent_download_url', label: 'xagent 安装包地址', placeholder: 'http://43.165.172.3/downloads/packages/xagent/xagent-server.zip' },
        { key: 'server_ip', label: isBulk ? '服务器 IP（批量时建议逐节点单独使用）' : '服务器 IP', placeholder: '例如 1.2.3.4' },
      ];
    }
    if (actionKey === 'install_xnftables') {
      return [
        { key: 'server_id', label: '业务 server_id', placeholder: '例如 1018' },
        { key: 'download_url', label: 'bridge 安装包地址', placeholder: 'http://43.165.172.3/downloads/packages/xbridge/xbridge-server.zip' },
      ];
    }
    if (actionKey === 'apply_cert') {
      return [
        { key: 'server_ip', label: isBulk ? '证书绑定 IP（批量时请确认统一参数是否合适）' : '证书绑定 IP', placeholder: '例如 43.165.172.3' },
      ];
    }
    if (actionKey === 'init_ops_scripts') {
      return [
        { key: 'ops_scripts_url', label: '脚本包地址', placeholder: 'http://43.165.172.3/downloads/packages/ops/ops-scripts.zip' },
      ];
    }
    return [];
  }, [actionKey, isBulk]);

  if (!open || !targetServers.length) return null;

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
    if (actionKey === 'apply_cert') {
      return { server_ip: form.server_ip };
    }
    if (actionKey === 'init_ops_scripts') {
      return { ops_scripts_url: form.ops_scripts_url };
    }
    return {};
  }

  async function submit() {
    setSubmitting(true);
    setError('');
    try {
      const params = buildParams();
      const requests = targetServers.map((item) => fetch('/api/proxy/actions/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          server_id: item.server_id,
          action_key: actionKey,
          params,
          source: isBulk ? 'dashboard-bulk' : 'dashboard',
          created_by: isBulk ? 'dashboard-bulk' : 'dashboard'
        })
      }).then(async (res) => ({ ok: res.ok, data: await res.json().catch(() => ({})) })));

      const results = await Promise.all(requests);
      setSubmitting(false);
      const success = results.filter((x) => x.ok).length;
      if (!success) {
        setError(results[0]?.data?.error || '创建任务失败');
        return;
      }
      onCreated?.({ total: targetServers.length, success, failed: targetServers.length - success, action_key: actionKey });
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
            <div className="drawerTitle">统一任务入口</div>
            <div className="drawerSub">
              {singleServer ? (singleServer.ip || singleServer.server_id) : `已选择 ${targetServers.length} 个节点`}
            </div>
          </div>
          <button className="iconButton" type="button" onClick={onClose}>×</button>
        </div>
        <div className="modalBody">
          <label className="fieldLabel">执行范围</label>
          <div className="small" style={{ lineHeight: 1.7 }}>
            {singleServer ? '单节点部署 / 执行任务' : `批量部署 / 执行任务，共 ${targetServers.length} 个节点`}
          </div>

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

          {isBulk ? (
            <div className="small" style={{ background: '#f8fafc', border: '1px solid #e4e7ec', borderRadius: 10, padding: '10px 12px', lineHeight: 1.7 }}>
              批量模式会把同一套参数下发到所有已勾选节点。像 <b>apply_cert</b>、<b>install_ixvpn</b>（安装 xagent）这类强依赖节点独立参数的动作，批量前请确认参数是否适用于全部节点。
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
            <button className="primaryBtn" type="button" onClick={submit} disabled={submitting || !actionKey}>
              {submitting ? '提交中...' : (isBulk ? `批量创建 ${targetServers.length} 个任务` : '创建任务')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
