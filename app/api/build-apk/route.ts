import { NextResponse } from 'next/server';

const SERVER_BASE = process.env.ZEUS_SERVER_URL || 'http://localhost:8742';

export async function POST(request: Request) {
  try {
    const body = await request.text();
    const res = await fetch(`${SERVER_BASE}/api/build-apk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: body || undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => 'Error desconocido');
      return NextResponse.json(
        { error: `Error del servidor de build: ${res.status}`, details: text },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    console.error('[build-apk proxy] Error:', err);
    return NextResponse.json(
      { error: err.message || 'Error de red al contactar el servidor de build' },
      { status: 500 }
    );
  }
}
