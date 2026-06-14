import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';

function getUploadsDir(): string {
  if (process.env.ZEUS_UPLOADS_PATH) {
    return process.env.ZEUS_UPLOADS_PATH;
  }
  return path.join(process.cwd(), 'uploads');
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No se proporcionó archivo' }, { status: 400 });
    }

    // Validar que sea imagen
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'El archivo no es una imagen' }, { status: 400 });
    }

    // Directorio de uploads: Electron empaquetado usa userData/uploads; dev usa cwd/uploads
    const uploadsDir = getUploadsDir();
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    console.log('[upload-image] Uploads dir:', uploadsDir);

    // Generar nombre único
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileName = `${timestamp}-${safeName}`;
    const destPath = path.join(uploadsDir, fileName);

    // Guardar archivo
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(destPath, buffer);

    console.log(`[upload-image] SUCCESS: ${fileName} saved to ${destPath}`);

    return NextResponse.json({
      success: true,
      data: {
        fileName,
        originalName: file.name,
        url: `/api/serve-upload?fileName=${encodeURIComponent(fileName)}`,
        size: file.size,
        mimetype: file.type
      }
    });
  } catch (error: any) {
    console.error('[upload-image] ERROR:', error);
    return NextResponse.json(
      { error: 'Error al guardar la imagen', details: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const fileName = searchParams.get('fileName');

    if (!fileName) {
      return NextResponse.json({ error: 'Nombre de archivo no proporcionado' }, { status: 400 });
    }

    // Evitar ataques de path traversal
    const safeFileName = path.basename(fileName);
    const uploadsDir = getUploadsDir();
    const filePath = path.join(uploadsDir, safeFileName);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[upload-image] DELETED: ${filePath}`);
      return NextResponse.json({ success: true, message: 'Archivo eliminado correctamente' });
    } else {
      console.warn(`[upload-image] NOT FOUND: ${filePath}`);
      return NextResponse.json({ error: 'Archivo no encontrado' }, { status: 404 });
    }
  } catch (error: any) {
    console.error('[upload-image] DELETE ERROR:', error);
    return NextResponse.json(
      { error: 'Error al eliminar el archivo', details: error.message },
      { status: 500 }
    );
  }
}
