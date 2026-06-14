'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Terminal as TerminalIcon, Trash2, RefreshCw, AlertCircle, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStore } from '@/lib/store';
import 'xterm/css/xterm.css';

interface ChatTerminalBubbleProps {
  isVisible: boolean;
  isMaximized?: boolean;
}

const ChatTerminalBubble = ({ isVisible, isMaximized = false }: ChatTerminalBubbleProps) => {
  const refreshExplorer = useStore((state) => state.refreshExplorer);
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermInstanceRef = useRef<any | null>(null);
  const fitAddonRef = useRef<any | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentDataPath, setCurrentDataPath] = useState<string>('');
  const [hasSelection, setHasSelection] = useState(false);
  const currentDataPathRef = useRef<string>('');
  const syncedCwdPathRef = useRef<string>('');
  const commandQueueRef = useRef<string[]>([]);

  const getBaseFolderName = (fullPath: string): string => {
    const normalized = String(fullPath || '').replace(/[\\/]+$/, '');
    if (!normalized) return 'data';
    const parts = normalized.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || 'data';
  };

  const copySelection = () => {
    console.log('copySelection called in chat terminal');
    if (xtermInstanceRef.current && xtermInstanceRef.current.hasSelection()) {
      const selection = xtermInstanceRef.current.getSelection();
      console.log('Selection text:', selection);
      if (selection) {
        navigator.clipboard.writeText(selection).then(() => {
          console.log('Text copied to clipboard successfully');
        }).catch((err) => {
          console.error('Error copying to clipboard:', err);
        });
      }
    } else {
      console.log('No selection found in chat terminal');
    }
  };

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    currentDataPathRef.current = currentDataPath;
  }, [currentDataPath]);

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

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const assignBaseDirName = (pathValue?: string | null) => {
      const source = pathValue || localStorage.getItem('ZEUS_DATA_PATH') || '';
      (window as any).chatTerminalBaseDirName = getBaseFolderName(source);
      if (source) {
        setCurrentDataPath(String(source));
        syncTerminalWorkingDirectory(source);
      }
    };

    const loadDataPath = async () => {
      try {
        const res = await fetch('/api/config/data-path');
        if (!res.ok) {
          assignBaseDirName();
          return;
        }
        const data = await res.json();
        assignBaseDirName(typeof data?.dataPath === 'string' ? data.dataPath : '');
      } catch {
        assignBaseDirName();
      }
    };

    loadDataPath();

    // Escuchar cambios de DATA_PATH desde el selector
    const handleDataPathChanged = () => {
      loadDataPath();
    };
    window.addEventListener('resetExplorerPath', handleDataPathChanged);
    return () => window.removeEventListener('resetExplorerPath', handleDataPathChanged);
  }, []);

  useEffect(() => {
    if (!isVisible) return;

    const refreshDataPath = async () => {
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
        }
      } catch {
        // silencioso: solo indicador visual
      }
    };

    refreshDataPath();
  }, [isVisible]);

  // REGISTRO AGRESIVO DE LA FUNCIÓN GLOBAL
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).isChatTerminalReady = false;

      const registerTerminal = () => {
        console.log('🚀 [TERMINAL-CHAT] Registrando como terminal principal');
        (window as any).executeTerminalCommand = (command: string, options?: { queueIfNotReady?: boolean }) => {
          const cmd = command.trim();
          if (socketRef.current?.readyState === WebSocket.OPEN) {
            console.log('✅ [TERMINAL-CHAT] Enviando:', cmd);
            // Usamos \r\n para máxima compatibilidad con PowerShell en Windows
            socketRef.current.send(cmd + '\r\n');

            // Refrescar explorador después de enviar comando (con delay para que de tiempo a crearse archivos)
            setTimeout(() => {
              console.log('🔄 [TERMINAL-CHAT] Refrescando explorador tras comando');
              refreshExplorer();
            }, 1500);

            return true;
          } else {
            if (options?.queueIfNotReady) {
              console.log('⏳ [TERMINAL-CHAT] Terminal no listo, encolando:', cmd);
              commandQueueRef.current.push(cmd);
            } else {
              console.log('⏳ [TERMINAL-CHAT] Terminal no listo, reintentar sin encolar:', cmd);
            }
            return false;
          }
        };
      };

      registerTerminal();
      // Re-registrar periódicamente por si el IDE nos pisa la función
      const interval = setInterval(registerTerminal, 2000);
      return () => {
        clearInterval(interval);
        (window as any).isChatTerminalReady = false;
      };
    }
  }, []);

  useEffect(() => {
    if (isConnected && socketRef.current?.readyState === WebSocket.OPEN && commandQueueRef.current.length > 0) {
      console.log(`📦 [TERMINAL-CHAT] Procesando cola: ${commandQueueRef.current.length} comandos`);
      while (commandQueueRef.current.length > 0) {
        const cmd = commandQueueRef.current.shift();
        if (cmd) {
          socketRef.current.send(cmd + '\r\n');
          // Refrescar tras vaciar cola
          setTimeout(() => refreshExplorer(), 2000);
        }
      }
    }
  }, [isConnected]);

  useEffect(() => {
    if (!isMounted || !terminalRef.current) return;

    let terminal: any;
    let fitAddon: any;
    let ws: WebSocket;

    const initTerminal = async () => {
      try {
        const { Terminal } = await import('xterm');
        const { FitAddon } = await import('xterm-addon-fit');

        if (!terminalRef.current) return;

        terminal = new Terminal({
          cursorBlink: true,
          fontSize: 11,
          fontFamily: 'JetBrains Mono, Consolas, monospace',
          convertEol: true,
          scrollback: 1000,
          theme: {
            background: '#000000',
            foreground: '#00ff00', // Verde matriz para visibilidad
            cursor: '#00ff00',
          },
          allowProposedApi: true
        });

        fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        terminal.open(terminalRef.current);
        
        xtermInstanceRef.current = terminal;
        fitAddonRef.current = fitAddon;

        const fitAndSyncTerminal = () => {
          fitAddon.fit();
          const dims = fitAddon.proposeDimensions();
          if (dims) {
            const safeCols = Math.max(2, Math.floor(Number(dims.cols)));
            const safeRows = Math.max(2, Math.floor(Number(dims.rows)));
            if (!Number.isFinite(safeCols) || !Number.isFinite(safeRows)) {
              terminal.scrollToBottom();
              return;
            }
            // Ajuste defensivo: en contenedores animados el cálculo de filas puede quedar alto
            // y ocultar las últimas líneas visuales. Restamos 2 filas para evitar clipping.
            const correctedRows = Math.max(2, safeRows - 2);
            if (terminal.cols !== safeCols || terminal.rows !== correctedRows) {
              terminal.resize(safeCols, correctedRows);
            }

            if (socketRef.current?.readyState === WebSocket.OPEN) {
              socketRef.current.send(JSON.stringify({ type: 'zeus-resize', cols: safeCols, rows: correctedRows }));
            }
          }
          terminal.scrollToBottom();
        };

        const connect = () => {
          const wsUrl = 'ws://localhost:3351';
          ws = new WebSocket(wsUrl);
          socketRef.current = ws;

          ws.onopen = () => {
            setIsConnected(true);
            setError(null);
            if (typeof window !== 'undefined') {
              (window as any).isChatTerminalReady = true;
            }
            terminal.write('\x1b[32m[SISTEMA] Zeus Terminal Conectado\x1b[0m\r\n');
            const targetPath = currentDataPathRef.current || localStorage.getItem('ZEUS_DATA_PATH') || '';
            if (targetPath) {
              setTimeout(() => syncTerminalWorkingDirectory(targetPath, { silent: true, force: true }), 80);
            }
            setTimeout(() => fitAndSyncTerminal(), 220);
            // Refits adicionales tras la transición del contenedor para evitar recortes en altura normal
            setTimeout(() => fitAndSyncTerminal(), 620);
            setTimeout(() => fitAndSyncTerminal(), 980);
          };

          ws.onmessage = (event) => {
            try {
              const msg = JSON.parse(event.data);
              if (msg.type === 'output') {
                terminal.write(msg.data);
                terminal.scrollToBottom();
              }
            } catch (e) {
              terminal.write(event.data);
              terminal.scrollToBottom();
            }
          };

          ws.onclose = () => {
            setIsConnected(false);
            syncedCwdPathRef.current = '';
            if (typeof window !== 'undefined') {
              (window as any).isChatTerminalReady = false;
            }
            console.log('Terminal cerrada, reintentando...');
            setTimeout(() => { if (isMounted) connect(); }, 3000);
          };

          ws.onerror = (err) => {
            setIsConnected(false);
            if (typeof window !== 'undefined') {
              (window as any).isChatTerminalReady = false;
            }
            setError('Error de conexión con el servidor de terminal');
          };

          terminal.onData((data: string) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(data);
          });

          // Detectar selección de texto
          terminal.onSelectionChange(() => {
            const hasSel = terminal.hasSelection();
            console.log('ChatTerminal selection changed, hasSelection:', hasSel);
            setHasSelection(hasSel);
          });
        };

        connect();

        const handleResize = () => {
          if (fitAddon) {
            fitAndSyncTerminal();
          }
        };

        const ro = new ResizeObserver(() => handleResize());
        ro.observe(terminalRef.current);
        window.addEventListener('resize', handleResize);

        return () => {
          window.removeEventListener('resize', handleResize);
          ro.disconnect();
          terminal.dispose();
          ws.close();
        };
      } catch (e) {
        console.error(e);
        setError('Error al cargar xterm.js');
      }
    };

    initTerminal();
  }, [isMounted]);

  useEffect(() => {
    if (isVisible && fitAddonRef.current && xtermInstanceRef.current) {
      const fitAndSyncVisible = () => {
        fitAddonRef.current?.fit();
        const dims = fitAddonRef.current?.proposeDimensions?.();
        if (dims && xtermInstanceRef.current) {
          const safeCols = Math.max(2, Math.floor(Number(dims.cols)));
          const safeRows = Math.max(2, Math.floor(Number(dims.rows)));
          if (!Number.isFinite(safeCols) || !Number.isFinite(safeRows)) {
            xtermInstanceRef.current?.scrollToBottom();
            return;
          }

          const correctedRows = Math.max(2, safeRows - 2);
          if (xtermInstanceRef.current.cols !== safeCols || xtermInstanceRef.current.rows !== correctedRows) {
            xtermInstanceRef.current.resize(safeCols, correctedRows);
          }
          if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({ type: 'zeus-resize', cols: safeCols, rows: correctedRows }));
          }
        }
        xtermInstanceRef.current?.scrollToBottom();
      };

      setTimeout(() => {
        fitAndSyncVisible();
        xtermInstanceRef.current?.focus();
      }, 320);
      // Segundo ajuste cuando termina la animación de apertura
      setTimeout(() => {
        fitAndSyncVisible();
      }, 650);
      // Ajuste final para layouts lentos
      setTimeout(() => {
        fitAndSyncVisible();
      }, 980);
    }
  }, [isVisible]);

  return (
    <div className={cn(
      "w-full max-w-[610px] flex flex-col overflow-hidden rounded-xl border-2 transition-all duration-500 shadow-[0_0_20px_rgba(0,0,0,0.5)] relative",
      isVisible 
        ? (isMaximized ? "opacity-100 h-[350px] max-h-[54vh] my-4 border-emerald-500/30" : "opacity-100 h-[285px] max-h-[42vh] my-4 border-border/80") 
        : "opacity-0 h-0 overflow-hidden border-transparent pointer-events-none"
    )} style={{ backgroundColor: '#000000' }}>
      
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 shrink-0 border-b border-white/10 bg-background">
        <div className="flex items-center gap-3">
          <TerminalIcon className="w-4 h-4 text-success" />
          <span className="text-[10px] font-black text-success uppercase tracking-widest">Zeus</span>
          {isConnected ? (
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-success/10 text-[8px] font-bold text-success border border-emerald-500/20">
              <span className="w-1 h-1 rounded-full bg-success animate-ping"></span> ONLINE
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-full bg-rose-500/10 text-[8px] font-bold text-rose-400 border border-rose-500/20">OFFLINE</span>
          )}
        </div>
        <div className="flex gap-2">
          {hasSelection && (
            <button onClick={copySelection} className="p-1 hover:bg-white/10 rounded text-muted-foreground/80" title="Copiar selección">
              <Copy className="w-3 h-3" />
            </button>
          )}
          <button onClick={() => socketRef.current?.close()} className="p-1 hover:bg-white/10 rounded text-muted-foreground/80"><RefreshCw className="w-3 h-3" /></button>
          <button onClick={() => xtermInstanceRef.current?.clear()} className="p-1 hover:bg-white/10 rounded text-muted-foreground/80"><Trash2 className="w-3 h-3" /></button>
        </div>
      </div>

      {/* Error Overlay */}
      {error && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2 text-rose-400">
            <AlertCircle className="w-8 h-8" />
            <span className="text-[10px] font-bold uppercase">{error}</span>
            <button onClick={() => window.location.reload()} className="mt-2 text-[9px] underline opacity-70">Recargar aplicación</button>
          </div>
        </div>
      )}

      {/* Terminal Canvas */}
      <div className="flex-1 bg-background p-2 relative">
        <style jsx global>{`
          .xterm-viewport::-webkit-scrollbar {
            width: 3px !important;
            height: 3px !important;
          }
          .xterm-viewport::-webkit-scrollbar-track {
            background: transparent !important;
          }
          .xterm-viewport::-webkit-scrollbar-thumb {
            background: rgba(255,255,255,0.15) !important;
            border-radius: 2px !important;
          }
          .xterm-viewport::-webkit-scrollbar-thumb:hover {
            background: rgba(255,255,255,0.25) !important;
          }
        `}</style>
        <div ref={terminalRef} className="w-full h-full" />
      </div>
    </div>
  );
};

export default ChatTerminalBubble;
