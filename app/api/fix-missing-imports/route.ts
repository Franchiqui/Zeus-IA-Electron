import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { UsageService, getProjectRoot, getModelsForUser } from '@/api/utils';
import { getPocketBase } from '@/lib/pocketbase';
import { callModelGeneric } from '@/api/zeus-model-api/generic-model-call';


async function fileExists(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function readRepoTemplateFile(relativePathFromRepoRoot: string): Promise<string | null> {
  try {
    const fullPath = path.join(process.cwd(), relativePathFromRepoRoot);
    return await fs.readFile(fullPath, 'utf8');
  } catch {
    return null;
  }
}

async function getFastTemplateForMissingFile(relTarget: string): Promise<string | null> {
  const normalized = relTarget.replace(/\\/g, '/').replace(/^\/+/, '');

  // Atajo para shadcn/ui
  if (!normalized.startsWith('components/ui/')) return null;
  if (!normalized.endsWith('.tsx')) return null;

  const fileName = normalized.slice('components/ui/'.length);
  return (
    (await readRepoTemplateFile(path.join('components', 'ui', fileName))) ||
    (await readRepoTemplateFile(path.join('ui', fileName)))
  );
}

const SOURCE_EXTS = ['.tsx', '.ts', '.jsx', '.js'];

const MAX_COMPONENTS_PER_REQUEST = 4;

// ✅ Helpers para evitar duplicados y extensiones dobles
function hasKnownExtension(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SOURCE_EXTS.includes(ext);
}

function normalizeTargetPath(candidateBase: string): string {
  if (hasKnownExtension(candidateBase)) {
    return candidateBase;
  }
  return candidateBase + SOURCE_EXTS[0]; // .tsx por defecto
}

async function scanExistingFiles(root: string): Promise<Set<string>> {
  const existing = new Set<string>();
  async function walk(dir: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch { return; }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const name = entry.name.toLowerCase();
        if (name === 'node_modules' || name.startsWith('.') || name === 'dist' || name === 'out' || name === 'build') continue;
        await walk(fullPath);
      } else {
        existing.add(fullPath);
      }
    }
  }
  await walk(root);
  return existing;
}

// Common files that already exist and should not be duplicated
const COMMON_FILES_BLACKLIST = [
  // App files
  'app/globals.css',
  'app/globals.css.tsx',
  'app/layout.tsx',
  'app/page.tsx',


  // Components
  'components/component-selector-helper.tsx',
  'components/ComponentSelectorHelper.tsx',
  'components/component-selector-helper',

  
  // Components - Common
  'components/common/Icon.tsx',
  'components/common/icon.tsx',
  'components/common/Icon',
  'components/common/icon',
  
  // Components - Layout
  'components/layout/footer.tsx',
  'components/layout/Footer.tsx',
  'components/layout/footer',
  'components/layout/Footer',
  'components/layout/header.tsx',
  'components/layout/Header.tsx',
  'components/layout/header',
  'components/layout/Header',
  'components/layout/sidebar.tsx',
  'components/layout/Sidebar.tsx',
  'components/layout/sidebar',
  'components/layout/Sidebar',
  
  // Components - UI
  'components/ui/button.tsx',
  'components/ui/Button.tsx',
  'components/ui/button',
  'components/ui/Button',
  'components/ui/card.tsx',
  'components/ui/Card.tsx',
  'components/ui/card',
  'components/ui/Card',
  'components/ui/input.tsx',
  'components/ui/Input.tsx',
  'components/ui/input',
  'components/ui/Input',
  'components/ui/modal.tsx',
  'components/ui/Modal.tsx',
  'components/ui/modal',
  'components/ui/Modal',
  'components/ui/slider.tsx',
  'components/ui/Slider.tsx',
  'components/ui/slider',
  'components/ui/Slider',
  'components/ui/tabs.tsx',
  'components/ui/Tabs.tsx',
  'components/ui/tabs',
  'components/ui/Tabs',
  'components/ui/toast.tsx',
  'components/ui/Toast.tsx',
  'components/ui/toast',
  'components/ui/Toast',
  'components/ui/toaster.tsx',
  'components/ui/Toaster.tsx',
  'components/ui/toaster',
  'components/ui/Toaster',
  'components/ui/toggle.tsx',
  'components/ui/Toggle.tsx',
  'components/ui/toggle',
  'components/ui/Toggle',
  'components/ui/tooltip.tsx',
  'components/ui/Tooltip.tsx',
  'components/ui/tooltip',
  'components/ui/Tooltip',
  'components/ui/error-boundary.tsx',
  'components/ui/ErrorBoundary.tsx',
  'components/ui/error-boundary',
  'components/ui/ErrorBoundary',
  'components/ui/navbar.tsx',
  'components/ui/Navbar.tsx',
  'components/ui/navbar',
  'components/ui/Navbar',
  'components/ui/Providers.tsx',
  'components/ui/providers.tsx',
  'components/ui/Providers',
  'components/ui/providers',
  'components/Providers.tsx',
  'components/providers.tsx',
  'components/Providers',
  'components/providers',
  'components/ui/theme-provider.tsx',
  'components/ui/ThemeProvider.tsx',
  'components/ui/theme-provider',
  'components/ui/ThemeProvider',

  // FloatingChat
  'components/ui/floating-chat-button.tsx',
  'components/ui/FloatingChatButton.tsx',
  'components/ui/floating-chat-button',
  'components/ui/FloatingChatButton',
  'FloatingChat/Chat/index.tsx',
  'FloatingChat/Chat/Index.tsx',
  'FloatingChat/Chat/index',
  'FloatingChat/Chat/Index',
  'FloatingChat/Chat/DraggableFloatingChat.tsx',
  'FloatingChat/Chat/DraggableFloatingChat',
  'FloatingChat/Chat/draggableFloatingChat.tsx',
  'FloatingChat/Chat/draggableFloatingChat',
  'FloatingChat/Chat/AuthForm.tsx',
  'FloatingChat/Chat/AuthForm',
  'FloatingChat/Chat/ChatSizeContext.tsx',
  'FloatingChat/Chat/ChatSizeContext',
  'FloatingChat/Chat/ChatWindow.tsx',
  'FloatingChat/Chat/ChatWindow',
  'FloatingChat/Chat/ConnectedUsers.tsx',
  'FloatingChat/Chat/ConnectedUsers',
  'FloatingChat/Chat/LanguageContext.tsx',
  'FloatingChat/Chat/LanguageContext',
  'FloatingChat/Chat/LanguageSelector.tsx',
  'FloatingChat/Chat/LanguageSelector',
  'FloatingChat/Chat/MessageInput.tsx',
  'FloatingChat/Chat/MessageInput',
  'FloatingChat/Chat/MessageList.tsx',
  'FloatingChat/Chat/MessageList',
  'FloatingChat/Chat/PocketBaseContext.tsx',
  'FloatingChat/Chat/PocketBaseContext',
  'FloatingChat/Chat/ProfileSettings.tsx',
  'FloatingChat/Chat/ProfileSettings',
  'FloatingChat/ui/button.tsx',
  'FloatingChat/ui/button',
  'FloatingChat/ui/dropdown-menu.tsx',
  'FloatingChat/ui/dropdown-menu',
  'FloatingChat/ui/input.tsx',
  'FloatingChat/ui/input',
  'FloatingChat/ui/label.tsx',
  'FloatingChat/ui/label',
  'FloatingChat/ui/scroll-area.tsx',
  'FloatingChat/ui/scroll-area',
  'FloatingChat/chat.css',
  'FloatingChat/chat.css.tsx',
  'FloatingChat/chat',
  'FloatingChat/theme-provider.tsx',
  'FloatingChat/theme-provider',
  'FloatingChat/theme-toggle.tsx',
  'FloatingChat/theme-toggle',



  // Contexts
  'contexts/drawing-context.tsx',
  'contexts/DrawingContext.tsx',
  'contexts/drawing-context',
  'contexts/DrawingContext',
  'contexts/editor-context.tsx',
  'contexts/EditorContext.tsx',
  'contexts/editor-context',
  'contexts/EditorContext',
  'contexts/file-context.tsx',
  'contexts/FileContext.tsx',
  'contexts/file-context',
  'contexts/FileContext',
  
  // Hooks
  'hooks/use-debounce.ts',
  'hooks/useDebounce.ts',
  'hooks/use-debounce',
  'hooks/useDebounce',
  'hooks/use-local-storage.ts',
  'hooks/useLocalStorage.ts',
  'hooks/use-local-storage',
  'hooks/useLocalStorage',
  'hooks/use-toast.ts',
  'hooks/use-toast.tsx',
  'hooks/useToast.ts',
  'hooks/useToast.tsx',
  'hooks/use-toast',
  'hooks/useToast',
  
  // Lib
  'lib/constants.ts',
  'lib/constants',
  'lib/pocketbase.ts',
  'lib/pocketbase.tsx',
  'lib/pocketbase',
  'lib/store.ts',
  'lib/store.tsx',
  'lib/store',
  'lib/utils.ts',
  'lib/utils.tsx',
  'lib/utils',
  'lib/validations.ts',
  'lib/validations',
  'src/components/ui/floating-chat-button.tsx',
  'src/components/ui/FloatingChatButton.tsx',
  'src/components/ui/floating-chat-button.ts',
  'src/components/ui/FloatingChatButton.ts',
  'src/components/ui/floating-chat-button',
  'src/components/ui/FloatingChatButton',
  'zeus-styles.css',
  'zeus-styles.css.tsx',
  'zeus-icons.js',

];

