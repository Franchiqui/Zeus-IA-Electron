'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useModel } from '@/hooks/use-model';
import { useStore } from '@/lib/store';
import { useAutonomy } from '@/contexts/AutonomyContext';
import { useAuth } from '@/context/AuthContext';
// Custom Switch component (replaces broken import)
function Switch({
  checked,
  onCheckedChange,
  ...props
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  [k: string]: any;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${checked ? 'bg-green-500' : 'bg-muted/80'}`}
      {...props}
    >
      <span
        className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`}
      />
    </button>
  );
}

import { sessionFetch } from '@/lib/projectStore';
import {
  initPocketBase,
  isPocketBaseInitialized,
} from '@/api/lib/pocketbaseForGenerateApi';

// Helper function to generate unique IDs
const generateUniqueId = () => {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

export type PlanAction = {
  type: 'create_file' | 'update_file' | 'create_folder';
  path: string;
  purpose?: string;
  language?: 'tsx' | 'ts' | 'js';
  routeKind?: 'page' | 'route' | 'layout' | 'api' | 'component' | 'file';
  content?: string; // optional generated content
  // Opcionales para actualizaciones parciales
  replacements?: Array<{
    old: string;
    new: string;
  }>;
  markers?: Array<{
    start: string;
    end: string;
    newContent: string;
    includeMarkers?: boolean;
  }>;
};
type PlanExecutorProps = {
  projectRoot?: string;
  explorer?: Record<string, any> | Array<any>;
  projectId?: string;
  onRefreshFiles: () => Promise<void>; // New prop for refreshing file explorer
  onProjectTypeChange?: (type: 'database' | 'local' | 'unknown') => void; // Pasa el tipo detectado al padre (header)
  initialInstruction?: string;
  initialHintPath?: string;
  autoPlanOnMount?: boolean;
  currentConversationId?: string | null; // Conversation ID for saving messages
  onAddMessage?: (message: {
    id?: string;
    content: string;
    role: 'user' | 'assistant';
    type?: 'text';
    hasCodeChanges?: boolean;
    downloadableFiles?: Array<{ filePath: string; content: string }>;
    downloadOnly?: boolean;
  }) => void; // Function to add message to chat
  onSaveMessage?: (
    conversationId: string,
    message: {
      id?: string;
      content: string;
      role: 'user' | 'assistant';
      type?: 'text';
      hasCodeChanges?: boolean;
      downloadableFiles?: Array<{ filePath: string; content: string }>;
      downloadOnly?: boolean;
    }
  ) => Promise<string | undefined>; // Function to save message to conversation
  onForcePreviewReload?: () => void; // Function to force reload the preview
  activeFile?: { path: string; content?: string; name?: string } | null; // Current active file in editor
  fileContent?: string; // Content of the active file
  previewFile?: { path: string; content?: string } | null; // Current file in preview
  onFileSelect?: (filePath: string, content: string) => void; // Function to update editor with file content
  onNotifyPreviewServer?: (projectId: string) => Promise<void>; // Notificar servidor de vista previa (como hace el chat)
};
export default function PlanExecutor({
  projectRoot,
  explorer,
  projectId,
  onRefreshFiles,
  onProjectTypeChange,
  initialInstruction,
  initialHintPath,
  autoPlanOnMount,
  currentConversationId,
  onAddMessage,
  onSaveMessage,
  onForcePreviewReload,
  activeFile,
  fileContent,
  previewFile,
  onFileSelect,
  onNotifyPreviewServer,
}: PlanExecutorProps) {
  const [instruction, setInstruction] = useState('');
  const [hintPath, setHintPath] = useState('');
  const [autoScanFixImports, setAutoScanFixImports] = useState(false);
  const [autoScanSummary, setAutoScanSummary] = useState<string>('');
  const [autoScanPlaceholderPaths, setAutoScanPlaceholderPaths] = useState<
    string[]
  >([]);
  const didAutoPlanRef = useRef(false);
  const { selectedModel: modelFromLocalStorage } = useModel();
  const storeSelectedModel = useStore((s) => s.selectedModel);

  /** Mismo origen que el selector de la barra (store PocketBase); fallback a modelConfig en localStorage */
  const selectedModel = useMemo(() => {
    const sm = storeSelectedModel;
    if (sm?.id && String(sm.model_name ?? '').trim()) {
      return {
        id: sm.id,
        provider: sm.provider || 'openai',
        model: sm.model_name,
        url: sm.base_url,
        apiKey: sm.api_key,
      };
    }
    const lm = modelFromLocalStorage as Record<string, unknown> | null;
    if (!lm) return null;
    const legacyName =
      (typeof lm.model === 'string' && lm.model) ||
      (typeof lm.model_name === 'string' && lm.model_name);
    if (!String(legacyName || '').trim()) return null;
    return {
      id: String(lm.id ?? ''),
      provider: (typeof lm.provider === 'string' && lm.provider) || 'openai',
      model: legacyName,
      url: typeof lm.url === 'string' ? lm.url : undefined,
      apiKey:
        typeof lm.api_key === 'string'
          ? lm.api_key
          : typeof lm.apiKey === 'string'
            ? lm.apiKey
            : undefined,
    };
  }, [storeSelectedModel, modelFromLocalStorage]);

  const { autonomyLevel, setAutonomyLevel } = useAutonomy();
  const { user } = useAuth();
  const [plan, setPlan] = useState<{
    actions: PlanAction[];
  } | null>(null);
  const [status, setStatus] = useState<string>('');
  const [applying, setApplying] = useState(false);
  // Función para validar si un projectRoot es válido
  const isValidProjectRoot = (root: string | null | undefined): boolean => {
    if (!root || typeof root !== 'string') return false;
    const trimmed = root.trim();
    if (!trimmed) return false;
    return true; // Allow all paths including /tmp/ paths for temporary projects
  };

  const [localProjectRoot, setLocalProjectRoot] = useState<string>(() => {
    // Inicializar con projectRoot si es válido, sino vacío
    return isValidProjectRoot(projectRoot) ? projectRoot! : '';
  });
  useEffect(() => {
    if (
      projectRoot &&
      isValidProjectRoot(projectRoot) &&
      projectRoot !== localProjectRoot
    ) {
      setLocalProjectRoot(projectRoot);
    }
  }, [projectRoot, localProjectRoot]);

  const [projectType, setProjectType] = useState<
    'database' | 'local' | 'unknown'
  >('unknown');

  // ref para ignorar respuestas desactualizadas (evita que correcciones/operaciones cambien el tipo incorrectamente)
  const resolveVersionRef = useRef(0);
  const resolveProjectType = useCallback(async (): Promise<
    'database' | 'local'
  > => {
    const version = ++resolveVersionRef.current;
    const normalizedProjectId =
      typeof projectId === 'string' ? projectId.trim() : '';

    // Si no hay projectId válido, o es un ID temporal de preview, NO cambiar el tipo.
    // Los IDs de preview suelen empezar por local- o ser UUIDs largos que no existen en PocketBase.
    if (!normalizedProjectId || normalizedProjectId.startsWith('local-')) {
      console.log(
        '[PlanExecutor] ⏭️ ID temporal o ausente. Manteniendo tipo actual.'
      );
      return 'database';
    }

    // Consultar el campo database_type en la base de datos
    try {
      const response = await fetch(
        `/api/projects?id=${encodeURIComponent(normalizedProjectId)}`
      );

      // ✅ Ignorar si hubo una nueva solicitud mientras esperábamos (evita race condition)
      if (resolveVersionRef.current !== version) return 'database';

      if (response.ok) {
        const record = await response.json().catch(() => ({}));
        const databaseType = record?.database_type;

        // - Si database_type es true → proyecto de base de datos
        // - Si database_type es false → proyecto local
        // - Si database_type es undefined: NO actualizar (preservar) - evita cambiar a "local" incorrectamente
        if (databaseType === true) {
          console.log(
            '[PlanExecutor] ✅ database_type=true → Proyecto de BASE DE DATOS'
          );
          setProjectType('database');
          onProjectTypeChange?.('database');
          return 'database';
        } else if (databaseType === false) {
          console.log('[PlanExecutor] ✅ database_type=false → Proyecto LOCAL');
          setProjectType('local');
          onProjectTypeChange?.('local');
          return 'local';
        }
        // database_type undefined: preservar valor actual, no llamar onProjectTypeChange
        return 'database';
      }

      if (response.status === 404) {
        console.log(
          '[PlanExecutor] 🔒 Proyecto no encontrado en BD (ID de preview?). MANTENIENDO modo database.'
        );
        // BLOQUEO: No llamar a onProjectTypeChange?.('local');
        return 'database';
      }

      // ✅ Para 500, timeout, etc: NO actualizar - preservar valor anterior
      console.warn(
        '[PlanExecutor] ⚠️ API /api/projects devolvió',
        response.status,
        '- preservando tipo actual'
      );
      return 'database';
    } catch (error) {
      console.warn(
        '[PlanExecutor] ⚠️ Error consultando tipo de proyecto en PocketBase:',
        error
      );
      // ✅ CRÍTICO: En error de red/timeout NO sobrescribir con 'local' - preservar estado anterior
      return 'database';
    }
  }, [projectId, onProjectTypeChange]);

  useEffect(() => {
    void resolveProjectType();
  }, [resolveProjectType]);

  // Preferencias adicionales para guiar al modelo
  const [autonomy, setAutonomy] = useState<'guided' | 'semi' | 'full'>(
    'guided'
  );
  const [protectedPathsText, setProtectedPathsText] = useState<string>(
    'app/api/**\nserver/**'
  );
  const [allowedExtensionsText, setAllowedExtensionsText] =
    useState<string>('.ts,.tsx');
  const [uiLibrary, setUiLibrary] = useState<string>('shadcn');
  const [deliverables, setDeliverables] = useState<
    'plan' | 'plan_and_skeletons'
  >('plan_and_skeletons');

  // Removed two-step generator recommendation UI/state

  // Auto-detect projectRoot from explorer files if not set or invalid
  useEffect(() => {
    if (!explorer || typeof explorer !== 'object') return;

    const shouldAutoDetect = !isValidProjectRoot(localProjectRoot);

    if (!shouldAutoDetect) return;

    try {
      // Function to recursively find all file paths in the explorer tree
      const findAllPaths = (nodes: any[], currentPath = ''): string[] => {
        const paths: string[] = [];
        for (const node of nodes) {
          const nodePath = currentPath
            ? `${currentPath}/${node.path}`
            : node.path;
          if (node.type === 'file') {
            paths.push(nodePath);
          } else if (node.children) {
            paths.push(...findAllPaths(node.children, nodePath));
          }
        }
        return paths;
      };

      console.log(
        '[PlanExecutor] Auto-detecting projectRoot. Current localProjectRoot:',
        localProjectRoot
      );
      console.log(
        '[PlanExecutor] Explorer structure (first few items):',
        Array.isArray(explorer) ? explorer.slice(0, 3) : 'not array'
      );

      const allPaths = findAllPaths(Array.isArray(explorer) ? explorer : []);
      console.log(
        '[PlanExecutor] All found paths (first 10):',
        allPaths.slice(0, 10)
      );

      // Find a canonical page path
      const pagePath = allPaths.find((p) =>
        /(^|\/)(src\/)?app\/page\.tsx$/i.test(p.replace(/\\/g, '/'))
      );
      const appPath = allPaths.find((p) =>
        /(^|\/)(src\/)?app\//i.test(p.replace(/\\/g, '/'))
      );

      console.log(
        '[PlanExecutor] Found pagePath:',
        pagePath,
        'appPath:',
        appPath
      );

      let detectedRoot = '';
      if (pagePath) {
        const norm = pagePath.replace(/\\/g, '/');
        // Try to cut before '/app/' (or '/src/app/') segment to get root
        let idx = norm.toLowerCase().lastIndexOf('/app/');
        if (idx > 0) {
          // If we have '/src/app/', cut before '/src'
          const srcIdx = norm.toLowerCase().lastIndexOf('/src/app/');
          if (srcIdx >= 0) {
            detectedRoot = norm.slice(0, srcIdx);
          } else {
            detectedRoot = norm.slice(0, idx);
          }
        }
      } else if (appPath) {
        const norm = appPath.replace(/\\/g, '/');
        // Try to cut before '/app/' (or '/src/app/') segment to get root
        let idx = norm.toLowerCase().lastIndexOf('/app/');
        if (idx > 0) {
          // If we have '/src/app/', cut before '/src'
          const srcIdx = norm.toLowerCase().lastIndexOf('/src/app/');
          if (srcIdx >= 0) {
            detectedRoot = norm.slice(0, srcIdx);
          } else {
            detectedRoot = norm.slice(0, idx);
          }
        }
      }

      // If we found a root and it's different from current, update it
      if (detectedRoot !== undefined && detectedRoot !== localProjectRoot) {
        console.log(
          '[PlanExecutor] Auto-detected projectRoot from explorer:',
          detectedRoot
        );
        setLocalProjectRoot(detectedRoot);
      }
    } catch (err) {
      console.warn('[PlanExecutor] Error auto-detecting projectRoot:', err);
    }
  }, [explorer, localProjectRoot]);

  useEffect(() => {
    if (
      typeof initialInstruction === 'string' &&
      initialInstruction.trim() &&
      !instruction.trim()
    ) {
      setInstruction(initialInstruction);
    }
    if (
      typeof initialHintPath === 'string' &&
      initialHintPath.trim() &&
      !hintPath.trim()
    ) {
      setHintPath(initialHintPath);
    }
  }, [initialHintPath, initialInstruction, hintPath, instruction]);

  // Construye un árbol tipo ExplorerNode[] desde un FileMap plano (Record<path, content>)
  function buildExplorerTree(input: any, rootBase?: string) {
    if (Array.isArray(input)) return input; // ya estaría en formato árbol
    if (!input || typeof input !== 'object') return [];
    const makeRel = (p: string): string => {
      let rp = String(p || '');
      if (rootBase && rp.startsWith(rootBase)) {
        rp = rp.slice(rootBase.length);
      }
      rp = rp.replace(/^\\+|^\/+/, '');
      rp = rp.replace(/\\/g, '/');
      return rp || '';
    };
    type Node = {
      name: string;
      path: string;
      type: 'file' | 'directory';
      children?: Node[];
    };
    const root: Node = {
      name: '',
      path: '',
      type: 'directory',
      children: [],
    };
    const dirMap = new Map<string, Node>();
    dirMap.set('', root);
    for (const absPath of Object.keys(input)) {
      const relPath = makeRel(absPath);
      if (!relPath) continue;
      const parts = relPath.split('/').filter(Boolean);
      let currPath = '';
      let parent = root;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isFile = i === parts.length - 1 && /\.[^./]+$/.test(part);
        const nextPath = currPath ? `${currPath}/${part}` : part;
        if (isFile) {
          parent.children = parent.children || [];
          if (
            !parent.children.find((c) => c.name === part && c.type === 'file')
          ) {
            parent.children.push({
              name: part,
              path: nextPath,
              type: 'file',
            });
          }
        } else {
          // directory
          let dirNode = dirMap.get(nextPath);
          if (!dirNode) {
            dirNode = {
              name: part,
              path: nextPath,
              type: 'directory',
              children: [],
            };
            parent.children = parent.children || [];
            parent.children.push(dirNode);
            dirMap.set(nextPath, dirNode);
          }
          parent = dirNode;
          currPath = nextPath;
        }
      }
    }
    return root.children || [];
  }

  const toPosix = (p: string) =>
    String(p || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
  const dirnamePosix = (p: string) => {
    const norm = toPosix(p);
    const idx = norm.lastIndexOf('/');
    if (idx <= 0) return '';
    return norm.slice(0, idx);
  };
  const resolvePosix = (baseDir: string, rel: string) => {
    const baseParts = toPosix(baseDir).split('/').filter(Boolean);
    const relParts = toPosix(rel).split('/').filter(Boolean);
    const stack = [...baseParts];
    for (const part of relParts) {
      if (part === '.' || part === '') continue;
      if (part === '..') {
        stack.pop();
        continue;
      }
      stack.push(part);
    }
    return stack.join('/');
  };

  const flattenExplorerToFileMap = (ex: any): Record<string, string> => {
    if (!ex) return {};
    if (!Array.isArray(ex) && typeof ex === 'object') {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(ex)) {
        out[toPosix(k)] = typeof v === 'string' ? v : '';
      }
      return out;
    }
    if (!Array.isArray(ex)) return {};

    const out: Record<string, string> = {};
    const walk = (nodes: any[]) => {
      for (const n of nodes) {
        if (!n) continue;
        if (n.type === 'file' && n.path) {
          out[toPosix(n.path)] = typeof n.content === 'string' ? n.content : '';
        }
        if (Array.isArray(n.children)) walk(n.children);
      }
    };
    walk(ex);
    return out;
  };

  const buildAutoFixImportsInstruction = (ex: any) => {
    const fileMap = flattenExplorerToFileMap(ex);
    const allPaths = Object.keys(fileMap);
    const SOURCE_EXTS = ['.tsx', '.ts', '.jsx', '.js'];
    const existing = new Set(allPaths.map((p) => toPosix(p)));

    const missingTargets = new Set<string>();
    const placeholderTargets = new Set<string>();
    const contextFiles = new Set<string>();

    const importFromRe = /\bimport\s+[^;\n]*?\s+from\s+['"]([^'"]+)['"]/g;
    const requireRe = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;

    const isPlaceholder = (content: string) => {
      const trimmed = (content || '').trim();
      if (!trimmed) return true;
      if (trimmed.length > 260) return false;
      if (!/\breturn\s+null\s*;/.test(trimmed)) return false;
      if (!/\bexport\s+default\s+function\b/.test(trimmed)) return false;
      if (!/\bimport\s+React\s+from\s+['"]react['"]\s*;/.test(trimmed))
        return false;
      return true;
    };

    for (const absPath of allPaths) {
      const filePath = toPosix(absPath);
      const lower = filePath.toLowerCase();
      if (!SOURCE_EXTS.some((ext) => lower.endsWith(ext))) continue;
      if (lower.includes('/node_modules/')) continue;
      const content = fileMap[filePath] || '';

      if (isPlaceholder(content)) {
        placeholderTargets.add(filePath);
        contextFiles.add(filePath);
      }

      const dir = dirnamePosix(filePath);

      const specs: string[] = [];
      for (const re of [importFromRe, requireRe]) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(content)) !== null) {
          if (m[1]) specs.push(String(m[1]));
        }
      }

      for (let spec of specs) {
        spec = spec.trim();
        if (!spec) continue;
        if (
          !(
            spec.startsWith('./') ||
            spec.startsWith('../') ||
            spec.startsWith('@/')
          )
        )
          continue;
        if (spec.startsWith('@/')) {
          spec = spec.slice(2);
        } else {
          spec = resolvePosix(dir, spec);
        }

        spec = spec.replace(/\.(tsx?|jsx?)$/i, '');

        const importerPrefersTsx =
          lower.endsWith('.tsx') || lower.endsWith('.jsx');
        const defaultExt = importerPrefersTsx ? '.tsx' : '.ts';
        const candidates = [
          `${spec}${defaultExt}`,
          `${spec}.tsx`,
          `${spec}.ts`,
          `${spec}.jsx`,
          `${spec}.js`,
          `${spec}/index${defaultExt}`,
          `${spec}/index.tsx`,
          `${spec}/index.ts`,
          `${spec}/index.jsx`,
          `${spec}/index.js`,
        ].map(toPosix);

        const exists = candidates.some((c) => existing.has(c));
        if (!exists) {
          missingTargets.add(toPosix(`${spec}${defaultExt}`));
          contextFiles.add(filePath);
        }
      }
    }

    const missingList = Array.from(missingTargets).sort();
    const placeholderList = Array.from(placeholderTargets).sort();
    const contextList = Array.from(contextFiles).sort();

    const createList = Array.from(
      new Set([...missingList, ...placeholderList])
    ).sort();

    const instructionText = [
      'OBJETIVO:',
      'Crear los archivos necesarios (incluye imports faltantes y archivos con contenido no válido/placeholder).',
      '',
      'REGLAS:',
      '- Para cada archivo de "ARCHIVOS A CREAR", devuelve una acción create_file con contenido completo y funcional.',
      '- Respeta la arquitectura existente del proyecto (nombres, rutas, estilos).',
      '- No inventes archivos demo. Usa los existentes como referencia.',
      '',
      `ARCHIVOS A CREAR (${createList.length}):`,
      ...(createList.length
        ? createList.map((p) => `- ${p}`)
        : ['- (ninguno)']),
    ].join('\n');

    const summaryText = `Escaneo: ${missingList.length} imports faltantes, ${placeholderList.length} archivos no válidos/placeholder, ${contextList.length} archivos de contexto.`;
    return {
      instructionText,
      summaryText,
      missingList,
      placeholderList,
      createList,
    };
  };

  const pruneExplorerTree = (nodes: any[], removePaths: Set<string>): any[] => {
    if (!Array.isArray(nodes)) return [];
    const prune = (n: any): any | null => {
      if (!n) return null;
      const nodePath = typeof n.path === 'string' ? toPosix(n.path) : '';
      if (n.type === 'file') {
        if (nodePath && removePaths.has(nodePath)) return null;
        return n;
      }
      if (Array.isArray(n.children)) {
        const prunedChildren = n.children.map(prune).filter(Boolean);
        if (prunedChildren.length === 0) {
          return { ...n, children: [] };
        }
        return { ...n, children: prunedChildren };
      }
      return n;
    };
    return nodes.map(prune).filter(Boolean);
  };

  async function planScaffold(instructionOverride?: string) {
    const effectiveInstruction = (instructionOverride ?? instruction).trim();
    if (!effectiveInstruction) {
      setStatus('Por favor, proporciona una instrucción');
      return;
    }

    // Validar que tengamos un projectRoot válido
    let finalProjectRoot = localProjectRoot;
    if (!isValidProjectRoot(localProjectRoot)) {
      // Intentar auto-detección síncrona antes de enviar la petición
      console.log(
        '[PlanExecutor] localProjectRoot inválido, intentando auto-detección síncrona'
      );
      try {
        if (explorer && Array.isArray(explorer)) {
          const findAllPaths = (nodes: any[], currentPath = ''): string[] => {
            const paths: string[] = [];
            for (const node of nodes) {
              const nodePath = currentPath
                ? `${currentPath}/${node.path}`
                : node.path;
              if (node.type === 'file') {
                paths.push(nodePath);
              } else if (node.children) {
                paths.push(...findAllPaths(node.children, nodePath));
              }
            }
            return paths;
          };

          const allPaths = findAllPaths(explorer);
          const pagePath = allPaths.find((p) =>
            /(^|\/)(src\/)?app\/page\.tsx$/i.test(p.replace(/\\/g, '/'))
          );
          const appPath = allPaths.find((p) =>
            /(^|\/)(src\/)?app\//i.test(p.replace(/\\/g, '/'))
          );

          let detectedRoot = '';
          if (pagePath) {
            const norm = pagePath.replace(/\\/g, '/');
            let idx = norm.toLowerCase().lastIndexOf('/app/');
            if (idx > 0) {
              const srcIdx = norm.toLowerCase().lastIndexOf('/src/app/');
              if (srcIdx >= 0) {
                detectedRoot = norm.slice(0, srcIdx);
              } else {
                detectedRoot = norm.slice(0, idx);
              }
            }
          } else if (appPath) {
            const norm = appPath.replace(/\\/g, '/');
            let idx = norm.toLowerCase().lastIndexOf('/app/');
            if (idx > 0) {
              const srcIdx = norm.toLowerCase().lastIndexOf('/src/app/');
              if (srcIdx >= 0) {
                detectedRoot = norm.slice(0, srcIdx);
              } else {
                detectedRoot = norm.slice(0, idx);
              }
            }
          }

          if (detectedRoot !== undefined && isValidProjectRoot(detectedRoot)) {
            console.log(
              '[PlanExecutor] Auto-detected valid projectRoot synchronously:',
              detectedRoot
            );
            setLocalProjectRoot(detectedRoot);
            finalProjectRoot = detectedRoot;
          } else {
            throw new Error('No se pudo detectar un projectRoot válido');
          }
        } else {
          throw new Error('Explorer no disponible para auto-detección');
        }
      } catch (err) {
        console.error('[PlanExecutor] Error en auto-detección síncrona:', err);
        // Limpiar projectRoot inválido del localStorage si es necesario
        if (localProjectRoot && !isValidProjectRoot(localProjectRoot)) {
          console.warn(
            '[PlanExecutor] Eliminando projectRoot inválido del localStorage:',
            localProjectRoot
          );
          if (typeof window !== 'undefined') {
            localStorage.removeItem('projectRoot');
          }
        }
        setStatus(
          'Error: No hay un proyecto válido configurado. Abre un proyecto desde el explorador de archivos o especifica la ruta manualmente en el campo "Project Root".'
        );
        return;
      }
    }

    setStatus('Planificando...');
    let explorerTree = buildExplorerTree(explorer, finalProjectRoot);
    if (autoScanFixImports && autoScanPlaceholderPaths.length > 0) {
      const remove = new Set(autoScanPlaceholderPaths.map((p) => toPosix(p)));
      explorerTree = pruneExplorerTree(explorerTree, remove);
    }
    const protectedPaths = protectedPathsText
      .split(/\r?\n|,/)
      .map((s) => s.trim())
      .filter(Boolean);
    const allowedExtensions = allowedExtensionsText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    // ✅ CRÍTICO: Obtener el contenido del archivo activo con priorización correcta
    // PRIORIDAD 1: fileContent (contenido del editor)
    // PRIORIDAD 2: previewFile.content (contenido de la vista previa)
    // PRIORIDAD 3: activeFile.content (contenido del objeto activeFile)
    let activeFileContent = '';
    let activeFilePath = '';

    // PRIORIDAD 1: Usar fileContent si está disponible
    if (fileContent && fileContent.trim()) {
      activeFileContent = fileContent;
      activeFilePath = activeFile?.path || '';
      console.log(
        '[PlanExecutor] ✅ Usando fileContent como archivo principal (length:',
        activeFileContent.length,
        ')'
      );
    }
    // PRIORIDAD 2: Si no hay fileContent pero hay previewFile, usar previewFile
    else if (previewFile && previewFile.content && previewFile.content.trim()) {
      activeFileContent = previewFile.content;
      activeFilePath = previewFile.path;
      console.log(
        '[PlanExecutor] 📝 No hay fileContent, usando previewFile como archivo principal para planificación'
      );
      console.log('[PlanExecutor] PreviewFile path:', previewFile.path);
      console.log(
        '[PlanExecutor] PreviewFile content length:',
        activeFileContent.length
      );
    }
    // PRIORIDAD 3: Si hay activeFile con contenido, usarlo
    else if (activeFile && activeFile.content && activeFile.content.trim()) {
      activeFileContent = activeFile.content;
      activeFilePath = activeFile.path;
      console.log(
        '[PlanExecutor] ✅ Usando activeFile.content como archivo principal (length:',
        activeFileContent.length,
        ')'
      );
    }
    // PRIORIDAD 4: Si solo tenemos la ruta pero no el contenido, intentar obtenerlo del explorador
    else if (activeFile?.path) {
      activeFilePath = activeFile.path;
      console.log(
        '[PlanExecutor] ⚠️ Solo tenemos la ruta del archivo, intentando obtener contenido del explorador...'
      );
    }

    // Si aún no tenemos contenido, intentar obtenerlo del explorador
    if (
      (!activeFileContent || !activeFileContent.trim()) &&
      activeFilePath &&
      explorer
    ) {
      console.log(
        '[PlanExecutor] 📝 Intentando obtener contenido del archivo desde el explorador:',
        activeFilePath
      );
      const normalizedPath = activeFilePath
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');

      if (Array.isArray(explorer)) {
        const findFileInExplorer = (
          nodes: any[],
          targetPath: string
        ): string | null => {
          for (const node of nodes) {
            if (
              node.path &&
              (node.path.replace(/\\/g, '/').replace(/^\/+/, '') ===
                targetPath ||
                node.path === activeFilePath)
            ) {
              return node.content || null;
            }
            if (node.children && Array.isArray(node.children)) {
              const found = findFileInExplorer(node.children, targetPath);
              if (found !== null) return found;
            }
          }
          return null;
        };
        const foundContent = findFileInExplorer(explorer, normalizedPath);
        if (foundContent) {
          activeFileContent = foundContent;
          console.log(
            '[PlanExecutor] ✅ Archivo encontrado en explorador. Longitud:',
            activeFileContent.length
          );
        }
      } else if (typeof explorer === 'object') {
        const foundContent =
          (explorer as Record<string, string>)[normalizedPath] ||
          (explorer as Record<string, string>)[activeFilePath];
        if (foundContent) {
          activeFileContent = foundContent;
          console.log(
            '[PlanExecutor] ✅ Archivo encontrado en explorador. Longitud:',
            activeFileContent.length
          );
        }
      }
    }

    // ✅ Si todavía no hay contenido, leer directamente del servidor de archivos
    if ((!activeFileContent || !activeFileContent.trim()) && activeFilePath) {
      try {
        const fileName = activeFilePath.split('/').pop() || '';
        const dirPath = activeFilePath
          .replace('/' + fileName, '')
          .replace(fileName, '');
        const fileUrl = `http://localhost:8742/api/files/${encodeURIComponent(fileName)}?path=${encodeURIComponent(dirPath)}`;
        console.log(
          '[PlanExecutor] 🔄 Fetching file content from file server:',
          fileUrl
        );
        const response = await fetch(fileUrl);
        const result = await response.json();
        if (result && result.success && typeof result.content === 'string') {
          activeFileContent = result.content;
          console.log(
            '[PlanExecutor] ✅ File content fetched from server. Length:',
            activeFileContent.length
          );
        } else {
          console.warn(
            '[PlanExecutor] ⚠️ File server responded but no content:',
            result
          );
        }
      } catch (err) {
        console.warn(
          '[PlanExecutor] ⚠️ Could not fetch file content from file server:',
          err
        );
      }
    }

    // ✅ NUEVO: Escanear la instrucción en busca de archivos mencionados para dar más contexto al modelo
    const contextFiles: Array<{ path: string; content: string }> = [];
    if (explorer && Array.isArray(explorer)) {
      const words = effectiveInstruction.split(/[\s,;()\[\]{}'"]+/);
      const allFiles: Array<{ name: string; path: string }> = [];
      
      const walk = (nodes: any[]) => {
        for (const node of nodes) {
          if (node.type === 'file') {
            allFiles.push({ name: node.name || node.path.split('/').pop() || '', path: node.path });
          }
          if (node.children && Array.isArray(node.children)) walk(node.children);
        }
      };
      walk(explorer);
      
      const mentionedFiles = new Set<string>();
      for (const word of words) {
        if (word.includes('.') && word.length > 3) {
          const match = allFiles.find(f => 
            f.name === word || 
            f.path === word || 
            f.path.replace(/\\/g, '/').endsWith('/' + word) ||
            f.path.replace(/\\/g, '/').replace(/^\/+/, '') === word.replace(/^\/+/, '')
          );
          
          if (match && match.path !== activeFilePath) {
            mentionedFiles.add(match.path);
          }
        }
      }
      
      // Limitar a 5 archivos de contexto para no saturar el prompt
      const filesToFetch = Array.from(mentionedFiles).slice(0, 5);
      if (filesToFetch.length > 0) {
        console.log('[PlanExecutor] 🔍 Fetching mentioned files for context:', filesToFetch);
        for (const filePath of filesToFetch) {
          try {
            const fileName = filePath.split(/[\\/]/).pop() || '';
            const dirPath = filePath.replace(/[\\/][^\\/]+$/, '');
            const fileUrl = `http://localhost:8742/api/files/${encodeURIComponent(fileName)}?path=${encodeURIComponent(dirPath)}`;
            const response = await fetch(fileUrl);
            const result = await response.json();
            if (result && result.success && typeof result.content === 'string') {
              contextFiles.push({ path: filePath, content: result.content });
              console.log(`[PlanExecutor] ✅ Context file fetched: ${filePath}`);
            }
          } catch (e) {
            console.warn(`[PlanExecutor] ⚠️ Failed to fetch context file ${filePath}:`, e);
          }
        }
      }
    }

    // Prepare the request payload
    // NORMALIZACIÓN DE RUTAS: Asegurar que el modelo vea rutas relativas a la raíz del proyecto
    const normalizedExplorer = explorerTree.map((node: any) => {
      const normalizeNode = (n: any): any => {
        // Si el nodo ya tiene una ruta coherente con el root, la mantenemos.
        // Si no, la normalizamos para que sea relativa al root real.
        return {
          ...n,
          children: n.children ? n.children.map(normalizeNode) : undefined,
        };
      };
      return normalizeNode(node);
    });

    const payload = {
      description: effectiveInstruction,
      hints: hintPath.trim()
        ? {
            path: hintPath,
          }
        : undefined,
      // Only include hints if hintPath is provided
      // Enviar identificador y datos mínimos del modelo seleccionado
      modelId: selectedModel?.id,
      model: selectedModel
        ? {
            provider: (selectedModel as any).provider || 'openai',
            model: selectedModel.model,
            url: (selectedModel as any).url,
            apiKey: (selectedModel as any).apiKey,
          }
        : undefined,
      userId: user?.id,
      projectRoot: finalProjectRoot || undefined,
      explorer: normalizedExplorer,
      autonomy,
      protectedPaths,
      allowedExtensions,
      uiLibrary,
      deliverables,
      // ✅ CRÍTICO: Incluir el archivo activo para que el modelo/backend vea el código actual.
      // Enviamos el path siempre que exista; el backend leerá del disco si el contenido está vacío.
      activeFile: activeFilePath
        ? {
            path: activeFilePath,
            content: activeFileContent || '',
          }
        : undefined,
      // ✅ NUEVO: Archivos de contexto adicionales detectados por mención
      contextFiles: contextFiles.length > 0 ? contextFiles : undefined,
    };

    // ✅ Logging detallado para debugging
    console.log('[PlanExecutor] 📊 Resumen del contexto enviado al modelo:');
    console.log('[PlanExecutor] - finalProjectRoot:', finalProjectRoot);
    console.log(
      '[PlanExecutor] - activeFilePath:',
      activeFilePath || '(ninguno)'
    );
    console.log(
      '[PlanExecutor] - activeFile en payload:',
      payload.activeFile ? `Sí (path: ${payload.activeFile.path})` : 'No'
    );
    console.log(
      '[PlanExecutor] Sending request to /api/plan-with-model with payload:',
      payload
    );
    try {
      const res = await sessionFetch('/api/plan-with-model', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      console.log(
        '[PlanExecutor] Received response from /api/plan-with-model:',
        res.status
      );
      const data = await res.json();
      if (!res.ok) {
        console.error(
          '[PlanExecutor] Error response from /api/plan-with-model:',
          data
        );
        setStatus('Error: ' + (data?.error ?? res.statusText));
        setPlan(null);
        return;
      }

      // NORMALIZACIÓN DE ACCIONES: Corregir rutas generadas por el modelo que puedan tener redundancia
      const rawActions = data.actions ?? [];
      const actions = rawActions.map((action: any) => {
        if (!action.path) return action;

        let cleanPath = action.path.replace(/\\/g, '/');

        // Si el modelo repite la carpeta del proyecto en la ruta (ej: "Zeus-IA/app/page.tsx")
        // O si repite carpetas base como "app/app/page.tsx" cuando estamos en una subcarpeta
        const projectFolderName =
          (finalProjectRoot || '').split(/[\\/]/).pop() || '';
        if (
          projectFolderName &&
          cleanPath.startsWith(projectFolderName + '/')
        ) {
          cleanPath = cleanPath.slice(projectFolderName.length + 1);
        }

        // Detectar y corregir redundancias comunes como app/app/ o components/components/
        const redundantes = [
          'app/',
          'components/',
          'services/',
          'lib/',
          'api/',
        ];
        for (const r of redundantes) {
          if (cleanPath.startsWith(r + r)) {
            cleanPath = cleanPath.slice(r.length);
          }
        }

        return { ...action, path: cleanPath };
      });

      console.log('[PlanExecutor] Received and normalized actions:', actions);
      setPlan({
        actions,
      });
      // Si el server devuelve un projectRoot y el input está vacío, úsalo para aplicar correctamente en el FS
      if (
        !localProjectRoot &&
        typeof data.projectRoot === 'string' &&
        data.projectRoot.length > 0
      ) {
        setLocalProjectRoot(data.projectRoot);
      }
      if (!actions.length) {
        setStatus(
          'Sin acciones. Prueba con una instrucción más específica o añade un Hint Path para guiar mejor al modelo.'
        );
      } else {
        setStatus('Plan listo');
      }
    } catch (err) {
      console.error('[PlanExecutor] Network error:', err);
      setStatus(
        'Error de red: ' +
          (err instanceof Error ? err.message : 'Unknown error')
      );
      setPlan(null);
    }
  }

  useEffect(() => {
    if (!autoPlanOnMount) return;
    if (didAutoPlanRef.current) return;
    if (!instruction.trim()) return;
    if (plan) return;
    if (applying) return;
    didAutoPlanRef.current = true;
    void planScaffold();
  }, [applying, autoPlanOnMount, instruction, plan]);
  async function applyPlan() {
    if (!plan) return;
    setApplying(true);
    setStatus('Aplicando plan...');

    // ✅ OPTIMIZADO: Feedback visual inmediato
    const startTime = Date.now();
    // Recopilar archivos modificados para sincronizar el editor/explorador
    const fileUpdates: Array<{ filePath: string; content: string }> = [];

    // Inicializar contadores fuera del try para que estén disponibles en todo el scope
    let appliedCount = 0;
    let errorCount = 0;
    let partialApplied = 0;
    let partialErrors = 0;

    try {
      const resolvedProjectType = await resolveProjectType();
      const isPocketBaseProject = resolvedProjectType === 'database';
      const storedDatabaseId =
        typeof window !== 'undefined'
          ? window.localStorage.getItem('databaseProjectId')
          : null;
      const effectiveProjectId = projectId || storedDatabaseId || undefined;

      // ✅ Refuerzo: si es PocketBase, asegurarnos de tener un projectRoot válido antes de /api/apply-plan
      let effectiveProjectRoot = localProjectRoot;
      if (
        isPocketBaseProject &&
        (!effectiveProjectRoot || !effectiveProjectRoot.trim())
      ) {
        try {
          const rootRes = await sessionFetch('/api/project/get-root', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId: effectiveProjectId,
              initialProjectRoot: localProjectRoot || undefined,
            }),
          });
          const rootData = await rootRes.json().catch(() => ({}));
          if (
            rootRes.ok &&
            typeof rootData?.projectRoot === 'string' &&
            rootData.projectRoot.trim()
          ) {
            effectiveProjectRoot = rootData.projectRoot;
            setLocalProjectRoot(rootData.projectRoot);
          }
        } catch {}
      }

      if (!effectiveProjectRoot || !effectiveProjectRoot.trim()) {
        setStatus(
          'Error: projectRoot vacío. Define un Project Root o abre el proyecto desde PocketBase.'
        );
        setApplying(false);
        return;
      }

      // 1) Aplica todas las acciones de creación de una vez
      const res = await sessionFetch('/api/apply-plan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          actions: plan.actions,
          projectRoot: effectiveProjectRoot,
          projectId: effectiveProjectId, // Add projectId for PocketBase updates
          onlyCreate: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus('Error aplicando plan: ' + (data?.error ?? res.statusText));
        setApplying(false);
        return;
      }
      appliedCount = Array.isArray(data?.result?.applied)
        ? data.result.applied.length
        : 0;
      errorCount = Array.isArray(data?.result?.errors)
        ? data.result.errors.length
        : 0;

      // Recopilar archivos creados para sincronizar el editor/explorador
      const createdFiles = plan.actions.filter(
        (a: any) => a.type === 'create_file' && typeof a.content === 'string'
      );
      for (const action of createdFiles) {
        const normalizedPath = action.path
          .replace(/\\/g, '/')
          .replace(/^\/+/, '');
        fileUpdates.push({
          filePath: normalizedPath,
          content: action.content || '',
        });
      }

      // ✅ Obtener el projectRoot real donde se aplicaron los cambios
      const actualProjectRoot = data?.projectRoot || localProjectRoot;
      // 2) Procesa update_file mediante API de corrección por lotes: /api/correct-code
      const updates = (plan.actions || []).filter(
        (a) => a.type === 'update_file'
      );
      let restoredAutonomy = false;
      let prevAutonomy: any = autonomyLevel;
      if (updates.length > 0) {
        setStatus(
          (prev) =>
            `${prev} | Procesando ${updates.length} actualización(es)...`
        );
        if (autonomyLevel !== 'full') {
          // Activación automática de edición directa
          try {
            setAutonomyLevel('full' as any);
            restoredAutonomy = true;
          } catch {}
          setStatus(
            (prev) =>
              `${prev} | Edición directa activada automáticamente para aplicar updates.`
          );
        }
        // 2a) Primero, aplicar todos los updates que sean 'replacements' en memoria
        const replacementUpdates = updates.filter(
          (u: any) => Array.isArray(u.replacements) && u.replacements.length > 0
        );
        if (replacementUpdates.length > 0) {
          // Aplicar cambios en memoria usando el contenido más actualizado disponible
          for (const update of replacementUpdates) {
            const normalizedPath = update.path
              .replace(/\\/g, '/')
              .replace(/^\/+/, '');

            // ✅ CRÍTICO: Obtener el contenido actual del archivo con priorización correcta
            // PRIORIDAD 1: fileContent (si el archivo está abierto en el editor y coincide con update.path)
            // PRIORIDAD 2: previewFile.content (si el archivo está en la vista previa y coincide)
            // PRIORIDAD 3: activeFile.content (si está disponible y coincide)
            // PRIORIDAD 4: Explorador (como fallback)
            let currentContent = '';

            // Función auxiliar para normalizar y comparar rutas
            const normalizePathForComparison = (path: string): string => {
              return path.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
            };

            const updatePathNormalized = normalizePathForComparison(
              update.path
            );
            const normalizedPathNormalized =
              normalizePathForComparison(normalizedPath);

            // PRIORIDAD 1: Verificar si el archivo está abierto en el editor
            if (fileContent && fileContent.trim() && activeFile?.path) {
              const activeFilePathNormalized = normalizePathForComparison(
                activeFile.path
              );
              if (
                activeFilePathNormalized === updatePathNormalized ||
                activeFilePathNormalized === normalizedPathNormalized ||
                activeFilePathNormalized.endsWith(normalizedPathNormalized)
              ) {
                currentContent = fileContent;
                console.log(
                  '[PlanExecutor] ✅ Usando fileContent del editor para aplicar cambios (length:',
                  currentContent.length,
                  ')'
                );
              }
            }

            // PRIORIDAD 2: Verificar si el archivo está en la vista previa
            if (
              (!currentContent || !currentContent.trim()) &&
              previewFile?.content &&
              previewFile.content.trim() &&
              previewFile?.path
            ) {
              const previewFilePathNormalized = normalizePathForComparison(
                previewFile.path
              );
              if (
                previewFilePathNormalized === updatePathNormalized ||
                previewFilePathNormalized === normalizedPathNormalized ||
                previewFilePathNormalized.endsWith(normalizedPathNormalized)
              ) {
                currentContent = previewFile.content;
                console.log(
                  '[PlanExecutor] ✅ Usando previewFile.content para aplicar cambios (length:',
                  currentContent.length,
                  ')'
                );
              }
            }

            // PRIORIDAD 3: Verificar activeFile.content
            if (
              (!currentContent || !currentContent.trim()) &&
              activeFile?.content &&
              activeFile.content.trim() &&
              activeFile?.path
            ) {
              const activeFilePathNormalized = normalizePathForComparison(
                activeFile.path
              );
              if (
                activeFilePathNormalized === updatePathNormalized ||
                activeFilePathNormalized === normalizedPathNormalized ||
                activeFilePathNormalized.endsWith(normalizedPathNormalized)
              ) {
                currentContent = activeFile.content;
                console.log(
                  '[PlanExecutor] ✅ Usando activeFile.content para aplicar cambios (length:',
                  currentContent.length,
                  ')'
                );
              }
            }

            // PRIORIDAD 4: Buscar en el explorador (fallback)
            if (
              (!currentContent || !currentContent.trim()) &&
              explorer &&
              typeof explorer === 'object'
            ) {
              if (Array.isArray(explorer)) {
                const findFileInExplorer = (
                  nodes: any[],
                  targetPath: string
                ): string | null => {
                  for (const node of nodes) {
                    const nodePathNormalized = node.path
                      ? normalizePathForComparison(node.path)
                      : '';
                    if (
                      nodePathNormalized === targetPath ||
                      nodePathNormalized.endsWith(targetPath)
                    ) {
                      return node.content || null;
                    }
                    if (node.children && Array.isArray(node.children)) {
                      const found = findFileInExplorer(
                        node.children,
                        targetPath
                      );
                      if (found !== null) return found;
                    }
                  }
                  return null;
                };
                const foundContent = findFileInExplorer(
                  explorer,
                  normalizedPathNormalized
                );
                if (foundContent) {
                  currentContent = foundContent;
                  console.log(
                    '[PlanExecutor] ✅ Usando contenido del explorador para aplicar cambios (length:',
                    currentContent.length,
                    ')'
                  );
                }
              } else {
                // Buscar en el objeto Record
                for (const [key, value] of Object.entries(
                  explorer as Record<string, string>
                )) {
                  const keyNormalized = normalizePathForComparison(key);
                  if (
                    keyNormalized === normalizedPathNormalized ||
                    keyNormalized.endsWith(normalizedPathNormalized)
                  ) {
                    currentContent = value || '';
                    if (currentContent) {
                      console.log(
                        '[PlanExecutor] ✅ Usando contenido del explorador (objeto) para aplicar cambios (length:',
                        currentContent.length,
                        ')'
                      );
                      break;
                    }
                  }
                }
              }
            }

            // Si no encontramos el contenido, usar el contenido del plan si está disponible
            if (
              !currentContent &&
              typeof update.content === 'string' &&
              update.content.length > 0
            ) {
              currentContent = update.content;
              console.log(
                '[PlanExecutor] ⚠️ Usando contenido del plan (puede estar desactualizado)'
              );
            }

            // Si aún no tenemos contenido, intentar leer del disco
            if (!currentContent || !currentContent.trim()) {
              try {
                const normalizedPath = update.path
                  .replace(/\\/g, '/')
                  .replace(/^\/+/, '');
                console.log(
                  `[PlanExecutor] 🔍 Leyendo archivo del disco: ${normalizedPath}`
                );
                const readRes = await sessionFetch('/api/read-file', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    filePath: normalizedPath,
                    projectRoot: actualProjectRoot || effectiveProjectRoot,
                  }),
                });
                if (readRes.ok) {
                  const readData = await readRes.json();
                  if (
                    readData.success &&
                    typeof readData.content === 'string'
                  ) {
                    currentContent = readData.content;
                    console.log(
                      `[PlanExecutor] ✅ Archivo leído del disco (${currentContent.length} chars): ${normalizedPath}`
                    );
                  }
                } else {
                  console.warn(
                    `[PlanExecutor] ⚠️ No se pudo leer del disco: ${normalizedPath}`,
                    await readRes.text()
                  );
                }
              } catch (readDiskError) {
                console.warn(
                  `[PlanExecutor] ⚠️ Error leyendo del disco:`,
                  readDiskError
                );
              }
            }

            if (!currentContent || !currentContent.trim()) {
              console.warn(
                `[PlanExecutor] ⚠️ No se pudo encontrar el archivo ${update.path} en ninguna fuente.`
              );
              partialErrors++;
              continue;
            }

            // Aplicar los replacements en memoria
            let correctedContent = currentContent;
            const originalLength = currentContent.length;
            const replacementsCount = Array.isArray(update.replacements)
              ? update.replacements.length
              : 0;
            console.log(
              '[PlanExecutor] 🔧 Aplicando replacements. Contenido original length:',
              originalLength
            );
            console.log(
              '[PlanExecutor] 🔧 Número de replacements:',
              replacementsCount
            );

            const replaceAtIndex = (
              text: string,
              startIndex: number,
              oldText: string,
              newText: string
            ) => {
              return (
                text.slice(0, startIndex) +
                newText +
                text.slice(startIndex + oldText.length)
              );
            };

            const replacePreferLastExact = (
              text: string,
              oldText: string,
              newText: string
            ) => {
              const firstIdx = text.indexOf(oldText);
              if (firstIdx === -1)
                return {
                  ok: false as const,
                  result: text,
                  index: -1,
                  occurrences: 0,
                };
              const lastIdx = text.lastIndexOf(oldText);
              // Contar ocurrencias (ligero, para logging/diagnóstico)
              let occurrences = 0;
              let searchFrom = 0;
              while (true) {
                const idx = text.indexOf(oldText, searchFrom);
                if (idx === -1) break;
                occurrences++;
                searchFrom = idx + Math.max(1, oldText.length);
              }
              const targetIdx = occurrences > 1 ? lastIdx : firstIdx;
              return {
                ok: true as const,
                result: replaceAtIndex(text, targetIdx, oldText, newText),
                index: targetIdx,
                occurrences,
              };
            };

            const replacePreferLastFlexible = (
              text: string,
              oldText: string,
              newText: string
            ) => {
              // Normalizar el texto de búsqueda: escapar caracteres especiales de regex y permitir cualquier espacio en blanco
              const escaped = oldText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              // Permitir cualquier cantidad de espacios, tabs o saltos de línea donde haya espacios en el original
              const pattern = escaped.replace(/\s+/g, '[\\s\\n\\r]*');
              const regexGlobal = new RegExp(pattern, 'g');
              let lastMatch: RegExpExecArray | null = null;
              let matchCount = 0;
              let m: RegExpExecArray | null;
              while ((m = regexGlobal.exec(text)) !== null) {
                matchCount++;
                lastMatch = m;
                if (m.index === regexGlobal.lastIndex) regexGlobal.lastIndex++;
              }
              if (!lastMatch)
                return {
                  ok: false as const,
                  result: text,
                  index: -1,
                  occurrences: 0,
                };

              // Intentar mantener la indentación del texto original si es posible
              let finalNewText = newText;
              const matchText = lastMatch[0];
              const matchLines = matchText.split('\n');
              const firstLineIndent = matchLines[0].match(/^\s*/)?.[0] || '';

              // Si el nuevo texto no tiene indentación pero el original sí, aplicar la indentación a cada línea del nuevo texto
              if (
                firstLineIndent &&
                !newText.startsWith(' ') &&
                !newText.startsWith('\t')
              ) {
                finalNewText = newText
                  .split('\n')
                  .map((line, i) => (i === 0 ? line : firstLineIndent + line))
                  .join('\n');
              }

              return {
                ok: true as const,
                result: replaceAtIndex(
                  text,
                  lastMatch.index,
                  matchText,
                  finalNewText
                ),
                index: lastMatch.index,
                occurrences: matchCount,
              };
            };

            let replacementsApplied = 0;
            let replacementsFailed = 0;

            if (
              Array.isArray(update.replacements) &&
              update.replacements.length > 0
            ) {
              for (let i = 0; i < update.replacements.length; i++) {
                const replacement = update.replacements[i];
                if (replacement.old && replacement.new !== undefined) {
                  const beforeReplace = correctedContent.length;

                  // Intentar reemplazo exacto primero
                  let found = correctedContent.includes(replacement.old);
                  let newContent = correctedContent;

                  if (found) {
                    // Reemplazo exacto: preferir la ÚLTIMA coincidencia si hay varias para evitar insertar en mitad del archivo
                    const r = replacePreferLastExact(
                      correctedContent,
                      replacement.old,
                      replacement.new
                    );
                    newContent = r.result;
                    replacementsApplied++;
                    console.log(
                      `[PlanExecutor] ✅ Replacement ${i + 1}/${replacementsCount}: Coincidencia exacta encontrada y reemplazada (occurrences=${r.occurrences}, index=${r.index})`
                    );
                  } else {
                    // Intentar reemplazo flexible (normalizar espacios en blanco)
                    const normalizedOld = replacement.old
                      .replace(/\s+/g, ' ')
                      .trim();
                    const normalizedContent = correctedContent.replace(
                      /\s+/g,
                      ' '
                    );

                    if (normalizedContent.includes(normalizedOld)) {
                      // Buscar el texto original con espacios normalizados pero mantener el formato original
                      // ✅ CRÍTICO: NO usar replace global (g) porque puede reemplazar múltiples zonas.
                      // Preferir la última coincidencia (similar al exacto) para evitar inserciones en mitad.
                      const r = replacePreferLastFlexible(
                        correctedContent,
                        replacement.old,
                        replacement.new
                      );
                      if (r.ok) {
                        newContent = r.result;
                        replacementsApplied++;
                        console.log(
                          `[PlanExecutor] ✅ Replacement ${i + 1}/${replacementsCount}: Coincidencia flexible encontrada (occurrences=${r.occurrences}, index=${r.index})`
                        );
                      } else {
                        replacementsFailed++;
                        console.warn(
                          `[PlanExecutor] ⚠️ Replacement ${i + 1}/${replacementsCount}: No se encontró coincidencia (ni exacta ni flexible)`
                        );
                      }
                    } else {
                      replacementsFailed++;
                      console.warn(
                        `[PlanExecutor] ⚠️ Replacement ${i + 1}/${replacementsCount}: No se encontró coincidencia`
                      );
                      // Log detallado para debugging
                      console.warn(
                        `[PlanExecutor] 🔍 DEBUG - old completo (${replacement.old.length} chars):\n${replacement.old}`
                      );
                      console.warn(
                        `[PlanExecutor] 🔍 DEBUG - Primeros 500 chars del archivo:\n${correctedContent.substring(0, 500)}`
                      );
                      console.warn(
                        `[PlanExecutor] 🔍 DEBUG - Últimos 500 chars del archivo:\n${correctedContent.substring(correctedContent.length - 500)}`
                      );
                    }
                  }

                  const afterReplace = newContent.length;
                  correctedContent = newContent;

                  console.log(
                    `[PlanExecutor] 🔧 Replacement ${i + 1}/${replacementsCount}: Length: ${beforeReplace} -> ${afterReplace}`
                  );
                  console.log(
                    `[PlanExecutor] 🔧   - old (preview): ${replacement.old.substring(0, 100)}${replacement.old.length > 100 ? '...' : ''}`
                  );
                  console.log(
                    `[PlanExecutor] 🔧   - new (preview): ${replacement.new.substring(0, 100)}${replacement.new.length > 100 ? '...' : ''}`
                  );
                }
              }
            }

            const finalLength = correctedContent.length;
            const hasChanged =
              originalLength !== finalLength ||
              currentContent !== correctedContent;
            console.log(
              '[PlanExecutor] 🔧 Contenido después de replacements. Length:',
              finalLength,
              '¿Cambió?',
              hasChanged
            );
            console.log(
              '[PlanExecutor] 🔧 Resumen: Aplicados:',
              replacementsApplied,
              'Fallidos:',
              replacementsFailed
            );

            // ✅ CRÍTICO: Si los replacements fallaron, intentar usar contenido completo o marcar para /api/correct-code
            if (!hasChanged && replacementsFailed > 0) {
              if (
                typeof update.content === 'string' &&
                update.content.length > 0
              ) {
                console.warn(
                  '[PlanExecutor] ⚠️ Los replacements no funcionaron, pero tenemos contenido completo del plan. Usando contenido completo...'
                );
                correctedContent = update.content;
                console.log(
                  '[PlanExecutor] ✅ Usando contenido completo del plan. Length:',
                  correctedContent.length
                );
                // Guardar el contenido completo
                fileUpdates.push({
                  filePath: normalizedPath,
                  content: correctedContent,
                });
                console.log(
                  '[PlanExecutor] 📝 Archivo procesado con contenido completo:',
                  normalizedPath
                );
                partialApplied++;
                continue; // Continuar con el siguiente archivo
              } else {
                // ✅ NUEVO: Si no hay contenido completo, NO guardar el contenido sin cambios
                // En su lugar, marcar este update para procesarlo con /api/correct-code más abajo
                console.warn(
                  '[PlanExecutor] ⚠️ Los replacements fallaron y no hay contenido completo. Este archivo se procesará con /api/correct-code.'
                );
                partialErrors++;
                continue; // Saltar este archivo aquí, se procesará después con /api/correct-code
              }
            }

            // Guardar el contenido corregido para sincronizar el editor (solo si se aplicaron cambios)
            if (hasChanged) {
              fileUpdates.push({
                filePath: normalizedPath,
                content: correctedContent,
              });

              console.log(
                '[PlanExecutor] 📝 Archivo procesado para actualización:',
                normalizedPath
              );
              console.log(
                '[PlanExecutor] 📝 Contenido guardado en fileUpdates (length):',
                correctedContent.length
              );
              console.log(
                '[PlanExecutor] 📝 Contenido guardado (preview):',
                correctedContent.substring(0, 200) + '...'
              );

              partialApplied++;
            } else {
              console.warn(
                '[PlanExecutor] ⚠️ Archivo no cambió después de replacements. Se procesará con /api/correct-code si es necesario.'
              );
            }
          }
        }

        // 2b) Para el resto (markers/overwrite/summary) Y updates con replacements fallidos, procesar con /api/correct-code
        // Filtrar updates que ya fueron procesados exitosamente (están en fileUpdates)
        const processedPaths = new Set(
          fileUpdates.map((fu) =>
            fu.filePath.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
          )
        );

        // Incluir updates con replacements que fallaron completamente (no están en fileUpdates)
        const replacementUpdatesFailed = replacementUpdates.filter((u: any) => {
          const normalizedPath = u.path
            .replace(/\\/g, '/')
            .replace(/^\/+/, '')
            .toLowerCase();
          return !processedPaths.has(normalizedPath);
        });

        const remainingUpdates = updates.filter((u: any) => {
          const normalizedPath = u.path
            .replace(/\\/g, '/')
            .replace(/^\/+/, '')
            .toLowerCase();
          return !processedPaths.has(normalizedPath);
        });

        // Para updates con contenido completo, agregar directamente a fileUpdates
        for (const update of remainingUpdates) {
          if (typeof update.content === 'string' && update.content.length > 0) {
            const normalizedPath = update.path
              .replace(/\\/g, '/')
              .replace(/^\/+/, '');
            fileUpdates.push({
              filePath: normalizedPath,
              content: update.content,
            });

            console.log(
              '[PlanExecutor] 📝 Archivo con contenido completo procesado:',
              normalizedPath
            );

            partialApplied++;
          }
        }

        // 2b) Aplicar updates con replacements fallidos mediante API de corrección por líneas
        if (replacementUpdatesFailed.length > 0) {
          console.log(
            '[PlanExecutor] 🔧 Procesando',
            replacementUpdatesFailed.length,
            'archivo(s) con correcciones por líneas...'
          );

          for (const failedUpdate of replacementUpdatesFailed) {
            const normalizedPath = failedUpdate.path
              .replace(/\\/g, '/')
              .replace(/^\/+/, '');

            // Obtener contenido actual del archivo
            let currentFileContent = '';
            try {
              const readRes = await sessionFetch('/api/read-file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  filePath: normalizedPath,
                  projectRoot: actualProjectRoot || effectiveProjectRoot,
                }),
              });
              if (readRes.ok) {
                const readData = await readRes.json();
                if (readData.success && typeof readData.content === 'string') {
                  currentFileContent = readData.content;
                }
              }
            } catch (readDiskError) {
              console.warn(
                `[PlanExecutor] ⚠️ Error leyendo del disco:`,
                readDiskError
              );
            }

            if (!currentFileContent || !currentFileContent.trim()) {
              console.warn(
                '[PlanExecutor] ⚠️ No se pudo obtener contenido para aplicar corrección por líneas:',
                normalizedPath
              );
              partialErrors++;
              continue;
            }

            const eol = currentFileContent.includes('\r\n') ? '\r\n' : '\n';
            const fileLines = currentFileContent.split(eol);

            // Intentar aplicar cada replacement fallido buscando líneas exactas
            let appliedReplacements = 0;
            const correctionsToApply = [];

            for (const replacement of failedUpdate.replacements || []) {
              if (!replacement.old || replacement.new === undefined) continue;

              const normalizeNewlines = (str: string) =>
                str
                  .replace(/\r\n/g, '\n')
                  .replace(/\r/g, '\n');
              const oldNormalized = normalizeNewlines(replacement.old);
              const newNormalized = normalizeNewlines(replacement.new);

              // Calcular número real de líneas (trailing newline no cuenta como línea extra)
              const oldLineCount = oldNormalized.endsWith('\n')
                ? oldNormalized.split('\n').length - 1
                : oldNormalized.split('\n').length;

              // Buscar coincidencia exacta primero
              let startLine = -1;
              let endLine = -1;
              let matchedOriginal = '';

              for (let i = 0; i < fileLines.length; i++) {
                const slice = fileLines
                  .slice(i, i + oldLineCount)
                  .join(eol);
                const sliceNormalized = slice
                  .replace(/\r\n/g, '\n')
                  .replace(/\r/g, '\n')
                  .trimEnd();
                if (sliceNormalized === oldNormalized.trimEnd()) {
                  startLine = i + 1;
                  endLine = i + oldLineCount;
                  matchedOriginal = slice;
                  break;
                }
              }

              // Si no coincide exacto, buscar flexible (ignorar espacios)
              if (startLine === -1) {
                const oldFlexible = oldNormalized.replace(/\s+/g, ' ').trim();
                for (let i = 0; i < fileLines.length; i++) {
                  const slice = fileLines
                    .slice(i, i + oldLineCount)
                    .join(eol);
                  const sliceFlexible = slice.replace(/\s+/g, ' ').trim();
                  if (sliceFlexible === oldFlexible) {
                    startLine = i + 1;
                    endLine = i + oldLineCount;
                    matchedOriginal = slice;
                    break;
                  }
                }
              }

              if (startLine !== -1 && endLine !== -1) {
                correctionsToApply.push({
                  startLine,
                  endLine,
                  originalCode: matchedOriginal,
                  correctedCode: replacement.new
                    .replace(/\\n/g, '\n')
                    .replace(/\\r\\n/g, '\r\n')
                    .replace(/\\r/g, '\r')
                    .replace(/\\t/g, '\t'),
                  description: `Replacement: ${replacement.old.substring(0, 50)}... → ${replacement.new.substring(0, 50)}...`,
                });
              } else {
                console.warn(
                  '[PlanExecutor] ⚠️ No se encontró coincidencia por líneas para replacement en:',
                  normalizedPath
                );
              }
            }

            // Aplicar correcciones de abajo hacia arriba para no desplazar líneas
            if (correctionsToApply.length > 0) {
              correctionsToApply.sort((a, b) => b.startLine - a.startLine);

              for (const correction of correctionsToApply) {
                try {
                  const applyRes = await fetch(
                    '/api/corrections/apply',
                    {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        projectRoot: actualProjectRoot || effectiveProjectRoot,
                        filePath: normalizedPath,
                        startLine: correction.startLine,
                        endLine: correction.endLine,
                        originalCode: correction.originalCode,
                        correctedCode: correction.correctedCode,
                        description: correction.description,
                      }),
                    }
                  );

                  if (applyRes.ok) {
                    appliedReplacements++;
                    console.log(
                      '[PlanExecutor] ✅ Corrección aplicada por líneas:',
                      normalizedPath,
                      `L${correction.startLine}-L${correction.endLine}`
                    );
                  } else {
                    const errData = await applyRes.json().catch(() => ({}));
                    console.warn(
                      '[PlanExecutor] ⚠️ Error aplicando corrección por líneas:',
                      normalizedPath,
                      errData.error || applyRes.statusText
                    );
                  }
                } catch (applyErr) {
                  console.warn(
                    '[PlanExecutor] ⚠️ Excepción aplicando corrección por líneas:',
                    normalizedPath,
                    applyErr
                  );
                }
              }

              if (appliedReplacements > 0) {
                partialApplied++;
                // Leer el archivo actualizado para sincronizar con el editor/explorador
                try {
                  const updatedReadRes = await sessionFetch('/api/read-file', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      filePath: normalizedPath,
                      projectRoot: actualProjectRoot || effectiveProjectRoot,
                    }),
                  });
                  if (updatedReadRes.ok) {
                    const updatedData = await updatedReadRes.json();
                    if (
                      updatedData.success &&
                      typeof updatedData.content === 'string'
                    ) {
                      const existingIndex = fileUpdates.findIndex(
                        (fu) => fu.filePath === normalizedPath
                      );
                      if (existingIndex >= 0) {
                        fileUpdates[existingIndex].content =
                          updatedData.content;
                      } else {
                        fileUpdates.push({
                          filePath: normalizedPath,
                          content: updatedData.content,
                        });
                      }
                    }
                  }
                } catch (reReadErr) {
                  console.warn(
                    '[PlanExecutor] ⚠️ No se pudo re-leer archivo actualizado:',
                    normalizedPath,
                    reReadErr
                  );
                }
              } else {
                partialErrors++;
              }
            } else {
              console.warn(
                '[PlanExecutor] ⚠️ No se pudieron calcular líneas para ningún replacement de:',
                normalizedPath
              );
              partialErrors++;
            }
          }
        }
        // Restaurar autonomía previa si la cambiamos automáticamente
        if (restoredAutonomy) {
          try {
            setAutonomyLevel(prevAutonomy);
          } catch {}
        }
      }

      // Guardar todos los archivos modificados al disco (IDE)
      const saveProjectRoot = actualProjectRoot || effectiveProjectRoot;
      let savedCount = 0;
      let saveErrors = 0;
      if (fileUpdates.length > 0 && saveProjectRoot) {
        console.log(
          '[PlanExecutor] 💾 Guardando',
          fileUpdates.length,
          'archivo(s) modificado(s) al disco...'
        );
        for (const update of fileUpdates) {
          try {
            const saveRes = await sessionFetch('/api/save-file', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                filePath: update.filePath,
                content: update.content,
                projectRoot: saveProjectRoot,
              }),
            });
            if (saveRes.ok) {
              savedCount++;
              console.log(
                '[PlanExecutor] 💾 Archivo guardado en disco:',
                update.filePath
              );
            } else {
              saveErrors++;
              const errText = await saveRes.text();
              console.error(
                '[PlanExecutor] ❌ Error guardando archivo:',
                update.filePath,
                errText
              );
            }
          } catch (saveErr) {
            saveErrors++;
            console.error(
              '[PlanExecutor] ❌ Excepción guardando archivo:',
              update.filePath,
              saveErr
            );
          }
        }
        console.log(
          `[PlanExecutor] 💾 Guardado en disco completado: ${savedCount} éxitos, ${saveErrors} errores`
        );
        setStatus(
          (prev) =>
            `${prev} | 💾 ${savedCount} archivo(s) guardado(s) en disco.`
        );

        // Para proyectos locales, también sincronizar con el preview server
        if (!isPocketBaseProject) {
          try {
            const { getPreviewServerUrl } =
              await import('@/utils/preview-server-url');
            const previewServerUrl = getPreviewServerUrl();
            console.log(
              '[PlanExecutor] 🔄 Sincronizando',
              fileUpdates.length,
              'archivo(s) con el preview server...'
            );
            let previewSaved = 0;
            let previewErrors = 0;
            for (const update of fileUpdates) {
              try {
                const previewRes = await fetch(
                  `${previewServerUrl}/api/save-local-file`,
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      filePath: update.filePath,
                      content: update.content,
                    }),
                  }
                );
                if (previewRes.ok) {
                  previewSaved++;
                  console.log(
                    '[PlanExecutor] 🔄 Archivo sincronizado con preview server:',
                    update.filePath
                  );
                } else {
                  previewErrors++;
                  console.warn(
                    '[PlanExecutor] ⚠️ Error sincronizando con preview server:',
                    update.filePath,
                    await previewRes.text()
                  );
                }
              } catch (previewErr) {
                previewErrors++;
                console.warn(
                  '[PlanExecutor] ⚠️ Excepción sincronizando con preview server:',
                  update.filePath,
                  previewErr
                );
              }
            }
            console.log(
              `[PlanExecutor] 🔄 Sincronización con preview server: ${previewSaved} éxitos, ${previewErrors} errores`
            );
            if (previewSaved > 0) {
              setStatus(
                (prev) =>
                  `${prev} | 🔄 ${previewSaved} archivo(s) sincronizado(s) con vista previa.`
              );
            }
          } catch (syncErr) {
            console.warn(
              '[PlanExecutor] ⚠️ No se pudo sincronizar con el preview server:',
              syncErr
            );
          }
        }
      }

      // Notificar al servidor de vista previa mediante callback si está disponible
      if (isPocketBaseProject && effectiveProjectId) {
        if (onNotifyPreviewServer) {
          try {
            console.log(
              '[PlanExecutor] 📡 Notificando servidor de vista previa (callback del editor)...'
            );
            await onNotifyPreviewServer(effectiveProjectId);
            setStatus((prev) => `${prev} | ✅ Vista previa notificada.`);
            if (onForcePreviewReload) {
              console.log(
                '[PlanExecutor] 🔄 Forzando recarga de vista previa en el cliente...'
              );
              onForcePreviewReload();
            }
          } catch (refreshErr) {
            console.warn(
              '[PlanExecutor] ⚠️ Error notificando servidor de vista previa (callback):',
              refreshErr
            );
            setStatus(
              (prev) =>
                `${prev} | ⚠️ Advertencia: No se pudo actualizar la vista previa automáticamente.`
            );
          }
        }
      }

      // Actualizar el estado final
      const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);
      const finalStatus = `✅ Plan finalizado en ${elapsedTime}s. Creados: ${appliedCount}, Updates: ${partialApplied}. ${saveErrors > 0 ? `⚠️ Errores al guardar: ${saveErrors}` : `💾 ${savedCount} guardados en disco.`}`;
      setStatus(finalStatus);
      setApplying(false);

      // PASO 5: Refrescar el explorador
      try {
        await onRefreshFiles();
        console.log('[PlanExecutor] ✅ Explorador refrescado');
      } catch (refreshError) {
        console.warn(
          '[PlanExecutor] ⚠️ Error refrescando explorador:',
          refreshError
        );
      }

      // PASO 6: Actualizar el editor/preview con el contenido actualizado
      // Usar directamente el contenido de fileUpdates (ya está sincronizado en disco)
      if (onFileSelect && fileUpdates.length > 0) {
        // Función auxiliar para normalizar y comparar rutas
        const normalizePathForComparison = (path: string): string => {
          return path.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
        };

        // ✅ OPTIMIZADO: Reducido delay del explorador (no es crítico, puede actualizarse en background)
        // await new Promise(resolve => setTimeout(resolve, 300)); // Removido - no es necesario esperar

        console.log(
          '[PlanExecutor] 🔍 Buscando archivos abiertos para actualizar editor/preview...'
        );
        console.log(
          '[PlanExecutor] 📊 Archivos modificados:',
          fileUpdates.length
        );
        console.log(
          '[PlanExecutor] 📂 activeFile:',
          activeFile?.path || 'ninguno'
        );
        console.log(
          '[PlanExecutor] 📂 previewFile:',
          previewFile?.path || 'ninguno'
        );

        // Buscar archivos actualizados que estén abiertos en el editor o vista previa
        for (const update of fileUpdates) {
          const normalizedPath = update.filePath
            .replace(/\\/g, '/')
            .replace(/^\/+/, '');
          const normalizedPathLower =
            normalizePathForComparison(normalizedPath);

          console.log('[PlanExecutor] 🔍 Verificando archivo:', normalizedPath);

          // Verificar si el archivo está abierto en el editor o vista previa
          const activeFilePathNormalized = activeFile?.path
            ? normalizePathForComparison(activeFile.path)
            : '';
          const previewFilePathNormalized = previewFile?.path
            ? normalizePathForComparison(previewFile.path)
            : '';

          const isFileOpenInEditor =
            activeFilePathNormalized &&
            (activeFilePathNormalized === normalizedPathLower ||
              activeFilePathNormalized.endsWith(normalizedPathLower) ||
              normalizedPathLower.endsWith(activeFilePathNormalized));

          const isFileOpenInPreview =
            previewFilePathNormalized &&
            (previewFilePathNormalized === normalizedPathLower ||
              previewFilePathNormalized.endsWith(normalizedPathLower) ||
              normalizedPathLower.endsWith(previewFilePathNormalized));

          console.log(
            '[PlanExecutor] 📊 isFileOpenInEditor:',
            isFileOpenInEditor,
            'isFileOpenInPreview:',
            isFileOpenInPreview
          );

          if (isFileOpenInEditor || isFileOpenInPreview) {
            // Usar directamente el contenido de fileUpdates (ya está sincronizado)
            const updatedContent = update.content;

            if (updatedContent && updatedContent.trim()) {
              // Determinar qué ruta usar para actualizar - usar la ruta EXACTA del archivo abierto
              let filePathToUpdate: string | null = null;
              if (isFileOpenInEditor && activeFile?.path) {
                filePathToUpdate = activeFile.path; // Usar la ruta exacta del editor
                console.log(
                  '[PlanExecutor] 📝 ✅ Archivo abierto en EDITOR, actualizando con ruta:',
                  filePathToUpdate
                );
                console.log(
                  '[PlanExecutor] 📝 Contenido a actualizar (length):',
                  updatedContent.length
                );
              } else if (isFileOpenInPreview && previewFile?.path) {
                filePathToUpdate = previewFile.path; // Usar la ruta exacta de la vista previa
                console.log(
                  '[PlanExecutor] 📝 ✅ Archivo abierto en VISTA PREVIA, actualizando con ruta:',
                  filePathToUpdate
                );
                console.log(
                  '[PlanExecutor] 📝 Contenido a actualizar (length):',
                  updatedContent.length
                );
              } else {
                // Fallback: usar la ruta del archivo actualizado
                filePathToUpdate = update.filePath;
                console.log(
                  '[PlanExecutor] 📝 ⚠️ Usando ruta del archivo actualizado (fallback):',
                  filePathToUpdate
                );
              }

              if (filePathToUpdate && updatedContent) {
                console.log('[PlanExecutor] 🔄 Llamando onFileSelect con:');
                console.log('[PlanExecutor]   - filePath:', filePathToUpdate);
                console.log(
                  '[PlanExecutor]   - content length:',
                  updatedContent.length
                );
                console.log(
                  '[PlanExecutor]   - content preview:',
                  updatedContent.substring(0, 100) + '...'
                );

                try {
                  onFileSelect(filePathToUpdate, updatedContent);
                  console.log(
                    '[PlanExecutor] ✅ onFileSelect llamado exitosamente'
                  );

                  // ✅ OPTIMIZADO: Removido delay innecesario - onFileSelect es síncrono
                  console.log('[PlanExecutor] ✅ Editor/preview actualizado');
                } catch (fileSelectError) {
                  console.error(
                    '[PlanExecutor] ❌ Error llamando onFileSelect:',
                    fileSelectError
                  );
                }
              } else {
                console.warn(
                  '[PlanExecutor] ⚠️ No se puede actualizar: filePathToUpdate o updatedContent faltante'
                );
                console.warn(
                  '[PlanExecutor]   - filePathToUpdate:',
                  filePathToUpdate
                );
                console.warn(
                  '[PlanExecutor]   - updatedContent exists:',
                  !!updatedContent
                );
              }
            } else {
              console.warn(
                '[PlanExecutor] ⚠️ Contenido vacío para:',
                normalizedPath
              );
            }
          } else {
            console.log(
              '[PlanExecutor] ℹ️ Archivo no está abierto:',
              normalizedPath
            );
          }
        }
      } else {
        if (!onFileSelect) {
          console.warn('[PlanExecutor] ⚠️ onFileSelect no está disponible');
        }
        if (fileUpdates.length === 0) {
          console.log(
            '[PlanExecutor] ℹ️ No hay archivos para actualizar en el editor'
          );
        }
      }

      // Crear backup y mensaje con botón de deshacer si hubo cambios
      if (
        isPocketBaseProject &&
        effectiveProjectId &&
        fileUpdates.length > 0 &&
        (appliedCount > 0 || partialApplied > 0)
      ) {
        try {
          // Generar messageId para asociar backup con mensaje
          const messageIdForBackup = generateUniqueId();
          console.log(
            '[PlanExecutor] 🔧 MessageId para backup:',
            messageIdForBackup
          );

          // Preparar cambios para el backup
          const backupChanges = fileUpdates.map((update) => {
            const normalizedPath = update.filePath
              .replace(/\\/g, '/')
              .replace(/^\/+/, '');
            return {
              file: update.filePath,
              filePath: normalizedPath,
              replacements: [
                {
                  old: '', // No tenemos el contenido anterior perfecto, pero guardamos referencia
                  new: update.content.substring(0, 500), // Guardar una muestra del contenido nuevo
                },
              ],
              lineCount: update.content.split('\n').length,
              fileSize: new TextEncoder().encode(update.content).length,
            };
          });

          // Crear backup
          const backupResponse = await sessionFetch('/api/file-backups/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId: effectiveProjectId,
              changes: backupChanges,
              explanation: `Plan aplicado: ${appliedCount} archivo(s) creado(s), ${partialApplied} archivo(s) actualizado(s)`,
              messageId: messageIdForBackup,
            }),
          });

          if (backupResponse.ok) {
            const backupResult = await backupResponse.json();
            console.log('[PlanExecutor] ✅ Backup creado:', backupResult);

            // Crear mensaje con hasCodeChanges para mostrar botón de deshacer
            // Incluir las instrucciones originales para identificar el cambio
            const instructionText =
              instruction.trim() || 'Sin instrucciones especificadas';
            const explanationMessage = {
              id: messageIdForBackup,
              content: `**Instrucciones:**
${instructionText}

**Resultado:**
Plan aplicado exitosamente:
- ${appliedCount} archivo(s) creado(s)
- ${partialApplied} archivo(s) actualizado(s)${
                errorCount > 0
                  ? `
- ${errorCount} error(es)`
                  : ''
              }${
                partialErrors > 0
                  ? `
- ${partialErrors} error(es) en actualizaciones`
                  : ''
              }`,
              role: 'assistant' as const,
              type: 'text' as const,
              hasCodeChanges: true,
            };

            // Agregar mensaje al chat
            if (onAddMessage) {
              onAddMessage(explanationMessage);
            }

            // Guardar mensaje en la conversación
            if (currentConversationId && onSaveMessage) {
              try {
                await onSaveMessage(currentConversationId, explanationMessage);
                console.log(
                  '[PlanExecutor] ✅ Mensaje guardado en conversación'
                );
              } catch (saveError) {
                console.warn(
                  '[PlanExecutor] ⚠️ Error guardando mensaje en conversación:',
                  saveError
                );
              }
            }
          } else {
            const errorText = await backupResponse.text();
            console.warn('[PlanExecutor] ⚠️ Error creando backup:', errorText);
          }
        } catch (backupError: any) {
          console.error(
            '[PlanExecutor] ❌ Error en proceso de backup/mensaje:',
            backupError
          );
        }
      }
    } catch (err: any) {
      setStatus(
        'Error de red aplicando plan: ' + (err?.message || 'Unknown error')
      );
      setApplying(false);
    }
  }

  const isPocketBaseProject = projectType === 'database';
  const detectedProjectTypeLabel =
    projectType === 'unknown'
      ? 'Detectando...'
      : isPocketBaseProject
        ? 'Base de datos (PocketBase)'
        : 'Local';
  const projectTypeBannerTone =
    projectType === 'unknown'
      ? 'border-border/50/60 bg-background/40'
      : isPocketBaseProject
        ? 'border-blue-500/40 bg-blue-950/30'
        : 'border-amber-500/40 bg-amber-950/30';
  const needsRestartHint =
    isPocketBaseProject && (!localProjectRoot || !localProjectRoot.trim());
  return (
    <div
      className="p-4 space-y-4 bg-background/0 text-foreground/80"
      data-zeus-id="Z-PlanExecutor-1"
    >
      <h3
        className="text-lg font-semibold bg-clip-text text-transparent bg-gradient-to-r from-green-400 to-yellow-400"
        data-zeus-id="Z-PlanExecutor-2"
      >
        Planificador Zeus IA
      </h3>

      {autoScanSummary ? (
        <div
          className="text-xs text-muted-foreground mt-1"
          data-zeus-id="Z-PlanExecutor-auto-scan-summary"
        >
          {autoScanSummary}
        </div>
      ) : null}

      <div className="grid gap-2" data-zeus-id="Z-PlanExecutor-3">
        <label
          className="text-sm text-foreground/70"
          data-zeus-id="Z-PlanExecutor-4"
        >
          Instrucciones:
        </label>
        <textarea
          className="px-3 py-2 rounded-lg bg-card/60 border border-border/50/60 text-foreground/80 placeholder-muted-foreground/80 focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-transparent"
          rows={4}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="Ej: Crea una página de Artículos e incluye una galería de imágenes con descripciones de los artículos. Incluye un botón que me dirija a la página de inicio."
          data-zeus-id="Z-PlanExecutor-5"
        />
        <span className="text-xs text-muted-foreground/80" data-zeus-id="Z-PlanExecutor-6">
          Describe qué función o componente deseas agregar al proyecto.
        </span>
      </div>

      <div className="grid gap-2" data-zeus-id="Z-PlanExecutor-7">
        <label
          className="text-sm text-foreground/70"
          data-zeus-id="Z-PlanExecutor-8"
        >
          Project Root
        </label>
        <input
          className="px-3 py-2 rounded-lg bg-card/60 border border-border/50/60 text-foreground/80 placeholder-muted-foreground/80 focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-transparent"
          value={localProjectRoot}
          onChange={(e) => setLocalProjectRoot(e.target.value)}
          placeholder="Ej: c:/ruta/a/tu/proyecto o ./"
          data-zeus-id="Z-PlanExecutor-9"
        />
        <span
          className="text-xs text-muted-foreground/80"
          data-zeus-id="Z-PlanExecutor-10"
        >
          Por defecto usa el root actual. Modifícalo si quieres planificar en
          otra ubicación.
        </span>
      </div>

      <div className="space-y-3 p-3 rounded-lg border border-border/80 bg-background/40">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-foreground/70">
            Configuración del Generador
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold text-muted-foreground/80 tracking-wider">
              Biblioteca UI
            </label>
            <select
              value={uiLibrary}
              onChange={(e) => setUiLibrary(e.target.value)}
              className="w-full h-8 px-2 text-xs rounded bg-card border border-border/50 text-foreground/70 focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="shadcn">Shadcn UI + Tailwind</option>
              <option value="tailwind">Tailwind CSS (Vanilla)</option>
              <option value="bootstrap">Bootstrap</option>
              <option value="none">Ninguna / CSS puro</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold text-muted-foreground/80 tracking-wider">
              Entregables
            </label>
            <select
              value={deliverables}
              onChange={(e) => setDeliverables(e.target.value as any)}
              className="w-full h-8 px-2 text-xs rounded bg-card border border-border/50 text-foreground/70 focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="plan_and_skeletons">Código Completo + Plan</option>
              <option value="plan">Solo Plan (Estructura)</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold text-muted-foreground/80 tracking-wider">
              Autonomía
            </label>
            <select
              value={autonomy}
              onChange={(e) => setAutonomy(e.target.value as any)}
              className="w-full h-8 px-2 text-xs rounded bg-card border border-border/50 text-foreground/70 focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="guided">Guiada (Cambios mínimos)</option>
              <option value="semi">Semi-autónoma</option>
              <option value="full">Total (Implementación completa)</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold text-muted-foreground/80 tracking-wider">
              Protección
            </label>
            <input
              value={protectedPathsText}
              onChange={(e) => setProtectedPathsText(e.target.value)}
              placeholder="Rutas a proteger (separadas por línea)"
              className="w-full h-8 px-2 text-xs rounded bg-card border border-border/50 text-foreground/70 focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3" data-zeus-id="Z-PlanExecutor-15">
        <button
          className="h-9 px-4 text-sm rounded-lg border border-yellow-500/50 bg-gradient-to-r from-gray-800/80 to-gray-700/80 text-foreground/80 hover:text-foreground hover:from-gray-700/90 hover:to-gray-600/90 shadow-[0_0_12px_rgba(234,179,8,0.2)] hover:shadow-[0_0_16px_rgba(234,179,8,0.4)] transition-all"
          onClick={async () => {
            try {
              if (!autoScanFixImports) {
                setAutoScanPlaceholderPaths([]);
                await planScaffold();
                return;
              }
              setStatus('Escaneando imports...');
              const { instructionText, summaryText, placeholderList } =
                buildAutoFixImportsInstruction(explorer);
              setAutoScanSummary(summaryText);
              setAutoScanPlaceholderPaths(
                Array.isArray(placeholderList) ? placeholderList : []
              );
              setInstruction(instructionText);
              setPlan(null);
              await planScaffold(instructionText);
            } catch (e: any) {
              console.error('[PlanExecutor] Error auto-scan:', e);
              setStatus('Error en escaneo: ' + (e?.message || String(e)));
            }
          }}
          data-zeus-id="Z-PlanExecutor-16"
        >
          Planificar
        </button>
        <button
          className={`h-9 px-4 text-sm rounded-lg border transition-all ${!plan || applying ? 'border-border/50/60 bg-card/60 text-muted-foreground/80 cursor-not-allowed' : 'border-green-500/50 bg-gradient-to-r from-gray-800/80 to-gray-700/80 text-foreground/80 hover:text-foreground hover:from-gray-700/90 hover:to-gray-600/90 shadow-[0_0_12px_rgba(34,197,94,0.2)] hover:shadow-[0_0_16px_rgba(34,197,94,0.4)]'}`}
          onClick={applyPlan}
          disabled={!plan || applying}
          data-zeus-id="Z-PlanExecutor-17"
        >
          {applying ? 'Aplicando...' : 'Aplicar'}
        </button>
      </div>

      <div
        className="text-sm text-muted-foreground min-h-[1.25rem]"
        data-zeus-id="Z-PlanExecutor-18"
      >
        {status}
      </div>

      {/* Two-step suggestion removed */}

      {(() => {
        console.log(
          '[PlanExecutor] RENDER plan block, plan exists:',
          !!plan,
          'actions count:',
          plan?.actions?.length
        );
        return null;
      })()}

      {plan && (
        <div
          className="mt-1 border border-border/80 rounded-lg p-3 text-sm bg-background/40"
          data-zeus-id="Z-PlanExecutor-19"
        >
          <div
            className="font-medium mb-2 text-foreground/70"
            data-zeus-id="Z-PlanExecutor-20"
          >
            Plan
          </div>
          {plan.actions.length === 0 ? (
            <div className="text-muted-foreground" data-zeus-id="Z-PlanExecutor-21">
              Sin acciones. Proporciona un Hint Path para el MVP o conecta el
              LLM.
            </div>
          ) : (
            <ul
              className="list-disc pl-5 space-y-1 text-foreground/70"
              data-zeus-id="Z-PlanExecutor-22"
            >
              {plan.actions.map((a, i) => (
                <li key={i} data-zeus-id="Z-PlanExecutor-23">
                  <code
                    className="text-yellow-300/90"
                    data-zeus-id="Z-PlanExecutor-24"
                  >
                    {a.type}
                  </code>{' '}
                  <span
                    className="text-muted-foreground"
                    data-zeus-id="Z-PlanExecutor-25"
                  >
                    →
                  </span>{' '}
                  <code
                    className="text-green-300/90"
                    data-zeus-id="Z-PlanExecutor-26"
                  >
                    {a.path}
                  </code>{' '}
                  {a.purpose ? (
                    <span
                      className="text-muted-foreground"
                      data-zeus-id="Z-PlanExecutor-27"
                    >
                      - {a.purpose}
                    </span>
                  ) : (
                    ''
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
