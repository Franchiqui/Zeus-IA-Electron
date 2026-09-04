import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import fsSync from 'fs';
import { getBaseDataPath } from '@/lib/env';

function safeJoin(base: string, rel: string): string {
  const target = path.resolve(path.join(base, rel));
  if (!target.toLowerCase().startsWith(base.toLowerCase())) {
    throw new Error('Ruta no permitida');
  }
  return target;
}

interface SchemaItem {
  name: string;
  path: string;
  type: 'directory' | 'file';
  extension?: string;
  size?: number;
  modified?: string;
  children?: SchemaItem[];
}

async function buildSchema(dirPath: string, relPath: string): Promise<SchemaItem> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const children: SchemaItem[] = [];

  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue;

    const itemRelPath = relPath ? `${relPath}/${entry.name}` : entry.name;
    const fullPath = path.join(dirPath, entry.name);
    const stat = await fs.stat(fullPath);

    if (entry.isDirectory()) {
      children.push({
        name: entry.name,
        path: itemRelPath,
        type: 'directory',
        modified: stat.mtime.toISOString(),
        children: [],
      });
    } else {
      const ext = path.extname(entry.name).slice(1);
      children.push({
        name: entry.name,
        path: itemRelPath,
        type: 'file',
        extension: ext,
        size: stat.size,
        modified: stat.mtime.toISOString(),
      });
    }
  }

  // Recursively build children for directories
  for (const child of children) {
    if (child.type === 'directory') {
      const childFullPath = path.join(dirPath, child.name);
      try {
        child.children = (await buildSchema(childFullPath, child.path)).children;
      } catch {
        child.children = [];
      }
    }
  }

  return {
    name: path.basename(dirPath) || dirPath,
    path: relPath,
    type: 'directory',
    children,
  };
}

export async function GET(request: Request) {
  try {
    const baseDataPath = await getBaseDataPath();
    const { searchParams } = new URL(request.url);
    const relPath = searchParams.get('path') || '';

    const targetDir = safeJoin(baseDataPath, relPath);

    if (!fsSync.existsSync(targetDir)) {
      return NextResponse.json({ success: false, error: 'Directorio no existe' }, { status: 404 });
    }

    const schema = await buildSchema(targetDir, relPath);

    return NextResponse.json({
      success: true,
      dataPath: baseDataPath,
      schema,
      generatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[ide-schema] GET error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
