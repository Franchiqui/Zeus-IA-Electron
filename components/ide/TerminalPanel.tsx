'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Terminal as TerminalIcon,
  RefreshCw,
  Wifi,
  WifiOff,
  Copy,
  Smartphone,
  Hammer,
  Package,
  Download
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEditor } from '@/context/editor-context';
import { useStore } from '@/lib/store';
import { useTranslation } from '@/contexts/translation-context';

export default function TerminalPanel({ explorerPath: propExplorerPath }: { explorerPath?: string }) {
  const { t } = useTranslation();
  const refreshExplorer = useStore((state) => state.refreshExplorer);
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermInstanceRef = useRef<any | null>(null);
  const fitAddonRef = useRef<any | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [currentDataPath, setCurrentDataPath] = useState('');
  const [hasSelection, setHasSelection] = useState(false);
  const [isMobileProject, setIsMobileProject] = useState(false);
  const [isElectronProject, setIsElectronProject] = useState(false);
  const [isBuildingApk, setIsBuildingApk] = useState(false);
  const [apkDownloadUrl, setApkDownloadUrl] = useState<string | null>(null);
  const [isCopyingApkUrl, setIsCopyingApkUrl] = useState(false);
  const currentDataPathRef = useRef('');
  const syncedCwdPathRef = useRef('');

  const { askZeus } = useEditor();

  const getBaseFolderName = (fullPath: string): string => {
    const normalized = String(fullPath || '').replace(/[\\/]+$/, '');
    if (!normalized) return 'data';
    const parts = normalized.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || 'data';
  };

  const syncTerminalWorkingDirectory = (pathValue?: string | null, options?: { silent?: boolean; force?: boolean }) => {
    const nextPath = String(pathValue || '').trim();
    if (!nextPath) return;
    if (!options?.force && syncedCwdPathRef.current === nextPath) return;
    if (socketRef.current?.readyState !== WebSocket.OPEN) return;

    const escapedPath = nextPath.replace(/'/g, "''");
    if (options?.silent) {
      socketRef.current.send(`Set-Location -LiteralPath '${escapedPath}'; Clear-Host\r\n`);
    } else {
      socketRef.current.send(`Set-Location -LiteralPath '${escapedPath}'\r\n`);
    }
    syncedCwdPathRef.current = nextPath;
  };

  // Detectar si el proyecto es móvil (Capacitor/Ionic/Cordova) o de escritorio (Electron)
  const checkedPathsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const checkProjectType = async () => {
      const rawExplorerPath = propExplorerPath || localStorage.getItem('zeus_current_explorer_path') || '';
      const explorerPath = rawExplorerPath.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');

      if (!explorerPath) {
        setIsMobileProject(false);
        setIsElectronProject(false);
        return;
      }

      // Si ya comprobamos este path, no repetir
      if (checkedPathsRef.current.has(explorerPath)) return;

      const pathsToCheck = [explorerPath];
      const pathParts = explorerPath.split('/').filter(Boolean);
      for (let up = 1; up < Math.min(pathParts.length, 5); up++) {
        pathsToCheck.push(pathParts.slice(0, pathParts.length - up).join('/'));
      }

      let foundMobile = false;
      let foundElectron = false;

      for (const candidatePath of pathsToCheck) {
        try {
          const res = await fetch(`/api/ide-files?name=package.json&path=${encodeURIComponent(candidatePath)}`);
          if (!res.ok) continue;
          const data = await res.json();
          if (data.success && data.content) {
            const pkg = typeof data.content === 'string' ? JSON.parse(data.content) : data.content;
            const deps = Object.keys(pkg.dependencies || {});
            const devDeps = Object.keys(pkg.devDependencies || {});
            const allDeps = [...deps, ...devDeps];
            const scripts = Object.keys(pkg.scripts || {});

            if (!foundMobile) {
              const isMobile =
                allDeps.includes('@capacitor/core') ||
                allDeps.includes('@capacitor/android') ||
                allDeps.includes('@capacitor/ios') ||
                allDeps.includes('capacitor') ||
                allDeps.includes('@ionic/core') ||
                allDeps.includes('@ionic/angular') ||
                allDeps.includes('@ionic/react') ||
                allDeps.includes('@ionic/vue') ||
                allDeps.includes('cordova') ||
                scripts.some((k: string) =>
                  k.startsWith('cap') ||
                  k.includes('apk') ||
                  k.includes('android') ||
                  k.includes('ionic') ||
                  k.includes('mobile')
                );
              if (isMobile) foundMobile = true;
            }

            if (!foundElectron) {
              const isElectron = allDeps.includes('electron') ||
                allDeps.includes('electron-builder') ||
                scripts.some((k: string) => k.includes('electron') || k.includes('dist') || k.includes('builder'));
              if (isElectron) foundElectron = true;
            }

            if (foundMobile && foundElectron) break;
          }
        } catch {
          // Silenciar errores de búsqueda (archivo no encontrado es esperable)
        }
      }

      checkedPathsRef.current.add(explorerPath);
      setIsMobileProject(foundMobile);
      setIsElectronProject(foundElectron);
    };

    checkProjectType();
  }, [propExplorerPath]);

  const sendTerminalCommand = (cmd: string) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(`${cmd}\r\n`);
    }
  };

  const handleAddAndroid = () => {
    sendTerminalCommand('npx cap add android');
  };

  const handleCapSync = () => {
    sendTerminalCommand('npx cap sync android');
  };

  const handleBuildApkLocal = () => {
    sendTerminalCommand('npm run build');
    setTimeout(() => sendTerminalCommand('npx cap copy android'), 2000);
    setTimeout(() => sendTerminalCommand('cmd /c "cd android && gradlew.bat assembleDebug"'), 4000);
  };

  const handleBuildApkViaAPI = async () => {
    setIsBuildingApk(true);
    setApkDownloadUrl(null);
    try {
      const dataPath = currentDataPathRef.current || localStorage.getItem('ZEUS_DATA_PATH') || '';
      const explorerPath = localStorage.getItem('zeus_current_explorer_path') || '';
      const fullProjectPath = explorerPath ? `${dataPath}/${explorerPath}`.replace(/\/+/g, '/') : dataPath;

      const res = await fetch('/api/build-apk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath: fullProjectPath })
      });
      const data = await res.json();
      if (data.success && data.apkPath) {
        const url = `/api/download-apk?project=${encodeURIComponent(data.apkPath)}`;
        setApkDownloadUrl(url);
      } else {
        console.error('[Build APK] Server error:', data.error || data);
      }
    } catch (err) {
      console.error('Error building APK:', err);
    } finally {
      setIsBuildingApk(false);
    }
  };

  const handleRunAndroid = () => {
    sendTerminalCommand('npx cap run android');
  };

  const handleElectronDist = () => {
    sendTerminalCommand('npm run dist');
  };

  const handleElectronBuilder = () => {
    sendTerminalCommand('npm run electron:build:win');
  };

  const handleElectronDev = () => {
    sendTerminalCommand('npm run electron:dev');
  };

  const handleCopyApkUrl = async () => {
    if (!apkDownloadUrl) return;
    setIsCopyingApkUrl(true);
    try {
      await navigator.clipboard.writeText(window.location.origin + apkDownloadUrl);
    } catch {
      // ignore
    } finally {
      setIsCopyingApkUrl(false);
    }
  };

  // Marcar como montado en el cliente
  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    currentDataPathRef.current = currentDataPath;
  }, [currentDataPath]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const loadDataPath = async () => {
      try {
        const res = await fetch('/api/config/data-path');
        if (!res.ok) return;
        const data = await res.json();
        if (typeof data?.dataPath === 'string' && data.dataPath.trim()) {
          const latestPath = data.dataPath.trim();
          setCurrentDataPath(latestPath);
          (window as any).chatTerminalBaseDirName = getBaseFolderName(latestPath);
          localStorage.setItem('ZEUS_DATA_PATH', latestPath);
          syncTerminalWorkingDirectory(latestPath);
          return;
        }
      } catch {
        // fallback local
      }

      const cached = localStorage.getItem('ZEUS_DATA_PATH');
      if (cached) {
        setCurrentDataPath(cached);
        (window as any).chatTerminalBaseDirName = getBaseFolderName(cached);
      }
    };

    loadDataPath();

    // Recargar DATA_PATH cuando se cambia desde el selector
    const handleDataPathChanged = () => {
      loadDataPath();
    };
    window.addEventListener('resetExplorerPath', handleDataPathChanged);
    return () => window.removeEventListener('resetExplorerPath', handleDataPathChanged);
  }, []);

  // Inicializar terminal cuando esté montado y el ref esté disponible
  useEffect(() => {
    if (!isMounted || !terminalRef.current) return;

    let terminal: any;
    let fitAddon: any;
    let ws: WebSocket;

    const initTerminal = async () => {
      try {
        // Importación dinámica de xterm.js
        const { Terminal } = await import('xterm');
        const { FitAddon } = await import('xterm-addon-fit');
        await import('xterm/css/xterm.css');
        
        if (!terminalRef.current) return;

        terminal = new Terminal({
          cursorBlink: true,
          fontSize: 13,
          fontFamily: 'Consolas, "Courier New", monospace',
          convertEol: true, // Esto ayuda con el posicionamiento del cursor
          theme: {
            background: '#000000',
            foreground: '#cccccc',
            cursor: '#ffffff',
            selectionBackground: 'rgba(255, 255, 255, 0.3)',
          },
          allowProposedApi: true
        });

        fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        
        // Abrir antes de ajustar
        terminal.open(terminalRef.current);
        
        // Pequeño retardo para asegurar que el DOM esté listo antes de fit()
        setTimeout(() => {
          if (fitAddon) fitAddon.fit();
        }, 100);

        xtermInstanceRef.current = terminal;
        fitAddonRef.current = fitAddon;

        const connect = () => {
          const wsUrl = 'ws://localhost:3351';
          ws = new WebSocket(wsUrl);
          socketRef.current = ws;

          ws.onopen = () => {
            setIsConnected(true);
            // Eliminamos el mensaje de bienvenida para que el prompt suba al inicio
            const targetPath = currentDataPathRef.current || localStorage.getItem('ZEUS_DATA_PATH') || '';
            if (targetPath) {
              setTimeout(() => syncTerminalWorkingDirectory(targetPath, { silent: true, force: true }), 80);
            }
            
            // Sincronizar dimensiones inmediatamente
            if (fitAddon) {
              fitAddon.fit();
              const dims = fitAddon.proposeDimensions();
              if (dims) {
                ws.send(JSON.stringify({
                  type: 'zeus-resize',
                  cols: dims.cols,
                  rows: dims.rows
                }));
              }
            }
          };

          ws.onmessage = (event) => {
            try {
              const msg = JSON.parse(event.data);
              if (msg.type === 'output') {
                terminal.write(msg.data);
              }
            } catch (e) {
              terminal.write(event.data);
            }
          };

          ws.onclose = (event) => {
            setIsConnected(false);
            syncedCwdPathRef.current = '';
            if (terminal) {
              if (event.code === 1006) {
                terminal.writeln(`\n\x1b[1;31m${t('terminalWsError')}\x1b[0m`);
                terminal.writeln(`\x1b[1;33m${t('terminalWsPortHint')}\x1b[0m`);
              } else {
                terminal.writeln(`\n\x1b[1;31m${t('terminalWsClosed')}\x1b[0m`);
              }
            }
            // Reintento automático más lento para no saturar
            setTimeout(() => {
              if (isMounted) connect();
            }, 10000);
          };

          ws.onerror = (err) => {
            setIsConnected(false);
            console.error('Terminal WebSocket Error:', err);
          };

          terminal.onData((data: string) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(data);
              
              // Si el usuario presiona Enter (\r o \n), refrescar el explorador con un delay
              if (data === '\r' || data === '\n' || data.includes('\r')) {
                setTimeout(() => {
                  console.log('🔄 [TERMINAL-IDE] Refrescando explorador tras Enter');
                  refreshExplorer();
                }, 2000);
              }
            }
          });

          // Detectar selección de texto
          terminal.onSelectionChange(() => {
            const hasSel = terminal.hasSelection();
            console.log('Terminal selection changed, hasSelection:', hasSel);
            setHasSelection(hasSel);
          });
        };

        connect();

        const handleResize = () => {
          if (fitAddon && socketRef.current?.readyState === WebSocket.OPEN) {
            fitAddon.fit();
            const dims = fitAddon.proposeDimensions();
            if (dims) {
              socketRef.current.send(JSON.stringify({
                type: 'zeus-resize',
                cols: dims.cols,
                rows: dims.rows
              }));
            }
          }
        };

        const resizeObserver = new ResizeObserver(() => {
          handleResize();
        });
        
        if (terminalRef.current) {
          resizeObserver.observe(terminalRef.current);
        }

        window.addEventListener('resize', handleResize);
        
        return () => {
          window.removeEventListener('resize', handleResize);
          resizeObserver.disconnect();
          if (terminal) terminal.dispose();
          if (socketRef.current) socketRef.current.close();
        };
      } catch (error) {
        console.error('Error inicializando terminal:', error);
      }
    };

    const cleanupResize = initTerminal();

    return () => {
      if (terminal) terminal.dispose();
      if (ws) ws.close();
      window.removeEventListener('resize', () => {});
    };
  }, [isMounted]);

  const refreshTerminal = () => {
    if (socketRef.current) {
      socketRef.current.close();
    }
  };

  const clearTerminal = () => {
    if (xtermInstanceRef.current) {
      xtermInstanceRef.current.clear();
    }
  };

  const copySelection = () => {
    console.log('copySelection called, has terminal:', !!xtermInstanceRef.current);
    if (xtermInstanceRef.current && xtermInstanceRef.current.hasSelection()) {
      const selection = xtermInstanceRef.current.getSelection();
      console.log('Selection text:', selection);
      if (selection) {
        // Intentar API moderna primero
        navigator.clipboard.writeText(selection).catch(() => {
          // Fallback: usar execCommand con un textarea temporal
          const ta = document.createElement('textarea');
          ta.value = selection;
          ta.style.position = 'fixed';
          ta.style.left = '-9999px';
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          try {
            document.execCommand('copy');
            console.log('Text copied via fallback');
          } catch (e) {
            console.error('Fallback copy also failed:', e);
          }
          document.body.removeChild(ta);
        });
      }
    } else {
      console.log('No selection found');
    }
  };

  const handleSendTerminalToZeus = () => {
    if (!xtermInstanceRef.current) return;
    const term = xtermInstanceRef.current;
    term.selectAll();
    const content = term.getSelection();
    term.clearSelection();
    if (!content || !content.trim()) return;
    const prompt = t('terminalSendToZeusPrompt').replace('{content}', content);
    askZeus(prompt);
  };

  // Durante SSR o antes de montar, renderizar un placeholder con el mismo diseño
  if (!isMounted) {
    return (
      <div className="flex flex-col h-full bg-background border-t border-border/80 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-1 bg-background/80 border-b border-border/80 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <TerminalIcon className="h-4 w-4" />
              <span className="text-xs font-bold uppercase tracking-wider">{t('terminalTitle')}</span>
            </div>
          </div>
        </div>
        <div className="flex-1 bg-background" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background border-t border-border/80 overflow-hidden">
      <style jsx global>{`
        .xterm-viewport::-webkit-scrollbar {
          width: 0px !important;
          display: none !important;
        }
        .xterm-viewport {
          -ms-overflow-style: none !important;
          scrollbar-width: none !important;
        }
      `}</style>
      <div className="flex items-center justify-between px-4 py-1 bg-background/80 border-b border-border/80 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <TerminalIcon className="h-4 w-4 text-primary" />
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('terminalTitle')}</span>
          </div>
          <div className={cn(
            "flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] text-[10px] font-bold uppercase",
            isConnected ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
          )}>
            {isConnected ? <Wifi className="w-2.5 h-2.5" /> : <WifiOff className="w-2.5 h-2.5" />}
            {isConnected ? t('terminalLive') : t('terminalOffline')}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Botones de Capacitor (solo apps móviles) */}
          {isMobileProject && (
            <>
              <button
                onClick={handleAddAndroid}
                className="px-2 py-0.5 text-[10px] bg-green-800 hover:bg-green-700 rounded flex items-center gap-1 text-foreground transition-colors"
                title={t('terminalTooltipAddAndroid')}
              >
                <Smartphone className="w-3 h-3" />
                <span>{t('terminalAddAndroid')}</span>
              </button>
              <button
                onClick={handleCapSync}
                className="px-2 py-0.5 text-[10px] bg-primary hover:bg-primary/80 rounded flex items-center gap-1 text-foreground transition-colors"
                title={t('terminalTooltipSync')}
              >
                <RefreshCw className="w-3 h-3" />
                <span>{t('terminalSync')}</span>
              </button>
              <button
                onClick={handleBuildApkLocal}
                className="px-2 py-0.5 text-[10px] bg-amber-800 hover:bg-amber-700 rounded flex items-center gap-1 text-foreground transition-colors"
                title={t('terminalTooltipBuildApkLocal')}
              >
                <Hammer className="w-3 h-3" />
                <span>{t('terminalBuildApk')}</span>
              </button>
              <button
                onClick={handleBuildApkViaAPI}
                disabled={isBuildingApk}
                className="px-2 py-0.5 text-[10px] bg-rose-800 hover:bg-rose-700 rounded flex items-center gap-1 text-foreground transition-colors disabled:opacity-50"
                title={t('terminalTooltipBuildApkApi')}
              >
                <Package className="w-3 h-3" />
                <span>{isBuildingApk ? t('terminalBuilding') : t('terminalBuildApkApi')}</span>
              </button>
              <button
                onClick={handleRunAndroid}
                className="px-2 py-0.5 text-[10px] bg-purple-800 hover:bg-purple-700 rounded flex items-center gap-1 text-foreground transition-colors"
                title={t('terminalTooltipRunAndroid')}
              >
                <Smartphone className="w-3 h-3" />
                <span>{t('terminalRunAndroid')}</span>
              </button>
              {apkDownloadUrl && (
                <>
                  <a
                    href={apkDownloadUrl}
                    download
                    className="px-2 py-0.5 text-[10px] bg-emerald-800 hover:bg-emerald-700 rounded flex items-center gap-1 text-foreground no-underline transition-colors"
                    title={t('terminalTooltipDownloadApk')}
                  >
                    <Download className="w-3 h-3" />
                    <span>{t('terminalDownload')}</span>
                  </a>
                </>
              )}
              <div className="w-px h-4 bg-muted mx-1" />
            </>
          )}
          {/* Botones de Electron (solo apps de escritorio) */}
          {isElectronProject && (
            <>
              <button
                onClick={handleElectronDev}
                className="px-2 py-0.5 text-[10px] bg-indigo-800 hover:bg-indigo-700 rounded flex items-center gap-1 text-foreground transition-colors"
                title={t('terminalTooltipDev')}
              >
                <Smartphone className="w-3 h-3" />
                <span>{t('terminalDev')}</span>
              </button>
              <button
                onClick={handleElectronDist}
                className="px-2 py-0.5 text-[10px] bg-sky-800 hover:bg-sky-700 rounded flex items-center gap-1 text-foreground transition-colors"
                title={t('terminalTooltipDist')}
              >
                <Package className="w-3 h-3" />
                <span>{t('terminalDist')}</span>
              </button>
              <button
                onClick={handleElectronBuilder}
                className="px-2 py-0.5 text-[10px] bg-cyan-800 hover:bg-cyan-700 rounded flex items-center gap-1 text-foreground transition-colors"
                title={t('terminalTooltipBuilder')}
              >
                <Hammer className="w-3 h-3" />
                <span>{t('terminalBuilder')}</span>
              </button>
              <div className="w-px h-4 bg-muted mx-1" />
            </>
          )}
          {hasSelection && (
            <button onClick={copySelection} className="p-1 hover:bg-card rounded text-muted-foreground/80 hover:text-foreground transition-colors" title={t('terminalTooltipCopySelection')}>
              <Copy className="w-3.5 h-3.5" />
            </button>
          )}
          <button onClick={refreshTerminal} className="p-1 hover:bg-card rounded text-muted-foreground/80 hover:text-foreground transition-colors" title={t('terminalTooltipRestartSession')}>
            <img src="/iconos/reiniciar.png" alt={t('terminalTooltipRestartSession')} className="w-4 h-4 object-contain" />
          </button>
          <button onClick={handleSendTerminalToZeus} className="p-1 hover:bg-card rounded text-muted-foreground/80 hover:text-foreground transition-colors" title={t('terminalTooltipSendToZeus')}>
            <img src="/iconos/enviar.png" alt={t('terminalTooltipSendToZeus')} className="w-4 h-4 object-contain" />
          </button>
          <button onClick={clearTerminal} className="p-1 hover:bg-card rounded text-muted-foreground/80 hover:text-foreground transition-colors" title={t('terminalTooltipClearScreen')}>
            <img src="/iconos/limpiar.png" alt={t('terminalTooltipClearScreen')} className="w-4 h-4 object-contain" />
          </button>
        </div>
      </div>

      <div className="flex-1 relative min-h-0 bg-background">
        <div ref={terminalRef} className="absolute inset-0 p-0.5" />
      </div>
    </div>
  );
}
