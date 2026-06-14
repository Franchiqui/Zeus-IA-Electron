/**
 * Repara salidas del modelo que mezclan Markdown largo dentro de swagger-jsdoc
 * (`definition` / `info.description`), rompiendo `api.ts` al ejecutar `ts-node`.
 */

export function escapeSingleQuoted(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Encuentra el `}` que cierra la `{` en openIdx, ignorando llaves dentro de '...', "...", `...`.
 */
export function findMatchingBrace(code: string, openIdx: number): number {
  let depth = 0;
  let mode: 'code' | 'squote' | 'dquote' | 'template' = 'code';
  let escaped = false;
  let templateExprDepth = 0;

  for (let i = openIdx; i < code.length; i++) {
    const c = code[i];

    if (mode === 'squote') {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === '\\') {
        escaped = true;
        continue;
      }
      if (c === "'") {
        mode = 'code';
        continue;
      }
      continue;
    }

    if (mode === 'dquote') {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === '\\') {
        escaped = true;
        continue;
      }
      if (c === '"') {
        mode = 'code';
        continue;
      }
      continue;
    }

    if (mode === 'template') {
      if (templateExprDepth > 0) {
        if (c === '{') templateExprDepth++;
        else if (c === '}') templateExprDepth--;
        continue;
      }
      if (c === '\\' && code[i + 1] === '`') {
        i++;
        continue;
      }
      if (c === '$' && code[i + 1] === '{') {
        templateExprDepth = 1;
        i++;
        continue;
      }
      if (c === '`') {
        mode = 'code';
        continue;
      }
      continue;
    }

    if (c === "'") {
      mode = 'squote';
      continue;
    }
    if (c === '"') {
      mode = 'dquote';
      continue;
    }
    if (c === '`') {
      mode = 'template';
      continue;
    }

    if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

/** Título visible en Swagger: evita duplicar "API" si el nombre del proyecto ya lo incluye. */
export function openapiInfoTitleLine(title: string): string {
  const t = escapeSingleQuoted(title).slice(0, 220).trim();
  if (/\bAPI\b/i.test(t)) {
    return t;
  }
  return `${t} API`;
}

/**
 * Resumen corto para `info.description` en OpenAPI/Swagger UI.
 * Swagger interpreta Markdown: los ## se vuelven títulos enormes. Aquí dejamos texto legible y breve.
 */
export function openApiInfoDescriptionPlainSummary(raw: unknown, maxChars = 480): string {
  if (!raw || !String(raw).trim()) {
    return 'API generada con Zeus.';
  }
  let s = '';
  if (typeof raw === 'string') {
    s = raw;
  } else if (raw && typeof raw === 'object') {
    if ((raw as any).text) s = String((raw as any).text);
    else if ((raw as any).markdown) s = String((raw as any).markdown);
    else if ((raw as any).description) s = String((raw as any).description);
    else {
      try { s = JSON.stringify(raw); } catch { s = String(raw); }
    }
  } else {
    s = String(raw);
  }

  s = s.replace(/\r\n/g, '\n').trim();
  s = s.replace(/^#{1,6}\s+[^\n]*$/gm, ' ');
  s = s.replace(/^#{1,6}\s+/gm, '');
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/__([^_]+)__/g, '$1');
  s = s.replace(/`([^`]+)`/g, '$1');
  s = s.replace(/^\s*[-*+]\s+/gm, '• ');
  s = s.replace(/^\s*\d+\.\s+/gm, '');
  s = s.replace(/\n{3,}/g, '\n\n');
  s = s.replace(/\n\n+/g, '\n\n');
  s = s.replace(/\n/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > maxChars) {
    const cut = s.slice(0, maxChars);
    const lastSpace = cut.lastIndexOf(' ');
    s = (lastSpace > maxChars * 0.55 ? cut.slice(0, lastSpace) : cut).trim() + '…';
  }
  return s;
}

export const SWAGGER_UI_READABLE_CSS =
  '.swagger-ui .info .title{font-size:1.5rem!important;line-height:1.3;font-weight:600}' +
  '.swagger-ui .info .description{font-size:.875rem!important;line-height:1.55!important;max-width:56rem;color:#3b4151;font-weight:400}' +
  '.swagger-ui .info .description p{margin:.45em 0}' +
  '.swagger-ui .info .description ul,.swagger-ui .info .description ol{margin:.4em 0 .4em 1.15em}' +
  '.swagger-ui .info .description h1,.swagger-ui .info .description h2,.swagger-ui .info .description h3,.swagger-ui .info .description h4{font-size:1rem!important;font-weight:600!important;margin:.7em 0 .35em!important;line-height:1.35!important}';

/** Ajusta tipografía del bloque de información en Swagger UI. */
export function patchSwaggerUiSetupForReadableInfo(code: string): string {
  if (!code.includes('swaggerUi.setup')) {
    return code;
  }
  if (/swaggerUi\.setup[\s\S]*?customCss\s*:/.test(code)) {
    return code;
  }
  const opts = `{ customCss: ${JSON.stringify(SWAGGER_UI_READABLE_CSS)} }`;
  if (/\bswaggerUi\.setup\s*\(\s*swaggerSpec\s*\)/.test(code)) {
    return code.replace(/\bswaggerUi\.setup\s*\(\s*swaggerSpec\s*\)/g, `swaggerUi.setup(swaggerSpec, ${opts})`);
  }
  if (/\bswaggerUi\.setup\s*\(\s*swaggerSpec\s*,\s*\{/.test(code)) {
    return code.replace(
      /\bswaggerUi\.setup\s*\(\s*swaggerSpec\s*,\s*\{/,
      `swaggerUi.setup(swaggerSpec, { customCss: ${JSON.stringify(SWAGGER_UI_READABLE_CSS)}, `
    );
  }
  return code;
}

function ensureLeadingSlash(path: string): string {
  if (path.startsWith('/')) return path;
  return `/${path}`;
}

/** Express `/users/:id` → OpenAPI `/users/{id}` */
function expressPathToOpenAPI(path: string): string {
  return ensureLeadingSlash(path).replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

type ExpressRouteProbe = { method: string; path: string };

/** OpenAPI 3 operation (swagger-jsdoc hace merge con los @swagger del archivo). */
type OaOp = {
  summary: string;
  description?: string;
  tags?: string[];
  parameters?: Array<Record<string, unknown>>;
  requestBody?: Record<string, unknown>;
  responses: Record<string, { description: string }>;
};

function pathParamNamesFromOpenApiPath(oaPath: string): string[] {
  const names: string[] = [];
  const re = /\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(oaPath)) !== null) {
    names.push(m[1]);
  }
  return names;
}

/** Metadatos de endpoint guardados en PocketBase / JSON del modelo (alineado con el probador). */
export type ZeusEndpointRecord = {
  method: string;
  path: string;
  description?: string;
  parameters?: Record<string, unknown>;
};

/** Unifica rutas Express (`:id`) y metadatos Zeus (`{id}`) para emparejar endpoint ↔ código. */
export function routeLookupKey(method: string, path: string): string {
  let p = ensureLeadingSlash(String(path).trim()).replace(/\/+/g, '/');
  p = p.replace(/\{([A-Za-z0-9_]+)\}/g, ':$1');
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return `${method.trim().toLowerCase()}:${p.toLowerCase()}`;
}

/**
 * Claves `method:path` alternativas para indexar y resolver metadatos Zeus.
 * El código Express suele usar `/api/...` mientras el JSON de endpoints trae `/recurso` sin prefijo (o al revés).
 */
function routeLookupKeyVariants(method: string, path: string): string[] {
  const baseKey = routeLookupKey(method, path);
  const sep = baseKey.indexOf(':');
  const m = sep >= 0 ? baseKey.slice(0, sep) : method.trim().toLowerCase();
  const pl = sep >= 0 ? baseKey.slice(sep + 1) : pathKeyForMatch(path);
  const variants = new Set<string>([pl]);
  let cur = pl;
  for (let i = 0; i < 8; i++) {
    const stripped = cur.replace(/^\/api(\/v\d+)?(?=\/|$)/, '');
    const next =
      stripped === '' ? '/' : stripped.startsWith('/') ? stripped : `/${stripped}`;
    const norm = next.replace(/\/+/g, '/');
    if (norm === cur) break;
    variants.add(norm);
    cur = norm;
  }
  if (!/^\/api(\/|$)/.test(pl)) {
    variants.add(pl === '/' ? '/api' : `/api${pl}`);
  }
  return [...variants].map((p) => `${m}:${p}`);
}

/** Path comparable entre metadatos y Express ignorando prefijo /api(/vN)? */
function canonicalPathForEndpointMatching(path: string): string {
  const pk = pathKeyForMatch(path);
  const stripped = pk.replace(/^\/api(\/v\d+)?(?=\/|$)/, '') || '/';
  return stripped.replace(/\/+/g, '/');
}

/** Solo path normalizado (mismo criterio que routeLookupKey) para emparejar hermanos HTTP. */
function pathKeyForMatch(path: string): string {
  let p = ensureLeadingSlash(String(path).trim()).replace(/\/+/g, '/');
  p = p.replace(/\{([A-Za-z0-9_]+)\}/g, ':$1');
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p.toLowerCase();
}

/**
 * Registro Zeus por ruta: primero method+path exacto; si no hay, mismo path y mismo método entre hermanos.
 */
function resolveEndpointRecordForRoute(
  method: string,
  expressPath: string,
  endpointsByRoute?: Map<string, ZeusEndpointRecord>
): ZeusEndpointRecord | undefined {
  if (!endpointsByRoute?.size) return undefined;
  for (const key of routeLookupKeyVariants(method, expressPath)) {
    const hit = endpointsByRoute.get(key);
    if (hit) return hit;
  }
  const pk = canonicalPathForEndpointMatching(expressPath);
  const m = method.toLowerCase();
  const siblings = Array.from(endpointsByRoute.values()).filter(
    (r) => canonicalPathForEndpointMatching(r.path) === pk
  );
  return siblings.find((r) => r.method.trim().toLowerCase() === m) ?? siblings[0];
}

/**
 * Acepta el objeto Zeus habitual `{ id: { type, required, description } }` o un array estilo OpenAPI
 * `[{ name, in, schema, required, description }]` que a veces devuelve el modelo.
 */
function normalizeEndpointParametersField(raw: unknown): Record<string, unknown> | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    const q = o.query;
    const b = o.body;
    const nestedQuery = q && typeof q === 'object' && !Array.isArray(q);
    const nestedBody = b && typeof b === 'object' && !Array.isArray(b);
    if (nestedQuery || nestedBody) {
      const flat: Record<string, unknown> = { ...o };
      delete flat.query;
      delete flat.body;
      if (nestedQuery) Object.assign(flat, q as Record<string, unknown>);
      if (nestedBody) Object.assign(flat, b as Record<string, unknown>);
      return Object.keys(flat).length > 0 ? flat : undefined;
    }
    return o;
  }
  if (!Array.isArray(raw)) return undefined;
  const out: Record<string, unknown> = {};
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const p = item as Record<string, unknown>;
    const name = typeof p.name === 'string' ? p.name.trim() : '';
    if (!name) continue;
    const inn = String(p.in ?? '').toLowerCase();
    if (inn === 'header' || inn === 'cookie') continue;
    const schema =
      p.schema && typeof p.schema === 'object' && !Array.isArray(p.schema)
        ? (p.schema as Record<string, unknown>)
        : {};
    const type = String(schema.type ?? 'string').toLowerCase();
    const required = p.required === true;
    const description = typeof p.description === 'string' ? p.description : undefined;
    out[name] = {
      type,
      required,
      ...(description ? { description } : {})
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function endpointsJsonToList(endpoints: unknown): unknown[] {
  if (Array.isArray(endpoints)) return endpoints;
  if (endpoints !== null && typeof endpoints === 'object' && !Array.isArray(endpoints)) {
    const o = endpoints as Record<string, unknown>;
    if (typeof o.path === 'string' || typeof o.method === 'string') {
      return [endpoints];
    }
    const vals = Object.values(o).filter((v) => v && typeof v === 'object' && !Array.isArray(v));
    if (
      vals.length > 0 &&
      vals.every((v) => {
        const r = v as Record<string, unknown>;
        return typeof r.path === 'string' || typeof r.method === 'string';
      })
    ) {
      return vals;
    }
    return [endpoints];
  }
  if (typeof endpoints === 'string') {
    try {
      const p = JSON.parse(endpoints);
      return endpointsJsonToList(p);
    } catch {
      return [];
    }
  }
  return [];
}

function parseZeusEndpointsMetadata(endpoints: unknown): ZeusEndpointRecord[] {
  const list = endpointsJsonToList(endpoints);
  const out: ZeusEndpointRecord[] = [];
  for (const ep of list) {
    const o = ep && typeof ep === 'object' ? (ep as Record<string, unknown>) : {};
    const method = String(o.method ?? 'GET').trim();
    const path = String(o.path ?? '/').trim();
    if (!path) continue;
    const description = typeof o.description === 'string' ? o.description : undefined;
    const parameters = normalizeEndpointParametersField(o.parameters);
    out.push({ method, path, description, parameters });
  }
  return out;
}

/**
 * Corrige llamadas legacy del SDK de PocketBase que el modelo suele inventar.
 * - pb.request(...) -> helper basado en client.send(...)
 * - getMany/getRecord/createRecord/updateRecord/deleteRecord -> métodos actuales
 */
export function patchPocketBaseLegacySdkCallsInApiTs(code: string): string {
  let out = code;

  // El modelo a veces mezcla `getFullList({...})` con forma de respuesta paginada (`response.records`).
  // Lo redirigimos al wrapper `getMany(...)` que sí devuelve `{ records, page, limit, total, totalPages }`.
  out = out.replace(/\.\s*getFullList\s*\(/g, '.getMany(');

  // Envolver colecciones de PocketBase para exponer aliases legacy (`getMany`, `getRecord`, etc).
  out = out.replace(/\bpb\.collection\s*\(/g, '__zeusCollection(pb, ');

  if (/\bpb\.request\s*\(/.test(out)) {
    out = out.replace(/\bpb\.request\s*\(/g, '__zeusPbRequest(pb, ');

    if (!out.includes('const __zeusPbRequest = async')) {
      const helper = `const __zeusPbRequest = async (
  client: any,
  method: string,
  path: string,
  body?: any,
  options?: Record<string, unknown>
) => {
  const hasBody =
    body !== undefined &&
    body !== null &&
    !(typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0);

  const payload: Record<string, unknown> = {
    ...(options || {}),
    method
  };

  if (hasBody) {
    payload.body = body;
  }

  return client.send(path, payload);
};

`;
      out = insertAfterLeadingImports(out, helper);
    }
  }

  if (!out.includes('const __zeusCollection = (pb: any, name: string) =>')) {
    const collectionHelper = `const __zeusFilterObjectToPbFilter = (value: any): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || Array.isArray(value)) return String(value);

  const entries = Object.entries(value as Record<string, unknown>);
  return entries
    .map(([k, v]) => {
      if (v === null) return k + ' = null';
      if (typeof v === 'number' || typeof v === 'boolean') return k + ' = ' + String(v);
      const escaped = String(v).replace(/'/g, "\\'");
      return k + " = '" + escaped + "'";
    })
    .join(' && ');
};

const __zeusCollection = (pb: any, name: string) => {
  const svc = (pb as any).collection(name) as any;

  if (typeof svc.getRecord !== 'function') {
    svc.getRecord = (id: string, options?: any) => svc.getOne(id, options);
  }
  if (typeof svc.createRecord !== 'function') {
    svc.createRecord = (data: any, options?: any) => svc.create(data, options);
  }
  if (typeof svc.updateRecord !== 'function') {
    svc.updateRecord = (id: string, data: any, options?: any) => svc.update(id, data, options);
  }
  if (typeof svc.deleteRecord !== 'function') {
    svc.deleteRecord = (id: string, options?: any) => svc.delete(id, options);
  }
  if (typeof svc.getMany !== 'function') {
    svc.getMany = async (params?: any) => {
      const rawPage = Number(params?.page ?? 1);
      const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
      const rawLimit = Number(params?.limit ?? params?.perPage ?? 30);
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 30;
      const options: Record<string, unknown> = {};

      if (params?.sort != null) options.sort = String(params.sort);
      if (params?.expand != null) options.expand = params.expand;
      if (params?.fields != null) options.fields = params.fields;
      if (params?.filter != null) {
        const filter = __zeusFilterObjectToPbFilter(params.filter);
        if (filter) options.filter = filter;
      }

      const res = await svc.getList(page, limit, options);
      return {
        records: Array.isArray(res?.items) ? res.items : [],
        page: typeof res?.page === 'number' ? res.page : page,
        limit: typeof res?.perPage === 'number' ? res.perPage : limit,
        total: typeof res?.totalItems === 'number' ? res.totalItems : 0,
        totalPages: typeof res?.totalPages === 'number' ? res.totalPages : 1
      };
    };
  }

  return svc;
};

`;
    out = insertAfterLeadingImports(out, collectionHelper);
  }

  return out;
}

/** Corrige imports inválidos de PocketBase: `import { PocketBase } from 'pocketbase'`. */
export function patchPocketBaseImportInApiTs(code: string): string {
  let out = code;

  out = out.replace(
    /import\s*\{\s*PocketBase\s*\}\s*from\s*['"]pocketbase['"];?/g,
    "import PocketBase from 'pocketbase';"
  );

  out = out.replace(
    /import\s*\{\s*([^}]*)\}\s*from\s*['"]pocketbase['"];?/g,
    (full, namesRaw: string) => {
      const names = namesRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      if (!names.some((n) => n === 'PocketBase')) {
        return full;
      }

      const rest = names.filter((n) => n !== 'PocketBase');
      if (rest.length === 0) {
        return "import PocketBase from 'pocketbase';";
      }

      return `import PocketBase, { ${rest.join(', ')} } from 'pocketbase';`;
    }
  );

  return out;
}

function indexEndpointsByRoute(records: ZeusEndpointRecord[]): Map<string, ZeusEndpointRecord> {
  const m = new Map<string, ZeusEndpointRecord>();
  for (const r of records) {
    for (const key of routeLookupKeyVariants(r.method, r.path)) {
      m.set(key, r);
    }
  }
  return m;
}

/** Campo Docs / Markdown del proyecto (PocketBase editor → string u objeto). */
export function normalizeZeusDocumentationField(val: unknown): string {
  if (val == null) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'object') {
    const o = val as Record<string, unknown>;
    if (typeof o.text === 'string') return o.text;
    if (typeof o.markdown === 'string') return o.markdown;
    try {
      const s = JSON.stringify(val);
      return s === '{}' ? '' : s;
    } catch {
      return String(val);
    }
  }
  return String(val);
}

/**
 * Mapa entidad (p. ej. Task) → nombre de campo → spec Zeus { type, required?, description?, enum? }
 * reconocido desde Docs: bloques `Task:` o `## Task` y líneas `campo: tipo (...)`.
 */
export function buildDocumentationEntityFieldMap(docs: string): Map<string, Record<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, Record<string, unknown>>>();
  const text = String(docs ?? '').replace(/\r\n/g, '\n');
  if (!text.trim()) return map;

  let current: string | null = null;
  let fields: Record<string, Record<string, unknown>> = {};

  const flush = () => {
    if (current && Object.keys(fields).length > 0) {
      map.set(current, { ...fields });
    }
  };

  const restToSpec = (rest: string): Record<string, unknown> => {
    const raw = rest.trim();
    const lower = raw.toLowerCase();
    const nullable = /\bnullable\b/.test(lower);
    const spec: Record<string, unknown> = { type: 'string', description: raw.slice(0, 400) };

    const enumBracket = /\benum\s*\[\s*([^\]]+)\]/i.exec(raw);
    if (enumBracket) {
      const vals = enumBracket[1]
        .split(',')
        .map((s) => s.replace(/['"]/g, '').trim())
        .filter(Boolean);
      if (vals.length > 0) spec.enum = vals;
    }

    const arrM = /\barray\s*<\s*([^>]+)\s*>/i.exec(raw);
    const mapM = /\bmap\s*</i.exec(raw);
    if (arrM && !spec.enum) {
      spec.type = 'array';
      const inner = arrM[1].trim().toLowerCase();
      if (inner === 'string' || inner === 'string[]') spec.itemsType = 'string';
      else if (inner === 'integer' || inner === 'int') spec.itemsType = 'integer';
      else if (inner === 'number' || inner === 'float' || inner === 'double') spec.itemsType = 'number';
      else if (inner === 'boolean' || inner === 'bool') spec.itemsType = 'boolean';
      else spec.itemsType = 'object';
    } else if (mapM && !spec.enum) {
      spec.type = 'object';
    } else if (!spec.enum) {
      if (/\bjsonb\b/.test(lower) || (/\bjson\b/i.test(raw) && /\bflexible\b/i.test(raw))) {
        spec.type = 'object';
      } else if (/\binteger\b/.test(lower) || /\bint\b/.test(lower) || /\bfibonacci\b/i.test(raw)) {
        spec.type = 'integer';
      } else if (
        /\bfloat\b/.test(lower) ||
        /\bdouble\b/.test(lower) ||
        /\bdecimal\b/.test(lower) ||
        (/\bnumber\b/.test(lower) && !/foreign\s+key/i.test(raw))
      ) {
        spec.type = 'number';
      } else if (/\bboolean\b/.test(lower)) {
        spec.type = 'boolean';
      } else if (/\buuid\b/.test(lower)) {
        spec.type = 'string';
        spec.format = 'uuid';
      } else if (/\btimestamp\b/.test(lower) || /\bdatetime\b/.test(lower) || /\bdate\b/.test(lower)) {
        spec.type = 'string';
        spec.format = 'date-time';
      }
    }

    if ((/\brequired\b/.test(lower) || /\bprimary\s+key\b/.test(lower)) && !nullable) {
      spec.required = true;
    }
    return spec;
  };

  let inJsonBlock = false;
  let jsonBuffer = '';

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detectar inicio de bloque JSON de parámetros
    if (inJsonBlock) {
      if (trimmed.startsWith('```')) {
        try {
          const parsed = JSON.parse(jsonBuffer);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            for (const [k, v] of Object.entries(parsed)) {
              if (typeof v === 'string') fields[k] = restToSpec(v);
              else if (typeof v === 'number') fields[k] = { type: 'number', description: String(v) };
              else if (typeof v === 'boolean') fields[k] = { type: 'boolean', description: String(v) };
              else if (Array.isArray(v)) fields[k] = { type: 'array', description: JSON.stringify(v) };
              else if (v && typeof v === 'object') fields[k] = { type: 'object', description: JSON.stringify(v) };
            }
          }
        } catch {
          // Ignorar JSON inválido en la doc
        }
        inJsonBlock = false;
        jsonBuffer = '';
      } else {
        jsonBuffer += trimmed;
      }
      continue;
    }

    if (/\b(Parámetros|Parameters|Request Body|Esquema|Schema)\b/i.test(trimmed)) {
      const nextJson = text.indexOf('```json', text.indexOf(rawLine)) !== -1;
      if (nextJson) {
        // Marcamos para empezar a capturar en la siguiente línea que sea ```json
      }
    }
    if (trimmed.startsWith('```json')) {
      inJsonBlock = true;
      jsonBuffer = '';
      continue;
    }

    const mdEnt = /^#{1,6}\s+(?:\*\*)?([A-Za-z0-9/_-]+)(?:\*\*)?\s*$/.exec(trimmed);
    if (mdEnt) {
      flush();
      current = mdEnt[1].replace(/[*]/g, '').trim();
      fields = {};
      continue;
    }

    const pascalEntity = /^([A-Z][a-zA-Z0-9_]*)\s*:\s*$/.exec(trimmed);
    if (pascalEntity) {
      flush();
      current = pascalEntity[1];
      fields = {};
      continue;
    }

    const bullet = /^\s*[-*]\s*([a-zA-Z_][\w]*)\s*:\s*(.+)$/.exec(line);
    if (current && bullet) {
      fields[bullet[1]] = restToSpec(bullet[2]);
      continue;
    }

    const indented = /^\s+([a-zA-Z_][\w]*)\s*:\s*(.+)$/.exec(line);
    if (current && indented) {
      fields[indented[1]] = restToSpec(indented[2]);
      continue;
    }

    const topField = /^([a-z_][\w]*)\s*:\s*(.+)$/.exec(trimmed);
    if (current && topField && !/^([A-Z][a-zA-Z0-9_]*)\s*:\s*$/.test(trimmed)) {
      fields[topField[1]] = restToSpec(topField[2]);
    }
  }

  flush();
  return map;
}

function singularizePathSegment(seg: string): string {
  const x = seg.toLowerCase();
  if (x.endsWith('ies')) return x.slice(0, -3) + 'y';
  if (x.endsWith('ses') || x.endsWith('xes')) return x.slice(0, -2);
  if (x.length > 1 && x.endsWith('s')) return x.slice(0, -1);
  return x;
}

/** Segmentos de ruta → nombre de entidad en la documentación (cuando no coincide por plural/singular). */
const SEGMENT_ENTITY_ALIASES: Record<string, string[]> = {
  search: ['SearchMetadata', 'Search'],
  query: ['SearchMetadata', 'Search'],
  results: ['SearchMetadata', 'Search'],
  tracks: ['Track', 'Tracks'],
  artists: ['Artist', 'Artists'],
  providers: ['Provider', 'Providers']
};

/** Elige entidad de Docs que mejor encaje con un segmento de ruta (Task ↔ /api/tracks). */
function matchDocumentationEntityForPath(
  expressPath: string,
  entityMap: Map<string, Record<string, Record<string, unknown>>>
): string | undefined {
  if (entityMap.size === 0) return undefined;
  const names = [...entityMap.keys()].sort((a, b) => b.length - a.length);
  const segments = expressPath
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const seg of segments) {
    const base = seg.replace(/^:/, '').replace(/\{([^}]+)\}/g, '$1').toLowerCase();
    if (!base || base === 'api' || base === 'v1' || base === 'v2' || base === 'v3') continue;
    const sing = singularizePathSegment(base.replace(/-/g, ''));
    const baseNoHyphen = base.replace(/-/g, '');

    for (const alias of SEGMENT_ENTITY_ALIASES[base] ?? []) {
      if (entityMap.has(alias)) return alias;
    }

    for (const name of names) {
      const nl = name.toLowerCase();
      const ncompact = nl.replace(/_/g, '').replace(/-/g, '');
      if (base === nl || sing === nl || baseNoHyphen === ncompact || sing === ncompact) return name;
      if (nl.startsWith(sing) && sing.length >= 3) return name;
      if (sing.startsWith(nl) && nl.length >= 3) return name;
      if (baseNoHyphen.startsWith(nl) && nl.length >= 4) return name;
      if (ncompact === baseNoHyphen) return name;
    }
  }

  // Heurística fallback: prioridad a entidades que sugieren búsqueda o son muy ricas en campos
  const searchCandidates = names.filter(n => /search|filter|metadata/i.test(n));
  for (const n of searchCandidates) {
    const fields = entityMap.get(n);
    if (fields && Object.keys(fields).length >= 10) return n;
  }

  // Si no hay candidatos de búsqueda claros, coger el que tenga MÁS campos (el más rico)
  let best: string | undefined;
  let maxFields = 0;
  for (const [name, fields] of entityMap.entries()) {
    const count = Object.keys(fields).length;
    if (count >= 10 && count > maxFields) {
      maxFields = count;
      best = name;
    }
  }
  return best;
}

