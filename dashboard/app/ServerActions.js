'use client';

export default function ServerActions({ server, compact = false, onEdit, onDelete, onTaskHistory }) {
  return (
    <div className="menuWrap actionButtonGroup">
      {onTaskHistory ? <button className={`pageBtn ${compact ? 'compactPageBtn' : ''}`} type="button" onClick={() => onTaskHistory?.(server)} title="任务历史">历史</button> : null}
      <button className={`iconButton subtleAction ${compact ? 'compactIconButton' : ''}`} type="button" onClick={() => onEdit?.(server)} aria-label="编辑节点" title="编辑节点">
        <svg viewBox="0 0 24 24" className="actionIcon" aria-hidden="true">
          <path d="M4 20h4l10-10-4-4L4 16v4zm12.7-13.3 1.6-1.6a1 1 0 0 1 1.4 0l1.2 1.2a1 1 0 0 1 0 1.4L19.3 9l-2.6-2.3z" fill="currentColor"/>
        </svg>
      </button>
      <button className={`iconButton dangerAction ${compact ? 'compactIconButton' : ''}`} type="button" onClick={() => onDelete?.(server)} aria-label="删除节点" title="删除节点">
        <svg viewBox="0 0 24 24" className="actionIcon" aria-hidden="true">
          <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v8h-2V9zm4 0h2v8h-2V9zM7 9h2v8H7V9zm1 12a2 2 0 0 1-2-2V8h12v11a2 2 0 0 1-2 2H8z" fill="currentColor"/>
        </svg>
      </button>
    </div>
  );
}
