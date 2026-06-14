import * as path from 'path';
import * as fsSync from 'fs';

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

export function getBaseDataPath(): string {
  const dataPath = readDataPathFromEnv() || process.env.DATA_PATH;
  if (!dataPath) {
    throw new Error('DATA_PATH no configurado');
  }
  return path.normalize(
    path.isAbsolute(dataPath) ? dataPath : path.resolve(process.cwd(), dataPath)
  );
}

/**
 * DATA_PATH efectivo para APIs del IDE.
 * - Desarrollo: suele ser `process.cwd()/api/.env`.
 * - Electron empaquetado: `ZEUS_API_ENV_PATH` apunta a `userData/api/.env` (ver electron/main.js).
 */
export function getResolvedDataPathDirectory(): string {
  return path.resolve(getBaseDataPath());
}

/**
 * Comprueba que la carpeta de trabajo (p. ej. DATA_PATH + subcarpeta del explorador) está bajo DATA_PATH.
 * Usa path.resolve y el separador del SO para evitar falsos positivos (.../data vs .../dataExtra).
 */
export function resolveAllowedWorkspaceRoot(clientProjectRoot: string):
  | { ok: true; root: string }
  | { ok: false; status: number; message: string } {
  let resolvedBase: string;
  try {
    resolvedBase = getResolvedDataPathDirectory();
  } catch {
    return { ok: false, status: 500, message: 'DATA_PATH no configurado' };
  }

  if (!clientProjectRoot || typeof clientProjectRoot !== 'string' || !clientProjectRoot.trim()) {
    return { ok: false, status: 400, message: 'projectRoot es requerido' };
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
        'La carpeta del proyecto debe estar dentro de DATA_PATH. En Electron, el valor válido es el de api/.env (userData); sincronízalo con la ruta del explorador o guarda de nuevo en configuración.',
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
