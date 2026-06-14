import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  THEME_TOKENS,
  DEFAULT_THEME_NAME,
  type SavedTheme,
} from '../../lib/theme-tokens';
import {
  fetchThemes,
  saveTheme,
  deleteTheme,
  activateTheme,
  deactivateAllThemes,
  applyThemeToDocument,
  readCurrentColorsFromDocument,
  loadAndApplyTheme,
} from '../../lib/theme-engine';
import {
  Palette,
  Save,
  Trash2,
  RotateCcw,
  Plus,
  Check,
  Loader2,
  X,
} from 'lucide-react';

interface ThemeEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ThemeEditorModal({ isOpen, onClose }: ThemeEditorModalProps) {
  const [themes, setThemes] = useState<SavedTheme[]>([]);
  const [selectedThemeId, setSelectedThemeId] = useState<string | 'new'>('new');
  const [themeName, setThemeName] = useState('');
  const [colors, setColors] = useState<Record<string, string>>(() => readCurrentColorsFromDocument());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  const refreshThemes = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchThemes();
      setThemes(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      refreshThemes();
      setColors(readCurrentColorsFromDocument());
      setThemeName('');
      setSelectedThemeId('new');
    }
  }, [isOpen, refreshThemes]);

  const applyPreview = useCallback(() => {
    applyThemeToDocument(colors);
  }, [colors]);

  useEffect(() => {
    if (isOpen) {
      applyPreview();
    } else {
      loadAndApplyTheme();
    }
  }, [isOpen, applyPreview]);

  useEffect(() => {
    if (!isOpen || isResetting) return;
    const timer = setTimeout(() => applyPreview(), 50);
    return () => clearTimeout(timer);
  }, [colors, isOpen, applyPreview, isResetting]);

  const handleColorChange = (key: string, value: string) => {
    setColors((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    const name = themeName.trim() || 'Tema sin nombre';
    setSaving(true);
    setSaveStatus(null);
    try {
      const { theme, savedToPb } = await saveTheme(name, colors);
      await refreshThemes();
      setSelectedThemeId(theme.id);
      setSaveStatus(savedToPb ? 'Guardado en base de datos' : 'Guardado solo localmente');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteTheme(id);
    await refreshThemes();
    if (selectedThemeId === id) {
      setSelectedThemeId('new');
      setThemeName('');
      setColors(readCurrentColorsFromDocument());
    }
  };

  const handleSelectTheme = (t: SavedTheme) => {
    setSelectedThemeId(t.id);
    setThemeName(t.name);
    setColors({ ...t.colors });
  };

  const handleReset = async () => {
    setIsResetting(true);
    setColors(readCurrentColorsFromDocument());
    setThemeName('');
    setSelectedThemeId('new');
    await deactivateAllThemes();
    applyThemeToDocument(undefined);
    setTimeout(() => setIsResetting(false), 300);
  };

  const previewGradient = useMemo(() => {
    return `linear-gradient(135deg, ${colors.primary} 0%, ${colors.secondary} 50%, ${colors.tertiary} 100%)`;
  }, [colors]);

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
        className="relative z-10 w-full max-w-4xl max-h-[92vh] bg-surface-container-low border border-secondary rounded-lg shadow-lg flex flex-col overflow-hidden text-[0.95rem]"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="zeus-theme-title"
      >
        {/* Header */}
        <div className="relative border-b border-outline-variant/10 bg-surface-container px-4 py-3 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Palette size={18} className="text-secondary" />
            <h2 id="zeus-theme-title" className="text-sm font-headline font-bold text-on-surface">
              Editor de temas Zeus
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-on-surface-variant hover:text-secondary p-1 rounded-md hover:bg-surface-container-high/80"
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Sidebar */}
          <div className="w-48 border-r border-outline-variant/10 flex flex-col bg-surface-container-lowest/30 shrink-0">
            <div className="p-2 border-b border-outline-variant/10">
              <button
                type="button"
                onClick={() => {
                  setSelectedThemeId('new');
                  setThemeName('');
                  setColors(readCurrentColorsFromDocument());
                }}
                className="w-full py-1.5 px-2 rounded-full border border-secondary text-secondary text-[10px] font-headline font-semibold hover:bg-secondary/10 transition-colors flex items-center justify-center gap-1"
              >
                <Plus size={12} /> Nuevo tema
              </button>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
              {loading && (
                <p className="text-[10px] text-on-surface-variant px-1 py-1 flex items-center gap-1">
                  <Loader2 size={11} className="animate-spin" /> Cargando…
                </p>
              )}
              {!loading && themes.length === 0 && (
                <p className="text-[10px] text-on-surface-variant px-1 py-1">
                  No hay temas guardados.
                </p>
              )}
              {themes.map((t) => (
                <button
                  key={t.id}
                  onClick={() => handleSelectTheme(t)}
                  className={`w-full text-left px-2 py-1.5 rounded-md text-[11px] transition-colors flex items-center justify-between group ${
                    selectedThemeId === t.id
                      ? 'bg-secondary/10 text-secondary ring-1 ring-secondary/30'
                      : 'hover:bg-surface-container-high/50 text-on-surface'
                  }`}
                >
                  <span className="truncate">{t.name}</span>
                  <Trash2
                    size={12}
                    className="text-error opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(t.id);
                    }}
                  />
                </button>
              ))}
            </div>
          </div>

          {/* Editor */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="px-4 py-3 border-b border-outline-variant/10 shrink-0 space-y-1">
              <div className="flex items-center gap-3">
                <label className="text-[10px] font-headline font-medium text-secondary uppercase tracking-wide shrink-0">
                  Nombre
                </label>
                <input
                  type="text"
                  value={themeName}
                  onChange={(e) => setThemeName(e.target.value)}
                  placeholder="Ej. Cyberpunk Neon"
                  className="flex-1 min-w-0 bg-surface-container-high border-none rounded px-2 py-1 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:ring-1 focus:ring-secondary/50 outline-none"
                />
                <div
                  className="w-16 h-6 rounded-md border border-outline-variant/20 shadow-inner shrink-0"
                  style={{ background: previewGradient }}
                  title="Preview"
                />
              </div>
              {saveStatus && (
                <p className={`text-[10px] ${saveStatus.includes('base de datos') ? 'text-secondary' : 'text-error'}`}>
                  {saveStatus}
                </p>
              )}
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
                {THEME_TOKENS.map((token) => (
                  <div key={token.key} className="flex items-center gap-2">
                    <input
                      type="color"
                      value={colors[token.key] || token.defaultHex}
                      onChange={(e) => handleColorChange(token.key, e.target.value)}
                      className="w-8 h-8 rounded cursor-pointer border-0 p-0 bg-transparent shrink-0"
                      aria-label={token.label}
                    />
                    <div className="min-w-0">
                      <span className="text-[11px] font-medium text-on-surface truncate block">
                        {token.label}
                      </span>
                      <code className="text-[9px] text-on-surface-variant">
                        {colors[token.key] || token.defaultHex}
                      </code>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="px-3 py-2 bg-surface-container flex justify-end items-center gap-2 border-t border-outline-variant/10 shrink-0">
              <button
                type="button"
                onClick={handleReset}
                className="px-3 py-1 rounded-full text-on-surface-variant font-headline font-bold text-[10px] hover:text-on-surface hover:bg-surface-container-high transition-colors flex items-center gap-1"
              >
                <RotateCcw size={12} /> Restaurar
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1 rounded-full border border-outline-variant/30 text-on-surface text-[10px] font-medium hover:bg-surface-container-high transition-colors"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center justify-center gap-1 px-3 py-1 bg-secondary text-on-secondary font-headline font-extrabold text-[10px] rounded-full hover:brightness-110 active:scale-[0.98] transition-all shadow-sm disabled:opacity-50"
              >
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
              {selectedThemeId !== 'new' && (
                <button
                  type="button"
                  onClick={async () => {
                    const t = themes.find((x) => x.id === selectedThemeId);
                    if (t) {
                      await activateTheme(t.id, t.name);
                      applyThemeToDocument(t.colors);
                    }
                  }}
                  className="inline-flex items-center justify-center gap-1 px-3 py-1 bg-primary text-on-primary font-headline font-bold text-[10px] rounded-full hover:bg-primary/80 transition-colors"
                >
                  <Check size={12} /> Aplicar
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
