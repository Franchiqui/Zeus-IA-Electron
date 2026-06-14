import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import fsSync from 'fs';
import { readDataPathFromEnv } from '@/lib/env';

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

    let basePath: string;
    if (projectRoot && typeof projectRoot === 'string') {
      const normalizedRoot = path.normalize(projectRoot);
      if (normalizedRoot.toLowerCase().startsWith(baseDataPath.toLowerCase())) {
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
