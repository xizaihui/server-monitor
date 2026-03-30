import GroupFilter from './GroupFilter';
import DashboardClient from './DashboardClient';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

async function getData(group = 'ALL') {
  const base = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8080';
  const cookieStore = cookies();
  const token = cookieStore.get('dashboard_token')?.value || '';
  const headers = token ? { cookie: `dashboard_token=${token}` } : {};
  const [serversRes, groupsRes, rulesRes] = await Promise.all([
    fetch(`${base}/api/servers?group=${encodeURIComponent(group)}`, { cache: 'no-store', headers }),
    fetch(`${base}/api/groups`, { cache: 'no-store', headers }),
    fetch(`${base}/api/settings/monitor-rules`, { cache: 'no-store', headers }),
  ]);
  if (serversRes.status === 401 || groupsRes.status === 401 || rulesRes.status === 401) redirect('/login');
  const [servers, groups, rules] = await Promise.all([serversRes.json(), groupsRes.json(), rulesRes.json()]);
  return { servers, groups, rules };
}

export default async function Page({ searchParams }) {
  const selectedGroup = searchParams?.group || 'ALL';
  const { servers, groups, rules } = await getData(selectedGroup);

  return (
    <div className="page">
      <main className="content">
        <section className="hero">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h2 className="heroTitle">Nomo 节点控制台</h2>
            <GroupFilter groups={groups} />
          </div>
          <div className="heroMeta">
            <span className="liveDot"></span>
            <span className="small">自动刷新 10s</span>
          </div>
        </section>

        <DashboardClient servers={servers} groups={groups} selectedGroup={selectedGroup} initialRules={rules} />
      </main>
    </div>
  );
}
