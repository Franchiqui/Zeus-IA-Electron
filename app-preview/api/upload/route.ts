import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, unlink } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const projectId = formData.get('projectId') as string;
    const projectSource = formData.get('projectSource') as string;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    console.log('[upload] 📤 Subiendo archivo:', {
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      projectId,
      projectSource
    });

    // Validar que sea una imagen
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'File must be an image' }, { status: 400 });
    }

    // Para proyectos locales, usar directorio temporal en el servidor
    const projectRoot = projectId ? `/tmp/PROJECT_LOCAL_${projectId}` : '/tmp/uploads';
    
    // Asegurarse de que el directorio del proyecto exista
    if (!existsSync(projectRoot)) {
      await mkdir(projectRoot, { recursive: true });
    }
    
    // Crear carpeta public/uploads si no existe
    const publicDir = join(projectRoot, 'public');
    if (!existsSync(publicDir)) {
      await mkdir(publicDir, { recursive: true });
    }
    
    const uploadsDir = join(publicDir, 'uploads');
    if (!existsSync(uploadsDir)) {
      await mkdir(uploadsDir, { recursive: true });
    }

    // Generar nombre de archivo único
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 8);
    const fileExtension = file.name.split('.').pop();
    const uniqueFileName = `${timestamp}_${randomString}.${fileExtension}`;
    
    // Guardar el archivo
    const filePath = join(uploadsDir, uniqueFileName);
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    
    await writeFile(filePath, new Uint8Array(buffer));
    
    console.log('[upload] ✅ Archivo guardado:', {
      originalName: file.name,
      uniqueFileName,
      filePath,
      size: buffer.length
    });

    // Construir URL relativa para el cliente
    const relativeUrl = `/uploads/${uniqueFileName}`;
    
    return NextResponse.json({
      success: true,
      data: {
        fileName: uniqueFileName,
        originalName: file.name,
        url: relativeUrl,
        size: file.size,
        type: file.type,
        uploadDate: new Date().toISOString(),
        projectId,
        projectSource
      }
    });

  } catch (error) {
    console.error('[upload] ❌ Error al subir archivo:', error);
    return NextResponse.json({ 
      error: 'Failed to upload file',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const fileName = searchParams.get('fileName');
    const projectId = searchParams.get('projectId');
    const projectSource = searchParams.get('projectSource');

    if (!fileName) {
      return NextResponse.json({ error: 'Missing fileName parameter' }, { status: 400 });
    }

    console.log('[upload] 🗑️ Eliminando archivo:', {
      fileName,
      projectId,
      projectSource
    });

    // Para proyectos locales, usar directorio temporal en el servidor
    const projectRoot = projectId ? `/tmp/PROJECT_LOCAL_${projectId}` : '/tmp/uploads';
    const uploadsDir = join(projectRoot, 'public', 'uploads');
    const filePath = join(uploadsDir, fileName);

    // Verificar si el archivo existe
    if (!existsSync(filePath)) {
      console.warn('[upload] ⚠️ Archivo no encontrado:', filePath);
      return NextResponse.json({ 
        error: 'File not found',
        fileName 
      }, { status: 404 });
    }

    // Eliminar el archivo
    await unlink(filePath);
    
    console.log('[upload] ✅ Archivo eliminado:', filePath);

    return NextResponse.json({
      success: true,
      fileName: fileName,
      message: 'File deleted successfully'
    });

  } catch (error) {
    console.error('[upload] ❌ Error al eliminar archivo:', error);
    return NextResponse.json({ 
      error: 'Failed to delete file',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
