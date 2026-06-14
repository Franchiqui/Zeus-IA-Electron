import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Proxy endpoint para obtener la URL del túnel desde zeus-ia.com
// Esto evita problemas de CORS al hacer la petición desde el mismo dominio
export async function GET(req: NextRequest) {
  try {
    // Obtener el token de autorización del header
    const authHeader = req.headers.get('Authorization');
    
    if (!authHeader) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    // Hacer la petición a zeus-ia.com desde el servidor (sin problemas de CORS)
    const zeusApiUrl = 'https://zeus-ia.com/api/preview-viewer/tunnel-url';
    
    console.log('[Proxy] Obteniendo URL del túnel desde:', zeusApiUrl);
    
    const response = await fetch(zeusApiUrl, {
      method: 'GET',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      cache: 'no-store'
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Proxy] Error en respuesta:', response.status, errorText);
      return NextResponse.json(
        { error: 'Error al obtener URL del túnel', details: errorText },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log('[Proxy] Datos recibidos:', data);
    
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('[Proxy] Error al obtener URL del túnel:', error);
    return NextResponse.json(
      { error: 'Error al obtener URL del túnel', details: error.message },
      { status: 500 }
    );
  }
}

// Proxy para POST también
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('Authorization');
    const body = await req.json();
    
    if (!authHeader) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const zeusApiUrl = 'https://zeus-ia.com/api/preview-viewer/tunnel-url';
    
    console.log('[Proxy] Guardando URL del túnel en:', zeusApiUrl);
    
    const response = await fetch(zeusApiUrl, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      cache: 'no-store'
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Proxy] Error en respuesta:', response.status, errorText);
      return NextResponse.json(
        { error: 'Error al guardar URL del túnel', details: errorText },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log('[Proxy] Datos recibidos:', data);
    
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('[Proxy] Error al guardar URL del túnel:', error);
    return NextResponse.json(
      { error: 'Error al guardar URL del túnel', details: error.message },
      { status: 500 }
    );
  }
}

