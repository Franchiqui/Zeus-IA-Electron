import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import fsSync from 'fs';
import { readDataPathFromEnv } from '@/lib/env';

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

    // Leer DATA_PATH
    const dataPath = readDataPathFromEnv() || process.env.DATA_PATH;
    if (!dataPath) {
      return NextResponse.json(
        { error: 'DATA_PATH no configurado' },
        { status: 500 }
      );
    }

    const baseDataPath = path.normalize(
      path.isAbsolute(dataPath) ? dataPath : path.resolve(process.cwd(), dataPath)
    );

    // Resolver la ruta base: DATA_PATH es la raíz directa
    let basePath: string;
    if (projectRoot && typeof projectRoot === 'string') {
      const normalizedRoot = path.normalize(projectRoot);
      // Solo confiar en projectRoot si está dentro de DATA_PATH
      if (normalizedRoot.toLowerCase().startsWith(baseDataPath.toLowerCase())) {
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
