import * as path from 'path';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';

// Mock de UsageService para evitar errores de facturación
export const UsageService = {
    recordUsage: async (userId: string, modelInfo: any, usageData: any) => {
        console.log(`[Usage Mock] Recording usage for user ${userId}:`, { modelInfo, usageData });
        return { success: true };
    }
};

// Leer DATA_PATH desde api/.env (respeta ZEUS_API_ENV_PATH cuando Electron lo setea)
function readDataPathFromEnv(): string | null {
  const envPath = process.env.ZEUS_API_ENV_PATH
    ? path.resolve(process.env.ZEUS_API_ENV_PATH)
    : path.join(process.cwd(), 'api', '.env');
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
    console.error('[utils] Error al leer DATA_PATH desde .env:', (error as Error).message);
  }
  return null;
}

// Resolver la ruta del proyecto basándose en DATA_PATH
// DATA_PATH es siempre la raíz directa de la aplicación actual, sin subcarpetas.
export async function getProjectRoot(_projectId?: string, currentRoot?: string): Promise<string> {
    const dataPath = readDataPathFromEnv() || process.env.DATA_PATH;
    const baseDataPath = dataPath
      ? path.normalize(path.isAbsolute(dataPath) ? dataPath : path.resolve(process.cwd(), dataPath))
      : path.join(process.cwd(), 'data');

    if (currentRoot) {
      const resolved = path.normalize(currentRoot);
      // Solo confiar en currentRoot si está dentro de DATA_PATH
      if (path.isAbsolute(resolved) && resolved.toLowerCase().startsWith(baseDataPath.toLowerCase())) {
        return resolved;
      }
    }

    return baseDataPath;
}

// Obtener modelos para un usuario (Placeholder)
export async function getModelsForUser(userId: string): Promise<any[]> {
    console.log(`[Utils Mock] getModelsForUser called for user ${userId}`);
    return [];
}

// Obtener URLs base
export function getApiBaseUrl(provider: string): string {
    switch (provider.toLowerCase()) {
        case 'openai': return 'https://api.openai.com/v1/chat/completions';
        case 'deepseek': return 'https://api.deepseek.com/chat/completions';
        case 'google': return 'https://generativelanguage.googleapis.com/v1beta/models';
        default: return '';
    }
}

export function getPreviewServerUrl(): string {
    return process.env.NEXT_PUBLIC_LOCAL_SERVER_URL || 'http://localhost:8741';
}

// Stub para aplicar cambios en PocketBase
export async function applyChangesPocketBaseFirst(args: any) {
    console.log('[PocketBase Sync Mock] Simulating sync for project:', args.projectId);
    // Devolver objeto compatible con lo que espera route.ts
    return {
        success: true,
        appliedCount: 1,
        error: null
    };
}

// Interfaces compartidas con compatibilidad para campos antiguos y nuevos
export interface StorageModelConfig {
    model: any;
    url: string;
    id: string;
    name: string;
    provider: string;
    model_name: string;
    base_url: string;
    api_key: string;
    type?: string;
    autonomy?: string;
    temperature?: number;
    maxTokens?: number;
    config?: {
        temperature?: number;
        max_tokens?: number;
    };
}

// Función auxiliar para leer archivos de forma segura
export async function readFileContent(filePath: string, root: string): Promise<string> {
    try {
        const fullPath = path.join(root, filePath);
        return await fs.readFile(fullPath, 'utf-8');
    } catch (error) {
        console.error(`[Utils] Error leyendo archivo ${filePath}:`, error);
        throw error;
    }
}

// Función para leer la configuración de API personalizada (zeus-api-config.json)
export async function readApiConfig(root?: string): Promise<string | null> {
    try {
        const configPath = root
            ? path.join(root, 'API', 'zeus-api-config.json')
            : path.join(process.cwd(), 'API', 'zeus-api-config.json');
        const content = await fs.readFile(configPath, 'utf-8');
        return content;
    } catch (error) {
        console.log('[Utils] No se encontró API config:', (error as Error).message);
        return null;
    }
}

// Función para escribir la configuración de API personalizada (zeus-api-config.json)
export async function writeApiConfig(data: string, root?: string): Promise<void> {
    try {
        const configPath = root
            ? path.join(root, 'API', 'zeus-api-config.json')
            : path.join(process.cwd(), 'API', 'zeus-api-config.json');
        const dir = path.dirname(configPath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(configPath, data, 'utf-8');
        console.log('[Utils] API config guardada en:', configPath);
    } catch (error) {
        console.error('[Utils] Error al escribir API config:', (error as Error).message);
        throw error;
    }
}
