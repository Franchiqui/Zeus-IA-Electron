import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

// Interfaz para la solicitud de despliegue
interface DeployRequest {
  flyApiToken: string;
  pocketbaseEmail: string;
  pocketbasePassword: string;
  appName: string;
  region: string;
  memory: number; // en MB
  organizationId: string;
  pocketbaseVersion: string;
}

// Función para realizar llamadas a la API GraphQL de Fly.io
async function callFlyApi(token: string, query: string, variables: object) {
  const response = await fetch('https://api.fly.io/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  return response.json();
}

export async function POST(request: NextRequest) {
  try {
    const body: DeployRequest = await request.json();

    // 1. Validación de la entrada (mejorada)
    const requiredFields: (keyof DeployRequest)[] = ['flyApiToken', 'pocketbaseEmail', 'pocketbasePassword', 'appName', 'region', 'memory', 'organizationId', 'pocketbaseVersion'];
    for (const field of requiredFields) {
      if (!body[field]) {
        return NextResponse.json({ error: `El campo '${field}' es requerido.` }, { status: 400 });
      }
    }

    // 1.1 Preflight: validar token y obtener viewer + organizaciones
    const viewerQuery = `
      query Viewer {
        viewer {
          name
          email
        }
        organizations { nodes { id name slug } }
      }
    `;
    const viewerResponse = await callFlyApi(body.flyApiToken, viewerQuery, {});
    if (viewerResponse.errors) {
      return NextResponse.json(
        {
          error: 'No autorizado con Fly.io',
          details: viewerResponse.errors,
          suggestion: 'Verifica que tu Fly API Token sea válido y no esté expirado. En la CLI ejecuta: flyctl auth token (o flyctl auth signup/login y flyctl tokens create).'
        },
        { status: 401 }
      );
    }

    // 2. Resolver el ID y slug de la Organización (admite id, slug o name)
    let orgId = body.organizationId;
    let orgSlug: string | null = null;
    {
      const orgsQuery = `query { organizations { nodes { id name slug } } }`;
      const orgsResponse = await callFlyApi(body.flyApiToken, orgsQuery, {});
      if (orgsResponse.errors || !orgsResponse.data?.organizations?.nodes) {
        return NextResponse.json({ error: "Error al obtener las organizaciones de Fly.io", details: orgsResponse.errors }, { status: 400 });
      }
      const orgs: Array<{ id: string; name: string; slug: string }> = orgsResponse.data.organizations.nodes || [];
      const normalized = (orgId || 'personal').trim().toLowerCase();
      // Prioridad de matching: id exacto -> slug -> name
      const byId = orgs.find(o => o.id === orgId);
      const bySlug = orgs.find(o => o.slug.toLowerCase() === normalized);
      const byName = orgs.find(o => o.name.toLowerCase() === normalized);
      const match = byId || bySlug || byName || orgs.find(o => o.slug === 'personal');
      if (!match) {
        return NextResponse.json({
          error: `No se pudo resolver la organización '${body.organizationId}'.`,
          details: { provided: body.organizationId, available: orgs.map(o => ({ id: o.id, slug: o.slug, name: o.name })) },
          suggestion: "Usa el 'slug' o 'id' de una de tus organizaciones, por ejemplo: personal"
        }, { status: 404 });
      }
      orgId = match.id;
      orgSlug = match.slug;
    }

    // 3. Crear la aplicación en Fly.io
    const createAppMutation = `
      mutation($input: CreateAppInput!) {
        createApp(input: $input) { app { id name } }
      }`;
    const createAppVars = { input: { name: body.appName, organizationId: orgId } };
    const createAppResponse = await callFlyApi(body.flyApiToken, createAppMutation, createAppVars);

    if (createAppResponse.errors) {
      const raw = JSON.stringify(createAppResponse.errors).toLowerCase();
      const nameInUse = /name\s+(is\s+already\s+in\s+use|already\s+in\s+use|taken|is\s+taken)/i.test(JSON.stringify(createAppResponse.errors))
        || raw.includes('app name is in use') || raw.includes('name is already taken');

      if (nameInUse) {
        return NextResponse.json({
          error: 'El nombre de la aplicación ya está en uso. Elige otro nombre único.',
          code: 'APP_NAME_TAKEN',
          details: createAppResponse.errors
        }, { status: 409 });
      }

      return NextResponse.json({
        error: 'Error al crear la aplicación en Fly.io',
        details: createAppResponse.errors,
        suggestion: 'Asegúrate de: (1) que el token tenga permisos, (2) que la organización exista y tengas acceso, (3) que el nombre de app no esté usado, (4) que estés autenticado en la organización correcta.'
      }, { status: 400 });
    }
    const appId = createAppResponse.data.createApp.app.id;
    const appName = createAppResponse.data.createApp.app.name;

    // 3. Asignar IP pública IPv6 para que la app sea accesible sin coste v4
    const allocateV6 = async (): Promise<{ ok: boolean; hint?: string }> => {
      // Prefer Machines API
      try {
        const res = await fetch(`https://api.machines.dev/v1/apps/${appName}/ips`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${body.flyApiToken}`,
            'Content-Type': 'application/json',
            ...(orgSlug ? { 'Fly-Organization': orgSlug } : {}),
          },
          body: JSON.stringify({ type: 'v6' })
        });
        if (res.ok) return { ok: true, hint: 'machines_api_v6' };
      } catch {}
      // Fallback: GraphQL allocateIpAddress
      try {
        const allocMutation = `mutation Alloc($input: AllocateIPAddressInput!) { allocateIpAddress(input: $input) { address { address type } } }`;
        const allocResp = await callFlyApi(body.flyApiToken, allocMutation, { input: { appId, type: 'v6' } });
        if (!allocResp.errors) return { ok: true, hint: 'graphql_allocate_v6' };
      } catch {}
      return { ok: false };
    };

    // Intentar IPv6; no abortar el deploy si falla, el cliente reintentará listar/asignar después
    const v6Alloc = await allocateV6();

    // 4. Crear un volumen persistente para la base de datos (usando la nueva API de Machines)
    const volumeResponse = await fetch(`https://api.machines.dev/v1/apps/${appName}/volumes`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${body.flyApiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: "pb_data",
          size_gb: 1,
          region: body.region,
        }),
      }
    );

    if (!volumeResponse.ok) {
      const errorDetails = await volumeResponse.json();
      return NextResponse.json({ error: "Error al crear el volumen de datos para PocketBase (API v2)", details: errorDetails }, { status: 500 });
    }
    const volumeJson = await volumeResponse.json().catch(() => ({}));
    const volumeName = volumeJson?.name || 'pb_data';

    // 5. Desplegar mediante Machines API usando Debian base y descargando PocketBase desde GitHub Releases
    // Evitamos completamente Docker Hub para no requerir más tokens
    const version = (body.pocketbaseVersion || '').trim();
    const normalizedVersion = version.replace(/^v/, '') || '0.22.8';
    const versionWithV = normalizedVersion.startsWith('v') ? normalizedVersion : `v${normalizedVersion}`;

    const startupCmd = [
      '/bin/sh',
      '-c',
      [
        'set -eux',
        'export DEBIAN_FRONTEND=noninteractive',
        'apt-get update',
        'apt-get install -y curl unzip ca-certificates',
        'mkdir -p /app',
        `echo "Descargando PocketBase ${versionWithV}..."`,
        `curl -fL --retry 3 --retry-delay 2 https://github.com/pocketbase/pocketbase/releases/download/${versionWithV}/pocketbase_${normalizedVersion}_linux_amd64.zip -o /tmp/pb.zip`,
        'ls -lah /tmp',
        'unzip -o /tmp/pb.zip -d /app',
        'chmod +x /app/pocketbase',
        'rm -f /tmp/pb.zip',
        'ls -lah /app',
        'uname -a',
        'echo "Iniciando PocketBase..."',
        '/app/pocketbase serve --http 0.0.0.0:8090 --dir /pb_data'
      ].join(' && ')
    ];

    const machineCreateResponse = await fetch(`https://api.machines.dev/v1/apps/${appName}/machines?start=true`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${body.flyApiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'pb-1',
        region: body.region,
        config: {
          image: 'debian:bookworm-slim',
          init: {
            entrypoint: startupCmd.slice(0, 2),
            cmd: [startupCmd[2]],
          },
          env: {
            POCKETBASE_EMAIL: body.pocketbaseEmail,
            POCKETBASE_PASSWORD: body.pocketbasePassword,
          },
          guest: {
            cpu_kind: 'shared',
            cpus: 1,
            memory_mb: body.memory,
          },
          auto_start: true,
          restart: { policy: 'always' },
          mounts: [
            {
              volume: volumeName,
              path: '/pb_data',
            }
          ],
          services: [
            {
              protocol: 'tcp',
              internal_port: 8090,
              ports: [
                { port: 80, handlers: ['http'] },
                { port: 443, handlers: ['tls', 'http'] }
              ],
              http_options: {
                h2: true,
                compress: true
              },
              checks: [
                {
                  type: 'http',
                  name: 'pocketbase-health',
                  interval: '15s',
                  timeout: '5s',
                  grace_period: '30s',
                  method: 'GET',
                  path: '/api/health'
                }
              ]
            }
          ]
        }
      })
    });

    const machineJson = await machineCreateResponse.json().catch(() => ({}));
    if (!machineCreateResponse.ok) {
      return NextResponse.json({
        error: 'Error al crear la máquina de PocketBase (Machines API)',
        details: machineJson
      }, { status: 500 });
    }

    // 6. Esperar a que el admin responda (máx ~90s)
    const appUrl = `https://${body.appName}.fly.dev`;
    const adminUrl = `${appUrl}/_/`;
    let ready = false;
    let lastStatus: number | null = null;
    let lastError: any = null;

    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 18; i++) { // 18 * 5s = 90s
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 8000);
        const r = await fetch(adminUrl, { signal: controller.signal });
        clearTimeout(t);
        lastStatus = r.status;
        if (r.ok) { ready = true; break; }
      } catch (e: any) {
        lastError = e?.message || String(e);
      }
      await wait(5000);
    }

    // 6.1 (opcional) Importar esquema desde pb_schema.json si existe en el repo
    let schemaImport: { applied: boolean; error?: any } = { applied: false };
    try {
      const schemaPath = path.join(process.cwd(), 'pb_schema.json');
      const raw = await fs.readFile(schemaPath, 'utf-8').catch(() => null as any);
      if (raw) {
        let collections = JSON.parse(raw);
        if (!Array.isArray(collections)) throw new Error('El esquema no es un array válido.');

        // Reparar esquemas vacíos para evitar error "schema: cannot be blank"
        for (const col of collections) {
          const hasSchema = Array.isArray(col.schema) && col.schema.length > 0;
          const hasFields = Array.isArray(col.fields) && col.fields.length > 0;
          if (!hasSchema && !hasFields) {
            const fallback = { system: false, id: Math.random().toString(36).slice(2, 10), name: 'title', type: 'text', required: false, presentable: false, unique: false, options: { min: null, max: null, pattern: '' } };
            col.schema = [fallback];
            col.fields = [fallback];
          } else {
            if (hasSchema && !hasFields) col.fields = col.schema;
            if (hasFields && !hasSchema) col.schema = col.fields;
          }
        }

        // Intentar autenticar como admin o superuser
        let token = '';
        const authEndpoints = ['/api/admins/auth-with-password', '/api/collections/_superusers/auth-with-password'];
        for (const endpoint of authEndpoints) {
          try {
            const loginRes = await fetch(`${appUrl}${endpoint}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ identity: body.pocketbaseEmail, password: body.pocketbasePassword })
            });
            if (loginRes.ok) {
              const loginJson = await loginRes.json();
              token = loginJson?.token;
              if (token) break;
            }
          } catch {}
        }

        if (!token) throw new Error('No se pudo autenticar en PocketBase.');

        // Importar colecciones
        const tryImport = async (authToken: string) => {
          return fetch(`${appUrl}/api/collections/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': authToken },
            body: JSON.stringify({ collections, deleteMissing: false })
          });
        };

        let importRes = await tryImport(token);
        if (!importRes.ok && (importRes.status === 401 || importRes.status === 403 || importRes.status === 404)) {
          importRes = await tryImport(`Bearer ${token}`);
        }

        if (!importRes.ok) {
          const t = await importRes.text().catch(() => '');
          throw new Error(`Import schema falló: ${importRes.status} ${t}`);
        }
        schemaImport.applied = true;
      }
    } catch (e: any) {
      schemaImport = { applied: false, error: e?.message || String(e) };
    }

    // 6.2 Obtener IPs públicas asignadas
    let ips: any[] = [];
    try {
      const ipsRes = await fetch(`https://api.machines.dev/v1/apps/${appName}/ips`, {
        headers: { 'Authorization': `Bearer ${body.flyApiToken}`, ...(orgSlug ? { 'Fly-Organization': orgSlug } : {}) },
      });
      if (ipsRes.ok) {
        ips = await ipsRes.json();
      }
    } catch {}

    // 7. Respuesta
    return NextResponse.json({
      message: '¡Despliegue iniciado con éxito!',
      appName: body.appName,
      appUrl,
      adminUrl,
      ready,
      lastCheck: {
        httpStatus: lastStatus,
        error: lastError,
      },
      ips,
      ipAllocation: v6Alloc,
      machine: {
        id: machineJson.id,
        state: machineJson.state,
        created_at: machineJson.created_at,
        region: machineJson.region,
      },
      schemaImport
    }, { status: 200 });

  } catch (error: any) {
    console.error('Error inesperado en el endpoint de despliegue:', error);
    return NextResponse.json({ error: "Error interno del servidor", details: error.message }, { status: 500 });
  }
}
