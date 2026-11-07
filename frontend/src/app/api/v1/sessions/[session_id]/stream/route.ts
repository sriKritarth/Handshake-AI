import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ session_id: string }> }
) {
  const { session_id } = await params;
  const token = request.nextUrl.searchParams.get('token') || request.headers.get('authorization')?.replace('Bearer ', '');

  if (!session_id) {
    return new NextResponse('Session ID is required', { status: 400 });
  }

  const backendBase = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
  const cleanBase = backendBase.replace(/\/+$/, '');
  const targetUrl = `${cleanBase}/api/v1/sessions/${encodeURIComponent(session_id)}/stream`;

  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token.trim()}`;
  }

  try {
    const upstreamRes = await fetch(targetUrl, {
      method: 'GET',
      headers,
      signal: request.signal,
    });

    if (!upstreamRes.ok || !upstreamRes.body) {
      return new NextResponse(upstreamRes.statusText || 'Upstream error', {
        status: upstreamRes.status,
      });
    }

    return new NextResponse(upstreamRes.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err: any) {
    if (request.signal.aborted) {
      return new NextResponse(null, { status: 499 });
    }
    return new NextResponse(err?.message || 'Failed to connect to negotiation stream', {
      status: 502,
    });
  }
}
