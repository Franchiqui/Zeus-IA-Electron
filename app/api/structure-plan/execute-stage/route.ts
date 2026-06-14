import { NextRequest, NextResponse } from 'next/server';
import PocketBase from 'pocketbase';
import { MODELOS_COLLECTION_NAME, MODELOS_FIELDS } from '@/lib/collections';
import fs from 'fs/promises';
import path from 'path';
import { getBaseDataPath } from '@/lib/env';
import { callModelGeneric } from '@/api/zeus-model-api/generic-model-call';

type ExecuteStageBody = {
  stage: {
    number: number;
    name: string;
    objective: string;
    tasks: string[];
    files: string[];
    dependencies: string[];
  };
  previousStages: any[];
  modelId?: string;
  projectTitle: string;
  projectDescription: string;
  projectStructure?: {
    folders?: string[];
    files?: string[];
    overview?: string;
  };
  executionConfig?: {
    planningMaxTokens?: number;
    fileMaxTokens?: number;
    finalMaxTokens?: number;
    maxFileContentChars?: number;
  };
  modelConfigOverride?: {
    endpoint?: string;
    modelName?: string;
    apiKey?: string;
    provider?: string;
  };
  alreadyCreatedFiles?: string[];
  projectContext?: {
    overview: string;
    folders: string[];
    files: string[];
  };
};

export const runtime = 'nodejs';

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function parseModelJsonResponse(rawResponse: string) {
  const trimmedRaw = String(rawResponse || '').trim();

  try {
    return JSON.parse(trimmedRaw);
  } catch {
    // continue with fallbacks
  }

  const fencedJsonMatch = trimmedRaw.match(/```json\s*([\s\S]*?)```/i);
  if (fencedJsonMatch?.[1]) {
    try {
      return JSON.parse(fencedJsonMatch[1].trim());
    } catch {
      // continue with fallbacks
    }
  }

  const withoutFences = trimmedRaw.replace(/```[a-zA-Z0-9_-]*\s*/g, '').replace(/```/g, '').trim();

  try {
    return JSON.parse(withoutFences);
  } catch {
    const objectStart = withoutFences.indexOf('{');
    const objectEnd = withoutFences.lastIndexOf('}');

    if (objectStart !== -1 && objectEnd > objectStart) {
      const possibleJson = withoutFences.slice(objectStart, objectEnd + 1);
      return JSON.parse(possibleJson);
    }

    throw new Error('Invalid JSON response');
  }
}

function parseGeneratedFileResponse(rawResponse: string, fallbackPath: string) {
  try {
    // Intentar extraer contenido de bloque de código markdown
    const codeBlockMatch = rawResponse.match(/```(?:[a-zA-Z0-9_+-]*)?\s*\n([\s\S]*?)```/);
    if (codeBlockMatch?.[1]) {
      return {
        path: fallbackPath,
        content: codeBlockMatch[1].trim(),
      };
    }
  } catch {
    // ignore and continue to fallbacks
  }

  // Fallback: usar la respuesta directamente si no hay bloque de código
  const text = String(rawResponse || '').trim();
  return {
    path: fallbackPath,
    content: text,
  };
}

type ModelResponseOptions = {
  maxTokens?: number;
  signal?: AbortSignal;
};

function isTransientFetchError(error: any) {
  if (!error) return false;
  if (error?.name === 'AbortError') return false;

  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('fetch failed') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('etimedout') ||
    message.includes('socket hang up')
  );
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string, init: RequestInit, options?: { retries?: number; retryDelayMs?: number; context?: string }) {
  const retries = Math.max(0, options?.retries ?? 2);
  const retryDelayMs = Math.max(0, options?.retryDelayMs ?? 600);
  const context = options?.context || 'fetch';

  let lastError: any = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetch(url, init);
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw error;
      }

      lastError = error;
      const shouldRetry = attempt < retries && isTransientFetchError(error);
      if (!shouldRetry) {
        break;
      }

      const backoffMs = retryDelayMs * (attempt + 1);
      await sleep(backoffMs);
    }
  }

  const errorMessage = lastError?.message || 'unknown fetch error';
  throw new Error(`${context}: ${errorMessage}`);
}

function normalizePlanName(name: string) {
  const safe = String(name || '').trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_-]/g, '');
  return safe || `structure-plan-${Date.now()}`;
}

function normalizeProjectFolderName(name: string) {
  const safe = String(name || '')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\.+$/, '')
    .trim();

  return safe || `project-${Date.now()}`;
}

