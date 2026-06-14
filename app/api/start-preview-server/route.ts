import { NextResponse } from 'next/server';
import path from 'path';
import os from 'os';

// Obtener spawn en tiempo de ejecución para evitar que Turbopack trace child_process
const getSpawn = () => {
  const cp = eval('require("child_process")') as typeof import('child_process');
  return cp.spawn;
};

type SpawnType = ReturnType<typeof getSpawn>;
let previewServerProcess: ReturnType<SpawnType> | null = null;

export async function POST() {
  try {
    // Si ya hay un proceso corriendo, verificar si sigue vivo
    if (previewServerProcess) {
      const isRunning = !previewServerProcess.killed && previewServerProcess.exitCode === null;
      if (isRunning) {
        return NextResponse.json({ success: true, message: 'Preview server ya estaba corriendo', pid: previewServerProcess.pid });
      }
    }

    // Construir rutas dinámicamente para evitar que Turbopack las trace como imports
    // Usamos new Function para ocultar los literales del análisis estático de Turbopack
    const base = process.cwd();
    const sep = path.sep;
    const getPaths = new Function('base', 'sep', 'path', `
      return [
        base + sep + 'serve' + sep + 'server.js',
        path.dirname(base) + sep + 'serve' + sep + 'server.js',
        base + sep + 'resources' + sep + 'app' + sep + 'serve' + sep + 'server.js',
      ];
    `);
    const possiblePaths: string[] = getPaths(base, sep, path);

    let serverPath: string | null = null;
    for (const p of possiblePaths) {
      try {
        const fs = await import('fs');
        if (fs.existsSync(p)) {
          serverPath = p;
          break;
        }
      } catch { /* ignore */ }
    }

    if (!serverPath) {
      return NextResponse.json({ success: false, message: 'No se encontró serve/server.js' });
    }

    // Use writable user directories when running inside a packaged Electron app
    const isPackaged = !!process.versions.electron || process.env.ELECTRON_RUN_AS_NODE === '1' || process.env.ZEUS_PACKAGED === '1';
    const userWritableBase = path.join(process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir(), 'ZeusIA');
    const projectsDir = isPackaged ? path.join(userWritableBase, 'projects', 'current-project') : undefined;
    const uploadsDir = isPackaged ? path.join(userWritableBase, 'uploads') : undefined;

    const proc = getSpawn()('node', [serverPath], {
      cwd: path.dirname(path.dirname(serverPath)),
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        DISABLE_TUNNEL: 'true',
        ...(projectsDir ? { PROJECTS_DIR: projectsDir } : {}),
        ...(uploadsDir ? { UPLOADS_DIR: uploadsDir } : {}),
      },
    });

    previewServerProcess = proc;

    proc.stdout?.on('data', (data) => {
      console.log(`[PreviewServer stdout]: ${data}`);
    });

    proc.stderr?.on('data', (data) => {
      console.error(`[PreviewServer stderr]: ${data}`);
    });

    proc.on('error', (err) => {
      console.error('[PreviewServer] Error en el proceso:', err);
    });

    proc.on('exit', (code) => {
      console.log(`[PreviewServer] Proceso terminado con código ${code}`);
      previewServerProcess = null;
    });

    // Esperar un poco para verificar que arrancó
    await new Promise((resolve) => setTimeout(resolve, 1500));

    if (proc.killed || proc.exitCode !== null) {
      return NextResponse.json({ success: false, message: 'El proceso terminó inmediatamente' });
    }

    return NextResponse.json({ success: true, message: 'Preview server iniciado', pid: proc.pid });
  } catch (error: any) {
    console.error('[start-preview-server] Error:', error);
    return NextResponse.json({ success: false, error: error.message || 'Error desconocido' }, { status: 500 });
  }
}
