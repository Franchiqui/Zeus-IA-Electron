'use client';

/**
 * Marketplace de extensiones de Zeus (basado en Open VSX).
 *
 * Reemplaza al antiguo ExtensionsTab que invocaba el binario `code` del
 * sistema. Ahora las extensiones se descargan, instalan y ejecutan DENTRO
 * de Zeus — el extension host de @codingame/monaco-vscode-api las levanta
 * al iniciar la app.
 *
 * Tres áreas:
 *   1. Panel izquierdo — búsqueda en Open VSX + resultados instalables
 *   2. Centro — extensiones instaladas con enable/disable/uninstall
 *   3. Abajo — log de operaciones
 *
 * El estado del extension host (initZeusMonaco + loadInstalledExtensions)
 * se inicializa perezosamente al abrir esta pestaña por primera vez, vía
 * useEffect, para no penalizar el arranque de la app.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Puzzle,
  RefreshCw,
  Loader2,
  Trash2,
  Search,
  Terminal as TerminalIcon,
  X,
  CheckCircle2,
  XCircle,
  FileCode,
  Store,
  ExternalLink,
  AlertTriangle,
  Power,
  Info,
  BookOpen,
  X as XIcon,
  Download,
  Tag,
  Hash,
  Keyboard,
  Palette,
  Code2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from '@/components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  initZeusMonaco,
  isMonacoReady,
} from '@/lib/zeus-monaco/init';
import {
  listInstalled,
  installExtension,
  uninstallExtension,
  loadInstalledExtensions,
  readInstalledExtensionDetail,
  readOpenVsxExtensionDetail,
  type InstalledExtensionInfo,
  type InstalledExtensionDetail,
} from '@/lib/zeus-monaco/extensions';
import type { OpenVsxExtensionSummary, ZeusHostStatus } from '@/types/vscode-extensions';

type OperationKind = 'list' | 'install' | 'uninstall' | null;

interface LogEntry {
  stream: 'stdout' | 'stderr' | 'system';
  text: string;
  ts: number;
}

const MAX_LOG_ENTRIES = 500;

// =============================================================================
// Renderer de markdown (sustituto minimalista de react-markdown)
// =============================================================================
//
// Soporta el subconjunto de markdown que se usa típicamente en READMEs de
// extensiones VS Code: headings (h1-h3), párrafos, listas (- y 1.), code
// blocks con ```, inline code, **bold**, *italic*, [link](url), y separadores
// ---. Es deliberadamente pequeño: ~120 líneas, sin dependencias, sin HTML
// embebido (los <script> y <iframe> se renderizan como texto para evitar XSS).

interface MdToken {
  kind: 'h1' | 'h2' | 'h3' | 'h4' | 'p' | 'ul' | 'ol' | 'code' | 'hr';
  text: string;
  level?: number;
}

function tokenizeMarkdown(src: string): MdToken[] {
  const tokens: MdToken[] = [];
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Code block ```lang ... ```
    if (line.startsWith('```')) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        buf.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // saltar ```
      tokens.push({ kind: 'code', text: buf.join('\n') });
      continue;
    }
    // Heading
    const h = line.match(/^(#{1,4})\s+(.+)$/);
    if (h) {
      const level = h[1].length;
      const text = h[2].trim();
      tokens.push({ kind: level === 1 ? 'h1' : level === 2 ? 'h2' : level === 3 ? 'h3' : 'h4', text });
      i++;
      continue;
    }
    // Horizontal rule
    if (/^---+\s*$/.test(line)) {
      tokens.push({ kind: 'hr', text: '' });
      i++;
      continue;
    }
    // Lista no ordenada
    if (/^\s*[-*]\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      tokens.push({ kind: 'ul', text: buf.join('\n') });
      continue;
    }
    // Lista ordenada
    if (/^\s*\d+\.\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      tokens.push({ kind: 'ol', text: buf.join('\n') });
      continue;
    }
    // Párrafo (líneas no vacías hasta línea vacía)
    if (line.trim() !== '') {
      const buf: string[] = [line];
      i++;
      while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,4}\s|```|-{3,}|\s*[-*]\s|\s*\d+\.\s)/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      tokens.push({ kind: 'p', text: buf.join(' ') });
      continue;
    }
    // Línea vacía: saltar
    i++;
  }
  return tokens;
}

// Escapa HTML para evitar XSS
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Aplica inline: **bold**, *italic*, `code`, [text](url)
function renderInline(text: string): string {
  // Primero escapamos HTML
  let s = escapeHtml(text);
  // Code inline
  s = s.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');
  // Bold (** primero para no romper italic)
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic con * (después de bold, no queda conflicto)
  s = s.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
  // Links [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="md-link">$1</a>');
  return s;
}

function MarkdownRenderer({ source }: { source: string }) {
  const tokens = useMemo(() => tokenizeMarkdown(source), [source]);
  return (
    <div className="md-body space-y-3 text-sm text-foreground/70 leading-relaxed">
      {tokens.map((t, idx) => {
        switch (t.kind) {
          case 'h1':
            return <h1 key={idx} className="text-2xl font-bold text-foreground/90 mt-4 mb-2" dangerouslySetInnerHTML={{ __html: renderInline(t.text) }} />;
          case 'h2':
            return <h2 key={idx} className="text-lg font-semibold text-foreground/90 mt-4 mb-2 border-b border-border/80 pb-1" dangerouslySetInnerHTML={{ __html: renderInline(t.text) }} />;
          case 'h3':
            return <h3 key={idx} className="text-base font-semibold text-foreground/80 mt-3 mb-1" dangerouslySetInnerHTML={{ __html: renderInline(t.text) }} />;
          case 'h4':
            return <h4 key={idx} className="text-sm font-semibold text-foreground/80 mt-3 mb-1" dangerouslySetInnerHTML={{ __html: renderInline(t.text) }} />;
          case 'p':
            return <p key={idx} dangerouslySetInnerHTML={{ __html: renderInline(t.text) }} />;
          case 'code':
            return (
              <pre key={idx} className="bg-background border border-border/80 rounded-md p-3 overflow-x-auto text-xs font-mono text-foreground/80">
                <code>{t.text}</code>
              </pre>
            );
          case 'ul':
            return (
              <ul key={idx} className="list-disc pl-5 space-y-1">
                {t.text.split('\n').map((item, j) => (
                  <li key={j} dangerouslySetInnerHTML={{ __html: renderInline(item) }} />
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={idx} className="list-decimal pl-5 space-y-1">
                {t.text.split('\n').map((item, j) => (
                  <li key={j} dangerouslySetInnerHTML={{ __html: renderInline(item) }} />
                ))}
              </ol>
            );
          case 'hr':
            return <hr key={idx} className="border-border/80 my-4" />;
          default:
            return null;
        }
      })}
    </div>
  );
}

// =============================================================================
// Panel de detalle de extensión instalada
// =============================================================================

function ExtDetailPanel({
  detail,
  loading,
  error,
  iconUrl,
  isInstalled,
  onClose,
  onUninstall,
  onInstall,
}: {
  detail: InstalledExtensionDetail | null;
  loading: boolean;
  error: string | null;
  iconUrl?: string;
  isInstalled: boolean;
  onClose: () => void;
  onUninstall: (id: string, version: string) => void | Promise<void>;
  onInstall?: (id: string, version: string) => void | Promise<void>;
}) {
  const contributes = detail?.manifest.contributes ?? {};
  const themes = contributes.themes ?? [];
  const grammars = contributes.grammars ?? [];
  const snippets = contributes.snippets ?? [];
  const languages = contributes.languages ?? [];
  const commands = contributes.commands ?? [];
  const keybindings = contributes.keybindings ?? [];

  if (loading) {
    return (
      <Card className="bg-background border-border/80">
        <CardContent className="flex items-center justify-center py-16 text-muted-foreground/80">
          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
          Cargando documentación…
        </CardContent>
      </Card>
    );
  }

  if (error || !detail) {
    return (
      <Card className="bg-background border-border/80">
        <CardContent className="py-8 text-center">
          <XCircle className="w-8 h-8 mx-auto text-rose-400 mb-2" />
          <p className="text-sm text-rose-300">{error || 'No se pudo cargar el detalle.'}</p>
          <Button variant="outline" size="sm" onClick={onClose} className="mt-4">
            <XIcon className="w-3.5 h-3.5 mr-1" /> Cerrar
          </Button>
        </CardContent>
      </Card>
    );
  }

  const id = `${detail.manifest.publisher}.${detail.manifest.name}`;
  const displayName = detail.manifest.displayName || detail.manifest.name;

  return (
    <Card className="bg-background border-border/80 flex flex-col" style={{ minHeight: 'calc(100vh - 12rem)' }}>
      {/* Header con botón cerrar */}
      <CardHeader className="pb-3 border-b border-border/80 flex-shrink-0">
        <div className="flex items-start gap-3">
          <ExtensionIcon iconUrl={iconUrl} alt={displayName} size={48} className="flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg text-foreground/90 truncate">{displayName}</CardTitle>
              <span className="text-xs text-muted-foreground/80 font-mono flex-shrink-0">v{detail.version}</span>
            </div>
            <CardDescription className="text-muted-foreground/80 font-mono text-xs mt-0.5">
              {id} · {detail.manifest.publisher}
            </CardDescription>
            {detail.manifest.description && (
              <p className="text-xs text-muted-foreground mt-2">{detail.manifest.description}</p>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {!isInstalled && onInstall && (
              <Button
                size="sm"
                variant="default"
                onClick={() => onInstall(id, detail.version)}
                className="bg-success hover:bg-success text-foreground h-8"
                title="Instalar esta extensión"
              >
                <Download className="w-3.5 h-3.5 mr-1" />
                Instalar
              </Button>
            )}
            {isInstalled && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onUninstall(id, detail.version)}
                className="text-muted-foreground hover:text-rose-400 h-8"
                title="Desinstalar esta extensión"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1" />
                Desinstalar
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground h-8 w-8"
              title="Cerrar panel de documentación"
            >
              <XIcon className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      {/* Body con scroll */}
      <CardContent className="flex-1 overflow-auto p-6 space-y-6">
        {/* Resumen de contributes */}
        {(themes.length > 0 || grammars.length > 0 || snippets.length > 0 ||
          languages.length > 0 || commands.length > 0 || keybindings.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {themes.length > 0 && (
              <Card className="bg-background border-border/80">
                <CardHeader className="pb-1 pt-3">
                  <CardTitle className="text-xs text-foreground/70 flex items-center gap-1.5">
                    <Palette className="w-3.5 h-3.5 text-violet-400" />
                    Temas ({themes.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-1 pb-3 text-xs text-muted-foreground space-y-0.5">
                  {themes.map((t) => (
                    <div key={t.id} className="font-mono">· {t.label} <span className="text-muted-foreground/60">({t.id})</span></div>
                  ))}
                </CardContent>
              </Card>
            )}
            {languages.length > 0 && (
              <Card className="bg-background border-border/80">
                <CardHeader className="pb-1 pt-3">
                  <CardTitle className="text-xs text-foreground/70 flex items-center gap-1.5">
                    <Code2 className="w-3.5 h-3.5 text-primary" />
                    Lenguajes ({languages.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-1 pb-3 text-xs text-muted-foreground space-y-0.5">
                  {languages.map((l) => (
                    <div key={l.id} className="font-mono">· {l.id} {l.aliases && <span className="text-muted-foreground/60">({l.aliases.join(', ')})</span>}</div>
                  ))}
                </CardContent>
              </Card>
            )}
            {grammars.length > 0 && (
              <Card className="bg-background border-border/80">
                <CardHeader className="pb-1 pt-3">
                  <CardTitle className="text-xs text-foreground/70 flex items-center gap-1.5">
                    <Hash className="w-3.5 h-3.5 text-cyan-400" />
                    Gramáticas ({grammars.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-1 pb-3 text-xs text-muted-foreground space-y-0.5">
                  {grammars.map((g) => (
                    <div key={g.scopeName} className="font-mono">· {g.language} → {g.scopeName}</div>
                  ))}
                </CardContent>
              </Card>
            )}
            {snippets.length > 0 && (
              <Card className="bg-background border-border/80">
                <CardHeader className="pb-1 pt-3">
                  <CardTitle className="text-xs text-foreground/70 flex items-center gap-1.5">
                    <Code2 className="w-3.5 h-3.5 text-success" />
                    Snippets ({snippets.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-1 pb-3 text-xs text-muted-foreground space-y-0.5">
                  {snippets.map((s) => (
                    <div key={s.path} className="font-mono">· {s.language}</div>
                  ))}
                </CardContent>
              </Card>
            )}
            {commands.length > 0 && (
              <Card className="bg-background border-border/80">
                <CardHeader className="pb-1 pt-3">
                  <CardTitle className="text-xs text-foreground/70 flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5 text-amber-400" />
                    Comandos ({commands.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-1 pb-3 text-xs text-muted-foreground space-y-0.5 max-h-32 overflow-auto">
                  {commands.map((c) => (
                    <div key={c.command} className="font-mono break-all">· {c.command}</div>
                  ))}
                </CardContent>
              </Card>
            )}
            {keybindings.length > 0 && (
              <Card className="bg-background border-border/80">
                <CardHeader className="pb-1 pt-3">
                  <CardTitle className="text-xs text-foreground/70 flex items-center gap-1.5">
                    <Keyboard className="w-3.5 h-3.5 text-pink-400" />
                    Keybindings ({keybindings.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-1 pb-3 text-xs text-muted-foreground space-y-0.5 max-h-32 overflow-auto">
                  {keybindings.map((k, i) => (
                    <div key={i} className="font-mono">· <span className="text-pink-300">{k.key}</span> → {k.command}</div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* README */}
        {detail.readme ? (
          <div>
            <h3 className="text-sm font-semibold text-foreground/70 mb-3 flex items-center gap-1.5">
              <BookOpen className="w-4 h-4 text-muted-foreground/80" />
              README
            </h3>
            <MarkdownRenderer source={detail.readme} />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground/60 italic">Esta extensión no incluye README.</p>
        )}

        {/* CHANGELOG (colapsado si existe) */}
        {detail.changelog && (
          <details className="border-t border-border/80 pt-4">
            <summary className="text-sm font-semibold text-foreground/70 cursor-pointer hover:text-foreground flex items-center gap-1.5">
              <Download className="w-4 h-4 text-muted-foreground/80" />
              CHANGELOG
            </summary>
            <div className="mt-3">
              <MarkdownRenderer source={detail.changelog} />
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

function formatTs(ts: number): string {
  return new Date(ts).toLocaleTimeString('es-ES', { hour12: false });
}

function formatRelativeFromNow(ts: number): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'hace menos de 1 min';
  if (diff < 3_600_000) return `hace ${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `hace ${Math.floor(diff / 3_600_000)} h`;
  return `hace ${Math.floor(diff / 86_400_000)} d`;
}

// =============================================================================
// ExtensionIcon
// =============================================================================

/**
 * Muestra el icono de una extensión. Si falla la carga o no hay URL,
 * muestra el icono Puzzle por defecto.
 */
function ExtensionIcon({
  iconUrl,
  alt,
  size = 32,
  className,
}: {
  iconUrl?: string;
  alt: string;
  size?: number;
  className?: string;
}) {
  const [errored, setErrored] = useState(false);
  // Resetear error si cambia la URL
  useEffect(() => setErrored(false), [iconUrl]);

  if (!iconUrl || errored) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-md bg-card border border-border/50 text-muted-foreground',
          className,
        )}
        style={{ width: size, height: size }}
        title={alt}
      >
        <Puzzle style={{ width: Math.round(size * 0.55), height: Math.round(size * 0.55) }} />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={iconUrl}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setErrored(true)}
      className={cn('rounded-md object-cover bg-card', className)}
      style={{ width: size, height: size }}
    />
  );
}

/**
 * Resuelve la URL del icono de una extensión en Open VSX.
 * Devuelve `null` si no se puede (sin red, no existe, etc.). El resultado
 * se cachea a nivel de módulo durante la vida de la app.
 */
const installedIconCache = new Map<string, string | null>();
const inFlight = new Map<string, Promise<string | null>>();

async function fetchInstalledIconUrl(id: string): Promise<string | null> {
  if (installedIconCache.has(id)) return installedIconCache.get(id) ?? null;
  if (inFlight.has(id)) return inFlight.get(id)!;

  const m = id.match(/^([a-zA-Z0-9_.-]+)\.([a-zA-Z0-9_.-]+)$/);
  if (!m) {
    installedIconCache.set(id, null);
    return null;
  }
  const promise = (async () => {
    try {
      const res = await fetch(`https://open-vsx.org/api/${m[1]}/${m[2]}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data?.files?.icon ?? null;
    } catch {
      return null;
    } finally {
      inFlight.delete(id);
    }
  })();
  inFlight.set(id, promise);
  const result = await promise;
  installedIconCache.set(id, result);
  return result;
}

export default function MarketplaceTab() {
  const { toast } = useToast();

  // Host state
  const [hostStatus, setHostStatus] = useState<ZeusHostStatus>('uninitialized');
  const [hostError, setHostError] = useState<string | null>(null);

  // Extensions
  const [installed, setInstalled] = useState<InstalledExtensionInfo[]>([]);
  /**
   * Mapa id → URL de icono en Open VSX. Las entradas ausentes significan
   * "aún no cargado" o "no tiene icono". El useEffect de abajo rellena las
   * que faltan. No guardamos `null` para mantener el tipo `Record<string, string>`.
   */
  const [installedIcons, setInstalledIcons] = useState<Record<string, string>>({});
  const [lastFetch, setLastFetch] = useState<number>(0);
  const [operation, setOperation] = useState<OperationKind>(null);

  /**
   * Panel de documentación: si está set, el panel central muestra la
   * información de esta extensión (README, contributes, etc.) en vez de
   * las Cards de Instaladas / Instalar por ID / Logs.
   */
  const [extDetail, setExtDetail] = useState<InstalledExtensionDetail | null>(null);
  const [extDetailLoading, setExtDetailLoading] = useState(false);
  const [extDetailError, setExtDetailError] = useState<string | null>(null);

  // Marketplace search
  // Persistimos el último query en localStorage para que al volver a la
  // pestaña (o tras un reload) se muestre lo que el usuario estaba buscando.
  // Usamos un lazy initializer para que el primer render ya tenga el valor
  // restaurado y no se vea el input "vacío" durante un instante.
  const [searchQuery, setSearchQuery] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    try {
      return window.localStorage.getItem('zeus.marketplace.lastQuery') ?? '';
    } catch {
      return '';
    }
  });
  const [searchResults, setSearchResults] = useState<OpenVsxExtensionSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchingMore, setSearchingMore] = useState(false);
  /**
   * Si es true, la siguiente petición traerá más resultados (no reemplaza la
   * lista). Si es false, es una búsqueda nueva y reemplaza.
   */
  const [hasMore, setHasMore] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  /** Versión incremental del query: si cambia, se reinicia la paginación. */
  const [searchEpoch, setSearchEpoch] = useState(0);
  /**
   * Ref al <div> sentinel al final de la lista. Cuando entra en el viewport,
   * cargamos la siguiente página.
   */
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Installed tab
  const [installedFilter, setInstalledFilter] = useState('');

  // Logs
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const isBusy = operation !== null;

  // Helpers
  const appendLog = useCallback((stream: LogEntry['stream'], text: string) => {
    if (!text) return;
    setLogs((prev) => {
      const next = [...prev, { stream, text, ts: Date.now() }];
      return next.length > MAX_LOG_ENTRIES ? next.slice(next.length - MAX_LOG_ENTRIES) : next;
    });
  }, []);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [logs]);

  // Inicialización: al montar la pestaña, inicializar el host y cargar extensiones.
  useEffect(() => {
    if (hostStatus !== 'uninitialized') return;

    setHostStatus('initializing');
    appendLog('system', '> Inicializando extension host de Zeus…');

    (async () => {
      try {
        await initZeusMonaco();
        setHostStatus('ready');
        appendLog('stdout', 'Extension host listo.');

        // Cargar extensiones instaladas
        appendLog('system', '> Cargando extensiones instaladas…');
        const loaded = await loadInstalledExtensions();
        setInstalled(loaded);
        setLastFetch(Date.now());
        appendLog('stdout', `${loaded.length} extensión(es) cargada(s).`);
        // Avisar al ThemePicker y a cualquier listener: las extensiones
        // cambiaron (cargadas, no instaladas). Sin esto, el ThemePicker
        // queda con su lista vacía tras un reinicio (el host se llena,
        // pero el picker ya se montó y no se entera).
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('zeus:extensions-changed', { detail: { loaded: true, count: loaded.length } }));
        }
      } catch (err: any) {
        setHostStatus('error');
        setHostError(err?.message || String(err));
        appendLog('stderr', `Error: ${err?.message || err}`);
        toast({
          title: 'Extension host no pudo inicializar',
          description: err?.message || String(err),
          variant: 'destructive',
        });
      }
    })();
  }, [hostStatus, appendLog, toast]);

  // Cargar iconos de Open VSX para las extensiones instaladas. Es lazy: solo
  // para las que aún no tenemos en caché. Las peticiones se deduplican vía
  // el Map inFlight del módulo.
  useEffect(() => {
    const missing = installed.filter((e) => !(e.id in installedIcons));
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const updates: Record<string, string> = {};
      await Promise.all(
        missing.map(async (e) => {
          const url = await fetchInstalledIconUrl(e.id);
          if (url) updates[e.id] = url;
        }),
      );
      if (cancelled || Object.keys(updates).length === 0) return;
      setInstalledIcons((prev) => ({ ...prev, ...updates }));
    })();
    return () => {
      cancelled = true;
    };
  }, [installed, installedIcons]);

  // Persistir el query de búsqueda cada vez que cambia. Si el usuario ya
  // tenía un query guardado, no re-buscamos en cada keystroke (sería spam):
  // la búsqueda se re-lanza una sola vez al montar (más abajo).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (searchQuery.trim()) {
        window.localStorage.setItem('zeus.marketplace.lastQuery', searchQuery);
      } else {
        window.localStorage.removeItem('zeus.marketplace.lastQuery');
      }
    } catch {
      // localStorage puede fallar en modo incógnito / sin permisos — ignorar
    }
  }, [searchQuery]);

  // Al montar, si hay un query guardado en localStorage, re-lanzar la búsqueda
  // para mostrar los resultados sin que el usuario tenga que pulsar Enter.
  // Solo se ejecuta UNA vez por montaje (deps vacías).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const last = window.localStorage.getItem('zeus.marketplace.lastQuery');
      if (last && last.trim()) {
        // El state ya tiene el valor (lazy init), solo re-disparamos la búsqueda.
        handleSearch();
      }
    } catch {
      // ignorar
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refrescar lista de instaladas
  const refreshInstalled = useCallback(async () => {
    setOperation('list');
    appendLog('system', '> Listando extensiones instaladas…');
    try {
      const list = await listInstalled();
      setInstalled(list);
      setLastFetch(Date.now());
      appendLog('stdout', `${list.length} extensión(es) instalada(s).`);
    } catch (err: any) {
      appendLog('stderr', `Error: ${err?.message || err}`);
    } finally {
      setOperation(null);
    }
  }, [appendLog]);

  // Búsqueda en Open VSX con paginación (scroll infinito).
  // Tamaño fijo de página: 50. `append=false` reemplaza la lista (búsqueda
  // nueva); `append=true` concatena al final (scroll infinito). El tamaño de
  // página no es configurable porque Open VSX lo cape alrededor de 100.
  const SEARCH_PAGE_SIZE = 50;

  const handleSearch = useCallback(
    async (append = false) => {
      const q = searchQuery.trim();
      if (!q) return;
      if (append) {
        setSearchingMore(true);
      } else {
        setSearching(true);
        setSearchError(null);
        setSearchResults([]);
        setHasMore(false);
        appendLog('system', `> Buscando "${q}" en Open VSX…`);
      }
      try {
        const offset = append ? searchResults.length : 0;
        const url = `https://open-vsx.org/api/-/search?query=${encodeURIComponent(q)}&size=${SEARCH_PAGE_SIZE}&offset=${offset}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Open VSX devolvió HTTP ${res.status}`);
        const data = await res.json();
        const results: OpenVsxExtensionSummary[] = data.extensions || [];
        setSearchResults((prev) => (append ? [...prev, ...results] : results));
        // Si la página vino llena, asumimos que puede haber más.
        // Si vino más corta, no hay más.
        setHasMore(results.length >= SEARCH_PAGE_SIZE);
        if (append) {
          appendLog('stdout', `+${results.length} más (acumulado: ${searchResults.length + results.length}).`);
        } else {
          appendLog('stdout', `Encontradas ${results.length} extensión(es) para "${q}" (página inicial).`);
        }
      } catch (err: any) {
        const msg = err?.message || String(err);
        setSearchError(msg);
        if (!append) {
          appendLog('stderr', `Error en búsqueda: ${msg}`);
          setSearchResults([]);
        }
      } finally {
        setSearching(false);
        setSearchingMore(false);
      }
    },
    [searchQuery, searchResults.length, appendLog],
  );

  // Scroll infinito: cuando el sentinel entra en el viewport, cargamos la
  // siguiente página. Se re-engancha cada vez que cambia `hasMore` o
  // `searchingMore` (p.ej. cuando termina una carga).
  // Usamos `root: null` para que el observer use el viewport (la región con
  // scroll real está dentro del ScrollArea → Viewport de radix).
  useEffect(() => {
    if (!hasMore || searching || searchingMore) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            handleSearch(true);
            break;
          }
        }
      },
      { rootMargin: '200px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, searching, searchingMore, searchEpoch, handleSearch]);

  // Instalar desde resultados de búsqueda
  const handleInstall = useCallback(async (summary: OpenVsxExtensionSummary) => {
    const id = `${summary.namespace}.${summary.name}`;
    setOperation('install');
    appendLog('system', `> Instalando ${id}@${summary.latestVersion || 'latest'}…`);
    try {
      const result = await installExtension(id);
      if (!result.success) {
        appendLog('stderr', `Error: ${result.error}`);
        toast({ title: 'Instalación fallida', description: result.error, variant: 'destructive' });
        return;
      }
      appendLog('stdout', result.alreadyInstalled ? `${id} ya estaba instalado.` : `${id}@${result.version} instalado.`);
      toast({
        title: result.alreadyInstalled ? 'Ya estaba instalado' : 'Instalación completada',
        description: `${id}@${result.version}`,
      });
      // Refrescar lista y recargar extensiones en el host
      await refreshInstalled();
      // Releer en el host para activar la nueva extensión
      appendLog('system', '> Recargando extension host…');
      await loadInstalledExtensions(true);
      // Avisar a componentes que escuchan cambios en el host (ThemePicker, etc.)
      window.dispatchEvent(new CustomEvent('zeus:extensions-changed', { detail: { id, version: result.version } }));
    } catch (err: any) {
      const msg = err?.message || String(err);
      appendLog('stderr', `Error: ${msg}`);
      toast({ title: 'Error', description: msg, variant: 'destructive' });
    } finally {
      setOperation(null);
    }
  }, [appendLog, refreshInstalled, toast]);

  // Abrir el panel de documentación de una extensión.
  // Si `installed` es true, lee del .vsix local (rápido). Si no, consulta
  // Open VSX directamente (un poco más lento pero no requiere instalar).
  const openExtDetail = useCallback(
    async (id: string, version: string | undefined, installed: boolean) => {
      setExtDetail(null);
      setExtDetailError(null);
      setExtDetailLoading(true);
      try {
        const detail = installed
          ? await readInstalledExtensionDetail(id, version || '')
          : await readOpenVsxExtensionDetail(id, version);
        if (!detail) {
          setExtDetailError('No se pudo leer la información de la extensión.');
          return;
        }
        setExtDetail(detail);
      } catch (err: any) {
        setExtDetailError(err?.message || String(err));
      } finally {
        setExtDetailLoading(false);
      }
    },
    [],
  );

  const closeExtDetail = useCallback(() => {
    setExtDetail(null);
    setExtDetailError(null);
  }, []);

  // Desinstalar
  const handleUninstall = useCallback(async (ext: InstalledExtensionInfo) => {
    const ok = window.confirm(`¿Desinstalar "${ext.id}" de Zeus?`);
    if (!ok) return;
    setOperation('uninstall');
    appendLog('system', `> Desinstalando ${ext.id}…`);
    try {
      const result = await uninstallExtension(ext.id);
      if (!result.success) {
        appendLog('stderr', `Error: ${result.error}`);
        toast({ title: 'Desinstalación fallida', description: result.error, variant: 'destructive' });
        return;
      }
      appendLog('stdout', `${ext.id} desinstalado.`);
      toast({ title: 'Desinstalación completada', description: ext.id });
      await refreshInstalled();
      appendLog('system', '> Recargando extension host…');
      await loadInstalledExtensions(true);
      window.dispatchEvent(new CustomEvent('zeus:extensions-changed', { detail: { id: ext.id, uninstalled: true } }));
    } catch (err: any) {
      const msg = err?.message || String(err);
      appendLog('stderr', `Error: ${msg}`);
      toast({ title: 'Error', description: msg, variant: 'destructive' });
    } finally {
      setOperation(null);
    }
  }, [appendLog, refreshInstalled, toast]);

  const clearLogs = useCallback(() => setLogs([]), []);

  // Filtro local de instaladas
  const filteredInstalled = useMemo(() => {
    if (!installedFilter.trim()) return installed;
    const q = installedFilter.toLowerCase();
    return installed.filter(
      (e) =>
        e.id.toLowerCase().includes(q) ||
        e.displayName.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q),
    );
  }, [installed, installedFilter]);

  return (
    <div className="flex flex-col h-full w-full bg-transparent">
      {/* Header */}
      <div className="flex items-center justify-between bg-background border-b border-border/80 px-6 py-2">
        <div className="flex items-center gap-3">
          <Puzzle className="w-4 h-4 text-violet-400" />
          <h2 className="text-sm font-semibold text-foreground/90">Marketplace Zeus</h2>
          <Badge variant="outline" className="border-border/50 text-foreground/70 text-xs">
            {installed.length} instalada(s)
          </Badge>
          {hostStatus === 'ready' && (
            <Badge className="bg-success/10 text-emerald-300 border-emerald-500/30 text-xs">
              <CheckCircle2 className="w-3 h-3 mr-1" />
              host listo
            </Badge>
          )}
          {hostStatus === 'initializing' && (
            <Badge className="bg-primary/10 text-primary-foreground border-blue-500/30 text-xs">
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              inicializando
            </Badge>
          )}
          {hostStatus === 'error' && (
            <Badge variant="destructive" className="text-xs">
              <XCircle className="w-3 h-3 mr-1" />
              host con error
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={refreshInstalled}
            disabled={isBusy || hostStatus !== 'ready'}
            className="border-border/50 text-foreground/70 hover:text-foreground h-7 text-xs"
            title="Volver a listar las extensiones instaladas"
          >
            {operation === 'list' ? (
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="w-3 h-3 mr-1" />
            )}
            Actualizar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={clearLogs}
            disabled={logs.length === 0}
            className="border-border/50 text-foreground/70 hover:text-foreground h-7 text-xs"
            title="Limpiar el panel de logs"
          >
            <X className="w-3 h-3 mr-1" />
            Limpiar logs
          </Button>
        </div>
      </div>

      {/* Banners de error */}
      {hostStatus === 'error' && hostError && (
        <div className="px-6 pt-4">
          <Alert variant="destructive" className="bg-red-900/30 border-red-700/50">
            <XCircle className="w-4 h-4" />
            <AlertTitle>El extension host no pudo inicializar</AlertTitle>
            <AlertDescription>
              {hostError}
              <br />
              <span className="text-xs text-red-200/70">
                Reinicia la app (Ctrl+R) o revisa la consola del renderer para
                más detalles.
              </span>
            </AlertDescription>
          </Alert>
        </div>
      )}
      {!isMonacoReady() && hostStatus === 'uninitialized' && (
        <div className="px-6 pt-4">
          <Alert className="bg-amber-900/30 border-amber-700/50">
            <AlertTriangle className="w-4 h-4 text-amber-300" />
            <AlertTitle className="text-amber-200">¿Fuera de Electron?</AlertTitle>
            <AlertDescription className="text-amber-100/90">
              Las APIs de extensiones (<code>window.electronAPI.zeusExtensions</code>)
              no están disponibles. Esta pestaña solo funciona dentro de la app
              empaquetada de Zeus, no en el navegador.
            </AlertDescription>
          </Alert>
        </div>
      )}

      {/* Banner de limitaciones del host propio */}
      <div className="px-6 pt-4">
        <Alert className="bg-background/40 border-border/50/60">
          <Info className="w-4 h-4 text-foreground/70" />
          <AlertTitle className="text-foreground/80">Limitaciones del host</AlertTitle>
          <AlertDescription className="text-foreground/70/90 text-xs">
            El código JavaScript de la extensión no se ejecuta. Las extensiones se instalan y sus
            temas, snippets, gramáticas y keybindings se aplican al editor de Monaco.
          </AlertDescription>
        </Alert>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Panel izquierdo: búsqueda */}
        <div className="w-80 flex-shrink-0 border-r border-border/80 bg-background/50 flex flex-col">
          <div className="p-4 border-b border-border/80">
            <div className="flex items-center gap-2 mb-3">
              <Store className="w-4 h-4 text-violet-400" />
              <h3 className="text-sm font-semibold text-foreground/90">Open VSX</h3>
            </div>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/80" />
              <Input
                placeholder="Buscar extensiones…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setSearchEpoch((e2) => e2 + 1);
                    handleSearch();
                  }
                }}
                className="pl-8 h-9 text-sm bg-background border-border/50 text-foreground/80"
              />
            </div>
            <Button
              onClick={() => {
                setSearchEpoch((e) => e + 1);
                handleSearch();
              }}
              disabled={searching || !searchQuery.trim()}
              className="w-full mt-2 bg-violet-600 hover:bg-violet-500 text-foreground text-xs h-8"
            >
              {searching ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Search className="w-3.5 h-3.5 mr-1.5" />
              )}
              Buscar
            </Button>
            {searchError && (
              <p className="text-xs text-rose-400 mt-2">{searchError}</p>
            )}
          </div>
          <ScrollArea className="flex-1">
            {searchResults.length === 0 && !searching ? (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <Store className="w-10 h-10 text-gray-700 mb-3" />
                <p className="text-sm text-muted-foreground/80">
                  Busca extensiones en Open VSX
                </p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Marketplace libre, compatible con VS Code
                </p>
              </div>
            ) : searching && searchResults.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-violet-400" />
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {searchResults.map((ext) => {
                  const id = `${ext.namespace}.${ext.name}`;
                  const isInstalled = installed.some((i) => i.id === id);
                  // Open VSX no devuelve `iconUrl` plano en /api/-/search — viene
                  // dentro de `files.icon`. El componente ExtensionIcon hace
                  // fallback a Puzzle si falla.
                  const iconUrl = ext.iconUrl ?? ext.files?.icon;
                  return (
                    <div
                      key={id}
                      className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-card/60 cursor-pointer transition-colors group"
                      onClick={() => !isInstalled && handleInstall(ext)}
                      title={isInstalled ? 'Ya instalada' : 'Click para instalar'}
                    >
                      <ExtensionIcon
                        iconUrl={iconUrl}
                        alt={ext.displayName || ext.name}
                        size={36}
                        className="flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium text-foreground/80 truncate">
                            {ext.displayName || ext.name}
                          </span>
                          {isInstalled && (
                            <CheckCircle2 className="w-3 h-3 text-success flex-shrink-0" />
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              openExtDetail(
                                `${ext.namespace}.${ext.name}`,
                                ext.version,
                                isInstalled,
                              );
                            }}
                            className="h-5 w-5 text-muted-foreground hover:text-cyan-400 hover:bg-cyan-500/10 flex-shrink-0 p-0"
                            title="Ver documentación de la extensión"
                          >
                            <BookOpen className="w-3 h-3" />
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground/80 truncate mt-0.5">
                          {ext.publisher?.displayName || ext.namespace}
                        </p>
                        {ext.description && (
                          <p className="text-[11px] text-muted-foreground/60 line-clamp-2 mt-1">
                            {ext.description}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-1.5">
                          {ext.latestVersion && (
                            <span className="text-[10px] text-muted-foreground/60 font-mono">
                              v{ext.latestVersion}
                            </span>
                          )}
                          {ext.downloadCount != null && (
                            <span className="text-[10px] text-muted-foreground/60">
                              ↓ {ext.downloadCount.toLocaleString('es-ES')}
                            </span>
                          )}
                          {!isInstalled && (
                            <Badge
                              variant="outline"
                              className="text-[10px] h-4 px-1.5 border-emerald-700/50 text-success opacity-0 group-hover:opacity-100 transition-opacity ml-auto"
                            >
                              Instalar
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {/* Sentinel para el IntersectionObserver del scroll infinito */}
                <div
                  ref={sentinelRef}
                  className="h-1"
                  aria-hidden
                />
                {/* Indicador de carga / fin */}
                {searchingMore ? (
                  <div className="flex items-center justify-center py-3 text-xs text-muted-foreground/80">
                    <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                    Cargando más…
                  </div>
                ) : hasMore ? (
                  <div className="text-center py-3 text-[10px] text-muted-foreground/60">
                    Desplaza para cargar más
                  </div>
                ) : searchResults.length > 0 ? (
                  <div className="text-center py-3 text-[10px] text-muted-foreground/60">
                    — Fin de los resultados —
                  </div>
                ) : null}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Centro: si hay un detalle abierto, ocupa todo el ancho; si no, las 3 Cards */}
        <div className="flex-1 overflow-auto p-6">
          {extDetail !== null || extDetailLoading || extDetailError ? (
            <ExtDetailPanel
              detail={extDetail}
              loading={extDetailLoading}
              error={extDetailError}
              iconUrl={extDetail ? installedIcons[extDetail.id] : undefined}
              isInstalled={extDetail ? installed.some((i) => i.id === extDetail.id) : false}
              onClose={closeExtDetail}
              onInstall={async (id, version) => {
                const fakeSummary: OpenVsxExtensionSummary = {
                  namespace: id.split('.')[0],
                  name: id.split('.').slice(1).join('.'),
                  latestVersion: version,
                };
                closeExtDetail();
                await handleInstall(fakeSummary);
              }}
              onUninstall={async (id, version) => {
                const fakeExt: InstalledExtensionInfo = {
                  id,
                  namespace: id.split('.')[0],
                  name: id.split('.').slice(1).join('.'),
                  version,
                  displayName: extDetail?.manifest.displayName || id,
                  description: extDetail?.manifest.description || '',
                  engines: extDetail?.manifest.engines as any,
                  categories: (extDetail?.manifest as any)?.categories || [],
                  path: '',
                };
                closeExtDetail();
                await handleUninstall(fakeExt);
              }}
            />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Card: instaladas */}
            <Card className="bg-background border-border/80">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base text-foreground/90">Instaladas</CardTitle>
                  <div className="relative w-56">
                    <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/80" />
                    <Input
                      placeholder="Buscar…"
                      value={installedFilter}
                      onChange={(e) => setInstalledFilter(e.target.value)}
                      className="pl-7 h-8 text-xs bg-background border-border/50 text-foreground/80"
                    />
                  </div>
                </div>
                <CardDescription className="text-muted-foreground/80">
                  {lastFetch
                    ? `Actualizado ${formatRelativeFromNow(lastFetch)}`
                    : 'Cargando…'}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-2">
                {hostStatus === 'initializing' ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground/80">
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Inicializando extension host…
                  </div>
                ) : filteredInstalled.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/80">
                    <Puzzle className="w-8 h-8 mb-2 opacity-30" />
                    <p className="text-sm">
                      {installed.length === 0
                        ? 'No hay extensiones instaladas en Zeus.'
                        : 'Sin resultados para la búsqueda.'}
                    </p>
                  </div>
                ) : (
                  <ScrollArea className="h-[calc(100vh-30rem)] min-h-[260px]">
                    <div className="space-y-1">
                      {filteredInstalled.map((ext) => (
                        <div
                          key={`${ext.id}@${ext.version}`}
                          className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-card/40 group"
                        >
                          <ExtensionIcon
                            iconUrl={installedIcons[ext.id]}
                            alt={ext.displayName}
                            size={32}
                            className="flex-shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm text-foreground/90 font-medium truncate">
                                {ext.displayName}
                              </span>
                              <span className="text-[10px] text-muted-foreground/80 font-mono">
                                v{ext.version}
                              </span>
                            </div>
                            <p className="text-[10px] text-muted-foreground/80 truncate font-mono">
                              {ext.id}
                            </p>
                            {ext.description && (
                              <p className="text-[11px] text-muted-foreground/60 line-clamp-2 mt-0.5">
                                {ext.description}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                openExtDetail(ext.id, ext.version, true);
                              }}
                              disabled={isBusy}
                              className="h-7 w-7 text-muted-foreground hover:text-cyan-400"
                              title="Ver documentación de la extensión"
                            >
                              <BookOpen className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleUninstall(ext);
                              }}
                              disabled={isBusy}
                              className="h-7 w-7 text-muted-foreground hover:text-rose-400"
                              title="Desinstalar extensión"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>

            {/* Card: instalar por id manual */}
            <Card className="bg-background border-border/80">
              <CardHeader className="pb-2">
                <CardTitle className="text-base text-foreground/90 flex items-center gap-2">
                  <FileCode className="w-4 h-4 text-success" />
                  Instalar por ID
                </CardTitle>
                <CardDescription className="text-muted-foreground/80">
                  Si conoces el id exacto (publisher.name) de la extensión.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ManualInstallForm
                  onInstall={async (id) => {
                    const fakeSummary: OpenVsxExtensionSummary = {
                      namespace: id.split('.')[0],
                      name: id.split('.').slice(1).join('.'),
                    };
                    await handleInstall(fakeSummary);
                  }}
                  isBusy={isBusy}
                />
              </CardContent>
            </Card>

            {/* Card: logs */}
            <Card className="bg-background border-border/80 lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base text-foreground/90 flex items-center gap-2">
                  <TerminalIcon className="w-4 h-4 text-muted-foreground" />
                  Logs de operación
                </CardTitle>
                <CardDescription className="text-muted-foreground/80">
                  Salida del extension host y del instalador.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div
                  className={cn(
                    'bg-background border border-border/80 rounded-md p-3 font-mono text-xs leading-5',
                    'h-64 overflow-auto',
                  )}
                >
                  {logs.length === 0 ? (
                    <span className="text-muted-foreground/60">
                      (sin actividad — las operaciones aparecerán aquí)
                    </span>
                  ) : (
                    logs.map((log, i) => (
                      <div
                        key={i}
                        className={cn(
                          'whitespace-pre-wrap break-words',
                          log.stream === 'stderr' && 'text-rose-300',
                          log.stream === 'stdout' && 'text-emerald-300',
                          log.stream === 'system' && 'text-muted-foreground/80',
                        )}
                      >
                        <span className="text-muted-foreground/60 mr-2">[{formatTs(log.ts)}]</span>
                        {log.text}
                      </div>
                    ))
                  )}
                  <div ref={logsEndRef} />
                </div>
              </CardContent>
            </Card>
          </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Formulario pequeño para instalar por id manual.
 */
function ManualInstallForm({
  onInstall,
  isBusy,
}: {
  onInstall: (id: string) => Promise<void>;
  isBusy: boolean;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const id = value.trim();
    if (!id) {
      setError('Introduce un id');
      return;
    }
    if (!/^[a-zA-Z0-9_.-]+\.[a-zA-Z0-9_.-]+$/.test(id)) {
      setError('Formato inválido. Usa "publisher.name"');
      return;
    }
    setError(null);
    await onInstall(id);
    setValue('');
  };

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        <label
          htmlFor="zeus-vsx-id-input"
          className="text-xs uppercase tracking-wider text-muted-foreground/80"
        >
          publisher.name
        </label>
        <Input
          id="zeus-vsx-id-input"
          placeholder="ej. catppuccin.catppuccin-vsc"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !isBusy) handleSubmit();
          }}
          className="bg-background border-border/50 text-foreground/90 font-mono text-sm"
        />
      </div>
      {error && <p className="text-xs text-rose-400">{error}</p>}
      <Button
        onClick={handleSubmit}
        disabled={isBusy || !value.trim()}
        className="w-full bg-success hover:bg-success text-foreground"
      >
        {isBusy ? (
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        ) : (
          <Puzzle className="w-4 h-4 mr-2" />
        )}
        Instalar
      </Button>
    </div>
  );
}