function isRelativeImport(spec: string) {
  return spec.startsWith('./') || spec.startsWith('../');
}

function isAliasImport(spec: string) {
  // Alias típico de Next.js: '@/...' mapeado a la raíz del proyecto/app
  return spec.startsWith('@/'); // Fix: Added missing slash
}

async function resolveImport(baseFile: string, spec: string): Promise<string | null> {
  const baseDir = path.dirname(baseFile);
  const candidateBase = path.resolve(baseDir, spec);

  // 1) Try with extensions
  for (const ext of SOURCE_EXTS) {
    const p = candidateBase + ext;
    if (await fileExists(p)) return p;
  }

  // 2) Try index files in folder
  for (const ext of SOURCE_EXTS) {
    const p = path.join(candidateBase, 'index' + ext);
    if (await fileExists(p)) return p;
  }

  // Not found
  return null;
}

// ✅ Función auxiliar para obtener el modelo seleccionado del usuario (reutilizable)
async function getEffectiveModel(userId?: string, modelId?: string, userToken?: string): Promise<{ provider: string; model: string; url: string; apiKey: string }> {
  let effectiveModel: { provider?: string; model?: string; url?: string; apiKey?: string } | undefined;

  if (modelId) {
    try {
      const pb = await getPocketBase();

      if (userToken) {
        try {
          pb.authStore.save(userToken, null as any);
        } catch {}
      }

      try {
        const record: any = await pb.collection('ai_models').getOne(modelId, { $autoCancel: false } as any);
        effectiveModel = {
          provider: record.provider || record.type || 'openai',
          model: record.model_name,
          url: record.base_url,
          apiKey: record.api_key,
        };
        console.log(`[postgen] ✅ Modelo seleccionado (ai_models.getOne): ${effectiveModel.model} (${effectiveModel.provider})`);
        return effectiveModel as { provider: string; model: string; url: string; apiKey: string };
      } catch (e) {
        console.warn('[postgen] Failed to get model by ID via ai_models.getOne:', e);
      }
    } catch (e) {
      console.warn('[postgen] Error inicializando PocketBase para leer ai_models:', e);
    }
  }

  // PRIORIDAD 1: Si hay userId, SIEMPRE intentar obtener el modelo seleccionado del usuario
  if (userId) {
    try {
      // Primero intentar con modelId si está disponible
      if (modelId) {
        try {
          const allModels = await getModelsForUser(userId);
          const modelConfig = allModels.find((m: any) => m.id === modelId);
          if (modelConfig) {
            effectiveModel = {
              provider: modelConfig.provider || 'openai',
              model: modelConfig.model,
              url: modelConfig.url,
              apiKey: modelConfig.apiKey,
            };
            console.log(`[postgen] ✅ Modelo seleccionado (por ID): ${effectiveModel.model} (${effectiveModel.provider})`);
          }
        } catch (e) {
          console.warn('[postgen] Failed to load model by ID from PocketBase:', e);
        }
      }

      // Si no encontramos el modelo por ID, usar el modelo seleccionado por defecto del usuario
      if (!effectiveModel || !effectiveModel.model) {
        try {
          const allModels = await getModelsForUser(userId);
          if (allModels && allModels.length > 0) {
            const defaultModel = allModels[0];
            effectiveModel = {
              provider: defaultModel.provider || 'openai',
              model: defaultModel.model || defaultModel.model_name,
              url: defaultModel.url || defaultModel.base_url,
              apiKey: defaultModel.apiKey || defaultModel.api_key,
            };
            console.log(`[postgen] ✅ Modelo seleccionado (por defecto del usuario): ${effectiveModel.model} (${effectiveModel.provider})`);
          }
        } catch (e) {
          console.warn('[postgen] Failed to get user selected model:', e);
        }
      }
    } catch (e) {
      console.warn('[postgen] Error obteniendo modelo del usuario:', e);
    }
  }

  if (!effectiveModel || !effectiveModel.model) {
    console.warn(`[postgen] ⚠️ No se pudo resolver el modelo seleccionado (userId: ${userId || 'n/a'}, modelId: ${modelId || 'n/a'}). Se usará fallback SIN apiKey (stub).`);
    effectiveModel = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      url: 'https://api.openai.com/v1',
      apiKey: '',
    };
  }

  return effectiveModel as { provider: string; model: string; url: string; apiKey: string };
}

