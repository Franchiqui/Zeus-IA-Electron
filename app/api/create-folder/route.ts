import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { getSessionCwdFromRequest } from '@/lib/sessionResolve';
import { getBaseDataPath } from '@/lib/env';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { dir, projectRoot, projectId } = body;

    if (!dir || typeof dir !== 'string') {
      return NextResponse.json(
        { error: 'dir es requerido' },
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

    // Resolver la ruta base: usar projectRoot si está dentro del cwd de sesión
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

    // Seguridad: prevenir path traversal
    const resolvedBase = path.resolve(basePath);
    const targetDir = path.resolve(path.join(resolvedBase, dir));

    if (!targetDir.startsWith(resolvedBase)) {
      return NextResponse.json(
        { error: 'Ruta no permitida (path traversal detectado)' },
        { status: 403 }
      );
    }

    // Crear carpeta
    await fs.mkdir(targetDir, { recursive: true });

    return NextResponse.json({
      success: true,
      message: 'Carpeta creada exitosamente',
      path: targetDir
    });
  } catch (error) {
    console.error('[create-folder] Error:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor', details: (error as Error).message },
      { status: 500 }
    );
  }
}