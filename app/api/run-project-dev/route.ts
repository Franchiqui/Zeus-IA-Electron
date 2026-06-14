import { NextResponse } from 'next/server';
import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

const activeDevProcesses = new Map<string, ReturnType<typeof spawn>>();

// Archivo compartido para que Electron pueda matar los previews al cerrar
const ACTIVE_PREVIEWS_FILE = process.env.ZEUS_API_ENV_PATH
  ? path.join(path.dirname(process.env.ZEUS_API_ENV_PATH), 'active-previews.json')
  : path.join(os.tmpdir(), 'zeus-active-previews.json');

function loadActivePreviews(): Array<{ projectPath: string; port: number; pid?: number }> {
  try {
    if (fs.existsSync(ACTIVE_PREVIEWS_FILE)) {
      return JSON.parse(fs.readFileSync(ACTIVE_PREVIEWS_FILE, 'utf8'));
    }
  } catch { /* ignore */ }
  return [];
}

function saveActivePreviews(previews: Array<{ projectPath: string; port: number; pid?: number }>) {
  try {
    fs.mkdirSync(path.dirname(ACTIVE_PREVIEWS_FILE), { recursive: true });
    fs.writeFileSync(ACTIVE_PREVIEWS_FILE, JSON.stringify(previews, null, 2));
  } catch { /* ignore */ }
}

function addActivePreview(projectPath: string, port: number, pid?: number) {
  const previews = loadActivePreviews().filter(p => p.projectPath !== projectPath);
  previews.push({ projectPath, port, pid });
  saveActivePreviews(previews);
}

function removeActivePreview(projectPath: string) {
  const previews = loadActivePreviews().filter(p => p.projectPath !== projectPath);
  saveActivePreviews(previews);
}

function detectPortFromPackageJson(packageJsonPath: string): number {
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const devScript = pkg.scripts?.dev || '';
    const portMatch = devScript.match(/(?:-p|--port)\s+(\d+)/);
    if (portMatch) return parseInt(portMatch[1], 10);
  } catch { /* ignore */ }
  return 3000;
}

function killProcessOnPort(port: number) {
  if (!Number.isFinite(port) || port <= 0) return;
  const ownPid = String(process.pid);
  try {
    if (process.platform === 'win32') {
      // Buscar solo conexiones TCP en estado LISTENING para evitar falsos positivos
      const stdout = execSync(`netstat -ano -p tcp | findstr LISTENING | findstr /C:":${port} "`).toString();
      const lines = stdout.split('\n');
      const pids = new Set<string>();
      lines.forEach((line) => {
        const parts = line.trim().split(/\s+/);
        // Formato netstat: Proto  Local Address  Foreign Address  State  PID
        if (parts.length >= 5) {
          const pid = parts[parts.length - 1];
          if (parseInt(pid) > 0 && pid !== ownPid) pids.add(pid);
        }
      });
      pids.forEach((pid) => {
        try {
          execSync(`taskkill /pid ${pid} /f /t`);
          console.log(`[run-project-dev] Matado proceso en puerto ${port} (PID: ${pid})`);
        } catch {
          // ignore
        }
      });
    } else {
      const stdout = execSync(`lsof -ti:${port}`).toString();
      const pids = stdout.split('\n').filter((p) => p && p !== ownPid);
      pids.forEach((pid) => {
        try {
          execSync(`kill -9 ${pid}`);
          console.log(`[run-project-dev] Matado proceso en puerto ${port} (PID: ${pid})`);
        } catch {
          // ignore
        }
      });
    }
  } catch {
    // No hay proceso en ese puerto, ignorar
  }
}