function inferParametersFromDocumentation(
  method: string,
  expressPath: string,
  docEntities: Map<string, Record<string, Record<string, unknown>>>
): Record<string, unknown> | undefined {
  if (docEntities.size === 0) return undefined;
  const m = method.toLowerCase();

  const entityName = matchDocumentationEntityForPath(expressPath, docEntities);
  if (!entityName) return undefined;

  const block = docEntities.get(entityName);
  if (!block || Object.keys(block).length === 0) return undefined;

  const pathNames = collectPathParamNamesFromExpress(expressPath);
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(block)) {
    if (key.startsWith('_') || pathNames.has(key)) continue;
    out[key] = spec;
  }
  if (Object.keys(out).length === 0) return undefined;

  if (m === 'post' || m === 'put' || m === 'patch') {
    return out;
  }
  if (m === 'get' || m === 'head' || m === 'delete') {
    return out;
  }
  return undefined;
}

/** La documentación es la fuente de verdad: pisa parámetros genéricos del JSON de endpoints (p. ej. name, description). */
function mergeParameterRecords(
  fromDoc: Record<string, unknown> | undefined,
  fromEndpoints: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!fromDoc || Object.keys(fromDoc).length === 0) return fromEndpoints;
  if (!fromEndpoints || Object.keys(fromEndpoints).length === 0) return fromDoc;
  return { ...fromEndpoints, ...fromDoc };
}