async function detectAppContext(officialRoot: string): Promise<string> {
  try {
    const keywords = new Set<string>();
    const pages: string[] = [];
    const components: string[] = [];
    const features: string[] = [];

    async function scanDir(dir: string) {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch { return; }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name.startsWith('.') || entry.name === 'dist' || entry.name === 'out') continue;
          await scanDir(fullPath);
        } else {
          const ext = path.extname(entry.name).toLowerCase();
          if (!['.tsx','.ts','.jsx','.js'].includes(ext)) continue;
          try {
            const content = await fs.readFile(fullPath, 'utf8');
            const lower = content.toLowerCase();
            if (lower.includes('dashboard')) keywords.add('dashboard');
            if (lower.includes('e-commerce') || lower.includes('ecommerce') || lower.includes('cart') || lower.includes('shop') || lower.includes('product')) keywords.add('e-commerce');
            if (lower.includes('blog') || lower.includes('post') || lower.includes('article')) keywords.add('blog');
            if (lower.includes('auth') || lower.includes('login') || lower.includes('register') || lower.includes('password')) keywords.add('auth');
            if (lower.includes('chat') || lower.includes('message') || lower.includes('conversation')) keywords.add('chat');
            if (lower.includes('admin') || lower.includes('panel') || lower.includes('crud')) keywords.add('admin');
            if (lower.includes('landing') || lower.includes('home') || lower.includes('hero')) keywords.add('landing');
            if (lower.includes('payment') || lower.includes('stripe') || lower.includes('checkout')) keywords.add('payment');
            if (lower.includes('map') || lower.includes('location') || lower.includes('geo')) keywords.add('maps');
            if (lower.includes('calendar') || lower.includes('schedule') || lower.includes('event')) keywords.add('calendar');
            if (lower.includes('chart') || lower.includes('graph') || lower.includes('analytics')) keywords.add('analytics');
            if (lower.includes('upload') || lower.includes('file') || lower.includes('image') || lower.includes('media')) keywords.add('media');
            if (lower.includes('api') || lower.includes('fetch') || lower.includes('axios')) keywords.add('api-client');
            if (lower.includes('form') || lower.includes('input') || lower.includes('validation')) keywords.add('forms');
            if (lower.includes('table') || lower.includes('datatable') || lower.includes('grid')) keywords.add('data-tables');
            if (lower.includes('socket') || lower.includes('websocket') || lower.includes('realtime')) keywords.add('realtime');
            if (lower.includes('notification') || lower.includes('toast') || lower.includes('alert')) keywords.add('notifications');
            if (lower.includes('theme') || lower.includes('dark') || lower.includes('light')) keywords.add('theming');
            if (lower.includes('i18n') || lower.includes('translate') || lower.includes('locale')) keywords.add('i18n');
            if (lower.includes('search') || lower.includes('filter') || lower.includes('query')) keywords.add('search');

            if (fullPath.includes('/app/') && (entry.name.includes('page.') || entry.name.includes('layout.'))) {
              const rel = path.relative(officialRoot, fullPath).replace(/\\/g, '/');
              pages.push(rel);
            }
            if (fullPath.includes('/components/')) {
              const rel = path.relative(officialRoot, fullPath).replace(/\\/g, '/');
              components.push(rel);
            }
          } catch {}
        }
      }
    }

    await scanDir(officialRoot);

    const keywordList = Array.from(keywords);
    if (keywordList.length === 0 && pages.length === 0 && components.length === 0) {
      return 'Aplicación Next.js/React con TypeScript.';
    }

    const parts: string[] = [];
    parts.push(`Aplicación Next.js/React con TypeScript.`);
    if (keywordList.length > 0) {
      parts.push(`Características principales detectadas: ${keywordList.join(', ')}.`);
    }
    if (pages.length > 0) {
      parts.push(`Páginas existentes: ${pages.slice(0, 8).join(', ')}${pages.length > 8 ? '...' : ''}.`);
    }
    if (components.length > 0) {
      parts.push(`Componentes existentes: ${components.slice(0, 8).join(', ')}${components.length > 8 ? '...' : ''}.`);
    }
    return parts.join(' ');
  } catch {
    return 'Aplicación Next.js/React con TypeScript.';
  }
}

function extractPureCode(raw: string): string {
  const trimmed = (raw || '').trim();
  const fenced = trimmed.match(/```[a-zA-Z0-9]*\n([\s\S]*?)```/);
  if (fenced && fenced[1]) return fenced[1].trim();
  return trimmed;
}

function looksTruncatedCode(code: string): boolean {
  const c = (code || '').trim();
  if (!c) return false;

  const openBraces = (c.match(/{/g) || []).length;
  const closeBraces = (c.match(/}/g) || []).length;
  const openParens = (c.match(/\(/g) || []).length;
  const closeParens = (c.match(/\)/g) || []).length;
  const openBrackets = (c.match(/\[/g) || []).length;
  const closeBrackets = (c.match(/\]/g) || []).length;

  if (openBraces > closeBraces) return true;
  if (openParens > closeParens) return true;
  if (openBrackets > closeBrackets) return true;

  const last = c.slice(-1);
  if (last === ',' || last === ':' || last === '.' || last === '(' || last === '[') return true;
  if (/\b(export|return|const|let|function)\s*$/.test(c)) return true;

  return false;
}

