'use client';

import { useTerminal } from '@/context/TerminalContext';
import { useEditor } from '@/context/editor-context';
import { useProject } from '@/context/ProjectContext';
import { useAuth } from '@/context/AuthContext';
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Comic_Neue } from 'next/font/google';
import { Terminal as TerminalIcon, Wifi, WifiOff, ChevronUp, ChevronDown, RefreshCw, Package, Play, Navigation, Monitor, X, Maximize2, Minimize2, Folder, Home, HardDrive, Smartphone, Hammer, Wrench, Download, Copy, Send } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getPreviewServerUrl } from '@/utils/preview-server-url';
import { fetchTunnelUrlFromAPI } from '@/utils/fetch-tunnel-url';

const terminalFont = Comic_Neue({
  subsets: ['latin'],
  weight: '300'
});

export default function Terminal() {
  const {
    isOpen,
    messages,
    executeCommand,
    isConnected,
    toggleTerminal,
    sendRawMessage,
    refreshTerminal,
    addLocalMessage,
    isSyncing
  } = useTerminal();
  
  const {
    projectRoot,
    projectId,
    files
  } = useProject();
  
  const {
    toast
  } = useToast();
  
  const {
    user
  } = useAuth();
  
  const {
    editorWidth,
    askZeus
  } = useEditor();
  
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(400);
  const [isResizing, setIsResizing] = useState(false);
  const [isAddingAndroid, setIsAddingAndroid] = useState(false);
  const [isBuildingApk, setIsBuildingApk] = useState(false);
  const [isCopyingApkUrl, setIsCopyingApkUrl] = useState(false);
  const [apkDownloadUrl, setApkDownloadUrl] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [hasNavigatedToRoot, setHasNavigatedToRoot] = useState(false);

  // Detectar tipo de app por archivos del proyecto
  const { isMobileApp, isDesktopApp } = useMemo(() => {
    const pkg = files['package.json'] || '';
    const fileKeys = Object.keys(files);
    const hasCapacitor = pkg.includes('@capacitor') || fileKeys.some(k => k.includes('capacitor.config'));
    const hasElectron = pkg.includes('electron:dev') || pkg.includes('electron:build') || fileKeys.some(k => k.includes('electron/main'));
    return {
      isMobileApp: !!hasCapacitor,
      isDesktopApp: !!hasElectron
    };
  }, [files]);

  const isZeusDesktop = typeof window !== 'undefined' && !!(window as any).electron;

  const resolvePreviewServerUrl = useCallback(async () => {
    let previewServerUrl = getPreviewServerUrl();
    if (user?.token) {
      const tunnelUrl = await fetchTunnelUrlFromAPI(user.token);
      if (tunnelUrl) {
        previewServerUrl = tunnelUrl;
      }
    }
    return previewServerUrl;
  }, [user?.token]);

  // Hacer scroll al final de los mensajes cuando se añadan nuevos
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Enfocar el input cuando se abre el terminal
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  // Ejecutar comandos de Linux al conectar
  useEffect(() => {
    if (isConnected && messages.length <= 3 && !hasNavigatedToRoot) {
      // Ejecutar comandos informativos de Linux después de conectar
      setTimeout(() => {
        executeCommand('echo Sistema Operativo: Linux');
      }, 500);
      
      setTimeout(() => {
        executeCommand('pwd');
      }, 1000);
      
      setTimeout(() => {
        executeCommand('ls -la');
      }, 1500);
      
      setTimeout(() => {
        executeCommand('uname -a');
      }, 2000);
      
      setHasNavigatedToRoot(true);
    }
  }, [isConnected, executeCommand, messages.length, hasNavigatedToRoot]);

  // Resetear el flag de navegación cuando se desconecta
  useEffect(() => {
    if (!isConnected) {
      setHasNavigatedToRoot(false);
    }
  }, [isConnected]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const command = inputValue.trim();
    if (command) {
      executeCommand(command);
      setInputValue('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      handleSubmit(e);
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      executeCommand('clear');
    } else if (e.key === 'c' && e.ctrlKey) {
      // Si hay texto seleccionado en cualquier parte (especialmente el historial)
      const selection = window.getSelection()?.toString();
      if (selection && selection.length > 0) {
        // Forzamos la copia al portapapeles manualmente
        navigator.clipboard.writeText(selection);
        return; // Salimos sin ejecutar el comando de interrupción
      }
      
      e.preventDefault();
      addLocalMessage({ text: '^C', type: 'input' });
      sendRawMessage('\x03'); // Enviar Ctrl+C al terminal
    }
  };

  const handleSyncFiles = useCallback(async () => {
    if (!projectRoot) {
      toast({
        title: 'Error',
        description: 'No hay proyecto activo para sincronizar',
        variant: 'destructive'
      });
      return;
    }
    
    addLocalMessage({ text: '🔄 Sincronizando archivos con el servidor...', type: 'info' });
    
    try {
      const projectId = projectRoot.split('/').pop() || projectRoot.split('\\').pop();
      const filesToSync = Object.entries(files).map(([path, content]) => ({
        path,
        content
      }));
      
      // TEMPORAL: Skip sync entirely
      console.log('[TERMINAL] Manual sync temporarily disabled');
      addLocalMessage({ text: '⚠️ Sincronización temporalmente deshabilitada', type: 'warn' });
      
      toast({
        title: 'Sync Disabled',
        description: 'File synchronization is temporarily disabled',
        variant: 'default'
      });
    } catch (error) {
      console.error('Error sincronizando archivos:', error);
      addLocalMessage({ text: '❌ Error al sincronizar archivos', type: 'error' });
      toast({
        title: 'Error',
        description: 'No se pudieron sincronizar los archivos',
        variant: 'destructive'
      });
    }
  }, [projectRoot, files, toast, addLocalMessage]);

  const handleQuickCommand = (command: string) => {
    setInputValue(command);
    executeCommand(command);
  };

  const handleAddAndroid = () => {
    setIsAddingAndroid(true);
    addLocalMessage({ text: '📱 Añadiendo plataforma Android...', type: 'info' });
    executeCommand('npx cap add android');
    setTimeout(() => setIsAddingAndroid(false), 3000);
  };

  const handleCapSync = () => {
    addLocalMessage({ text: '🔄 Sincronizando Capacitor con Android...', type: 'info' });
    executeCommand('npx cap sync android');
  };

  const handleBuildApk = () => {
    setIsBuildingApk(true);
    addLocalMessage({ text: '🔨 Construyendo APK...', type: 'info' });
    executeCommand('npm run build-apk');
    setTimeout(() => setIsBuildingApk(false), 5000);
  };

  const handleBuildApkViaAPI = async () => {
    setIsBuildingApk(true);
    setApkDownloadUrl(null);
    addLocalMessage({ text: '🔨 Iniciando construcción de APK vía servidor...', type: 'info' });
    try {
      const res = await fetch('http://localhost:8744/api/build-apk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath: projectRoot || '' })
      });
      const data = await res.json();
      if (data.success && data.apkPath) {
        const downloadUrl = `http://localhost:8744/api/download-apk?project=${encodeURIComponent(data.apkPath)}`;
        setApkDownloadUrl(downloadUrl);
        addLocalMessage({ text: `✅ APK construido correctamente. Tamaño: ${(data.fileSize / 1024 / 1024).toFixed(2)} MB`, type: 'success' });
        addLocalMessage({ text: `📥 URL de descarga: ${downloadUrl}`, type: 'info' });
        toast({ title: 'APK listo', description: 'El APK se construyó correctamente. Usa el botón de descarga.', variant: 'default' });
      } else {
        addLocalMessage({ text: `❌ Error al construir APK: ${data.error || 'Error desconocido'}`, type: 'error' });
        toast({ title: 'Error APK', description: data.error || 'No se pudo construir el APK', variant: 'destructive' });
      }
    } catch (err: any) {
      addLocalMessage({ text: `❌ Error de red: ${err.message}`, type: 'error' });
      toast({ title: 'Error de red', description: err.message, variant: 'destructive' });
    } finally {
      setIsBuildingApk(false);
    }
  };

  const handleCopyApkUrl = async () => {
    if (!apkDownloadUrl) return;
    setIsCopyingApkUrl(true);
    try {
      await navigator.clipboard.writeText(window.location.origin + apkDownloadUrl);
      toast({ title: 'URL copiada', description: 'La URL de descarga del APK se ha copiado al portapapeles.', variant: 'default' });
    } catch {
      toast({ title: 'Error', description: 'No se pudo copiar la URL.', variant: 'destructive' });
    } finally {
      setIsCopyingApkUrl(false);
    }
  };

  const handleOpenAndroid = () => {
    addLocalMessage({ text: '🚀 Abriendo Android Studio...', type: 'info' });
    executeCommand('npx cap open android');
  };

  const handleNavigateToRoot = () => {
    executeCommand('cd /');
    addLocalMessage({ text: '📁 Navegando al directorio raíz /', type: 'info' });
  };

  const handleNavigateToHome = () => {
    executeCommand('cd ~');
    addLocalMessage({ text: '🏠 Navegando al directorio home', type: 'info' });
  };

  const handleNavigateToTmp = () => {
    executeCommand('cd /tmp');
    addLocalMessage({ text: '📁 Navegando al directorio temporal /tmp', type: 'info' });
  };

  const handleSendTerminalToZeus = () => {
    if (!messages.length) return;
    const content = messages
      .map((m) => `[${m.type.toUpperCase()}] ${m.text}`)
      .join('\n');
    const prompt = `Analiza la siguiente salida del terminal y ayúdame a entenderla o solucionar cualquier problema:\n\n${content}`;
    askZeus(prompt);
    addLocalMessage({ text: '🤖 Contenido del terminal enviado a Zeus', type: 'info' });
  };

  if (!isOpen) {
    return (
      <div className="fixed bottom-0 right-4 z-50">
        <button
          onClick={() => toggleTerminal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-card hover:bg-muted text-foreground rounded-t-lg shadow-lg"
          title="Abrir terminal"
        >
          <TerminalIcon className="h-4 w-4" />
          <span>Terminal</span>
          {!isConnected && <span className="w-2 h-2 bg-destructive rounded-full animate-pulse"></span>}
        </button>
      </div>
    );
  }

  return (
    <div 
      ref={terminalRef}
      className={`fixed bottom-0 left-0 right-0 z-50 flex flex-col transition-all duration-300 ${
        isExpanded ? 'top-0' : ''
      }`}
      style={{
        height: isExpanded ? '100vh' : `${height}px`,
        backgroundColor: '#0a0a0a',
        borderTop: '1px solid #333'
      }}
    >
      {/* Barra superior */}
      <div className="flex items-center justify-between px-4 py-2 bg-background border-b border-border/80">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <TerminalIcon className="h-5 w-5 text-green-400" />
            <span className="text-foreground font-medium">Terminal Linux</span>
          </div>
          
          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${
              isConnected 
                ? 'bg-green-900/30 text-green-400' 
                : 'bg-red-900/30 text-destructive'
            }`}>
              {isConnected ? (
                <>
                  <Wifi className="h-3 w-3" />
                  <span>Conectado</span>
                </>
              ) : (
                <>
                  <WifiOff className="h-3 w-3" />
                  <span>Desconectado</span>
                </>
              )}
            </div>
            
            {/* Indicador de sistema operativo */}
            <div className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-primary/30 text-primary">
              <span className="text-xs">🐧</span>
              <span>Linux</span>
            </div>
            
            {isSyncing && (
              <div className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-purple-900/30 text-accent">
                <RefreshCw className="h-3 w-3 animate-spin" />
                <span>Sincronizando...</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Botones de comandos rápidos */}
          <div className="flex items-center gap-1 mr-4">
            <button
              onClick={handleNavigateToRoot}
              className="px-2 py-1 text-xs bg-primary hover:bg-primary rounded flex items-center gap-1"
              title="Navegar al directorio raíz /"
            >
              <HardDrive className="h-3 w-3" />
              <span>/</span>
            </button>
            <button
              onClick={handleNavigateToHome}
              className="px-2 py-1 text-xs bg-purple-800 hover:bg-purple-700 rounded flex items-center gap-1"
              title="Navegar al directorio home ~"
            >
              <Home className="h-3 w-3" />
              <span>~</span>
            </button>
            <button
              onClick={handleNavigateToTmp}
              className="px-2 py-1 text-xs bg-card hover:bg-muted rounded flex items-center gap-1"
              title="Navegar al directorio temporal /tmp"
            >
              <Folder className="h-3 w-3" />
              <span>/tmp</span>
            </button>
            <button
              onClick={() => handleQuickCommand('pwd')}
              className="px-2 py-1 text-xs bg-card hover:bg-muted rounded"
              title="Mostrar directorio actual"
            >
              pwd
            </button>
            <button
              onClick={() => handleQuickCommand('ls -la')}
              className="px-2 py-1 text-xs bg-card hover:bg-muted rounded"
              title="Listar archivos (Linux)"
            >
              ls -la
            </button>
            <button
              onClick={() => handleQuickCommand('clear')}
              className="px-2 py-1 text-xs bg-card hover:bg-muted rounded"
              title="Limpiar pantalla (Linux)"
            >
              clear
            </button>
          </div>

          {/* Botones de Capacitor (solo apps móviles) */}
          {isMobileApp && (
            <div className="flex items-center gap-1 mr-4">
              <button
                onClick={handleAddAndroid}
                disabled={isAddingAndroid}
                className="px-2 py-1 text-xs bg-green-800 hover:bg-green-700 rounded flex items-center gap-1 disabled:opacity-50"
                title="Añadir plataforma Android (npx cap add android)"
              >
                <Smartphone className="h-3 w-3" />
                <span>{isAddingAndroid ? 'Añadiendo...' : 'Add Android'}</span>
              </button>
              <button
                onClick={handleCapSync}
                className="px-2 py-1 text-xs bg-primary hover:bg-primary rounded flex items-center gap-1"
                title="Sincronizar Capacitor (npx cap sync android)"
              >
                <RefreshCw className="h-3 w-3" />
                <span>Sync</span>
              </button>
              <button
                onClick={handleBuildApk}
                disabled={isBuildingApk}
                className="px-2 py-1 text-xs bg-amber-800 hover:bg-amber-700 rounded flex items-center gap-1 disabled:opacity-50"
                title="Construir APK local (npm run build-apk)"
              >
                <Hammer className="h-3 w-3" />
                <span>{isBuildingApk ? 'Building...' : 'Build APK'}</span>
              </button>
              <button
                onClick={handleBuildApkViaAPI}
                disabled={isBuildingApk}
                className="px-2 py-1 text-xs bg-rose-800 hover:bg-rose-700 rounded flex items-center gap-1 disabled:opacity-50"
                title="Construir APK vía servidor y obtener URL de descarga"
              >
                <Package className="h-3 w-3" />
                <span>{isBuildingApk ? 'Building...' : 'Build APK (API)'}</span>
              </button>
              <button
                onClick={handleOpenAndroid}
                className="px-2 py-1 text-xs bg-purple-800 hover:bg-purple-700 rounded flex items-center gap-1"
                title="Abrir Android Studio (npx cap open android)"
              >
                <Wrench className="h-3 w-3" />
                <span>Open Android</span>
              </button>
              {apkDownloadUrl && (
                <>
                  <a
                    href={apkDownloadUrl}
                    download
                    className="px-2 py-1 text-xs bg-emerald-800 hover:bg-emerald-700 rounded flex items-center gap-1 text-foreground no-underline"
                    title="Descargar APK"
                  >
                    <Download className="h-3 w-3" />
                    <span>Descargar APK</span>
                  </a>
                  <button
                    onClick={handleCopyApkUrl}
                    disabled={isCopyingApkUrl}
                    className="px-2 py-1 text-xs bg-card hover:bg-muted rounded flex items-center gap-1 disabled:opacity-50"
                    title="Copiar URL de descarga"
                  >
                    <Copy className="h-3 w-3" />
                    <span>{isCopyingApkUrl ? 'Copiado!' : 'Copiar URL'}</span>
                  </button>
                </>
              )}
            </div>
          )}

          <button
            onClick={refreshTerminal}
            className="p-1.5 hover:bg-card rounded"
            title="Reconectar terminal"
          >
            <RefreshCw className="h-4 w-4" />
          </button>

          <button
            onClick={handleSyncFiles}
            className="p-1.5 hover:bg-card rounded"
            title="Sincronizar archivos"
            disabled={isSyncing}
          >
            <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin text-accent' : 'text-primary'}`} />
          </button>

          <button
            onClick={handleSendTerminalToZeus}
            className="p-1.5 hover:bg-card rounded"
            title="Enviar contenido del terminal a Zeus"
          >
            <Send className="h-4 w-4 text-cyan-400" />
          </button>

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 hover:bg-card rounded"
            title={isExpanded ? "Restaurar tamaño" : "Maximizar"}
          >
            {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>

          <button
            onClick={() => toggleTerminal(false)}
            className="p-1.5 hover:bg-card rounded"
            title="Cerrar terminal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Barra de redimensionamiento */}
      <div
        className="h-1 w-full bg-card cursor-ns-resize hover:bg-primary"
        onMouseDown={(e) => {
          e.preventDefault();
          setIsResizing(true);
          const startY = e.clientY;
          const startHeight = height;

          const onMouseMove = (moveEvent: MouseEvent) => {
            const delta = startY - moveEvent.clientY;
            const newHeight = Math.max(200, Math.min(window.innerHeight - 100, startHeight + delta));
            setHeight(newHeight);
          };

          const onMouseUp = () => {
            setIsResizing(false);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
          };

          document.addEventListener('mousemove', onMouseMove);
          document.addEventListener('mouseup', onMouseUp, { once: true });
        }}
      />

      {/* Contenido del terminal */}
      <div className={`flex-1 overflow-hidden ${terminalFont.className}`}>
        <div className="h-full overflow-y-auto p-4 font-mono text-sm">
          {messages.map((msg, index) => (
            <div
              key={index}
              className={`whitespace-pre-wrap break-words mb-1 ${
                msg.type === 'error' ? 'text-destructive' :
                msg.type === 'success' ? 'text-green-400' :
                msg.type === 'warn' ? 'text-warning' :
                msg.type === 'info' ? 'text-cyan-400' :
                msg.type === 'input' ? 'text-accent font-semibold' :
                'text-foreground/70'
              }`}
            >
              {msg.text}
            </div>
          ))}
          
          {/* Línea de entrada */}
          <div className="flex items-center mt-4">
            <span className="text-green-400 mr-2">$</span>
            <form onSubmit={handleSubmit} className="flex-1">
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full bg-transparent outline-none text-foreground caret-green-400"
                placeholder="Escribe un comando de Linux (ej: ls, pwd, cd, clear)..."
                disabled={!isConnected}
                autoComplete="off"
                spellCheck="false"
              />
            </form>
          </div>
          
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Barra inferior con información */}
      <div className="px-4 py-2 bg-background border-t border-border/80 text-xs text-muted-foreground flex justify-between">
        <div className="flex items-center gap-4">
          <div>
            {projectRoot ? `Proyecto: ${projectRoot.split('/').pop() || projectRoot.split('\\').pop()}` : 'Sin proyecto activo'}
          </div>
          <div className="flex items-center gap-2">
            <span>Sistema: Linux</span>
            <button
              onClick={() => handleQuickCommand('whoami')}
              className="px-2 py-1 text-xs bg-card hover:bg-muted rounded"
              title="Mostrar usuario actual"
            >
              whoami
            </button>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span>Ctrl+L: limpiar pantalla</span>
          <span>Ctrl+C: cancelar comando</span>
          <span>{messages.length} mensajes</span>
        </div>
      </div>
    </div>
  );
}
