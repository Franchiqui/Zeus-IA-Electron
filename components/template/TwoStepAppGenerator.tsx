'use client';

import React, { useState, useCallback, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { getPocketBase } from '@/lib/pocketbase';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Wand2, CheckCircle, Clock, Download, ExternalLink, FileText, Folder, AlertCircle, RefreshCw, Info, Upload, X, ImageIcon, Smartphone, Globe, Monitor, Copy, ChevronDown, ChevronLeft, ChevronRight, Save, Plus, Trash2, Play } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Progress } from '../ui/progress';
import { Alert, AlertDescription } from '../ui/alert';
import { useModel } from '@/hooks/use-model';
import { useAuth } from '@/context/AuthContext';
import { useProject } from '@/context/ProjectContext';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useStore } from '@/lib/store';
import { MODELOS_COLLECTION_NAME, MODELOS_FIELDS, type ModeloRecord } from '@/lib/collections';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { slugify } from '../../lib/utils';
import { generatePbSchema } from '@/lib/generatePbSchema';
import { searchImages, type ImageResult } from '@/services/images';
import JSZip from 'jszip';
import { useTranslation } from '../../contexts/translation-context';
import { sessionFetch } from '@/lib/projectStore';

async function obtenerContenidoTemplate(nombreTemplate: string, path?: string, id?: string): Promise<string> {
  let url = `/api/code_template/${encodeURIComponent(nombreTemplate)}`;

  // Si se proporciona una ruta, añadirla como parámetro de consulta
  const params = new URLSearchParams();
  if (path) {
    params.append('path', path);
  }
  if (id) {
    params.append('id', id);
  }
  if (params.toString()) {
    url += `?${params.toString()}`;
  }
  console.log(`[Template] Solicitando contenido para: "${nombreTemplate}" desde ${url}`);
  try {
    const response = await fetch(url);
    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[Template] Error en la respuesta de la API (status ${response.status}):`, errorBody);
      throw new Error(`Error ${response.status} ${response.statusText}: ${errorBody}`);
    }

    // Check if response is JSON or plain text
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const data = await response.json();
      // Handle both code_templates and templates_floating_chat response formats
      if (data.contenido !== undefined) {
        return data.contenido;
      } else if (data.content !== undefined) {
        return data.content;
      } else {
        console.warn(`[Template] La respuesta para "${nombreTemplate}" no contiene la propiedad "contenido" o "content".`, data);
        return '';
      }
    } else {
      // If it's not JSON, it's the direct content
      return await response.text();
    }
  } catch (error) {
    console.error(`[Template] Fallo crítico al obtener el template "${nombreTemplate}":`, error);
    // Devolver una cadena vacía para no bloquear el resto del proceso
    return '';
  }
}

// Remove the top-level await calls and initialize with default content
let pageContent = '// Contenido de página por defecto\nexport default function Page() {\n  return <div>Hello World</div>;\n}';

// Create an initialization function to load the template content
const initializeTemplateContent = async () => {
  try {
    // pageContent will remain as the default content
    console.log('[Template] inicialización completada (sin pre-carga de PB_Datos)');
  } catch (error) {
    console.error(`[Template] Fallo en la inicialización:`, error);
  }
};

// Call the initialization function
//initializeTemplateContent();

interface FileStructure {
  name: string;
  type: 'file' | 'directory';
  path: string;
  content?: string;
  children?: FileStructure[];
}
interface ProjectStructure {
  structure: FileStructure[];
  stats: {
    totalFiles: number;
    totalDirectories: number;
    configFiles: number;
  };
  metadata: {
    appName: string;
    template: string;
    complexity: string;
    features: string[];
    description: string;
    generatedAt: string;
    additionalPages?: { route: string; purpose: string }[];
  };
}
interface FileProgress {
  filePath: string;
  status: 'pending' | 'generating' | 'completed' | 'error';
  content?: string;
  progress?: number;
  error?: string;
  linesGenerated?: number;
}
interface TwoStepAppGeneratorProps {
  onComplete?: (files: Record<string, string>) => void;
  onNavigateToResults?: () => void;
  onStructureGenerated?: (structure: ProjectStructure) => void;
  onStepChange?: (step: 'form' | 'structure' | 'content' | 'complete') => void;
  projectId?: string | null;
  projectRoot?: string;
  appType?: string;
  initialTemplateId?: string;
  initialAppName?: string;
  initialDescription?: string;
  isUploadingToPreview?: boolean;
  isStartingPreview?: boolean;
  previewUrl?: string | null;
  previewServerStarted?: boolean;
  isPostProcessing?: boolean;
  setPreviewUrl?: React.Dispatch<React.SetStateAction<string | null>>;
  setIsUploadingToPreview?: React.Dispatch<React.SetStateAction<boolean>>;
  setIsStartingPreview?: React.Dispatch<React.SetStateAction<boolean>>;
  setPreviewServerStarted?: React.Dispatch<React.SetStateAction<boolean>>;
  setIsPostProcessing?: React.Dispatch<React.SetStateAction<boolean>>;
  /** Archivo seleccionado en la vista previa; "Corregir archivo" corregirá este. Si no se pasa, se usa app/page.tsx. */
  previewSelectedFilePath?: string | null;
  /** Se llama cuando un archivo se corrige con éxito; permite al padre actualizar su vista previa. */
  onFileCorrected?: (filePath: string, content: string) => void;
  /** Se llama cuando la lista de archivos completados cambia (ej. al generar componentes); permite actualizar la lista en tiempo real. */
  onCompletedFilesChange?: (files: Record<string, string>) => void;
  /** Modelo seleccionado desde la barra de navegación (opcional; si no se pasa se usa useModel). */
  selectedModel?: any;
}
export interface TwoStepAppGeneratorRef {
  uploadToPreviewServer: (files: Record<string, string>, appName: string, template: string) => Promise<string | null>;
  getFormData: () => any;
  getCompletedFiles: () => Record<string, string>;
  goToFormStep: () => void;
  runFixMissingImports: () => Promise<void>;
  runFixMissingImportsAndValidate: () => Promise<void>;
  runPostCorrectPage: (filePath?: string, content?: string) => Promise<{ filePath: string; content: string } | null>;
  runValidateComponents: () => Promise<void>;
  getValidationSuggestions: () => any;
}
const injectZeusImportsIntoLayout = (content: string, filePath: string): string => {
  if (!content) return content;
  const isLayout =
    filePath.endsWith('/layout.tsx') ||
    filePath.endsWith('/layout.jsx') ||
    filePath.endsWith('/_app.tsx') ||
    filePath.endsWith('/_app.jsx');
  if (!isLayout) return content;

  let modified = content;

  // Asegurar 'use client' para poder importar scripts client-side (zeus-icons.js y ComponentSelectorHelper)
  const hasUseClient = /^\s*['"]use client['"]/.test(modified);
  if (!hasUseClient) {
    modified = `'use client';\n\n${modified}`;
  }
  // Quitar metadata exports si existen (incompatibles con 'use client' en Next.js App Router)
  modified = modified.replace(/(^|\n)export\s+const\s+metadata\s*=\s*\{[\s\S]*?\};\s*/m, '$1');
  modified = modified.replace(/(^|\n)export\s+(?:async\s+)?function\s+generateMetadata\s*\([\s\S]*?\n\}\s*/m, '$1');
  if (!/\bMetadata\b/.test(modified)) {
    modified = modified.replace(/^\s*import\s+type\s*\{\s*Metadata\s*\}\s*from\s*['"]next['"];\s*\n/m, '');
  }

  const pathParts = filePath.split('/').filter(Boolean);
  const depth = pathParts.length - 1;
  let relativePrefix = './';
  if (depth === 1) relativePrefix = '../';
  else if (depth >= 2) relativePrefix = '../../';

  const addImport = (importLine: string, check: string) => {
    if (modified.includes(check)) return;
    const lines = modified.split('\n');
    let insertIdx = 0;
    let lastImportIdx = -1;
    let useClientIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('import ')) lastImportIdx = i;
      if (trimmed.startsWith('use client') || trimmed.startsWith('"use client"')) useClientIdx = i;
    }
    if (lastImportIdx !== -1) insertIdx = lastImportIdx + 1;
    else if (useClientIdx !== -1) insertIdx = useClientIdx + 1;
    lines.splice(insertIdx, 0, importLine);
    modified = lines.join('\n');
  };

  addImport(`import '${relativePrefix}zeus-icons.js';`, 'zeus-icons.js');
  addImport(`import '${relativePrefix}zeus-styles.css';`, 'zeus-styles.css');
  addImport(`import { ComponentSelectorHelper } from '@/components/component-selector-helper';`, 'component-selector-helper');

  if (!modified.includes('<ComponentSelectorHelper')) {
    const lines = modified.split('\n');
    let childrenIdx = -1;
    let childrenIndent = '';
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*\{children\}/.test(lines[i])) {
        childrenIdx = i;
        childrenIndent = lines[i].match(/^(\s*)/)?.[1] || '';
        break;
      }
    }
    if (childrenIdx !== -1) {
      lines.splice(childrenIdx, 0, `${childrenIndent}<ComponentSelectorHelper />`);
      modified = lines.join('\n');
    } else {
      modified = modified.replace(/(<body[^>]*>)/, '$1\n      <ComponentSelectorHelper />');
    }
  }

  return modified;
};

const correctAndFinalizeContent = (content: string, filePath: string): string => {
  let correctedContent = content;
  if (
    filePath === 'app/page.tsx' ||
    filePath.endsWith('/app/page.tsx') ||
    filePath === 'app/layout.tsx' ||
    filePath.endsWith('/app/layout.tsx')
  ) {
    correctedContent = correctedContent.replace(/(^|\n)export\s+const\s+metadata\s*=\s*\{[\s\S]*?\};\s*/m, '$1');
    correctedContent = correctedContent.replace(/(^|\n)export\s+(?:async\s+)?function\s+generateMetadata\s*\([\s\S]*?\n\}\s*/m, '$1');
    if (!/\bMetadata\b/.test(correctedContent)) {
      correctedContent = correctedContent.replace(/^\s*import\s+type\s+\{\s*Metadata\s*\}\s+from\s+['"]next['"];\s*\n/m, '');
    }
  }
  const hasMetadataExport = /(export\s+const\s+metadata\b|export\s+(?:async\s+)?function\s+generateMetadata\b)/.test(correctedContent);

  // 1. Add 'use client' for .tsx and .jsx files if not present, and it's not a layout/page with metadata export
  if ((filePath.endsWith('.tsx') || filePath.endsWith('.jsx')) && !correctedContent.trim().startsWith('use client') && !correctedContent.trim().startsWith("\"use client\"") && !hasMetadataExport) {
    correctedContent = `'use client';

${correctedContent}`;
  }

  // 2. Attempt to fix basic syntax truncation by balancing brackets
  const openBraces = (correctedContent.match(/{/g) || []).length;
  const closeBraces = (correctedContent.match(/}/g) || []).length;
  if (openBraces > closeBraces) {
    correctedContent += '}'.repeat(openBraces - closeBraces);
  }
  const openParens = (correctedContent.match(/\(/g) || []).length;
  const closeParens = (correctedContent.match(/\)/g) || []).length;
  if (openParens > closeParens) {
    correctedContent += ')'.repeat(openParens - closeParens);
  }
  const openBrackets = (correctedContent.match(/\[/g) || []).length;
  const closeBrackets = (correctedContent.match(/\]/g) || []).length;
  if (openBrackets > closeBrackets) {
    correctedContent += ']'.repeat(openBrackets - closeBrackets);
  }

  return injectZeusImportsIntoLayout(correctedContent, filePath);
};
const TwoStepAppGenerator = forwardRef<TwoStepAppGeneratorRef, TwoStepAppGeneratorProps>(({
  onComplete,
  onNavigateToResults,
  onStructureGenerated,
  onStepChange,
  projectId,
  projectRoot: propProjectRoot,
  appType,
  initialTemplateId,
  initialAppName,
  initialDescription,
  isUploadingToPreview: propIsUploadingToPreview,
  isStartingPreview: propIsStartingPreview,
  previewUrl: propPreviewUrl,
  previewServerStarted: propPreviewServerStarted,
  isPostProcessing: propIsPostProcessing,
  setPreviewUrl: setPropPreviewUrl,
  setIsUploadingToPreview: setPropIsUploadingToPreview,
  setIsStartingPreview: setPropIsStartingPreview,
  setPreviewServerStarted: setPropPreviewServerStarted,
  setIsPostProcessing: setPropIsPostProcessing,
  previewSelectedFilePath: propPreviewSelectedFilePath,
  onFileCorrected: propOnFileCorrected,
  onCompletedFilesChange: propOnCompletedFilesChange,
  selectedModel: propSelectedModel
}, ref) => {
  const {
    projectRoot: contextProjectRoot,
    projectId: contextProjectId,
    setProjectId: setCtxProjectId,
    setProjectRoot: setCtxProjectRoot
  } = useProject();
  const { user } = useAuth();
  const { t } = useTranslation();
  const projectRoot = propProjectRoot || contextProjectRoot;
  // Mapeo de IDs externos (StarterTemplates) a IDs internos del selector
  const normalizeTemplateId = useCallback((id?: string): string => {
    if (!id) return 'next-js';
    const map: Record<string, string> = {
      // coincidencias directas
      'next-js': 'next-js',
      'astro': 'astro',
      'svelte-kit': 'svelte-kit',
      'angular': 'angular',
      'vite-react': 'vite-react',
      // equivalencias
      'vite-shadcn': 'vite-react',
      'vue-js': 'vue-nuxt',
      'expo-app': 'react-native',
      'remix-ts': 'next-js',
      'qwik-ts': 'html-css-js',
      'slidev': 'html-css-js',
      'vanilla-vite': 'html-css-js',
      'vite-ts': 'html-css-js'
    };
    return map[id] || (['next-js', 'vite-react', 'vue-nuxt', 'svelte-kit', 'angular', 'html-css-js', 'astro', 'eleventy', 'react-native', 'flutter', 'swift-ui', 'kotlin-compose'].includes(id) ? id : 'next-js');
  }, []);

  // Función para resolver contenido de template en archivos predefinidos
  const resolverContenidoTemplate = useCallback(async (content: string): Promise<string> => {
    // Si el contenido contiene llamadas a obtenerContenidoTemplate, ejecutarlas
    if (content && content.includes('await obtenerContenidoTemplate(')) {
      try {
        // Extraer el nombre del template de la llamada y opcionalmente la ruta e ID
        const match = content.match(/await\s+obtenerContenidoTemplate\(['"]([^"']+)["'](?:\s*,\s*['"]([^"']+)["'])?(?:\s*,\s*['"]([^"']+)["'])?\)/);
        if (match && match[1]) {
          const templateName = match[1];
          const path = match[2]; // path es opcional
          const id = match[3]; // id es opcional

          // Handle specific IDs for known files
          let finalId = id;
          if (!id) {
            // Map specific paths to their corresponding IDs
            if (path === '/PB_Datos/app/page.tsx') {
              finalId = 'l5p18oio8dyhium';
            } else if (path === '/PB_Datos/app/database/page.tsx') {
              finalId = '9xhe40kd2chj9u9';
            } else if (path === '/PB_Datos/app/edit/page.tsx') {
              finalId = '0ros0eck5g4qpmi';
            } else if (path === '/PB_Datos/app/api/collections/route.ts') {
              finalId = '914jcm1dlbol74b';
            } else if (path === '/PB_Datos/app/api/collections/[collectionId]/route.ts') {
              finalId = 'gyzja5doz1yb8be';
            } else if (path === '/PB_Datos/app/api/collections/[collectionId]/fields/route.ts') {
              finalId = 'sqr8cf2x0e5gme6';
            } else if (path === '/PB_Datos/app/api/collections/[collectionId]/fields/[fieldId]/route.ts') {
              finalId = 'uf5hicfxidwemso';
            } else if (path === '/PB_Datos/app/api/collections/[collectionId]/records/route.ts') {
              finalId = '0c3noustscjj6if';
            } else if (path === '/PB_Datos/app/api/collections/[collectionId]/records/[recordId]/route.ts') {
              finalId = 'vqr6zjh1tru4i7r';
            } else if (path === '/PB_Datos/app/auth/login/page.tsx') {
              finalId = '58n018ads05wohn';
            } else if (path === '/PB_Datos/app/auth/register/page.tsx') {
              finalId = 'ztagtmvi0k4xl52';
            } else if (path === '/PB_Datos/app/components/Navbar.tsx') {
              finalId = 'zfmjk0e8kmtq9px';
            } else if (path === '/PB_Datos/components/ui/button.tsx') {
              finalId = '4s71w2h9400iqiu';
            } else if (path === '/PB_Datos/components/ui/image-preview.tsx') {
              finalId = 'ht5182xd5kzlejl';
            } else if (path === '/PB_Datos/components/ui/toast.tsx') {
              finalId = 'tr45k7d4k9hjduu';
            } else if (path === '/PB_Datos/components/ui/toaster.tsx') {
              finalId = 't9bh0gef2z1xzyd';
            } else if (path === '/PB_Datos/components/error-boundary.tsx') {
              finalId = 'klawr706gwbxk46';
            } else if (path === '/PB_Datos/components/navbar.tsx') {
              finalId = 'g8t91ibdzco5sp7';
            } else if (path === '/PB_Datos/components/Providers.tsx') {
              finalId = 'n26lubq6shlcpsw';
            } else if (path === '/PB_Datos/app/globals.css') {
              finalId = 'f39expveujrh0rq';
            } else if (path === '/PB_Datos/app/layout.tsx') {
              finalId = 'kph254vz2lpj41z';
            } else if (path === '/PB_Datos/components/theme-provider.tsx') {
              finalId = '11q0t3g6pz414do';
            } else if (path === '/PB_Datos/hooks/use-theme.ts') {
              finalId = '7o9t6yay8flp91d';
            } else if (path === '/PB_Datos/hooks/use-toast.ts') {
              finalId = 'wephfapgp7b68uf';
            } else if (path === '/PB_Datos/lib/store/image-editor-store.ts') {
              finalId = 'wephfapgp7b68uf';
            } else if (path === '/PB_Datos/lib/constants.ts') {
              finalId = 'w8khm0h5lk1r5hf';
            } else if (path === '/PB_Datos/lib/utils.ts') {
              finalId = '9n6rawglo4zmexd';
            } else if (path === '/PB_Datos/lib/validations.ts') {
              finalId = 'hgfjsrp8o2zcazo';
            } else if (path === '/PB_Datos/types/index.ts') {
              finalId = 'z3l2yj4jvc2mns9';
            } else if (path === '/PB_Datos/proxy.ts') {
              finalId = '5a7a86l8ymb83rx';
            } else if (path === '/FloatingChat/Chat/AuthForm.tsx') {
              finalId = 'lmjidhghewkxdsx';
            } else if (path === '/FloatingChat/Chat/ChatWindow.tsx') {
              finalId = 'kziw4j9a5ol4pa8';
            } else if (path === '/FloatingChat/Chat/ConnectedUsers.tsx') {
              finalId = 'psa1yns87dhrbtr';
            } else if (path === '/FloatingChat/Chat/index.tsx') {
              finalId = 'hhe1yuhfqoj45fi';
            } else if (path === '/FloatingChat/Chat/LanguageContext.tsx') {
              finalId = 'kpzfmziemmres7x';
            } else if (path === '/FloatingChat/Chat/LanguageSelector.tsx') {
              finalId = 'j03b9li4rvrl9lb';
            } else if (path === '/FloatingChat/Chat/MessageInput.tsx') {
              finalId = 'me0w28wirq1nttj';
            } else if (path === '/FloatingChat/Chat/MessageList.tsx') {
              finalId = '52rhxpta20gdvgx';
            } else if (path === '/FloatingChat/Chat/PocketBaseContext.tsx') {
              finalId = 'p5ts8nsvjz0kyzo';
            } else if (path === '/FloatingChat/lib/i18n.ts') {
              finalId = 'aqsbn3ildi41t5q';
            } else if (path === '/FloatingChat/lib/utils.ts') {
              finalId = '9cp0wlpxwf4lrq0';
            } else if (path === '/FloatingChat/ui/button.tsx') {
              finalId = 'zcwk0p2w6mql061';
            } else if (path === '/FloatingChat/ui/input.tsx') {
              finalId = 'z5cjcvf3whd2lf8';
            } else if (path === '/FloatingChat/theme-provider.tsx') {
              finalId = '5hxfrqq4m937y88';
            } else if (path === '/FloatingChat/theme-toggle.tsx') {
              finalId = 'nojabahzzfs3q2q';
            } else if (path === '/FloatingChat/ui/dropdown-menu.tsx') {
              finalId = 'fir6f0ybkajn4p4';
            } else if (path === '/FloatingChat/ui/label.tsx') {
              finalId = 'jd6jib2pqnj7mlu';
            } else if (path === '/FloatingChat/ui/scroll-area.tsx') {
              finalId = 'tzrkvzcu3i0giup';
            } else if (path === '/FloatingChat/Chat/ChatSizeContext.tsx') {
              finalId = 'ey9l0udx3v1yx6o';
            } else if (path === '/FloatingChat/Chat/ProfileSettings.tsx') {
              finalId = '9v744gu9hj81r0t';
            } else if (path === '/PB_Datos/next.config.js') {
              finalId = 'ktjh67rg9crtnma';
            } else if (path === '/PB_Datos/components/ui/settings-modal.tsx') {
              finalId = '47j6vukcfzslev4';
            } else if (path === '/PB_Datos/lib/pocketbase.ts') {
              finalId = 'glefr3ar4ww11rx';
            } else if (path === '/FloatingChat/chat.css') {
              finalId = 'kvdy9gaa2ic5r44';
            }
          }
          console.log(`Resolviendo contenido de template: ${templateName}${path ? ` con ruta: ${path}` : ''}${finalId ? ` con ID: ${finalId}` : ''}`);
          return await obtenerContenidoTemplate(templateName, path, finalId);
        }
      } catch (error) {
        console.error('Error resolviendo contenido de template:', error);
        return content; // Devolver el contenido original si hay error
      }
    }
    return content;
  }, []);
  const [step, setStep] = useState<'form' | 'structure' | 'content' | 'complete'>('form');
  const [completeStepSelectedFile, setCompleteStepSelectedFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [enhancingDescription, setEnhancingDescription] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiAutoGenerating, setApiAutoGenerating] = useState(false);
  const [apiAutoGenStatus, setApiAutoGenStatus] = useState<string | null>(null);
  const [autoGeneratedApiData, setAutoGeneratedApiData] = useState<any | null>(null);
  const autoGeneratedApiDataRef = useRef<any>(null);

  useEffect(() => {
    if (onStepChange) onStepChange(step);
  }, [onStepChange, step]);

  // Form state
  const [formData, setFormData] = useState<{
    appName: string;
    template: string;
    appType?: string;
    complexity: 'simple' | 'standard' | 'complex';
    features: string[];
    description: string;
    preferredOS?: 'windows' | 'macos' | 'linux';
    customPages: { name: string; description: string }[];
  }>({
    appName: initialAppName || '',
    template: normalizeTemplateId(initialTemplateId) || 'next-js',
    appType: undefined,
    // se ajustará en useEffect según template
    complexity: 'complex',
    features: [],
    description: initialDescription || '',
    preferredOS: undefined,
    customPages: []
  });

  // Ajustar appType respetando la prop appType si viene definida
  useEffect(() => {
    if (initialTemplateId) {
      const normalized = normalizeTemplateId(initialTemplateId);
      const mobileTemplates = ['react-native', 'flutter', 'swift-ui', 'kotlin-compose'];
      const staticTemplates = ['vite-react', 'html-css-js', 'astro', 'eleventy'];
      let inferredAppType: 'mobile-app' | 'web-app' | 'desktop-app' | undefined;
      if (mobileTemplates.includes(normalized)) {
        inferredAppType = 'mobile-app';
      } else if (appType === 'desktop-app') {
        inferredAppType = 'desktop-app';
      } else if (staticTemplates.includes(normalized)) {
        inferredAppType = undefined; // Página Web (estática/SPA)
      } else {
        // Para next-js, si NO viene appType por props, por defecto tratamos como Página Web (undefined)
        // Esto permite que la tarjeta "Page Web" funcione correctamente sin appType
        inferredAppType = normalized === 'next-js' && typeof appType === 'undefined' ? undefined : 'web-app';
      }
      setFormData(prev => ({
        ...prev,
        template: normalized,
        appType: typeof appType !== 'undefined' ? appType : inferredAppType
      }));
      console.log('[TwoStepAppGenerator] init template/appType:', {
        normalized,
        propAppType: appType,
        finalAppType: typeof appType !== 'undefined' ? appType : inferredAppType
      });
    } else if (!formData.appType) {
      // Si no hay plantilla inicial, asegurar un valor por defecto consistente
      setFormData(prev => ({
        ...prev,
        appType: appType || 'web-app'
      }));
    }
    // Solo en montaje o cuando cambien las props iniciales
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTemplateId, normalizeTemplateId, appType]);
  const enhanceDescription = async () => {
    if (!formData.description.trim()) return;
    setEnhancingDescription(true);
    try {
      // Get PocketBase instance
      const pb = getPocketBase();
      const token = (await pb).authStore.token;
      if (!token) {
        throw new Error(t('authTokenNotFound'));
      }
      console.log('Using PocketBase auth token');
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      };
      console.log('Sending request to /api/generate-prompt with headers:', headers);
      const requestBody = {
        userDescription: formData.description,
        modelId: selectedModel?.id || ''
      };
      console.log('Request body:', requestBody);
      const response = await fetch('/api/generate-prompt', {
        method: 'POST',
        headers,
        credentials: 'include',
        // Include cookies in the request
        body: JSON.stringify(requestBody)
      });
      console.log('Response status:', response.status);
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Error response:', errorText);
        throw new Error(`${t('errorEnhancingDesc')} ${response.status} ${response.statusText}`);
      }
      const data = await response.json();
      console.log('API Response:', data);
      if (data.sophisticatedPrompt) {
        setFormData(prev => ({
          ...prev,
          description: data.sophisticatedPrompt
        }));
      } else {
        throw new Error(t('enhanceDescError'));
      }
    } catch (error) {
      console.error('Error al mejorar la descripción:', error);
      setError(t('enhanceDescError'));
    } finally {
      setEnhancingDescription(false);
    }
  };

  // File upload state
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [uploadedImages, setUploadedImages] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const uploadToPreviewServerRef = useRef<((files: Record<string, string>, appName: string, template: string) => Promise<string | null>) | null>(null);

  // Suggested images (from Unsplash via /api/images)
  const [suggestedImages, setSuggestedImages] = useState<ImageResult[]>([]);
  const [loadingSuggestedImages, setLoadingSuggestedImages] = useState(false);
  const [customImageQuery, setCustomImageQuery] = useState('');
  const [isSearchingCustom, setIsSearchingCustom] = useState(false);
  const [imageLimit, setImageLimit] = useState<number>(12);
  const [selectedImage, setSelectedImage] = useState<ImageResult | null>(null);
  const [selectedImageUrls, setSelectedImageUrls] = useState<string[]>([]);

  // Obtener toast ANTES de usarlo en copyImageUrl para evitar problemas de inicialización
  const { toast } = useToast();

  // Función helper para limpiar URLs (no usar useCallback para evitar problemas de inicialización)
  const cleanImageUrl = (url: string): string => {
    try {
      // Para URLs de Unsplash, quitar todos los parámetros de query
      const urlObj = new URL(url);
      if (urlObj.hostname === 'images.unsplash.com') {
        return `${urlObj.protocol}//${urlObj.hostname}${urlObj.pathname}`;
      }
      return url;
    } catch {
      return url;
    }
  };

  const handleImageSelection = (img: ImageResult) => {
    const regularUrl = cleanImageUrl(img.urls.regular || '');
    setSelectedImageUrls(prevUrls => {
      if (prevUrls.includes(regularUrl)) {
        // Si se deselecciona, también limpiar selectedImage si es la misma
        setSelectedImage((prev: ImageResult | null) => {
          if (prev) {
            const prevUrl = cleanImageUrl(prev.urls.regular || '');
            if (prevUrl === regularUrl) {
              return null;
            }
          }
          return prev;
        });
        return prevUrls.filter(url => url !== regularUrl);
      } else {
        // Si se selecciona, actualizar selectedImage
        setSelectedImage(img);
        return [...prevUrls, regularUrl];
      }
    });
  };

  const copyImageUrl = useCallback(async (url: string) => {
    try {
      const cleanUrl = cleanImageUrl(url);
      await navigator.clipboard.writeText(cleanUrl);
      toast({
        title: t('copyImageUrl'),
        description: t('copyImageUrlDesc'),
        variant: 'default'
      });
    } catch (e) {
      // Fallback para navegadores antiguos
      const textArea = document.createElement('textarea');
      textArea.value = cleanImageUrl(url);
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      document.execCommand('copy');
      textArea.remove();
      toast({
        title: t('copyImageUrl'),
        description: t('copyImageUrlDesc'),
        variant: 'default'
      });
    }
  }, [toast]);

  useEffect(() => {
    let active = true;
    const desc = formData.description?.trim();
    if (!desc) {
      if (active) setSuggestedImages([]);
      if (active) setLoadingSuggestedImages(false);
      return;
    }
    let timer: NodeJS.Timeout;

    const load = async () => {
      try {
        if (active) setLoadingSuggestedImages(true);

        // Use the user's description directly as the query for more relevant images
        const query = desc.length > 100 ? desc.slice(0, 100) : desc;

        let results = await searchImages({
          query: query,
          limit: imageLimit,
          orientation: 'landscape'
        });

        // If no results or very few results, try with a broader search using key terms
        if (!results || results.length < Math.min(3, imageLimit)) {
          const keyTerms = desc.split(/\s+/).slice(0, 3).join(' ');
          const fallback = await searchImages({
            query: keyTerms,
            limit: imageLimit,
            orientation: 'landscape'
          });

          // Merge results and remove duplicates
          const map = new Map<string, ImageResult>();
          for (const r of [...(results || []), ...(fallback || [])]) {
            if (r?.id) map.set(r.id, r);
          }
          results = Array.from(map.values());
        }

        if (active) setSuggestedImages(results || []);
      } catch (error) {
        console.warn('Error loading suggested images:', error);
        if (active) setSuggestedImages([]);
      } finally {
        if (active) setLoadingSuggestedImages(false);
      }
    };

    timer = setTimeout(load, 500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [formData.description, imageLimit]);

  const addSuggestedImage = useCallback(async (img: ImageResult) => {
    try {
      const url = img.urls.small || img.urls.regular || img.urls.full || img.urls.raw;
      if (!url) return;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return;
      const blob = await res.blob();
      const ext = (blob.type && blob.type.includes('png')) ? 'png' : 'jpg';
      const file = new File([blob], `unsplash-${img.id}.${ext}`, { type: blob.type || 'image/jpeg' });

      setUploadedImages(prev => [...prev, file]);
      setSelectedImage(img); // Guardar la imagen seleccionada para mostrar su URL
    } catch (e) {
      // Silenciar fallo; es una utilidad auxiliar.
    }
  }, []);

  const handleCustomSearch = useCallback(async () => {
    const q = customImageQuery.trim();
    if (!q) return;
    setIsSearchingCustom(true);
    try {
      const res = await searchImages({ query: q, limit: imageLimit, orientation: 'landscape' });
      setSuggestedImages(res || []);
    } catch {
      setSuggestedImages([]);
    } finally {
      setIsSearchingCustom(false);
    }
  }, [customImageQuery, imageLimit]);

  // Get selected model from context (permitir override por prop)
  const {
    selectedModel: hookSelectedModel
  } = useModel();
  const selectedModel = propSelectedModel ?? hookSelectedModel;

  // Structure state
  const [projectStructure, setProjectStructure] = useState<ProjectStructure | null>(null);
  const [autoProgressTimer, setAutoProgressTimer] = useState<NodeJS.Timeout | null>(null);
  const [isAutoPaused, setIsAutoPaused] = useState(false);

  // Content generation state
  const [fileProgress, setFileProgress] = useState<Record<string, FileProgress>>({});
  const [currentGeneratingFile, setCurrentGeneratingFile] = useState<string | null>(null);
  const [completedFiles, setCompletedFiles] = useState<Record<string, string>>({});
  const [overallProgress, setOverallProgress] = useState(0);

  // Al pasar a pantalla complete, seleccionar el primer archivo (o app/page.tsx si existe)
  useEffect(() => {
    if (step === 'complete' && Object.keys(completedFiles).length > 0) {
      const keys = Object.keys(completedFiles);
      const preferred = keys.find(k => k === 'app/page.tsx' || k.endsWith('/app/page.tsx')) || keys[0];
      setCompleteStepSelectedFile(prev => prev && completedFiles[prev] ? prev : preferred);
    }
  }, [step, completedFiles]);

  const shouldAutoStartContentAfterStructureRef = useRef(false);
  const hasTransitionedToCompleteRef = useRef(false);
  const runFixMissingImportsRef = useRef<(() => Promise<void>) | null>(null);

  const definitiveProjectRootRef = useRef<string | null>(null);

  // Internal states for preview if not provided as props
  const [internalPreviewUrl, setInternalPreviewUrl] = useState<string | null>(null);
  const [internalIsUploadingToPreview, setInternalIsUploadingToPreview] = useState(false);
  const [internalIsStartingPreview, setInternalIsStartingPreview] = useState(false);
  const [internalPreviewServerStarted, setInternalPreviewServerStarted] = useState(false);
  const [internalIsPostProcessing, setInternalIsPostProcessing] = useState(false);
  const previewUrl = propPreviewUrl !== undefined ? propPreviewUrl : internalPreviewUrl;
  const isUploadingToPreview = propIsUploadingToPreview !== undefined ? propIsUploadingToPreview : internalIsUploadingToPreview;
  const isStartingPreview = propIsStartingPreview !== undefined ? propIsStartingPreview : internalIsStartingPreview;
  const previewServerStarted = propPreviewServerStarted !== undefined ? propPreviewServerStarted : internalPreviewServerStarted;
  const isPostProcessing = propIsPostProcessing !== undefined ? propIsPostProcessing : internalIsPostProcessing;
  const [fileInPostCorrection, setFileInPostCorrection] = useState<string | null>(null); // Archivo actualmente en post-corrección
  const [validationSuggestions, setValidationSuggestions] = useState<{
    summary?: string;
    components: Array<{
      relativePath: string;
      isValid: boolean;
      issues: Array<{
        type: string;
        severity: string;
        message: string;
        suggestion?: string;
      }>;
    }>;
  } | null>(null); // Sugerencias de validación de componentes
  const [copiedSuggestions, setCopiedSuggestions] = useState(false); // Estado para feedback de copia
  const [terminalLines, setTerminalLines] = useState<Array<{ type: 'log' | 'info' | 'warn' | 'error'; text: string }>>([]);

  // Helper para añadir líneas al terminal
  const pushTerminal = useCallback((type: 'log' | 'info' | 'warn' | 'error', text: string) => {
    setTerminalLines(prev => {
      const next = [...prev, { type, text }];
      return next.length > 800 ? next.slice(next.length - 800) : next;
    });
  }, []);

  // Helper para mostrar logs de validación en streaming simulado
  const streamValidationToTerminal = useCallback(async (validationResult: any, title: string) => {
    const validatedCount = validationResult?.validatedComponents ?? validationResult?.totalComponents ?? 0;
    const invalidCount = validationResult?.invalidComponents ?? 0;
    const autoCorrectedCount = validationResult?.components?.filter((c: any) => c.autoCorrected)?.length ?? 0;

    pushTerminal('info', `=== ${title} ===`);
    await new Promise(r => setTimeout(r, 50));
    pushTerminal('log', `Total escaneados: ${validationResult?.totalComponents ?? 0}`);
    await new Promise(r => setTimeout(r, 50));
    pushTerminal('log', `Validados: ${validatedCount} | Válidos: ${validationResult?.validComponents ?? 0} | Inválidos: ${invalidCount} | Auto-corregidos: ${autoCorrectedCount}`);
    await new Promise(r => setTimeout(r, 50));

    const components = validationResult?.components || [];
    for (const comp of components) {
      if (!comp || !comp.issues || comp.issues.length === 0) continue;
      const issues = comp.issues.filter((i: any) => i && i.type !== 'info');
      if (issues.length === 0) continue;
      pushTerminal('warn', `📄 ${comp.relativePath || comp.filePath}`);
      await new Promise(r => setTimeout(r, 30));
      for (const issue of issues.slice(0, 3)) {
        const prefix = issue.severity === 'critical' || issue.severity === 'high' ? '❌' : '⚠️';
        pushTerminal(issue.severity === 'critical' || issue.severity === 'high' ? 'error' : 'warn', `  ${prefix} [${issue.severity}] ${issue.message}`);
        await new Promise(r => setTimeout(r, 20));
        if (issue.suggestion) {
          pushTerminal('info', `     → ${issue.suggestion}`);
          await new Promise(r => setTimeout(r, 20));
        }
      }
    }
    pushTerminal('info', '=== FIN VALIDACIÓN ===');
  }, [pushTerminal]);

  const [isSaving, setIsSaving] = useState(false);
  const terminalEndRef = useRef<HTMLDivElement | null>(null);
  const autoPostProcessedRef = useRef(false);
  const consolePatchedRef = useRef(false);
  const originalConsoleRef = useRef<{
    log?: typeof console.log;
    info?: typeof console.info;
    warn?: typeof console.warn;
    error?: typeof console.error;
  }>({});

  // Debug: Log cuando cambian las sugerencias de validación
  useEffect(() => {
    if (validationSuggestions) {
      console.log('[UI] ✅ validationSuggestions actualizado - Componente debería mostrarse:', {
        hasSummary: !!validationSuggestions.summary,
        componentsCount: validationSuggestions.components?.length || 0,
        hasComponents: !!validationSuggestions.components,
        componentsWithIssues: validationSuggestions.components?.filter((c: any) =>
          c && c.issues && Array.isArray(c.issues) && c.issues.length > 0
        ).length || 0,
        step: 'complete' // Verificar en qué step estamos
      });
    } else {
      console.log('[UI] validationSuggestions está null');
    }
  }, [validationSuggestions]);

  const setGlobalPreviewUrl = useStore(s => s.setPreviewUrl);
  const setPreviewUrl = setPropPreviewUrl || setInternalPreviewUrl;
  const setIsUploadingToPreview = setPropIsUploadingToPreview || setInternalIsUploadingToPreview;
  const setIsStartingPreview = setPropIsStartingPreview || setInternalIsStartingPreview;
  const setPreviewServerStarted = setPropPreviewServerStarted || setInternalPreviewServerStarted;
  const setIsPostProcessing = setPropIsPostProcessing || setInternalIsPostProcessing;

  const getDefinitiveProjectRoot = useCallback(async (): Promise<string> => {
    if (definitiveProjectRootRef.current) return definitiveProjectRootRef.current;
    if (!projectRoot) return '';
    const pid = (projectId as any) || (contextProjectId as any);
    if (!pid) return projectRoot;
    try {
      const rootRes = await sessionFetch('/api/project/get-root', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: pid, initialProjectRoot: projectRoot })
      });
      if (rootRes.ok) {
        const rootData = await rootRes.json().catch(() => ({}));
        if (rootData?.projectRoot && typeof rootData.projectRoot === 'string') {
          definitiveProjectRootRef.current = rootData.projectRoot;
          try {
            setCtxProjectRoot?.(rootData.projectRoot);
          } catch { }
          return rootData.projectRoot;
        }
      }
    } catch (e) {
      console.warn('[getDefinitiveProjectRoot] ⚠️ Error resolviendo projectRoot definitivo:', e);
    }
    return projectRoot;
  }, [projectRoot, projectId, contextProjectId, setCtxProjectRoot]);

  /** Post-corrección de app/page.tsx: se ejecuta INMEDIATAMENTE cuando se pasan todos los archivos y se va a la pantalla "complete". */
  const runPostCorrectAppPageWhenComplete = useCallback(async (completedMap: Record<string, string>): Promise<void> => {
    const normalizePath = (p: string) => p.replace(/\\/g, '/').replace(/^\//, '');
    const allKeys = Object.keys(completedMap);
    console.log('[POST-CORRECT] Buscando app/page.tsx en', allKeys.length, 'archivos. Claves:', allKeys.slice(0, 20));
    const key = allKeys.find(k => {
      const nk = normalizePath(k);
      return nk === 'app/page.tsx' || nk === 'src/app/page.tsx';
    });
    if (!key) {
      console.warn('[POST-CORRECT] No se encontró app/page.tsx en completedFiles. Claves:', allKeys);
      return;
    }
    if (!projectRoot) {
      console.warn('[POST-CORRECT] Falta projectRoot');
      return;
    }
    const isWebPage = true; // Solo aplicamos en flujo web (structure/content ya filtran móvil)
    const isWebApp = true;
    const isMobileApp = false;
    const shouldCorrect = isWebPage || isWebApp || isMobileApp;
    if (!shouldCorrect) return;

    const content = completedMap[key];
    if (!content) {
      console.warn('[POST-CORRECT] No hay contenido para', key);
      return;
    }

    const normalizedKey = normalizePath(key);

    setFileInPostCorrection(normalizedKey);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000);
      const correctionResponse = await fetch('/api/correct-file-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath: projectRoot,
          fileName: normalizedKey,
          fileContent: content,
          projectId: projectId,
          userToken: user?.token,
          modelConfig: selectedModel
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (correctionResponse.ok) {
        const correctionResult = await correctionResponse.json();
        console.log('✅ [POST-CORRECT] Post-corrección automática al pasar a complete:', correctionResult.explanation);
        let correctedContent: string | null = null;
        if (projectRoot && correctionResult.appliedChanges) {
          try {
            const reloadResponse = await sessionFetch('/api/read-file', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filePath: normalizedKey, projectRoot, projectId })
            });
            if (reloadResponse.ok) {
              const reloadData = await reloadResponse.json();
              correctedContent = reloadData.content;
            }
          } catch { }
        }
        if (!correctedContent && correctionResult.correctedContent) correctedContent = correctionResult.correctedContent;
        if (correctedContent) {
          completedMap[normalizedKey] = correctedContent;
          setCompletedFiles(prev => ({ ...prev, [normalizedKey]: correctedContent! }));
          setFileProgress(prev => ({
            ...prev,
            [normalizedKey]: { ...(prev[normalizedKey] || {}), status: 'completed', content: correctedContent!, progress: 100 }
          }));
          try {
            const effectiveRoot = await getDefinitiveProjectRoot();
            await sessionFetch('/api/save-file', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filePath: normalizedKey, content: correctedContent, projectRoot: effectiveRoot, projectId })
            });
          } catch { }
        }
      }
    } catch (e) {
      const msg = (e as any)?.message || String(e);
      if (!String(msg).toLowerCase().includes('abort')) console.warn('⚠️ Post-corrección al pasar a complete (no crítico):', e);
    } finally {
      setFileInPostCorrection(null);
    }
  }, [projectRoot, projectId, user?.token, selectedModel, setFileInPostCorrection, setCompletedFiles, setFileProgress, getDefinitiveProjectRoot]);

  // Estado para Modal de Despliegue de Base de Datos
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [deploySuccess, setDeploySuccess] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [isCheckingDeploy, setIsCheckingDeploy] = useState(false);
  const [deploymentInfo, setDeploymentInfo] = useState<{
    appUrl?: string;
    adminUrl?: string;
    ready?: boolean;
    lastStatus?: number | null;
  } | null>(null);
  const [deploymentIps, setDeploymentIps] = useState<any[]>([]);
  const [isRefreshingIps, setIsRefreshingIps] = useState(false);
  const [ipsError, setIpsError] = useState<string | null>(null);
  // toast ya se obtuvo arriba, no es necesario obtenerlo de nuevo
  const [isUpdatingData, setIsUpdatingData] = useState(false);
  const [ipsFetched, setIpsFetched] = useState(false);
  const [autoIpsRetryActive, setAutoIpsRetryActive] = useState(false);
  const [autoIpsRetriesLeft, setAutoIpsRetriesLeft] = useState(0);
  const ipsIntervalRef = useRef<any>(null);
  const [lastIpsUpdatedAt, setLastIpsUpdatedAt] = useState<string | null>(null);
  const [deployForm, setDeployForm] = useState({
    flyApiToken: '',
    pocketbaseEmail: '',
    pocketbasePassword: '',
    appName: initialAppName || '',
    region: '',
    memory: 256,
    organizationId: 'personal',
    pocketbaseVersion: '0.22.8',
    enableSsl: true
  });

  // ✅ Comprobar si el proyecto tiene database_type === false (solo entonces permitir descarga desde navegador)
  const isDatabaseTypeFalse = useCallback(async (projectId: string): Promise<boolean> => {
    if (!projectId) return false;
    try {
      const res = await fetch(`/api/projects?id=${encodeURIComponent(projectId)}`, { cache: 'no-store' });
      if (!res.ok) return false;
      const record = await res.json().catch(() => ({}));
      return record?.database_type === false;
    } catch {
      return false;
    }
  }, []);

  const runFixMissingImports = useCallback(async () => {
    let root = projectRoot;
    if (!root) {
      console.warn('⚠️ No se pudo iniciar fix-missing-imports: falta projectRoot');
      toast({
        title: t('toastIconError'),
        description: t('noProjectRoot'),
        variant: 'destructive'
      });
      return;
    }

    let targetProjectId: string | undefined = (projectId as any) || (contextProjectId as any);

    // ✅ Si hay projectId, validar/crear en PocketBase y resolver root definitivo
    if (targetProjectId) {
      try {
        const chk = await fetch(`/api/projects?id=${encodeURIComponent(targetProjectId)}`, { cache: 'no-store' });
        if (!chk.ok) {
          const createResp = await fetch('/api/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: formData.appName,
              userId: user?.id,
              selectedModel: selectedModel,
              description: formData.description,
              path: root || '',
              isLocal: typeof window !== 'undefined' && (
                window.location.hostname === 'localhost' ||
                window.location.hostname === '127.0.0.1' ||
                window.location.hostname.includes('local')
              )
            })
          });
          if (createResp.ok) {
            const rec = await createResp.json();
            targetProjectId = rec?.id || targetProjectId;
            try { setCtxProjectId?.(targetProjectId ?? null); } catch { }
          }
        }
      } catch (e) {
        console.warn('⚠️ Error resolviendo projectId para fix-missing-imports:', e);
      }

      // Resolver el projectRoot definitivo del servidor
      try {
        const rootRes = await sessionFetch('/api/project/get-root', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: targetProjectId,
            initialProjectRoot: root
          })
        });
        if (rootRes.ok) {
          const rootData = await rootRes.json();
          if (rootData?.projectRoot && typeof rootData.projectRoot === 'string') {
            root = rootData.projectRoot;
          }
        }
      } catch (rootErr) {
        console.warn('[FIX-MISSING-IMPORTS] ⚠️ Error resolviendo projectRoot definitivo, usando el actual:', rootErr);
      }
    }

    setIsPostProcessing(true);
    console.log('[Generar Componentes] Iniciando revisión de importaciones faltantes...');
    try {
      const newCompletedFiles: Record<string, string> = { ...completedFiles };
      const allCreatedInRun: Array<{ filePath: string; content: string }> = [];

      const checkAndFixImports = async (round: number = 1, maxRounds: number = 10, previousCreatedFiles: string[] = []): Promise<void> => {
        const filesToScan = round > 1 && previousCreatedFiles.length > 0 ? previousCreatedFiles : undefined;
        console.log(`[Generar Componentes] Ronda ${round}/${maxRounds} - Conectando al servidor...`);

        const fixImportsResponse = await fetch('/api/fix-missing-imports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectRoot: root,
            projectId: targetProjectId,
            userToken: user?.token,
            userId: user?.id,
            modelId: selectedModel?.id,
            stream: true,
            filesToScan: filesToScan
          })
        });

        if (!fixImportsResponse.ok) {
          const errorText = await fixImportsResponse.text();
          throw new Error(errorText);
        }

        let fixResult: any = null;
        const streamAccum: any = {
          totalFound: 0,
          totalCreated: 0,
          createdFiles: [] as string[],
          createdContents: {} as Record<string, string>,
          generationLogs: [] as any[],
          hasMore: false,
        };

        try {
          const reader = fixImportsResponse.body?.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          if (reader) {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.type === 'found') {
                    if (typeof data.total === 'number') {
                      streamAccum.totalFound = data.total;
                      console.log(`[Generar Componentes] Encontradas ${data.total} importaciones faltantes`);
                    }
                    if (data.message) console.log(`[Generar Componentes] ${data.message}`);
                  } else if (data.type === 'skipped') {
                    if (data.file) console.log(`[Generar Componentes] ⏭️ Saltado: ${data.file} (${data.reason || 'ya existe'})`);
                  } else if (data.type === 'ready') {
                    if (typeof data.hasMore === 'boolean') streamAccum.hasMore = data.hasMore;
                    console.log(`[Generar Componentes] Listo: generando ${data.total || 0} componentes (más pendientes: ${data.hasMore})`);
                  } else if (data.type === 'generating') {
                    if (data.file) console.log(`[Generar Componentes] ⏳ Generando: ${data.file}...`);
                  } else if (data.type === 'error') {
                    console.warn(`[Generar Componentes] ❌ ${data.message || data.file || 'Error'}`);
                  } else if (data.type === 'generated') {
                    if (data.file && typeof data.file === 'string') {
                      if (!streamAccum.createdFiles.includes(data.file)) {
                        streamAccum.createdFiles.push(data.file);
                        console.log(`[Generar Componentes] ✅ Generado: ${data.file}`);
                      }
                      if (typeof data.content === 'string' && data.content.length > 0) {
                        streamAccum.createdContents[data.file] = data.content;
                      }
                    }
                  } else if (data.type === 'complete') {
                    fixResult = data;
                    console.log(`[Generar Componentes] Ronda ${round} completada (creados: ${streamAccum.createdFiles.length})`);
                  }
                } catch {
                }
              }
            }
          } else {
            fixResult = await fixImportsResponse.clone().json();
          }
        } catch (e) {
          console.warn('⚠️ Error procesando stream de fix-missing-imports:', e);
        }

        if (!fixResult) {
          streamAccum.totalCreated = streamAccum.createdFiles.length;
          fixResult = streamAccum;
        }

        if (fixResult.createdContents) {
          const fileUpdates: Array<{ filePath: string; content: string }> = [];
          for (const [filePath, content] of Object.entries(fixResult.createdContents)) {
            const normalizedPath = (filePath as string).startsWith('/') ? (filePath as string).slice(1) : (filePath as string);
            newCompletedFiles[normalizedPath] = content as string;
            setCompletedFiles(prev => ({
              ...prev,
              [normalizedPath]: content as string
            }));
            fileUpdates.push({ filePath: normalizedPath, content: content as string });
          }

          if (fileUpdates.length > 0) {
            allCreatedInRun.push(...fileUpdates);
            propOnCompletedFilesChange?.(newCompletedFiles);
          }
        }

        const shouldContinue = (fixResult && fixResult.totalCreated > 0) || (fixResult && fixResult.hasMore);
        if (!shouldContinue) {
          console.log('[Generar Componentes] No hay más componentes que generar.');
          return;
        }

        console.log(`[Generar Componentes] Nueva ronda en 2 segundos...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        if (round < maxRounds) {
          const createdInThisRound = fixResult.hasMore ? undefined : (fixResult.createdFiles || []);
          await checkAndFixImports(round + 1, maxRounds, createdInThisRound);
        }
      };

      await checkAndFixImports(1, 10);

      console.log('[Generar Componentes] Proceso finalizado.');

      // ✅ Validación automática de componentes tras corregir imports
      try {
        const filesToValidate = allCreatedInRun.map(a => a.filePath).filter(Boolean);
        console.log('[Generar Componentes] Iniciando validación automática de componentes...', {
          root,
          targetProjectId,
          filesToValidateCount: filesToValidate.length,
          filesToValidate: filesToValidate.slice(0, 20)
        });

        // PocketBase / store usan base_url, api_key, model_name; el hook puede usar url, apiKey, model
        const safeModelConfig = selectedModel
          ? {
            id: selectedModel.id,
            name: (selectedModel as any).name ?? (selectedModel as any).nombre_modelo,
            model: (selectedModel as any).model ?? (selectedModel as any).model_name,
            provider: (selectedModel as any).provider,
            url: (selectedModel as any).url ?? (selectedModel as any).base_url,
            apiKey: (selectedModel as any).apiKey ?? (selectedModel as any).api_key,
          }
          : undefined;

        const validateBody = {
          projectRoot: root,
          projectId: targetProjectId,
          userId: user?.id,
          modelId: selectedModel?.id,
          userToken: user?.token,
          modelConfig: safeModelConfig,
          filesToValidate: filesToValidate.length > 0 ? filesToValidate : undefined,
          autoCorrect: true,
        };

        console.log('[Generar Componentes] Enviando a /api/validate-components:', validateBody);

        const validateResponse = await fetch('/api/validate-components', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validateBody),
        });

        if (!validateResponse.ok) {
          const errorText = await validateResponse.text();
          console.warn('[Generar Componentes] ⚠️ Error en validación automática (HTTP):', errorText);
          toast?.({
            title: 'Error validación automática',
            description: `HTTP ${validateResponse.status}: ${errorText.slice(0, 100)}`,
            variant: 'destructive'
          });
        } else {
          const validateResult = await validateResponse.json();
          console.log('[Generar Componentes] ✅ Validación completada:', validateResult);

          const validatedCount = validateResult?.validatedComponents ?? validateResult?.totalComponents ?? 0;
          const invalidCount = validateResult?.invalidComponents ?? 0;
          const autoCorrectedCount = validateResult?.components?.filter((c: any) => c.autoCorrected)?.length ?? 0;

          // Imprimir en terminal en streaming
          await streamValidationToTerminal(validateResult, 'VALIDACIÓN AUTOMÁTICA POST-IMPORTS');

          if (validatedCount === 0) {
            console.warn('[Generar Componentes] ⚠️ Validación devolvió 0 componentes. Intentando escaneo completo del directorio...');
            // Fallback: escanear todo el directorio si no validó nada
            const fallbackResponse = await fetch('/api/validate-components', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                projectRoot: root,
                projectId: targetProjectId,
                userId: user?.id,
                modelId: selectedModel?.id,
                userToken: user?.token,
                modelConfig: safeModelConfig,
                autoCorrect: true,
              }),
            });
            if (fallbackResponse.ok) {
              const fallbackResult = await fallbackResponse.json();
              console.log('[Generar Componentes] ✅ Fallback escaneo completado:', fallbackResult);
              await streamValidationToTerminal(fallbackResult, 'VALIDACIÓN FALLBACK');
              toast?.({
                title: 'Validación fallback completada',
                description: `Escaneados ${fallbackResult?.totalComponents ?? 0} componentes. Inválidos: ${fallbackResult?.invalidComponents ?? 0}`,
              });
            } else {
              console.warn('[Generar Componentes] ⚠️ Fallback también falló.');
              pushTerminal('error', 'Fallback de validación también falló.');
            }
          } else {
            toast?.({
              title: 'Validación completada',
              description: `Validados ${validatedCount} componentes. Inválidos: ${invalidCount}. Auto-corregidos: ${autoCorrectedCount}`,
            });
          }
        }
      } catch (validationError) {
        console.warn('[Generar Componentes] ⚠️ Error en validación automática (catch):', validationError);
        toast?.({
          title: 'Error validación automática',
          description: validationError instanceof Error ? validationError.message : 'Error desconocido',
          variant: 'destructive'
        });
      }
    } catch (e) {
      console.warn('⚠️ Error en fix-missing-imports manual:', e);

      // Mostrar notificación si está disponible
      if (toast) {
        toast({
          title: t('fixImportsError'),
          description: t('fixImportsDesc'),
          variant: 'destructive'
        });
      } else {
        // Fallback: mostrar alert nativo si toast no está disponible
        if (typeof window !== 'undefined') {
          alert(`${t('fixImportsError')}: ${t('fixImportsDesc')}`);
        }
      }
    } finally {
      setIsPostProcessing(false);
    }
  }, [projectRoot, projectId, contextProjectId, completedFiles, formData.appName, formData.description, selectedModel, setCompletedFiles, setCtxProjectId, setIsPostProcessing, pushTerminal, user?.id, user?.token, toast, isDatabaseTypeFalse, propOnCompletedFilesChange]);

  // ✅ Ref para acceder a la versión más reciente sin causar recreaciones de callbacks
  runFixMissingImportsRef.current = runFixMissingImports;

  // ✅ Función para corregir el archivo seleccionado en la vista previa (o app/page por defecto)
  const runPostCorrectPage = useCallback(async (filePath?: string, content?: string) => {
    const targetProjectId: string | undefined = (projectId as any) || (contextProjectId as any);
    // Prioridad: 1) argumentos pasados (validaciones), 2) archivo seleccionado en vista resultados, 3) archivo en pantalla complete
    const fileToCorrect = (filePath != null && content != null) ? filePath : (propPreviewSelectedFilePath || completeStepSelectedFile || null);
    console.log('[Corregir archivo] Iniciando corrección...', fileToCorrect ? `Archivo: ${fileToCorrect}` : 'Archivo: app/page.tsx (por defecto)');
    if (!projectRoot) {
      console.warn('[POST-CORRECT] No se puede ejecutar: falta projectRoot');
      toast({
        title: t('toastIconError'),
        description: t('noProjectRoot'),
        variant: 'destructive'
      });
      return null;
    }

    setIsPostProcessing(true);
    try {
      // ✅ Resolver el projectRoot definitivo del servidor (solo si hay projectId)
      let definitiveProjectRoot = projectRoot;
      if (targetProjectId) {
        try {
          const rootRes = await sessionFetch('/api/project/get-root', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId: targetProjectId,
              initialProjectRoot: projectRoot
            })
          });
          if (rootRes.ok) {
            const rootData = await rootRes.json();
            if (rootData?.projectRoot && typeof rootData.projectRoot === 'string') {
              definitiveProjectRoot = rootData.projectRoot;
            }
          } else {
            const errText = await rootRes.text().catch(() => '');
            console.warn('[POST-CORRECT] ⚠️ No se pudo resolver projectRoot definitivo, usando el actual. Detalle:', errText);
          }
        } catch (rootErr) {
          console.warn('[POST-CORRECT] ⚠️ Error resolviendo projectRoot definitivo, usando el actual:', rootErr);
        }
      }

      // Archivo a corregir: argumentos pasados o el seleccionado en la vista previa o app/page.tsx por defecto
      let fileContent = (filePath != null && content != null) ? content : '';
      let pageFilePath = (filePath != null && content != null) ? filePath : (fileToCorrect || 'app/page.tsx');
      const candidates = fileToCorrect ? [fileToCorrect] : ['app/page.tsx', 'src/app/page.tsx'];

      if (fileContent) {
        // Ya tenemos contenido (pasado por argumentos desde validaciones)
      } else if (fileToCorrect && completedFiles[fileToCorrect]) {
        fileContent = completedFiles[fileToCorrect];
        pageFilePath = fileToCorrect;
      } else {
        for (const candidate of candidates) {
          try {
            const readResponse = await sessionFetch('/api/read-file', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                filePath: candidate,
                projectRoot: definitiveProjectRoot,
                projectId: targetProjectId
              })
            });

            if (readResponse.ok) {
              const readData = await readResponse.json();
              const content = readData.content || '';
              if (content && String(content).trim()) {
                fileContent = content;
                pageFilePath = candidate;
                break;
              }
            }
          } catch (readError) {
            // Intentar siguiente candidato
          }
        }
      }

      if (!fileContent) {
        toast({
          title: t('toastIconError'),
          description: fileToCorrect
            ? t('cannotReadFile').replace('{file}', fileToCorrect)
            : t('cannotReadDefaultFile'),
          variant: 'destructive'
        });
        return null;
      }

      console.log('[Corregir archivo] Enviando a la IA para corrección...');
      const correctionResponse = await fetch('/api/correct-file-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath: definitiveProjectRoot,
          fileName: pageFilePath,
          fileContent: fileContent,
          projectId: targetProjectId,
          userToken: user?.token,
          modelConfig: selectedModel
        })
      });

      if (correctionResponse.ok) {
        const correctionResult = await correctionResponse.json();
        console.log('[Corregir archivo] ✅ Corrección aplicada. Actualizando proyecto...');
        // Si la API detectó mismatch (ej. types/index.ts con contenido de página), usar effectiveFileName
        const actualFilePath = correctionResult.effectiveFileName || pageFilePath;
        const expl = correctionResult.explanation?.trim();
        toast({
          title: `${t('correctFileApplied')}: ${actualFilePath}`,
          description: expl || t('correctionsApplied'),
          variant: 'default'
        });

        // Recargar el archivo corregido
        if (correctionResult.correctedContent) {
          setCompletedFiles(prev => ({
            ...prev,
            [actualFilePath]: correctionResult.correctedContent
          }));
        }

        // Retornar el archivo corregido para que el padre actualice la vista inmediatamente
        const resultToReturn = correctionResult.correctedContent
          ? { filePath: actualFilePath, content: correctionResult.correctedContent }
          : null;

        // Llamar al callback del padre para actualizar la vista previa
        if (propOnFileCorrected && correctionResult.correctedContent) {
          propOnFileCorrected(actualFilePath, correctionResult.correctedContent);
        }

        return resultToReturn;
      } else {
        const errorData = await correctionResponse.json().catch(() => ({ error: t('unknownError') }));
        const errorMessage = errorData.error || t('correctFileErrorDesc');

        // Registrar error en consola para debugging
        console.error('❌ [POST-CORRECT] Error en corrección:', {
          status: correctionResponse.status,
          error: errorMessage,
          timestamp: new Date().toISOString()
        });

        // Mostrar notificación si está disponible
        if (toast) {
          toast({
            title: t('correctFileError'),
            description: errorMessage,
            variant: 'destructive'
          });
        } else {
          // Fallback: mostrar alert nativo si toast no está disponible
          if (typeof window !== 'undefined') {
            alert(`${t('correctFileError')}: ${errorMessage}`);
          }
        }
        return null;
      }
    } catch (error: any) {
      console.error('❌ [POST-CORRECT] Error en post-correct:', {
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });

      const errorMessage = error.message || t('correctFileErrorDesc');

      // Mostrar notificación si está disponible
      if (toast) {
        toast({
          title: t('toastIconError'),
          description: errorMessage,
          variant: 'destructive'
        });
      } else {
        // Fallback: mostrar alert nativo si toast no está disponible
        if (typeof window !== 'undefined') {
          alert(`${t('toastIconError')}: ${errorMessage}`);
        }
      }
      return null;
    } finally {
      setIsPostProcessing(false);
    }
  }, [projectRoot, projectId, contextProjectId, user?.token, selectedModel, toast, setCompletedFiles, setIsPostProcessing, isDatabaseTypeFalse, propPreviewSelectedFilePath, propOnFileCorrected, completedFiles, step, completeStepSelectedFile]);

  // ✅ Función para validar componentes manualmente
  const runValidateComponents = useCallback(async () => {
    const root = projectRoot;
    console.log('[Validar Componentes] Iniciando validación de componentes...');
    if (!root) {
      console.warn('[VALIDATE-COMPONENTS] No se puede ejecutar: falta projectRoot');
      toast({
        title: t('toastIconError'),
        description: t('noProjectSelected'),
        variant: 'destructive'
      });
      return;
    }

    let targetProjectId: string | undefined = (projectId as any) || (contextProjectId as any);
    if (!targetProjectId) {
      console.warn('[VALIDATE-COMPONENTS] No hay projectId, se usará solo projectRoot');
    }

    setIsPostProcessing(true);
    try {
      console.log('[Validar Componentes] Analizando archivos del proyecto...');

      const safeModelConfig = selectedModel
        ? {
          id: selectedModel.id,
          name: (selectedModel as any).name ?? (selectedModel as any).nombre_modelo,
          model: (selectedModel as any).model ?? (selectedModel as any).model_name,
          provider: (selectedModel as any).provider,
          url: (selectedModel as any).url ?? (selectedModel as any).base_url,
          apiKey: (selectedModel as any).apiKey ?? (selectedModel as any).api_key,
        }
        : undefined;

      const validateResponse = await fetch('/api/validate-components', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectRoot: root,
          projectId: targetProjectId,
          userId: user?.id,
          modelId: selectedModel?.id,
          userToken: user?.token,
          modelConfig: safeModelConfig,
          autoCorrect: true,
        })
      });

      if (validateResponse.ok) {
        const validationResult = await validateResponse.json();
        // setValidationSuggestions(validationResult); // ya no se usa la tarjeta, se imprime en terminal

        const validatedCount = validationResult?.validatedComponents ?? validationResult?.totalComponents ?? 0;
        const invalidCount = validationResult?.invalidComponents ?? 0;
        const autoCorrectedCount = validationResult?.components?.filter((c: any) => c.autoCorrected)?.length ?? 0;

        console.log('[Validar Componentes] ✅ Validación completada.', validationResult?.summary || '');

        // ✅ Imprimir resultado en terminal en streaming
        await streamValidationToTerminal(validationResult, 'VALIDACIÓN DE COMPONENTES');

        toast({
          title: t('validationCompleted'),
          description: t('componentsValidated').replace('{count}', String(validatedCount)).replace('{invalid}', String(invalidCount)).replace('{autoCorrected}', String(autoCorrectedCount)),
          variant: 'default'
        });

        // Aplicar correcciones locales (archivos que la API no pudo auto-corregigar en disco pero devolvió correctedCode)
        if (targetProjectId && root) {
          try {
            const filesToSave: Record<string, string> = { ...completedFiles };
            const components = validationResult?.components || [];
            for (const c of components) {
              if (c?.correctedCode && c?.relativePath && !c?.autoCorrected) {
                filesToSave[c.relativePath] = c.correctedCode;
              }
            }
            if (Object.keys(filesToSave).length > Object.keys(completedFiles).length) {
              setCompletedFiles(filesToSave);
              propOnCompletedFilesChange?.(filesToSave);
              console.log('[Validar Componentes] Aplicadas correcciones locales en memoria.');
            }

            // Actualizar vista previa
            try {
              const listRes = await fetch('/api/list-files', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ directoryPath: '', projectRoot: root, projectId: targetProjectId, includeContent: true })
              });
              if (listRes.ok) {
                const listData = await listRes.json();
                const allFiles = listData.files || {};
                const excludeDirs = ['node_modules', '.next', '.git', 'dist', 'build'];
                const filtered: Record<string, string> = {};
                for (const [p, c] of Object.entries(allFiles)) {
                  if (typeof c !== 'string') continue;
                  const skip = excludeDirs.some(d => p.includes(`/${d}/`) || p.startsWith(`${d}/`));
                  if (!skip && p && !p.endsWith('/')) filtered[p] = c;
                }
                if (Object.keys(filtered).length > 0) {
                  await uploadToPreviewServerRef.current?.(filtered, formData.appName, formData.template);
                  console.log('[Validar Componentes] ✅ Vista previa actualizada con archivos recopilados.');
                }
              }
            } catch (previewErr: any) {
              console.warn('[Validar Componentes] No se pudo actualizar vista previa:', previewErr?.message);
            }
          } catch (archiveError: any) {
            console.warn('[VALIDATE-COMPONENTS] ⚠️ Error al aplicar correcciones locales (no crítico):', archiveError?.message || archiveError);
          }
        }
      } else {
        const errorData = await validateResponse.json().catch(() => ({ error: t('unknownError') }));
        toast({
          title: t('validationError'),
          description: errorData.error || t('validationErrorDesc'),
          variant: 'destructive'
        });
      }
    } catch (error: any) {
      console.error('Error en validate-components:', error);
      toast({
        title: t('toastIconError'),
        description: error.message || t('validationErrorDesc'),
        variant: 'destructive'
      });
    } finally {
      setIsPostProcessing(false);
    }
  }, [projectRoot, projectId, contextProjectId, user?.id, user?.token, selectedModel, toast, setIsPostProcessing, pushTerminal, isDatabaseTypeFalse, completedFiles, setCompletedFiles, propOnCompletedFilesChange, formData]);

  // ✅ Función para generar componentes faltantes (solo fix-missing-imports, sin validación)
  const runFixMissingImportsAndValidate = useCallback(async () => {
    const root = projectRoot;
    let targetProjectId: string | undefined = (projectId as any) || (contextProjectId as any);
    console.log('[FIX-MISSING-IMPORTS] Click: Generar Componentes', {
      projectRoot: !!root,
      projectId: targetProjectId
    });

    // Solo ejecutar fix-missing-imports (la validación tiene su propio botón)
    await runFixMissingImports();
  }, [runFixMissingImports, projectRoot, projectId, contextProjectId, user?.token]);

  // ✅ Función para guardar el proyecto en almacenamiento local (disco)
  // Usa File System Access API (showDirectoryPicker) cuando está disponible
  const handleSave = useCallback(async () => {
    if (!completedFiles || Object.keys(completedFiles).length === 0) {
      toast({
        title: 'No se puede guardar',
        description: 'No hay archivos para guardar.',
        variant: 'destructive'
      });
      return;
    }
    setIsSaving(true);
    try {
      let savedCount = 0;
      const entries = Object.entries(completedFiles);
      console.log(`[handleSave] Guardando ${entries.length} archivos en DATA_PATH.`);

      const root = projectRoot || propProjectRoot;
      const effectiveProjectId = projectId || contextProjectId || formData.appName?.replace(/[^a-zA-Z0-9\-_]/g, '_') || 'unknown';
      console.log(`[handleSave] Usando /api/save-file. root=${root || 'null'}, projectId=${effectiveProjectId}`);
      for (const [filePath, content] of entries) {
        try {
          const response = await sessionFetch('/api/save-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ skipBackup: true, filePath, content, projectRoot: root, projectId: root ? undefined : effectiveProjectId })
          });
          const data = await response.json().catch(() => ({}));
          if (response.ok) {
            savedCount++;
            console.log(`[handleSave] ✅ Archivo guardado: ${filePath}`);
          } else {
            console.warn(`[handleSave] ⚠️ Error guardando ${filePath}: ${response.status} - ${JSON.stringify(data)}`);
          }
        } catch (err) {
          console.warn(`[handleSave] ⚠️ Error de red guardando ${filePath}:`, err);
        }
      }

      // Guardar imágenes subidas en public/uploads/
      if (uploadedImages && uploadedImages.length > 0) {
        for (const img of uploadedImages) {
          try {
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(img);
            });
            const imgPath = `public/uploads/${img.name}`;
            const response = await sessionFetch('/api/save-file', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ skipBackup: true, filePath: imgPath, content: dataUrl, projectRoot: root, projectId: root ? undefined : effectiveProjectId })
            });
            const data = await response.json().catch(() => ({}));
            if (response.ok) {
              savedCount++;
              console.log(`[handleSave] ✅ Imagen guardada: ${imgPath}`);
            } else {
              console.warn(`[handleSave] ⚠️ Error guardando imagen ${imgPath}: ${response.status} - ${JSON.stringify(data)}`);
            }
          } catch (err) {
            console.warn(`[handleSave] ⚠️ Error guardando imagen ${img.name}:`, err);
          }
        }
      }
      if (savedCount === 0) {
        toast({
          title: t('saveError'),
          description: t('saveErrorDesc'),
          variant: 'destructive'
        });
      } else {
        const location = root || `DATA_PATH/projects/${effectiveProjectId}`;
        toast({
          title: t('projectSaved'),
          description: `${savedCount} ${t('projectSavedDesc')} ${location}`,
          variant: 'default'
        });
      }
    } catch (e: any) {
      console.error('Error guardando proyecto localmente:', e);
      toast({
        title: t('saveError'),
        description: e?.message || t('saveFilesError'),
        variant: 'destructive'
      });
    } finally {
      setIsSaving(false);
    }
  }, [completedFiles, projectRoot, propProjectRoot, projectId, contextProjectId, formData.appName, toast, uploadedImages]);

  useEffect(() => {
    if (step !== 'complete' || autoPostProcessedRef.current || !projectRoot) return;
    const targetProjectId = (projectId as any) || (contextProjectId as any);
    if (!targetProjectId) return;

    autoPostProcessedRef.current = true;

    const push = (type: 'log' | 'info' | 'warn' | 'error', text: string) => {
      setTerminalLines(prev => {
        const next = [...prev, { type, text }];
        return next.length > 800 ? next.slice(next.length - 800) : next;
      });
    };

    const runAutoPostProcess = async () => {
      push('info', 'Iniciando post-procesamiento automático...');

      // 1) Corrección de app/page.tsx
      push('info', 'Paso 1/2: Corrigiendo app/page.tsx...');
      try {
        const correctionRes = await fetch('/api/correct-file-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectPath: projectRoot,
            fileName: 'app/page.tsx',
            projectId: targetProjectId,
            userToken: user?.token,
            modelConfig: selectedModel
          })
        });
        if (correctionRes.ok) {
          const data = await correctionRes.json();
          push('log', `✅ Corrección aplicada: ${data.effectiveFileName || 'app/page.tsx'}`);
          if (data.correctedContent) {
            setCompletedFiles(prev => ({ ...prev, 'app/page.tsx': data.correctedContent }));
          }
        } else {
          const err = await correctionRes.json().catch(() => ({ error: 'Error desconocido' }));
          push('error', `❌ Error en corrección: ${err.error || correctionRes.status}`);
        }
      } catch (e: any) {
        push('error', `❌ Excepción en corrección: ${e.message || e}`);
      }

      // 2) Fix missing imports
      push('info', 'Paso 2/2: Revisando importaciones faltantes...');
      try {
        const fixRes = await fetch('/api/fix-missing-imports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectRoot,
            projectId: targetProjectId,
            userToken: user?.token,
            userId: user?.id,
            modelId: selectedModel?.id,
            stream: false
          })
        });
        if (fixRes.ok) {
          const data = await fixRes.json();
          const created = data.createdFiles?.length || 0;
          push('log', `✅ Importaciones corregidas. Archivos creados: ${created}`);
          if (data.createdContents) {
            setCompletedFiles(prev => ({ ...prev, ...data.createdContents }));
          }
        } else {
          const err = await fixRes.json().catch(() => ({ error: 'Error desconocido' }));
          push('error', `❌ Error en fix-missing-imports: ${err.error || fixRes.status}`);
        }
      } catch (e: any) {
        push('error', `❌ Excepción en fix-missing-imports: ${e.message || e}`);
      }

      push('info', 'Post-procesamiento automático finalizado.');
    };

    runAutoPostProcess();
  }, [step, projectRoot, projectId, contextProjectId, user?.token, user?.id, selectedModel]);

  useImperativeHandle(ref, () => ({
    uploadToPreviewServer: uploadToPreviewServer,
    getFormData: () => formData,
    getCompletedFiles: () => completedFiles,
    goToFormStep: () => setStep('form'),
    runFixMissingImports: runFixMissingImports,
    runFixMissingImportsAndValidate: runFixMissingImportsAndValidate,
    runPostCorrectPage: runPostCorrectPage,
    runValidateComponents: runValidateComponents,
    getValidationSuggestions: () => validationSuggestions
  }));

  // Helper function to extract files from structure
  const extractFilesFromStructure = useCallback((structure: FileStructure[]): FileStructure[] => {
    const files: FileStructure[] = [];
    const traverse = (items: FileStructure[]) => {
      for (const item of items) {
        if (item.type === 'file') {
          files.push(item);
        } else if (item.children) {
          traverse(item.children);
        }
      }
    };
    traverse(structure);
    return files;
  }, []);
  const startPreviewServer = useCallback(async () => {
    setIsStartingPreview(true);
    try {
      const response = await fetch('/api/preview/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      if (response.ok) {
        const result = await response.json();
        setPreviewServerStarted(true);
        console.log('Preview server started:', result);
      } else {
        console.error('Failed to start preview server');
      }
    } catch (error) {
      console.error('Error starting preview server:', error);
    } finally {
      setIsStartingPreview(false);
    }
  }, [setIsStartingPreview, setPreviewServerStarted]);
  const uploadToPreviewServer = useCallback(async (files: Record<string, string>, appName: string, template: string): Promise<string | null> => {
    const setUploading = setIsUploadingToPreview || setInternalIsUploadingToPreview;
    const setStarting = setIsStartingPreview || setInternalIsStartingPreview;
    const setPreview = setPreviewUrl || setInternalPreviewUrl;
    const setServerStarted = setPreviewServerStarted || setInternalPreviewServerStarted;
    setUploading(true);
    setStarting(true); // Assume starting process begins

    try {
      // Usar /api/preview/upload (Next.js) que recibe JSON y reenvía al servidor de preview
      const uploadUrl = '/api/preview/upload';
      console.log('Frontend: Enviando proyecto a:', uploadUrl);
      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files, appName, template })
      });
      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        let errorData: { error?: string; details?: string } = { error: 'Error desconocido' };
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: `Error ${uploadResponse.status}`, details: errorText?.slice(0, 200) };
        }
        console.error('Failed to upload to preview server:', errorData);
        const msg = errorData.details || errorData.error || 'Error desconocido';
        alert(`Error al subir el proyecto: ${msg}\n\nSi el servidor de preview no está en marcha, descarga el proyecto como ZIP.`);
        return null;
      }
      const uploadResult = await uploadResponse.json();
      const newProjectId = uploadResult.projectId;
      console.log('Application uploaded, project ID:', newProjectId);

      // Poll for project status
      let currentPreviewUrl: string | null = null;
      let attempts = 0;
      const maxAttempts = 60; // Poll for up to 60 seconds
      const pollInterval = 1000; // 1 second

      while (attempts < maxAttempts) {
        attempts++;
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        const statusResponse = await fetch(`/api/project-status/${newProjectId}`);
        if (statusResponse.ok) {
          const statusResult = await statusResponse.json();
          console.log(`Polling status for ${newProjectId}:`, statusResult.status);
          if (statusResult.status === 'ready' && statusResult.url) {
            currentPreviewUrl = statusResult.url;
            break;
          } else if (statusResult.status === 'error') {
            alert(`Error en el servidor de preview: ${statusResult.error}`);
            return null;
          }
        }
      }
      if (!currentPreviewUrl) {
        console.warn(`Failed to get status for ${newProjectId} after polling attempts.`);
      }
      if (currentPreviewUrl) {
        setPreview(currentPreviewUrl);
        setGlobalPreviewUrl(currentPreviewUrl);
        setServerStarted(true); // Assuming server is started if URL is ready
        console.log('Application uploaded and preview ready:', currentPreviewUrl);
        return currentPreviewUrl;
      } else {
        console.error('Preview server did not start in time or URL could not be obtained.');
        alert('El servidor de vista previa no se inició a tiempo o no se pudo obtener la URL.');
        return null;
      }
    } catch (error) {
      console.error('Error uploading to preview server:', error);
      const errorMessage = error instanceof Error ? error.message : 'Error de conexión';
      alert(`Error al conectar con el servidor de preview:

${errorMessage}

Por favor:
1. Verifica tu conexión a internet
2. Intenta nuevamente en unos minutos
3. Como alternativa, descarga el proyecto como ZIP`);
      return null;
    } finally {
      setUploading(false);
      setStarting(false); // Ensure starting state is reset
    }
  }, [setIsUploadingToPreview, setInternalIsUploadingToPreview, setIsStartingPreview, setInternalIsStartingPreview, setPreviewUrl, setInternalPreviewUrl, setPreviewServerStarted, setInternalPreviewServerStarted, setGlobalPreviewUrl]);
  uploadToPreviewServerRef.current = uploadToPreviewServer;
  const templates = [{
    id: 'next-js',
    name: 'Next.js',
    description: 'React framework con SSR'
  }, {
    id: 'vite-react',
    name: 'Vite + React',
    description: 'React con Vite build tool'
  }, {
    id: 'vue-nuxt',
    name: 'Vue + Nuxt',
    description: 'Vue.js con Nuxt framework'
  }, {
    id: 'svelte-kit',
    name: 'SvelteKit',
    description: 'Svelte con SvelteKit'
  }, {
    id: 'angular',
    name: 'Angular',
    description: 'Angular framework'
  }, {
    id: 'html-css-js',
    name: 'HTML, CSS, JS',
    description: 'Página web estática con HTML, CSS y JavaScript'
  }, {
    id: 'astro',
    name: 'Astro',
    description: 'Framework moderno para sitios web estáticos'
  }, {
    id: 'eleventy',
    name: 'Eleventy',
    description: 'Generador de sitios estáticos simple y rápido'
  }, {
    id: 'react-native',
    name: 'React Native',
    description: 'Aplicación móvil multiplataforma con React Native'
  }, {
    id: 'flutter',
    name: 'Flutter',
    description: 'Aplicación móvil multiplataforma con Flutter'
  }, {
    id: 'swift-ui',
    name: 'SwiftUI (iOS)',
    description: 'Aplicación nativa para iOS con SwiftUI'
  }, {
    id: 'kotlin-compose',
    name: 'Jetpack Compose (Android)',
    description: 'Aplicación nativa para Android con Jetpack Compose'
  }, {
    id: 'fastapi-py',
    name: 'FastAPI',
    description: 'Python FastAPI backend'
  }];
  const availableFeatures = ['authentication', 'database', 'chat', 'api'];

  // Auto-generate API using API Generator resources before generating the app
  const autoGenerateApi = useCallback(async (description: string): Promise<any | null> => {
    if (!selectedModel) {
      console.warn('[autoGenerateApi] No hay modelo seleccionado, saltando auto-generación de API');
      return null;
    }

    setApiAutoGenerating(true);
    setApiAutoGenStatus('Generando API para tu aplicación...');

    try {
      // ── Verificar si ya existe una API generada previamente ──
      // Si el usuario creó la API desde la pestaña API Generator,
      // reutilizamos esa configuración en lugar de generar una nueva.
      try {
        const checkRes = await sessionFetch('/api/read-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: 'API/zeus-api-config.json', projectRoot })
        });
        if (checkRes.ok) {
          const checkData = await checkRes.json();
          if (checkData.success && checkData.content) {
            const existingConfig = JSON.parse(checkData.content);
            if (existingConfig.title && Array.isArray(existingConfig.endpoints)) {
              console.log('[autoGenerateApi] API existente detectada en API/zeus-api-config.json. Reutilizando sin regenerar.');
              setApiAutoGenStatus('API existente detectada. Reutilizando configuración...');

              // Asegurar que el pb_schema.json exista; si no, lo creamos ahora
              try {
                const pbCheckRes = await sessionFetch('/api/read-file', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ filePath: 'API/pb_schema.json', projectRoot })
                });
                if (!pbCheckRes.ok) {
                  const pbSchemaContent = generatePbSchema(existingConfig.endpoints || [], existingConfig.title || formData.appName);
                  await sessionFetch('/api/save-file', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ skipBackup: true, filePath: 'API/pb_schema.json', content: pbSchemaContent, projectRoot })
                  });
                  console.log('[autoGenerateApi] pb_schema.json creado para la API existente.');
                }
              } catch (pbErr) {
                console.warn('[autoGenerateApi] No se pudo verificar/crear pb_schema.json:', pbErr);
              }

              // Pequeña pausa para que el spinner se vea y luego devolver la API existente
              await new Promise(r => setTimeout(r, 800));

              const reusedResult = {
                title: existingConfig.title,
                description: existingConfig.description || '',
                endpoints: existingConfig.endpoints || [],
                schemas: existingConfig.schemas || '',
                documentation: existingConfig.documentation || '',
                code: existingConfig.code || '',
                reused: true
              };

              setApiAutoGenStatus('API existente reutilizada correctamente');
              setAutoGeneratedApiData(reusedResult);
              autoGeneratedApiDataRef.current = reusedResult;
              return reusedResult;
            }
          }
        }
      } catch (checkErr) {
        // Silencioso: si no podemos leer, simplemente generamos como antes
        console.log('[autoGenerateApi] No se pudo verificar API existente, procediendo a generar nueva.');
      }

      // Build model config for the API Generator
      const modelConfig = {
        apiKey: selectedModel[MODELOS_FIELDS.API_KEY] || '',
        model: selectedModel[MODELOS_FIELDS.MODEL_NAME] || 'deepseek-chat',
        temperature: selectedModel[MODELOS_FIELDS.CONFIG]?.temperature || 0.7,
        maxTokens: selectedModel[MODELOS_FIELDS.CONFIG]?.max_tokens || 4000,
        apiBaseUrl: selectedModel[MODELOS_FIELDS.BASE_URL] || undefined,
        type: selectedModel[MODELOS_FIELDS.TYPE] || '',
        provider: selectedModel[MODELOS_FIELDS.PROVIDER] || '',
        modelId: selectedModel.id,
      };

      const modelConfigStr = JSON.stringify(modelConfig);

      // Build FormData for the API Generator (same format as ApiGeneratorModal)
      const fd = new FormData();
      fd.append('title', formData.appName || 'API');
      fd.append('description', description);
      fd.append('modelType', 'typescript');

      setApiAutoGenStatus('Llamando al API Generator...');

      // Call the API Generator endpoint with fallback URLs
      const generateUrls = [
        '/api/generate-api/generate',
        'http://localhost:8742/api/generate-api/generate',
        'http://localhost:8743/api/generate-api/generate'
      ];

      let response: Response | null = null;
      for (const url of generateUrls) {
        try {
          const candidate = await fetch(url, {
            method: 'POST',
            headers: {
              'x-model-config': modelConfigStr,
            },
            body: fd
          });
          if (candidate.ok) {
            response = candidate;
            break;
          }
          if (candidate.status === 404 || candidate.status === 502 || candidate.status === 503) {
            continue;
          }
          response = candidate;
          break;
        } catch {
          continue;
        }
      }

      if (!response || !response.ok) {
        const errData = response ? await response.json().catch(() => ({})) : {};
        console.warn('[autoGenerateApi] Error generando API:', errData);
        setApiAutoGenStatus('No se pudo generar la API automáticamente. Continuando sin API personalizada...');
        await new Promise(r => setTimeout(r, 2000));
        return null;
      }

      const result = await response.json();
      console.log('[autoGenerateApi] API generada exitosamente:', result?.title);

      setApiAutoGenStatus('Guardando configuración de API...');

      // Save the generated API config to zeus-api-config.json
      const apiConfigData = {
        title: result.title || formData.appName,
        description: result.description || description,
        endpoints: result.endpoints || [],
        schemas: result.schemas || '',
        documentation: result.documentation || '',
        code: result.code || '',
        generatedAt: new Date().toISOString(),
        autoGenerated: true
      };

      const saveUrls = [
        '/api/generate-api/save-config',
        'http://localhost:8742/api/generate-api/save-config',
        'http://localhost:8743/api/generate-api/save-config'
      ];

      for (const url of saveUrls) {
        try {
          const saveRes = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiConfig: apiConfigData, projectRoot })
          });
          if (saveRes.ok) {
            console.log('[autoGenerateApi] API config guardada correctamente');
            break;
          }
        } catch {
          continue;
        }
      }

      // ✅ Guardar todos los archivos de la API generada en la carpeta API/
      setApiAutoGenStatus('Guardando archivos de la API...');
      const apiPackageJson = {
        name: 'api',
        version: '1.0.0',
        private: true,
        scripts: {
          start: 'tsx index.ts',
          dev: 'tsx watch index.ts'
        },
        dependencies: {
          express: '^4.18.2',
          zod: '^3.22.4',
          'swagger-ui-express': '^5.0.0',
          'swagger-jsdoc': '^6.2.8',
          cors: '^2.8.5',
          dotenv: '^16.3.1',
          multer: '^1.4.5-lts.1',
          pocketbase: '^0.21.0'
        },
        devDependencies: {
          tsx: '^4.7.0',
          '@types/express': '^4.17.21',
          '@types/cors': '^2.8.17',
          '@types/swagger-ui-express': '^4.1.6',
          '@types/multer': '^1.4.12'
        }
      };

      const apiFilesToSave: Record<string, string> = {
        'API/package.json': JSON.stringify(apiPackageJson, null, 2),
        'API/README.md': `# ${result.title || formData.appName} API\n\n${result.description || description}\n\n## Instalación\n\n\`\`\`bash\nnpm install\n\`\`\`\n\n## Ejecución\n\n\`\`\`bash\nnpm start\n\`\`\`\n\n## Documentación API\n\n${result.documentation || ''}`,
        'API/schemas.ts': result.schemas || '',
        'API/documentation.md': result.documentation || '',
        'API/endpoints.json': JSON.stringify(result.endpoints || [], null, 2),
        'API/index.ts': (() => {
          let code = result.code || '';
          if (!code.includes('dotenv')) {
            code = `import 'dotenv/config';\n${code}`;
          }
          if (!/import\s+.*pocketbase/i.test(code) && !/require\s*\(\s*['"]pocketbase['"]\s*\)/i.test(code)) {
            code = `import { pb, authAsAdmin } from './pocketbase';\n${code}`;
          }
          return code;
        })(),
        'API/zeus-api-config.json': JSON.stringify(apiConfigData, null, 2),
        'API/pb_schema.json': generatePbSchema(result.endpoints || [], result.title || formData.appName)
      };

      let apiSavedCount = 0;
      for (const [filePath, content] of Object.entries(apiFilesToSave)) {
        if (!content || content.trim().length === 0) continue;
        try {
          const res = await sessionFetch('/api/save-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ skipBackup: true, filePath, content, projectRoot })
          });
          if (res.ok) {
            apiSavedCount++;
            console.log(`[autoGenerateApi] Guardado: ${filePath}`);
          } else {
            console.error(`[autoGenerateApi] Error guardando ${filePath}:`, await res.text());
          }
        } catch (err) {
          console.error(`[autoGenerateApi] Excepción guardando ${filePath}:`, err);
        }
      }
      console.log(`[autoGenerateApi] ${apiSavedCount} archivos de API guardados en API/`);

      // ✅ Generar componentes de UI para la API directamente usando los endpoints
      const endpoints: any[] = Array.isArray(result?.endpoints) ? result.endpoints : [];
      if (endpoints.length > 0) {
        setApiAutoGenStatus('Generando componentes de UI para la API...');
        const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

        // Helper: reemplaza {param} en el path por template literal interpolation
        const buildPath = (path: string, paramKeys: string[]) => {
          let p = path;
          paramKeys.forEach((k: string) => {
            p = p.replace(`{${k}}`, `\${encodeURIComponent(String(${k}))}`);
          });
          // Reemplaza placeholders genéricos restantes como {id}
          p = p.replace(/\{([^}]+)\}/g, '\${encodeURIComponent(String($1))}');
          return p;
        };

        // 1) ApiClient.ts
        const clientFunctions = endpoints.map((ep: any) => {
          const fnName = ep.path.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'call' + ep.id;
          const paramKeys = ep.parameters && Object.keys(ep.parameters).length > 0 ? Object.keys(ep.parameters) : [];
          const paramsStr = paramKeys.length > 0 ? paramKeys.join(', ') : '';
          const pathWithParams = buildPath(ep.path, paramKeys);
          const queryKeys = paramKeys.filter((k: string) => !ep.path.includes(`{${k}}`));
          const queryStr = ['GET', 'DELETE'].includes(ep.method) && queryKeys.length > 0
            ? `?${queryKeys.map((k: string) => `${k}=\${encodeURIComponent(String(${k} || ''))}`).join('&')}`
            : '';
          const bodyStr = ['POST', 'PUT', 'PATCH'].includes(ep.method) && paramKeys.length > 0
            ? `, body: JSON.stringify({ ${paramsStr} })`
            : '';
          return `export async function ${fnName}(${paramsStr ? paramsStr + ': any' : ''}) {
  const res = await fetch(\`${baseUrl}${pathWithParams}${queryStr}\`, {
    method: '${ep.method}',
    headers: { 'Content-Type': 'application/json' }${bodyStr}
  });
  if (!res.ok) throw new Error('${ep.method} ${ep.path} failed: ' + res.status);
  return res.json();
}`;
        }).join('\n\n');

        const apiClientContent = `// Auto-generated API client for ${result.title || 'API'}\nconst BASE_URL = process.env.NEXT_PUBLIC_API_URL || '${baseUrl}';\n\n${clientFunctions}\n`;

        // 2) ApiDashboard.tsx
        const epRows = endpoints.map((ep: any, idx: number) => {
          const paramFields = ep.parameters
            ? Object.keys(ep.parameters).map((k: string) => `                      <div className="flex flex-col">
                        <label className="text-xs text-muted-foreground">${k}</label>
                        <input type="text" value={params[${idx}]['${k}'] || ''} onChange={(e) => updateParam(${idx}, '${k}', e.target.value)} className="bg-card border border-border/50 rounded px-2 py-1 text-sm text-foreground" />
                      </div>`).join('\n')
            : '';
          const colorClass = ep.method === 'GET' ? 'bg-success/30 text-success' : ep.method === 'POST' ? 'bg-primary text-primary-foreground' : ep.method === 'PUT' || ep.method === 'PATCH' ? 'bg-yellow-900 text-yellow-300' : 'bg-red-900 text-red-300';
          return `              <tr key="${ep.id}" className="border-b border-border/80">
                <td className="px-3 py-2 text-sm"><span className="inline-block px-2 py-0.5 rounded text-xs font-bold ${colorClass}">${ep.method}</span></td>
                <td className="px-3 py-2 text-sm text-foreground/70">${ep.path}</td>
                <td className="px-3 py-2 text-sm text-muted-foreground">${ep.description || ''}</td>
                <td className="px-3 py-2">
${paramFields}
                  <button onClick={() => testEndpoint(${idx})} className="mt-2 px-3 py-1 bg-cyan-700 hover:bg-cyan-600 text-foreground text-xs rounded">{loading[${idx}] ? 'Ejecutando...' : 'Probar'}</button>
                  {results[${idx}] && (
                    <div className="mt-2 text-xs bg-background border border-border/50 rounded p-2 max-h-32 overflow-auto">
                      <pre className="text-success">{JSON.stringify(results[${idx}], null, 2)}</pre>
                    </div>
                  )}
                  {errors[${idx}] && (
                    <div className="mt-2 text-xs text-destructive">{errors[${idx}]}</div>
                  )}
                </td>
              </tr>`;
        }).join('\n');

        const initialParams = endpoints.map(() => '{}').join(', ');
        const testFunctions = endpoints.map((ep: any, idx: number) => {
          const paramKeys = ep.parameters ? Object.keys(ep.parameters) : [];
          // Reemplaza {param} en el path por template literals
          let pathWithParams = ep.path;
          paramKeys.forEach((k: string) => {
            pathWithParams = pathWithParams.replace(`{${k}}`, `\${encodeURIComponent(params[${idx}]['${k}'] || '')}`);
          });
          pathWithParams = pathWithParams.replace(/\{([^}]+)\}/g, '\${encodeURIComponent(params[' + idx + '][\'$1\'] || \'\')}');
          const queryKeys = paramKeys.filter((k: string) => !ep.path.includes(`{${k}}`));
          const queryStr = ['GET', 'DELETE'].includes(ep.method) && queryKeys.length > 0
            ? `?${queryKeys.map((k: string) => `${k}=\${encodeURIComponent(params[${idx}]['${k}'] || '')}`).join('&')}`
            : '';
          const bodyStr = ['POST', 'PUT', 'PATCH'].includes(ep.method) && paramKeys.length > 0
            ? `JSON.stringify(params[${idx}])`
            : 'undefined';
          return `      case ${idx}:
        res = await fetch(\`${baseUrl}${pathWithParams}${queryStr}\`, { method: '${ep.method}', headers: { 'Content-Type': 'application/json' }${bodyStr !== 'undefined' ? `, body: ${bodyStr}` : ''} });
        break;`;
        }).join('\n');

        const apiDashboardContent = `'use client';
import React, { useState } from 'react';

const ENDPOINTS = ${JSON.stringify(endpoints.map((ep: any) => ({ id: ep.id, method: ep.method, path: ep.path, description: ep.description })))};

export default function ApiDashboard() {
  const [params, setParams] = useState<any[]>([${initialParams}]);
  const [files, setFiles] = useState<Record<number, File | null>>({});
  const [results, setResults] = useState<Record<number, any>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState<Record<number, boolean>>({});

  const updateParam = (idx: number, key: string, value: any) => {
    setParams(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [key]: value };
      return next;
    });
  };

  const updateFileParam = (idx: number, file: File | null) => {
    setFiles(prev => ({ ...prev, [idx]: file }));
  };

  const testEndpoint = async (idx: number) => {
    setLoading(prev => ({ ...prev, [idx]: true }));
    setErrors(prev => ({ ...prev, [idx]: '' }));
    try {
      const ep = ENDPOINTS[idx];
      let res;
      switch (idx) {
${testFunctions}
      }
      if (!res.ok) throw new Error(ep.method + ' ' + ep.path + ' failed: ' + res.status);
      const data = await res.json();
      setResults(prev => ({ ...prev, [idx]: data }));
    } catch (err: any) {
      setErrors(prev => ({ ...prev, [idx]: err.message || 'Error' }));
    } finally {
      setLoading(prev => ({ ...prev, [idx]: false }));
    }
  };

  return (
    <div className="p-6 bg-background text-foreground/90 min-h-screen">
      <h1 className="text-2xl font-bold mb-4">API Dashboard</h1>
      <p className="text-muted-foreground mb-6">${result?.title || 'API'} — ${endpoints.length} endpoints disponibles</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left border border-border/80 rounded-lg">
          <thead className="bg-background">
            <tr>
              <th className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Método</th>
              <th className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Path</th>
              <th className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Descripción</th>
              <th className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Acción</th>
            </tr>
          </thead>
          <tbody>
${epRows}
          </tbody>
        </table>
      </div>
    </div>
  );
}
`;

        const apiClientPageContent = `'use client';
import ApiDashboard from '@/components/api/ApiDashboard';

export default function ApiClientPage() {
  return <ApiDashboard />;
}
`;

        const uiFiles: Record<string, string> = {
          'components/api/ApiClient.ts': apiClientContent,
          'components/api/ApiDashboard.tsx': apiDashboardContent,
          'app/api-client/page.tsx': apiClientPageContent
        };

        let uiSavedCount = 0;
        for (const [filePath, content] of Object.entries(uiFiles)) {
          if (!content || content.trim().length === 0) continue;
          try {
            const res = await sessionFetch('/api/save-file', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ skipBackup: true, filePath, content, projectRoot })
            });
            if (res.ok) {
              uiSavedCount++;
              console.log(`[autoGenerateApi] UI guardado: ${filePath}`);
            } else {
              console.error(`[autoGenerateApi] Error guardando UI ${filePath}:`, await res.text());
            }
          } catch (err) {
            console.error(`[autoGenerateApi] Excepción guardando UI ${filePath}:`, err);
          }
        }
        console.log(`[autoGenerateApi] ${uiSavedCount} archivos de UI guardados`);
      }

      setApiAutoGenStatus('API generada y configurada correctamente');
      setAutoGeneratedApiData(result);
      autoGeneratedApiDataRef.current = result;

      await new Promise(r => setTimeout(r, 1000));
      return result;
    } catch (err) {
      console.error('[autoGenerateApi] Error:', err);
      setApiAutoGenStatus('Error al generar API. Continuando sin API personalizada...');
      await new Promise(r => setTimeout(r, 2000));
      return null;
    } finally {
      setApiAutoGenerating(false);
    }
  }, [selectedModel, formData.appName, projectRoot]);

  // Step 1: Generate project structure (OPTIMIZADO)
  const generateStructure = useCallback(async (arg1?: any, arg2?: any) => {
    console.log('generateStructure called with args:', {
      arg1,
      arg2
    });

    // Resetear ref de transición para cada nueva generación
    hasTransitionedToCompleteRef.current = false;

    // Validación adicional de seguridad antes de proceder
    if (!formData.appName || !formData.template || !formData.description?.trim() || !selectedModel) {
      setError(t('step1Incomplete'));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // ── AUTO-GENERATE API (si la feature 'api' está seleccionada) ──
      // Antes de generar la estructura de la app, usamos los recursos del API Generator
      // para crear la API que la aplicación necesita, y luego inyectamos su contexto.
      const selectedFeatures = Array.isArray(formData.features) ? formData.features : [];
      if (selectedFeatures.includes('api')) {
        console.log('🔗 Feature "api" seleccionada → Auto-generando API con API Generator antes de la app');
        const apiResult = await autoGenerateApi(formData.description);
        if (apiResult) {
          console.log('✅ API auto-generada correctamente. Su contexto se inyectará en la generación de la app.');
          // La API config ya fue guardada en zeus-api-config.json por autoGenerateApi,
          // y los endpoints de generate-app-*/structure ya la inyectan automáticamente
          // cuando la feature 'api' está activa (readApiConfig).
        } else {
          console.warn('⚠️ No se pudo auto-generar la API. Continuando con la generación de la app sin API personalizada.');
        }
      }

      // OPTIMIZACIÓN 1: Usar AbortController con timeout más corto para estructura
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout para estructura

      console.log('📡 Enviando solicitud al backend para generar estructura');

      // Prepare uploaded files data
      const uploadedFilesData = await Promise.all(uploadedFiles.map(async file => {
        const content = await file.text();
        return {
          name: file.name,
          type: file.type,
          size: file.size,
          content: content
        };
      }));
      // Procesar imágenes subidas (archivos File)
      const uploadedImagesData = await Promise.all(uploadedImages.map(async file => {
        return new Promise<{
          name: string;
          type: string;
          size: number;
          dataUrl: string;
          path: string;
          url?: string;
        }>(resolve => {
          const reader = new FileReader();
          reader.onload = () => {
            resolve({
              name: file.name,
              type: file.type,
              size: file.size,
              dataUrl: reader.result as string,
              path: `/uploads/${file.name}`
            });
          };
          reader.readAsDataURL(file);
        });
      }));

      // Procesar imágenes seleccionadas de Unsplash (URLs)
      const selectedImagesData = selectedImageUrls.map((url, index) => {
        // Extraer nombre de la URL o usar un nombre descriptivo
        const urlName = url.split('/').pop()?.split('?')[0] || `selected-image-${index + 1}.jpg`;
        return {
          name: urlName,
          type: 'image/jpeg', // Unsplash generalmente devuelve JPEG
          size: 0, // No tenemos el tamaño de las URLs
          dataUrl: '', // No tenemos el dataUrl, usaremos la URL directamente
          url: url // ✅ Agregar la URL para que la API pueda usarla
        };
      });

      // Combinar imágenes subidas y seleccionadas
      const allImagesData = [...uploadedImagesData, ...selectedImagesData];

      // Determine API endpoint based on template and appType
      let apiEndpoint = '/api/generate-app-page-web/structure'; // Default for static pages

      if (formData.template === 'next-js' && formData.appType === 'web-app') {
        // App Web (Next.js web application)
        apiEndpoint = '/api/generate-app/structure';
      } else if (formData.template === 'next-js' && formData.appType === 'mobile-app') {
        // App Móvil (Next.js mobile application)
        apiEndpoint = '/api/generate-app-movil/structure';
      } else if (formData.template === 'next-js' && formData.appType === 'desktop-app') {
        // App Escritorio (Electron/Next.js)
        apiEndpoint = '/api/generate-app-escritorio/structure';
      } else if (formData.template === 'next-js' && !formData.appType || formData.template === 'vite-react' || ['html-css-js', 'astro', 'eleventy'].includes(formData.template)) {
        // Página Web (Next.js static pages) or other static templates
        apiEndpoint = '/api/generate-app-page-web/structure';
      } else if (['react-native', 'flutter', 'swift-ui', 'kotlin-compose'].includes(formData.template)) {
        // Native mobile frameworks
        apiEndpoint = '/api/generate-app-movil/structure';
      }

      // DEBUG: Comprehensive log of what we're sending to the API
      const requestData = {
        ...formData,
        projectId: projectId,
        projectRoot: projectRoot,
        modelConfig: selectedModel,
        optimizeForSpeed: true,
        uploadedFiles: uploadedFilesData,
        uploadedImages: allImagesData,
        // Configurar automáticamente authMethod cuando se selecciona authentication
        authMethod: formData.features.includes('authentication') ? 'pocketbase' : 'none',
        requiresAuth: formData.features.includes('authentication'),
        // Configurar automáticamente databaseType cuando se selecciona database
        databaseType: formData.features.includes('database') ? 'pocketbase' : 'none',
        requiresDatabase: formData.features.includes('database')
      };
      console.log(`🔍 DEBUG - Complete request data being sent to ${apiEndpoint}:`);
      console.log(`   Template: "${formData.template}"`);
      console.log(`   AppType: "${formData.appType}" (type: ${typeof formData.appType})`);
      console.log(`   AppName: "${formData.appName}"`);
      console.log(`   Complexity: "${formData.complexity}"`);
      console.log(`   Selected API Endpoint: ${apiEndpoint}`);
      console.log(`   Full request body:`, JSON.stringify(requestData, null, 2));

      // Additional routing debug
      console.log(`🔍 ROUTING DEBUG:`);
      console.log(`   Condition 1 (next-js + web-app): ${formData.template === 'next-js' && formData.appType === 'web-app'}`);
      console.log(`   Condition 2 (next-js + mobile-app): ${formData.template === 'next-js' && formData.appType === 'mobile-app'}`);
      console.log(`   Condition 3 (next-js page-web or vite-react): ${formData.template === 'next-js' && !formData.appType || formData.template === 'vite-react' || ['html-css-js', 'astro', 'eleventy'].includes(formData.template)}`);
      console.log(`   Condition 4 (native mobile): ${['react-native', 'flutter', 'swift-ui', 'kotlin-compose'].includes(formData.template)}`);
      console.log(`   Final endpoint: ${apiEndpoint}`);

      // TEST: Force different endpoint for debugging
      if (formData.template === 'vite-react') {
        console.log(`🚨 TEST - Forcing vite-react to use page-web API`);
        apiEndpoint = '/api/generate-app-page-web/structure';
      }
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData),
        signal: controller.signal
      });
      console.log('✅ Respuesta recibida del backend');
      clearTimeout(timeoutId);
      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${response.statusText}`);
      }
      const result = await response.json();

      // Mostrar información del modo rápido al usuario
      if (result.metadata?.fastMode) {
        console.log('✅ CONFIRMACIÓN: Modo Rápido ejecutado correctamente');
        console.log(`⚡ Tiempo de procesamiento: ${result.metadata.processingTime}ms`);
        console.log('🎯 Optimización: Descripción IA saltada para mayor velocidad');
      }

      // --- Package.json y pocket-base según features (authentication, database o chat) ---
      // Solo si el usuario ha seleccionado EXPLÍCITAMENTE una de estas 3 opciones
      const features = Array.isArray(formData.features) ? formData.features : [];
      const needsPocketBase = features.includes('authentication') || features.includes('database') || features.includes('chat') || features.includes('api');
      console.log('🔍 needsPocketBase:', needsPocketBase, '| features:', features);

      // Generar puerto aleatorio para PocketBase (entre 8091 y 8999) si se necesita
      const pbPort = needsPocketBase ? Math.floor(Math.random() * (8999 - 8091 + 1)) + 8091 : 8090;

      // Si NO se necesita PocketBase: eliminar solo pocket-base (scripts se crea siempre)
      if (!needsPocketBase && result && Array.isArray(result.structure)) {
        const struct = result.structure as FileStructure[];
        const pbIdx = struct.findIndex((item: any) => item.type === 'directory' && item.name === 'pocket-base');
        if (pbIdx >= 0) {
          struct.splice(pbIdx, 1);
          console.log('🗑️ Eliminada carpeta pocket-base (no seleccionadas auth/database/chat)');
        }
      }

      const rootPackageJsonFile = (result.structure as FileStructure[]).find((file: FileStructure) => file.name === 'package.json' && (file.path === 'package.json' || file.path === '/package.json'));
      if (rootPackageJsonFile && rootPackageJsonFile.content) {
        try {
          let packageJsonContent = JSON.parse(rootPackageJsonFile.content);
          // Corregir si la IA puso contenido de pocketbase-installer en el package.json raíz
          if (packageJsonContent.name === 'pocketbase-installer') {
            console.warn('⚠️ package.json raíz tenía contenido pocketbase-installer; corrigiendo con contenido del proyecto.');
            packageJsonContent = {
              name: formData.appName || 'my-app',
              version: '0.1.0',
              private: true,
              scripts: { dev: 'next dev -p 3000', build: 'next build', start: 'next start' },
              dependencies: { next: '^14.0.0', react: '^18.2.0', 'react-dom': '^18.2.0' }
            };
          }
          if (!packageJsonContent.scripts) {
            packageJsonContent.scripts = {};
          }
          if (!packageJsonContent.devDependencies) {
            packageJsonContent.devDependencies = {};
          }

          if (features.includes('api')) {
            packageJsonContent.scripts.api = 'tsx API/index.ts';
            if (!packageJsonContent.devDependencies.tsx) {
              packageJsonContent.devDependencies.tsx = '^4.7.0';
            }
            if (!packageJsonContent.dependencies) {
              packageJsonContent.dependencies = {};
            }
            const apiDeps: Record<string, string> = {
              express: '^4.18.2',
              zod: '^3.22.4',
              'swagger-ui-express': '^5.0.0',
              'swagger-jsdoc': '^6.2.8',
              cors: '^2.8.5',
              dotenv: '^16.3.1'
            };
            for (const [dep, version] of Object.entries(apiDeps)) {
              if (!packageJsonContent.dependencies[dep]) {
                packageJsonContent.dependencies[dep] = version;
              }
            }
          }

          if (needsPocketBase) {
            const parts = ['next dev -p 3000'];
            parts.push(`pocket-base\\\\pocketbase.exe serve --dir=pocket-base\\\\pb_data --http=127.0.0.1:${pbPort}`);
            if (features.includes('api')) {
              parts.push('npm run api');
            }
            packageJsonContent.scripts.dev = `concurrently ${parts.map(p => `"${p}"`).join(' ')}`;
            packageJsonContent.scripts.postinstall = 'node scripts/postinstall.js';
          } else if (features.includes('api')) {
            packageJsonContent.scripts.dev = `concurrently "next dev -p 3000" "npm run api"`;
            packageJsonContent.scripts.postinstall = 'node scripts/postinstall.js';
          } else {
            packageJsonContent.scripts.dev = 'next dev -p 3000';
            delete packageJsonContent.scripts.postinstall;
          }
          rootPackageJsonFile.content = JSON.stringify(packageJsonContent, null, 2);
          const logMsg = needsPocketBase
            ? `✅ Añadidos scripts dev y postinstall (pocket-base) al package.json`
            : '✅ Añadido script dev simple al package.json';
          console.log(logMsg);
        } catch (parseError) {
          console.error('Error parsing root package.json content for scripts:', parseError);
        }
      }

      // Post-procesar next.config.js: asegurar que existe si hay feature API
      if (features.includes('api') && result && Array.isArray(result.structure)) {
        try {
          const struct = result.structure as FileStructure[];
          const hasNextConfig = struct.some((f: FileStructure) => f.type === 'file' && (f.name === 'next.config.js' || f.name === 'next.config.ts' || f.name === 'next.config.mjs'));
          if (!hasNextConfig) {
            struct.push({
              name: 'next.config.js',
              type: 'file' as const,
              path: '/next.config.js',
              content: `/** @type {import('next').NextConfig} */\nconst nextConfig = {};\nmodule.exports = nextConfig;\n`
            });
            console.log('✅ next.config.js creado (feature API activa)');
          }
        } catch (e) {
          console.warn('Error post-procesando next.config.js:', e);
        }
      }

      // Carpeta scripts siempre: install-pocketbase.js y start-pocketbase.js
      if (result && Array.isArray(result.structure)) {
        try {
          const installScriptContent = `// Ejecutado por postinstall cuando el proyecto usa PocketBase
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const rootPath = process.cwd();
const pocketBasePath = path.join(rootPath, 'pocket-base');
const installScriptPath = path.join(pocketBasePath, 'install.js');

if (fs.existsSync(installScriptPath)) {
  try {
    process.chdir(pocketBasePath);
    execSync('node install.js', { stdio: 'inherit' });
    console.log('✅ Instalación de PocketBase completada');
  } catch (err) {
    console.error('❌ Error instalando PocketBase:', err?.message);
  } finally {
    process.chdir(rootPath);
  }
} else {
  console.log('ℹ️ Sin pocket-base: omitiendo (si se añade después, ejecuta: node scripts/install-pocketbase.js)');
}`;

          const startPocketbaseContent = `#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const pocketBaseDir = path.join(process.cwd(), 'pocket-base');
const executableName = process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase';
const executablePath = path.join(pocketBaseDir, executableName);

if (!fs.existsSync(executablePath)) {
  console.error('❌ No se encontró PocketBase en:', executablePath);
  console.error('Ejecuta primero: node scripts/install-pocketbase.js');
  process.exit(1);
}

const child = spawn(executablePath, ['serve', '--http=0.0.0.0:${pbPort}'], {
  cwd: pocketBaseDir,
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 0));
`;

          const postinstallScriptContent = `const fs = require('fs');
const { execSync } = require('child_process');

let exitCode = 0;

if (fs.existsSync('API/package.json')) {
  console.log('[postinstall] Installing API dependencies...');
  try {
    execSync('npm install --prefix ./API', { stdio: 'inherit' });
    console.log('[postinstall] API dependencies installed.');
  } catch (err) {
    console.error('[postinstall] Failed to install API dependencies:', err.message);
    exitCode = 1;
  }
}

if (fs.existsSync('scripts/install-pocketbase.js')) {
  console.log('[postinstall] Installing PocketBase...');
  try {
    execSync('node scripts/install-pocketbase.js', { stdio: 'inherit' });
    console.log('[postinstall] PocketBase installed.');
  } catch (err) {
    console.error('[postinstall] Failed to install PocketBase:', err.message);
  }
}

if (fs.existsSync('scripts/setup-pocketbase-schema.js')) {
  console.log('[postinstall] Setting up PocketBase schema...');
  try {
    execSync('node scripts/setup-pocketbase-schema.js', { stdio: 'inherit' });
    console.log('[postinstall] PocketBase schema set up.');
  } catch (err) {
    console.error('[postinstall] Failed to set up PocketBase schema:', err.message);
  }
}

process.exit(exitCode);
`;

          const setupSchemaContent = `const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const rootPath = process.cwd();
const pocketBasePath = path.join(rootPath, 'pocket-base');
const executableName = process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase';
const executablePath = path.join(pocketBasePath, executableName);
const schemaPath = path.join(rootPath, 'API', 'pb_schema.json');

// Cargar variables de .env manualmente
const envPath = path.join(rootPath, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split(/\\r?\\n/)) {
    const idx = line.indexOf('=');
    if (idx > 0 && !line.startsWith('#')) {
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (key && value && !process.env[key]) process.env[key] = value;
    }
  }
}

const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL || 'francisco@gmail.com';
const ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD || '1234512345';

if (!fs.existsSync(executablePath)) {
  console.log('ℹ️ PocketBase no encontrado. Omitiendo configuración de schema.');
  process.exit(0);
}

if (!fs.existsSync(schemaPath)) {
  console.log('ℹ️ API/pb_schema.json no encontrado. Omitiendo configuración de schema.');
  process.exit(0);
}

function findFreePort(start = 18091) {
  const net = require('net');
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(start, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', () => resolve(findFreePort(start + 1)));
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function waitForPocketBase(port, retries = 30) {
  const url = 'http://127.0.0.1:' + port + '/api/health';
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {}
    await sleep(1000);
  }
  return false;
}

async function tryLogin(port) {
  const endpoints = [
    '/api/admins/auth-with-password', // PocketBase <= 0.22
    '/api/collections/_superusers/auth-with-password' // PocketBase >= 0.23
  ];
  
  for (const endpoint of endpoints) {
    try {
      const res = await fetch('http://127.0.0.1:' + port + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      });
      if (res.ok) {
        const data = await res.json();
        return data.token || null;
      }
    } catch (e) {
      // Continuar al siguiente endpoint
    }
  }
  return null;
}

function makeHeaders(token) {
  return { 'Content-Type': 'application/json', 'Authorization': token };
}

async function readBodyText(res) {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

async function createCollection(port, token, collection) {
  try {
    const res = await fetch('http://127.0.0.1:' + port + '/api/collections', {
      method: 'POST',
      headers: makeHeaders(token),
      body: JSON.stringify(collection)
    });
    if (res.ok) return { ok: true, created: true };
    const text = await readBodyText(res);
    if (res.status === 400) {
      try {
        const data = JSON.parse(text);
        if (data?.data?.name?.code === 'validation_not_unique_value') {
          return { ok: true, created: false, exists: true };
        }
      } catch {}
    }
    return { ok: false, status: res.status, text };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function updateCollection(port, token, collection) {
  try {
    const listRes = await fetch('http://127.0.0.1:' + port + '/api/collections?page=1&perPage=500', {
      headers: makeHeaders(token)
    });
    const listText = await readBodyText(listRes);
    let listData;
    try { listData = JSON.parse(listText); } catch { listData = {}; }
    const existing = listData?.items?.find(c => c.name === collection.name);
    if (!existing) return { ok: false, text: 'Collection not found for update' };
    const res = await fetch('http://127.0.0.1:' + port + '/api/collections/' + existing.id, {
      method: 'PATCH',
      headers: makeHeaders(token),
      body: JSON.stringify(collection)
    });
    if (res.ok) return { ok: true, updated: true };
    const text = await readBodyText(res);
    return { ok: false, status: res.status, text };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function importCollectionsFallback(port, token, schema) {
  console.log('📦 Importando colecciones una por una (fallback)...');
  let created = 0, updated = 0, failed = 0;
  for (const col of schema) {
    const result = await createCollection(port, token, col);
    if (result.ok && result.created) {
      console.log('✅ Colección creada:', col.name);
      created++;
    } else if (result.ok && result.exists) {
      console.log('📝 Colección ya existe, actualizando:', col.name);
      const upResult = await updateCollection(port, token, col);
      if (upResult.ok) updated++;
      else { console.error('❌ Error actualizando', col.name + ':', upResult.text || upResult.error); failed++; }
    } else {
      console.error('❌ Error creando', col.name + ':', result.text || result.error);
      failed++;
    }
  }
  console.log('📊 Resultado fallback: ' + created + ' creadas, ' + updated + ' actualizadas, ' + failed + ' fallidas.');
  return failed === 0;
}

async function safeExit(pbProcess, code = 0) {
  if (pbProcess && !pbProcess.killed) {
    try { pbProcess.stdin?.end?.(); pbProcess.kill(); await sleep(1000); } catch (e) {}
  }
  await sleep(500);
  process.exit(code);
}

async function importSchema() {
  const port = await findFreePort();
  console.log('🚀 Iniciando PocketBase temporalmente en puerto ' + port + '...');

  const pbProcess = spawn(executablePath, ['serve', '--http=127.0.0.1:' + port, '--dir=' + path.join(pocketBasePath, 'pb_data')], {
    cwd: pocketBasePath,
    stdio: 'pipe',
    detached: false
  });

  pbProcess.on('error', async (err) => {
    console.error('❌ Error iniciando PocketBase:', err.message);
    await safeExit(pbProcess, 1);
  });

  const ready = await waitForPocketBase(port);
  if (!ready) {
    console.error('❌ PocketBase no respondió a tiempo.');
    await safeExit(pbProcess, 1);
  }

  console.log('✅ PocketBase listo. Intentando login...');

  let token = await tryLogin(port);

  // Si falla login, intentar crear superuser y reintentar
  if (!token) {
    console.log('ℹ️ Login falló. Intentando crear superuser...');
    try {
      const quote = process.platform === 'win32' ? '\"' : '"';
      execSync(quote + executablePath + quote + ' superuser create ' + quote + ADMIN_EMAIL + quote + ' ' + quote + ADMIN_PASSWORD + quote, {
        cwd: pocketBasePath,
        stdio: 'pipe',
        timeout: 10000,
        windowsHide: true
      });
      console.log('✅ Superuser creado. Reintentando login...');
      token = await tryLogin(port);
    } catch {
      console.log('ℹ️ No se pudo crear superuser (probablemente ya existe).');
    }
  }

  if (!token) {
    console.error('❌ No se pudo autenticar como admin.');
    console.error('💡 Verifica PB_ADMIN_EMAIL y PB_ADMIN_PASSWORD en tu archivo .env');
    await safeExit(pbProcess, 1);
  }

  console.log('🔑 Autenticado. Importando schema...');

  // Leer schema
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

  // Asegurar que ninguna colección tenga schema vacío (PocketBase lo rechaza)
  const rndId = (length = 15) => {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < length; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  };
  
  if (!Array.isArray(schema)) {
    console.error('❌ El esquema no es un array válido.');
    await safeExit(pbProcess, 1);
  }

  for (const col of schema) {
    // PocketBase < 0.23 usa .schema, >= 0.23 usa .fields
    const hasSchema = Array.isArray(col.schema) && col.schema.length > 0;
    const hasFields = Array.isArray(col.fields) && col.fields.length > 0;

    if (!hasSchema && !hasFields) {
      console.log('⚠️ Colección "' + col.name + '" tiene schema/fields vacío. Añadiendo campo title de respaldo.');
      const titleField = {
        system: false,
        id: rndId(8),
        name: 'title',
        type: 'text',
        required: false,
        presentable: false,
        unique: false,
        options: { min: null, max: null, pattern: '' }
      };
      col.schema = [titleField];
      col.fields = [titleField];
    } else {
      // Sincronizar ambos campos por si acaso
      if (hasSchema && !hasFields) col.fields = col.schema;
      if (hasFields && !hasSchema) col.schema = col.fields;
    }
  }

  console.log('📦 Preparadas ' + schema.length + ' colecciones para importar.');

  // Importar collections
  // Nota: En PocketBase <= 0.22, el token de admin suele ir sin el prefijo "Bearer "
  const tryImport = async (authToken) => {
    try {
      const res = await fetch('http://127.0.0.1:' + port + '/api/collections/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authToken
        },
        body: JSON.stringify({ collections: schema, deleteMissing: true })
      });
      return res;
    } catch (e) {
      return { ok: false, status: 0, text: () => Promise.resolve(e.message) };
    }
  };

  let importRes = await tryImport(token);
  
  // Si falla con 401, 403 o 404, intentar con Bearer
  // A veces 404 puede ser devuelto si el endpoint requiere Bearer y no lo tiene (dependiendo de la versión/config)
  if (!importRes.ok && (importRes.status === 401 || importRes.status === 403 || importRes.status === 404)) {
    console.log('ℹ️ Reintentando importación con prefijo Bearer (Status anterior: ' + importRes.status + ')...');
    importRes = await tryImport('Bearer ' + token);
  }

  if (!importRes.ok) {
    const errText = await (typeof importRes.text === 'function' ? importRes.text() : Promise.resolve('Unknown error'));
    console.error('❌ Error importando schema bulk (Status ' + importRes.status + '):', errText);

    // Fallback: si es 404, crear colecciones una por una
    if (importRes.status === 404) {
      console.log('ℹ️ El endpoint /api/collections/import no está disponible. Usando fallback...');
      const fallbackOk = await importCollectionsFallback(port, token, schema);
      if (fallbackOk) {
        console.log('✅ Schema importado correctamente via fallback.');
        await safeExit(pbProcess, 0);
      }
    }

    // Intentar listar colecciones para diagnóstico
    try {
      const listRes = await fetch('http://127.0.0.1:' + port + '/api/collections?limit=1', {
        headers: makeHeaders(token)
      });
      console.log('🔍 Diagnóstico: GET /api/collections status:', listRes.status);
    } catch (diagErr) {
      console.log('🔍 Diagnóstico: Error consultando colecciones:', diagErr.message);
    }

    await safeExit(pbProcess, 1);
  }

  console.log('✅ Schema importado correctamente en PocketBase.');
  await safeExit(pbProcess, 0);
}

importSchema().catch(err => {
  console.error('❌ Error en setup-pocketbase-schema:', err);
  process.exit(1);
});
`;

          let scriptsDir = (result.structure as FileStructure[]).find((item: FileStructure) => (item.path === 'scripts' || item.path === '/scripts') && item.type === 'directory');
          if (!scriptsDir) {
            scriptsDir = { name: 'scripts', type: 'directory' as const, path: 'scripts', children: [] as FileStructure[] };
            (result.structure as FileStructure[]).push(scriptsDir);
            console.log('✅ Carpeta scripts creada');
          }
          if (!scriptsDir.children) scriptsDir.children = [];

          const hasInstallPb = (scriptsDir.children as FileStructure[]).some((f: FileStructure) => f.name === 'install-pocketbase.js');
          if (!hasInstallPb) {
            (scriptsDir.children as FileStructure[]).push({
              name: 'install-pocketbase.js',
              type: 'file' as const,
              path: 'scripts/install-pocketbase.js',
              content: installScriptContent
            });
            console.log('✅ install-pocketbase.js añadido');
          }
          const hasStartPb = (scriptsDir.children as FileStructure[]).some((f: FileStructure) => f.name === 'start-pocketbase.js');
          if (!hasStartPb) {
            (scriptsDir.children as FileStructure[]).push({
              name: 'start-pocketbase.js',
              type: 'file' as const,
              path: 'scripts/start-pocketbase.js',
              content: startPocketbaseContent
            });
            console.log('✅ start-pocketbase.js añadido');
          }
          const hasSetupSchema = (scriptsDir.children as FileStructure[]).some((f: FileStructure) => f.name === 'setup-pocketbase-schema.js');
          if (!hasSetupSchema) {
            (scriptsDir.children as FileStructure[]).push({
              name: 'setup-pocketbase-schema.js',
              type: 'file' as const,
              path: 'scripts/setup-pocketbase-schema.js',
              content: setupSchemaContent
            });
            console.log('✅ setup-pocketbase-schema.js añadido');
          }
          const hasPostinstall = (scriptsDir.children as FileStructure[]).some((f: FileStructure) => f.name === 'postinstall.js');
          if (!hasPostinstall) {
            (scriptsDir.children as FileStructure[]).push({
              name: 'postinstall.js',
              type: 'file' as const,
              path: 'scripts/postinstall.js',
              content: postinstallScriptContent
            });
            console.log('✅ postinstall.js añadido');
          }
        } catch (e) {
          console.warn('Error creando carpeta scripts:', e);
        }
      }

      // Añadir .env con credenciales de PocketBase
      if (needsPocketBase && result && Array.isArray(result.structure)) {
        try {
          const struct = result.structure as FileStructure[];
          const hasEnv = struct.some((item: FileStructure) => item.type === 'file' && item.name === '.env');
          if (!hasEnv) {
            let envContent = `PB_ADMIN_EMAIL=francisco@gmail.com\nPB_ADMIN_PASSWORD=1234512345\nNEXT_PUBLIC_PB_URL=http://127.0.0.1:${pbPort}\n`;
            if (features.includes('api')) {
              envContent += 'NEXT_PUBLIC_API_URL=http://localhost:3001\n';
            }
            struct.push({
              name: '.env',
              type: 'file' as const,
              path: '/.env',
              content: envContent
            });
            console.log('✅ Archivo .env añadido con credenciales de PocketBase');
          }
        } catch (e) {
          console.warn('Error añadiendo .env:', e);
        }
      }

      // Añadir archivos de conexión a PocketBase para la API
      if (features.includes('api') && result && Array.isArray(result.structure)) {
        try {
          const struct = result.structure as FileStructure[];

          const apiEnvContent = `PB_URL=http://127.0.0.1:${pbPort}\nPB_ADMIN_EMAIL=francisco@gmail.com\nPB_ADMIN_PASSWORD=1234512345\nAPI_PORT=3001\n`;
          const apiPbClientContent = `import PocketBase from 'pocketbase';\nimport dotenv from 'dotenv';\n\ndotenv.config();\n\nconst pbUrl = process.env.PB_URL || 'http://127.0.0.1:8090';\nexport const pb = new PocketBase(pbUrl);\n\nexport async function authAsAdmin() {\n  const email = process.env.PB_ADMIN_EMAIL || 'francisco@gmail.com';\n  const password = process.env.PB_ADMIN_PASSWORD || '1234512345';\n  try {\n    await pb.collection('_superusers').authWithPassword(email, password);\n    console.log('[PocketBase] Admin autenticado');\n  } catch {\n    try {\n      await pb.admins.authWithPassword(email, password);\n      console.log('[PocketBase] Admin autenticado (legacy)');\n    } catch (e) {\n      console.warn('[PocketBase] No se pudo autenticar como admin:', e);\n    }\n  }\n}\n`;

          let apiDir = struct.find((item: any) => item.type === 'directory' && item.name === 'API');
          if (!apiDir) {
            apiDir = {
              name: 'API',
              type: 'directory' as const,
              path: 'API',
              children: [] as FileStructure[]
            };
            struct.push(apiDir);
          }
          if (!apiDir.children) apiDir.children = [];
          const hasApiEnv = (apiDir.children as FileStructure[]).some((f: FileStructure) => f.name === '.env');
          if (!hasApiEnv) {
            (apiDir.children as FileStructure[]).push({
              name: '.env',
              type: 'file' as const,
              path: 'API/.env',
              content: apiEnvContent
            });
            console.log('✅ API/.env añadido con credenciales de PocketBase');
          }
          const hasPbClient = (apiDir.children as FileStructure[]).some((f: FileStructure) => f.name === 'pocketbase.ts');
          if (!hasPbClient) {
            (apiDir.children as FileStructure[]).push({
              name: 'pocketbase.ts',
              type: 'file' as const,
              path: 'API/pocketbase.ts',
              content: apiPbClientContent
            });
            console.log('✅ API/pocketbase.ts añadido para conexión con PocketBase');
          }
        } catch (e) {
          console.warn('Error añadiendo archivos de conexión API/PocketBase:', e);
        }
      }

      // Inyección de archivo ZIP personalizado de PocketBase (solo si authentication, database o chat)
      if (needsPocketBase && result && Array.isArray(result.structure)) {
        try {
          const struct = result.structure as FileStructure[];
          // Eliminar pocket-base existente (de la IA o inyección anterior) para evitar duplicados
          const removePocketBaseItems = (items: any[]): any[] => {
            return items.filter((item: any) => {
              if (item.type === 'directory' && item.name === 'pocket-base') return false;
              if (item.path === 'pocket-base/package.json' || item.path === 'pocket-base/install.js' || item.path === 'pocket-base/README.md') return false;
              if (item.children) item.children = removePocketBaseItems(item.children);
              return true;
            });
          };
          const filtered = removePocketBaseItems(struct);
          struct.length = 0;
          struct.push(...filtered);
          const hasPocketBase = struct.some((item: any) => item.type === 'directory' && item.name === 'pocket-base');
          if (!hasPocketBase) {
            // Get the ZIP URL from our new API endpoint for instalacion_pocket_base collection
            let pocketbaseZipUrl = '';
            try {
              const zipResponse = await fetch('/api/download-pocketbase-zip');
              if (zipResponse.ok) {
                const zipData = await zipResponse.json();
                pocketbaseZipUrl = zipData.url;
              } else {
                // Fallback to hardcoded URL if API fails
                pocketbaseZipUrl = 'https://zeus-basedatos.fly.dev/api/files/pbc_936789771/ia4iek7i0b5qq4r/pocket_base_km8lp1ccdx_0al05ft6c0.zip';
              }
            } catch (error) {
              console.warn('Failed to fetch ZIP URL from instalacion_pocket_base, using fallback:', error);
              // Fallback to hardcoded URL if API fails
              pocketbaseZipUrl = 'https://zeus-basedatos.fly.dev/api/files/pbc_936789771/ia4iek7i0b5qq4r/pocket_base_km8lp1ccdx_0al05ft6c0.zip';
            }

            // Script para descargar y extraer el ZIP personalizado
            const downloadScript = `// Este script descargará el archivo ZIP personalizado de PocketBase
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ZIP_URL = '${pocketbaseZipUrl.replace(/'/g, "\\'")}';
const ZIP_NAME = 'pocketbase_custom.zip';

console.log('📥 Descargando archivo ZIP personalizado de PocketBase...');
console.log('🔗 URL:', ZIP_URL);

async function downloadAndExtract() {
  try {
    // Ensure we're in the correct directory (pocket-base)
    const pocketBaseDir = process.cwd();
    console.log('📂 Working directory:', pocketBaseDir);

    // Check if PocketBase files already exist
    const pocketBaseExecutable = path.join(pocketBaseDir, process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase');
    if (fs.existsSync(pocketBaseExecutable)) {
      console.log('✅ PocketBase already exists, skipping download');
      return;
    }

    // Create the file stream for download
    const file = fs.createWriteStream(path.join(pocketBaseDir, ZIP_NAME));
    
    // Download the file
    await new Promise((resolve, reject) => {
      const request = https.get(ZIP_URL, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error('Error al descargar el archivo: ' + response.statusCode));
          return;
        }
        response.pipe(file);
        
        file.on('finish', () => {
          file.close();
          resolve(true);
        });
      });
      
      request.on('error', (err) => {
        reject(new Error('Error en la descarga: ' + err.message));
      });
    });
    
    console.log('✅ Descarga completada');
    console.log('📦 Extrayendo archivos...');
    
    // Extraer el archivo ZIP
    console.log('📦 Iniciando extracción...');
    if (process.platform === 'win32') {
      console.log('🖥️  Sistema Windows detectado');
      try {
        // Fixed PowerShell command with proper quote escaping
        execSync('powershell -Command "Expand-Archive -Path \\'' + ZIP_NAME + '\\' -DestinationPath \\'.\\' -Force"', { stdio: 'inherit' });
        console.log('✅ Extracción en Windows completada');
      } catch (winError) {
        console.error('❌ Error en extracción Windows:', winError.message);
        throw new Error('Falló la extracción en Windows');
      }
    } else {
      console.log('🐧 Sistema Unix/Linux/Mac detectado');
      try {
        execSync('unzip -o "' + ZIP_NAME + '" -d "."', { stdio: 'inherit' });
        console.log('✅ Extracción en Unix completada');
      } catch (unixError) {
        console.error('❌ Error en extracción Unix:', unixError.message);
        throw new Error('Falló la extracción en Unix');
      }
    }
    
    // Handle nested directory structure from ZIP extraction
    const extractedPocketBaseDir = path.join(pocketBaseDir, 'pocket-base');
    if (fs.existsSync(extractedPocketBaseDir)) {
      console.log('🔄 Moving files from nested pocket-base directory...');
      
      // Copy all files from nested directory to current directory
      const files = fs.readdirSync(extractedPocketBaseDir);
      files.forEach(file => {
        const sourcePath = path.join(extractedPocketBaseDir, file);
        const destPath = path.join(pocketBaseDir, file);
        
        // Remove destination if it exists
        if (fs.existsSync(destPath)) {
          if (fs.lstatSync(destPath).isDirectory()) {
            fs.rmSync(destPath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(destPath);
          }
        }
        
        // Move file/directory
        fs.renameSync(sourcePath, destPath);
        console.log('  📄 Moved:', file);
      });
      
      // Remove the now empty nested directory
      fs.rmdirSync(extractedPocketBaseDir);
      console.log('🗑️  Removed temporary nested directory');
    }
    
    // Eliminar el archivo ZIP después de extraer
    try {
      const zipPath = path.join(pocketBaseDir, ZIP_NAME);
      if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath);
        console.log('🗑️  Archivo ZIP eliminado después de la extracción');
      } else {
        console.log('⚠️  Archivo ZIP no encontrado para eliminar');
      }
    } catch (deleteError) {
      console.warn('⚠️  No se pudo eliminar el archivo ZIP:', deleteError.message);
    }
    
    console.log('✅ Extracción completada');
    console.log('🚀 Archivos de PocketBase listos para usar');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Ejecutar la descarga y extracción
downloadAndExtract();
`;
            const readmeContent = '# PocketBase Personalizado\n\n' + 'Este directorio contiene los archivos personalizados de tu instancia de PocketBase.\n\n' + '## Cómo usar\n\n' + '1. Asegúrate de tener Node.js instalado en tu sistema\n' + '2. Abre una terminal en esta carpeta\n' + '3. Ejecuta: `node install.js`\n\n' + 'El script se encargará de:\n' + '- Descargar el archivo ZIP personalizado de PocketBase\n' + '- Extraer los archivos necesarios\n' + '- Preparar la instancia de PocketBase\n\n' + '## Acceso al panel de administración\n\n' + 'Una vez extraídos los archivos, puedes iniciar PocketBase con el comando apropiado para tu sistema.\n' + 'Por defecto, el panel de administración estará disponible en:\n' + 'https://zeus-basedatos.fly.dev/';

            // Crear el directorio pocket-base con los archivos necesarios
            // No se usa package.json en pocket-base: install.js solo usa módulos nativos de Node
            const pocketBaseDir: FileStructure = {
              name: 'pocket-base',
              type: 'directory',
              path: 'pocket-base',
              children: [{
                name: 'install.js',
                type: 'file',
                path: 'pocket-base/install.js',
                content: downloadScript
              }, {
                name: 'README.md',
                type: 'file',
                path: 'pocket-base/README.md',
                content: readmeContent
              }]
            };

            // Añadir el directorio a la estructura del proyecto
            (result.structure as FileStructure[]).push(pocketBaseDir);
            console.log('✅ Carpeta pocket-base agregada al proyecto');
          }

          // Actualizar estadísticas si existen
          if (result.stats) {
            result.stats.totalDirectories = (result.stats.totalDirectories || 0) + 1;
            // sumamos 2 archivos (script install.js y README.md)
            result.stats.totalFiles = (result.stats.totalFiles || 0) + 2;
          }
        } catch (injectErr) {
          console.warn('No se pudo inyectar pocket-base en la estructura:', injectErr);
        }
      }

      // Inyección de la carpeta FloatingChat completa cuando se selecciona la opción de chat
      try {
        const needsFloatingChat = formData.features.includes('chat');
        // Usar result directamente en lugar de projectStructure

        if (needsFloatingChat && result && Array.isArray(result.structure)) {
          // Función para crear la estructura real de la carpeta FloatingChat
          const createFloatingChatStructure = (): any => {
            return {
              name: 'FloatingChat',
              type: 'directory' as const,
              path: '/FloatingChat',
              children: [{
                name: 'Chat',
                type: 'directory' as const,
                path: '/FloatingChat/Chat',
                children: [{
                  name: 'ChatSizeContext.tsx',
                  type: 'file' as const,
                  path: '/FloatingChat/Chat/ChatSizeContext.tsx',
                  content: `await obtenerContenidoTemplate('ChatSizeContext.tsx', '/FloatingChat/Chat/ChatSizeContext.tsx', 'ey9l0udx3v1yx6o')`
                }, {
                  name: 'ProfileSettings.tsx',
                  type: 'file' as const,
                  path: '/FloatingChat/Chat/ProfileSettings.tsx',
                  content: `await obtenerContenidoTemplate('ProfileSettings.tsx', '/FloatingChat/Chat/ProfileSettings.tsx', '9v744gu9hj81r0t')`
                }, {
                  name: 'AuthForm.tsx',
                  type: 'file' as const,
                  path: '/FloatingChat/Chat/AuthForm.tsx',
                  content: `await obtenerContenidoTemplate('AuthForm.tsx', '/FloatingChat/Chat/AuthForm.tsx', 'lmjidhghewkxdsx')`
                }, {
                  name: 'ChatWindow.tsx',
                  type: 'file' as const,
                  path: '/FloatingChat/Chat/ChatWindow.tsx',
                  content: `await obtenerContenidoTemplate('ChatWindow.tsx', '/FloatingChat/Chat/ChatWindow.tsx', 'kziw4j9a5ol4pa8')`
                }, {
                  name: 'ConnectedUsers.tsx',
                  type: 'file' as const,
                  path: '/FloatingChat/Chat/ConnectedUsers.tsx',
                  content: `await obtenerContenidoTemplate('ConnectedUsers.tsx', '/FloatingChat/Chat/ConnectedUsers.tsx', 'psa1yns87dhrbtr')`
                }, {
                  name: 'index.tsx',
                  type: 'file' as const,
                  path: '/FloatingChat/Chat/index.tsx',
                  content: `await obtenerContenidoTemplate('index.tsx', '/FloatingChat/Chat/index.tsx', 'hhe1yuhfqoj45fi')`
                }, {
                  name: 'DraggableFloatingChat.tsx',
                  type: 'file' as const,
                  path: '/FloatingChat/Chat/DraggableFloatingChat.tsx',
                  content: `"use client";

import { useState, useEffect, useRef } from 'react';
import { X, Move } from 'lucide-react';
import { ChatSizeProvider } from './ChatSizeContext';

interface DraggableFloatingChatProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export function DraggableFloatingChat({ isOpen, onClose, children }: DraggableFloatingChatProps) {
  const [position, setPosition] = useState({ x: 100, y: 100 }); // Default position instead of centering
  const [size, setSize] = useState({ width: 400, height: 600 }); // Default size
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [resizeDirection, setResizeDirection] = useState<string | null>(null);
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && chatRef.current) {
      const isMobile = window.innerWidth < 768; // md breakpoint

      if (isMobile) {
        setPosition({ x: 0, y: 0 });
        setSize({ width: window.innerWidth, height: window.innerHeight });
      }
      // Removed the centering logic to prevent repositioning when resizing
    }
  }, [isOpen]);

  const handleMouseDown = (e: React.MouseEvent) => {
    const isMobile = window.innerWidth < 768; // md breakpoint
    if (isMobile || e.button !== 0) return;

    const target = e.target as HTMLElement;
    
    // Check if we're resizing from edges
    if (target.classList.contains('resize-edge')) {
      const direction = target.getAttribute('data-direction');
      if (direction) {
        setIsResizing(true);
        setResizeDirection(direction);
        setResizeStart({
          x: e.clientX,
          y: e.clientY,
          width: size.width,
          height: size.height
        });
        e.preventDefault();
        return;
      }
    }
    
    // Check if we're dragging
    if (target.closest('.cursor-grab')) {
      if (chatRef.current) {
        const rect = chatRef.current.getBoundingClientRect();
        setDragOffset({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });
        setIsDragging(true);
        e.preventDefault();
      }
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    // Don't allow dragging on mobile
    const isMobile = window.innerWidth < 768; // md breakpoint
    if (isMobile) return;

    const target = e.target as HTMLElement;

    // Check if we're resizing from edges
    if (target.classList.contains('resize-edge')) {
      const direction = target.getAttribute('data-direction');
      if (direction) {
        const touch = e.touches[0];
        setIsResizing(true);
        setResizeDirection(direction);
        setResizeStart({
          x: touch.clientX,
          y: touch.clientY,
          width: size.width,
          height: size.height
        });
        e.preventDefault();
        return;
      }
    }
    
    // Check if we're dragging
    if (target.closest('.cursor-grab')) {
      if (chatRef.current) {
        const touch = e.touches[0];
        const rect = chatRef.current.getBoundingClientRect();
        setDragOffset({
          x: touch.clientX - rect.left,
          y: touch.clientY - rect.top,
        });
        setIsDragging(true);
        e.preventDefault();
      }
    }
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const newX = e.clientX - dragOffset.x;
        const newY = e.clientY - dragOffset.y;

        // Keep within viewport bounds
        const maxX = window.innerWidth - (chatRef.current?.offsetWidth || 0);
        const maxY = window.innerHeight - (chatRef.current?.offsetHeight || 0);

        const clampedX = Math.max(0, Math.min(newX, maxX));
        const clampedY = Math.max(0, Math.min(newY, maxY));

        setPosition({
          x: clampedX,
          y: clampedY
        });
      } else if (isResizing && resizeDirection) {
        const deltaX = e.clientX - resizeStart.x;
        const deltaY = e.clientY - resizeStart.y;
        
        const minWidth = 300;
        const minHeight = 400;
        const maxWidth = window.innerWidth - 50;
        const maxHeight = window.innerHeight - 50;
        
        let newWidth = resizeStart.width;
        let newHeight = resizeStart.height;
        let newX = position.x;
        let newY = position.y;
        
        // Handle different resize directions
        if (resizeDirection.includes('e')) {
          newWidth = Math.max(minWidth, Math.min(resizeStart.width + deltaX, maxWidth));
        }
        if (resizeDirection.includes('w')) {
          const delta = Math.min(deltaX, resizeStart.width - minWidth);
          newWidth = resizeStart.width - delta;
          newX = position.x + delta;
          if (newWidth < minWidth) {
            newX = position.x + (resizeStart.width - minWidth);
            newWidth = minWidth;
          }
        }
        if (resizeDirection.includes('s')) {
          newHeight = Math.max(minHeight, Math.min(resizeStart.height + deltaY, maxHeight));
        }
        if (resizeDirection.includes('n')) {
          const delta = Math.min(deltaY, resizeStart.height - minHeight);
          newHeight = resizeStart.height - delta;
          newY = position.y + delta;
          if (newHeight < minHeight) {
            newY = position.y + (resizeStart.height - minHeight);
            newHeight = minHeight;
          }
        }
        
        // Apply new size and position
        setSize({ width: newWidth, height: newHeight });
        setPosition({ x: newX, y: newY });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
      setResizeDirection(null);
    };

    if (isDragging || isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.addEventListener('mouseleave', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mouseleave', handleMouseUp);
    };
  }, [isDragging, isResizing, dragOffset, resizeDirection, resizeStart, position, size]);

  if (!isOpen) return null;

  return (
    <div
      ref={chatRef}
      className="fixed z-50 bg-white dark:bg-card md:rounded-lg shadow-2xl md:border border-gray-200 dark:border-border/50 flex flex-col"
      style={{
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
        cursor: isDragging ? 'grabbing' : 'default'
      }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
    >
      {/* Invisible resize edges */}
      <div 
        className="resize-edge absolute w-2 h-full bg-transparent cursor-w-resize left-0 top-0"
        data-direction="w"
      />
      <div 
        className="resize-edge absolute w-2 h-full bg-transparent cursor-e-resize right-0 top-0"
        data-direction="e"
      />
      <div 
        className="resize-edge absolute h-2 w-full bg-transparent cursor-n-resize top-0 left-0"
        data-direction="n"
      />
      <div 
        className="resize-edge absolute h-2 w-full bg-transparent cursor-s-resize bottom-0 left-0"
        data-direction="s"
      />
      <div 
        className="resize-edge absolute w-3 h-3 bg-transparent cursor-nw-resize top-0 left-0"
        data-direction="nw"
      />
      <div 
        className="resize-edge absolute w-3 h-3 bg-transparent cursor-ne-resize top-0 right-0"
        data-direction="ne"
      />
      <div 
        className="resize-edge absolute w-3 h-3 bg-transparent cursor-sw-resize bottom-0 left-0"
        data-direction="sw"
      />
      <div 
        className="resize-edge absolute w-3 h-3 bg-transparent cursor-se-resize bottom-0 right-0"
        data-direction="se"
      />
      
      {/* Chat Content */}
      <div className="flex-1 overflow-hidden">
        <ChatSizeProvider width={size.width} height={size.height}>
          {children}
        </ChatSizeProvider>
      </div>
    </div>
  );
}`
                }, {
                  name: 'LanguageContext.tsx',
                  type: 'file' as const,
                  path: '/FloatingChat/Chat/LanguageContext.tsx',
                  content: `await obtenerContenidoTemplate('LanguageContext.tsx', '/FloatingChat/Chat/LanguageContext.tsx', 'kpzfmziemmres7x')`
                }, {
                  name: 'LanguageSelector.tsx',
                  type: 'file' as const,
                  path: '/FloatingChat/Chat/LanguageSelector.tsx',
                  content: `await obtenerContenidoTemplate('LanguageSelector.tsx', '/FloatingChat/Chat/LanguageSelector.tsx', 'j03b9li4rvrl9lb')`
                }, {
                  name: 'MessageInput.tsx',
                  type: 'file' as const,
                  path: '/FloatingChat/Chat/MessageInput.tsx',
                  content: `await obtenerContenidoTemplate('MessageInput.tsx', '/FloatingChat/Chat/MessageInput.tsx', 'me0w28wirq1nttj')`
                }, {
                  name: 'MessageList.tsx',
                  type: 'file' as const,
                  path: '/FloatingChat/Chat/MessageList.tsx',
                  content: `await obtenerContenidoTemplate('MessageList.tsx', '/FloatingChat/Chat/MessageList.tsx', '52rhxpta20gdvgx')`
                }, {
                  name: 'PocketBaseContext.tsx',
                  type: 'file' as const,
                  path: '/FloatingChat/Chat/PocketBaseContext.tsx',
                  content: `await obtenerContenidoTemplate('PocketBaseContext.tsx', '/FloatingChat/Chat/PocketBaseContext.tsx', 'p5ts8nsvjz0kyzo')`
                }]
              }, {
                name: 'lib',
                type: 'directory' as const,
                path: '/FloatingChat/lib',
                children: [{
                  name: 'i18n.ts',
                  type: 'file' as const,
                  path: '/FloatingChat/lib/i18n.ts',
                  content: `await obtenerContenidoTemplate('i18n.ts', '/FloatingChat/lib/i18n.ts', 'aqsbn3ildi41t5q')`
                }, {
                  name: 'utils.ts',
                  type: 'file' as const,
                  path: '/FloatingChat/lib/utils.ts',
                  content: `await obtenerContenidoTemplate('utils.ts', '/FloatingChat/lib/utils.ts', '9cp0wlpxwf4lrq0')`
                }]
              }, {
                name: 'ui',
                type: 'directory' as const,
                path: '/FloatingChat/ui',
                children: [{
                  name: 'button.tsx',
                  type: 'file' as const,
                  path: '/FloatingChat/ui/button.tsx',
                  content: `await obtenerContenidoTemplate('button.tsx', '/FloatingChat/ui/button.tsx', 'zcwk0p2w6mql061')`
                }, {
                  name: 'input.tsx',
                  type: 'file' as const,
                  path: '/FloatingChat/ui/input.tsx',
                  content: `await obtenerContenidoTemplate('input.tsx', '/FloatingChat/ui/input.tsx', 'z5cjcvf3whd2lf8')`
                }, {
                  name: 'dropdown-menu.tsx',
                  type: 'file' as const,
                  path: '/FloatingChat/ui/dropdown-menu.tsx',
                  content: `await obtenerContenidoTemplate('dropdown-menu.tsx', '/FloatingChat/ui/dropdown-menu.tsx', 'fir6f0ybkajn4p4')`
                }, {
                  name: 'label.tsx',
                  type: 'file' as const,
                  path: '/FloatingChat/ui/label.tsx',
                  content: `await obtenerContenidoTemplate('label.tsx', '/FloatingChat/ui/label.tsx', 'jd6jib2pqnj7mlu')`
                }, {
                  name: 'scroll-area.tsx',
                  type: 'file' as const,
                  path: '/FloatingChat/ui/scroll-area.tsx',
                  content: `await obtenerContenidoTemplate('scroll-area.tsx', '/FloatingChat/ui/scroll-area.tsx', 'tzrkvzcu3i0giup')`
                }]
              }, {
                name: 'chat.css',
                type: 'file' as const,
                path: '/FloatingChat/chat.css',
                content: `await obtenerContenidoTemplate('chat.css', '/FloatingChat/chat.css', 'kvdy9gaa2ic5r44')`
              }, {
                name: 'theme-provider.tsx',
                type: 'file' as const,
                path: '/FloatingChat/theme-provider.tsx',
                content: `await obtenerContenidoTemplate('theme-provider.tsx', '/FloatingChat/theme-provider.tsx', '5hxfrqq4m937y88')`
              }, {
                name: 'theme-toggle.tsx',
                type: 'file' as const,
                path: '/FloatingChat/theme-toggle.tsx',
                content: `await obtenerContenidoTemplate('theme-toggle.tsx', '/FloatingChat/theme-toggle.tsx', 'nojabahzzfs3q2q')`
              }]
            };
          };

          // Aquí va el código para usar createFloatingChatStructure
          const hasFloatingChat = result.structure.some((item: any) => item.type === 'directory' && item.name === 'FloatingChat');
          if (!hasFloatingChat) {
            const floatingChatStructure = createFloatingChatStructure();
            result.structure.push(floatingChatStructure);

            // Actualizar estadísticas
            if (result.stats) {
              result.stats.totalDirectories = (result.stats.totalDirectories || 0) + 3;
              result.stats.totalFiles = (result.stats.totalFiles || 0) + 15; // Ajusta según la cantidad real
            }
          }

          // También necesitamos crear el floating-chat-button.tsx en components/ui
          // Encontrar o crear la carpeta components/ui
          let componentsDir = result.structure.find((item: any) => item.type === 'directory' && item.name === 'components');
          if (!componentsDir) {
            componentsDir = {
              name: 'components',
              type: 'directory' as const,
              path: '/components',
              children: []
            };
            result.structure.push(componentsDir);
          }
          let uiDir = componentsDir.children?.find((item: any) => item.type === 'directory' && item.name === 'ui');
          if (!uiDir) {
            uiDir = {
              name: 'ui',
              type: 'directory' as const,
              path: '/components/ui',
              children: []
            };
            componentsDir.children.push(uiDir);
          }

          // Verificar si ya existe el archivo floating-chat-button.tsx
          const hasFloatingChatButton = uiDir.children?.some((item: any) => item.type === 'file' && item.name === 'floating-chat-button.tsx');

          // Si no existe el archivo, lo creamos
          if (!hasFloatingChatButton) {
            const floatingChatButtonContent = `"use client";

import { Button } from '@/components/ui/button';
import { useState, useEffect, useRef, ReactNode } from 'react';

interface FloatingChatButtonProps {
  onClick?: () => void;
  children: ReactNode;
}

export function FloatingChatButton({ onClick, children }: FloatingChatButtonProps) {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [hasWindowDimensions, setHasWindowDimensions] = useState(false);
  const buttonRef = useRef<HTMLDivElement>(null);

  const updatePosition = () => {
    if (buttonRef.current) {
      const buttonWidth = buttonRef.current.offsetWidth;
      const buttonHeight = buttonRef.current.offsetHeight;
      // Position above the original FloatingButton (database button)
      const initialX = window.innerWidth - buttonWidth - 20;
      const initialY = window.innerHeight - buttonHeight - 90; // 20 (bottom margin) + 56 (button height) + 14 (some spacing)
      setPosition({ x: initialX, y: initialY });
      setHasWindowDimensions(true); // Set true when dimensions are obtained
    }
  };

  useEffect(() => {
    window.addEventListener('resize', updatePosition);

    return () => {
      window.removeEventListener('resize', updatePosition);
    };
  }, []);

  useEffect(() => {
    if (buttonRef.current) {
      requestAnimationFrame(updatePosition);
    }
  }, [buttonRef.current]);

  const buttonClass = 'h-14 w-14 shadow-lg border-2 border-black dark:border-white text-foreground flex items-center justify-center p-0';


  return (
    <div
      ref={buttonRef}
      className="fixed z-50" // z-index 50 to be above other content, but below iframe overlays
      style={{ ...{ left: position.x, top: position.y }, visibility: hasWindowDimensions ? 'visible' : 'hidden' }}
    >
      <Button
        className={buttonClass}
        size="icon"
        variant="ghost"
        onClick={onClick}
        style={{ borderRadius: '50%', width: '56px', height: '56px', minWidth: '56px', minHeight: '56px' }}
      >
        {children}
      </Button>
    </div>
  );
}`;
            uiDir.children.push({
              name: 'floating-chat-button.tsx',
              type: 'file' as const,
              path: '/src/components/ui/floating-chat-button.tsx',
              content: floatingChatButtonContent
            });
            console.log('✅ Componente floating-chat-button.tsx agregado');
          }
        }
      } catch (injectErr) {
        console.warn('No se pudo inyectar la carpeta FloatingChat en la estructura:', injectErr);
      }

      // Inyección de autenticación (PocketBase) dentro de la estructura generada, no en la app generadora
      try {
        const wantsAuth = Array.isArray(formData.features) && formData.features.includes('authentication');
        const wantsDatabase = Array.isArray(formData.features) && formData.features.includes('database');
        const wantsDatatable = Array.isArray(formData.features) && formData.features.includes('datatable');
        const wantsApi = Array.isArray(formData.features) && formData.features.includes('api');
        if ((wantsAuth || wantsDatabase || wantsDatatable || wantsApi) && result && Array.isArray(result.structure)) {
          const incDir = () => {
            if (result.stats) result.stats.totalDirectories = (result.stats.totalDirectories || 0) + 1;
          };
          const incFile = () => {
            if (result.stats) result.stats.totalFiles = (result.stats.totalFiles || 0) + 1;
          };

          // Helpers para encontrar/crear directorios de primer nivel
          const findTopDir = (name: string) => (result.structure as any[]).find(d => d.type === 'directory' && d.name === name);
          const ensureTopDir = (name: string, path: string) => {
            let dir = findTopDir(name);
            if (!dir) {
              dir = {
                name,
                type: 'directory' as const,
                path,
                children: [] as any[]
              };
              (result.structure as any[]).push(dir);
              incDir();
            }
            dir.children = dir.children || [];
            return dir;
          };

          // 1) lib/pocketbase.ts - Crear SIEMPRE
          const libDir = ensureTopDir('lib', '/lib');
          const hasPbClient = (libDir.children || []).some((c: any) => c.type === 'file' && c.name === 'pocketbase.ts');
          if (!hasPbClient) {
            const pbClient = `import PocketBase from 'pocketbase';

const pb = new PocketBase(process.env.NEXT_PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:${pbPort}');

export default pb;
`;
            (libDir.children as any[]).push({
              name: 'pocketbase.ts',
              type: 'file' as const,
              path: '/lib/pocketbase.ts',
              content: pbClient
            });
            incFile();
          }

          // 1b) lib/auth-config.ts - Misma condición que auth-status (autenticación, base de datos o chat)
          const hasAuthConfig = (libDir.children || []).some((c: any) => c.type === 'file' && (c.name === 'auth-config.ts' || c.name === 'auth-config.tsx'));
          if (!hasAuthConfig) {
            const authConfigContent = `/**
 * Rutas de autenticación. Cambia estos valores para reutilizar en otra app.
 * También puedes usar variables de entorno: NEXT_PUBLIC_AUTH_LOGIN_PATH, etc.
 */
export const authPaths = {
  login: process.env.NEXT_PUBLIC_AUTH_LOGIN_PATH ?? '/auth/login',
  register: process.env.NEXT_PUBLIC_AUTH_REGISTER_PATH ?? '/auth/register',
  home: process.env.NEXT_PUBLIC_AUTH_HOME_PATH ?? '/',
  profile: process.env.NEXT_PUBLIC_AUTH_PROFILE_PATH ?? '/profile',
  settings: process.env.NEXT_PUBLIC_AUTH_SETTINGS_PATH ?? '/settings',
};
`;
            (libDir.children as any[]).push({
              name: 'auth-config.ts',
              type: 'file' as const,
              path: '/lib/auth-config.ts',
              content: authConfigContent
            });
            incFile();
          }

          // 2) app/layout.tsx - Crear SIEMPRE
          const appDir = ensureTopDir('app', '/app');
          const hasLayout = (appDir.children || []).some((c: any) => c.type === 'file' && c.name === 'layout.tsx');
          if (!hasLayout) {
            const layoutContent = `'use client';
import React from 'react';
import './globals.css';
import Navbar from './components/Navbar';
import '../zeus-icons.js';
import '../zeus-styles.css';
import { ComponentSelectorHelper } from '@/components/component-selector-helper';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className="bg-background text-foreground/90 min-h-screen flex flex-col">
        <ComponentSelectorHelper />
        <Navbar />
        <div className="flex-grow">
          {children}
        </div>
      </body>
    </html>
  );
}
`;
            (appDir.children as any[]).push({
              name: 'layout.tsx',
              type: 'file' as const,
              path: '/app/layout.tsx',
              content: layoutContent
            });
            incFile();
          }

          // 3) app/auth/login y app/auth/register
          // Crear carpeta auth si se necesita autenticación O base de datos
          let authDir = (appDir.children || []).find((c: any) => c.type === 'directory' && c.name === 'auth');
          if ((wantsAuth || wantsDatabase) && !authDir) {
            authDir = {
              name: 'auth',
              type: 'directory' as const,
              path: '/app/auth',
              children: [] as any[]
            };
            (appDir.children as any[]).push(authDir);
            incDir();
          }
          const ensureAuthSubdir = (name: string) => {
            let d = (authDir.children || []).find((c: any) => c.type === 'directory' && c.name === name);
            if (!d) {
              d = {
                name,
                type: 'directory' as const,
                path: `/app/auth/${name}`,
                children: [] as any[]
              };
              (authDir.children as any[]).push(d);
              incDir();
            }
            d.children = d.children || [];
            return d;
          };
          const loginDir = ensureAuthSubdir('login');
          const registerDir = ensureAuthSubdir('register');
          const loginExists = (loginDir.children || []).some((c: any) => c.type === 'file' && c.name === 'page.tsx');
          if (!loginExists) {
            const loginPage = `'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import pb from '@/lib/pocketbase';
import { authPaths } from '@/lib/auth-config';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await pb.collection('users').authWithPassword(email, password);
      // Guardar cookie para el middleware
      document.cookie = pb.authStore.exportToCookie({ httpOnly: false, path: '/', sameSite: 'Lax' });
      // Redirigir usando window.location para asegurar que el middleware detecte la cookie
      window.location.href = authPaths.home;
    } catch {
      setError(t('invalidCredentials'));
    }
  };

  return (
    <main className="min-h-[calc(100vh-56px)] bg-background text-foreground/90 flex items-center justify-center px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md">
        <div className="bg-background/70 backdrop-blur border border-border/50 rounded-xl p-6 sm:p-8 shadow-xl">
          <h1 className="text-2xl font-bold text-foreground mb-6">{t('login')}</h1>
          {error && (
            <div className="text-destructive text-sm mb-3" role="alert">
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="login-email" className="text-foreground/80">
                {t('email')}
              </Label>
              <Input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('emailPlaceholder')}
                required
                className="bg-card border-border/50 text-foreground placeholder:text-muted-foreground/80"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="login-password" className="text-foreground/80">
                {t('password')}
              </Label>
              <Input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="bg-card border-border/50 text-foreground placeholder:text-muted-foreground/80"
              />
            </div>
            <Button type="submit" className="w-full bg-card hover:bg-muted text-foreground">
              {t('enter')}
            </Button>
          </form>
          <p className="mt-4 text-sm text-muted-foreground text-center">
            {t('noAccount')}{' '}
            <Link href={authPaths.register} className="text-primary hover:underline">
              {t('register')}
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}


`;
            (loginDir.children as any[]).push({
              name: 'page.tsx',
              type: 'file' as const,
              path: '/app/auth/login/page.tsx',
              content: loginPage
            });
            incFile();
          }
          const registerExists = (registerDir.children || []).some((c: any) => c.type === 'file' && c.name === 'page.tsx');
          if (!registerExists) {
            const registerPage = `'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import pb from '@/lib/pocketbase';
import { authPaths } from '@/lib/auth-config';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError(t('passwordsDontMatch'));
      return;
    }
    try {
      await pb.collection('users').create({
        email,
        password,
        passwordConfirm: confirmPassword,
      });
      await pb.collection('users').authWithPassword(email, password);
      // Guardar cookie para el middleware
      document.cookie = pb.authStore.exportToCookie({ httpOnly: false, path: '/', sameSite: 'Lax' });
      // Redirigir usando window.location para asegurar que el middleware detecte la cookie
      window.location.href = authPaths.home;
    } catch {
      setError(t('registerError'));
    }
  };

  return (
    <main className="min-h-[calc(100vh-56px)] bg-background text-foreground/90 flex items-center justify-center px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md">
        <div className="bg-background/70 backdrop-blur border border-border/50 rounded-xl p-6 sm:p-8 shadow-xl">
          <h1 className="text-2xl font-bold text-foreground mb-6">{t('register')}</h1>
          {error && (
            <div className="text-destructive text-sm mb-3" role="alert">
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="register-email" className="text-foreground/80">
                {t('email')}
              </Label>
              <Input
                id="register-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('emailPlaceholder')}
                required
                className="bg-card border-border/50 text-foreground placeholder:text-muted-foreground/80"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="register-password" className="text-foreground/80">
                {t('password')}
              </Label>
              <Input
                id="register-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="bg-card border-border/50 text-foreground placeholder:text-muted-foreground/80"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="register-confirm" className="text-foreground/80">
                {t('confirmPassword')}
              </Label>
              <Input
                id="register-confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="bg-card border-border/50 text-foreground placeholder:text-muted-foreground/80"
              />
            </div>
            <Button type="submit" className="w-full bg-card hover:bg-muted text-foreground">
              {t('register')}
            </Button>
          </form>
          <p className="mt-4 text-sm text-muted-foreground text-center">
            {t('haveAccount')}{' '}
            <Link href={authPaths.login} className="text-primary hover:underline">
              {t('login')}
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
`;
            (registerDir.children as any[]).push({
              name: 'page.tsx',
              type: 'file' as const,
              path: '/app/auth/register/page.tsx',
              content: registerPage
            });
            incFile();
          }

          // 4) Home: si no existe /app/page.tsx, crear uno que redirija a /auth/register si no hay sesión
          const homePage = (appDir.children || []).find((c: any) => c.type === 'file' && c.name === 'page.tsx');
          if (!homePage) {
            const homeContent = `'use client';
import React, { useEffect } from 'react';
import Link from 'next/link';
import Navbar from './components/Navbar';
import pb from '../lib/pocketbase';

export default function Home() {
  useEffect(() => {
    // Cargar sesión desde cookies si existe
    pb.authStore.loadFromCookie(document.cookie);
    if (!pb.authStore.isValid) {
      window.location.href = '/auth/login';
    }
  }, []);

  return (
    <>
      <Navbar />
      <main className="min-h-[calc(100vh-56px)] bg-background text-foreground/90 flex items-center justify-center px-4 sm:px-6 lg:px-8">
        <div className="w-full max-w-md text-center">
          <h1 className="text-2xl font-bold text-foreground mb-3">{t('welcome')}</h1>
          <p className="text-foreground/70">{t('loadingApp')}</p>
          <div className="mt-4 text-sm text-muted-foreground">
            {t('redirectLogin')} <Link href="/auth/login" className="text-cyan-400 hover:underline">{t('login')}</Link> {t('or')} <Link href="/auth/register" className="text-cyan-400 hover:underline">{t('createAccount')}</Link>.
          </div>
        </div>
      </main>
    </>
  );
}
`;
            (appDir.children as any[]).push({
              name: 'page.tsx',
              type: 'file' as const,
              path: '/app/page.tsx',
              content: homeContent
            });
            incFile();
          }

          // 5) middleware.ts para forzar redirección desde home cuando no autenticado
          const hasMiddleware = (result.structure as any[]).some((n: any) => n.type === 'file' && n.name === 'middleware.ts');
          if (!hasMiddleware) {
            const mwContent = `import { NextRequest, NextResponse } from 'next/server';

const LOGIN_PATH = process.env.NEXT_PUBLIC_AUTH_LOGIN_PATH ?? '/auth/login';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const authCookie = request.cookies.get('pb_auth');

  const isAuthRoute = pathname.startsWith('/auth');
  const isPublicAsset =
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/images') ||
    pathname.startsWith('/uploads') ||
    pathname.startsWith('/api');

  if (!authCookie && !isAuthRoute && !isPublicAsset) {
    const url = request.nextUrl.clone();
    url.pathname = LOGIN_PATH;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

// Proteger todas las rutas excepto las listadas arriba
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|auth|api).*)'],
};
`;
            // middleware.ts es un archivo en la raíz del proyecto
            (result.structure as any[]).push({
              name: 'middleware.ts',
              type: 'file' as const,
              path: '/middleware.ts',
              content: mwContent
            });
            incFile();
          }

          // 6) .env.local por defecto para que el cliente apunte al servidor PocketBase local
          const hasEnvLocal = (result.structure as any[]).some((n: any) => n.type === 'file' && n.name === '.env.local');
          if (!hasEnvLocal) {
            let envContent = `NEXT_PUBLIC_POCKETBASE_URL=http://127.0.0.1:${pbPort}`;
            if (features.includes('api')) {
              envContent += '\nNEXT_PUBLIC_API_URL=http://localhost:3001';
            }
            (result.structure as any[]).push({
              name: '.env.local',
              type: 'file' as const,
              path: '/.env.local',
              content: envContent
            });
            incFile();
          }

          // 7) Crear componente auth-status.tsx en components/auth/
          // Este componente se crea cuando se selecciona autenticación, base de datos o chat
          const componentsDir = ensureTopDir('components', '/components');
          let authComponentsDir = (componentsDir.children || []).find((c: any) => c.type === 'directory' && c.name === 'auth');
          if (!authComponentsDir) {
            authComponentsDir = {
              name: 'auth',
              type: 'directory' as const,
              path: '/components/auth',
              children: [] as any[]
            };
            (componentsDir.children as any[]).push(authComponentsDir);
            incDir();
          }

          const hasAuthStatus = (authComponentsDir.children || []).some((c: any) => c.type === 'file' && c.name === 'auth-status.tsx');
          if (!hasAuthStatus) {
            const authStatusContent = `'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, User, Settings, ChevronDown } from 'lucide-react';
import pb from '@/lib/pocketbase';
import { authPaths } from '@/lib/auth-config';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';

interface UserData {
  id: string;
  name: string;
  email: string;
  avatar?: string;
}

/** Rutas opcionales para reutilizar en otra app. Por defecto usa authPaths de lib/auth-config */
export interface AuthStatusPaths {
  login?: string;
  register?: string;
  home?: string;
  profile?: string;
  settings?: string;
}

interface AuthStatusProps {
  /** Rutas personalizadas (ej. al mover a otra app) */
  paths?: AuthStatusPaths;
}

export default function AuthStatus({ paths = {} }: AuthStatusProps) {
  const router = useRouter();
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const loginPath = paths.login ?? authPaths.login;
  const registerPath = paths.register ?? authPaths.register;
  const homePath = paths.home ?? authPaths.home;
  const profilePath = paths.profile ?? authPaths.profile;
  const settingsPath = paths.settings ?? authPaths.settings;

  useEffect(() => {
    setLoading(true);
    try {
      pb.authStore.loadFromCookie(document.cookie);
      if (pb.authStore.isValid && pb.authStore.model) {
        const model = pb.authStore.model as Record<string, unknown>;
        const collectionId = (model as { collectionId?: string }).collectionId;
        const avatar = (model as { avatar?: string }).avatar;
        setUser({
          id: (model.id as string) ?? '',
          name: (model.name as string) || (model.username as string) || (model.email as string) || 'Usuario',
          email: (model.email as string) ?? '',
          avatar: collectionId && avatar
            ? pb.baseUrl + '/api/files/' + collectionId + '/' + (model.id as string) + '/' + avatar
            : undefined,
        });
      } else {
        setUser(null);
      }
      const unsubscribe = pb.authStore.onChange((token, model) => {
        if (token && model) {
          const data = model as Record<string, unknown>;
          const collectionId = (data as { collectionId?: string }).collectionId;
          const avatar = (data as { avatar?: string }).avatar;
          setUser({
            id: (data.id as string) ?? '',
            name: (data.name as string) || (data.username as string) || (data.email as string) || 'Usuario',
            email: (data.email as string) ?? '',
            avatar: collectionId && avatar
              ? pb.baseUrl + '/api/files/' + collectionId + '/' + (data.id as string) + '/' + avatar
              : undefined,
          });
          router.refresh();
        } else {
          setUser(null);
          router.push(loginPath);
          router.refresh();
        }
      });
      return () => unsubscribe?.();
    } catch (error) {
      console.error('Error leyendo sesión:', error);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [loginPath, router]);

  const handleLogout = () => {
    pb.authStore.clear();
    document.cookie = 'pb_auth=; Path=/; Max-Age=0';
    setUser(null);
    router.push(loginPath);
    router.refresh();
  };

  const handleProfileClick = () => {
    if (profilePath && profilePath !== '#') {
      router.push(profilePath);
      setDropdownOpen(false);
    }
  };

  const handleSettingsClick = () => {
    if (settingsPath && settingsPath !== '#') {
      router.push(settingsPath);
      setDropdownOpen(false);
    }
  };

  const showProfile = profilePath && profilePath !== '#';
  const showSettings = settingsPath && settingsPath !== '#';

  if (loading) {
    return (
      <div className="flex items-center space-x-4">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="space-y-2 hidden md:block">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push(loginPath)}
          className="border-blue-500 text-primary hover:bg-blue-50 dark:border-blue-400 dark:text-primary dark:hover:bg-blue-950"
        >
          {t('login')}
        </Button>
        <Button size="sm" onClick={() => router.push(registerPath)} className="bg-primary hover:bg-primary">
          {t('register')}
        </Button>
      </div>
    );
  }

  const getInitials = (name: string) =>
    name
      .split(' ')
      .map((part) => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);

  return (
    <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="flex items-center space-x-3 hover:bg-gray-100 dark:hover:bg-card px-3 py-2 rounded-lg transition-colors"
        >
          <Avatar className="h-8 w-8">
            <AvatarImage src={user.avatar} alt={user.name} />
            <AvatarFallback className="bg-blue-100 text-primary dark:bg-primary/50 dark:text-primary-foreground">
              {getInitials(user.name)}
            </AvatarFallback>
          </Avatar>
          <div className="hidden md:block text-left">
            <p className="text-sm font-medium text-gray-900 dark:text-foreground/90">{user.name}</p>
            <p className="text-xs text-muted-foreground/80 dark:text-muted-foreground truncate max-w-[150px]">{user.email}</p>
          </div>
          <ChevronDown className="h-4 w-4 text-muted-foreground/80 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">{user.name}</p>
            <p className="text-xs leading-none text-muted-foreground/80 truncate">{user.email}</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {showProfile && (
          <DropdownMenuItem onClick={handleProfileClick}>
            <User className="mr-2 h-4 w-4" />
            <span>Perfil</span>
          </DropdownMenuItem>
        )}
        {showSettings && (
          <DropdownMenuItem onClick={handleSettingsClick}>
            <Settings className="mr-2 h-4 w-4" />
            <span>Configuración</span>
          </DropdownMenuItem>
        )}
        {(showProfile || showSettings) && <DropdownMenuSeparator />}
        <DropdownMenuItem onClick={handleLogout} className="text-red-600 focus:text-red-600">
          <LogOut className="mr-2 h-4 w-4" />
          <span>Cerrar sesión</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
`;
            (authComponentsDir.children as any[]).push({
              name: 'auth-status.tsx',
              type: 'file' as const,
              path: '/components/auth/auth-status.tsx',
              content: authStatusContent
            });
            incFile();
          }

          // 8) Inyección de componentes API cuando la feature 'api' está activa
          if (wantsApi) {
            const apiData = autoGeneratedApiDataRef.current;
            const endpoints: any[] = Array.isArray(apiData?.endpoints) ? apiData.endpoints : [];

            // Usar componentsDir (raíz) en lugar de appComponentsDir (dentro de /app)
            const componentsDir = ensureTopDir('components', '/components');
            let apiComponentsDir = (componentsDir.children || []).find((c: any) => c.type === 'directory' && c.name === 'api');
            if (!apiComponentsDir) {
              apiComponentsDir = {
                name: 'api',
                type: 'directory' as const,
                path: '/components/api',
                children: [] as any[]
              };
              (componentsDir.children as any[]).push(apiComponentsDir);
              incDir();
            }

            // Generar ApiClient.ts con funciones para cada endpoint
            const hasApiClient = (apiComponentsDir.children || []).some((c: any) => c.type === 'file' && c.name === 'ApiClient.ts');
            if (!hasApiClient && endpoints.length > 0) {
              const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
              let clientFunctions = endpoints.map((ep: any) => {
                const fnName = ep.path.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'call' + ep.id;
                const params = ep.parameters && Object.keys(ep.parameters).length > 0
                  ? Object.keys(ep.parameters).join(', ')
                  : '';
                const bodyArg = ['POST', 'PUT', 'PATCH'].includes(ep.method) && params ? `, ${params}` : '';
                const queryArg = ['GET', 'DELETE'].includes(ep.method) && params ? `?${Object.keys(ep.parameters).map((k: string) => `${k}=\${${k}}`).join('&')}` : '';
                return `export async function ${fnName}(${params ? params + ': any' : ''}) {
  const res = await fetch(\`${baseUrl}${ep.path}${queryArg}\`, {
    method: '${ep.method}',
    headers: { 'Content-Type': 'application/json' },
    ${['POST', 'PUT', 'PATCH'].includes(ep.method) && params ? `body: JSON.stringify({ ${params} })` : ''}
  });
  if (!res.ok) throw new Error('${ep.method} ${ep.path} failed: ' + res.status);
  return res.json();
}`;
              }).join('\n\n');

              const apiClientContent = `// Auto-generated API client for ${apiData?.title || 'API'}\nconst BASE_URL = process.env.NEXT_PUBLIC_API_URL || '${baseUrl}';\n\n${clientFunctions}\n`;
              (apiComponentsDir.children as any[]).push({
                name: 'ApiClient.ts',
                type: 'file' as const,
                path: '/components/api/ApiClient.ts',
                content: apiClientContent
              });
              incFile();
            }

            // Generar ApiDashboard.tsx con UI para todos los endpoints
            const hasApiDashboard = (apiComponentsDir.children || []).some((c: any) => c.type === 'file' && c.name === 'ApiDashboard.tsx');
            if (!hasApiDashboard && endpoints.length > 0) {
              const epRows = endpoints.map((ep: any, idx: number) => {
                const fnName = ep.path.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'call' + ep.id;
                const paramFields = (() => {
                  if (['POST', 'PUT', 'PATCH'].includes(ep.method)) {
                    // Check if any parameter indicates a file upload
                    const hasFileUpload = ep.parameters && Object.values(ep.parameters).some((p: any) => p.type === 'string' && p.format === 'binary');

                    if (hasFileUpload) {
                      return `
                      <div className="flex flex-col gap-2">
                        <label className="text-xs text-muted-foreground">Cargar Archivo</label>
                        <input type="file" onChange={(e) => updateFileParam(${idx}, e.target.files ? e.target.files[0] : null)} className="bg-card border border-border/50 rounded px-2 py-1 text-sm text-foreground file:mr-4 file:py-1 file:px-2 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-cyan-500 file:text-foreground hover:file:bg-cyan-600" />
                      </div>`;
                    } else if (ep.parameters && Object.keys(ep.parameters).length > 0) {
                      return `
                      <div className="flex flex-col">
                        <label className="text-xs text-muted-foreground">Cuerpo JSON</label>
                        <textarea
                          value={JSON.stringify(params[${idx}], null, 2)}
                          onChange={(e) => {
                            try {
                              updateParam(${idx}, 'jsonBody', JSON.parse(e.target.value));
                            } catch {
                              // Invalid JSON, keep as string for now
                              updateParam(${idx}, 'jsonBody', e.target.value);
                            }
                          }}
                          className="bg-card border border-border/50 rounded px-2 py-1 text-sm text-foreground h-32 font-mono"
                          placeholder="{}"
                        ></textarea>
                      </div>`;
                    }
                  } else if (ep.parameters) {
                    return Object.entries(ep.parameters).map(([k, v]: [string, any]) => `
                    <div className="flex flex-col">
                      <label className="text-xs text-muted-foreground">${k} ${v.required ? '(Requerido)' : ''}</label>
                      <input
                        type="${v.type === 'number' ? 'number' : 'text'}"
                        value={params[${idx}]['${k}'] || ''}
                        onChange={(e) => updateParam(${idx}, '${k}', e.target.value)}
                        className="bg-card border border-border/50 rounded px-2 py-1 text-sm text-foreground"
                        placeholder="${v.description || ''}"
                      />
                    </div>`).join('\n');
                  }
                  return '';
                })();
                return `              <tr key="${ep.id}" className="border-b border-border/80">
                <td className="px-3 py-2 text-sm"><span className="inline-block px-2 py-0.5 rounded text-xs font-bold ${ep.method === 'GET' ? 'bg-success/30 text-success' : ep.method === 'POST' ? 'bg-primary text-primary-foreground' : ep.method === 'PUT' || ep.method === 'PATCH' ? 'bg-yellow-900 text-yellow-300' : 'bg-red-900 text-red-300'}">${ep.method}</span></td>
                <td className="px-3 py-2 text-sm text-foreground/70">${ep.path}</td>
                <td className="px-3 py-2 text-sm text-muted-foreground">${ep.description || ''}</td>
                <td className="px-3 py-2">
                  ${paramFields || ''}
                  <button onClick={() => testEndpoint(${idx})} className="mt-2 px-3 py-1 bg-cyan-700 hover:bg-cyan-600 text-foreground text-xs rounded">{loading[${idx}] ? 'Ejecutando...' : 'Probar'}</button>
                  {results[${idx}] && (
                    <div className="mt-2 text-xs bg-background border border-border/50 rounded p-2 max-h-32 overflow-auto">
                      <pre className="text-success">{JSON.stringify(results[${idx}], null, 2)}</pre>
                    </div>
                  )}
                  {errors[${idx}] && (
                    <div className="mt-2 text-xs text-destructive">{errors[${idx}]}</div>
                  )}
                </td>
              </tr>`;
              }).join('\n');

              const initialParams = endpoints.map(() => '{}').join(', ');
              const testFunctions = endpoints.map((ep: any, idx: number) => {
                const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
                const queryStr = ep.parameters
                  ? Object.keys(ep.parameters).map((k: string) => `${k}=\${encodeURIComponent(params[${idx}]['${k}'] || '')}`).join('&')
                  : '';
                const url = queryStr ? `${baseUrl}${ep.path}?${queryStr}` : `${baseUrl}${ep.path}`;
                const bodyStr = ['POST', 'PUT', 'PATCH'].includes(ep.method) && ep.parameters
                  ? `JSON.stringify(params[${idx}])`
                  : 'undefined';
                return `      case ${idx}:
        res = await fetch('${url}', { method: '${ep.method}', headers: { 'Content-Type': 'application/json' }${bodyStr !== 'undefined' ? `, body: ${bodyStr}` : ''} });
        break;`;
              }).join('\n');

              const apiDashboardContent = `'use client';
import React, { useState } from 'react';

const ENDPOINTS = ${JSON.stringify(endpoints.map((ep: any) => ({ id: ep.id, method: ep.method, path: ep.path, description: ep.description })))};

export default function ApiDashboard() {
  const [params, setParams] = useState<any[]>([${initialParams}]);
  const [files, setFiles] = useState<Record<number, File | null>>({});
  const [results, setResults] = useState<Record<number, any>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState<Record<number, boolean>>({});

  const updateParam = (idx: number, key: string, value: any) => {
    setParams(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [key]: value };
      return next;
    });
  };

  const updateFileParam = (idx: number, file: File | null) => {
    setFiles(prev => ({ ...prev, [idx]: file }));
  };

  const testEndpoint = async (idx: number) => {
    setLoading(prev => ({ ...prev, [idx]: true }));
    setErrors(prev => ({ ...prev, [idx]: '' }));
    try {
      const ep = ENDPOINTS[idx];
      let res;
      switch (idx) {
${testFunctions}
      }
      if (!res.ok) throw new Error(ep.method + ' ' + ep.path + ' failed: ' + res.status);
      const data = await res.json();
      setResults(prev => ({ ...prev, [idx]: data }));
    } catch (err: any) {
      setErrors(prev => ({ ...prev, [idx]: err.message || 'Error' }));
    } finally {
      setLoading(prev => ({ ...prev, [idx]: false }));
    }
  };

  return (
    <div className="p-6 bg-background text-foreground/90 min-h-screen">
      <h1 className="text-2xl font-bold mb-4">API Dashboard</h1>
      <p className="text-muted-foreground mb-6">${apiData?.title || 'API'} — ${endpoints.length} endpoints disponibles</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left border border-border/80 rounded-lg">
          <thead className="bg-background">
            <tr>
              <th className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Método</th>
              <th className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Path</th>
              <th className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Descripción</th>
              <th className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Acción</th>
            </tr>
          </thead>
          <tbody>
${epRows}
          </tbody>
        </table>
      </div>
    </div>
  );
}
`;
              (apiComponentsDir.children as any[]).push({
                name: 'ApiDashboard.tsx',
                type: 'file' as const,
                path: '/components/api/ApiDashboard.tsx',
                content: apiDashboardContent
              });
              incFile();
            }

            // Página dedicada para gestionar la API
            const hasApiPage = (appDir.children || []).some((c: any) => c.type === 'directory' && c.name === 'api-client');
            if (!hasApiPage) {
              const apiClientPageDir = {
                name: 'api-client',
                type: 'directory' as const,
                path: '/app/api-client',
                children: [] as any[]
              };
              (appDir.children as any[]).push(apiClientPageDir);
              incDir();
              (apiClientPageDir.children as any[]).push({
                name: 'page.tsx',
                type: 'file' as const,
                path: '/app/api-client/page.tsx',
                content: `'use client';
import ApiDashboard from '@/components/api/ApiDashboard';

export default function ApiClientPage() {
  return <ApiDashboard />;
}
`
              });
              incFile();
            }

            // Proxy route: redirige todas las llamadas /api/* al servidor Express externo
            const hasApiProxy = (result.structure as any[]).some((n: any) => n.type === 'file' && n.path === 'app/api/[...path]/route.ts');
            if (!hasApiProxy) {
              const apiProxyContent = `import { NextRequest, NextResponse } from 'next/server';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function handler(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  const search = req.nextUrl.search;
  const target = API_BASE + pathname + search;

  const body = req.method !== 'GET' && req.method !== 'HEAD' ? await req.arrayBuffer() : undefined;

  const res = await fetch(target, {
    method: req.method,
    headers: req.headers,
    body,
  });

  return new NextResponse(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
`;
              (result.structure as any[]).push({
                name: 'route.ts',
                type: 'file' as const,
                path: 'app/api/[...path]/route.ts',
                content: apiProxyContent
              });
              if (result.stats) result.stats.totalFiles = (result.stats.totalFiles || 0) + 1;
              console.log('✅ Proxy API route añadido: app/api/[...path]/route.ts');
            }
          }
        }
      } catch (authInjectErr) {
        console.warn('No se pudo inyectar autenticación/API en la estructura:', authInjectErr);
      }

      // Salvaguarda final: asegurar que lib/pocketbase.ts exista SIEMPRE antes de fijar la estructura
      try {
        const findTopDir = (name: string) => (result.structure as any[]).find((d: any) => d.type === 'directory' && d.name === name);
        const ensureTopDir = (name: string, path: string) => {
          let dir = findTopDir(name);
          if (!dir) {
            dir = {
              name,
              type: 'directory' as const,
              path,
              children: [] as any[]
            };
            (result.structure as any[]).push(dir);
            if (result.stats) result.stats.totalDirectories = (result.stats.totalDirectories || 0) + 1;
          }
          dir.children = dir.children || [];
          return dir;
        };
        const libDir = ensureTopDir('lib', '/lib');
        const hasPbClient = (libDir.children || []).some((c: any) => c.type === 'file' && c.name === 'pocketbase.ts');
        if (!hasPbClient) {
          const pbClient = `import PocketBase from 'pocketbase';

const pb = new PocketBase(process.env.NEXT_PUBLIC_POCKETBASE_URL || 'https://zeus-basedatos.fly.dev');

export default pb;
`;
          (libDir.children as any[]).push({
            name: 'pocketbase.ts',
            type: 'file' as const,
            path: '/lib/pocketbase.ts',
            content: pbClient
          });
          if (result.stats) result.stats.totalFiles = (result.stats.totalFiles || 0) + 1;
        }
      } catch (e) {
        console.warn('No se pudo aplicar la salvaguarda de lib/pocketbase.ts:', (e as any)?.message || e);
      }

      // Agregar component-selector-helper.tsx a la estructura SIEMPRE
      try {
        console.log('📥 Descargando component-selector-helper.tsx desde PocketBase para agregarlo a la estructura...');
        const componentHelperContent = await obtenerContenidoTemplate('component-selector-helper.tsx', '/components/component-selector-helper.tsx', 'wg3p6p2uo4r2r5w');

        if (componentHelperContent && componentHelperContent.trim().length > 0) {
          // Buscar o crear la carpeta components
          const findComponentsDir = (items: any[]): any => {
            for (const item of items) {
              if (item.type === 'directory' && item.name === 'components') {
                return item;
              }
              if (item.children) {
                const found = findComponentsDir(item.children);
                if (found) return found;
              }
            }
            return null;
          };

          const ensureComponentsDir = () => {
            let componentsDir = findComponentsDir(result.structure);
            if (!componentsDir) {
              componentsDir = {
                name: 'components',
                type: 'directory' as const,
                path: 'components',
                children: [] as any[]
              };
              (result.structure as any[]).push(componentsDir);
              if (result.stats) result.stats.totalDirectories = (result.stats.totalDirectories || 0) + 1;
            }
            componentsDir.children = componentsDir.children || [];
            return componentsDir;
          };

          const componentsDir = ensureComponentsDir();

          // Verificar si el archivo ya existe
          const fileExists = (componentsDir.children || []).some((c: any) => c.type === 'file' && c.name === 'component-selector-helper.tsx');

          if (!fileExists) {
            componentsDir.children.push({
              name: 'component-selector-helper.tsx',
              type: 'file' as const,
              path: 'components/component-selector-helper.tsx',
              content: componentHelperContent
            });
            if (result.stats) result.stats.totalFiles = (result.stats.totalFiles || 0) + 1;
            console.log('✅ component-selector-helper.tsx agregado a la estructura en components/');
          } else {
            console.log('ℹ️ component-selector-helper.tsx ya existe en la estructura');
          }
        } else {
          console.warn('⚠️ No se encontró el contenido en code_templates con ID wg3p6p2uo4r2r5w');
        }
      } catch (helperError: any) {
        console.warn('⚠️ Error al descargar/agregar component-selector-helper.tsx a la estructura:', helperError.message);
        // No fallar la generación si no se puede descargar el archivo
      }

      // Agregar zeus-icons.js a la raíz de la estructura SIEMPRE (descargado desde PocketBase)
      let zeusIconsContent = '';
      try {
        console.log('[zeus-icons] 📥 Intentando descargar zeus-icons.js desde API local...');
        zeusIconsContent = await obtenerContenidoTemplate('zeus-icons.js', '/zeus-icons.js', 'lran49kul5g1d4a');
        console.log(`[zeus-icons] 📥 API local: contenido recibido, longitud=${zeusIconsContent?.length || 0}`);
      } catch (localErr: any) {
        console.warn('[zeus-icons] ⚠️ API local falló:', localErr.message);
      }

      // Fallback directo a PocketBase si la API local no funcionó
      if (!zeusIconsContent || zeusIconsContent.trim().length === 0) {
        try {
          console.log('[zeus-icons] 📥 Fallback: descargando directamente desde PocketBase...');
          const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL || 'https://zeus-basedatos.fly.dev';
          const directRes = await fetch(`${pbUrl}/api/collections/code_templates/records/lran49kul5g1d4a`);
          if (directRes.ok) {
            const record = await directRes.json();
            const possibleFields = ['contenido', 'content', 'codigo', 'code', 'template', 'body', 'text'];
            for (const f of possibleFields) {
              if (record[f] !== undefined && record[f] !== null && record[f] !== '') {
                zeusIconsContent = String(record[f]);
                console.log(`[zeus-icons] ✅ Fallback: contenido encontrado en campo '${f}', longitud=${zeusIconsContent.length}`);
                break;
              }
            }
          } else {
            console.warn('[zeus-icons] ⚠️ Fallback: PocketBase respondió', directRes.status);
          }
        } catch (fallbackErr: any) {
          console.warn('[zeus-icons] ⚠️ Fallback: error directo a PocketBase:', fallbackErr.message);
        }
      }

      // Si tenemos contenido, inyectar en la estructura
      if (zeusIconsContent && zeusIconsContent.trim().length > 0) {
        const existingFileIndex = (result.structure as any[]).findIndex(
          (item: any) => item.type === 'file' && item.name === 'zeus-icons.js'
        );
        if (existingFileIndex !== -1) {
          (result.structure as any[])[existingFileIndex].content = zeusIconsContent;
          console.log('[zeus-icons] ♻️ zeus-icons.js existente reemplazado');
        } else {
          (result.structure as any[]).push({
            name: 'zeus-icons.js',
            type: 'file' as const,
            path: '/zeus-icons.js',
            content: zeusIconsContent
          });
          if (result.stats) result.stats.totalFiles = (result.stats.totalFiles || 0) + 1;
          console.log('[zeus-icons] ✅ zeus-icons.js agregado a la raíz del proyecto');
        }
      } else {
        console.warn('[zeus-icons] ❌ No se pudo obtener contenido para zeus-icons.js (ni API local ni PocketBase directo). ID: lran49kul5g1d4a');
      }

      // Agregar zeus-styles.css vacío a la raíz de la estructura SIEMPRE
      const hasZeusStyles = (result.structure as any[]).some((item: any) => item.type === 'file' && item.name === 'zeus-styles.css');
      if (!hasZeusStyles) {
        (result.structure as any[]).push({
          name: 'zeus-styles.css',
          type: 'file' as const,
          path: '/zeus-styles.css',
          content: '/* Estilos generados por Zeus Studio - se sobreescriben en runtime */'
        });
        if (result.stats) result.stats.totalFiles = (result.stats.totalFiles || 0) + 1;
        console.log('✅ zeus-styles.css agregado a la raíz del proyecto');
      }

      // Inyectar importaciones de Zeus en cualquier layout existente generado por la IA
      try {
        const walkAndFixLayouts = (items: any[]) => {
          for (const item of items) {
            if (item.type === 'file' && (item.name === 'layout.tsx' || item.name === 'layout.jsx' || item.name === '_app.tsx' || item.name === '_app.jsx')) {
              if (typeof item.content === 'string' && item.content.length > 0) {
                const original = item.content;
                item.content = injectZeusImportsIntoLayout(original, item.path || item.name);
                if (item.content !== original) {
                  console.log(`🔧 Layout modificado con imports de Zeus: ${item.path || item.name}`);
                }
              }
            }
            if (item.children && Array.isArray(item.children)) {
              walkAndFixLayouts(item.children);
            }
          }
        };
        walkAndFixLayouts(result.structure as any[]);
      } catch (layoutFixError: any) {
        console.warn('⚠️ Error al inyectar imports en layouts existentes:', layoutFixError.message);
      }

      setProjectStructure(result);

      // ✅ Guardar projectRoot devuelto por el backend en el contexto para que la generación
      // de contenido sepa dónde escribir los archivos en disco.
      if (result.metadata?.projectRoot && typeof result.metadata.projectRoot === 'string') {
        try {
          setCtxProjectRoot?.(result.metadata.projectRoot);
          console.log('[generateStructure] projectRoot guardado en contexto:', result.metadata.projectRoot);
        } catch (e) {
          console.warn('[generateStructure] No se pudo guardar projectRoot en contexto:', e);
        }
      }

      // ✅ Guardar imágenes subidas en public/uploads/ tan pronto como se genera la estructura
      const root = result.metadata?.projectRoot;
      if (root && uploadedImages.length > 0) {
        console.log(`[generateStructure] Guardando ${uploadedImages.length} imágenes en ${root}/public/uploads/`);
        for (const img of uploadedImages) {
          try {
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(img);
            });
            const imgPath = `public/uploads/${img.name}`;
            const res = await sessionFetch('/api/save-file', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ skipBackup: true, filePath: imgPath, content: dataUrl, projectRoot: root })
            });
            if (res.ok) {
              console.log(`[generateStructure] ✅ Imagen guardada: ${imgPath}`);
            } else {
              console.warn(`[generateStructure] ⚠️ Error guardando imagen ${imgPath}:`, await res.text().catch(() => 'unknown'));
            }
          } catch (e) {
            console.warn(`[generateStructure] ⚠️ Error guardando imagen ${img.name}:`, e);
          }
        }
      }

      setStep('structure');

      // Call the callback to notify parent component
      if (onStructureGenerated) {
        onStructureGenerated(result);
      }

      // Initialize file progress tracking
      const extractedFiles = extractFilesFromStructure(result.structure);
      const initialProgress: Record<string, FileProgress> = {};
      extractedFiles.forEach(file => {
        initialProgress[file.path] = {
          filePath: file.path,
          status: 'pending'
        };
      });
      setFileProgress(initialProgress);
      // Mantenerse en la pantalla de estructura hasta que el usuario pulse "Generar Contenido"
      // Desactivar cualquier temporizador de auto avance y pausar explícitamente
      if (autoProgressTimer) {
        clearTimeout(autoProgressTimer);
        setAutoProgressTimer(null);
      }
      setIsAutoPaused(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error generando estructura');
    } finally {
      setLoading(false);
    }
  }, [formData, selectedModel, projectId, projectRoot, uploadedFiles, uploadedImages, onStructureGenerated, extractFilesFromStructure, autoGenerateApi]);

  // Función para pausar el progreso automático
  const pauseAutoProgress = useCallback(() => {
    if (autoProgressTimer) {
      clearTimeout(autoProgressTimer);
      setAutoProgressTimer(null);
    }
    setIsAutoPaused(true);
  }, [autoProgressTimer]);

  // Función para reanudar o proceder manualmente
  const resumeOrProceed = useCallback(() => {
    if (projectStructure) {
      const files = extractFilesFromStructure(projectStructure.structure);
      const initialProgress: Record<string, FileProgress> = {};
      files.forEach(file => {
        initialProgress[file.path] = {
          filePath: file.path,
          status: 'pending'
        };
      });
      setFileProgress(initialProgress);
      generateContentWithStructure(projectStructure, initialProgress);
    }
    setIsAutoPaused(false);
  }, [projectStructure]);

  // Limpiar timer al desmontar el componente o cambiar de paso
  useEffect(() => {
    return () => {
      if (autoProgressTimer) {
        clearTimeout(autoProgressTimer);
      }
    };
  }, [autoProgressTimer]);

  // Limpiar timer cuando se cambia de paso
  useEffect(() => {
    if (step !== 'structure' && autoProgressTimer) {
      clearTimeout(autoProgressTimer);
      setAutoProgressTimer(null);
      setIsAutoPaused(false);
    }
  }, [step, autoProgressTimer]);

  // ✅ Función para crear la estructura de carpetas antes de generar contenido
  const createFoldersFromStructure = useCallback(async (structure: ProjectStructure) => {
    if (!structure || !structure.structure) return;

    // DATA_PATH es la raíz directa del proyecto
    const root = projectRoot || '';
    if (!root) {
      console.warn('[createFolders] No hay projectRoot ni appName para crear carpetas.');
      return;
    }

    const extractDirectories = (items: FileStructure[]): string[] => {
      const dirs: string[] = [];
      for (const item of items) {
        if (item.type === 'directory') {
          const cleanPath = item.path.replace(/^[\\/]+/, '').replace(/\\/g, '/');
          if (cleanPath) dirs.push(cleanPath);
          if (item.children && item.children.length > 0) {
            dirs.push(...extractDirectories(item.children));
          }
        }
      }
      return dirs;
    };

    const directories = extractDirectories(structure.structure);
    if (directories.length === 0) return;

    console.log(`[createFolders] Creando ${directories.length} carpetas en ${root}...`);
    for (const dir of directories) {
      try {
        const response = await sessionFetch('/api/create-folder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dir, projectRoot: root })
        });
        if (!response.ok) {
          console.warn(`[createFolders] ⚠️ No se pudo crear carpeta ${dir}:`, await response.text().catch(() => 'unknown error'));
        } else {
          console.log(`[createFolders] ✅ Carpeta creada: ${dir}`);
        }
      } catch (error) {
        console.warn(`[createFolders] ⚠️ Error creando carpeta ${dir}:`, error);
      }
    }
  }, [projectRoot, formData.appName]);

  // Function to generate content with a given structure (OPTIMIZADO PARA PARALELISMO)
  const generateContentWithStructure = useCallback(async (structure: ProjectStructure, initialProgress: Record<string, FileProgress>) => {
    // Resetear el ref de transición para esta nueva generación
    hasTransitionedToCompleteRef.current = false;

    // Validación de que tenemos una estructura válida antes de proceder al segundo paso
    if (!structure || !structure.structure || structure.structure.length === 0) {
      setError(t('noStructureError'));
      setLoading(false);
      return;
    }
    setStep('content');
    setLoading(true);

    // ✅ Crear estructura de carpetas antes de generar archivos
    await createFoldersFromStructure(structure);

    const files = extractFilesFromStructure(structure.structure);
    const totalFiles = files.length;
    let completedCount = 0;
    const newCompletedFiles: Record<string, string> = {};

    // OPTIMIZACIÓN: Separar archivos con contenido predefinido de los que necesitan generación
    const filesWithContent = files.filter(file => file.content);
    const filesToGenerate = files.filter(file => !file.content);

    // OPTIMIZACIÓN: Priorizar archivos críticos para generación más rápida
    const prioritizeFiles = (files: FileStructure[]) => {
      const critical = files.filter(f => f.path.includes('layout') || f.path.includes('page.') || f.path.includes('App.') || f.path.includes('main.') || f.path.includes('index.'));
      const normal = files.filter(f => !critical.includes(f));
      return [...critical, ...normal];
    };
    const prioritizedFiles = prioritizeFiles(filesToGenerate);

    // Procesar archivos con contenido predefinido inmediatamente
    for (const file of filesWithContent) {
      // Special handling for FloatingChat template resolution strings
      let finalContent = file.content!;

      // Check if this is a direct template resolution string
      if (file.content!.trim().startsWith('await obtenerContenidoTemplate(')) {
        try {
          // Parse the template call directly
          const match = file.content!.trim().match(/await\s+obtenerContenidoTemplate\(['"]([^"']+)["'](?:\s*,\s*['"]([^"']+)["'])?(?:\s*,\s*['"]([^"']+)["'])?\)/);
          if (match && match[1]) {
            const templateName = match[1];
            const path = match[2]; // path is optional
            const id = match[3]; // id is optional

            console.log(`Resolviendo contenido de template directamente: ${templateName}${path ? ` con ruta: ${path}` : ''}${id ? ` con ID: ${id}` : ''}`);
            finalContent = await obtenerContenidoTemplate(templateName, path, id);
          }
        } catch (error) {
          console.error('Error resolviendo contenido de template directamente:', error);
          finalContent = file.content!; // Fallback to original content
        }
      } else {
        // Use the existing resolver for content that contains template calls
        finalContent = await resolverContenidoTemplate(file.content!);
      }
      newCompletedFiles[file.path] = finalContent;

      // Save file to disk if projectRoot is available
      if (projectRoot) {
        const normalizedFilePath = file.path.startsWith('/') ? file.path.slice(1) : file.path;
        try {
          await sessionFetch('/api/save-file', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              filePath: normalizedFilePath,
              content: finalContent,
              projectRoot: projectRoot,
              projectId: projectId
            })
          });
          console.log(`✅ Archivo con contenido predefinido guardado en disco: ${normalizedFilePath}`);
        } catch (saveError) {
          console.error(`⚠️ Error guardando archivo predefinido ${normalizedFilePath}:`, saveError);
        }
      }
      setCompletedFiles(prev => ({
        ...prev,
        [file.path]: finalContent
      }));
      setFileProgress(prev => ({
        ...prev,
        [file.path]: {
          ...prev[file.path],
          status: 'completed',
          content: finalContent
        }
      }));
      completedCount++;
      setOverallProgress(completedCount / totalFiles * 100);
    }

    // OPTIMIZACIÓN: Generar contenido en paralelo (máximo 3 archivos simultáneos)
    const CONCURRENT_LIMIT = 3;
    const generateFileContent = async (file: FileStructure) => {
      try {
        setCurrentGeneratingFile(file.path);
        setFileProgress(prev => ({
          ...prev,
          [file.path]: {
            ...prev[file.path],
            status: 'generating',
            progress: 0
          }
        }));

        // OPTIMIZACIÓN: Timeout más corto para cada archivo individual.
        // Ollama Cloud puede tardar varios minutos en prompts grandes, así
        // que el timeout se adapta al provider: 3 min para OpenAI/Deepseek/etc
        // y 12 min para Ollama Cloud.
        const controller = new AbortController();
        const isOllamaCloudModel = (() => {
          const m: any = selectedModel;
          const provider = String(m?.provider || '').toLowerCase();
          const url = String(m?.url || m?.base_url || '').toLowerCase();
          return provider.includes('ollama cloud') || provider.includes('ollama_cloud') || provider.includes('ollama-cloud') ||
            url.includes('ollama.com') || url.includes('ollama.cloud');
        })();
        const perFileTimeoutMs = isOllamaCloudModel ? 12 * 60 * 1000 : 3 * 60 * 1000;
        const timeoutId = setTimeout(() => controller.abort(), perFileTimeoutMs);

        // Prepare uploaded files data for content generation
        const uploadedFilesData = await Promise.all(uploadedFiles.map(async file => {
          const content = await file.text();
          return {
            name: file.name,
            type: file.type,
            size: file.size,
            content: content
          };
        }));
        // Procesar imágenes subidas (archivos File)
        const uploadedImagesData = await Promise.all(uploadedImages.map(async file => {
          return new Promise<{
            name: string;
            type: string;
            size: number;
            dataUrl: string;
            path: string;
            url?: string;
          }>(resolve => {
            const reader = new FileReader();
            reader.onload = () => {
              resolve({
                name: file.name,
                type: file.type,
                size: file.size,
                dataUrl: reader.result as string,
                path: `/uploads/${file.name}`
              });
            };
            reader.readAsDataURL(file);
          });
        }));

        // Procesar imágenes seleccionadas de Unsplash (URLs)
        const selectedImagesData = selectedImageUrls.map((url, index) => {
          // Extraer nombre de la URL o usar un nombre descriptivo
          const urlName = url.split('/').pop()?.split('?')[0] || `selected-image-${index + 1}.jpg`;
          return {
            name: urlName,
            type: 'image/jpeg', // Unsplash generalmente devuelve JPEG
            size: 0, // No tenemos el tamaño de las URLs
            dataUrl: '', // No tenemos el dataUrl, usaremos la URL directamente
            url: url // ✅ Agregar la URL para que la API pueda usarla
          };
        });

        // Combinar imágenes subidas y seleccionadas
        const allImagesData = [...uploadedImagesData, ...selectedImagesData];

        // Determine API endpoint based on template and appType (same logic as structure)
        let apiEndpoint = '/api/generate-app-page-web/content'; // Default for static pages

        if (formData.template === 'next-js' && formData.appType === 'web-app') {
          // App Web (Next.js web application)
          apiEndpoint = '/api/generate-app/content';
        } else if (formData.template === 'next-js' && formData.appType === 'mobile-app') {
          // App Móvil (Next.js mobile application)
          apiEndpoint = '/api/generate-app-movil/content';
        } else if (formData.template === 'next-js' && formData.appType === 'desktop-app') {
          // App Escritorio (Electron/Next.js)
          apiEndpoint = '/api/generate-app-escritorio/content';
        } else if (formData.template === 'next-js' && !formData.appType || formData.template === 'vite-react' || ['html-css-js', 'astro', 'eleventy'].includes(formData.template)) {
          // Página Web (Next.js static pages) or other static templates
          apiEndpoint = '/api/generate-app-page-web/content';
        } else if (['react-native', 'flutter', 'swift-ui', 'kotlin-compose'].includes(formData.template)) {
          // Native mobile frameworks
          apiEndpoint = '/api/generate-app-movil/content';
        }
        let response: Response;
        response = await fetch(apiEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            filePath: file.path,
            template: formData.template,
            appName: formData.appName,
            complexity: formData.complexity,
            features: formData.features,
            description: formData.description,
            projectStructure: structure.structure,
            modelConfig: selectedModel,
            projectRoot: projectRoot,
            // Pass projectRoot from context
            optimizeForSpeed: true,
            // Activar modo rápido para contenido
            uploadedFiles: uploadedFilesData,
            uploadedImages: allImagesData,
            // Configurar automáticamente authMethod cuando se selecciona authentication
            authMethod: formData.features.includes('authentication') ? 'pocketbase' : 'none',
            requiresAuth: formData.features.includes('authentication'),
            // Configurar automáticamente databaseType cuando se selecciona database
            databaseType: formData.features.includes('database') ? 'pocketbase' : 'none',
            requiresDatabase: formData.features.includes('database'),
            additionalPages: structure.metadata?.additionalPages
          }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!response.ok) {
          throw new Error(`Error ${response.status}: ${response.statusText}`);
        }
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No se pudo obtener el reader del stream');
        }
        const decoder = new TextDecoder();
        let sseBuffer = '';
        let accumulatedContent = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          sseBuffer += decoder.decode(value, { stream: true });

          const events = sseBuffer.split('\n\n');
          sseBuffer = events.pop() || '';

          for (const evt of events) {
            const lines = evt.split('\n');
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data: ')) continue;
              const data = trimmed.slice(6);
              try {
                const parsed = JSON.parse(data);
                if (parsed.type === 'content') {
                  accumulatedContent += parsed.chunk || '';
                  setFileProgress(prev => ({
                    ...prev,
                    [file.path]: {
                      ...prev[file.path],
                      progress: parsed.metadata?.progress || 0,
                      linesGenerated: parsed.metadata?.linesGenerated || 0
                    }
                  }));
                } else if (parsed.type === 'complete') {
                  let finalContent = parsed.content || accumulatedContent;
                  finalContent = correctAndFinalizeContent(finalContent, file.path);
                  const normalizedCompletedPath = file.path.startsWith('/') ? file.path.slice(1) : file.path;
                  newCompletedFiles[normalizedCompletedPath] = finalContent;
                  setCompletedFiles(prev => ({
                    ...prev,
                    [normalizedCompletedPath]: finalContent
                  }));

                  // Save file to disk if projectRoot is available
                  if (projectRoot) {
                    const normalizedFilePath = file.path.startsWith('/') ? file.path.slice(1) : file.path;
                    console.log(`Attempting to save file to disk: ${normalizedFilePath}`);
                    try {
                      const effectiveRoot = await getDefinitiveProjectRoot();
                      const saveResponse = await sessionFetch('/api/save-file', {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                          filePath: normalizedFilePath,
                          content: finalContent,
                          projectRoot: effectiveRoot,
                          projectId: projectId
                        })
                      });
                      if (saveResponse.ok) {
                        console.log(`✅ Archivo guardado en disco exitosamente: ${normalizedFilePath}`);
                      } else {
                        const errorText = await saveResponse.text();
                        console.error(`⚠️ Error al guardar archivo ${normalizedFilePath}: ${saveResponse.statusText} - ${errorText}`);
                      }
                    } catch (saveError) {
                      console.error(`⚠️ Error guardando archivo ${normalizedFilePath}:`, saveError);
                    }
                  }
                  const contentForCompletion = finalContent;
                  setFileProgress(prev => ({
                    ...prev,
                    [file.path]: {
                      ...prev[file.path],
                      status: 'completed',
                      content: contentForCompletion,
                      progress: 100,
                      linesGenerated: contentForCompletion.split('\n').length
                    }
                  }));
                  completedCount++;
                  setOverallProgress(completedCount / totalFiles * 100);
                  if (completedCount === totalFiles) {
                    setCurrentGeneratingFile(null);
                    setLoading(false);

                    // ✅ Post-corrección INMEDIATA de app/page.tsx: se ejecuta justo cuando terminan todos los archivos y se pasa a la última pantalla
                    try {
                      console.log('[FLUJO] Iniciando post-corrección de app/page.tsx...');
                      await runPostCorrectAppPageWhenComplete(newCompletedFiles);
                      console.log('[FLUJO] Post-corrección terminada. Iniciando fix-missing-imports...');
                      await runFixMissingImportsRef.current?.();
                    } catch (e) {
                      console.warn('[FLUJO] Error en post-corrección o fix-imports:', e);
                    }

                    // Resolve a real PocketBase projectId (create one if the provided ID doesn't exist)
                    let targetProjectId = projectId;
                    try {
                      if (targetProjectId) {
                        const chk = await fetch(`/api/projects?id=${encodeURIComponent(targetProjectId)}`, { cache: 'no-store' });
                        if (!chk.ok) {
                          // Create new PB project record
                          const createResp = await fetch('/api/projects', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              name: formData.appName,
                              userId: user?.id,
                              selectedModel: selectedModel,
                              description: formData.description,
                              path: projectRoot || '',
                              database_type: false,
                              // Detectar LOCAL por hostname del navegador; producción en cualquier otro caso
                              isLocal: typeof window !== 'undefined' && (
                                window.location.hostname === 'localhost' ||
                                window.location.hostname === '127.0.0.1' ||
                                window.location.hostname.includes('local')
                              )
                            })
                          });
                          if (createResp.ok) {
                            const rec = await createResp.json();
                            targetProjectId = rec?.id || targetProjectId;
                            try { setCtxProjectId?.(targetProjectId ?? null); } catch { }
                          }
                        }
                      }
                    } catch { }

                    if (!hasTransitionedToCompleteRef.current) {
                      hasTransitionedToCompleteRef.current = true;
                      setCompletedFiles(newCompletedFiles);
                      propOnCompletedFilesChange?.(newCompletedFiles);
                      setStep('complete');
                      if (onComplete) {
                        onComplete(newCompletedFiles);
                      }
                    }

                    // ✅ BUCLE RECURSIVO: Revisar y corregir importaciones faltantes hasta que no queden más
                    // Esto asegura que todos los componentes estén bien conectados, incluso los recién creados
                    let fixResult: any = null;
                    try {
                      if (targetProjectId && projectRoot) {
                        console.log('🔍 Iniciando revisión recursiva de importaciones faltantes...');
                        setIsPostProcessing(true);

                        // Función recursiva para revisar importaciones
                        const checkAndFixImports = async (round: number = 1, maxRounds: number = 10, previousCreatedFiles: string[] = [], previousCreatedContents: Record<string, string> = {}): Promise<void> => {
                          console.log(`\n🔄 ========== RONDA ${round} de revisión de importaciones faltantes ==========`);

                          // ✅ En rondas siguientes (round > 1), escanear solo los archivos creados en la ronda anterior
                          const filesToScan = round > 1 && previousCreatedFiles.length > 0
                            ? previousCreatedFiles
                            : undefined;

                          // ✅ Pasar el contenido de los archivos creados para no depender del disco (crítico en Vercel/serverless)
                          const filesWithContent = round > 1 && Object.keys(previousCreatedContents).length > 0
                            ? previousCreatedContents
                            : undefined;

                          if (filesToScan) {
                            console.log(`📋 Escaneando solo ${filesToScan.length} archivo(s) recién creado(s) en esta ronda (con contenido proporcionado)`, filesToScan);
                          } else {
                            console.log(`📋 Escaneando todos los archivos del proyecto (ronda inicial)`);
                          }

                          const fixImportsResponse = await fetch('/api/fix-missing-imports', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              projectRoot: projectRoot,
                              projectId: targetProjectId,
                              userToken: user?.token,
                              userId: user?.id,
                              modelId: selectedModel?.id,
                              stream: true, // ✅ Activar streaming
                              filesToScan: filesToScan,
                              filesWithContent: filesWithContent // ✅ Contenido de archivos creados para escanear sin depender del disco
                            })
                          });

                          if (fixImportsResponse.ok) {
                            // ✅ Marcar que el body será consumido por el stream
                            let bodyConsumed = false;
                            let fixResult: any = null;
                            const streamAccum: any = {
                              totalFound: 0,
                              totalCreated: 0,
                              createdFiles: [] as string[],
                              createdContents: {} as Record<string, string>,
                              generationLogs: [] as any[],
                              hasMore: false,
                            };

                            try {
                              // ✅ Procesar respuesta streaming
                              const reader = fixImportsResponse.body?.getReader();
                              const decoder = new TextDecoder();
                              let buffer = '';

                              if (reader) {
                                bodyConsumed = true; // Marcar que el body está siendo consumido
                                // Procesar stream
                                while (true) {
                                  const { done, value } = await reader.read();
                                  if (done) break;

                                  buffer += decoder.decode(value, { stream: true });
                                  const lines = buffer.split('\n\n');
                                  buffer = lines.pop() || '';

                                  for (const line of lines) {
                                    if (line.startsWith('data: ')) {
                                      try {
                                        const data = JSON.parse(line.slice(6));

                                        if (data.type === 'start') {
                                          console.log('🔍', data.message);
                                        } else if (data.type === 'found') {
                                          console.log(`📋 ${data.message}`);
                                          if (typeof data.total === 'number') streamAccum.totalFound = data.total;
                                        } else if (data.type === 'ready') {
                                          console.log(`📦 ${data.message}`);
                                          if (typeof data.hasMore === 'boolean') streamAccum.hasMore = data.hasMore;
                                        } else if (data.type === 'skipped') {
                                          console.log(`⏭️ ${data.message}`);
                                        } else if (data.type === 'generating') {
                                          console.log(`🔄 ${data.message}`);
                                        } else if (data.type === 'generated') {
                                          console.log(`✅ ${data.message}`);
                                          if (data.file && typeof data.file === 'string') {
                                            if (!streamAccum.createdFiles.includes(data.file)) {
                                              streamAccum.createdFiles.push(data.file);
                                            }
                                            if (typeof data.content === 'string' && data.content.length > 0) {
                                              streamAccum.createdContents[data.file] = data.content;
                                            }
                                          }
                                        } else if (data.type === 'error') {
                                          console.warn(`⚠️ ${data.message}`);
                                        } else if (data.type === 'complete') {
                                          fixResult = data;
                                        }
                                      } catch (e) {
                                        // Ignorar errores de parsing
                                      }
                                    }
                                  }
                                }
                              } else {
                                // Fallback a JSON normal si no hay stream
                                // ✅ Usar clone() para poder leer el body sin consumir el original
                                bodyConsumed = true; // Marcar que el body será consumido
                                fixResult = await fixImportsResponse.clone().json();
                              }

                              // ✅ NO intentar leer JSON nuevamente si ya procesamos el stream
                              // El stream ya fue consumido, fixResult debería estar en el evento 'complete'

                              // ✅ Verificar que tenemos un resultado válido
                              if (!fixResult) {
                                // Si el stream se corta antes de 'complete', usar lo acumulado de 'generated'
                                streamAccum.totalCreated = streamAccum.createdFiles.length;
                                if (streamAccum.totalCreated > 0 || streamAccum.totalFound > 0) {
                                  console.warn('⚠️ No se recibió evento complete del stream; usando resultado parcial acumulado');
                                  fixResult = streamAccum;
                                } else {
                                  console.warn('⚠️ No se recibió resultado completo del stream (puede ser normal si no hay componentes faltantes)');
                                  fixResult = { totalFound: 0, totalCreated: 0, createdFiles: [], generationLogs: [], hasMore: false };
                                }
                              }

                              console.log(`[postgen] Respuesta recibida:`, {
                                totalFound: fixResult.totalFound || 0,
                                totalCreated: fixResult.totalCreated || 0,
                                createdFiles: fixResult.createdFiles?.length || 0,
                                generationLogs: fixResult.generationLogs?.length || 0
                              });

                              // Mostrar logs de generación en la consola
                              if (fixResult.generationLogs && Array.isArray(fixResult.generationLogs)) {
                                console.log('📊 Logs de generación de componentes:');
                                fixResult.generationLogs.forEach((log: any) => {
                                  if (log.status === 'success') {
                                    console.log(`✅ ${log.file}: ${log.message}`);
                                  } else if (log.status === 'fallback') {
                                    console.warn(`⚠️ ${log.file}: ${log.message}`);
                                  } else {
                                    console.log(`ℹ️ ${log.file}: ${log.message}`);
                                  }
                                });
                              }

                              if (fixResult.createdFiles && fixResult.createdFiles.length > 0) {
                                console.log(`✅ Se crearon ${fixResult.createdFiles.length} componentes faltantes:`, fixResult.createdFiles);

                                // ✅ Verificar si hay más componentes pendientes
                                if (fixResult.hasMore) {
                                  console.log(`🔄 Hay más componentes pendientes, se procesarán en la siguiente ronda...`);
                                }

                                // Agregar los archivos creados a newCompletedFiles para integrarlos en el estado
                                // ✅ FLUJO CORRECTO: Primero actualizar ZIP, luego sincronizar disco desde ZIP
                                if (fixResult.createdContents) {
                                  // Paso 1: Actualizar completedFiles y newCompletedFiles en memoria
                                  const fileUpdates: Array<{ filePath: string; content: string }> = [];

                                  for (const [filePath, content] of Object.entries(fixResult.createdContents)) {
                                    const normalizedPath = (filePath as string).startsWith('/') ? (filePath as string).slice(1) : (filePath as string);
                                    newCompletedFiles[normalizedPath] = content as string;
                                    setCompletedFiles(prev => ({
                                      ...prev,
                                      [normalizedPath]: content as string
                                    }));
                                    fileUpdates.push({
                                      filePath: normalizedPath,
                                      content: content as string
                                    });
                                    console.log(`✅ Componente integrado en memoria: ${normalizedPath}`);
                                  }

                                  console.log(`📋 Total de componentes integrados en memoria: ${fileUpdates.length}`);
                                } else {
                                  console.warn('⚠️ La API no devolvió el contenido de los archivos creados');
                                }
                              } else {
                                console.log('✅ No se encontraron importaciones faltantes en esta ronda');
                              }

                              // ✅ Verificar si hay más importaciones faltantes y continuar el bucle
                              const shouldContinue = (fixResult && fixResult.totalCreated > 0) || (fixResult && fixResult.hasMore);

                              if (shouldContinue) {
                                if (fixResult.hasMore) {
                                  console.log(`\n🔄 Ronda ${round} completada: ${fixResult.totalCreated || 0} componentes creados`);
                                  console.log(`⚠️ Hay más componentes pendientes (límite por request para evitar timeout de Vercel)`);
                                  console.log(`🔄 Continuando con la siguiente ronda para procesar los restantes...`);
                                } else {
                                  console.log(`\n📊 Ronda ${round} completada: ${fixResult.totalCreated} componentes creados`);
                                  console.log(`🔄 Los componentes recién creados pueden tener importaciones faltantes.`);
                                  console.log(`🔄 Continuando con la siguiente ronda para verificar...`);
                                }

                                // Esperar un momento antes de la siguiente ronda para asegurar que todo esté sincronizado
                                await new Promise(resolve => setTimeout(resolve, 2000));

                                // Continuar con la siguiente ronda si no hemos alcanzado el límite
                                if (round < maxRounds) {
                                  // Si hay más componentes pendientes por timeout, escanear todos los archivos de nuevo
                                  // Si no, solo escanear los archivos creados en esta ronda
                                  const createdInThisRound = fixResult.hasMore ? undefined : (fixResult.createdFiles || []);
                                  const createdContentsForNextRound = fixResult.hasMore ? {} : (fixResult.createdContents || {});
                                  return await checkAndFixImports(round + 1, maxRounds, createdInThisRound || [], createdContentsForNextRound);
                                } else {
                                  console.warn(`\n⚠️ Se alcanzó el límite de ${maxRounds} rondas. Puede haber importaciones faltantes pendientes.`);
                                  console.log('✅ Revisión recursiva finalizada (límite alcanzado).');
                                }
                              } else {
                                console.log(`\n✅ Ronda ${round} completada: No se encontraron más importaciones faltantes.`);
                                console.log('✅ Revisión recursiva de importaciones completada exitosamente.');
                              }

                              return fixResult; // Retornar el resultado para que pueda ser usado fuera de la función
                            } catch (parseError: any) {
                              // ✅ NO intentar leer el body si ya fue consumido por el stream
                              // El error ya contiene información suficiente
                              const errorMsg = parseError?.message || String(parseError);

                              // Si el error es sobre el body ya leído, solo loguear sin intentar leerlo de nuevo
                              if (errorMsg.includes('body stream already read') || errorMsg.includes('already read')) {
                                console.warn('⚠️ El body del stream ya fue consumido (esto es normal para streams)');
                              } else {
                                console.error('⚠️ Error parseando respuesta de fix-missing-imports:', errorMsg);
                              }

                              // Si no hay fixResult, crear uno vacío para evitar errores posteriores
                              if (!fixResult) {
                                fixResult = { totalFound: 0, totalCreated: 0, createdFiles: [], generationLogs: [] };
                              }

                              // Si hay un error, no continuar con más rondas
                              console.error(`❌ Error en ronda ${round}, deteniendo revisión recursiva.`);
                              return fixResult;
                            }
                          } else {
                            // Si la respuesta no es OK, no continuar con más rondas
                            console.error(`❌ Error en ronda ${round}: La API respondió con error.`);
                            try {
                              const errorText = await fixImportsResponse.text();
                              console.error('Error:', errorText);
                            } catch { }
                            return;
                          }
                        };

                        // Iniciar la revisión recursiva
                        fixResult = await checkAndFixImports(1, 10);

                        setIsPostProcessing(false);
                      }
                    } catch (fixImportsError) {
                      console.warn('⚠️ Error revisando importaciones (no crítico):', fixImportsError);
                      setIsPostProcessing(false);
                    }

                    // ✅ El ZIP ya se actualizó correctamente en el servidor
                    // El servidor maneja la creación del ZIP completo con archiver después de generar la aplicación
                    // Y fix-missing-imports actualiza el ZIP con los componentes nuevos
                    // NO crear ZIP desde el cliente para evitar sobrescribir el ZIP completo del servidor
                    console.log('ℹ️ ZIP ya actualizado por el servidor:');
                    console.log('   1. generate-app creó ZIP completo con archiver (aplicación base)');
                    console.log('   2. fix-missing-imports actualizó ZIP con componentes nuevos');
                    console.log('   ✅ No se creará ZIP desde cliente para evitar sobrescribir');

                    // ⚠️ DESHABILITADO: No crear ZIP desde cliente
                    // El ZIP del cliente solo incluye archivos de esta sesión (newCompletedFiles)
                    // y sobrescribe el ZIP completo del servidor que tiene aplicación + componentes
                    // Mantener esta lógica deshabilitada para evitar pérdida de datos

                    // ✅ VALIDACIÓN DE COMPONENTES: Revisar todos los componentes creados
                    try {
                      if (targetProjectId && projectRoot && user?.id && selectedModel?.id) {
                        // ✅ Corrección de app/page: siempre se ejecuta aquí (en validaciones), en primer plano, antes de validar componentes
                        console.log('🔍 [VALIDATE-COMPONENTS] Ejecutando corrección de app/page en primer plano...');
                        setFileInPostCorrection('app/page.tsx');
                        try {
                          const appPageKey = Object.keys(newCompletedFiles).find(k =>
                            k === 'app/page.tsx' || k === 'src/app/page.tsx' || k.endsWith('/app/page.tsx')
                          );
                          const contentForCorrection = appPageKey ? newCompletedFiles[appPageKey] : undefined;
                          const correctResult = await runPostCorrectPage('app/page.tsx', contentForCorrection);
                          // Incorporar contenido corregido a newCompletedFiles para persistir localmente
                          if (correctResult?.content && correctResult?.filePath) {
                            const pathKey = (correctResult.filePath ?? '')
                              .replace(/\\/g, '/')
                              .replace(/^\/+/, '');
                            if (pathKey) {
                              newCompletedFiles[pathKey] = correctResult.content;
                            }
                          }
                        } catch (correctErr) {
                          console.warn('⚠️ [VALIDATE-COMPONENTS] Error corrigiendo app/page antes de validaciones (no crítico):', correctErr);
                        } finally {
                          setFileInPostCorrection(null);
                        }
                        console.log('🔍 [VALIDATE-COMPONENTS] ============================================');
                        console.log('🔍 [VALIDATE-COMPONENTS] Iniciando validación de componentes...');
                        console.log('🔍 [VALIDATE-COMPONENTS] ProjectId:', targetProjectId);
                        console.log('🔍 [VALIDATE-COMPONENTS] ProjectRoot:', projectRoot);
                        console.log('🔍 [VALIDATE-COMPONENTS] ============================================');
                        setIsPostProcessing(true);

                        const codegenLikeExt = /\.(tsx|ts|jsx|js)$/i;
                        const filesFromSession = Object.keys(newCompletedFiles || {}).filter((p) => codegenLikeExt.test(p));
                        const filesFromFixImports = Array.isArray(fixResult?.createdFiles) ? fixResult.createdFiles : [];
                        const mergedValidatePaths = [...new Set(
                          [...filesFromSession, ...filesFromFixImports].map((f) =>
                            String(f || '').replace(/\\/g, '/').replace(/^\/+/, '')
                          )
                        )].filter(Boolean);

                        const safeModelConfigVc = selectedModel
                          ? {
                            id: selectedModel.id,
                            name: (selectedModel as any).name ?? (selectedModel as any).nombre_modelo,
                            model: (selectedModel as any).model ?? (selectedModel as any).model_name,
                            provider: (selectedModel as any).provider,
                            url: (selectedModel as any).url ?? (selectedModel as any).base_url,
                            apiKey: (selectedModel as any).apiKey ?? (selectedModel as any).api_key,
                          }
                          : undefined;

                        const validateBodyVc = {
                          projectRoot: projectRoot,
                          projectId: targetProjectId,
                          userId: user.id,
                          modelId: selectedModel.id,
                          userToken: user.token,
                          modelConfig: safeModelConfigVc,
                          autoCorrect: true,
                          filesToValidate: mergedValidatePaths.length > 0 ? mergedValidatePaths : undefined,
                        };

                        console.log('[VALIDATE-COMPONENTS] Rutas a validar:', mergedValidatePaths.length, mergedValidatePaths.slice(0, 30));

                        const validateResponse = await fetch('/api/validate-components', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(validateBodyVc),
                        });

                        if (validateResponse.ok) {
                          const validationResult = await validateResponse.json();
                          await streamValidationToTerminal(validationResult, 'VALIDATE-COMPONENTS');
                          const validationComponents = Array.isArray(validationResult?.components) ? validationResult.components : [];
                          console.log('✅ [VALIDATE-COMPONENTS] ============================================');
                          console.log('✅ [VALIDATE-COMPONENTS] Validación completada');
                          console.log('✅ [VALIDATE-COMPONENTS] Resumen:', validationResult.summary);
                          console.log('✅ [VALIDATE-COMPONENTS] Componentes válidos:', validationResult.validComponents);
                          console.log('✅ [VALIDATE-COMPONENTS] Componentes con problemas:', validationResult.invalidComponents);

                          // ✅ Guardar las sugerencias de validación para mostrarlas en la UI
                          const suggestionsToSave = {
                            summary: validationResult.summary,
                            components: validationComponents
                          };
                          console.log('[VALIDATE-COMPONENTS] Guardando sugerencias en estado...', {
                            hasSummary: !!suggestionsToSave.summary,
                            componentsCount: suggestionsToSave.components.length,
                            componentsWithIssues: suggestionsToSave.components.filter((c: any) => c && c.issues && Array.isArray(c.issues) && c.issues.length > 0).length
                          });
                          setValidationSuggestions(suggestionsToSave);
                          console.log('[VALIDATE-COMPONENTS] ✅ Sugerencias guardadas en estado. Estado actualizado.');

                          // Log componentes con problemas y aplicar correcciones automáticas
                          const invalidComps = validationComponents.filter((c: any) => c && c.isValid === false);
                          let correctedCount = 0;

                          if (invalidComps.length > 0) {
                            console.warn('⚠️ [VALIDATE-COMPONENTS] Componentes con problemas:');
                            for (const comp of invalidComps) {
                              console.warn(`  - ${comp.relativePath}:`);
                              comp.issues.forEach((issue: any) => {
                                console.warn(`    [${issue.severity}] ${issue.message}`);
                                if (issue.suggestion) {
                                  console.warn(`      Sugerencia: ${issue.suggestion}`);
                                }
                              });

                              // ✅ APLICAR CORRECCIÓN AUTOMÁTICA si hay código corregido disponible
                              if (comp.correctedCode && projectRoot && targetProjectId) {
                                try {
                                  console.log(`🔧 [VALIDATE-COMPONENTS] Aplicando corrección automática a: ${comp.relativePath}`);

                                  // Limpiar el código corregido antes de enviarlo
                                  // Asegurar que no tiene caracteres de control problemáticos
                                  let cleanedCode = comp.correctedCode;

                                  // Reemplazar caracteres de control (excepto \n, \r, \t) con espacios
                                  cleanedCode = cleanedCode.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ');

                                  // Intentar serializar para verificar que es JSON válido
                                  try {
                                    JSON.stringify({ test: cleanedCode });
                                  } catch (jsonError) {
                                    console.warn(`⚠️ [VALIDATE-COMPONENTS] El código corregido contiene caracteres problemáticos para ${comp.relativePath}, omitiendo corrección`);
                                    continue; // Saltar esta corrección
                                  }

                                  // Guardar el código corregido
                                  const saveResponse = await sessionFetch('/api/save-file', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      filePath: comp.relativePath,
                                      content: cleanedCode,
                                      projectRoot: projectRoot,
                                      projectId: targetProjectId
                                    })
                                  });

                                  if (saveResponse.ok) {
                                    correctedCount++;
                                    console.log(`✅ [VALIDATE-COMPONENTS] Corrección aplicada exitosamente a: ${comp.relativePath}`);

                                    // Actualizar el estado local si el archivo está en memoria (usar código limpiado)
                                    const normalizedPath = comp.relativePath.startsWith('/') ? comp.relativePath.slice(1) : comp.relativePath;
                                    if (newCompletedFiles[normalizedPath]) {
                                      newCompletedFiles[normalizedPath] = cleanedCode;
                                      setCompletedFiles((prev: Record<string, string>) => ({
                                        ...prev,
                                        [normalizedPath]: cleanedCode
                                      }));
                                    }
                                  } else {
                                    const errorText = await saveResponse.text();
                                    console.warn(`⚠️ [VALIDATE-COMPONENTS] Error al guardar corrección para ${comp.relativePath}:`, errorText);
                                  }
                                } catch (correctionError) {
                                  console.warn(`⚠️ [VALIDATE-COMPONENTS] Error aplicando corrección a ${comp.relativePath}:`, correctionError);
                                }
                              } else if (!comp.correctedCode) {
                                console.warn(`⚠️ [VALIDATE-COMPONENTS] No hay código corregido disponible para: ${comp.relativePath}`);
                              }
                            }
                          }

                          if (correctedCount > 0) {
                            console.log(`✅ [VALIDATE-COMPONENTS] Se aplicaron ${correctedCount} correcciones automáticas`);
                          }

                          console.log('✅ [VALIDATE-COMPONENTS] ============================================');

                          // ✅ Guardar sugerencias en PocketBase (siempre, incluso si hay errores)
                          if (targetProjectId && suggestionsToSave) {
                            try {
                              const pb = getPocketBase();
                              // Convertir las sugerencias a texto para guardarlas en el campo sugerencias_ia
                              const sugerenciasTexto = JSON.stringify(suggestionsToSave, null, 2);

                              // Verificar el tamaño del texto (PocketBase tiene límites)
                              const textSize = new Blob([sugerenciasTexto]).size;
                              console.log('[VALIDATE-COMPONENTS] Tamaño de sugerencias a guardar:', textSize, 'bytes');

                              // Si el texto es muy grande, truncar o comprimir
                              let textoFinal = sugerenciasTexto;
                              const MAX_SIZE = 100000; // 100KB límite razonable para texto
                              if (textSize > MAX_SIZE) {
                                console.warn('[VALIDATE-COMPONENTS] ⚠️ Las sugerencias son muy grandes, truncando...');
                                // Mantener solo el resumen y los primeros componentes
                                const truncated = {
                                  summary: suggestionsToSave.summary,
                                  components: Array.isArray(suggestionsToSave.components)
                                    ? suggestionsToSave.components.slice(0, 10) // Solo primeros 10 componentes
                                    : []
                                };
                                textoFinal = JSON.stringify(truncated, null, 2);
                                console.log('[VALIDATE-COMPONENTS] Sugerencias truncadas a', new Blob([textoFinal]).size, 'bytes');
                              }

                              // Intentar actualizar el proyecto
                              console.log('[VALIDATE-COMPONENTS] Intentando actualizar proyecto con sugerencias...', {
                                projectId: targetProjectId,
                                textSize: new Blob([textoFinal]).size
                              });

                              // Obtener el registro actual primero para verificar que existe
                              const currentProject = await (await pb).collection('projects').getOne(targetProjectId);
                              console.log('[VALIDATE-COMPONENTS] Proyecto obtenido, campos disponibles:', Object.keys(currentProject));

                              // Intentar actualizar solo el campo sugerencias_ia
                              const updateData: any = {
                                sugerencias_ia: textoFinal
                              };

                              await (await pb).collection('projects').update(targetProjectId, updateData);

                              console.log('[VALIDATE-COMPONENTS] ✅ Sugerencias guardadas en PocketBase en el campo sugerencias_ia');
                            } catch (pbError: any) {
                              console.error('❌ [VALIDATE-COMPONENTS] Error guardando sugerencias en PocketBase:', pbError);

                              // Log detallado del error
                              if (pbError?.response) {
                                console.error('[VALIDATE-COMPONENTS] Detalles del error:', {
                                  status: pbError.response.status,
                                  data: pbError.response.data,
                                  message: pbError.message
                                });

                                // Si el campo no existe, intentar crear el campo o usar otro método
                                if (pbError.response?.status === 400) {
                                  console.warn('[VALIDATE-COMPONENTS] ⚠️ Error 400: El campo sugerencias_ia podría no existir en PocketBase');
                                  console.warn('[VALIDATE-COMPONENTS] ⚠️ Por favor, verifica que el campo sugerencias_ia existe en la colección projects');
                                }
                              }

                              // Mostrar error pero no interrumpir el flujo
                            }
                          } else {
                            console.warn('⚠️ [VALIDATE-COMPONENTS] No se pueden guardar sugerencias: targetProjectId o suggestionsToSave faltantes', {
                              hasTargetProjectId: !!targetProjectId,
                              hasSuggestions: !!suggestionsToSave
                            });
                          }
                        } else {
                          // Si la validación falla, limpiar sugerencias previas para evitar confusión
                          setValidationSuggestions(null);
                          console.log('[VALIDATE-COMPONENTS] Validación falló, limpiando sugerencias');
                          // Clone the response before reading to avoid "body stream already read" error
                          const responseClone = validateResponse.clone();
                          try {
                            const errorData = await responseClone.json();
                            console.warn('⚠️ [VALIDATE-COMPONENTS] Validación falló (no crítico):', errorData.error);
                            if (errorData.details) {
                              console.warn('⚠️ [VALIDATE-COMPONENTS] Detalles:', errorData.details);
                            }
                          } catch (parseError) {
                            try {
                              const errorText = await validateResponse.text();
                              console.warn('⚠️ [VALIDATE-COMPONENTS] Validación falló (no crítico) - Error parseando respuesta:', errorText);
                            } catch (textError) {
                              console.warn('⚠️ [VALIDATE-COMPONENTS] Validación falló (no crítico) - No se pudo leer la respuesta');
                            }
                          }
                        }

                        // ✅ Aplicar correcciones localmente (sin crear ZIP en PocketBase)
                        if (targetProjectId && projectRoot && Object.keys(newCompletedFiles).length > 0) {
                          setCompletedFiles(newCompletedFiles);
                          propOnCompletedFilesChange?.(newCompletedFiles);
                        }

                        setIsPostProcessing(false);
                      }
                    } catch (validateError) {
                      console.warn('⚠️ [VALIDATE-COMPONENTS] Error en validación de componentes (no crítico):', validateError);
                      // Limpiar sugerencias si hay un error
                      setValidationSuggestions(null);
                      setIsPostProcessing(false);
                    }
                  }
                } else if (parsed.type === 'error') {
                  throw new Error(parsed.error || 'Error generando contenido');
                }
              } catch (parseError) {
                // ✅ Si el error viene de un evento SSE 'error', re-lanzarlo para que sea
                // capturado por el catch externo de generateFileContent y la promesa se resuelva.
                if (parseError instanceof Error && parseError.message.includes('Error generando contenido')) {
                  throw parseError;
                }
                console.error('Error parsing SSE data:', parseError);
              }
            }
          }
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Error desconocido';
        setFileProgress(prev => ({
          ...prev,
          [file.path]: {
            ...prev[file.path],
            status: 'error',
            error: errorMessage
          }
        }));
        console.error(`Error generando ${file.path}:`, err);

        // ✅ Contar errores como "terminado" para que el flujo no se quede bloqueado en el último archivo
        completedCount++;
        setOverallProgress(completedCount / totalFiles * 100);
        if (completedCount === totalFiles) {
          setCurrentGeneratingFile(null);
          setLoading(false);

          try {
            await runPostCorrectAppPageWhenComplete(newCompletedFiles);
            await runFixMissingImportsRef.current?.();
          } catch { }

          // Resolve a real PocketBase projectId (create one if the provided ID doesn't exist)
          let targetProjectId = projectId;
          try {
            if (targetProjectId) {
              const chk = await fetch(`/api/projects?id=${encodeURIComponent(targetProjectId)}`, { cache: 'no-store' });
              if (!chk.ok) {
                const createResp = await fetch('/api/projects', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    name: formData.appName,
                    userId: user?.id,
                    selectedModel: selectedModel,
                    description: formData.description,
                    path: projectRoot || '',
                    database_type: false,
                    isLocal: typeof window !== 'undefined' && (
                      window.location.hostname === 'localhost' ||
                      window.location.hostname === '127.0.0.1' ||
                      window.location.hostname.includes('local')
                    )
                  })
                });
                if (createResp.ok) {
                  const rec = await createResp.json();
                  targetProjectId = rec?.id || targetProjectId;
                  try { setCtxProjectId?.(targetProjectId ?? null); } catch { }
                }
              }
            }
          } catch { }

          if (!hasTransitionedToCompleteRef.current) {
            hasTransitionedToCompleteRef.current = true;
            setCompletedFiles(newCompletedFiles);
            propOnCompletedFilesChange?.(newCompletedFiles);
            setStep('complete');
            if (onComplete) {
              onComplete(newCompletedFiles);
            }
          }
        }
      }
    };

    // Now, execute the file generation in parallel
    // ✅ Usar Promise.allSettled para que si un archivo falla o se queda colgado,
    // los demás continúen y el flujo no se bloquee indefinidamente.
    // ✅ Timeout global de seguridad: si la generación tarda más de 20 minutos,
    // forzar la continuación del flujo para evitar quedarse atascado.
    const GLOBAL_GENERATION_TIMEOUT_MS = 1200000; // 20 minutos
    const generationPromise = Promise.allSettled(prioritizedFiles.map(generateFileContent));
    const globalTimeoutPromise = new Promise<any[]>((resolve) => {
      setTimeout(() => {
        console.warn(`[generateContentWithStructure] Timeout global (${GLOBAL_GENERATION_TIMEOUT_MS}ms) alcanzado. Forzando continuación.`);
        resolve([]);
      }, GLOBAL_GENERATION_TIMEOUT_MS);
    });
    const generationResults = await Promise.race([generationPromise, globalTimeoutPromise]);
    const failedCount = generationResults.filter(r => r.status === 'rejected').length;
    if (failedCount > 0) {
      console.warn(`⚠️ ${failedCount} archivos fallaron durante la generación.`);
    }

    // ✅ Si por alguna razón no se pasó a 'complete' dentro de los callbacks,
    // forzar la transición aquí para evitar quedarse atascado.
    if (!hasTransitionedToCompleteRef.current) {
      console.log('[generateContentWithStructure] Forzando transición a complete tras finalizar generación.');
      hasTransitionedToCompleteRef.current = true;
      setCurrentGeneratingFile(null);
      setLoading(false);
      try {
        await runPostCorrectAppPageWhenComplete(newCompletedFiles);
        await runFixMissingImportsRef.current?.();
      } catch { }
      setCompletedFiles(newCompletedFiles);
      propOnCompletedFilesChange?.(newCompletedFiles);
      setStep('complete');
      if (onComplete) {
        onComplete(newCompletedFiles);
      }
    }
  }, [formData, projectRoot, selectedModel, onComplete, setCompletedFiles, setFileProgress, setCurrentGeneratingFile, setLoading, setStep, setOverallProgress, setError, extractFilesFromStructure, projectId, uploadedFiles, uploadedImages, selectedImageUrls, runPostCorrectAppPageWhenComplete, createFoldersFromStructure, propOnCompletedFilesChange]);

  useEffect(() => {
    if (!shouldAutoStartContentAfterStructureRef.current) return;
    if (!projectStructure) return;
    shouldAutoStartContentAfterStructureRef.current = false;
    generateContentWithStructure(projectStructure, {}).catch((e) => {
      console.error('Error starting content generation after structure generation:', e);
    });
  }, [projectStructure, generateContentWithStructure]);
  // End of generateContentWithStructure



  // Declare variables here to avoid temporal dead zone issues
  const files = projectStructure ? extractFilesFromStructure(projectStructure.structure) : [];
  const showPreferredOS = formData.appType === 'desktop-app' || ['authentication', 'database', 'real-time'].some(f => formData.features.includes(f));
  const completedCount = Object.values(fileProgress).filter(f => f.status === 'completed').length;
  const errorCount = Object.values(fileProgress).filter(f => f.status === 'error').length;

  // Function to resume generation for stuck files
  const resumeStuckFiles = useCallback(async () => {
    if (!projectStructure) return;

    const stuckFiles = files.filter(file => {
      const progress = fileProgress[file.path];
      return !progress || progress.status === 'pending' || progress.status === 'generating';
    });

    if (stuckFiles.length === 0) return;

    console.log(`Resuming generation for ${stuckFiles.length} files`);

    setStep('content');
    setLoading(true);

    const updatedProgress: Record<string, FileProgress> = { ...fileProgress };
    for (const file of stuckFiles) {
      updatedProgress[file.path] = {
        ...(updatedProgress[file.path] || { filePath: file.path }),
        filePath: file.path,
        status: 'pending',
        error: undefined
      };
    }
    setFileProgress(updatedProgress);

    const localProgress: Record<string, FileProgress> = { ...updatedProgress };
    const localCompleted: Record<string, string> = { ...completedFiles };

    const generateSingleFile = async (file: FileStructure) => {
      setCurrentGeneratingFile(file.path);
      setFileProgress(prev => ({
        ...prev,
        [file.path]: {
          ...prev[file.path],
          status: 'generating',
          progress: 0
        }
      }));

      try {
        let finalContent = file.content || '';

        if (file.content) {
          if (file.content.trim().startsWith('await obtenerContenidoTemplate(')) {
            const match = file.content.trim().match(/await\s+obtenerContenidoTemplate\(['"]([^"']+)["'](?:\s*,\s*['"]([^"']+)["'])?(?:\s*,\s*['"]([^"']+)["'])?\)/);
            if (match && match[1]) {
              finalContent = await obtenerContenidoTemplate(match[1], match[2], match[3]);
            }
          } else {
            finalContent = await resolverContenidoTemplate(file.content);
          }
        } else {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 180000);

          const uploadedFilesData = await Promise.all(uploadedFiles.map(async file => {
            const content = await file.text();
            return {
              name: file.name,
              type: file.type,
              size: file.size,
              content: content
            };
          }));

          const uploadedImagesData = await Promise.all(uploadedImages.map(async file => {
            return new Promise<{
              name: string;
              type: string;
              size: number;
              dataUrl: string;
              path: string;
              url?: string;
            }>(resolve => {
              const reader = new FileReader();
              reader.onload = () => {
                resolve({
                  name: file.name,
                  type: file.type,
                  size: file.size,
                  dataUrl: reader.result as string,
                  path: `/uploads/${file.name}`
                });
              };
              reader.readAsDataURL(file);
            });
          }));

          const selectedImagesData = selectedImageUrls.map((url, index) => {
            const urlName = url.split('/').pop()?.split('?')[0] || `selected-image-${index + 1}.jpg`;
            return {
              name: urlName,
              type: 'image/jpeg',
              size: 0,
              dataUrl: '',
              url: url
            };
          });
          const allImagesData = [...uploadedImagesData, ...selectedImagesData];

          let apiEndpoint = '/api/generate-app-page-web/content';
          if (formData.template === 'next-js' && formData.appType === 'web-app') {
            apiEndpoint = '/api/generate-app/content';
          } else if (formData.template === 'next-js' && formData.appType === 'mobile-app') {
            apiEndpoint = '/api/generate-app-movil/content';
          } else if (formData.template === 'next-js' && formData.appType === 'desktop-app') {
            apiEndpoint = '/api/generate-app-escritorio/content';
          } else if (formData.template === 'next-js' && !formData.appType || formData.template === 'vite-react' || ['html-css-js', 'astro', 'eleventy'].includes(formData.template)) {
            apiEndpoint = '/api/generate-app-page-web/content';
          } else if (['react-native', 'flutter', 'swift-ui', 'kotlin-compose'].includes(formData.template)) {
            apiEndpoint = '/api/generate-app-movil/content';
          }

          const response = await fetch(apiEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filePath: file.path,
              template: formData.template,
              appName: formData.appName,
              complexity: formData.complexity,
              features: formData.features,
              description: formData.description,
              projectStructure: projectStructure.structure,
              modelConfig: selectedModel,
              projectRoot: projectRoot,
              optimizeForSpeed: true,
              uploadedFiles: uploadedFilesData,
              uploadedImages: allImagesData,
              authMethod: formData.features.includes('authentication') ? 'pocketbase' : 'none',
              requiresAuth: formData.features.includes('authentication'),
              databaseType: formData.features.includes('database') ? 'pocketbase' : 'none',
              requiresDatabase: formData.features.includes('database'),
              additionalPages: projectStructure.metadata?.additionalPages
            }),
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          if (!response.ok) {
            throw new Error(`Error ${response.status}: ${response.statusText}`);
          }
          const reader = response.body?.getReader();
          if (!reader) throw new Error('No se pudo obtener el reader del stream');

          const decoder = new TextDecoder();
          let sseBuffer = '';
          let accumulatedContent = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            sseBuffer += decoder.decode(value, { stream: true });

            const events = sseBuffer.split('\n\n');
            sseBuffer = events.pop() || '';

            for (const evt of events) {
              const lines = evt.split('\n');
              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data: ')) continue;
                const data = trimmed.slice(6);
                const parsed = JSON.parse(data);
                if (parsed.type === 'content') {
                  accumulatedContent += parsed.chunk || '';
                  setFileProgress(prev => ({
                    ...prev,
                    [file.path]: {
                      ...prev[file.path],
                      progress: parsed.metadata?.progress || 0,
                      linesGenerated: parsed.metadata?.linesGenerated || 0
                    }
                  }));
                } else if (parsed.type === 'complete') {
                  finalContent = parsed.content || accumulatedContent;
                  finalContent = correctAndFinalizeContent(finalContent, file.path);
                } else if (parsed.type === 'error') {
                  throw new Error(parsed.error || 'Error generando contenido');
                }
              }
            }
          }
        }

        if (projectRoot) {
          const normalizedFilePath = file.path.startsWith('/') ? file.path.slice(1) : file.path;
          try {
            await sessionFetch('/api/save-file', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                filePath: normalizedFilePath,
                content: finalContent,
                projectRoot: projectRoot,
                projectId: projectId
              })
            });
          } catch { }
        }

        setCompletedFiles(prev => ({
          ...prev,
          [file.path]: finalContent
        }));

        localCompleted[file.path] = finalContent;
        localProgress[file.path] = {
          ...(localProgress[file.path] || { filePath: file.path }),
          filePath: file.path,
          status: 'completed',
          content: finalContent,
          progress: 100,
          linesGenerated: finalContent.split('\n').length
        };

        setFileProgress(prev => ({
          ...prev,
          [file.path]: {
            ...prev[file.path],
            status: 'completed',
            content: finalContent,
            progress: 100,
            linesGenerated: finalContent.split('\n').length
          }
        }));
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Error desconocido';
        setFileProgress(prev => ({
          ...prev,
          [file.path]: {
            ...prev[file.path],
            status: 'error',
            error: errorMessage
          }
        }));

        localProgress[file.path] = {
          ...(localProgress[file.path] || { filePath: file.path }),
          filePath: file.path,
          status: 'error',
          error: errorMessage
        };
      }
    };

    for (const file of stuckFiles) {
      await generateSingleFile(file);
    }

    setCurrentGeneratingFile(null);
    setLoading(false);

    try {
      const allFiles = extractFilesFromStructure(projectStructure.structure);
      const allCompleted = allFiles.length > 0 && allFiles.every(f => {
        const p = localProgress[f.path];
        return p?.status === 'completed' || p?.status === 'error';
      });
      if (allCompleted) {
        try {
          await runPostCorrectAppPageWhenComplete(localCompleted);
          await runFixMissingImportsRef.current?.();
        } catch { }
        setCompletedFiles({ ...localCompleted });
        setStep('complete');
        if (onComplete) {
          onComplete({ ...localCompleted });
        }
      }
    } catch { }
  }, [projectStructure, files, fileProgress, projectId, projectRoot, formData, selectedModel, uploadedFiles, uploadedImages, selectedImageUrls, extractFilesFromStructure, setStep, setLoading, setFileProgress, setCurrentGeneratingFile, setCompletedFiles, completedFiles, onComplete, runPostCorrectAppPageWhenComplete]);


  const handleFeatureToggle = (feature: string) => {
    const newFeatures = formData.features.includes(feature) ? formData.features.filter(f => f !== feature) : [...formData.features, feature];
    setFormData(prev => ({
      ...prev,
      features: prev.features.includes(feature) ? prev.features.filter(f => f !== feature) : [...prev.features, feature]
    }));

    // Si se está activando la opción de desplegar base de datos, abrir modal
    if (feature === 'deploy-db' && !formData.features.includes('deploy-db')) {
      setDeployForm(prev => ({
        ...prev,
        appName: formData.appName || prev.appName
      }));
      setShowDeployModal(true);
    }
  };
  const submitDeploy = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsDeploying(true);
    setDeployError(null);
    setDeploySuccess(false);
    // Normalizar el nombre para Fly (minúsculas, números y guiones, <=63, empezar por letra)
    const flyAppName = (() => {
      const raw = (deployForm.appName || formData.appName || '').trim();
      let s = slugify(raw).toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
      if (!/^[a-z]/.test(s)) s = `a${s}`; // asegurar que empieza por letra
      if (s.length > 63) s = s.slice(0, 63).replace(/-+$/g, '');
      return s || 'app';
    })();
    try {
      // Envío al API interno Next.js (JSON)
      const res = await fetch('/api/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          flyApiToken: deployForm.flyApiToken,
          pocketbaseEmail: deployForm.pocketbaseEmail,
          pocketbasePassword: deployForm.pocketbasePassword,
          appName: flyAppName,
          region: deployForm.region,
          memory: Number(deployForm.memory),
          organizationId: deployForm.organizationId,
          pocketbaseVersion: deployForm.pocketbaseVersion
        })
      });
      const data = await res.json();
      if (!res.ok) {
        const errMsg = data?.error || 'Error en el despliegue';
        const details = data?.details ? `\nDetalles: ${JSON.stringify(data.details)}` : '';
        const suggestion = data?.suggestion ? `\nSugerencia: ${data.suggestion}` : '';
        throw new Error(`${errMsg}${details}${suggestion}\nNombre original: ${deployForm.appName}\nNombre normalizado: ${flyAppName}`);
      }
      setDeploySuccess(true);
      // Reset feedback before primer auto-refresh
      setIpsFetched(false);
      setIpsError(null);
      setDeploymentInfo({
        appUrl: data.appUrl,
        adminUrl: data.adminUrl,
        ready: Boolean(data.ready),
        lastStatus: data?.lastCheck?.httpStatus ?? null
      });
      if (Array.isArray(data?.ips)) {
        setDeploymentIps(data.ips);
      }
      try {
        await refreshIps();
      } catch { }

      // Disparar también la asignación IPv6 vía CLI automáticamente y refrescar IPs de nuevo
      (async () => {
        try {
          if (deployForm.appName) {
            await fetch('/api/fly/cli/allocate-v6', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                appName: flyAppName
              })
            });
            // Espera 2s y reinicia la máquina para aplicar cambios de red; luego espera y refresca IPs
            await new Promise(r => setTimeout(r, 2000));
            // Reiniciar máquinas si contamos con credenciales válidas
            if ((deployForm.flyApiToken?.trim()?.length ?? 0) > 0 && (deployForm.appName?.trim()?.length ?? 0) > 0) {
              try {
                await fetch('/api/fly/machines/restart', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    flyApiToken: deployForm.flyApiToken,
                    appName: flyAppName,
                    waitForIp: true
                  })
                });
                // pequeña espera y refrescar IPs
                await new Promise(res => setTimeout(res, 1500));
                try {
                  await refreshIps();
                } catch { }
              } catch { }
            }

            // Intentar bootstrap de PocketBase si tenemos credenciales
            const pbUrl = String(data?.appUrl || '').replace(/\/_\/?$/, '');
            if ((pbUrl?.length ?? 0) > 0 && (deployForm.pocketbaseEmail?.trim()?.length ?? 0) > 0 && (deployForm.pocketbasePassword?.trim()?.length ?? 0) > 0) {
              const maxAttempts = 10;
              for (let i = 0; i < maxAttempts; i++) {
                try {
                  const r = await fetch('/api/pb/bootstrap', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                      pbUrl,
                      adminEmail: deployForm.pocketbaseEmail,
                      adminPassword: deployForm.pocketbasePassword
                    })
                  });
                  if (r.ok) break;
                  // Si PB aún no está listo devolverá 503; esperar con backoff y reintentar
                  if (r.status === 503) {
                    await new Promise(res => setTimeout(res, 1000 + i * 500));
                    continue;
                  }
                  // Otros errores: salir del loop
                  break;
                } catch { }
              }
            }
          }
        } catch { }
      })();
    } catch (err: any) {
      setDeployError(err?.message || 'Error desconocido durante el despliegue');
    } finally {
      setIsDeploying(false);
    }
  };
  const retryCheckAdmin = async () => {
    if (!deploymentInfo?.adminUrl) return;
    setIsCheckingDeploy(true);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      // Usar GET en lugar de HEAD para compatibilidad con algunos proxies
      const r = await fetch(deploymentInfo.adminUrl, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal
      });
      clearTimeout(timeout);
      setDeploymentInfo(prev => ({
        ...prev,
        lastStatus: r.status,
        ready: r.ok || prev?.ready
      }));
      // Si el admin ya está listo, reintentar refresco de IPs con un pequeño delay
      if (r.ok) {
        try {
          setTimeout(() => {
            try {
              refreshIps();
            } catch { }
          }, 1500);
        } catch { }
      }
    } catch {
      // ignore
    } finally {
      setIsCheckingDeploy(false);
    }
  };
  const refreshIps = async () => {
    if (!deployForm.flyApiToken || !deployForm.appName) return;
    setIsRefreshingIps(true);
    setIpsError(null);
    // Normalizar nombre de app para Fly
    const flyAppName = (() => {
      const raw = (deployForm.appName || '').trim();
      let s = slugify(raw).toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
      if (!/^[a-z]/.test(s)) s = `a${s}`;
      if (s.length > 63) s = s.slice(0, 63).replace(/-+$/g, '');
      return s || 'app';
    })();
    try {
      const res = await fetch('/api/fly/ips', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          flyApiToken: deployForm.flyApiToken,
          appName: flyAppName,
          organizationId: deployForm.organizationId,
          allocate: true,
          ipTypes: ['v6']
        })
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error || 'No se pudieron obtener las IPs');
      }
      if (Array.isArray(json?.ips)) {
        setDeploymentIps(json.ips);
      } else {
        setDeploymentIps([]);
      }
    } catch (e: any) {
      console.warn('Error actualizando IPs:', e);
      setIpsError(e?.message || 'Error actualizando IPs');
    } finally {
      setIpsFetched(true);
      setIsRefreshingIps(false);
      try {
        const now = new Date();
        const hh = now.getHours().toString().padStart(2, '0');
        const mm = now.getMinutes().toString().padStart(2, '0');
        const ss = now.getSeconds().toString().padStart(2, '0');
        setLastIpsUpdatedAt(`${hh}:${mm}:${ss}`);
      } catch { }
    }
  };



  // Ejecuta literalmente el comando CLI vía API backend y luego refresca las IPs
  const allocateIpv6ViaCli = async () => {
    if (!deployForm.appName) return;
    setIsRefreshingIps(true);
    setIpsError(null);
    try {
      const flyAppName = (() => {
        const raw = (deployForm.appName || '').trim();
        let s = slugify(raw).toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
        if (!/^[a-z]/.test(s)) s = `a${s}`;
        if (s.length > 63) s = s.slice(0, 63).replace(/-+$/g, '');
        return s || 'app';
      })();
      const res = await fetch('/api/fly/cli/allocate-v6', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          appName: flyAppName
        })
      });
      const json = await res.json();
      if (!res.ok || json?.ok === false) {
        const errMsg = json?.stderr || json?.error || 'Fallo al ejecutar flyctl ips allocate-v6';
        throw new Error(errMsg);
      }
      // Espera 2s y reinicia la máquina; luego refresca listado
      await new Promise(r => setTimeout(r, 2000));
      if (deployForm.flyApiToken) {
        try {
          await fetch('/api/fly/machines/restart', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              flyApiToken: deployForm.flyApiToken,
              appName: flyAppName,
              organizationId: deployForm.organizationId
            })
          });
        } catch { }
      }
      await new Promise(r => setTimeout(r, 3000));
      await refreshIps();
      // tras refrescar IPs, intentar actualizar readiness
      setTimeout(() => {
        try {
          retryCheckAdmin();
        } catch { }
      }, 1500);
    } catch (e: any) {
      setIpsError(e?.message || 'Error asignando IPv6');
    } finally {
      setIsRefreshingIps(false);
    }
  };

  // Refresca readiness del admin e IPs en una sola acción
  const updateAllData = async () => {
    setIsUpdatingData(true);
    try {
      await Promise.allSettled([(async () => {
        try {
          await retryCheckAdmin();
        } catch { }
      })(), (async () => {
        try {
          await refreshIps();
        } catch { }
      })()]);
    } finally {
      setIsUpdatingData(false);
    }
  };

  // Reiniciar máquina manualmente desde el modal
  const restartMachine = async () => {
    if (!deployForm.flyApiToken || !deployForm.appName) return;
    setIsRestarting(true);
    setIpsError(null);
    try {
      toast({
        title: t('restartMachineTitle'),
        description: t('restartMachineDesc')
      });
      const flyAppName = (() => {
        const raw = (deployForm.appName || '').trim();
        let s = slugify(raw).toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
        if (!/^[a-z]/.test(s)) s = `a${s}`;
        if (s.length > 63) s = s.slice(0, 63).replace(/-+$/g, '');
        return s || 'app';
      })();
      await fetch('/api/fly/machines/restart', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          flyApiToken: deployForm.flyApiToken,
          appName: flyAppName,
          organizationId: deployForm.organizationId,
          waitForIp: true
        })
      });
      // Espera breve y refresca IPs
      await new Promise(res => setTimeout(res, 1500));
      try {
        await refreshIps();
      } catch { }
      // y re-chequear el admin con un ligero delay
      setTimeout(() => {
        try {
          retryCheckAdmin();
        } catch { }
      }, 1500);
      toast({
        title: t('restartCompleted'),
        description: t('restartCompletedDesc')
      });
    } catch (e: any) {
      setIpsError(e?.message || t('restartError'));
      toast({
        title: t('restartError'),
        description: e?.message || t('unknownError'),
        variant: 'destructive'
      });
    } finally {
      setIsRestarting(false);
    }
  };

  // File upload handlers
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    const validFiles = files.filter(file => {
      // Limit file size to 10MB
      if (file.size > 10 * 1024 * 1024) {
        setError(`${t('fileTooLarge')} ${file.name} ${t('fileTooLarge2')}`);
        return false;
      }
      return true;
    });
    setUploadedFiles(prev => [...prev, ...validFiles]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };
  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    const validImages = files.filter(file => {
      // Check if it's an image
      if (!file.type.startsWith('image/')) {
        setError(`${file.name} ${t('invalidImage')}`);
        return false;
      }
      // Limit file size to 5MB for images
      if (file.size > 5 * 1024 * 1024) {
        setError(`${t('imageTooLarge')} ${file.name} ${t('imageTooLarge2')}`);
        return false;
      }
      return true;
    });
    setUploadedImages(prev => [...prev, ...validImages]);
    if (imageInputRef.current) {
      imageInputRef.current.value = '';
    }
  };
  const removeFile = (fileName: string, type: 'file' | 'image') => {
    if (type === 'file') {
      setUploadedFiles(prev => prev.filter(file => file.name !== fileName));
    } else {
      setUploadedImages(prev => prev.filter(file => file.name !== fileName));
    }
  };
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };
  const getStatusIcon = (status: FileProgress['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-foreground" data-zeus-id="Z-TwoStepAppGenerator-1" />;
      case 'generating':
        return <Clock className="w-4 h-4 text-foreground animate-spin" data-zeus-id="Z-TwoStepAppGenerator-2" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-foreground" data-zeus-id="Z-TwoStepAppGenerator-3" />;
      default:
        return <Clock className="w-4 h-4 text-foreground" data-zeus-id="Z-TwoStepAppGenerator-4" />;
    }
  };
  const getStatusColor = (status: FileProgress['status']) => {
    switch (status) {
      case 'completed':
        return 'bg-success/20 text-success';
      case 'generating':
        return 'bg-blue-100 text-blue-800';
      case 'error':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  useEffect(() => {
    if (step !== 'content') {
      if (consolePatchedRef.current) {
        if (originalConsoleRef.current.log) console.log = originalConsoleRef.current.log;
        if (originalConsoleRef.current.info) console.info = originalConsoleRef.current.info;
        if (originalConsoleRef.current.warn) console.warn = originalConsoleRef.current.warn;
        if (originalConsoleRef.current.error) console.error = originalConsoleRef.current.error;
        consolePatchedRef.current = false;
      }
      return;
    }

    if (!consolePatchedRef.current) {
      originalConsoleRef.current = {
        log: console.log,
        info: console.info,
        warn: console.warn,
        error: console.error
      };

      const pushLine = (type: 'log' | 'info' | 'warn' | 'error', args: any[]) => {
        const text = args
          .map(a => {
            if (typeof a === 'string') return a;
            try {
              return JSON.stringify(a);
            } catch {
              return String(a);
            }
          })
          .join(' ');
        setTerminalLines(prev => {
          const next = [...prev, { type, text }];
          return next.length > 800 ? next.slice(next.length - 800) : next;
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
        pushLine('error', args);
      };

      consolePatchedRef.current = true;
    }

    return () => {
      if (!consolePatchedRef.current) return;
      if (originalConsoleRef.current.log) console.log = originalConsoleRef.current.log;
      if (originalConsoleRef.current.info) console.info = originalConsoleRef.current.info;
      if (originalConsoleRef.current.warn) console.warn = originalConsoleRef.current.warn;
      if (originalConsoleRef.current.error) console.error = originalConsoleRef.current.error;
      consolePatchedRef.current = false;
    };
  }, [step]);

  const prevBodyOverflowRef = useRef<string | null>(null);
  useEffect(() => {
    if (typeof document === 'undefined') return;

    if (step === 'form' || step === 'content') {
      if (prevBodyOverflowRef.current === null) {
        prevBodyOverflowRef.current = document.body.style.overflow || '';
      }
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prevBodyOverflowRef.current || '';
        prevBodyOverflowRef.current = null;
      };
    }

    if (prevBodyOverflowRef.current !== null) {
      document.body.style.overflow = prevBodyOverflowRef.current || '';
      prevBodyOverflowRef.current = null;
    }
  }, [step]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // When we lock body scrolling for form/content, ensure the viewport is reset.
    // Otherwise, navigating back/forward can leave the user at a scrolled offset
    // and show parts of other screens underneath.
    if (step === 'form' || step === 'content') {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }
  }, [step]);

  useEffect(() => {
    if (step !== 'content' && step !== 'complete') return;
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [terminalLines, step]);

  let contentToRender = null;
  if (step === 'form') {
    contentToRender = <div className="max-w-4xl mx-auto px-6 h-full overflow-hidden flex flex-col" data-zeus-id="Z-TwoStepAppGenerator-5">
      <Card className="p-6 bg-transparent border-transparent shadow-none flex-1 min-h-0 overflow-hidden flex flex-col" data-zeus-id="Z-TwoStepAppGenerator-6">
        <h2 className="text-2xl font-bold mb-6 text-success" data-zeus-id="Z-TwoStepAppGenerator-7">{t('generateAppConfig')}</h2>

        <div className="space-y-6 flex-1 min-h-0 overflow-y-auto pr-2" data-zeus-id="Z-TwoStepAppGenerator-8">
          <div data-zeus-id="Z-TwoStepAppGenerator-9">
            <label className="block text-sm font-medium mb-2 text-primary" data-zeus-id="Z-TwoStepAppGenerator-10">{t('appNameLabel')}</label>
            <input type="text" value={formData.appName} onChange={e => setFormData(prev => ({
              ...prev,
              appName: e.target.value
            }))} className="w-full p-3 border border-border/40 rounded-lg bg-muted text-foreground placeholder-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/50" placeholder="mi-aplicacion" data-zeus-id="Z-TwoStepAppGenerator-11" />
          </div>

          <div data-zeus-id="Z-TwoStepAppGenerator-12">
            <label className="block text-sm font-medium mb-2 text-primary" data-zeus-id="Z-TwoStepAppGenerator-13">Plantilla</label>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-zeus-id="Z-TwoStepAppGenerator-14">
              {/* App Web (Next.js) */}
              <div onClick={() => setFormData(prev => ({
                ...prev,
                template: 'next-js',
                appType: 'web-app'
              }))} className={`relative p-4 rounded-xl border cursor-pointer group overflow-hidden transition-all flex flex-col items-center text-center gap-2 ${formData.appType === 'web-app' ? 'border-blue-500/60 bg-input shadow-[0_0_20px_rgba(59,130,246,0.35)]' : 'border-border/40 bg-input hover:border-blue-400/50 hover:shadow-[0_0_20px_rgba(59,130,246,0.25)]'}`} data-zeus-id="Z-TwoStepAppGenerator-15">
                <div className="pointer-events-none absolute -inset-0.5 rounded-2xl opacity-0 group-hover:opacity-60 blur-md animate-spin" style={{
                  background: 'conic-gradient(from 0deg, rgba(59,130,246,0.0), rgba(59,130,246,0.5), rgba(168,85,247,0.5), rgba(59,130,246,0.0))'
                }} data-zeus-id="Z-TwoStepAppGenerator-16" />
                <Monitor className="w-8 h-8 text-foreground relative z-10" data-zeus-id="Z-TwoStepAppGenerator-19" />
                <div className="relative z-10">
                  <div className="text-foreground font-semibold text-sm" data-zeus-id="Z-TwoStepAppGenerator-21">{t('appWeb')}</div>
                  <div className="text-xs text-muted-foreground mt-1" data-zeus-id="Z-TwoStepAppGenerator-22">{t('appWebDesc')}</div>
                </div>
              </div>

              {/* App Móvil */}
              <div onClick={() => setFormData(prev => ({
                ...prev,
                template: 'next-js',
                appType: 'mobile-app'
              }))} className={`relative p-4 rounded-xl border cursor-pointer group overflow-hidden transition-all flex flex-col items-center text-center gap-2 ${formData.appType === 'mobile-app' || ['react-native', 'flutter', 'swift-ui', 'kotlin-compose'].includes(formData.template) ? 'border-success/60 bg-input shadow-[0_0_20px_hsl(var(--success) / 0.35)]' : 'border-border/40 bg-input hover:border-success/50 hover:shadow-[0_0_20px_hsl(var(--success) / 0.25)]'}`} data-zeus-id="Z-TwoStepAppGenerator-23">
                <div className="pointer-events-none absolute -inset-0.5 rounded-2xl opacity-0 group-hover:opacity-60 blur-md animate-spin" style={{
                  background: 'conic-gradient(from 0deg, hsl(var(--success) / 0), hsl(var(--success) / 0.5), rgba(99,102,241,0.5), hsl(var(--success) / 0))'
                }} data-zeus-id="Z-TwoStepAppGenerator-24" />
                <Smartphone className="w-8 h-8 text-foreground relative z-10" data-zeus-id="Z-TwoStepAppGenerator-27" />
                <div className="relative z-10">
                  <div className="text-foreground font-semibold text-sm" data-zeus-id="Z-TwoStepAppGenerator-29">{t('appMobile')}</div>
                  <div className="text-xs text-muted-foreground mt-1" data-zeus-id="Z-TwoStepAppGenerator-30">{t('appMobileDesc')}</div>
                </div>
              </div>

              {/* Página Web */}
              <div onClick={() => {
                console.log('🚨 CLICKING Página Web - Before:', {
                  template: formData.template,
                  appType: formData.appType
                });
                setFormData(prev => {
                  const newState = {
                    ...prev,
                    template: 'next-js',
                    appType: undefined
                  };
                  console.log('🚨 CLICKING Página Web - After:', {
                    template: newState.template,
                    appType: newState.appType
                  });
                  return newState;
                });
              }} className={`relative p-4 rounded-xl border cursor-pointer group overflow-hidden transition-all flex flex-col items-center text-center gap-2 ${!formData.appType && (formData.template === 'next-js' || ['vite-react', 'html-css-js', 'astro', 'eleventy'].includes(formData.template)) ? 'border-fuchsia-500/60 bg-input shadow-[0_0_20px_rgba(217,70,239,0.35)]' : 'border-border/40 bg-input hover:border-fuchsia-400/50 hover:shadow-[0_0_20px_rgba(217,70,239,0.25)]'}`} data-zeus-id="Z-TwoStepAppGenerator-31">
                <div className="pointer-events-none absolute -inset-0.5 rounded-2xl opacity-0 group-hover:opacity-60 blur-md animate-spin" style={{
                  background: 'conic-gradient(from 0deg, rgba(217,70,239,0.0), rgba(217,70,239,0.5), rgba(59,130,246,0.5), rgba(217,70,239,0.0))'
                }} data-zeus-id="Z-TwoStepAppGenerator-32" />
                <Globe className="w-8 h-8 text-foreground relative z-10" data-zeus-id="Z-TwoStepAppGenerator-35" />
                <div className="relative z-10">
                  <div className="text-foreground font-semibold text-sm" data-zeus-id="Z-TwoStepAppGenerator-37">{t('webPage')}</div>
                  <div className="text-xs text-muted-foreground mt-1" data-zeus-id="Z-TwoStepAppGenerator-38">{t('webPageDesc')}</div>
                </div>
              </div>

              {/* App Escritorio */}
              <div onClick={() => setFormData(prev => ({
                ...prev,
                template: 'next-js',
                appType: 'desktop-app'
              }))} className={`relative p-4 rounded-xl border cursor-pointer group overflow-hidden transition-all flex flex-col items-center text-center gap-2 ${formData.appType === 'desktop-app' ? 'border-amber-500/60 bg-input shadow-[0_0_20px_rgba(245,158,11,0.35)]' : 'border-border/40 bg-input hover:border-amber-400/50 hover:shadow-[0_0_20px_rgba(245,158,11,0.25)]'}`} data-zeus-id="Z-TwoStepAppGenerator-39">
                <div className="pointer-events-none absolute -inset-0.5 rounded-2xl opacity-0 group-hover:opacity-60 blur-md animate-spin" style={{
                  background: 'conic-gradient(from 0deg, rgba(245,158,11,0.0), rgba(245,158,11,0.5), rgba(59,130,246,0.5), rgba(245,158,11,0.0))'
                }} data-zeus-id="Z-TwoStepAppGenerator-40" />
                <Monitor className="w-8 h-8 text-foreground relative z-10" data-zeus-id="Z-TwoStepAppGenerator-43" />
                <div className="relative z-10">
                  <div className="text-foreground font-semibold text-sm" data-zeus-id="Z-TwoStepAppGenerator-45">{t('appDesktop')}</div>
                  <div className="text-xs text-muted-foreground mt-1" data-zeus-id="Z-TwoStepAppGenerator-46">{t('appDesktopDesc')}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Complejidad oculta: por defecto 'complex' en estado, sin UI */}

          <div data-zeus-id="Z-TwoStepAppGenerator-39">
            <div className="flex justify-between items-center mb-2" data-zeus-id="Z-TwoStepAppGenerator-40">
              <label className="block text-sm font-medium text-primary" data-zeus-id="Z-TwoStepAppGenerator-41">{t('featuresLabel')}</label>
              <div className="flex items-center gap-2" data-zeus-id="Z-TwoStepAppGenerator-42">
                <label className="text-sm font-medium text-success cursor-pointer" onClick={() => handleFeatureToggle('deploy-db')} data-zeus-id="Z-TwoStepAppGenerator-43">
                  {t('deployDatabase')}
                </label>
                <div className={`w-4 h-4 border rounded-sm flex items-center justify-center cursor-pointer ${formData.features.includes('deploy-db') ? 'bg-success border-success' : 'border-gray-400'}`} onClick={() => handleFeatureToggle('deploy-db')} data-zeus-id="Z-TwoStepAppGenerator-44">
                  {formData.features.includes('deploy-db') && <CheckCircle className="w-3 h-3 text-foreground" data-zeus-id="Z-TwoStepAppGenerator-45" />}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mb-3" data-zeus-id="Z-TwoStepAppGenerator-46">
              {availableFeatures.map(feature => {
                const isSelected = formData.features.includes(feature);
                const isApiFeature = feature === 'api';
                const isApiAutoGenerating = apiAutoGenerating && isApiFeature;

                return (
                  <Badge
                    key={feature}
                    variant={isSelected ? 'default' : 'outline'}
                    className={`cursor-pointer transition-all ${isApiFeature && isSelected ? 'bg-success hover:bg-success border-success' : ''
                      } ${isApiAutoGenerating ? 'animate-pulse' : ''
                      }`}
                    onClick={() => handleFeatureToggle(feature)}
                    data-zeus-id="Z-TwoStepAppGenerator-47"
                  >
                    <span className="flex items-center gap-1">
                      {feature}
                      {isApiFeature && isSelected && autoGeneratedApiData && (
                        <CheckCircle className="w-3 h-3" />
                      )}
                      {isApiAutoGenerating && (
                        <RefreshCw className="w-3 h-3 animate-spin" />
                      )}
                    </span>
                  </Badge>
                );
              })}
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground" data-zeus-id="Z-TwoStepAppGenerator-48">
              {t('selectFeatureDesc')}
            </p>
            <p className="mt-2 text-[11px] text-success" data-zeus-id="Z-TwoStepAppGenerator-49">
              {formData.features.includes('deploy-db') ? t('deployDbActive') : t('deployDbInactive')}
            </p>
          </div>

          {showPreferredOS && <div data-zeus-id="Z-TwoStepAppGenerator-50">
            <label className="block text-sm font-medium mb-2 text-primary" data-zeus-id="Z-TwoStepAppGenerator-51">{t('preferredOS')}</label>
            <select value={formData.preferredOS || ''} onChange={e => setFormData(prev => ({
              ...prev,
              preferredOS: (e.target.value || undefined) as any
            }))} className="w-full p-3 border border-border/40 rounded-lg bg-muted text-foreground focus:border-primary focus:ring-2 focus:ring-primary/50" data-zeus-id="Z-TwoStepAppGenerator-52">
              <option value="" data-zeus-id="Z-TwoStepAppGenerator-53">{t('autoDetectOS')}</option>
              <option value="windows" data-zeus-id="Z-TwoStepAppGenerator-54">Windows</option>
              <option value="macos" data-zeus-id="Z-TwoStepAppGenerator-55">macOS</option>
              <option value="linux" data-zeus-id="Z-TwoStepAppGenerator-56">Linux</option>
            </select>
            <p className="text-xs text-muted-foreground mt-2" data-zeus-id="Z-TwoStepAppGenerator-57">{t('osInstructions')}</p>
          </div>}

          <div className="relative" data-zeus-id="Z-TwoStepAppGenerator-58">
            <div className="flex justify-between items-center mb-2" data-zeus-id="Z-TwoStepAppGenerator-59">
              <label className="block text-sm font-medium text-primary" data-zeus-id="Z-TwoStepAppGenerator-60">{t('descriptionLabel')}</label>
              <button type="button" onClick={enhanceDescription} disabled={!formData.description.trim() || enhancingDescription} className={`p-1.5 rounded-md ${!formData.description.trim() ? 'text-muted-foreground/80 cursor-not-allowed' : 'text-foreground/70 hover:text-foreground hover:bg-muted'} transition-colors`} title={!formData.description.trim() ? t('writeDescFirst') : t('enhanceDescTooltip')} data-zeus-id="Z-TwoStepAppGenerator-61">
                {enhancingDescription ? <svg className="animate-spin h-5 w-5 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" data-zeus-id="Z-TwoStepAppGenerator-62">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" data-zeus-id="Z-TwoStepAppGenerator-63"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" data-zeus-id="Z-TwoStepAppGenerator-64"></path>
                </svg> : <Wand2 className="h-5 w-5" data-zeus-id="Z-TwoStepAppGenerator-65" />}
              </button>
            </div>
            <textarea value={formData.description} onChange={e => setFormData(prev => ({
              ...prev,
              description: e.target.value
            }))} maxLength={80000} className="w-full p-3 border border-border/40 rounded-lg h-24 bg-muted text-foreground placeholder-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/50" placeholder={t('descPlaceholder')} data-zeus-id="Z-TwoStepAppGenerator-66" />
          </div>

          {/* Páginas Personalizadas */}
          <div data-zeus-id="Z-TwoStepAppGenerator-custom-pages">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-primary">{t('customPagesLabel')}</label>
              <button
                type="button"
                onClick={() => setFormData(prev => ({
                  ...prev,
                  customPages: [...prev.customPages, { name: '', description: '' }]
                }))}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-success hover:text-success hover:bg-success/10 transition-colors"
                title={t('addPageTooltip')}
              >
                <Plus className="w-3.5 h-3.5" />
                {t('addPage')}
              </button>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              {t('customPagesDesc')}
            </p>
            <div className="space-y-3">
              {formData.customPages.map((page, index) => (
                <div key={index} className="flex gap-2 items-start">
                  <input
                    type="text"
                    value={page.name}
                    onChange={e => {
                      const newPages = [...formData.customPages];
                      newPages[index] = { ...page, name: e.target.value };
                      setFormData(prev => ({ ...prev, customPages: newPages }));
                    }}
                    placeholder={t('pageNamePlaceholder')}
                    className="flex-1 p-2.5 border border-border/40 rounded-lg bg-muted text-foreground placeholder-muted-foreground text-sm focus:border-primary focus:ring-2 focus:ring-primary/50"
                  />
                  <input
                    type="text"
                    value={page.description}
                    onChange={e => {
                      const newPages = [...formData.customPages];
                      newPages[index] = { ...page, description: e.target.value };
                      setFormData(prev => ({ ...prev, customPages: newPages }));
                    }}
                    placeholder={t('pageDescPlaceholder')}
                    className="flex-[2] p-2.5 border border-border/40 rounded-lg bg-muted text-foreground placeholder-muted-foreground text-sm focus:border-primary focus:ring-2 focus:ring-primary/50"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const newPages = formData.customPages.filter((_, i) => i !== index);
                      setFormData(prev => ({ ...prev, customPages: newPages }));
                    }}
                    className="p-2.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-red-400/10 transition-colors"
                    title={t('deletePageTooltip')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* File Upload Section */}
          <div className="border-t pt-6" data-zeus-id="Z-TwoStepAppGenerator-67">
            <h3 className="text-lg font-medium mb-4 text-success" data-zeus-id="Z-TwoStepAppGenerator-68">{t('additionalResources')}</h3>
            <p className="text-sm text-muted-foreground mb-4" data-zeus-id="Z-TwoStepAppGenerator-69">
              {t('resourcesDesc')}
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-zeus-id="Z-TwoStepAppGenerator-70">
              {/* File Upload */}
              <div data-zeus-id="Z-TwoStepAppGenerator-71">
                <label className="block text-sm font-medium mb-2 text-primary" data-zeus-id="Z-TwoStepAppGenerator-72">{t('filesLabel')}</label>
                <div className="space-y-3" data-zeus-id="Z-TwoStepAppGenerator-73">
                  <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} className="w-full flex items-center gap-2 bg-card border border-success text-foreground/70 hover:text-foreground hover:bg-muted shadow-[0_0_8px_hsl(var(--success) / 0.8)]" data-zeus-id="Z-TwoStepAppGenerator-74">
                    <Upload className="w-4 h-4 text-success" data-zeus-id="Z-TwoStepAppGenerator-75" />
                    {t('uploadFiles')}
                  </Button>
                  <input ref={fileInputRef} type="file" multiple onChange={handleFileUpload} className="hidden" accept=".txt,.md,.json,.xml,.csv,.pdf,.doc,.docx" data-zeus-id="Z-TwoStepAppGenerator-76" />

                  {uploadedFiles.length > 0 && <div className="space-y-2" data-zeus-id="Z-TwoStepAppGenerator-77">
                    {uploadedFiles.map(file => <div key={file.name} className="flex items-center justify-between p-2 bg-muted border border-border/40 rounded" data-zeus-id="Z-TwoStepAppGenerator-78">
                      <div className="flex items-center gap-2" data-zeus-id="Z-TwoStepAppGenerator-79">
                        <FileText className="w-4 h-4 text-primary" data-zeus-id="Z-TwoStepAppGenerator-80" />
                        <div data-zeus-id="Z-TwoStepAppGenerator-81">
                          <div className="text-sm font-medium text-foreground" data-zeus-id="Z-TwoStepAppGenerator-82">{file.name}</div>
                          <div className="text-xs text-muted-foreground" data-zeus-id="Z-TwoStepAppGenerator-83">{formatFileSize(file.size)}</div>
                        </div>

                      </div>
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeFile(file.name, 'file')} data-zeus-id="Z-TwoStepAppGenerator-84">
                        <X className="w-4 h-4" data-zeus-id="Z-TwoStepAppGenerator-85" />
                      </Button>
                    </div>)}
                  </div>}
                </div>
              </div>

              {/* Image Upload */}
              <div className="md:col-span-2" data-zeus-id="Z-TwoStepAppGenerator-86">
                <label className="block text-sm font-medium mb-2 text-primary" data-zeus-id="Z-TwoStepAppGenerator-87">{t('imagesLabel')}</label>
                <div className="space-y-3" data-zeus-id="Z-TwoStepAppGenerator-88">
                  <Button type="button" variant="outline" onClick={() => imageInputRef.current?.click()} className="w-full flex items-center gap-2 bg-card border border-success text-foreground/70 hover:text-foreground hover:bg-muted shadow-[0_0_8px_hsl(var(--success) / 0.8)]" data-zeus-id="Z-TwoStepAppGenerator-89">
                    <ImageIcon className="w-4 h-4 text-success" data-zeus-id="Z-TwoStepAppGenerator-90" />
                    {t('uploadImages')}
                  </Button>
                  <input ref={imageInputRef} type="file" multiple onChange={handleImageUpload} className="hidden" accept="image/*" data-zeus-id="Z-TwoStepAppGenerator-91" />

                  {uploadedImages.length > 0 && <div className="space-y-2" data-zeus-id="Z-TwoStepAppGenerator-92">
                    {uploadedImages.map(file => <div key={file.name} className="flex items-center justify-between p-2 bg-muted border border-border/40 rounded" data-zeus-id="Z-TwoStepAppGenerator-93">
                      <div className="flex items-center gap-2" data-zeus-id="Z-TwoStepAppGenerator-94">
                        <div className="w-4 h-4 bg-success rounded-sm" data-zeus-id="Z-TwoStepAppGenerator-95" />
                        <div data-zeus-id="Z-TwoStepAppGenerator-96">
                          <div className="text-sm font-medium text-foreground" data-zeus-id="Z-TwoStepAppGenerator-97">{file.name}</div>
                          <div className="text-xs text-muted-foreground" data-zeus-id="Z-TwoStepAppGenerator-98">{formatFileSize(file.size)}</div>
                        </div>
                      </div>
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeFile(file.name, 'image')} data-zeus-id="Z-TwoStepAppGenerator-99">
                        <X className="w-4 h-4" data-zeus-id="Z-TwoStepAppGenerator-100" />
                      </Button>
                    </div>)}
                  </div>}

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-primary">{t('selectImagesDesc')}</span>
                      {(loadingSuggestedImages || isSearchingCustom) && <span className="text-xs text-muted-foreground">{t('searching')}</span>}
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={customImageQuery}
                        onChange={(e) => setCustomImageQuery(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleCustomSearch(); }}
                        placeholder={t('searchPlaceholder')}
                        className="w-full px-2 py-1 rounded bg-card border border-border/40 text-sm text-foreground/80 focus:outline-none focus:ring-1 focus:ring-success"
                      />
                      <input
                        type="number"
                        min={3}
                        max={24}
                        step={3}
                        value={imageLimit}
                        onChange={(e) => setImageLimit(Math.max(3, Math.min(24, Number(e.target.value) || 3)))}
                        className="w-24 px-2 py-1 rounded bg-card border border-border/40 text-sm text-foreground/80 focus:outline-none focus:ring-1 focus:ring-success"
                        placeholder={t('quantityPlaceholder')}
                        title={t('quantityTitle')}
                      />
                      <Button type="button" variant="outline" onClick={handleCustomSearch} disabled={!customImageQuery.trim() || isSearchingCustom}>
                        {t('searchBtn')}
                      </Button>
                    </div>
                    {(!loadingSuggestedImages && suggestedImages.length === 0) && (
                      <div className="text-xs text-muted-foreground/80">{t('noSuggestions')}</div>
                    )}
                    {suggestedImages.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 w-full">
                        {suggestedImages.map((img) => {
                          const regularUrl = cleanImageUrl(img.urls.regular || '');
                          const isSelected = selectedImageUrls.includes(regularUrl);
                          return (
                            <div
                              key={img.id}
                              className="relative group cursor-pointer border-2 rounded-lg overflow-hidden"
                              onClick={() => handleImageSelection(img)}
                              style={{ borderColor: isSelected ? 'rgb(34 197 94)' : 'transparent' }}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={img.urls.thumb || img.urls.small || img.urls.regular || ''} alt={img.alt || 'suggested'} className="w-full h-36 md:h-32 object-cover transition-transform duration-300 group-hover:scale-105" />
                              {isSelected && (
                                <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
                                  <CheckCircle className="w-8 h-8 text-success" />
                                </div>
                              )}
                              <div className="absolute bottom-0 left-0 right-0 p-1 bg-gradient-to-t from-black/70 to-transparent">
                                <Button type="button" variant="outline" size="sm" className="w-full text-xs bg-background/50 border-border/50/50 hover:bg-card">
                                  {isSelected ? t('deselect') : t('select')}
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Tarjeta de imagen seleccionada */}
            {selectedImage && (
              <div className="mt-4 p-4 bg-muted border border-border/40 rounded-lg">
                <div className="flex items-start gap-4">
                  <img
                    src={selectedImage.urls.small || selectedImage.urls.regular || selectedImage.urls.thumb || ''}
                    alt={selectedImage.alt || 'Imagen seleccionada'}
                    className="w-24 h-24 object-cover rounded border border-border/30"
                  />
                  <div className="flex-1">
                    <h4 className="text-sm font-medium text-foreground mb-2">{t('selectedImage')}</h4>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-muted-foreground flex-1 truncate max-w-32" title={cleanImageUrl(selectedImage.urls.regular || selectedImage.urls.full || selectedImage.urls.raw || '')}>
                        {t('selectedImageUrl')}
                      </span>
                      <Button variant="outline" size="sm" onClick={() => copyImageUrl(selectedImage.urls.regular || selectedImage.urls.full || selectedImage.urls.raw || '')}
                        className="flex items-center gap-1 px-2 py-1 text-xs">
                        <Copy className="w-3 h-3" />
                        {t('copyUrl')}
                      </Button>
                    </div>
                    {selectedImage.photographer && (
                      <p className="text-xs text-muted-foreground/80">
                        {t('photographer')}: {selectedImage.photographer}
                      </p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedImage(null)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}

            {(uploadedFiles.length > 0 || uploadedImages.length > 0) && <div className="mt-4 p-3 bg-muted border border-border/40 rounded-lg" data-zeus-id="Z-TwoStepAppGenerator-101">
              <div className="text-sm text-foreground" data-zeus-id="Z-TwoStepAppGenerator-102">
                <strong data-zeus-id="Z-TwoStepAppGenerator-103">{t('totalResources')}</strong> {uploadedFiles.length} {t('files').toLowerCase()} + {uploadedImages.length} {t('imagesLabel').toLowerCase()}
              </div>
              <div className="text-xs text-muted-foreground mt-1" data-zeus-id="Z-TwoStepAppGenerator-104">
                {t('resourcesContextDesc')}
              </div>
            </div>}
          </div>

        </div>

        {error && <Alert className="mt-4" data-zeus-id="Z-TwoStepAppGenerator-120">
          <AlertCircle className="h-4 w-4" data-zeus-id="Z-TwoStepAppGenerator-121" />
          <AlertDescription data-zeus-id="Z-TwoStepAppGenerator-122">{error}</AlertDescription>
        </Alert>}

        <div className="flex justify-between items-center mt-6 gap-2" data-zeus-id="Z-TwoStepAppGenerator-123">
          <div className="flex items-center gap-2" data-zeus-id="Z-TwoStepAppGenerator-debug-nav">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const mockStructure: FileStructure[] = [
                ];

                const structurePayload: any = {
                  structure: mockStructure,
                  stats: {
                    totalFiles: 3,
                    totalDirectories: 1,
                    configFiles: 1
                  }
                };

                setProjectStructure(structurePayload);
                const extracted = extractFilesFromStructure(mockStructure);
                const initialProgress: Record<string, FileProgress> = {};
                extracted.forEach(f => {
                  initialProgress[f.path] = { filePath: f.path, status: 'pending' };
                });
                setFileProgress(initialProgress);
                setOverallProgress(0);
                setLoading(false);
                setError(null);
                setStep('content');
              }}
              className="bg-card border border-border/40 text-foreground/80 hover:bg-muted"
              data-zeus-id="Z-TwoStepAppGenerator-debug-to-content"
            >
              {t('goToContent')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const mockFiles: Record<string, string> = {

                };
                setCompletedFiles(mockFiles);
                setLoading(false);
                setError(null);
                setStep('complete');
                if (onComplete) onComplete(mockFiles);
                if (onNavigateToResults) onNavigateToResults();
              }}
              className="bg-card border border-border/40 text-foreground/80 hover:bg-muted"
              data-zeus-id="Z-TwoStepAppGenerator-debug-to-complete"
            >
              {t('goToGenerated')}
            </Button>
          </div>

          <Button onClick={() => {
            // Validación completa del primer paso
            if (!formData.appName) {
              setError(t('enterAppName'));
              return;
            }
            if (!formData.template) {
              setError(t('selectTemplate'));
              return;
            }
            if (!formData.description || formData.description.trim().length === 0) {
              setError(t('enterDescription'));
              return;
            }
            if (!selectedModel) {
              setError(t('selectModel'));
              return;
            }

            // Si todas las validaciones pasan, limpiar error y generar
            setError(null);
            console.log('🚀 Iniciando generación de aplicación');
            generateStructure();
          }} disabled={loading || apiAutoGenerating} className="px-6 flex items-center gap-2 bg-card border border-success text-foreground/70 hover:text-foreground hover:bg-muted shadow-[0_0_8px_hsl(var(--success) / 0.8)]" data-zeus-id="Z-TwoStepAppGenerator-124">
            {apiAutoGenerating ? apiAutoGenStatus || t('generatingAPI') : loading ? t('generatingStructure') : <><Play className="w-4 h-4 text-success" />{t('generateStructure')}</>}
          </Button>
        </div>
      </Card>
      <Dialog open={showDeployModal} onOpenChange={open => {
        if (isRestarting) return;
        setShowDeployModal(open);
      }} data-zeus-id="Z-TwoStepAppGenerator-125">
        <DialogContent className="max-w-3xl min-w-[720px] bg-background text-foreground border border-border/50" data-zeus-id="Z-TwoStepAppGenerator-126">
          <DialogHeader data-zeus-id="Z-TwoStepAppGenerator-127">
            <DialogTitle data-zeus-id="Z-TwoStepAppGenerator-128">{t('deployDbTitle')}</DialogTitle>
            <DialogDescription className="text-foreground/70 space-y-1" data-zeus-id="Z-TwoStepAppGenerator-129">
              <p data-zeus-id="Z-TwoStepAppGenerator-130">{t('deployDbDesc')}</p>
            </DialogDescription>
          </DialogHeader>

          {!deploySuccess && <form onSubmit={submitDeploy} className="space-y-4" data-zeus-id="Z-TwoStepAppGenerator-131">
            {deployError && <div className="p-3 bg-red-900/40 border border-destructive/40 rounded-md text-sm text-red-300 whitespace-pre-wrap" data-zeus-id="Z-TwoStepAppGenerator-132">
              {deployError}
            </div>}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-zeus-id="Z-TwoStepAppGenerator-133">
              <div className="col-span-1 md:col-span-2" data-zeus-id="Z-TwoStepAppGenerator-134">
                <label className="block text-sm font-medium text-foreground/80 mb-1" data-zeus-id="Z-TwoStepAppGenerator-135">{t('flyApiToken')}</label>
                <input type="password" value={deployForm.flyApiToken} onChange={e => setDeployForm({
                  ...deployForm,
                  flyApiToken: e.target.value
                })} className="w-full px-3 py-2 border border-border/40 rounded-md bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary" placeholder={t('flyTokenPlaceholder')} required data-zeus-id="Z-TwoStepAppGenerator-136" />
                <p className="mt-1 text-xs text-muted-foreground" data-zeus-id="Z-TwoStepAppGenerator-137">
                  {t('flyTokenHint')} <span className="text-yellow-300" data-zeus-id="Z-TwoStepAppGenerator-138">{t('orgToken')}</span> {t('flyTokenHint2')}
                  Crea uno en <a className="underline" href="https://fly.io/user/personal_access_tokens" target="_blank" rel="noreferrer" data-zeus-id="Z-TwoStepAppGenerator-139">fly.io</a> o con CLI: <code className="px-1 py-0.5 bg-muted rounded" data-zeus-id="Z-TwoStepAppGenerator-140">fly tokens create</code> y asócialo a la organización correcta.
                </p>
              </div>

              <div data-zeus-id="Z-TwoStepAppGenerator-141">
                <label className="block text-sm font-medium text-foreground/80 mb-1" data-zeus-id="Z-TwoStepAppGenerator-142">{t('adminEmail')}</label>
                <input type="email" value={deployForm.pocketbaseEmail} onChange={e => setDeployForm({
                  ...deployForm,
                  pocketbaseEmail: e.target.value
                })} className="w-full px-3 py-2 border border-border/40 rounded-md bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary" placeholder={t('emailPlaceholder')} required data-zeus-id="Z-TwoStepAppGenerator-143" />
                <p className="mt-1 text-xs text-muted-foreground" data-zeus-id="Z-TwoStepAppGenerator-144">{t('adminEmailHint')}</p>
              </div>

              <div data-zeus-id="Z-TwoStepAppGenerator-145">
                <label className="block text-sm font-medium text-foreground/80 mb-1" data-zeus-id="Z-TwoStepAppGenerator-146">{t('adminPassword')}</label>
                <input type="password" value={deployForm.pocketbasePassword} onChange={e => setDeployForm({
                  ...deployForm,
                  pocketbasePassword: e.target.value
                })} className="w-full px-3 py-2 border border-border/40 rounded-md bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary" placeholder={t('passwordPlaceholder')} required data-zeus-id="Z-TwoStepAppGenerator-147" />
                <p className="mt-1 text-xs text-muted-foreground" data-zeus-id="Z-TwoStepAppGenerator-148">{t('adminPasswordHint')}</p>
              </div>

              <div data-zeus-id="Z-TwoStepAppGenerator-149">
                <label className="block text-sm font-medium text-foreground/80 mb-1" data-zeus-id="Z-TwoStepAppGenerator-150">{t('appNameLabel2')}</label>
                <input type="text" value={deployForm.appName} onChange={e => setDeployForm({
                  ...deployForm,
                  appName: e.target.value
                })} className="w-full px-3 py-2 border border-border/40 rounded-md bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary" placeholder={t('appNamePlaceholder')} required data-zeus-id="Z-TwoStepAppGenerator-151" />
              </div>

              {/* Región siempre */}
              <div data-zeus-id="Z-TwoStepAppGenerator-152">
                <label className="block text-sm font-medium text-foreground/80 mb-1" data-zeus-id="Z-TwoStepAppGenerator-153">{t('regionLabel')}</label>
                <select value={deployForm.region} onChange={e => setDeployForm({
                  ...deployForm,
                  region: e.target.value
                })} className="w-full px-3 py-2 border border-border/40 rounded-md bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary" required data-zeus-id="Z-TwoStepAppGenerator-154">
                  <option value="" data-zeus-id="Z-TwoStepAppGenerator-155">{t('selectRegion')}</option>
                  <option value="mad" data-zeus-id="Z-TwoStepAppGenerator-156">Madrid (mad)</option>
                  <option value="cdg" data-zeus-id="Z-TwoStepAppGenerator-157">París (cdg)</option>
                  <option value="lhr" data-zeus-id="Z-TwoStepAppGenerator-158">Londres (lhr)</option>
                  <option value="ams" data-zeus-id="Z-TwoStepAppGenerator-159">Amsterdam (ams)</option>
                  <option value="fra" data-zeus-id="Z-TwoStepAppGenerator-160">Frankfurt (fra)</option>
                  <option value="syd" data-zeus-id="Z-TwoStepAppGenerator-161">Sydney (syd)</option>
                  <option value="iad" data-zeus-id="Z-TwoStepAppGenerator-162">Virginia (iad)</option>
                  <option value="ord" data-zeus-id="Z-TwoStepAppGenerator-163">Chicago (ord)</option>
                  <option value="lax" data-zeus-id="Z-TwoStepAppGenerator-164">Los Angeles (lax)</option>
                </select>
              </div>

              {/* Campos avanzados */}
              <>
                <div data-zeus-id="Z-TwoStepAppGenerator-165">
                  <label className="block text-sm font-medium text-foreground/80 mb-1" data-zeus-id="Z-TwoStepAppGenerator-166">{t('orgIdLabel')}</label>
                  <input type="text" value={deployForm.organizationId} onChange={e => setDeployForm({
                    ...deployForm,
                    organizationId: e.target.value
                  })} className="w-full px-3 py-2 border border-border/40 rounded-md bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary" placeholder={t('orgIdPlaceholder')} required data-zeus-id="Z-TwoStepAppGenerator-167" />
                  <p className="mt-1 text-xs text-muted-foreground" data-zeus-id="Z-TwoStepAppGenerator-168">{t('orgIdHint')}</p>
                </div>

                <div data-zeus-id="Z-TwoStepAppGenerator-169">
                  <label className="block text-sm font-medium text-foreground/80 mb-1" data-zeus-id="Z-TwoStepAppGenerator-170">{t('pbVersionLabel')}</label>
                  <input type="text" value={deployForm.pocketbaseVersion} onChange={e => setDeployForm({
                    ...deployForm,
                    pocketbaseVersion: e.target.value
                  })} className="w-full px-3 py-2 border border-border/40 rounded-md bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary" placeholder={t('pbVersionPlaceholder')} required data-zeus-id="Z-TwoStepAppGenerator-171" />
                </div>

                <div data-zeus-id="Z-TwoStepAppGenerator-172">
                  <label className="block text-sm font-medium text-foreground/80 mb-1" data-zeus-id="Z-TwoStepAppGenerator-173">{t('memoryLabel')}</label>
                  <input type="number" min={128} max={4096} step={64} value={deployForm.memory} onChange={e => setDeployForm({
                    ...deployForm,
                    memory: Number(e.target.value)
                  })} className="w-full px-3 py-2 border border-border/40 rounded-md bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary" required data-zeus-id="Z-TwoStepAppGenerator-174" />
                  <p className="mt-1 text-xs text-muted-foreground" data-zeus-id="Z-TwoStepAppGenerator-175">{t('memoryHint')}</p>
                </div>

                <div className="flex items-center gap-2" data-zeus-id="Z-TwoStepAppGenerator-176">
                  <input id="enableSsl" type="checkbox" checked={deployForm.enableSsl} onChange={e => setDeployForm({
                    ...deployForm,
                    enableSsl: e.target.checked
                  })} className="h-4 w-4 rounded border-border/40 bg-card" data-zeus-id="Z-TwoStepAppGenerator-177" />
                  <label htmlFor="enableSsl" className="text-sm font-medium text-foreground/80" data-zeus-id="Z-TwoStepAppGenerator-178">{t('enableSSL')}</label>
                </div>
              </>

            </div>

            <DialogFooter className="pt-2" data-zeus-id="Z-TwoStepAppGenerator-179">
              <Button type="button" variant="outline" onClick={() => setShowDeployModal(false)} className="bg-card border border-border/40 text-foreground/80 hover:bg-muted" data-zeus-id="Z-TwoStepAppGenerator-180">{t('cancel')}</Button>
              <Button type="submit" disabled={isDeploying} className="bg-primary text-foreground hover:bg-primary" data-zeus-id="Z-TwoStepAppGenerator-181">
                {isDeploying ? t('deploying') : t('deploy')}
              </Button>
            </DialogFooter>
          </form>}

          {deploySuccess && <div className="space-y-3" data-zeus-id="Z-TwoStepAppGenerator-182">
            <div className="p-3 bg-success/20 border border-success/40 rounded-md text-sm text-success" data-zeus-id="Z-TwoStepAppGenerator-183">
              {t('deploySuccess')}
            </div>
            {deploymentInfo && <div className="space-y-2 text-sm" data-zeus-id="Z-TwoStepAppGenerator-184">
              {deploymentInfo.appUrl && <p data-zeus-id="Z-TwoStepAppGenerator-185">{t('urlLabel')} <a href={deploymentInfo.appUrl} target="_blank" rel="noreferrer" className="underline text-primary" data-zeus-id="Z-TwoStepAppGenerator-186">{deploymentInfo.appUrl}</a></p>}
              {deploymentInfo.adminUrl && <div className="space-y-1" data-zeus-id="Z-TwoStepAppGenerator-187">
                <p data-zeus-id="Z-TwoStepAppGenerator-188">{t('adminLabel')} <a href={deploymentInfo.adminUrl} target="_blank" rel="noreferrer" className="underline text-primary" data-zeus-id="Z-TwoStepAppGenerator-189">{deploymentInfo.adminUrl}</a></p>
                <div className="flex items-center gap-2 text-xs text-foreground/70" data-zeus-id="Z-TwoStepAppGenerator-190">
                  <span className={deploymentInfo.ready ? 'text-success' : 'text-yellow-300'} data-zeus-id="Z-TwoStepAppGenerator-191">
                    {deploymentInfo.ready ? t('statusReady') : t('statusWaiting')}
                  </span>
                  {typeof deploymentInfo.lastStatus !== 'undefined' && <span data-zeus-id="Z-TwoStepAppGenerator-192">• {t('lastCode')} {deploymentInfo.lastStatus ?? '-'}</span>}
                  {isCheckingDeploy && <span data-zeus-id="Z-TwoStepAppGenerator-193">• {t('checking')}</span>}
                </div>
                <div className="text-xs text-foreground/70 bg-card/60 border border-border/50 rounded px-2 py-1.5" data-zeus-id="Z-TwoStepAppGenerator-194">
                  {t('deployFinishTip')}
                  <br data-zeus-id="Z-TwoStepAppGenerator-195" />• {t('adminShows')} <span className="text-success" data-zeus-id="Z-TwoStepAppGenerator-196">{t('deployTipStatus')}</span> (código 200)
                  <br data-zeus-id="Z-TwoStepAppGenerator-197" />• {t('deployTipIP')} <span className="text-success" data-zeus-id="Z-TwoStepAppGenerator-198">{t('publicIP')}</span> {t('below')}
                </div>
                <div className="flex items-center gap-2" data-zeus-id="Z-TwoStepAppGenerator-199">
                  <Button type="button" variant="outline" onClick={() => window.open(deploymentInfo.adminUrl!, '_blank')} className="bg-card border border-blue-600 text-primary-foreground hover:bg-muted" title={t('openAdminPanel')} data-zeus-id="Z-TwoStepAppGenerator-200">
                    {t('openAdmin')}
                  </Button>
                  <Button type="button" variant="outline" onClick={updateAllData} disabled={isUpdatingData} className="bg-card border border-border/40 text-foreground/80 hover:bg-muted disabled:opacity-60 disabled:cursor-not-allowed" title={t('updateAdminAndIPs')} data-zeus-id="Z-TwoStepAppGenerator-201">
                    {isUpdatingData && <svg className="mr-2 h-4 w-4 animate-spin text-foreground/80" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-zeus-id="Z-TwoStepAppGenerator-202">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" data-zeus-id="Z-TwoStepAppGenerator-203"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" data-zeus-id="Z-TwoStepAppGenerator-204"></path>
                    </svg>}
                    {isUpdatingData ? t('updating') : t('updateData')}
                  </Button>
                  <Button type="button" variant="outline" onClick={restartMachine} disabled={isRestarting || !deployForm.flyApiToken || !deployForm.appName} className="bg-card border border-yellow-600 text-yellow-300 hover:bg-muted disabled:opacity-60 disabled:cursor-not-allowed" aria-busy={isRestarting} title={`${t('restartMachineOf')} ${deployForm.appName || ''}`} data-zeus-id="Z-TwoStepAppGenerator-205">
                    {isRestarting && <svg className="mr-2 h-4 w-4 animate-spin text-yellow-300" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-zeus-id="Z-TwoStepAppGenerator-206">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" data-zeus-id="Z-TwoStepAppGenerator-207"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" data-zeus-id="Z-TwoStepAppGenerator-208"></path>
                    </svg>}
                    {isRestarting ? t('restarting') : t('restartMachine')}
                  </Button>
                  <Button type="button" variant="outline" onClick={allocateIpv6ViaCli} disabled={isRefreshingIps || !deployForm.appName} className="bg-card border border-success text-success hover:bg-muted disabled:opacity-60 disabled:cursor-not-allowed" title={`${t('assignIPv6Desc')} ${deployForm.appName || t('appNamePlaceholder')}`} data-zeus-id="Z-TwoStepAppGenerator-209">
                    {isRefreshingIps ? t('assigningIPv6') : t('assignIPv6')}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground" data-zeus-id="Z-TwoStepAppGenerator-210">{t('flyProxyTip')}</p>
                {ipsError && <div className="mt-2 text-xs text-red-300 bg-red-900/30 border border-destructive/30 rounded p-2" data-zeus-id="Z-TwoStepAppGenerator-211">
                  {ipsError}
                </div>}
                {ipsFetched && !ipsError && (!deploymentIps || deploymentIps.length === 0) && <div className="mt-2 text-xs text-foreground/70" data-zeus-id="Z-TwoStepAppGenerator-212">
                  {t('noPublicIPs')}
                  <code className="ml-1 px-1 py-0.5 bg-card rounded border border-border/50" data-zeus-id="Z-TwoStepAppGenerator-213">flyctl ips list -a {deployForm.appName}</code>.
                </div>}
                {deploymentIps && deploymentIps.length > 0 && <div className="mt-2 text-xs text-foreground/70" data-zeus-id="Z-TwoStepAppGenerator-214">
                  <div className="font-medium text-foreground/80 mb-1" data-zeus-id="Z-TwoStepAppGenerator-215">{t('publicIPsAssigned')}</div>
                  <ul className="list-disc list-inside space-y-1" data-zeus-id="Z-TwoStepAppGenerator-216">
                    {deploymentIps.map((ip: any, idx: number) => <li key={idx} data-zeus-id="Z-TwoStepAppGenerator-217">
                      {ip?.ip || ip?.address || JSON.stringify(ip)} {ip?.type ? `(${ip.type})` : ''}
                    </li>)}
                  </ul>
                </div>}
              </div>}
            </div>}
            <DialogFooter data-zeus-id="Z-TwoStepAppGenerator-218">
              <Button type="button" onClick={() => setShowDeployModal(false)} disabled={isRestarting} className="bg-success hover:bg-success text-foreground disabled:opacity-60 disabled:cursor-not-allowed" title={isRestarting ? t('waitingRestart') : undefined} data-zeus-id="Z-TwoStepAppGenerator-219">{t('close')}</Button>
            </DialogFooter>
          </div>}
        </DialogContent>
      </Dialog>
    </div>;
  }
  if (step === 'structure') {
    contentToRender = <div className="w-full max-w-6xl mx-auto px-6 h-full overflow-hidden flex flex-col" data-zeus-id="Z-TwoStepAppGenerator-220">
      <div className="p-6 flex-1 min-h-0 overflow-hidden flex flex-col" data-zeus-id="Z-TwoStepAppGenerator-221">
        <div className="text-center mb-8 pb-2" data-zeus-id="Z-TwoStepAppGenerator-222">
          <h2 className="text-2xl font-bold text-success mb-2" data-zeus-id="Z-TwoStepAppGenerator-225">{t('projectStructureGenerated')}</h2>
          <p className="text-foreground/70 text-sm" data-zeus-id="Z-TwoStepAppGenerator-226">{t('reviewStructure')}</p>
        </div>

        {projectStructure && <div className="space-y-8" data-zeus-id="Z-TwoStepAppGenerator-227">
          {/* Estadísticas principales con animaciones */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6" data-zeus-id="Z-TwoStepAppGenerator-228">
            {/* Contenedor de Archivos */}
            <div className="relative p-6 rounded-xl bg-gradient-to-br from-white/5 to-transparent border border-blue-400/20 shadow-[0_0_15px_rgba(59,130,246,0.3)] hover:shadow-[0_0_25px_rgba(59,130,246,0.5)] transition-all duration-300 group" data-zeus-id="Z-TwoStepAppGenerator-229">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300" data-zeus-id="Z-TwoStepAppGenerator-230"></div>
              <div className="relative z-10 flex flex-col items-center justify-center h-full" data-zeus-id="Z-TwoStepAppGenerator-231">
                <div className="text-5xl font-bold text-foreground mb-2 animate-in slide-in-from-bottom-2 duration-500" data-zeus-id="Z-TwoStepAppGenerator-232">
                  {projectStructure.stats?.totalFiles || 0}
                </div>
                <div className="text-sm font-medium text-primary-foreground/80 text-center w-full" data-zeus-id="Z-TwoStepAppGenerator-233">{t('files')}</div>
              </div>
            </div>

            {/* Contenedor de Directorios */}
            <div className="relative p-6 rounded-xl bg-gradient-to-br from-white/5 to-transparent border border-success/20 shadow-[0_0_15px_hsl(var(--success) / 0.3)] hover:shadow-[0_0_25px_hsl(var(--success) / 0.5)] transition-all duration-300 group" data-zeus-id="Z-TwoStepAppGenerator-234">
              <div className="absolute inset-0 bg-gradient-to-br from-success/5 to-transparent rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300" data-zeus-id="Z-TwoStepAppGenerator-235"></div>
              <div className="relative z-10 flex flex-col items-center justify-center h-full" data-zeus-id="Z-TwoStepAppGenerator-236">
                <div className="text-5xl font-bold text-foreground mb-2 animate-in slide-in-from-bottom-2 duration-500 delay-100" data-zeus-id="Z-TwoStepAppGenerator-237">
                  {projectStructure.stats?.totalDirectories || 0}
                </div>
                <div className="text-sm font-medium text-success text-center w-full" data-zeus-id="Z-TwoStepAppGenerator-238">{t('directories')}</div>
              </div>
            </div>

            {/* Contenedor de Configuración */}
            <div className="relative p-6 rounded-xl bg-gradient-to-br from-white/5 to-transparent border border-purple-400/20 shadow-[0_0_15px_rgba(168,85,247,0.3)] hover:shadow-[0_0_25px_rgba(168,85,247,0.5)] transition-all duration-300 group" data-zeus-id="Z-TwoStepAppGenerator-239">
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300" data-zeus-id="Z-TwoStepAppGenerator-240"></div>
              <div className="relative z-10 flex flex-col items-center justify-center h-full" data-zeus-id="Z-TwoStepAppGenerator-241">
                <div className="text-5xl font-bold text-foreground mb-2 animate-in slide-in-from-bottom-2 duration-500 delay-200" data-zeus-id="Z-TwoStepAppGenerator-242">
                  {projectStructure.stats?.configFiles || 0}
                </div>
                <div className="text-sm font-medium text-purple-200 text-center w-full" data-zeus-id="Z-TwoStepAppGenerator-243">{t('configuration')}</div>
              </div>
            </div>
          </div>

          {/* Estructura del proyecto con diseño mejorado */}
          <div className="bg-gradient-to-br from-white/5 to-transparent rounded-xl border border-blue-400/20 p-6 shadow-[0_0_15px_rgba(59,130,246,0.2)] hover:shadow-[0_0_25px_rgba(59,130,246,0.4)] transition-all duration-300 group" data-zeus-id="Z-TwoStepAppGenerator-244">
            <div className="flex items-center justify-between mb-4" data-zeus-id="Z-TwoStepAppGenerator-245">
              <h3 className="text-xl font-semibold text-foreground/90 flex items-center gap-2" data-zeus-id="Z-TwoStepAppGenerator-246">
                <div className="w-8 h-8 bg-gradient-to-br from-blue-400 to-blue-600 rounded-lg flex items-center justify-center" data-zeus-id="Z-TwoStepAppGenerator-247">
                  <Folder className="w-4 h-4 text-foreground" data-zeus-id="Z-TwoStepAppGenerator-248" />
                </div>
                {t('projectStructure')}
              </h3>
              <Badge className="bg-primary/50 text-primary-foreground border-blue-500/30 animate-pulse" data-zeus-id="Z-TwoStepAppGenerator-249">
                {projectStructure.stats?.totalFiles || 0} {t('files').toLowerCase()}
              </Badge>
            </div>

            <div className="bg-gradient-to-br from-white/5 to-transparent rounded-lg border border-gray-400/20 p-4 max-h-96 overflow-y-auto" data-zeus-id="Z-TwoStepAppGenerator-250">
              <div className="font-mono text-sm text-foreground/70" data-zeus-id="Z-TwoStepAppGenerator-251">
                {projectStructure.structure && renderStructureTree(projectStructure.structure)}
              </div>
            </div>
          </div>

          {/* Botones de acción con efectos */}
          <div className="flex justify-center mt-6 w-full" data-zeus-id="Z-TwoStepAppGenerator-252">
            <div onClick={() => generateContentWithStructure(projectStructure!, {})} className="relative px-6 py-3 rounded-lg bg-gradient-to-br from-success/10 to-transparent border border-success/40 shadow-[0_0_10px_hsl(var(--success) / 0.4)] hover:shadow-[0_0_20px_hsl(var(--success) / 0.6)] transition-all duration-300 cursor-pointer group flex items-center justify-center gap-2 w-full sm:w-auto" data-zeus-id="Z-TwoStepAppGenerator-261">
              <div className="absolute inset-0 bg-gradient-to-br from-success/10 to-transparent rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300" data-zeus-id="Z-TwoStepAppGenerator-262"></div>
              <RefreshCw className="w-4 h-4 text-success relative z-10 flex-shrink-0" data-zeus-id="Z-TwoStepAppGenerator-263" />
              <span className="text-foreground font-medium text-sm relative z-10 truncate" data-zeus-id="Z-TwoStepAppGenerator-264">{t('generateContent')}</span>
            </div>
          </div>
        </div>}
      </div>
    </div>;
  }
  if (step === 'content') {
    contentToRender = <div className="w-full max-w-7xl mx-auto px-6 h-full overflow-hidden flex flex-col" data-zeus-id="Z-TwoStepAppGenerator-265">
      <Card className="p-8 bg-transparent border-transparent text-foreground shadow-none animate-in fade-in-0 duration-500 flex-1 min-h-0 flex flex-col" data-zeus-id="Z-TwoStepAppGenerator-266">
        <div className="mb-6 flex items-center justify-between gap-6" data-zeus-id="Z-TwoStepAppGenerator-267">
          <div className="w-[320px] flex-shrink-0" data-zeus-id="Z-TwoStepAppGenerator-content-header-left">
            <div className="space-y-2" data-zeus-id="Z-TwoStepAppGenerator-273">
              <div className="flex justify-between items-center" data-zeus-id="Z-TwoStepAppGenerator-274">
                <h3 className="text-sm font-semibold text-foreground/80" data-zeus-id="Z-TwoStepAppGenerator-275">{t('overallProgress')}</h3>
                <span className="text-sm font-bold text-foreground" data-zeus-id="Z-TwoStepAppGenerator-276">
                  {Math.round(overallProgress)}%
                </span>
              </div>
              <div className="relative h-2 bg-muted/30 rounded-full overflow-hidden" data-zeus-id="Z-TwoStepAppGenerator-277">
                <div className="absolute top-0 left-0 h-full bg-gradient-to-r from-blue-500 to-gray-400 transition-all duration-500 ease-out" style={{
                  width: `${overallProgress}%`
                }} data-zeus-id="Z-TwoStepAppGenerator-278">
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent" data-zeus-id="Z-TwoStepAppGenerator-279"></div>
                </div>
              </div>
            </div>

            <div className="mt-3" data-zeus-id="Z-TwoStepAppGenerator-content-header-resume">
              <button onClick={resumeStuckFiles} className="w-full px-3 py-2 bg-card border border-yellow-400 text-yellow-300 hover:text-foreground hover:bg-muted rounded-md shadow-[0_0_8px_rgba(234,179,8,0.8)] flex items-center justify-center gap-2 transition-all duration-300 text-sm" data-zeus-id="Z-TwoStepAppGenerator-content-resume-btn">
                <RefreshCw className="w-4 h-4" data-zeus-id="Z-TwoStepAppGenerator-content-resume-icon" />
                {t('resumeGeneration')}
              </button>
            </div>
          </div>

          <div className="flex-1 text-center" data-zeus-id="Z-TwoStepAppGenerator-content-header-center">
            <h2 className="text-3xl font-bold text-success mb-2" data-zeus-id="Z-TwoStepAppGenerator-270">{t('generatingContent')}</h2>
            <p className="text-foreground/70" data-zeus-id="Z-TwoStepAppGenerator-271">{t('creatingFiles')}</p>
          </div>

          <div className="w-[320px] flex-shrink-0" data-zeus-id="Z-TwoStepAppGenerator-content-header-right">
            <div className="grid grid-cols-3 gap-2" data-zeus-id="Z-TwoStepAppGenerator-content-header-counters">
              <div className="p-2 rounded-md border border-success/30 bg-success/20" data-zeus-id="Z-TwoStepAppGenerator-content-counter-completed">
                <div className="text-lg font-bold text-foreground leading-none" data-zeus-id="Z-TwoStepAppGenerator-content-counter-completed-value">{completedCount}</div>
                <div className="text-[11px] font-medium text-success" data-zeus-id="Z-TwoStepAppGenerator-content-counter-completed-label">{t('completed')}</div>
              </div>
              <div className="p-2 rounded-md border border-blue-500/30 bg-primary/20" data-zeus-id="Z-TwoStepAppGenerator-content-counter-pending">
                <div className="text-lg font-bold text-foreground leading-none" data-zeus-id="Z-TwoStepAppGenerator-content-counter-pending-value">{files.length - completedCount - errorCount}</div>
                <div className="text-[11px] font-medium text-primary-foreground" data-zeus-id="Z-TwoStepAppGenerator-content-counter-pending-label">{t('pending')}</div>
              </div>
              <div className="p-2 rounded-md border border-destructive/30 bg-red-900/20" data-zeus-id="Z-TwoStepAppGenerator-content-counter-errors">
                <div className="text-lg font-bold text-foreground leading-none" data-zeus-id="Z-TwoStepAppGenerator-content-counter-errors-value">{errorCount}</div>
                <div className="text-[11px] font-medium text-red-300" data-zeus-id="Z-TwoStepAppGenerator-content-counter-errors-label">{t('errors')}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 min-h-0 overflow-hidden" data-zeus-id="Z-TwoStepAppGenerator-content-grid">
          <div className="p-4 rounded-xl bg-gradient-to-br from-white/5 to-transparent border border-success/20 min-h-0 overflow-hidden flex flex-col" data-zeus-id="Z-TwoStepAppGenerator-content-left-panel">
            <div className="flex-1 min-h-0 flex flex-col" data-zeus-id="Z-TwoStepAppGenerator-272">
              {/* Lista de archivos con diseño mejorado */}
              <div className="flex items-center justify-between mb-4" data-zeus-id="Z-TwoStepAppGenerator-content-files-header">
                <div className="flex items-center gap-2" data-zeus-id="Z-TwoStepAppGenerator-content-files-title-left">
                  <span className="font-semibold text-success" data-zeus-id="Z-TwoStepAppGenerator-content-files-title">{t('fileProgress')}</span>
                  <Badge variant="outline" data-zeus-id="Z-TwoStepAppGenerator-content-files-count">{files.length}</Badge>
                </div>
              </div>

              <div className="border border-border/50 rounded-lg bg-background/20 flex-1 min-h-0 overflow-y-auto p-3" data-zeus-id="Z-TwoStepAppGenerator-296">
                <div className="space-y-3" data-zeus-id="Z-TwoStepAppGenerator-302">
                  {files.map((file, index) => {
                    const progress = fileProgress[file.path];
                    const isGenerating = progress?.status === 'generating';
                    const isCompleted = progress?.status === 'completed';
                    const isError = progress?.status === 'error';
                    const normalizedFilePath = file.path.startsWith('/') ? file.path.slice(1) : file.path;
                    const normalizedPostCorrectionPath = fileInPostCorrection?.startsWith('/') ? fileInPostCorrection.slice(1) : fileInPostCorrection;
                    const isInPostCorrection = normalizedPostCorrectionPath === normalizedFilePath || fileInPostCorrection === file.path;
                    const glowColor1 = isGenerating ? 'rgba(56,189,248,0.6)' : isCompleted ? 'hsl(var(--success) / 0.6)' : isError ? 'rgba(251,113,133,0.6)' : isInPostCorrection ? 'rgba(251,191,36,0.6)' : 'rgba(156,163,175,0.6)';
                    const glowColor2 = isGenerating ? 'rgba(168,85,247,0.6)' : isCompleted ? 'hsl(var(--success) / 0.6)' : isError ? 'rgba(239,68,68,0.6)' : isInPostCorrection ? 'rgba(245,158,11,0.6)' : 'rgba(255,255,255,0.6)';
                    return <div key={file.path} className={`relative group overflow-hidden flex flex-col p-4 rounded-lg border transition-all duration-500 transform hover:scale-105 hover:shadow-[0_0_25px_rgba(255,255,255,0.15)] ${isGenerating ? 'bg-primary/10 border-sky-300/50 shadow-lg animate-pulse hover:shadow-[0_0_20px_rgba(56,189,248,0.35)]' : isCompleted ? 'bg-success/10 border-success/50 shadow-md hover:shadow-[0_0_20px_hsl(var(--success) / 0.35)]' : isError ? 'bg-destructive/10 border-rose-300/50 shadow-md hover:shadow-[0_0_20px_rgba(251,113,133,0.35)]' : isInPostCorrection ? 'bg-warning/10 border-amber-300/50 shadow-lg hover:shadow-[0_0_20px_rgba(251,191,36,0.35)]' : 'bg-white/5 border-gray-400/20 shadow-sm hover:shadow-[0_0_20px_rgba(156,163,175,0.25)]'}`} style={{
                      animationDelay: `${index * 50}ms`
                    }} data-zeus-id="Z-TwoStepAppGenerator-303">
                      <div className="pointer-events-none absolute -inset-0.5 rounded-2xl opacity-0 group-hover:opacity-60 blur-md animate-spin" style={{
                        background: `conic-gradient(from 0deg, rgba(0,0,0,0), ${glowColor1}, ${glowColor2}, rgba(0,0,0,0))`
                      }} />
                      <div className="flex items-center justify-between" data-zeus-id="Z-TwoStepAppGenerator-304">
                        <div className="flex items-center gap-3 flex-1" data-zeus-id="Z-TwoStepAppGenerator-304-inner">
                          <div className="relative" data-zeus-id="Z-TwoStepAppGenerator-305">
                            {(isGenerating || isInPostCorrection) && <div className="absolute inset-0 animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400" data-zeus-id="Z-TwoStepAppGenerator-306"></div>}
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center ${isCompleted ? 'bg-gradient-to-br from-success to-success' : isError ? 'bg-gradient-to-br from-red-400 to-red-600' : isGenerating ? 'bg-gradient-to-br from-blue-400 to-blue-600' : isInPostCorrection ? 'bg-gradient-to-br from-yellow-400 to-yellow-600' : 'bg-gradient-to-br from-gray-400 to-gray-600'}`} data-zeus-id="Z-TwoStepAppGenerator-307">
                              {getStatusIcon(progress?.status || 'pending')}
                            </div>
                          </div>
                          <FileText className={`w-4 h-4 ${isCompleted ? 'text-success' : isError ? 'text-destructive' : isGenerating ? 'text-primary' : isInPostCorrection ? 'text-warning' : 'text-muted-foreground'}`} data-zeus-id="Z-TwoStepAppGenerator-308" />
                          <span className="font-mono text-sm text-foreground/70 truncate" data-zeus-id="Z-TwoStepAppGenerator-309">{file.path}</span>
                        </div>
                        <div className="flex items-center gap-3" data-zeus-id="Z-TwoStepAppGenerator-310">
                          {progress?.linesGenerated && <span className="text-xs bg-muted text-foreground/70 px-2 py-1 rounded-full" data-zeus-id="Z-TwoStepAppGenerator-311">
                            {progress.linesGenerated} {t('lines')}
                          </span>}
                          <Badge className={`${isCompleted ? 'bg-success/30 text-success border-success/30' : isError ? 'bg-red-900/50 text-red-300 border-destructive/30' : isGenerating ? 'bg-primary/50 text-primary-foreground border-blue-500/30 animate-pulse' : isInPostCorrection ? 'bg-yellow-900/50 text-yellow-300 border-yellow-500/30 animate-pulse' : 'bg-muted text-foreground/70 border-border/40'}`} data-zeus-id="Z-TwoStepAppGenerator-312">
                            {isInPostCorrection ? t('postRevision') : (progress?.status || 'pending')}
                          </Badge>
                        </div>
                      </div>
                      {/* Indicador de post-corrección */}
                      {isInPostCorrection && (
                        <div className="mt-3 flex items-center justify-center gap-2 animate-pulse" data-zeus-id="Z-TwoStepAppGenerator-post-correction">
                          <Clock className="h-5 w-5 text-warning animate-spin" data-zeus-id="Z-TwoStepAppGenerator-post-correction-icon" />
                          <span className="text-sm text-yellow-200 font-medium" data-zeus-id="Z-TwoStepAppGenerator-post-correction-text">
                            {t('applyingAutoCorrections')}
                          </span>
                        </div>
                      )}
                    </div>;
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-gradient-to-br from-white/5 to-transparent border border-success/20 min-h-0 overflow-hidden flex flex-col" data-zeus-id="Z-TwoStepAppGenerator-content-terminal-panel">
            <div className="flex items-center justify-between mb-4" data-zeus-id="Z-TwoStepAppGenerator-content-terminal-header">
              <div className="flex items-center gap-2" data-zeus-id="Z-TwoStepAppGenerator-content-terminal-title-left">
                <span className="font-semibold text-success" data-zeus-id="Z-TwoStepAppGenerator-content-terminal-title">{t('terminal')}</span>
                <Badge variant="outline" data-zeus-id="Z-TwoStepAppGenerator-content-terminal-count">{terminalLines.length}</Badge>
              </div>
            </div>

            <div className="border border-border/50 rounded-lg bg-[#060a14] flex-1 min-h-0 overflow-y-auto p-3 font-mono text-xs" data-zeus-id="Z-TwoStepAppGenerator-content-terminal-body">
              {terminalLines.length === 0 ? (
                <div className="text-muted-foreground" data-zeus-id="Z-TwoStepAppGenerator-content-terminal-empty">{t('terminalEmpty')}</div>
              ) : (
                terminalLines.map((line: { type: 'log' | 'info' | 'warn' | 'error'; text: string }, idx: number) => (
                  <div key={idx} className={`whitespace-pre-wrap break-words leading-relaxed ${line.type === 'error' ? 'text-destructive' : line.type === 'warn' ? 'text-yellow-300' : line.type === 'info' ? 'text-primary-foreground' : 'text-foreground/80'}`} data-zeus-id={`Z-TwoStepAppGenerator-content-terminal-line-${idx}`}>
                    {line.type === 'error' ? '❌ ' : line.type === 'warn' ? '⚠️ ' : line.type === 'info' ? 'ℹ️ ' : ''}{line.text}
                  </div>
                ))
              )}
              <div ref={terminalEndRef} data-zeus-id="Z-TwoStepAppGenerator-content-terminal-end" />
            </div>
          </div>
        </div>
      </Card>
    </div>;
  }
  if (step === 'complete') {
    contentToRender = <div className="w-full max-w-7xl mx-auto px-6 h-full overflow-hidden flex flex-col" data-zeus-id="Z-TwoStepAppGenerator-313">
      <Card className="p-6 bg-transparent border-transparent text-foreground shadow-none flex-1 min-h-0 overflow-y-auto flex flex-col" data-zeus-id="Z-TwoStepAppGenerator-314">
        <div className="text-center space-y-4 shrink-0" data-zeus-id="Z-TwoStepAppGenerator-315">
          <div className="flex justify-center mb-4" data-zeus-id="Z-TwoStepAppGenerator-316">
            <img src="/LOGO_ZEUS.png" alt="Logo" className="w-24 h-24 object-contain" width={100} height={100} data-zeus-id="Z-TwoStepAppGenerator-317" />
          </div>
          <h2 className="text-3xl font-bold text-success" data-zeus-id="Z-TwoStepAppGenerator-318">{t('appGenerated')}</h2>
          <p className="text-foreground/70" data-zeus-id="Z-TwoStepAppGenerator-319">
            {t('appGeneratedDesc')} <strong className="text-foreground" data-zeus-id="Z-TwoStepAppGenerator-320">{formData.appName}</strong> {t('appGeneratedDesc2')}
          </p>

          {/* Animación de post-procesamiento */}
          {isPostProcessing && (
            <div className="mb-4 flex flex-col items-center justify-center gap-3 animate-pulse" data-zeus-id="Z-TwoStepAppGenerator-postprocessing">
              <Clock className="h-7 w-7 text-warning animate-spin" data-zeus-id="Z-TwoStepAppGenerator-postprocessing-icon" />
              <div className="text-yellow-200 text-sm text-center" data-zeus-id="Z-TwoStepAppGenerator-postprocessing-text">
                <div className="font-semibold text-yellow-100">{t('finishing')}</div>
                <div>{t('applyingAutoCorrections')}</div>
              </div>
            </div>
          )}

          {/* Botón de acción superior: Guardar */}
          <div className="flex justify-end gap-3 mt-4 shrink-0" data-zeus-id="Z-TwoStepAppGenerator-top-actions">
            <button
              onClick={isSaving ? undefined : handleSave}
              disabled={isSaving}
              className={`relative px-4 py-2 rounded-lg bg-gradient-to-br from-white/5 to-transparent border transition-all duration-300 flex items-center justify-center gap-2 ${isSaving ? 'border-border/40/40 opacity-50 cursor-not-allowed' : 'border-success/40 shadow-[0_0_10px_hsl(var(--success) / 0.4)] hover:shadow-[0_0_20px_hsl(var(--success) / 0.6)] cursor-pointer group'}`}
              data-zeus-id="Z-TwoStepAppGenerator-save-btn"
            >
              {!isSaving && <div className="absolute inset-0 bg-gradient-to-br from-success/10 to-transparent rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>}
              <Save className={`w-4 h-4 relative z-10 flex-shrink-0 ${isSaving ? 'text-muted-foreground/80' : 'text-foreground'}`} />
              <span className={`font-medium text-sm relative z-10 whitespace-nowrap ${isSaving ? 'text-muted-foreground/80' : 'text-foreground'}`}>
                {isSaving ? t('saving') : t('save')}
              </span>
            </button>
          </div>

          {/* Layout de 2 columnas: Izquierda (archivos + vista previa + botones) | Derecha (terminal) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-4 flex-1 min-h-0 overflow-hidden" data-zeus-id="Z-TwoStepAppGenerator-321">
            {/* Columna izquierda: Archivos + Vista previa + Botones */}
            <div className="lg:col-span-1 space-y-2 min-h-0 flex flex-col overflow-hidden" data-zeus-id="Z-TwoStepAppGenerator-left-column">
              {/* Botones de acción */}
              <div className="flex flex-row gap-2 shrink-0" data-zeus-id="Z-TwoStepAppGenerator-buttons-row">
                <div onClick={isPostProcessing ? undefined : runFixMissingImportsAndValidate} className={`relative px-3 py-2 rounded-lg bg-gradient-to-br from-white/5 to-transparent border transition-all duration-300 flex items-center justify-center gap-2 flex-1 ${isPostProcessing ? 'border-border/40/40 opacity-50 cursor-not-allowed' : 'border-cyan-400/40 shadow-[0_0_10px_rgba(34,211,238,0.4)] hover:shadow-[0_0_20px_rgba(34,211,238,0.6)] cursor-pointer group'}`} data-zeus-id="Z-TwoStepAppGenerator-fix-imports-btn">
                  {!isPostProcessing && <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 to-transparent rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>}
                  <Wand2 className={`w-4 h-4 relative z-10 flex-shrink-0 ${isPostProcessing ? 'text-muted-foreground/80' : 'text-foreground'}`} />
                  <span className={`font-medium text-sm relative z-10 whitespace-nowrap ${isPostProcessing ? 'text-muted-foreground/80' : 'text-foreground'}`}>{t('generateComponents')}</span>
                </div>

                <div onClick={isPostProcessing ? undefined : () => runPostCorrectPage()} className={`relative px-3 py-2 rounded-lg bg-gradient-to-br from-white/5 to-transparent border transition-all duration-300 flex items-center justify-center gap-2 flex-1 ${isPostProcessing ? 'border-border/40/40 opacity-50 cursor-not-allowed' : 'border-yellow-400/40 shadow-[0_0_10px_rgba(234,179,8,0.4)] hover:shadow-[0_0_20px_rgba(234,179,8,0.6)] cursor-pointer group'}`} data-zeus-id="Z-TwoStepAppGenerator-post-correct-btn">
                  {!isPostProcessing && <div className="absolute inset-0 bg-gradient-to-br from-yellow-500/10 to-transparent rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>}
                  <AlertCircle className={`w-4 h-4 relative z-10 flex-shrink-0 ${isPostProcessing ? 'text-muted-foreground/80' : 'text-foreground'}`} />
                  <span className={`font-medium text-sm relative z-10 whitespace-nowrap ${isPostProcessing ? 'text-muted-foreground/80' : 'text-foreground'}`}>{t('correctFile')}</span>
                </div>

                <div onClick={isPostProcessing ? undefined : runValidateComponents} className={`relative px-3 py-2 rounded-lg bg-gradient-to-br from-white/5 to-transparent border transition-all duration-300 flex items-center justify-center gap-2 flex-1 ${isPostProcessing ? 'border-border/40/40 opacity-50 cursor-not-allowed' : 'border-indigo-400/40 shadow-[0_0_10px_rgba(99,102,241,0.4)] hover:shadow-[0_0_20px_rgba(99,102,241,0.6)] cursor-pointer group'}`} data-zeus-id="Z-TwoStepAppGenerator-validate-btn">
                  {!isPostProcessing && <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-transparent rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>}
                  <CheckCircle className={`w-4 h-4 relative z-10 flex-shrink-0 ${isPostProcessing ? 'text-muted-foreground/80' : 'text-foreground'}`} />
                  <span className={`font-medium text-sm relative z-10 whitespace-nowrap ${isPostProcessing ? 'text-muted-foreground/80' : 'text-foreground'}`}>{t('validateComponents')}</span>
                </div>
              </div>

              {/* Selector de archivos generados */}
              <div className="rounded-xl bg-gradient-to-br from-white/5 to-transparent border border-success/20 p-3 shrink-0" data-zeus-id="Z-TwoStepAppGenerator-complete-file-selector">
                <div className="text-sm text-success mb-1" data-zeus-id="Z-TwoStepAppGenerator-archivos-label">{t('generatedFiles')}</div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 rounded-md border border-border/40 bg-[#060a14] px-3 py-2 text-sm text-foreground/80 hover:bg-[#0a1020] transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {completeStepSelectedFile ? (
                          <>
                            <FileText className="w-4 h-4 flex-shrink-0 text-success" />
                            <span className="font-mono text-sm truncate text-warning">{completeStepSelectedFile}</span>
                            <span className="flex-shrink-0 text-xs text-muted-foreground">
                              {completedFiles[completeStepSelectedFile]?.split('\n').length || 0} {t('lines')}
                            </span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">{t('selectFileToCorrect')}</span>
                        )}
                      </div>
                      <ChevronDown className="w-4 h-4 opacity-70 flex-shrink-0" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width] bg-[#060a14] border border-border/50" sideOffset={6}>
                    <DropdownMenuLabel className="text-foreground/70">{t('selectFileToCorrect')}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <div className="max-h-60 overflow-y-auto">
                      {Object.keys(completedFiles).map(filePath => {
                        const isActive = completeStepSelectedFile === filePath;
                        const lines = completedFiles[filePath]?.split('\n').length || 0;
                        return (
                          <DropdownMenuItem
                            key={filePath}
                            onSelect={() => setCompleteStepSelectedFile(filePath)}
                            className={`cursor-pointer px-2 py-2 ${isActive ? 'bg-primary/20 border border-blue-500/50' : ''}`}
                          >
                            <div className="flex items-center gap-3 w-full">
                              <FileText className="w-4 h-4 flex-shrink-0 text-success" />
                              <div className="flex-1 min-w-0">
                                <div className="font-mono text-sm truncate text-warning">{filePath}</div>
                                <div className="text-xs text-muted-foreground">{lines} {t('lines')}</div>
                              </div>
                            </div>
                          </DropdownMenuItem>
                        );
                      })}
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Vista previa del código / URL */}
              <div className="relative p-3 rounded-xl bg-gradient-to-br from-white/5 to-transparent border border-success/20 shadow-[0_0_15px_hsl(var(--success) / 0.2)] flex-1 min-h-0 max-h-[45vh] flex flex-col overflow-hidden" data-zeus-id="Z-TwoStepAppGenerator-preview-container">
                <div className="text-sm text-success mb-1" data-zeus-id="Z-TwoStepAppGenerator-preview-label">{t('codePreview')}</div>
                <div className="text-xs text-muted-foreground" data-zeus-id="Z-TwoStepAppGenerator-preview-placeholder">
                  {previewUrl ? (
                    <div className="space-y-2">
                      <div className="text-success">{t('previewAvailable')}</div>
                      <code className="bg-success/30 text-success px-2 py-1 rounded text-xs block break-all">{previewUrl}</code>
                    </div>
                  ) : (
                    <div className="text-muted-foreground/80">{t('previewUnavailable')}</div>
                  )}
                </div>
                {completeStepSelectedFile && completedFiles[completeStepSelectedFile] && (
                  <div className="mt-4 border-t border-border/40 pt-4">
                    <div className="text-xs text-muted-foreground/80 mb-2">{t('codePreview')} {completeStepSelectedFile}:</div>
                    <pre className="text-xs bg-[#060a14] rounded p-3 max-h-96 overflow-y-auto overflow-x-auto whitespace-pre font-mono text-success text-left">
                      {completedFiles[completeStepSelectedFile]}
                    </pre>
                  </div>
                )}
              </div>

            </div>

            {/* Columna derecha: Terminal */}
            <div className="lg:col-span-1 min-h-0 flex flex-col" style={{ maxHeight: '55vh' }} data-zeus-id="Z-TwoStepAppGenerator-right-column">
              <div className="p-3 rounded-xl bg-gradient-to-br from-white/5 to-transparent border border-success/20 min-h-0 overflow-hidden flex flex-col flex-1" data-zeus-id="Z-TwoStepAppGenerator-complete-terminal-panel">
                <div className="flex items-center justify-between mb-2" data-zeus-id="Z-TwoStepAppGenerator-complete-terminal-header">
                  <div className="flex items-center gap-2" data-zeus-id="Z-TwoStepAppGenerator-complete-terminal-title-left">
                    <span className="font-semibold text-success" data-zeus-id="Z-TwoStepAppGenerator-complete-terminal-title">{t('terminal')}</span>
                    <Badge variant="outline" data-zeus-id="Z-TwoStepAppGenerator-complete-terminal-count">{terminalLines.length}</Badge>
                  </div>
                </div>

                <div className="border border-border/50 rounded-lg bg-[#060a14] flex-1 min-h-0 overflow-y-auto p-3 font-mono text-xs" data-zeus-id="Z-TwoStepAppGenerator-complete-terminal-body">
                  {terminalLines.length === 0 ? (
                    <div className="text-muted-foreground" data-zeus-id="Z-TwoStepAppGenerator-complete-terminal-empty">{t('terminalEmpty')}</div>
                  ) : (
                    terminalLines.map((line: { type: 'log' | 'info' | 'warn' | 'error'; text: string }, idx: number) => (
                      <div key={idx} className={`whitespace-pre-wrap break-words leading-relaxed ${line.type === 'error' ? 'text-destructive' : line.type === 'warn' ? 'text-yellow-300' : line.type === 'info' ? 'text-primary-foreground' : 'text-foreground/80'}`} data-zeus-id={`Z-TwoStepAppGenerator-complete-terminal-line-${idx}`}>
                        {line.type === 'error' ? '❌ ' : line.type === 'warn' ? '⚠️ ' : line.type === 'info' ? 'ℹ️ ' : ''}{line.text}
                      </div>
                    ))
                  )}
                  <div ref={terminalEndRef} data-zeus-id="Z-TwoStepAppGenerator-complete-terminal-end" />
                </div>
              </div>
            </div>
          </div>

          {isStartingPreview && <Alert className="mb-4 border-blue-700 bg-primary/30" data-zeus-id="Z-TwoStepAppGenerator-328">
            <Clock className="h-4 w-4 text-primary" data-zeus-id="Z-TwoStepAppGenerator-329" />
            <AlertDescription className="text-primary-foreground/80" data-zeus-id="Z-TwoStepAppGenerator-330">
              {t('startingPreviewServer')}
            </AlertDescription>
          </Alert>}

          {isUploadingToPreview && <Alert className="mb-4 border-blue-700 bg-primary/30" data-zeus-id="Z-TwoStepAppGenerator-331">
            <Clock className="h-4 w-4 text-primary" data-zeus-id="Z-TwoStepAppGenerator-332" />
            <AlertDescription className="text-primary-foreground/80" data-zeus-id="Z-TwoStepAppGenerator-333">
              {t('uploadingToPreviewServer')}
            </AlertDescription>
          </Alert>}

          {previewUrl && (
            <div className="mb-4 flex flex-col items-center justify-center gap-2" data-zeus-id="Z-TwoStepAppGenerator-334">
              <div className="flex items-center justify-center gap-2" data-zeus-id="Z-TwoStepAppGenerator-335">
                <CheckCircle className="h-5 w-5 text-success" data-zeus-id="Z-TwoStepAppGenerator-335-icon" />
                <span className="text-success text-sm font-medium" data-zeus-id="Z-TwoStepAppGenerator-336">
                  ¡Vista previa lista! Tu aplicación está disponible en:
                </span>
              </div>
              <code className="text-success text-sm break-all" data-zeus-id="Z-TwoStepAppGenerator-338">{previewUrl}</code>
            </div>
          )}



        </div>
      </Card>
    </div>;
  }

  // Ensure we always return a valid ReactNode
  const stepLabels: Record<string, string> = {
    form: 'Configuración',
    structure: 'Estructura',
    content: 'Contenido',
    complete: 'Resultado'
  };

  const stepOrder: ('form' | 'structure' | 'content' | 'complete')[] = ['form', 'structure', 'content', 'complete'];
  const currentStepIndex = stepOrder.indexOf(step);

  const goToPrevStep = () => {
    if (currentStepIndex > 0) {
      setStep(stepOrder[currentStepIndex - 1]);
    }
  };

  const goToNextStep = () => {
    if (currentStepIndex < stepOrder.length - 1) {
      setStep(stepOrder[currentStepIndex + 1]);
    }
  };

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto">
        {contentToRender}
      </div>
      <div className="shrink-0 px-4 py-1.5 border-t border-border/50/50 bg-background/80 backdrop-blur-sm flex items-center justify-between gap-3 z-50" data-zeus-id="Z-TwoStepAppGenerator-step-navigator">
        <button
          onClick={goToPrevStep}
          disabled={currentStepIndex === 0}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all duration-300 text-xs font-medium ${currentStepIndex === 0 ? 'border-border/50 text-muted-foreground/60 cursor-not-allowed' : 'border-blue-400/40 text-primary-foreground hover:bg-blue-400/10 hover:border-blue-400/70 cursor-pointer'}`}
          data-zeus-id="Z-TwoStepAppGenerator-prev-btn"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          {t('previous')}
        </button>

        <div className="flex items-center gap-1.5">
          {stepOrder.map((s, idx) => (
            <div
              key={s}
              className={`h-1.5 rounded-full transition-all duration-300 ${idx === currentStepIndex ? 'w-6 bg-success' : idx < currentStepIndex ? 'w-3 bg-success/50' : 'w-3 bg-muted/80'}`}
              data-zeus-id={`Z-TwoStepAppGenerator-step-dot-${s}`}
            />
          ))}
        </div>

        <button
          onClick={goToNextStep}
          disabled={currentStepIndex === stepOrder.length - 1}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all duration-300 text-xs font-medium ${currentStepIndex === stepOrder.length - 1 ? 'border-border/50 text-muted-foreground/60 cursor-not-allowed' : 'border-blue-400/40 text-primary-foreground hover:bg-blue-400/10 hover:border-blue-400/70 cursor-pointer'}`}
          data-zeus-id="Z-TwoStepAppGenerator-next-btn"
        >
          {t('next')}
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Modal Generar Icono */}
    </div>
  );
});

// Helper function to render structure tree
function renderStructureTree(structure: FileStructure[], level = 0): React.ReactNode {
  return structure.map(item => <div key={item.path} style={{
    marginLeft: `${level * 24}px`
  }} data-zeus-id="Z-TwoStepAppGenerator-369">
    <div className="flex items-center gap-3 py-2 hover:bg-muted/50 rounded-lg px-2 transition-colors duration-200" data-zeus-id="Z-TwoStepAppGenerator-370">
      <div className="flex-shrink-0" data-zeus-id="Z-TwoStepAppGenerator-371">
        {item.type === 'directory' ? <div className="w-5 h-5 bg-gradient-to-br from-blue-400 to-blue-600 rounded flex items-center justify-center" data-zeus-id="Z-TwoStepAppGenerator-372">
          <Folder className="w-3 h-3 text-foreground" data-zeus-id="Z-TwoStepAppGenerator-373" />
        </div> : <div className="w-5 h-5 bg-gradient-to-br from-gray-400 to-gray-600 rounded flex items-center justify-center" data-zeus-id="Z-TwoStepAppGenerator-374">
          <FileText className="w-3 h-3 text-foreground" data-zeus-id="Z-TwoStepAppGenerator-375" />
        </div>}
      </div>
      <span className={`font-medium ${item.type === 'directory' ? 'text-primary-foreground font-semibold' : 'text-foreground/70'}`} data-zeus-id="Z-TwoStepAppGenerator-376">
        {item.name}
      </span>
      {item.content && <Badge className="ml-auto bg-success/30 text-success border-success/30 text-xs px-2 py-1" data-zeus-id="Z-TwoStepAppGenerator-377">
        predefinido
      </Badge>}
    </div>
    {item.children && <div className="border-l-2 border-border/40 ml-2" data-zeus-id="Z-TwoStepAppGenerator-378">
      {renderStructureTree(item.children, level + 1)}
    </div>}
  </div>);
}
export default TwoStepAppGenerator;