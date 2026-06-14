import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

interface ApplyCorrectionBody {
  projectRoot: string;
  filePath: string;
  startLine: number;
  endLine: number;
  originalCode: string;
  correctedCode: string;
  description?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ApplyCorrectionBody;

    const {
      projectRoot,
      filePath,
      startLine,
      endLine,
      originalCode,
      correctedCode,
      description,
    } = body;

    if (!projectRoot || !filePath || !startLine || !endLine || !originalCode || !correctedCode) {
      return NextResponse.json(
        { error: 'Faltan campos requeridos (projectRoot, filePath, startLine, endLine, originalCode, correctedCode)' },
        { status: 400 }
      );
    }

    const baseDataPath = path.resolve(projectRoot);
    const targetPath = path.join(baseDataPath, filePath);

    // Path traversal protection
    if (!targetPath.toLowerCase().startsWith(baseDataPath.toLowerCase())) {
      return NextResponse.json(
        { error: 'Ruta no permitida (path traversal detectado)' },
        { status: 403 }
      );
    }

    // Read file
    let content: string;
    try {
      content = await fs.readFile(targetPath, 'utf8');
    } catch (readErr: any) {
      if (readErr.code === 'ENOENT') {
        return NextResponse.json(
          { error: 'Archivo no encontrado: ' + filePath },
          { status: 404 }
        );
      }
      throw readErr;
    }

    // Crear backup antes de cualquier modificacion
    try {
      await fs.writeFile(targetPath + '.zeus-backup', content, 'utf8');
    } catch (backupErr) {
      console.warn('[apply-correction] No se pudo crear backup:', backupErr);
    }

    // Detect original EOL to preserve it
    const eol = content.includes('\r\n') ? '\r\n' : '\n';
    const lines = content.split(eol);

    const startIdx = startLine - 1;
    const endIdx = endLine - 1;

    if (startIdx < 0 || endIdx >= lines.length || startIdx > endIdx) {
      return NextResponse.json(
        { error: 'Rango de lineas invalido', totalLines: lines.length },
        { status: 400 }
      );
    }

    // Extract current code in range and normalize for comparison
    const currentSlice = lines.slice(startIdx, endIdx + 1).join(eol);
    const normalize = (str: string) =>
      str.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd();

    if (normalize(currentSlice) !== normalize(originalCode)) {
      return NextResponse.json(
        {
          error: 'Conflicto: el codigo original no coincide con el archivo actual.',
          filePath,
          startLine,
          endLine,
          currentCode: currentSlice,
          expectedCode: originalCode,
        },
        { status: 409 }
      );
    }

    // Apply the correction
    const correctedLines = correctedCode
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n');
    lines.splice(startIdx, endIdx - startIdx + 1, ...correctedLines);

    // Ensure parent directory exists
    const dir = path.dirname(targetPath);
    await fs.mkdir(dir, { recursive: true });

    await fs.writeFile(targetPath, lines.join(eol), 'utf8');

    return NextResponse.json({
      success: true,
      message: 'Correction applied successfully',
      filePath,
      linesAffected: correctedLines.length,
      previousLines: endIdx - startIdx + 1,
    });
  } catch (error: any) {
    console.error('[apply-correction] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