function collectPathParamNamesFromExpress(expressPath: string): Set<string> {
  const s = new Set(pathParamNamesFromOpenApiPath(expressPathToOpenAPI(expressPath)));
  let m: RegExpExecArray | null;
  const re = /:([A-Za-z0-9_]+)/g;
  while ((m = re.exec(expressPath)) !== null) {
    s.add(m[1]);
  }
  return s;
}

function isZeusFieldRequired(spec: unknown): boolean {
  return !!(spec && typeof spec === 'object' && !Array.isArray(spec) && (spec as Record<string, unknown>).required === true);
}

function zeusFieldDescription(spec: unknown): string | undefined {
  if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
    const d = (spec as Record<string, unknown>).description;
    if (typeof d === 'string' && d.trim()) return d.trim();
  }
  return undefined;
}

function openApiSchemaFromZeusField(spec: unknown): Record<string, unknown> {
  if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
    const o = spec as Record<string, unknown>;
    const t = String(o.type ?? 'string').toLowerCase();
    const fmt = typeof o.format === 'string' ? o.format : undefined;
    const withFormat = (s: Record<string, unknown>) => (fmt ? { ...s, format: fmt } : s);

    if (Array.isArray(o.enum) && o.enum.length > 0 && o.enum.every((x) => typeof x === 'string')) {
      return withFormat({ type: 'string', enum: o.enum as string[] });
    }
    if (t === 'integer' || t === 'int') return withFormat({ type: 'integer' });
    if (t === 'number' || t === 'float' || t === 'double') return withFormat({ type: 'number' });
    if (t === 'boolean' || t === 'bool') return withFormat({ type: 'boolean' });
    if (t === 'array') {
      const it = String(o.itemsType ?? 'string').toLowerCase();
      const item =
        it === 'integer' || it === 'int'
          ? { type: 'integer' }
          : it === 'number' || it === 'float' || it === 'double'
            ? { type: 'number' }
            : it === 'boolean' || it === 'bool'
              ? { type: 'boolean' }
              : it === 'object'
                ? { type: 'object' }
                : { type: 'string' };
      return { type: 'array', items: item };
    }
    if (t === 'object') return { type: 'object' };
    return withFormat({ type: 'string' });
  }
  return { type: 'string' };
}

