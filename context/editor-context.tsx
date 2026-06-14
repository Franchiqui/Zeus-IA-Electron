import React, { createContext, useContext, useCallback } from 'react';
import { useTabState } from '@/lib/tab-state';

export interface CorrectionChange {
  lineNumber: number;
  oldContent: string;
  newContent: string;
}

export interface CodeReplacementRaw {
  old: string;
  new: string;
}

export interface PendingCorrection {
  id: string;
  file: string;
  path: string;
  changes: CorrectionChange[];
  originalContent: string;
  newContent: string;
  type: 'file' | 'line' | 'char';
  replacements?: CodeReplacementRaw[]; // Replacements individuales del code_change
}

export interface OpenFile {
  id: any;
  path: string;
  name: string;
  content: string;
}

interface EditorContextType {
  // Editor state
  selectedTool: string;
  zoomLevel: number;
  isDragging: boolean;
  editorWidth: number;
  editorRef: any;
  correctionQueue: PendingCorrection[];
  pendingCorrection: PendingCorrection | null;
  openFiles: OpenFile[];
  activeFile: string | null;
  externalMessage: string | null;
  hiddenContext: string | null;

  // Editor actions
  setSelectedTool: (tool: string) => void;
  setZoomLevel: (level: number) => void;
  setIsDragging: (dragging: boolean) => void;
  setEditorWidth: (width: number) => void;
  setEditorRef: (ref: any) => void;
  addCorrection: (correction: Omit<PendingCorrection, 'id'>) => void;
  removeCorrection: (id: string) => void;
  setOpenFiles: React.Dispatch<React.SetStateAction<OpenFile[]>>;
  setActiveFile: (path: string | null) => void;
  openFile: (path: string, name: string) => Promise<void>;
  askZeus: (message: string, hiddenContext?: string) => void;
  clearExternalMessage: () => void;
  clearHiddenContext: () => void;
}

const EditorContext = createContext<EditorContextType | undefined>(undefined);

export function EditorProvider({ children, activeTabId = 'default' }: { children: React.ReactNode; activeTabId?: string }) {
  const [selectedTool, setSelectedTool] = useTabState(activeTabId, 'selectedTool', 'select');
  const [zoomLevel, setZoomLevel] = useTabState(activeTabId, 'zoomLevel', 1);
  const [isDragging, setIsDragging] = useTabState(activeTabId, 'isDragging', false);
  const [editorWidth, setEditorWidth] = useTabState(activeTabId, 'editorWidth', 800);
  const [editorRef, setEditorRef] = useTabState(activeTabId, 'editorRef', null);
  const [correctionQueue, setCorrectionQueue] = useTabState<PendingCorrection[]>(activeTabId, 'correctionQueue', []);
  const [openFiles, setOpenFiles] = useTabState<OpenFile[]>(activeTabId, 'openFiles', []);
  const [activeFile, setActiveFile] = useTabState<string | null>(activeTabId, 'activeFile', null);
  const [externalMessage, setExternalMessage] = useTabState<string | null>(activeTabId, 'externalMessage', null);
  const [hiddenContext, setHiddenContext] = useTabState<string | null>(activeTabId, 'hiddenContext', null);

  const pendingCorrection = correctionQueue.length > 0 ? correctionQueue[0] : null;

  const askZeus = useCallback((message: string, hidden?: string) => {
    console.log('askZeus llamado con mensaje:', message);
    setExternalMessage(message);
    if (hidden) setHiddenContext(hidden);
  }, [setExternalMessage, setHiddenContext]);

  const clearExternalMessage = useCallback(() => {
    setExternalMessage(null);
  }, [setExternalMessage]);

  const clearHiddenContext = useCallback(() => {
    setHiddenContext(null);
  }, [setHiddenContext]);

  const addCorrection = useCallback((correction: Omit<PendingCorrection, 'id'>) => {
    const id = Math.random().toString(36).substring(7);
    setCorrectionQueue(prev => [...prev, { ...correction, id }]);
  }, [setCorrectionQueue]);

  const removeCorrection = useCallback((id: string) => {
    setCorrectionQueue(prev => prev.filter(c => c.id !== id));
  }, [setCorrectionQueue]);

  const openFile = useCallback(async (path: string, name: string) => {
    let alreadyOpen = false;
    setOpenFiles(prev => {
      if (prev.find(f => f.path === path)) {
        alreadyOpen = true;
        return prev;
      }
      return prev;
    });
    if (alreadyOpen) {
      setActiveFile(path);
      return;
    }

    try {
      const fileUrl = `http://localhost:8742/api/files/${encodeURIComponent(name)}?path=${encodeURIComponent(path.replace('/' + name, '').replace(name, ''))}`;
      const response = await fetch(fileUrl);
      const result = await response.json();

      if (result && result.success) {
        // Generar un ID único para el archivo
        const generateId = () => {
          if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
          }
          return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        };

        const newFile: OpenFile = {
          id: generateId(),  // ← AGREGAR ID ÚNICO
          path: path,
          name: name,
          content: typeof result.content === 'string' ? result.content : ''
        };
        setOpenFiles(prev => {
          if (prev.find(f => f.path === path)) {
            setActiveFile(path);
            return prev;
          }
          return [...prev, newFile];
        });
        setActiveFile(path);
      }
    } catch (error) {
      console.error('Error opening file:', error);
    }
  }, [setOpenFiles, setActiveFile]);

  const value = {
    selectedTool,
    zoomLevel,
    isDragging,
    editorWidth,
    editorRef,
    correctionQueue,
    pendingCorrection,
    openFiles,
    activeFile,
    externalMessage,
    hiddenContext,
    setSelectedTool,
    setZoomLevel,
    setIsDragging,
    setEditorWidth,
    setEditorRef,
    addCorrection,
    removeCorrection,
    setOpenFiles,
    setActiveFile,
    openFile,
    askZeus,
    clearExternalMessage,
    clearHiddenContext
  };

  return (
    <EditorContext.Provider value={value}>
      {children}
    </EditorContext.Provider>
  );
}

export function useEditor() {
  const context = useContext(EditorContext);
  if (context === undefined) {
    throw new Error('useEditor must be used within an EditorProvider');
  }
  return context;
}
