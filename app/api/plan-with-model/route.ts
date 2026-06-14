import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import PocketBase from 'pocketbase';
import {
  detectNextStructure,
  ensureRouteConventions,
  normalizeTargetPath,
  type RouteKind,
} from '@/services/pathResolver';

import { UsageService, getModelsForUser } from '@/api/utils';
import { generatePlanWithModel } from '@/api/zeus-model-api/model-service';

// Tipos de entrada/salida del endpoint
export type ExplorerNode = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: ExplorerNode[];
};

export type PlanAction = {
  type: 'create_file' | 'update_file' | 'create_folder';
  path: string;
  purpose?: string;
  language?: 'tsx' | 'ts' | 'js';
  routeKind?: RouteKind;
  content?: string;
  replacements?: Array<{ old: string; new: string }>;
  markers?: Array<{ start: string; end: string; newContent: string; includeMarkers?: boolean }>;
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    console.log('[plan-with-model] Received request with body:', JSON.stringify(body, null, 2));

    const {
      description,
      explorer,
      projectRoot,
      hints,
      modelId,
      model,
      userId,
      autonomy,
      protectedPaths,
      allowedExtensions,
      uiLibrary,
      deliverables,
      activeFile,
      contextFiles,
    } = body as {
      description: string;
      explorer?: ExplorerNode[] | Record<string, any>;
      projectRoot?: string;
      hints?: { path?: string; type?: RouteKind };
      modelId?: string;
      model?: { provider?: string; model?: string; url?: string; apiKey?: string };
      userId?: string;
      autonomy?: 'guided' | 'semi' | 'full';
      protectedPaths?: string[];
      allowedExtensions?: string[];
      uiLibrary?: string;
      deliverables?: 'plan' | 'plan_and_skeletons';
      activeFile?: { path: string; content: string };
      contextFiles?: Array<{ path: string; content: string }>;
    };

    if (!description && !hints?.path) {
      return NextResponse.json({ error: 'Debes proporcionar al menos una descripción o un hint path' }, { status: 400 });
    }

    const root = projectRoot;
    if (!root) {
      return NextResponse.json({ error: 'No se ha especificado el directorio del proyecto. Por favor, abre un proyecto o especifica la ruta manualmente.' }, { status: 400 });
    }
    console.log('[plan-with-model] Using project root:', root);

    let structure: Awaited<ReturnType<typeof detectNextStructure>> | null = null;
    try {
      structure = await detectNextStructure(root);
      console.log('[plan-with-model] Detected Next.js structure:', JSON.stringify(structure, null, 2));
    } catch (structErr) {
      console.warn('[plan-with-model] Could not detect Next.js structure, continuing without it:', structErr);
      structure = { hasSrcDir: false, hasAppDir: false, hasPagesDir: false };
    }

    // ✅ CRÍTICO: Obtener la estructura REAL del disco (no depender solo del explorer del frontend)
    let diskExplorer: ExplorerNode[] = [];
    try {
      diskExplorer = await scanDirectoryTree(root, root);
      console.log('[plan-with-model] Scanned', countExplorerNodes(diskExplorer), 'items from disk');
    } catch (scanErr) {
      console.warn('[plan-with-model] Could not scan disk structure, using frontend explorer only:', scanErr);
    }

    // Usar la estructura del disco como fuente principal; el explorer del frontend es fallback
    const effectiveExplorer = diskExplorer.length > 0 ? diskExplorer : (explorer || []);

    // Resolver modelo
    let effectiveModel = model;
    if ((!effectiveModel?.apiKey && !process.env.OPENAI_API_KEY) || !effectiveModel?.model || !effectiveModel?.provider) {
      if (userId && modelId) {
        console.log('[plan-with-model] Attempting to resolve model from PocketBase for userId:', userId, 'and modelId:', modelId);
        try {
          const allModels = await getModelsForUser(userId);
          const modelConfig = allModels.find((m: any) => m.id === modelId);
          if (modelConfig) {
            effectiveModel = {
              provider: modelConfig.provider || 'openai',
              model: modelConfig.model,
              url: modelConfig.url,
              apiKey: modelConfig.apiKey,
            };
            console.log('[plan-with-model] Resolved model from PocketBase:', effectiveModel);
          }
        } catch (error) {
          console.error('[plan-with-model] Error getting model from PocketBase:', error);
        }
      } else if (userId) {
        console.log('[plan-with-model] Attempting to resolve model from PocketBase using default method for userId:', userId);
        try {
          const selected = await getUserSelectedModel(userId);
          if (selected) {
            effectiveModel = {
              provider: selected.provider || 'openai',
              model: selected.model,
              url: selected.url,
              apiKey: selected.apiKey,
            };
            console.log('[plan-with-model] Resolved model from PocketBase:', effectiveModel);
          }
        } catch (err) {
          console.error('[plan-with-model] Error getting user selected model:', err);
        }
      }
    }

    if (!effectiveModel || !effectiveModel.model) {
      console.log('[plan-with-model] No valid model found, using default from env');
      effectiveModel = {
        provider: process.env.DEFAULT_PROVIDER || 'openai',
        model: process.env.OPENAI_MODEL || process.env.LM_STUDIO_MODEL || process.env.DEFAULT_CHAT_MODEL || 'gpt-4o-mini',
        url: process.env.LM_STUDIO_URL || process.env.OPENAI_API_URL,
        apiKey: process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || '',
      };
    }

    // El cliente (p. ej. modelConfig en localStorage) suele enviar modelo/proveedor/url pero NO apiKey por seguridad.
    // Sin esto, effectiveModel queda con apiKey vacío aunque el servidor tenga OPENAI_API_KEY → se salta el modelo y solo corre heuristicPlan.
    const envApiKey =
      process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.API_KEY_DEEPSEEK || '';
    if (effectiveModel && !String(effectiveModel.apiKey || '').trim() && envApiKey) {
      effectiveModel = { ...effectiveModel, apiKey: envApiKey };
      console.log('[plan-with-model] apiKey rellenada desde variables de entorno (cliente no envió clave)');
    }

    // Collect file content samples
    let fileSamples: Array<{ path: string; contentSample: string }> = [];
    try {
      fileSamples = await collectFileSamples({ root, structure: structure!, hints });
    } catch (fsErr) {
      console.warn('[plan-with-model] Error collecting file samples:', fsErr);
    }

    // ✅ CRÍTICO: Incluir el archivo activo en fileSamples si está disponible
    // Si el frontend no envió contenido pero sí la ruta, leer del disco
    let resolvedActiveFile = activeFile;
    if (resolvedActiveFile?.path && (!resolvedActiveFile.content || !resolvedActiveFile.content.trim()) && root) {
      try {
        const safePath = String(resolvedActiveFile.path).replace(/\\/g, '/').replace(/^\/+/, '');
        const absPath = path.join(root, safePath);
        const stat = await fs.stat(absPath).catch(() => null);
        if (stat?.isFile()) {
          const diskContent = await fs.readFile(absPath, 'utf8');
          resolvedActiveFile = { path: resolvedActiveFile.path, content: diskContent };
          console.log('[plan-with-model] Archivo activo leído del disco:', safePath, 'length:', diskContent.length);
        }
      } catch (diskErr) {
        console.warn('[plan-with-model] No se pudo leer archivo activo del disco:', diskErr);
      }
    }

    // Si todavía no hay contenido activo, intentar inferir un archivo desde la descripción y leerlo del disco
    if ((!resolvedActiveFile || !resolvedActiveFile.content?.trim()) && root && description) {
      const descPaths = extractPathsFromDescription(description);
      for (const p of descPaths) {
        try {
          const absPath = path.join(root, p);
          const stat = await fs.stat(absPath).catch(() => null);
          if (stat?.isFile()) {
            const diskContent = await fs.readFile(absPath, 'utf8');
            resolvedActiveFile = { path: p, content: diskContent };
            console.log('[plan-with-model] Archivo inferido de descripción leído del disco:', p, 'length:', diskContent.length);
            break;
          }
        } catch {}
      }
    }

    let enhancedFileSamples = fileSamples;
    if (resolvedActiveFile && resolvedActiveFile.path && resolvedActiveFile.content && resolvedActiveFile.content.trim()) {
      const normalizedPath = resolvedActiveFile.path.replace(/\\/g, '/').replace(/^\/+/, '');
      enhancedFileSamples = [
        {
          path: normalizedPath,
          contentSample: resolvedActiveFile.content.length > 50000
            ? resolvedActiveFile.content.substring(0, 50000) + '\n\n... (contenido truncado, archivo muy grande)'
            : resolvedActiveFile.content
        },
        ...fileSamples.filter((f: any) => {
          const fPath = f.path?.replace(/\\/g, '/').replace(/^\/+/, '') || '';
          return fPath !== normalizedPath;
        })
      ];
      console.log('[plan-with-model] Archivo activo agregado a fileSamples con', enhancedFileSamples[0].contentSample.length, 'caracteres');
    }

    // Intentamos llamar al modelo. Si falla, usamos heurística.
    let actionsFromModel: PlanAction[] = [];
    try {
      if (effectiveModel.apiKey || effectiveModel.url?.includes('localhost') || effectiveModel.url?.includes('127.0.0.1')) {
        actionsFromModel = await generatePlanWithModel({
          description: description || '',
          explorer: effectiveExplorer,
          structure: structure!,
          hints,
          fileSamples: enhancedFileSamples,
          model: effectiveModel,
          modelId,
          userId,
          autonomy: autonomy ?? 'guided',
          protectedPaths: Array.isArray(protectedPaths) ? protectedPaths : [],
          allowedExtensions: Array.isArray(allowedExtensions) ? allowedExtensions : [],
          uiLibrary,
          deliverables: deliverables ?? 'plan_and_skeletons',
          activeFile: resolvedActiveFile,
          contextFiles,
        });
      } else {
        console.log('[plan-with-model] Skipping model call: no API key and no local URL');
      }
    } catch (modelErr) {
      console.error('[plan-with-model] Model call failed, will use heuristic fallback:', modelErr);
    }

    console.log('[plan-with-model] Actions from model:', actionsFromModel);

    let actions: PlanAction[] = [];
    if (actionsFromModel.length > 0) {
      const filteredByProtected = applyFilterProtectedPaths(actionsFromModel, Array.isArray(protectedPaths) ? protectedPaths : []);
      const filteredByExtensions = applyFilterByAllowedExtensions(filteredByProtected, Array.isArray(allowedExtensions) ? allowedExtensions : []);
      actions = filteredByExtensions;
    } else {
      console.log('[plan-with-model] Using heuristic plan as fallback');
      actions = heuristicPlan({
        description: description || '',
        hints,
        structure: structure!,
        projectRoot: root,
        activeFile: resolvedActiveFile,
      });
    }

    console.log('[plan-with-model] Final actions:', actions);

    return NextResponse.json({ projectRoot: root, structure, actions });
  } catch (error: any) {
    console.error('[plan-with-model] Unhandled error:', error);
    return NextResponse.json({ error: error.message ?? 'Unknown error' }, { status: 500 });
  }
}

