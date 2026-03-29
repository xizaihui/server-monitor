'use client';

import { useEffect, useState } from 'react';

export default function ServerModal({ open, mode, server, groups, onClose, onSaved, onDeleted }) {
  const [name, setName] = useState('');
  const [group, setGroup] = useState('未分组');
  const [deleting, setDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState('');

  useEffect(() => {
    setName(server?.display_name || server?.ip || '');
    setGroup(server?.group_name || '未分组');
    setDeleting(false);
    setDeleteResult('');
  }, [server, open]);

  if (!open || !server) return null;

  async function save() {
    await fetch(`/api/proxy/servers/${server.server_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: name, group_name: group }),
    });
    onSaved?.();
    onClose();
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
            <div className="modalActions">
              <button className="pageBtn" type="button" onClick={onClose}>取消</button>
              <button className="primaryBtn" type="button" onClick={save}>保存修改</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
