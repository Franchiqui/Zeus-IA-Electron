import * as path from 'path';
import * as fsSync from 'fs';
import { getActiveSessionCwd } from '@/lib/sessionResolve';

export function getApiEnvPath(): string {
  if (process.env.ZEUS_API_ENV_PATH) {
    return path.resolve(process.env.ZEUS_API_ENV_PATH);
  }
  return path.join(process.cwd(), 'api', '.env');
}

export function readDataPathFromEnv(): string | null {
  const envPath = getApiEnvPath();
  try {
    if (fsSync.existsSync(envPath)) {
      const envContent = fsSync.readFileSync(envPath, 'utf8');
      const dataPathMatch = envContent.match(/^DATA_PATH\s*=\s*"([^"]+)"/m);
      if (dataPathMatch) {
        const rawPath = dataPathMatch[1];
        return path.normalize(
          path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath)
        );
      }
    }
  } catch (error) {
    console.error('[env] Error al leer DATA_PATH desde .env:', (error as Error).message);
  }
  return null;
}

// --- Resolución de cwd por sesión ---
// El anclaje global DATA_PATH quedó obsoleto: el cwd lo define la sesión activa
// (header X-Zeus-Session), resuelta vía Express. DATA_PATH solo se usa como
// fallback heredado durante la migración.
let activeCwdCache: { cwd: string | null; exp: number } | null = null;
const ACTIVE_CWD_TTL_MS = 5000;

async function resolveActiveCwd(): Promise<string | null> {
  const now = Date.now();
  if (activeCwdCache && activeCwdCache.exp > now) return activeCwdCache.cwd;
  try {
    const { cwd } = await getActiveSessionCwd();
    activeCwdCache = { cwd, exp: now + ACTIVE_CWD_TTL_MS };
    return cwd;
  } catch {
    return null;
  }
}

/** Invalida la caché del cwd activo (tras cambiar de proyecto/sesión). */
export function invalidateEnvActiveCwd(): void {
  activeCwdCache = null;
}

/**
 * Devuelve el cwd base: el de la sesión activa, o (fallback heredado) DATA_PATH.
 * Ahora es asíncrona porque resuelve la sesión contra Express por HTTP.
 */
export async function getBaseDataPath(): Promise<string> {
  const active = await resolveActiveCwd();
  if (active) return path.normalize(active);
  const dataPath = readDataPathFromEnv() || process.env.DATA_PATH;
  if (!dataPath) {
    throw new Error('No hay sesión activa y DATA_PATH no configurado');
  }
  return path.normalize(
    path.isAbsolute(dataPath) ? dataPath : path.resolve(process.cwd(), dataPath)
  );
}

/**
 * Cwd efectivo para APIs del IDE (sesión activa o fallback DATA_PATH).
 */
export async function getResolvedDataPathDirectory(): Promise<string> {
  return path.resolve(await getBaseDataPath());
}

/**
 * Comprueba que la carpeta de trabajo está bajo el cwd de la sesión (o fallback DATA_PATH).
 * Usa path.resolve y el separador del SO para evitar falsos positivos (.../data vs .../dataExtra).
 * Ahora asíncrona. Si no se proporciona clientProjectRoot, devuelve la base (cwd activo).
 */
export async function resolveAllowedWorkspaceRoot(clientProjectRoot: string):
  Promise<{ ok: true; root: string } | { ok: false; status: number; message: string }> {
  let resolvedBase: string;
  try {
    resolvedBase = await getResolvedDataPathDirectory();
  } catch {
    return { ok: false, status: 500, message: 'No hay sesión activa ni DATA_PATH configurado' };
  }

  if (!clientProjectRoot || typeof clientProjectRoot !== 'string' || !clientProjectRoot.trim()) {
    return { ok: true, root: resolvedBase };
  }

  const resolvedClient = path.resolve(path.normalize(clientProjectRoot.trim()));

  const bl = resolvedBase.toLowerCase();
  const cl = resolvedClient.toLowerCase();
  const sep = path.sep;
  const inside = cl === bl || cl.startsWith(bl + sep);

  if (!inside) {
    return {
      ok: false,
      status: 403,
      message:
        'La carpeta del proyecto debe estar dentro del cwd de la sesión activa. Selecciona la carpeta de proyecto en el IDE.',
    };
  }

  try {
    fsSync.mkdirSync(resolvedClient, { recursive: true });
  } catch (e) {
    console.warn('[env] resolveAllowedWorkspaceRoot mkdir:', e);
  }

  return { ok: true, root: resolvedClient };
}

export function readEnvFile(): Record<string, string> {
  const envPath = getApiEnvPath();
  try {
    if (fsSync.existsSync(envPath)) {
      const content = fsSync.readFileSync(envPath, 'utf8');
      const lines = content.split('\n');
      const result: Record<string, string> = {};
      for (const line of lines) {
        const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"]*)"/);
        if (match) {
          result[match[1]] = match[2];
        }
      }
      return result;
    }
  } catch {
    // ignore
  }
  return {};
}

export function writeEnvFile(vars: Record<string, string>) {
  const envPath = getApiEnvPath();
  const envDir = path.dirname(envPath);
  if (!fsSync.existsSync(envDir)) {
    fsSync.mkdirSync(envDir, { recursive: true });
  }
  let content = '';
  for (const [key, value] of Object.entries(vars)) {
    content += `${key} = "${value}"\n`;
  }
  fsSync.writeFileSync(envPath, content, 'utf8');
}
