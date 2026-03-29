import { cookies } from 'next/headers';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8080';

function authQuery() {
  const token = cookies().get('dashboard_token')?.value || '';
  return token ? `?token=${encodeURIComponent(token)}` : '';
}

export async function POST(request) {
  const body = await request.text();
  const response = await fetch(`${API_BASE}/api/groups${authQuery()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    cache: 'no-store',
  });
  return new Response(await response.text(), { status: response.status, headers: { 'Content-Type': 'application/json' } });
}
