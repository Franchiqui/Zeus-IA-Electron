import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

export async function POST(req: Request) {
  try {
    const { projectPath } = await req.json();
    if (!projectPath || typeof projectPath !== 'string') {
      return NextResponse.json({ error: 'projectPath requerido' }, { status: 400 });
    }

    const normalizedPath = path.normalize(projectPath);
    const packageJsonPath = path.join(normalizedPath, 'package.json');

    if (!fs.existsSync(packageJsonPath)) {
      return NextResponse.json({ error: 'No se encontró package.json en el proyecto' }, { status: 400 });
    }

    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    if (!pkg.scripts || !pkg.scripts.build) {
      return NextResponse.json({ error: 'El proyecto no tiene un script "build" definido en package.json' }, { status: 400 });
    }

    // Ejecutar npm run build
    console.log(`[run-project-build] Ejecutando npm run build en ${normalizedPath}...`);
    const result = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve) => {
      const child = spawn('npm', ['run', 'build'], {
        cwd: normalizedPath,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, FORCE_COLOR: '0' },
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });
      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });
      child.on('close', (code) => {
        resolve({ stdout, stderr, code });
      });
    });

    if (result.code !== 0) {
      return NextResponse.json({
        success: false,
        error: `Build falló (código ${result.code}). Revisa los errores en la salida.`,
        stdout: result.stdout,
        stderr: result.stderr,
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  } catch (error: any) {
    console.error('[run-project-build] Error:', error);
    return NextResponse.json({ success: false, error: error.message || 'Error desconocido' }, { status: 500 });
  }
}
