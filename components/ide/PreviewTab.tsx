'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Eye, Loader2, AlertCircle, RefreshCw, Square } from 'lucide-react';
import { useStore } from '@/lib/store';

export default function PreviewTab() {
  const previewUrl = useStore((s) => s.previewUrl);
  const setPreviewUrl = useStore((s) => s.setPreviewUrl);
  const isAppPreview = Boolean(previewUrl);
  const url = previewUrl || '/api/preview-panel';
  const [isLoading, setIsLoading] = useState(() => {
    if (!isAppPreview) return false;
    const last = typeof window !== 'undefined' ? localStorage.getItem('zeus_preview_last_url') : null;
    return last !== url;
  });
  const [hasError, setHasError] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Cuando cambia la URL, resetear estado solo si es una URL diferente a la última cargada
  useEffect(() => {
    const last = typeof window !== 'undefined' ? localStorage.getItem('zeus_preview_last_url') : null;
    if (last === url) {
      setIsLoading(false);
      return;
    }
    setIsLoading(isAppPreview);
    setHasError(false);

    if (!isAppPreview) return;

    // Si después de 15 segundos el iframe aún no cargó, mostrar error
    const errorTimeout = setTimeout(() => {
      setIsLoading(false);
      // Solo marcar error si el iframe aún no ha cargado
      setHasError((current) => {
        if (current) return current;
        // Verificar si el iframe realmente cargó algo
        try {
          const iframe = iframeRef.current;
          if (iframe && iframe.contentWindow && iframe.contentWindow.location.href !== 'about:blank') {
            return false;
          }
        } catch {
          // Cross-origin, asumir que cargó
          return false;
        }
        return true;
      });
    }, 15000);

    return () => clearTimeout(errorTimeout);
  }, [url, isAppPreview]);

  const handleRefresh = () => {
    setIsChecking(true);
    setIsLoading(true);
    setHasError(false);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('zeus_preview_last_url');
    }
    // Forzar recarga del iframe cambiando su src
    const iframe = iframeRef.current;
    if (iframe) {
      iframe.src = url;
    }
    setTimeout(() => setIsChecking(false), 1000);
  };

  // Recargar preview cuando el modelo modifica archivos (zeus:file-changed → zeus:preview-reload)
  useEffect(() => {
    const handlePreviewReload = () => {
      const iframe = iframeRef.current;
      if (iframe && url) {
        setIsLoading(true);
        setHasError(false);
        iframe.src = url;
      }
    };
    window.addEventListener('zeus:preview-reload', handlePreviewReload);
    return () => window.removeEventListener('zeus:preview-reload', handlePreviewReload);
  }, [url]);

  return (
    <div className="h-full w-full flex flex-col bg-transparent">
      {/* Barra de herramientas del preview */}
      <div className="flex items-center justify-between px-4 h-10 bg-background border-b border-border/80">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Eye className="w-3.5 h-3.5 text-primary" />
          <span className="font-medium">{isAppPreview ? 'Preview' : 'Panel de control'}</span>
          {isAppPreview && (
            <>
              <span className="text-muted-foreground/60">|</span>
              <code className="text-success bg-card px-1.5 py-0.5 rounded text-[10px]">{url}</code>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasError && (
            <span className="text-[10px] text-amber-400 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              Error al cargar
            </span>
          )}
          {isAppPreview && (
            <button
              onClick={() => {
              setPreviewUrl(null);
              if (typeof window !== 'undefined') {
                localStorage.removeItem('zeus_preview_last_url');
              }
            }}
              className="p-1.5 rounded hover:bg-card text-destructive hover:text-red-300 transition-colors"
              title="Detener preview y volver al panel de control"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={handleRefresh}
            disabled={isChecking}
            className="p-1.5 rounded hover:bg-card text-muted-foreground/80 hover:text-foreground/70 transition-colors"
            title="Recargar"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Contenido */}
      <div className="flex-1 relative overflow-hidden">
        {isLoading && !hasError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-background z-10">
            <Loader2 className="w-8 h-8 text-primary animate-spin mb-3" />
            <p className="text-sm text-muted-foreground">Cargando vista previa...</p>
            <p className="text-xs text-muted-foreground/60 mt-1">{url}</p>
            <p className="text-xs text-muted-foreground/80 mt-2 max-w-xs text-center">
              Si acabas de iniciar el proyecto, puede tardar unos segundos en compilar.
            </p>
          </div>
        )}

        {hasError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-background z-10 p-8">
            <AlertCircle className="w-12 h-12 text-amber-400 mb-4" />
            <h3 className="text-lg font-semibold text-foreground/80 mb-2">No se pudo cargar la vista previa</h3>
            <p className="text-sm text-muted-foreground text-center max-w-md mb-4">
              El servidor no respondió en <code className="text-success">{url}</code>.
            </p>
            <div className="space-y-2 text-xs text-muted-foreground/80 text-left bg-background p-4 rounded-lg border border-border/80 max-w-md">
              <p className="font-medium text-muted-foreground">Posibles soluciones:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Espera unos segundos y presiona recargar (el servidor puede estar compilando).</li>
                <li>Verifica el terminal del IDE para ver si hay errores de compilación.</li>
                <li>Asegúrate de que el proyecto tiene un script <code className="text-primary">dev</code> en package.json.</li>
              </ul>
              <div className="flex gap-2 mt-3">
                <input
                  type="text"
                  defaultValue={url}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const val = (e.target as HTMLInputElement).value.trim();
                      if (val) setPreviewUrl(val);
                    }
                  }}
                  className="flex-1 bg-card border border-border/50 rounded px-2 py-1 text-xs text-foreground/80 focus:outline-none focus:border-primary"
                  placeholder="http://localhost:3000"
                />
                <button
                  onClick={() => {
                    const input = document.querySelector('input[type="text"]') as HTMLInputElement;
                    if (input?.value.trim()) setPreviewUrl(input.value.trim());
                  }}
                  className="px-3 py-1 bg-primary hover:bg-primary text-foreground text-xs rounded transition-colors"
                >
                  Ir
                </button>
              </div>
            </div>
          </div>
        )}

        <iframe
          ref={iframeRef}
          src={url}
          className="w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
          allow="fullscreen; clipboard-write; autoplay"
          onLoad={() => {
            setIsLoading(false);
            setHasError(false);
            if (typeof window !== 'undefined') {
              localStorage.setItem('zeus_preview_last_url', url);
            }
          }}
          title="Preview"
        />
      </div>
    </div>
  );
}
