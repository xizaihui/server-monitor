'use client';

import { useState } from 'react';

export default function LoginPage() {
  const [token, setToken] = useState('');

  function login() {
    document.cookie = `dashboard_token=${token}; path=/; max-age=${60 * 60 * 24 * 30}`;
    window.location.href = '/';
  }

  return (
    <div className="loginPage">
      <div className="loginCard refinedLoginCard">
        <div className="loginBadge">Nomo Monitor</div>
        <div className="loginTitle">登录监控台</div>
        <div className="loginDesc">输入访问令牌后进入统一节点控制台</div>
        <div className="modalBody">
          <label className="fieldLabel">访问令牌</label>
          <input className="input fullInput" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="请输入 dashboard token" />
          <button className="primaryBtn loginSubmitBtn" type="button" onClick={login}>进入系统</button>
        </div>
      </div>
    </div>
  );
}
