import type { NextRequest } from 'next/server';
import {
    initPocketBase,
    getPocketBase,
    isPocketBaseInitialized,
    getPocketBaseUrl,
    ensureDevAdminIfConfigured
} from '../../../lib/pocketbaseForGenerateApi';
import {
    normalizeEndpointsForProjectsApi,
    editorFieldForProjectsApi,
    getProjectsApiOwnerId
} from '../../../lib/projectsApiPocketBase';

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!isPocketBaseInitialized()) {
      await initPocketBase({
        url: await getPocketBaseUrl(),
        isAdmin: false,
      });
    }
    const pb = getPocketBase();

    const isDevelopment = process.env.NODE_ENV === 'development';

    if (isDevelopment) {
      try {
        await pb.admins.authWithPassword(
          process.env.POCKETBASE_ADMIN_EMAIL!,
          process.env.POCKETBASE_ADMIN_PASSWORD!
        );
      } catch (adminError) {
        console.error('❌ Admin auth failed in development (GET):', adminError);
        return jsonResponse({ error: 'Admin authentication failed' }, { status: 500 });
      }
      const project = await pb.collection('projects_api').getOne(id);
      return jsonResponse(project);
    }

    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.split(' ')[1];

    if (token) {
      pb.authStore.save(token, null);
      try {
        await pb.collection('users').authRefresh();
      } catch {
        pb.authStore.clear();
      }
    }

    if (!pb.authStore.isValid || !pb.authStore.model) {
      pb.authStore.loadFromCookie(request.headers.get('cookie') || '');
    }

    if (!pb.authStore.isValid || !pb.authStore.model) {
      return jsonResponse({ error: 'No autorizado - usuario no autenticado' }, { status: 401 });
    }

    const userId = pb.authStore.model.id;
    const project = await pb.collection('projects_api').getOne(id);
    const ownerId = getProjectsApiOwnerId(project as Record<string, unknown>);

    if (ownerId && ownerId !== userId) {
      return jsonResponse({ error: 'No autorizado' }, { status: 403 });
    }

    return jsonResponse(project);
  } catch (error: unknown) {
    const err = error as { status?: number };
    if (err?.status === 404) {
      return jsonResponse({ error: 'Proyecto no encontrado' }, { status: 404 });
    }
    console.error('Error loading project from PocketBase:', error);
    return jsonResponse({ error: 'Error loading project' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await request.json()) as Record<string, unknown>;

    if (!isPocketBaseInitialized()) {
      await initPocketBase({
        url: await getPocketBaseUrl(),
        isAdmin: false,
      });
    }
    const pb = getPocketBase();

    // En modo desarrollo, usar admin auth
    const isDevelopment = process.env.NODE_ENV === 'development';

    if (isDevelopment) {
      const adminErr = await ensureDevAdminIfConfigured(pb, 'project PUT');
      if (adminErr) {
        return jsonResponse(
          { error: adminErr.error, details: adminErr.details },
          { status: adminErr.status }
        );
      }
    }

    const payload: Record<string, unknown> = {};
    if (body.code !== undefined) {
      const v = editorFieldForProjectsApi(body.code);
      if (v !== undefined) payload.code = v;
    }
    if (body.documentation !== undefined) {
      const v = editorFieldForProjectsApi(body.documentation);
      if (v !== undefined) payload.documentation = v;
    }
    if (body.schemas !== undefined) {
      const v = editorFieldForProjectsApi(body.schemas);
      if (v !== undefined) payload.schemas = v;
    }
    if (body.endpoints !== undefined) {
      payload.endpoints = normalizeEndpointsForProjectsApi(body.endpoints);
    }
    if (body.title !== undefined) payload.title = body.title;
    if (body.description !== undefined) payload.description = body.description;

    console.log('📋 PUT request payload:', {
      id,
      payload,
      originalBody: body,
      payloadKeys: Object.keys(payload)
    });

    const result = await pb.collection('projects_api').update(id, payload);
    console.log('✅ Project updated in PocketBase local:', result.id);
    return jsonResponse(result);
  } catch (error) {
    console.error('Error updating project in PocketBase:', error);
    return jsonResponse(
      { error: 'Error updating project' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    if (!isPocketBaseInitialized()) {
      await initPocketBase({
        url: await getPocketBaseUrl(),
        isAdmin: false,
      });
    }
    const pb = getPocketBase();

    // Verificar autenticación del usuario
    pb.authStore.loadFromCookie(request.headers.get('cookie') || '');

    if (!pb.authStore.isValid || !pb.authStore.model) {
      return jsonResponse(
        { error: 'No autorizado - usuario no autenticado' },
        { status: 401 }
      );
    }

    const userId = pb.authStore.model.id;

    // Verificar que el proyecto pertenece al usuario
    try {
      const project = await pb.collection('projects_api').getOne(id);
      const ownerId = getProjectsApiOwnerId(project as Record<string, unknown>);
      if (ownerId && ownerId !== userId) {
        return jsonResponse(
          { error: 'No autorizado - no puedes eliminar este proyecto' },
          { status: 403 }
        );
      }
    } catch (projectError) {
      return jsonResponse(
        { error: 'Proyecto no encontrado' },
        { status: 404 }
      );
    }

    // Eliminar el registro de PocketBase local
    await pb.collection('projects_api').delete(id);
    
    return jsonResponse({ success: true });
  } catch (error) {
    console.error('Error deleting project in PocketBase:', error);
    return jsonResponse(
      { error: 'Error deleting project' },
      { status: 500 }
    );
  }
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

export async function GET_EXPRESS(req: any, res: any): Promise<void> {
  const fake = {
    headers: expressHeaders(req)
  } as NextRequest;
  const r = await GET(fake, { params: Promise.resolve({ id: req.params.id }) });
  const data = await r.json();
  res.status(r.status).json(data);
}

export async function PUT_EXPRESS(req: any, res: any): Promise<void> {
  const fake = {
    json: async () => req.body,
    headers: expressHeaders(req)
  } as NextRequest;
  const r = await PUT(fake, { params: Promise.resolve({ id: req.params.id }) });
  const data = await r.json();
  res.status(r.status).json(data);
}

export async function DELETE_EXPRESS(req: any, res: any): Promise<void> {
  const fake = {
    headers: expressHeaders(req)
  } as NextRequest;
  const r = await DELETE(fake, { params: Promise.resolve({ id: req.params.id }) });
  const data = await r.json();
  res.status(r.status).json(data);
}
