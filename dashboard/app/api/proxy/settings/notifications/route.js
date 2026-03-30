import { cookies } from 'next/headers';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8080';

function getToken() {
  return cookies().get('dashboard_token')?.value || '';
}

function authQuery() {
  const token = getToken();
  return token ? `?token=${encodeURIComponent(token)}` : '';
}

export async function GET() {
  const response = await fetch(`${API_BASE}/api/settings/notifications${authQuery()}`, { cache: 'no-store' });
  return new Response(await response.text(), { status: response.status, headers: { 'Content-Type': 'application/json' } });
}

export async function PATCH(request) {
  const body = await request.text();
  const response = await fetch(`${API_BASE}/api/settings/notifications${authQuery()}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body,
    cache: 'no-store',
  });
  return new Response(await response.text(), { status: response.status, headers: { 'Content-Type': 'application/json' } });
}
