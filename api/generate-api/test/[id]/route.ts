import type { NextRequest } from 'next/server';
let NextResponse: any;
try {
  ({ NextResponse } = require('next/server'));
} catch {
  NextResponse = null;
}

function jsonResponse(body: any, init?: { status?: number; headers?: Record<string, string> }) {
  const status = init?.status ?? 200;
  const headers = init?.headers ?? {};
  if (NextResponse) {
    return NextResponse.json(body, { status, headers });
  }
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleTestRequest(request, id, 'POST');
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleTestRequest(request, id, 'GET');
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleTestRequest(request, id, 'PUT');
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleTestRequest(request, id, 'DELETE');
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleTestRequest(request, id, 'PATCH');
}

export async function HEAD(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleTestRequest(request, id, 'HEAD');
}

function setNested(target: Record<string, unknown>, dottedKey: string, value: unknown): void {
  const parts = String(dottedKey).split('.').filter(Boolean);
  if (parts.length === 0) return;
  let cur: Record<string, unknown> = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!cur[p] || typeof cur[p] !== 'object' || Array.isArray(cur[p])) {
      cur[p] = {};
    }
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

function coerceStringValue(v: string): unknown {
  const t = String(v ?? '').trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    try {
      return JSON.parse(t);
    } catch {
      return v;
    }
  }
  return v;
}

