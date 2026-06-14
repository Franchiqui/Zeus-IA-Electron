import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import fsSync from 'fs';
import { readDataPathFromEnv } from '@/lib/env';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { filePath, content, encoding, skipBackup } = body;

    console.log('[save-file] Request recibida:', { filePath, contentLength: content?.length, skipBackup });

    if (!filePath || typeof filePath !== 'string') {
      return NextResponse.json(
        { error: 'filePath es requerido' },
        { status: 400 }
      );
    }

    if (content === undefined) {
      return NextResponse.json(
        { error: 'content es requerido' },
        { status: 400 }
      );
    }

    // Leer DATA_PATH
    const dataPath = readDataPathFromEnv() || process.env.DATA_PATH;
    console.log('[save-file] DATA_PATH leído:', dataPath);
    if (!dataPath) {
      return NextResponse.json(
        { error: 'DATA_PATH no configurado' },
        { status: 500 }
      );
    }

    const baseDataPath = path.normalize(
      path.isAbsolute(dataPath) ? dataPath : path.resolve(process.cwd(), dataPath)
    );
    console.log('[save-file] baseDataPath:', baseDataPath);

    let targetPath: string;
    const normalizedFilePath = path.normalize(filePath);

    if (path.isAbsolute(normalizedFilePath)) {
      // Si es una ruta absoluta, verificar que esté dentro de DATA_PATH
      targetPath = path.resolve(normalizedFilePath);
      console.log('[save-file] Ruta absoluta recibida. targetPath:', targetPath);
    } else {
      // Si es relativa, unir con DATA_PATH
      targetPath = path.resolve(path.join(baseDataPath, normalizedFilePath));
      console.log('[save-file] Ruta relativa recibida. targetPath:', targetPath);
    }

    // Seguridad: prevenir path traversal
    if (!targetPath.toLowerCase().startsWith(baseDataPath.toLowerCase())) {
      console.error('[save-file] ❌ Path traversal detectado:', {
        targetPath,
        baseDataPath
      });
      return NextResponse.json(
        { error: 'Ruta no permitida (path traversal detectado)' },
        { status: 403 }
      );
    }

    // Crear directorios intermedios
    const dirName = path.dirname(targetPath);
    console.log('[save-file] Creando directorio:', dirName);
    await fs.mkdir(dirName, { recursive: true });

    // Crear backup solo si el archivo ya existe, no se solicita omitirlo,
    // y el contenido realmente va a cambiar (evita backups durante re-escrituras idénticas)
    if (!skipBackup && fsSync.existsSync(targetPath)) {
      const current = await fs.readFile(targetPath, 'utf8');
      if (current !== content) {
        await fs.writeFile(targetPath + '.zeus-backup', current, 'utf8');
        console.log('[save-file] Backup creado:', targetPath + '.zeus-backup');
      } else {
        console.log('[save-file] Contenido idéntico, omitiendo backup:', targetPath);
      }
    }

    // Escribir archivo
    console.log('[save-file] Escribiendo archivo:', targetPath, 'bytes:', content.length);

    // Detectar si el contenido es un data URL (base64) y escribir como binario
    const dataUrlMatch = typeof content === 'string' && content.match(/^data:([\w/+-]+);base64,(.+)$/);
    if (dataUrlMatch) {
      const base64Data = dataUrlMatch[2];
      const buffer = Buffer.from(base64Data, 'base64');
      await fs.writeFile(targetPath, buffer);
      console.log('[save-file] Archivo binario (dataUrl) escrito. Tamaño:', buffer.length);
    } else if (encoding === 'base64') {
      const buffer = Buffer.from(content, 'base64');
      await fs.writeFile(targetPath, buffer);
      console.log('[save-file] Archivo binario (base64) escrito. Tamaño:', buffer.length);
    } else {
      await fs.writeFile(targetPath, content, 'utf8');
    }

    // Verificar que se escribió
    const stats = await fs.stat(targetPath);
    console.log('[save-file] Archivo escrito. Tamaño:', stats.size);

    return NextResponse.json({
      success: true,
      message: 'Archivo guardado exitosamente',
      path: targetPath,
      inputPath: filePath
    });
  } catch (error) {
    console.error('[save-file] Error:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor', details: (error as Error).message },
      { status: 500 }
    );
  }
}
