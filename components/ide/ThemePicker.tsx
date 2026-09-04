'use client';

/**
 * ThemePicker — selector de tema de Monaco con persistencia.
 *
 * Muestra todos los temas registrados por extensiones instaladas en Zeus
 * (vía `host.getRegisteredThemes()`) más los dos temas built-in de Monaco
 * ('dark-blue' y 'vs'). Al elegir uno, llama a `monaco.editor.setTheme()`
 * y lo persiste en localStorage para que sobreviva al reinicio.
 *
 * Atajo: `Ctrl+K Ctrl+T` (estándar de VS Code para "Color Theme").
 *
 * Render: un botón en la barra del IDE que abre un Popover con buscador
 * + lista. La lista se actualiza cuando se instala/desinstala una extensión
 * (escuchando el evento 'zeus:extensions-changed' si existe, o un poll
 * ligero cada vez que se abre el popover).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Paintbrush, Check, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getStoredTheme, onThemeChange, emitThemeChange, setStoredTheme } from '@/lib/zeus-monaco/theme';
import { saveMonacoTheme, getActiveMonacoTheme, onMonacoThemeChange } from '@/lib/zeus-monaco/monaco-theme-service';
import { Button } from '@/components/ui/button';

// Importaciones dinámicas para evitar SSR con Monaco.
// Son `let` porque el import() es asíncrono; hasta que resuelva son `undefined`,
// por lo que todo uso debe ir precedido de ensureMonacoLoaded().
let listRegisteredThemes: () => any[];
let initZeusMonaco: () => Promise<void>;
let isMonacoReady: () => boolean;
let applyMonacoTheme: (themeId: string) => boolean;

let loadPromise: Promise<void> | null = null;
const loadZeusMonaco = async () => {
  const [ext, init] = await Promise.all([
    import('@/lib/zeus-monaco/extensions'),
    import('@/lib/zeus-monaco/init')
  ]);
  listRegisteredThemes = ext.listRegisteredThemes;
  initZeusMonaco = init.initZeusMonaco;
  isMonacoReady = init.isMonacoReady;
  applyMonacoTheme = init.applyMonacoTheme;
};

// Garantiza que el import dinámico solo se lanza una vez y devuelve siempre
// la misma promesa. Cualquier consumidor debe await/then sobre esto antes de
// llamar a initZeusMonaco/isMonacoReady/listRegisteredThemes/applyMonacoTheme.
const ensureMonacoLoaded = (): Promise<void> => {
  if (!loadPromise) {
    loadPromise = loadZeusMonaco().catch((e) => {
      loadPromise = null; // permitir reintentar si falla
      console.warn('[ThemePicker] Fallo al cargar zeus-monaco:', e);
      throw e;
    });
  }
  return loadPromise;
};

// Cargar módulos al importar el componente (cliente)
if (typeof window !== 'undefined') {
  ensureMonacoLoaded();
}

interface ThemeEntry {
  id: string;
  label: string;
  uiTheme: 'vs' | 'vs-dark' | 'hc-black' | 'hc-light' | string;
  extensionId?: string;
  extensionDisplayName?: string;
}

const BUILTIN_THEMES: ThemeEntry[] = [
  { id: 'zeus-dark', label: 'Zeus Dark (Default)', uiTheme: 'vs-dark' },
  { id: 'vs', label: 'Light (Monaco)', uiTheme: 'vs' },
  { id: 'vs-dark', label: 'Dark (Monaco)', uiTheme: 'vs-dark' },
  { id: 'hc-black', label: 'High Contrast Dark', uiTheme: 'hc-black' },
];

const DEFAULT_THEME_ID = 'vs-dark';

function useExtensionThemes(): ThemeEntry[] {
  const [themes, setThemes] = useState<ThemeEntry[]>(BUILTIN_THEMES);
  const refresh = useCallback(() => {
    if (typeof window === 'undefined') return;
    ensureMonacoLoaded()
      .then(() => {
        if (!isMonacoReady()) {
          setThemes(BUILTIN_THEMES);
          return;
        }
        const extThemes = listRegisteredThemes();
        setThemes([...BUILTIN_THEMES, ...extThemes]);
      })
      .catch(() => setThemes(BUILTIN_THEMES));
  }, []);

  useEffect(() => {
    refresh();
    // Refrescar al recibir el evento de "extensiones cambiaron" o cada vez
    // que se abra el popover (la API del popover llama a refresh() también).
    const handler = () => refresh();
    window.addEventListener('zeus:extensions-changed', handler);
    return () => window.removeEventListener('zeus:extensions-changed', handler);
  }, [refresh]);

  return themes;
}

export function ThemePicker() {
  const themes = useExtensionThemes();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [current, setCurrent] = useState<string>(() => {
    const stored = getStoredTheme();
    // Si el id persistido no está en la lista de temas disponibles
    // (p.ej. el usuario lo guardó de una extensión que ya no está instalada),
    // caemos a 'vs-dark' para que el botón no muestre "undefined".
    return stored || 'vs-dark';
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Si el id persistido no existe en la lista, lo reemplazamos por el
  // primer tema disponible (vs-dark por defecto) y lo emitimos para que
  // Monaco se sincronice.
  useEffect(() => {
    if (themes.length === 0) return;
    const exists = themes.some((t) => t.id === current);
    if (!exists) {
      const fallback = 'vs-dark';
      setCurrent(fallback);
      ensureMonacoLoaded()
        .then(() => initZeusMonaco())
        .then(() => applyMonacoTheme(fallback))
        .catch(() => {});
      emitThemeChange(fallback);
    }
  }, [themes, current]);

  // Escuchar cambios de tema (locales y remotos)
  useEffect(() => {
    // 1. Sincronización inicial con PocketBase
    const syncWithPB = async () => {
      try {
        const pbTheme = await getActiveMonacoTheme();
        if (pbTheme?.themeId) {
          console.log('[ThemePicker] Sincronización inicial con PB:', pbTheme.themeId);
          setCurrent(pbTheme.themeId);
          setStoredTheme(pbTheme.themeId);
        }
      } catch (err) {
        console.warn('[ThemePicker] Falló sincronización inicial con PB:', err);
      }
    };
    syncWithPB();

    // 2. Suscripción local (misma pestaña)
    const unsubLocal = onThemeChange((themeId) => setCurrent(themeId));

    // 3. Suscripción remota (otra pestaña via PocketBase Realtime)
    const unsubRemote = onMonacoThemeChange((themeId) => {
      console.log('[ThemePicker] Cambio realtime recibido:', themeId);
      setCurrent(themeId);
    });

    return () => {
      unsubLocal();
      unsubRemote();
    };
  }, []);

  // Cerrar al hacer click fuera
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  // Enfocar el input al abrir
  useEffect(() => {
    if (open) {
      // pequeño delay para que el popover esté montado
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Atajo Ctrl+K Ctrl+T (estándar de VS Code)
  useEffect(() => {
    let firstK = false;
    let firstKTimer: number | null = null;
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && (e.key === 'k' || e.key === 'K')) {
        firstK = true;
        if (firstKTimer) window.clearTimeout(firstKTimer);
        firstKTimer = window.setTimeout(() => {
          firstK = false;
        }, 1500);
        return;
      }
      if (firstK && ctrl && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        firstK = false;
        if (firstKTimer) window.clearTimeout(firstKTimer);
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (firstKTimer) window.clearTimeout(firstKTimer);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return themes;
    return themes.filter(
      (t) =>
        t.label.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q) ||
        (t.extensionDisplayName || '').toLowerCase().includes(q),
    );
  }, [themes, filter]);

  const handleSelect = useCallback((themeId: string) => {
    const themeEntry = themes.find(t => t.id === themeId);
    const themeName = themeEntry?.label || themeId;
    const extensionId = themeEntry?.extensionId;

    setCurrent(themeId);

    // Guardar en localStorage (para fallback y sincronización)
    setStoredTheme(themeId);

    // Guardar en PocketBase para persistencia real
    saveMonacoTheme(themeId, themeName, extensionId)
      .then(saved => {
        console.log('[ThemePicker] Guardado en PB:', themeId, saved ? 'OK' : 'FALLÓ');
      })
      .catch(err => {
        console.warn('[ThemePicker] Error guardando en PB:', err);
      });

    // Garantiza que Monaco esté listo antes de aplicar. Si no lo está aún
    // (p.ej. el usuario abre el ThemePicker antes que cualquier editor),
    // `initZeusMonaco()` lo inicializa. El editor también escucha el evento
    // 'zeus:monaco-theme-changed' y aplica el tema sobre su instancia.
    ensureMonacoLoaded()
      .then(() => initZeusMonaco())
      .then(() => {
        const ok = applyMonacoTheme(themeId);
        console.log('[ThemePicker] seleccionar', themeId, '→ applyMonacoTheme=', ok, 'ready=', isMonacoReady());
        emitThemeChange(themeId);
      })
      .catch((err) => {
        console.warn('[ThemePicker] initZeusMonaco() falló:', err);
        // Aun así persistimos, para que el siguiente montaje del editor lo recoja.
        emitThemeChange(themeId);
      });
    setOpen(false);
  }, [themes]);

  const currentLabel = themes.find((t) => t.id === current)?.label || current;

  return (
    <div ref={containerRef} className="relative">
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen((v) => !v)}
        className="h-7 px-2 text-xs gap-1.5 border-border/50 text-foreground/70 hover:text-foreground/90 hover:bg-card"
        title="Cambiar tema de color (Ctrl+K Ctrl+T)"
      >
        <Paintbrush className="w-3.5 h-3.5" />
        <span className="hidden sm:inline max-w-[120px] truncate">{currentLabel}</span>
      </Button>

      {open && (
        <div
          className="absolute right-0 top-9 z-50 w-72 bg-background border border-border/50 rounded-md shadow-2xl shadow-black/50 overflow-hidden"
          role="dialog"
          aria-label="Selector de tema"
        >
          <div className="p-2 border-b border-border/80">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/80" />
              <input
                ref={inputRef}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Buscar tema…"
                className="w-full pl-7 pr-2 h-7 text-xs bg-background border border-border/50 rounded-md text-foreground/80 placeholder-muted-foreground/80 focus:outline-none focus:border-primary"
              />
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground/80">
                No hay temas que coincidan.
                <br />
                <span className="text-[10px] text-muted-foreground/60">
                  Instala extensiones de temas (Catppuccin, DarkMatter Pro, etc.) y aparecerán aquí.
                </span>
              </div>
            ) : (
              filtered.map((t) => {
                const isCurrent = t.id === current;
                // Key compuesta: dos extensiones distintas podrían declarar
                // el mismo theme.id (poco habitual, pero posible), y queremos
                // que el warning de React no se dispare.
                const itemKey = `${t.extensionId || 'builtin'}::${t.id}`;
                return (
                  <button
                    key={itemKey}
                    onClick={() => handleSelect(t.id)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-card/70 transition-colors',
                      isCurrent && 'bg-violet-500/10 text-violet-200',
                    )}
                    title={t.id}
                  >
                    <span
                      className={cn(
                        'w-3 h-3 rounded-sm border flex-shrink-0',
                        isCurrent
                          ? 'bg-violet-500 border-violet-300'
                          : 'border-border/40',
                      )}
                    >
                      {isCurrent && <Check className="w-2.5 h-2.5 text-foreground" />}
                    </span>
                    <span className="flex-1 min-w-0 truncate">{t.label}</span>
                    {t.extensionDisplayName && (
                      <span className="text-[10px] text-muted-foreground/80 truncate max-w-[100px]">
                        {t.extensionDisplayName}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
          <div className="px-3 py-1.5 border-t border-border/80 text-[10px] text-muted-foreground/60 flex items-center justify-between">
            <span>{themes.length - BUILTIN_THEMES.length} de extensiones</span>
            <span>Ctrl+K Ctrl+T</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default ThemePicker;
