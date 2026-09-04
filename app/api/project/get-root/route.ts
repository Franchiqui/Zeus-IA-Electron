import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getSessionCwdFromRequest } from '@/lib/sessionResolve';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { initialProjectRoot } = body;

    // El cwd se ancla por sesión (header X-Zeus-Session), no a DATA_PATH global.
    const sessionCwd = await getSessionCwdFromRequest(request);
    if (!sessionCwd) {
      return NextResponse.json(
        { error: 'No hay sesión activa. Selecciona una carpeta de proyecto.' },
        { status: 400 }
      );
    }

    const baseDataPath = path.normalize(sessionCwd);

    // Solo confiar en initialProjectRoot si está dentro del cwd de sesión
    let projectRoot: string;
    if (initialProjectRoot && typeof initialProjectRoot === 'string') {
      const normalizedRoot = path.normalize(initialProjectRoot);
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
