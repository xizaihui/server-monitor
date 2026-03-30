import { cookies } from 'next/headers';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8080';

function getToken() {
  return cookies().get('dashboard_token')?.value || '';
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const qs = new URLSearchParams(searchParams);
  const token = getToken();
  if (token) qs.set('token', token);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const response = await fetch(`${API_BASE}/api/incidents${suffix}`, { cache: 'no-store' });
  return new Response(await response.text(), { status: response.status, headers: { 'Content-Type': 'application/json' } });
}
