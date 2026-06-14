import {
    initPocketBase,
    getPocketBase,
    isPocketBaseInitialized,
    getPocketBaseUrl
} from '../../lib/pocketbaseForGenerateApi';
import { buildProjectsApiCreateBody } from '../../lib/projectsApiPocketBase';
import { generatePbSchema } from '../../../lib/generatePbSchema';
import { filterGenerateFileParts } from '../../../src/lib/generateApiContextFilter';
import {
  escapeSingleQuoted,
  extractExpressRoutesFromCode,
  openApiInfoDescriptionPlainSummary,
  openapiInfoTitleLine,
  patchSwaggerUiSetupForReadableInfo,
  sanitizeGeneratedApiTsCode
} from '../../../src/lib/sanitizeGeneratedApiCode';

let NextResponse: any;
try {
  ({ NextResponse } = require('next/server'));
} catch {
  NextResponse = null;
}

/** Límites de contexto: carpetas/archivos adjuntos pueden generar prompts enormes y romper V8 al serializar o llamar a la API. */
function readEnvInt(name: string, defaultVal: number): number {
  const v = process.env[name];
  if (v == null || !String(v).trim()) return defaultVal;
  const n = parseInt(String(v).trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : defaultVal;
}

function truncateContextSlice(s: string, maxChars: number, label: string): string {
  if (s.length <= maxChars) return s;
  const note = `\n\n[${label}: truncado ${s.length}→~${maxChars} caracteres — límite de contexto]\n`;
  const head = Math.max(0, maxChars - note.length);
  return (head > 0 ? s.slice(0, head) : '') + note;
}

async function saveProjectToPocketBase(projectData: any, userId?: string) {
  try {
    // Forzar inicialización con credenciales admin locales
    const localUrl = process.env.NEXT_PUBLIC_POCKETBASE_LOCAL_URL || 'http://localhost:8091';
    const adminEmail = process.env.POCKETBASE_LOCAL_ADMIN_EMAIL || 'zeus@ia.com';
    const adminPassword = process.env.POCKETBASE_LOCAL_ADMIN_PASSWORD || '1234567890';

    if (!isPocketBaseInitialized()) {
      await initPocketBase({
        url: localUrl,
        isAdmin: true, // Necesario para crear registros si hay reglas restrictivas
      });
    }
    
    const pb = getPocketBase();
    
    // Autenticar como admin si no lo está
    if (!pb.authStore.isValid || pb.authStore.model?.email !== adminEmail) {
      try {
        await pb.admins.authWithPassword(adminEmail, adminPassword);
        console.log('✓ Autenticado en PocketBase local como admin (Proyectos API)');
      } catch (authError) {
        console.error('✗ Fallo de autenticación admin en Projects API:', authError instanceof Error ? authError.message : String(authError));
      }
    }

    console.log('📋 Creating project in projects_api:', {
      title: projectData.title,
      description: projectData.description,
      hasCode: !!projectData.code,
      hasDocumentation: !!projectData.documentation,
      hasSchemas: !!projectData.schemas,
      hasEndpoints: !!projectData.endpoints,
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

    const result = await pb.collection('projects_api').create(payload);
    console.log('✅ Project saved to local PocketBase (projects_api):', result.id);
    return result;
  } catch (error) {
    console.error('❌ PocketBase save error in projects_api:', error);
    throw error;
  }
}

async function resolveModelApiKey(modelConfig: any): Promise<string | null> {
  if (modelConfig?.apiKey) return modelConfig.apiKey;
  const modelId = modelConfig?.modelId || modelConfig?.id;
  if (!modelId) return null;
  try {
    if (!isPocketBaseInitialized()) {
      await initPocketBase({ url: await getPocketBaseUrl(), isAdmin: false });
    }
    const pb = getPocketBase();
    const record = await pb.collection('ai_models').getOne(modelId);
    const key = record?.api_key || record?.apiKey || null;
    if (key) console.log('[resolveModelApiKey] API key recuperada desde PocketBase para modelo:', modelId);
    return key;
  } catch (e) {
    console.warn('[resolveModelApiKey] No se pudo obtener api_key de PocketBase:', e instanceof Error ? e.message : e);
    return null;
  }
}

export type GenerateFilePart = { buffer: Buffer; originalname: string };

export type GenerateCoreInput = {
  title: string;
  description: string;
  modelType: string;
  selectedFolders: string[];
  files: GenerateFilePart[];
  skipSave: boolean;
  existingCode: string | null;
  feedbackText: string | null;
  userId: string | null;
  modelConfig: { apiKey?: string; [k: string]: unknown } | null;
};

export async function runGenerateCore(input: GenerateCoreInput): Promise<{ status: number; body: Record<string, unknown> }> {
  const {
    title,
    description,
    modelType,
    selectedFolders,
    files,
    skipSave,
    existingCode,
    feedbackText,
    userId,
    modelConfig
  } = input;

  // Recuperar api_key desde PocketBase si no viene en la config (campo oculto en listas)
  if (modelConfig && !modelConfig.apiKey && modelConfig.modelId) {
    const resolvedKey = await resolveModelApiKey(modelConfig);
    if (resolvedKey) {
      modelConfig.apiKey = resolvedKey;
    }
  }

  const isLocal =
    modelConfig?.type === 'local' ||
    modelConfig?.type === 'LM Studio' ||
    modelConfig?.type === 'Ollama' ||
    modelConfig?.provider === 'LM Studio' ||
    modelConfig?.provider === 'local' ||
    modelConfig?.provider === 'Ollama' ||
    (typeof modelConfig?.apiBaseUrl === 'string' && (modelConfig.apiBaseUrl.includes('localhost') || modelConfig.apiBaseUrl.includes('127.0.0.1')));

  if (!isLocal && (!modelConfig || !modelConfig.apiKey)) {
    return {
      status: 400,
      body: {
        error: 'API Key no configurada. Por favor, configura tu API Key en Configuración.'
      }
    };
  }

  const maxFilesTotal = readEnvInt('ZEUS_GENERATE_MAX_FILE_CONTENTS_CHARS', 350_000);
  const maxSingleFile = readEnvInt('ZEUS_GENERATE_MAX_SINGLE_FILE_CONTEXT_CHARS', 120_000);
  const maxDescPrompt = readEnvInt('ZEUS_GENERATE_MAX_DESCRIPTION_CHARS', 80_000);
  const maxPromptTotal = readEnvInt('ZEUS_GENERATE_MAX_PROMPT_CHARS', 450_000);
  const maxExistingCode = readEnvInt('ZEUS_GENERATE_MAX_EXISTING_CODE_CHARS', 250_000);
  const maxFeedback = readEnvInt('ZEUS_GENERATE_MAX_FEEDBACK_CHARS', 50_000);

  const descriptionForPrompt = truncateContextSlice(description, maxDescPrompt, 'Descripción (prompt)');

  const fallbackCtxMax = readEnvInt('ZEUS_GENERATE_CONTEXT_FALLBACK_MAX_FILES', 25);
  const ctxFilter = filterGenerateFileParts(files, fallbackCtxMax);
  const contextFiles = ctxFilter.kept;
  if (ctxFilter.dropped > 0) {
    console.log(
      '📎 Contexto de archivos:',
      contextFiles.length,
      'incluidos,',
      ctxFilter.dropped,
      'omitidos (no son pages/api/rutas principales' +
        (ctxFilter.usedFallback ? '; fallback src/ acotado' : '') +
        ')'
    );
  }

  let fileContents = '';
  for (const file of contextFiles) {
    const header = `\n// ${file.originalname}\n`;
    let content = file.buffer.toString('utf8');
    const perFileCap = Math.min(maxSingleFile, maxFilesTotal);
    if (content.length > perFileCap) {
      content = truncateContextSlice(content, perFileCap, file.originalname);
    }
    const block = `${header}${content}\n`;
    if (fileContents.length + block.length > maxFilesTotal) {
      const room = maxFilesTotal - fileContents.length - header.length - 120;
      if (room < 400) break;
      fileContents += `${header}${content.slice(0, room)}\n// [más archivos omitidos: ZEUS_GENERATE_MAX_FILE_CONTENTS_CHARS]\n`;
      break;
    }
    fileContents += block;
  }

  let folderContents = '';
  if (selectedFolders.length > 0) {
    folderContents = `\n// Carpetas seleccionadas:\n${selectedFolders.join(', ')}\n`;
  }

  const existingForPrompt =
    existingCode && existingCode.length > maxExistingCode
      ? truncateContextSlice(existingCode, maxExistingCode, 'existing_code')
      : existingCode;
  const feedbackForPrompt =
    feedbackText && feedbackText.length > maxFeedback
      ? truncateContextSlice(feedbackText, maxFeedback, 'feedback')
      : feedbackText;

  let prompt =
    feedbackText && existingCode
      ? buildFeedbackPrompt(
          title,
          descriptionForPrompt,
          existingForPrompt ?? '',
          feedbackForPrompt ?? ''
        )
      : buildPrompt(title, descriptionForPrompt, fileContents, folderContents, modelType);

  if (prompt.length > maxPromptTotal) {
    prompt = truncateContextSlice(prompt, maxPromptTotal, 'Prompt total');
  }

  const feedbackMode = !!(feedbackText && existingCode);
  const generatedContent = await callDeepSeekAPI(prompt, modelConfig, { feedbackMode });
  const parsedContent = parseGeneratedContent(
    generatedContent,
    title,
    description,
    feedbackMode ? existingCode : null
  );

  if (feedbackMode && existingCode && typeof parsedContent.code === 'string' && parsedContent.code.trim()) {
    const guard = validateFeedbackPreservesExistingRoutes(
      existingCode,
      parsedContent.code,
      feedbackForPrompt ?? feedbackText ?? ''
    );
    if (!guard.ok) {
      console.warn('[ZEUS feedback]', guard.reason);
      parsedContent.code = existingCode;
      (parsedContent as Record<string, unknown>).feedbackMergeRejected = true;
      (parsedContent as Record<string, unknown>).feedbackMergeMessage = guard.reason;
    }
  }

  if (typeof parsedContent.code === 'string' && parsedContent.code.trim()) {
    const pc = parsedContent as { endpoints?: any; documentation?: unknown; pb_schema?: any };
    parsedContent.code = sanitizeGeneratedApiTsCode(
      parsedContent.code,
      title,
      description,
      pc.endpoints,
      pc.documentation
    );

    // Generar el esquema de PocketBase basado en los endpoints
    try {
      const pbSchemaStr = generatePbSchema(pc.endpoints || [], title);
      pc.pb_schema = JSON.parse(pbSchemaStr);
    } catch (e) {
      console.warn('⚠️ Error generando pb_schema JSON:', e instanceof Error ? e.message : String(e));
      pc.pb_schema = [];
    }
  }

  let savedProjectId: string | null = null;
  let saved = false;
  let saveError: string | undefined;

  if (!skipSave) {
    try {
      const savedProject = await saveProjectToPocketBase(parsedContent, userId || undefined);
      console.log('✅ API project saved successfully to PocketBase');
      savedProjectId = savedProject.id;
      saved = true;
    } catch (err) {
      console.error('❌ Failed to save project to PocketBase:', err);
      saved = false;
      saveError = err instanceof Error ? err.message : 'Unknown save error';
    }
  } else {
    console.log('⏭️ skip_save=true: omitiendo creación de nuevo registro en PocketBase');
  }

  const finalResponse = {
    ...parsedContent,
    id: savedProjectId,
    saved,
    ...(saveError && { saveError })
  };

  return { status: 200, body: finalResponse as Record<string, unknown> };
}

function jsonResponse(body: any, init?: { status?: number }) {
  const status = init?.status ?? 200;
  if (NextResponse) {
    return NextResponse.json(body, { status });
  }
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function POST(request: any) {
  try {
    const formData = await request.formData();

    const title = (formData.get('title') as string) || '';
    const description = (formData.get('description') as string) || '';
    const modelType = (formData.get('modelType') as string) || 'typescript';
    const selectedFolders = formData.getAll('selectedFolders') as string[];
    const webFiles = formData.getAll('files') as File[];
    const files: GenerateFilePart[] = [];
    for (const file of webFiles) {
      const buf = Buffer.from(await file.arrayBuffer());
      files.push({ buffer: buf, originalname: file.name });
    }
    const skipSave = formData.get('skip_save') === 'true';
    const existingCode = formData.get('existing_code') as string | null;
    const feedbackText = formData.get('feedback_text') as string | null;
    const userId = request.headers.get('x-user-id');
    const modelConfigStr = request.headers.get('x-model-config');
    let modelConfig = null;
    if (modelConfigStr) {
      try {
        modelConfig = JSON.parse(modelConfigStr);
      } catch (error) {
        console.error('Error parsing model config:', error);
      }
    }

    const r = await runGenerateCore({
      title,
      description,
      modelType,
      selectedFolders,
      files,
      skipSave,
      existingCode,
      feedbackText,
      userId,
      modelConfig
    });
    return jsonResponse(r.body, { status: r.status });
  } catch (error) {
    console.error('Error generando API:', error);
    return jsonResponse(
      { error: 'Error generando la API: ' + (error instanceof Error ? error.message : 'Unknown error') },
      { status: 500 }
    );
  }
}

/** Express + multer (campos en req.body, archivos en req.files) */
export async function POST_EXPRESS(req: any, res: any): Promise<void> {
  try {
    const title = String(req.body?.title ?? '');
    const description = String(req.body?.description ?? '');
    const modelType = String(req.body?.modelType ?? 'typescript');
    let selectedFolders: string[] = [];
    if (req.body?.selectedFolders !== undefined && req.body?.selectedFolders !== null) {
      selectedFolders = Array.isArray(req.body.selectedFolders)
        ? req.body.selectedFolders.map(String)
        : [String(req.body.selectedFolders)];
    }
    const multerFiles = (req.files || []) as Array<{ buffer: Buffer; originalname: string }>;
    const files: GenerateFilePart[] = multerFiles.map((f) => ({
      buffer: f.buffer,
      originalname: f.originalname || 'file'
    }));
    const skipSave = req.body?.skip_save === 'true' || req.body?.skip_save === true;
    const existingCode = req.body?.existing_code != null ? String(req.body.existing_code) : null;
    const feedbackText = req.body?.feedback_text != null ? String(req.body.feedback_text) : null;
    const userId = (req.headers['x-user-id'] as string) || null;
    let modelConfig = null;
    const modelConfigStr = req.headers['x-model-config'] as string | undefined;
    if (modelConfigStr) {
      try {
        modelConfig = JSON.parse(modelConfigStr);
      } catch (e) {
        console.error('Error parsing model config:', e);
      }
    }

    const r = await runGenerateCore({
      title,
      description,
      modelType,
      selectedFolders,
      files,
      skipSave,
      existingCode,
      feedbackText,
      userId,
      modelConfig
    });
    res.status(r.status).json(r.body);
  } catch (error) {
    console.error('Error generando API (Express):', error);
    res.status(500).json({
      error: 'Error generando la API: ' + (error instanceof Error ? error.message : 'Unknown error')
    });
  }
}

function buildFeedbackPrompt(title: string, description: string, existingCode: string, feedback: string): string {
  const routeCount = extractExpressRoutesFromCode(existingCode).length;
  return `Actúa como un experto arquitecto de APIs TypeScript. Estás en modo ACTUALIZACIÓN (feedback), NO en modo crear API desde cero.

**Título del Proyecto:** ${title}
**Descripción original:** ${description}

**CÓDIGO ACTUAL COMPLETO (es la base; tu salida debe ser este archivo COMPLETO modificado de forma mínima):**
\`\`\`typescript
${existingCode}
\`\`\`

**FEEDBACK (cambio concreto que pide el usuario):**
${feedback}

**REGLAS ABSOLUTAS (incumplir = respuesta inválida):**
1. PROHIBIDO sustituir esta API por otra distinta o por un "ejemplo" nuevo. PROHIBIDO empezar de cero salvo que el usuario pida explícitamente rehacer todo el proyecto.
2. REGLA CRÍTICA DE COPIA: Tu campo JSON "code" debe ser EL MISMO archivo anterior, CARÁCTER POR CARÁCTER, excepto en los cambios mínimos solicitados. NO reescribas imports, NO cambies nombres de variables, NO reorganices el orden del código, NO modifiques endpoints existentes.
3. El feedback suele pedir AÑADIR algo (p. ej. subida de imágenes): intégralo (multer, ruta nueva, etc.) SIN quitar rutas ni lógica previa. Inserta el nuevo código ADYACENTE a lo existente; no lo reemplaces.
4. Cuenta de referencia: el código actual tiene aproximadamente ${routeCount} registro(s) de ruta (app/router .get/.post/.put/.delete/.patch). La versión final NO debe tener MENOS rutas que eso, salvo que el usuario pida explícitamente eliminar endpoints.
5. Si añades dependencias (p. ej. multer), añade el import y la ruta nueva; no borres el resto del archivo. Con multer: tipa diskStorage (destination, filename, fileFilter) con (req: Request, file: Express.Multer.File, cb con firma correcta); usa Request importado de 'express'; amplía Express.Request para req.file (p. ej. declare global { namespace Express { interface Request { file?: Express.Multer.File } } }).
6. Actualiza "documentation", "schemas" y "endpoints" en el JSON solo para reflejar los cambios, sin reemplazar la descripción funcional de lo que ya hacía la API.
7. **Swagger:** mantén y extiende @swagger; apis debe seguir incluyendo './api.ts'. Cada endpoint NUEVO que añadas debe llevar encima un bloque @swagger completo: tags, summary, description breve; parameters in path para :id; query para GET; requestBody con application/json y application/x-www-form-urlencoded (mismo schema object) para POST/PUT/PATCH cuando haya varios campos, además de multipart si hay multer. Conserva express.urlencoded({ extended: true }). En el array JSON **endpoints**, cada ruta debe traer **parameters** completos (path/query/body) para que Zeus enriquezca el OpenAPI y Swagger muestre todos los parámetros de cada endpoint.
8. **MANEJO DE TIPOS POCKETBASE:** 'record as unknown as YourType' donde aplique.
9. **PUERTO:** El servidor debe escuchar por defecto en el puerto 3001 (o process.env.PORT).
10. **CORS:** Configura CORS para permitir peticiones desde el frontend (normalmente puerto 3000).
11. **Swagger info.description** en el código: breve, una línea, sin Markdown largo.
8. **CONEXIÓN A POCKETBASE:** El código debe inicializar PocketBase usando la variable de entorno PB_URL o NEXT_PUBLIC_PB_URL. Ejemplo: const pb = new PocketBase(process.env.PB_URL || process.env.NEXT_PUBLIC_PB_URL );. Para evitar errores de compilación TS2352, al retornar datos de PocketBase usa siempre una conversión segura como 'return record as unknown as YourType o usa genéricos en la colección: pb.collection<YourType>("name")'.

**IMPORTANTE:** Responde ÚNICAMENTE con JSON válido. No incluyas markdown, no uses \`\`\`, no añadas explicaciones. Solo el JSON puro.

**CRÍTICO SOBRE FORMATO DEL CÓDIGO:**
- Dentro de los valores de string JSON, usa \\n para representar saltos de línea.
- El código TypeScript debe estar completamente formateado con \\n entre cada línea.

Formato exacto requerido:
{"endpoints":[{"id":"endpoint-id","path":"/items/{id}","method":"GET","description":"Descripción","parameters":{"id":{"type":"string","required":true,"description":"ID"}},"testTask":{"id":"test-endpoint-id","endpointId":"endpoint-id","method":"POST","path":"/api/generate-api/test/endpoint-id","title":"Test GET /items/{id}"}}],"code":"// Código TypeScript completo con \\n entre líneas","documentation":"# Documentación OpenAPI actualizada","schemas":"// Esquemas Zod personalizados"} `;
}

/** El usuario no pidió quitar rutas; detecta intención explícita de eliminar endpoints. */
function feedbackImpliesRemovingEndpoints(feedback: string): boolean {
  const f = feedback.toLowerCase();
  return (
    /\b(eliminar|borrar|quita|quitar|remove|drop|delete\s+the\s+endpoint|delete\s+endpoint|sin\s+el\s+endpoint|quita\s+la\s+ruta)\b/.test(
      f
    ) || /\b(elimina|borra)\s+(el\s+|la\s+)?(endpoint|ruta|api|servicio)\b/.test(f)
  );
}

function validateFeedbackPreservesExistingRoutes(
  existingCode: string,
  proposedCode: string,
  feedback: string
): { ok: true } | { ok: false; reason: string } {
  if (feedbackImpliesRemovingEndpoints(feedback)) {
    return { ok: true };
  }
  const nBefore = extractExpressRoutesFromCode(existingCode).length;
  const nAfter = extractExpressRoutesFromCode(proposedCode).length;
  if (nBefore === 0) {
    return { ok: true };
  }
  if (nAfter < nBefore) {
    return {
      ok: false,
      reason: `La respuesta del modelo tenía ${nAfter} rutas frente a ${nBefore} en tu API actual; se conservó el código anterior para no perder endpoints. Reformula el feedback indicando que quieres AÑADIR el cambio sin reescribir el archivo entero.`
    };
  }
  return { ok: true };
}

function buildPrompt(title: string, description: string, fileContents: string, folderContents: string, modelType: string): string {
  return `Actúa como un experto arquitecto de APIs TypeScript. Necesito que generes una API completa basada en la siguiente información:

**Título del Proyecto:** ${title}
**Descripción:** ${description}
**Tipo de Modelo:** ${modelType}

**Archivos de código proporcionados:**
${fileContents || 'No se proporcionaron archivos'}

**Carpetas seleccionadas:**
${folderContents || 'No se seleccionaron carpetas'}

**Instrucciones:**
1. Genera código TypeScript completo y tipado.
2. Incluye todos los endpoints necesarios para cumplir con la descripción del usuario, usando métodos REST apropiados (GET, POST, PUT, DELETE, PATCH). No te limites a un CRUD básico si la descripción pide más funcionalidades.
3. Usa Zod para validación de esquemas.
4. Genera documentación OpenAPI/Swagger INTEGRADA con swagger-jsdoc. **Obligatorio:** cada registro de ruta Express (app.get, app.post, app.put, app.delete, app.patch, o los mismos en router) debe tener **justo encima** un bloque JSDoc /** @swagger ... */ con: tags, summary, description; si hay parámetros de ruta (:id, etc.), bloque parameters (in: path, schema string); para GET/DELETE incluye query parameters que uses (in: query); para POST/PUT/PATCH incluye requestBody con application/json y application/x-www-form-urlencoded (el mismo schema object en ambos) con properties por cada campo del cuerpo; si la ruta sube archivos (multer), requestBody con multipart/form-data y propiedad file (type string, format binary). Si varios métodos comparten path, un solo bloque @swagger con get:, post:, etc.
5. **CONEXIÓN A POCKETBASE (PUERTOS DINÁMICOS):** PocketBase NO usa el puerto 8090 por defecto; Zeus asigna puertos aleatorios. Por lo tanto, el código DEBE usar process.env.PB_URL o process.env.NEXT_PUBLIC_PB_URL para inicializar el cliente. Prohibido usar 'http://127.0.0.1:8090' de forma estática. Ejemplo: const pb = new PocketBase(process.env.PB_URL || process.env.NEXT_PUBLIC_PB_URL || 'http://127.0.0.1:8090');.
6. Para evitar errores de compilación TS2352, al retornar datos de PocketBase usa siempre una conversión segura como 'return record as unknown as YourType' o usa genéricos en la colección: 'pb.collection<YourType>("name")'.
7. El campo 'apis' de swagger-jsdoc **debe** incluir al menos './api.ts' además de globs, p. ej. ['./*.ts', './api.ts', './src/*.ts'] — así Swagger UI ve todas las rutas del archivo principal.
8. El código debe incluir la configuración de express, cors (configurado para permitir peticiones desde el frontend, puerto 3000), swagger-ui-express y swagger-jsdoc. Tras express.json() añade express.urlencoded({ extended: true }).
9. **PUERTO DE LA API:** El servidor API debe escuchar por defecto en el puerto 3001 (o process.env.PORT).
10. **Swagger info.description:** debe ser UNA sola cadena en una línea (comillas simples o dobles), texto plano breve (1–2 frases). Prohibido pegar Markdown ahí. Toda la documentación larga va SOLO en el campo JSON "documentation", nunca como texto suelto dentro de api.ts.
11. **Multer (subida de imágenes/archivos):** tipa los callbacks de multer.diskStorage (destination, filename, fileFilter) con Request y Express.Multer.File; declara req.file en Express.Request (merge de interfaz). Así compila con strict y @types/multer.
12. **Array JSON "endpoints":** genera un array con "id", "path", "method", "description" y "parameters" (con type/required) por cada ruta. En cada endpoint incluye también "testTask" con { id, endpointId, method:'POST', path:'/api/generate-api/test/<endpointId>', title }. Sé breve en las descripciones. No te limites a 5; pon todos los que hayas hecho.

**IMPORTANTE:** Responde ÚNICAMENTE con JSON válido. No incluyas markdown, no uses \`\`\`, no añadas explicaciones. Solo el JSON puro.

**CRÍTICO SOBRE FORMATO DEL CÓDIGO:**
- Dentro de los valores de string JSON, usa \\n para representar saltos de línea (NUNCA saltos de línea reales dentro del JSON).
- El código TypeScript debe estar completamente formateado con \\n entre cada línea.
- Ejemplo correcto: {"code":"import express from 'express';\\n\\nconst app = express();\\n\\napp.get('/', (req, res) => {\\n  res.json({ok: true});\\n});\\n"}
- Genera código COMPLETO con todos los endpoints, middleware, clases y configuración.

Formato exacto requerido:
{"endpoints":[{"id":"endpoint-id","path":"/items/{id}","method":"GET","description":"Descripción","parameters":{"id":{"type":"string","required":true,"description":"ID"}},"testTask":{"id":"test-endpoint-id","endpointId":"endpoint-id","method":"POST","path":"/api/generate-api/test/endpoint-id","title":"Test GET /items/{id}"}}],"code":"// Código TypeScript completo con \\n entre líneas","documentation":"# Documentación OpenAPI actualizada","schemas":"// Esquemas Zod personalizados"} `;
}

async function callDeepSeekAPI(
  prompt: string,
  modelConfig: any,
  options?: { feedbackMode?: boolean }
): Promise<string> {
  let apiUrl: string;
  if (modelConfig.apiBaseUrl) {
    let b = modelConfig.apiBaseUrl.trim().replace(/\/$/, '');
    
    // Si ya tiene el endpoint completo, no añadir más
    if (b.endsWith('/api/chat') || b.endsWith('/v1/chat/completions') || b.endsWith('/chat/completions')) {
      apiUrl = b;
    } else if (b.includes(':11434')) {
      // Ollama puro
      b = b.replace(/\/v1$/, '').replace(/\/api$/, '');
      apiUrl = `${b}/api/chat`;
    } else {
      // Si no tiene /v1 ni /chat/completions, intentamos ser inteligentes
      if (!b.includes('/v1') && !b.includes('/api/')) {
        apiUrl = `${b}/v1/chat/completions`;
      } else if (b.includes('/v1') && !b.includes('/chat/completions')) {
        apiUrl = `${b}/chat/completions`;
      } else {
        apiUrl = b;
      }
    }
  } else {
    apiUrl = 'https://api.deepseek.com/chat/completions';
  }
  const feedbackMode = options?.feedbackMode === true;
  const systemCreate =
    'Eres un experto arquitecto de APIs TypeScript que genera código de producción. ' +
    'En swagger-jsdoc, definition.info.description debe ser siempre una cadena corta en una sola línea (texto plano). ' +
    'No pongas Markdown (#, listas, secciones) ni documentación larga dentro del .ts; eso va únicamente en el campo JSON "documentation". ' +
    'Documenta en @swagger cada ruta Express (app.get/post/put/delete/patch o router.*) y usa apis que incluyan ./api.ts para que Swagger UI liste todos los endpoints.';
  const systemFeedback =
    'Eres un experto en TypeScript y Express en modo ACTUALIZACIÓN POR FEEDBACK. ' +
    'REGLA CRÍTICA: NUNCA reescribas todo el archivo. Toma el código exacto que te pasan, conserva CADA línea, CADA import, CADA variable, CADA middleware y CADA endpoint existente. ' +
    'Solo añade o modifica lo mínimo necesario para cumplir el feedback. Si el usuario pide "añadir un endpoint de upload", simplemente añade ese endpoint junto a los existentes; no toques nada más. ' +
    'Si reescribes desde cero, borras o cambias endpoints existentes, tu respuesta es INVÁLIDA. ' +
    'El JSON de respuesta debe contener el archivo COMPLETO pero idéntico al original excepto en los cambios solicitados. ' +
    'Swagger: info.description breve en una línea; documentación larga en el campo JSON documentation.';

  const baseTemp =
    typeof modelConfig.temperature === 'number' && Number.isFinite(modelConfig.temperature)
      ? modelConfig.temperature
      : 0.7;
  const temperature = feedbackMode ? Math.min(baseTemp, 0.35) : baseTemp;

  console.log('📡 API URL:', apiUrl, '| Model:', modelConfig.model, feedbackMode ? '| mode=feedback' : '');
  
  // Intentar con un límite alto para permitir APIs complejas (19+ endpoints)
  let currentMaxTokens = Math.max(modelConfig.maxTokens || 8192, 8192);
  
  const performFetch = async (tokens: number) => {
    return await fetch(apiUrl, {
      method: 'POST',
      headers: {
        ...(modelConfig.apiKey && { 'Authorization': `Bearer ${modelConfig.apiKey}` }),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelConfig.model || 'deepseek-chat',
        messages: [
          { role: 'system', content: feedbackMode ? systemFeedback : systemCreate },
          { role: 'user', content: prompt }
        ],
        temperature,
        max_tokens: tokens,
      }),
    });
  };

  let response = await performFetch(currentMaxTokens);
  
  // Si el modelo rechaza la petición por max_tokens (Error 400), reintentamos con un límite seguro
  if (response.status === 400) {
    const errorClone = response.clone();
    try {
      const errorData = await errorClone.json();
      const errorMsg = JSON.stringify(errorData).toLowerCase();
      if (errorMsg.includes('max_tokens') || errorMsg.includes('maximum')) {
        console.log('⚠️ El modelo rechazó el límite de tokens. Reintentando con 8192...');
        response = await performFetch(8192);
      }
    } catch (e) {
      // Si no es JSON o falla el parseo del error, seguimos con la respuesta original
    }
  }
  
  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`Error en API de DeepSeek: ${response.status} - ${errorData}`);
  }
  
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('Respuesta DeepSeek sin contenido de mensaje');
  }
  return content;
}

