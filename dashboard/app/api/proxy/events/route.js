export const dynamic = 'force-dynamic';
export const revalidate = 0;

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8080';

export async function GET(request) {
  const cookie = request.headers.get('cookie') || '';
  const upstream = await fetch(`${API_BASE}/api/events`, {
    headers: cookie ? { cookie } : {},
    cache: 'no-store',
  });
  if (!upstream.ok || !upstream.body) {
    return new Response('upstream failed', { status: 502 });
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
