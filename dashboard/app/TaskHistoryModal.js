'use client';

import { useEffect, useState } from 'react';

export default function TaskHistoryModal({ open, server, onClose }) {
  const [items, setItems] = useState([]);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !server) return;
    setLoading(true);
    fetch(`/api/proxy/actions/tasks?server_id=${encodeURIComponent(server.server_id)}&limit=10`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => setItems(Array.isArray(data) ? data : []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [open, server]);

  async function loadDetail(taskId) {
    try {
      const res = await fetch(`/api/proxy/actions/tasks/${taskId}`, { cache: 'no-store' });
      const data = await res.json().catch(() => null);
      setDetail(data);
    } catch {
      setDetail(null);
    }
  }

  if (!open || !server) return null;

  return (
    <div className="drawerOverlay" onClick={onClose}>
      <div className="modalCard largeModal" onClick={(e) => e.stopPropagation()}>
        <div className="drawerHeader">
          <div>
            <div className="drawerTitle">任务历史</div>
            <div className="drawerSub">{server.ip || server.server_id}</div>
          </div>
          <button className="iconButton" type="button" onClick={onClose}>×</button>
        </div>

        <div className="modalBody">
          {loading ? <div className="small">加载中...</div> : null}
          {!loading && items.length === 0 ? <div className="small">暂无任务记录</div> : null}

          {items.length > 0 ? (
            <div className="groupList">
              {items.map((item) => (
                <div key={item.task_id} className="groupItem">
                  <div>
                    <div className="groupTitle">{item.action_key}</div>
                    <div className="small">状态：{item.status} · 时间：{item.created_at}</div>
                    {item.result_summary ? <div className="small">结果：{item.result_summary}</div> : null}
                    {item.result_code ? <div className="small">代码：{item.result_code}</div> : null}
                  </div>
                  <div className="toolbarGroup">
                    <button className="pageBtn" type="button" onClick={() => loadDetail(item.task_id)}>详情</button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {detail ? (
            <div className="drawerSection">
              <div className="drawerSectionTitle">任务详情</div>
              <div className="drawerList">
                <div className="drawerRow"><span>task_id</span><strong>{detail.task_id}</strong></div>
                <div className="drawerRow"><span>动作</span><strong>{detail.action_key}</strong></div>
                <div className="drawerRow"><span>状态</span><strong>{detail.status}</strong></div>
                <div className="drawerRow"><span>exit_code</span><strong>{String(detail.exit_code ?? '-')}</strong></div>
                <div className="drawerRow"><span>result_code</span><strong>{detail.result_code || '-'}</strong></div>
                <div className="drawerRow"><span>摘要</span><strong>{detail.result_summary || '-'}</strong></div>
                <div className="drawerRow"><span>错误</span><strong>{detail.error_message || '-'}</strong></div>
              </div>

              <div style={{ marginTop: 12 }}>
                <div className="fieldLabel">参数</div>
                <pre className="small" style={{ whiteSpace: 'pre-wrap' }}>{detail.params_json || '{}'}</pre>
              </div>

              <div style={{ marginTop: 12 }}>
                <div className="fieldLabel">日志</div>
                <pre className="small" style={{ whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto' }}>{detail.log_excerpt || '(无日志)'}</pre>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
