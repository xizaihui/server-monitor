import { cookies } from 'next/headers';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8080';

export async function GET(request, { params }) {
  const token = cookies().get('dashboard_token')?.value || '';
  const url = new URL(`${API_BASE}/api/actions/tasks/${params.taskId}`);
  if (token) url.searchParams.set('token', token);

  const response = await fetch(url.toString(), {
    cache: 'no-store',
  });

  return new Response(await response.text(), {
    status: response.status,
    headers: { 'Content-Type': 'application/json' }
  });
}
