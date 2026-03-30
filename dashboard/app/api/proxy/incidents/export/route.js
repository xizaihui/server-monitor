import { cookies } from 'next/headers';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8080';

function getToken() {
  return cookies().get('dashboard_token')?.value || '';
}

export async function GET() {
  const token = getToken();
  const qs = token ? `?token=${encodeURIComponent(token)}` : '';
  const response = await fetch(`${API_BASE}/api/incidents/export${qs}`, { cache: 'no-store' });
  return new Response(await response.text(), {
    status: response.status,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename=incidents_export.csv',
    },
  });
}
