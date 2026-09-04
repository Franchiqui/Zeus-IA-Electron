import PocketBase from 'pocketbase';

let pb: PocketBase | null = null;
let initialized = false;

/** Respuesta cuando el login admin falla habiendo credenciales configuradas. */
export type DevAdminAuthFailure = {
  error: string;
  details?: string;
  status: number;
};

/**
 * En `NODE_ENV === 'development'`, inicia sesión como admin solo si
 * `POCKETBASE_ADMIN_EMAIL` y `POCKETBASE_ADMIN_PASSWORD` están definidos.
 * Si no están, continúa sin admin (evita 500 por `undefined`).
 * Si están y el login falla, devuelve error explícito (502).
 */
export async function ensureDevAdminIfConfigured(
  pb: PocketBase,
  logLabel: string
): Promise<DevAdminAuthFailure | null> {
  if (process.env.NODE_ENV !== 'development') {
    return null;
  }
  const email = process.env.POCKETBASE_ADMIN_EMAIL?.trim();
  const password = process.env.POCKETBASE_ADMIN_PASSWORD;
  const hasPassword = password !== undefined && password !== null && String(password).length > 0;
  if (!email || !hasPassword) {
    console.warn(
      `[pocketbase:${logLabel}] Dev: sin credenciales admin (.env.local). ` +
        'Añade POCKETBASE_ADMIN_EMAIL y POCKETBASE_ADMIN_PASSWORD o ajusta reglas de `projects_api`.'
    );
    return null;
  }
  try {
    await pb.admins.authWithPassword(email, String(password));
    return null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[pocketbase:${logLabel}] Admin auth falló:`, e);
    return {
      status: 502,
      error:
        'PocketBase rechazó el login de admin. Comprueba POCKETBASE_ADMIN_EMAIL y POCKETBASE_ADMIN_PASSWORD en .env.local (carpeta raíz del repo; el servidor carga con dotenv desde ahí).',
      details: msg
    };
  }
}

/** URL local de PocketBase para fallback cuando no hay Internet */
const LOCAL_POCKETBASE_URL = 'http://127.0.0.1:8091';

export async function getPocketBaseUrl(): Promise<string> {
    const primaryUrl = (
        process.env.POCKETBASE_URL ||
        process.env.NEXT_PUBLIC_POCKETBASE_URL ||
        'https://zeus-basedatos.fly.dev'
    );

    // Verificar si hay conexión a Internet intentando conectar a la URL principal
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 segundos timeout

        // /api/health responde 200 en PocketBase. HEAD sobre / devuelve 404
        // (el admin UI se sirve por GET /) y ensucia la consola del navegador.
        await fetch(`${primaryUrl.replace(/\/$/, '')}/api/health`, {
            method: 'GET',
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        console.log('✅ [API] Conexión a Internet detectada, usando PocketBase desplegado:', primaryUrl);
        return primaryUrl;
    } catch (error) {
        console.log('⚠️ [API] Sin conexión a Internet, usando PocketBase local:', LOCAL_POCKETBASE_URL);
        return LOCAL_POCKETBASE_URL;
    }
}

export async function initPocketBase(opts?: { url?: string; isAdmin?: boolean }): Promise<void> {
    const url = opts?.url || await getPocketBaseUrl();
    pb = new PocketBase(url);
    pb.autoCancellation(false);

    // Siempre intentar auth admin si las credenciales están disponibles (backend necesita leer campos ocultos)
    if (process.env.POCKETBASE_ADMIN_EMAIL && process.env.POCKETBASE_ADMIN_PASSWORD) {
        try {
            await pb.admins.authWithPassword(
                process.env.POCKETBASE_ADMIN_EMAIL,
                process.env.POCKETBASE_ADMIN_PASSWORD
            );
            console.log('[pocketbaseForGenerateApi] Admin auth ok');
        } catch (e) {
            console.error('[pocketbaseForGenerateApi] Admin auth failed:', e);
        }
    }
    initialized = true;
}

export function getPocketBase(): PocketBase {
    if (!pb) {
        throw new Error('PocketBase not initialized');
    }
    return pb;
}

export function isPocketBaseInitialized(): boolean {
    return initialized && !!pb;
}