/** Si el modelo no devuelve `code` o viene vacío, conservar `feedbackExistingCode` en lugar de plantillas genéricas. */
function codeFromParsedOrExisting(
  parsedCode: unknown,
  feedbackExistingCode: string | null,
  title: string,
  description: string
): string {
  if (typeof parsedCode === 'string' && parsedCode.trim()) {
    return parsedCode;
  }
  if (feedbackExistingCode && feedbackExistingCode.trim()) {
    return feedbackExistingCode;
  }
  return generateTypeScriptAPI(title, description, '', '');
}

function slugifyEndpointPart(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/\{([^}]+)\}/g, '$1')
    .replace(/:([a-zA-Z0-9_]+)/g, '$1')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'endpoint';
}

function endpointPathParamNames(path: string): string[] {
  const names = new Set<string>();
  const text = String(path || '');

  const braces = /\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = braces.exec(text)) !== null) {
    const name = String(m[1] || '').trim();
    if (name) names.add(name);
  }

  const colon = /:([A-Za-z0-9_]+)/g;
  while ((m = colon.exec(text)) !== null) {
    const name = String(m[1] || '').trim();
    if (name) names.add(name);
  }

  return [...names];
}

function normalizeEndpointParameters(path: string, raw: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    Object.assign(out, raw as Record<string, unknown>);
  } else if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const p = item as Record<string, unknown>;
      const name = typeof p.name === 'string' ? p.name.trim() : '';
      if (!name) continue;
      const schema = p.schema && typeof p.schema === 'object' && !Array.isArray(p.schema)
        ? (p.schema as Record<string, unknown>)
        : {};
      out[name] = {
        type: typeof schema.type === 'string' ? schema.type : 'string',
        required: p.required === true,
        ...(typeof p.description === 'string' && p.description.trim() ? { description: p.description.trim() } : {})
      };
    }
  }

  for (const pathName of endpointPathParamNames(path)) {
    const existing = out[pathName];
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
      out[pathName] = {
        ...(existing as Record<string, unknown>),
        required: true,
        type: typeof (existing as Record<string, unknown>).type === 'string'
          ? (existing as Record<string, unknown>).type
          : 'string',
        description: typeof (existing as Record<string, unknown>).description === 'string'
          ? (existing as Record<string, unknown>).description
          : `Path parameter: ${pathName}`
      };
    } else {
      out[pathName] = {
        type: 'string',
        required: true,
        description: `Path parameter: ${pathName}`
      };
    }
  }

  return out;
}

