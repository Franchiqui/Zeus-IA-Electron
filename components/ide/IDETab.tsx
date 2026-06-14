'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useStore } from '@/lib/store';
import FileExplorer from './FileExplorer';
import TerminalPanel from './TerminalPanel';
import CodeEditor from '@/components/CodeEditor';
import CodeComparator from '@/components/CodeComparator';
import FormatCodeTab from './FormatCodeTab';
import SchemaTab from './SchemaTab';
import FolderComparatorTab from './FolderComparatorTab';
// NOTA: `initZeusMonaco` y `loadInstalledExtensions` se importan dinámicamente
// dentro de un useEffect (no arriba) para no romper el SSR — `init.ts`
// importa `monaco-editor` que accede a `window` en runtime, así que cualquier
// import estático en un componente pre-renderizado por Next.js fallaría con
// "window is not defined".
import {
  Terminal as TerminalIcon,
  Code,
  Folder,
  FolderOpen,
  X,
  Maximize2,
  Minimize2,
  RefreshCw,
  Save,
  Play,
  Settings,
  FolderTree,
  Sparkles,
  Wrench,
  ShieldCheck,
  ShieldAlert,
  Square,
  AlertCircle,
  Hammer,
  ImageIcon,
  Upload,
  Zap,
  GitCompare,
  GitBranch,
  Undo2,
  Puzzle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useEditor } from '@/context/editor-context';
import { useTerminal } from '@/context/TerminalContext';
import { useTranslation } from '@/contexts/translation-context';
import EnvironmentPathSetter from '@/components/EnvironmentPathSetter';
import PlanExecutorModal from '@/components/modals/PlanExecutorModal';
import UndoDiffModal from '@/components/modals/UndoDiffModal';
import GitPanel from './GitPanel';
import { GitHubSvg } from '@/components/ui/github-icon';
import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';
// ThemePicker importa módulos de Monaco que tocan `window` en scope de
// módulo. Lo cargamos dinámicamente (ssr: false) para no romper el SSR.
const ThemePicker = dynamic(
  () => import('./ThemePicker').then((m) => m.ThemePicker),
  { ssr: false, loading: () => <div className="h-7 w-24 rounded-md border border-border/50 bg-background/50" /> },
) as ComponentType;

// MarketplaceTab arrastra @codingame/monaco-vscode-api y @codingame/* que
// tocan `window` en scope de módulo. Lo cargamos en cliente únicamente
// para no romper el pre-render de la página `/`.
const MarketplaceTab = dynamic(
  () => import('./MarketplaceTab'),
  { ssr: false, loading: () => <div className="flex items-center justify-center h-full text-muted-foreground/80 text-sm">Cargando marketplace…</div> },
) as ComponentType;

