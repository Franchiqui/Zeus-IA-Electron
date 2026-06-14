import PocketBase from 'pocketbase';
import dotenv from 'dotenv';

dotenv.config({ path: './.env' });
dotenv.config({ path: './api/.env' });
dotenv.config({ path: './api/api-rae/.env' });

const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_LOCAL_URL || process.env.POCKETBASE_LOCAL_URL || 'http://localhost:8091';
export const pb = new PocketBase(pbUrl);

export async function authAsAdmin() {
  const email = process.env.POCKETBASE_LOCAL_ADMIN_EMAIL || 'zeus@ia.com';
  const password = process.env.POCKETBASE_LOCAL_ADMIN_PASSWORD || '1234567890';
  try {
    await pb.collection('_superusers').authWithPassword(email, password);
    console.log('[PocketBase] Admin autenticado');
  } catch {
    try {
      await pb.admins.authWithPassword(email, password);
      console.log('[PocketBase] Admin autenticado (legacy)');
    } catch (e) {
      console.warn('[PocketBase] No se pudo autenticar como admin:', e);
    }
  }
}