function splitFilePath(filePath: string) {
  const normalized = String(filePath || '').replace(/\\/g, '/').trim();
  const parts = normalized.split('/').filter(Boolean);
  const fileNameWithExt = parts.pop() || 'file.txt';

  const dotIndex = fileNameWithExt.lastIndexOf('.');
  const hasExt = dotIndex > 0 && dotIndex < fileNameWithExt.length - 1;

  return {
    name: hasExt ? fileNameWithExt.slice(0, dotIndex) : fileNameWithExt,
    extension: hasExt ? fileNameWithExt.slice(dotIndex + 1) : '',
    path: parts.join('/'),
  };
}

function normalizeFilePath(filePath: string) {
  return String(filePath || '').trim().replace(/\\/g, '/').toLowerCase();
}

/**
 * Estima el número de tokens en un texto (aproximación: ~4 caracteres por token para código)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Divide el contenido en partes lógicas basándose en estructura de código
 * Intenta dividir por funciones, clases, o bloques de código
 */
function splitContentByLogicalStructure(content: string, maxTokens: number): string[] {
  const parts: string[] = [];
  const lines = content.split('\n');
  let currentPart: string[] = [];
  let currentTokens = 0;
  let currentBlockLevel = 0;

  for (const line of lines) {
    const lineTokens = estimateTokens(line);
    
    // Detectar inicio/fin de bloques (funciones, clases, etc.)
    const openBraces = (line.match(/{/g) || []).length;
    const closeBraces = (line.match(/}/g) || []).length;
    const openParens = (line.match(/\(/g) || []).length;
    const closeParens = (line.match(/\)/g) || []).length;
    
    const blockStart = openBraces > closeBraces || openParens > closeParens;
    const blockEnd = closeBraces > openBraces || closeParens > openParens;
    
    if (blockStart) currentBlockLevel++;
    if (blockEnd) currentBlockLevel--;
    
    // Si agregar esta línea excede el límite y no estamos dentro de un bloque
    if (currentTokens + lineTokens > maxTokens && currentBlockLevel === 0 && currentPart.length > 0) {
      parts.push(currentPart.join('\n'));
      currentPart = [line];
      currentTokens = lineTokens;
    } else {
      currentPart.push(line);
      currentTokens += lineTokens;
    }
  }
  
  // Agregar la última parte si existe
  if (currentPart.length > 0) {
    parts.push(currentPart.join('\n'));
  }
  
  // Fallback: si no se pudo dividir por bloques, dividir por líneas
  if (parts.length === 1 && estimateTokens(content) > maxTokens) {
    const fallbackParts: string[] = [];
    let fallbackPart: string[] = [];
    let fallbackTokens = 0;
    
    for (const line of lines) {
      const lineTokens = estimateTokens(line);
      
      if (fallbackTokens + lineTokens > maxTokens && fallbackPart.length > 0) {
        fallbackParts.push(fallbackPart.join('\n'));
        fallbackPart = [line];
        fallbackTokens = lineTokens;
      } else {
        fallbackPart.push(line);
        fallbackTokens += lineTokens;
      }
    }
    
    if (fallbackPart.length > 0) {
      fallbackParts.push(fallbackPart.join('\n'));
    }
    
    return fallbackParts.length > 1 ? fallbackParts : [content];
  }
  
  return parts.length > 1 ? parts : [content];
}

/**
 * Genera una parte específica de un archivo con contexto de las partes anteriores
 */
async function generateFilePart(
  filePath: string,
  partIndex: number,
  totalParts: number,
  contentSoFar: string,
  remainingContent: string,
  projectTitle: string,
  projectDescription: string,
  stage: any,
  previousContext: string,
  modelConfig: any,
  tokenBudget: number,
  signal?: AbortSignal
): Promise<string> {
  const partSystemPrompt = `Eres un experto en desarrollo de software.
Tu tarea es generar una parte específica de un archivo grande.

INSTRUCCIONES:
1. Este es el archivo: ${filePath}
2. Estás generando la parte ${partIndex + 1} de ${totalParts}
3. El contenido generado hasta ahora es:
${contentSoFar ? '--- CONTENIDO GENERADO HASTA AHORA ---\n' + contentSoFar + '\n--- FIN CONTENIDO GENERADO ---\n' : '(Este es el inicio del archivo)'}
4. Debes continuar el archivo desde donde terminó
5. Genera SOLO el contenido de esta parte, sin explicaciones
6. Asegúrate de que el código sea coherente y funcional
7. NO uses JSON. NO escapes caracteres. Escribe el código tal como debe ser guardado en el archivo.

IMPORTANTE: Responde con el contenido de esta parte directamente en un bloque de código markdown.

Formato de respuesta:
\`\`\`[lenguaje]
[contenido de esta parte del archivo]
\`\`\``;

  const partUserPrompt = `Genera la parte ${partIndex + 1} de ${totalParts} del archivo ${filePath}:

PROYECTO: ${projectTitle}
DESCRIPCIÓN: ${projectDescription}

ETAPA ACTUAL: ${stage.number} - ${stage.name}
Objetivo: ${stage.objective}${previousContext}

Por favor, genera el contenido de esta parte en un bloque de código markdown. NO uses JSON.`;

  const partResponse = await getModelResponse([
    { role: 'system', content: partSystemPrompt },
    { role: 'user', content: partUserPrompt },
  ], modelConfig, { maxTokens: tokenBudget, signal });

  // Extraer contenido del bloque de código markdown
  try {
    const codeBlockMatch = partResponse.match(/```(?:[a-zA-Z0-9_+-]*)?\s*\n([\s\S]*?)```/);
    if (codeBlockMatch?.[1]) {
      return codeBlockMatch[1].trim();
    }
  } catch {
    // Fallback: usar la respuesta directamente
  }

  return partResponse;
}

