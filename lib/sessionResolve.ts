// Resolución de cwd por sesión en el lado Next.js (8741).
// Next.js no comparte memoria con Express (8742), así que resuelve sessionId->cwd
// consultando GET http://localhost:8742/api/session/resolve con caché LRU de 5s.

export const EXPRESS_BASE_URL =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_EXPRESS_URL) || 'http://localhost:8742';

const CACHE_TTL_MS = 5000;
const cache = new Map<string, { cwd: string | null; exp: number }>();

function extractSessionIdFromReq(req: Request): string | null {
  const sid = req.headers.get('x-zeus-session');
  if (sid) return sid;
  try {
    const url = new URL(req.url);
    return url.searchParams.get('sessionId');
  } catch {
    return null;
  }
}

async function fetchSessionCwd(sid: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch(`${EXPRESS_BASE_URL}/api/session/resolve?sessionId=${encodeURIComponent(sid)}`, {
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.cwd || null;
  } catch {
    return null;
  }
}

/** Resuelve el cwd de una request Next.js (route handler). Usa caché de 5s. */
export async function getSessionCwdFromRequest(req: Request): Promise<string | null> {
  const sid = extractSessionIdFromReq(req);
  if (!sid) return null;
  const now = Date.now();
  const hit = cache.get(sid);
  if (hit && hit.exp > now) return hit.cwd;
  const cwd = await fetchSessionCwd(sid);
  cache.set(sid, { cwd, exp: now + CACHE_TTL_MS });
  return cwd;
}

/** Invalida la caché de un sessionId (tras cambiar de proyecto/sesión). */
export function invalidateSessionCwd(sid?: string): void {
  if (sid) cache.delete(sid);
  else cache.clear();
}

/** Resuelve el cwd activo actual (sesión marcada como activa en Express). */
export async function getActiveSessionCwd(): Promise<{ sessionId: string | null; cwd: string | null; projectId: string | null }> {
  try {
    const res = await fetch(`${EXPRESS_BASE_URL}/api/session/active`);
    if (!res.ok) return { sessionId: null, cwd: null, projectId: null };
    const data = await res.json();
    return { sessionId: data?.sessionId || null, cwd: data?.cwd || null, projectId: data?.projectId || null };
  } catch {
    return { sessionId: null, cwd: null, projectId: null };
  }
}