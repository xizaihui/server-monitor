'use client';

import { useEffect, useState } from 'react';

export default function ServerModal({ open, mode, server, groups, onClose, onSaved, onDeleted }) {
  const [name, setName] = useState('');
  const [group, setGroup] = useState('未分组');
  const [instanceId, setInstanceId] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState('');

  useEffect(() => {
    setName(server?.display_name || server?.ip || '');
    setGroup(server?.group_name || '未分组');
    setInstanceId(server?.instance_id || '');
    setSaving(false);
    setSaveResult('');
    setDeleting(false);
    setDeleteResult('');
  }, [server, open]);

  if (!open || !server) return null;

  async function save() {
    setSaving(true);
    setSaveResult('');
    try {
      const body = { display_name: name, group_name: group };
      // Only include instance_id if it was changed
      const oldInstanceId = server?.instance_id || '';
      if (instanceId.trim() !== oldInstanceId) {
        body.instance_id = instanceId.trim();
      }

      const res = await fetch(`/api/proxy/servers/${server.server_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setSaveResult(data.error || '保存失败');
        setSaving(false);
        return;
      }

      if (data.instance_id_changed && data.task_id) {
        setSaveResult(`ServerID 已修改：${data.old} → ${data.new}，同步任务已下发 (${data.task_id})`);
      } else if (data.instance_id_changed && data.warning) {
        setSaveResult(`ServerID 已修改（数据库），但节点有进行中的任务，稍后自动同步`);
      }

      setTimeout(() => {
        onSaved?.();
        onClose();
      }, data.instance_id_changed ? 1500 : 0);
    } catch {
      setSaveResult('保存失败，请重试');
      setSaving(false);
    }
  }

  async function remove() {
    const ok = window.confirm(`确认彻底删除节点 ${server.ip || server.server_id} 吗？\n\n这会同时删除该节点和历史监控数据，且不可恢复。`);
    if (!ok) return;
    setDeleting(true);
    setDeleteResult('');
    try {
      const res = await fetch(`/api/proxy/servers/${server.server_id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setDeleteResult('删除失败，请稍后重试');
        setDeleting(false);
        return;
      }
      setDeleteResult(`已彻底删除：节点 ${data.deletedServerRows || 0} 条，监控数据 ${data.deletedMetricRows || 0} 条`);
      onDeleted?.(server, data);
      setTimeout(() => onClose(), 500);
    } catch {
      setDeleteResult('删除失败，请稍后重试');
      setDeleting(false);
    }
  }

  const instanceIdChanged = instanceId.trim() !== (server?.instance_id || '');
  const instanceIdValid = !instanceId.trim() || /^\d+$/.test(instanceId.trim());

  return (
    <div className="drawerOverlay" onClick={onClose}>
      <div className="modalCard" onClick={(e) => e.stopPropagation()}>
        <div className="drawerHeader">
          <div>
            <div className="drawerTitle">{mode === 'delete' ? '彻底删除节点' : '编辑节点'}</div>
            <div className="drawerSub">{server.ip || '-'}</div>
          </div>
          <button className="iconButton" type="button" onClick={onClose}>×</button>
        </div>

        {mode === 'delete' ? (
          <div className="modalBody">
            <div className="small">删除后将同时移除该节点记录与历史监控数据，刷新后不会再出现。</div>
            {deleteResult ? <div className="small" style={{ color: deleteResult.includes('失败') ? '#b42318' : '#15803d' }}>{deleteResult}</div> : null}
            <div className="modalActions">
              <button className="pageBtn" type="button" onClick={onClose} disabled={deleting}>取消</button>
              <button className="dangerBtn" type="button" onClick={remove} disabled={deleting}>{deleting ? '删除中...' : '确认彻底删除'}</button>
            </div>
          </div>
        ) : (
          <div className="modalBody">
            <label className="fieldLabel">节点名称</label>
            <input className="input fullInput" value={name} onChange={(e) => setName(e.target.value)} />

            <label className="fieldLabel">分类</label>
            <select className="select fullInput" value={group} onChange={(e) => setGroup(e.target.value)}>
              {groups.map((g) => <option key={g.id} value={g.name}>{g.name}</option>)}
            </select>

            <label className="fieldLabel">
              Server-ID (InstanceId / NodeId)
              {instanceIdChanged && instanceIdValid && (
                <span style={{ color: '#b45309', fontWeight: 400, fontSize: '0.78rem', marginLeft: 8 }}>
                  ⚠ 修改后将自动同步到节点配置并重启服务
                </span>
              )}
            </label>
            <input
              className="input fullInput"
              value={instanceId}
              onChange={(e) => setInstanceId(e.target.value)}
              placeholder="纯数字，如 1015"
              style={!instanceIdValid ? { borderColor: '#b42318' } : instanceIdChanged ? { borderColor: '#b45309' } : {}}
            />
            {!instanceIdValid && <div className="small" style={{ color: '#b42318' }}>Server-ID 必须为纯数字</div>}
            {instanceIdChanged && instanceIdValid && (
              <div className="small" style={{ color: '#b45309' }}>
                当前值: {server?.instance_id || '(空)'} → 新值: {instanceId.trim() || '(空)'}
                <br />保存后将下发 change_server_id 任务到节点，自动修改 xagent.yaml 和 bridge.yaml 并重启服务
              </div>
            )}

            {saveResult && (
              <div className="small" style={{ color: saveResult.includes('失败') ? '#b42318' : '#15803d', marginTop: 4 }}>{saveResult}</div>
            )}

            <div className="modalActions">
              <button className="pageBtn" type="button" onClick={onClose} disabled={saving}>取消</button>
              <button className="primaryBtn" type="button" onClick={save} disabled={saving || (instanceIdChanged && !instanceIdValid)}>
                {saving ? '保存中...' : '保存修改'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
