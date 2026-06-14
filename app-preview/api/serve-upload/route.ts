import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const fileName = searchParams.get('fileName');
    const projectId = searchParams.get('projectId');
    
    if (!fileName) {
      return NextResponse.json({ error: 'Missing fileName parameter' }, { status: 400 });
    }

    console.log('[serve-upload] 🖼️ Sirviendo imagen:', { fileName, projectId });
    
    // Para proyectos locales, usar directorio temporal
    const projectRoot = projectId ? `/tmp/PROJECT_LOCAL_${projectId}` : '/tmp/uploads';
    const uploadsDir = join(projectRoot, 'public', 'uploads');
    const filePath = join(uploadsDir, fileName);
    
    // Verificar si el archivo existe
    if (!existsSync(filePath)) {
      console.warn('[serve-upload] ⚠️ Archivo no encontrado:', filePath);
      return NextResponse.json({ 
        error: 'File not found',
        fileName,
        filePath
      }, { status: 404 });
    }
    
    // Leer el archivo
    const fileBuffer = await readFile(filePath);
    
    // Determinar el tipo de contenido basado en la extensión
    const ext = fileName.split('.').pop()?.toLowerCase();
    let contentType = 'application/octet-stream';
    
    switch (ext) {
      case 'jpg':
      case 'jpeg':
        contentType = 'image/jpeg';
        break;
      case 'png':
        contentType = 'image/png';
        break;
      case 'gif':
        contentType = 'image/gif';
        break;
      case 'webp':
        contentType = 'image/webp';
        break;
      case 'svg':
        contentType = 'image/svg+xml';
        break;
      default:
        contentType = 'application/octet-stream';
    }
    
    console.log('[serve-upload] ✅ Imagen servida:', {
      fileName,
      contentType,
      size: fileBuffer.length
    });
    
    // Configurar headers para caché y tipo de contenido
    const headers = new Headers({
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000', // 1 año
      'ETag': `"${fileName}-${fileBuffer.length}"`,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    
    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers
    });
    
  } catch (error) {
    console.error('[serve-upload] ❌ Error al servir imagen:', error);
    return NextResponse.json({ 
      error: 'Failed to serve image',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}

export async function OPTIONS(request: NextRequest) {
  // Manejar solicitudes CORS preflight
  const headers = new Headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  });
  
  return new NextResponse(null, { status: 200, headers });
}
