import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8080';

export async function POST(request, { params }) {
  const token = cookies().get('dashboard_token')?.value || '';
  if (!token) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const id = params.id;
  const res = await fetch(`${API_BASE}/api/incidents/${id}/takeover?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
  });
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