/** Query opcionales típicos de listados (GET sin `:param` en la ruta). No pisan claves ya definidas en Zeus. */
const DEFAULT_GET_LIST_QUERY_PARAMS: Array<{
  name: string;
  schema: Record<string, unknown>;
  description: string;
}> = [
  {
    name: 'page',
    schema: { type: 'integer', minimum: 1, default: 1 },
    description: 'Número de página (empieza en 1)'
  },
  {
    name: 'limit',
    schema: { type: 'integer', minimum: 1, maximum: 500, default: 20 },
    description: 'Cuántos ítems devolver por página'
  },
  {
    name: 'offset',
    schema: { type: 'integer', minimum: 0, default: 0 },
    description: 'Desplazamiento alternativo a page/limit (índice base 0)'
  },
  {
    name: 'search',
    schema: { type: 'string' },
    description: 'Texto de búsqueda / filtro libre'
  },
  {
    name: 'sortBy',
    schema: { type: 'string' },
    description: 'Campo por el que ordenar'
  },
  {
    name: 'sortOrder',
    schema: { type: 'string', enum: ['asc', 'desc'] },
    description: 'asc = ascendente, desc = descendente'
  }
];

const DEFAULT_LIST_QUERY_PARAM_NAMES = new Set(DEFAULT_GET_LIST_QUERY_PARAMS.map((x) => x.name));

/**
 * Parámetros OpenAPI para esta operación: exactos por método; si faltan, herencia entre verbos del mismo path.
 * POST/PUT/PATCH pueden tomar campos de body del registro GET del mismo path (excl. filtros de listado).
 */
function pickParametersForOperation(
  method: string,
  expressPath: string,
  endpointsByRoute?: Map<string, ZeusEndpointRecord>
): Record<string, unknown> | undefined {
  if (!endpointsByRoute?.size) return undefined;
  const m = method.toLowerCase();
  let exact: ZeusEndpointRecord | undefined;
  for (const key of routeLookupKeyVariants(method, expressPath)) {
    exact = endpointsByRoute.get(key);
    if (exact) break;
  }
  if (exact?.parameters && Object.keys(exact.parameters).length > 0) {
    return exact.parameters;
  }

  const pk = canonicalPathForEndpointMatching(expressPath);
  const siblings = Array.from(endpointsByRoute.values()).filter(
    (r) => canonicalPathForEndpointMatching(r.path) === pk
  );
  if (siblings.length === 0) return undefined;

  const pathNames = collectPathParamNamesFromExpress(expressPath);

  const sameMethod = siblings.find((r) => r.method.trim().toLowerCase() === m);
  if (sameMethod?.parameters && Object.keys(sameMethod.parameters).length > 0) {
    return sameMethod.parameters;
  }

  if (m === 'post' || m === 'put' || m === 'patch') {
    const bodySibling = siblings.find(
      (r) =>
        ['post', 'put', 'patch'].includes(r.method.trim().toLowerCase()) &&
        r.parameters &&
        Object.keys(r.parameters).length > 0
    );
    if (bodySibling?.parameters) return bodySibling.parameters;

    const getRec = siblings.find(
      (r) =>
        (r.method.trim().toLowerCase() === 'get' || r.method.trim().toLowerCase() === 'head') &&
        r.parameters &&
        Object.keys(r.parameters).length > 0
    );
    if (getRec?.parameters) {
      const body: Record<string, unknown> = {};
      for (const [k, spec] of Object.entries(getRec.parameters)) {
        if (k.startsWith('_') || pathNames.has(k)) continue;
        if (DEFAULT_LIST_QUERY_PARAM_NAMES.has(k)) continue;
        body[k] = spec;
      }
      if (Object.keys(body).length > 0) return body;
    }
  }

  if (m === 'get' || m === 'head' || m === 'delete') {
    const qSibling = siblings.find(
      (r) =>
        ['get', 'head', 'delete'].includes(r.method.trim().toLowerCase()) &&
        r.parameters &&
        Object.keys(r.parameters).length > 0
    );
    if (qSibling?.parameters) return qSibling.parameters;
  }

  return undefined;
}

function appendDefaultGetListQueryParams(op: OaOp, method: string, expressPath: string): void {
  const m = method.toLowerCase();
  if (m !== 'get' && m !== 'head' && m !== 'delete') return;
  if (collectPathParamNamesFromExpress(expressPath).size > 0) return;

  const existing = new Set(
    (op.parameters ?? []).map((p) => {
      const o = p as Record<string, unknown>;
      return `${String(o.in)}:${String(o.name)}`;
    })
  );

  const extra: Array<Record<string, unknown>> = [];
  for (const row of DEFAULT_GET_LIST_QUERY_PARAMS) {
    const k = `query:${row.name}`;
    if (existing.has(k)) continue;
    existing.add(k);
    extra.push({
      in: 'query',
      name: row.name,
      required: false,
      description: row.description,
      schema: row.schema
    });
  }
  if (extra.length > 0) {
    op.parameters = [...(op.parameters ?? []), ...extra];
  }
}

function appendSwaggerJSDocSchemaLines(lines: string[], schema: Record<string, unknown>, linePrefix: string): void {
  const t = String(schema.type ?? 'string');
  lines.push(`${linePrefix}type: ${t}`);
  if (typeof schema.minimum === 'number') {
    lines.push(`${linePrefix}minimum: ${schema.minimum}`);
  }
  if (typeof schema.maximum === 'number') {
    lines.push(`${linePrefix}maximum: ${schema.maximum}`);
  }
  if (schema.default !== undefined && (typeof schema.default === 'number' || typeof schema.default === 'string')) {
    lines.push(`${linePrefix}default: ${schema.default}`);
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    lines.push(`${linePrefix}enum:`);
    for (const ev of schema.enum) {
      lines.push(`${linePrefix}  - ${JSON.stringify(ev)}`);
    }
  }
}

function appendDefaultGetListQueryParamsToSwaggerJSDoc(
  lines: string[],
  method: string,
  expressPath: string,
  zeusParameters?: Record<string, unknown>
): void {
  const m = method.toLowerCase();
  if (m !== 'get' && m !== 'head' && m !== 'delete') return;
  if (collectPathParamNamesFromExpress(expressPath).size > 0) return;

  const zeusKeys = new Set(
    Object.keys(zeusParameters ?? {}).filter((k) => !k.startsWith('_'))
  );

  let opened = lines.some((l) => l.trim() === '*     parameters:');
  const sp = ' *           ';

  for (const row of DEFAULT_GET_LIST_QUERY_PARAMS) {
    if (zeusKeys.has(row.name)) continue;
    if (!opened) {
      lines.push(' *     parameters:');
      opened = true;
    }
    lines.push(
      ' *       - in: query',
      ` *         name: ${row.name}`,
      ' *         required: false',
      ` *         description: ${JSON.stringify(row.description)}`,
      ' *         schema:'
    );
    appendSwaggerJSDocSchemaLines(lines, row.schema, sp);
  }
}

/**
 * Enriquece una operación OpenAPI con parameters / requestBody del JSON de endpoints Zeus.
 */
function mergeZeusParametersIntoOp(
  op: OaOp,
  method: string,
  expressPath: string,
  parameters: Record<string, unknown> | undefined
): void {
  if (!parameters || typeof parameters !== 'object') return;

  const pathNames = collectPathParamNamesFromExpress(expressPath);
  const m = method.toLowerCase();
  const existingParamKeys = new Set(
    (op.parameters ?? []).map((p) => `${String(p.in)}:${String(p.name)}`)
  );

  const queryParams: Array<Record<string, unknown>> = [];
  const bodyProps: Record<string, Record<string, unknown>> = {};
  const bodyRequired: string[] = [];

  for (const [key, spec] of Object.entries(parameters)) {
    if (key.startsWith('_')) continue;
    if (pathNames.has(key)) {
      const pList = op.parameters ?? [];
      const existing = pList.find((p) => p.in === 'path' && p.name === key) as
        | Record<string, unknown>
        | undefined;
      const desc = zeusFieldDescription(spec);
      const schema = openApiSchemaFromZeusField(spec);
      if (existing) {
        if (desc) existing.description = desc;
        existing.schema = schema;
      } else {
        op.parameters = pList;
        op.parameters.push({
          in: 'path',
          name: key,
          required: true,
          description: desc || `Identificador ${key}`,
          schema
        });
      }
      continue;
    }

    if (m === 'get' || m === 'head' || m === 'delete') {
      const qk = `query:${key}`;
      if (existingParamKeys.has(qk)) continue;
      existingParamKeys.add(qk);
      const desc = zeusFieldDescription(spec);
      queryParams.push({
        in: 'query',
        name: key,
        required: isZeusFieldRequired(spec),
        ...(desc ? { description: desc } : {}),
        schema: openApiSchemaFromZeusField(spec)
      });
    } else if (m === 'post' || m === 'put' || m === 'patch') {
      const multipart =
        op.requestBody &&
        typeof op.requestBody === 'object' &&
        (op.requestBody as Record<string, unknown>).content &&
        typeof (op.requestBody as { content: Record<string, unknown> }).content['multipart/form-data'] === 'object';
      if (multipart) continue;
      bodyProps[key] = openApiSchemaFromZeusField(spec);
      if (isZeusFieldRequired(spec)) bodyRequired.push(key);
    }
  }

  if (queryParams.length > 0) {
    op.parameters = [...(op.parameters ?? []), ...queryParams];
  }

  if (
    (m === 'post' || m === 'put' || m === 'patch') &&
    Object.keys(bodyProps).length > 0 &&
    !(
      op.requestBody &&
      typeof op.requestBody === 'object' &&
      (op.requestBody as Record<string, unknown>).content &&
      typeof (op.requestBody as { content: Record<string, unknown> }).content['multipart/form-data'] === 'object'
    )
  ) {
    const bodySchema = {
      type: 'object' as const,
      properties: bodyProps,
      ...(bodyRequired.length > 0 ? { required: bodyRequired } : {})
    };
    op.requestBody = {
      required: bodyRequired.length > 0,
      content: {
        'multipart/form-data': { schema: { ...bodySchema } }
      }
    };
  }
}

