import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8080';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const group = searchParams.get('group') || 'ALL';
  const cookieStore = cookies();
  const token = cookieStore.get('dashboard_token')?.value || '';
  if (!token) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const [serversRes, groupsRes] = await Promise.all([
    fetch(`${API_BASE}/api/servers?group=${encodeURIComponent(group)}&_t=${Date.now()}&token=${encodeURIComponent(token)}`, { cache: 'no-store' }),
    fetch(`${API_BASE}/api/groups?_t=${Date.now()}&token=${encodeURIComponent(token)}`, { cache: 'no-store' }),
  ]);

  if (!serversRes.ok || !groupsRes.ok) {
    return Response.json({ error: 'upstream_failed', serversStatus: serversRes.status, groupsStatus: groupsRes.status }, { status: 500 });
  }

  const [servers, groups] = await Promise.all([serversRes.json(), groupsRes.json()]);
  return Response.json({ servers, groups, now: Date.now() }, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate' },
  });
}