function normalizeGeneratedEndpoints(rawEndpoints: unknown, code: string): any[] {
  const hasRaw = Array.isArray(rawEndpoints) && rawEndpoints.length > 0;
  const source = hasRaw
    ? (rawEndpoints as any[])
    : extractExpressRoutesFromCode(code).map((r) => ({
        path: r.path,
        method: r.method.toUpperCase(),
        description: `Operación ${r.method.toUpperCase()} en ${r.path}`,
        parameters: {}
      }));

  const usedIds = new Set<string>();

  return source.map((item, index) => {
    const endpoint = item && typeof item === 'object' ? { ...(item as Record<string, unknown>) } : {};
    const method = String(endpoint.method || 'GET').toUpperCase();
    const path = String(endpoint.path || '/');

    const autoIdBase = `${slugifyEndpointPart(path)}-${method.toLowerCase()}`;
    let id = typeof endpoint.id === 'string' && endpoint.id.trim()
      ? endpoint.id.trim()
      : autoIdBase;
    if (usedIds.has(id)) {
      id = `${autoIdBase}-${index + 1}`;
    }
    usedIds.add(id);

    const parameters = normalizeEndpointParameters(path, endpoint.parameters);
    const existingTestTask = endpoint.testTask && typeof endpoint.testTask === 'object' && !Array.isArray(endpoint.testTask)
      ? (endpoint.testTask as Record<string, unknown>)
      : {};
    const defaultInputValues = Object.fromEntries(
      Object.keys(parameters).map((k) => [k, ''])
    );
    const existingInputValues =
      existingTestTask.inputValues &&
      typeof existingTestTask.inputValues === 'object' &&
      !Array.isArray(existingTestTask.inputValues)
        ? (existingTestTask.inputValues as Record<string, unknown>)
        : {};

    const testTask = {
      id: typeof existingTestTask.id === 'string' && existingTestTask.id.trim()
        ? existingTestTask.id
        : `test-${id}`,
      endpointId: id,
      method: 'POST',
      path: `/api/generate-api/test/${id}`,
      title: typeof existingTestTask.title === 'string' && existingTestTask.title.trim()
        ? existingTestTask.title
        : `Test ${method} ${path}`,
      inputValues: {
        ...defaultInputValues,
        ...existingInputValues
      }
    };

    return {
      ...endpoint,
      id,
      path,
      method,
      parameters,
      testTask
    };
  });
}