function withProjectRoot(filePath: string, projectRootFolder: string) {
  const normalizedPath = String(filePath || '').replace(/\\/g, '/').trim().replace(/^\/+/, '');
  if (!normalizedPath) {
    return `${projectRootFolder}/untitled.txt`;
  }

  const lowerPath = normalizedPath.toLowerCase();
  const lowerRoot = projectRootFolder.toLowerCase();
  if (lowerPath === lowerRoot || lowerPath.startsWith(`${lowerRoot}/`)) {
    return normalizedPath;
  }

  return `${projectRootFolder}/${normalizedPath}`;
}

async function ensurePlanExists(apiBaseUrl: string, planName: string, description: string, signal?: AbortSignal) {
  const response = await fetchWithRetry(`${apiBaseUrl}/plan`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    signal,
    body: JSON.stringify({
      name: planName,
      description,
    }),
  }, {
    retries: 2,
    retryDelayMs: 500,
    context: 'Automation API /plan',
  });

  if (response.ok) return;

  let errorText = '';
  try {
    errorText = await response.text();
  } catch {
    errorText = '';
  }

  const normalizedError = errorText.toLowerCase();
  if (normalizedError.includes('ya existe') || normalizedError.includes('already exists')) {
    return;
  }

  throw new Error(`No se pudo crear/asegurar el plan '${planName}': ${errorText || response.statusText}`);
}

async function ensureProjectRootFolderTask(apiBaseUrl: string, planName: string, folderName: string, signal?: AbortSignal) {
  const response = await fetchWithRetry(`${apiBaseUrl}/plan/tasks/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    signal,
    body: JSON.stringify({
      planName,
      name: folderName,
      type: 'folder',
      operation: 'create',
      path: '',
    }),
  }, {
    retries: 2,
    retryDelayMs: 500,
    context: 'Automation API /plan/tasks/create (root folder)',
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`No se pudo crear carpeta raíz '${folderName}': ${errorText || response.statusText}`);
  }
}

async function saveFileDirectlyToDataPath(filePath: string, content: string) {
  const basePath = getBaseDataPath();
  const safeFilePath = String(filePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const targetPath = path.resolve(path.join(basePath, safeFilePath));

  // Seguridad: asegurar que el archivo queda dentro de DATA_PATH
  if (!targetPath.toLowerCase().startsWith(basePath.toLowerCase())) {
    throw new Error(`Ruta no permitida: ${safeFilePath}`);
  }

  // Crear directorios intermedios si no existen
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, content, 'utf8');
  return { path: safeFilePath, saved: true };
}

async function saveAndExecuteFileTask(apiBaseUrl: string, planName: string, filePath: string, content: string, signal?: AbortSignal) {
  const fileInfo = splitFilePath(filePath);
  const response = await fetchWithRetry(`${apiBaseUrl}/plan/tasks/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    signal,
    body: JSON.stringify({
      planName,
      name: fileInfo.name,
      extension: fileInfo.extension,
      type: 'file',
      operation: 'create',
      path: fileInfo.path,
      content: content || '',
    }),
  }, {
    retries: 2,
    retryDelayMs: 450,
    context: `Automation API /plan/tasks/create (${filePath})`,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`No se pudo guardar/ejecutar tarea para ${filePath}: ${errorText || response.statusText}`);
  }

  return response.json().catch(() => null);
}

function normalizeLocalEndpoint(endpoint: string) {
  const trimmed = endpoint.trim().replace(/\/$/, '');
  if (trimmed.endsWith('/v1/chat/completions') || trimmed.endsWith('/api/chat')) {
    return trimmed;
  }
  return `${trimmed}/v1/chat/completions`;
}

