import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { flushSync } from 'react-dom';
import { loadAndApplyTheme } from '../../lib/theme-engine';
import ThemeEditorModal from './ThemeEditorModal';
import { filterBrowserFilesForContext } from '../../src/lib/generateApiContextFilter';
import {
  getZeusApiBase,
  getZeusPocketBaseProfile,
  getZeusPocketBaseRequestHeaders,
  isZeusCentralPanelInVsCode,
  requestModelConfigFromExtension,
  requestPocketBaseSessionFromExtension,
  requestProjectByIdFromExtension,
  requestProjectsFromExtension
} from './zeusApi';
import { ZeusMonacoPane, getMonacoCopyValue } from './ZeusMonacoPane';
import { buildOpenApiPreviewPayload } from '../../src/lib/sanitizeGeneratedApiCode';
import { buildSwaggerStandaloneHtml } from '../../src/lib/swaggerPreviewStandalone';
import { downloadZeusProjectZip } from './zeusProjectZip';
const zeusModalIconPng = '../../resources/zeus-icon.png';
import { 
  Code, 
  Terminal, 
  Rocket, 
  Settings,
  ChevronRight, 
  ArrowRight, 
  Plus, 
  FileText, 
  HelpCircle, 
  X, 
  Upload,
  FolderOpen,
  Copy,
  Download, 
  Play,
  Sparkles,
  Wand2,
  Server,
  Layers2,
  Workflow,
  Cpu,
  User,
  Loader2,
  Maximize2,
  Minimize2
} from 'lucide-react';
// --- Types ---
type View = 'home' | 'editor';

interface Project {
  id: string;
  name: string;
  status: 'Saludable' | 'Pendiente';
  /** Número de endpoints definidos en el campo JSON `endpoints` del registro PocketBase */
  endpoints: number;
  lastDeployed: string;
}

const PROJECT_CARD_ICONS: ComponentType<{ className?: string; size?: number; strokeWidth?: number }>[] = [
  Server,
  Layers2,
  Workflow,
  Cpu
];

function pickProjectCardIcon(id: string): ComponentType<{ className?: string; size?: number; strokeWidth?: number }> {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i)) % PROJECT_CARD_ICONS.length;
  return PROJECT_CARD_ICONS[h] ?? Server;
}

function countEndpointsInPbRecord(raw: Record<string, unknown>): number {
  try {
    const ep = raw.endpoints;
    if (Array.isArray(ep)) return ep.length;
    if (ep !== null && typeof ep === 'object') return 1;
    if (typeof ep === 'string' && ep.trim()) {
      const p = JSON.parse(ep);
      if (Array.isArray(p)) return p.length;
      if (p !== null && typeof p === 'object') return 1;
    }
  } catch {
    /* vacío o no JSON */
  }
  return 0;
}

function endpointsCountLabel(n: number): string {
  if (n <= 0) return 'Sin rutas';
  if (n === 1) return '1 endpoint';
  return `${n} endpoints`;
}

function sortPbRecordsNewestFirst(data: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...data].sort((a, b) => {
    const ta = new Date(String(a.updated ?? a.created ?? 0)).getTime();
    const tb = new Date(String(b.updated ?? b.created ?? 0)).getTime();
    return tb - ta;
  });
}

// --- Components ---

const Sidebar = ({
  currentView,
  onOpenEditorBlank,
  onNewProject,
  onOpenSettings,
  userName,
  userEmail
}: {
  currentView: View;
  /** Abre el editor sin proyecto de PocketBase (vista demo). */
  onOpenEditorBlank: () => void;
  onNewProject: () => void;
  onOpenSettings: () => void;
  userName: string | null;
  userEmail: string | null;
}) => {
  const displayName =
    userName?.trim() ||
    (userEmail?.includes('@') ? userEmail.split('@')[0] : null) ||
    null;
  const avatarLetter = displayName
    ? displayName.slice(0, 1).toUpperCase()
    : userEmail?.trim()
      ? userEmail.trim().slice(0, 1).toUpperCase()
      : null;
  const isLoggedIn = !!(userName?.trim() || userEmail?.trim());

  return (
  <aside className="hidden 2xl:flex flex-col h-screen fixed left-0 top-0 pt-4 w-44 border-r border-secondary/10 bg-surface-container-low shadow-md z-40 text-[0.85rem]">
    <div className="px-3 py-4">
      <div className="flex items-center gap-2 mb-6 min-w-0">
        <div className="w-8 h-8 shrink-0 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden border border-primary/30 text-primary text-xs font-bold font-headline">
          {avatarLetter ? (
            <span aria-hidden>{avatarLetter}</span>
          ) : (
            <User size={16} strokeWidth={2} className="text-on-surface-variant" aria-hidden />
          )}
        </div>
        <div className="min-w-0">
          <h5 className="text-xs font-bold font-headline truncate">
            {isLoggedIn ? displayName || 'Usuario' : 'Sin sesión'}
          </h5>
          <p
            className="text-[9px] text-on-surface-variant uppercase tracking-tighter truncate"
            title={userEmail ?? undefined}
          >
            {isLoggedIn
              ? userEmail?.trim() || 'Cuenta Zeus'
              : 'Inicia sesión en Zeus'}
          </p>
        </div>
      </div>

      <nav className="space-y-1">
        {[
          { id: 'code', label: 'Code', icon: Code, active: currentView === 'editor' },
          { id: 'review', label: 'Review', icon: Terminal, active: false },
          { id: 'deploy', label: 'Deploy', icon: Rocket, active: false },
          { id: 'settings', label: 'Settings', icon: Settings, active: false },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              if (item.id === 'code') onOpenEditorBlank();
              if (item.id === 'settings') onOpenSettings();
            }}
            className={`w-full flex items-center gap-2 px-2 py-2 font-headline text-xs transition-all duration-200 hover:translate-x-0.5 ${
              item.active 
                ? 'text-secondary bg-surface-container-high border-l-4 border-secondary font-bold' 
                : 'text-on-surface-variant hover:text-primary hover:bg-surface-container-high/50'
            }`}
          >
            <item.icon size={15} />
            {item.label}
          </button>
        ))}
      </nav>
    </div>

    <div className="mt-auto p-3 space-y-0.5">
      <button 
        onClick={onNewProject}
        className="w-full mb-3 py-2 bg-primary text-on-primary rounded-full font-bold text-xs hover:bg-primary/80 transition-all shadow active:scale-95"
      >
        New Project
      </button>
      <a href="#" className="flex items-center gap-2 text-on-surface-variant hover:text-primary px-2 py-1.5 transition-colors font-headline text-[10px]">
        <FileText size={14} />
        Docs
      </a>
      <a href="#" className="flex items-center gap-2 text-on-surface-variant hover:text-primary px-2 py-1.5 transition-colors font-headline text-[10px]">
        <HelpCircle size={14} />
        Help
      </a>
    </div>
  </aside>
  );
};

type GenerateApiSavedPayload = {
  projectId: string;
  title: string;
};

