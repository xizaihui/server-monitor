import { cookies } from 'next/headers';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8080';

export async function GET() {
  const token = cookies().get('dashboard_token')?.value || '';
  const response = await fetch(`${API_BASE}/api/packages/checksums${token ? `?token=${encodeURIComponent(token)}` : ''}`, {
    cache: 'no-store',
  });
  return new Response(await response.text(), {
    status: response.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
