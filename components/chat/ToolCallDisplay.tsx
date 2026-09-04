'use client';
import React, { useState, useMemo } from 'react';
import { useChatMonacoTheme, ensureReactMonacoLoader } from '@/lib/zeus-monaco/react-loader';
import {
  FileText, FilePlus, FolderOpen, FolderPlus, Trash2, Search, Terminal, FileCode,
  AlertCircle, CheckCircle2, Loader2, ChevronDown, ChevronRight, Copy, Check
} from 'lucide-react';

// Display de tool calls nativas en el chat — replicando el patrón de F:\Agent:
// filas colapsables con glyph de estado, transcript de terminal, y runs de
// actividad agrupados que se colapsan a una línea resumen cuando terminan.

export interface ToolLogEntry {
  name: string;
  args: Record<string, any>;
  result: string;
  status: 'success' | 'error' | 'running';
  durationMs: number;
}

// Iconos de lucide por tool
import type { LucideIcon } from 'lucide-react';

const TOOL_ICONS: Record<string, LucideIcon> = {
  read_file: FileText,
  write_file: FilePlus,
  list_dir: FolderOpen,
  create_dir: FolderPlus,
  delete_file: Trash2,
  search_files: Search,
  run_command: Terminal,
  patch: FileCode,
};

// ---- Categorías para el resumen de runs (estilo run-summary.ts de F:\Agent) ----

type RunCategory = 'edit' | 'explore' | 'run' | 'other';

const CATEGORY_ORDER: RunCategory[] = ['edit', 'explore', 'run', 'other'];

const EDIT_TOOLS = new Set(['write_file', 'patch', 'create_dir', 'delete_file']);
const EXPLORE_TOOLS = new Set(['read_file', 'list_dir', 'search_files']);
const RUN_TOOLS = new Set(['run_command']);

function toolCategory(name: string): RunCategory {
  if (EDIT_TOOLS.has(name)) return 'edit';
  if (EXPLORE_TOOLS.has(name)) return 'explore';
  if (RUN_TOOLS.has(name)) return 'run';
  return 'other';
}

// El target de la herramienta: path (basename) o comando resumido
function toolTarget(entry: ToolLogEntry): string {
  const args = entry.args || {};
  if (toolCategory(entry.name) === 'run') {
    const cmd = String(args.command || args.code || '').trim();
    return cmd.length > 60 ? cmd.slice(0, 57) + '…' : cmd;
  }
  const path = String(args.path || args.file || '');
  if (path) return path.split(/[\\/]/).pop() || path;
  return String(args.pattern || args.query || '');
}

interface CategoryCopy { noun: [string, string]; past: string; present: string; }

const CATEGORY_COPY: Record<RunCategory, CategoryCopy> = {
  edit: { noun: ['archivo', 'archivos'], past: 'Editado', present: 'Editando' },
  explore: { noun: ['archivo', 'archivos'], past: 'Explorado', present: 'Explorando' },
  run: { noun: ['comando', 'comandos'], past: 'Ejecutado', present: 'Ejecutando' },
  other: { noun: ['tool', 'tools'], past: 'Usado', present: 'Usando' },
};

