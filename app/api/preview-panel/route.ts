import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), 'serve', 'public', 'index.html');
    const content = fs.readFileSync(filePath, 'utf8');
    return new NextResponse(content, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (error: any) {
    console.error('[preview-panel] Error leyendo serve/public/index.html:', error.message);
    return new NextResponse(
      `<html><body style="background:#111827;color:#e5e7eb;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
        <div style="text-align:center;">
          <h2 style="color:#fbbf24;">Panel de control no disponible</h2>
          <p style="color:#9ca3af;">No se encontró serve/public/index.html</p>
        </div>
      </body></html>`,
      { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}
