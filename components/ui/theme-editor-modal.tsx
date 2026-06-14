'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import {
  THEME_TOKENS,
  DEFAULT_THEME_NAME,
  type SavedTheme,
} from '@/lib/theme-tokens';
import {
  fetchThemes,
  saveTheme,
  publishTheme,
  deleteTheme,
  activateTheme,
  deactivateAllThemes,
  applyThemeToDocument,
  readCurrentColorsFromDocument,
  loadAndApplyTheme,
} from '@/lib/theme-engine';
import {
  fetchPublishedThemesFromPb,
  rateThemeInPb,
  deletePublishedThemeFromPb,
  type PbThemeRecord,
} from '@/lib/theme-pb-service';
import { pb } from '@/lib/pocketbase';
import {
  Palette,
  Save,
  Trash2,
  RotateCcw,
  Plus,
  Check,
  Loader2,
  Globe,
  Star,
} from 'lucide-react';

interface ThemeEditorModalProps {
  open: boolean;
  onClose: () => void;
}

export function ThemeEditorModal({ open, onClose }: ThemeEditorModalProps) {
  const [themes, setThemes] = useState<SavedTheme[]>([]);
  const [publishedThemes, setPublishedThemes] = useState<PbThemeRecord[]>([]);
  const [selectedThemeId, setSelectedThemeId] = useState<string | 'new'>('new');
  const [themeName, setThemeName] = useState('');
  const [colors, setColors] = useState<Record<string, string>>(() => readCurrentColorsFromDocument());
  const [loading, setLoading] = useState(false);
  const [loadingPublished, setLoadingPublished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [publishStatus, setPublishStatus] = useState<string | null>(null);
  const [ratingUpdatingId, setRatingUpdatingId] = useState<string | null>(null);
  const [useLucideIcons, setUseLucideIcons] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const refreshThemes = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchThemes();
      setThemes(list);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshPublishedThemes = useCallback(async () => {
    setLoadingPublished(true);
    try {
      const list = await fetchPublishedThemesFromPb();
      setPublishedThemes(list);
    } finally {
      setLoadingPublished(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      refreshThemes();
      refreshPublishedThemes();
      setColors(readCurrentColorsFromDocument());
      setThemeName('');
      setSelectedThemeId('new');
      setUseLucideIcons(localStorage.getItem('zeus-use-lucide-icons') === 'true');
      setCurrentUserId(pb.authStore.model?.id ?? null);
    }
  }, [open, refreshThemes, refreshPublishedThemes]);

  const applyPreview = useCallback(() => {
    applyThemeToDocument(colors);
  }, [colors]);

  useEffect(() => {
    if (open) {
      applyPreview();
    } else {
      loadAndApplyTheme();
    }
  }, [open, applyPreview]);

  useEffect(() => {
    if (!open || isResetting) return;
    const timer = setTimeout(() => applyPreview(), 50);
    return () => clearTimeout(timer);
  }, [colors, open, applyPreview, isResetting]);

  const handleColorChange = (key: string, value: string) => {
    setColors((prev) => ({ ...prev, [key]: value }));
  };

  const handleToggleLucideIcons = (checked: boolean) => {
    setUseLucideIcons(checked);
    localStorage.setItem('zeus-use-lucide-icons', String(checked));
    window.dispatchEvent(new CustomEvent('zeus-theme-icons-changed', { detail: { useLucideIcons: checked } }));
  };

  const handleSave = async () => {
    const name = themeName.trim() || 'Tema sin nombre';
    setSaving(true);
    setSaveStatus(null);
    try {
      const { theme, savedToPb } = await saveTheme(name, colors);
      await refreshThemes();
      setSelectedThemeId(theme.id);
      setSaveStatus(savedToPb ? 'Guardado en base de datos' : 'Guardado solo localmente (sin conexión a base de datos)');
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    const name = themeName.trim() || 'Tema sin nombre';
    setPublishing(true);
    setPublishStatus(null);
    try {
      const { savedToPb } = await publishTheme(name, colors, useLucideIcons);
      if (savedToPb) {
        setPublishStatus('Tema publicado correctamente en la base de datos');
        await refreshPublishedThemes();
      } else {
        setPublishStatus('No se pudo publicar el tema');
      }
    } finally {
      setPublishing(false);
    }
  };

  const handleRatePublishedTheme = async (themeId: string, rating: number) => {
    setRatingUpdatingId(themeId);
    try {
      const ok = await rateThemeInPb(themeId, rating);
      if (ok) {
        setPublishedThemes((prev) =>
          prev.map((t) => (t.id === themeId ? { ...t, rating } : t))
        );
      }
    } finally {
      setRatingUpdatingId(null);
    }
  };

  const handleDeletePublishedTheme = async (id: string) => {
    const ok = await deletePublishedThemeFromPb(id);
    if (ok) {
      setPublishedThemes((prev) => prev.filter((t) => t.id !== id));
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
    // Desactivar tema en PB + localStorage para que la app vuelva a sus colores nativos
    await deactivateAllThemes();
    applyThemeToDocument(undefined);
    // Permitir preview de nuevo tras un breve delay
    setTimeout(() => setIsResetting(false), 300);
  };

  const previewGradient = useMemo(() => {
    return `linear-gradient(135deg, ${colors.primary} 0%, ${colors.secondary} 50%, ${colors.tertiary} 100%)`;
  }, [colors]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl w-[95vw] h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Palette className="w-5 h-5 text-primary" />
            Editor de temas Zeus
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Sidebar temas guardados */}
          <div className="w-56 border-r flex flex-col bg-muted/30 shrink-0">
            <div className="p-3 border-b">
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-1"
                onClick={() => {
                  setSelectedThemeId('new');
                  setThemeName('');
                  setColors(readCurrentColorsFromDocument());
                }}
              >
                <Plus className="w-4 h-4" /> Nuevo tema
              </Button>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-2 space-y-1">
                {/* Guardados */}
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-2 py-1">
                  Guardados
                </div>
                {loading && (
                  <p className="text-xs text-muted-foreground px-2 py-2 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Cargando…
                  </p>
                )}
                {!loading && themes.length === 0 && (
                  <p className="text-xs text-muted-foreground px-2 py-2">
                    No hay temas guardados.
                  </p>
                )}
                {themes.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => handleSelectTheme(t)}
                    className={cn(
                      'w-full text-left px-3 py-2 rounded-md text-sm transition-colors flex items-center justify-between group',
                      selectedThemeId === t.id
                        ? 'bg-primary/10 text-primary ring-1 ring-primary/30'
                        : 'hover:bg-muted text-foreground'
                    )}
                  >
                    <span className="truncate">{t.name}</span>
                    <Trash2
                      className="w-3.5 h-3.5 text-destructive opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(t.id);
                      }}
                    />
                  </button>
                ))}

                <Separator className="my-2" />

                {/* Publicados */}
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-2 py-1">
                  Publicados
                </div>
                {loadingPublished && (
                  <p className="text-xs text-muted-foreground px-2 py-2 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Cargando…
                  </p>
                )}
                {!loadingPublished && publishedThemes.length === 0 && (
                  <p className="text-xs text-muted-foreground px-2 py-2">
                    No hay temas publicados.
                  </p>
                )}
                {publishedThemes.map((t) => (
                  <div
                    key={t.id}
                    className="px-2 py-2 rounded-md text-sm hover:bg-muted transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => {
                          setColors({ ...t.colors });
                          setThemeName(t.name);
                          setSelectedThemeId('new');
                          applyThemeToDocument(t.colors);
                        }}
                        className="truncate text-foreground text-left flex-1"
                        title="Clic para previsualizar colores"
                      >
                        {t.name}
                      </button>
                      {t.user_id === currentUserId && (
                        <Trash2
                          className="w-3.5 h-3.5 text-destructive cursor-pointer shrink-0 ml-1"
                          onClick={() => handleDeletePublishedTheme(t.id)}
                        />
                      )}
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          onClick={() => handleRatePublishedTheme(t.id, star)}
                          disabled={ratingUpdatingId === t.id}
                          className="p-0.5 disabled:opacity-50"
                        >
                          <Star
                            className={`w-3.5 h-3.5 ${
                              star <= (t.rating || 0)
                                ? 'text-yellow-400 fill-yellow-400'
                                : 'text-muted-foreground/40'
                            }`}
                          />
                        </button>
                      ))}
                      {ratingUpdatingId === t.id && (
                        <Loader2 className="w-3 h-3 animate-spin text-muted-foreground ml-1" />
                      )}
                      <span className="text-xs text-muted-foreground ml-1">
                        ({t.votesCount || 0})
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            {/* Botones del sidebar */}
            <div className="p-3 border-t shrink-0 space-y-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePublish}
                disabled={publishing}
                className="w-full gap-1"
              >
                {publishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />}
                {publishing ? 'Publicando…' : 'Publicar tema'}
              </Button>
              {selectedThemeId !== 'new' && (
                <Button
                  variant="default"
                  size="sm"
                  onClick={async () => {
                    const t = themes.find((x) => x.id === selectedThemeId);
                    if (t) {
                      await activateTheme(t.id, t.name);
                      applyThemeToDocument(t.colors);
                      setPublishStatus('Tema activado y aplicado');
                      setTimeout(() => setPublishStatus(null), 2000);
                    }
                  }}
                  className="w-full gap-1"
                >
                  <Check className="w-3.5 h-3.5" /> Aplicar y activar
                </Button>
              )}
            </div>
          </div>

          {/* Editor central */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="px-6 py-4 border-b shrink-0 space-y-3">
              <div className="flex items-center gap-3">
                <Label htmlFor="theme-name" className="text-sm font-medium shrink-0">
                  Nombre del tema
                </Label>
                <Input
                  id="theme-name"
                  value={themeName}
                  onChange={(e) => setThemeName(e.target.value)}
                  placeholder="Ej. Cyberpunk Neon"
                  className="max-w-xs"
                />
                <div className="ml-auto flex items-center gap-2">
                  <div
                    className="w-20 h-8 rounded-md border shadow-inner"
                    style={{ background: previewGradient }}
                    title="Preview gradient"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="use-lucide-icons"
                  type="checkbox"
                  checked={useLucideIcons}
                  onChange={(e) => handleToggleLucideIcons(e.target.checked)}
                  className="w-4 h-4 rounded border border-border bg-background accent-primary cursor-pointer"
                />
                <Label htmlFor="use-lucide-icons" className="text-sm cursor-pointer select-none">
                  Usar iconos Lucide planos
                </Label>
              </div>
              {saveStatus && (
                <p className={`text-xs ${saveStatus.includes('base de datos') ? 'text-green-500' : 'text-amber-500'}`}>
                  {saveStatus}
                </p>
              )}
              {publishStatus && (
                <p className={`text-xs ${publishStatus.includes('correctamente') ? 'text-green-500' : 'text-destructive'}`}>
                  {publishStatus}
                </p>
              )}
            </div>

            <ScrollArea className="flex-1 px-6 py-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                {THEME_TOKENS.map((token) => (
                  <div key={token.key} className="flex items-center gap-3">
                    <input
                      type="color"
                      value={colors[token.key] || token.defaultHex}
                      onChange={(e) => handleColorChange(token.key, e.target.value)}
                      className="w-10 h-10 rounded cursor-pointer border p-0 bg-transparent shrink-0"
                      aria-label={token.label}
                    />
                    <div className="min-w-0">
                      <Label className="text-sm font-medium truncate block">
                        {token.label}
                      </Label>
                      <code className="text-xs text-muted-foreground">
                        {colors[token.key] || token.defaultHex}
                      </code>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <Separator />

            <DialogFooter className="px-6 py-4 shrink-0 flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 mr-auto">
                <Button variant="outline" onClick={handleReset} className="gap-1">
                  <RotateCcw className="w-4 h-4" /> Restaurar default
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={onClose}>
                  Cerrar
                </Button>
                <Button onClick={handleSave} disabled={saving} className="gap-1">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {saving ? 'Guardando…' : 'Guardar tema'}
                </Button>
              </div>
            </DialogFooter>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
