import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import fsSync from 'fs';
import { getSessionCwdFromRequest } from '@/lib/sessionResolve';
import { getBaseDataPath } from '@/lib/env';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { filePath, content, encoding, skipBackup, projectRoot } = body;

    console.log('[save-file] Request recibida:', { filePath, contentLength: content?.length, skipBackup, projectRoot });

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

    // Resolver la ruta base: sesión de la request (header X-Zeus-Session),
    // fallback a la sesión activa global, fallback a DATA_PATH
    let baseDataPath: string;
    const sessionCwd = await getSessionCwdFromRequest(request);
    if (sessionCwd) {
      baseDataPath = path.normalize(sessionCwd);
    } else {
      baseDataPath = await getBaseDataPath();
    }
    console.log('[save-file] baseDataPath:', baseDataPath);

    // Usar projectRoot si está dentro del cwd de la sesión; si no, usar el cwd
    let basePath: string;
    if (projectRoot && typeof projectRoot === 'string') {
      const normalizedRoot = path.normalize(projectRoot);
      const bl = baseDataPath.toLowerCase();
      const rl = normalizedRoot.toLowerCase();
      const sep = path.sep;
      if (rl === bl || rl.startsWith(bl + sep)) {
        basePath = normalizedRoot;
      } else {
        // projectRoot fuera del cwd de sesión — usar el cwd como base segura
        console.warn('[save-file] projectRoot fuera del cwd de sesión, usando cwd:', baseDataPath);
        basePath = baseDataPath;
      }
    } else {
      basePath = baseDataPath;
    }

    let targetPath: string;
    const normalizedFilePath = path.normalize(filePath);

    if (path.isAbsolute(normalizedFilePath)) {
      // Si es una ruta absoluta, verificar que esté dentro de basePath
      targetPath = path.resolve(normalizedFilePath);
      console.log('[save-file] Ruta absoluta recibida. targetPath:', targetPath);
    } else {
      // Si es relativa, unir con basePath
      targetPath = path.resolve(path.join(basePath, normalizedFilePath));
      console.log('[save-file] Ruta relativa recibida. targetPath:', targetPath);
    }

    // Seguridad: prevenir path traversal
    if (!targetPath.toLowerCase().startsWith(basePath.toLowerCase())) {
      console.error('[save-file] ❌ Path traversal detectado:', {
        targetPath,
        basePath
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