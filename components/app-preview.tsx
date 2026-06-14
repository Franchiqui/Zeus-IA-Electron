'use client';

import { useState, useEffect, useCallback } from 'react';
import JSZip from 'jszip';

interface AppPreviewProps {
  zipUrl: string;
  appName: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function AppPreview({ zipUrl, appName, isOpen, onClose }: AppPreviewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [iframeSrc, setIframeSrc] = useState<string>('');

  const extractAndRender = useCallback(async () => {
    if (!zipUrl || !isOpen) return;

    setLoading(true);
    setError(null);
    setIframeSrc('');

    try {
      // Descargar el ZIP
      const response = await fetch(zipUrl);
      if (!response.ok) throw new Error(`No se pudo descargar el archivo ZIP (HTTP ${response.status})`);

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        throw new Error('El servidor devolvió una página HTML en lugar de un archivo ZIP. Verifica que la URL del archivo sea correcta.');
      }
      if (contentType.includes('application/json')) {
        throw new Error('El servidor devolvió JSON en lugar de un ZIP. El archivo puede estar protegido o no existir.');
      }

      const blob = await response.blob();
      if (blob.size === 0) {
        throw new Error('El archivo ZIP está vacío.');
      }
      if (blob.size < 4) {
        throw new Error('El archivo descargado es demasiado pequeño para ser un ZIP válido.');
      }

      // Extraer con JSZip
      const zip = await JSZip.loadAsync(blob);

      // Encontrar el archivo HTML de entrada (index.html o el primero .html)
      const files = Object.keys(zip.files);
      console.log('[AppPreview] Archivos en ZIP:', files);

      // Detectar código fuente sin compilar
      const hasPackageJson = files.some(f => f.toLowerCase().endsWith('package.json'));
      const hasSrcFolder = files.some(f => f.toLowerCase().startsWith('src/'));
      const hasBuildFolder = files.some(f => f.toLowerCase().startsWith('build/') || f.toLowerCase().startsWith('dist/'));
      const hasDotNext = files.some(f => f.startsWith('.next/'));
      if ((hasPackageJson || hasSrcFolder) && !hasBuildFolder) {
        throw new Error('Este ZIP parece ser código fuente (contiene package.json o src/). Sube solo la carpeta build/dist generada tras ejecutar "npm run build".');
      }
      if (hasDotNext) {
        throw new Error('Este ZIP contiene una carpeta .next/ (build interno de Next.js). Para previsualizar, configura output: "export" y distDir: "dist" en next.config.js, luego comprime la carpeta dist/.');
      }

      const htmlFile = files.find(f => f.toLowerCase().endsWith('index.html'))
        || files.find(f => f.toLowerCase().endsWith('.html'));

      if (!htmlFile) {
        throw new Error('No se encontró ningún archivo HTML en el ZIP. Archivos encontrados: ' + files.join(', '));
      }
      console.log('[AppPreview] HTML encontrado:', htmlFile);

      // Crear blob URLs para todos los archivos
      const blobMap = new Map<string, string>();

      await Promise.all(
        files.map(async (filename) => {
          const file = zip.files[filename];
          if (file.dir) return;

          const content = await file.async('uint8array');
          let mimeType = 'application/octet-stream';

          if (filename.endsWith('.html') || filename.endsWith('.htm')) mimeType = 'text/html';
          else if (filename.endsWith('.css')) mimeType = 'text/css';
          else if (filename.endsWith('.js')) mimeType = 'application/javascript';
          else if (filename.endsWith('.json')) mimeType = 'application/json';
          else if (filename.endsWith('.png')) mimeType = 'image/png';
          else if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) mimeType = 'image/jpeg';
          else if (filename.endsWith('.gif')) mimeType = 'image/gif';
          else if (filename.endsWith('.svg')) mimeType = 'image/svg+xml';
          else if (filename.endsWith('.webp')) mimeType = 'image/webp';
          else if (filename.endsWith('.woff')) mimeType = 'font/woff';
          else if (filename.endsWith('.woff2')) mimeType = 'font/woff2';
          else if (filename.endsWith('.ttf')) mimeType = 'font/ttf';
          else if (filename.endsWith('.otf')) mimeType = 'font/otf';

          const fileBlob = new Blob([content.slice()], { type: mimeType });
          const url = URL.createObjectURL(fileBlob);
          blobMap.set(filename, url);
        })
      );

      // Obtener el contenido HTML y reescribir rutas relativas
      const htmlFileObj = zip.files[htmlFile];
      let htmlContent = await htmlFileObj.async('text');

      // Reescribir rutas relativas en el HTML para apuntar a los blobs
      // href="./css/style.css" → href="blob:..."
      // src="./js/app.js" → src="blob:..."
      // url('./images/bg.png') → url('blob:...')

      const htmlDir = htmlFile.includes('/') ? htmlFile.substring(0, htmlFile.lastIndexOf('/') + 1) : '';

      const resolvePath = (ref: string): string | null => {
        if (!ref || ref.startsWith('http') || ref.startsWith('//') || ref.startsWith('blob:') || ref.startsWith('data:')) {
          return null;
        }
        // Quitar query strings y hashes
        const cleanRef = ref.split('?')[0].split('#')[0];
        // Resolver ruta relativa
        const parts = (htmlDir + cleanRef).split('/').filter(Boolean);
        const resolved: string[] = [];
        for (const part of parts) {
          if (part === '..') resolved.pop();
          else if (part !== '.') resolved.push(part);
        }
        const resolvedPath = resolved.join('/');
        return blobMap.has(resolvedPath) ? blobMap.get(resolvedPath)! : null;
      };

      // Reemplazar href="..."
      htmlContent = htmlContent.replace(
        /href\s*=\s*["']([^"']+)["']/gi,
        (match, p1) => {
          const resolved = resolvePath(p1);
          return resolved ? `href="${resolved}"` : match;
        }
      );

      // Reemplazar src="..."
      htmlContent = htmlContent.replace(
        /src\s*=\s*["']([^"']+)["']/gi,
        (match, p1) => {
          const resolved = resolvePath(p1);
          return resolved ? `src="${resolved}"` : match;
        }
      );

      // Reemplazar url(...) en CSS inline
      htmlContent = htmlContent.replace(
        /url\(["']?([^"')\s]+)["']?\)/gi,
        (match, p1) => {
          const resolved = resolvePath(p1);
          return resolved ? `url("${resolved}")` : match;
        }
      );

      // Añadir base target para que los enlaces no rompan el iframe
      const baseTag = `<base target="_blank">`;
      if (htmlContent.includes('<head>')) {
        htmlContent = htmlContent.replace('<head>', `<head>${baseTag}`);
      } else if (htmlContent.includes('<html>')) {
        htmlContent = htmlContent.replace('<html>', `<html><head>${baseTag}</head>`);
      } else {
        htmlContent = `<html><head>${baseTag}</head><body>${htmlContent}</body></html>`;
      }

      console.log('[AppPreview] HTML final (primeros 500 chars):', htmlContent.substring(0, 500));
      console.log('[AppPreview] Blob map:', Array.from(blobMap.keys()));

      // Create blob URL to avoid React script tag warnings
      const htmlBlob = new Blob([htmlContent], { type: 'text/html' });
      const blobUrl = URL.createObjectURL(htmlBlob);
      setIframeSrc(blobUrl);
    } catch (err: any) {
      console.error('Error en vista previa:', err);
      setError(err?.message || 'Error al cargar la vista previa');
    } finally {
      setLoading(false);
    }
  }, [zipUrl, isOpen]);

  useEffect(() => {
    if (isOpen) {
      extractAndRender();
    }
    return () => {
      // Limpiar blob URLs al cerrar
      if (iframeSrc && iframeSrc.startsWith('blob:')) {
        URL.revokeObjectURL(iframeSrc);
        setIframeSrc('');
      }
    };
  }, [isOpen, extractAndRender]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="relative w-full max-w-6xl h-[90vh] mx-4 bg-background rounded-xl shadow-2xl border border-border/50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-destructive"></div>
            <div className="w-3 h-3 rounded-full bg-warning"></div>
            <div className="w-3 h-3 rounded-full bg-green-500"></div>
            <h2 className="ml-2 text-sm font-semibold text-foreground/80 truncate max-w-md">
              {appName}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors p-1"
            title="Cerrar vista previa"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 relative overflow-hidden bg-white">
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-background">
              <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-destructive mb-4"></div>
              <p className="text-muted-foreground text-sm">Extrayendo y renderizando aplicación...</p>
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-background px-6">
              <svg className="h-16 w-16 text-destructive mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-destructive text-lg font-medium mb-2">Error al cargar la vista previa</p>
              <p className="text-muted-foreground/80 text-sm text-center max-w-md">{error}</p>
              <button
                onClick={extractAndRender}
                className="mt-4 px-4 py-2 bg-destructive hover:bg-red-700 text-foreground rounded-lg text-sm transition-colors"
              >
                Reintentar
              </button>
            </div>
          )}

          {iframeSrc && !loading && !error && (
            <iframe
              src={iframeSrc}
              title={`Vista previa de ${appName}`}
              className="w-full h-full border-0"
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            />
          )}
        </div>
      </div>
    </div>
  );
}
