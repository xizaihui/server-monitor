'use client';

import { useEffect, useState } from 'react';

export default function PackageRepoModal({ open, onClose }) {
  const [catalog, setCatalog] = useState([]);
  const [checksums, setChecksums] = useState({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');

  async function load() {
    setLoading(true);
    const [catalogData, checksumData] = await Promise.all([
      fetch('/api/proxy/packages/catalog', { cache: 'no-store' }).then((r) => r.json()).catch(() => []),
      fetch('/api/proxy/packages/checksums', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
    ]);
    setCatalog(Array.isArray(catalogData) ? catalogData : []);
    setChecksums(checksumData || {});
    setLoading(false);
  }

  useEffect(() => {
    if (!open) return;
    load();
  }, [open]);

  if (!open) return null;

  const checksumMap = {
    xagent: checksums.xagent_zip,
    xbridge: checksums.xbridge_zip,
    xcore: checksums.xcore_zip,
    redis: checksums.redis_script,
    ops: checksums.ops_scripts_zip,
  };

  async function switchStable(name, release) {
    setBusy(`${name}:${release}`);
    await fetch(`/api/proxy/packages/${name}/stable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ release })
    });
    setBusy('');
    load();
  }

  return (
    <div className="drawerOverlay" onClick={onClose}>
      <div className="modalCard largeModal" onClick={(e) => e.stopPropagation()}>
        <div className="drawerHeader">
          <div>
            <div className="drawerTitle">包仓库</div>
            <div className="drawerSub">stable / releases / checksum 总览与切换</div>
          </div>
          <button className="iconButton" type="button" onClick={onClose}>×</button>
        </div>

        <div className="modalBody">
          {loading ? <div className="small">加载中...</div> : null}
          {!loading ? (
            <div className="groupList">
              {catalog.map((item) => {
                const c = checksumMap[item.name];
                return (
                  <div key={item.name} className="groupItem" style={{ alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 0, width: '100%' }}>
                      <div className="groupTitle">{item.name}</div>
                      <div className="small">stable：{item.stable || '-'}</div>
                      <div className="small">md5：{c?.md5 || '-'}</div>
                      <div className="small">sha256：{c?.sha256 || '-'}</div>
                      <div className="small" style={{ marginTop: 8 }}>releases：</div>
                      <div className="toolbarGroup" style={{ marginTop: 6 }}>
                        {(item.releases || []).map((release) => (
                          <button key={release} className={`pageBtn ${item.stable === release ? 'activePageBtn' : ''}`} type="button" onClick={() => switchStable(item.name, release)} disabled={busy === `${item.name}:${release}`}>
                            {busy === `${item.name}:${release}` ? '切换中...' : release}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className="modalActions">
            <button className="pageBtn" type="button" onClick={onClose}>关闭</button>
          </div>
        </div>
      </div>
    </div>
  );
}