function NewApiModal({
  isOpen,
  onClose,
  onSuccess
}: {
  isOpen: boolean;
  onClose: () => void;
  /** Solo se llama cuando la generación se guardó en PocketBase y hay `projectId`. */
  onSuccess?: (payload: GenerateApiSavedPayload) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  /** Sesión + modelo desde la extensión (antes del fetch de generar). */
  const [generatePreparing, setGeneratePreparing] = useState(false);
  const [improveDescLoading, setImproveDescLoading] = useState(false);
  const [folderScanning, setFolderScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** Hay que copiar los `File` antes de `input.value = ''`; si no, el FileList queda vacío al ejecutar el timeout. */
  const onFolderPicked = (picked: File[]) => {
    if (!picked.length) return;
    const t0 = performance.now();
    flushSync(() => {
      setFolderScanning(true);
    });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setFiles(filterBrowserFilesForContext(picked, 25));
        const elapsed = performance.now() - t0;
        const minVisibleMs = 320;
        if (elapsed >= minVisibleMs) {
          setFolderScanning(false);
        } else {
          window.setTimeout(() => setFolderScanning(false), minVisibleMs - elapsed);
        }
      });
    });
  };

  const handleImproveDescription = async () => {
    setError(null);
    const draft = description.trim();
    if (!draft) {
      setError('Escribe al menos un borrador en la descripción para poder mejorarlo con el modelo.');
      return;
    }
    setImproveDescLoading(true);
    try {
      await requestPocketBaseSessionFromExtension();
      const cfg = await requestModelConfigFromExtension();
      const isLocal = cfg?.type === 'local' || cfg?.type === 'LM Studio' || cfg?.provider === 'LM Studio' || cfg?.provider === 'local';
      
      if ((!isLocal && !cfg?.apiKey?.trim()) || !cfg?.modelId) {
        setError(
          'Selecciona un modelo en el chat de Zeus con API key en PocketBase para usar la varita mágica.'
        );
        return;
      }
      const base = getZeusApiBase();
      const res = await fetch(`${base}/api/generate-api-description`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getZeusPocketBaseRequestHeaders()
        },
        body: JSON.stringify({
          userDescription: draft,
          modelId: cfg.modelId,
          appType: 'API REST'
        })
      });
      const data = (await res.json().catch(() => ({}))) as {
        prompt?: string;
        error?: string;
        details?: string;
      };
      if (!res.ok) {
        const msg =
          typeof data.error === 'string'
            ? data.details
              ? `${data.error}: ${data.details}`
              : data.error
            : `Error ${res.status}`;
        throw new Error(msg);
      }
      if (typeof data.prompt === 'string' && data.prompt.trim()) {
        setDescription(data.prompt.trim());
      } else {
        throw new Error('El modelo no devolvió texto mejorado.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al mejorar la descripción');
    } finally {
      setImproveDescLoading(false);
    }
  };

  const handleGenerate = async () => {
    setError(null);
    setGeneratePreparing(true);
    try {
      await requestPocketBaseSessionFromExtension();
      const cfg = await requestModelConfigFromExtension();
      
      const isLocal = cfg?.type === 'local' || cfg?.type === 'LM Studio' || cfg?.provider === 'LM Studio' || cfg?.provider === 'local';
      
      if (!isLocal && !cfg?.apiKey?.trim()) {
        setError(
          'Selecciona un modelo en el chat de Zeus (barra lateral) y comprueba que tiene API key en PocketBase. Si abres el panel fuera de VS Code, define VITE o __ZEUS_MODEL_CONFIG__ solo para desarrollo.'
        );
        return;
      }
      if (!title.trim() || !description.trim()) {
        setError('Título y descripción son obligatorios.');
        return;
      }

      const formData = new FormData();
      formData.append('title', title.trim());
      formData.append('description', description.trim());
      formData.append('modelType', 'typescript');
      files.forEach((f) => formData.append('files', f));

      const modelConfig = {
        apiKey: cfg?.apiKey || '',
        model: cfg?.model || 'deepseek-chat',
        temperature: cfg?.temperature ?? 0.7,
        maxTokens: cfg?.maxTokens ?? 8192,
        type: cfg?.type || '',
        provider: cfg?.provider || '',
        ...(cfg?.apiBaseUrl ? { apiBaseUrl: cfg.apiBaseUrl } : {})
      };

      setLoading(true);
      const base = getZeusApiBase();
      const res = await fetch(`${base}/api/generate-api/generate`, {
        method: 'POST',
        headers: {
          'x-model-config': JSON.stringify(modelConfig),
          ...getZeusPocketBaseRequestHeaders()
        },
        body: formData
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : `Error ${res.status}`);
      }
      const saved = data.saved === true;
      const projectId =
        typeof data.id === 'string' && data.id.trim() ? data.id.trim() : null;
      if (!saved || !projectId) {
        const msg =
          typeof data.saveError === 'string' && data.saveError.trim()
            ? data.saveError.trim()
            : 'La API se generó pero no se pudo guardar en PocketBase. Comprueba que estés autenticado en Zeus (sesión PocketBase) y las reglas de la colección projects_api.';
        setError(msg);
        return;
      }
      const projectTitle =
        typeof data.title === 'string' && data.title.trim()
          ? data.title.trim()
          : title.trim();
      onSuccess?.({ projectId, title: projectTitle });
      setTitle('');
      setDescription('');
      setFiles([]);
      onClose();
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const isNetwork =
        raw === 'Failed to fetch' ||
        raw.includes('NetworkError') ||
        raw.includes('Load failed');
      setError(
        isNetwork
          ? `${raw}. Suele ser timeout o corte de conexión mientras el modelo genera (puede tardar varios minutos). Reinicia el servidor API con el último código (api.js) o reduce max tokens en el modelo. Si el servidor llegó a terminar, revisa en PocketBase si el proyecto se creó.`
          : raw
      );
    } finally {
      setLoading(false);
      setGeneratePreparing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-2">
      <button
        type="button"
        aria-label="Cerrar"
        onClick={onClose}
        className="absolute inset-0 z-0 bg-surface-lowest/85 backdrop-blur-sm border-0 cursor-default"
      />
      <div
        className="relative z-10 w-full max-w-lg max-h-[92vh] bg-surface-container-low border border-secondary rounded-lg shadow-lg flex flex-col overflow-hidden text-[0.95rem]"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="zeus-new-api-title"
      >
        <div className="relative border-b border-outline-variant/10 bg-surface-container pt-7 pb-5 px-4 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="absolute top-3 right-3 z-10 text-on-surface-variant hover:text-secondary p-1 rounded-md hover:bg-surface-container-high/80"
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
          <div className="flex flex-col items-center text-center gap-2.5">
            <img
              src={zeusModalIconPng}
              alt="Zeus"
              width={64}
              height={64}
              className="w-16 h-16 object-contain drop-shadow-[0_0_14px_rgba(0,227,253,0.35)]"
            />
            <h2 id="zeus-new-api-title" className="text-sm sm:text-base font-headline font-bold text-[#fc8828] tracking-tight">
              Api Generator Zeus
            </h2>
          </div>
        </div>

        <div className="p-3 space-y-3 overflow-y-hidden">
          {error ? (
            <p className="text-[10px] text-error font-medium bg-error/10 border border-error/20 rounded px-2 py-1.5">{error}</p>
          ) : null}

          <div className="space-y-1">
            <label className="text-[10px] font-headline font-medium text-secondary uppercase tracking-wide">Título del Proyecto</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ej. Sistema de autenticación"
              className="w-full bg-surface-container-high border-none rounded px-2 py-1.5 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:ring-1 focus:ring-secondary/50 outline-none"
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <label className="text-[10px] font-headline font-medium text-secondary uppercase tracking-wide">
                Descripción
              </label>
              <button
                type="button"
                onClick={() => void handleImproveDescription()}
                disabled={loading || improveDescLoading || generatePreparing || folderScanning}
                title={
                  improveDescLoading
                    ? 'Mejorando…'
                    : 'Enviar el borrador al modelo seleccionado en Zeus y reemplazar por una versión mejorada'
                }
                className={`inline-flex items-center justify-center gap-0.5 shrink-0 rounded-full px-1.5 py-1 border cursor-pointer disabled:opacity-40 disabled:pointer-events-none transition-colors ${
                  improveDescLoading
                    ? 'animate-zeus-wand-thinking text-on-secondary border-secondary shadow-lg'
                    : 'text-secondary bg-secondary/10 hover:bg-secondary/25 active:scale-95 border-secondary/40'
                }`}
              >
                {improveDescLoading ? (
                  <Loader2 size={11} strokeWidth={2.5} className="animate-spin shrink-0" aria-hidden />
                ) : null}
                <Wand2 size={12} strokeWidth={2.25} className="shrink-0" aria-hidden />
              </button>
            </div>
            <textarea
              rows={12}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              spellCheck={false}
              placeholder="Describe con todo el detalle que necesites (puedes pegar textos muy largos): recursos, reglas, auth, ejemplos JSON, errores, etc."
              className="modal-desc-textarea-scroll w-full min-h-[min(35vh,280px)] max-h-[min(45vh,380px)] bg-surface-container-high border-none rounded px-3 py-2.5 text-sm leading-relaxed text-on-surface placeholder:text-on-surface-variant/40 focus:ring-1 focus:ring-secondary/50 outline-none resize-y overflow-y-auto"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-headline font-medium text-secondary uppercase tracking-wide">
              Carpeta del proyecto
            </label>
            <p className="text-[9px] text-on-surface-variant/90 leading-snug m-0 mb-1">
              Elige la carpeta completa del proyecto para el que quieres generar la API.  Zeus incluirá los archivos necesarios para documentarse.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              disabled={folderScanning}
              {...({ webkitdirectory: '', directory: '' } as object)}
              onChange={(e) => {
                const picked = e.target.files?.length ? Array.from(e.target.files) : [];
                e.target.value = '';
                onFolderPicked(picked);
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={folderScanning || loading || improveDescLoading || generatePreparing}
              className={`w-full border border-dashed rounded-lg p-3 flex flex-col items-center cursor-pointer group transition-colors disabled:opacity-70 disabled:cursor-wait ${
                folderScanning
                  ? 'animate-zeus-folder-scan border-secondary/60 bg-secondary/5'
                  : 'border-outline-variant/30 bg-surface-container-lowest/30 hover:border-secondary/35'
              }`}
            >
              <div className="w-8 h-8 rounded-full bg-secondary/15 flex items-center justify-center text-secondary mb-1">
                {folderScanning ? (
                  <Loader2 size={18} strokeWidth={2.25} className="animate-spin" aria-hidden />
                ) : (
                  <FolderOpen size={16} aria-hidden />
                )}
              </div>
              <p className="text-[10px] text-on-surface font-medium text-center">
                {folderScanning ? 'Leyendo archivos de la carpeta…' : 'Elegir carpeta del proyecto'}
              </p>
              {files.length > 0 && !folderScanning ? (
                <p className="text-[9px] text-secondary mt-1.5 text-center max-w-full px-2">
                  {files.length} archivo{files.length === 1 ? '' : 's'} (carpeta y subcarpetas)
                </p>
              ) : null}
            </button>
          </div>
        </div>

        <div className="relative z-10 px-3 py-2 bg-surface-container flex justify-end items-center gap-2 border-t border-outline-variant/10">
          <button
            type="button"
            onClick={onClose}
            disabled={loading || improveDescLoading || generatePreparing || folderScanning}
            className="px-3 py-1 rounded-full text-on-surface-variant font-headline font-bold text-[10px] hover:text-on-surface hover:bg-surface-container-high/60 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={loading || improveDescLoading || generatePreparing || folderScanning}
            className="inline-flex items-center justify-center gap-2 px-4 py-1.5 min-h-[2rem] bg-secondary text-on-secondary font-headline font-extrabold text-[10px] rounded-full cursor-pointer hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 transition-all shadow-sm"
          >
            {loading || generatePreparing ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" strokeWidth={2.5} aria-hidden />
            ) : null}
            <span>{loading ? 'Generando…' : generatePreparing ? 'Preparando…' : 'Generar API'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

const HomeView = ({
  onStartNow,
  onProjectClick,
  projects,
  projectsLoading,
  projectsError
}: {
  onStartNow: () => void;
  onProjectClick: (id: string) => void;
  projects: Project[];
  projectsLoading: boolean;
  projectsError: string | null;
}) => {
  const [showAllProjects, setShowAllProjects] = useState(false);
  const spotlight = useMemo(() => projects.slice(0, 6), [projects]);
  const hasMoreThanSpotlight = projects.length > 6;

  return (
    <div className="w-full min-w-0 max-w-5xl mx-auto px-3 sm:px-4 py-4">
      <section className="flex flex-col items-center text-center mb-8 py-4 relative">
        <div className="absolute inset-0 bg-gradient-to-b from-secondary/5 to-transparent rounded-full blur-[60px] -z-10 h-32 w-full" />
        <h1 className="font-headline text-xl sm:text-2xl md:text-3xl font-bold tracking-tight mb-2 leading-snug max-w-xl">
          Transforma tu código en una <span className="text-secondary">API completa</span>
        </h1>
        <p className="text-on-surface-variant text-[11px] sm:text-xs max-w-md mb-4 leading-relaxed">
          Genera endpoints, validaciones y documentación mientras defines tu lógica de negocio.
        </p>
        <button
          type="button"
          onClick={onStartNow}
          className="px-4 py-1.5 bg-transparent border border-secondary rounded-full font-headline font-bold text-secondary text-[11px] hover:bg-secondary hover:text-on-secondary transition-colors"
        >
          Comenzar ahora
        </button>
      </section>

      <section className="mb-8 relative min-w-0 w-full">
        <div
          className="pointer-events-none absolute inset-x-0 -top-5 h-24 bg-gradient-to-b from-secondary/[0.1] via-transparent to-transparent rounded-[50%] blur-2xl opacity-90"
          aria-hidden
        />
        <div className="relative z-[1] text-center sm:text-left mb-3">
          <p className="text-[8px] font-headline font-bold uppercase tracking-[0.2em] text-secondary mb-0.5">
            Capacidades
          </p>
          <p className="text-on-surface-variant text-[9px] max-w-md mx-auto sm:mx-0 leading-snug">
            De tipado estricto a documentación viva: todo lo que sale del generador, en un solo sitio.
          </p>
        </div>
        <div className="relative z-[1] grid w-full min-w-0 grid-cols-3 gap-2 [&>*]:min-w-0">
          {[
            { icon: Code, title: 'TypeScript', desc: 'Tipos y contratos seguros.' },
            { icon: FileText, title: 'Docs', desc: 'OpenAPI / Swagger al instante.' },
            { icon: Rocket, title: 'Validación', desc: 'Esquemas listos para usar.' },
            { icon: Terminal, title: 'Tests', desc: 'Pruebas generadas por IA.' },
            { icon: ChevronRight, title: 'Versiones', desc: 'Historial de cambios.' },
            { icon: Sparkles, title: 'Sugerencias', desc: 'Feedback en tiempo real.' },
          ].map((feature, i) => {
            const accentPurple = i % 2 === 1;
            const iconShell = accentPurple
              ? 'bg-gradient-to-br from-tertiary/35 via-secondary/15 to-surface-container-highest shadow-[0_0_16px_-8px_rgba(182,160,255,0.45)] group-hover:shadow-[0_0_20px_-6px_rgba(182,160,255,0.5)]'
              : 'bg-gradient-to-br from-secondary/40 via-secondary/10 to-surface-container-highest shadow-[0_0_16px_-8px_rgba(0,227,253,0.38)] group-hover:shadow-[0_0_20px_-6px_rgba(0,227,253,0.5)]';
            const ringGradient = accentPurple
              ? 'from-tertiary/50 via-secondary/25 to-secondary/15'
              : 'from-secondary/50 via-tertiary/20 to-transparent';
            return (
              <div
                key={i}
                className={`group relative rounded-xl p-px bg-gradient-to-br ${ringGradient} hover:opacity-100 opacity-95 transition-all duration-300 hover:scale-[1.02] hover:-translate-y-px`}
              >
                <div className="rounded-[11px] bg-surface-container-low/95 backdrop-blur-md border border-outline-variant/10 h-full px-2 py-2 sm:px-2.5 sm:py-2 transition-colors duration-300 group-hover:border-secondary/25 group-hover:bg-surface-container/80">
                  <div
                    className={`mb-1.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/5 text-on-secondary ${iconShell} transition-all duration-300 group-hover:scale-105`}
                  >
                    <feature.icon size={17} strokeWidth={2.1} className={accentPurple ? 'text-tertiary' : 'text-secondary'} />
                  </div>
                  <h3 className="font-headline text-[10px] font-bold text-on-surface tracking-tight group-hover:text-secondary transition-colors duration-200 leading-tight">
                    {feature.title}
                  </h3>
                  <p className="text-on-surface-variant/95 text-[8px] leading-snug mt-0.5 line-clamp-2">
                    {feature.desc}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="pt-4 border-t border-outline-variant/15 min-w-0 w-full">
        <div className="flex flex-wrap justify-between items-end mb-4 gap-2">
          <div className="min-w-0">
            <h2 className="font-headline text-sm font-bold tracking-tight">Proyectos generados</h2>
            <p className="text-on-surface-variant text-[10px]">
              {showAllProjects
                ? `Todos los proyectos (${projects.length})`
                : hasMoreThanSpotlight
                  ? `Últimos proyectos · ${projects.length} en total`
                  : `${projects.length} proyecto${projects.length === 1 ? '' : 's'}`}
            </p>
          </div>
          {!projectsLoading && !projectsError && projects.length > 0 && (
            <div className="flex items-center gap-2 shrink-0">
              {showAllProjects ? (
                <button
                  type="button"
                  onClick={() => setShowAllProjects(false)}
                  className="text-secondary text-[10px] font-headline font-semibold flex items-center gap-1 px-2 py-1 rounded-full border border-secondary/30 hover:bg-secondary/10 transition-colors"
                >
                  Ver destacados <ChevronRight size={12} className="rotate-180" />
                </button>
              ) : (
                hasMoreThanSpotlight && (
                  <button
                    type="button"
                    onClick={() => setShowAllProjects(true)}
                    className="text-secondary text-[10px] font-headline font-semibold flex items-center gap-1 px-2 py-1 rounded-full border border-secondary/30 hover:bg-secondary/10 transition-colors"
                  >
                    Ver todos <ArrowRight size={12} />
                  </button>
                )
              )}
            </div>
          )}
        </div>

        {projectsLoading ? (
          <p className="text-[10px] text-on-surface-variant py-10 text-center">
            Cargando proyectos desde PocketBase (projects_api)…
          </p>
        ) : projectsError ? (
          <p className="text-[10px] text-primary py-3 px-2 rounded-lg bg-primary/10 border border-primary/25">{projectsError}</p>
        ) : projects.length === 0 ? (
          <p className="text-[10px] text-on-surface-variant py-10 text-center">
            No hay proyectos en la base. Usa «New Project» para generar el primero (API en ejecución y PocketBase
            configurados).
          </p>
        ) : showAllProjects ? (
          <div className="space-y-2">
            {projects.map((project) => {
              const Icon = pickProjectCardIcon(project.id);
              return (
                <div
                  key={project.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => project.id && onProjectClick(project.id)}
                  onKeyDown={(e) => e.key === 'Enter' && project.id && onProjectClick(project.id)}
                  className="glass-card p-2.5 rounded-xl border border-outline-variant/15 flex flex-wrap items-center justify-between gap-2 hover:border-secondary/25 hover:bg-surface-container-high/40 cursor-pointer transition-all"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-secondary/20 to-tertiary/10 flex items-center justify-center shrink-0 text-secondary border border-secondary/15">
                      <Icon size={18} strokeWidth={2.2} />
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-headline font-bold text-[11px] truncate text-on-surface">{project.name}</h4>
                      <p className="text-[9px] text-on-surface-variant">Creado {project.lastDeployed}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-[10px]">
                    <div className="text-right">
                      <p className="text-[9px] text-on-surface-variant uppercase tracking-wider">Endpoints</p>
                      <p className="font-headline font-semibold text-secondary tabular-nums">{endpointsCountLabel(project.endpoints)}</p>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-medium border ${
                        project.status === 'Saludable'
                          ? 'bg-secondary/10 text-secondary border-secondary/25'
                          : 'bg-tertiary/10 text-tertiary border-tertiary/25'
                      }`}
                    >
                      {project.status}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="grid w-full min-w-0 grid-cols-3 gap-2 sm:gap-3 [&>*]:min-w-0">
            {spotlight.map((project) => {
              const Icon = pickProjectCardIcon(project.id);
              return (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => project.id && onProjectClick(project.id)}
                  className="group text-left rounded-2xl border border-outline-variant/20 bg-surface-container-low/80 hover:border-secondary/50 hover:shadow-[0_0_24px_-8px_rgba(0,227,253,0.35)] transition-all duration-300 overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary/60"
                >
                  <div className="h-1 w-full bg-gradient-to-r from-secondary via-tertiary to-secondary opacity-80 group-hover:opacity-100 transition-opacity" />
                  <div className="p-3.5 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-secondary/25 to-surface-container-highest flex items-center justify-center text-secondary border border-secondary/20 shadow-inner group-hover:scale-[1.03] transition-transform">
                        <Icon size={22} strokeWidth={2} />
                      </div>
                      <span
                        className={`shrink-0 px-2 py-0.5 rounded-full text-[8px] font-headline font-bold uppercase tracking-wide border ${
                          project.status === 'Saludable'
                            ? 'bg-secondary/15 text-secondary border-secondary/30'
                            : 'bg-tertiary/15 text-tertiary border-tertiary/30'
                        }`}
                      >
                        {project.status}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-headline font-bold text-[12px] leading-snug text-on-surface line-clamp-2 group-hover:text-secondary transition-colors">
                        {project.name}
                      </h3>
                      <p className="text-[9px] text-on-surface-variant mt-1">Actualizado · {project.lastDeployed}</p>
                    </div>
                    <div className="flex items-center justify-between pt-1 border-t border-outline-variant/10">
                      <span className="text-[10px] font-headline font-semibold text-secondary tabular-nums">
                        {endpointsCountLabel(project.endpoints)}
                      </span>
                      <span className="flex items-center gap-0.5 text-[9px] text-on-surface-variant group-hover:text-secondary transition-colors font-medium">
                        Abrir <ChevronRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

const DEMO_EDITOR_ENDPOINTS = [
  { method: 'POST', path: '/deploy', color: 'text-secondary' },
  { method: 'GET', path: '/status', color: 'text-green-400' },
  { method: 'DELETE', path: '/artifact', color: 'text-primary-dim' }
];

/** Entrada del probador: una fila por endpoint del proyecto (o demo fija si no hay endpoints). */
type ZeusHarnessEndpoint = {
  id: string;
  method: string;
  path: string;
  description: string;
  parameters?: Record<string, unknown>;
};

const LEGACY_HARNESS_ENDPOINTS: ZeusHarnessEndpoint[] = [
  { id: 'list', method: 'GET', path: '/items', description: 'Listado (demo harness)' },
  { id: 'get', method: 'GET', path: '/items/:id', description: 'Obtener por id (demo)' },
  { id: 'create', method: 'POST', path: '/items', description: 'Crear (demo)' },
  { id: 'update', method: 'PUT', path: '/items/:id', description: 'Actualizar (demo)' },
  { id: 'delete', method: 'DELETE', path: '/items/:id', description: 'Eliminar (demo)' }
];

function normalizeHarnessEndpointId(raw: unknown, index: number): string {
  let id = typeof raw === 'string' && raw.trim() ? raw.trim() : '';
  if (!id) return `ep-${index}`;
  id = id.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return id || `ep-${index}`;
}

/** Parsea `project.endpoints` (PocketBase / JSON del modelo) para el select del probador. */
function parseHarnessEndpoints(endpoints: unknown): ZeusHarnessEndpoint[] {
  let list: unknown[] = [];
  if (Array.isArray(endpoints)) list = endpoints;
  else if (endpoints !== null && typeof endpoints === 'object' && !Array.isArray(endpoints)) {
    list = [endpoints];
  } else if (typeof endpoints === 'string') {
    try {
      const p = JSON.parse(endpoints);
      list = Array.isArray(p) ? p : p !== null && typeof p === 'object' ? [p] : [];
    } catch {
      list = [];
    }
  }
  const seen = new Map<string, number>();
  const out: ZeusHarnessEndpoint[] = [];
  for (let i = 0; i < list.length; i++) {
    const ep = list[i];
    const o = ep && typeof ep === 'object' ? (ep as Record<string, unknown>) : {};
    const method = String(o.method ?? 'GET').toUpperCase();
    const path = String(o.path ?? '/');
    const baseId = normalizeHarnessEndpointId(o.id, i);
    const n = seen.get(baseId) ?? 0;
    seen.set(baseId, n + 1);
    const id = n === 0 ? baseId : `${baseId}_${n}`;
    const desc = typeof o.description === 'string' ? o.description.trim() : '';
    const parameters =
      o.parameters !== null && typeof o.parameters === 'object' && !Array.isArray(o.parameters)
        ? (o.parameters as Record<string, unknown>)
        : undefined;
    out.push({ id, method, path, description: desc, parameters });
  }
  return out;
}

function sampleValueForParamSpec(spec: unknown, key: string): unknown {
  if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
    const t = String((spec as Record<string, unknown>).type ?? 'string').toLowerCase();
    if (t === 'number' || t === 'integer' || t === 'float') return 1;
    if (t === 'boolean') return true;
    if (t === 'array') return [];
    if (t === 'object') return {};
  }
  if (key === 'id') return '1';
  if (key === 'email') return 'test@example.com';
  return `test-${key}`;
}

function sampleBodyFromParameters(params: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!params) return {};
  const body: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(params)) {
    body[key] = sampleValueForParamSpec(spec, key);
  }
  return body;
}

function getTestHttpMethod(testId: string, catalog: ZeusHarnessEndpoint[]): string {
  const ep = catalog.find((e) => e.id === testId);
  if (ep) return ep.method.toUpperCase();
  if (testId === 'list' || testId === 'get') return 'GET';
  if (testId === 'create') return 'POST';
  if (testId === 'update') return 'PUT';
  if (testId === 'delete') return 'DELETE';
  return 'GET';
}

function getTestRequestBody(testId: string, catalog: ZeusHarnessEndpoint[]): Record<string, unknown> | null {
  const ep = catalog.find((e) => e.id === testId);
  if (ep) {
    const m = ep.method.toUpperCase();
    if (m === 'GET' || m === 'HEAD') return null;
    const fromParams = sampleBodyFromParameters(ep.parameters);
    if (Object.keys(fromParams).length > 0) return fromParams;
    if (m === 'DELETE') return { id: '1' };
    if (m === 'POST' || m === 'PUT' || m === 'PATCH') {
      return { name: 'Panel test', description: 'Desde Zeus panel' };
    }
    return {};
  }
  if (testId === 'list' || testId === 'get') return null;
  if (testId === 'create') return { name: 'Panel test', description: 'Desde Zeus panel' };
  if (testId === 'update') return { name: 'Panel test', description: 'Actualizado' };
  if (testId === 'delete') return { id: '1' };
  return null;
}

/** Solo sustituye si el modelo devolvió texto no vacío; si no, conserva lo ya guardado. */
function mergeNonEmptyString(incoming: unknown, previous: string): string {
  if (typeof incoming === 'string' && incoming.trim()) return incoming;
  return previous;
}

/** No sustituir endpoints por [] u omitidos si ya había datos (evita borrar la API). */
function mergeEndpointsField(incoming: unknown, previous: unknown): unknown {
  if (incoming === undefined || incoming === null) return previous;
  if (Array.isArray(incoming) && incoming.length === 0 && previous != null) {
    const prevLen = Array.isArray(previous)
      ? previous.length
      : previous !== null && typeof previous === 'object'
        ? 1
        : 0;
    if (prevLen > 0) return previous;
  }
  return incoming;
}

/** Línea curl equivalente a la petición del probador (para copiar desde Snippets). */
function buildCurlForGenerateApiTest(base: string, testId: string, catalog: ZeusHarnessEndpoint[]): string {
  const path = `/api/generate-api/test/${encodeURIComponent(testId)}`;
  const url = `${base.replace(/\/$/, '')}${path}`;
  const method = getTestHttpMethod(testId, catalog);
  const body = getTestRequestBody(testId, catalog);
  if (method === 'GET' || method === 'HEAD') {
    return `curl -sS -X ${method} ${JSON.stringify(url)}`;
  }
  const payload = JSON.stringify(body ?? {});
  return `curl -sS -X ${method} ${JSON.stringify(url)} -H ${JSON.stringify('Content-Type: application/json')} -d ${JSON.stringify(payload)}`;
}

/** PocketBase campos editor / texto a veces llegan como string u objeto. */
function pbStringFromEditorField(val: unknown): string | null {
  if (val == null) return null;
  if (typeof val === 'string') {
    const t = val.trim();
    return t.length ? t : null;
  }
  if (typeof val === 'object') {
    const o = val as Record<string, unknown>;
    if (typeof o.text === 'string' && o.text.trim()) return o.text.trim();
    if (typeof o.markdown === 'string' && o.markdown.trim()) return o.markdown.trim();
    try {
      const s = JSON.stringify(val, null, 2);
      return s === '{}' ? null : s;
    } catch {
      return String(val);
    }
  }
  return String(val);
}

function endpointsFromPbRecord(endpoints: unknown): { method: string; path: string; color: string }[] {
  const colors = ['text-secondary', 'text-green-400', 'text-tertiary', 'text-primary-dim', 'text-primary'];
  let list: unknown[] = [];
  if (Array.isArray(endpoints)) list = endpoints;
  else if (endpoints !== null && typeof endpoints === 'object' && !Array.isArray(endpoints)) {
    list = [endpoints];
  } else if (typeof endpoints === 'string') {
    try {
      const p = JSON.parse(endpoints);
      list = Array.isArray(p) ? p : p !== null && typeof p === 'object' ? [p] : [];
    } catch {
      list = [];
    }
  }
  return list.map((ep, i) => {
    const o = ep && typeof ep === 'object' ? (ep as Record<string, unknown>) : {};
    const method = String(o.method ?? 'GET').toUpperCase();
    const path = String(o.path ?? o.id ?? '/');
    const color = colors[i % colors.length];
    return { method, path, color };
  });
}

const EditorView = ({
  projectName,
  onBack,
  projectId,
  onProjectUpdated,
  onNewProject
}: {
  projectName: string;
  onBack: () => void;
  projectId: string | null;
  /** Tras guardar mejoras desde feedback, refresca la lista en Home si se pasa. */
  onProjectUpdated?: () => void;
  /** Ir a la pantalla principal y abrir el modal «Api Generator Zeus». */
  onNewProject: () => void;
}) => {
  const [testId, setTestId] = useState('list');
  const [testBusy, setTestBusy] = useState(false);
  const [apiTestResponseSnippet, setApiTestResponseSnippet] = useState<string | null>(null);
  const [remoteProject, setRemoteProject] = useState<Record<string, unknown> | null>(null);
  const [projectLoading, setProjectLoading] = useState(false);
  const [projectLoadError, setProjectLoadError] = useState<string | null>(null);
  const [editorMainTab, setEditorMainTab] = useState<'code' | 'docs' | 'schemas'>('code');
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackStatus, setFeedbackStatus] = useState<string | null>(null);
  const [editorCopyHint, setEditorCopyHint] = useState<string | null>(null);
  const editorCopyHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [downloadZipBusy, setDownloadZipBusy] = useState(false);
  const [downloadZipError, setDownloadZipError] = useState<string | null>(null);
  const [swaggerPreviewBusy, setSwaggerPreviewBusy] = useState(false);
  const [swaggerPreviewMessage, setSwaggerPreviewMessage] = useState<string | null>(null);
  const [swaggerUrl, setSwaggerUrl] = useState<string | null>(null);
  /** Visor Monaco / Docs / Esquemas a pantalla completa dentro del panel central */
  const [editorViewerFullscreen, setEditorViewerFullscreen] = useState(false);

  useEffect(() => {
    setEditorMainTab('code');
  }, [projectId]);

  useEffect(() => {
    setEditorViewerFullscreen(false);
  }, [projectId]);

  useEffect(() => {
    if (!editorViewerFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEditorViewerFullscreen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editorViewerFullscreen]);

  useEffect(() => {
    if (!editorViewerFullscreen) return;
    const t = requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });
    return () => cancelAnimationFrame(t);
  }, [editorViewerFullscreen]);

  useEffect(() => {
    if (!projectId) {
      setRemoteProject(null);
      setProjectLoadError(null);
      return;
    }
    let cancelled = false;
    setProjectLoading(true);
    setProjectLoadError(null);
    (async () => {
      try {
        if (isZeusCentralPanelInVsCode()) {
          const { project, error } = await requestProjectByIdFromExtension(projectId);
          if (cancelled) return;
          if (error) {
            setRemoteProject(null);
            setProjectLoadError(error);
            return;
          }
          if (project && 'id' in project) {
            setRemoteProject(project);
            setProjectLoadError(null);
          } else {
            setRemoteProject(null);
            setProjectLoadError('Respuesta vacía al cargar el proyecto.');
          }
          return;
        }

        const base = getZeusApiBase();
        const url = `${base}/api/generate-api/projects/${encodeURIComponent(projectId)}`;
        const r = await fetch(url, { headers: getZeusPocketBaseRequestHeaders() });
        let data: unknown = null;
        try {
          data = await r.json();
        } catch {
          data = null;
        }
        if (cancelled) return;
        if (r.ok && data && typeof data === 'object' && data !== null && 'id' in data) {
          setRemoteProject(data as Record<string, unknown>);
          setProjectLoadError(null);
        } else {
          setRemoteProject(null);
          const msg =
            data && typeof data === 'object' && data !== null && 'error' in data
              ? String((data as { error: unknown }).error)
              : `HTTP ${r.status}`;
          setProjectLoadError(`No se pudo cargar el proyecto (${msg}). URL: ${url}`);
        }
      } catch (e) {
        if (!cancelled) {
          setRemoteProject(null);
          setProjectLoadError(e instanceof Error ? e.message : 'Error de red al cargar el proyecto');
        }
      } finally {
        if (!cancelled) setProjectLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const pbEndpoints = endpointsFromPbRecord(remoteProject?.endpoints);
  const endpointRows = pbEndpoints.length > 0 ? pbEndpoints : DEMO_EDITOR_ENDPOINTS;
  const harnessCatalog = useMemo(() => {
    const parsed = parseHarnessEndpoints(remoteProject?.endpoints);
    return parsed.length > 0 ? parsed : LEGACY_HARNESS_ENDPOINTS;
  }, [remoteProject?.endpoints]);

  useEffect(() => {
    if (harnessCatalog.length === 0) return;
    if (!harnessCatalog.some((e) => e.id === testId)) {
      setTestId(harnessCatalog[0].id);
    }
  }, [harnessCatalog, testId]);

  const codeFromPb = pbStringFromEditorField(remoteProject?.code);
  const docsFromPb = pbStringFromEditorField(remoteProject?.documentation);
  const schemasFromPb = pbStringFromEditorField(remoteProject?.schemas);
  const editorBody =
    editorMainTab === 'code'
      ? codeFromPb
      : editorMainTab === 'docs'
        ? docsFromPb
        : schemasFromPb;

  const curlPreviewForTest = useMemo(
    () => buildCurlForGenerateApiTest(getZeusApiBase(), testId, harnessCatalog),
    [testId, harnessCatalog]
  );

  const projectRecordId =
    remoteProject && typeof remoteProject.id === 'string' ? remoteProject.id : null;

  const handleDownloadProjectZip = async () => {
    if (!remoteProject || downloadZipBusy) return;
    setDownloadZipError(null);
    setDownloadZipBusy(true);
    try {
      await downloadZeusProjectZip({
        title: String(remoteProject.title ?? remoteProject.name ?? projectName),
        description: String(remoteProject.description ?? ''),
        code: pbStringFromEditorField(remoteProject.code) ?? '',
        documentation: pbStringFromEditorField(remoteProject.documentation) ?? '',
        schemas: pbStringFromEditorField(remoteProject.schemas) ?? '',
        endpoints: remoteProject.endpoints
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error al generar o guardar el ZIP';
      setDownloadZipError(msg);
      console.error(e);
    } finally {
      setDownloadZipBusy(false);
    }
  };

  const handleExecuteSwaggerPreview = async () => {
    setSwaggerPreviewMessage(null);
    const code = pbStringFromEditorField(remoteProject?.code) ?? '';
    if (!code.trim()) {
      setSwaggerPreviewMessage('No hay código en el proyecto para generar Swagger.');
      return;
    }
    const description = String(remoteProject?.description ?? '');
    const endpoints = remoteProject?.endpoints;
    const documentation = remoteProject?.documentation;
    const title =
      String(remoteProject?.title ?? remoteProject?.name ?? projectName ?? 'API').trim() || 'API';

    setSwaggerPreviewBusy(true);
    setSwaggerPreviewMessage('Instalando dependencias en memoria...');
    setSwaggerUrl(null);
    
    try {
      const base = getZeusApiBase().replace(/\/$/, '');
      
      // 1) Instalar dependencias en memoria
      await fetch(`${base}/api/install-dependencies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getZeusPocketBaseRequestHeaders()
        }
      });
      
      setSwaggerPreviewMessage('Dependencias listas. Iniciando servidor de la API...');

      // 2) Ejecutar la API en vivo
      const runRes = await fetch(`${base}/api/run-api-runtime`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getZeusPocketBaseRequestHeaders()
        },
        body: JSON.stringify({
          code,
          title,
          description,
          endpoints,
          documentation
        })
      });

      if (!runRes.ok) {
        throw new Error('No se pudo arrancar el servidor de la API.');
      }

      const runData = await runRes.json();
      const targetUrl = runData.url || 'http://localhost:8745/api-docs';
      setSwaggerUrl(targetUrl);
      setSwaggerPreviewMessage('¡Servidor listo en el puerto 8745!');
    } catch (e) {
      try {
        const local = buildOpenApiPreviewPayload(code, title, description, endpoints, documentation);
        const html = buildSwaggerStandaloneHtml(local.openapi);
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        setSwaggerUrl(url);
        setSwaggerPreviewMessage('Error en servidor; se generó vista local.');
      } catch (err) {
        setSwaggerPreviewMessage(e instanceof Error ? e.message : 'Error al generar Swagger');
      }
    } finally {
      setSwaggerPreviewBusy(false);
    }
  };

  const copyActiveEditorTab = async () => {
    let text = '';
    if (editorMainTab === 'code') {
      text = getMonacoCopyValue(codeFromPb, projectId);
    } else if (editorMainTab === 'docs') {
      text = docsFromPb ?? '';
    } else {
      text = schemasFromPb ?? '';
    }
    if (!text.trim()) {
      if (editorCopyHintTimer.current) clearTimeout(editorCopyHintTimer.current);
      setEditorCopyHint('Sin contenido');
      editorCopyHintTimer.current = setTimeout(() => setEditorCopyHint(null), 2000);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      if (editorCopyHintTimer.current) clearTimeout(editorCopyHintTimer.current);
      setEditorCopyHint('Copiado');
      editorCopyHintTimer.current = setTimeout(() => setEditorCopyHint(null), 2000);
    } catch {
      setEditorCopyHint('Error al copiar');
      editorCopyHintTimer.current = setTimeout(() => setEditorCopyHint(null), 2000);
    }
  };

  const runApiTest = async () => {
    setTestBusy(true);
    setApiTestResponseSnippet(null);
    try {
      const method = getTestHttpMethod(testId, harnessCatalog);
      const bodyObj = getTestRequestBody(testId, harnessCatalog);
      const base = getZeusApiBase().replace(/\/$/, '');
      const url = `${base}/api/generate-api/test/${encodeURIComponent(testId)}`;
      const init: RequestInit = {
        method,
        headers: { ...getZeusPocketBaseRequestHeaders() }
      };
      if (bodyObj != null && method !== 'GET' && method !== 'HEAD') {
        (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
        init.body = JSON.stringify(bodyObj);
      }
      const res = await fetch(url, init);
      const text = await res.text();
      const statusLine = `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`;
      let bodyBlock: string;
      if (!text.trim()) {
        bodyBlock = '(sin cuerpo)';
      } else {
        try {
          const parsed = JSON.parse(text) as unknown;
          bodyBlock =
            typeof parsed === 'object' && parsed !== null
              ? JSON.stringify(parsed, null, 2)
              : String(parsed);
        } catch {
          bodyBlock = text;
        }
      }
      setApiTestResponseSnippet(`${statusLine}\n\n${bodyBlock}`);
    } catch (e) {
      setApiTestResponseSnippet(e instanceof Error ? e.message : 'Error de red');
    } finally {
      setTestBusy(false);
    }
  };

  const submitFeedbackImprovement = async () => {
    setFeedbackStatus(null);
    if (!projectId || !remoteProject) {
      setFeedbackStatus('Selecciona un proyecto desde la lista para pedir mejoras al modelo.');
      return;
    }
    const existingCode = pbStringFromEditorField(remoteProject.code) ?? '';
    if (!existingCode.trim()) {
      setFeedbackStatus('Este proyecto no tiene código; genera o pega código antes de pedir mejoras.');
      return;
    }
    if (!feedbackText.trim()) {
      setFeedbackStatus('Describe qué quieres mejorar o añadir en la API.');
      return;
    }
    await requestPocketBaseSessionFromExtension();
    const cfg = await requestModelConfigFromExtension();
    const isLocal = cfg?.type === 'local' || cfg?.type === 'LM Studio' || cfg?.provider === 'LM Studio' || cfg?.provider === 'local';

    if (!isLocal && !cfg?.apiKey?.trim()) {
      setFeedbackStatus(
        'Selecciona un modelo en el chat de Zeus (barra lateral) con API key en PocketBase.'
      );
      return;
    }
    setFeedbackBusy(true);
    try {
      const formData = new FormData();
      formData.append('title', String(remoteProject.title ?? remoteProject.name ?? 'Proyecto'));
      formData.append('description', String(remoteProject.description ?? ''));
      formData.append('modelType', 'typescript');
      formData.append('existing_code', existingCode);
      formData.append('feedback_text', feedbackText.trim());
      formData.append('skip_save', 'true');

      const modelConfig = {
        apiKey: cfg?.apiKey || '',
        model: cfg?.model || 'deepseek-chat',
        temperature: cfg?.temperature ?? 0.7,
        maxTokens: cfg?.maxTokens ?? 8192,
        type: cfg?.type || '',
        provider: cfg?.provider || '',
        ...(cfg?.apiBaseUrl ? { apiBaseUrl: cfg.apiBaseUrl } : {})
      };

      const base = getZeusApiBase();
      const res = await fetch(`${base}/api/generate-api/generate`, {
        method: 'POST',
        headers: {
          'x-model-config': JSON.stringify(modelConfig),
          ...getZeusPocketBaseRequestHeaders()
        },
        body: formData
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : `Error ${res.status}`);
      }
      if (data.feedbackMergeRejected === true) {
        const msg =
          typeof data.feedbackMergeMessage === 'string' && data.feedbackMergeMessage.trim()
            ? data.feedbackMergeMessage
            : 'Se conservó el código actual: la respuesta del modelo eliminaba rutas sin que lo pidieras. Reformula el feedback.';
        setFeedbackStatus(msg);
        return;
      }
      const prevDocs = pbStringFromEditorField(remoteProject.documentation) ?? '';
      const prevSchemas = pbStringFromEditorField(remoteProject.schemas) ?? '';
      const mergedCode = mergeNonEmptyString(data.code, existingCode);
      if (!mergedCode.trim()) {
        throw new Error('No hay código que guardar (ni respuesta del modelo ni proyecto previo).');
      }
      const putBody: Record<string, unknown> = {
        code: mergedCode,
        documentation: mergeNonEmptyString(data.documentation, prevDocs),
        schemas: mergeNonEmptyString(data.schemas, prevSchemas),
        endpoints: mergeEndpointsField(data.endpoints, remoteProject.endpoints)
      };
      const putRes = await fetch(`${base}/api/generate-api/projects/${encodeURIComponent(projectId)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...getZeusPocketBaseRequestHeaders()
        },
        body: JSON.stringify(putBody)
      });
      const putJson = (await putRes.json().catch(() => ({}))) as { error?: unknown };
      if (!putRes.ok) {
        throw new Error(
          typeof putJson.error === 'string' ? putJson.error : `No se pudo guardar (HTTP ${putRes.status})`
        );
      }
      setFeedbackText('');
      setFeedbackStatus('Mejoras aplicadas y guardadas en PocketBase.');

      if (isZeusCentralPanelInVsCode()) {
        const { project, error } = await requestProjectByIdFromExtension(projectId);
        if (!error && project && typeof project === 'object' && project !== null && 'id' in project) {
          setRemoteProject(project as Record<string, unknown>);
        }
      } else {
        const r = await fetch(`${base}/api/generate-api/projects/${encodeURIComponent(projectId)}`, {
          headers: getZeusPocketBaseRequestHeaders()
        });
        if (r.ok) {
          const p = await r.json();
          if (p && typeof p === 'object' && 'id' in p) {
            setRemoteProject(p as Record<string, unknown>);
          }
        }
      }
      onProjectUpdated?.();
    } catch (e) {
      setFeedbackStatus(e instanceof Error ? e.message : 'Error al aplicar el feedback');
    } finally {
      setFeedbackBusy(false);
    }
  };

  const editorMainTabsNav = (
    <div
      className={`flex border-b text-[10px] shrink-0 gap-1 ${
        editorViewerFullscreen
          ? 'border-outline-variant/20 mb-0 px-2 sm:px-1'
          : 'border-outline-variant/10 mb-3'
      }`}
    >
      <button
        type="button"
        onClick={() => setEditorMainTab('code')}
        className={`px-3 py-1.5 font-headline font-semibold ${
          editorMainTab === 'code'
            ? 'text-secondary border-b-2 border-secondary'
            : 'text-on-surface-variant'
        }`}
      >
        Código
      </button>
      <button
        type="button"
        onClick={() => setEditorMainTab('docs')}
        className={`px-3 py-1.5 font-headline ${
          editorMainTab === 'docs'
            ? 'text-secondary border-b-2 border-secondary font-semibold'
            : 'text-on-surface-variant'
        }`}
      >
        Docs
      </button>
      <button
        type="button"
        onClick={() => setEditorMainTab('schemas')}
        className={`px-3 py-1.5 font-headline ${
          editorMainTab === 'schemas'
            ? 'text-secondary border-b-2 border-secondary font-semibold'
            : 'text-on-surface-variant'
        }`}
      >
        Esquemas
      </button>
    </div>
  );

  return (
  <div className="flex flex-col flex-1 min-h-0 h-full w-full max-w-[min(100%,1680px)] mx-auto px-2 sm:px-5 md:px-8 pb-5 pt-3 overflow-hidden min-w-0">
    {!editorViewerFullscreen ? (
    <header className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-3 shrink-0">
      <div className="space-y-1 min-w-0">
        <p className="text-[9px] uppercase tracking-widest text-secondary font-headline truncate">{projectName}</p>
        <h1 className="font-headline text-base sm:text-lg font-extrabold text-on-surface leading-tight">Zeus Code Editor</h1>
        <p className="text-on-surface-variant text-[9px] max-w-2xl leading-snug hidden sm:block">
          {projectId
            ? projectLoading
              ? 'Cargando desde PocketBase (projects_api)…'
              : remoteProject
                ? 'Registro projects_api: código, documentación, esquemas y endpoints (JSON).'
                : projectLoadError || 'Sin datos. Revisa API, PocketBase y credenciales (admin en desarrollo).'
            : 'Editor arriba; snippets y probador a la izquierda; endpoints y feedback a la derecha.'}
        </p>
        {projectLoadError && projectId ? (
          <p className="text-[9px] text-primary max-w-2xl leading-snug mt-1 break-words sm:block">{projectLoadError}</p>
        ) : null}
        {downloadZipError ? (
          <p className="text-[9px] text-primary max-w-2xl leading-snug mt-1 break-words">{downloadZipError}</p>
        ) : null}
        {swaggerPreviewMessage ? (
          <p className="text-[9px] text-amber-400/95 max-w-2xl leading-snug mt-1 break-words">
            {swaggerPreviewMessage}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2 shrink-0">
        <button type="button" onClick={onBack} className="px-3 py-1 rounded-full border border-outline-variant/30 text-on-surface text-[10px] font-medium hover:bg-surface-container-high">
          Volver
        </button>
        <button
          type="button"
          disabled={!remoteProject || projectLoading || downloadZipBusy}
          onClick={() => void handleDownloadProjectZip()}
          title={
            remoteProject
              ? 'Descargar ZIP con código, documentación, esquemas y proyecto npm'
              : 'Abre un proyecto con datos cargados para descargar'
          }
          className="px-3 py-1 rounded-full border border-secondary text-secondary text-[10px] font-medium hover:bg-secondary/10 flex items-center gap-1 disabled:opacity-40 disabled:pointer-events-none"
        >
          <Download size={12} /> {downloadZipBusy ? 'Generando…' : 'Descargar'}
        </button>

        <button
          type="button"
          disabled={
            !remoteProject ||
            projectLoading ||
            swaggerPreviewBusy ||
            !(pbStringFromEditorField(remoteProject.code) ?? '').trim()
          }
          onClick={() => void handleExecuteSwaggerPreview()}
          title="Instalar dependencias y preparar servidor API"
          className="px-3 py-1 rounded-full bg-primary text-on-primary text-[10px] font-bold flex items-center gap-1 hover:bg-primary/80 disabled:opacity-40 disabled:pointer-events-none"
        >
          {swaggerPreviewBusy ? (
            <Loader2 size={12} className="animate-spin shrink-0" />
          ) : (
            <Play size={12} className="shrink-0" />
          )}
          Ejecutar
        </button>

        {swaggerUrl && (
          <a
            href={swaggerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1 rounded-full bg-secondary text-on-secondary text-[10px] font-bold flex items-center gap-1 hover:bg-secondary-dim animate-pulse no-underline"
          >
            <Rocket size={12} className="shrink-0" />
            Abrir Swagger
          </a>
        )}
      </div>
    </header>
    ) : null}

    {!editorViewerFullscreen ? editorMainTabsNav : null}

    {/* Editor: código con Monaco; Docs / Esquemas — fondo negro en las tres pestañas */}
    <div
      className={
        editorViewerFullscreen
          ? 'flex flex-col flex-1 min-h-0 rounded-none mb-0 overflow-hidden bg-background'
          : 'shrink-0 min-h-[200px] h-[min(40vh,420px)] flex flex-col rounded-lg overflow-hidden mb-5 bg-background'
      }
      style={{ boxShadow: 'inset 0 0 0 1px rgba(0, 227, 253, 0.28)' }}
    >
      {editorViewerFullscreen ? editorMainTabsNav : null}
      <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-2 bg-surface-container-low border-b border-outline-variant/10">
        <div className="flex gap-2 items-center min-w-0 flex-1">
          <div className="flex gap-1 shrink-0">
            <div className="w-2 h-2 rounded-full bg-primary/55" />
            <div className="w-2 h-2 rounded-full bg-warning/50" />
            <div className="w-2 h-2 rounded-full bg-secondary/50" />
          </div>
          <span className="text-[9px] text-on-surface-variant font-headline truncate">
            {editorMainTab === 'code' ? 'Monaco · TypeScript' : editorMainTab === 'docs' ? 'Documentación' : 'Esquemas'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 max-w-[min(100%,320px)]">
          <span
            className={`text-[9px] font-mono truncate text-right min-w-0 ${
              editorMainTab === 'code' ? 'text-sky-300/85' : 'text-teal-300/90'
            }`}
            title={projectRecordId ?? undefined}
          >
            {projectRecordId ?? '—'}
          </span>
          <button
            type="button"
            onClick={() => void copyActiveEditorTab()}
            className="text-on-surface-variant p-1.5 rounded-md hover:bg-surface-container-high/50 hover:text-secondary shrink-0 border border-outline-variant/20"
            aria-label="Copiar contenido de la pestaña"
            title="Copiar contenido de la pestaña activa (código, documentación o esquemas)"
          >
            <Copy size={13} strokeWidth={2.25} />
          </button>
          <button
            type="button"
            onClick={() => setEditorViewerFullscreen((v) => !v)}
            className="text-on-surface-variant p-1.5 rounded-md hover:bg-surface-container-high/50 hover:text-secondary shrink-0 border border-outline-variant/20"
            aria-label={editorViewerFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa del visor'}
            title={
              editorViewerFullscreen
                ? 'Restaurar diseño (Esc)'
                : 'Expandir el visor a todo el panel central'
            }
          >
            {editorViewerFullscreen ? (
              <Minimize2 size={13} strokeWidth={2.25} />
            ) : (
              <Maximize2 size={13} strokeWidth={2.25} />
            )}
          </button>
          {editorCopyHint ? (
            <span className="text-[8px] text-secondary font-medium whitespace-nowrap tabular-nums">
              {editorCopyHint}
            </span>
          ) : null}
        </div>
      </div>
      {editorMainTab === 'code' ? (
        <div className="flex-1 min-h-0 flex flex-col min-w-0">
          <ZeusMonacoPane
            codeFromPb={codeFromPb}
            projectId={projectId}
            projectLoading={projectLoading}
            emptyHint="Este proyecto no tiene código guardado en PocketBase o el campo está vacío."
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto custom-scrollbar bg-background px-4 py-3 sm:px-5 sm:py-4 text-left">
          {editorBody ? (
            <pre className="m-0 h-full min-h-full whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-teal-300 selection:bg-teal-500/25 selection:text-teal-50">
              {editorBody}
            </pre>
          ) : projectId && !projectLoading ? (
            <p className="text-[#5eead4] text-[11px] m-0 font-medium leading-relaxed">
              {editorMainTab === 'docs' ? 'Sin documentación en el registro.' : 'Sin esquemas en el registro.'}
            </p>
          ) : (
            <pre className="m-0 text-teal-200/95 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
              Vista previa: selecciona un proyecto o genera una API para ver {editorMainTab === 'docs' ? 'la documentación' : 'los esquemas'} aquí (texto turquesa, fondo negro).
            </pre>
          )}
        </div>
      )}
    </div>

    {/* Rejilla fija 3 columnas: al estrechar el panel solo se reduce el ancho, sin apilar en vertical */}
    {!editorViewerFullscreen ? (
    <div className="flex-1 min-h-0 grid grid-cols-3 gap-2 sm:gap-3 md:gap-5 min-w-0">
      {/* Columna Izquierda: Snippets — curl del probador + última respuesta JSON */}
      <div className="bg-surface-container-low rounded-lg p-2 sm:p-3 md:p-4 border border-outline-variant/5 min-h-0 min-w-0 flex flex-col overflow-hidden h-full">
        <h3 className="font-headline font-bold text-[11px] mb-2 text-on-surface flex items-center gap-2 shrink-0">
          <Terminal size={14} className="text-primary shrink-0" />
          Snippets
        </h3>
        <p className="text-[8px] uppercase tracking-wide text-on-surface-variant mb-1 shrink-0">Petición (misma que Ejecutar)</p>
        <pre className="bg-surface-container-lowest p-2 rounded-md border border-outline-variant/20 font-mono text-[9px] text-secondary/95 whitespace-pre-wrap break-all mb-3 shrink-0 max-h-[28%] overflow-auto custom-scrollbar leading-snug">
          <span className="text-secondary">$</span> {curlPreviewForTest}
        </pre>
        <p className="text-[8px] uppercase tracking-wide text-on-surface-variant mb-1 shrink-0">
          Respuesta (código HTTP + cuerpo)
        </p>
        <div className="bg-surface-container-lowest p-3 rounded-md border border-outline-variant/20 font-mono text-[9px] text-on-surface-variant break-all flex-1 min-h-0 overflow-auto leading-snug custom-scrollbar">
          {apiTestResponseSnippet ? (
            <pre className="m-0 whitespace-pre-wrap break-words text-teal-200/95">{apiTestResponseSnippet}</pre>
          ) : (
            <span className="text-on-surface-variant/80">
              Ejecuta una operación en el probador para ver aquí el estado HTTP (p. ej. 200, 404) y el cuerpo de{' '}
              <span className="text-secondary">/api/generate-api/test/:id</span>.
            </span>
          )}
        </div>
      </div>

      {/* Columna Central: Probador API (Arriba) y Feedback (Abajo) */}
      <div className="flex flex-col gap-3 sm:gap-4 md:gap-6 min-h-0 min-w-0 h-full">
        {/* Probador API */}
        <div className="bg-surface-container-high rounded-lg p-2 sm:p-3 md:p-4 border border-secondary/10 flex-1 flex flex-col overflow-hidden min-w-0">
          <h3 className="font-headline font-bold text-[11px] mb-2 sm:mb-3 text-on-surface shrink-0">Probador API</h3>
          <div className="space-y-2 sm:space-y-3 flex-1 min-h-0 flex flex-col min-w-0">
            <label className="text-[8px] sm:text-[9px] uppercase text-on-surface-variant shrink-0 tracking-wide break-words">
              Harness{' '}
              <span className="font-mono text-secondary/90 break-all">/api/generate-api/test/:id</span>
            </label>
            <select
              value={testId}
              onChange={(e) => setTestId(e.target.value)}
              className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-md px-2.5 py-2 text-[10px] text-on-surface outline-none shrink-0"
            >
              {harnessCatalog.map((ep) => {
                const shortDesc =
                  ep.description.length > 72 ? `${ep.description.slice(0, 70)}…` : ep.description;
                const label = shortDesc
                  ? `${ep.method} ${ep.path} — ${ep.id} (${shortDesc})`
                  : `${ep.method} ${ep.path} — ${ep.id}`;
                return (
                  <option key={ep.id} value={ep.id}>
                    {label}
                  </option>
                );
              })}
            </select>
            <button
              type="button"
              onClick={() => void runApiTest()}
              disabled={testBusy}
              className="w-full py-2 rounded-md bg-secondary text-on-secondary font-bold text-[10px] flex items-center justify-center gap-1 shrink-0 mt-auto disabled:opacity-50"
            >
              <Play size={12} /> {testBusy ? '…' : 'Ejecutar'}
            </button>
            <p className="text-[8px] text-on-surface-variant/90 leading-snug shrink-0">
              La respuesta aparece en <span className="text-secondary font-medium">Snippets</span> (curl + JSON).
            </p>
          </div>
        </div>

        {/* Feedback — mismo flujo que generate-api/page: POST /api/generate-api/generate + PUT proyecto */}
        <div className="bg-surface-container-low rounded-lg p-2 sm:p-3 md:p-4 border border-outline-variant/10 flex-1 flex flex-col min-h-0 min-w-0">
          <h3 className="font-headline font-bold text-[11px] mb-2 text-on-surface shrink-0">Feedback al modelo</h3>
          {feedbackStatus ? (
            <p
              className={`text-[9px] mb-2 shrink-0 leading-snug ${
                feedbackStatus.startsWith('Mejoras aplicadas') ? 'text-secondary' : 'text-primary-dim'
              }`}
            >
              {feedbackStatus}
            </p>
          ) : null}
          <div className="min-h-0 flex-1 flex flex-col overflow-y-auto [min-height:72px]">
            <textarea
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              disabled={feedbackBusy || projectLoading || !projectId}
              className="w-full min-h-[72px] flex-1 box-border bg-surface-container-lowest border border-outline-variant/30 rounded-md p-2 text-[10px] leading-snug text-on-surface placeholder:text-on-surface-variant outline-none resize-none disabled:opacity-50"
              placeholder={
                projectId
                  ? 'Pide cambios sobre el código actual, Ej: Crea un nuevo endpoint para autenticación'
                  : 'Abre un proyecto desde la lista para enviar feedback…'
              }
            />
          </div>
          <div className="flex items-center justify-end mt-2 gap-1.5 shrink-0 pt-2 border-t border-outline-variant/10">
            <button
              type="button"
              disabled={feedbackBusy || projectLoading || !projectId}
              onClick={() => void submitFeedbackImprovement()}
              className="inline-flex items-center justify-center px-2 py-0.5 rounded bg-primary/15 text-primary border border-primary/30 font-headline font-semibold text-[8px] leading-tight hover:bg-primary/25 disabled:opacity-40 disabled:pointer-events-none"
            >
              {feedbackBusy ? '…' : 'Enviar'}
            </button>
          </div>
        </div>
      </div>

      {/* Columna Derecha: Endpoints */}
      <div className="flex flex-col gap-2 min-h-0 min-w-0 h-full overflow-hidden">
        <h3 className="font-headline font-bold text-[11px] text-on-surface shrink-0">
          Endpoints{pbEndpoints.length > 0 ? ' (PocketBase JSON)' : ''}
        </h3>
        <div className="flex flex-col gap-2 overflow-y-auto custom-scrollbar flex-1 pr-1">
          {endpointRows.map((ep, i) => (
            <div
              key={`${ep.method}-${ep.path}-${i}`}
              className="flex items-center justify-between p-2.5 bg-surface-container-high/90 backdrop-blur-sm rounded-md border border-outline-variant/15 text-[10px] shrink-0"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 ${ep.color}`}>{ep.method}</span>
                <span className="font-mono text-on-surface-variant truncate">{ep.path}</span>
              </div>
              <ChevronRight size={12} className="text-outline-variant shrink-0 ml-2" />
            </div>
          ))}
        </div>
      </div>
    </div>
    ) : null}
  </div>
  );
};

function formatPbCreatedLabel(created: unknown): string {
  if (created == null) return '—';
  if (typeof created === 'string') return created.length >= 10 ? created.slice(0, 10) : created;
  return '—';
}

/** Etiqueta corta para tarjetas: prioriza `updated` si existe (PocketBase ISO). */
function formatPbUpdatedOrCreatedLabel(raw: Record<string, unknown>): string {
  const u = raw.updated ?? raw.created;
  return formatPbCreatedLabel(u);
}

function mapPbRecordsToProjectList(data: Record<string, unknown>[]): Project[] {
  const sorted = sortPbRecordsNewestFirst(data);
  return sorted.map((raw) => {
    const id = String(raw.id ?? '');
    return {
      id,
      name: String(raw.title ?? raw.name ?? 'Sin título'),
      status: 'Saludable' as const,
      endpoints: countEndpointsInPbRecord(raw),
      lastDeployed: formatPbUpdatedOrCreatedLabel(raw)
    };
  });
}

export default function App() {
  const [view, setView] = useState<View>('home');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isThemeEditorOpen, setIsThemeEditorOpen] = useState(false);
  const [editorProjectName, setEditorProjectName] = useState('Zeus Code Editor');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsFetchError, setProjectsFetchError] = useState<string | null>(null);
  const [projectsRefresh, setProjectsRefresh] = useState(0);
  const [pbSessionNonce, setPbSessionNonce] = useState(0);
  const [panelUser, setPanelUser] = useState<{ userName: string | null; userEmail: string | null }>(
    { userName: null, userEmail: null }
  );

  useEffect(() => {
    void loadAndApplyTheme();
  }, []);

  useEffect(() => {
    void requestPocketBaseSessionFromExtension().then(() => {
      setPbSessionNonce((n) => n + 1);
      setPanelUser(getZeusPocketBaseProfile());
    });
  }, []);

  useEffect(() => {
    const onAuth = (ev: Event) => {
      const ce = ev as CustomEvent<{
        loggedIn: boolean;
        userName?: string | null;
        userEmail?: string | null;
      }>;
      const d = ce.detail;
      if (!d) return;
      if (!d.loggedIn) {
        setPanelUser({ userName: null, userEmail: null });
        setProjectList([]);
        setProjectsFetchError(null);
        setSelectedProjectId(null);
        setView('home');
        setEditorProjectName('Zeus Code Editor');
        setIsModalOpen(false);
        setPbSessionNonce((n) => n + 1);
        return;
      }
      setPanelUser({
        userName: d.userName ?? getZeusPocketBaseProfile().userName,
        userEmail: d.userEmail ?? getZeusPocketBaseProfile().userEmail
      });
      setPbSessionNonce((n) => n + 1);
    };
    window.addEventListener('zeus-auth-changed', onAuth as EventListener);
    return () => window.removeEventListener('zeus-auth-changed', onAuth as EventListener);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setProjectsLoading(true);
    setProjectsFetchError(null);
    (async () => {
      try {
        if (isZeusCentralPanelInVsCode()) {
          const { projects, error } = await requestProjectsFromExtension();
          if (cancelled) return;
          if (error) {
            setProjectsFetchError(error);
            setProjectList([]);
            return;
          }
          setProjectList(mapPbRecordsToProjectList(projects));
          return;
        }

        const base = getZeusApiBase();
        const res = await fetch(`${base}/api/generate-api/projects`, {
          headers: getZeusPocketBaseRequestHeaders()
        });
        if (!res.ok) {
          if (!cancelled) {
            setProjectsFetchError(
              `No se pudo listar proyectos (HTTP ${res.status}). ¿API en marcha y PocketBase accesible?`
            );
            setProjectList([]);
          }
          return;
        }
        const data: unknown = await res.json();
        if (cancelled) return;
        if (!Array.isArray(data)) {
          setProjectList([]);
          return;
        }
        setProjectList(mapPbRecordsToProjectList(data as Record<string, unknown>[]));
      } catch (e) {
        if (!cancelled) {
          setProjectsFetchError(e instanceof Error ? e.message : 'Error de red al listar proyectos');
          setProjectList([]);
        }
      } finally {
        if (!cancelled) setProjectsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectsRefresh, pbSessionNonce]);

  const goToEditorFromProject = (projectId: string) => {
    const p = projectList.find((x) => x.id === projectId);
    setEditorProjectName(p?.name ?? projectId);
    setSelectedProjectId(projectId);
    setView('editor');
  };

  return (
    <div className={`flex flex-col bg-transparent ${view === 'editor' ? 'h-[100dvh] overflow-hidden min-h-0' : 'min-h-screen'}`}>
      <Sidebar
        currentView={view}
        onOpenEditorBlank={() => {
          setSelectedProjectId(null);
          setView('editor');
        }}
        onNewProject={() => setIsModalOpen(true)}
        onOpenSettings={() => setIsThemeEditorOpen(true)}
        userName={panelUser.userName}
        userEmail={panelUser.userEmail}
      />
      
      <div className={`2xl:ml-44 flex flex-col min-h-0 ${view === 'editor' ? 'flex-1 h-full overflow-hidden' : 'min-h-screen'}`}>
        <main className={`flex-1 min-h-0 ${view === 'editor' ? 'flex flex-col overflow-hidden' : ''}`}>
          {view === 'home' ? (
            <HomeView
              onStartNow={() => setIsModalOpen(true)}
              onProjectClick={goToEditorFromProject}
              projects={projectList}
              projectsLoading={projectsLoading}
              projectsError={projectsFetchError}
            />
          ) : (
            <EditorView
              projectName={editorProjectName}
              onBack={() => {
                setSelectedProjectId(null);
                setView('home');
              }}
              projectId={selectedProjectId}
              onProjectUpdated={() => setProjectsRefresh((x) => x + 1)}
              onNewProject={() => {
                setSelectedProjectId(null);
                setView('home');
                setIsModalOpen(true);
              }}
            />
          )}
        </main>
      </div>

      <NewApiModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={({ projectId, title }) => {
          setProjectsRefresh((x) => x + 1);
          setEditorProjectName(title);
          setSelectedProjectId(projectId);
          setView('editor');
        }}
      />

      <ThemeEditorModal
        isOpen={isThemeEditorOpen}
        onClose={() => {
          setIsThemeEditorOpen(false);
          void loadAndApplyTheme();
        }}
      />

      <div className="fixed bottom-0 right-0 w-[30%] h-[30%] bg-primary/5 blur-[60px] rounded-full pointer-events-none -z-10 opacity-50" />
    </div>
  );
}