async function readRequestBodyAsObject(request: NextRequest): Promise<Record<string, unknown>> {
  const contentType = String(request.headers.get('content-type') || '').toLowerCase();

  if (contentType.includes('multipart/form-data')) {
    try {
      const form = await request.formData();
      const out: Record<string, unknown> = {};
      for (const [k, val] of form.entries()) {
        if (typeof val !== 'string') continue;
        if (k === 'payload') {
          try {
            const p = JSON.parse(val);
            if (p && typeof p === 'object' && !Array.isArray(p)) {
              Object.assign(out, p as Record<string, unknown>);
              continue;
            }
          } catch {
            // payload no era JSON válido; sigue flujo normal
          }
        }
        setNested(out, k, coerceStringValue(val));
      }
      return out;
    } catch {
      return {};
    }
  }

  try {
    const raw = await request.json();
    return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function handleTestRequest(request: NextRequest, endpointId: string, method: string) {
  try {
    let body: Record<string, unknown> = {};
    
    // Solo intentar parsear body si no es GET o HEAD
    if (method !== 'GET' && method !== 'HEAD') {
      body = await readRequestBodyAsObject(request);
    }
    
    if (body._method && body._path) {
      const targetMethod = String(body._method).toUpperCase();
      let targetPath = String(body._path);
      const baseUrl = 'http://localhost:8745';
      
      const bodyCopy = { ...body };
      delete bodyCopy._method;
      delete bodyCopy._path;
      
      // Extrae el payload real y parámetros adicionales
      let payloadContent: Record<string, unknown> = {};
      if (bodyCopy.payload && typeof bodyCopy.payload === 'object' && !Array.isArray(bodyCopy.payload)) {
        payloadContent = bodyCopy.payload as Record<string, unknown>;
        delete bodyCopy.payload;
      } else {
        payloadContent = bodyCopy;
      }
      
      // Resuelve variables de path
      targetPath = targetPath.replace(/\{([^}]+)\}/g, (match, p1) => {
        const val = bodyCopy[p1] !== undefined ? bodyCopy[p1] : payloadContent[p1];
        if (bodyCopy[p1] !== undefined) delete bodyCopy[p1];
        if (payloadContent[p1] !== undefined) delete payloadContent[p1];
        return encodeURIComponent(String(val ?? ''));
      });
      targetPath = targetPath.replace(/:([a-zA-Z0-9_]+)/g, (match, p1) => {
        const val = bodyCopy[p1] !== undefined ? bodyCopy[p1] : payloadContent[p1];
        if (bodyCopy[p1] !== undefined) delete bodyCopy[p1];
        if (payloadContent[p1] !== undefined) delete payloadContent[p1];
        return encodeURIComponent(String(val ?? ''));
      });

      const fetchOptions: RequestInit = {
        method: targetMethod,
        headers: {}
      };

      if (['GET', 'HEAD', 'DELETE'].includes(targetMethod)) {
        const qs = new URLSearchParams();
        // Agrega tanto lo que quedaba en formData como en payload (como string plano)
        const combined = { ...bodyCopy, ...payloadContent };
        for (const [k, v] of Object.entries(combined)) {
           if (v !== undefined && typeof v !== 'object') qs.append(k, String(v));
        }
        const qsStr = qs.toString();
        if (qsStr) targetPath += `?${qsStr}`;
      } else {
        (fetchOptions.headers as Record<string, string>)['Content-Type'] = 'application/json';
        fetchOptions.body = JSON.stringify(payloadContent);
      }

      try {
        const proxyRes = await fetch(`${baseUrl}${targetPath}`, fetchOptions);
        
        let resData;
        const contentType = proxyRes.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          resData = await proxyRes.json();
        } else {
          resData = await proxyRes.text();
        }

        return jsonResponse(resData, {
          status: proxyRes.status
        });
      } catch (err) {
        console.error('Error proxying to runtime API:', err);
        return jsonResponse({
          error: 'No se pudo conectar con la API en ejecución. Asegúrate de que la API esté iniciada (El puerto 3005 no responde).',
          details: err instanceof Error ? err.message : String(err)
        }, { status: 502 });
      }
    }
    
    // Fallback: mock response si no hay target method/path
    const testResponse = buildGenerateApiTestResponse(endpointId, body, method);

    const headers: Record<string, string> = {};
    Object.entries(testResponse.headers).forEach(([key, value]) => {
      if (value !== undefined) {
        headers[key] = String(value);
      }
    });

    return jsonResponse(testResponse.body, {
      status: testResponse.status,
      headers
    });
  } catch (error) {
    console.error('Error testing endpoint:', error);
    return jsonResponse(
      { error: 'Error testing endpoint', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * Respuestas del harness `/api/generate-api/test/:id` usado por el probador del panel Zeus.
 * Contrato estable para list / get / create / update / delete (no es un mock aleatorio: es la API de prueba oficial).
 */
function matchesHarnessList(id: string): boolean {
  return id === 'list' || /-list$/i.test(id);
}

function matchesHarnessGet(id: string): boolean {
  return id === 'get' || /-get$/i.test(id);
}

function matchesHarnessCreate(id: string): boolean {
  return id === 'create' || /-create$/i.test(id);
}

function matchesHarnessUpdate(id: string): boolean {
  return id === 'update' || /-update$/i.test(id);
}

function matchesHarnessDelete(id: string): boolean {
  return id === 'delete' || /-delete$/i.test(id);
}

function buildGenerateApiTestResponse(endpointId: string, body: Record<string, unknown>, method: string = 'POST') {
  const timestamp = new Date().toISOString();
  const m = (method || 'GET').toUpperCase();

  if (!endpointId) {
    return {
      status: 400,
      headers: {
        'content-type': 'application/json'
      },
      body: {
        error: 'Missing endpoint ID',
        message: 'No endpoint ID provided'
      }
    };
  }
  
  if (matchesHarnessList(endpointId)) {
    return {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-total-count': '10'
      },
      body: {
        data: [
          {
            id: '1',
            name: 'Example Item 1',
            description: 'This is an example item',
            createdAt: timestamp,
            updatedAt: timestamp
          },
          {
            id: '2',
            name: 'Example Item 2',
            description: 'Another example item',
            createdAt: timestamp,
            updatedAt: timestamp
          }
        ],
        pagination: {
          page: 1,
          limit: 10,
          total: 2,
          totalPages: 1
        }
      }
    };
  }
  
  if (matchesHarnessGet(endpointId)) {
    return {
      status: 200,
      headers: {
        'content-type': 'application/json'
      },
      body: {
        id: '1',
        name: 'Example Item',
        description: 'This is an example item retrieved by ID',
        createdAt: timestamp,
        updatedAt: timestamp
      }
    };
  }
  
  if (matchesHarnessCreate(endpointId)) {
    return {
      status: 201,
      headers: {
        'content-type': 'application/json',
        'location': '/api/v1/items/3'
      },
      body: {
        id: '3',
        name: body.name || 'New Item',
        description: body.description || 'New item description',
        createdAt: timestamp,
        updatedAt: timestamp
      }
    };
  }
  
  if (matchesHarnessUpdate(endpointId)) {
    return {
      status: 200,
      headers: {
        'content-type': 'application/json'
      },
      body: {
        id: '1',
        name: body.name || 'Updated Item',
        description: body.description || 'Updated description',
        createdAt: timestamp,
        updatedAt: timestamp
      }
    };
  }
  
  if (matchesHarnessDelete(endpointId)) {
    return {
      status: 200,
      headers: {
        'content-type': 'application/json'
      },
      body: {
        message: 'Item deleted successfully',
        id: body.id
      }
    };
  }
  
  // Endpoints del proyecto (id arbitrario): respuesta acorde al método HTTP real
  if (m === 'POST') {
    return {
      status: 201,
      headers: {
        'content-type': 'application/json'
      },
      body: {
        message: 'Recurso creado (simulación del harness Zeus)',
        endpointId,
        echo: body,
        timestamp
      }
    };
  }
  if (m === 'PUT' || m === 'PATCH') {
    return {
      status: 200,
      headers: {
        'content-type': 'application/json'
      },
      body: {
        message: 'Recurso actualizado (simulación del harness Zeus)',
        endpointId,
        echo: body,
        timestamp
      }
    };
  }
  if (m === 'DELETE') {
    return {
      status: 200,
      headers: {
        'content-type': 'application/json'
      },
      body: {
        message: 'Recurso eliminado (simulación del harness Zeus)',
        endpointId,
        receivedData: body,
        timestamp
      }
    };
  }

  return {
    status: 200,
    headers: {
      'content-type': 'application/json'
    },
    body: {
      message: 'Lectura simulada por el harness Zeus',
      endpointId,
      method: m,
      sample: {
        id: '1',
        note: 'Respuesta de prueba; despliega la API generada para usar la ruta real.'
      },
      timestamp
    }
  };
}

function expressHeaders(req: any) {
  return {
    get: (n: string) => {
      const key = n.toLowerCase();
      const v = req.headers[key];
      return Array.isArray(v) ? v[0] : v;
    }
  };
}

/** Express: cualquier método HTTP sobre `/api/generate-api/test/:id` */
export async function ANY_EXPRESS(req: any, res: any): Promise<void> {
  const method = (req.method || 'GET').toUpperCase();
  const id = req.params.id as string;
  const fake = {
    json: async () =>
      req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : {},
    headers: expressHeaders(req)
  } as NextRequest;
  const r = await handleTestRequest(fake, id, method);
  const data = await r.json();
  for (const [key, value] of r.headers.entries()) {
    if (key.toLowerCase() !== 'content-length') {
      res.setHeader(key, value);
    }
  }
  res.status(r.status).json(data);
}