function appendZeusQueryParamsToSwaggerJSDoc(
  lines: string[],
  method: string,
  parameters: Record<string, unknown> | undefined,
  pathNames: Set<string>
): void {
  const m = method.toLowerCase();
  if (!(m === 'get' || m === 'head' || m === 'delete') || !parameters) return;

  let opened = lines.some((l) => l.trim() === '*     parameters:');

  for (const [key, spec] of Object.entries(parameters)) {
    if (key.startsWith('_') || pathNames.has(key)) continue;
    if (!opened) {
      lines.push(' *     parameters:');
      opened = true;
    }
    const req = isZeusFieldRequired(spec);
    const desc = zeusFieldDescription(spec);
    const schema = openApiSchemaFromZeusField(spec);
    const t = String(schema.type ?? 'string');
    lines.push(
      ' *       - in: query',
      ` *         name: ${key}`,
      ...(req ? [' *         required: true'] : []),
      ...(desc ? [` *         description: ${JSON.stringify(desc)}`] : []),
      ' *         schema:',
      ` *           type: ${t}`
    );
  }
}

function appendZeusJsonRequestBodyToSwaggerJSDoc(
  lines: string[],
  method: string,
  parameters: Record<string, unknown> | undefined,
  pathNames: Set<string>
): void {
  const m = method.toLowerCase();
  if (!(m === 'post' || m === 'put' || m === 'patch') || !parameters) return;

  const entries = Object.entries(parameters).filter(([k]) => !k.startsWith('_') && !pathNames.has(k));
  if (entries.length === 0) return;

  const required = entries.filter(([, spec]) => isZeusFieldRequired(spec)).map(([k]) => k);

  lines.push(
    ' *     requestBody:',
    ` *       required: ${required.length > 0}`,
    ' *       content:',
    ' *         multipart/form-data:',
    ' *           schema:',
    ' *             type: object',
    ' *             properties:'
  );
  for (const [key, spec] of entries) {
    const t = String(openApiSchemaFromZeusField(spec).type ?? 'string');
    lines.push(` *               ${key}:`, ` *                 type: ${t}`);
  }
  if (required.length > 0) {
    lines.push(' *             required:');
    for (const k of required) {
      lines.push(` *               - ${k}`);
    }
  }
}

/** Heurística: POST/PUT/PATCH típico de subida de archivos. */
function routeSuggestsFileUpload(method: string, expressPath: string): boolean {
  const m = method.toLowerCase();
  if (m !== 'post' && m !== 'put' && m !== 'patch') return false;
  const p = expressPath.toLowerCase();
  return /\b(upload|image|imagen|archivo|file|avatar|photo|foto|adjunt|attach|media)\b/.test(p);
}

function swaggerTagFromTitle(title: string): string {
  const t = title.replace(/\r?\n/g, ' ').trim().slice(0, 64);
  return t || 'API';
}

