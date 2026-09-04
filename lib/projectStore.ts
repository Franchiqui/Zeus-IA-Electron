// Store de proyecto/sesión de workspace (estilo F:\Agent).
// Mantiene el proyecto activo y su sesión (cwd) anclada en el backend Express.
// Espeja {id, name, path} localmente para resolver el cwd sin depender del
// campo `path` de la colección PocketBase `projects` (que puede no existir).
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import PocketBase from 'pocketbase';
import { EXPRESS_BASE_URL, invalidateSessionCwd } from '@/lib/sessionResolve';

// --- Instancia de PocketBase local para projects/sesiones ---
// Usa la base de datos local (http://127.0.0.1:8091) en vez de la remota.
const LOCAL_PB_URL = 'http://127.0.0.1:8091';
const LOCAL_PB_ADMIN_EMAIL = 'zeus@ia.com';
const LOCAL_PB_ADMIN_PASSWORD = '1234567890';

let localPbInstance: PocketBase | null = null;

async function getLocalPb(): Promise<PocketBase> {
  if (localPbInstance && localPbInstance.authStore.isValid) {
    return localPbInstance;
  }
  const pb = new PocketBase(LOCAL_PB_URL);
  pb.autoCancellation(false);
  try {
    await pb.admins.authWithPassword(LOCAL_PB_ADMIN_EMAIL, LOCAL_PB_ADMIN_PASSWORD);
  } catch {
    try {
      await pb.collection('_superusers').authWithPassword(LOCAL_PB_ADMIN_EMAIL, LOCAL_PB_ADMIN_PASSWORD);
    } catch (e) {
      console.warn('[projectStore] No se pudo autenticar PocketBase local:', e);
    }
  }
  localPbInstance = pb;
  return pb;
}

/** getActiveSessionCwd con timeout AbortController */
async function getActiveSessionCwdWithTimeout(ctrl: AbortController): Promise<{ sessionId: string | null; cwd: string | null; projectId: string | null }> {
  try {
    const res = await fetch(`${EXPRESS_BASE_URL}/api/session/active`, { signal: ctrl.signal });
    if (!res.ok) return { sessionId: null, cwd: null, projectId: null };
    const data = await res.json();
    return { sessionId: data?.sessionId || null, cwd: data?.cwd || null, projectId: data?.projectId || null };
  } catch {
    return { sessionId: null, cwd: null, projectId: null };
  }
}

/**
 * Marca un proyecto como activo (is_active: true) en PocketBase local y
 * desmarca todos los demás (is_active: false). Si el proyecto no existe en PB,
 * lo crea. Silencioso: no lanza errores.
 */
async function setActiveProjectInPocketBase(projectId: string, name?: string, path?: string): Promise<void> {
  try {
    const localPb = await getLocalPb();
    // 1) Verificar si el proyecto existe en PB.
    let exists = false;
    try {
      await localPb.collection('projects').getOne(projectId);
      exists = true;
    } catch {
      exists = false;
    }
    // 2) Si no existe, crearlo con is_active: true.
    if (!exists) {
      try {
        await localPb.collection('projects').create({
          name: name || basename(path || ''),
          path: (path || '').replace(/\\/g, '/'),
          user_id: '',
          is_active: true,
        });
      } catch (e) {
        // Si falla por no tener campo path, reintentar sin él.
        try {
          await localPb.collection('projects').create({
            name: name || basename(path || ''),
            user_id: '',
            is_active: true,
          });
        } catch (e2) {
          console.warn('[projectStore] No se pudo crear proyecto en PB local:', e2);
        }
      }
    } else {
      // 3) Poner todos los proyectos a is_active: false.
      const all = await localPb.collection('projects').getFullList({ fields: 'id,is_active' });
      for (const r of all) {
        if (r.id !== projectId) {
          await localPb.collection('projects').update(r.id, { is_active: false }).catch(() => {});
        }
      }
      // 4) Marcar el proyecto activo.
      await localPb.collection('projects').update(projectId, { is_active: true }).catch(() => {});
    }
  } catch (e) {
    console.warn('[projectStore] No se pudo actualizar is_active en PocketBase:', e);
  }
}