export default function IDETab({ onOpenPreview, onOpenGitHubModal }: { onOpenPreview?: () => void; onOpenGitHubModal?: () => void }) {
  const { t } = useTranslation();

  console.log('IDETab: Componente montado');

  const {
    openFiles,
    setOpenFiles,
    activeFile,
    setActiveFile,
    openFile,
    pendingCorrection,
    askZeus
  } = useEditor();

  const selectedModel = useStore((state) => state.selectedModel);
  const globalPreviewUrl = useStore((state) => state.previewUrl);
  const setGlobalPreviewUrl = useStore((state) => state.setPreviewUrl);
  const refreshExplorer = useStore((state) => state.refreshExplorer);
  const { executeCommand, toggleTerminal, addLocalMessage, isConnected: isTerminalConnected } = useTerminal();

  const [explorerWidth, setExplorerWidth] = useState(300);
  const [terminalHeight, setTerminalHeight] = useState(200);
  const [isExplorerOpen, setIsExplorerOpen] = useState(true);
  const [isTerminalOpen, setIsTerminalOpen] = useState(true);
  const [isFormatCodeOpen, setIsFormatCodeOpen] = useState(false);
  const [isCodeComparatorOpen, setIsCodeComparatorOpen] = useState(false);
  const [isFolderComparatorOpen, setIsFolderComparatorOpen] = useState(false);
  const [isSchemaOpen, setIsSchemaOpen] = useState(false);
  const [isSplitViewOpen, setIsSplitViewOpen] = useState(false);
  const [correctedContent, setCorrectedContent] = useState('');
  const [isCorrecting, setIsCorrecting] = useState(false);
  const [isFixImportsOpen, setIsFixImportsOpen] = useState(false);
  const [fixImportsContent, setFixImportsContent] = useState('');
  const [isFixingImports, setIsFixingImports] = useState(false);
  const [isValidateOpen, setIsValidateOpen] = useState(false);
  const [validateContent, setValidateContent] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [isFixDepsOpen, setIsFixDepsOpen] = useState(false);
  const [fixDepsContent, setFixDepsContent] = useState('');
  const [isFixingDeps, setIsFixingDeps] = useState(false);

  // Git panel state
  const [isGitPanelOpen, setIsGitPanelOpen] = useState(false);
  const [gitPanelWidth, setGitPanelWidth] = useState(300);

  // Extensions tab state
  const [isExtensionsOpen, setIsExtensionsOpen] = useState(false);

  // Icon generator modal state
  const [iconModalOpen, setIconModalOpen] = useState(false);
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [iconGenerating, setIconGenerating] = useState(false);
  const [iconGenerated, setIconGenerated] = useState(false);
  const [iconMode, setIconMode] = useState<'upload' | 'prompt'>('upload');
  const [iconPrompt, setIconPrompt] = useState('');
  const [iconApiKey, setIconApiKey] = useState('');

  const [currentExplorerPath, setCurrentExplorerPath] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('zeus_current_explorer_path') || '';
    }
    return '';
  });

  // Plan Executor modal state
  const [isPlanExecutorOpen, setIsPlanExecutorOpen] = useState(false);
  const [planExecutorMessages, setPlanExecutorMessages] = useState<any[]>([]);
  const [projectExplorerData, setProjectExplorerData] = useState<any[]>([]);

  const fetchProjectExplorer = useCallback(async () => {
    if (!currentExplorerPath) return;
    try {
      const res = await fetch(`/api/ide-files?path=${encodeURIComponent(currentExplorerPath)}&type=all`);
      if (!res.ok) return;
      const data = await res.json();
      if (!data.success) return;
      const files = (data.files || []).map((f: any) => f.path || f.name);
      const folders = (data.folders || []).map((f: any) => f.path || f.name);
      const allPaths = [...folders.map((p: string) => p + '/'), ...files];

      type Node = { name: string; path: string; type: 'file' | 'directory'; children?: Node[] };
      const root: Node = { name: '', path: '', type: 'directory', children: [] };
      const dirMap = new Map<string, Node>();
      dirMap.set('', root);

      for (const relPath of allPaths) {
        const clean = relPath.replace(/^\/+/, '').replace(/\/$/, '');
        if (!clean) continue;
        const isFile = !relPath.endsWith('/');
        const parts = clean.split('/').filter(Boolean);
        let currPath = '';
        let parent = root;
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          const nextPath = currPath ? `${currPath}/${part}` : part;
          if (isFile && i === parts.length - 1) {
            parent.children = parent.children || [];
            if (!parent.children.find((c: Node) => c.name === part && c.type === 'file')) {
              parent.children.push({ name: part, path: nextPath, type: 'file' });
            }
          } else {
            let dirNode = dirMap.get(nextPath);
            if (!dirNode) {
              dirNode = { name: part, path: nextPath, type: 'directory', children: [] };
              parent.children = parent.children || [];
              parent.children.push(dirNode);
              dirMap.set(nextPath, dirNode);
            }
            parent = dirNode;
          }
          currPath = nextPath;
        }
      }
      setProjectExplorerData(root.children || []);
    } catch (e) {
      console.warn('[IDETab] Error cargando explorer:', e);
    }
  }, [currentExplorerPath]);

  useEffect(() => {
    if (isPlanExecutorOpen) {
      fetchProjectExplorer();
    }
  }, [isPlanExecutorOpen, fetchProjectExplorer]);

  const [schemaRefreshTrigger, setSchemaRefreshTrigger] = useState(0);
  const [isPreviewRunning, setIsPreviewRunning] = useState(false);
  const [isBuildRunning, setIsBuildRunning] = useState(false);
  const [previewPort, setPreviewPort] = useState(3000);
  const [previewErrorBubble, setPreviewErrorBubble] = useState<{
    title: string;
    message: string;
    stdout?: string;
    stderr?: string;
  } | null>(null);

  // Cleanup: detener preview anterior cuando cambia el proyecto o se desmonta
  useEffect(() => {
    return () => {
      if (currentExplorerPath && isPreviewRunning) {
        const dataPath = (typeof window !== 'undefined' ? localStorage.getItem('ZEUS_DATA_PATH') || '' : '').replace(/\\/g, '/').replace(/\/+$/, '');
        const projectPath = dataPath + (currentExplorerPath ? '/' + currentExplorerPath.replace(/^\/+/, '') : '');
        if (projectPath) {
          fetch('/api/run-project-dev', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectPath })
          }).catch(() => {});
        }
      }
    };
  }, [currentExplorerPath]);

  // Guardar path del explorador en localStorage para que el panel de control lo lea
  useEffect(() => {
    localStorage.setItem('zeus_current_explorer_path', currentExplorerPath);
  }, [currentExplorerPath]);

  // Trigger refresh del esquema cuando cambia el path
  useEffect(() => {
    if (currentExplorerPath) {
      setSchemaRefreshTrigger(prev => prev + 1);
    }
  }, [currentExplorerPath]);

  // Forzar actualización del esquema cuando se abre la pestaña
  useEffect(() => {
    if (isSchemaOpen) {
      setSchemaRefreshTrigger(prev => prev + 1);
    }
  }, [isSchemaOpen]);

  // Abrir automáticamente el archivo cuando hay una corrección pendiente
  useEffect(() => {
    if (!pendingCorrection) return;

    const normalizedPath = (pendingCorrection.path || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const fileName = pendingCorrection.file;
    const fullPath = normalizedPath ? `${normalizedPath}/${fileName}` : fileName;

    if (activeFile !== fullPath) {
      console.log('[IDETab] Abriendo archivo para corrección pendiente:', fullPath);
      openFile(fullPath, fileName);
    }
  }, [pendingCorrection, activeFile, openFile]);

  // Resetear path del explorador y cerrar archivos cuando cambia DATA_PATH
  useEffect(() => {
    const handleReset = () => setCurrentExplorerPath('');
    const handleClearFiles = () => {
      setOpenFiles([]);
      setActiveFile(null);
    };
    window.addEventListener('resetExplorerPath', handleReset);
    window.addEventListener('clearEditorFiles', handleClearFiles);
    return () => {
      window.removeEventListener('resetExplorerPath', handleReset);
      window.removeEventListener('clearEditorFiles', handleClearFiles);
    };
  }, []);

  // Cargar las extensiones instaladas en el host de extensiones AL INICIO,
  // no solo cuando se abre la pestaña Marketplace. Si no, el ThemePicker
  // queda con la lista vacía hasta que el usuario navega a "Extensiones"
  // y abre la pestaña (escenario: el usuario reinicia, abre la app,
  // selecciona un tema en el picker — pero no hay temas de extensiones
  // porque `loadInstalledExtensions` aún no se ha llamado).
  // Import dinámico para no romper el SSR.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { initZeusMonaco } = await import('@/lib/zeus-monaco/init');
        const { loadInstalledExtensions } = await import('@/lib/zeus-monaco/extensions');
        await initZeusMonaco();
        if (cancelled) return;
        const loaded = await loadInstalledExtensions();
        if (cancelled) return;
        // Avisar al ThemePicker (y a quien escuche) que el host tiene
        // extensiones aplicadas. El ThemePicker se monta al mismo tiempo
        // que este IDETab, así que también recargamos manualmente para
        // cubrir el caso de que ya estuviera montado con la lista vacía.
        window.dispatchEvent(
          new CustomEvent('zeus:extensions-changed', {
            detail: { loaded: true, count: loaded.length, source: 'IDETab-init' },
          }),
        );
        console.log(`[IDETab] Extensiones precargadas en el host: ${loaded.length}`);
      } catch (err) {
        console.warn('[IDETab] Error precargando extensiones:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const { toast } = useToast();

  // Refs para redimensionamiento
  const isResizingExplorer = useRef(false);
  const isResizingTerminal = useRef(false);
  const isResizingGit = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleFileSelect = async (path: string, name: string) => {
    await openFile(path, name);
  };

  // === Undo con diff ===
  const [isUndoModalOpen, setIsUndoModalOpen] = useState(false);
  const [undoLoading, setUndoLoading] = useState(false);
  const [undoBackupContent, setUndoBackupContent] = useState<string | null>(null);

  const getActiveFileParts = (): { name: string; folder: string } | null => {
    if (!activeFile) return null;
    const normalized = activeFile.replace(/\\/g, '/');
    const lastSlash = normalized.lastIndexOf('/');
    return {
      name: lastSlash === -1 ? normalized : normalized.substring(lastSlash + 1),
      folder: lastSlash === -1 ? '' : normalized.substring(0, lastSlash),
    };
  };

  const handleOpenUndoDiff = async () => {
    const parts = getActiveFileParts();
    if (!parts) {
      toast({ title: t('toastEmptyFile'), description: t('selectFileToBeginCoding'), variant: 'destructive' });
      return;
    }
    setUndoLoading(true);
    try {
      // Pedimos el archivo en modo raw: la API devuelve el contenido si existe, o 404.
      // Para el backup, leemos directamente file.zeus-backup usando un fetch "raw" al nombre + ".zeus-backup".
      const res = await fetch(
        `/api/ide-files?path=${encodeURIComponent(parts.folder)}&name=${encodeURIComponent(parts.name + '.zeus-backup')}`
      );
      if (!res.ok) {
        // Sin backup o error: notificamos con toast en vez de abrir un modal sin sentido
        if (res.status === 404) {
          toast({ title: t('undoDiffTitle'), description: t('undoNoBackup'), variant: 'destructive' });
        } else {
          const data = await res.json().catch(() => ({}));
          toast({ title: t('undoDiffTitle'), description: data.error || t('toastUnknownError'), variant: 'destructive' });
        }
        return;
      }
      const data = await res.json();
      const content = typeof data.content === 'string' ? data.content : '';
      // Si el backup está vacío (sin cambios previos), también notificamos
      if (!content) {
        toast({ title: t('undoDiffTitle'), description: t('undoNoBackup'), variant: 'destructive' });
        return;
      }
      setUndoBackupContent(content);
      setIsUndoModalOpen(true);
    } catch (err: any) {
      toast({ title: t('undoDiffTitle'), description: err?.message || t('toastUnknownError'), variant: 'destructive' });
    } finally {
      setUndoLoading(false);
    }
  };

  const handleConfirmUndo = async () => {
    const parts = getActiveFileParts();
    if (!parts) return;
    try {
      const res = await fetch('/api/ide-files/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: parts.folder, name: parts.name }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || t('toastUnknownError'));
      }
      // Releer el archivo desde disco y actualizar el editor
      const fresh = await fetch(
        `/api/ide-files?path=${encodeURIComponent(parts.folder)}&name=${encodeURIComponent(parts.name)}`
      );
      const freshData = await fresh.json();
      const newContent = typeof freshData.content === 'string' ? freshData.content : '';
      if (activeFile) {
        const normalizedFullPath = activeFile.replace(/\\/g, '/');
        setOpenFiles(prev => prev.map(f =>
          (f.path || '').replace(/\\/g, '/') === normalizedFullPath
            ? { ...f, content: newContent }
            : f
        ));
      }
      toast({ title: t('undoRestored'), description: parts.name });
      setIsUndoModalOpen(false);
    } catch (err: any) {
      toast({
        title: t('toastSaveError'),
        description: err?.message || t('toastUnknownError'),
        variant: 'destructive',
      });
    }
  };

  const handleSave = async (fullPath: string, content: string) => {
    try {
      // Normalizar la ruta (convertir backslashes a forward slashes)
      const normalizedPath = fullPath.replace(/\\/g, '/');
      
      // Separar nombre de archivo y ruta de la carpeta
      const lastSlashIndex = normalizedPath.lastIndexOf('/');
      let fileName = '';
      let folderPath = '';
      
      if (lastSlashIndex !== -1) {
        fileName = normalizedPath.substring(lastSlashIndex + 1);
        folderPath = normalizedPath.substring(0, lastSlashIndex);
      } else {
        fileName = normalizedPath;
        folderPath = '';
      }

      console.log('💾 Guardando archivo:', { fullPath, fileName, folderPath, contentLength: content.length });

      // Usar el endpoint de Next.js para guardar archivos
      const response = await fetch('/api/ide-files', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'save',
          path: folderPath,
          name: fileName,
          content
        })
      });

      const result = await response.json();
      if (response.ok && result.success) {
        toast({ title: t('toastSaved'), description: t('toastSavedDesc').replace('{fileName}', fileName) });
        // Actualizar el contenido en el estado local (normalizar rutas para comparación)
        const normalizedFullPath = (fullPath || '').replace(/\\/g, '/');
        setOpenFiles(prev => prev.map(f => ((f.path || '').replace(/\\/g, '/') === normalizedFullPath) ? { ...f, content } : f));
      } else {
        throw new Error(result.error || 'Error al guardar');
      }
    } catch (error: any) {
      toast({
        title: t('toastSaveError'),
        description: error.message || t('toastUnknownError'),
        variant: 'destructive'
      });
      throw error;
    }
  };

  const closeFile = (path: string) => {
    const newFiles = openFiles.filter(f => f.path !== path);
    setOpenFiles(newFiles);
    if (activeFile === path) {
      setActiveFile(newFiles.length > 0 ? newFiles[newFiles.length - 1].path : null);
    }
  };

  const handleCorrectFile = async () => {
    if (!activeFile) return;
    const currentContent = openFiles.find(f => f.path === activeFile)?.content || '';
    if (!currentContent.trim()) {
      toast({ title: t('toastEmptyFile'), description: t('toastEmptyFileDesc'), variant: 'destructive' });
      return;
    }

    setIsCorrecting(true);
    try {
      const fileName = activeFile.split(/[\\/]/).pop() || '';
      const response = await fetch('/api/correct-file-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileContent: currentContent,
          fileName,
          modelConfig: selectedModel ? {
            url: selectedModel.base_url,
            apiKey: selectedModel.api_key,
            model: selectedModel.model_name,
            provider: selectedModel.provider || selectedModel.type,
            id: selectedModel.id,
            name: selectedModel.nombre_modelo || selectedModel.name
          } : undefined
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Error al corregir el archivo');
      }

      const corrected = result.correctedContent || result.fullContent || result.content || '';
      if (corrected) {
        // Streaming del contenido corregido
        setCorrectedContent('');
        const chunkSize = 8;
        const delayMs = 12;
        let index = 0;
        const streamInterval = setInterval(() => {
          index += chunkSize;
          if (index >= corrected.length) {
            setCorrectedContent(corrected);
            clearInterval(streamInterval);
          } else {
            setCorrectedContent(corrected.slice(0, index));
          }
        }, delayMs);
        toast({ title: 'Corrección completada', description: 'El código corregido se muestra en el panel derecho.' });
      } else {
        toast({ title: 'Sin cambios', description: 'El modelo no sugirió correcciones.' });
      }
    } catch (error: any) {
      toast({ title: t('toastCorrectionError'), description: error.message || t('toastUnknownError'), variant: 'destructive' });
    } finally {
      setIsCorrecting(false);
    }
  };

  const handleFixMissingImports = async () => {
    const dataPath = typeof window !== 'undefined' ? localStorage.getItem('ZEUS_DATA_PATH') || '' : '';
    if (!dataPath) {
      toast({ title: 'Sin DATA_PATH', description: 'Configura DATA_PATH en el campo superior del explorador.', variant: 'destructive' });
      return;
    }
    setIsFixingImports(true);
    setFixImportsContent('');
    try {
      const absoluteProjectRoot = dataPath.replace(/\\/g, '/').replace(/\/+$/, '') + '/' + currentExplorerPath.replace(/^\/+/, '');

      const response = await fetch('/api/fix-missing-imports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectRoot: absoluteProjectRoot, stream: true }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Error al escanear importaciones');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      if (!reader) throw new Error('No se pudo leer el stream');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const jsonStr = trimmed.slice(5).trim();
          if (!jsonStr) continue;
          try {
            const event = JSON.parse(jsonStr);
            if (event.type === 'start') {
              setFixImportsContent(prev => prev + `🚀 ${event.message}\n`);
            } else if (event.type === 'round') {
              setFixImportsContent(prev => prev + `\n━━━━━━━━━━━━━━━━━━━━\n🔄 ${event.message}\n━━━━━━━━━━━━━━━━━━━━\n`);
            } else if (event.type === 'info') {
              setFixImportsContent(prev => prev + `ℹ️ ${event.message}\n`);
            } else if (event.type === 'found') {
              setFixImportsContent(prev => prev + `📋 ${event.message}\n`);
            } else if (event.type === 'ready') {
              setFixImportsContent(prev => prev + `📦 ${event.message}\n`);
            } else if (event.type === 'generating') {
              setFixImportsContent(prev => prev + `🔧 ${event.message}\n`);
            } else if (event.type === 'generated') {
              setFixImportsContent(prev => prev + `✅ ${event.message}\n`);
              if (event.content) {
                setFixImportsContent(prev => prev + `\n--- ${event.file} ---\n${event.content}\n`);
              }
            } else if (event.type === 'skipped') {
              setFixImportsContent(prev => prev + `⏭️ ${event.message}\n`);
            } else if (event.type === 'error') {
              setFixImportsContent(prev => prev + `❌ ${event.message}\n`);
            } else if (event.type === 'complete') {
              setFixImportsContent(prev => prev + `\n🏁 Completado. ${event.totalCreated ?? 0} archivos creados.\n`);
            }
          } catch {
            // ignorar líneas malformadas
          }
        }
      }
    } catch (error: any) {
      toast({ title: t('toastFixImportsError'), description: error.message || t('toastUnknownError'), variant: 'destructive' });
    } finally {
      setIsFixingImports(false);
    }
  };

  const handleValidateComponents = async () => {
    const dataPath = typeof window !== 'undefined' ? localStorage.getItem('ZEUS_DATA_PATH') || '' : '';
    if (!dataPath) {
      toast({ title: 'Sin DATA_PATH', description: 'Configura DATA_PATH en el campo superior del explorador.', variant: 'destructive' });
      return;
    }
    setIsValidating(true);
    setValidateContent('');
    try {
      const absoluteProjectRoot = dataPath.replace(/\\/g, '/').replace(/\/+$/, '') + '/' + currentExplorerPath.replace(/^\/+/, '');
      const response = await fetch('/api/validate-components', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectRoot: absoluteProjectRoot,
          modelConfig: selectedModel ? {
            url: selectedModel.base_url,
            apiKey: selectedModel.api_key,
            model: selectedModel.model_name,
            provider: selectedModel.provider || selectedModel.type,
            id: selectedModel.id,
            name: selectedModel.nombre_modelo || selectedModel.name
          } : undefined
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Error al validar componentes');
      }

      const result = await response.json();

      // Construir informe legible
      let report = `🔍 VALIDACIÓN DE COMPONENTES\n`;
      report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
      report += `📊 Resumen:\n`;
      report += `  • Total componentes: ${result.totalComponents ?? 0}\n`;
      report += `  • Validados: ${result.validatedComponents ?? 0}\n`;
      report += `  • Válidos: ${result.validComponents ?? 0}\n`;
      report += `  • Con problemas: ${result.invalidComponents ?? 0}\n\n`;

      if (result.summary) {
        report += `📝 ${result.summary}\n\n`;
      }

      if (result.components && result.components.length > 0) {
        for (const comp of result.components) {
          const statusIcon = comp.isValid ? '✅' : '⚠️';
          report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
          report += `${statusIcon} ${comp.relativePath}\n`;
          report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

          if (comp.issues && comp.issues.length > 0) {
            for (const issue of comp.issues) {
              const severityIcon = issue.severity === 'critical' ? '🔴' : issue.severity === 'high' ? '🟠' : issue.severity === 'medium' ? '🟡' : '🔵';
              report += `  ${severityIcon} [${issue.type?.toUpperCase() || 'INFO'}] ${issue.message}\n`;
              if (issue.suggestion) {
                report += `     💡 Sugerencia: ${issue.suggestion}\n`;
              }
              report += `\n`;
            }
          }

          if (comp.propsAnalysis) {
            const pa = comp.propsAnalysis;
            report += `  📦 Props:\n`;
            if (pa.propsDefined?.length) report += `     Definidos: ${pa.propsDefined.join(', ')}\n`;
            if (pa.propsUsed?.length) report += `     Usados: ${pa.propsUsed.join(', ')}\n`;
            if (pa.missingProps?.length) report += `     ❌ Faltantes: ${pa.missingProps.join(', ')}\n`;
            if (pa.unusedProps?.length) report += `     ⚠️ No usados: ${pa.unusedProps.join(', ')}\n`;
            if (pa.typeErrors?.length) report += `     📝 Errores de tipo: ${pa.typeErrors.join(', ')}\n`;
            report += `\n`;
          }

          if (comp.functionalityIssues && comp.functionalityIssues.length > 0) {
            report += `  🔧 Problemas de funcionalidad:\n`;
            for (const fi of comp.functionalityIssues) {
              report += `     • ${fi}\n`;
            }
            report += `\n`;
          }

          if (comp.correctedCode) {
            report += `  🛠️ CÓDIGO CORREGIDO:\n`;
            report += `  \`\`\`tsx\n${comp.correctedCode}\n\`\`\`\n\n`;
          }
        }
      } else {
        report += `ℹ️ No se encontraron componentes para validar.\n`;
      }

      setValidateContent(report);
      toast({ title: 'Validación completada', description: `Revisa el informe en el panel derecho.` });
    } catch (error: any) {
      toast({ title: t('toastValidationError'), description: error.message || t('toastUnknownError'), variant: 'destructive' });
    } finally {
      setIsValidating(false);
    }
  };

  const generateIcon = async () => {
    const dataPath = typeof window !== 'undefined' ? localStorage.getItem('ZEUS_DATA_PATH') || '' : '';
    if (!dataPath) {
      toast({ title: 'Sin DATA_PATH', description: 'Configura DATA_PATH en el campo superior del explorador.', variant: 'destructive' });
      return;
    }
    if (!iconFile && iconMode === 'upload') {
      toast({ title: 'Sin archivo', description: 'Selecciona un PNG primero.', variant: 'destructive' });
      return;
    }
    if (iconMode === 'prompt' && (!iconPrompt.trim() || !iconApiKey.trim())) {
      toast({ title: 'Faltan datos', description: 'Escribe un prompt y tu API Key de OpenAI.', variant: 'destructive' });
      return;
    }
    setIconGenerating(true);
    setIconGenerated(false);
    try {
      const absoluteProjectRoot = dataPath.replace(/\\/g, '/').replace(/\/+$/, '') + '/' + currentExplorerPath.replace(/^\/+/, '');
      let body: any = { projectRoot: absoluteProjectRoot, output: 'public/installer-icon.ico' };
      if (iconMode === 'upload') {
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(iconFile!);
        });
        body = { ...body, mode: 'input', inputBase64: base64 };
      } else {
        body = { ...body, mode: 'prompt', prompt: iconPrompt.trim(), openaiApiKey: iconApiKey.trim() };
      }
      const res = await fetch('/api/generate-icon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Error generando icono');
      }
      setIconGenerated(true);
      toast({ title: t('toastIconGenerated'), description: data.message || t('toastIconGeneratedDesc') });
    } catch (err: any) {
      console.error('Error generando icono:', err);
      toast({ title: t('toastIconError'), description: err?.message || t('toastIconErrorDesc'), variant: 'destructive' });
    } finally {
      setIconGenerating(false);
    }
  };

  const handleFixDependencies = async () => {
    const dataPath = typeof window !== 'undefined' ? localStorage.getItem('ZEUS_DATA_PATH') || '' : '';
    if (!dataPath) {
      toast({ title: 'Sin DATA_PATH', description: 'Configura DATA_PATH en el campo superior del explorador.', variant: 'destructive' });
      return;
    }
    setIsFixingDeps(true);
    setFixDepsContent('');
    try {
      const absoluteProjectRoot = dataPath.replace(/\\/g, '/').replace(/\/+$/, '') + '/' + currentExplorerPath.replace(/^\/+/, '');
      
      // Obtener contenido actual si package.json está abierto en el editor
      const activeFileNorm = (activeFile || '').replace(/\\/g, '/');
      const isPkgOpen = activeFileNorm.endsWith('package.json');
      const pkgContent = isPkgOpen ? openFiles.find(f => (f.path || '').replace(/\\/g, '/') === activeFileNorm)?.content : undefined;

      const response = await fetch('/api/fix-dependencies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectRoot: absoluteProjectRoot,
          packageJsonContent: pkgContent,
          modelConfig: selectedModel ? {
            url: selectedModel.base_url,
            apiKey: selectedModel.api_key,
            model: selectedModel.model_name,
            provider: selectedModel.provider || selectedModel.type,
            id: selectedModel.id,
            name: selectedModel.nombre_modelo || selectedModel.name
          } : undefined
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Error al analizar dependencias');
      }

      const result = await response.json();

      let report = `🛡️ ANÁLISIS DE DEPENDENCIAS (Iteraciones: ${result.iterationCount || 1})\n`;
      report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
      report += `📊 Estado final: ${result.resolved ? '✅ SIN CONFLICTOS' : '⚠️ PERSISTEN CONFLICTOS'}\n\n`;

      if (result.report) {
        report += `📝 Informe detallado:\n${result.report}\n\n`;
      }

      if (result.correctedPackageJson) {
        report += `✅ package.json propuesto:\n`;
        report += `\`\`\`json\n${JSON.stringify(result.correctedPackageJson, null, 2)}\n\`\`\`\n\n`;
      }

      setFixDepsContent(report);
      toast({ 
        title: result.resolved ? 'Dependencias optimizadas' : 'Análisis completado con advertencias', 
        description: `Se realizaron ${result.iterationCount || 1} iteraciones de corrección.` 
      });
    } catch (error: any) {
      toast({ title: 'Error de dependencias', description: error.message || 'Error desconocido', variant: 'destructive' });
    } finally {
      setIsFixingDeps(false);
    }
  };

  const handleStartPreview = async () => {
    const dataPath = (typeof window !== 'undefined' ? localStorage.getItem('ZEUS_DATA_PATH') || '' : '').replace(/\\/g, '/').replace(/\/+$/, '');
    const projectPath = dataPath + (currentExplorerPath ? '/' + currentExplorerPath.replace(/^\/+/, '') : '');

    if (!dataPath) {
      toast({ title: 'Sin DATA_PATH', description: 'Configura la ruta del proyecto en el explorador.', variant: 'destructive' });
      return;
    }

    setPreviewErrorBubble(null);
    toggleTerminal(true);
    addLocalMessage({ type: 'info', text: `[Preview] ${t('localPreviewPreparing').replace('{projectPath}', projectPath)}` });

    try {
      // 1. Verificar que existe package.json
      const pkgRes = await fetch(`/api/ide-files?name=package.json&path=${encodeURIComponent(currentExplorerPath)}`);
      const pkgData = await pkgRes.json();
      if (!pkgData.success) {
        addLocalMessage({ type: 'error', text: `[Preview] ${t('localPreviewNoPackageJson')}` });
        toast({ title: t('toastInvalidProject'), description: t('toastInvalidProjectDesc'), variant: 'destructive' });
        return;
      }

      // 2. Ejecutar npm install (si falta) y npm run dev vía backend
      addLocalMessage({ type: 'info', text: `[Preview] ${t('localPreviewSendingCommand')}` });
      toast({ title: t('toastStartingProject'), description: t('toastStartingProjectDesc'), variant: 'default' });

      const runRes = await fetch('/api/run-project-dev', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath, port: previewPort })
      });
      const runData = await runRes.json();

      if (!runData.success) {
        addLocalMessage({ type: 'error', text: `[Preview] Error: ${runData.error || 'No se pudo iniciar el proyecto'}` });
        setPreviewErrorBubble({
          title: t('previewErrorStartTitle'),
          message: runData.error || 'No se pudo iniciar el proyecto',
          stdout: runData.stdout,
          stderr: runData.stderr,
        });
        toast({ title: t('toastStartProjectError'), description: runData.error || t('toastUnknownError'), variant: 'destructive' });
        return;
      }

      if (runData.installed) {
        addLocalMessage({ type: 'success', text: `[Preview] ${t('localPreviewDepsInstalled')}` });
      }
      addLocalMessage({ type: 'success', text: `[Preview] ${t('localPreviewStarted').replace('{pid}', String(runData.pid))}` });

      // Mostrar logs del servidor si el backend los devolvió
      if (runData.stdout) {
        addLocalMessage({ type: 'info', text: `[DevServer] ${runData.stdout}` });
      }
      if (runData.stderr) {
        addLocalMessage({ type: 'warn', text: `[DevServer] ${runData.stderr}` });
      }

      // 3. Determinar puerto: preferir el que devolvió el backend (respeta PORT enviado), luego package.json, luego previewPort
      let expectedPort = previewPort;
      if (typeof runData.expectedPort === 'number' && Number.isFinite(runData.expectedPort)) {
        expectedPort = runData.expectedPort;
      } else {
        try {
          if (pkgData.success && pkgData.content) {
            const pkg = typeof pkgData.content === 'string' ? JSON.parse(pkgData.content) : pkgData.content;
            const devScript = pkg.scripts?.dev || '';
            const portMatch = devScript.match(/(?:-p|--port)\s+(\d+)/);
            if (portMatch) {
              expectedPort = parseInt(portMatch[1], 10);
            }
          }
        } catch {
          // usar previewPort como fallback
        }
      }

      const targetUrl = `http://localhost:${expectedPort}`;
      addLocalMessage({ type: 'info', text: `[Preview] ${t('localPreviewPort').replace('{expectedPort}', String(expectedPort))}` });

      // Polling inteligente: esperar hasta que el servidor realmente responda (hasta 60s)
      addLocalMessage({ type: 'info', text: `[Preview] ${t('localPreviewTimeout').replace('{url}', targetUrl)}` });
      let serverReady = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        await new Promise(r => setTimeout(r, 1000));
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 2000);
          await fetch(targetUrl, { method: 'HEAD', signal: ctrl.signal, mode: 'no-cors' });
          clearTimeout(t);
          serverReady = true;
          break;
        } catch {
          // Servidor aún no responde, seguir esperando
        }
      }

      if (!serverReady) {
        addLocalMessage({ type: 'error', text: `[Preview] ${t('localPreviewTimeout').replace('{url}', targetUrl)}` });
        setPreviewErrorBubble({
          title: t('previewErrorStartTitle'),
          message: t('previewErrorTimeout').replace('{url}', targetUrl),
        });
        toast({ title: 'Servidor no respondió', description: 'El proyecto puede tener un error de compilación. Revisa el terminal.', variant: 'destructive' });
        return;
      }

      setGlobalPreviewUrl(targetUrl);
      setIsPreviewRunning(true);
      addLocalMessage({ type: 'success', text: `[Preview] ${t('localPreviewReady').replace('{url}', targetUrl)}` });
      toast({ title: t('toastProjectRunning'), description: targetUrl, variant: 'default' });
      onOpenPreview?.();
    } catch (error: any) {
      addLocalMessage({ type: 'error', text: `[Preview] ${t('localPreviewError').replace('{error}', error.message || t('toastUnknownError'))}` });
      setPreviewErrorBubble({
        title: t('previewErrorUnexpected'),
        message: error.message || t('toastUnknownError'),
      });
      toast({ title: 'Error', description: error.message || 'Error desconocido', variant: 'destructive' });
    }
  };

  const handleSendErrorToModel = useCallback(() => {
    if (!previewErrorBubble) return;

    const parts = [
      '🔧 **Error de compilación en el preview:**',
      '',
      `**${previewErrorBubble.title}**`,
      previewErrorBubble.message,
    ];

    if (previewErrorBubble.stdout) {
      parts.push('', '**Stdout:**', '```', previewErrorBubble.stdout, '```');
    }
    if (previewErrorBubble.stderr) {
      parts.push('', '**Stderr:**', '```', previewErrorBubble.stderr, '```');
    }

    parts.push('', 'Por favor, analiza estos errores de compilación y sugiere correcciones para el proyecto.');

    askZeus(parts.join('\n'));
    setPreviewErrorBubble(null);
    toast({ title: 'Enviado al modelo', description: 'El error se ha enviado al chat de Zeus.' });
  }, [previewErrorBubble, askZeus, toast]);

  const handleStopPreview = async () => {
    const dataPath = (typeof window !== 'undefined' ? localStorage.getItem('ZEUS_DATA_PATH') || '' : '').replace(/\\/g, '/').replace(/\/+$/, '');
    const projectPath = dataPath + (currentExplorerPath ? '/' + currentExplorerPath.replace(/^\/+/, '') : '');

    if (!dataPath) {
      toast({ title: 'Sin DATA_PATH', description: 'Configura la ruta del proyecto en el explorador.', variant: 'destructive' });
      return;
    }

    try {
      const res = await fetch('/api/run-project-dev', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath })
      });
      const data = await res.json();
      if (data.success) {
        setIsPreviewRunning(false);
        setGlobalPreviewUrl(null);
        setPreviewErrorBubble(null);
        addLocalMessage({ type: 'info', text: `[Preview] ${t('localPreviewServerStopped')}` });
        toast({ title: t('toastServerStopped'), description: t('toastServerStoppedDesc'), variant: 'default' });
      } else {
        addLocalMessage({ type: 'warn', text: `[Preview] ${t('localPreviewNoServerRunning')}` });
      }
    } catch (error: any) {
      toast({ title: t('toastStopError'), description: error.message || t('toastUnknownError'), variant: 'destructive' });
    }
  };

  // Limpiar códigos ANSI de la salida del terminal
  const stripAnsi = (str: string) => str.replace(/\[[0-9;]*m/g, '');

  // Extraer rutas de archivo del output de errores
  const extractFilePathsFromErrors = (output: string): string[] => {
    const matches = output.match(/(?:\.\/|src\/|app\/|components\/|pages\/|lib\/)[\w/.-]+\.(tsx?|jsx?|json|css|scss|md)/gi);
    return matches ? [...new Set(matches)] : [];
  };

  const handleRunBuild = async () => {
    const dataPath = (typeof window !== 'undefined' ? localStorage.getItem('ZEUS_DATA_PATH') || '' : '').replace(/\\/g, '/').replace(/\/+$/, '');
    const projectPath = dataPath + (currentExplorerPath ? '/' + currentExplorerPath.replace(/^\/+/, '') : '');

    if (!dataPath) {
      toast({ title: 'Sin DATA_PATH', description: 'Configura la ruta del proyecto en el explorador.', variant: 'destructive' });
      return;
    }

    setIsBuildRunning(true);
    addLocalMessage({ type: 'info', text: `[Build] ${t('localBuildRunning').replace('{projectPath}', projectPath)}` });
    toggleTerminal(true);

    try {
      const res = await fetch('/api/run-project-build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath })
      });

      const data = await res.json();

      if (data.stdout) {
        for (const line of data.stdout.split('\n')) {
          if (line.trim()) {
            addLocalMessage({ type: 'info', text: stripAnsi(line) });
          }
        }
      }
      if (data.stderr) {
        for (const line of data.stderr.split('\n')) {
          if (line.trim()) {
            addLocalMessage({ type: 'warn', text: stripAnsi(line) });
          }
        }
      }

      if (data.success) {
        addLocalMessage({ type: 'success', text: '[Build] Build completado sin errores.' });
        toast({ title: 'Build exitoso', description: 'npm run build completado correctamente.', variant: 'default' });
      } else {
        const buildError = data.error || t('toastBuildError');
        addLocalMessage({ type: 'error', text: `[Build] ${t('localBuildFailed').replace('{buildError}', buildError)}` });

        const errorOutput = (data.stdout || '') + '\n' + (data.stderr || '');
        const relevantPaths = extractFilePathsFromErrors(errorOutput);

        const parts = [
          'Error de build detectado:',
          '',
          `Proyecto: ${projectPath}`,
          `Error: ${buildError}`,
        ];
        if (data.stdout?.trim()) {
          parts.push('', 'Stdout:', stripAnsi(data.stdout).slice(-3000));
        }
        if (data.stderr?.trim()) {
          parts.push('', 'Stderr:', stripAnsi(data.stderr).slice(-3000));
        }
        if (relevantPaths.length > 0) {
          parts.push('', 'Archivos mencionados en el error:', relevantPaths.join('\n'));
        }
        parts.push('', 'Instrucciones: analiza el error y proporciona correcciones exactas usando bloques code_change JSON. Incluye 3-5 lineas de contexto antes y despues en cada correccion.');

        askZeus(parts.join('\n'));
        toast({ title: 'Build falló', description: 'Los errores se han enviado al modelo de IA.', variant: 'destructive' });
      }
    } catch (error: any) {
      addLocalMessage({ type: 'error', text: `[Build] ${t('localBuildUnexpectedError').replace('{error}', error.message || t('toastUnknownError'))}` });
      toast({ title: t('toastBuildError'), description: error.message || t('toastUnknownError'), variant: 'destructive' });
    } finally {
      setIsBuildRunning(false);
    }
  };

  // Lógica de redimensionamiento
  const startResizingExplorer = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingExplorer.current = true;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', stopResizing);
    document.body.style.cursor = 'col-resize';
  }, []);

  const startResizingTerminal = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingTerminal.current = true;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', stopResizing);
    document.body.style.cursor = 'row-resize';
  }, []);

  const startResizingGit = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingGit.current = true;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', stopResizing);
    document.body.style.cursor = 'col-resize';
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isResizingExplorer.current && containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = e.clientX - containerRect.left;
      if (newWidth > 150 && newWidth < 500) {
        setExplorerWidth(newWidth);
      }
    } else if (isResizingGit.current && containerRef.current) {
      // Git panel puede estar a la derecha del explorer o a la izquierda del editor
      // Simplificación: lo calculamos como el espacio entre explorer y editor
      const containerRect = containerRef.current.getBoundingClientRect();
      const explorerW = isExplorerOpen ? explorerWidth : 0;
      const newGitWidth = e.clientX - containerRect.left - explorerW;
      if (newGitWidth > 200 && newGitWidth < 500) {
        setGitPanelWidth(newGitWidth);
      }
    } else if (isResizingTerminal.current && containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const newHeight = containerRect.bottom - e.clientY;
      if (newHeight > 100 && newHeight < 400) {
        setTerminalHeight(newHeight);
      }
    }
  }, [explorerWidth, isExplorerOpen]);

  const stopResizing = useCallback(() => {
    isResizingExplorer.current = false;
    isResizingTerminal.current = false;
    isResizingGit.current = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', stopResizing);
    document.body.style.cursor = 'default';
  }, [handleMouseMove]);

  return (
    <div ref={containerRef} className={cn(
      "flex flex-col h-full w-full border border-border/80 rounded-none overflow-hidden shadow-2xl relative",
      (isCodeComparatorOpen || isFolderComparatorOpen || isSchemaOpen) ? "bg-transparent" : "bg-background"
    )}>
      {/* IDE Top Bar */}
      <div className="flex items-center justify-between h-10 px-4 bg-background border-b border-border/80">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground uppercase tracking-widest">
            <Code className="w-3.5 h-3.5 text-primary" />
            Zeus IDE
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 border border-border/50 rounded px-1.5 py-0.5 bg-background/50 mr-8">
            <span className="text-[10px] text-success uppercase font-semibold">Port</span>
            <input
              type="number"
              value={previewPort}
              onChange={(e) => setPreviewPort(parseInt(e.target.value, 10) || 3000)}
              className="w-12 bg-transparent text-[10px] text-foreground/70 focus:outline-none text-center border-b border-transparent focus:border-primary"
              min={1024}
              max={65535}
              title={t('tabPreviewPort')}
            />
          </div>
          <ThemePicker />
          <button
            onClick={() => setIsExplorerOpen(!isExplorerOpen)}
            className={cn("p-1.5 rounded transition-colors border", isExplorerOpen ? "text-success bg-emerald-400/10 border-emerald-400/30" : "text-muted-foreground/80 hover:text-foreground/70 border-border/50")}
            title={t('tabToggleExplorer')}
          >
            <Folder className="w-4 h-4" />
          </button>
          <button
            onClick={handleOpenUndoDiff}
            disabled={!activeFile || undoLoading}
            className={cn(
              "p-1.5 rounded transition-colors border",
              !activeFile || undoLoading
                ? "text-muted-foreground/60 bg-muted/60/10 border-border/40/30 cursor-not-allowed"
                : "text-amber-400 hover:text-amber-300 bg-amber-400/10 border-amber-400/30"
            )}
            title={t('undoDiffTitle')}
          >
            <Undo2 className={cn("w-4 h-4", undoLoading && "animate-spin")} />
          </button>
          <button
            onClick={() => setIsGitPanelOpen(!isGitPanelOpen)}
            className={cn("p-1.5 rounded transition-colors border", isGitPanelOpen ? "text-accent bg-purple-400/10 border-purple-400/30" : "text-muted-foreground/80 hover:text-foreground/70 border-border/50")}
            title="Panel Git"
          >
            <GitBranch className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              if (isExtensionsOpen) {
                setIsExtensionsOpen(false);
              } else {
                setIsExplorerOpen(false);
                setIsFormatCodeOpen(false);
                setIsFolderComparatorOpen(false);
                setIsSchemaOpen(false);
                setIsSplitViewOpen(false);
                setIsFixImportsOpen(false);
                setIsValidateOpen(false);
                setIsFixDepsOpen(false);
                setIsCodeComparatorOpen(false);
                setIsGitPanelOpen(false);
                setIsExtensionsOpen(true);
              }
            }}
            className={cn("p-1.5 rounded transition-colors border", isExtensionsOpen ? "text-violet-400 bg-violet-400/10 border-violet-400/30" : "text-muted-foreground/80 hover:text-foreground/70 border-border/50")}
            title="Extensiones VS Code"
          >
            <Puzzle className="w-4 h-4" />
          </button>
          <button
            onClick={() => onOpenGitHubModal?.()}
            className={cn("p-1.5 rounded transition-colors border text-muted-foreground/80 hover:text-green-300 border-border/50")}
            title="GitHub"
          >
            <GitHubSvg className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIsTerminalOpen(!isTerminalOpen)}
            className={cn("p-1.5 rounded transition-colors border", isTerminalOpen ? "text-success bg-emerald-400/10 border-emerald-400/30" : "text-muted-foreground/80 hover:text-foreground/70 border-border/50")}
            title={t('tabToggleTerminal')}
          >
            <TerminalIcon className="w-4 h-4" />
          </button>
          <button
            onClick={handleStartPreview}
            disabled={isPreviewRunning}
            className={cn("p-1.5 rounded transition-colors border", isPreviewRunning ? "text-muted-foreground/80 bg-muted/60/10 border-border/30/30 cursor-not-allowed" : "text-primary hover:text-primary-foreground bg-blue-400/10 border-blue-400/30")}
            title={t('tabStartPreview')}
          >
            <Play className="w-4 h-4" />
          </button>
          <button
            onClick={handleRunBuild}
            disabled={isBuildRunning}
            className={cn("p-1.5 rounded transition-colors border", isBuildRunning ? "text-muted-foreground/80 bg-muted/60/10 border-border/30/30 cursor-not-allowed" : "text-amber-400 hover:text-amber-300 bg-amber-400/10 border-amber-400/30")}
            title={t('tabRunBuild')}
          >
            <Hammer className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              if (isFormatCodeOpen) {
                setIsFormatCodeOpen(false);
              } else {
                setIsExplorerOpen(false);
                setIsSchemaOpen(false);
                setIsFolderComparatorOpen(false);
                setIsSplitViewOpen(false);
                setIsFixImportsOpen(false);
                setIsValidateOpen(false);
                setIsFixDepsOpen(false);
                setIsFormatCodeOpen(true);
              }
            }}
            className={cn("p-1.5 rounded transition-colors border", isFormatCodeOpen ? "text-success bg-emerald-400/10 border-emerald-400/30" : "text-muted-foreground/80 hover:text-foreground/70 border-border/50")}
            title={t('tabFormatCode')}
          >
            <Code className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              if (isFolderComparatorOpen) {
                setIsFolderComparatorOpen(false);
              } else {
                setIsExplorerOpen(false);
                setIsSchemaOpen(false);
                setIsFormatCodeOpen(false);
                setIsSplitViewOpen(false);
                setIsFixImportsOpen(false);
                setIsValidateOpen(false);
                setIsFixDepsOpen(false);
                setIsFolderComparatorOpen(true);
              }
            }}
            className={cn("p-1.5 rounded transition-colors border", isFolderComparatorOpen ? "text-success bg-emerald-400/10 border-emerald-400/30" : "text-muted-foreground/80 hover:text-foreground/70 border-border/50")}
            title="Comparador de Carpetas"
          >
            <FolderOpen className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              if (isSchemaOpen) {
                setIsSchemaOpen(false);
              } else {
                setIsExplorerOpen(false);
                setIsFormatCodeOpen(false);
                setIsFolderComparatorOpen(false);
                setIsSplitViewOpen(false);
                setIsFixImportsOpen(false);
                setIsValidateOpen(false);
                setIsFixDepsOpen(false);
                setIsSchemaOpen(true);
              }
            }}
            className={cn("p-1.5 rounded transition-colors border", isSchemaOpen ? "text-success bg-emerald-400/10 border-emerald-400/30" : "text-muted-foreground/80 hover:text-foreground/70 border-border/50")}
            title={t('tabViewSchema')}
          >
            <FolderTree className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              if (isSplitViewOpen) {
                setIsSplitViewOpen(false);
              } else {
                setIsExplorerOpen(false);
                setIsSchemaOpen(false);
                setIsFormatCodeOpen(false);
                setIsFolderComparatorOpen(false);
                setIsFixImportsOpen(false);
                setIsSplitViewOpen(true);
              }
            }}
            className={cn("p-1.5 rounded transition-colors border", isSplitViewOpen ? "text-success bg-emerald-400/10 border-emerald-400/30" : "text-muted-foreground/80 hover:text-foreground/70 border-border/50")}
            title={t('tabCorrectFileCode')}
          >
            <Sparkles className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              if (isFixImportsOpen) {
                setIsFixImportsOpen(false);
              } else {
                setIsExplorerOpen(false);
                setIsSchemaOpen(false);
                setIsFormatCodeOpen(false);
                setIsFolderComparatorOpen(false);
                setIsSplitViewOpen(false);
                setIsFixImportsOpen(true);
                handleFixMissingImports();
              }
            }}
            className={cn("p-1.5 rounded transition-colors border", isFixImportsOpen ? "text-success bg-emerald-400/10 border-emerald-400/30" : "text-muted-foreground/80 hover:text-foreground/70 border-border/50")}
            title={t('tabFixMissingImports')}
          >
            <Wrench className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              if (isValidateOpen) {
                setIsValidateOpen(false);
              } else {
                setIsExplorerOpen(false);
                setIsSchemaOpen(false);
                setIsFormatCodeOpen(false);
                setIsFolderComparatorOpen(false);
                setIsSplitViewOpen(false);
                setIsFixImportsOpen(false);
                setIsValidateOpen(true);
                handleValidateComponents();
              }
            }}
            className={cn("p-1.5 rounded transition-colors border", isValidateOpen ? "text-success bg-emerald-400/10 border-emerald-400/30" : "text-muted-foreground/80 hover:text-foreground/70 border-border/50")}
            title={t('tabValidateComponents')}
          >
            <ShieldCheck className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              if (isFixDepsOpen) {
                setIsFixDepsOpen(false);
              } else {
                setIsExplorerOpen(false);
                setIsSchemaOpen(false);
                setIsFormatCodeOpen(false);
                setIsFolderComparatorOpen(false);
                setIsSplitViewOpen(false);
                setIsFixImportsOpen(false);
                setIsValidateOpen(false);
                setIsFixDepsOpen(true);
                handleFixDependencies();
              }
            }}
            className={cn("p-1.5 rounded transition-colors border", isFixDepsOpen ? "text-success bg-emerald-400/10 border-emerald-400/30" : "text-muted-foreground/80 hover:text-foreground/70 border-border/50")}
            title={t('tabFixDependencies')}
          >
            <ShieldAlert className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIconModalOpen(true)}
            className={cn("p-1.5 rounded transition-colors border", iconModalOpen ? "text-pink-400 bg-pink-400/10 border-pink-400/30" : "text-muted-foreground/80 hover:text-foreground/70 border-border/50")}
            title={t('tabGenerateIcon')}
          >
            <ImageIcon className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIsPlanExecutorOpen(true)}
            className={cn("p-1.5 rounded transition-colors border", isPlanExecutorOpen ? "text-violet-400 bg-violet-400/10 border-violet-400/30" : "text-muted-foreground/80 hover:text-foreground/70 border-border/50")}
            title={t('tabComponentGenerator')}
          >
            <Zap className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              if (isCodeComparatorOpen) {
                setIsCodeComparatorOpen(false);
              } else {
                setIsExplorerOpen(false);
                setIsSchemaOpen(false);
                setIsFormatCodeOpen(false);
                setIsFolderComparatorOpen(false);
                setIsSplitViewOpen(false);
                setIsFixImportsOpen(false);
                setIsValidateOpen(false);
                setIsFixDepsOpen(false);
                setIsCodeComparatorOpen(true);
              }
            }}
            className={cn("p-1.5 rounded transition-colors border", isCodeComparatorOpen ? "text-success bg-emerald-400/10 border-emerald-400/30" : "text-muted-foreground/80 hover:text-foreground/70 border-border/50")}
            title="Comparador de código"
          >
            <GitCompare className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Error Bubble */}
      {previewErrorBubble && (
        <div className="shrink-0 mx-4 mt-2 mb-1">
          <div className="flex items-start gap-3 bg-amber-950/60 border border-amber-800/60 text-amber-100 rounded-lg px-4 py-3 shadow-lg">
            <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-200">{previewErrorBubble.title}</p>
              <p className="text-xs text-amber-300/80 mt-1">{previewErrorBubble.message}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleSendErrorToModel}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary text-foreground text-xs font-medium rounded-md transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {t('tabSendToModel')}
              </button>
              <button
                onClick={() => setPreviewErrorBubble(null)}
                className="p-1.5 text-amber-400 hover:text-amber-200 hover:bg-amber-900/50 rounded-md transition-colors"
                title={t('tabCancel')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden relative min-h-0">
        {/* Explorer Sidebar */}
        {isExplorerOpen && (
          <div style={{ width: explorerWidth }} className="flex-shrink-0 border-right border-border/80 bg-background/50 flex flex-col relative group">
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-shrink-0">
                <EnvironmentPathSetter />
              </div>
              <div className="flex-1 overflow-hidden">
                <FileExplorer onFileSelect={handleFileSelect} currentPath={currentExplorerPath} setCurrentPath={setCurrentExplorerPath} />
              </div>
            </div>

            {/* Resize Handle */}
            <div
              onMouseDown={startResizingExplorer}
              className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/50 transition-colors z-10"
            />
          </div>
        )}

        {/* Git Panel Sidebar */}
        {isGitPanelOpen && (
          <div style={{ width: gitPanelWidth }} className="flex-shrink-0 border-r border-border/80 bg-background flex flex-col relative group">
            <GitPanel projectPath={currentExplorerPath} isOpen={isGitPanelOpen} onSetExplorerPath={setCurrentExplorerPath} />
            <div
              onMouseDown={startResizingGit}
              className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-accent/50 transition-colors z-10"
            />
          </div>
        )}

        {/* Editor Main Area */}
        <div className={cn("flex-1 flex flex-col min-w-0 min-h-0", (isCodeComparatorOpen || isFolderComparatorOpen || isSchemaOpen) ? "bg-transparent" : "bg-background")}>
          {/* Tabs */}
          <div className="flex items-center h-9 bg-background overflow-x-hidden border-b border-border/80">
            {openFiles.map((file, index) => {
              // Crear una clave única combinando path y un identificador único
              // Si hay archivos duplicados con la misma ruta, usamos un índice o timestamp
              const uniqueKey = file.id ? file.id : `${file.path}_${index}`;

              return (
                <div
                  key={uniqueKey}
                  onClick={() => setActiveFile(file.path)}
                  className={cn(
                    "flex items-center gap-2 px-3 h-full min-w-[120px] max-w-[200px] border-r border-border/80 cursor-pointer transition-all text-xs relative group",
                    activeFile === file.path ? "bg-background text-primary" : "bg-background text-muted-foreground/80 hover:bg-card"
                  )}
                >
                  <div className={cn(
                    "w-1 absolute left-0 top-0 bottom-0 transition-all",
                    activeFile === file.path ? "bg-primary" : "bg-transparent"
                  )} />
                  <FileIcon filename={file.name} className="w-3.5 h-3.5" />
                  <span className="truncate flex-1">{file.name}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); closeFile(file.path); }}
                    className="p-0.5 rounded-sm hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Editor Content */}
          <div className="flex-1 relative overflow-hidden min-h-0">
            {isExtensionsOpen ? (
              <MarketplaceTab />
            ) : isSchemaOpen ? (
              <SchemaTab currentPath={currentExplorerPath} refreshTrigger={schemaRefreshTrigger} />
            ) : isFormatCodeOpen ? (
              <FormatCodeTab />
            ) : isFolderComparatorOpen ? (
              <FolderComparatorTab />
            ) : isCodeComparatorOpen ? (
              <CodeComparator onClose={() => setIsCodeComparatorOpen(false)} />
            ) : isFixImportsOpen ? (
              <div className="flex h-full w-full">
                <div className="flex-1 min-w-0 border-r border-border/80">
                  {activeFile ? (
                    <CodeEditor
                      path={activeFile}
                      content={openFiles.find(f => f.path === activeFile)?.content || ''}
                      onSave={handleSave}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground/60 animate-pulse">
                      <Code className="w-16 h-16 mb-4 opacity-20" />
                      <p className="text-sm font-medium tracking-widest uppercase">{t('selectFileToBeginCoding')}</p>
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <CodeEditor
                    path="fix-imports-log"
                    content={fixImportsContent}
                    readOnly={true}
                    onSave={async () => {}}
                  />
                </div>
              </div>
            ) : isFixDepsOpen ? (
              <div className="flex h-full w-full">
                {activeFile && (
                  <div className="flex-1 min-w-0 border-r border-border/80">
                    <CodeEditor
                      path={activeFile}
                      content={openFiles.find(f => f.path === activeFile)?.content || ''}
                      onSave={handleSave}
                    />
                  </div>
                )}
                <div className={`min-w-0 bg-background ${activeFile ? 'flex-1' : 'flex-1 w-full'}`}>
                  {isFixingDeps ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground/80">
                      <div className="flex items-center gap-1.5 mb-4">
                        <span className="w-2.5 h-2.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-2.5 h-2.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-2.5 h-2.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                      <p className="text-sm font-medium tracking-widest uppercase animate-pulse">Analizando dependencias...</p>
                    </div>
                  ) : (
                    <CodeEditor
                      path="fix-dependencies-report"
                      content={fixDepsContent}
                      readOnly={true}
                      onSave={async () => {}}
                    />
                  )}
                </div>
              </div>
            ) : isValidateOpen ? (
              <div className="flex h-full w-full">
                <div className="flex-1 min-w-0 border-r border-border/80">
                  {activeFile ? (
                    <CodeEditor
                      path={activeFile}
                      content={openFiles.find(f => f.path === activeFile)?.content || ''}
                      onSave={handleSave}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground/60 animate-pulse">
                      <Code className="w-16 h-16 mb-4 opacity-20" />
                      <p className="text-sm font-medium tracking-widest uppercase">{t('selectFileToBeginCoding')}</p>
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0 bg-background">
                  {isValidating ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground/80">
                      <div className="flex items-center gap-1.5 mb-4">
                        <span className="w-2.5 h-2.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-2.5 h-2.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-2.5 h-2.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                      <p className="text-sm font-medium tracking-widest uppercase animate-pulse">Validando componentes...</p>
                    </div>
                  ) : (
                    <CodeEditor
                      path="validate-components-report"
                      content={validateContent}
                      readOnly={true}
                      onSave={async () => {}}
                    />
                  )}
                </div>
              </div>
            ) : isSplitViewOpen && activeFile ? (
              <div className="flex h-full w-full">
                <div className="flex-1 min-w-0 border-r border-border/80">
                  <CodeEditor
                    path={activeFile}
                    content={openFiles.find(f => f.path === activeFile)?.content || ''}
                    onSave={handleSave}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <CodeEditor
                    path={`${activeFile}::corrected`}
                    content={correctedContent}
                    readOnly={true}
                    onSave={async () => {
                      if (!activeFile || !correctedContent) {
                        toast({ title: 'Sin correcciones', description: 'No hay contenido corregido para guardar.', variant: 'destructive' });
                        return;
                      }
                      console.log('[IDETab] Aplicando correcciones al archivo original:', activeFile, 'contenido length:', correctedContent.length);
                      await handleSave(activeFile, correctedContent);
                      // Cerrar split view y limpiar corrección para indicar que ya se aplicó
                      setIsSplitViewOpen(false);
                      setCorrectedContent('');
                      toast({ title: 'Correcciones aplicadas', description: 'El archivo original se ha actualizado con el código corregido.' });
                    }}
                    onCorrectFile={handleCorrectFile}
                    isCorrecting={isCorrecting}
                  />
                </div>
              </div>
            ) : activeFile ? (
              <CodeEditor
                path={activeFile}
                content={openFiles.find(f => f.path === activeFile)?.content || ''}
                onSave={handleSave}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground/60 animate-pulse">
                <Code className="w-16 h-16 mb-4 opacity-20" />
                <p className="text-sm font-medium tracking-widest uppercase">{t('selectFileToBeginCoding')}</p>
              </div>
            )}
          </div>

          {/* Terminal Panel */}
          {isTerminalOpen && (
            <div style={{ height: terminalHeight }} className="border-t border-border/80 flex flex-col relative group overflow-hidden">
              {/* Resize Handle */}
              <div
                onMouseDown={startResizingTerminal}
                className="absolute top-0 left-0 right-0 h-1 cursor-row-resize hover:bg-primary/50 transition-colors z-10"
              />
              <TerminalPanel explorerPath={currentExplorerPath} />
            </div>
          )}
        </div>
      </div>

      {/* IDE Bottom Bar */}
      <div className="flex items-center justify-between h-4 px-4 bg-primary text-foreground text-[10px] font-bold uppercase tracking-wider">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <RefreshCw className="w-3 h-3 animate-spin-slow" />
            Ready
          </div>
          {activeFile && (
            <div className="flex items-center gap-1.5">
              <Folder className="w-3 h-3" />
              {activeFile}
            </div>
          )}
        </div>
        <div className="flex items-center gap-4">
          <div>UTF-8</div>
          <div>TypeScript React</div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-green-400 shadow-[0_0_5px_rgba(74,222,128,0.5)]" />
            Main Port: {previewPort}
          </div>
        </div>
      </div>

      {/* Modal Generar Icono */}
      {iconModalOpen && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/60 backdrop-blur-sm" onClick={() => setIconModalOpen(false)}>
        <div className="relative bg-background border border-emerald-500/30 rounded-xl p-6 w-full max-w-md shadow-[0_0_30px_rgba(16,185,129,0.2)]" onClick={e => e.stopPropagation()}>
          <button onClick={() => setIconModalOpen(false)} className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
          <h3 className="text-lg font-bold text-success mb-1">{t('modalGenerateIconTitle')}</h3>
          <p className="text-xs text-muted-foreground mb-4">{t('modalGenerateIconDesc')}</p>

          <div className="flex rounded-lg border border-border/40 overflow-hidden mb-4">
            <button onClick={() => setIconMode('upload')} className={`flex-1 py-1.5 text-xs font-medium transition-all ${iconMode === 'upload' ? 'bg-success/20 text-emerald-300' : 'text-muted-foreground hover:text-foreground/80 hover:bg-card'}`}>{t('tabUploadPNG')}</button>
            <button onClick={() => setIconMode('prompt')} className={`flex-1 py-1.5 text-xs font-medium transition-all ${iconMode === 'prompt' ? 'bg-success/20 text-emerald-300' : 'text-muted-foreground hover:text-foreground/80 hover:bg-card'}`}>{t('tabGenerateWithAI')}</button>
          </div>

          {iconMode === 'upload' && <>
            <input type="file" accept="image/png" className="hidden" id="icon-file-input" onChange={e => { const f = e.target.files?.[0]; if (f) setIconFile(f); }} />
            <label htmlFor="icon-file-input" className="flex items-center justify-center gap-2 w-full p-3 rounded-lg border border-dashed border-border/30 hover:border-emerald-400 hover:bg-success/5 cursor-pointer transition-all">
              <Upload className="w-5 h-5 text-success" />
              <span className="text-sm text-foreground/70">{iconFile ? iconFile.name : t('tabSelectPNG')}</span>
            </label>
          </>}

          {iconMode === 'prompt' && <>
            <div className="space-y-3">
              <textarea value={iconPrompt} onChange={e => setIconPrompt(e.target.value)} placeholder={t('tabDescribeIconPlaceholder')} className="w-full p-3 rounded-lg border border-border/40 bg-card text-foreground text-sm placeholder-muted-foreground focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/50 resize-none h-24"></textarea>
              <input type="password" value={iconApiKey} onChange={e => setIconApiKey(e.target.value)} placeholder={t('tabOpenAIKeyPlaceholder')} className="w-full p-3 rounded-lg border border-border/40 bg-card text-foreground text-sm placeholder-muted-foreground focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/50"></input>
              <p className="text-[11px] text-muted-foreground/80">{t('tabDalle3Info')}</p>
            </div>
          </>}

          <div className="flex gap-3 mt-5">
            <button onClick={generateIcon} disabled={iconGenerating || (iconMode === 'upload' ? !iconFile : (!iconPrompt.trim() || !iconApiKey.trim()))} className={`flex-1 py-2 rounded-lg font-bold text-sm transition-all ${iconGenerating || (iconMode === 'upload' ? !iconFile : (!iconPrompt.trim() || !iconApiKey.trim())) ? 'bg-muted text-muted-foreground/80 cursor-not-allowed' : 'bg-gradient-to-r from-emerald-500 to-yellow-400 text-gray-900 hover:from-emerald-600 hover:to-yellow-500 shadow-[0_0_15px_rgba(16,185,129,0.4)]'}`}>
              {iconGenerating ? t('tabGenerating') : t('tabGenerateIconBtn')}
            </button>
            {iconGenerated && <a href="/installer-icon.ico" download="installer-icon.ico" className="flex-1 py-2 rounded-lg font-bold text-sm text-center bg-gradient-to-r from-emerald-500 to-yellow-400 text-gray-900 hover:from-emerald-600 hover:to-yellow-500 shadow-[0_0_15px_rgba(34,197,94,0.4)] transition-all">
              {t('tabDownloadIcon')}
            </a>}
          </div>
        </div>
      </div>}

      {/* Modal Generador de Componentes */}
      {(() => {
        const dataPath = (typeof window !== 'undefined' ? localStorage.getItem('ZEUS_DATA_PATH') || '' : '').replace(/\\/g, '/').replace(/\/+$/, '');
        
        // CORRECCIÓN: Usar siempre el root del proyecto (primer segmento) para el generador
        const pathSegments = (currentExplorerPath || '').replace(/\\/g, '/').split('/').filter(Boolean);
        const projectFolderName = pathSegments[0] || '';
        const absoluteProjectRoot = dataPath + (projectFolderName ? '/' + projectFolderName : '');
        
        const activeFileNorm = (activeFile || '').replace(/\\/g, '/');
        let activeFileObj = activeFile ? openFiles.find(f => (f.path || '').replace(/\\/g, '/') === activeFileNorm) : null;
        // Fallback: si el contexto no tiene activeFile pero hay archivos abiertos, usar el primero
        if (!activeFileObj && openFiles.length > 0) {
          activeFileObj = openFiles[0];
          console.log('[IDETab] Fallback activeFileObj from openFiles[0]:', activeFileObj?.path);
        }
        return <PlanExecutorModal
          isOpen={isPlanExecutorOpen}
          onClose={() => setIsPlanExecutorOpen(false)}
          projectRoot={absoluteProjectRoot}
          files={projectExplorerData}
          projectId={projectFolderName}
          effectiveProjectId={projectFolderName}
          refreshProjectFiles={async () => {
            setSchemaRefreshTrigger(v => v + 1);
            refreshExplorer();
          }}
          currentConversationId={null}
          setMessages={setPlanExecutorMessages}
          saveMessage={async () => undefined}
          activeFile={activeFileObj ? { path: activeFileObj.path, name: activeFileObj.name || activeFileObj.path.split('/').pop() || '' } : null}
          fileContent={activeFileObj?.content || ''}
          mounted={!!dataPath}
          onFileSelect={(filePath, content) => {
            const name = filePath.split('/').pop() || filePath;
            openFile(filePath, name);
          }}
        />;
      })()}

      {/* Modal Undo + Diff */}
      <UndoDiffModal
        isOpen={isUndoModalOpen}
        onClose={() => {
          setIsUndoModalOpen(false);
          setUndoBackupContent(null);
        }}
        onConfirm={handleConfirmUndo}
        fileName={getActiveFileParts()?.name || ''}
        currentContent={openFiles.find(f => (f.path || '').replace(/\\/g, '/') === (activeFile || '').replace(/\\/g, '/'))?.content || ''}
        backupContent={undoBackupContent || ''}
      />
    </div>
  );
}

// Helper component for file icons
function FileIcon({ filename, className }: { filename: string, className?: string }) {
  const ext = filename.split('.').pop()?.toLowerCase();

  if (ext === 'tsx' || ext === 'jsx') return <Code className={cn(className, "text-primary")} />;
  if (ext === 'ts' || ext === 'js') return <Code className={cn(className, "text-warning")} />;
  if (ext === 'css') return <Code className={cn(className, "text-pink-400")} />;
  if (ext === 'json') return <Settings className={cn(className, "text-orange-400")} />;
  return <Code className={cn(className, "text-muted-foreground")} />;
}

