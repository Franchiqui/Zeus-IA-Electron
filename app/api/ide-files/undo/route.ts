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

export async function POST(request: Request) {
  try {
    const baseDataPath = getBaseDataPath();
    const body = await request.json();
    const { path: relPath = '', name } = body;

    if (!name) {
      return NextResponse.json({ success: false, error: 'Nombre requerido' }, { status: 400 });
    }

    const targetDir = safeJoin(baseDataPath, relPath);
    const filePath = path.join(targetDir, name);
    const resolvedFile = path.resolve(filePath);
    if (!resolvedFile.toLowerCase().startsWith(baseDataPath.toLowerCase())) {
      return NextResponse.json({ success: false, error: 'Ruta no permitida' }, { status: 403 });
    }

    const backupPath = resolvedFile + '.zeus-backup';
    if (!fsSync.existsSync(backupPath)) {
      return NextResponse.json({ success: false, error: 'No hay backup disponible para este archivo' }, { status: 404 });
    }

    const backupContent = await fs.readFile(backupPath, 'utf8');
    await fs.writeFile(resolvedFile, backupContent, 'utf8');
    return NextResponse.json({ success: true, message: 'Archivo restaurado desde backup' });
  } catch (error: any) {
    console.error('[ide-files/undo] POST error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
