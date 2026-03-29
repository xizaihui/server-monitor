'use client';

function formatShanghai(input) {
  if (!input) return '-';
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return input;
  const f = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d);
  const get = (t) => f.find((x) => x.type === t)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}
function formatDuration(seconds) { if (seconds == null) return '-'; const s = Number(seconds || 0); const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600); const m = Math.floor((s % 3600) / 60); if (d > 0) return `${d}天 ${h}小时 ${m}分`; if (h > 0) return `${h}小时 ${m}分`; return `${m}分`; }
function CopyRow({ label, value, onCopy }) { return <div className="drawerRow"><span>{label}</span><strong className="copyValueWrap"><span>{value || '-'}</span>{value ? <button type="button" className="miniCopyBtn" onClick={() => onCopy(value)}>复制</button> : null}</strong></div>; }

export default function NodeDrawer({ server, onClose, onCopy }) {
  if (!server) return null;
  const ports = [['443 / 内核', server.port_443], ['6379 / Redis', server.port_6379], ['8888 / XAgent', server.port_8888], ['8789 / XBridge', server.port_8789]];
  return (
    <div className="drawerOverlay" onClick={onClose}>
      <aside className="drawerPanel" onClick={(e) => e.stopPropagation()}>
        <div className="drawerHeader"><div><div className="drawerTitle">节点详情</div><div className="drawerSub">{server.ip || '-'}</div></div><button className="iconButton" type="button" onClick={onClose}>×</button></div>
        <div className="drawerSection"><div className="drawerSectionTitle">基本信息</div><div className="drawerList"><CopyRow label="IP" value={server.ip} onCopy={onCopy} /><CopyRow label="节点名" value={server.display_name || server.hostname} onCopy={onCopy} /><CopyRow label="Server ID" value={server.server_id} onCopy={onCopy} /><CopyRow label="业务 server-id" value={server.instance_id} onCopy={onCopy} /><div className="drawerRow"><span>分类</span><strong>{server.group_name || '未分组'}</strong></div><div className="drawerRow"><span>状态</span><strong>{server.status}</strong></div><div className="drawerRow"><span>Agent 版本</span><strong>{server.metadata?.agent_version || '-'}</strong></div><div className="drawerRow"><span>系统 / 架构</span><strong>{server.os || '-'} / {server.arch || '-'}</strong></div><div className="drawerRow"><span>最后心跳</span><strong>{formatShanghai(server.last_seen)}</strong></div><div className="drawerRow"><span>离线时长</span><strong>{server.status === 'offline' ? formatDuration(server.offline_seconds) : '-'}</strong></div><div className="drawerRow"><span>创建时间</span><strong>{formatShanghai(server.created_at)}</strong></div><div className="drawerRow"><span>更新时间</span><strong>{formatShanghai(server.updated_at)}</strong></div></div></div>
        <div className="drawerSection"><div className="drawerSectionTitle">资源指标</div><div className="drawerList"><div className="drawerRow"><span>CPU</span><strong>{server.status === 'offline' ? '-' : `${Number(server.cpu_usage || 0).toFixed(1)}%`}</strong></div><div className="drawerRow"><span>内存</span><strong>{server.status === 'offline' ? '-' : `${Number(server.memory_usage || 0).toFixed(1)}%`}</strong></div><div className="drawerRow"><span>磁盘</span><strong>{server.status === 'offline' ? '-' : `${Number(server.disk_usage || 0).toFixed(1)}%`}</strong></div></div></div>
        <div className="drawerSection"><div className="drawerSectionTitle">端口状态</div><div className="drawerList">{ports.map(([label, ok]) => <div className="drawerRow" key={label}><span>{label}</span><strong className={server.status === 'offline' ? '' : ok ? 'okText' : 'badText'}>{server.status === 'offline' ? '-' : ok ? 'UP' : 'DOWN'}</strong></div>)}</div></div>
      </aside>
    </div>
  );
}
