import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { useProject } from './ProjectContext';
import { useTabState } from '@/lib/tab-state';

type TerminalMessage = {
  type: 'input' | 'output' | 'error' | 'status' | 'info' | 'warn' | 'success' | 'ai';
  text: string;
};

type TerminalContextType = {
  isOpen: boolean;
  toggleTerminal: (open?: boolean) => void;
  messages: TerminalMessage[];
  executeCommand: (cmd: string) => void;
  isConnected: boolean;
  isSyncing: boolean;
  sendRawMessage: (message: string) => void;
  refreshTerminal: () => void;
  requestProjectRoot: () => void;
  addLocalMessage: (message: TerminalMessage) => void;
  clearMessages: () => void;
};

const TerminalContext = createContext<TerminalContextType | undefined>(undefined);

// Global singleton para el WebSocket (compartido entre pestañas)
let globalSocket: WebSocket | null = null;
let globalIsConnected = false;
const globalReconnectAttempts = { current: 0 };
const globalReconnectTimeout: { current: NodeJS.Timeout | null } = { current: null };
const maxReconnectAttempts = 5;

export function TerminalProvider({
  children,
  activeTabId = 'default'
}: {
  children: React.ReactNode;
  activeTabId?: string;
}) {
  const [isOpen, setIsOpen] = useTabState(activeTabId, 'terminalIsOpen', true);
  const [messages, setMessages] = useTabState<TerminalMessage[]>(activeTabId, 'terminalMessages', [
    { type: 'info', text: 'Inicializando terminal Linux...' }
  ]);
  const [isConnected, setIsConnected] = useState(globalIsConnected);
  const [isSyncing, setIsSyncing] = useState(false);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const { files } = useProject();
  const stripAnsi = useCallback((value: string) => value.replace(/\x1B\[[0-9;]*[A-Za-z]/g, ''), []);

  const addMessage = useCallback((message: TerminalMessage) => {
    console.log('TerminalContext: addMessage recibido:', message);

    const cleanedText = stripAnsi(message.text || '');

    // Solo ignorar mensajes completamente vacíos
    if (!cleanedText.trim()) {
      console.log('TerminalContext: Mensaje vacío ignorado');
      return;
    }

    // ✅ FILTRO SIMPLIFICADO: Solo ignorar líneas completamente vacías
    const ignoredPatterns = [
      /^\s*$/,  // Solo líneas completamente vacías
      // Mantener solo patrones críticos para evitar spam
      /^Microsoft Windows \[Versión[^\n]+\s*$/i,
      /\(c\) Microsoft Corporation\. Todos los derechos reservados\.\s*$/i,
      /^([A-Z]:\\.*?)\>cd \/d "([A-Z]:\\.*?)"\s*$/i
    ];

    // Verificar si el mensaje coincide con algún patrón a ignorar
    const shouldIgnore = ignoredPatterns.some(pattern => pattern.test(cleanedText));

    if (shouldIgnore) {
      console.log('TerminalContext: Mensaje ignorado por patrón:', cleanedText.substring(0, 50));
      return;
    }

    // Asegurarse de que el texto no sea demasiado largo
    const displayText = cleanedText.length > 10000
      ? cleanedText.substring(0, 10000) + '... [truncado]'
      : cleanedText;

    console.log('TerminalContext: Añadiendo mensaje al terminal:', {
      type: message.type,
      textLength: displayText.length,
      preview: displayText.substring(0, 100)
    });

    setMessages(prev => {
      const newMessages = [...prev, { ...message, text: displayText }];
      // Limitar a 1000 mensajes para evitar problemas de rendimiento
      return newMessages.slice(-1000);
    });
  }, [setMessages, stripAnsi]);

  const addLocalMessage = useCallback((message: TerminalMessage) => {
    addMessage(message);
  }, [addMessage]);

  const sendRawMessage = useCallback((message: string) => {
    if (!globalSocket || !globalIsConnected) {
      addMessage({ text: 'Error: Terminal no conectado al servidor', type: 'error' });
      return;
    }
    globalSocket.send(message);
  }, [addMessage]);

  const syncProjectFiles = useCallback(async (projectRoot: string) => {
    if (isSyncing) {
      console.log('TerminalContext: Sincronización ya en progreso, omitiendo...');
      return;
    }

    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }

    syncTimeoutRef.current = setTimeout(async () => {
      setIsSyncing(true);
      try {
        const projectId = projectRoot.split('/').pop() || projectRoot.split('\\').pop();
        if (!projectId || Object.keys(files).length === 0) {
          console.log('TerminalContext: No hay archivos para sincronizar');
          return;
        }

        const filesToSync = Object.entries(files).map(([path, content]) => ({
          path,
          content
        }));

        console.log('TerminalContext: Sincronizando archivos con Fly.io:', {
          projectId,
          filesCount: filesToSync.length
        });

        const response = await fetch('/api/sync-project', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            projectId,
            files: filesToSync
          })
        });

        const result = await response.json();

        if (result.success) {
          if (result.skipped) {
            console.log('TerminalContext: Sync skipped:', result.message);
          } else {
            console.log('TerminalContext: Sync successful:', result.message);
            addMessage({ text: `✅ ${result.message}`, type: 'info' });
          }
        } else {
          console.error('TerminalContext: Sync failed:', result.error);
          addMessage({ text: `⚠️ Sync warning: ${result.error}`, type: 'warn' });
        }
      } catch (error: unknown) {
        console.error('TerminalContext: Error sincronizando archivos:', error);
        const errorMessage = error instanceof Error ? error.message : 'Error desconocido al sincronizar archivos';
        addMessage({ text: `❌ Error sincronizando archivos: ${errorMessage}`, type: 'error' });
      } finally {
        setIsSyncing(false);
      }
    }, 500);
  }, [addMessage, isSyncing, files]);

  const requestProjectRoot = useCallback(async () => {
    const projectRoot = localStorage.getItem('projectRoot');
    if (projectRoot) {
      // Convertir rutas de Windows a Linux si es necesario
      let linuxPath = projectRoot;
      if (projectRoot.includes('\\')) {
        linuxPath = projectRoot.replace(/\\/g, '/');
        if (linuxPath.startsWith('C:')) {
          linuxPath = linuxPath.substring(2); // Remover C:
        }
      }

      // No limpiar mensajes aquí para mantener el historial
      const message = JSON.stringify({
        type: 'setProjectRoot',
        projectRoot: linuxPath
      });
      sendRawMessage(message);

      await syncProjectFiles(linuxPath);
    }
  }, [sendRawMessage, syncProjectFiles]);

  const connectWebSocket = () => {
    if (globalSocket && globalSocket.readyState !== WebSocket.CLOSED) {
      return globalSocket;
    }

    if (globalReconnectAttempts.current >= maxReconnectAttempts) {
      console.log('TerminalContext: Máximo de intentos de reconexión alcanzado');
      addMessage({ text: 'No se pudo conectar al servidor. Por favor, recarga la página para intentar de nuevo.', type: 'error' });
      return null;
    }

    console.log('TerminalContext: Conectando al WebSocket...');
    const wsUrl = process.env.NEXT_PUBLIC_TERMINAL_SERVER_URL || 'ws://localhost:3351';
    console.log('TerminalContext: URL del WebSocket:', wsUrl);

    addMessage({ text: `🔗 Conectando a ${wsUrl}...`, type: 'info' });

    const ws = new WebSocket(wsUrl);
    globalSocket = ws;

    ws.onopen = () => {
      console.log('TerminalContext: Conexión WebSocket establecida');
      globalIsConnected = true;
      setIsConnected(true);
      globalReconnectAttempts.current = 0;
      addMessage({ text: '✅ Terminal Linux conectado exitosamente', type: 'success' });
      addMessage({ text: 'Escribe un comando de Linux para comenzar (ej: ls, pwd, cd, clear)', type: 'info' });
      requestProjectRoot();
    };

    ws.onmessage = event => {
      console.log('TerminalContext: Mensaje WebSocket recibido:', {
        data: event.data,
        type: typeof event.data,
        length: event.data.length
      });

      try {
        // Intentar parsear como JSON
        const parsedMessage = JSON.parse(event.data);
        const messageText = typeof parsedMessage.data === 'object'
          ? JSON.stringify(parsedMessage.data, null, 2)
          : String(parsedMessage.data || '');

        addMessage({
          text: messageText,
          type: (parsedMessage.type || 'output') as TerminalMessage['type']
        });
      } catch (error) {
        // Si falla el parseo JSON, tratar como texto plano
        console.log('TerminalContext: Tratando como texto plano');
        addMessage({ text: String(event.data), type: 'output' });
      }
    };

    ws.onerror = error => {
      if (!globalIsConnected) {
        // Silenciar mensajes de intento de conexión para evitar ruido en consola
      }
    };

    ws.onclose = event => {
      console.log('TerminalContext: Conexión WebSocket cerrada:', event.code, event.reason);
      globalIsConnected = false;
      setIsConnected(false);
      globalSocket = null;

      if (event.code !== 1000) {
        globalReconnectAttempts.current++;
        const delay = Math.min(1000 * Math.pow(2, globalReconnectAttempts.current), 10000);
        console.log(`TerminalContext: Reintentando en ${delay}ms (intento ${globalReconnectAttempts.current}/${maxReconnectAttempts})`);

        addMessage({ text: `🔌 Conexión perdida. Reconectando en ${delay / 1000} segundos...`, type: 'warn' });

        globalReconnectTimeout.current = setTimeout(() => {
          connectWebSocket();
        }, delay);
      } else {
        addMessage({ text: '🔌 Conexión cerrada normalmente', type: 'info' });
      }
    };

    return ws;
  };

  useEffect(() => {
    const ws = connectWebSocket();

    return () => {
      console.log('TerminalContext: Limpiando conexión WebSocket');
      if (globalReconnectTimeout.current) {
        clearTimeout(globalReconnectTimeout.current);
        globalReconnectTimeout.current = null;
      }
      if (ws) {
        ws.close(1000, 'Componente desmontado');
      }
    };
  }, []);

  const executeCommand = (command: string) => {
    if (!globalSocket || !globalIsConnected) {
      addMessage({ text: '❌ Error: Terminal no conectado al servidor', type: 'error' });
      return;
    }

    // ✅ ENVIAR COMANDO DE LINUX DIRECTAMENTE - SIN CONVERSIÓN
    addMessage({ text: `$ ${command}`, type: 'input' });

    if (command.trim().toLowerCase() === 'clear') {
      setMessages([]);
      return;
    }

    try {
      // Asegurarse de que el comando termine en \r para que el PTY lo ejecute
      // El servidor espera texto plano directamente para ptyProcess.write
      const cmdToSend = command.endsWith('\r') ? command : command + '\r';

      console.log('TerminalContext: Enviando comando raw:', cmdToSend);
      globalSocket.send(cmdToSend);
    } catch (error) {
      console.error('TerminalContext: Error al enviar comando:', error);
      addMessage({ text: '❌ Error al enviar comando.', type: 'error' });
    }
  };

  // Exponer la función globalmente para que el chat pueda usarla
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).executeTerminalCommand = executeCommand;
    }
    return () => {
      if (typeof window !== 'undefined') {
        delete (window as any).executeTerminalCommand;
      }
    };
  }, [executeCommand]);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, [setMessages]);

  const handleToggleTerminal = (open?: boolean) => {
    console.log('TerminalContext: toggleTerminal llamado, isOpen actual:', isOpen);
    setIsOpen(prev => {
      const newState = typeof open === 'boolean' ? open : !prev;
      console.log('TerminalContext: Actualizando isOpen a:', newState);
      return newState;
    });
  };

  const refreshTerminal = useCallback(() => {
    console.log('TerminalContext: Refrescando terminal...');

    // Limpiar mensajes pero mantener uno informativo
    setMessages([{ type: 'info', text: '🔄 Recargando terminal Linux...' }]);

    // Cerrar conexión existente
    if (globalSocket) {
      console.log('TerminalContext: Cerrando conexión WebSocket existente');
      globalSocket.close(1000, 'Refresh requested');
      globalSocket = null;
      globalIsConnected = false;
      setIsConnected(false);
    }

    // Reiniciar contadores
    globalReconnectAttempts.current = 0;

    // Limpiar timeout pendiente
    if (globalReconnectTimeout.current) {
      clearTimeout(globalReconnectTimeout.current);
      globalReconnectTimeout.current = null;
    }

    // Iniciar nueva conexión
    setTimeout(() => {
      console.log('TerminalContext: Iniciando nueva conexión WebSocket...');
      connectWebSocket();
    }, 500);
  }, [setMessages]);

  return (
    <TerminalContext.Provider value={{
      isOpen,
      toggleTerminal: handleToggleTerminal,
      messages,
      executeCommand,
      isConnected,
      isSyncing,
      sendRawMessage,
      refreshTerminal,
      requestProjectRoot,
      addLocalMessage,
      clearMessages
    }}>
      {children}
    </TerminalContext.Provider>
  );
}

const defaultTerminalContext: TerminalContextType = {
  isOpen: false,
  toggleTerminal: () => { },
  messages: [],
  executeCommand: () => { },
  isConnected: false,
  isSyncing: false,
  sendRawMessage: () => { },
  refreshTerminal: () => { },
  requestProjectRoot: () => { },
  addLocalMessage: () => { },
  clearMessages: () => { }
};

export const useTerminal = () => {
  try {
    const context = useContext(TerminalContext);
    return context || defaultTerminalContext;
  } catch (error) {
    return defaultTerminalContext;
  }
};
