import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { patchReplace } from '@/utils/fileOps';

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

    // Read file (for backup + conflict reporting).
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

    // Compute the current slice in the requested line range, for conflict
    // reporting if the fuzzy apply can't find the original code.
    const eol = content.includes('\r\n') ? '\r\n' : '\n';
    const lines = content.split(eol);
    const startIdx = startLine - 1;
    const endIdx = endLine - 1;
    let currentSlice = '';
    if (startIdx >= 0 && endIdx < lines.length && startIdx <= endIdx) {
      currentSlice = lines.slice(startIdx, endIdx + 1).join(eol);
    }

    // Apply the correction using the fuzzy patchReplace (9-strategy chain +
    // already-applied detection + safe atomic write with BOM/CRLF
    // preservation, fail-closed syntax gate, sha256 verify, lint-delta).
    const result = await patchReplace(targetPath, originalCode, correctedCode);

    if (result.success && !result.noChange) {
      const correctedLines = correctedCode.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
      return NextResponse.json({
        success: true,
        message: 'Correction applied successfully',
        filePath,
        linesAffected: correctedLines.length,
        previousLines: endIdx - startIdx + 1,
        strategy: result.strategy,
        diff: result.diff,
        lint: result.lint,
      });
    }

    if (result.success && result.noChange) {
      return NextResponse.json({
        success: true,
        message: result.note || 'Correction already applied — no changes made.',
        filePath,
        alreadyApplied: true,
      });
    }

    // No fuzzy match and not already-applied → conflict. Surface the current
    // vs expected code so the caller can reconcile (preserves the old 409 shape).
    return NextResponse.json(
      {
        error: 'Conflicto: el codigo original no coincide con el archivo actual (ninguna estrategia fuzzy encontro el bloque).',
        detail: result.error,
        filePath,
        startLine,
        endLine,
        currentCode: currentSlice,
        expectedCode: originalCode,
      },
      { status: 409 }
    );
  } catch (error: any) {
    console.error('[apply-correction] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}