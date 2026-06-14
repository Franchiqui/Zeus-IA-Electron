'use client';

import React, { useEffect, useState, useRef, useCallback, Suspense } from 'react';
import TwoStepAppGenerator from '../../../components/template/TwoStepAppGenerator';
import { Card } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '../../../components/ui/alert-dialog';
import { FileText, Download, Eye, ArrowLeft, ArrowRight, Folder, FolderOpen, Clock, Wand2, AlertCircle, CheckCircle, Info, Copy, ChevronDown, Save } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useProject } from '../../../context/ProjectContext';
import { useAuth } from '../../../context/AuthContext';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

function TwoStepGeneratorPageContent({ initialTemplateId, initialAppType }: { initialTemplateId?: string; initialAppType?: 'web-app' | 'mobile-app' }) {
  const router = useRouter();
  const { toast } = useToast();
  const {
    projectRoot: contextProjectRoot,
    projectId: contextProjectId,
    setProjectRoot  } = useProject();
  const { user } = useAuth();
  const [generatedFiles, setGeneratedFiles] = useState<Record<string, string> | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<'generator' | 'results'>('generator');
  const [projectStructure, setProjectStructure] = useState<any>(null);
  const [showPreviewConfirmation, setShowPreviewConfirmation] = useState(false);
  const twoStepGeneratorRef = useRef<any>(null);
  const [isUploadingToPreview, setIsUploadingToPreview] = useState(false);
  const [isStartingPreview, setIsStartingPreview] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewServerStarted, setPreviewServerStarted] = useState(false);
  const [autoApplyStatus, setAutoApplyStatus] = useState<string>('');
  const [isPostProcessing, setIsPostProcessing] = useState(false);
  const [isFixingImports, setIsFixingImports] = useState(false);
  const [, setImportListInput] = useState<string>('');
  const [validationSuggestions, setValidationSuggestions] = useState<any>(null);
  const [copiedSuggestions, setCopiedSuggestions] = useState(false);
  const [showSuggestionsDialog, setShowSuggestionsDialog] = useState(false);
  const [terminalLines, setTerminalLines] = useState<Array<{ type: 'log' | 'info' | 'warn' | 'error'; text: string }>>([]);
  const terminalEndRef = useRef<HTMLDivElement | null>(null);
  const consolePatchedRef = useRef(false);
  const [generatorStep, setGeneratorStep] = useState<'form' | 'structure' | 'content' | 'complete'>('form');
  const lastFullListRefreshRef = useRef<number>(0);
  const [isSaving, setIsSaving] = useState(false);

  const countOnlyFiles = useCallback((files: Record<string, string> | null) => {
    if (!files) return 0;
    return Object.keys(files).filter(p => {
      const normalized = String(p || '').trim();
      if (!normalized) return false;
      // Directorios vienen como entradas con '' en /api/list-files y no tienen extensión
      const hasExtension = /\.[a-z0-9]+$/i.test(normalized);
      const hasContent = typeof files[p] === 'string' && files[p].length > 0;
      return hasExtension || hasContent;
    }).length;
  }, []);
  const originalConsoleRef = useRef<{
    log?: typeof console.log;
    info?: typeof console.info;
    warn?: typeof console.warn;
    error?: typeof console.error;
  }>({});

  useEffect(() => {
    if (generatorStep === 'structure' || generatorStep === 'content') {
      window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
    }
  }, [generatorStep]);

  // NO generar ID temporal - dejar que TwoStepAppGenerator cree el proyecto en PocketBase y obtenga el ID real
  // El projectId se establecerá automáticamente cuando TwoStepAppGenerator cree el proyecto
  
  // ✅ Usar DATA_PATH configurado como raíz del proyecto
  const [fallbackProjectRoot] = useState(() => {
    if (typeof window !== 'undefined') {
      const dataPath = localStorage.getItem('ZEUS_DATA_PATH');
      if (dataPath) return dataPath;
    }
    return '';
  });

  // Use context project root if available, otherwise use DATA_PATH
  const projectRoot = contextProjectRoot || fallbackProjectRoot || '';

  // Persist projectRoot in context when available
  useEffect(() => {
    if (projectRoot) setProjectRoot(projectRoot);
  }, [projectRoot, setProjectRoot]);

  // Sincronizar sugerencias de validación desde TwoStepAppGenerator
  useEffect(() => {
    const interval = setInterval(() => {
      if (twoStepGeneratorRef.current?.getValidationSuggestions && currentView === 'results') {
        const suggestions = twoStepGeneratorRef.current.getValidationSuggestions();
        if (suggestions) {
          setValidationSuggestions(suggestions);
        }
      }
    }, 1000); // Verificar cada segundo

    return () => clearInterval(interval);
  }, [currentView]);

  // Estado para rastrear si estamos cargando desde PocketBase
  const [isLoadingFromPocketBase, setIsLoadingFromPocketBase] = useState(false);
  // Estado para rastrear si estamos viendo archivos cargados desde PocketBase
  const [isViewingPocketBaseFiles, setIsViewingPocketBaseFiles] = useState(false);

  // ✅ Auto-cargar proyecto desde PocketBase al entrar si hay un projectId activo
  useEffect(() => {
    if (contextProjectId && !isViewingPocketBaseFiles && !isLoadingFromPocketBase) {
      console.log('[TwoStepGenerator] 🔄 Detectado projectId activo al entrar, cargando archivos reales...');
      useOpenProjectRoot();
    }
  }, [contextProjectId]); // Ejecutar cuando el ID esté disponible o cambie
  
  useEffect(() => {
    if (currentView !== 'results') return;
    // No ejecutar este efecto mientras se carga desde PocketBase
    if (isLoadingFromPocketBase) return;
    // No ejecutar este efecto si estamos viendo archivos de PocketBase
    if (isViewingPocketBaseFiles) return;

    const interval = setInterval(() => {
      const getCompletedFiles = twoStepGeneratorRef.current?.getCompletedFiles;
      if (typeof getCompletedFiles !== 'function') return;

      const latest = getCompletedFiles() as Record<string, string>;
      if (!latest || typeof latest !== 'object') return;

      // ✅ Refrescar periódicamente el proyecto completo desde disco para incluir
      // componentes nuevos creados por fix-missing-imports (post-procesado).
      const now = Date.now();
      if (projectRoot && now - lastFullListRefreshRef.current > 3500) {
        lastFullListRefreshRef.current = now;
        fetch('/api/list-files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            directoryPath: '',
            projectRoot,
            projectId: contextProjectId || undefined,
            includeContent: true
          })
        })
          .then(async (res) => {
            if (!res.ok) return null;
            return res.json().catch(() => null);
          })
          .then((data) => {
            const serverFiles = (data?.files || null) as Record<string, string> | null;
            if (!serverFiles) return;
            setGeneratedFiles(prev => {
              const base = prev || {};
              // serverFiles trae scaffold completo; latest trae los cambios del modelo
              return { ...base, ...serverFiles, ...latest };
            });
          })
          .catch(() => {
            // silencioso: no queremos spamear ni romper la UI
          });
      }

      setGeneratedFiles(prev => {
        // ✅ Importante: NO reemplazar el mapa completo.
        // latest contiene solo los archivos generados por stream (~10-20).
        // El scaffold completo se carga desde /api/list-files y debe mantenerse.
        if (!prev) return latest;
        
        // Filtrar archivos de 'latest' que sean placeholders si ya tenemos contenido real
        const filteredLatest: Record<string, string> = {};
        for (const [path, content] of Object.entries(latest)) {
          const isPlaceholder = content.includes('return <div>Demo</div>;') || content.includes('return <div>Hello World</div>;');
          const prevContent = prev[path];
          const prevIsRealContent = prevContent && !prevContent.includes('return <div>Demo</div>;') && !prevContent.includes('return <div>Hello World</div>;');
          
          if (isPlaceholder && prevIsRealContent) {
            console.log(`[Sync] Ignorando placeholder para ${path} ya que tenemos contenido real.`);
            continue;
          }
          filteredLatest[path] = content;
        }

        const merged = { ...prev, ...filteredLatest };
        return merged;
      });

      // Mantener selección: si el archivo seleccionado ya no existe, elegir el primero
      setSelectedFile(prevSelected => {
        if (prevSelected) return prevSelected;
        const first = Object.keys(latest)[0] || null;
        return first;
      });
    }, 700);

    return () => clearInterval(interval);
  }, [currentView, isLoadingFromPocketBase, isViewingPocketBaseFiles, projectRoot, contextProjectId]);

  useEffect(() => {
    // ✅ Limpieza inicial profunda
    setGeneratedFiles(null);
    setTerminalLines([]);
    
    // Limpiar planes pendientes que puedan causar inyecciones de código no deseadas
    if (typeof window !== 'undefined') {
      localStorage.removeItem('zeus:two_step_plan');
    }

    if (!consolePatchedRef.current) {
      originalConsoleRef.current = {
        log: console.log,
        info: console.info,
        warn: console.warn,
        error: console.error
      };

      const pushLine = (type: 'log' | 'info' | 'warn' | 'error', args: any[]) => {
        // No procesar logs durante el desmontaje o si la página no está activa
        if (!consolePatchedRef.current) return;

        const MAX_ARG_CHARS = 1000;
        const safeToString = (a: any) => {
          if (a === undefined) return 'undefined';
          if (a === null) return 'null';
          if (typeof a === 'string') return a;
          try {
            const json = JSON.stringify(a);
            return json !== undefined ? json : String(a);
          } catch {
            return String(a);
          }
        };

        const text = args.map(a => {
          const s = safeToString(a);
          // ✅ Asegurar que s sea una cadena antes de acceder a length
          const str = typeof s === 'string' ? s : String(s);
          return str.length > MAX_ARG_CHARS ? str.slice(0, MAX_ARG_CHARS) + '…' : str;
        }).join(' ');

        // ✅ Uso de requestAnimationFrame para asegurar que el setState ocurra fuera del ciclo de renderizado de React
        requestAnimationFrame(() => {
          setTerminalLines(prev => {
            const next = [...prev, { type, text }];
            return next.length > 500 ? next.slice(next.length - 500) : next;
          });
        });
      };

      console.log = (...args: any[]) => {
        originalConsoleRef.current.log?.(...args);
        pushLine('log', args);
      };
      console.info = (...args: any[]) => {
        originalConsoleRef.current.info?.(...args);
        pushLine('info', args);
      };
      console.warn = (...args: any[]) => {
        originalConsoleRef.current.warn?.(...args);
        pushLine('warn', args);
      };
      console.error = (...args: any[]) => {
        originalConsoleRef.current.error?.(...args);
        // Evitar bucles infinitos si el propio setState lanza un error de consola
        if (!args[0]?.toString().includes('Cannot update a component')) {
          pushLine('error', args);
        }
      };

      consolePatchedRef.current = true;
    }

    return () => {
      if (originalConsoleRef.current.log) console.log = originalConsoleRef.current.log;
      if (originalConsoleRef.current.info) console.info = originalConsoleRef.current.info;
      if (originalConsoleRef.current.warn) console.warn = originalConsoleRef.current.warn;
      if (originalConsoleRef.current.error) console.error = originalConsoleRef.current.error;
      consolePatchedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (currentView !== 'results') return;
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [terminalLines, currentView]);
  
  // El projectId se establecerá automáticamente por TwoStepAppGenerator cuando cree el proyecto en PocketBase

  const handleGenerationComplete = (files: Record<string, string>) => {
    const incomingCount = Object.keys(files || {}).length;
    console.log('handleGenerationComplete: Files received:', incomingCount);
    
    // ✅ SEGURIDAD: No permitir que un set de archivos minúsculo (como el antiguo mock de 3 archivos)
    // sobrescriba un proyecto real que ya hemos cargado (ej. 55 archivos).
    if (generatedFiles && Object.keys(generatedFiles).length > 10 && incomingCount <= 3) {
      console.warn('[handleGenerationComplete] 🛑 Bloqueada sobrescritura sospechosa: se intentó reemplazar un proyecto grande por uno de solo 3 archivos.');
      return;
    }

    setGeneratedFiles(files);
    // Seleccionar el primer archivo por defecto
    const firstFile = Object.keys(files)[0];
    if (firstFile) {
      setSelectedFile(firstFile);
    }
    // Cambiar automáticamente a la vista de resultados cuando se complete la generación
    setCurrentView('results');
    // No iniciar la subida automáticamente, esperar confirmación

    // ✅ Cargar el proyecto COMPLETO desde el servidor (scaffold + archivos generados)
    // El stream del modelo puede tener solo ~10-20 archivos; el resto existe en projectRoot.
    (async () => {
      try {
        if (!projectRoot) return;
        let effectiveRoot = projectRoot;
        try {
          const rootRes = await fetch('/api/project/get-root', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId: contextProjectId || undefined, initialProjectRoot: projectRoot })
          });
          if (rootRes.ok) {
            const rootData = await rootRes.json().catch(() => ({}));
            if (rootData?.projectRoot && typeof rootData.projectRoot === 'string') {
              effectiveRoot = rootData.projectRoot;
            }
          }
        } catch {}
        const listResponse = await fetch('/api/list-files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            directoryPath: '',
            projectRoot: effectiveRoot,
            projectId: contextProjectId || undefined,
            includeContent: true
          })
        });
        if (!listResponse.ok) {
          const errText = await listResponse.text().catch(() => '');
          console.warn('[two-step/results] ⚠️ No se pudo cargar el proyecto completo:', errText);
          return;
        }
        const data = await listResponse.json();
        const serverFiles = (data?.files || {}) as Record<string, string>;
        const merged = { ...serverFiles, ...files };
        setGeneratedFiles(merged);
        const keys = Object.keys(merged);
        const preferred = keys.find(k => k === 'app/page.tsx' || k.endsWith('/app/page.tsx')) || keys[0];
        if (preferred) setSelectedFile(preferred);
        // No subir automáticamente a la vista previa al entrar. El usuario puede hacerlo con el botón correspondiente.
      } catch (e) {
        console.warn('[two-step/results] ⚠️ Error cargando proyecto completo:', e);
      }
    })();
  };
  const handleSendToPreview = async () => {
    console.log('handleSendToPreview: Start. generatedFiles:', generatedFiles);
    if (!generatedFiles || Object.keys(generatedFiles).length === 0) {
      console.log('handleSendToPreview: generatedFiles is null or empty. Exiting.');
      return;
    }
    console.log('handleSendToPreview: Initiated. generatedFiles is not empty.');
    if (!twoStepGeneratorRef.current) {
      console.error('handleSendToPreview: twoStepGeneratorRef.current is null.');
      return;
    }
    if (!twoStepGeneratorRef.current.uploadToPreviewServer) {
      console.error('handleSendToPreview: twoStepGeneratorRef.current.uploadToPreviewServer is undefined.');
      return;
    }
    console.log('handleSendToPreview: Calling uploadToPreviewServer...');
    const url = await twoStepGeneratorRef.current.uploadToPreviewServer(generatedFiles, twoStepGeneratorRef.current.getFormData().appName, twoStepGeneratorRef.current.getFormData().template);
    console.log('handleSendToPreview: uploadToPreviewServer returned URL:', url);
    if (url) {
      console.log('handleSendToPreview: Navigating to editor with previewUrl.');
      router.push(`/editor?previewUrl=${encodeURIComponent(url)}`);
    } else {
      console.error("handleSendToPreview: No preview URL returned from uploadToPreviewServer.");
      router.push('/editor');
    }
    setShowPreviewConfirmation(false);
    console.log('handleSendToPreview: Confirmation dialog closed.');
  };
  const handleStructureGenerated = (structure: any) => {
    setProjectStructure(structure);
  };

  // --- Tipos locales para el plan ---
  type PlanAction = {
    type: 'create_file' | 'update_file' | 'create_folder';
    path: string;
    purpose?: string;
    language?: 'tsx' | 'ts' | 'js';
    routeKind?: 'page' | 'route' | 'layout' | 'api' | 'component' | 'file';
    content?: string;
  };
  type ExplorerNode = {
    name: string;
    path: string;
    type: 'file' | 'directory';
    children?: ExplorerNode[];
  };

  // Construye estructura combinada: existente (explorer) + acciones nuevas
  function buildCombinedStructure(explorer: ExplorerNode[] | undefined, actions: PlanAction[]): ExplorerNode[] {
    const root: ExplorerNode = {
      name: '',
      path: '',
      type: 'directory',
      children: []
    };
    const dirMap = new Map<string, ExplorerNode>();
    dirMap.set('', root);
    const ensureDir = (relDir: string) => {
      // Handle empty or root directory
      if (!relDir) return root;
      const parts = relDir.split('/').filter(Boolean);
      let curr = root;
      let acc = '';
      for (const part of parts) {
        const next = acc ? `${acc}/${part}` : part;
        let found = (curr.children || []).find(c => c.type === 'directory' && c.name === part);
        if (!found) {
          found = {
            name: part,
            path: next,
            type: 'directory',
            children: []
          };
          curr.children = curr.children || [];
          curr.children.push(found);
        }
        dirMap.set(next, found);
        curr = found;
        acc = next;
      }
      return curr;
    };
    const addFile = (relFile: string) => {
      // Handle empty file path
      if (!relFile) return;
      const parts = relFile.split('/').filter(Boolean);
      const fileName = parts.pop();

      // If no filename, it's not a valid file path
      if (!fileName) return;
      const dir = parts.join('/');
      const parent = ensureDir(dir);
      parent.children = parent.children || [];
      if (!parent.children.find(c => c.type === 'file' && c.name === fileName)) {
        parent.children.push({
          name: fileName,
          path: dir ? `${dir}/${fileName}` : fileName,
          type: 'file'
        });
      }
    };

    // 1) volcar explorer existente
    const walk = (nodes?: ExplorerNode[], parentPath = '') => {
      if (!nodes) return;
      for (const n of nodes) {
        const rel = n.path.replace(/^[\\/]+/, '').replace(/\\/g, '/');
        if (n.type === 'directory') {
          ensureDir(rel);
          walk(n.children, rel);
        } else {
          addFile(rel);
        }
      }
    };
    walk(explorer);

    // 2) aplicar acciones nuevas (solo crear carpeta/archivo)
    for (const a of actions) {
      const rel = String(a.path || '').replace(/^[\\/]+/, '').replace(/\\/g, '/');
      if (!rel) continue;
      if (a.type === 'create_folder') {
        ensureDir(rel);
      } else if (a.type === 'create_file') {
        addFile(rel);
      }
    }
    return root.children || [];
  }

  // Auto-lectura del plan desde localStorage y ejecución de creación (sin modificar archivos existentes)
  useEffect(() => {
    const processPlan = async () => {
      try {
        const raw = localStorage.getItem('zeus:two_step_plan');
        if (!raw) return;
        // Limpiar para evitar re-ejecuciones
        localStorage.removeItem('zeus:two_step_plan');
        const payload = JSON.parse(raw || '{}') as {
          projectRoot?: string | null;
          actions?: PlanAction[];
          explorer?: ExplorerNode[];
        };
        const actions = Array.isArray(payload.actions) ? payload.actions : [];
        const incomingExplorer = Array.isArray(payload.explorer) ? payload.explorer : undefined;
        const pr = payload.projectRoot || projectRoot;
        if (!actions.length) return;

        // Construir estructura combinada para mostrar
        const combined = buildCombinedStructure(incomingExplorer, actions);
        setProjectStructure(combined);
        setCurrentView('results');

        // Crear primero las carpetas, luego los archivos nuevos
        setAutoApplyStatus('Creando estructura...');

        // Process folders
        const folders = actions.filter(a => a.type === 'create_folder');
        for (const f of folders) {
          const dir = String(f.path || '').replace(/^[\\/]+/, '').replace(/\\/g, '/');
          if (!dir) continue;
          try {
            const response = await fetch('/api/create-folder', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                dir,
                projectRoot: pr
              })
            });
            if (!response.ok) {
              const errorData = await response.json().catch(() => ({}));
              console.error(`Failed to create folder ${dir}:`, errorData);
            }
          } catch (error) {
            console.error(`Error creating folder ${dir}:`, error);
          }
        }

        // Process files
        const files = actions.filter(a => a.type === 'create_file');
        const generated: Record<string, string> = {};
        for (const file of files) {
          const filePath = String(file.path || '').replace(/^[\\/]+/, '').replace(/\\/g, '/');
          if (!filePath) continue;
          const content = typeof file.content === 'string' ? file.content : '';
          try {
            const response = await fetch('/api/save-file', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                filePath,
                content,
                projectRoot: pr
              })
            });
            if (!response.ok) {
              const errorData = await response.json().catch(() => ({}));
              console.error(`Failed to create file ${filePath}:`, errorData);
            } else {
              // Guardar para visualización en UI
              generated[filePath] = content;
            }
          } catch (error) {
            console.error(`Error creating file ${filePath}:`, error);
          }
        }

        // Corrección de código por lote para acciones de update_file (si las hay)
        const updates = actions.filter(a => a.type === 'update_file');
        if (updates.length) {
          setAutoApplyStatus('Corrigiendo código...');
          try {
            const payload = {
              projectRoot: pr,
              updates: updates.map(u => ({
                filePath: String(u.path || '').replace(/^[\\/]+/, '').replace(/\\/g, '/'),
                issueSummary: u.purpose || undefined
              }))
            };
            const resp = await fetch('/api/correct-code', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(payload)
            });
            if (resp.ok) {
              const data = await resp.json();
              const results = Array.isArray(data?.results) ? data.results : [];
              for (const r of results) {
                if (r?.filePath && typeof r?.correctedContent === 'string') {
                  generated[r.filePath] = r.correctedContent;
                }
              }
            } else {
              const errorData = await resp.json().catch(() => ({}));
              console.error('Failed to correct code:', errorData);
            }
          } catch (error) {
            console.error('Error correcting code:', error);
          }
        }

        // Generar y subir ZIP del proyecto a PocketBase (si está configurado)
        try {
          setAutoApplyStatus('Actualizando ZIP del proyecto...');
          const respZip = await fetch('/api/zip-and-upload', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              projectRoot: pr
            }) // usa variables de entorno PB si están definidas
          });
          // No bloqueamos la UI en caso de fallo; solo informativo
          if (!respZip.ok) {
            const errorText = await respZip.text();
            console.warn('zip-and-upload failed:', errorText);
          }
        } catch (e) {
          console.warn('zip-and-upload error:', e);
        }
        if (Object.keys(generated).length) {
          setGeneratedFiles(generated);
          const first = Object.keys(generated)[0];
          setSelectedFile(first || null);
        }
        setAutoApplyStatus('Estructura creada');
      } catch (error) {
        console.error('Error processing plan:', error);
        setAutoApplyStatus('Error al crear la estructura');
      }
    };
    processPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const downloadFile = (filePath: string, content: string) => {
    const blob = new Blob([content], {
      type: 'text/plain'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filePath.split('/').pop() || 'file.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  const downloadAllFiles = async () => {
    if (!generatedFiles) return;
    try {
      const zip = new JSZip();

      // Agregar cada archivo al ZIP
      Object.entries(generatedFiles).forEach(([filePath, content]) => {
        zip.file(filePath, content);
      });

      // Generar el archivo ZIP
      const content = await zip.generateAsync({
        type: 'blob'
      });

      // Descargar el archivo ZIP
      saveAs(content, 'generated-app.zip');
    } catch (error) {
      console.error('Error al crear el archivo ZIP:', error);
      // Fallback al método anterior si hay error
      let allContent = '';
      Object.entries(generatedFiles).forEach(([filePath, content]) => {
        allContent += `

=== ${filePath} ===

${content}`;
      });
      const blob = new Blob([allContent], {
        type: 'text/plain'
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'generated-app-files.txt';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const saveToPocketBase = async () => {
    if (!generatedFiles || !contextProjectId) {
      toast({
        title: 'No se puede guardar',
        description: !contextProjectId ? 'No hay proyecto activo.' : 'No hay archivos para guardar.',
        variant: 'destructive'
      });
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch('/api/project/save-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: contextProjectId,
          projectRoot: contextProjectRoot || projectRoot,
          userToken: user?.token,
          files: generatedFiles
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || data.details || `Error ${res.status}`);
      }
      toast({
        title: 'Proyecto guardado',
        description: `ZIP y backup actualizados (${data.filesWritten ?? Object.keys(generatedFiles).length} archivos).`,
        variant: 'default'
      });
    } catch (e: any) {
      console.error('Error guardando proyecto:', e);
      toast({
        title: 'Error al guardar',
        description: e?.message || 'No se pudo actualizar el ZIP y backup en PocketBase.',
        variant: 'destructive'
      });
    } finally {
      setIsSaving(false);
    }
  };

  const useOpenProjectRoot = async () => {
    if (!contextProjectId) {
      toast({
        title: 'Project ID no disponible',
        description: 'No se detectó un projectId del proyecto activo.',
        variant: 'destructive'
      });
      return;
    }

    try {
      // Marcar que estamos cargando desde PocketBase
      setIsLoadingFromPocketBase(true);
      
      toast({
        title: 'Descargando proyecto...',
        description: 'Obteniendo archivos del proyecto desde PocketBase.',
        variant: 'default'
      });

      // Descargar el archivo ZIP del proyecto desde PocketBase
      const res = await fetch(`/api/download-project-files?projectId=${contextProjectId}`);
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Error al descargar proyecto: ${res.status} - ${errorText}`);
      }
      
      const data = await res.json();
      
      if (!data.files || Object.keys(data.files).length === 0) {
        toast({
          title: 'Sin archivos',
          description: 'No se encontraron archivos en el proyecto de PocketBase.',
          variant: 'destructive'
        });
        return;
      }

      // Establecer los archivos descargados en el estado
      setGeneratedFiles(data.files);
      const keys = Object.keys(data.files);
      const preferred = keys.find(k => k === 'app/page.tsx' || k.endsWith('/app/page.tsx')) || keys[0];
      setSelectedFile(preferred || null);
      
      // Marcar que estamos viendo archivos de PocketBase
      setIsViewingPocketBaseFiles(true);
      
      // Actualizar el projectRoot con la ruta del proyecto descargado
      if (data.projectRoot) {
        setProjectRoot(data.projectRoot);
      }
      
      toast({
        title: 'Proyecto cargado exitosamente',
        description: `Se cargaron ${Object.keys(data.files).length} archivos desde PocketBase.`,
        variant: 'default'
      });
      
    } catch (e: any) {
      console.error('Error al descargar proyecto desde PocketBase:', e);
      toast({
        title: 'Error al cargar proyecto',
        description: e?.message || 'No se pudo descargar el proyecto desde PocketBase.',
        variant: 'destructive'
      });
      // Resetear estado en caso de error
      setIsViewingPocketBaseFiles(false);
    } finally {
      // Desmarcar el estado de carga
      setIsLoadingFromPocketBase(false);
    }
  };
  const createFromImportList = async () => {
    setIsFixingImports(true);
    setAutoApplyStatus('Buscando importaciones faltantes y generando componentes...');
    try {
      const runFix = twoStepGeneratorRef.current?.runFixMissingImports;
      if (typeof runFix !== 'function') {
        console.error('TwoStepAppGenerator ref no expone runFixMissingImports');
        setAutoApplyStatus('Error: no se pudo iniciar la generación de componentes faltantes.');
        return;
      }
      await runFix();
      setAutoApplyStatus('');
    } catch (error) {
      console.error('❌ Error al abrir el modal de importaciones:', error);
      setAutoApplyStatus('❌ Error generando componentes faltantes');
    } finally {
      setIsFixingImports(false);
      setImportListInput('');
      setTimeout(() => setAutoApplyStatus(''), 3000);
    }
  };

  const getFileExtension = (filePath: string) => {
    const ext = filePath.split('.').pop() || '';
    return ext.toLowerCase();
  };

  const getFileIcon = (filePath: string) => {
    const ext = getFileExtension(filePath);
    const colors: Record<string, string> = {
      tsx: 'text-green-600',
      ts: 'text-green-500',
      jsx: 'text-green-600',
      js: 'text-green-600',
      vue: 'text-green-600',
      svelte: 'text-green-600',
      py: 'text-green-700',
      json: 'text-green-600',
      css: 'text-green-600',
      html: 'text-green-600',
      md: 'text-green-700'
    };
    return <FileText className={`w-4 h-4 ${colors[ext] || 'text-green-500'}`} data-zeus-id="Z-page-232" />;
  };

  // Función para refrescar la vista previa de archivos después de operaciones
  const refreshPreviewFiles = useCallback(async () => {
    // Solo refrescar si estamos viendo archivos de un proyecto activo
    if (!contextProjectId) return;
    
    try {
      // Obtener los archivos actualizados del TwoStepAppGenerator
      const getCompletedFiles = twoStepGeneratorRef.current?.getCompletedFiles;
      if (typeof getCompletedFiles === 'function') {
        const latestFiles = getCompletedFiles() as Record<string, string>;
        if (latestFiles && Object.keys(latestFiles).length > 0) {
          setGeneratedFiles(latestFiles);
          
          // Mantener la selección del archivo actual si existe, sino seleccionar el primero
          if (selectedFile && !latestFiles[selectedFile]) {
            const firstFile = Object.keys(latestFiles)[0] || null;
            setSelectedFile(firstFile);
          }
          
          toast({
            title: 'Vista previa actualizada',
            description: `Se han cargado ${Object.keys(latestFiles).length} archivos actualizados.`,
            variant: 'default'
          });
        }
      }
    } catch (error) {
      console.warn('No se pudo refrescar la vista previa:', error);
    }
  }, [contextProjectId, selectedFile, toast]);

  const getLanguageForHighlighting = (filePath: string) => {
    const ext = getFileExtension(filePath);
    const languageMap: Record<string, string> = {
      tsx: 'typescript',
      ts: 'typescript',
      jsx: 'javascript',
      js: 'javascript',
      vue: 'vue',
      svelte: 'svelte',
      py: 'python',
      json: 'json',
      css: 'css',
      html: 'html',
      md: 'text'
    };
    return languageMap[ext] || 'text';
  };

  return <div className="h-screen overflow-hidden text-foreground" data-zeus-id="Z-page-233">
      
      {/* Botones de Navegación en la parte superior derecha - ARRIBA DEL TODO */}
      <div className="fixed top-4 right-20 z-[60]" data-zeus-id="Z-page-236">
        <Card className="p-2 bg-card border border-green-400 shadow-[0_0_8px_rgba(74,222,128,0.8)]" data-zeus-id="Z-page-237">
          <div className="flex items-center gap-2 flex-wrap" data-zeus-id="Z-page-238">
            <button onClick={() => {
              if (generatorStep !== 'form') {
                twoStepGeneratorRef.current?.goToFormStep?.();
                setCurrentView('generator');
                return;
              }
              router.back();
            }} className="px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 text-foreground/70 hover:text-foreground hover:bg-muted" data-zeus-id="Z-page-239">
              <ArrowLeft className="w-4 h-4" data-zeus-id="Z-page-240" />
              Volver
            </button>
            <div className="h-6 w-px bg-muted/80" data-zeus-id="Z-page-241"></div>
            <button onClick={async () => {
              if (twoStepGeneratorRef.current?.getValidationSuggestions) {
                const suggestions = twoStepGeneratorRef.current.getValidationSuggestions();
                setValidationSuggestions(suggestions);
              }
              setShowSuggestionsDialog(true);
            }} className="px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 text-foreground/70 hover:text-foreground hover:bg-muted" data-zeus-id="Z-page-suggestions-btn">
              <Info className="w-4 h-4" />
              Abrir sugerencias del modelo
            </button>
          </div>
        </Card>
      </div>
      
      <div className={`container mx-auto pt-16 pb-4 h-full overflow-hidden flex flex-col relative z-10`} data-zeus-id="Z-page-247">
        <div className={`${currentView === 'results' ? 'text-center mb-4 flex-shrink-0' : 'text-center mb-8'}`} data-zeus-id="Z-page-248">
          <div className="flex items-center justify-center" data-zeus-id="Z-page-title-row">
            <h1 className="text-4xl font-bold text-green-400" data-zeus-id="Z-page-249">
              Generador de Aplicaciones en Dos Pasos
            </h1>
          </div>
          <p className="text-lg text-foreground/70 max-w-2xl mx-auto" data-zeus-id="Z-page-250">
            Una nueva arquitectura que separa la generación de estructura del contenido, 
            ofreciendo mejor rendimiento y control granular sobre el proceso.
          </p>
        </div>



        <div className="w-full max-w-7xl mx-auto flex-1 min-h-0 overflow-hidden flex flex-col" style={{
        display: currentView === 'generator' ? 'flex' : 'none'
      }} data-zeus-id="Z-page-256">
          <Card className="w-full p-6 bg-card border border-green-400 shadow-[0_0_8px_rgba(74,222,128,0.8)] flex-1 min-h-0 overflow-hidden flex flex-col" data-zeus-id="Z-page-257">
            <TwoStepAppGenerator ref={twoStepGeneratorRef} onComplete={handleGenerationComplete} onNavigateToResults={() => setCurrentView('results')} onStructureGenerated={handleStructureGenerated} onStepChange={setGeneratorStep} projectId={contextProjectId} projectRoot={projectRoot} initialTemplateId={initialTemplateId} appType={initialAppType} isUploadingToPreview={isUploadingToPreview} isStartingPreview={isStartingPreview} previewUrl={previewUrl} previewServerStarted={previewServerStarted} setPreviewUrl={setPreviewUrl} setIsUploadingToPreview={setIsUploadingToPreview} setIsStartingPreview={setIsStartingPreview} setPreviewServerStarted={setPreviewServerStarted} isPostProcessing={isPostProcessing} setIsPostProcessing={setIsPostProcessing} previewSelectedFilePath={selectedFile} onFileCorrected={(filePath, content) => { const norm = (p: string) => p.replace(/\\/g, '/'); setGeneratedFiles(prev => { if (!prev) return { [filePath]: content }; const next = { ...prev }; const targetKey = Object.keys(next).find(k => norm(k) === norm(filePath)) ?? filePath; next[targetKey] = content; return next; }); }} onCompletedFilesChange={(files) => { setGeneratedFiles(prev => ({ ...(prev || {}), ...files })); }} data-zeus-id="Z-page-258" />
          </Card>
        </div>
        {currentView === 'results' && generatedFiles ? <div className="flex-1 min-h-0" data-zeus-id="Z-page-results-container">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full min-h-0" data-zeus-id="Z-page-259">
              <Card className="p-4 bg-card border border-green-400 shadow-[0_0_8px_rgba(74,222,128,0.8)] flex flex-col min-h-0" data-zeus-id="Z-page-preview-panel">
                <div className="flex flex-col gap-3 mb-4" data-zeus-id="Z-page-preview-header">
                  <div className="flex flex-wrap items-center justify-between gap-3" data-zeus-id="Z-page-preview-title-row">
                    <div className="flex items-center gap-2 min-w-0" data-zeus-id="Z-page-preview-title-left">
                      <Eye className="w-4 h-4 text-foreground/70" data-zeus-id="Z-page-preview-eye" />
                      <h3 className="text-lg font-semibold text-green-400" data-zeus-id="Z-page-preview-title">Vista previa del código</h3>
                      <Badge variant="outline" data-zeus-id="Z-page-preview-count">{countOnlyFiles(generatedFiles)} archivos</Badge>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap" data-zeus-id="Z-page-preview-actions">
                      <Button onClick={useOpenProjectRoot} size="sm" className="bg-card border border-border/40 text-foreground/80 hover:text-foreground hover:bg-muted shrink-0" variant="outline" data-zeus-id="Z-page-preview-use-projectroot">
                        <FolderOpen className="w-4 h-4 mr-1.5" />
                        Cargar Proyecto
                      </Button>
                      <Button onClick={downloadAllFiles} size="sm" className="bg-card border border-green-500/60 text-green-300 hover:text-foreground hover:bg-green-900/30 shrink-0" variant="outline" data-zeus-id="Z-page-preview-download-all">
                        <Download className="w-4 h-4 mr-1.5" data-zeus-id="Z-page-preview-download-all-icon" />
                        Descargar Todos
                      </Button>
                      <Button onClick={saveToPocketBase} disabled={isSaving} size="sm" className="bg-card border border-amber-500/60 text-amber-200 hover:text-foreground hover:bg-amber-900/30 shrink-0" variant="outline" data-zeus-id="Z-page-preview-save">
                        <Save className={`w-4 h-4 mr-1.5 ${isSaving ? 'animate-pulse' : ''}`} data-zeus-id="Z-page-preview-save-icon" />
                        {isSaving ? 'Guardando...' : 'Guardar'}
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-center" data-zeus-id="Z-page-preview-controls">
                    <DropdownMenu data-zeus-id="Z-page-file-dropdown">
                      <DropdownMenuTrigger asChild data-zeus-id="Z-page-file-dropdown-trigger">
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-2 rounded-md border border-border/40 bg-background px-3 py-2 text-sm text-foreground/80 hover:bg-card transition-colors"
                          data-zeus-id="Z-page-file-dropdown-trigger-btn"
                        >
                          <div className="flex items-center gap-2 min-w-0" data-zeus-id="Z-page-file-dropdown-trigger-left">
                            {selectedFile ? (
                              <>
                                <span className="flex-shrink-0" data-zeus-id="Z-page-file-dropdown-trigger-icon">{getFileIcon(selectedFile)}</span>
                                <span className="font-mono text-sm truncate text-warning" data-zeus-id="Z-page-file-dropdown-trigger-path">{selectedFile}</span>
                                <span className="flex-shrink-0 text-xs text-muted-foreground" data-zeus-id="Z-page-file-dropdown-trigger-lines">
                                  {generatedFiles[selectedFile]?.split('\n').length || 0} líneas
                                </span>
                              </>
                            ) : (
                              <span className="text-muted-foreground" data-zeus-id="Z-page-file-dropdown-trigger-placeholder">Selecciona un archivo</span>
                            )}
                          </div>
                          <ChevronDown className="h-4 w-4 opacity-70 flex-shrink-0" data-zeus-id="Z-page-file-dropdown-trigger-chevron" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        className="w-[--radix-dropdown-menu-trigger-width] bg-background border border-border/50"
                        sideOffset={6}
                        data-zeus-id="Z-page-file-dropdown-content"
                      >
                        <DropdownMenuLabel className="text-foreground/70" data-zeus-id="Z-page-file-dropdown-label">
                          Archivos Generados
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator data-zeus-id="Z-page-file-dropdown-sep" />
                        <div className="max-h-80 overflow-y-auto" data-zeus-id="Z-page-file-dropdown-scroll">
                          {Object.keys(generatedFiles).map(filePath => {
                            const isActive = selectedFile === filePath;
                            const lines = generatedFiles[filePath]?.split('\n').length || 0;
                            return (
                              <DropdownMenuItem
                                key={filePath}
                                onSelect={() => setSelectedFile(filePath)}
                                className={`cursor-pointer px-2 py-2 rounded-md focus:bg-card ${isActive ? 'bg-primary/20 border border-blue-500/50' : 'border border-transparent'}`}
                                data-zeus-id={`Z-page-file-dropdown-item-${filePath.replace(/[^a-zA-Z0-9]/g, '_')}`}
                              >
                                <div className="flex items-center gap-3 w-full" data-zeus-id="Z-page-file-dropdown-item-row">
                                  <span className="flex-shrink-0" data-zeus-id="Z-page-file-dropdown-item-icon">{getFileIcon(filePath)}</span>
                                  <div className="flex-1 min-w-0" data-zeus-id="Z-page-file-dropdown-item-main">
                                    <div className="font-mono text-sm truncate text-warning" data-zeus-id="Z-page-file-dropdown-item-path">
                                      {filePath}
                                    </div>
                                    <div className="text-xs text-muted-foreground" data-zeus-id="Z-page-file-dropdown-item-lines">
                                      {lines} líneas
                                    </div>
                                  </div>
                                </div>
                              </DropdownMenuItem>
                            );
                          })}
                        </div>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    
                    {selectedFile && (
                      <Button 
                        size="sm" 
                        variant="outline" 
                        onClick={() => downloadFile(selectedFile, generatedFiles[selectedFile])}
                        className="h-10 w-10 p-0 bg-card border border-green-400 text-foreground/70 hover:text-foreground hover:bg-muted shadow-[0_0_8px_rgba(74,222,128,0.8)] flex items-center justify-center"
                        data-zeus-id="Z-page-preview-download-single"
                      >
                        <Download className="w-4 h-4 text-green-400" data-zeus-id="Z-page-preview-download-single-icon" />
                      </Button>
                    )}
                  </div>
                </div>

                {selectedFile ? (
                  <div className="flex-1 min-h-0 flex flex-col" data-zeus-id="Z-page-preview-body">

                    <div className="border rounded-lg overflow-hidden flex-1 min-h-0 flex flex-col" data-zeus-id="Z-page-preview-code-wrap">
                      <div className="bg-muted px-4 py-2 border-b border-border/40" data-zeus-id="Z-page-preview-code-header">
                        <div className="flex items-center gap-2 text-sm text-foreground/70" data-zeus-id="Z-page-preview-code-title">
                          <Eye className="w-4 h-4" data-zeus-id="Z-page-preview-code-eye" />
                          Vista previa del código
                        </div>
                      </div>
                      <div className="p-4 bg-background/90 flex-1 min-h-0 overflow-y-auto" data-zeus-id="Z-page-preview-code-body">
                        <pre className="text-sm overflow-x-auto whitespace-pre-wrap font-mono" data-zeus-id="Z-page-preview-pre">
                          <code className="text-green-400" data-zeus-id="Z-page-preview-code">
                            {generatedFiles[selectedFile]}
                          </code>
                        </pre>
                      </div>
                    </div>

                    <div className="mt-3 text-sm text-muted-foreground" data-zeus-id="Z-page-preview-stats">
                      <div className="grid grid-cols-2 gap-4" data-zeus-id="Z-page-preview-stats-grid">
                        <div data-zeus-id="Z-page-preview-stats-lines">
                          <strong data-zeus-id="Z-page-preview-stats-lines-strong">Líneas:</strong> {(generatedFiles[selectedFile] || '').split('\n').length}
                        </div>
                        <div data-zeus-id="Z-page-preview-stats-chars">
                          <strong data-zeus-id="Z-page-preview-stats-chars-strong">Caracteres:</strong> {(generatedFiles[selectedFile] || '').length}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground/80" data-zeus-id="Z-page-preview-empty">
                    <FileText className="w-12 h-12 mx-auto mb-4 text-foreground/70" data-zeus-id="Z-page-preview-empty-icon" />
                    <p data-zeus-id="Z-page-preview-empty-text">Selecciona un archivo para ver su contenido</p>
                  </div>
                )}
              </Card>

              <Card className="p-4 bg-card border border-green-400 shadow-[0_0_8px_rgba(74,222,128,0.8)] flex flex-col min-h-0" data-zeus-id="Z-page-terminal-panel">
                <div className="flex items-center justify-between mb-4" data-zeus-id="Z-page-terminal-header">
                  <div className="flex items-center gap-2" data-zeus-id="Z-page-terminal-title-left">
                    <span className="font-semibold text-green-400" data-zeus-id="Z-page-terminal-title">Terminal</span>
                    <Badge variant="outline" data-zeus-id="Z-page-terminal-count">{terminalLines.length}</Badge>
                  </div>
                  <div className="flex items-center gap-2" data-zeus-id="Z-page-terminal-actions">
                    <button onClick={async () => {
                      if (twoStepGeneratorRef.current?.runFixMissingImportsAndValidate) {
                        await twoStepGeneratorRef.current.runFixMissingImportsAndValidate();
                        // Refrescar la vista previa después de la operación
                        refreshPreviewFiles();
                      }
                    }} disabled={isPostProcessing} className={`px-3 py-2 rounded-md text-xs font-medium transition-all duration-300 flex items-center gap-2 whitespace-nowrap ${isPostProcessing ? 'opacity-50 cursor-not-allowed text-muted-foreground/80' : 'text-foreground bg-gradient-to-br from-white/5 to-transparent border border-cyan-400/40 shadow-[0_0_10px_rgba(34,211,238,0.4)] hover:shadow-[0_0_20px_rgba(34,211,238,0.6)]'}`} data-zeus-id="Z-page-terminal-generate-components">
                      <Wand2 className="w-4 h-4" />
                      Generar Componentes
                    </button>
                    <button onClick={async () => {
                      if (twoStepGeneratorRef.current?.runPostCorrectPage) {
                        const result = await twoStepGeneratorRef.current.runPostCorrectPage();
                        if (!result?.filePath || !result?.content) refreshPreviewFiles();
                      }
                    }} disabled={isPostProcessing} className={`px-3 py-2 rounded-md text-xs font-medium transition-all duration-300 flex items-center gap-2 whitespace-nowrap ${isPostProcessing ? 'opacity-50 cursor-not-allowed text-muted-foreground/80' : 'text-foreground bg-gradient-to-br from-white/5 to-transparent border border-yellow-400/40 shadow-[0_0_10px_rgba(234,179,8,0.4)] hover:shadow-[0_0_20px_rgba(234,179,8,0.6)]'}`} data-zeus-id="Z-page-terminal-correct-page">
                      <AlertCircle className="w-4 h-4" />
                      Corregir archivo
                    </button>
                    <button onClick={async () => {
                      if (twoStepGeneratorRef.current?.runValidateComponents) {
                        await twoStepGeneratorRef.current.runValidateComponents();
                        // Refrescar la vista previa después de la operación
                        refreshPreviewFiles();
                      }
                    }} disabled={isPostProcessing} className={`px-3 py-2 rounded-md text-xs font-medium transition-all duration-300 flex items-center gap-2 whitespace-nowrap ${isPostProcessing ? 'opacity-50 cursor-not-allowed text-muted-foreground/80' : 'text-foreground bg-gradient-to-br from-white/5 to-transparent border border-indigo-400/40 shadow-[0_0_10px_rgba(99,102,241,0.4)] hover:shadow-[0_0_20px_rgba(99,102,241,0.6)]'}`} data-zeus-id="Z-page-terminal-validate-components">
                      <CheckCircle className="w-4 h-4" />
                      Validar Componentes
                    </button>
                  </div>
                </div>

                {isPostProcessing && <div className="mb-4 flex items-start gap-3 rounded-lg border border-green-500/30 bg-green-900/20 p-3" data-zeus-id="Z-page-terminal-postprocessing">
                    <Clock className="h-5 w-5 text-green-400 animate-spin mt-0.5" data-zeus-id="Z-page-terminal-postprocessing-icon" />
                    <div className="text-green-200 text-xs leading-relaxed" data-zeus-id="Z-page-terminal-postprocessing-text">
                      <strong className="text-green-100">Estamos terminando...</strong><br />
                      Aplicando correcciones automáticas y preparando el archivo ZIP. Por favor espera un momento antes de descargar o ir al editor.
                    </div>
                  </div>}

                <div className="border border-border/50 rounded-lg bg-background/90 flex-1 min-h-0 overflow-y-auto p-3 font-mono text-xs" data-zeus-id="Z-page-terminal-body">
                  {terminalLines.length === 0 ? (
                    <div className="text-muted-foreground" data-zeus-id="Z-page-terminal-empty">Aquí aparecerán los logs mientras se generan/guardan archivos.</div>
                  ) : (
                    terminalLines.map((line, idx) => (
                      <div key={idx} className={`whitespace-pre-wrap break-words leading-relaxed ${line.type === 'error' ? 'text-destructive' : line.type === 'warn' ? 'text-yellow-300' : line.type === 'info' ? 'text-primary-foreground' : 'text-foreground/80'}`} data-zeus-id={`Z-page-terminal-line-${idx}`}>
                        {line.type === 'error' ? '❌ ' : line.type === 'warn' ? '⚠️ ' : line.type === 'info' ? 'ℹ️ ' : ''}{line.text}
                      </div>
                    ))
                  )}
                  <div ref={terminalEndRef} data-zeus-id="Z-page-terminal-end" />
                </div>
              </Card>
            </div>
          </div> : (generatorStep === 'structure' && projectStructure) ? <div className="max-w-4xl mx-auto" data-zeus-id="Z-page-301">
            <Card className="p-6 bg-card border border-green-400 shadow-[0_0_8px_rgba(74,222,128,0.8)] text-foreground" data-zeus-id="Z-page-302">
              <div className="text-center" data-zeus-id="Z-page-303">
                <h2 className="text-2xl font-bold mb-6 text-green-400" data-zeus-id="Z-page-304">Estructura del Proyecto Generada</h2>
                <p className="text-foreground/70 mb-4" data-zeus-id="Z-page-305">La estructura ha sido generada. Puedes proceder a generar el contenido desde la Primera Parte.</p>
              </div>
            </Card>
          </div> : null}
        {!generatedFiles && generatorStep === 'structure' && projectStructure && <div className="mt-6 max-w-4xl mx-auto text-center text-sm text-foreground/70" data-zeus-id="Z-page-310">
            {autoApplyStatus && <div className="mb-3 inline-block px-3 py-1 rounded bg-card border border-border/50 text-foreground/80" data-zeus-id="Z-page-311">{autoApplyStatus}</div>}
            <div className="text-muted-foreground" data-zeus-id="Z-page-312">Se ha combinado la estructura del proyecto existente con los nuevos elementos propuestos por el plan. Los archivos marcados para modificación no se han aplicado aún.</div>
          </div>}

      </div>

      {/* Dialog para mostrar sugerencias de validación */}
      <Dialog open={showSuggestionsDialog} onOpenChange={setShowSuggestionsDialog}>
        <DialogContent className="bg-card border-border/50 text-foreground max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-cyan-400 text-xl font-bold flex items-center gap-2">
              <Info className="h-5 w-5" />
              Sugerencias de Validación de Componentes
            </DialogTitle>
            <DialogDescription className="text-foreground/70">
              Revisa las sugerencias del modelo para mejorar tus componentes
            </DialogDescription>
          </DialogHeader>
          
          {validationSuggestions ? (
            <div className="space-y-4 mt-4">
              <div className="flex items-center justify-between">
                <Button
                  onClick={async () => {
                    try {
                      let textToCopy = '=== SUGERENCIAS DE VALIDACIÓN DE COMPONENTES ===\n\n';
                      if (validationSuggestions.summary) {
                        textToCopy += validationSuggestions.summary + '\n\n';
                      }
                      const invalidComps = validationSuggestions.components?.filter((c: any) => c && c.issues && Array.isArray(c.issues) && c.issues.length > 0) || [];
                      invalidComps.forEach((comp: any, compIdx: number) => {
                        textToCopy += `\n--- ${comp.relativePath} ---\n`;
                        comp.issues.forEach((issue: any, issueIdx: number) => {
                          textToCopy += `\n[${issue.severity?.toUpperCase() || 'INFO'}] ${issue.message}\n`;
                          if (issue.suggestion) {
                            textToCopy += `Sugerencia: ${issue.suggestion}\n`;
                          }
                        });
                        if (compIdx < invalidComps.length - 1) {
                          textToCopy += '\n';
                        }
                      });
                      await navigator.clipboard.writeText(textToCopy);
                      setCopiedSuggestions(true);
                      setTimeout(() => setCopiedSuggestions(false), 2000);
                      toast({
                        title: 'Copiado',
                        description: 'Las sugerencias se han copiado al portapapeles',
                        variant: 'default'
                      });
                    } catch (error) {
                      console.error('Error copiando sugerencias:', error);
                      toast({
                        title: 'Error',
                        description: 'No se pudieron copiar las sugerencias',
                        variant: 'destructive'
                      });
                    }
                  }}
                  className="h-8 px-3 text-xs bg-cyan-800/50 hover:bg-cyan-700/50 text-cyan-200 border border-cyan-600/50 hover:border-cyan-500/70"
                >
                  {copiedSuggestions ? (
                    <>
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Copiado
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3 mr-1" />
                      Copiar
                    </>
                  )}
                </Button>
              </div>
              
              {validationSuggestions.summary && (
                <div className="text-sm text-cyan-200/90 bg-cyan-900/20 p-3 rounded-lg border border-cyan-500/30">
                  {validationSuggestions.summary.split('\n').map((line: string, idx: number) => (
                    <div key={idx}>{line.trim()}</div>
                  ))}
                </div>
              )}
              
              <div className="max-h-96 overflow-y-auto space-y-3">
                {validationSuggestions.components && validationSuggestions.components.length > 0 ? (
                  validationSuggestions.components
                    .filter((comp: any) => comp && comp.issues && Array.isArray(comp.issues) && comp.issues.length > 0)
                    .map((comp: any, compIdx: number) => (
                      <div key={compIdx} className="border-l-4 border-cyan-500/50 pl-4 py-2 space-y-2 bg-muted/30 rounded-r-lg">
                        <div className="font-semibold text-cyan-300 text-sm">
                          {comp.relativePath}
                        </div>
                        {comp.issues.map((issue: any, issueIdx: number) => (
                          <div key={issueIdx} className="text-sm space-y-1">
                            <div className="flex items-start gap-2">
                              <span className={`text-xs font-medium px-2 py-1 rounded ${
                                issue.severity === 'critical' ? 'bg-destructive/20 text-red-300 border border-destructive/30' :
                                issue.severity === 'high' ? 'bg-orange-500/20 text-orange-300 border border-orange-500/30' :
                                issue.severity === 'medium' ? 'bg-warning/20 text-yellow-300 border border-yellow-500/30' :
                                'bg-primary/20 text-primary-foreground border border-blue-500/30'
                              }`}>
                                [{issue.severity || 'info'}]
                              </span>
                              <div className="flex-1">
                                <div className="text-cyan-200/90 text-sm">
                                  {issue.message}
                                </div>
                                {issue.suggestion && (
                                  <div className="text-cyan-300/70 text-xs mt-1 italic">
                                    💡 {issue.suggestion}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ))
                ) : (
                  <div className="text-sm text-cyan-300/80 text-center py-8">
                    No hay componentes con problemas para mostrar
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No hay sugerencias disponibles
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>;
}

// Helper function to render structure tree
function renderStructureTree(structure: any[], level = 0): React.ReactNode {
  return structure.map((item: any, index: number) => <div key={index} style={{
    marginLeft: `${level * 20}px`
  }} data-zeus-id="Z-page-325">
      <div className="flex items-center gap-2 py-1" data-zeus-id="Z-page-326">
        {item.type === 'directory' ? <Folder className="w-4 h-4 text-primary" data-zeus-id="Z-page-327" /> : <FileText className="w-4 h-4 text-muted-foreground/80" data-zeus-id="Z-page-328" />}
        <span className={item.type === 'directory' ? 'font-medium text-primary' : 'text-foreground/70'} data-zeus-id="Z-page-329">
          {item.name}
        </span>
        {item.content && <span className="text-xs bg-green-600 text-foreground px-2 py-1 rounded" data-zeus-id="Z-page-330">
            predefinido
          </span>}
      </div>
      {item.children && renderStructureTree(item.children, level + 1)}
    </div>);
}

function TwoStepGeneratorPageWrapper() {
  const searchParams = useSearchParams();
  const initialTemplateId = searchParams?.get('templateId') ?? undefined;
  const initialAppType = (searchParams?.get('appType') ?? undefined) as 'web-app' | 'mobile-app' | undefined;

  return <TwoStepGeneratorPageContent initialTemplateId={initialTemplateId} initialAppType={initialAppType} />;
}

export default function TwoStepGeneratorPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen text-muted-foreground">Loading...</div>}>
      <TwoStepGeneratorPageWrapper />
    </Suspense>
  );
}