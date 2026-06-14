/**
 * Carga de extensiones instaladas EN ZEUS dentro del host propio.
 *
 * Patrón:
 *   1. listInstalled() consulta el IPC para saber qué hay en
 *      userData/extensions/<id>/<version>/.
 *   2. Por cada extensión, leemos su package.json (manifest) desde el IPC.
 *   3. Leemos TODOS los archivos referenciados en contributes.*
 *      (themes/*.json, grammars/*.json, snippets/*.json,
 *      language-configuration.json, etc.) y los metemos en un Map de contenido.
 *   4. Pasamos el LoadedExtension al host.register() que aplica los contributes
 *      directamente sobre la API estándar de Monaco.
 *
 * Importante: este módulo asume que initZeusMonaco() ya se ejecutó
 * (porque el host necesita la instancia de Monaco bindeada).
 */

import { isMonacoReady } from './init';
import { host, type LoadedExtension, type ParsedManifest } from './host';

export interface InstalledExtensionInfo {
  id: string;
  namespace: string;
  name: string;
  version: string;
  displayName: string;
  description: string;
  engines: any;
  categories: string[];
  path: string;
}

let loadPromise: Promise<InstalledExtensionInfo[]> | null = null;

// =============================================================================
// IPC wrappers
// =============================================================================

interface ZeusExtensionsApi {
  list: () => Promise<{ success: boolean; extensions?: InstalledExtensionInfo[]; error?: string }>;
  install: (payload: { id: string; version?: string }) => Promise<{ success: boolean; alreadyInstalled?: boolean; error?: string; path?: string; version?: string }>;
  uninstall: (payload: { id: string }) => Promise<{ success: boolean; alreadyAbsent?: boolean; error?: string }>;
  readBuffer: (payload: { id: string; version: string; path: string }) => Promise<{ success: boolean; content?: string; error?: string; path?: string }>;
}

function getApi(): ZeusExtensionsApi | null {
  if (typeof window === 'undefined') return null;
  return (window as any).electronAPI?.zeusExtensions ?? null;
}

export async function listInstalled(): Promise<InstalledExtensionInfo[]> {
  const api = getApi();
  if (!api) {
    console.warn('[zeus-monaco] window.electronAPI.zeusExtensions no disponible (¿fuera de Electron?)');
    return [];
  }
  const result = await api.list();
  if (!result.success) {
    console.error('[zeus-monaco] extensions:list falló:', result.error);
    return [];
  }
  return result.extensions || [];
}

export async function installExtension(
  id: string,
  version?: string,
): Promise<{ success: boolean; alreadyInstalled?: boolean; error?: string; path?: string; version?: string }> {
  const api = getApi();
  if (!api) return { success: false, error: 'IPC no disponible' };
  return api.install({ id, version });
}

export async function uninstallExtension(
  id: string,
): Promise<{ success: boolean; alreadyAbsent?: boolean; error?: string }> {
  const api = getApi();
  if (!api) return { success: false, error: 'IPC no disponible' };
  return api.uninstall({ id });
}

/**
 * Lee un archivo de una extensión instalada. Devuelve null si falla.
 */
async function readExtensionFile(
  id: string,
  version: string,
  relPath: string,
): Promise<string | null> {
  const api = getApi();
  if (!api) return null;
  // Los paths del manifest son relativos a `extension/` dentro del .vsix
  // extraído. El IPC `readBuffer` espera el path relativo a
  // <extDir>/<version>/, así que añadimos el prefijo `extension/` si no está.
  const ipcPath = relPath.startsWith('extension/') ? relPath : `extension/${relPath.replace(/^\//, '')}`;
  const result = await api.readBuffer({ id, version, path: ipcPath });
  if (!result.success) return null;
  return result.content ?? null;
}

// =============================================================================
// Carga de extensiones
// =============================================================================

/**
 * Carga todas las extensiones instaladas en el host.
 *
 * Esta función es idempotente: llamadas subsiguientes devuelven la misma
 * promesa cacheada. Para forzar recarga, llamar `loadInstalledExtensions(true)`.
 *
 * Devuelve `InstalledExtensionInfo[]` (la misma shape que `listInstalled()`)
 * para mantener la API existente del componente MarketplaceTab.
 */
