'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

const PREVIEW_SERVER_URL = 'http://localhost:8744';
const POLL_INTERVAL = 3000;
const MAX_POLL_ATTEMPTS = 120; // 6 minutos

interface AppPreviewServerProps {
  zipUrl: string;
  appName: string;
  isOpen: boolean;
  onClose: () => void;
  /**
   * ID estable de la app (ej. id de PocketBase). Si se pasa, se usa como
   * `existingProjectId` para que el servidor pueda matchear correctamente
   * con DELETE /api/project/:id y limpie el proyecto anterior.
   * Si no se pasa, se genera un id aleatorio (compatibilidad con usos antiguos).
   */
  appId?: string;
  /**
   * Callback opcional que notifica al padre del estado final del preview.
   * - 'ready'  -> la preview llegó a estar lista (para aplicar cooldown)
   * - 'error'  -> la preview falló
   * - 'closed' -> el usuario cerró antes de llegar a ready/error
   */
  onCompleted?: (status: 'ready' | 'error' | 'closed') => void;
}

export default function AppPreviewServer({ zipUrl, appName, isOpen, onClose, appId, onCompleted }: AppPreviewServerProps) {
  const [phase, setPhase] = useState<'idle' | 'downloading' | 'uploading' | 'building' | 'ready' | 'error'>('idle');
  const [progressMsg, setProgressMsg] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const projectIdRef = useRef<string>('');
  const hasOpenedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const onCompletedRef = useRef(onCompleted);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const pocketBaseStoppedRef = useRef(false);
  const finalStatusRef = useRef<'ready' | 'error' | 'closed' | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
    onCompletedRef.current = onCompleted;
  }, [onClose, onCompleted]);

  const reset = useCallback(() => {
    if (pollRef.current) clearTimeout(pollRef.current);
    if (abortRef.current) abortRef.current.abort();
    setPhase('idle');
    setProgressMsg('');
    setPreviewUrl('');
    setErrorMsg('');
    setIsFullscreen(false);
    pocketBaseStoppedRef.current = false;
  }, []);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => !prev);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      reset();
      return;
    }

    let cancelled = false;
    abortRef.current = new AbortController();

    // 0. Limpiar la carpeta current-project ANTES de subir el ZIP
    //    para que el preview server siempre trabaje sobre un directorio vacío.
    const resetPromise: Promise<any> = (typeof window !== 'undefined' &&
      (window as any).electronAPI?.library?.resetCurrentProject)
      ? (window as any).electronAPI.library.resetCurrentProject()
          .then((r: any) => console.log('[PreviewServer] Carpeta current-project limpiada:', r))
          .catch((resetErr: any) => console.warn('[PreviewServer] No se pudo limpiar current-project:', resetErr))
      : Promise.resolve();

    async function run() {
      try {
        // 1. Descargar ZIP desde PocketBase (PocketBase debe estar vivo aquí)
        setPhase('downloading');
        setProgressMsg('Descargando aplicación...');
        const zipResp = await fetch(zipUrl, { signal: abortRef.current!.signal });
        if (cancelled) return;
        if (!zipResp.ok) throw new Error(`No se pudo descargar el ZIP: HTTP ${zipResp.status}`);
        const zipBlob = await zipResp.blob();

        // 2. Subir al preview server
        setPhase('uploading');
        setProgressMsg('Enviando al servidor de vista previa...');
        const formData = new FormData();
        formData.append('zipFile', zipBlob, `${appName}.zip`);
        // Usar appId estable si está disponible; si no, generar uno único
        formData.append('existingProjectId', appId || `app-library-${Date.now()}`);

        const uploadResp = await fetch(`${PREVIEW_SERVER_URL}/api/upload`, {
          method: 'POST',
          body: formData,
          signal: abortRef.current!.signal,
        });

        if (cancelled) return;
        if (!uploadResp.ok) {
          const text = await uploadResp.text().catch(() => '');
          throw new Error(`El servidor de preview respondió ${uploadResp.status}: ${text}`);
        }

        const uploadData = await uploadResp.json();
        const projectId = uploadData.projectId;
        if (!projectId) throw new Error('El servidor no devolvió un projectId');
        projectIdRef.current = projectId;

        // 2.b Detener PocketBase de App Library SOLO DESPUÉS de subir el ZIP.
        // El ZIP se descarga desde PocketBase en el paso 1, así que no podemos
        // detenerlo antes. Ahora que ya está en el preview server, podemos
        // liberar la base de datos para que la app del preview use su propio
        // PocketBase sin colisión.
        if (typeof window !== 'undefined' && (window as any).electronAPI?.pocketbase?.stop) {
          console.log('[PreviewServer] Deteniendo PocketBase de App Library...');
          try {
            await (window as any).electronAPI.pocketbase.stop();
            pocketBaseStoppedRef.current = true;
          } catch (pbStopErr) {
            console.warn('[PreviewServer] No se pudo detener PocketBase:', pbStopErr);
          }
        }

        // 3. Polling de estado
        setPhase('building');
        setProgressMsg('Instalando dependencias y compilando... Esto puede tardar unos minutos la primera vez.');

        let attempts = 0;
        const checkStatus = async () => {
          if (cancelled) return;
          attempts++;

          try {
            const statusResp = await fetch(`${PREVIEW_SERVER_URL}/api/project-status/${projectId}`, {
              signal: abortRef.current!.signal,
            });
            if (cancelled) return;
            if (!statusResp.ok) {
              if (attempts >= MAX_POLL_ATTEMPTS) {
                throw new Error('Tiempo de espera agotado. El servidor no respondió a tiempo.');
              }
              pollRef.current = setTimeout(checkStatus, POLL_INTERVAL);
              return;
            }

            const status = await statusResp.json();
            if (cancelled) return;

            if (status.status === 'ready' && status.url) {
              setPreviewUrl(status.url);
              setPhase('ready');
              setProgressMsg('');
              finalStatusRef.current = 'ready';
              return;
            }

            if (status.status === 'error') {
              throw new Error(status.error || 'Error desconocido en el servidor de preview');
            }

            if (attempts >= MAX_POLL_ATTEMPTS) {
              throw new Error('Tiempo de espera agotado. El servidor no pudo preparar la vista previa.');
            }

            // Aún construyendo
            setProgressMsg(`Construyendo... (${attempts}/${MAX_POLL_ATTEMPTS})`);
            pollRef.current = setTimeout(checkStatus, POLL_INTERVAL);
          } catch (err: any) {
            if (err.name === 'AbortError') return;
            throw err;
          }
        };

        await checkStatus();
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        console.error('[PreviewServer] Error:', err);
        setPhase('error');
        setErrorMsg(err?.message || 'Error inesperado al cargar la vista previa');
        finalStatusRef.current = 'error';
      }
    }

    resetPromise.finally(() => {
      run();
    });

    return () => {
      cancelled = true;
      const pid = projectIdRef.current;
      // Capturar el estado final ANTES de reset() (que limpia flags y phase)
      const reachedReady = finalStatusRef.current === 'ready';
      const reachedError = finalStatusRef.current === 'error';
      // Si nunca llegó a ready ni error, fue un cierre
      if (!reachedReady && !reachedError) {
        finalStatusRef.current = 'closed';
      }
      const finalStatus = finalStatusRef.current;
      const pbWasStopped = pocketBaseStoppedRef.current;
      reset();

      const restartPb = () => {
        // Solo reiniciar PocketBase si lo detuvimos nosotros.
        // Si nunca llegamos a detenerlo (ej. fallo en descarga), reiniciarlo
        // podría matar un proceso que aún se está usando.
        if (!pbWasStopped) return;
        if (typeof window !== 'undefined' && (window as any).electronAPI?.pocketbase?.start) {
          console.log('[PreviewServer] Reiniciando PocketBase de App Library...');
          (window as any).electronAPI.pocketbase.start().catch((err: any) => {
            console.warn('[PreviewServer] Error reiniciando PocketBase:', err);
          });
        }
      };

      // Detener el proyecto preview antes de reiniciar PocketBase de App Library
      if (pid) {
        fetch(`${PREVIEW_SERVER_URL}/api/project/${pid}`, { method: 'DELETE' })
          .then(() => {
            console.log('[PreviewServer] Proyecto preview detenido.');
            // Limpiar carpeta current-project al cerrar la preview
            if (typeof window !== 'undefined' && (window as any).electronAPI?.library?.resetCurrentProject) {
              (window as any).electronAPI.library.resetCurrentProject()
                .then((r: any) => console.log('[PreviewServer] current-project limpiada al cerrar:', r))
                .catch((e: any) => console.warn('[PreviewServer] No se pudo limpiar current-project al cerrar:', e));
            }
            restartPb();
          })
          .catch((err) => {
            console.warn('[PreviewServer] Error deteniendo proyecto preview:', err);
            // Aun así limpiar current-project en caso de error
            if (typeof window !== 'undefined' && (window as any).electronAPI?.library?.resetCurrentProject) {
              (window as any).electronAPI.library.resetCurrentProject().catch(() => {});
            }
            restartPb();
          })
          .finally(() => {
            // Notificar al padre del estado final (después de la limpieza)
            if (finalStatus && onCompletedRef.current) {
              try { onCompletedRef.current(finalStatus); } catch (_) { /* noop */ }
            }
            finalStatusRef.current = null;
          });
      } else {
        // Sin pid: aun así limpiamos current-project por si quedó algo
        if (typeof window !== 'undefined' && (window as any).electronAPI?.library?.resetCurrentProject) {
          (window as any).electronAPI.library.resetCurrentProject().catch(() => {});
        }
        restartPb();
        if (finalStatus && onCompletedRef.current) {
          try { onCompletedRef.current(finalStatus); } catch (_) { /* noop */ }
          finalStatusRef.current = null;
        }
      }
    };
  }, [isOpen, zipUrl, appName, appId, reset]);

  // Reset hasOpened when modal opens
  useEffect(() => {
    if (isOpen) {
      hasOpenedRef.current = false;
    }
  }, [isOpen]);

  // Cuando la preview está lista, mostrar en iframe
  useEffect(() => {
    if (phase === 'ready' && previewUrl && !hasOpenedRef.current) {
      hasOpenedRef.current = true;
      // NO abrir en nueva pestaña automáticamente - mostrar en iframe
    }
  }, [phase, previewUrl]);

  if (!isOpen) return null;

  const isLoading = phase !== 'ready' && phase !== 'error';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className={`relative w-full max-w-[95vw] h-[92vh] mx-4 bg-background rounded-xl shadow-2xl border border-border/50 flex flex-col overflow-hidden transition-all duration-300 ${isFullscreen ? 'fixed inset-0 max-w-none h-full mx-0 my-0 rounded-none border-0' : ''}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 shrink-0 relative z-20 bg-background">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-destructive"></div>
            <div className="w-3 h-3 rounded-full bg-warning"></div>
            <div className="w-3 h-3 rounded-full bg-green-500"></div>
            <h2 className="ml-2 text-sm font-semibold text-foreground/80 truncate max-w-md">
              {phase === 'ready' ? appName : `Preparando: ${appName}`}
            </h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => previewUrl && window.open(previewUrl, '_blank')}
              disabled={!previewUrl}
              className="text-muted-foreground hover:text-foreground transition-colors p-1 mr-2 disabled:opacity-30 disabled:cursor-not-allowed z-10"
              title="Abrir en nueva pestaña"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </button>
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
        <div className="flex-1 relative bg-card">
          {isLoading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-background z-10">
              <div className="animate-spin rounded-full h-14 w-14 border-t-2 border-b-2 border-destructive mb-6"></div>
              <p className="text-foreground text-lg font-medium mb-2">
                {phase === 'downloading' && 'Descargando aplicación...'}
                {phase === 'uploading' && 'Enviando al servidor...'}
                {phase === 'building' && 'Compilando proyecto...'}
              </p>
              <p className="text-muted-foreground text-sm max-w-md text-center px-4">{progressMsg}</p>
              <p className="text-muted-foreground/60 text-xs mt-4">No cierres esta ventana</p>
            </div>
          )}

          {phase === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-background z-10 px-6">
              <svg className="h-16 w-16 text-destructive mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-destructive text-lg font-medium mb-2">Error al cargar la vista previa</p>
              <p className="text-muted-foreground/80 text-sm text-center max-w-lg">{errorMsg}</p>
              <div className="mt-4 text-muted-foreground/60 text-xs text-center max-w-md">
                Asegúrate de que el servidor de preview esté corriendo en <strong>http://localhost:8744</strong>
              </div>
            </div>
          )}

          {phase === 'ready' && previewUrl && (
            <iframe
              ref={iframeRef}
              src={previewUrl}
              title={`Vista previa de ${appName}`}
              className="w-full h-full border-0 bg-card"
              // Color de fondo mientras el iframe carga: gris medio para que
              // combine con el tema oscuro de Zeus y evitar el flash blanco.
              style={{ backgroundColor: '#1f2937' }}
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals"
            />
          )}
        </div>
      </div>
    </div>
  );
}
