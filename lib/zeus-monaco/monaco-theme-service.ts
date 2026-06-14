/**
 * Servicio para persistencia de temas de Monaco en PocketBase.
 *
 * Guarda el tema de Monaco seleccionado en la colección `monaco_themes`
 * para que persista entre sesiones y cambios de pestaña.
 */

'use client';

import { getLocalPocketBase } from '../pocketbase';
import PocketBase from 'pocketbase';

const COLLECTION = 'monaco_themes';
const ACTIVE_SETTING_ID = 'monaco_theme_setting';

type ThemeChangeCallback = (themeId: string, themeName: string) => void;

let unsubscribeRealtime: (() => void) | null = null;
const callbacks: Set<ThemeChangeCallback> = new Set();

/**
 * Suscribe a cambios en el tema activo de Monaco en tiempo real.
 * Devuelve función de cleanup.
 */
export function onMonacoThemeChange(callback: ThemeChangeCallback): () => void {
  callbacks.add(callback);

  // Si es la primera suscripción, configurar realtime
  if (!unsubscribeRealtime) {
    setupRealtimeSubscription().catch(err => {
      console.error('[monaco-theme-service] Error al configurar realtime:', err);
    });
  }

  return () => {
    callbacks.delete(callback);
    if (callbacks.size === 0 && unsubscribeRealtime) {
      unsubscribeRealtime();
      unsubscribeRealtime = null;
      console.log('[monaco-theme-service] Realtime desuscrito (sin callbacks)');
    }
  };
}

/**
 * Configura la suscripción realtime a cambios en la colección monaco_themes.
 */
async function setupRealtimeSubscription(): Promise<void> {
  const pb = getPb();
  if (!pb) return;

  // IMPORTANTE: Asegurar auth antes de suscribir
  await ensureAuth();

  try {
    console.log('[monaco-theme-service] Suscribiendo a realtime en:', COLLECTION);
    
    // Desuscribir si ya había algo por si acaso
    try {
      pb.collection(COLLECTION).unsubscribe('*');
    } catch (e) {}

    await pb.collection(COLLECTION).subscribe('*', (e) => {
      console.log('[monaco-theme-service] Evento realtime recibido:', e.action, e.record.id);
      
      if (e.record && e.record.is_active === true) {
        const themeId = e.record.theme_id;
        const themeName = e.record.theme_name;
        console.log('[monaco-theme-service] Notificando cambio de tema:', themeId, themeName);
        callbacks.forEach(cb => cb(themeId, themeName));
      }
    }, { expand: '' });

    unsubscribeRealtime = () => {
      console.log('[monaco-theme-service] Cancelando suscripción realtime');
      pb.collection(COLLECTION).unsubscribe('*');
    };
  } catch (err) {
    console.error('[monaco-theme-service] Falló suscripción realtime:', err);
    // Reintentar tras un delay si falló por red/auth
    setTimeout(() => {
      if (callbacks.size > 0 && !unsubscribeRealtime) {
        setupRealtimeSubscription();
      }
    }, 5000);
  }
}

interface MonacoThemeRecord {
  id: string;
  theme_id: string;
  theme_name: string;
  extension_id?: string;
  is_active: boolean;
  created: string;
  updated: string;
}

function normalizeRecord(raw: any): MonacoThemeRecord {
  return {
    id: raw.id,
    theme_id: String(raw.theme_id ?? ''),
    theme_name: String(raw.theme_name ?? ''),
    extension_id: raw.extension_id ? String(raw.extension_id) : undefined,
    is_active: Boolean(raw.is_active),
    created: raw.created ?? '',
    updated: raw.updated ?? '',
  };
}

function getPb() {
  if (typeof window === 'undefined') return null;
  return getLocalPocketBase();
}

const LOCAL_ADMIN_EMAIL = 'zeus@ia.com';
const LOCAL_ADMIN_PASSWORD = '1234567890';

async function ensureAuth(): Promise<void> {
  const pb = getPb();
  if (!pb) return;
  if (pb.authStore.isValid) return;
  try {
    await pb.admins.authWithPassword(LOCAL_ADMIN_EMAIL, LOCAL_ADMIN_PASSWORD);
  } catch (e) {
    console.warn('[monaco-theme-service] Auth falló:', e);
  }
}

function isCollectionMissing(e: unknown): boolean {
  const status = (e as any)?.status ?? (e as any)?.response?.status;
  const msg = String((e as any)?.message ?? '');
  return status === 404 || msg.includes('not found') || msg.includes("'monaco_themes'");
}

/**
 * Guarda el tema de Monaco activo en PocketBase.
 * Crea un registro si no existe, o actualiza el existente.
 */
export async function saveMonacoTheme(themeId: string, themeName: string, extensionId?: string): Promise<boolean> {
  const pb = getPb();
  if (!pb) return false;

  await ensureAuth();

  try {
    // Buscar si ya existe un registro activo
    const existing = await pb.collection(COLLECTION).getFullList({
      filter: 'is_active = true',
      limit: 1,
    });

    const payload = {
      theme_id: themeId,
      theme_name: themeName,
      extension_id: extensionId || null,
      is_active: true,
    };

    if (existing.length > 0) {
      // Actualizar el registro existente
      await pb.collection(COLLECTION).update(existing[0].id, payload);
    } else {
      // Crear nuevo registro
      await pb.collection(COLLECTION).create(payload);
    }

    return true;
  } catch (e) {
    if (!isCollectionMissing(e)) {
      console.error('[monaco-theme-service] saveMonacoTheme falló:', e);
    }
    return false;
  }
}

/**
 * Obtiene el tema de Monaco activo desde PocketBase.
 */
export async function getActiveMonacoTheme(): Promise<{ themeId: string; themeName: string } | null> {
  const pb = getPb();
  if (!pb) return null;

  await ensureAuth();

  try {
    const res = await pb.collection(COLLECTION).getFullList({
      filter: 'is_active = true',
      limit: 1,
    });

    if (res.length > 0) {
      const record = normalizeRecord(res[0]);
      return {
        themeId: record.theme_id,
        themeName: record.theme_name,
      };
    }

    return null;
  } catch (e) {
    if (!isCollectionMissing(e)) {
      console.warn('[monaco-theme-service] getActiveMonacoTheme falló:', e);
    }
    return null;
  }
}

/**
 * Desactiva todos los temas de Monaco en PocketBase.
 */
export async function deactivateAllMonacoThemes(): Promise<void> {
  const pb = getPb();
  if (!pb) return;

  await ensureAuth();

  try {
    const activeThemes = await pb.collection(COLLECTION).getFullList({
      filter: 'is_active = true',
    });

    for (const theme of activeThemes) {
      await pb.collection(COLLECTION).update(theme.id, { is_active: false });
    }
  } catch (e) {
    if (!isCollectionMissing(e)) {
      console.error('[monaco-theme-service] deactivateAllMonacoThemes falló:', e);
    }
  }
}