async function getModelResponse(messages: any[], modelConfig: any, options: ModelResponseOptions = {}) {
  const { endpoint, modelName, apiKey, provider } = modelConfig;
  const { maxTokens, signal } = options;

  if (!endpoint || !modelName) {
    throw new Error('No hay configuración de modelo disponible');
  }

  console.log(`Conectando a modelo (${provider || 'remoto'})...`);

  return await callModelGeneric(
    {
      provider: provider || 'openai',
      model: modelName,
      url: endpoint,
      apiKey,
    },
    messages,
    { temperature: 0.7, maxTokens, signal }
  );
}

export async function POST(request: NextRequest) {
  try {
    const body: ExecuteStageBody = await request.json();
    const { stage, previousStages, modelId, projectTitle, projectDescription, projectStructure, executionConfig, modelConfigOverride, alreadyCreatedFiles = [], projectContext } = body;
    const requestSignal = request.signal;

    const alreadyCreatedSet = new Set(
      (alreadyCreatedFiles || []).map((f) => normalizeFilePath(f))
    );
    const automationApiBaseUrl = process.env.ZEUS_AUTOMATION_API_URL || 'http://localhost:8742/api';
    const stagePlanName = normalizePlanName(projectTitle || `structure-stage-${stage?.number || Date.now()}`);
    const projectRootFolder = normalizeProjectFolderName(projectTitle || stagePlanName);

    const throwIfAborted = () => {
      if (requestSignal?.aborted) {
        throw new Error('Execution aborted by client');
      }
    };

    if (!stage || !stage.number) {
      return NextResponse.json(
        { error: 'Faltan parámetros requeridos: stage' },
        { status: 400 }
      );
    }

    // Obtener configuración del modelo
    let modelConfig: any = {
      endpoint: process.env.LM_STUDIO_URL || process.env.OPENAI_API_URL,
      modelName: process.env.LM_STUDIO_MODEL || process.env.OPENAI_MODEL || process.env.DEFAULT_CHAT_MODEL || 'gpt-4o-mini',
      apiKey: process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || '',
    };

    // Si se proporciona modelId, intentar obtener la configuración desde PocketBase
    if (modelId) {
      try {
        const pb = new PocketBase(process.env.POCKETBASE_URL || 'http://localhost:8091');

        if (process.env.POCKETBASE_EMAIL && process.env.POCKETBASE_PASSWORD) {
          await pb.admins.authWithPassword(process.env.POCKETBASE_EMAIL, process.env.POCKETBASE_PASSWORD);
        }

        const modelRecord = await pb.collection(MODELOS_COLLECTION_NAME).getOne(modelId);
        
        if (modelRecord) {
          modelConfig = {
            endpoint:
              modelRecord[MODELOS_FIELDS.BASE_URL] ||
              modelRecord.endpoint ||
              modelConfig.endpoint,
            modelName:
              modelRecord[MODELOS_FIELDS.MODEL_NAME] ||
              modelRecord[MODELOS_FIELDS.NAME] ||
              modelRecord.nombre_modelo ||
              modelConfig.modelName,
            apiKey:
              modelRecord[MODELOS_FIELDS.API_KEY] ||
              modelRecord.api_key ||
              modelConfig.apiKey,
            provider:
              modelRecord[MODELOS_FIELDS.PROVIDER] ||
              modelRecord.provider ||
              modelConfig.provider,
          };
        }
      } catch (error) {
        console.error('Error al obtener configuración del modelo desde PocketBase:', error);
      }
    }

    if (modelConfigOverride) {
      modelConfig = {
        ...modelConfig,
        ...(modelConfigOverride.endpoint ? { endpoint: modelConfigOverride.endpoint } : {}),
        ...(modelConfigOverride.modelName ? { modelName: modelConfigOverride.modelName } : {}),
        ...(modelConfigOverride.apiKey !== undefined ? { apiKey: modelConfigOverride.apiKey } : {}),
        ...(modelConfigOverride.provider ? { provider: modelConfigOverride.provider } : {}),
      };
    }

    // Construir el contexto de etapas anteriores
    let previousContext = '';
    if (previousStages && previousStages.length > 0) {
      previousContext = '\n\nCONTEXTO DE ETAPAS ANTERIORES:\n';
      previousStages.forEach((prevStage: any) => {
        previousContext += `\nEtapa ${prevStage.number}: ${prevStage.name}\n`;
        previousContext += `- Objetivo: ${prevStage.objective}\n`;
        if (prevStage.tasks && prevStage.tasks.length > 0) {
          previousContext += `- Tareas completadas: ${prevStage.tasks.join(', ')}\n`;
        }
        if (prevStage.files && prevStage.files.length > 0) {
          previousContext += `- Archivos creados: ${prevStage.files.join(', ')}\n`;
        }
      });
      previousContext += '\nEstas etapas ya han sido completadas. Usa esta información para continuar el proyecto.\n';
    }

    // Crear un stream para enviar los archivos uno por uno
    const encoder = new TextEncoder();
    const normalizedProvider = String(modelConfig?.provider || '').toLowerCase();
    const isOllama = normalizedProvider === 'ollama';
    const isLocalModel = isOllama || !!(modelConfig?.endpoint && modelConfig.endpoint.includes('localhost'));
    const defaultTokenBudget = {
      planning: isLocalModel ? 600 : 1200,
      file: isLocalModel ? 1200 : 2800,
      final: isLocalModel ? 500 : 1000,
    };
    const defaultMaxFileContentChars = isLocalModel ? 14000 : 50000;

    const tokenBudget = {
      planning: clampNumber(executionConfig?.planningMaxTokens, 100, 4000, defaultTokenBudget.planning),
      file: clampNumber(executionConfig?.fileMaxTokens, 200, 8000, defaultTokenBudget.file),
      final: clampNumber(executionConfig?.finalMaxTokens, 100, 4000, defaultTokenBudget.final),
    };
    const maxFileContentChars = clampNumber(
      executionConfig?.maxFileContentChars,
      2000,
      120000,
      defaultMaxFileContentChars
    );

    const stream = new ReadableStream({
      async start(controller) {
        try {
          throwIfAborted();

          // Solo crear plan de automatización cuando NO estamos en modo contexto de proyecto existente
          if (!projectContext) {
            await ensurePlanExists(
              automationApiBaseUrl,
              stagePlanName,
              `Plan generado automáticamente desde Structure Plan para ${projectTitle || 'proyecto'} (etapa ${stage.number})`,
              requestSignal
            );

            if (stage.number === 1) {
              await ensureProjectRootFolderTask(
                automationApiBaseUrl,
                stagePlanName,
                projectRootFolder,
                requestSignal
              );
            }
          }

          // Enviar metadata inicial
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'start', stageNumber: stage.number, stageName: stage.name })}\n\n`));

          // Paso 1: Generar el plan de archivos (resumen y lista de archivos)
          // Construir lista de archivos de la estructura
          const structureFilesList = projectStructure?.files && projectStructure.files.length > 0
            ? `\n\nARCHIVOS DEFINIDOS EN LA ESTRUCTURA DEL PROYECTO (SOLO puedes usar estos):\n${projectStructure.files.join('\n')}`
            : '';

          // Contexto del proyecto existente
          const existingProjectContext = projectContext
            ? `\n\nESTRUCTURA DEL PROYECTO EXISTENTE:\n${projectContext.overview}\n\nCARPETAS EXISTENTES:\n${projectContext.folders.slice(0, 60).join('\n')}${projectContext.folders.length > 60 ? '\n...' : ''}\n\nARCHIVOS EXISTENTES:\n${projectContext.files.slice(0, 80).join('\n')}${projectContext.files.length > 80 ? '\n...' : ''}\n\nINSTRUCCIÓN CRÍTICA: Este es un proyecto YA EXISTENTE. Todo lo que generes debe ser COMPATIBLE con la estructura, tecnologías y convenciones del proyecto existente. No generes archivos que ya existan a menos que se indique explícitamente que deben modificarse.`
            : '';

          const planningSystemPrompt = `Eres un experto en desarrollo de software.
Tu tarea es planificar qué archivos se necesitan para implementar una etapa específica de un proyecto.

INSTRUCCIONES:
1. Genera un resumen de lo que se implementará en esta etapa
2. Lista los archivos que se necesitan crear/modificar
3. NO generes el contenido de los archivos todavía, solo la lista
4. SOLO puedes usar archivos que estén definidos en la estructura del proyecto
5. NO inventes nuevos archivos ni rutas de archivos
${projectContext ? '6. ESTE PROYECTO YA EXISTE: todo lo que planifiques debe integrarse perfectamente con la estructura, tecnologías y convenciones del proyecto existente.' : ''}

Responde en formato JSON con la siguiente estructura:
{
  "summary": "resumen de lo que se implementará",
  "files": [
    {
      "path": "ruta/del/archivo.ext",
      "description": "breve descripción de qué contendrá este archivo"
    }
  ]
}`;

          const alreadyCreatedList = alreadyCreatedSet.size > 0
            ? `\n\nARCHIVOS YA CREADOS (NO los incluyas en el plan):\n${Array.from(alreadyCreatedSet).join('\n')}`
            : '';

          const planningUserPrompt = `Planifica los archivos necesarios para la siguiente etapa:

PROYECTO: ${projectTitle}
DESCRIPCIÓN: ${projectDescription}${structureFilesList}${existingProjectContext}

ETAPA ACTUAL:
Número: ${stage.number}
Nombre: ${stage.name}
Objetivo: ${stage.objective}
Tareas: ${stage.tasks ? stage.tasks.join(', ') : 'N/A'}
Archivos sugeridos: ${stage.files ? stage.files.join(', ') : 'N/A'}
Dependencias: ${stage.dependencies ? stage.dependencies.join(', ') : 'N/A'}${previousContext}${alreadyCreatedList}

REGLA IMPORTANTE (OBLIGATORIA):
${structureFilesList}
- SOLO puedes incluir archivos que estén en la lista de archivos de la estructura del proyecto
- NO inventes nuevos archivos
- Si no hay archivos definidos, pide al usuario que defina la estructura primero
- ${alreadyCreatedSet.size > 0 ? 'NO incluyas en "files" ninguno de los archivos ya creados listados arriba' : ''}
${projectContext ? '- NO generes archivos que ya existan en el proyecto, salvo que deban modificarse.' : ''}

Por favor, genera el plan en formato JSON como se especifica en las instrucciones. NO INVENTES ARCHIVOS.`;

          const planningResponse = await getModelResponse([
            { role: 'system', content: planningSystemPrompt },
            { role: 'user', content: planningUserPrompt },
          ], modelConfig, { maxTokens: tokenBudget.planning, signal: requestSignal });

          let planningData: any;
          try {
            planningData = parseModelJsonResponse(planningResponse);
          } catch (parseError) {
            const fallbackFiles = Array.isArray(stage.files)
              ? stage.files
                  .filter((filePath) => typeof filePath === 'string' && filePath.trim())
                  .map((filePath) => ({ path: String(filePath).trim(), description: 'Archivo definido en la etapa del plan.' }))
              : [];

            planningData = {
              summary: `Implementación de la etapa ${stage.number}: ${stage.name}`,
              files: fallbackFiles,
            };
          }

          // Enviar el resumen
          if (planningData.summary) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'summary', content: planningData.summary })}\n\n`));
          }

          // Paso 2: Generar el contenido de cada archivo uno por uno
          const generatedFiles: any[] = [];
          const generatedFilePathSet = new Set<string>();

          if (planningData.files && Array.isArray(planningData.files)) {
            for (const filePlan of planningData.files) {
              throwIfAborted();

              const plannedPath = typeof filePlan?.path === 'string' ? filePlan.path.trim() : '';
              if (!plannedPath) {
                continue;
              }

              const normalizedPlannedPath = normalizeFilePath(plannedPath);
              if (generatedFilePathSet.has(normalizedPlannedPath)) {
                continue;
              }
              if (alreadyCreatedSet.has(normalizedPlannedPath)) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'file_skipped', path: plannedPath, reason: 'already_created' })}