async function generateFileWithModel(args: {
  targetPath: string;
  officialRoot: string;
  fromFiles: { file: string; spec: string }[];
  appContext?: string;

  userId?: string;
  modelId?: string;
  userToken?: string;
  requestUrl?: string;
  onLog?: (message: string) => void;
}): Promise<{ success: boolean; usedModel: boolean; contentLength: number }> {
  const { targetPath, officialRoot, fromFiles, appContext, userId, modelId, userToken, onLog } = args;
  const ext = path.extname(targetPath).toLowerCase();
  const relTarget = path.relative(officialRoot, targetPath).replace(/\\/g, '/');

  const log = (msg: string) => {
    console.log(`[postgen] ${msg}`);
    if (onLog) onLog(msg);
  };

  // ✅ Helper para agregar 'use client' si es necesario
  const addUseClientIfNeeded = (code: string, filePath: string): string => {
    const ext = path.extname(filePath).toLowerCase();
    const isReactFile = ext === '.tsx' || ext === '.jsx';
    const isPageOrLayout = filePath.includes('/app/') && (filePath.includes('/page.') || filePath.includes('/layout.'));
    
    // Solo agregar 'use client' a componentes React que no sean páginas/layouts
    if (isReactFile && !isPageOrLayout) {
      const trimmed = code.trim();
      // Verificar si ya tiene 'use client' o 'use server'
      if (!trimmed.startsWith("'use client'") && !trimmed.startsWith('"use client"') && 
          !trimmed.startsWith("'use server'") && !trimmed.startsWith('"use server"')) {
        return `'use client';\n\n${code}`;
      }
    }
    return code;
  };

  const fastTemplate = await getFastTemplateForMissingFile(relTarget);
  if (fastTemplate) {
    let content = fastTemplate.endsWith('\n') ? fastTemplate : fastTemplate + '\n';
    content = addUseClientIfNeeded(content, targetPath);
    log(`✅ Copiado template local para ${relTarget} (${content.length} caracteres)`);
    await ensureDir(path.dirname(targetPath));
    await fs.writeFile(targetPath, content, 'utf8');
    return { success: true, usedModel: false, contentLength: content.length };
  }

  log(`🔧 Generando componente faltante: ${relTarget}`);
  log(`📋 Contexto: ${fromFiles.length} archivo(s) importan este componente`);

  const mainRef = fromFiles[0];
  let importerContent = '';
  try {
    importerContent = await fs.readFile(mainRef.file, 'utf8');
  } catch {
    importerContent = '';
  }

  const effectiveModel = await getEffectiveModel(userId, modelId, userToken);
  log(`✅ Usando modelo: ${effectiveModel.model} (${effectiveModel.provider})`);

  let content = '';
  if (effectiveModel && effectiveModel.model && effectiveModel.apiKey) {
    try {
      const relativeImporter = path.relative(officialRoot, mainRef.file).replace(/\\/g, '/');
      const componentName = path.basename(relTarget, ext);

      const isComponentFile = relTarget.includes('/components/');
      const isPageFile = relTarget.includes('/app/') && (relTarget.includes('/page.') || relTarget.includes('/layout.'));
      const isHookFile = relTarget.includes('/hooks/') || componentName.startsWith('use');
      const isUtilFile = relTarget.includes('/lib/') || relTarget.includes('/utils/');

      const structure: any = {};
      const specList = fromFiles
        .map(f => `- ${path.relative(officialRoot, f.file).replace(/\\/g, '/')} importa: "${f.spec}"`)
        .join('\n');

      const systemPrompt = [
        'Eres un asistente experto en Next.js, React y TypeScript.',
        'Tu tarea es GENERAR el contenido COMPLETO y FUNCIONAL de un módulo que falta en el proyecto.',
        'IMPORTANTE: Genera código REAL y funcional, NO stubs vacíos.',
        'El código debe ser válido, compilable y coherente con cómo se usa en el proyecto.',
        'Usa shadcn/ui para componentes UI cuando sea apropiado.',
        'Debes devolver ÚNICAMENTE el contenido del archivo, sin explicaciones, sin comentarios externos y sin bloques ```.',
      ].join(' ');

      const userPrompt = [
        `Proyecto: ${appContext || 'aplicación Next.js/React con TypeScript.'}`,
        `Archivo faltante: ${relTarget}`,
        `Tipo: ${isPageFile ? 'página' : isComponentFile ? 'componente React' : isHookFile ? 'hook personalizado' : isUtilFile ? 'módulo de utilidades' : 'módulo'}`,
        '',
        'Estructura del proyecto:',
        Object.keys(structure).length > 0 ? JSON.stringify(structure, null, 2).substring(0, 2000) : '(no disponible)',
        '',
        'Se importa de la siguiente forma:',
        specList,
        '',
        `Archivo que importa este módulo (${relativeImporter}):`,
        '```tsx',
        importerContent.substring(0, 8000),
        importerContent.length > 8000 ? '\n... (contenido truncado)' : '',
        '```',
        '',
        'INSTRUCCIONES:',
        `1. Genera un ${isPageFile ? 'página' : isComponentFile ? 'componente React' : isHookFile ? 'hook personalizado' : isUtilFile ? 'módulo de utilidades' : 'módulo'} completo y funcional.`,
        `2. El ${isComponentFile ? 'componente' : 'módulo'} debe tener toda la funcionalidad necesaria basada en cómo se usa en el archivo importador Y en el contexto general de la aplicación.`,
        `3. ${isComponentFile ? 'Incluye props, estado, efectos y toda la lógica necesaria. Usa shadcn/ui para componentes UI.' : 'Incluye todas las funciones, tipos y constantes necesarias.'}`,
        '4. NO generes stubs vacíos. Genera código REAL y funcional que encaje con el resto de la aplicación.',
        '5. El código debe ser production-ready y seguir las mejores prácticas de React/Next.js.',
        '6. IMPORTANTE: Si el componente necesita importar otros módulos (iconos, hooks, utilidades), usa las importaciones correctas que ya existen en el proyecto.',
        '',
        'Genera el contenido COMPLETO del archivo ahora:',
      ].join('\n');

      // Construir URL de API correcta (solo para el log; callModelGeneric ya
      // detecta Ollama Cloud por provider+url y hace su propia rama).
      const isOllamaCloudModelLog =
        String(effectiveModel.provider || '').toLowerCase().includes('ollama') ||
        String(effectiveModel.url || '').toLowerCase().includes('ollama.com') ||
        String(effectiveModel.url || '').toLowerCase().includes('ollama.cloud');
      let apiUrl = effectiveModel.url;
      if (!apiUrl) {
        const modelName = effectiveModel.model.toLowerCase();
        if (modelName.includes('deepseek')) {
          apiUrl = 'https://api.deepseek.com/chat/completions';
        } else {
          apiUrl = 'https://api.openai.com/v1/chat/completions';
        }
      } else if (isOllamaCloudModelLog) {
        // No concatenar /chat/completions a /api/generate
        if (!apiUrl.includes('/api/generate') && !apiUrl.includes('/api/chat') && !apiUrl.includes('/chat/completions')) {
          apiUrl = `${apiUrl.replace(/\/$/, '')}/api/generate`;
        }
      } else if (!apiUrl.includes('/chat/completions')) {
        if (apiUrl.includes('deepseek.com')) {
          apiUrl = `${apiUrl.replace(/\/$/, '')}/chat/completions`;
        } else if (apiUrl.endsWith('/v1')) {
          apiUrl = `${apiUrl}/chat/completions`;
        } else if (!apiUrl.includes('/v1')) {
          apiUrl = `${apiUrl.replace(/\/$/, '')}/v1/chat/completions`;
        } else {
          apiUrl = `${apiUrl.replace(/\/$/, '')}/chat/completions`;
        }
      }

      log(`🚀 Generando ${relTarget} con modelo ${effectiveModel.model} en ${apiUrl} (timeout: 20s)...`);

      const callOnce = async (messages: any[], maxTokens: number, timeoutMs: number) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const rawContent = await callModelGeneric(
            {
              provider: effectiveModel.provider,
              model: effectiveModel.model,
              url: effectiveModel.url,
              apiKey: effectiveModel.apiKey,
            },
            messages,
            { temperature: 0.4, maxTokens, signal: controller.signal }
          );
          clearTimeout(timeoutId);

          // >>> REGISTRO DE CONSUMO (solo cuando la respuesta incluye usage; Ollama Cloud no lo incluye) <<<
          // Nota: callModelGeneric devuelve solo el contenido. El registro de consumo se omite para Ollama Cloud.

          return { ok: true as const, rawContent, finishReason: undefined };
        } catch (fetchError: any) {
          clearTimeout(timeoutId);
          const errorText = fetchError?.name === 'AbortError' ? 'AbortError' : (fetchError?.message || String(fetchError));
          return { ok: false as const, errorText };
        }
      };

      const initialMessages: any[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];

      const maxContinuationRounds = 2;
      let messages = initialMessages;
      let fullCode = '';
      let lastFinishReason: string | undefined;

      for (let round = 0; round <= maxContinuationRounds; round++) {
        const maxTokens = round === 0 ? 2500 : 1500;
        // Ollama Cloud puede tardar >1min en prompts grandes.
        // Detectar provider/url para dar margen suficiente.
        const modelProviderLower = String(effectiveModel.provider || '').toLowerCase();
        const modelUrlLower = String(effectiveModel.url || '').toLowerCase();
        const isOllamaCloudModel =
          modelProviderLower.includes('ollama cloud') || modelProviderLower.includes('ollama_cloud') || modelProviderLower.includes('ollama-cloud') ||
          modelUrlLower.includes('ollama.com') || modelUrlLower.includes('ollama.cloud');
        const timeoutMs = isOllamaCloudModel
          ? (round === 0 ? 180000 : 90000)   // 3 min / 1.5 min para Ollama Cloud
          : (round === 0 ? 60000  : 30000);  // 1 min / 30s para OpenAI/Deepseek/etc

        const res = await callOnce(messages, maxTokens, timeoutMs);
        if (!res.ok) {
          if (res.errorText === 'AbortError') {
            log(`⚠️ Timeout generando ${relTarget} (${Math.round(timeoutMs / 1000)}s)`);
          } else {
            const statusPart = 'status' in res && res.status ? String(res.status) : 'n/a';
            log(`⚠️ Error API modelo para ${relTarget}: ${statusPart} - URL: ${apiUrl} - Error: ${String(res.errorText).substring(0, 150)}`);
          }
          break;
        }

        const chunk = extractPureCode(res.rawContent);
        if (chunk) {
          fullCode = (fullCode ? `${fullCode}\n${chunk}` : chunk).trim() + '\n';
        }
        lastFinishReason = res.finishReason;

        const shouldContinue = lastFinishReason === 'length' || looksTruncatedCode(fullCode);
        if (!shouldContinue) break;

        const tail = fullCode.slice(-4000);
        messages = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
          { role: 'assistant', content: tail },
          { role: 'user', content: 'Continúa EXACTAMENTE desde el final del código anterior. NO repitas lo ya escrito. Devuelve SOLO el resto del archivo (solo código).'}
        ];
      }

      content = fullCode;
      if (content && content.length > 50) {
        // ✅ Agregar 'use client' si es necesario
        content = addUseClientIfNeeded(content, targetPath);
        
        // ✅ Validar y corregir export del Footer si es necesario
        if (relTarget.includes('footer') || relTarget.includes('Footer')) {
          // Verificar si tiene export default correcto
          const hasDefaultExport = /export\s+default\s+(Footer|function\s+Footer)/.test(content);
          const hasFooterComponent = /(const|function)\s+Footer\s*=/.test(content) || /export\s+default\s+function\s+Footer/.test(content);
          
          if (hasFooterComponent && !hasDefaultExport) {
            // Si tiene el componente Footer pero no tiene export default, agregarlo
            if (!content.includes('export default')) {
              // Buscar la definición del componente Footer
              const footerMatch = content.match(/((const|function)\s+Footer\s*[={][^}]*})/s);
              if (footerMatch) {
                // Agregar export default al final si no existe
                if (!content.trim().endsWith('export default Footer') && !content.includes('export default Footer')) {
                  content = content.trim() + '\n\nexport default Footer;';
                  log('✅ Agregado export default Footer al componente generado');
                }
              }
            }
          }
        }
        
        log(`✅ Componente generado: ${relTarget} (${content.length} caracteres)`);
        await ensureDir(path.dirname(targetPath));
        await fs.writeFile(targetPath, content, 'utf8');
        return { success: true, usedModel: true, contentLength: content.length };
      }

      log(`⚠️ Contenido muy corto para ${relTarget} (${content.length} caracteres), usando fallback`);
      content = '';
    } catch (e: any) {
      log(`⚠️ Error en generación de ${relTarget}: ${e?.message || String(e)}`);
    }
  } else {
    log(`⚠️ No hay modelo configurado para ${relTarget} (modelo: ${effectiveModel?.model || 'none'}, apiKey: ${effectiveModel?.apiKey ? 'presente' : 'ausente'})`);
  }

  // ✅ Último fallback: crear stub mejorado con estructura básica
  if (!content || content.trim().length < 50) {
    const fileBaseName = path.basename(targetPath, ext);
    const exportName = fileBaseName.replace(/[^a-zA-Z0-9_$]/g, '') || 'GeneratedModule';
    const isComponentFallback = relTarget.includes('/components/');
    const isPageFallback = relTarget.includes('/app/') && (relTarget.includes('/page.') || relTarget.includes('/layout.'));
    const isHookFallback = relTarget.includes('/hooks/') || fileBaseName.startsWith('use');

    if (ext === '.tsx' || ext === '.jsx') {
      // ✅ Template especial para input.tsx (shadcn/ui)
      if (relTarget.includes('/ui/input') || relTarget.includes('/ui/Input')) {
        content = `'use client';\n\nimport * as React from 'react';\nimport { cn } from '@/lib/utils';\n\nexport interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}\n\nconst Input = React.forwardRef<HTMLInputElement, InputProps>(\n  ({ className, type, ...props }, ref) => {\n    return (\n      <input\n        type={type}\n        className={cn(\n          'flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',\n          className\n        )}\n        ref={ref}\n        {...props}\n      />\n    );\n  }\n);\nInput.displayName = 'Input';\n\nexport { Input };\nexport default Input;\n`;
      } else if (relTarget.includes('footer') || relTarget.includes('Footer')) {
        content = `'use client';\n\nimport React from 'react';\n\nexport default function Footer() {\n  const year = new Date().getFullYear();\n  const appName = process.env.NEXT_PUBLIC_APP_NAME || 'App';\n  \n  return (\n    <footer className="fixed bottom-0 left-0 right-0 bg-gray-900/95 backdrop-blur-sm border-t border-gray-800 py-4 z-50">\n      <div className="container mx-auto px-4">\n        <p className="text-center text-sm text-gray-400">\n          © {year} {appName}. Todos los derechos reservados. Aplicación creada con www.zeus-ia.com\n        </p>\n      </div>\n    </footer>\n  );\n}\n`;
      } else if (isPageFallback) {
        content = `import React from 'react';\n\nexport default function ${exportName}() {\n  return (\n    <div className=\"container mx-auto p-4\">\n      <h1>${exportName}</h1>\n      <p>Página generada automáticamente. Por favor, implementa la funcionalidad necesaria.</p>\n    </div>\n  );\n}\n`;
      } else if (isComponentFallback) {
        content = `'use client';\n\nimport React from 'react';\n\ninterface ${exportName}Props {\n  // Agrega las props necesarias aquí\n}\n\nexport default function ${exportName}(props: ${exportName}Props) {\n  return (\n    <div>\n      {/* Implementa el componente aquí */}\n    </div>\n  );\n}\n`;
      } else {
        content = `'use client';\n\nimport React from 'react';\n\nexport default function ${exportName}() {\n  return null;\n}\n`;
      }
    } else if (isHookFallback && (ext === '.ts' || ext === '.js')) {
      content = `export function ${exportName}() {\n  // Implementa el hook aquí\n  return {};\n}\n`;
    } else {
      content = `export default {};\n`;
    }
    log(`⚠️ Usando stub mejorado para ${relTarget} (generación con modelo falló o no disponible)`);
  }

  // ✅ Agregar 'use client' si es necesario (para el fallback también, excepto Footer que ya lo tiene)
  if (!relTarget.includes('footer') && !relTarget.includes('Footer')) {
    content = addUseClientIfNeeded(content, targetPath);
  }

  await ensureDir(path.dirname(targetPath));
  await fs.writeFile(targetPath, content, 'utf8');
  return { success: true, usedModel: false, contentLength: content.length };
}

