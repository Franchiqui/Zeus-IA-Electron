'use client';

/**
 * Helper compartido para los Monacos del CHAT (ToolCallDisplay, ChatCodeBubble).
 *
 * Problema que resuelve: @monaco-editor/react, si no se configura su loader,
 * carga SU PROPIA instancia de Monaco (CDN) sin los temas que Zeus define en la
 * instancia local (zeus-dark, temas de extensiones). Si el tema activo (guardado
 * en la colección `monaco_themes` de PocketBase local) no es un tema built-in,
 * Monaco no lo encuentra y el editor queda con el fondo por defecto (blanco).
 *
 * Solución: forzar que el loader de @monaco-editor/react use la MISMA instancia
 * de `monaco-editor` bundleada localmente (la que initZeusMonaco() configura y
 * donde viven zeus-dark + los temas de extensiones), y un hook que lee el tema
 * desde PocketBase (`monaco_themes` → getActiveMonacoTheme) con fallback a
 * localStorage, igual que hace el editor principal (CodeEditor).
 *
 * IMPORTANTE (SSR): `monaco-editor` toca `window` al evaluarse, así que aquí
 * se importa SIEMPRE de forma dinámica dentro de la función (nunca en el
 * top-level del módulo). Un import estático rompe el prerender de Next con
 * "ReferenceError: window is not defined".
 */
import { useEffect, useState } from 'react';
import { getStoredTheme, onThemeChange, setStoredTheme } from './theme';
import { getActiveMonacoTheme, onMonacoThemeChange } from './monaco-theme-service';

let loaderConfigured = false;
let loaderPromise: Promise<void> | null = null;

/** Configura el loader UNA sola vez para que use la instancia local de Monaco. */
export function ensureReactMonacoLoader(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (loaderConfigured) return Promise.resolve();
  if (loaderPromise) return loaderPromise;

  loaderPromise = Promise.all([
    import('monaco-editor'),
    import('@monaco-editor/react'),
    // CRÍTICO: initZeusMonaco() define el tema por defecto 'zeus-dark' (y los
    // temas de extensiones) en la instancia local de Monaco. El editor del chat
    // monta con `theme="zeus-dark"` (o el tema de monaco_themes), así que si
    // esto no ha corrido antes, Monaco no encuentra el tema → fondo BLANCO
    // (default 'vs') y no se re-aplica porque el prop `theme` no cambia.
    // (import dinámico: init.ts importa monaco-editor estáticamente, así que
    //  cargarlo aquí a pelo rompería el prerender de Next.)
    import('./init').then((m) => m.initZeusMonaco()),
  ])
    .then(([monacoMod, reactMod]) => {
      reactMod.loader.config({ monaco: monacoMod });
      loaderConfigured = true;
    })
    .catch((e) => {
      loaderPromise = null; // permitir reintentar
      console.warn('[zeus-monaco/react-loader] loader.config falló:', e);
    });

  return loaderPromise;
}

/**
 * Hook de tema para Monacos del chat: inicializa desde PocketBase
 * (colección monaco_themes) → localStorage, y se mantiene sincronizado con el
 * ThemePicker (evento 'zeus:monaco-theme-changed' + realtime de PocketBase).
 */
export function useChatMonacoTheme(): string {
  const [theme, setTheme] = useState<string>(() => getStoredTheme() || 'vs-dark');

  // 1. Sincronización inicial con PocketBase (misma fuente que el editor principal)
  useEffect(() => {
    let cancelled = false;
    getActiveMonacoTheme()
      .then((pbTheme) => {
        if (cancelled) return;
        if (pbTheme?.themeId) {
          setTheme(pbTheme.themeId);
          setStoredTheme(pbTheme.themeId);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // 2. Suscripción local (ThemePicker de la misma pestaña)
  useEffect(() => {
    return onThemeChange((themeId) => {
      if (themeId) setTheme(themeId);
    });
  }, []);

  // 3. Suscripción remota (otra pestaña vía PocketBase Realtime)
  useEffect(() => {
    return onMonacoThemeChange((themeId) => {
      if (themeId) setTheme(themeId);
    });
  }, []);

  return theme;
}
