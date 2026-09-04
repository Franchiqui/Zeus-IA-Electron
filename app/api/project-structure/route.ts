import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import fsSync from 'fs';
import { getBaseDataPath } from '@/lib/env';

export const runtime = 'nodejs';

// Carpetas y archivos a ignorar durante el escaneo
const IGNORED_NAMES = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'out',
  '.cache',
  '.claude',
  '.vscode',
  '.idea',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  '.turbo',
  '.parcel-cache',
  '.nuxt',
  '.output',
  '.vercel',
  '.netlify',
  'bower_components',
  '.svelte-kit',
  '.astro',
  '.quasar',
  '.expo',
  '.gradle',
  'android',
  'ios',
  'Pods',
  'DerivedData',
  '.DS_Store',
  'Thumbs.db',
  '*.log',
  '*.tmp',
  '*.temp',
  '.env.local',
  '.env.development',
  '.env.production',
  '.env.test',
]);

const IGNORED_EXTENSIONS = new Set([
  '.lock',
  '.map',
  '.min.js',
  '.min.css',
]);

function shouldIgnore(name: string): boolean {
  if (IGNORED_NAMES.has(name)) return true;
  if (name.startsWith('.')) {
    // No ignorar todos los archivos ocultos, solo algunos
    if (name === '.env' || name === '.gitignore' || name === '.eslintrc' || name === '.prettierrc') {
      return false;
    }
    return true;
  }
  for (const ext of IGNORED_EXTENSIONS) {
    if (name.endsWith(ext)) return true;
  }
  return false;
}

async function scanDirectory(dirPath: string, basePath: string, folders: string[], files: string[]): Promise<void> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => [] as fsSync.Dirent[]);

  for (const entry of entries) {
    if (shouldIgnore(entry.name)) continue;

    const fullPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(basePath, fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      folders.push(relativePath);
      await scanDirectory(fullPath, basePath, folders, files);
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
}

export async function GET() {
  try {
    const baseDataPath = await getBaseDataPath();

    if (!fsSync.existsSync(baseDataPath)) {
      return NextResponse.json(
        { success: false, error: 'DATA_PATH no existe' },
        { status: 404 }
      );
    }

    const folders: string[] = [];
    const files: string[] = [];

    await scanDirectory(baseDataPath, baseDataPath, folders, files);

    // Intentar leer package.json para obtener información del proyecto
    let overview = `Estructura del proyecto en ${baseDataPath}`;
    try {
      const packageJsonPath = path.join(baseDataPath, 'package.json');
      if (fsSync.existsSync(packageJsonPath)) {
        const content = await fs.readFile(packageJsonPath, 'utf8');
        const pkg = JSON.parse(content);
        const deps = Object.keys(pkg.dependencies || {});
        const devDeps = Object.keys(pkg.devDependencies || {});
        const allDeps = [...deps, ...devDeps];

        let framework = 'proyecto';
        if (allDeps.includes('next')) framework = 'Next.js';
        else if (allDeps.includes('react')) framework = 'React';
        else if (allDeps.includes('vue')) framework = 'Vue';
        else if (allDeps.includes('angular')) framework = 'Angular';
        else if (allDeps.includes('svelte')) framework = 'Svelte';
        else if (allDeps.includes('electron')) framework = 'Electron';
        else if (allDeps.includes('@capacitor/core')) framework = 'Capacitor';
        else if (allDeps.includes('express')) framework = 'Express';
        else if (allDeps.includes('fastify')) framework = 'Fastify';
        else if (allDeps.includes('nestjs')) framework = 'NestJS';

        overview = `Proyecto ${framework}: ${pkg.name || 'sin nombre'}\n`;
        if (pkg.description) overview += `Descripción: ${pkg.description}\n`;
        if (deps.length > 0) overview += `Dependencias principales: ${deps.slice(0, 15).join(', ')}${deps.length > 15 ? '...' : ''}\n`;
      }
    } catch {
      // ignorar errores de package.json
    }

    return NextResponse.json({
      success: true,
      structure: {
        overview,
        folders,
        files,
        basePath: baseDataPath,
      },
    });
  } catch (error: any) {
    console.error('[project-structure] Error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Error al escanear el proyecto' },
      { status: 500 }
    );
  }
}
