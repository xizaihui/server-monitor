import { cookies } from 'next/headers';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8080';

function getToken() {
  return cookies().get('dashboard_token')?.value || '';
}

function authQuery() {
  const token = getToken();
  return token ? `?token=${encodeURIComponent(token)}` : '';
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const qs = new URLSearchParams(searchParams);
  const token = getToken();
  if (token) qs.set('token', token);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const response = await fetch(`${API_BASE}/api/actions/tasks${suffix}`, { cache: 'no-store' });
  return new Response(await response.text(), { status: response.status, headers: { 'Content-Type': 'application/json' } });
}

export async function POST(request) {
  const body = await request.text();
  const response = await fetch(`${API_BASE}/api/actions/tasks${authQuery()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    cache: 'no-store',
  });
  return new Response(await response.text(), { status: response.status, headers: { 'Content-Type': 'application/json' } });
}