\n\n`));
                continue;
              }
              generatedFilePathSet.add(normalizedPlannedPath);

              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'file_start', path: plannedPath })}\n\n`));

              const fileSystemPrompt = `Eres un experto en desarrollo de software.
Tu tarea es generar el contenido de un archivo específico para implementar una etapa de un proyecto.

INSTRUCCIONES:
1. Genera el contenido completo del archivo
2. El código debe ser funcional y bien estructurado
3. Incluye comentarios cuando sea apropiado
4. Devuelve SOLO el contenido del archivo, sin explicaciones adicionales
${projectContext ? '5. ESTE PROYECTO YA EXISTE: el código que generes debe ser COMPATIBLE con la estructura, tecnologías, frameworks y convenciones del proyecto existente. Usa los mismos patrones de código, estilos de importación y arquitectura que el proyecto ya tiene.' : ''}

IMPORTANTE: Responde con el contenido del archivo directamente en un bloque de código markdown.
NO uses JSON. NO escapes caracteres. Escribe el código tal como debe ser guardado en el archivo.

Formato de respuesta:
\`\`\`[lenguaje]
[contenido del archivo]
\`\`\``;

              const fileUserPrompt = `Genera el contenido del siguiente archivo:

PROYECTO: ${projectTitle}
DESCRIPCIÓN: ${projectDescription}${existingProjectContext}

ETAPA ACTUAL: ${stage.number} - ${stage.name}
Objetivo: ${stage.objective}

ARCHIVO: ${plannedPath}
Descripción: ${filePlan.description || 'No especificada'}${previousContext}

${projectContext ? 'REGLA IMPORTANTE: Este archivo pertenece a un proyecto YA EXISTENTE. Genera el código de forma que se integre perfectamente con la estructura, tecnologías y convenciones del proyecto existente. Usa los mismos patrones que ya se usan en el proyecto.' : ''}

Por favor, genera el contenido del archivo en un bloque de código markdown. NO uses JSON. Escribe el código tal como debe ser guardado en el archivo.`;

              // Para modelos locales, generar archivos grandes en múltiples llamadas
              let fileData: any;
              if (isLocalModel) {
                // Primero generar un resumen/estructura del archivo para estimar su tamaño
                const structureSystemPrompt = `Eres un experto en desarrollo de software.
Tu tarea es generar un resumen de la estructura del archivo y estimar su tamaño.

INSTRUCCIONES:
1. Describe brevemente qué contendrá el archivo
2. Estima cuántas líneas de código tendrá aproximadamente
3. Si el archivo será muy grande (más de 100 líneas), indícalo

Responde en formato JSON con la siguiente estructura:
{
  "description": "descripción breve del archivo",
  "estimatedLines": número aproximado de líneas,
  "isLarge": true/false
}`;

                const structureResponse = await getModelResponse([
                  { role: 'system', content: structureSystemPrompt },
                  { role: 'user', content: fileUserPrompt },
                ], modelConfig, { maxTokens: 300, signal: requestSignal });

                let structureData: any;
                try {
                  structureData = parseModelJsonResponse(structureResponse);
                } catch {
                  structureData = { estimatedLines: 50, isLarge: false };
                }

                // Si se estima que el archivo será grande, generarlo en partes
                const MAX_TOKENS_PER_PART = 3000;
                const estimatedTokens = (structureData.estimatedLines || 50) * 20; // ~20 tokens por línea

                if (estimatedTokens > MAX_TOKENS_PER_PART) {
                  console.log(`Archivo grande estimado (${estimatedTokens} tokens), generando en partes para modelo local...`);

                  // Generar la primera parte
                  const firstPartPrompt = `${fileUserPrompt}\n\nEste es un archivo grande. Genera SOLO la primera parte (aproximadamente 3000 tokens o 150 líneas). No generes el archivo completo, solo el inicio.`;

                  const firstPartResponse = await getModelResponse([
                    { role: 'system', content: fileSystemPrompt },
                    { role: 'user', content: firstPartPrompt },
                  ], modelConfig, { maxTokens: MAX_TOKENS_PER_PART, signal: requestSignal });

                  const firstPartData = parseGeneratedFileResponse(firstPartResponse, plannedPath);
                  let fullContent = firstPartData.content || '';

                  // Generar partes adicionales
                  let partIndex = 1;
                  let shouldContinue = true;

                  while (shouldContinue) {
                    throwIfAborted();

                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'file_part', part: partIndex + 1, path: plannedPath })}\n\n`));

                    const continuationPrompt = `${fileUserPrompt}\n\nContinúa generando el archivo desde donde terminó. Aquí está el contenido generado hasta ahora:\n\n${fullContent.slice(-2000)}\n\nGenera la siguiente parte (aproximadamente 3000 tokens o 150 líneas más). Si el archivo está completo, responde con "FILE_COMPLETE".`;

                    const continuationResponse = await getModelResponse([
                      { role: 'system', content: fileSystemPrompt },
                      { role: 'user', content: continuationPrompt },
                    ], modelConfig, { maxTokens: MAX_TOKENS_PER_PART, signal: requestSignal });

                    if (continuationResponse.includes('FILE_COMPLETE') || continuationResponse.toLowerCase().includes('completado')) {
                      shouldContinue = false;
                    } else {
                      const continuationData = parseGeneratedFileResponse(continuationResponse, plannedPath);
                      if (continuationData.content) {
                        fullContent += '\n' + continuationData.content;
                        partIndex++;
                      } else {
                        shouldContinue = false;
                      }
                    }

                    // Límite de seguridad para evitar bucles infinitos
                    if (partIndex > 10) {
                      console.log('Límite de partes alcanzado, deteniendo generación');
                      shouldContinue = false;
                    }
                  }

                  fileData = {
                    path: plannedPath,
                    content: fullContent,
                    parts: partIndex + 1
                  };
                } else {
                  // Archivo pequeño, generar normalmente
                  const fileResponse = await getModelResponse([
                    { role: 'system', content: fileSystemPrompt },
                    { role: 'user', content: fileUserPrompt },
                  ], modelConfig, { maxTokens: tokenBudget.file, signal: requestSignal });

                  fileData = parseGeneratedFileResponse(fileResponse, plannedPath);
                }
              } else {
                // Modelo remoto, generar normalmente
                const fileResponse = await getModelResponse([
                  { role: 'system', content: fileSystemPrompt },
                  { role: 'user', content: fileUserPrompt },
                ], modelConfig, { maxTokens: tokenBudget.file, signal: requestSignal });

                fileData = parseGeneratedFileResponse(fileResponse, plannedPath);
              }

              if (!fileData.path || typeof fileData.path !== 'string') {
                fileData.path = plannedPath;
              }

              // Solo añadir carpeta raíz del plan cuando NO estamos en modo proyecto existente
              if (!projectContext) {
                fileData.path = withProjectRoot(fileData.path, projectRootFolder);
              }

              // Aplicar límite de caracteres para modelos locales
              if (typeof fileData.content === 'string' && fileData.content.length > maxFileContentChars) {
                fileData.content = `${fileData.content.slice(0, maxFileContentChars)}\n\n// [truncated] Contenido recortado para evitar respuestas demasiado grandes.`;
              }

              try {
                let taskResult: any;
                if (projectContext) {
                  // Modo proyecto existente: guardar directamente en DATA_PATH
                  taskResult = await saveFileDirectlyToDataPath(fileData.path, fileData.content);
                } else {
                  // Modo nuevo proyecto: usar API de automatización
                  taskResult = await saveAndExecuteFileTask(
                    automationApiBaseUrl,
                    stagePlanName,
                    fileData.path,
                    fileData.content,
                    requestSignal
                  );
                }

                fileData.persisted = {
                  planName: stagePlanName,
                  rootFolder: projectContext ? 'DATA_PATH' : projectRootFolder,
                  saved: true,
                  taskResult,
                };
              } catch (persistError: any) {
                fileData.persisted = {
                  planName: stagePlanName,
                  rootFolder: projectContext ? 'DATA_PATH' : projectRootFolder,
                  saved: false,
                  error: persistError?.message || 'Error al persistir archivo',
                };
              }

              generatedFiles.push(fileData);
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'file', file: fileData })}\n\n`));
            }
          }

          // Paso 3: Generar explicación y próximos pasos
          const finalSystemPrompt = `Eres un experto en desarrollo de software.
