'use client';

import PocketBase from 'pocketbase';
import { getLocalPocketBase, pb as pbRemote } from './pocketbase';
import { SavedTheme } from './theme-tokens';

const COLLECTION = 'zeus_themes';

function pb() {
  return getLocalPocketBase();
}

/** Crea una instancia temporal de PocketBase remota autenticada como admin */
async function getRemotePbAsAdmin(): Promise<PocketBase | null> {
  const url = pbRemote.baseUrl;
  const tmp = new PocketBase(url);
  tmp.autoCancellation(false);

  const isLocal = url.includes('127.0.0.1') || url.includes('localhost');
  const email = isLocal
    ? (process.env.POCKETBASE_LOCAL_ADMIN_EMAIL || 'zeus@ia.com')
    : (process.env.POCKETBASE_ADMIN_EMAIL || 'exchiqui.fr@gmail.com');
  const password = isLocal
    ? (process.env.POCKETBASE_LOCAL_ADMIN_PASSWORD || '1234567890')
    : (process.env.POCKETBASE_ADMIN_PASSWORD || 'Cruzcampo5230');

  try {
    await tmp.admins.authWithPassword(email, password);
    return tmp;
  } catch (e) {
    console.error('[theme-pb-service] Admin auth falló:', e);
    return null;
  }
}

export interface PbThemeRecord {
  id: string;
  name: string;
  colors: Record<string, string>;
  is_active: boolean;
  is_default: boolean;
  icon_lucide: boolean;
  rating?: number;
  votesCount?: number;
  user_id?: string;
  created: string;
  updated: string;
}

function normalizePbRecord(raw: any): PbThemeRecord {
  let colors: Record<string, string> = {};
  if (typeof raw.colors === 'object' && raw.colors !== null) {
    colors = raw.colors;
  } else if (typeof raw.colors === 'string') {
    try {
      colors = JSON.parse(raw.colors) as Record<string, string>;
    } catch {
      colors = {};
    }
  }
  return {
    id: raw.id,
    name: String(raw.name ?? ''),
    colors,
    is_active: Boolean(raw.is_active),
    is_default: Boolean(raw.is_default),
    icon_lucide: Boolean(raw.icon_lucide),
    rating: typeof raw.rating === 'number' ? raw.rating : undefined,
    votesCount: typeof raw.votesCount === 'number' ? raw.votesCount : undefined,
    user_id: raw.user_id ? String(raw.user_id) : undefined,
    created: raw.created ?? '',
    updated: raw.updated ?? '',
  };
}

function isCollectionMissing(e: unknown): boolean {
  const status = (e as any)?.status ?? (e as any)?.response?.status;
  const msg = String((e as any)?.message ?? '');
  return status === 404 || msg.includes('not found') || msg.includes("'zeus_themes'");
}

/* ── Auth admin local ─────────────────────────────── */

const LOCAL_ADMIN_EMAIL = 'zeus@ia.com';
const LOCAL_ADMIN_PASSWORD = '1234567890';

async function ensureLocalAdminAuth(): Promise<void> {
  const localPb = pb();
  if (localPb.authStore.isValid) return;
  try {
    await localPb.admins.authWithPassword(LOCAL_ADMIN_EMAIL, LOCAL_ADMIN_PASSWORD);
  } catch (e) {
    console.warn('[theme-pb-service] Auth admin local falló:', e);
  }
}

/* ── CRUD ─────────────────────────────────────────── */

export async function getThemesFromPb(): Promise<PbThemeRecord[]> {
  try {
    await ensureLocalAdminAuth();
    const res = await pb().collection(COLLECTION).getFullList({
      sort: '-is_default,-created',
    });
    return res.map(normalizePbRecord);
  } catch (e) {
    if (!isCollectionMissing(e)) {
      console.warn('[theme-pb-service] getThemesFromPb falló:', e);
    }
    return [];
  }
}

export async function getActiveThemeFromPb(): Promise<PbThemeRecord | null> {
  try {
    await ensureLocalAdminAuth();
    const res = await pb().collection(COLLECTION).getFullList({
      filter: 'is_active = true',
      limit: 1,
    });
    if (res.length) return normalizePbRecord(res[0]);
    return null;
  } catch (e) {
    if (!isCollectionMissing(e)) {
      console.warn('[theme-pb-service] getActiveThemeFromPb falló:', e);
    }
    return null;
  }
}

