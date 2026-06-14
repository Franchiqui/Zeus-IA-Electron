declare global {
  interface Window {
    __ZEUS_API_BASE__?: string;
    __ZEUS_VSCODE_API__?: {
      postMessage: (message: unknown) => void;
    };
    __ZEUS_MODEL_CONFIG__?: {
      apiKey?: string;
      model?: string;
      temperature?: number;
      maxTokens?: number;
      apiBaseUrl?: string;
      type?: string;
      provider?: string;
    };
  }
}

export type ZeusGenerateModelConfig = {
  modelId: string;
  apiKey?: string;
  model: string;
  temperature: number;
  maxTokens: number;
  apiBaseUrl?: string;
  displayName?: string;
  type?: string;
  provider?: string;
};

let modelConfigRequestSeq = 0;
let pocketBaseSessionRequestSeq = 0;

const cachedPbSession: { userId: string | null; token: string | null } = {
  userId: null,
  token: null
};

const cachedPbProfile: { userName: string | null; userEmail: string | null } = {
  userName: null,
  userEmail: null
};

export function getZeusPocketBaseProfile(): { userName: string | null; userEmail: string | null } {
  return { ...cachedPbProfile };
}

function applyPocketBaseSessionFromMessage(data: {
  pocketbaseUserId?: string | null;
  pocketbaseAuthToken?: string | null;
  userId?: string | null;
  token?: string | null;
  userName?: string | null;
  userEmail?: string | null;
}): void {
  const uid = data.pocketbaseUserId ?? data.userId;
  const tok = data.pocketbaseAuthToken ?? data.token;
  if (uid !== undefined) {
    cachedPbSession.userId = uid && String(uid).trim() ? String(uid).trim() : null;
  }
  if (tok !== undefined) {
    cachedPbSession.token = tok && String(tok).trim() ? String(tok).trim() : null;
  }
  if (!cachedPbSession.userId && !cachedPbSession.token) {
    cachedPbProfile.userName = null;
    cachedPbProfile.userEmail = null;
  } else {
    if (data.userName !== undefined) {
      cachedPbProfile.userName =
        data.userName && String(data.userName).trim() ? String(data.userName).trim() : null;
    }
    if (data.userEmail !== undefined) {
      cachedPbProfile.userEmail =
        data.userEmail && String(data.userEmail).trim() ? String(data.userEmail).trim() : null;
    }
  }
}

/** Cabeceras para la API generate-api (usuario PocketBase autenticado en la extensión). */
export function getZeusPocketBaseRequestHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  if (cachedPbSession.userId) {
    h['x-user-id'] = cachedPbSession.userId;
  }
  if (cachedPbSession.token) {
    h['Authorization'] = `Bearer ${cachedPbSession.token}`;
  }
  return h;
}

/** Actualiza sesión desde la extensión (abrir panel o modal). */
export function requestPocketBaseSessionFromExtension(): Promise<void> {
  const vscodeApi = window.__ZEUS_VSCODE_API__;
  if (!vscodeApi) {
    return Promise.resolve();
  }
  const requestId = ++pocketBaseSessionRequestSeq;
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      resolve();
    }, 8000);

    function onMessage(event: MessageEvent) {
      const data = event.data as {
        type?: string;
        requestId?: number;
        userId?: string | null;
        token?: string | null;
        userName?: string | null;
        userEmail?: string | null;
      };
      if (!data || data.type !== 'zeusPocketBaseSession' || data.requestId !== requestId) {
        return;
      }
      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      applyPocketBaseSessionFromMessage({
        userId: data.userId,
        token: data.token,
        userName: data.userName,
        userEmail: data.userEmail
      });
      resolve();
    }

    window.addEventListener('message', onMessage);
    vscodeApi.postMessage({ type: 'requestZeusPocketBaseSession', requestId });
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('message', (event: MessageEvent) => {
    const d = event.data as {
      type?: string;
      loggedIn?: boolean;
      userName?: string;
      userEmail?: string;
    };
    if (!d || d.type !== 'zeusAuthChanged') {
      return;
    }
    if (d.loggedIn === false) {
      cachedPbSession.userId = null;
      cachedPbSession.token = null;
      cachedPbProfile.userName = null;
      cachedPbProfile.userEmail = null;
      window.dispatchEvent(
        new CustomEvent('zeus-auth-changed', { detail: { loggedIn: false as const } })
      );
    } else if (d.loggedIn === true) {
      if (d.userName !== undefined) {
        cachedPbProfile.userName =
          d.userName && String(d.userName).trim() ? String(d.userName).trim() : null;
      }
      if (d.userEmail !== undefined) {
        cachedPbProfile.userEmail =
          d.userEmail && String(d.userEmail).trim() ? String(d.userEmail).trim() : null;
      }
      void requestPocketBaseSessionFromExtension().then(() => {
        window.dispatchEvent(
          new CustomEvent('zeus-auth-changed', {
            detail: {
              loggedIn: true as const,
              userName: cachedPbProfile.userName,
              userEmail: cachedPbProfile.userEmail
            }
          })
        );
      });
    }
  });
}