function parseGeneratedContent(
  generatedContent: string,
  title: string,
  description: string,
  feedbackExistingCode: string | null = null
) {
  const maxAiChars = readEnvInt('ZEUS_GENERATE_MAX_AI_RESPONSE_CHARS', 1_500_000);
  let gc = generatedContent;
  if (gc.length > maxAiChars) {
    console.warn('⚠️ Respuesta del modelo recortada para parsing:', gc.length, '→', maxAiChars);
    gc = gc.slice(0, maxAiChars);
  }

  try {
    // Limpiar la respuesta del modelo - eliminar bloques de pensamiento, markdown y caracteres no deseados
    let cleanedContent = gc.trim();
    
    // 1. ELIMINAR BLOQUE DE PENSAMIENTO (<think>...</think>) de modelos de razonamiento
    if (cleanedContent.includes('<think>')) {
      console.log('🧠 Detectado bloque de pensamiento del modelo, eliminándolo...');
      cleanedContent = cleanedContent.replace(/<think>[^]*?<\/think>/g, '').trim();
    }
    
    // Detectar si la respuesta fue truncada
    const isTruncated = !cleanedContent.endsWith('}') && !cleanedContent.endsWith(']');
    if (isTruncated) {
      console.warn('⚠️ AI response appears truncated. Length:', cleanedContent.length);
    }
    
    // Eliminar bloques de código markdown si existen
    if (cleanedContent.startsWith('```json')) {
      cleanedContent = cleanedContent.replace(/^```json\s*/, '').replace(/```\s*$/, '');
    } else if (cleanedContent.startsWith('```')) {
      cleanedContent = cleanedContent.replace(/^```\w*\s*/, '').replace(/```\s*$/, '');
    }
    
    // TÉCNICA DE RESCATE: Si está truncado, intentar extraer solo el array de endpoints que ahora está al principio
    let rescuedEndpoints: any[] | null = null;
    try {
      const endpointsMatch = cleanedContent.match(/"endpoints"\s*:\s*(\[[^]*?\])\s*(?:,|\s*\})/);
      if (endpointsMatch) {
        rescuedEndpoints = JSON.parse(endpointsMatch[1]);
        console.log('⚡ Endpoints rescatados quirúrgicamente del JSON truncado:', rescuedEndpoints?.length);
      }
    } catch (e) {
      console.log('⚠️ No se pudo rescatar endpoints por Regex:', e);
    }

    // Intentar parsear como JSON completo
    try {
      const parsed = JSON.parse(cleanedContent);
      const code = codeFromParsedOrExisting(parsed.code, feedbackExistingCode, title, description);
      
      // Usar endpoints del JSON o los rescatados
      const endpoints = normalizeGeneratedEndpoints(
        (Array.isArray(parsed.endpoints) && parsed.endpoints.length > 0) ? parsed.endpoints : rescuedEndpoints,
        code
      );

      return {
        title,
        description,
        code,
        documentation: parsed.documentation || generateOpenAPIDocumentation(title, description, ''),
        schemas: parsed.schemas || generateZodSchemas(''),
        endpoints
      };
    } catch (jsonError) {
       // Si falla el JSON completo pero tenemos endpoints rescatados y código parcial
       if (rescuedEndpoints && rescuedEndpoints.length > 0) {
         console.log('🩹 Usando modo recuperación parcial (JSON roto pero endpoints OK)');
         // Intentar extraer código aunque el JSON esté roto (buscando el campo "code")
         const codeMatch = cleanedContent.match(/"code"\s*:\s*"([^]*?)"(?:\s*,|\s*\})/);
         const code = codeMatch ? codeMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : codeFromParsedOrExisting(undefined, feedbackExistingCode, title, description);
         
         return {
           title,
           description,
           code,
           documentation: generateOpenAPIDocumentation(title, description, ''),
           schemas: generateZodSchemas(''),
           endpoints: normalizeGeneratedEndpoints(rescuedEndpoints, code)
         };
       }
       throw jsonError; // Re-lanzar para que entre en los catch de abajo
    }
  } catch (error) {
    console.error('Error parsing AI response, using fallback:', error);
    const rawPreview =
      gc.length > 8000 ? `${gc.slice(0, 4000)}…[${gc.length} chars]…${gc.slice(-2000)}` : gc;
    console.log('Raw AI response (preview):', rawPreview);

    // Intentar extraer JSON manualmente con regex como último recurso
    try {
      const jsonMatch = gc.length <= 2_000_000 ? gc.match(/\{[\s\S]*\}/) : null;
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const code = codeFromParsedOrExisting(parsed.code, feedbackExistingCode, title, description);
        const endpoints = normalizeGeneratedEndpoints(parsed.endpoints, code);
        return {
          title,
          description,
          code,
          documentation: parsed.documentation || generateOpenAPIDocumentation(title, description, ''),
          schemas: parsed.schemas || generateZodSchemas(''),
          endpoints
        };
      }
    } catch (regexError) {
      console.error('Regex extraction also failed:', regexError);
      // Intentar reparar JSON truncado añadiendo cierre
      try {
        const jsonStart = gc.indexOf('{');
        if (jsonStart !== -1) {
          let partial = gc.slice(jsonStart);
          if (partial.length > maxAiChars) {
            partial = partial.slice(0, maxAiChars);
          }
          // Contar llaves para intentar cerrar el JSON
          const openBraces = (partial.match(/\{/g) || []).length;
          const closeBraces = (partial.match(/\}/g) || []).length;
          const missing = openBraces - closeBraces;
          const maxRepairBraces = readEnvInt('ZEUS_GENERATE_MAX_JSON_REPAIR_BRACES', 64);
          if (missing > 0 && missing <= maxRepairBraces) {
            partial += '"}}' + '}'.repeat(missing - 1);
            const repaired = JSON.parse(partial);
            console.log('🔧 JSON reparado exitosamente');
            const code = codeFromParsedOrExisting(repaired.code, feedbackExistingCode, title, description);
            const endpoints = normalizeGeneratedEndpoints(repaired.endpoints, code);
            return {
              title,
              description,
              code,
              documentation: repaired.documentation || generateOpenAPIDocumentation(title, description, ''),
              schemas: repaired.schemas || generateZodSchemas(''),
              endpoints
            };
          }
        }
      } catch (repairError) {
        console.error('JSON repair also failed:', repairError);
      }
    }
    
    // Si todo falla: con feedback, conservar el código existente; si no, plantilla nueva
    console.error('❌ All JSON parsing attempts failed. Using clean fallback template.');
    return {
      title,
      description,
      code: codeFromParsedOrExisting(undefined, feedbackExistingCode, title, description),
      documentation: generateOpenAPIDocumentation(title, description, ''),
      schemas: generateZodSchemas(''),
      endpoints: normalizeGeneratedEndpoints(generateEndpoints(title, description), codeFromParsedOrExisting(undefined, feedbackExistingCode, title, description))
    };
  }
}