async function collectFileSamples(args: {
  root: string;
  structure: Awaited<ReturnType<typeof detectNextStructure>>;
  hints?: { path?: string; type?: RouteKind };
}): Promise<Array<{ path: string; contentSample: string }>> {
  const { root, structure, hints } = args;
  const maxPerFile = 20000;
  const candidates = new Set<string>();

  try { candidates.add('app/page.tsx'); } catch {}

  if (hints?.path) {
    try {
      const kind: RouteKind = (hints.type as any) || 'file';
      const normalized = normalizeTargetPath(hints.path, root);
      const ensured = ensureRouteConventions(kind, normalized, structure, 'tsx');
      candidates.add(ensured);
      candidates.add(normalized);
    } catch {}
  }

  const results: Array<{ path: string; contentSample: string }> = [];
  for (const rel of Array.from(candidates)) {
    const safeRel = String(rel || '').replace(/^\/+/, '').replace(/\\/g, '/');
    const abs = path.join(root, safeRel);
    try {
      const stat = await fs.stat(abs).catch(() => null);
      if (!stat || !stat.isFile()) continue;
      const text = await fs.readFile(abs, 'utf8');
      const sample = text.slice(0, maxPerFile);
      results.push({ path: safeRel, contentSample: sample });
    } catch {}
  }
  return results;
}

