'use client';

import { useEffect, useState } from 'react';

const NOTIFY_OPTIONS = [
  { value: 'open', label: '故障发生 (open)' },
  { value: 'failed', label: '修复失败 (failed)' },
];

export default function NotificationSettingsModal({ open, onClose, onSaved }) {
  const [enabled, setEnabled] = useState(false);
  const [webhookUrls, setWebhookUrls] = useState('');
  const [notifyOn, setNotifyOn] = useState(['open', 'failed']);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError('');
    fetch('/api/proxy/settings/notifications', { cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        setEnabled(!!data.enabled);
        setWebhookUrls(Array.isArray(data.webhook_urls) ? data.webhook_urls.join('\n') : '');
        setNotifyOn(Array.isArray(data.notify_on) ? data.notify_on : ['open', 'failed']);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const urls = webhookUrls.split('\n').map(u => u.trim()).filter(Boolean);
      const res = await fetch('/api/proxy/settings/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, webhook_urls: urls, notify_on: notifyOn }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        onSaved?.();
        onClose?.();
      } else {
        setError(data.error || '保存失败');
      }
    } catch {
      setError('网络错误');
    } finally {
      setSaving(false);
    }
  }

  function toggleNotifyOn(value) {
    setNotifyOn(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]);
  }

  if (!open) return null;

  return (
    <div className="drawerOverlay" onClick={onClose}>
      <div className="modalCard" onClick={e => e.stopPropagation()}>
        <div className="drawerHeader">
          <div>
            <div className="drawerTitle">🔔 通知设置</div>
            <div className="drawerSub">配置 incident webhook 通知</div>
          </div>
          <button className="iconButton" type="button" onClick={onClose}>×</button>
        </div>

        <div className="modalBody">
          {loading ? <div className="small">加载中...</div> : (
            <>
              <label className="fieldLabel" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
                启用 Webhook 通知
              </label>

              <div>
                <label className="fieldLabel">Webhook URLs（每行一个）</label>
                <textarea
                  className="input fullInput"
                  rows={4}
                  value={webhookUrls}
                  onChange={e => setWebhookUrls(e.target.value)}
                  placeholder="https://example.com/webhook&#10;https://hooks.slack.com/..."
                  style={{ resize: 'vertical', minHeight: 80 }}
                />
              </div>

              <div>
                <label className="fieldLabel">通知事件类型</label>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {NOTIFY_OPTIONS.map(opt => (
                    <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      <input type="checkbox" checked={notifyOn.includes(opt.value)} onChange={() => toggleNotifyOn(opt.value)} />
                      <span className="small">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="small" style={{ background: '#f8fafc', border: '1px solid #e4e7ec', borderRadius: 10, padding: '10px 12px', lineHeight: 1.7 }}>
                当 incident 状态变为选中的事件类型时，系统会向所有 webhook URL 发送 POST 请求，payload 包含 incident 详情。
                <br />
                支持 Slack、企业微信、飞书、自定义 webhook 等。
              </div>

              {error ? <div className="small badText">{error}</div> : null}

              <div className="modalActions">
                <button className="pageBtn" type="button" onClick={onClose} disabled={saving}>取消</button>
                <button className="primaryBtn" type="button" onClick={handleSave} disabled={saving}>
                  {saving ? '保存中...' : '保存设置'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