Tu tarea es generar una explicación de la implementación realizada y sugerir los próximos pasos.

INSTRUCCIONES:
1. Explica brevemente lo que se ha implementado
2. Sugiere los próximos pasos lógicos para continuar el proyecto
${projectContext ? '3. ESTE PROYECTO YA EXISTE: los próximos pasos deben ser coherentes con la estructura, tecnologías y convenciones del proyecto existente.' : ''}

Responde en formato JSON con la siguiente estructura:
{
  "explanation": "explicación de la implementación",
  "nextSteps": ["paso 1", "paso 2", ...]
}`;

          const finalUserPrompt = `Genera la explicación y próximos pasos para la siguiente etapa:

PROYECTO: ${projectTitle}
DESCRIPCIÓN: ${projectDescription}${existingProjectContext}

ETAPA COMPLETADA: ${stage.number} - ${stage.name}
Objetivo: ${stage.objective}
Archivos generados: ${generatedFiles.map(f => f.path).join(', ')}${previousContext}

${projectContext ? 'REGLA IMPORTANTE: Este proyecto YA EXISTE. Los próximos pasos deben ser coherentes con la estructura, tecnologías y convenciones del proyecto existente.' : ''}

Por favor, genera la explicación y próximos pasos en formato JSON como se especifica en las instrucciones.`;

          const finalResponse = await getModelResponse([
            { role: 'system', content: finalSystemPrompt },
            { role: 'user', content: finalUserPrompt },
          ], modelConfig, { maxTokens: tokenBudget.final, signal: requestSignal });

          let finalData;
          try {
            finalData = parseModelJsonResponse(finalResponse);
          } catch (parseError) {
            finalData = {
              explanation: finalResponse,
              nextSteps: [],
            };
          }

          // Enviar la explicación
          if (finalData.explanation) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'explanation', content: finalData.explanation })}\n\n`));
          }

          // Enviar los próximos pasos
          if (finalData.nextSteps && Array.isArray(finalData.nextSteps)) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'nextSteps', steps: finalData.nextSteps })}\n\n`));
          }

          // Enviar señal de completado
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'complete', data: { summary: planningData.summary, files: generatedFiles, explanation: finalData.explanation, nextSteps: finalData.nextSteps } })}\n\n`));
          controller.close();
        } catch (error: any) {
          if (requestSignal?.aborted || error?.name === 'AbortError' || error?.message === 'Execution aborted by client') {
            try {
              controller.close();
            } catch {}
            return;
          }

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`));
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error: any) {
    console.error('Error en execute stage:', error);
    return NextResponse.json(
      { error: error.message || 'Error al ejecutar la etapa' },
      { status: 500 }
    );
  }
}
