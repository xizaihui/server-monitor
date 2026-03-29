import { cookies } from 'next/headers';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8080';

export async function POST(request) {
  const token = cookies().get('dashboard_token')?.value || '';
  const form = await request.formData();
  const response = await fetch(`${API_BASE}/api/uploads/packages${token ? `?token=${encodeURIComponent(token)}` : ''}`, {
    method: 'POST',
    body: form,
    cache: 'no-store',
  });

  return new Response(await response.text(), {
    status: response.status,
    headers: { 'Content-Type': 'application/json' }
  });
}
