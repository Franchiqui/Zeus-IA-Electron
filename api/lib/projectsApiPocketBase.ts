/**
 * Normalización para la colección PocketBase `projects_api`:
 * - endpoints: campo type "json" → enviar array/objeto serializable, no string JSON.
 * - code, documentation, schemas: type "editor" → strings.
 */

export function normalizeEndpointsForProjectsApi(endpoints: unknown): unknown[] {
  if (endpoints == null) return [];
  if (Array.isArray(endpoints)) return endpoints;
  if (typeof endpoints === 'string') {
    const t = endpoints.trim();
    if (!t) return [];
    try {
      const p = JSON.parse(t);
      if (Array.isArray(p)) return p;
      if (p !== null && typeof p === 'object') return [p];
      return [];
    } catch {
      return [];
    }
  }
  if (typeof endpoints === 'object') return [endpoints as object];
  return [];
}

export function getProjectsApiDescriptionMax(): number {
  return envInt('ZEUS_PB_PROJECTS_DESCRIPTION_MAX', 50000);
}

/** Detalle legible de ClientResponseError de pocketbase (validación por campo). */
export function formatPocketBaseSaveError(err: unknown): string {
  if (err && typeof err === 'object') {
    const o = err as {
      message?: string;
      response?: { data?: Record<string, unknown> };
      data?: Record<string, unknown>;
    };
    const payload = o.response?.data ?? o.data;
    if (payload && typeof payload === 'object') {
      try {
        const inner = payload.data;
        const part =
          inner && typeof inner === 'object' && !Array.isArray(inner) ? inner : payload;
        const raw = JSON.stringify(part);
        const cap = 8000;
        const snippet =
          raw.length <= cap ? raw : `${raw.slice(0, cap)}…[${raw.length} chars]`;
        return `${o.message ?? 'PocketBase'} — ${snippet}`;
      } catch {
        /* fall through */
      }
    }
    if (typeof o.message === 'string' && o.message.trim()) return o.message;
  }
  return err instanceof Error ? err.message : String(err);
}


/** Valor para campos editor (texto en la API de PocketBase). */
export function editorFieldForProjectsApi(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Id del propietario en `projects_api` (campo `user_id`; compat. lectura `user`). */
export function getProjectsApiOwnerId(project: Record<string, unknown>): string | undefined {
  const raw =
    project.user_id !== undefined && project.user_id !== null ? project.user_id : project.user;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (raw && typeof raw === 'object' && raw !== null && 'id' in raw) {
    return String((raw as { id: string }).id);
  }
  return undefined;
}

export function buildProjectsApiCreateBody(
  projectData: Record<string, unknown>,
  userId?: string | null
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    title: projectData.title,
    description: projectData.description,
    endpoints: normalizeEndpointsForProjectsApi(projectData.endpoints),
    pb_schema: projectData.pb_schema || [] // Nuevo campo para esquemas de PocketBase
  };
  const code = editorFieldForProjectsApi(projectData.code);
  const documentation = editorFieldForProjectsApi(projectData.documentation);
  const schemas = editorFieldForProjectsApi(projectData.schemas);
  if (code !== undefined) body.code = code;
  if (documentation !== undefined) body.documentation = documentation;
  if (schemas !== undefined) body.schemas = schemas;
  const uid = userId != null && String(userId).trim() ? String(userId).trim() : '';
  if (uid) {
    body.user_id = uid;
  }
  return body;
}

function envInt(varName: string, defaultValue: number): number {
  const value = process.env[varName];
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

