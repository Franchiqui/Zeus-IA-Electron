import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const fileName = searchParams.get('fileName');

    if (!fileName) {
      return new NextResponse('Missing fileName', { status: 400 });
    }

    // Sanitizar: evitar path traversal
    const safeName = path.basename(fileName);

    // Intentar múltiples rutas posibles para uploads
    const possibleDirs = [
      process.env.ZEUS_UPLOADS_PATH,
      path.join(process.cwd(), 'uploads'),
      path.join(process.cwd(), '..', 'uploads'),
      path.join(process.cwd(), '..', '..', 'uploads'),
      '/tmp/uploads',
    ].filter(Boolean) as string[];

    let filePath = '';
    let foundDir = '';

    for (const dir of possibleDirs) {
      const candidate = path.join(dir, safeName);
      if (fs.existsSync(candidate)) {
        filePath = candidate;
        foundDir = dir;
        break;
      }
    }

    // Si no se encontró, usar la ruta por defecto para el log
    if (!filePath) {
      filePath = path.join(possibleDirs[0], safeName);
      console.error(`[serve-upload] File not found. Searched in:`, possibleDirs);
      return new NextResponse('File not found', { status: 404 });
    }

    console.log(`[serve-upload] Serving ${safeName} from ${foundDir}`);

    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(safeName).toLowerCase();
    const contentType =
      ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
      ext === '.png' ? 'image/png' :
      ext === '.gif' ? 'image/gif' :
      ext === '.webp' ? 'image/webp' :
      ext === '.svg' ? 'image/svg+xml' :
      'application/octet-stream';

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error: any) {
    console.error('[serve-upload] ERROR:', error);
    return new NextResponse('Server error', { status: 500 });
  }
}