export async function saveThemeToPb(
  name: string,
  colors: Record<string, string>,
  existingId?: string
): Promise<PbThemeRecord | null> {
  await ensureLocalAdminAuth();
  const payload: Record<string, unknown> = {
    name: name.trim() || 'Tema sin nombre',
    colors,
    is_active: false,
    is_default: false,
  };
  try {
    let raw: any;
    if (existingId) {
      try {
        raw = await pb().collection(COLLECTION).update(existingId, payload);
      } catch (updateErr) {
        const status = (updateErr as any)?.status ?? (updateErr as any)?.response?.status;
        if (status === 404) {
          // El registro no existe en PB → crear uno nuevo
          raw = await pb().collection(COLLECTION).create(payload);
        } else {
          throw updateErr;
        }
      }
    } else {
      raw = await pb().collection(COLLECTION).create(payload);
    }
    return normalizePbRecord(raw);
  } catch (e) {
    const status = (e as any)?.status ?? (e as any)?.response?.status;
    console.error(`[theme-pb-service] saveThemeToPb falló (HTTP ${status}):`, e);
    return null;
  }
}

export async function deleteThemeFromPb(id: string): Promise<boolean> {
  try {
    await ensureLocalAdminAuth();
    await pb().collection(COLLECTION).delete(id);
    return true;
  } catch (e) {
    if (!isCollectionMissing(e)) {
      console.error('[theme-pb-service] deleteThemeFromPb falló:', e);
    }
    return false;
  }
}

export async function setActiveThemeInPb(id: string): Promise<boolean> {
  try {
    await ensureLocalAdminAuth();
    const activeOnes = await pb().collection(COLLECTION).getFullList({ filter: 'is_active = true' });
    for (const r of activeOnes) {
      await pb().collection(COLLECTION).update(r.id, { is_active: false });
    }
    await pb().collection(COLLECTION).update(id, { is_active: true });
    return true;
  } catch (e) {
    if (!isCollectionMissing(e)) {
      console.error('[theme-pb-service] setActiveThemeInPb falló:', e);
    }
    return false;
  }
}

/** Desactiva todos los temas activos en PB. */
export async function deactivateAllThemesInPb(): Promise<void> {
  try {
    await ensureLocalAdminAuth();
    const activeOnes = await pb().collection(COLLECTION).getFullList({ filter: 'is_active = true' });
    for (const r of activeOnes) {
      await pb().collection(COLLECTION).update(r.id, { is_active: false });
    }
  } catch (e) {
    if (!isCollectionMissing(e)) {
      console.error('[theme-pb-service] deactivateAllThemesInPb falló:', e);
    }
  }
}

/* ── Publicación en base de datos remota (desplegada) ─────────── */

export async function publishThemeToPb(
  name: string,
  colors: Record<string, string>,
  iconLucide: boolean = false
): Promise<PbThemeRecord | null> {
  const pb = await getRemotePbAsAdmin();
  if (!pb) return null;

  // No enviar user_id - el usuario autenticado local puede no existir en el remoto
  const payload: {
    name: string;
    colors: Record<string, string>;
    is_active: boolean;
    is_default: boolean;
    icon_lucide: boolean;
  } = {
    name: name.trim() || 'Tema sin nombre',
    colors,
    is_active: false,
    is_default: false,
    icon_lucide: iconLucide,
  };

  try {
    // Buscar si ya existe un tema con el mismo nombre
    const existing = await pb.collection(COLLECTION).getFullList({
      filter: `name = "${payload.name.replace(/"/g, '\\"')}"`,
      limit: 1,
    });

    let raw: any;
    if (existing.length > 0) {
      raw = await pb.collection(COLLECTION).update(existing[0].id, payload);
    } else {
      raw = await pb.collection(COLLECTION).create(payload);
    }
    return normalizePbRecord(raw);
  } catch (e) {
    const err = e as any;
    console.error('[theme-pb-service] publishThemeToPb falló:', {
      status: err.status,
      response: err.response,
      data: err.data,
      message: err.message
    });
    return null;
  }
}

/* ── Temas publicados (desplegados) ─────────────── */

export async function fetchPublishedThemesFromPb(): Promise<PbThemeRecord[]> {
  try {
    const pb = await getRemotePbAsAdmin();
    if (!pb) return [];

    const res = await pb.collection(COLLECTION).getFullList({
      sort: '-created',
    });

    // Calcular la media actualizada de votos para cada tema
    const themesWithRatings = await Promise.all(res.map(async (theme) => {
      const votes = await pb.collection(VOTES_COLLECTION).getFullList({
        filter: `theme_id = "${theme.id}"`,
      });

      let averageRating = theme.rating || 0;
      if (votes.length > 0) {
        const total = votes.reduce((sum, v) => sum + (v.rating || 0), 0);
        averageRating = Math.round((total / votes.length) * 10) / 10;
      }

      return { ...theme, rating: averageRating, votesCount: votes.length };
    }));

    return themesWithRatings.map(normalizePbRecord);
  } catch (e) {
    console.warn('[theme-pb-service] fetchPublishedThemesFromPb falló:', e);
    return [];
  }
}

