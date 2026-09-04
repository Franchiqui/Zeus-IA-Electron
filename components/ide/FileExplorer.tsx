'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Folder, 
  File, 
  ChevronRight, 
  Search, 
  RefreshCw, 
  ArrowLeft,
  ArrowUp,
  Home,
  FilePlus2,
  FolderPlus,
  Pencil,
  Trash2,
  Scissors,
  Copy,
  Clipboard
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStore } from '@/lib/store';
import { sessionFetch } from '@/lib/projectStore';
import { useTranslation } from '@/contexts/translation-context';

interface FileSystemItem {
  type: 'folder' | 'file';
  name: string;
  path: string;
  size?: number;
  modified?: string;
}

interface FileExplorerProps {
  onFileSelect: (path: string, name: string) => void;
  currentPath: string;
  setCurrentPath: (path: string) => void;
}

type ExplorerDialogMode = 'create-folder' | 'create-file' | 'rename-item' | 'delete-item' | null;

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  item: FileSystemItem | null;
  targetPath: string | null;
}

export default function FileExplorer({ onFileSelect, currentPath, setCurrentPath }: FileExplorerProps) {
  const { t } = useTranslation();
  const { explorerRefreshTrigger } = useStore();
  const [folderContents, setFolderContents] = useState<FileSystemItem[]>([]);
  const [navigationHistory, setNavigationHistory] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dialogMode, setDialogMode] = useState<ExplorerDialogMode>(null);
  const [dialogValue, setDialogValue] = useState('');
  const [dialogItem, setDialogItem] = useState<FileSystemItem | null>(null);
  const [dialogError, setDialogError] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    item: null,
    targetPath: null
  });
  const [hasClipboardContent, setHasClipboardContent] = useState(false);
  const [modifiedPaths, setModifiedPaths] = useState<Set<string>>(new Set());
  const [modifiedFolders, setModifiedFolders] = useState<Set<string>>(new Set());

  // Normaliza un path: separadores a /, sin barra inicial ni final
  const toRepoRelative = useCallback((itemPath: string): string => {
    if (!itemPath) return '';
    return String(itemPath)
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/\/+$/, '')
      .toLowerCase();
  }, []);

  // Devuelve solo el nombre de archivo (sin ruta) para matching por nombre
  const basename = useCallback((p: string): string => {
    const norm = toRepoRelative(p);
    const idx = norm.lastIndexOf('/');
    return idx === -1 ? norm : norm.substring(idx + 1);
  }, [toRepoRelative]);

  // Comprueba si un item está modificado: por path exacto, por sufijo, o por nombre.
  // Esto cubre casos donde el path del item y el de git status usan raíces o formatos distintos.
  const isItemModified = useCallback((itemPath: string, type: 'folder' | 'file'): boolean => {
    const rel = toRepoRelative(itemPath);
    const name = basename(itemPath);

    if (type === 'file') {
      if (modifiedPaths.has(rel)) return true;
      // match por sufijo (por si el repo-root es distinto)
      for (const p of modifiedPaths) {
        if (p === rel) return true;
        if (p.endsWith('/' + rel) || rel.endsWith('/' + p)) return true;
        // match por nombre de archivo (último recurso)
        if (basename(p) === name) return true;
      }
      return false;
    }
    // folder
    if (modifiedFolders.has(rel)) return true;
    const prefix = rel + '/';
    for (const p of modifiedPaths) {
      if (p.startsWith(prefix) || p === rel) return true;
      if (p.includes('/' + rel + '/') || p.includes('/' + rel)) return true;
    }
    return false;
  }, [modifiedPaths, modifiedFolders, toRepoRelative, basename]);

  const navigateToFolder = useCallback(async (folderPath: string, addToHistory = true) => {
    setIsLoading(true);
    try {
      const [foldersResponse, filesResponse, gitStatusResponse] = await Promise.all([
        sessionFetch(`/api/ide-files?path=${encodeURIComponent(folderPath)}&type=folders`),
        sessionFetch(`/api/ide-files?path=${encodeURIComponent(folderPath)}&type=files`),
        sessionFetch(`/api/git/status?path=${encodeURIComponent(folderPath)}`).catch(() => null)
      ]);

      const foldersResult = await foldersResponse.json();
      const filesResult = await filesResponse.json();
      const gitStatusResult = gitStatusResponse ? await gitStatusResponse.json().catch(() => null) : null;

      if (foldersResult.success || filesResult.success) {
        const combinedContents: FileSystemItem[] = [
          ...(foldersResult.folders || []).map((folder: any) => ({
            ...folder,
            type: 'folder',
            size: 0
          })),
          ...(filesResult.files || []).map((file: any) => ({
            ...file,
            type: 'file'
          }))
        ];

        // Procesar estado de git para colorear archivos/carpetas modificados
        if (gitStatusResult && gitStatusResult.isRepo && Array.isArray(gitStatusResult.files)) {
          const newModifiedPaths = new Set<string>();
          for (const f of gitStatusResult.files) {
            if (f && typeof f.path === 'string' && f.path) {
              newModifiedPaths.add(f.path.replace(/\\/g, '/').replace(/^\/+/, ''));
            }
          }
          // Calcular carpetas que contienen archivos modificados
          const newModifiedFolders = new Set<string>();
          for (const p of newModifiedPaths) {
            const parts = p.split('/');
            for (let i = 1; i < parts.length; i++) {
              newModifiedFolders.add(parts.slice(0, i).join('/'));
            }
          }
          setModifiedPaths(newModifiedPaths);
          setModifiedFolders(newModifiedFolders);
        } else {
          setModifiedPaths(new Set());
          setModifiedFolders(new Set());
        }

        setFolderContents(combinedContents);
        setCurrentPath(folderPath);
        if (addToHistory) {
          setNavigationHistory(prev => [...prev, folderPath]);
        }
      }
    } catch (error) {
      console.error('Failed to navigate to folder:', error);
    } finally {
      setIsLoading(false);
    }
  }, [setCurrentPath]);

  useEffect(() => {
    navigateToFolder(currentPath, false);
  }, [explorerRefreshTrigger, navigateToFolder]); // No currentPath here to avoid loops

  // Polling periódico del estado de git (cada 5s) para que los cambios realizados
  // desde Zeus mismo (editor interno, terminal integrada, etc.) se reflejen en el
  // coloreado del explorador sin tener que navegar o cambiar el foco.
  useEffect(() => {
    if (!currentPath) return;
    const interval = setInterval(() => {
      void navigateToFolder(currentPath, false);
    }, 5000);
    return () => clearInterval(interval);
  }, [currentPath, navigateToFolder]);

  // Verificar si hay contenido en el portapapeles cuando se abre el menú contextual
  useEffect(() => {
    if (contextMenu.visible) {
      const checkClipboard = async () => {
        if (typeof window !== 'undefined' && (window as any).electronAPI?.fileExplorer) {
          try {
            const hasContent = await (window as any).electronAPI.fileExplorer.hasClipboardContent();
            setHasClipboardContent(hasContent);
          } catch (error) {
            console.error('Error checking clipboard:', error);
            setHasClipboardContent(false);
          }
        }
      };
      checkClipboard();
    }
  }, [contextMenu.visible]);

  // Refrescar el estado de git cuando la ventana recupera el foco
  // (para que al volver del editor externo con cambios ya committeados, los archivos vuelvan a su color normal)
  useEffect(() => {
    const handleFocus = () => {
      if (currentPath) {
        void navigateToFolder(currentPath, false);
      }
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [currentPath, navigateToFolder]);

  const navigateBack = () => {
    if (navigationHistory.length > 1) {
      const newHistory = navigationHistory.slice(0, -1);
      const previousPath = newHistory[newHistory.length - 1] || '';
      setNavigationHistory(newHistory);
      navigateToFolder(previousPath, false);
    } else {
      setNavigationHistory([]);
      navigateToFolder('', false);
    }
  };

  const navigateToParent = () => {
    if (currentPath) {
      const parentPath = currentPath.split('/').slice(0, -1).join('/');
      navigateToFolder(parentPath);
    }
  };

  const filteredContents = folderContents.filter(item => 
    item.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const splitItemPath = useCallback((itemPath: string) => {
    const normalized = itemPath.replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    const name = parts.pop() || '';
    const parentPath = parts.join('/');
    return { name, parentPath };
  }, []);

  const executeCreateFolder = useCallback(async (folderName: string) => {
    const response = await sessionFetch('/api/ide-files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'createFolder',
        name: folderName.trim(),
        path: currentPath || ''
      })
    });

    const result = await response.json();
    if (!response.ok || !result?.success) {
      throw new Error(result?.error || t('explorerErrorCreateFolder'));
    }

    await navigateToFolder(currentPath || '', false);
  }, [currentPath, navigateToFolder]);

  const handleCreateFolder = useCallback(() => {
    setDialogMode('create-folder');
    setDialogValue('');
    setDialogItem(null);
    setDialogError('');
  }, []);

  const executeCreateFile = useCallback(async (fileName: string) => {
    const response = await sessionFetch('/api/ide-files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'createFile',
        name: fileName.trim(),
        path: currentPath || '',
        content: ''
      })
    });

    const result = await response.json();
    if (!response.ok || !result?.success) {
      throw new Error(result?.error || t('explorerErrorCreateFile'));
    }

    await navigateToFolder(currentPath || '', false);
  }, [currentPath, navigateToFolder]);

  const handleCreateFile = useCallback(() => {
    setDialogMode('create-file');
    setDialogValue('');
    setDialogItem(null);
    setDialogError('');
  }, []);

  const executeRenameItem = useCallback(async (item: FileSystemItem, newName: string) => {
    const { name, parentPath } = splitItemPath(item.path);

    const response = await sessionFetch('/api/ide-files', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'rename',
        name,
        newName: newName.trim(),
        path: parentPath
      })
    });

    const result = await response.json();
    if (!response.ok || !result?.success) {
      throw new Error(result?.error || (item.type === 'folder' ? t('explorerErrorRenameFolder') : t('explorerErrorRenameFile')));
    }

    await navigateToFolder(currentPath || '', false);
  }, [currentPath, navigateToFolder, splitItemPath]);

  const handleRenameItem = useCallback((item: FileSystemItem) => {
    setDialogMode('rename-item');
    setDialogValue(item.name);
    setDialogItem(item);
    setDialogError('');
  }, []);

  const executeDeleteItem = useCallback(async (item: FileSystemItem) => {
    // En Electron, usar IPC nativo para evitar crash del servidor Next.js empaquetado
    if (typeof window !== 'undefined' && (window as any).electronAPI?.fileExplorer?.deleteFile) {
      const result = await (window as any).electronAPI.fileExplorer.deleteFile(item.path);
      if (!result?.success) {
        throw new Error(result?.error || (item.type === 'folder' ? t('explorerErrorDeleteFolder') : t('explorerErrorDeleteFile')));
      }
      await navigateToFolder(currentPath || '', false);
      return;
    }

    // Fallback para modo web
    const { name, parentPath } = splitItemPath(item.path);
    const response = await sessionFetch(`/api/ide-files?name=${encodeURIComponent(name)}&path=${encodeURIComponent(parentPath)}`, {
      method: 'DELETE'
    });

    const result = await response.json();
    if (!response.ok || !result?.success) {
      throw new Error(result?.error || (item.type === 'folder' ? t('explorerErrorDeleteFolder') : t('explorerErrorDeleteFile')));
    }

    await navigateToFolder(currentPath || '', false);
  }, [currentPath, navigateToFolder, splitItemPath]);

  const handleDeleteItem = useCallback((item: FileSystemItem) => {
    setDialogMode('delete-item');
    setDialogValue('');
    setDialogItem(item);
    setDialogError('');
  }, []);

  const handleCopy = useCallback(async (item: FileSystemItem) => {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.fileExplorer) {
      try {
        await (window as any).electronAPI.fileExplorer.copyFile(item.path);
        setContextMenu({ visible: false, x: 0, y: 0, item: null, targetPath: null });
      } catch (error) {
        console.error('Error al copiar:', error);
      }
    }
  }, []);

  const handleCut = useCallback(async (item: FileSystemItem) => {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.fileExplorer) {
      try {
        await (window as any).electronAPI.fileExplorer.cutFile(item.path);
        setContextMenu({ visible: false, x: 0, y: 0, item: null, targetPath: null });
      } catch (error) {
        console.error('Error al cortar:', error);
      }
    }
  }, []);

  const handlePaste = useCallback(async (targetPath: string) => {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.fileExplorer) {
      try {
        const result = await (window as any).electronAPI.fileExplorer.pasteFile(targetPath);
        if (result.success) {
          await navigateToFolder(currentPath || '', false);
          setContextMenu({ visible: false, x: 0, y: 0, item: null, targetPath: null });
        } else {
          console.error('Error al pegar:', result.error);
          alert(result.error || t('explorerErrorPaste'));
        }
      } catch (error) {
        console.error('Error al pegar:', error);
      }
    }
  }, [currentPath, navigateToFolder]);

  const handleContextMenu = useCallback((e: React.MouseEvent, item: FileSystemItem | null = null) => {
    e.preventDefault();
    e.stopPropagation();
    const targetPath = item ? item.path : currentPath;
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      item,
      targetPath
    });
  }, [currentPath]);

  const closeContextMenu = useCallback(() => {
    setContextMenu({ visible: false, x: 0, y: 0, item: null, targetPath: null });
  }, []);

  const closeDialog = useCallback(() => {
    setDialogMode(null);
    setDialogItem(null);
    setDialogValue('');
    setDialogError('');
  }, []);

  const submitDialog = useCallback(async () => {
    try {
      setDialogError('');

      if (dialogMode === 'create-folder') {
        const folderName = dialogValue.trim();
        if (!folderName) return;
        await executeCreateFolder(folderName);
        closeDialog();
        return;
      }

      if (dialogMode === 'create-file') {
        const fileName = dialogValue.trim();
        if (!fileName) return;
        await executeCreateFile(fileName);
        closeDialog();
        return;
      }

      if (dialogMode === 'rename-item' && dialogItem) {
        const newName = dialogValue.trim();
        if (!newName || newName === dialogItem.name) return;
        await executeRenameItem(dialogItem, newName);
        closeDialog();
        return;
      }

      if (dialogMode === 'delete-item' && dialogItem) {
        await executeDeleteItem(dialogItem);
        closeDialog();
      }
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : t('explorerErrorAction'));
    }
  }, [
    closeDialog,
    dialogItem,
    dialogMode,
    dialogValue,
    executeCreateFile,
    executeCreateFolder,
    executeDeleteItem,
    executeRenameItem
  ]);

  return (
    <>
    <div 
      className="flex flex-col h-full bg-background border-r border-border/80"
      onClick={closeContextMenu}
    >
      <div className="p-4 border-b border-border/80 flex items-center justify-between bg-background/80">
        <h2 className="text-sm font-bold flex items-center gap-2 text-primary">
          <Folder className="w-4 h-4" />
          {t('explorerTitle')}
        </h2>
        <div className="flex items-center gap-1">
          <button
            onClick={handleCreateFile}
            className="p-1.5 hover:bg-card rounded text-muted-foreground hover:text-emerald-300 transition-colors"
            title={t('explorerCreateFile')}
          >
            <FilePlus2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleCreateFolder}
            className="p-1.5 hover:bg-card rounded text-muted-foreground hover:text-primary-foreground transition-colors"
            title={t('explorerCreateFolder')}
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
          <button 
            onClick={navigateBack} 
            disabled={navigationHistory.length === 0}
            className="p-1.5 hover:bg-card rounded text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title={t('explorerGoBack')}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <button 
            onClick={navigateToParent} 
            disabled={!currentPath}
            className="p-1.5 hover:bg-card rounded text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title={t('explorerUpOneLevel')}
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => navigateToFolder(currentPath, false)} className="p-1.5 hover:bg-card rounded text-muted-foreground hover:text-foreground transition-colors">
            <RefreshCw className={cn("w-3.5 h-3.5", isLoading && "animate-spin")} />
          </button>
        </div>
      </div>

      <div className="p-2 border-b border-border/80">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/80" />
          <input
            type="text"
            placeholder={t('explorerSearchFiles')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-7 pr-2 py-1.5 bg-background border border-border/80 rounded text-xs outline-none focus:border-primary transition-colors"
          />
        </div>
      </div>

      <div className="flex items-center gap-1 px-2 py-1.5 bg-background/30 border-b border-border/80 overflow-x-hidden">
        <button onClick={() => navigateToFolder('', true)} className="p-1 hover:bg-card rounded text-muted-foreground/80 hover:text-primary">
          <Home className="w-3.5 h-3.5" />
        </button>
        {currentPath && (
          <>
            <ChevronRight className="w-3 h-3 text-gray-700 flex-shrink-0" />
            <div className="flex items-center gap-1">
              {currentPath.split('/').map((part, idx, arr) => (
                <React.Fragment key={idx}>
                  <button 
                    onClick={() => navigateToFolder(arr.slice(0, idx + 1).join('/'), true)}
                    className="text-[10px] text-muted-foreground hover:text-foreground truncate max-w-[80px]"
                  >
                    {part}
                  </button>
                  {idx < arr.length - 1 && <ChevronRight className="w-2.5 h-2.5 text-gray-700 flex-shrink-0" />}
                </React.Fragment>
              ))}
            </div>
          </>
        )}
      </div>

      <div
        className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar p-1"
        onContextMenu={(e) => {
          if (e.target === e.currentTarget) {
            handleContextMenu(e, null);
          }
        }}
      >
        {isLoading && folderContents.length === 0 ? (
          <div className="flex justify-center p-8">
            <RefreshCw className="w-5 h-5 animate-spin text-primary opacity-50" />
          </div>
        ) : (
          <div className="space-y-0.5">
            {currentPath && !searchQuery && (
              <button
                onClick={navigateToParent}
                className="w-full flex items-center gap-2.5 p-2 rounded text-left transition-all bg-input border border-border/40 hover:border-border/70 text-muted-foreground/80 hover:text-foreground/70 group"
              >
                <Folder className="w-4 h-4 text-gray-700 group-hover:text-muted-foreground/80 flex-shrink-0" />
                <span className="text-xs font-medium">..</span>
              </button>
            )}
            
            {filteredContents.length > 0 ? (
              filteredContents.map((item) => (
                <div
                  key={item.path}
                  onClick={() => item.type === 'folder' ? navigateToFolder(item.path) : onFileSelect(item.path, item.name)}
                  onContextMenu={(e) => handleContextMenu(e, item)}
                  className={cn(
                    "w-full flex items-center justify-between p-2 rounded text-left transition-all group bg-input border border-border/40 hover:border-border/70",
                    isItemModified(item.path, item.type)
                      ? "hover:bg-primary/10 text-success hover:text-emerald-300"
                      : item.type === 'folder'
                        ? "hover:bg-primary/10 text-foreground/70 hover:text-primary"
                        : "hover:bg-input/80 text-muted-foreground hover:text-foreground/80"
                  )}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {item.type === 'folder' ? (
                      <Folder className={cn(
                        "w-4 h-4 flex-shrink-0",
                        isItemModified(item.path, item.type)
                          ? "text-success group-hover:text-emerald-300"
                          : "text-primary/70 group-hover:text-primary"
                      )} />
                    ) : (
                      <File className={cn(
                        "w-4 h-4 flex-shrink-0",
                        isItemModified(item.path, item.type) ? "text-success" : "text-muted-foreground/60"
                      )} />
                    )}
                    <span className="text-xs truncate font-medium">{item.name}</span>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRenameItem(item);
                      }}
                      className="p-1 rounded text-muted-foreground/80 hover:text-amber-300 hover:bg-card/80 opacity-0 group-hover:opacity-100 transition-all"
                      title={item.type === 'folder' ? t('explorerRenameFolder') : t('explorerRenameFile')}
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteItem(item);
                      }}
                      className="p-1 rounded text-muted-foreground/80 hover:text-rose-300 hover:bg-card/80 opacity-0 group-hover:opacity-100 transition-all"
                      title={item.type === 'folder' ? t('explorerDeleteFolder') : t('explorerDeleteFile')}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                    {item.type === 'folder' && <ChevronRight className="w-3 h-3 text-gray-700 group-hover:text-primary opacity-0 group-hover:opacity-100 transition-all" />}
                  </div>
                </div>
              ))
            ) : (
              !isLoading && (
                <div className="text-center py-12 text-muted-foreground/60">
                  <Folder className="w-8 h-8 mx-auto mb-2 opacity-20" />
                  <p className="text-[10px] uppercase tracking-widest font-bold">{t('explorerEmptyFolder')}</p>
                </div>
              )
            )}
          </div>
        )}
      </div>

      {contextMenu.visible && (
        <div
          className="fixed z-50 bg-card border border-border/50 rounded-lg shadow-xl py-1 min-w-[160px]"
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.item ? (
            <>
              <button
                onClick={() => handleCut(contextMenu.item!)}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground/70 hover:bg-muted hover:text-foreground transition-colors"
              >
                <Scissors className="w-3.5 h-3.5" />
                {t('explorerCut')}
              </button>
              <button
                onClick={() => handleCopy(contextMenu.item!)}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground/70 hover:bg-muted hover:text-foreground transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
                {t('explorerCopy')}
              </button>
              {contextMenu.item.type === 'folder' && (
                <button
                  onClick={() => handlePaste(contextMenu.item!.path)}
                  disabled={!hasClipboardContent}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors",
                    hasClipboardContent
                      ? "text-foreground/70 hover:bg-muted hover:text-foreground"
                      : "text-muted-foreground/60 cursor-not-allowed"
                  )}
                >
                  <Clipboard className="w-3.5 h-3.5" />
                  {t('explorerPaste')}
                </button>
              )}
            </>
          ) : (
            // Menú para área vacía (pegar en carpeta actual)
            <button
              onClick={() => handlePaste(contextMenu.targetPath || currentPath)}
              disabled={!hasClipboardContent}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors",
                hasClipboardContent
                  ? "text-foreground/70 hover:bg-muted hover:text-foreground"
                  : "text-muted-foreground/60 cursor-not-allowed"
              )}
            >
              <Clipboard className="w-3.5 h-3.5" />
              {t('explorerPaste')}
            </button>
          )}
        </div>
      )}
    </div>
    {dialogMode && (
      <div className="fixed inset-0 z-[10000]" onClick={(e) => { if (e.target === e.currentTarget) closeDialog(); }}>
        <div className="fixed inset-0 bg-background/60 backdrop-blur-sm" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-border/50 bg-background p-5">
            <h3 className="text-sm font-semibold text-foreground mb-3">
              {dialogMode === 'create-folder' && t('explorerDialogCreateFolder')}
              {dialogMode === 'create-file' && t('explorerDialogCreateFile')}
              {dialogMode === 'rename-item' && (dialogItem?.type === 'folder' ? t('explorerDialogRename') + ' ' + t('explorerRenameFolder').toLowerCase() : t('explorerDialogRename') + ' ' + t('explorerRenameFile').toLowerCase())}
              {dialogMode === 'delete-item' && (dialogItem?.type === 'folder' ? t('explorerDialogDelete') + ' ' + t('explorerDeleteFolder').toLowerCase() : t('explorerDialogDelete') + ' ' + t('explorerDeleteFile').toLowerCase())}
            </h3>

            {(dialogMode === 'create-folder' || dialogMode === 'create-file' || dialogMode === 'rename-item') && (
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground block">
                  {dialogMode === 'create-folder'
                    ? t('explorerDialogFolderName')
                    : dialogMode === 'rename-item'
                      ? t('explorerDialogNewName')
                      : t('explorerDialogFileName')}
                </label>
                <input
                  value={dialogValue}
                  onChange={(e) => setDialogValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submitDialog();
                  }}
                  autoFocus
                  className="w-full rounded-lg bg-[#030712] border border-border/50 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
                />
              </div>
            )}

            {dialogMode === 'delete-item' && (
              <p className="text-sm text-foreground/70">
                {dialogItem?.type === 'folder'
                  ? t('explorerDialogConfirmDeleteFolder').replace('{name}', dialogItem?.name || '')
                  : t('explorerDialogConfirmDeleteFile').replace('{name}', dialogItem?.name || '')}
              </p>
            )}

            {dialogError && (
              <p className="mt-3 text-xs text-destructive">{dialogError}</p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={closeDialog}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-border/50 text-foreground/70 hover:bg-card"
              >
                {t('explorerDialogCancel')}
              </button>
              <button
                onClick={() => void submitDialog()}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary hover:bg-primary text-foreground"
              >
                {dialogMode === 'delete-item' ? t('explorerDialogDeleteBtn') : dialogMode === 'rename-item' ? t('explorerDialogRename') : t('explorerDialogSave')}
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
