'use client';

import { useState } from 'react';

export default function BulkMoveModal({ open, groups, count, onClose, onConfirm }) {
  const [group, setGroup] = useState(groups?.[0]?.name || 'Ungrouped');
  if (!open) return null;

  return (
    <div className="drawerOverlay" onClick={onClose}>
      <div className="modalCard" onClick={(e) => e.stopPropagation()}>
        <div className="drawerHeader">
          <div>
            <div className="drawerTitle">批量移动分类</div>
            <div className="drawerSub">已选择 {count} 个节点</div>
          </div>
          <button className="iconButton" type="button" onClick={onClose}>×</button>
        </div>
        <div className="modalBody">
          <label className="fieldLabel">目标分类</label>
          <select className="select fullInput" value={group} onChange={(e) => setGroup(e.target.value)}>
            {groups.map((g) => <option key={g.id} value={g.name}>{g.name}</option>)}
          </select>
          <div className="modalActions">
            <button className="pageBtn" type="button" onClick={onClose}>取消</button>
            <button className="primaryBtn" type="button" onClick={() => onConfirm(group)}>确认移动</button>
          </div>
        </div>
      </div>
    </div>
  );
}