export async function POST(req: Request) {
  try {
    const { projectPath, port } = await req.json();
    if (!projectPath || typeof projectPath !== 'string') {
      return NextResponse.json({ error: 'projectPath requerido' }, { status: 400 });
    }

    const normalizedPath = path.normalize(projectPath);
    const packageJsonPath = path.join(normalizedPath, 'package.json');

    if (!fs.existsSync(packageJsonPath)) {
      return NextResponse.json({ error: 'No se encontró package.json en el proyecto' }, { status: 400 });
    }

    // Detectar puerto esperado y matar cualquier proceso que lo esté usando
    const expectedPort = (typeof port === 'number' && Number.isFinite(port)) ? port : detectPortFromPackageJson(packageJsonPath);
    killProcessOnPort(expectedPort);

    // Matar también el puerto siguiente por si acaso
    killProcessOnPort(expectedPort + 1);

    // Matar proceso anterior si existe (mismo projectPath)
    const existing = activeDevProcesses.get(normalizedPath);
    if (existing) {
      existing.kill();
      activeDevProcesses.delete(normalizedPath);
      await new Promise((r) => setTimeout(r, 500));
    }

    // Verificar node_modules
    const nodeModulesPath = path.join(normalizedPath, 'node_modules');
    const hasNodeModules = fs.existsSync(nodeModulesPath);

    if (!hasNodeModules) {
      console.log(`[run-project-dev] Instalando dependencias en ${normalizedPath}...`);
      await new Promise<void>((resolve, reject) => {
        const installProc = spawn('npm', ['install'], {
          cwd: normalizedPath,
          shell: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, FORCE_COLOR: '0' },
        });

        let stderr = '';
        installProc.stderr?.on('data', (data) => {
          stderr += data.toString();
        });

        installProc.on('close', (code) => {
          if (code === 0) {
            console.log(`[run-project-dev] npm install completado en ${normalizedPath}`);
            resolve();
          } else {
            reject(new Error(`npm install falló con código ${code}. ${stderr.slice(0, 300)}`));
          }
        });

        installProc.on('error', (err) => reject(err));
      });
    }

    // Ejecutar npm run dev (inyectando PORT si se envió explícitamente)
    console.log(`[run-project-dev] Iniciando npm run dev en ${normalizedPath} (puerto ${expectedPort})...`);
    const devProc = spawn('npm', ['run', 'dev'], {
      cwd: normalizedPath,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0', PORT: String(expectedPort) },
    });

    activeDevProcesses.set(normalizedPath, devProc);
    addActivePreview(normalizedPath, expectedPort, devProc.pid ?? undefined);

    let latestStdout = '';
    let latestStderr = '';
    let processExited = false;
    let exitCode: number | null = null;

    devProc.stdout?.on('data', (data) => {
      const text = data.toString().trim();
      latestStdout = text;
      console.log(`[DevServer ${normalizedPath}] ${text}`);
    });
    devProc.stderr?.on('data', (data) => {
      const text = data.toString().trim();
      latestStderr = text;
      console.error(`[DevServer ${normalizedPath}] ${text}`);
    });
    devProc.on('exit', (code) => {
      exitCode = code;
      processExited = true;
      console.log(`[DevServer ${normalizedPath}] Proceso terminado con código ${code}`);
      activeDevProcesses.delete(normalizedPath);
      removeActivePreview(normalizedPath);
    });

    // Esperar un poco y verificar si el proceso murió inmediatamente (error de compilación)
    await new Promise((r) => setTimeout(r, 3000));
    if (processExited && exitCode !== 0 && exitCode !== null) {
      return NextResponse.json({
        success: false,
        error: `El servidor dev terminó inmediatamente (código ${exitCode}). Revisa el terminal para ver el error de compilación.`,
        stdout: latestStdout,
        stderr: latestStderr,
        installed: !hasNodeModules
      }, { status: 500 });
    }

    return NextResponse.json({ success: true, pid: devProc.pid, installed: !hasNodeModules, stdout: latestStdout, stderr: latestStderr, expectedPort });
  } catch (error: any) {
    console.error('[run-project-dev] Error:', error);
    return NextResponse.json({ success: false, error: error.message || 'Error desconocido' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { projectPath } = await req.json();
    if (!projectPath) {
      return NextResponse.json({ error: 'projectPath requerido' }, { status: 400 });
    }
    const normalizedPath = path.normalize(projectPath);
    removeActivePreview(normalizedPath);
    const existing = activeDevProcesses.get(normalizedPath);
    if (existing) {
      existing.kill();
      activeDevProcesses.delete(normalizedPath);
      return NextResponse.json({ success: true, message: 'Proceso detenido' });
    }
    return NextResponse.json({ success: false, message: 'No hay proceso activo' });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