function clause(category: RunCategory, entries: ToolLogEntry[], live: boolean): string {
  const copy = CATEGORY_COPY[category];
  const verb = live ? copy.present : copy.past;
  const target = entries.length === 1 ? toolTarget(entries[0]) : '';
  if (target && (live || category !== 'run')) {
    return `${verb} ${target}`;
  }
  return `${verb} ${entries.length} ${copy.noun[entries.length === 1 ? 0 : 1]}`;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

// "Explorado wiring.tsx, ejecutado 1 comando" — la línea gris que resume un run
function summarizeRun(entries: ToolLogEntry[], live: boolean): string {
  const narrating = live ? entries.find(e => e.status === 'running') ?? entries[entries.length - 1] : undefined;
  const liveCategory = narrating ? toolCategory(narrating.name) : null;

  const byCategory = new Map<RunCategory, ToolLogEntry[]>();
  for (const entry of entries) {
    const cat = toolCategory(entry.name);
    const group = byCategory.get(cat);
    if (group) group.push(entry);
    else byCategory.set(cat, [entry]);
  }

  const clauses = CATEGORY_ORDER.flatMap(cat => {
    const group = byCategory.get(cat);
    return group ? [clause(cat, group, cat === liveCategory)] : [];
  });

  return clauses.map((text, i) => (i === 0 ? text : lowerFirst(text))).join(', ');
}

// ---- Parsing del resultado ----

interface ParsedResult {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: string;
  detail: string;
}

function parseResult(result: string): ParsedResult {
  const raw = typeof result === 'string' ? result : String(result ?? '');
  let parsed: any = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* texto plano */
  }

  if (parsed && typeof parsed === 'object') {
    return {
      stdout: parsed.stdout !== undefined ? String(parsed.stdout) : undefined,
      stderr: parsed.stderr !== undefined ? String(parsed.stderr) : undefined,
      exitCode: typeof parsed.exitCode === 'number' ? parsed.exitCode : undefined,
      error: parsed.error ? String(parsed.error) : undefined,
      detail: raw,
    };
  }
  return { detail: raw };
}

function truncateResult(text: string, maxLen: number = 6000): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + `\n… (${text.length - maxLen} caracteres más)`;
}

// ---- Transcript de terminal (estilo TerminalTranscript de F:\Agent) ----

function TerminalTranscript({ command, exitCode }: { command?: string; exitCode?: number }) {
  if (!command && exitCode === undefined) return null;
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border border-[hsl(var(--border))] bg-black/30 px-2 py-1.5 font-mono text-[11px] leading-relaxed">
      {command && (
        <code className="min-w-0 flex-1 whitespace-pre-wrap break-all text-[hsl(var(--muted-foreground))]">
          <span aria-hidden className="select-none text-cyan-400">$ </span>
          {command}
        </code>
      )}
      {exitCode !== undefined && (
        <span
          className={`shrink-0 rounded bg-[hsl(var(--border))] px-1 py-px text-[10px] tabular-nums ${
            exitCode === 0 ? 'text-emerald-500' : 'text-amber-500'
          }`}
        >
          exit {exitCode}
        </span>
      )}
    </div>
  );
}

// ---- Fila individual de tool (estilo ToolEntry de F:\Agent) ----

interface ToolCallRowProps {
  entry: ToolLogEntry;
  index: number;
  /** Abierta por defecto (edits con diff / filas en vivo). */
  defaultOpen?: boolean;
}

