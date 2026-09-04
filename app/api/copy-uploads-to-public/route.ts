import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getBaseDataPath } from '@/lib/env';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const requestedFiles = body.files as string[] | undefined;

    // La ruta del proyecto activo viene del cwd de la sesión activa
    const projectRoot = await getBaseDataPath();
    const publicDir = path.join(projectRoot, 'public');

    // Los archivos subidos se guardan en la raíz de Zeus (uploads) o en userData/uploads en Electron
    const uploadsDir = process.env.ZEUS_UPLOADS_PATH || path.join(process.cwd(), 'uploads');

    console.log('[copy-uploads-to-public] 📂 Proyecto activo (DATA_PATH):', projectRoot);
    console.log('[copy-uploads-to-public] 📁 uploadsDir (Zeus):', uploadsDir);
    console.log('[copy-uploads-to-public] 📁 publicDir (proyecto):', publicDir);

    // Verificar si existe la carpeta uploads
    if (!fs.existsSync(uploadsDir)) {
      console.warn('[copy-uploads-to-public] ⚠️ uploadsDir no existe');
      return NextResponse.json(
        { error: 'No existe la carpeta uploads. Sube imágenes primero.' },
        { status: 404 }
      );
    }

    // Crear la carpeta public del proyecto si no existe
    if (!fs.existsSync(publicDir)) {
      console.log('[copy-uploads-to-public] 🆕 publicDir no existe. Creándola...');
      fs.mkdirSync(publicDir, { recursive: true });
    }

    // Determinar qué archivos copiar
    let filesToCopy: string[];
    if (requestedFiles && Array.isArray(requestedFiles) && requestedFiles.length > 0) {
      filesToCopy = requestedFiles.map(f => path.basename(f)); // Seguridad: solo el nombre del archivo
      console.log('[copy-uploads-to-public] 🎯 Copia selectiva solicitada:', filesToCopy);
    } else {
      // Fallback: leer todos los archivos si no se especifica (comportamiento anterior)
      console.log('[copy-uploads-to-public] ⚠️ No se especificaron archivos, copiando todo el directorio');
      filesToCopy = fs.readdirSync(uploadsDir).filter(file => {
        const filePath = path.join(uploadsDir, file);
        return fs.statSync(filePath).isFile();
      });
    }

    if (filesToCopy.length === 0) {
      return NextResponse.json({ success: true, copied: [], message: 'No hay archivos para copiar.' });
    }

    // Copiar cada archivo al public del proyecto
    const copied: string[] = [];
    const skipped: string[] = [];

    for (const file of filesToCopy) {
      const src = path.join(uploadsDir, file);
      const dest = path.join(publicDir, file);

      if (fs.existsSync(src)) {
        try {
          fs.copyFileSync(src, dest);
          copied.push(file);
        } catch (copyError: any) {
          console.error(`[copy-uploads-to-public] ❌ Error copiando ${file}:`, copyError);
          skipped.push(file);
        }
      } else {
        console.warn(`[copy-uploads-to-public] ⚠️ Archivo no encontrado en uploads: ${file}`);
        skipped.push(file);
      }
    }

    return NextResponse.json({
      success: true,
      copied,
      skipped,
      total: filesToCopy.length
    });
  } catch (error: any) {
    console.error('[copy-uploads-to-public] ❌ Error general:', error);
    return NextResponse.json(
      { error: 'Error al copiar archivos a public', details: error.message },
      { status: 500 }
    );
  }
}