export interface ProjectInfo {
  id: string;
  name: string;
  path: string; // cwd absoluto
}

interface ProjectState {
  activeProjectId: string | null;
  activeSessionId: string | null;
  activeCwd: string | null; // cache del cwd de la sesión activa
  projects: ProjectInfo[]; // espejo local {id, name, path}
  setActiveProject: (id: string | null) => void;
  setActiveSession: (sessionId: string | null, cwd: string | null) => void;
  upsertLocalProject: (p: ProjectInfo) => void;
  createProject: (input: { name: string; path: string; userId?: string }) => Promise<ProjectInfo | null>;
  startWorkspaceSession: (cwd: string, projectId?: string) => Promise<{ sessionId: string; cwd: string } | null>;
  resolveNewSessionCwd: () => string;
  rehydrateActiveSession: () => Promise<void>;
  refreshProjectsFromPocketBase: () => Promise<void>;
}

function basename(p: string): string {
  const norm = p.replace(/\\/g, '/').replace(/\/+$/, '');
  const idx = norm.lastIndexOf('/');
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      activeProjectId: null,
      activeSessionId: null,
      activeCwd: null,
      projects: [],

      setActiveProject: (id) => set({ activeProjectId: id }),

      setActiveSession: (sessionId, cwd) => set({ activeSessionId: sessionId, activeCwd: cwd }),

      upsertLocalProject: (p) =>
        set((s) => {
          const idx = s.projects.findIndex((x) => x.id === p.id);
          const next = idx >= 0
            ? [...s.projects.slice(0, idx), p, ...s.projects.slice(idx + 1)]
            : [...s.projects, p];
          return { projects: next };
        }),

      createProject: async ({ name, path, userId }) => {
        const projectPath = path.replace(/\\/g, '/');
        const projectName = name || basename(projectPath);
        // 1) Crear registro en PocketBase local (colección `projects`).
        let pbId: string | null = null;
        try {
          const localPb = await getLocalPb();
          const rec = await localPb.collection('projects').create({ name: projectName, path: projectPath, user_id: userId || '' });
          pbId = rec?.id || null;
        } catch (e) {
          // Si la colección no tiene campo `path`, reintento sin ese campo.
          try {
            const localPb = await getLocalPb();
            const rec = await localPb.collection('projects').create({ name: projectName, user_id: userId || '' });
            pbId = rec?.id || null;
          } catch (e2) {
            console.warn('[projectStore] No se pudo crear registro en PocketBase local projects:', e2);
          }
        }
        // 2) Espejo local (fuente autoritativa del cwd en cliente).
        const id = pbId || `local_${Date.now()}`;
        const info: ProjectInfo = { id, name: projectName, path: projectPath };
        get().upsertLocalProject(info);
        // 3) Marcar como activo en PocketBase local (is_active: true, demás a false).
        if (pbId) {
          void setActiveProjectInPocketBase(pbId, projectName, projectPath);
        }
        return info;
      },

      startWorkspaceSession: async (cwd, projectId) => {
        try {
          const ctrl = new AbortController();
          const to = setTimeout(() => ctrl.abort(), 5000);
          const res = await fetch(`${EXPRESS_BASE_URL}/api/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cwd, projectId }),
            signal: ctrl.signal,
          });
          clearTimeout(to);
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            console.error('[projectStore] startWorkspaceSession falló:', err?.error || res.status);
            return null;
          }
          const data = await res.json();
          const sessionId: string = data.sessionId;
          invalidateSessionCwd(sessionId);
          set({ activeSessionId: sessionId, activeCwd: data.cwd });
          // Marcar el proyecto como activo en PocketBase local (is_active).
          if (projectId) {
            const proj = get().projects.find((p) => p.id === projectId);
            void setActiveProjectInPocketBase(projectId, proj?.name, proj?.path || cwd);
          }
          return { sessionId, cwd: data.cwd };
        } catch (e) {
          console.error('[projectStore] startWorkspaceSession error:', e);
          return null;
        }
      },

      resolveNewSessionCwd: () => {
        const { activeProjectId, projects } = get();
        if (!activeProjectId) return '';
        const p = projects.find((x) => x.id === activeProjectId);
        return p?.path || '';
      },

      rehydrateActiveSession: async () => {
        const { activeProjectId, activeSessionId, projects, startWorkspaceSession, createProject, setActiveProject, upsertLocalProject } = get();

        // 0) Migración one-shot: si no hay proyecto activo pero existe el viejo
        // global ZEUS_DATA_PATH en localStorage, crear un proyecto+sesión desde
        // esa ruta y limpiar el flag. Así un usuario existente conserva su carpeta.
        if (!activeProjectId && typeof window !== 'undefined') {
          try {
            const legacy = window.localStorage.getItem('ZEUS_DATA_PATH');
            if (legacy && legacy.trim()) {
              const normPath = legacy.replace(/\\/g, '/').replace(/\/+$/, '');
              const info = await createProject({ name: basename(normPath), path: normPath });
              if (info) {
                setActiveProject(info.id);
                upsertLocalProject(info);
                await startWorkspaceSession(info.path, info.id);
                window.localStorage.removeItem('ZEUS_DATA_PATH');
                console.log('[projectStore] Migrado ZEUS_DATA_PATH -> sesión:', info.path);
                return;
              }
            }
          } catch (e) {
            console.warn('[projectStore] Migración ZEUS_DATA_PATH falló:', e);
          }
        }

        // 1) Si hay sessionId activo, intentar reusarlo en Express (con timeout de 3s).
        if (activeSessionId) {
          try {
            const ctrl = new AbortController();
            const to = setTimeout(() => ctrl.abort(), 3000);
            const res = await fetch(`${EXPRESS_BASE_URL}/api/session/resolve?sessionId=${encodeURIComponent(activeSessionId)}`, {
              signal: ctrl.signal,
            });
            clearTimeout(to);
            if (res.ok) {
              const data = await res.json();
              if (data?.cwd) {
                set({ activeCwd: data.cwd });
                console.log('[projectStore] Sesión restaurada de Express:', data.cwd);
                return;
              }
            }
          } catch {
            // Express no responde o sessionId no existe — sigue abajo.
            console.log('[projectStore] Sesión anterior no disponible en Express, recreando...');
          }
        }

        // 2) Recrear sesión desde el proyecto activo (path del espejo local).
        if (activeProjectId) {
          let path = projects.find((x) => x.id === activeProjectId)?.path || '';
          if (!path) {
            try {
              const localPb = await getLocalPb();
              const rec = await localPb.collection('projects').getOne(activeProjectId);
              path = (rec as any)?.path || (rec as any)?.path_local || '';
            } catch {
              /* ignore */
            }
          }
          if (path) {
            console.log('[projectStore] Recreando sesión para proyecto activo:', path);
            const session = await startWorkspaceSession(path, activeProjectId);
            if (session) return;
            // Si startWorkspaceSession falla (Express caído), usar el path como cwd.
            console.warn('[projectStore] Express no disponible, usando path del proyecto como cwd.');
            // Aún así marcar como activo en PocketBase.
            const projInfo = get().projects.find((p) => p.id === activeProjectId);
            void setActiveProjectInPocketBase(activeProjectId, projInfo?.name, path || projInfo?.path);
            set({ activeCwd: path, activeSessionId: null });
            return;
          }
        }

        // 3) Sin proyecto activo: probar la sesión activa global de Express (con timeout).
        try {
          const ctrl = new AbortController();
          const to = setTimeout(() => ctrl.abort(), 3000);
          const active = await getActiveSessionCwdWithTimeout(ctrl);
          clearTimeout(to);
          if (active.sessionId && active.cwd) {
            set({ activeSessionId: active.sessionId, activeCwd: active.cwd, activeProjectId: active.projectId || get().activeProjectId });
            return;
          }
        } catch {
          /* Express no responde */
        }

        // 4) Último recurso: si hay proyectos en el espejo local, reconectar el último.
        const allProjects = get().projects;
        if (allProjects.length > 0) {
          const last = allProjects[allProjects.length - 1];
          console.log('[projectStore] Reconectando al último proyecto conocido:', last.name, last.path);
          setActiveProject(last.id);
          const session = await startWorkspaceSession(last.path, last.id);
          if (session) return;
          // Aún así marcar como activo en PocketBase.
          void setActiveProjectInPocketBase(last.id, last.name, last.path);
          set({ activeCwd: last.path, activeSessionId: null });
          return;
        }

        set({ activeSessionId: null, activeCwd: null });
      },

      refreshProjectsFromPocketBase: async () => {
        try {
          const localPb = await getLocalPb();
          const recs = await localPb.collection('projects').getList<any>(1, 50, { sort: '-created' });
          const merged: ProjectInfo[] = recs.items.map((r) => ({
            id: r.id,
            name: r.name || basename(r.path || r.path_local || ''),
            path: (r.path || r.path_local || '').replace(/\\/g, '/'),
          }));
          // Conservar del espejo local los paths que PocketBase no trajo.
          const localById = new Map(get().projects.map((p) => [p.id, p]));
          for (const m of merged) {
            if (!m.path && localById.has(m.id)) m.path = localById.get(m.id)!.path;
          }
          // Añadir proyectos locales no presentes en PB.
          for (const [id, lp] of localById) {
            if (!merged.find((m) => m.id === id) && lp.path) merged.push(lp);
          }
          set({ projects: merged });
        } catch (e) {
          console.warn('[projectStore] refreshProjectsFromPocketBase falló:', e);
        }
      },
    }),
    {
      name: 'zeus-project-store',
      partialize: (s) => ({
        activeProjectId: s.activeProjectId,
        activeSessionId: s.activeSessionId,
        projects: s.projects,
      }),
    }
  )
);

/** Helpers usables fuera de React (ej. en executeZeusApiCall, fetch helpers). */
export function getActiveSessionId(): string | null {
  return useProjectStore.getState().activeSessionId;
}

export function getActiveProjectId(): string | null {
  return useProjectStore.getState().activeProjectId;
}

export function zeusSessionHeader(): Record<string, string> {
  const sid = getActiveSessionId();
  return sid ? { 'X-Zeus-Session': sid } : {};
}

/**
 * Espera a que activeSessionId esté disponible (rehydrateActiveSession es asíncrono).
 * Solo espera si hay un activeProjectId (significa que la rehidratación está en curso).
 * Si no hay proyecto activo, devuelve null inmediatamente (no hay sesión que esperar).
 */
async function waitForSessionId(timeoutMs = 5000): Promise<string | null> {
  const sid = getActiveSessionId();
  if (sid) return sid;
  // Si no hay proyecto activo, no hay sesión pendiente — no esperar.
  if (!getActiveProjectId()) return null;
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const check = () => {
      const s = getActiveSessionId();
      if (s) return resolve(s);
      if (Date.now() >= deadline) return resolve(null);
      setTimeout(check, 50);
    };
    check();
  });
}

/** fetch wrapper que inyecta el header de sesión automáticamente. */
export async function sessionFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const sid = await waitForSessionId();
  const headers = new Headers(init.headers || {});
  if (sid) headers.set('X-Zeus-Session', sid);
  return fetch(input, { ...init, headers });
}