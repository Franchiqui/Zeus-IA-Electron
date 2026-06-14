import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Proxy endpoint para notificar al servidor de vista previa que refresque el proyecto desde PocketBase
// Esto evita problemas de CORS al hacer la petición desde el servidor
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId, userToken } = body;

    if (!projectId) {
      return NextResponse.json({ error: 'projectId es requerido' }, { status: 400 });
    }

    // Obtener la URL del servidor de vista previa
    const previewServerUrl = body.previewServerUrl || 'http://localhost:3030';
    
    console.log('[Proxy Refresh] 📡 Notificando al servidor de vista previa:', previewServerUrl);
    console.log('[Proxy Refresh] 🔍 projectId:', projectId);
    console.log('[Proxy Refresh] 🔍 Body completo:', body);
    console.log('[Proxy Refresh] 🔍 NODE_ENV:', process.env.NODE_ENV);
    console.log('[Proxy Refresh] 🔗 URL del túnel en body:', body.previewServerUrl);
    
    // Si la URL es localhost y estamos en producción, no podemos acceder desde el servidor
    // En este caso, devolver un error informativo
    if (previewServerUrl.includes('localhost') && process.env.NODE_ENV === 'production') {
      console.warn('[Proxy Refresh] ⚠️ No se puede acceder a localhost desde el servidor de producción');
      return NextResponse.json(
        { 
          error: 'No se puede acceder al servidor de vista previa local desde producción',
          hint: 'El servidor de vista previa debe estar accesible públicamente o a través de un túnel'
        },
        { status: 400 }
      );
    }
    
    // Llamar al endpoint de refresco del servidor de vista previa
    let refreshUrl;
    
    if (previewServerUrl === 'http://localhost:3030') {
      // Usar comunicación directa con zeus-ia.com
      refreshUrl = 'http://localhost:3030';
      console.log('[Proxy Refresh] 🔗 Usando comunicación directa con zeus-ia.com');
    } else {
      // Usar URL directa del servidor de vista previa (túnel o localhost)
      refreshUrl = `${previewServerUrl}/api/refresh-project-from-pocketbase`;
      console.log('[Proxy Refresh] 🔗 Usando URL directa del servidor de vista previa');
    }
    
    console.log('[Proxy Refresh] 🔗 URL completa:', refreshUrl);
    
    const response = await fetch(refreshUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(userToken ? { 'Authorization': `Bearer ${userToken}` } : {})
      },
      body: JSON.stringify({
        projectId: projectId,
        userToken: userToken || null
      }),
      cache: 'no-store',
      // Aumentar timeout para peticiones que pueden tardar
      signal: AbortSignal.timeout(60000) // 60 segundos
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Proxy Refresh] ❌ Error en respuesta:', response.status, errorText);
      return NextResponse.json(
        { 
          error: 'Error al notificar al servidor de vista previa', 
          details: errorText,
          status: response.status
        },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log('[Proxy Refresh] ✅ Respuesta del servidor de vista previa:', data);
    
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('[Proxy Refresh] ❌ Error al notificar al servidor de vista previa:', error);
    return NextResponse.json(
      { 
        error: 'Error al notificar al servidor de vista previa', 
        details: error.message 
      },
      { status: 500 }
    );
  }
}

