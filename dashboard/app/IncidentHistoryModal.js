'use client';

import { useEffect, useState } from 'react';

const BAR_COLORS = {
  open_count: '#ef4444',
  remediating_count: '#3b82f6',
  failed_count: '#dc2626',
  resolved_count: '#22c55e',
};
const BAR_LABELS = {
  open_count: 'Open',
  remediating_count: 'Remediating',
  failed_count: 'Failed',
  resolved_count: 'Resolved',
};

export default function IncidentHistoryModal({ open, onClose }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(7);

  useEffect(() => {
    if (!open) return;
    loadStats();
  }, [open, days]);

  async function loadStats() {
    setLoading(true);
    try {
      const res = await fetch(`/api/proxy/incidents/stats?days=${days}`, { cache: 'no-store' });
      const data = await res.json();
      setStats(data);
    } catch {
      setStats(null);
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    window.open('/api/proxy/incidents/export', '_blank');
  }

  if (!open) return null;

  const maxTotal = stats?.days?.length ? Math.max(...stats.days.map(d => d.total), 1) : 1;

  return (
    <div className="drawerOverlay" onClick={onClose}>
      <div className="modalCard largeModal" onClick={e => e.stopPropagation()}>
        <div className="drawerHeader">
          <div>
            <div className="drawerTitle">📊 Incident 历史趋势</div>
            <div className="drawerSub">近 {days} 天 incident 统计</div>
          </div>
          <button className="iconButton" type="button" onClick={onClose}>×</button>
        </div>

        <div className="modalBody">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {[7, 14, 30].map(d => (
              <button key={d} className={`pageBtn compactPageBtn ${days === d ? 'activePageBtn' : ''}`} type="button" onClick={() => setDays(d)}>
                {d} 天
              </button>
            ))}
            <button className="primaryBtn compactPageBtn" type="button" onClick={handleExport}>📥 导出 CSV</button>
            {stats ? <span className="small">总计 {stats.totalIncidents} 条 incident</span> : null}
          </div>

          {loading ? <div className="small" style={{ padding: 20, textAlign: 'center' }}>加载中...</div> : null}

          {!loading && stats?.days?.length ? (
            <>
              <div className="incidentChartWrap">
                <div className="incidentChartLegend">
                  {Object.entries(BAR_LABELS).map(([key, label]) => (
                    <span key={key} className="small" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: BAR_COLORS[key], display: 'inline-block' }} />
                      {label}
                    </span>
                  ))}
                </div>

                <div className="incidentChart">
                  {stats.days.map(day => (
                    <div key={day.day} className="incidentChartCol">
                      <div className="incidentChartBars">
                        {['resolved_count', 'failed_count', 'remediating_count', 'open_count'].map(key => {
                          const val = day[key] || 0;
                          if (!val) return null;
                          const pct = (val / maxTotal) * 100;
                          return (
                            <div key={key} className="incidentChartBar" style={{ height: `${Math.max(pct, 4)}%`, background: BAR_COLORS[key] }} title={`${BAR_LABELS[key]}: ${val}`} />
                          );
                        })}
                      </div>
                      <div className="incidentChartLabel small">{day.day.slice(5)}</div>
                      <div className="incidentChartTotal small">{day.total}</div>
                    </div>
                  ))}
                </div>
              </div>

              {stats.byFault?.length ? (
                <div>
                  <div className="drawerSectionTitle" style={{ marginTop: 16 }}>故障类型分布</div>
                  <div className="incidentFaultGrid">
                    {stats.byFault.map(f => (
                      <div key={f.fault_type} className="incidentFaultItem">
                        <span className="small">{f.fault_type}</span>
                        <strong>{f.count}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {!loading && stats && !stats.days?.length ? (
            <div className="small" style={{ padding: 20, textAlign: 'center' }}>该时间段内暂无 incident 记录</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