// ✅ Función para crear respuesta con streaming
function createStreamingResponse(
  officialRoot: string,
  projectId?: string,
  userId?: string,
  modelId?: string,
  userToken?: string,
  req?: Request,
  filesToScan?: string[]
) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'start', message: 'Iniciando revisión de importaciones...' })}\n\n`));

        const appContext = await detectAppContext(officialRoot);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'info', message: 'Contexto: ' + appContext.substring(0, 120) + '...' })}\n\n`));

        // ✅ Escanear archivos existentes para blacklist dinámica
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'info', message: 'Escaneando archivos existentes...' })}

`));
        const existingFiles = await scanExistingFiles(officialRoot);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'info', message: 'Archivos existentes: ' + existingFiles.size })}

`));

        const allCreated: any[] = [];
        const allCreatedContents: Record<string, string> = {};
        const allGenerationLogs: { file: any; status: string; message: string; }[] = [];
        const MAX_ROUNDS = 5;

        for (let round = 1; round <= MAX_ROUNDS; round++) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'round', round, maxRounds: MAX_ROUNDS, message: '--- Ronda ' + round + '/' + MAX_ROUNDS + ' ---' })}\n\n`));

          const sourceFiles = await getSourceFilesToScan(officialRoot, undefined);
          const missingTargets = new Map();
          const importRegex = /import\s+[^'";]+['"]([^'";]+)['"];?/g;
          const importRegex2 = /import\(['"]([^'";]+)['"]\)/g;
          const importRegex3 = /import\s+(?:(?:\w+\s+from\s+)?['"]([^'"]+)['"]|\(['"]([^'"]+)['"]\))/g;

          for (const file of sourceFiles) {
            let fileContent;
            try { fileContent = await fs.readFile(file, 'utf8'); } catch { continue; }
            const check = async (spec: string) => {
              if (!spec || spec.trim() === '') return;
              if (isRelativeImport(spec)) {
                const resolved = await resolveImport(file, spec);
                if (!resolved) {
                  const baseDir = path.dirname(file);
                  const candidateBase = path.resolve(baseDir, spec);
                  const target = normalizeTargetPath(candidateBase);
                  if (existingFiles.has(target)) return;
                  if (await fileExists(target)) return;
                  let info = missingTargets.get(target);
                  if (!info) { info = { fromFiles: [] }; missingTargets.set(target, info); }
                  info.fromFiles.push({ file, spec });
                }
                return;
              }
              if (isAliasImport(spec)) {
                const withoutAlias = spec.replace(/^@\//, '');
                const candidateBase = path.resolve(officialRoot, withoutAlias);
                const target = normalizeTargetPath(candidateBase);
                if (existingFiles.has(target)) return;
                if (await fileExists(target)) return;
                let info = missingTargets.get(target);
                if (!info) { info = { fromFiles: [] }; missingTargets.set(target, info); }
                info.fromFiles.push({ file, spec });
              }
            };
            let m;
            importRegex.lastIndex = 0;
            while ((m = importRegex.exec(fileContent)) !== null) { await check(m[1]); }
            importRegex2.lastIndex = 0;
            while ((m = importRegex2.exec(fileContent)) !== null) { await check(m[1]); }
            importRegex3.lastIndex = 0;
            while ((m = importRegex3.exec(fileContent)) !== null) { await check(m[1]); }
          }

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'found', round, total: missingTargets.size, message: 'Ronda ' + round + ': ' + missingTargets.size + ' faltantes' })}\n\n`));

          if (missingTargets.size === 0) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'info', round, message: '✅ Ronda ' + round + ': No hay más importaciones faltantes.' })}\n\n`));
            break;
          }

          const filesToGenerate = [];
          for (const [target, info] of missingTargets.entries()) {
            if (await fileExists(target)) {
              const relativePath = path.relative(officialRoot, target).replace(/\\/g, '/');
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'skipped', round, file: relativePath, reason: 'exists', message: '⏭️ ' + relativePath + ' ya existe' })}\n\n`));
              continue;
            }
            const relativePath = path.relative(officialRoot, target).replace(/\\/g, '/');
            const isBlacklisted = COMMON_FILES_BLACKLIST.some(blacklisted => {
              const normalizedRel = relativePath.replace(/\.(tsx?|jsx?|css|scss)$/, '');
              const normalizedBlack = blacklisted.replace(/\.(tsx?|jsx?|css|scss)$/, '');
              return normalizedRel === normalizedBlack || normalizedRel.endsWith('/' + normalizedBlack);
            });
            if (isBlacklisted) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'skipped', round, file: relativePath, reason: 'blacklist', message: '⏭️ ' + relativePath + ' en blacklist' })}\n\n`));
              continue;
            }
            filesToGenerate.push({ target, info, relativePath });
          }

          if (filesToGenerate.length === 0) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'info', round, message: 'Ronda ' + round + ': Todos los faltantes ya existen o están en blacklist.' })}\n\n`));
            break;
          }

          const hasMore = filesToGenerate.length > MAX_COMPONENTS_PER_REQUEST;
          const limitedToGenerate = filesToGenerate.slice(0, MAX_COMPONENTS_PER_REQUEST);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'ready', round, total: limitedToGenerate.length, totalDetected: filesToGenerate.length, hasMore, message: 'Ronda ' + round + ': generar ' + limitedToGenerate.length })}\n\n`));

          const CONCURRENCY_LIMIT = 1;
          const roundCreated = [];

          const processBatch = async (batch: { target: any; info: any; relativePath: any; }[]) => {
            return Promise.all(batch.map(async ({ target, info, relativePath }) => {
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'generating', round, file: relativePath, message: 'Ronda ' + round + ': Generando ' + relativePath + '...' })}\n\n`));
                const heartbeat = setInterval(() => { try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'ping', round, file: relativePath, message: '...' })}\n\n`)); } catch {} }, 5000);
                let result;
                try {
                  result = await generateFileWithModel({ targetPath: target, officialRoot, fromFiles: info.fromFiles, appContext, userId, modelId, userToken, requestUrl: req?.url, onLog: (msg) => { allGenerationLogs.push({ file: relativePath, status: 'info', message: msg }); } });
                } finally { clearInterval(heartbeat); }
                allGenerationLogs.push({ file: relativePath, status: result.usedModel ? 'success' : 'fallback', message: result.usedModel ? 'Generado con modelo (' + result.contentLength + ' chars)' : 'Stub (' + result.contentLength + ' chars)' });
                roundCreated.push(relativePath);
                allCreated.push(relativePath);
                try { const content = await fs.readFile(target, 'utf8'); allCreatedContents[relativePath] = content; } catch {}
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'generated', round, file: relativePath, usedModel: result.usedModel, contentLength: result.contentLength, content: allCreatedContents[relativePath], message: '✅ Ronda ' + round + ': ' + relativePath + ' generado' })}\n\n`));
              } catch (e) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', round, file: relativePath, message: 'Error ' + relativePath + ': ' + (e instanceof Error ? e.message : String(e)) })}\n\n`));
              }
            }));
          };

          for (let i = 0; i < limitedToGenerate.length; i += CONCURRENCY_LIMIT) {
            await processBatch(limitedToGenerate.slice(i, i + CONCURRENCY_LIMIT));
          }

          if (roundCreated.length === 0) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'info', round, message: 'Ronda ' + round + ': No se pudo crear ningún archivo.' })}\n\n`));
            break;
          }

          await new Promise(r => setTimeout(r, 200));
        }

        let archiveUpdated = false;
        if (projectId && allCreated.length > 0) {
          try {
            const origin = req?.url ? new URL(req.url).origin : '';
            if (origin) {
              const fileUpdates = allCreated.map((relPath) => ({ filePath: relPath, content: allCreatedContents[relPath] })).filter((u) => typeof u.content === 'string');
              const res = await fetch(origin + '/api/update-zip-from-memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, userToken, fileUpdates }) });
              archiveUpdated = res.ok;
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.warn('[postgen] Failed to update archive:', errorMessage);
          }
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'complete', createdFiles: allCreated, createdContents: allCreatedContents, archiveUpdated, totalCreated: allCreated.length, generationLogs: allGenerationLogs })}\n\n`));
        controller.close();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: errorMessage })}\n\n`));
        controller.close();
      }
    }
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

async function collectSourceFiles(root: string, acc: string[], dir: string = root) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.git')) continue;
      await collectSourceFiles(root, acc, fullPath);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (SOURCE_EXTS.includes(ext)) {
        acc.push(fullPath);
      }
    }
  }
}

async function getSourceFilesToScan(officialRoot: string, filesToScan?: string[]): Promise<string[]> {
  if (!filesToScan || !Array.isArray(filesToScan) || filesToScan.length === 0) {
    const sourceFiles: string[] = [];
    await collectSourceFiles(officialRoot, sourceFiles);
    return sourceFiles;
  }

  const resolved: string[] = [];
  for (const rel of filesToScan) {
    if (!rel || typeof rel !== 'string') continue;
    const normalized = rel.replace(/\\/g, '/').replace(/^\/+/, '');
    const fullPath = path.join(officialRoot, normalized);
    try {
      const stat = await fs.stat(fullPath);
      if (!stat.isFile()) continue;
      const ext = path.extname(fullPath).toLowerCase();
      if (!SOURCE_EXTS.includes(ext)) continue;
      resolved.push(fullPath);
    } catch {
      continue;
    }
  }
  return resolved;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { projectRoot, projectId, userToken, userId, modelId, stream, filesToScan } = body as {
      projectRoot?: string;
      projectId?: string;
      userToken?: string;
      userId?: string;
      modelId?: string;
      stream?: boolean;
      filesToScan?: string[];
    };

    if (!projectRoot && !projectId) {
      return NextResponse.json({ error: 'Se requiere projectRoot o projectId' }, { status: 400 });
    }

    const officialRoot = await getProjectRoot(projectId || undefined, projectRoot || '.');
    
    // ✅ Si se solicita streaming, usar respuesta con streaming
    if (stream) {
      return createStreamingResponse(officialRoot, projectId, userId, modelId, userToken, req, filesToScan);
    }

    const sourceFiles = await getSourceFilesToScan(officialRoot, filesToScan);

    // ✅ Escanear archivos existentes para blacklist dinámica
    const existingFiles = await scanExistingFiles(officialRoot);
    console.log(`[postgen] Archivos existentes escaneados: ${existingFiles.size}`);

    // Map de archivo objetivo -> contexto de imports que lo referencian
    const missingTargets = new Map<string, { fromFiles: { file: string; spec: string }[] }>();

    // Regex exactamente iguales al archivo B
    const importRegex = /import\s+[^'";]+['"]([^'";]+)['"];?/g;
    const importRegex2 = /import\(['"]([^'";]+)['"]\)/g;
    const importRegex3 = /import\s+(?:(?:\w+\s+from\s+)?['"]([^'"]+)['"]|\(['"]([^'"]+)['"]\))/g;

    for (const file of sourceFiles) {
      let content: string;
      try {
        content = await fs.readFile(file, 'utf8');
      } catch {
        continue;
      }

      const relForLog = path.relative(officialRoot, file);
      
      // Log para debugging: mostrar si el archivo tiene imports
      const hasImports = /import\s+.*from\s+['"]/.test(content);
      if (hasImports) {
        console.log(`[postgen] 📄 Analizando archivo con imports: ${relForLog}`);
      }

      const check = async (spec: string) => {
        if (!spec || spec.trim() === '') return;

        if (isRelativeImport(spec)) {
          const resolved = await resolveImport(file, spec);
          if (!resolved) {
            const baseDir = path.dirname(file);
            const candidateBase = path.resolve(baseDir, spec);
            const target = normalizeTargetPath(candidateBase);
            if (existingFiles.has(target)) return;
            if (await fileExists(target)) return;
            let info = missingTargets.get(target);
            if (!info) {
              info = { fromFiles: [] };
              missingTargets.set(target, info);
            }
            info.fromFiles.push({ file, spec });
          }
          return;
        }

        if (isAliasImport(spec)) {
          const withoutAlias = spec.replace(/^@\//, '');
          const candidateBase = path.resolve(officialRoot, withoutAlias);
          const target = normalizeTargetPath(candidateBase);
          if (existingFiles.has(target)) return;
          if (await fileExists(target)) return;
          let info = missingTargets.get(target);
          if (!info) {
            info = { fromFiles: [] };
            missingTargets.set(target, info);
            console.log(`[postgen] 📝 Nuevo componente faltante detectado: ${path.relative(officialRoot, target)} (importado desde ${path.relative(officialRoot, file)})`);
          }
          info.fromFiles.push({ file, spec });
        }
      };

      let m: RegExpExecArray | null;
      
      // Procesar exactamente igual que el archivo B
      importRegex.lastIndex = 0;
      while ((m = importRegex.exec(content)) !== null) {
        await check(m[1]);
      }
      
      importRegex2.lastIndex = 0;
      while ((m = importRegex2.exec(content)) !== null) {
        await check(m[1]);
      }
      
      importRegex3.lastIndex = 0;
      while ((m = importRegex3.exec(content)) !== null) {
        await check(m[1]);
      }
    }

    const created: string[] = [];
    const createdContents: Record<string, string> = {};
    const generationLogs: Array<{ file: string; status: string; message?: string }> = [];
    
    // Filtrar y preparar archivos a generar
    const filesToGenerate: Array<{ target: string; info: { fromFiles: { file: string; spec: string }[] }; relativePath: string }> = [];
    
    for (const [target, info] of missingTargets.entries()) {
      // ✅ Check if file already exists
      const exists = await fileExists(target);
      if (exists) {
        const relativePath = path.relative(officialRoot, target).replace(/\\/g, '/');
        console.log(`[postgen] ⏭️ Archivo ya existe, saltando: ${relativePath}`);
        continue;
      }
      
      // ✅ Check if file is in blacklist
      const relativePath = path.relative(officialRoot, target).replace(/\\/g, '/');
      const isBlacklisted = COMMON_FILES_BLACKLIST.some(blacklisted => {
        const normalizedRel = relativePath.replace(/\.(tsx?|jsx?|css|scss)$/, '');
        const normalizedBlack = blacklisted.replace(/\.(tsx?|jsx?|css|scss)$/, '');
        return normalizedRel === normalizedBlack || normalizedRel.endsWith('/' + normalizedBlack);
      });
      
      if (isBlacklisted) {
        console.log(`[postgen] ⏭️ Archivo en blacklist, saltando: ${relativePath}`);
        continue;
      }
      
      filesToGenerate.push({ target, info, relativePath });
    }
    
    const hasMore = filesToGenerate.length > MAX_COMPONENTS_PER_REQUEST;
    const limitedToGenerate = filesToGenerate.slice(0, MAX_COMPONENTS_PER_REQUEST);

    // ✅ Procesar en paralelo con límite de concurrencia (3 a la vez) para evitar timeouts
    const CONCURRENCY_LIMIT = 1;
    const processBatch = async (batch: typeof filesToGenerate) => {
      return Promise.all(batch.map(async ({ target, info, relativePath }) => {
        try {
          const result = await generateFileWithModel({
            targetPath: target,
            officialRoot,
            fromFiles: info.fromFiles,
            userId,
            modelId,
            userToken,
            requestUrl: req.url,
            onLog: (msg) => {
              generationLogs.push({ file: relativePath, status: 'info', message: msg });
            },
          });
          
          generationLogs.push({
            file: relativePath,
            status: result.usedModel ? 'success' : 'fallback',
            message: result.usedModel 
              ? `Generado con modelo (${result.contentLength} caracteres)`
              : `Usando stub mejorado (${result.contentLength} caracteres)`,
          });
          
          created.push(relativePath);

          try {
            const content = await fs.readFile(target, 'utf8');
            createdContents[relativePath] = content;
          } catch (readErr) {
            console.warn('[postgen] Could not read created file:', target, readErr);
          }
        } catch (e) {
          console.warn('[postgen] Failed to generate file for', target, e);
        }
      }));
    };
    
    // Procesar en lotes de 3
    for (let i = 0; i < limitedToGenerate.length; i += CONCURRENCY_LIMIT) {
      const batch = limitedToGenerate.slice(i, i + CONCURRENCY_LIMIT);
      await processBatch(batch);
    }

    // Actualizar ZIP en PocketBase si hemos creado algo
    let archiveUpdated = false;
    if (projectId && created.length > 0) {
      try {
        const origin = new URL(req.url).origin;
        const fileUpdates = created
          .map((relPath) => ({ filePath: relPath, content: createdContents[relPath] }))
          .filter((u) => typeof u.content === 'string');

        const res = await fetch(`${origin}/api/update-zip-from-memory`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, userToken, fileUpdates })
        });
        archiveUpdated = res.ok;
      } catch (e) {
        console.warn('[postgen] Failed to update archive after creating stubs:', e);
      }
    }

    return NextResponse.json({
      createdFiles: created,
      createdContents,
      archiveUpdated,
      hasMore,
      totalFound: missingTargets.size,
      totalCreated: created.length,
      generationLogs, // ✅ Incluir logs de generación para debugging
    });
  } catch (e: any) {
    console.error('[postgen] Error fixing missing imports:', e);
    const errorMessage = e?.message || 'Unknown error';
    const errorStack = e?.stack ? e.stack.substring(0, 500) : '';
    console.error('[postgen] Error stack:', errorStack);
    return NextResponse.json({
      error: errorMessage,
      stack: process.env.NODE_ENV === 'development' ? errorStack : undefined,
    }, { status: 500 });
  }
}