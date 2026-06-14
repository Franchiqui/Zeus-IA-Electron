import { NextRequest, NextResponse } from 'next/server';
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import JSZip from 'jszip';

// Marcar como ruta dinámica
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    
    console.log('[download-uploads] 📦 Iniciando descarga de public/uploads...', { projectId });
    
    // Para proyectos locales, usar directorio temporal
    const projectRoot = projectId ? `/tmp/PROJECT_LOCAL_${projectId}` : '/tmp/uploads';
    const uploadsDir = join(projectRoot, 'public', 'uploads');
    
    // Verificar si existe la carpeta
    if (!existsSync(uploadsDir)) {
      console.warn('[download-uploads] ⚠️ Carpeta no existe:', uploadsDir);
      return NextResponse.json({ 
        error: 'Uploads directory not found',
        uploadsDir 
      }, { status: 404 });
    }
    
    // Leer archivos en la carpeta
    const files = await readdir(uploadsDir);
    const imageFiles = files.filter(file => {
      const filePath = join(uploadsDir, file);
      return existsSync(filePath) && file.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i);
    });
    
    console.log('[download-uploads] 📁 Archivos encontrados:', imageFiles.length);
    
    if (imageFiles.length === 0) {
      return NextResponse.json({ 
        error: 'No images found in uploads directory',
        uploadsDir,
        filesFound: 0
      }, { status: 404 });
    }
    
    // Crear ZIP
    const zip = new JSZip();
    
    // Agregar cada archivo al ZIP
    for (const fileName of imageFiles) {
      const filePath = join(uploadsDir, fileName);
      const fileBuffer = await readFile(filePath);
      zip.file(fileName, new Uint8Array(fileBuffer));
      console.log('[download-uploads] 📄 Agregado al ZIP:', fileName);
    }
    
    // Generar el ZIP
    const zipBuffer = await zip.generateAsync({ type: 'uint8array' });
    
    console.log('[download-uploads] ✅ ZIP generado:', {
      totalFiles: imageFiles.length,
      zipSize: zipBuffer.length
    });
    
    // Configurar headers para la descarga
    const headers = new Headers({
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="public-uploads.zip"',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    
    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers
    });
    
  } catch (error) {
    console.error('[download-uploads] ❌ Error al descargar imágenes:', error);
    return NextResponse.json({ 
      error: 'Failed to download uploads',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