export function loadInstalledExtensions(force = false): Promise<InstalledExtensionInfo[]> {
  if (typeof window === 'undefined') return Promise.resolve([]);
  if (loadPromise && !force) return loadPromise;
  if (loadPromise && force) loadPromise = null;

  loadPromise = (async () => {
    if (!isMonacoReady()) {
      console.error('[zeus-monaco] initZeusMonaco() no se ha llamado todavía');
      return [];
    }
    if (!host.isReady()) {
      console.error('[zeus-monaco] host no está bindeado a Monaco');
      return [];
    }

    const installed = await listInstalled();
    console.log(`[zeus-monaco] ${installed.length} extensión(es) instalada(s). Registrando en el host…`);

    // Antes de cargar, descargar las extensiones que ya NO están en disco
    // (típicamente porque el usuario las desinstaló). Sin esto, el ThemePicker
    // muestra temas de extensiones "zombi" que ya no existen.
    const installedIds = new Set(installed.map((e) => `${e.id}@${e.version}`));
    const loadedIds = host.list().map((e) => e.key);
    for (const key of loadedIds) {
      if (!installedIds.has(key)) {
        console.log(`[zeus-monaco] Descargando extensión ausente: ${key}`);
        try {
          await host.unload(key);
        } catch (err) {
          console.warn(`[zeus-monaco] Error descargando ${key}:`, err);
        }
      }
    }

    const results: InstalledExtensionInfo[] = [];
    for (const ext of installed) {
      try {
        const loaded = await readAndRegisterExtension(ext);
        if (loaded) results.push(ext);
      } catch (err) {
        console.error(`[zeus-monaco] Error registrando ${ext.id}:`, err);
      }
    }

    return results;
  })();

  return loadPromise;
}

/**
 * Devuelve los LoadedExtension actualmente en el host (después de un load).
 * Útil para la UI para mostrar las extensiones activas sin re-llamar a listInstalled.
 */
export function listLoaded(): LoadedExtension[] {
  return host.list();
}

/**
 * Devuelve los temas registrados por las extensiones instaladas en el host.
 * Cada item: { id, label, uiTheme, extensionId, extensionDisplayName }.
 * Los `monaco.editor.defineTheme()` ya se han aplicado — basta con que el
 * ThemePicker llame a `monaco.editor.setTheme(id)`.
 */
export function listRegisteredThemes() {
  return host.getRegisteredThemes();
}

/**
 * Devuelve los comandos registrados por extensiones. Útil para una futura
 * paleta de comandos.
 */
export function listCommands() {
  return host.getCommands();
}

// =============================================================================
// Lectura detallada de una extensión instalada
// =============================================================================

export interface InstalledExtensionDetail {
  /** "publisher.name" */
  id: string;
  version: string;
  manifest: ParsedManifest;
  /** Contenido del README.md (markdown). Null si no existe. */
  readme: string | null;
  /** Contenido del CHANGELOG.md (markdown). Null si no existe. */
  changelog: string | null;
}

const README_CANDIDATES = ['README.md', 'readme.md', 'Readme.md', 'README', 'readme'];
const CHANGELOG_CANDIDATES = ['CHANGELOG.md', 'changelog.md', 'Changelog.md', 'CHANGELOG'];

/**
 * Parsea un manifest de VS Code desde un string. Devuelve null si falla.
 */
function parseManifest(raw: string): ParsedManifest | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Lee el manifest + README + CHANGELOG de una extensión instalada localmente.
 * Devuelve null si no se puede leer el manifest.
 */
export async function readInstalledExtensionDetail(
  id: string,
  version: string,
): Promise<InstalledExtensionDetail | null> {
  const manifestRaw = await readExtensionFile(id, version, 'package.json');
  if (!manifestRaw) return null;
  const manifest = parseManifest(manifestRaw);
  if (!manifest) return null;
  let readme: string | null = null;
  for (const candidate of README_CANDIDATES) {
    const content = await readExtensionFile(id, version, candidate);
    if (content) {
      readme = content;
      break;
    }
  }
  let changelog: string | null = null;
  for (const candidate of CHANGELOG_CANDIDATES) {
    const content = await readExtensionFile(id, version, candidate);
    if (content) {
      changelog = content;
      break;
    }
  }
  return {
    id,
    version,
    manifest,
    readme,
    changelog,
  };
}

/**
 * Lee el detalle de una extensión DESDE OPEN VSX (sin instalar). Útil para
 * que el usuario previsualice el README antes de decidir instalar.
 *
 * Estrategia: descarga el `package.json` (manifest) y los `README.md` /
 * `CHANGELOG.md` que suelen incluir los autores. No descarga el .vsix
 * completo (que puede ser MB), solo los archivos de texto pequeños.
 *
 * Si la versión no se especifica, usa la latest publicada (`meta.version`).
 * Devuelve null si la extensión no existe en Open VSX o si falla la red.
 */
