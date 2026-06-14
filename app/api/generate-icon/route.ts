import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

export const dynamic = 'force-dynamic';

const ICON_REL = 'public/installer-icon.ico';
// Incluir 24x24 para compatibilidad con NSIS (wizard bitmaps)
const DEFAULT_SIZES = [16, 24, 32, 48, 128, 256];

/** Detecta si la ruta es absoluta de Windows (C:\, D:\, etc.) - no usable en servidor Linux/Vercel */
function isWindowsAbsolutePath(p: string): boolean {
  if (!p || typeof p !== 'string') return false;
  const trimmed = p.trim().replace(/^["']|["']$/g, '');
  return /^[A-Za-z]:[\\/]/.test(trimmed);
}

/**
 * Actualiza el package.json de la APLICACIÓN EDITADA (el proyecto en el explorador),
 * NUNCA el de Zeus. Añade referencias al icono para electron-builder.
 */
function updateProjectPackageJsonIcons(projectRoot: string): void {
  const resolvedProject = path.resolve(projectRoot);
  const resolvedCwd = path.resolve(process.cwd());
  if (resolvedProject === resolvedCwd) {
    console.log('[generate-icon] Omitiendo: projectRoot es el directorio de Zeus');
    return;
  }
  const pkgPath = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) return;
  try {
    const content = fs.readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(content);
    if (pkg.name === 'zeus') {
      console.log('[generate-icon] Omitiendo package.json de Zeus');
      return;
    }
    pkg.build = pkg.build || {};
    pkg.build.win = pkg.build.win || {};
    pkg.build.win.icon = ICON_REL;
    pkg.build.nsis = pkg.build.nsis || {};
    pkg.build.nsis.installerIcon = ICON_REL;
    pkg.build.nsis.uninstallerIcon = ICON_REL;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf-8');
    console.log('[generate-icon] package.json del proyecto actualizado con referencias al icono');
  } catch (e: any) {
    console.warn('[generate-icon] No se pudo actualizar package.json del proyecto:', e?.message);
  }

  const servePkgPath = path.join(projectRoot, 'serve', 'package.json');
  if (fs.existsSync(servePkgPath)) {
    try {
      const content = fs.readFileSync(servePkgPath, 'utf-8');
      const pkg = JSON.parse(content);
      if (pkg.name === 'zeus') return;
      pkg.build = pkg.build || {};
      pkg.build.win = pkg.build.win || {};
      pkg.build.win.icon = `../${ICON_REL}`;
      fs.writeFileSync(servePkgPath, JSON.stringify(pkg, null, 2), 'utf-8');
      console.log('[generate-icon] serve/package.json del proyecto actualizado');
    } catch (e: any) {
      console.warn('[generate-icon] No se pudo actualizar serve/package.json:', e?.message);
    }
  }
}

async function pngBufferToIco(pngBuffer: Buffer, sizes: number[]): Promise<Buffer> {
  const [sharp, pngToIco] = await Promise.all([
    import('sharp').then(m => m.default),
    import('png-to-ico').then(m => m.default),
  ]);
  const buffers: Buffer[] = [];
  for (const size of sizes) {
    const buf = await sharp(pngBuffer)
      .resize(size, size)
      .png()
      .toBuffer();
    buffers.push(buf);
  }
  return pngToIco(buffers);
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Error descargando: ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { mode, prompt, openaiApiKey, url, input, inputBase64, output = 'public/installer-icon.ico', sizes: sizesParam = '16,32,48,256', projectRoot, projectId, userToken } = body;

    const sizes = (typeof sizesParam === 'string' ? sizesParam.split(',').map(Number) : Array.isArray(sizesParam) ? sizesParam : DEFAULT_SIZES).filter((n: number) => n > 0) || DEFAULT_SIZES;

    let pngBuffer: Buffer;

    if (mode === 'prompt' && prompt) {
      if (!openaiApiKey?.trim()) {
        return NextResponse.json({ error: 'Indica tu API Key de OpenAI para DALL-E.' }, { status: 400 });
      }
      try {
        const OpenAI = (await import('openai')).default;
        const client = new OpenAI({ apiKey: openaiApiKey.trim() });
        const res = await client.images.generate({
          model: 'dall-e-3',
          prompt: prompt + '. App icon, square, transparent or solid background, professional.',
          n: 1,
          size: '1024x1024',
          quality: 'hd',
        });
        const imageUrl = res.data?.[0]?.url;
        if (!imageUrl) throw new Error('DALL-E no devolvió imagen');
        pngBuffer = await fetchBuffer(imageUrl);
      } catch (e: any) {
        return NextResponse.json({ error: e?.message || 'Error generando con DALL-E. ¿Tienes instalado el paquete openai?' }, { status: 500 });
      }
    } else if (mode === 'url' && url?.trim()) {
      try {
        pngBuffer = await fetchBuffer(url.trim());
      } catch (e: any) {
        return NextResponse.json({ error: e?.message || 'Error descargando la URL' }, { status: 500 });
      }
    } else if (mode === 'input') {
      if (inputBase64 && typeof inputBase64 === 'string') {
        const base64Data = inputBase64.replace(/^data:image\/\w+;base64,/, '');
        pngBuffer = Buffer.from(base64Data, 'base64');
      } else if (input && typeof input === 'string' && input.trim()) {
        const trimmedInput = input.trim();
        if (isWindowsAbsolutePath(trimmedInput)) {
          return NextResponse.json(
            { error: 'Las rutas de Windows (C:\\, D:\\...) no funcionan en el servidor. Usa el botón "Seleccionar PNG" para subir tu archivo.' },
            { status: 400 }
          );
        }
        const inputPath = path.isAbsolute(trimmedInput) ? trimmedInput : path.join(process.cwd(), trimmedInput);
        if (!fs.existsSync(inputPath)) {
          return NextResponse.json(
            { error: `Archivo no encontrado: ${trimmedInput}. En producción, usa el botón "Seleccionar PNG" para subir el archivo.` },
            { status: 404 }
          );
        }
        pngBuffer = fs.readFileSync(inputPath);
      } else {
        return NextResponse.json(
          { error: 'Indica la ruta del PNG o selecciona un archivo con el botón "Seleccionar PNG".' },
          { status: 400 }
        );
      }
    } else {
      return NextResponse.json(
        { error: 'Indica modo (prompt/url/input) y el valor correspondiente' },
        { status: 400 }
      );
    }

    const icoBuffer = await pngBufferToIco(pngBuffer, sizes);

    const cleanOutput = String(output).replace(/^[\u200B-\u200D\u202A-\u202E\u2060\uFEFF]+/, '').trim();

    let effectiveProjectRoot: string | null = projectRoot && typeof projectRoot === 'string' ? projectRoot : null;
    if ((!effectiveProjectRoot || !fs.existsSync(effectiveProjectRoot)) && projectId) {
      try {
        const { getProjectRoot } = await import('@/api/utils');
        effectiveProjectRoot = await getProjectRoot(projectId, effectiveProjectRoot || '');
      } catch (e: any) {
        console.warn('[generate-icon] No se pudo resolver projectRoot:', e?.message);
        effectiveProjectRoot = effectiveProjectRoot || null;
      }
    }

    const basePath = (effectiveProjectRoot && fs.existsSync(effectiveProjectRoot)) ? effectiveProjectRoot : process.cwd();
    const outPath = path.isAbsolute(cleanOutput) ? cleanOutput : path.join(basePath, cleanOutput);
    const outDir = path.dirname(outPath);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, icoBuffer);

    const shouldUpdatePackageJson = output.includes('installer-icon.ico');
    if (effectiveProjectRoot && fs.existsSync(effectiveProjectRoot) && shouldUpdatePackageJson) {
      updateProjectPackageJsonIcons(effectiveProjectRoot);
    }

    // Para proyectos de base de datos: actualizar el ZIP en PocketBase con icono Y package.json
    const isDbProject = projectId && typeof projectId === 'string' && !String(projectId).startsWith('local-');
    const fileUpdates: Array<{ filePath: string; content?: string; contentBase64?: string; isBinary?: boolean }> = [
      { filePath: 'public/installer-icon.ico', contentBase64: icoBuffer.toString('base64'), isBinary: true },
    ];

    // Añadir package.json actualizado para todos los modos (también URL y DALL-E)
    if (isDbProject && effectiveProjectRoot && shouldUpdatePackageJson) {
      const pkgPath = path.join(effectiveProjectRoot, 'package.json');
      const servePkgPath = path.join(effectiveProjectRoot, 'serve', 'package.json');
      if (fs.existsSync(pkgPath)) {
        try {
          const content = fs.readFileSync(pkgPath, 'utf-8');
          fileUpdates.push({ filePath: 'package.json', content });
        } catch (e: any) {
          console.warn('[generate-icon] No se pudo leer package.json para ZIP:', e?.message);
        }
      }
      if (fs.existsSync(servePkgPath)) {
        try {
          const content = fs.readFileSync(servePkgPath, 'utf-8');
          fileUpdates.push({ filePath: 'serve/package.json', content });
        } catch (e: any) {
          console.warn('[generate-icon] No se pudo leer serve/package.json para ZIP:', e?.message);
        }
      }
    }

    if (isDbProject) {
      try {
        const origin = new URL(request.url).origin;
        const updateRes = await fetch(`${origin}/api/update-zip-from-memory`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            userToken: userToken || null,
            fileUpdates,
          }),
        });
        const updateData = await updateRes.json();
        if (!updateRes.ok) {
          console.warn('[generate-icon] update-zip-from-memory falló:', updateData?.error || updateRes.statusText);
        } else {
          console.log('[generate-icon] Icono persistido en PocketBase:', updateData?.updatedFiles);
        }
      } catch (e: any) {
        console.warn('[generate-icon] Error actualizando ZIP en PocketBase:', e?.message || e);
      }
    }

    return NextResponse.json({ success: true, message: `Icono creado: ${outPath}`, output });
  } catch (err: any) {
    console.error('[generate-icon] Error:', err);
    return NextResponse.json({ error: err?.message || 'Error interno' }, { status: 500 });
  }
}
