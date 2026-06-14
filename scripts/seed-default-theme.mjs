/**
 * Seed script: inserta el tema por defecto de Zeus en PocketBase.
 * Uso: node scripts/seed-default-theme.mjs
 */
import PocketBase from 'pocketbase';

const URL = process.env.POCKETBASE_URL || process.env.NEXT_PUBLIC_POCKETBASE_URL || 'https://zeus-basedatos.fly.dev';
const ADMIN_EMAIL = process.env.POCKETBASE_ADMIN_EMAIL || 'exchiqui.fr@gmail.com';
const ADMIN_PASSWORD = process.env.POCKETBASE_ADMIN_PASSWORD || 'Cruzcampo5230';
const COLLECTION = 'zeus_themes';

const DEFAULT_COLORS = {
  primary: '#3b82f6',
  primaryDim: '#1d4ed8',
  onPrimary: '#ffffff',
  secondary: '#00e3fd',
  onSecondary: '#004d57',
  tertiary: '#c4b5fd',
  surface: '#0e0e0e',
  surfaceContainer: '#1a1a1a',
  surfaceContainerLow: '#131313',
  surfaceContainerHigh: '#20201f',
  surfaceContainerHighest: '#262626',
  surfaceContainerLowest: '#000000',
  onSurface: '#ffffff',
  onSurfaceVariant: '#adaaaa',
  outline: '#484847',
  outlineVariant: '#484847',
  error: '#d8b4fe',
  success: '#4ade80',
  warning: '#facc15',
  info: '#60a5fa',
};

async function main() {
  const pb = new PocketBase(URL);
  console.log('[seed] Conectando a', URL);

  try {
    await pb.admins.authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);
    console.log('[seed] Auth admin OK');
  } catch (e) {
    console.error('[seed] Auth admin falló:', e.message);
    process.exit(1);
  }

  // Buscar si ya existe el tema default
  const existing = await pb.collection(COLLECTION).getFullList({
    filter: 'is_default = true',
  });

  if (existing.length > 0) {
    console.log('[seed] Ya existe tema por defecto:', existing[0].id);
    return;
  }

  const record = await pb.collection(COLLECTION).create({
    name: 'Zeus Default',
    colors: DEFAULT_COLORS,
    is_active: false,
    is_default: true,
  });

  console.log('[seed] Tema por defecto creado:', record.id);
}

main().catch((e) => {
  console.error('[seed] Error:', e);
  process.exit(1);
});
