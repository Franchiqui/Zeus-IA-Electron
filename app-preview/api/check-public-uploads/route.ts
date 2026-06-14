import { NextRequest, NextResponse } from 'next/server';
import { existsSync } from 'fs';

// Marcar como ruta dinámica
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    
    // Para proyectos locales, verificar directorio temporal
    const projectRoot = projectId ? `/tmp/PROJECT_LOCAL_${projectId}` : '/tmp/uploads';
    const uploadsDir = `${projectRoot}/public/uploads`;
    
    const exists = existsSync(uploadsDir);
    
    console.log('[check-public-uploads] 📁 Verificando carpeta:', {
      uploadsDir,
      exists,
      projectId
    });
    
    return NextResponse.json({
      exists: exists,
      uploadsDir: uploadsDir,
      projectId: projectId
    });

  } catch (error) {
    console.error('[check-public-uploads] ❌ Error al verificar carpeta:', error);
    return NextResponse.json({ 
      error: 'Failed to check uploads directory',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