export async function readOpenVsxExtensionDetail(
  id: string,
  version?: string,
): Promise<InstalledExtensionDetail | null> {
  const m = id.match(/^([a-zA-Z0-9_.-]+)\.([a-zA-Z0-9_.-]+)$/);
  if (!m) return null;
  const namespace = m[1];
  const name = m[2];

  try {
    // 1. Metadata para saber qué versión consultar y dónde está el manifest
    const metaRes = await fetch(`https://open-vsx.org/api/${namespace}/${name}`);
    if (!metaRes.ok) return null;
    const meta = await metaRes.json();
    const targetVersion = version || meta.version;
    if (!targetVersion) return null;

    // 2. Descargar manifest (es pequeño, ~5-50 KB)
    const manifestUrl = meta.files?.manifest || `https://open-vsx.org/api/${namespace}/${name}/${targetVersion}/file/package.json`;
    const manifestRes = await fetch(manifestUrl);
    if (!manifestRes.ok) return null;
    const manifestText = await manifestRes.text();
    const manifest = parseManifest(manifestText);
    if (!manifest) return null;

    // 3. Descargar README y CHANGELOG desde el endpoint por archivo.
    //    Open VSX sirve el archivo si existe; si no, devuelve 404 y seguimos.
    const base = `https://open-vsx.org/api/${namespace}/${name}/${targetVersion}/file/`;
    let readme: string | null = null;
    for (const candidate of README_CANDIDATES) {
      try {
        const r = await fetch(base + candidate);
        if (r.ok) {
          readme = await r.text();
          break;
        }
      } catch {
        // seguir probando
      }
    }
    let changelog: string | null = null;
    for (const candidate of CHANGELOG_CANDIDATES) {
      try {
        const r = await fetch(base + candidate);
        if (r.ok) {
          changelog = await r.text();
          break;
        }
      } catch {
        // seguir probando
      }
    }

    return {
      id,
      version: targetVersion,
      manifest,
      readme,
      changelog,
    };
  } catch {
    return null;
  }
}

/**
 * Lee el manifest y todos los contributes.* de una extensión, y los pasa al host.
 */
async function readAndRegisterExtension(ext: InstalledExtensionInfo): Promise<LoadedExtension | null> {
  // 1. Manifest
  const manifestRaw = await readExtensionFile(ext.id, ext.version, 'package.json');
  if (!manifestRaw) {
    console.warn(`[zeus-monaco] No se pudo leer el manifest de ${ext.id}`);
    return null;
  }

  let manifest: ParsedManifest;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch (err) {
    console.warn(`[zeus-monaco] Manifest JSON inválido de ${ext.id}:`, err);
    return null;
  }

  // 2. Construir el mapa de archivos a leer
  const pathsToRead = new Set<string>();
  pathsToRead.add('package.json');

  const c = manifest.contributes ?? {};
  for (const t of c.themes ?? []) pathsToRead.add(t.path);
  for (const g of c.grammars ?? []) {
    pathsToRead.add(g.path);
    if (g.languageConfigurationPath) pathsToRead.add(g.languageConfigurationPath);
  }
  for (const s of c.snippets ?? []) pathsToRead.add(s.path);
  for (const l of c.languages ?? []) {
    if (l.configuration) pathsToRead.add(l.configuration);
  }

  // 3. Leer todos los archivos en paralelo
  const files = new Map<string, string>();
  await Promise.all(
    Array.from(pathsToRead).map(async (relPath) => {
      const content = await readExtensionFile(ext.id, ext.version, relPath);
      if (content != null) {
        // Guardamos el path tal cual (sin prefijo) — el host prueba varias
        // formas al resolver.
        files.set(relPath, content);
        files.set(`/${relPath.replace(/^\//, '')}`, content);
      }
    }),
  );

  // 4. Construir el LoadedExtension
  const id = `${manifest.publisher}.${manifest.name}`;
  const loaded: LoadedExtension = {
    id,
    version: manifest.version,
    namespace: manifest.publisher,
    name: manifest.name,
    key: `${id}@${manifest.version}`,
    displayName: manifest.displayName || manifest.name,
    description: manifest.description || '',
    categories: (manifest as any).categories || [],
    manifest,
    files,
  };

  // 5. Registrar en el host
  await host.register(loaded);
  console.log(`[zeus-monaco] ✓ ${loaded.id}@${loaded.version} registrado (${files.size} archivos)`);
  return loaded;
}

/**
 * Desregistra una extensión por id. Útil cuando el usuario la desinstala
 * desde la UI y queremos limpiar el host sin reiniciar la app.
 */
export async function unloadExtension(id: string, version?: string): Promise<void> {
  if (!host.isReady()) return;
  // Si no se pasa version, intentamos encontrar la versión cargada
  if (version) {
    await host.unload(`${id}@${version}`);
    return;
  }
  const loaded = host.list();
  const ext = loaded.find((e) => e.id === id);
  if (ext) await host.unload(ext.key);
}
