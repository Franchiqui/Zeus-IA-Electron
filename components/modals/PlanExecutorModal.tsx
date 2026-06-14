'use client';

import { createPortal } from 'react-dom';
import PlanExecutor from '@/components/editor/PlanExecutor';

export interface PlanExecutorModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectRoot?: string;
  files?: Record<string, any> | Array<any>;
  projectId?: string;
  effectiveProjectId?: string;
  refreshProjectFiles: () => Promise<void>;
  onProjectTypeChange?: (type: 'database' | 'local' | 'unknown') => void;
  onNotifyPreviewServer?: (projectId: string) => Promise<void>;
  currentConversationId?: string | null;
  setMessages: (updater: (prev: any[]) => any[]) => void;
  saveMessage: (conversationId: string, message: any) => Promise<string | undefined>;
  onForcePreviewReload?: () => void;
  activeFile?: { path: string; content?: string; name?: string } | null;
  fileContent?: string;
  previewFile?: { path: string; content?: string } | null;
  onFileSelect?: (filePath: string, content: string) => void;
  mounted?: boolean;
}

// Tipos para los mensajes
interface Message {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  type?: 'text';
  hasCodeChanges?: boolean;
  downloadableFiles?: Array<{ filePath: string; content: string }>;
  downloadOnly?: boolean;
}

// Función para verificar si hay información importante antes de cerrar
const hasImportantData = (projectId: string | undefined): boolean => {
  const storageKey = `planExecutor_state_${projectId || 'default'}`;
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const parsed = JSON.parse(saved);
      return (parsed.instruction && parsed.instruction.trim().length > 0) ||
        (parsed.plan && parsed.plan.actions && parsed.plan.actions.length > 0);
    }
  } catch (e) {
    // Si hay error, asumir que no hay datos importantes
  }
  return false;
};

// Función para manejar el cierre del modal
const handleModalClose = (onClose: () => void, projectId: string | undefined) => {
  if (hasImportantData(projectId)) {
    if (confirm('¿Estás seguro de que quieres cerrar? La información se guardará automáticamente y podrás continuar después.')) {
      onClose();
    }
  } else {
    onClose();
  }
};

export default function PlanExecutorModal({
  isOpen,
  onClose,
  projectRoot,
  files,
  projectId,
  effectiveProjectId,
  refreshProjectFiles,
  onProjectTypeChange,
  onNotifyPreviewServer,
  currentConversationId,
  setMessages,
  saveMessage,
  onForcePreviewReload,
  activeFile,
  fileContent,
  previewFile,
  onFileSelect,
  mounted = false
}: PlanExecutorModalProps) {
  // Función para añadir mensajes al chat
  const handleAddMessage = (msg: any) => {
    const message: Message = {
      id: msg.id,
      content: msg.content,
      role: msg.role,
      type: msg.type || 'text',
      hasCodeChanges: msg.hasCodeChanges || false,
      downloadableFiles: msg.downloadableFiles,
      downloadOnly: msg.downloadOnly
    };
    setMessages(prev => [...prev, message]);
  };

  // Si no está montado o no hay projectRoot, no renderizar nada
  if (!mounted || !projectRoot) {
    return null;
  }

  // Renderizar el modal usando createPortal
  return isOpen ? createPortal(
    <div id="plan-executor-modal" className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Fondo oscuro con clic para cerrar */}
      <div 
        className="absolute inset-0 bg-background/70" 
        onClick={() => handleModalClose(onClose, projectId)}
      />
      
      {/* Contenido del modal */}
      <div className="relative z-10 w-full max-w-3xl bg-background text-foreground/80 rounded-xl shadow-2xl border border-border/80 overflow-hidden">
        {/* Header del modal */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/80 bg-background/70">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold bg-clip-text text-transparent bg-gradient-to-r from-green-400 to-yellow-400">
              Generador de Componentes
            </h3>
            <span 
              className="text-xs text-muted-foreground/80" 
              title="La información se guarda automáticamente"
            >
              
            </span>
          </div>
          
          {/* Botón de cerrar */}
          <button 
            onClick={() => handleModalClose(onClose, projectId)}
            className="px-2 py-1 text-sm rounded-md border border-border/50/60 bg-card/60 hover:bg-muted/60 hover:border-border/40 transition-colors" 
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>
        
        {/* Contenido del modal con scroll */}
        <div className="max-h-[80vh] overflow-auto p-4 bg-gradient-to-b from-gray-900 to-gray-900/60">
          <PlanExecutor
            projectRoot={projectRoot}
            explorer={files as any}
            projectId={effectiveProjectId || projectId}
            onRefreshFiles={refreshProjectFiles}
            onProjectTypeChange={onProjectTypeChange}
            onNotifyPreviewServer={onNotifyPreviewServer}
            currentConversationId={currentConversationId}
            onAddMessage={handleAddMessage}
            onSaveMessage={saveMessage}
            onForcePreviewReload={onForcePreviewReload}
            activeFile={activeFile}
            fileContent={fileContent}
            previewFile={previewFile}
            onFileSelect={onFileSelect}
          />
        </div>
      </div>
    </div>,
    document.body
  ) : (
    // Renderizar oculto para mantener el estado del componente
    <div style={{ display: 'none' }} aria-hidden="true">
      <PlanExecutor
        projectRoot={projectRoot}
        explorer={files as any}
        projectId={effectiveProjectId || projectId}
        onRefreshFiles={refreshProjectFiles}
        onProjectTypeChange={onProjectTypeChange}
        onNotifyPreviewServer={onNotifyPreviewServer}
        currentConversationId={currentConversationId}
        onAddMessage={handleAddMessage}
        onSaveMessage={saveMessage}
        onForcePreviewReload={onForcePreviewReload}
        activeFile={activeFile}
        fileContent={fileContent}
        previewFile={previewFile}
        onFileSelect={onFileSelect}
      />
    </div>
  );
}
