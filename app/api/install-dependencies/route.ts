import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';

// Carpeta runtime persistente para la API en ejecución
function getRuntimeDir(): string {
  // En Electron, ZEUS_USER_DATA apunta a AppData/Local/Zeus IA
  const base = process.env.ZEUS_USER_DATA || os.tmpdir();
  return path.join(base, 'api-runtime');
}

// Las dependencias estándar de una API generada por Zeus
const API_DEPENDENCIES: Record<string, string> = {
  'express': '^4.18.2',
  'zod': '^3.22.4',
  'swagger-ui-express': '^5.0.0',
  'swagger-jsdoc': '^6.2.8',
  'cors': '^2.8.5',
  'dotenv': '^16.3.1',
  'multer': '^1.4.5-lts.1',
  'pocketbase': '^0.21.0',
};

const API_DEV_DEPENDENCIES: Record<string, string> = {
  'tsx': '^4.7.0',
  '@types/express': '^4.17.21',
  '@types/cors': '^2.8.17',
  '@types/swagger-ui-express': '^4.1.6',
  '@types/multer': '^1.4.12',
  'typescript': '^5.3.3',
};

export async function POST(request: Request) {
  try {
    const runtimeDir = getRuntimeDir();
    console.log('[install-dependencies] Runtime dir:', runtimeDir);

    // Crear carpeta runtime si no existe
    await fs.mkdir(runtimeDir, { recursive: true });

    // Leer package.json existente o crear uno nuevo
    const pkgPath = path.join(runtimeDir, 'package.json');
    let existingPkg: any = {};

    try {
      const content = await fs.readFile(pkgPath, 'utf8');
      existingPkg = JSON.parse(content);
    } catch {
      // No existe, crear nuevo
    }

    // Mergear dependencias (preservar versiones existentes, añadir las que falten)
    const mergedDeps = { ...(existingPkg.dependencies || {}), ...API_DEPENDENCIES };
    const mergedDevDeps = { ...(existingPkg.devDependencies || {}), ...API_DEV_DEPENDENCIES };

    const pkgJson = {
      name: 'zeus-api-runtime',
      version: '1.0.0',
      private: true,
      scripts: {
        start: 'tsx index.ts',
        dev: 'tsx watch index.ts',
      },
      dependencies: mergedDeps,
      devDependencies: mergedDevDeps,
    };

    await fs.writeFile(pkgPath, JSON.stringify(pkgJson, null, 2), 'utf8');
    console.log('[install-dependencies] package.json escrito');

    // Ejecutar npm install
    return new Promise<Response>((resolve) => {
      const child = exec('npm install', {
        cwd: runtimeDir,
        env: { ...process.env },
        timeout: 120000, // 2 min máximo
      }, async (error, stdout, stderr) => {
        if (error) {
          console.error('[install-dependencies] npm install error:', error.message);
          console.error('[install-dependencies] stderr:', stderr);
          resolve(NextResponse.json({
            success: false,
            error: 'Error instalando dependencias',
            stderr: stderr?.slice(-500) || '',
            stdout: stdout?.slice(-500) || '',
          }, { status: 500 }));
          return;
        }

        console.log('[install-dependencies] npm install completado');
        resolve(NextResponse.json({
          success: true,
          message: 'Dependencias instaladas correctamente',
          runtimeDir,
        }));
      });
    });
  } catch (error) {
    console.error('[install-dependencies] Error:', error);
    return NextResponse.json(
      { error: 'Error interno', details: (error as Error).message },
      { status: 500 }
    );
  }
}