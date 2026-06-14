import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { existsSync, readdir } from 'fs';
import { readFile } from 'fs/promises';
import JSZip from 'jszip';

// Marcar como ruta dinámica
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    const selectedImagesParam = searchParams.get('selectedImages');
    
    console.log('[download-selected-uploads] 📦 Iniciando descarga selectiva de imágenes...', { 
      projectId,
      hasSelectedImages: !!selectedImagesParam
    });
    
    // Parsear imágenes seleccionadas
    let selectedImages = [];
    if (selectedImagesParam) {
      try {
        selectedImages = JSON.parse(decodeURIComponent(selectedImagesParam));
        console.log('[download-selected-uploads] 🖼️ Imágenes seleccionadas recibidas:', selectedImages.length);
      } catch (parseError) {
        console.error('[download-selected-uploads] ❌ Error parseando imágenes seleccionadas:', parseError);
        return NextResponse.json({ 
          error: 'Invalid selectedImages parameter' 
        }, { status: 400 });
      }
    }
    
    if (selectedImages.length === 0) {
      return NextResponse.json({ 
        error: 'No images selected for download',
        selectedImagesCount: 0
      }, { status: 400 });
    }
    
    // Para proyectos locales, usar directorio temporal
    const projectRoot = projectId ? `/tmp/PROJECT_LOCAL_${projectId}` : '/tmp/uploads';
    const uploadsDir = join(projectRoot, 'public', 'uploads');
    
    // Verificar si existe la carpeta
    if (!existsSync(uploadsDir)) {
      console.warn('[download-selected-uploads] ⚠️ Carpeta no existe:', uploadsDir);
      return NextResponse.json({ 
        error: 'Uploads directory not found',
        uploadsDir 
      }, { status: 404 });
    }
    
    console.log('[download-selected-uploads] 📁 Directorio de uploads:', uploadsDir);
    console.log('[download-selected-uploads] 🖼️ Imágenes a descargar:', selectedImages.map((img: { name: any; }) => img.name));
    
    // Verificar que los archivos seleccionados existen
    const existingFiles = [];
    for (const image of selectedImages) {
      const filePath = join(uploadsDir, image.name);
      if (existsSync(filePath)) {
        existingFiles.push({
          name: image.name,
          path: filePath
        });
        console.log('[download-selected-uploads] ✅ Archivo encontrado:', image.name);
      } else {
        console.warn('[download-selected-uploads] ⚠️ Archivo no encontrado:', image.name);
      }
    }
    
    if (existingFiles.length === 0) {
      return NextResponse.json({ 
        error: 'None of the selected images were found in uploads directory',
        selectedImages: selectedImages.length,
        foundImages: 0
      }, { status: 404 });
    }
    
    // Crear ZIP con estructura de carpetas public/uploads
    const zip = new JSZip();
    
    // Crear la estructura de carpetas
    const publicFolder = zip.folder('public')!;
    const uploadsFolder = publicFolder.folder('uploads')!;
    
    // Agregar cada archivo seleccionado dentro de public/uploads/
    for (const file of existingFiles) {
      try {
        const fileBuffer = await readFile(file.path);
        uploadsFolder.file(file.name, new Uint8Array(fileBuffer));
        console.log('[download-selected-uploads] 📄 Agregado al ZIP en public/uploads/:', file.name);
      } catch (readError) {
        console.error('[download-selected-uploads] ❌ Error leyendo archivo:', file.name, readError);
      }
    }
    
    // Generar el ZIP
    const zipBuffer = await zip.generateAsync({ type: 'uint8array' });
    
    console.log('[download-selected-uploads] ✅ ZIP generado:', {
      totalFiles: existingFiles.length,
      zipSize: zipBuffer.length
    });
    
    // Configurar headers para la descarga
    const headers = new Headers({
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="selected-images.zip"',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    
    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers
    });
    
  } catch (error) {
    console.error('[download-selected-uploads] ❌ Error al descargar imágenes seleccionadas:', error);
    return NextResponse.json({ 
      error: 'Failed to download selected uploads',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}