export async function deletePublishedThemeFromPb(id: string): Promise<boolean> {
  const pb = await getRemotePbAsAdmin();
  if (!pb) return false;
  try {
    await pb.collection(COLLECTION).delete(id);
    return true;
  } catch (e) {
    console.error('[theme-pb-service] deletePublishedThemeFromPb falló:', e);
    return false;
  }
}

const VOTES_COLLECTION = 'theme_votes';

/**
 * Registra un voto para un tema. El rating final se calcula como la media de todos los votos.
 */
export async function rateThemeInPb(themeId: string, rating: number): Promise<boolean> {
  const pb = await getRemotePbAsAdmin();
  if (!pb) return false;

  const userId = pb.authStore.model?.id;

  try {
    // Buscar si el usuario ya votó este tema (si está autenticado)
    let existingVotes: any[] = [];
    if (userId) {
      existingVotes = await pb.collection(VOTES_COLLECTION).getFullList({
        filter: `theme_id = "${themeId}" && user_id = "${userId}"`,
        limit: 1,
      });
    }

    if (existingVotes.length > 0) {
      // Actualizar voto existente
      await pb.collection(VOTES_COLLECTION).update(existingVotes[0].id, { rating });
    } else {
      // Crear nuevo voto
      const voteData: Record<string, any> = {
        theme_id: themeId,
        rating,
      };
      // Solo enviar user_id si existe y la colección lo soporta
      if (userId) {
        try {
          voteData.user_id = userId;
          await pb.collection(VOTES_COLLECTION).create(voteData);
        } catch (userErr) {
          // Si falla por user_id, intentar sin él
          delete voteData.user_id;
          await pb.collection(VOTES_COLLECTION).create(voteData);
        }
      } else {
        await pb.collection(VOTES_COLLECTION).create(voteData);
      }
    }

    // Actualizar la media en el tema
    await updateThemeAverageRating(themeId);
    return true;
  } catch (e) {
    const err = e as any;
    console.error('[theme-pb-service] rateThemeInPb falló:', {
      status: err.status,
      response: err.response,
      data: err.data,
      message: err.message,
      themeId,
      rating,
      userId,
    });
    return false;
  }
}

/**
 * Calcula y actualiza el rating promedio de un tema basado en todos sus votos.
 */
async function updateThemeAverageRating(themeId: string): Promise<void> {
  const pb = await getRemotePbAsAdmin();
  if (!pb) return;

  try {
    const votes = await pb.collection(VOTES_COLLECTION).getFullList({
      filter: `theme_id = "${themeId}"`,
    });

    if (votes.length === 0) {
      await pb.collection(COLLECTION).update(themeId, { rating: 0 });
      return;
    }

    const total = votes.reduce((sum, v) => sum + (v.rating || 0), 0);
    const average = total / votes.length;

    await pb.collection(COLLECTION).update(themeId, { rating: Math.round(average * 10) / 10 });
  } catch (e) {
    console.error('[theme-pb-service] updateThemeAverageRating falló:', e);
  }
}

/**
 * Obtiene el rating promedio de un tema sin actualizarlo (solo lectura).
 */
export async function getThemeAverageRating(themeId: string): Promise<number> {
  const pb = await getRemotePbAsAdmin();
  if (!pb) return 0;

  try {
    const votes = await pb.collection(VOTES_COLLECTION).getFullList({
      filter: `theme_id = "${themeId}"`,
    });

    if (votes.length === 0) return 0;
    const total = votes.reduce((sum, v) => sum + (v.rating || 0), 0);
    return Math.round((total / votes.length) * 10) / 10;
  } catch {
    return 0;
  }
}

/* ── Sincronización localStorage ↔ PB ─────────────── */

export async function syncThemesFromPbToLocal(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const themes = await getThemesFromPb();
    const saved: SavedTheme[] = themes.map((t) => ({
      id: t.id,
      name: t.name,
      colors: t.colors,
      createdAt: new Date(t.created).getTime(),
    }));
    localStorage.setItem('zeus-custom-themes', JSON.stringify(saved));

    const active = themes.find((t) => t.is_active);
    if (active) {
      localStorage.setItem('zeus-active-theme', active.name);
    }
  } catch {
    // Si falla, queda lo que haya en localStorage
  }
}
