import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { spawn, execSync } from 'child_process';

// Carpeta runtime persistente para la API en ejecución
function getRuntimeDir(): string {
  const base = process.env.ZEUS_USER_DATA || os.tmpdir();
  return path.join(base, 'api-runtime');
}

// Puerto donde corre la API generada
const API_PORT = 8745;

// Referencia al proceso de la API (para no duplicar)
let apiProcess: any = null;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { code, title, description, endpoints, documentation } = body;

    if (!code || typeof code !== 'string' || !code.trim()) {
      return NextResponse.json(
        { error: 'Código de la API es requerido' },
        { status: 400 }
      );
    }

    const runtimeDir = getRuntimeDir();
    console.log('[run-api-runtime] Runtime dir:', runtimeDir);

    // Asegurar que la carpeta existe
    await fs.mkdir(runtimeDir, { recursive: true });

    // Matar proceso anterior si existe
    if (apiProcess) {
      try {
        apiProcess.kill('SIGTERM');
        console.log('[run-api-runtime] Proceso anterior terminado');
      } catch {}
      apiProcess = null;
    }

    // Matar cualquier proceso que ocupe el puerto 8745
    try {
      if (process.platform === 'win32') {
        try {
          const pidStr = execSync(`netstat -ano | findstr ":${API_PORT} " | findstr "LISTENING"`, { encoding: 'utf8' });
          const pids = pidStr.trim().split('\n').map((l: string) => l.trim().split(/\s+/).pop()).filter(Boolean);
          for (const pid of pids) {
            try { execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' }); } catch {}
          }
        } catch {}
      } else {
        try { execSync(`lsof -ti:${API_PORT} | xargs kill -9`, { stdio: 'ignore' }); } catch {}
      }
    } catch {}

    // Escribir el código de la API a index.ts
    const indexPath = path.join(runtimeDir, 'index.ts');
    await fs.writeFile(indexPath, code, 'utf8');
    console.log('[run-api-runtime] index.ts escrito:', code.length, 'chars');

    // Asegurar que package.json existe (mínimo)
    const pkgPath = path.join(runtimeDir, 'package.json');
    if (!fsSync.existsSync(pkgPath)) {
      await fs.writeFile(pkgPath, JSON.stringify({
        name: 'zeus-api-runtime',
        version: '1.0.0',
        private: true,
        scripts: { start: 'tsx index.ts' },
        dependencies: {
          'express': '^4.18.2',
          'zod': '^3.22.4',
          'swagger-ui-express': '^5.0.0',
          'swagger-jsdoc': '^6.2.8',
          'cors': '^2.8.5',
          'dotenv': '^16.3.1',
          'multer': '^1.4.5-lts.1',
          'pocketbase': '^0.21.0',
        },
        devDependencies: {
          'tsx': '^4.7.0',
          '@types/express': '^4.17.21',
          '@types/cors': '^2.8.17',
          '@types/multer': '^1.4.12',
          'typescript': '^5.3.3',
        }
      }, null, 2), 'utf8');
    }

    // Buscar el binario tsx (puede estar en el runtime dir o en el proyecto principal)
    // IMPORTANTE: construir las rutas dinámicamente para que Turbopack/webpack
    // no intente resolverlas como imports estáticos (build error "Module not found").
    const NM = ['node', 'modules'].join('_').replace('_', '');
    const tsxCandidates = [
      [runtimeDir, NM, '.bin', 'tsx'].join(path.sep),
      [process.cwd(), NM, '.bin', 'tsx'].join(path.sep),
      [process.cwd(), NM, 'tsx', 'dist', 'cli.mjs'].join(path.sep),
    ];
    let tsxBin: string | null = null;
    for (const c of tsxCandidates) {
      if (fsSync.existsSync(c)) { tsxBin = c; break; }
    }

    // Arrancar la API
    const env = {
      ...process.env,
      PORT: String(API_PORT),
      NODE_ENV: 'development',
    } as NodeJS.ProcessEnv;

    if (tsxBin && tsxBin.endsWith('.mjs')) {
      // tsx como módulo ES
      apiProcess = spawn('node', [tsxBin, 'index.ts'], {
        cwd: runtimeDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
    } else if (tsxBin) {
      // tsx como binario
      apiProcess = spawn(tsxBin, ['index.ts'], {
        cwd: runtimeDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
    } else {
      // Fallback: npx tsx
      apiProcess = spawn('npx', ['tsx', 'index.ts'], {
        cwd: runtimeDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
      });
    }

    console.log('[run-api-runtime] Proceso iniciado, PID:', apiProcess.pid);

    // Capturar logs
    const logLines: string[] = [];
    apiProcess.stdout?.on('data', (data: Buffer) => {
      const text = data.toString('utf8');
      logLines.push(text.trim());
      console.log('[run-api-runtime] stdout:', text.trim().slice(0, 200));
    });
    apiProcess.stderr?.on('data', (data: Buffer) => {
      const text = data.toString('utf8');
      logLines.push(text.trim());
      console.log('[run-api-runtime] stderr:', text.trim().slice(0, 200));
    });

    apiProcess.on('error', (err: Error) => {
      console.error('[run-api-runtime] Error del proceso:', err.message);
    });

    apiProcess.on('exit', (code: number) => {
      console.log('[run-api-runtime] Proceso terminado, code:', code);
      apiProcess = null;
    });

    // Esperar a que el servidor arranque (intentar conectar al puerto)
    const startTime = Date.now();
    const maxWait = 15000; // 15s máximo
    let serverReady = false;

    while (Date.now() - startTime < maxWait) {
      await new Promise(r => setTimeout(r, 500));
      try {
        // Verificar si el proceso sigue vivo
        if (apiProcess?.exitCode !== null && apiProcess?.exitCode !== undefined) {
          // El proceso murió
          return NextResponse.json({
            error: 'La API se detuvo inesperadamente',
            runtimeLogTail: logLines.slice(-10),
          }, { status: 500 });
        }

        const res = await fetch(`http://localhost:${API_PORT}/api-docs`, {
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok || res.status === 200 || res.status === 301 || res.status === 302) {
          serverReady = true;
          break;
        }
      } catch {
        // Aún no ready
      }
    }

    if (!serverReady) {
      // Si no responde en api-docs, intentar la raíz
      try {
        const res = await fetch(`http://localhost:${API_PORT}/`, {
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok) serverReady = true;
      } catch {}
    }

    const url = `http://localhost:${API_PORT}/api-docs`;

    if (serverReady) {
      return NextResponse.json({
        success: true,
        url,
        message: 'API ejecutándose en el puerto ' + API_PORT,
        runtimeLogTail: logLines.slice(-5),
      });
    }

    // Si no detectamos el servidor pero el proceso sigue vivo, devolver la URL de todas formas
    if (apiProcess && apiProcess.exitCode === null) {
      return NextResponse.json({
        success: true,
        url,
        message: 'API iniciada (esperando confirmación)',
        runtimeLogTail: logLines.slice(-5),
      });
    }

    return NextResponse.json({
      error: 'La API no arrancó en el tiempo esperado',
      runtimeLogTail: logLines.slice(-10),
    }, { status: 500 });
  } catch (error) {
    console.error('[run-api-runtime] Error:', error);
    return NextResponse.json(
      { error: 'Error interno', details: (error as Error).message },
      { status: 500 }
    );
  }
}