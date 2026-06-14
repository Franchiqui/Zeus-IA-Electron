/**
 * Configuración compartida de PocketBase para las APIs (modelos y chat).
 * Las rutas /api/modelos y /api/chat usan estas constantes.
 * Usa credenciales de ADMINISTRADOR para gestionar las colecciones.
 */

import PocketBase from 'pocketbase';
import {
  MODELOS_COLLECTION_NAME,
  CONVERSATIONS_COLLECTION_NAME,
  MESSAGES_COLLECTION_NAME,
} from '@/lib/collections';

export const POCKETBASE_URL =
  process.env.POCKETBASE_URL || process.env.NEXT_PUBLIC_POCKETBASE_URL || 'https://zeus-basedatos.fly.dev';

// Priorizamos las variables ADMIN de .env.local
export const POCKETBASE_EMAIL = process.env.POCKETBASE_ADMIN_EMAIL || process.env.POCKETBASE_EMAIL || process.env.PB_ADMIN_EMAIL;
export const POCKETBASE_PASSWORD = process.env.POCKETBASE_ADMIN_PASSWORD || process.env.POCKETBASE_PASSWORD || process.env.PB_ADMIN_PASSWORD;

/** Colecciones */
export const PB_COLLECTIONS = {
  MODELOS: MODELOS_COLLECTION_NAME,
  CONVERSATIONS: CONVERSATIONS_COLLECTION_NAME,
  MESSAGES: MESSAGES_COLLECTION_NAME,
} as const;

export function getPocketBase(): PocketBase {
  const pb = new PocketBase(POCKETBASE_URL);
  pb.autoCancellation(false);
  return pb;
}

/** Autentica como administrador usando pb.admins. */
export async function authPocketBaseAdmin(pb: PocketBase) {
  if (!POCKETBASE_EMAIL || !POCKETBASE_PASSWORD) {
    throw new Error('Credenciales de administrador no configuradas en .env.local (POCKETBASE_ADMIN_EMAIL)');
  }
  await pb.admins.authWithPassword(POCKETBASE_EMAIL, POCKETBASE_PASSWORD);
}
