'use client';

import { SavedTheme, THEME_TOKENS, DEFAULT_THEME_NAME } from './theme-tokens';
import {
  getThemesFromPb,
  getActiveThemeFromPb,
  saveThemeToPb,
  deleteThemeFromPb,
  setActiveThemeInPb,
  deactivateAllThemesInPb,
  syncThemesFromPbToLocal,
  publishThemeToPb,
  type PbThemeRecord,
} from './theme-pb-service';

const STORAGE_KEY = 'zeus-custom-themes';
const ACTIVE_KEY = 'zeus-active-theme';

function hexToHslValues(hex: string): { h: number; s: number; l: number } {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map((x) => x + x).join('');
  const num = parseInt(c, 16);
  const r = ((num >> 16) & 255) / 255;
  const g = ((num >> 8) & 255) / 255;
  const b = (num & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hexToHslString(hex: string): string {
  const { h, s, l } = hexToHslValues(hex);
  return `${h} ${s}% ${l}%`;
}

/* ── localStorage (fallback / caché offline) ─────────── */

export function getSavedThemes(): SavedTheme[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedTheme[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function setSavedThemes(themes: SavedTheme[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(themes));
}

export function getActiveThemeName(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveThemeName(name: string | null): void {
  if (typeof window === 'undefined') return;
  if (name) localStorage.setItem(ACTIVE_KEY, name);
  else localStorage.removeItem(ACTIVE_KEY);
}

/* ── Aplicación de CSS ─────────────────────────────── */

function syncTitleBarOverlay() {
  if (typeof window === 'undefined') return;
  const electronAPI = (window as any).electronAPI;
  if (!electronAPI || typeof electronAPI.setTitleBarOverlay !== 'function') return;

  const style = getComputedStyle(document.documentElement);
  const cardHsl = style.getPropertyValue('--card').trim();
  const fgHsl = style.getPropertyValue('--foreground').trim();

  const cardHex = cardHsl ? hslStringToHex(cardHsl) : '#1a1a1a';
  const fgHex = fgHsl ? hslStringToHex(fgHsl) : '#9ca3af';

  electronAPI.setTitleBarOverlay(cardHex, fgHex);
}

export function applyThemeToDocument(colors?: Record<string, string>): void {
  if (typeof window === 'undefined') return;
  const root = document.documentElement;

  if (!colors) {
    THEME_TOKENS.forEach((t) => {
      root.style.removeProperty(t.nextVar);
      root.style.removeProperty(t.panelVar);
    });
    syncTitleBarOverlay();
    return;
  }

  THEME_TOKENS.forEach((token) => {
    const hex = colors[token.key] || token.defaultHex;
    const hsl = hexToHslString(hex);
    root.style.setProperty(token.nextVar, hsl);
    root.style.setProperty(token.panelVar, hex);
  });

  syncTitleBarOverlay();
}

export function getDefaultColors(): Record<string, string> {
  const out: Record<string, string> = {};
  THEME_TOKENS.forEach((t) => {
    out[t.key] = t.defaultHex;
  });
  return out;
}

/** Convierte HSL en formato "H S% L%" a HEX. */
function hslStringToHex(hsl: string): string {
  const parts = hsl.trim().split(/\s+/);
  if (parts.length < 3) return '#000000';
  const h = parseFloat(parts[0]);
  const s = parseFloat(parts[1]) / 100;
  const l = parseFloat(parts[2]) / 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Lee los colores computados actuales del DOM. */
export function readCurrentColorsFromDocument(): Record<string, string> {
  if (typeof window === 'undefined') return getDefaultColors();
  const style = getComputedStyle(document.documentElement);
  const isPanel = style.getPropertyValue('--color-primary').trim().length > 0;
  const out: Record<string, string> = {};

  THEME_TOKENS.forEach((token) => {
    const varName = isPanel ? token.panelVar : token.nextVar;
    let raw = style.getPropertyValue(varName).trim();
    if (!raw) {
      out[token.key] = token.defaultHex;
      return;
    }
    // HSL (Next.js): "217 91% 60%"
    if (raw.includes('%')) {
      out[token.key] = hslStringToHex(raw);
      return;
    }
    // HEX directo (panel-central)
    if (raw.startsWith('#')) {
      out[token.key] = raw;
      return;
    }
    // Fallback
    out[token.key] = token.defaultHex;
  });

  return out;
}

/* ── CRUD híbrido: PB primario, LS fallback ─────────── */

export async function fetchThemes(): Promise<SavedTheme[]> {
  const pbThemes = await getThemesFromPb();
  if (pbThemes.length > 0) {
    const mapped: SavedTheme[] = pbThemes.map((t) => ({
      id: t.id,
      name: t.name,
      colors: t.colors,
      createdAt: new Date(t.created).getTime(),
    }));
    setSavedThemes(mapped);
    return mapped;
  }
  return getSavedThemes();
}

export interface SaveThemeResult {
  theme: SavedTheme;
  savedToPb: boolean;
}

export async function saveTheme(name: string, colors: Record<string, string>): Promise<SaveThemeResult> {
  const existing = (await fetchThemes()).find((t) => t.name === name);
  const id = existing?.id;

  // Intentar guardar en PB
  const pbRecord = await saveThemeToPb(name, colors, id);
  const savedToPb = pbRecord != null;

  const theme: SavedTheme = {
    id: pbRecord?.id ?? id ?? crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name,
    colors: { ...colors },
    createdAt: Date.now(),
  };

  // También guardar en localStorage (offline / fallback)
  const themes = getSavedThemes().filter((t) => t.id !== theme.id);
  themes.push(theme);
  setSavedThemes(themes);

  return { theme, savedToPb };
}

export async function publishTheme(
  name: string,
  colors: Record<string, string>,
  iconLucide: boolean = false
): Promise<SaveThemeResult> {
  const pbRecord = await publishThemeToPb(name, colors, iconLucide);
  const savedToPb = pbRecord != null;

  const theme: SavedTheme = {
    id: pbRecord?.id ?? crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name,
    colors: { ...colors },
    createdAt: Date.now(),
  };

  return { theme, savedToPb };
}

export async function deleteTheme(id: string): Promise<void> {
  await deleteThemeFromPb(id);
  const themes = getSavedThemes().filter((t) => t.id !== id);
  setSavedThemes(themes);
}

export async function activateTheme(id: string, name: string): Promise<void> {
  await setActiveThemeInPb(id);
  setActiveThemeName(name);
}

export async function deactivateAllThemes(): Promise<void> {
  await deactivateAllThemesInPb();
  setActiveThemeName(null);
}

/* ── Carga inicial ─────────────────────────────────── */

export async function loadAndApplyTheme(): Promise<void> {
  if (typeof window === 'undefined') return;

  // 1. Intentar desde PocketBase
  const activePb = await getActiveThemeFromPb();
  if (activePb) {
    applyThemeToDocument(activePb.colors);
    setActiveThemeName(activePb.name);
    await syncThemesFromPbToLocal();
    return;
  }

  // 2. Fallback localStorage
  const activeName = getActiveThemeName();
  if (!activeName || activeName === DEFAULT_THEME_NAME) {
    applyThemeToDocument(undefined);
    return;
  }
  const theme = getSavedThemes().find((t) => t.name === activeName);
  if (theme) {
    applyThemeToDocument(theme.colors);
  } else {
    syncTitleBarOverlay();
  }
}