function extractPathsFromDescription(description: string): string[] {
  const matches = description.match(/([\w\-/.]+\.(tsx|ts|jsx|js|json|css|scss|html))/gi);
  return matches ? Array.from(new Set(matches.map(m => m.replace(/\\/g, '/').replace(/^\/+/, '')))) : [];
}

function inferKindFromPath(p: string): RouteKind {
  const path = p.replace(/\\/g, '/');
  if (path.includes('/page.')) return 'page';
  if (path.includes('/layout.')) return 'layout';
  if (path.includes('/route.')) return 'route';
  // Si ya tiene extensión de archivo plano y no es un segmento de ruta Next.js, tratarlo como file
  if (/\.(ts|js|tsx|jsx|json|css|scss|html)$/i.test(path)) {
    const fileName = path.split('/').pop() || '';
    if (!/^(page|layout|route)\./i.test(fileName)) return 'file';
  }
  if (path.match(/\bapi\b/) || path.startsWith('api/')) return 'api';
  if (path.match(/components?\//i)) return 'component';
  return 'file';
}

function inferPageNameFromDescription(description: string): string | null {
  const m = description.match(/(?:crear|generar|hacer|nuevo|new|build|make)\s+(?:un|una|el|la|los|las|del|de|la|el|un|una)?\s*(\w[\w\s]*?)(?:\s+(?:de|para|con|desde|que|por|basado|$))/i);
  if (m) {
    return toPascalCase(m[1].trim());
  }
  const words = description.split(/\s+/).filter(w => w.length > 3 && !/^(crear|generar|hacer|para|con|los|las|del|de|la|el|un|una|desde|que|por|the|and|with)$/i.test(w));
  if (words.length > 0) {
    return toPascalCase(words.slice(0, 2).join(' '));
  }
  return null;
}

function toPascalCase(str: string): string {
  return str
    .replace(/[-_]+/g, ' ')
    .replace(/(?:^\w|[A-Z]|\b\w)/g, (word) => word.toUpperCase())
    .replace(/\s+/g, '');
}

function generateFrontendForApi(apiContent: string, apiPath: string, pageName: string, description: string): string {
  const functionMatches = [...apiContent.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)];
  const constMatches = [...apiContent.matchAll(/export\s+const\s+(\w+)\s*[:=]/g)];
  const exports = [...functionMatches, ...constMatches].map(m => m[1]).filter(Boolean);

  const apiImportPath = apiPath.replace(/\.(ts|js|tsx|jsx)$/, '').replace(/\/index$/, '');

  let fields = '';
  if (exports.length > 0) {
    fields = exports.map(fn => `<div className="mb-2"><label className="block text-sm font-medium mb-1">${fn}</label><input name="${fn}" className="border rounded px-2 py-1 w-full" placeholder="${fn}..." /></div>`).join('\n        ');
  } else {
    fields = `<div className="mb-2"><label className="block text-sm font-medium mb-1">Payload</label><textarea name="payload" className="border rounded px-2 py-1 w-full" rows={4} placeholder="JSON..." /></div>`;
  }

  const importLine = exports.length > 0
    ? "import { " + exports.join(', ') + " } from '@/" + apiImportPath + "';"
    : "// import { ... } from '@/" + apiImportPath + "';";

  return `import React, { useState } from 'react';\n// Importa tus funciones de API desde '${apiImportPath}'\n${importLine}\n\nexport default function ${pageName}() {\n  const [loading, setLoading] = useState(false);\n  const [result, setResult] = useState<any>(null);\n\n  const handleSubmit = async (e: React.FormEvent) => {\n    e.preventDefault();\n    setLoading(true);\n    // TODO: integrar con ${apiPath}\n    setLoading(false);\n  };\n\n  return (\n    <div className="container mx-auto py-8 max-w-xl">\n      <h1 className="text-2xl font-bold mb-4">${pageName}</h1>\n      <p className="text-gray-600 mb-6">${description}</p>\n      <form onSubmit={handleSubmit} className="space-y-4">\n        ${fields}\n        <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded w-full">\n          {loading ? 'Enviando...' : 'Enviar'}\n        </button>\n      </form>\n      {result && <pre className="mt-4 p-4 bg-gray-100 rounded text-sm">{JSON.stringify(result, null, 2)}</pre>}\n    </div>\n  );\n}\n`;
}

function heuristicPlan(args: {
  description: string;
  hints?: { path?: string; type?: RouteKind };
  structure: Awaited<ReturnType<typeof detectNextStructure>>;
  projectRoot: string;
  activeFile?: { path: string; content: string };
}): PlanAction[] {
  const { description, hints, structure, projectRoot, activeFile } = args;
  const actions: PlanAction[] = [];
  const desc = description || '';

  console.log('[heuristicPlan] Running heuristic plan with args:', {
    description: desc.substring(0, 100) + '...',
    hints,
    projectRoot,
    hasActiveFile: !!activeFile,
    activeFilePath: activeFile?.path
  });

  // 1. Hint explícito
  if (hints?.path) {
    const kind = hints.type ?? inferKindFromPath(hints.path);
    const rel = normalizeTargetPath(hints.path, projectRoot);
    const finalPath = ensureRouteConventions(kind, rel, structure, kind === 'api' ? 'ts' : 'tsx');

    if (activeFile && activeFile.path && normalizeTargetPath(activeFile.path, projectRoot) === finalPath) {
      actions.push({
        type: 'update_file',
        path: finalPath,
        purpose: `Actualizar archivo existente: ${desc}`.trim(),
        replacements: [{
          old: activeFile.content.substring(0, Math.min(200, activeFile.content.length)),
          new: activeFile.content.substring(0, Math.min(200, activeFile.content.length)) + '\n// TODO: Aplicar instrucciones del usuario'
        }]
      });
    } else {
      actions.push({
        type: 'create_file',
        path: finalPath,
        purpose: `Generado desde hint: ${desc}`.trim(),
        language: kind === 'api' ? 'ts' : 'tsx',
        routeKind: kind,
        content: generateBasicContent(kind, desc, finalPath)
      });
    }
    console.log('[heuristicPlan] Generated action from hints:', actions[0]);
    return actions;
  }

  // 2. ActiveFile contextual (prioridad alta cuando el usuario tiene código abierto)
  if (activeFile && activeFile.path && activeFile.content) {
    const activeNorm = normalizeTargetPath(activeFile.path, projectRoot);
    const isApiFile = /[\\/]api[\\/]/.test(activeNorm) || activeNorm.endsWith('api.ts');
    const wantsFrontend = /formulario|form|frontend|p[aá]gina|componente|interfaz|ui/i.test(desc);
    const wantsUpdate = /actualizar|editar|modificar|completar|a[nñ]adir|agregar|incluir/i.test(desc);

    if (wantsFrontend && isApiFile) {
      const pageName = inferPageNameFromDescription(desc) || 'ApiIntegration';
      const slug = pageName.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
      const targetPath = structure.hasAppDir
        ? ensureRouteConventions('page', slug, structure, 'tsx')
        : ensureRouteConventions('component', `components/${pageName}`, structure, 'tsx');

      actions.push({
        type: 'create_file',
        path: targetPath,
        purpose: `Frontend generado a partir de ${activeNorm}: ${desc}`,
        language: 'tsx',
        routeKind: structure.hasAppDir ? 'page' : 'component',
        content: generateFrontendForApi(activeFile.content, activeNorm, pageName, desc)
      });
      console.log('[heuristicPlan] Generated frontend action from active API file:', actions[0]);
      return actions;
    }

    if (wantsUpdate) {
      const lines = activeFile.content.split('\n');
      const firstBlock = lines.slice(0, Math.min(5, lines.length)).join('\n');
      actions.push({
        type: 'update_file',
        path: activeFile.path,
        purpose: `Actualizar archivo activo: ${desc}`,
        replacements: [{
          old: firstBlock,
          new: firstBlock + '\n// TODO: Aplicar cambios descritos: ' + desc
        }]
      });
      console.log('[heuristicPlan] Generated update action for active file:', actions[0]);
      return actions;
    }
  }

  // 3. Extraer paths de la descripción
  const extractedPaths = extractPathsFromDescription(desc);
  if (extractedPaths.length > 0) {
    const targetRaw = extractedPaths[0];
    const kind = inferKindFromPath(targetRaw);
    const finalPath = ensureRouteConventions(kind, targetRaw, structure, kind === 'api' ? 'ts' : 'tsx');

    // Si coincide con activeFile y parece actualización
    if (activeFile && activeFile.path) {
      const activeNorm = normalizeTargetPath(activeFile.path, projectRoot);
      if (activeNorm === finalPath && /actualizar|editar|modificar|completar|a[nñ]adir|agregar|incluir/i.test(desc)) {
        const lines = activeFile.content.split('\n');
        const firstBlock = lines.slice(0, Math.min(5, lines.length)).join('\n');
        actions.push({
          type: 'update_file',
          path: finalPath,
          purpose: `Actualizar según descripción: ${desc}`,
          replacements: [{
            old: firstBlock,
            new: firstBlock + '\n// TODO: Aplicar cambios descritos: ' + desc
          }]
        });
        return actions;
      }
    }

    actions.push({
      type: 'create_file',
      path: finalPath,
      purpose: `Archivo generado según path en descripción: ${desc}`,
      language: kind === 'api' ? 'ts' : 'tsx',
      routeKind: kind,
      content: generateBasicContent(kind, desc, finalPath)
    });
    return actions;
  }

  // 4. Fallback por keywords con nombre derivado de la descripción
  const isComponent = /componente|component/i.test(desc);
  const isPage = /p[aá]gina|page/i.test(desc);
  const isApi = /api|endpoint/i.test(desc);
  const isLayout = /layout/i.test(desc);
  const isForm = /formulario|form/i.test(desc);

  let name = inferPageNameFromDescription(desc) || 'Generated';
  let kind: RouteKind = 'file';
  let targetPath: string;

  if (isForm && isApi) {
    kind = 'component';
    targetPath = ensureRouteConventions('component', `components/${name}Form`, structure, 'tsx');
  } else if (isPage) {
    kind = 'page';
    targetPath = ensureRouteConventions('page', name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase(), structure, 'tsx');
  } else if (isComponent) {
    kind = 'component';
    targetPath = ensureRouteConventions('component', `components/${name}`, structure, 'tsx');
  } else if (isApi) {
    kind = 'api';
    targetPath = ensureRouteConventions('api', `api/${name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}`, structure, 'ts');
  } else if (isLayout) {
    kind = 'layout';
    targetPath = ensureRouteConventions('layout', name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase(), structure, 'tsx');
  } else {
    kind = 'file';
    targetPath = ensureRouteConventions('file', name, structure, 'tsx');
  }

  actions.push({
    type: 'create_file',
    path: targetPath,
    purpose: `Generado desde descripción: ${desc}`.trim(),
    language: kind === 'api' ? 'ts' : 'tsx',
    routeKind: kind,
    content: generateBasicContent(kind, desc, targetPath)
  });

  console.log('[heuristicPlan] Final actions:', actions);
  return actions;
}

function generateBasicContent(type: RouteKind | 'file', description: string, path: string): string {
  console.log('[generateBasicContent] Generating content for type:', type, 'description:', description, 'path:', path);
  switch (type) {
    case 'page':
      return `import React from 'react';\n\nexport default function Page() {\n  return (\n    <div className="container mx-auto py-8">\n      <h1 className="text-3xl font-bold mb-4">${path.split('/').pop()?.replace(/\.[^/.]+$/, '') || 'Page'}</h1>\n      <p className="text-gray-600">${description}</p>\n    </div>\n  );\n}\n`;
    case 'component': {
      const componentName = path.split('/').pop()?.replace(/\.[^/.]+$/, '') || 'Component';
      return `import React from 'react';\n\ninterface ${componentName}Props {\n  // Define tus props aquí\n}\n\nexport const ${componentName}: React.FC<${componentName}Props> = ({}) => {\n  return (\n    <div className="p-4 border rounded-lg">\n      <h2 className="text-xl font-semibold mb-2">${componentName}</h2>\n      <p className="text-gray-600">${description}</p>\n    </div>\n  );\n};\n`;
    }
    case 'api':
      return `import { NextResponse } from 'next/server';\n\nexport async function GET() {\n  return NextResponse.json({ message: '${description}' });\n}\n\nexport async function POST(request: Request) {\n  const data = await request.json();\n  return NextResponse.json({ message: 'Datos recibidos', data });\n}\n`;
    case 'layout':
      return `import React from 'react';\n\nexport default function Layout({ children }: { children: React.ReactNode }) {\n  return (\n    <div className="min-h-screen bg-gray-50">\n      <header className="bg-white shadow">\n        <div className="container mx-auto px-4 py-4">\n          <h1 className="text-xl font-bold">${path.split('/').pop()?.replace(/\.[^/.]+$/, '') || 'Layout'}</h1>\n        </div>\n      </header>\n      <main className="container mx-auto py-8">{children}</main>\n      <footer className="bg-white border-t mt-8">\n        <div className="container mx-auto px-4 py-4 text-center text-gray-500">Footer</div>\n      </footer>\n    </div>\n  );\n}\n`;
    default:
      return `// ${description}\n// Ruta: ${path}\n\n// Agrega tu implementación aquí\n`;
  }
}

function safeParseJSON(input: string): any {
  try {
    return JSON.parse(input);
  } catch (err) {
    const trimmed = input.trim();
    const match = trimmed.match(/\`\`\`json([\s\S]*?)\`\`\`/i);
    if (match) {
      try { return JSON.parse(match[1]); } catch (innerErr) {}
    }
    return {};
  }
}

function sanitizeAction(a: any, structure: Awaited<ReturnType<typeof detectNextStructure>>): PlanAction | null {
  if (!a || typeof a !== 'object') return null;
  const type = a.type as PlanAction['type'];
  let path = String(a.path ?? '').replace(/\\/g, '/');
  if (!type || !path) return null;

  const routeKind = (a.routeKind as RouteKind) ?? undefined;
  const language = (a.language as 'tsx' | 'ts' | 'js') ?? 'tsx';

  if (type === 'create_file' && routeKind) {
    path = ensureRouteConventions(routeKind, path, structure, language);
  }

  const result: PlanAction = {
    type,
    path,
    purpose: a.purpose ?? undefined,
    language,
    routeKind,
    content: typeof a.content === 'string' && a.content.length > 0 ? a.content : undefined,
  };

  const cleanDelimiters = (text: string): string => {
    return text
      .replace(/--- INICIO CONTENIDO ARCHIVO ---\n?/g, '')
      .replace(/\n?--- FIN CONTENIDO ARCHIVO ---/g, '')
      .replace(/=== ARCHIVO ACTIVO \(EDITOR ABIERTO\) ===/g, '')
      .replace(/El usuario tiene abierto el siguiente archivo\. Usa SOLO este contenido para los reemplazos\.\n?/g, '')
      .replace(/Ruta: [^\n]+\n?/g, '')
      .replace(/IMPORTANTE: El campo "old" en tus reemplazos debe contener SOLO código[^\n]+\n?/g, '');
  };

  const isPurposeAllowingLargeInsert = (purpose?: string): boolean => {
    const p = (purpose || '').toLowerCase();
    if (!p) return false;
    return ['landing', 'sección', 'seccion', 'testimonials', 'pricing', 'galería', 'galeria', 'early access', 'hero', 'crear', 'añadir', 'agregar', 'implementar', 'página completa', 'pagina completa', 'componente', 'component'].some((k) => p.includes(k));
  };

  const shouldRejectOversizedReplacement = (r: { old: string; new: string }, purpose?: string): boolean => {
    if (isPurposeAllowingLargeInsert(purpose)) return false;
    const oldLines = r.old.split('\n').length;
    const newLines = r.new.split('\n').length;
    const oldLen = r.old.length;
    const newLen = r.new.length;
    const delta = newLen - oldLen;
    
    // Límites aumentados significativamente para permitir componentes complejos
    if (newLen > 25000) return true; // 25KB por reemplazo
    if (newLines > 800) return true; // 800 líneas por reemplazo
    if (delta > 20000) return true; // Incremento neto de 20KB
    if (oldLen < 500 && newLen > 10000) return true; // Inserción masiva en zona pequeña
    if (oldLines <= 10 && newLines > 200) return true; // Inserción masiva de líneas
    
    return false;
  };


  if (Array.isArray(a?.replacements)) {
    result.replacements = a.replacements
      .filter((r: any) => r && typeof r.old === 'string' && typeof r.new === 'string')
      .map((r: any) => ({ old: cleanDelimiters(r.old), new: cleanDelimiters(r.new) }))
      .filter((r: any) => r.old.trim().length > 0)
      .filter((r: any) => {
        const reject = shouldRejectOversizedReplacement(r, result.purpose);
        if (reject) {
          console.warn('[sanitizeAction] Dropping oversized replacement for update_file:', { path: result.path, purpose: result.purpose, oldChars: r.old.length, newChars: r.new.length });
        }
        return !reject;
      });
  }
  if (Array.isArray(a?.markers)) {
    result.markers = a.markers
      .filter((m: any) => m && typeof m.start === 'string' && typeof m.end === 'string' && typeof m.newContent === 'string')
      .map((m: any) => ({ start: m.start, end: m.end, newContent: m.newContent, includeMarkers: !!m.includeMarkers }));
  }
  return result;
}

function applyFilterProtectedPaths(actions: PlanAction[], patterns: string[]): PlanAction[] {
  if (!patterns?.length) return actions;
  const toRegex = (glob: string) => new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$');
  const regs = patterns.map(toRegex);
  return actions.filter((a) => !regs.some((r) => r.test(a.path)));
}

function applyFilterByAllowedExtensions(actions: PlanAction[], extensions: string[]): PlanAction[] {
  const exts = (extensions || []).map((e) => (e.startsWith('.') ? e : `.${e}`.trim())).filter(Boolean);
  if (!exts.length) return actions;
  return actions.filter((a) => {
    if (a.type === 'create_folder') return true;
    const m = a.path.match(/\.([a-zA-Z0-9]+)$/);
    const ext = m ? `.${m[1]}` : '';
    return !ext || exts.includes(ext);
  });
}

async function scanDirectoryTree(dir: string, root: string, maxDepth = 6): Promise<ExplorerNode[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const nodes: ExplorerNode[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(root, fullPath).replace(/\\/g, '/');

    if (entry.name.startsWith('.')) continue;
    if (entry.name === 'node_modules') continue;
    if (entry.name === '.next') continue;
    if (entry.name === 'dist') continue;
    if (entry.name === 'out') continue;

    const depth = relPath.split('/').length;
    if (depth > maxDepth) continue;

    if (entry.isDirectory()) {
      const children = await scanDirectoryTree(fullPath, root, maxDepth);
      nodes.push({ name: entry.name, path: relPath, type: 'directory', children });
    } else if (entry.isFile()) {
      nodes.push({ name: entry.name, path: relPath, type: 'file' });
    }
  }

  // Ordenar: carpetas primero, luego archivos; alfabéticamente
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return nodes;
}

function countExplorerNodes(nodes: ExplorerNode[]): number {
  let count = 0;
  for (const n of nodes) {
    count++;
    if (n.children) count += countExplorerNodes(n.children);
  }
  return count;
}

async function getUserSelectedModel(_userId: string): Promise<any | null> {
  return null;
}
