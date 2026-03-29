'use client';

import { useState } from 'react';

export default function PackageUploadModal({ open, onClose, onUploaded }) {
  const [folder, setFolder] = useState('packages/xagent');
  const [file, setFile] = useState(null);
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
            <div className="drawerSub">上传后直接走本机文件服务地址</div>
          </div>
          <button className="iconButton" type="button" onClick={onClose}>×</button>
        </div>

        <div className="modalBody">
          <label className="fieldLabel">上传目录</label>
          <select className="select fullInput" value={folder} onChange={(e) => setFolder(e.target.value)}>
            <option value="packages/agents">agents</option>
            <option value="packages/xagent">xagent</option>
            <option value="packages/xbridge">xbridge</option>
            <option value="packages/xcore">xcore</option>
            <option value="packages/redis">redis</option>
          </select>

          <label className="fieldLabel">文件</label>
          <input className="input fullInput" type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />

          <div className="small" style={{ background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: 12, padding: '10px 12px' }}>
            默认发布目录：/downloads/{folder}/文件名
            <br />
            如果同名文件已存在，系统会先备份到 /downloads/backups/... 再覆盖，方便你回滚。
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