function generateTypeScriptAPI(title: string, description: string, fileContents: string, modelType: string): string {
  const modelName = title.replace(/\s+/g, '');
  const basePath = title.toLowerCase().replace(/\s+/g, '-');
  
  const embeddedTitle = openapiInfoTitleLine(title);
  const embeddedDesc = escapeSingleQuoted(openApiInfoDescriptionPlainSummary(description));

  const apiSource = `import express, { Request, Response } from 'express';
import { z } from 'zod';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// Zod Schemas
export const ${modelName}Schema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type ${modelName} = z.infer<typeof ${modelName}Schema>;

// Mock Data Store
let records: any[] = [
  { id: '1', name: 'Sample Record', description: 'This is a sample generated record' }
];

/**
 * @swagger
 * /api/${basePath}:
 *   get:
 *     summary: Get all ${title} records
 *     responses:
 *       200:
 *         description: List of records
 */
app.get('/api/${basePath}', (req: Request, res: Response) => {
  res.json(records);
});

/**
 * @swagger
 * /api/${basePath}:
 *   post:
 *     summary: Create a new ${title} record
 *     responses:
 *       201:
 *         description: Created record
 */
app.post('/api/${basePath}', (req: Request, res: Response) => {
  try {
    const data = ${modelName}Schema.parse(req.body);
    const newRecord = { ...data, id: Date.now().toString() };
    records.push(newRecord);
    res.status(201).json(newRecord);
  } catch (error) {
    res.status(400).json({ error: 'Invalid data' });
  }
});

/**
 * @swagger
 * /api/${basePath}/{id}:
 *   get:
 *     summary: Get ${title} record by id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Record
 *       404:
 *         description: Not found
 */
app.get('/api/${basePath}/:id', (req: Request, res: Response) => {
  const rec = records.find((r) => r.id === req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });
  res.json(rec);
});

/**
 * @swagger
 * /api/${basePath}/{id}:
 *   put:
 *     summary: Update ${title} record
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Updated
 *       404:
 *         description: Not found
 */
app.put('/api/${basePath}/:id', (req: Request, res: Response) => {
  const i = records.findIndex((r) => r.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  const data = ${modelName}Schema.partial().parse(req.body);
  records[i] = { ...records[i], ...data };
  res.json(records[i]);
});

/**
 * @swagger
 * /api/${basePath}/{id}:
 *   delete:
 *     summary: Delete ${title} record
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Deleted
 *       404:
 *         description: Not found
 */
app.delete('/api/${basePath}/:id', (req: Request, res: Response) => {
  const i = records.findIndex((r) => r.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  records.splice(i, 1);
  res.status(204).send();
});

// Swagger Config
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: '${embeddedTitle}',
      version: '1.0.0',
      description: '${embeddedDesc}',
    },
    servers: [{ url: 'http://localhost:8743' }],
  },
  apis: ['./api.ts', './*.ts', './src/*.ts', './src/**/*.ts'],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(\`Server running on http://localhost:\${PORT}\`);
  console.log(\`Swagger UI available on http://localhost:\${PORT}/api-docs and http://localhost:\${PORT}/docs\`);
});

${fileContents ? `\n// Imported file contents:\n${fileContents}\n` : ''}`;

  return patchSwaggerUiSetupForReadableInfo(apiSource);
}