const ToolCallRow: React.FC<ToolCallRowProps> = ({ entry, index, defaultOpen = false }) => {
  // TODOS los tools se crean abiertos por defecto (el usuario quiere ver el
  // contenido/código directamente). El Monaco tiene altura fija moderada con
  // scroll interno, así no ocupa demasiado.
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const Icon = TOOL_ICONS[entry.name] || FileCode;
  const isRunning = entry.status === 'running';
  const isError = entry.status === 'error';
  const title = toolTitle(entry.name, entry.args);
  const parsed = useMemo(() => parseResult(entry.result), [entry.result]);
  const hasExpandable =
    !isRunning &&
    Boolean(parsed.detail || parsed.stdout || parsed.stderr || parsed.error);

  const duration = isRunning
    ? '…'
    : entry.durationMs < 1000
      ? `${entry.durationMs}ms`
      : `${(entry.durationMs / 1000).toFixed(1)}s`;

  const copyText = truncateResult(entry.result || '');

  const handleCopy = () => {
    const done = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };
    const text = copyText;
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done).catch(() => {
        // Fallback para Electron / contextos no seguros
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch { /* noop */ }
        document.body.removeChild(ta);
        done();
      });
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* noop */ }
      document.body.removeChild(ta);
      done();
    }
  };

  return (
    <div
      data-tool-row=""
      className="group min-w-0 max-w-full overflow-hidden rounded-md border border-[hsl(var(--border))] text-[12px] text-[hsl(var(--muted-foreground))]"
      style={{ marginBottom: 6 }}
    >
      {/* Header — clic para expandir/colapsar */}
      <button
        onClick={() => hasExpandable && setOpen(!open)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
        style={{ background: 'transparent', border: 'none', cursor: hasExpandable ? 'pointer' : 'default' }}
      >
        {/* Glyph de estado: spinner (running) > error > icono del tool (success silencioso) */}
        <span className="grid size-3.5 shrink-0 place-items-center self-center">
          {isRunning ? (
            <Loader2 size={14} className="text-[hsl(var(--muted-foreground))]" style={{ animation: 'spin 0.8s linear infinite' }} />
          ) : isError ? (
            <AlertCircle size={14} className="text-red-500" />
          ) : (
            <Icon size={14} className="text-yellow-500" />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-[hsl(var(--foreground))]">{title}</span>
        {!isRunning && parsed.exitCode !== undefined && parsed.exitCode !== 0 && (
          <span className="shrink-0 rounded bg-[hsl(var(--border))] px-1 py-px font-mono text-[10px] tabular-nums text-amber-500">
            exit {parsed.exitCode}
          </span>
        )}
        <span className="shrink-0 text-[10px] opacity-70">{duration}</span>
        {hasExpandable && (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
      </button>

      {/* Contenido expandido */}
      {open && !isRunning && (
        <div className="relative border-t border-[hsl(var(--border))] bg-black/20 p-1.5">
          {/* Botón copiar */}
          <button
            onClick={handleCopy}
            title={copied ? '¡Copiado!' : 'Copiar resultado'}
            className={`absolute right-2 top-1.5 z-10 flex items-center gap-1 rounded px-1.5 py-0.5 text-[hsl(var(--muted-foreground))] transition-all ${
              copied
                ? 'bg-emerald-500/20 text-emerald-500 opacity-100'
                : 'opacity-0 hover:bg-[hsl(var(--border))] hover:text-[hsl(var(--foreground))] group-hover:opacity-100'
            }`}
          >
            {copied ? <Check size={14} className="text-emerald-500" strokeWidth={3} /> : <Copy size={12} />}
          </button>

          {/* Terminal: comando + exit */}
          {entry.name === 'run_command' && (
            <TerminalTranscript command={toolTarget(entry)} exitCode={parsed.exitCode} />
          )}

          {/* Error */}
          {isError && (
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-[1.55] text-red-500/90">
              {truncateResult(parsed.error || parsed.detail)}
            </pre>
          )}

          {/* stdout / stderr separados */}
          {(parsed.stdout || parsed.stderr) && !isError && (
            <div className="max-w-full text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
              {parsed.stdout && (
                <div className="space-y-0.5">
                  {parsed.stderr && <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">stdout</p>}
                  <pre className="max-h-20 max-w-full overflow-auto whitespace-pre-wrap break-all bg-transparent px-2 py-1.5 font-mono text-[11px] leading-relaxed">
                    {truncateResult(parsed.stdout)}
                  </pre>
                </div>
              )}
              {parsed.stderr && (
                <div className={`space-y-0.5 ${parsed.stdout ? 'mt-1.5' : ''}`}>
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">stderr</p>
                  <pre className="max-h-20 max-w-full overflow-auto whitespace-pre-wrap break-all bg-transparent px-2 py-1.5 font-mono text-[11px] leading-relaxed">
                    {truncateResult(parsed.stderr)}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Detail genérico (read_file, search, etc.) */}
          {parsed.detail && !parsed.stdout && !parsed.stderr && !isError && (
            <div className="max-w-full text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
              <LazyMonacoEditor
                value={truncateResult(parsed.detail)}
                language={getLanguage(entry.name, entry.args)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Título legible para cada tool
function toolTitle(name: string, args: Record<string, any>): string {
  switch (name) {
    case 'read_file':
      return `Leer ${args.path || ''}${args.offset ? ` (desde línea ${args.offset})` : ''}`;
    case 'write_file':
      return `Escribir ${args.path || ''}`;
    case 'list_dir':
      return `Listar ${args.path || '(raíz)'}`;
    case 'create_dir':
      return `Crear carpeta ${args.path || ''}`;
    case 'delete_file':
      return `Eliminar ${args.path || ''}`;
    case 'search_files':
      return `Buscar "${args.pattern || ''}"`;
    case 'run_command':
      return `Ejecutar: ${String(args.command || '').slice(0, 80)}`;
    case 'patch':
      return `Patch ${args.path || ''}`;
    default:
      return name;
  }
}

// Determinar lenguaje para Monaco según el tipo de tool
function getLanguage(toolName: string, args: Record<string, any>): string {
  if (toolName === 'run_command') return 'shell';
  if (toolName === 'search_files') return 'markdown';
  if (toolName === 'read_file' || toolName === 'write_file' || toolName === 'patch') {
    const path = String(args.path || '');
    const ext = path.split('.').pop()?.toLowerCase() || '';
    const map: Record<string, string> = {
      ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
      json: 'json', css: 'css', html: 'html', md: 'markdown', py: 'python',
      sh: 'shell', bash: 'shell', yml: 'yaml', yaml: 'yaml', sql: 'sql',
      go: 'go', rs: 'rust', java: 'java', c: 'c', cpp: 'cpp', xml: 'xml',
    };
    return map[ext] || 'plaintext';
  }
  return 'plaintext';
}

// ---- Run agrupado: colapsa a una línea resumen cuando termina (estilo F:\Agent) ----

interface ToolRunProps {
  entries: ToolLogEntry[];
  startIndex: number;
}

const ToolRun: React.FC<ToolRunProps> = ({ entries, startIndex }) => {
  const live = entries.some(e => e.status === 'running');
  // Todos los runs se crean EXPANDIDOS (el usuario quiere ver el contenido de
  // todos los tools directamente); el resumen gris solo se usa mientras corre.
  const [open, setOpen] = useState(true);
  const summary = useMemo(() => summarizeRun(entries, live), [entries, live]);

  // Un solo tool = su propia fila, sin resumen encima (igual que F:\Agent)
  if (entries.length < 2) {
    return <ToolCallRow entry={entries[0]} index={startIndex} defaultOpen={live} />;
  }

  // Live: muestra las filas (con spinners); settled: colapsa al resumen
  if (!live && !open) {
    return (
      <div data-tool-summary="" data-conversation-scaffold="">
        <button
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-2 rounded-md border border-[hsl(var(--border))] px-2 py-1.5 text-left text-[12px] text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--border))/30]"
          style={{ background: 'transparent', cursor: 'pointer' }}
          title="Haz clic para ver los detalles"
        >
          <ChevronRight size={12} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">{summary}</span>
        </button>
      </div>
    );
  }

  return (
    <div data-tool-group="" className="grid min-w-0 max-w-full gap-1 overflow-hidden">
      {/* Mientras corre: la línea resumen en presente + las filas con spinner */}
      {live && (
        <div data-tool-summary="" data-conversation-scaffold="">
          <div className="flex w-full items-center gap-2 rounded-md border border-[hsl(var(--border))] px-2 py-1.5 text-[12px] text-[hsl(var(--muted-foreground))]">
            <Loader2 size={12} className="shrink-0" style={{ animation: 'spin 0.8s linear infinite' }} />
            <span className="min-w-0 flex-1 truncate">{summary}</span>
          </div>
        </div>
      )}
      <div className="grid min-w-0 max-w-full gap-1">
        {entries.map((entry, i) => (
          <ToolCallRow key={`${entry.name}-${i}`} entry={entry} index={startIndex + i} defaultOpen={live} />
        ))}
      </div>
    </div>
  );
};

// Monaco editor lazy-loaded (solo se carga cuando se monta la fila)
const LazyMonacoEditor: React.FC<{ value: string; language: string }> = ({ value, language }) => {
  const [Editor, setEditor] = useState<any>(null);
  // Usar el MISMO tema que el editor principal (colección monaco_themes de
  // PocketBase local + localStorage), sincronizado con el ThemePicker.
  const theme = useChatMonacoTheme();

  React.useEffect(() => {
    let mounted = true;
    ensureReactMonacoLoader()
      .then(() => import('@monaco-editor/react'))
      .then((mod) => {
        if (mounted) setEditor(() => mod.default);
      })
      .catch((e) => console.warn('[ToolCallDisplay] Error cargando Monaco:', e));
    return () => { mounted = false; };
  }, []);

  if (!Editor) {
    return (
      <pre style={{
        margin: 0, padding: '8px 10px', fontSize: 11, fontFamily: 'monospace',
        whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        color: 'hsl(var(--muted-foreground))', maxHeight: 180, overflow: 'auto',
      }}>
        {value}
      </pre>
    );
  }

  return (
    <div style={{ width: '100%', height: 180, overflow: 'hidden' }}>
      <Editor
        value={value}
        language={language}
        theme={theme}
        height={180}
        options={{
          readOnly: true,
          minimap: { enabled: false },
          fontSize: 11,
          lineHeight: 18,
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          lineNumbers: 'off',
          folding: false,
          glyphMargin: false,
          lineDecorationsWidth: 4,
          lineNumbersMinChars: 0,
          padding: { top: 4, bottom: 4 },
          scrollbar: { vertical: 'auto', horizontal: 'hidden', verticalScrollbarSize: 6 },
          renderLineHighlight: 'none',
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
        }}
        loading={
          <pre style={{
            margin: 0, padding: '8px 10px', fontSize: 11, fontFamily: 'monospace',
            color: 'hsl(var(--muted-foreground))', height: 180, overflow: 'auto',
          }}>
            {value}
          </pre>
        }
      />
    </div>
  );
};

interface ToolCallDisplayProps {
  toolLog: ToolLogEntry[];
}

export const ToolCallDisplay: React.FC<ToolCallDisplayProps> = ({ toolLog }) => {
  if (!toolLog || toolLog.length === 0) return null;

  const runningCount = toolLog.filter(t => t.status === 'running').length;

  // Agrupar tools consecutivos en runs: los edits (write/patch) son "cards"
  // que siempre se muestran como filas; la actividad (read/search/run) se
  // agrupa y colapsa a un resumen cuando termina. (splitRunItems de F:\Agent)
  const runs: { entries: ToolLogEntry[]; startIndex: number }[] = [];
  let current: ToolLogEntry[] | null = null;

  toolLog.forEach((entry, i) => {
    const isEdit = EDIT_TOOLS.has(entry.name);
    if (!isEdit) {
      if (current) current.push(entry);
      else {
        current = [entry];
        runs.push({ entries: current, startIndex: i });
      }
    } else {
      current = null;
      runs.push({ entries: [entry], startIndex: i });
    }
  });

  return (
    <div style={{ margin: '8px 0' }} data-tool-group="">
      <div
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          color: 'hsl(var(--muted-foreground))',
          marginBottom: 4,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <Terminal size={12} style={{ color: 'hsl(var(--muted-foreground))' }} />
        <span>
          {toolLog.length} tool{toolLog.length !== 1 ? 's' : ''} ejecutada{toolLog.length !== 1 ? 's' : ''}
          {runningCount > 0 && ` (${runningCount} en curso…)`}
        </span>
      </div>
      <div className="grid min-w-0 max-w-full gap-1">
        {runs.map((run, i) => (
          <ToolRun key={i} entries={run.entries} startIndex={run.startIndex} />
        ))}
      </div>
    </div>
  );
};

export default ToolCallDisplay;
