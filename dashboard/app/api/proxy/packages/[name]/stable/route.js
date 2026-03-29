import { cookies } from 'next/headers';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8080';

export async function POST(request, { params }) {
  const token = cookies().get('dashboard_token')?.value || '';
  const body = await request.text();
  const response = await fetch(`${API_BASE}/api/packages/${params.name}/stable${token ? `?token=${encodeURIComponent(token)}` : ''}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    cache: 'no-store',
  });
  return new Response(await response.text(), {
    status: response.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
