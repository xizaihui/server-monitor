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
    <div className="page compactPage">
      <main className="content compactContent">
        <section className="hero compactHero crispHero refinedHero">
          <div>
            <h2 className="heroTitle compactHeroTitle">Nomo 节点监控</h2>
            <div className="heroSubtitle">轻量、稳定、紧凑的节点状态面板</div>
          </div>
          <div className="heroMeta compactHeroMeta">
            <GroupFilter groups={groups} />
          </div>
        </section>

        <DashboardClient servers={servers} groups={groups} selectedGroup={selectedGroup} initialRules={rules} />
      </main>
    </div>
  );
}
