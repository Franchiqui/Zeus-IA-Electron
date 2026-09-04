import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import fsSync from 'fs';
import { getSessionCwdFromRequest } from '@/lib/sessionResolve';
import { safeWriteFile } from '@/utils/fileOps';

function safeJoin(base: string, rel: string): string {
  const target = path.resolve(path.join(base, rel));
  if (!target.toLowerCase().startsWith(base.toLowerCase())) {
    throw new Error('Ruta no permitida');
  }
  return target;
}

// Borrado manual recursivo para evitar posibles bugs nativos de fs.rm
// en Node 24 / Windows con archivos de solo lectura.
async function deletePathRecursive(targetPath: string): Promise<void> {
  const stat = await fsSync.promises.stat(targetPath);
  if (stat.isDirectory()) {
    const entries = await fsSync.promises.readdir(targetPath);
    for (const entry of entries) {
      await deletePathRecursive(path.join(targetPath, entry));
    }
    await fsSync.promises.rmdir(targetPath);
  } else {
    // En Windows, quitar atributo de solo lectura antes de borrar
    try {
      await fsSync.promises.chmod(targetPath, 0o666);
    } catch {
      // Ignorar si chmod falla
    }
    await fsSync.promises.unlink(targetPath);
  }
}

// GET /api/ide-files?path=&type=  (type: folders | files | all)
// GET /api/ide-files?path=&name=filename.txt&raw=1  (read single file)
export async function GET(request: Request) {
  try {
    const baseDataPath = await getSessionCwdFromRequest(request);
    if (!baseDataPath) return NextResponse.json({ success: false, error: "No hay sesión activa. Selecciona una carpeta de proyecto." }, { status: 400 });
    const { searchParams } = new URL(request.url);
    const relPath = searchParams.get('path') || '';
    const type = searchParams.get('type') || 'all';
    const name = searchParams.get('name');
    const raw = searchParams.get('raw') === '1';

    const targetDir = safeJoin(baseDataPath, relPath);

    // Read single file content
    if (name) {
      const filePath = path.join(targetDir, name);
      const resolvedFile = path.resolve(filePath);
      if (!resolvedFile.toLowerCase().startsWith(baseDataPath.toLowerCase())) {
        return NextResponse.json({ success: false, error: 'Ruta no permitida' }, { status: 403 });
      }
      if (!fsSync.existsSync(resolvedFile)) {
        return NextResponse.json({ success: false, error: 'Archivo no encontrado' }, { status: 404 });
      }
      if (raw) {
        const buffer = await fs.readFile(resolvedFile);
        const ext = path.extname(name).toLowerCase();
        const mimeTypes: Record<string, string> = {
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif': 'image/gif',
          '.bmp': 'image/bmp',
          '.svg': 'image/svg+xml',
          '.webp': 'image/webp',
          '.ico': 'image/x-icon',
          '.mp3': 'audio/mpeg',
          '.wav': 'audio/wav',
          '.ogg': 'audio/ogg',
          '.mp4': 'video/mp4',
          '.webm': 'video/webm',
        };
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        return new NextResponse(buffer, { headers: { 'Content-Type': contentType } });
      }
      const content = await fs.readFile(resolvedFile, 'utf8');
      return NextResponse.json({ success: true, content });
    }

    if (!fsSync.existsSync(targetDir)) {
      return NextResponse.json({ success: true, folders: [], files: [] });
    }

    const entries = await fs.readdir(targetDir, { withFileTypes: true });
    const folders: any[] = [];
    const files: any[] = [];

    for (const entry of entries) {
      const itemPath = relPath ? `${relPath.replace(/\\/g, '/')}/${entry.name}` : entry.name;
      const fullPath = path.join(targetDir, entry.name);
      const stat = await fs.stat(fullPath);

      if (entry.isDirectory()) {
        folders.push({
          name: entry.name,
          path: itemPath,
          size: 0,
          modified: stat.mtime.toISOString(),
        });
      } else if (entry.isFile()) {
        files.push({
          name: entry.name,
          path: itemPath,
          size: stat.size,
          modified: stat.mtime.toISOString(),
        });
      }
    }

    if (type === 'folders') {
      return NextResponse.json({ success: true, folders });
    }
    if (type === 'files') {
      return NextResponse.json({ success: true, files });
    }
    return NextResponse.json({ success: true, folders, files });
  } catch (error: any) {
    console.error('[ide-files] GET error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST /api/ide-files { action: 'createFile'|'createFolder', path, name, content? }
export async function POST(request: Request) {
  try {
    const baseDataPath = await getSessionCwdFromRequest(request);
    if (!baseDataPath) return NextResponse.json({ success: false, error: "No hay sesión activa. Selecciona una carpeta de proyecto." }, { status: 400 });
    const body = await request.json();
    const { action, path: relPath = '', name, content = '' } = body;

    if (!name) {
      return NextResponse.json({ success: false, error: 'Nombre requerido' }, { status: 400 });
    }

    const targetDir = safeJoin(baseDataPath, relPath);
    const targetPath = path.join(targetDir, name);
    const resolvedTarget = path.resolve(targetPath);
    if (!resolvedTarget.toLowerCase().startsWith(baseDataPath.toLowerCase())) {
      return NextResponse.json({ success: false, error: 'Ruta no permitida' }, { status: 403 });
    }

    if (action === 'createFolder') {
      await fs.mkdir(targetPath, { recursive: true });
      return NextResponse.json({ success: true });
    }

    if (action === 'createFile') {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      const writeRes = await safeWriteFile(targetPath, content);
      if (!writeRes.success) {
        return NextResponse.json({ success: false, error: writeRes.error }, { status: 500 });
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: 'Acción no válida' }, { status: 400 });
  } catch (error: any) {
    console.error('[ide-files] POST error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// PUT /api/ide-files { action: 'rename'|'save', path, name, newName?, content? }
export async function PUT(request: Request) {
  try {
    const baseDataPath = await getSessionCwdFromRequest(request);
    if (!baseDataPath) return NextResponse.json({ success: false, error: "No hay sesión activa. Selecciona una carpeta de proyecto." }, { status: 400 });
    const body = await request.json();
    const { action, path: relPath = '', name, newName, content } = body;

    const targetDir = safeJoin(baseDataPath, relPath);

    if (action === 'rename') {
      if (!name || !newName) {
        return NextResponse.json({ success: false, error: 'Nombre y nuevo nombre requeridos' }, { status: 400 });
      }
      const oldPath = path.join(targetDir, name);
      const newPath = path.join(targetDir, newName);
      const resolvedOld = path.resolve(oldPath);
      const resolvedNew = path.resolve(newPath);
      if (!resolvedOld.toLowerCase().startsWith(baseDataPath.toLowerCase()) ||
          !resolvedNew.toLowerCase().startsWith(baseDataPath.toLowerCase())) {
        return NextResponse.json({ success: false, error: 'Ruta no permitida' }, { status: 403 });
      }
      await fs.rename(resolvedOld, resolvedNew);
      return NextResponse.json({ success: true });
    }

    if (action === 'save') {
      if (!name || content === undefined) {
        return NextResponse.json({ success: false, error: 'Nombre y contenido requeridos' }, { status: 400 });
      }
      const filePath = path.join(targetDir, name);
      const resolvedFile = path.resolve(filePath);
      if (!resolvedFile.toLowerCase().startsWith(baseDataPath.toLowerCase())) {
        return NextResponse.json({ success: false, error: 'Ruta no permitida' }, { status: 403 });
      }
      await fs.mkdir(path.dirname(resolvedFile), { recursive: true });
      // Crear backup solo si el archivo ya existe y el contenido realmente cambia
      if (fsSync.existsSync(resolvedFile)) {
        const current = await fs.readFile(resolvedFile, 'utf8');
        if (current !== content) {
          await fs.writeFile(resolvedFile + '.zeus-backup', current, 'utf8');
        }
      }
      // Escritura segura de contenido: atómica, BOM/CRLF, fail-closed, sha256.
      const writeRes = await safeWriteFile(resolvedFile, content);
      if (!writeRes.success) {
        return NextResponse.json({ success: false, error: writeRes.error }, { status: 500 });
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: 'Acción no válida' }, { status: 400 });
  } catch (error: any) {
    console.error('[ide-files] PUT error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// DELETE /api/ide-files?path=&name=
export async function DELETE(request: Request) {
  try {
    const baseDataPath = await getSessionCwdFromRequest(request);
    if (!baseDataPath) return NextResponse.json({ success: false, error: "No hay sesión activa. Selecciona una carpeta de proyecto." }, { status: 400 });
    const { searchParams } = new URL(request.url);
    const relPath = searchParams.get('path') || '';
    const name = searchParams.get('name');

    if (!name) {
      return NextResponse.json({ success: false, error: 'Nombre requerido' }, { status: 400 });
    }

    const targetDir = safeJoin(baseDataPath, relPath);
    const targetPath = path.join(targetDir, name);
    const resolvedTarget = path.resolve(targetPath);
    if (!resolvedTarget.toLowerCase().startsWith(baseDataPath.toLowerCase())) {
      return NextResponse.json({ success: false, error: 'Ruta no permitida' }, { status: 403 });
    }

    const stat = await fs.stat(resolvedTarget).catch(() => null);
    if (!stat) {
      return NextResponse.json({ success: false, error: 'No existe' }, { status: 404 });
    }

    // Borrado manual recursivo para evitar posibles bugs nativos de fs.rm
    // en Node 24 / Windows con archivos de solo lectura.
    await deletePathRecursive(resolvedTarget);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[ide-files] DELETE error:', error);
    let message = error.message || 'Error al eliminar';
    const code = error.code || '';
    if (code === 'EPERM' || code === 'EACCES') {
      message = 'No se tienen permisos para eliminar este elemento.';
    } else if (code === 'EBUSY') {
      message = 'El archivo está en uso por otro proceso. Inténtalo de nuevo en unos segundos.';
    }
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