function generateOpenAPIDocumentation(title: string, description: string, code: string): string {
  return `# ${title} API Documentation

## Description
${description}

## Base URL
\`\`\`
/api/v1/${title.toLowerCase()}
\`\`\`

## Endpoints

### GET /${title.toLowerCase()}
Get all ${title.toLowerCase()} records

**Response:**
\`\`\`json
[
  {
    "id": "string",
    "name": "string",
    "description": "string",
    "createdAt": "datetime",
    "updatedAt": "datetime"
  }
]
\`\`\`

### GET /${title.toLowerCase()}/{id}
Get a specific ${title.toLowerCase()} record by ID

**Parameters:**
- \`id\` (string, required): The ID of the record

**Response:**
\`\`\`json
{
  "id": "string",
  "name": "string",
  "description": "string",
  "createdAt": "datetime",
  "updatedAt": "datetime"
}
\`\`\`

### POST /${title.toLowerCase()}
Create a new ${title.toLowerCase()} record

**Request Body:**
\`\`\`json
{
  "name": "string",
  "description": "string"
}
\`\`\`

**Response:**
\`\`\`json
{
  "id": "string",
  "name": "string",
  "description": "string",
  "createdAt": "datetime",
  "updatedAt": "datetime"
}
\`\`\`

### PUT /${title.toLowerCase()}/{id}
Update a ${title.toLowerCase()} record

**Parameters:**
- \`id\` (string, required): The ID of the record

**Request Body:**
\`\`\`json
{
  "name": "string",
  "description": "string"
}
\`\`\`

**Response:**
\`\`\`json
{
  "id": "string",
  "name": "string",
  "description": "string",
  "createdAt": "datetime",
  "updatedAt": "datetime"
}
\`\`\`

### DELETE /${title.toLowerCase()}/{id}
Delete a ${title.toLowerCase()} record

**Parameters:**
- \`id\` (string, required): The ID of the record

**Response:**
\`\`\`json
{
  "message": "Record deleted successfully"
}
\`\`\`

## Data Model

### ${title} Schema
\`\`\`typescript
interface ${title.replace(/\s+/g, '')} {
  id: string;
  name: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}
\`\`\`

## Error Responses

All endpoints may return the following error responses:

**400 Bad Request**
\`\`\`json
{
  "error": "Bad Request",
  "message": "Invalid input data"
}
\`\`\`

**404 Not Found**
\`\`\`json
{
  "error": "Not Found",
  "message": "Resource not found"
}
\`\`\`

**500 Internal Server Error**
\`\`\`json
{
  "error": "Internal Server Error",
  "message": "An unexpected error occurred"
}
\`\`\`

## Authentication
This API uses API key authentication. Include your API key in the request header:

\`\`\`
Authorization: Bearer YOUR_API_KEY
\`\`\`

## Rate Limiting
- 100 requests per minute per API key
- 1000 requests per hour per API key

## SDK Installation

\`\`\`bash
npm install ${title.toLowerCase()}-sdk
\`\`\`

## SDK Usage

\`\`\`typescript
import { ${title.replace(/\s+/g, '')}API } from '${title.toLowerCase()}-sdk';

const api = new ${title.replace(/\s+/g, '')}API();
const records = await api.getAll();
\`\`\``;
}