/** Pide a la extensión la config del modelo seleccionado en Zeus (PocketBase). */
export function requestModelConfigFromExtension(): Promise<ZeusGenerateModelConfig | null> {
  const vscodeApi = window.__ZEUS_VSCODE_API__;

  if (vscodeApi) {
    const requestId = ++modelConfigRequestSeq;
    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        window.removeEventListener('message', onMessage);
        resolve(null);
      }, 8000);

      function onMessage(event: MessageEvent) {
        const data = event.data as {
          type?: string;
          requestId?: number;
          config?: ZeusGenerateModelConfig | null;
          pocketbaseUserId?: string | null;
          pocketbaseAuthToken?: string | null;
        };
        if (!data || data.type !== 'zeusModelConfig' || data.requestId !== requestId) {
          return;
        }
        window.clearTimeout(timeout);
        window.removeEventListener('message', onMessage);
        applyPocketBaseSessionFromMessage(data);
        const c = data.config;
        const isLocal = c?.type === 'local' || c?.type === 'LM Studio' || c?.provider === 'LM Studio' || c?.provider === 'local';
        
        if (isLocal || c?.apiKey?.trim()) {
          resolve({
            modelId: c?.modelId || '',
            apiKey: c?.apiKey?.trim() || '',
            model: c?.model || 'deepseek-chat',
            temperature: typeof c?.temperature === 'number' ? c.temperature : 0.7,
            maxTokens: typeof c?.maxTokens === 'number' ? c.maxTokens : 8192,
            apiBaseUrl: c?.apiBaseUrl,
            type: c?.type,
            provider: c?.provider,
            displayName: c?.displayName
          });
        } else {
          resolve(null);
        }
      }

      window.addEventListener('message', onMessage);
      vscodeApi.postMessage({ type: 'requestZeusModelConfig', requestId });
    });
  }

  return Promise.resolve(null);
}

let projectsListRequestSeq = 0;

export function isZeusCentralPanelInVsCode(): boolean {
  return typeof window !== 'undefined' && !!window.__ZEUS_VSCODE_API__;
}

/** Lista `projects_api` vía extensión (GET directo a PocketBase con tu sesión). */
export function requestProjectsFromExtension(): Promise<{
  projects: Record<string, unknown>[];
  error?: string;
}> {
  const vscodeApi = window.__ZEUS_VSCODE_API__;
  if (!vscodeApi) {
    return Promise.resolve({ projects: [] });
  }
  const requestId = ++projectsListRequestSeq;
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      resolve({ projects: [], error: 'Tiempo de espera al pedir proyectos a la extensión.' });
    }, 20000);

    function onMessage(event: MessageEvent) {
      const data = event.data as {
        type?: string;
        requestId?: number;
        projects?: Record<string, unknown>[];
        error?: string;
      };
      if (!data || data.type !== 'zeusProjectsList' || data.requestId !== requestId) {
        return;
      }
      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      resolve({
        projects: Array.isArray(data.projects) ? data.projects : [],
        error: data.error
      });
    }

    window.addEventListener('message', onMessage);
    vscodeApi.postMessage({ type: 'requestZeusProjectsList', requestId });
  });
}

let projectByIdRequestSeq = 0;

/** Detalle de un `projects_api` vía extensión (getOne en PocketBase con tu sesión). */
export function requestProjectByIdFromExtension(
  projectId: string
): Promise<{ project: Record<string, unknown> | null; error?: string }> {
  const vscodeApi = window.__ZEUS_VSCODE_API__;
  if (!vscodeApi) {
    return Promise.resolve({ project: null });
  }
  const requestId = ++projectByIdRequestSeq;
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      resolve({ project: null, error: 'Tiempo de espera al cargar el proyecto.' });
    }, 20000);

    function onMessage(event: MessageEvent) {
      const data = event.data as {
        type?: string;
        requestId?: number;
        project?: Record<string, unknown> | null;
        error?: string;
      };
      if (!data || data.type !== 'zeusProjectById' || data.requestId !== requestId) {
        return;
      }
      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      const p = data.project;
      resolve({
        project: p !== null && p !== undefined && typeof p === 'object' ? p : null,
        error: data.error
      });
    }

    window.addEventListener('message', onMessage);
    vscodeApi.postMessage({ type: 'requestZeusProjectById', requestId, projectId });
  });
}

let downloadZipRequestSeq = 0;

/** Guardar ZIP generado en el panel: diálogo nativo de VS Code (el webview bloquea descargas blob). */
export function requestSaveZipFromExtension(
  filename: string,
  base64: string
): Promise<{ ok?: boolean; cancelled?: boolean; error?: string }> {
  const vscodeApi = window.__ZEUS_VSCODE_API__;
  if (!vscodeApi) {
    return Promise.resolve({ error: 'No hay bridge de VS Code' });
  }
  const requestId = ++downloadZipRequestSeq;
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      resolve({ error: 'Tiempo de espera al guardar el ZIP.' });
    }, 120000);

    function onMessage(event: MessageEvent) {
      const data = event.data as {
        type?: string;
        requestId?: number;
        ok?: boolean;
        cancelled?: boolean;
        error?: string;
      };
      if (!data || data.type !== 'zeusDownloadZipResult' || data.requestId !== requestId) {
        return;
      }
      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      if (data.cancelled) resolve({ cancelled: true });
      else if (typeof data.error === 'string' && data.error) resolve({ error: data.error });
      else resolve({ ok: true });
    }

    window.addEventListener('message', onMessage);
    vscodeApi.postMessage({
      type: 'requestZeusDownloadZip',
      requestId,
      filename,
      base64
    });
  });
}

export function getZeusApiBase(): string {
  if (typeof window !== 'undefined' && window.__ZEUS_API_BASE__) {
    return String(window.__ZEUS_API_BASE__).replace(/\/$/, '');
  }
  const env = import.meta.env.VITE_ZEUS_API_BASE;
  if (typeof env === 'string' && env.trim()) {
    return env.trim().replace(/\/$/, '');
  }
  return 'http://localhost:8743';
}
