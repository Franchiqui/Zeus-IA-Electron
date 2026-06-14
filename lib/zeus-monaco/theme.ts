/**
 * Estado global del tema de Monaco en Zeus — **sin dependencias de Monaco**.
 *
 * Este módulo solo usa `localStorage` y `window` (CustomEvent). Es seguro
 * importarlo estáticamente desde cualquier Client Component de Next sin
 * que dispare el SSR de `monaco-editor`.
 *
 * - `getStoredTheme()` / `setStoredTheme()`: persistencia.
 * - `onThemeChange()`: suscripción al evento 'zeus:monaco-theme-changed'.
 * - `emitThemeChange()`: dispara el evento y persiste.
 *
 * La parte de "aplicar el tema a la instancia de Monaco" vive en
 * `init.ts → applyMonacoTheme()` y la consume el MonacoEditor al recibir
 * el evento.
 */

const STORAGE_KEY = 'zeus.monaco.theme';
const EVENT_NAME = 'zeus:monaco-theme-changed';

function safeGet(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function safeSet(themeId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, themeId);
  } catch {
    // ignorar
  }
}

/** Tema persistido. Null si no hay ninguno guardado. */
export function getStoredTheme(): string | null {
  return safeGet();
}

/** Persiste un tema. */
export function setStoredTheme(themeId: string): void {
  safeSet(themeId);
  if (typeof window !== 'undefined') {
    (window as any).__ZEUS_THEME__ = themeId;
  }
}

/** Suscribe a cambios de tema. Devuelve función de cleanup. */
export function onThemeChange(handler: (themeId: string) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (e: Event) => {
    const ce = e as CustomEvent<{ themeId: string }>;
    handler(ce.detail?.themeId || safeGet() || '');
  };
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}

/** Dispara el evento (uso desde el ThemePicker). */
export function emitThemeChange(themeId: string): void {
  if (typeof window === 'undefined') return;
  safeSet(themeId);
  (window as any).__ZEUS_THEME__ = themeId;
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { themeId } }));
}

export { EVENT_NAME as THEME_CHANGE_EVENT };
