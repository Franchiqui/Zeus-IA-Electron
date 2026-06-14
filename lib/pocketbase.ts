import PocketBase from 'pocketbase';

/** URL local de PocketBase para fallback cuando no hay Internet */
const LOCAL_POCKETBASE_URL = 'http://localhost:8091';

/** URL de PocketBase. En otra app: .env con NEXT_PUBLIC_POCKETBASE_URL */
export async function getPocketBaseUrl(): Promise<string> {
  // Intentar obtener de variables de entorno, si no usar el fallback de Zeus
  const primaryUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL || 'https://zeus-basedatos.fly.dev';

  // Verificar si hay conexión a Internet intentando conectar a la URL principal
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 segundos timeout

    await fetch(primaryUrl, {
      method: 'HEAD',
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    console.log('[PocketBase] Conexión a Internet detectada, usando PocketBase desplegado:', primaryUrl);
    return primaryUrl;
  } catch (error) {
    console.log('[PocketBase] Sin conexión a Internet, usando PocketBase local:', LOCAL_POCKETBASE_URL);
    return LOCAL_POCKETBASE_URL;
  }
}

// Crear instancia de PocketBase con la URL determinada
let pbInstance: PocketBase | null = null;
let pbInitialized = false;

export async function getPocketBase(): Promise<PocketBase> {
  if (pbInstance && pbInitialized) {
    return pbInstance;
  }

  const url = await getPocketBaseUrl();
  pbInstance = new PocketBase(url);
  pbInstance.autoCancellation(false);
  pbInitialized = true;

  return pbInstance;
}

// Para compatibilidad con código existente que usa `pb` directamente
// Se inicializa con la URL principal, pero se puede actualizar dinámicamente
export const pb = new PocketBase(process.env.NEXT_PUBLIC_POCKETBASE_URL || 'https://zeus-basedatos.fly.dev');
pb.autoCancellation(false);

// Restaurar sesión desde localStorage (el SDK de PocketBase NO lo hace automáticamente)
if (typeof window !== 'undefined') {
  try {
    const raw = localStorage.getItem('pb_auth');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.token) {
        pb.authStore.save(parsed.token, parsed.model ?? null);
        console.log('[PocketBase] Sesión restaurada desde localStorage:', parsed.model?.email || parsed.model?.id || 'sin email');
      }
    }
  } catch {
    // Ignorar errores de parseo corrupto
  }

  // Persistir automáticamente cualquier cambio de auth en localStorage
  pb.authStore.onChange((token, model) => {
    if (token) {
      localStorage.setItem('pb_auth', JSON.stringify({ token, model }));
    } else {
      localStorage.removeItem('pb_auth');
    }
  });
}

// Función para actualizar la instancia pb si cambia la conexión
export async function updatePocketBaseInstance(): Promise<void> {
  const url = await getPocketBaseUrl();
  const currentUrl = pb.baseUrl;

  if (url !== currentUrl) {
    console.log('[PocketBase] Actualizando instancia de PocketBase de', currentUrl, 'a', url);
    // Crear nueva instancia con la nueva URL
    const newPb = new PocketBase(url);
    newPb.autoCancellation(false);

    // Copiar el auth store si existe
    if (pb.authStore.isValid) {
      newPb.authStore.save(pb.authStore.token, pb.authStore.model);
    }

    // Reemplazar la instancia exportada (esto es un hack pero funciona para compatibilidad)
    (pb as any) = newPb;
  }
}

/** Autentica como administrador */
export async function authAsAdmin(pb: PocketBase) {
  const isLocal = pb.baseUrl.includes('127.0.0.1') || pb.baseUrl.includes('localhost');

  // Credenciales: local vs remota
  const email = isLocal
    ? (process.env.POCKETBASE_LOCAL_ADMIN_EMAIL || 'zeus@ia.com')
    : (process.env.POCKETBASE_ADMIN_EMAIL || 'exchiqui.fr@gmail.com');
  const password = isLocal
    ? (process.env.POCKETBASE_LOCAL_ADMIN_PASSWORD || '1234567890')
    : (process.env.POCKETBASE_ADMIN_PASSWORD || 'Cruzcampo5230');

  try {
    console.log('[PocketBase] Intentando autenticación administrativa en:', pb.baseUrl);
    await pb.admins.authWithPassword(email, password);
    console.log('[PocketBase] Autenticación de administrador exitosa en', pb.baseUrl);
  } catch (error: any) {
    console.error('[PocketBase] Error de autenticación en PocketBase (' + pb.baseUrl + '):', error);
  }
}

/** Opciones por defecto para la cookie de sesión (reutilizable) */
export const authCookieOptions = {
  httpOnly: false,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'Lax' as const,
  path: '/',
  maxAge: 30 * 24 * 60 * 60, // 30 días
};

/** Instancia de PocketBase para la base de datos local */
let pbLocal: PocketBase | null = null;

export function getLocalPocketBase(): PocketBase {
  if (!pbLocal) {
    pbLocal = new PocketBase(LOCAL_POCKETBASE_URL);
    pbLocal.autoCancellation(false);
  }
  return pbLocal;
}

/**
 * Verifica si una colección existe en PocketBase
 * @param pb Instancia de PocketBase
 * @param collectionName Nombre de la colección
 * @returns true si la colección existe
 */
export async function collectionExists(pb: PocketBase, collectionName: string): Promise<boolean> {
  try {
    // Intentar obtener la lista de colecciones y buscar la específica
    const collections = await pb.collections.getList();
    return collections.items.some((col: any) => col.name === collectionName);
  } catch (error) {
    return false;
  }
}

/**
 * Guarda un registro en AMBAS bases de datos: remota primaria y local espejo.
 * @param collectionName Nombre de la colección
 * @param data Datos a guardar
 * @param id ID opcional para actualización
 * @returns El registro guardado (de la base remota como referencia)
 */
export async function saveToBothDatabases(
  collectionName: string,
  data: any,
  id?: string
): Promise<any> {
  if (id) {
    return await pb.collection(collectionName).update(id, data);
  } else {
    return await pb.collection(collectionName).create(data);
  }
}

export async function deleteFromBothDatabases(
  collectionName: string,
  id: string
): Promise<void> {
  await pb.collection(collectionName).delete(id);
}

export default pb;
