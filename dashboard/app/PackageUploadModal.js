'use client';

import { useState } from 'react';

export default function PackageUploadModal({ open, onClose, onUploaded }) {
  const [folder, setFolder] = useState('packages/xagent');
  const [file, setFile] = useState(null);
  const [release, setRelease] = useState('');
  const [publishStable, setPublishStable] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  async function submit() {
    if (!file) {
      setError('请选择文件');
      return;
    }
    setUploading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('folder', folder);
      form.append('release', release);
      form.append('publish_stable', publishStable ? '1' : '0');
      const res = await fetch('/api/proxy/uploads/packages', {
        method: 'POST',
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || '上传失败');
        setUploading(false);
        return;
      }
      onUploaded?.(data);
      onClose?.();
    } catch {
      setError('上传失败，请稍后重试');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="drawerOverlay" onClick={onClose}>
      <div className="modalCard" onClick={(e) => e.stopPropagation()}>
        <div className="drawerHeader">
          <div>
            <div className="drawerTitle">上传安装包 / 更新包</div>
            <div className="drawerSub">上传为 release，可选直接发布为 stable</div>
          </div>
          <button className="iconButton" type="button" onClick={onClose}>×</button>
        </div>

        <div className="modalBody">
          <label className="fieldLabel">上传目录</label>
          <select className="select fullInput" value={folder} onChange={(e) => setFolder(e.target.value)}>
            <option value="packages/xagent">xagent</option>
            <option value="packages/xbridge">xbridge</option>
            <option value="packages/xray">xray</option>
            <option value="packages/singbox">singbox</option>
            <option value="packages/xassets">xassets (geoip/geosite)</option>
          </select>

          <label className="fieldLabel">release 名称（可选）</label>
          <input className="input fullInput" value={release} onChange={(e) => setRelease(e.target.value)} placeholder="例如 2026.03.29-2，不填则自动生成" />

          <label className="fieldLabel">文件</label>
          <input className="input fullInput" type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />

          <label className="fieldLabel" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={publishStable} onChange={(e) => setPublishStable(e.target.checked)} />
            上传后直接切为 stable
          </label>

          <div className="small" style={{ background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: 12, padding: '10px 12px' }}>
            上传会先生成 release 包，再同步覆盖当前目录；如果勾选，会自动切为 stable。
          </div>

          {error ? <div className="small" style={{ color: '#b42318' }}>{error}</div> : null}

          <div className="modalActions">
            <button className="pageBtn" type="button" onClick={onClose} disabled={uploading}>取消</button>
            <button className="primaryBtn" type="button" onClick={submit} disabled={uploading}>{uploading ? '上传中...' : '上传'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
