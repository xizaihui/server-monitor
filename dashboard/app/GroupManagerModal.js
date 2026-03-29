'use client';

import { useState } from 'react';

export default function GroupManagerModal({ open, groups, onClose }) {
  const [name, setName] = useState('');
  const [localGroups, setLocalGroups] = useState(groups);
  if (!open) return null;

  async function addGroup() {
    if (!name.trim()) return;
    await fetch('/api/proxy/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) });
    location.reload();
  }

  async function renameGroup(group) {
    const next = window.prompt('输入新的分类名称', group.name);
    if (!next || next === group.name) return;
    await fetch(`/api/proxy/groups/${group.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: next }) });
    location.reload();
  }

  async function deleteGroup(group) {
    const ok = window.confirm(`确认删除分类 ${group.name} 吗？该分类下节点将移动到 未分组。`);
    if (!ok) return;
    await fetch(`/api/proxy/groups/${group.id}`, { method: 'DELETE' });
    location.reload();
  }

  async function move(id, dir) {
    const idx = localGroups.findIndex((g) => g.id === id);
    const next = [...localGroups];
    const swap = dir === 'up' ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setLocalGroups(next);
    await fetch('/api/proxy/groups/reorder', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: next.map((g) => g.id) }) });
  }

  return (
    <div className="drawerOverlay" onClick={onClose}>
      <div className="modalCard largeModal" onClick={(e) => e.stopPropagation()}>
        <div className="drawerHeader"><div><div className="drawerTitle">分类管理中心</div><div className="drawerSub">新增、重命名、删除、排序分类</div></div><button className="iconButton" type="button" onClick={onClose}>×</button></div>
        <div className="modalBody">
          <div className="inlineForm"><input className="input fullInput" value={name} onChange={(e) => setName(e.target.value)} placeholder="新增分类，例如：新加坡" /><button className="primaryBtn" type="button" onClick={addGroup}>新增分类</button></div>
          <div className="groupList">{localGroups.map((group, idx) => <div key={group.id} className="groupItem"><div><div className="groupTitle">{group.name}</div><div className="small">排序位置：{idx + 1}</div></div><div className="toolbarGroup"><button className="pageBtn" type="button" onClick={() => move(group.id, 'up')}>上移</button><button className="pageBtn" type="button" onClick={() => move(group.id, 'down')}>下移</button><button className="pageBtn" type="button" onClick={() => renameGroup(group)}>重命名</button>{group.name !== '未分组' && <button className="dangerBtn" type="button" onClick={() => deleteGroup(group)}>删除</button>}</div></div>)}</div>
        </div>
      </div>
    </div>
  );
}
