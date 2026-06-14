/**
 * Tipos compartidos entre el renderer y (vía JSDoc) el main process para el
 * módulo "Instalador de Extensiones VS Code" dentro del panel IDE de Zeus-IA.
 */

/** Extensión VS Code instalada (formato de id: "publisher.name"). */
export interface InstalledExtension {
  id: string;
  publisher: string;
  name: string;
  version: string;
}

/** Tipo de operación que se solicita al CLI `code`. */
export type VsxOperation =
  | { kind: 'list' }
  | { kind: 'install-id'; id: string }
  | { kind: 'install-vsix'; vsixPath: string }
  | { kind: 'uninstall'; id: string }
  | { kind: 'enable'; id: string }
  | { kind: 'disable'; id: string };

/** Chunk de log que se muestra en el panel inferior de la pestaña. */
export interface VsxLogChunk {
  stream: 'stdout' | 'stderr' | 'system';
  text: string;
  ts: number;
}

/** Resultado del chequeo inicial de disponibilidad del binario `code`. */
export interface VsxCheckResult {
  available: boolean;
  version?: string;
  path?: string;
  error?: string;
}

/** Resultado genérico de una operación contra el CLI `code`. */
export interface VsxOperationResult {
  success: boolean;
  code: number;
  stdout: string;
  stderr: string;
  operation: VsxOperation;
  durationMs: number;
  error?: string;
}

/** Payload para el IPC de instalación (id o ruta .vsix, uno de los dos). */
export interface VsxInstallPayload {
  id?: string;
  vsixPath?: string;
}

/** Payload para el file picker de .vsix. */
export interface VsxPickResult {
  canceled: boolean;
  filePath?: string;
}

// =============================================================================
// Zeus Marketplace (Open VSX)
// =============================================================================

/** Resultado de búsqueda en Open VSX: GET /api/-/search?query=... */
export interface OpenVsxSearchResult {
  total: number;
  extensions: OpenVsxExtensionSummary[];
}

export interface OpenVsxExtensionSummary {
  namespace: string;
  name: string;
  displayName?: string;
  description?: string;
  publisher?: { displayName?: string; name?: string };
  latestVersion?: string;
  version?: string;
  downloadCount?: number;
  rating?: number;
  ratingCount?: number;
  /**
   * Open VSX no devuelve un `iconUrl` plano en /api/-/search; viene dentro de
   * `files.icon`. Esta normalización la hacemos en el cliente.
   */
  iconUrl?: string;
  files?: {
    download?: string;
    icon?: string;
  };
  categories?: string[];
  tags?: string[];
}

/** Metadata detallada de una extensión: GET /api/{namespace}/{name} */
export interface OpenVsxExtensionDetail {
  name: string;
  namespace: string;
  displayName?: string;
  description?: string;
  publisher?: { displayName?: string; name?: string };
  versions: OpenVsxVersionMeta[];
  categories?: string[];
  tags?: string[];
  iconUrl?: string;
}

export interface OpenVsxVersionMeta {
  version: string;
  timestamp?: string;
  engine?: string; // p.ej. "^1.85.0"
  dependencies?: string[];
  downloadCount?: number;
}

/** Estado del extension host de Zeus. */
export type ZeusHostStatus = 'uninitialized' | 'initializing' | 'ready' | 'error';
