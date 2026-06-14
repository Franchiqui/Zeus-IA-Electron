import { NextResponse } from 'next/server';

const SERVER_BASE = process.env.ZEUS_SERVER_URL || 'http://localhost:8742';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const project = searchParams.get('project');

    const backendUrl = new URL(`${SERVER_BASE}/api/download-apk`);
    if (project) backendUrl.searchParams.set('project', project);

    const res = await fetch(backendUrl.toString(), {
      method: 'GET',
    });

    if (!res.ok) {
      const text = await res.text().catch(() => 'Error desconocido');
      return NextResponse.json(
        { error: `Error del servidor de descarga: ${res.status}`, details: text },
        { status: res.status }
      );
    }

    const contentType = res.headers.get('content-type') || 'application/octet-stream';
    const contentDisposition = res.headers.get('content-disposition');

    const headers: Record<string, string> = {
      'Content-Type': contentType,
    };
    if (contentDisposition) {
      headers['Content-Disposition'] = contentDisposition;
    }

    const arrayBuffer = await res.arrayBuffer();
    return new NextResponse(arrayBuffer, { status: 200, headers });
  } catch (err: any) {
    console.error('[download-apk proxy] Error:', err);
    return NextResponse.json(
      { error: err.message || 'Error de red al contactar el servidor de descarga' },
      { status: 500 }
    );
  }
}
