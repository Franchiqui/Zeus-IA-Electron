import type { NextRequest } from 'next/server';
import {
    initPocketBase,
    getPocketBase,
    isPocketBaseInitialized,
    getPocketBaseUrl,
    ensureDevAdminIfConfigured
} from '../../lib/pocketbaseForGenerateApi';
import { buildProjectsApiCreateBody } from '../../lib/projectsApiPocketBase';

let NextResponse: any;
try {
  ({ NextResponse } = require('next/server'));
} catch {
  NextResponse = null;
}

function jsonResponse(body: any, init?: { status?: number }) {
  const status = init?.status ?? 200;
  if (NextResponse) {
    return NextResponse.json(body, { status });
  }
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function GET(request: NextRequest) {
  try {
    if (!isPocketBaseInitialized()) {
      await initPocketBase({
        url: await getPocketBaseUrl(),
        isAdmin: false,
      });
    }
    const pb = getPocketBase();

    // En modo desarrollo, usar autenticación por admin para evitar CORS
    const isDevelopment = process.env.NODE_ENV === 'development';

    if (isDevelopment) {
      const adminErr = await ensureDevAdminIfConfigured(pb, 'projects GET');
      if (adminErr) {
        return jsonResponse(
          { error: adminErr.error, details: adminErr.details },
          { status: adminErr.status }
        );
      }
      const projects = await pb.collection('projects_api').getFullList({
        sort: '-created',
      });
      return jsonResponse(projects);
    } else {
      // En producción, intentar Authorization header primero, luego cookies
      const authHeader = request.headers.get('Authorization');
      const token = authHeader?.split(' ')[1];

      if (token) {
        pb.authStore.save(token, null);
        try { await pb.collection('users').authRefresh(); } catch { pb.authStore.clear(); }
      }

      if (!pb.authStore.isValid || !pb.authStore.model) {
        pb.authStore.loadFromCookie(request.headers.get('cookie') || '');
      }

      if (!pb.authStore.isValid || !pb.authStore.model) {
        return jsonResponse(
          { error: 'No autorizado - usuario no autenticado' },
          { status: 401 }
        );
      }

      const userId = pb.authStore.model.id;

      const projects = await pb.collection('projects_api').getFullList({
        filter: `user_id = "${userId}"`,
        sort: '-created',
      });

      return jsonResponse(projects);
    }
  } catch (error: unknown) {
    console.error('Error loading projects from PocketBase:', error);
    const err = error as {
      status?: number;
      message?: string;
      data?: unknown;
      url?: string;
      originalError?: { data?: unknown };
    };
    const pbStatus =
      typeof err.status === 'number' && err.status >= 400 && err.status < 600 ? err.status : 500;
    const body = {
      error: 'Error loading projects',
      message: err.message || String(error),
      pocketbase: err.data ?? err.originalError?.data ?? null,
      url: err.url
    };
    return jsonResponse(body, { status: pbStatus >= 400 && pbStatus < 600 ? pbStatus : 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const projectData = (await request.json()) as Record<string, unknown>;
    
    if (!isPocketBaseInitialized()) {
      await initPocketBase({
        url: await getPocketBaseUrl(),
        isAdmin: false,
      });
    }
    const pb = getPocketBase();

    // En modo desarrollo, usar admin auth
    const isDevelopment = process.env.NODE_ENV === 'development';

    let userId: string | null = null;

    if (isDevelopment) {
      const adminErr = await ensureDevAdminIfConfigured(pb, 'projects POST');
      if (adminErr) {
        return jsonResponse(
          { error: adminErr.error, details: adminErr.details },
          { status: adminErr.status }
        );
      }
      userId = (typeof projectData.userId === 'string' ? projectData.userId : null) || null;
    } else {
      // En producción, usar cookies
      pb.authStore.loadFromCookie(request.headers.get('cookie') || '');

      if (!pb.authStore.isValid || !pb.authStore.model) {
        return jsonResponse(
          { error: 'No autorizado - usuario no autenticado' },
          { status: 401 }
        );
      }

      userId = pb.authStore.model.id;
    }

    console.log('📋 Creating project with data:', {
      title: projectData.title,
      description: projectData.description,
      hasCode: !!projectData.code,
      hasDocumentation: !!projectData.documentation,
      hasSchemas: !!projectData.schemas,
      hasEndpoints: !!projectData.endpoints,
      endpointsType: typeof projectData.endpoints,
      userId: userId
    });

    // Verificar que title y description no estén vacíos
    if (!projectData.title || !projectData.description) {
      console.error('❌ Missing required fields:', {
        title: projectData.title,
        description: projectData.description
      });
      throw new Error('Title and description are required');
    }

    const payload = buildProjectsApiCreateBody(projectData as Record<string, unknown>, userId);

    const newProject = await pb.collection('projects_api').create(payload);
    
    return jsonResponse(newProject, { status: 201 });
  } catch (error: any) {
    console.error('❌ Error creating project in PocketBase:', error);
    
    // Mostrar detalles del error si es un ClientResponseError de PocketBase
    if (error?.data) {
      console.error('❌ PocketBase error details:', {
        status: error.status,
        data: error.data,
        message: error.message,
        url: error.url
      });
    }
    
    return jsonResponse(
      { 
        error: 'Error creating project',
        details: error?.message || 'Unknown error',
        pbData: error?.data || null
      },
      { status: 500 }
    );
  }
}

export async function GET_EXPRESS(req: any, res: any): Promise<void> {
  const hdr = (name: string) => {
    const v = req.headers[name.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  };
  const fake = {
    headers: {
      get: (n: string) => {
        if (n === 'Authorization') return hdr('authorization');
        if (n === 'cookie') return hdr('cookie');
        return hdr(n);
      }
    }
  } as NextRequest;
  const r = await GET(fake);
  const data = await r.json();
  res.status(r.status).json(data);
}

export async function POST_EXPRESS(req: any, res: any): Promise<void> {
  const fake = {
    json: async () => req.body
  } as NextRequest;
  const r = await POST(fake);
  const data = await r.json();
  res.status(r.status).json(data);
}