function generateZodSchemas(code: string): string {
  return `// Zod Schemas for Validation

import { z } from 'zod';

// Base schema
export const BaseSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// Create schema (for POST requests)
export const CreateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
  description: z.string().optional(),
});

// Update schema (for PUT requests)
export const UpdateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long').optional(),
  description: z.string().optional(),
});

// Response schema
export const ResponseSchema = BaseSchema.merge(CreateSchema);

// Query parameters schema
export const QuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
  search: z.string().optional(),
  sortBy: z.enum(['name', 'createdAt', 'updatedAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// Error response schema
export const ErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
  details: z.any().optional(),
});

// Types
export type CreateInput = z.infer<typeof CreateSchema>;
export type UpdateInput = z.infer<typeof UpdateSchema>;
export type QueryInput = z.infer<typeof QuerySchema>;
export type Response = z.infer<typeof ResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorSchema>;

// Validation middleware example
export const validateCreate = (data: unknown) => {
  return CreateSchema.parse(data);
};

export const validateUpdate = (data: unknown) => {
  return UpdateSchema.parse(data);
};

export const validateQuery = (data: unknown) => {
  return QuerySchema.parse(data);
};`;
}

function generateEndpoints(title: string, description: string): any[] {
  // Eliminamos los 5 endpoints genéricos para evitar confusión.
  // El sistema ahora confía en la extracción dinámica y el rescate por Regex.
  return [];
}
