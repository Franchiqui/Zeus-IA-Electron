import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import fsSync from 'fs';
import { getSessionCwdFromRequest } from '@/lib/sessionResolve';
import { getBaseDataPath } from '@/lib/env';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { filePath, projectRoot } = body;

    if (!filePath || typeof filePath !== 'string') {
      return NextResponse.json(
        { error: 'filePath es requerido' },
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

    let basePath: string;
    if (projectRoot && typeof projectRoot === 'string') {
      const normalizedRoot = path.normalize(projectRoot);
      const bl = baseDataPath.toLowerCase();
      const rl = normalizedRoot.toLowerCase();
      const sep = path.sep;
      if (rl === bl || rl.startsWith(bl + sep)) {
        basePath = normalizedRoot;
      } else {
        basePath = baseDataPath;
      }
    } else {
      basePath = baseDataPath;
    }

    const resolvedBase = path.resolve(basePath);
    const targetPath = path.resolve(path.join(resolvedBase, filePath));

    if (!targetPath.startsWith(resolvedBase)) {
      return NextResponse.json(
        { error: 'Ruta no permitida (path traversal detectado)' },
        { status: 403 }
      );
    }

    if (!fsSync.existsSync(targetPath)) {
      return NextResponse.json(
        { error: 'Archivo no encontrado' },
        { status: 404 }
      );
    }

    const content = await fs.readFile(targetPath, 'utf8');

    return NextResponse.json({
      success: true,
      content,
      path: targetPath,
      relativePath: filePath
    });
  } catch (error) {
    console.error('[read-file] Error:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor', details: (error as Error).message },
      { status: 500 }
    );
  }
}