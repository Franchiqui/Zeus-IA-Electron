import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { readDataPathFromEnv } from '@/lib/env';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { projectId, initialProjectRoot } = body;

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

    // DATA_PATH es siempre la raíz directa del proyecto actual
    let projectRoot: string;
    if (initialProjectRoot && typeof initialProjectRoot === 'string') {
      const normalizedRoot = path.normalize(initialProjectRoot);
      // Solo confiar en initialProjectRoot si está dentro de DATA_PATH
      if (normalizedRoot.toLowerCase().startsWith(baseDataPath.toLowerCase())) {
        projectRoot = normalizedRoot;
      } else {
        projectRoot = baseDataPath;
      }
    } else {
      projectRoot = baseDataPath;
    }

    // Asegurar que el directorio exista
    try {
      fs.mkdirSync(projectRoot, { recursive: true });
    } catch (e) {
      console.warn('[project/get-root] No se pudo crear directorio:', projectRoot, e);
    }

    return NextResponse.json({
      success: true,
      projectRoot,
      dataPath: baseDataPath
    });
  } catch (error) {
    console.error('[project/get-root] Error:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}
