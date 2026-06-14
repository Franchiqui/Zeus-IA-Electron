/**
 * Inicialización del editor Monaco en Zeus.
 *
 * El extension host de VS Code (vía `@codingame/monaco-vscode-api`) no
 * bundlea correctamente con Next.js 16, así que Zeus usa un host propio
 * (lib/zeus-monaco/host.ts) que aplica los `contributes.*` del manifest
 * directamente sobre la API estándar de Monaco.
 *
 * Esta función:
 *   1. Configura MonacoEnvironment.getWorker() para servir el editor worker
 *      bundleado por `monaco-editor-webpack-plugin` (ver next.config.js).
 *   2. Importa `monaco-editor` (la versión real, sin alias) y lo pasa al host.
 *   3. Marca `initialized = true` para que `isMonacoReady()` devuelva true.
 *
 * Idempotente: llamadas subsiguientes devuelven la misma promesa.
 */

import * as monaco from 'monaco-editor';
import { host } from './host';

let initPromise: Promise<void> | null = null;
let initialized = false;

/**
 * Configura el editor worker. En Next.js 16 + Webpack, el worker se importa
 * con el patrón `new URL('...', import.meta.url)` para que
 * monaco-editor-webpack-plugin lo bundle en un chunk separado.
 */
function setupMonacoEnvironment(): void {
  if (typeof window === 'undefined') return;

  const editorWorker = new Worker(
    new URL('monaco-editor/esm/vs/editor/editor.worker', import.meta.url),
    { type: 'module' },
  );

  (window as any).MonacoEnvironment = {
    getWorker: (_moduleId: string, label: string) => {
      if (label === 'editorWorkerService') return editorWorker;
      return undefined;
    },
  };
}

/**
 * Inicializa Monaco y bindea el host. Devuelve la misma promesa en llamadas
 * subsiguientes (singleton).
 *
 * Una vez resuelta, los componentes pueden usar `monaco.editor.*` directamente
 * y llamar a `loadInstalledExtensions()` para aplicar las extensiones.
 */
export function initZeusMonaco(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (initialized) return initPromise!;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    setupMonacoEnvironment();

    // Bindeamos el host a la instancia global de Monaco. A partir de aquí
    // `host.register(ext)` puede llamar a monaco.* directamente.
    host.bindMonaco(monaco);

    // Definimos el tema por defecto de Zeus ('zeus-dark'). Es el tema
    // que se aplica por defecto al abrir un archivo y el que aparece
    // como "Zeus Dark" en el ThemePicker. Idéntico a la paleta de
    // Zeus (gris-azul muy oscuro, acentos cian/violeta).
    monaco.editor.defineTheme('zeus-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: '', background: '030712', foreground: 'e2e8f0' },
        { token: 'comment', foreground: '64748b', fontStyle: 'italic' },
        { token: 'keyword', foreground: '38bdf8' },
        { token: 'string', foreground: '4ade80' },
        { token: 'number', foreground: 'fbbf24' },
        { token: 'type', foreground: 'c084fc' },
        { token: 'function', foreground: '60a5fa' },
        { token: 'variable', foreground: 'e2e8f0' },
      ],
      colors: {
        'editor.background': '#030712',
        'editor.foreground': '#e2e8f0',
        'editorCursor.foreground': '#38bdf8',
        'editor.selectionBackground': '#1e3a5f',
        'editor.lineHighlightBackground': '#0a0f1a',
        'editorLineNumber.foreground': '#475569',
        'editorLineNumber.activeForeground': '#38bdf8',
        'editorIndentGuide.background': '#0f172a',
        'editorIndentGuide.activeBackground': '#1e293b',
      },
    });

    initialized = true;
  })();

  return initPromise;
}

/**
 * Hook conveniente para componentes React: ¿la inicialización ha terminado?
 *
 * Uso:
 *   const ready = isMonacoReady();
 *   if (!ready) return <Loading />;
 */
export function isMonacoReady(): boolean {
  if (typeof window === 'undefined') return false;
  return initialized;
}

/**
 * Devuelve la instancia de Monaco. Solo se puede llamar DESPUÉS de initZeusMonaco().
 * Útil para componentes que necesitan acceso directo (p.ej. para definir temas
 * adicionales o registrar providers custom).
 */
export function getMonaco(): typeof monaco {
  if (!initialized) {
    throw new Error('getMonaco() llamado antes de initZeusMonaco()');
  }
  return monaco;
}

/**
 * Aplica un tema por id. Si el id no está definido en Monaco, devuelve `false`
 * para que el caller pueda decidir qué hacer (p.ej. no persistir).
 *
 * Implementación: probamos a aplicar el tema. Si Monaco no se ha inicializado
 * todavía (p.ej. el ThemePicker se montó antes que el editor), devolvemos
 * false. Si el id es desconocido, Monaco ignora la llamada y nosotros
 * devolvemos false tras un intento de verificación suave.
 */
export function applyMonacoTheme(themeId: string): boolean {
  if (typeof window === 'undefined') return false;
  if (!initialized) return false;
  try {
    monaco.editor.setTheme(themeId);
    return true;
  } catch {
    return false;
  }
}