/** Tras el registro de la ruta suele ir el middleware multer (upload.single, etc.). */
function routeHandlerUsesMulterMiddleware(code: string, routeIndex: number): boolean {
  const snippet = code.slice(routeIndex, Math.min(code.length, routeIndex + 1600));
  return (
    /\bupload\.(?:single|array|fields)\s*\(/.test(snippet) ||
    /\bmulter\(\)[\s\S]{0,120}\.(?:single|array|fields)\s*\(/.test(snippet)
  );
}

/**
 * Detecta rutas Express habituales (comillas, plantillas sin ${}, app.route().get(), *Router).
 */
export function extractExpressRoutesFromCode(code: string): ExpressRouteProbe[] {
  const seen = new Set<string>();
  const out: ExpressRouteProbe[] = [];

  const push = (method: string, pathRaw: string) => {
    const p = pathRaw.trim();
    if (!p) return;
    const m = method.toLowerCase();
    const k = `${m}:${p}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ method: m, path: p });
  };

  const meth = 'get|post|put|delete|patch';
  const recv = '(?:app|router|[A-Za-z_$][\\w]*(?:Router|router))';

  const reQuoted = new RegExp(`\\b${recv}\\s*\\.\\s*(${meth})\\s*\\(\\s*['"]([^'"]+)['"]`, 'gis');
  let m: RegExpExecArray | null;
  while ((m = reQuoted.exec(code)) !== null) {
    push(m[1], m[2]);
  }

  const reTmpl = new RegExp(`\\b${recv}\\s*\\.\\s*(${meth})\\s*\\(\\s*\`([^\`]*?)\``, 'gis');
  while ((m = reTmpl.exec(code)) !== null) {
    if (m[2].includes('${')) continue;
    push(m[1], m[2]);
  }

  const reRoute = new RegExp(
    `\\b${recv}\\s*\\.\\s*route\\s*\\(\\s*['"]([^'"]+)['"]\\s*\\)\\s*\\.\\s*(${meth})\\s*\\(`,
    'gis'
  );
  while ((m = reRoute.exec(code)) !== null) {
    push(m[2], m[1]);
  }

  // Detectar rutas en Router exportado (common en Zeus)
  const reRouterExport = /export\s+(?:const|let|var)\s+(\w+)\s*=\s*express\.Router\(\)/;
  const routerExportMatch = reRouterExport.exec(code);
  if (routerExportMatch) {
    const routerName = routerExportMatch[1];
    const reRouterUse = new RegExp(`\\b${routerName}\\s*\\.\\s*(${meth})\\s*\\(\\s*['"]([^'"]+)['"]`, 'gis');
    while ((m = reRouterUse.exec(code)) !== null) {
      push(m[1], m[2]);
    }
  }

  return out;
}

function buildOpenApiPathsFromRoutes(
  routes: ExpressRouteProbe[],
  title: string,
  endpointsByRoute?: Map<string, ZeusEndpointRecord>,
  docEntities?: Map<string, Record<string, Record<string, unknown>>>
): Record<string, Record<string, OaOp>> {
  const byPath = new Map<string, Map<string, OaOp>>();
  const tag = swaggerTagFromTitle(title);

  for (const r of routes) {
    const p = expressPathToOpenAPI(r.path);
    if (!p) continue;
    if (!byPath.has(p)) byPath.set(p, new Map());
    const methods = byPath.get(p)!;
    if (methods.has(r.method)) continue;

    const status =
      r.method === 'post' ? '201' : r.method === 'delete' ? '204' : '200';
    const desc =
      r.method === 'delete' ? 'No content' : r.method === 'post' ? 'Created' : 'OK';
    const responses: Record<string, { description: string }> = {
      [status]: { description: desc }
    };
    if (r.method === 'post') {
      responses['200'] = { description: 'OK' };
    }

    const meta = resolveEndpointRecordForRoute(r.method, r.path, endpointsByRoute);
    const zeusParams = mergeParameterRecords(
      inferParametersFromDocumentation(r.method, r.path, docEntities ?? new Map()),
      pickParametersForOperation(r.method, r.path, endpointsByRoute)
    );
    const summaryFromMeta =
      meta?.description && meta.description.trim()
        ? `${title}: ${meta.description.trim()}`.slice(0, 220)
        : `${title}: ${r.method.toUpperCase()} ${p}`;

    const op: OaOp = {
      tags: [tag],
      summary: summaryFromMeta,
      description: meta?.description?.trim()
        ? meta.description.trim()
        : `Operación ${r.method.toUpperCase()} sobre ${p}`,
      responses
    };

    const paramNames = pathParamNamesFromOpenApiPath(p);
    if (paramNames.length > 0) {
      op.parameters = paramNames.map((name) => ({
        in: 'path',
        name,
        required: true,
        description: `Identificador ${name}`,
        schema: { type: 'string' }
      }));
    }

    if (routeSuggestsFileUpload(r.method, r.path)) {
      op.requestBody = {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['file'],
              properties: {
                file: {
                  type: 'string',
                  format: 'binary',
                  description: 'Archivo (imagen u otro)'
                }
              }
            }
          }
        }
      };
    }

    mergeZeusParametersIntoOp(op, r.method, r.path, zeusParams);
    appendDefaultGetListQueryParams(op, r.method, r.path);

    methods.set(r.method, op);
  }

  const out: Record<string, Record<string, OaOp>> = {};
  for (const [p, mm] of byPath) {
    out[p] = {};
    for (const [method, op] of mm) {
      out[p][method] = op;
    }
  }
  return out;
}

/**
 * Serializa `paths` con saltos de línea e indentación para api.ts (evita una línea ilegible de miles de caracteres).
 */
function formatSwaggerPathsObjectLiteral(pathsObj: Record<string, Record<string, OaOp>>): string {
  return JSON.stringify(pathsObj, null, 2)
    .split('\n')
    .map((line) => '      ' + line)
    .join('\n');
}

/**
 * Sustituye el valor de `paths` en definition o lo añade antes del cierre.
 * Así se corrigen definiciones con solo 2 operaciones aunque ya exista la clave `paths`.
 */
function replaceOrInjectPathsInSwaggerDefinition(
  code: string,
  pathsObj: Record<string, Record<string, OaOp>>
): string {
  if (Object.keys(pathsObj).length === 0) {
    return code;
  }

  const sw = /\bswaggerOptions\s*=\s*\{/.exec(code);
  if (!sw) {
    return code;
  }

  const from = sw.index;
  const tail = code.slice(from);
  const def = /\bdefinition\s*:\s*\{/.exec(tail);
  if (!def) {
    return code;
  }

  const openBrace = from + def.index + def[0].length - 1;
  const closeIdx = findMatchingBrace(code, openBrace);
  if (closeIdx === -1) {
    return code;
  }

  const innerStart = openBrace + 1;
  const inner = code.slice(innerStart, closeIdx);
  const pathsKw = /\bpaths\s*:/.exec(inner);
  if (pathsKw && pathsKw.index !== undefined) {
    const searchFrom = innerStart + pathsKw.index;
    const afterPaths = code.slice(searchFrom, closeIdx);
    const braceRel = afterPaths.indexOf('{');
    if (braceRel !== -1) {
      const absPathsObjOpen = searchFrom + braceRel;
      const absPathsObjClose = findMatchingBrace(code, absPathsObjOpen);
      if (absPathsObjClose !== -1) {
        return (
          code.slice(0, searchFrom) +
          'paths:\n' +
          formatSwaggerPathsObjectLiteral(pathsObj) +
          code.slice(absPathsObjClose + 1)
        );
      }
    }
  }

  // No hay clave paths, inyectar antes del cierre de definition
  return (
    code.slice(0, closeIdx) +
    ',\n    paths:\n' +
    formatSwaggerPathsObjectLiteral(pathsObj) +
    code.slice(closeIdx)
  );
}

/**
 * Inyecta toda la configuración de Swagger si no existe en el código.
 * Esto es necesario cuando la IA genera código sin swaggerOptions.
 */
function injectFullSwaggerConfiguration(
  code: string,
  title: string,
  description: string,
  pathsObj: Record<string, Record<string, OaOp>>
): string {
  // Si ya tiene swaggerOptions o swaggerSpec declarados como variables, no hacer nada
  const hasSwaggerOptions = /\b(?:const|let|var)\s+swaggerOptions\s*=/.test(code);
  const hasSwaggerSpec = /\b(?:const|let|var)\s+swaggerSpec\s*=/.test(code);
  const hasOptions = /\b(?:const|let|var)\s+options\s*=/.test(code);
  
  // Si tiene swaggerSpec pero usa 'options' en lugar de 'swaggerOptions', reemplazarlo
  if (hasSwaggerSpec && hasOptions && !hasSwaggerOptions) {
    // Reemplazar "options" con "swaggerOptions"
    let modifiedCode = code.replace(/\bconst\s+options\s*=/g, 'const swaggerOptions =');
    modifiedCode = modifiedCode.replace(/\bconst\s+swaggerSpec\s*=\s*swaggerJsdoc\(options\)/g, 'const swaggerSpec = swaggerJsdoc(swaggerOptions)');
    
    // Buscar el bloque de definición para agregar paths
    const defMatch = /\bdefinition\s*:\s*\{/.exec(modifiedCode);
    if (defMatch) {
      const openBrace = defMatch.index + defMatch[0].length - 1;
      const closeIdx = findMatchingBrace(modifiedCode, openBrace);
      if (closeIdx !== -1) {
        const pathsPart =
          Object.keys(pathsObj).length > 0
            ? `,\n    paths:\n${formatSwaggerPathsObjectLiteral(pathsObj)}`
            : '';
        modifiedCode = modifiedCode.slice(0, closeIdx) + pathsPart + modifiedCode.slice(closeIdx);
      }
    } else {
      // No hay definition, reemplazar toda la configuración de swaggerOptions con una que tenga paths
      const swMatch = /\bswaggerOptions\s*=\s*\{/.exec(modifiedCode);
      if (swMatch) {
        const openBrace = swMatch.index + swMatch[0].length - 1;
        const closeIdx = findMatchingBrace(modifiedCode, openBrace);
        if (closeIdx !== -1) {
          const infoTitle = openapiInfoTitleLine(title);
          const safeDesc = escapeSingleQuoted(openApiInfoDescriptionPlainSummary(description));
          const pathsPart =
            Object.keys(pathsObj).length > 0
              ? `,\n    paths:\n${formatSwaggerPathsObjectLiteral(pathsObj)}`
              : '';
          const replacement = `{
  definition: {
    openapi: '3.0.0',
    info: {
      title: '${infoTitle}',
      version: '1.0.0',
      description: '${safeDesc}',
    },
    servers: [{ url: 'http://localhost:8745' }]${pathsPart}
  },
  apis: ['./runtime-api.ts'],
}`;
          modifiedCode = modifiedCode.slice(0, swMatch.index) + 'swaggerOptions = ' + replacement + modifiedCode.slice(closeIdx + 1);
        }
      }
    }
    
    return modifiedCode;
  }
  
  if (hasSwaggerOptions || hasSwaggerSpec) {
    return code;
  }

  // Buscar un buen lugar para inyectar la configuración de Swagger
  // Preferiblemente después de las imports y antes de las rutas
  const appMatch = /\bconst\s+app\s*=\s*express\(\)/.exec(code);
  if (!appMatch) {
    return code;
  }

  const insertPoint = appMatch.index + appMatch[0].length;
  const infoTitle = openapiInfoTitleLine(title);
  const safeDesc = escapeSingleQuoted(openApiInfoDescriptionPlainSummary(description));
  const pathsPart =
    Object.keys(pathsObj).length > 0
      ? `,\n    paths:\n${formatSwaggerPathsObjectLiteral(pathsObj)}`
      : '';

  const swaggerConfig = `

// Configuración de Swagger
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: '${infoTitle}',
      version: '1.0.0',
      description: '${safeDesc}',
    },
    servers: [{ url: 'http://localhost:8745' }]${pathsPart}
  },
  apis: ['./runtime-api.ts'],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { customCss: ".swagger-ui .info .title{font-size:1.5rem!important;line-height:1.3;font-weight:600}.swagger-ui .info .description{font-size:.875rem!important;line-height:1.55!important;max-width:56rem;color:#3b4151;font-weight:400}.swagger-ui .info .description p{margin:.45em 0}.swagger-ui .info .description ul,.swagger-ui .info .description ol{margin:.4em 0 .4em 1.15em}.swagger-ui .info .description h1,.swagger-ui .info .description h2,.swagger-ui .info .description h3,.swagger-ui .info .description h4{font-size:1rem!important;font-weight:600!important;margin:.7em 0 .35em!important;line-height:1.35!important}" }));

`;

  console.log('[injectFullSwaggerConfiguration] Injecting full Swagger configuration');
  return code.slice(0, insertPoint) + swaggerConfig + code.slice(insertPoint);
}

/**
 * Sustituye todo `definition: { ... }` bajo swaggerOptions por un OpenAPI mínimo válido.
 * Incluye `paths` derivados del código para que Swagger UI liste todos los endpoints aunque fallen los @swagger.
 */
function replaceSwaggerDefinitionBlock(
  code: string,
  title: string,
  description: string,
  pathsObj: Record<string, Record<string, OaOp>>
): string | null {
  if (!code.includes('swaggerOptions')) {
    return null;
  }

  const sw = /\bswaggerOptions\s*=\s*\{/.exec(code);
  if (!sw) {
    return null;
  }

  const from = sw.index;
  const tail = code.slice(from);
  const def = /\bdefinition\s*:\s*\{/.exec(tail);
  if (!def) {
    return null;
  }

  const openBrace = from + def.index + def[0].length - 1;
  const closeIdx = findMatchingBrace(code, openBrace);
  if (closeIdx === -1) {
    return null;
  }

  const startReplace = from + def.index;
  const infoTitle = openapiInfoTitleLine(title);
  const safeDesc = escapeSingleQuoted(openApiInfoDescriptionPlainSummary(description));
  // Siempre inyectar paths si hay rutas detectadas, independientemente de si swagger-jsdoc puede leer TypeScript
  const pathsPart =
    Object.keys(pathsObj).length > 0
      ? `,\n    paths:\n${formatSwaggerPathsObjectLiteral(pathsObj)}`
      : '';

  const replacement = `definition: {
    openapi: '3.0.0',
    info: {
      title: '${infoTitle}',
      version: '1.0.0',
      description: '${safeDesc}',
    },
    servers: [{ url: 'http://localhost:8743' }]${pathsPart}
  }`;

  return code.slice(0, startReplace) + replacement + code.slice(closeIdx + 1);
}

/**
 * Sustituye el objeto `info: { ... }` del bloque Swagger por uno seguro (reserva si no hay `definition`).
 */
export function sanitizeSwaggerInfoInGeneratedTs(code: string, title: string, description: string): string {
  if (!code || !code.includes('swaggerOptions')) {
    return code;
  }

  const swaggerIdx = code.search(/\bswaggerOptions\s*=/);
  const defIdx = swaggerIdx >= 0 ? code.indexOf('definition:', swaggerIdx) : code.indexOf('definition:');
  const searchFrom = defIdx >= 0 ? defIdx : 0;

  const re = /\binfo\s*:\s*\{/g;
  let m: RegExpExecArray | null;
  let openBrace = -1;
  re.lastIndex = 0;
  while ((m = re.exec(code)) !== null) {
    if (m.index >= searchFrom) {
      openBrace = m.index + m[0].length - 1;
      break;
    }
  }

  if (openBrace === -1) {
    const fallback = /\binfo\s*:\s*\{/.exec(code);
    if (!fallback) {
      return code;
    }
    openBrace = fallback.index + fallback[0].length - 1;
  }

  const closeIdx = findMatchingBrace(code, openBrace);
  if (closeIdx === -1) {
    return code;
  }

  const infoTitle = openapiInfoTitleLine(title);
  const safeDesc = escapeSingleQuoted(openApiInfoDescriptionPlainSummary(description));
  const replacement = `{\n      title: '${infoTitle}',\n      version: '1.0.0',\n      description: '${safeDesc}',\n    }`;

  return code.slice(0, openBrace) + replacement + code.slice(closeIdx + 1);
}

/** True si justo antes de la ruta hay un bloque `/** ... @swagger ... *\/` y solo espacios entre medias. */
function hasSwaggerCommentImmediatelyBefore(code: string, routeIndex: number): boolean {
  const before = code.slice(0, routeIndex);
  const lastOpen = before.lastIndexOf('/**');
  if (lastOpen === -1) return false;
  const closeIdx = code.indexOf('*/', lastOpen);
  if (closeIdx === -1 || closeIdx >= routeIndex) return false;
  const comment = code.slice(lastOpen, closeIdx + 2);
  if (!comment.includes('@swagger')) return false;
  const afterComment = code.slice(closeIdx + 2, routeIndex);
  return /^[\s\n\r]*$/.test(afterComment);
}

/**
 * swagger-jsdoc solo expone rutas con `@swagger`. Inserta bloques mínimos OpenAPI 3
 * delante de cada `app.*` / `router.*` que no tenga JSDoc inmediato.
 */
export function injectMissingSwaggerJSDocForExpressRoutes(
  code: string,
  title: string,
  endpointsByRoute?: Map<string, ZeusEndpointRecord>,
  docEntities?: Map<string, Record<string, Record<string, unknown>>>
): string {
  if (!code.includes('express') && !/\bapp\.(get|post)\b/.test(code)) {
    return code;
  }

  const meth = 'get|post|put|delete|patch';
  const recv = '(?:app|router|[A-Za-z_$][\\w]*(?:Router|router))';
  const matches: { method: string; path: string; index: number }[] = [];
  let m: RegExpExecArray | null;

  const reQuoted = new RegExp(`\\b${recv}\\s*\\.\\s*(${meth})\\s*\\(\\s*['"]([^'"]+)['"]`, 'gis');
  while ((m = reQuoted.exec(code)) !== null) {
    matches.push({ method: m[1].toLowerCase(), path: m[2], index: m.index });
  }

  const reTmpl = new RegExp(`\\b${recv}\\s*\\.\\s*(${meth})\\s*\\(\\s*\`([^\`]*?)\``, 'gis');
  while ((m = reTmpl.exec(code)) !== null) {
    if (m[2].includes('${')) continue;
    matches.push({ method: m[1].toLowerCase(), path: m[2], index: m.index });
  }

  let out = code;
  for (let i = matches.length - 1; i >= 0; i--) {
    const { method, path, index } = matches[i];
    if (hasSwaggerCommentImmediatelyBefore(out, index)) continue;

    const zeusParams = mergeParameterRecords(
      inferParametersFromDocumentation(method, path, docEntities ?? new Map()),
      pickParametersForOperation(method, path, endpointsByRoute)
    );
    const block = buildInjectedSwaggerJSDocBlock(method, path, title, out, index, zeusParams);
    out = out.slice(0, index) + block + out.slice(index);
  }

  return out;
}

/** Bloque @swagger listo para Swagger UI (tags, params, multipart si aplica). */
function buildInjectedSwaggerJSDocBlock(
  method: string,
  expressPath: string,
  title: string,
  code: string,
  routeIndex: number,
  zeusParameters?: Record<string, unknown>
): string {
  const oaPath = expressPathToOpenAPI(expressPath);
  const pathNames = collectPathParamNamesFromExpress(expressPath);
  const tag = swaggerTagFromTitle(title).replace(/:/g, '-');
  const summary = `${title} — ${method.toUpperCase()} ${expressPath}`.slice(0, 220);
  const defaultStatus = method === 'post' ? '201' : method === 'delete' ? '204' : '200';
  const lines: string[] = [
    '\n/**',
    ' * @swagger',
    ` * ${oaPath}:`,
    ` *   ${method}:`,
    ' *     tags:',
    ` *       - ${JSON.stringify(tag)}`,
    ` *     summary: ${JSON.stringify(summary)}`,
    ` *     description: ${JSON.stringify(`Operación ${method.toUpperCase()} en ${oaPath}`)}`
  ];

  const paramNames = pathParamNamesFromOpenApiPath(oaPath);
  if (paramNames.length > 0) {
    lines.push(' *     parameters:');
    for (const name of paramNames) {
      const spec = zeusParameters?.[name];
      const desc = spec ? zeusFieldDescription(spec) : undefined;
      const schema = spec ? openApiSchemaFromZeusField(spec) : { type: 'string' };
      const t = String(schema.type ?? 'string');
      lines.push(
        ' *       - in: path',
        ` *         name: ${name}`,
        ' *         required: true',
        ` *         description: ${JSON.stringify(desc || 'Identificador en la ruta')}`,
        ' *         schema:',
        ` *           type: ${t}`
      );
    }
  }

  appendZeusQueryParamsToSwaggerJSDoc(lines, method, zeusParameters, pathNames);
  appendDefaultGetListQueryParamsToSwaggerJSDoc(lines, method, expressPath, zeusParameters);

  const multipart =
    routeSuggestsFileUpload(method, expressPath) ||
    (codeUsesMulter(code) && routeHandlerUsesMulterMiddleware(code, routeIndex));

  if (!multipart) {
    appendZeusJsonRequestBodyToSwaggerJSDoc(lines, method, zeusParameters, pathNames);
  }

  if (multipart) {
    lines.push(
      ' *     requestBody:',
      ' *       required: true',
      ' *       content:',
      ' *         multipart/form-data:',
      ' *           schema:',
      ' *             type: object',
      ' *             required:',
      ' *               - file',
      ' *             properties:',
      ' *               file:',
      ' *                 type: string',
      ' *                 format: binary',
      ' *                 description: Archivo a subir'
    );
  }

  lines.push(
    ' *     responses:',
    ` *       ${defaultStatus}:`,
    ' *         description: Respuesta exitosa',
    ' */\n'
  );

  return lines.join('\n');
}

function ensureZodNamedImportHasZ(code: string): string {
  if (/import\s+\*\s+as\s+z\s+from\s+['"]zod['"]/.test(code)) {
    return code;
  }

  const namedImportRegex = /import\s*\{([^}]*)\}\s*from\s*['"]zod['"];?/;
  if (namedImportRegex.test(code)) {
    return code.replace(namedImportRegex, (_full, namesRaw: string) => {
      const names = namesRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      if (!names.includes('z')) {
        names.unshift('z');
      }

      const deduped = Array.from(new Set(names));
      return `import { ${deduped.join(', ')} } from 'zod';`;
    });
  }

  return insertAfterLeadingImports(code, "import { z } from 'zod';\n");
}

function patchZodTypeAnyRuntimeUsage(code: string): string {
  if (!/\bZodTypeAny\s*\./.test(code)) {
    return code;
  }

  let out = code.replace(/\bZodTypeAny\s*\./g, 'z.');
  out = ensureZodNamedImportHasZ(out);
  return out;
}

function patchMissingSchemaInferredTypes(code: string): string {
  const schemaToTypeMap = [
    { schema: 'LineContentSchema', typeName: 'LineContent' },
    { schema: 'CharacterRangeSchema', typeName: 'CharacterRange' }
  ];

  const aliasesToInsert: string[] = [];

  for (const item of schemaToTypeMap) {
    const typeUsageRe = new RegExp(`\\b${item.typeName}\\b`);
    const typeDeclRe = new RegExp(`\\b(?:type|interface|class|enum)\\s+${item.typeName}\\b`);
    const schemaDeclRe = new RegExp(`\\b(?:export\\s+)?const\\s+${item.schema}\\b`);

    if (!typeUsageRe.test(code)) continue;
    if (typeDeclRe.test(code)) continue;
    if (!schemaDeclRe.test(code)) continue;

    aliasesToInsert.push(`type ${item.typeName} = z.infer<typeof ${item.schema}>;`);
  }

  if (aliasesToInsert.length === 0) {
    return code;
  }

  let out = ensureZodNamedImportHasZ(code);
  out = insertAfterLeadingImports(out, `${aliasesToInsert.join('\n')}\n`);
  return out;
}

export function codeUsesMulter(code: string): boolean {
  return /\bfrom\s+['"]multer['"]/.test(code) || /\brequire\s*\(\s*['"]multer['"]\s*\)/.test(code);
}

export function codeUsesHelmet(code: string): boolean {
  return /\bfrom\s+['"]helmet['"]/.test(code) || /\brequire\s*\(\s*['"]helmet['"]\s*\)/.test(code);
}

export function codeUsesExpressRateLimit(code: string): boolean {
  return (
    /\bfrom\s+['"]express-rate-limit['"]/.test(code) ||
    /\brequire\s*\(\s*['"]express-rate-limit['"]\s*\)/.test(code)
  );
}

export function codeUsesUuid(code: string): boolean {
  return /\bfrom\s+['"]uuid['"]/.test(code) || /\brequire\s*\(\s*['"]uuid['"]\s*\)/.test(code);
}

/**
 * Añade al package.json del proyecto exportado las deps que el código importa (multer, helmet, etc.).
 */
export function mergeOptionalDependenciesFromApiCode(
  code: string,
  dependencies: Record<string, string>,
  devDependencies: Record<string, string>
): void {
  if (codeUsesMulter(code)) {
    dependencies.multer = '^1.4.5-lts.1';
    devDependencies['@types/multer'] = '^1.4.12';
  }
  if (codeUsesHelmet(code)) {
    dependencies.helmet = '^8.0.0';
  }
  if (codeUsesExpressRateLimit(code)) {
    dependencies['express-rate-limit'] = '^7.5.0';
  }
  if (codeUsesUuid(code)) {
    dependencies.uuid = '^11.0.0';
    devDependencies['@types/uuid'] = '^10.0.0';
  }
}

function hasExpressRequestInImports(code: string): boolean {
  const head = code.slice(0, Math.min(code.length, 12000));
  return (
    /\bimport\s+(?:type\s+)?\{[^}]*\bRequest\b[^}]*\}\s+from\s+['"]express['"]/.test(head) ||
    /\bimport\s+express\s*,\s*\{[^}]*\bRequest\b[^}]*\}\s+from\s+['"]express['"]/.test(head)
  );
}

/** Inserta bloque tras la secuencia inicial de `import` (y líneas en blanco / comentarios de línea). */
function insertAfterLeadingImports(code: string, insert: string): string {
  const lines = code.split('\n');
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const t = raw.trim();
    if (t === '' || t.startsWith('//')) {
      i++;
      continue;
    }
    if (t.startsWith('import ')) {
      i++;
      continue;
    }
    break;
  }
  const block = insert.endsWith('\n') ? insert : `${insert}\n`;
  lines.splice(i, 0, block);
  return lines.join('\n');
}

/**
 * Evita errores TS con multer: req.file, callbacks de diskStorage y falta de @types en el ZIP.
 */
export function patchMulterTypesInApiTs(code: string): string {
  if (!codeUsesMulter(code)) {
    return code;
  }

  let out = code;

  if (!/namespace\s+Express\s*\{[\s\S]*?interface\s+Request[\s\S]*?\bfile\??\s*:/.test(out)) {
    const reqImport = hasExpressRequestInImports(out) ? '' : "import type { Request } from 'express';\n\n";
    const aug = `${reqImport}declare global {\n  namespace Express {\n    interface Request {\n      file?: Express.Multer.File;\n    }\n  }\n}\n\n`;
    out = insertAfterLeadingImports(out, aug);
  }

  out = out.replace(
    /destination:\s*\(\s*req\s*,\s*file\s*,\s*cb\s*\)\s*=>/g,
    'destination: (req: Request, file: Express.Multer.File, cb: (err: Error | null, dest: string) => void) =>'
  );
  out = out.replace(
    /filename:\s*\(\s*req\s*,\s*file\s*,\s*cb\s*\)\s*=>/g,
    'filename: (req: Request, file: Express.Multer.File, cb: (err: Error | null, filename: string) => void) =>'
  );
  out = out.replace(
    /fileFilter:\s*\(\s*req\s*,\s*file\s*,\s*cb\s*\)\s*=>/g,
    'fileFilter: (req: Request, file: Express.Multer.File, cb: (err: Error | null | undefined, acceptFile?: boolean) => void) =>'
  );

  return out;
}

/**
 * swagger-jsdoc hace merge profundo de `definition.paths` con los @swagger; lodash.merge
 * mezcla arrays `parameters` por índice y deja la spec inválida o sin campos en Swagger UI.
 * Tras generar la spec, volvemos a aplicar parameters y requestBody desde definition.paths (Zeus).
 */
const ZEUS_SWAGGER_PATH_ENFORCER_FN = `function __zeusApplyDefinitionPathsToSwaggerSpec(spec: any, definition: any): any {
  const defPaths = definition && typeof definition === 'object' ? definition.paths : null;
  if (!defPaths || typeof defPaths !== 'object' || !spec || typeof spec !== 'object') return spec;
  if (!spec.paths || typeof spec.paths !== 'object') spec.paths = {};
  const verbs = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];
  for (const pathKey of Object.keys(defPaths)) {
    const defItem = (defPaths as Record<string, unknown>)[pathKey];
    if (!defItem || typeof defItem !== 'object') continue;
    const specItem = (spec.paths as Record<string, unknown>)[pathKey];
    if (!specItem || typeof specItem !== 'object') continue;
    for (const verb of verbs) {
      const defOp = (defItem as Record<string, unknown>)[verb];
      const specOp = (specItem as Record<string, unknown>)[verb];
      if (!defOp || typeof defOp !== 'object' || !specOp || typeof specOp !== 'object') continue;
      if (Array.isArray((defOp as { parameters?: unknown }).parameters)) {
        const dp = (defOp as { parameters: unknown[] }).parameters;
        if (dp.length > 0) (specOp as { parameters: unknown[] }).parameters = dp;
      }
      const defRb = (defOp as { requestBody?: unknown }).requestBody;
      if (
        defRb &&
        typeof defRb === 'object' &&
        defRb !== null &&
        typeof (defRb as { content?: unknown }).content === 'object' &&
        (defRb as { content: unknown }).content !== null
      ) {
        (specOp as { requestBody: unknown }).requestBody = defRb;
      }
    }
  }
  return spec;
}
`;

function injectSwaggerSpecZeusPathEnforcement(code: string): string {
  // No inyectar el enforcer de paths si no hay paths en la definición
  if (!code.includes('swaggerJsdoc') || code.includes('__zeusApplyDefinitionPathsToSwaggerSpec')) {
    return code;
  }
  // Verificar si hay paths en la definición antes de inyectar
  const defMatch = /\bdefinition\s*:\s*\{[\s\S]*?\bpaths\s*:/.exec(code);
  if (!defMatch) {
    return code;
  }
  const re = /\b(?:const|let)\s+swaggerSpec\s*=\s*swaggerJsdoc\s*\(\s*swaggerOptions\s*\)\s*;/;
  if (!re.test(code)) return code;
  const replacement = `${ZEUS_SWAGGER_PATH_ENFORCER_FN}\nconst swaggerSpec = __zeusApplyDefinitionPathsToSwaggerSpec(swaggerJsdoc(swaggerOptions), (swaggerOptions as { definition?: { paths?: unknown } }).definition);\n`;
  return code.replace(re, replacement);
}

/** Asegura que swagger-jsdoc escanee `api.ts` y patrones habituales del ZIP de Zeus. */
function patchSwaggerApisArray(code: string): string {
  const sw = code.search(/\bswaggerOptions\s*=/);
  if (sw === -1) return code;
  const tail = code.slice(sw);
  const apisMatch = /\bapis:\s*\[[^\]]*\]/.exec(tail);
  if (!apisMatch) return code;
  const idx = sw + apisMatch.index;
  const replacement = "apis: ['./runtime-api.ts']";
  return code.slice(0, idx) + replacement + code.slice(idx + apisMatch[0].length);
}

/** Limpia un string para que sea un identificador TypeScript válido (sin puntos, espacios, etc). */
export function sanitizeTsIdentifier(s: string): string {
  return s.replace(/[^a-zA-Z0-9_$]/g, '_').replace(/^(\d)/, '_$1');
}

/**
 * Asegura que la API tenga configurado CORS, use variables de entorno para PocketBase
 * y escuche en el puerto 3001.
 */
export function patchApiServerSetup(code: string): string {
  let out = code;

  // 1. Asegurar CORS
  if (out.includes('express()') && !out.includes('app.use(cors')) {
    const corsImport = out.includes("import cors from 'cors'") ? '' : "import cors from 'cors';\n";
    const corsUsage = "\napp.use(cors());\n";
    
    if (out.includes('app.use(express.json()')) {
      out = out.replace('app.use(express.json()', corsUsage + 'app.use(express.json()');
    } else {
      out = out.replace(/const\s+app\s*=\s*express\(\);?/, (match) => match + corsUsage);
    }
    
    if (corsImport) {
      out = insertAfterLeadingImports(out, corsImport);
    }
  }

  // 2. Asegurar URL dinámica de PocketBase (Zeus usa puertos aleatorios)
  // Reemplaza 'http://127.0.0.1:8090' o similares por variables de entorno
  out = out.replace(/['"]http:\/\/(?:127\.0\.0\.1|localhost):8090\/?['"]/g, "process.env.PB_URL || process.env.NEXT_PUBLIC_PB_URL || 'http://127.0.0.1:8090'");

  // 3. Asegurar Puerto 3001 para la API
  const portMatch = out.match(/\bport\s*=\s*(process\.env\.PORT\s*\|\|\s*)?(\d+)/i);
  if (portMatch) {
    const currentPort = portMatch[2];
    if (currentPort !== '3001') {
      out = out.replace(new RegExp(`\\bport\\s*=\\s*(process\\.env\\.PORT\\s*\\|\\|\\s*)?${currentPort}`, 'i'), 'port = process.env.PORT || 3001');
    }
  } else if (out.includes('app.listen(')) {
    // Si no hay variable port, pero hay app.listen
    if (!out.includes('const port =') && !out.includes('let port =')) {
      const listenMatch = out.match(/app\.listen\(\s*(\d+)/);
      if (listenMatch && listenMatch[1] !== '3001') {
        out = out.replace(/app\.listen\(\s*\d+/, 'app.listen(process.env.PORT || 3001');
      } else if (!listenMatch) {
        out = out.replace(/app\.listen\(/, 'app.listen(process.env.PORT || 3001, ');
      }
    }
  }

  return out;
}

export function sanitizeGeneratedApiTsCode(
  code: string,
  title: string,
  description: string,
  endpoints?: unknown,
  documentation?: unknown
): string {
  if (!code || !code.trim()) {
    return code;
  }


  // Reparar nombres de esquemas inválidos que el modelo a veces genera (ej: TaskFlowAPI1.5Schema -> TaskFlowAPI1_5Schema)
  let out = code;
  
  // Buscar patrones como "const Name.NumberSchema" o "type Name.Number ="
  out = out.replace(/\b(export\s+(?:const|type|interface|class)\s+)([a-zA-Z_$][a-zA-Z0-9._$]*)(Schema|)\b/g, (match, prefix, name, suffix) => {
    if (name.includes('.')) {
      const safeName = name.replace(/\./g, '_');
      return `${prefix}${safeName}${suffix}`;
    }
    return match;
  });

  // Reemplazar también las menciones de esos esquemas en el código (.parse, .infer, etc)
  // Este regex es agresivo pero necesario para limpiar los TaskFlowAPI1.5 que flotan por el código
  out = out.replace(/([a-zA-Z_$][a-zA-Z0-9_$]*)\.([0-9]+)([a-zA-Z0-9_$]*Schema)/g, '$1_$2$3');
  out = out.replace(/z\.infer<typeof\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\.([0-9]+)/g, 'z.infer<typeof $1_$2');

  const endpointRecords = parseZeusEndpointsMetadata(endpoints);
  const endpointsByRoute =
    endpointRecords.length > 0 ? indexEndpointsByRoute(endpointRecords) : undefined;

  const docEntities = buildDocumentationEntityFieldMap(normalizeZeusDocumentationField(documentation));

  const routes = extractExpressRoutesFromCode(out);
  const pathsObj = buildOpenApiPathsFromRoutes(routes, title, endpointsByRoute, docEntities);

  // Inyectar configuración completa de Swagger si no existe
  out = injectFullSwaggerConfiguration(out, title, description, pathsObj);

  const byDef = replaceSwaggerDefinitionBlock(out, title, description, pathsObj);
  if (byDef !== null) {
    out = byDef;
  } else {
    out = sanitizeSwaggerInfoInGeneratedTs(out, title, description);
    out = replaceOrInjectPathsInSwaggerDefinition(out, pathsObj);
  }
  out = patchSwaggerApisArray(out);
  out = injectMissingSwaggerJSDocForExpressRoutes(out, title, endpointsByRoute, docEntities);
  out = injectSwaggerSpecZeusPathEnforcement(out);
  out = patchSwaggerUiSetupForReadableInfo(out);
  out = patchMulterTypesInApiTs(out);
  out = patchZodTypeAnyRuntimeUsage(out);
  out = patchMissingSchemaInferredTypes(out);
  out = patchPocketBaseImportInApiTs(out);
  out = patchPocketBaseLegacySdkCallsInApiTs(out);
  out = patchApiServerSetup(out);
  return out;
}

/** Prepara el payload para la vista previa de Swagger, sanitizando el código y detectando dependencias. */
export function buildOpenApiPreviewPayload(
  code: string,
  title: string,
  description: string,
  endpoints?: any,
  documentation?: unknown
): { code: string; openapi: any; dependencies: Record<string, string> } {
  // 1) Sanitizar código (repara swagger-jsdoc y tipos)
  const sanitized = sanitizeGeneratedApiTsCode(code, title, description, endpoints, documentation);

  // 2) Misma especificación de paths que se inyecta en api.ts (endpoints JSON + Docs)
  const endpointRecords = parseZeusEndpointsMetadata(endpoints);
  const endpointsByRoute =
    endpointRecords.length > 0 ? indexEndpointsByRoute(endpointRecords) : undefined;
  const docEntities = buildDocumentationEntityFieldMap(normalizeZeusDocumentationField(documentation));
  const routes = extractExpressRoutesFromCode(sanitized);
  const pathsObj = buildOpenApiPathsFromRoutes(routes, title, endpointsByRoute, docEntities);

  const openapi = {
    openapi: '3.0.0',
    info: {
      title: openapiInfoTitleLine(title),
      description: openApiInfoDescriptionPlainSummary(description),
      version: '1.0.0'
    },
    servers: [{ url: 'http://localhost:8745' }],
    paths: pathsObj
  };

  // 3) Detectar dependencias opcionales
  const dependencies: Record<string, string> = {
    express: '^4.18.2',
    cors: '^2.8.5',
    'swagger-ui-express': '^5.0.0',
    'swagger-jsdoc': '^6.2.8'
  };
  mergeOptionalDependenciesFromApiCode(code, dependencies, {});

  return {
    code: sanitized,
    openapi,
    dependencies
  };
}
