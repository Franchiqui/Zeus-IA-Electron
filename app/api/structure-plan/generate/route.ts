import { NextRequest, NextResponse } from 'next/server';
import PocketBase from 'pocketbase';
import { MODELOS_COLLECTION_NAME, MODELOS_FIELDS } from '@/lib/collections';
import { callModelGeneric } from '@/api/zeus-model-api/generic-model-call';

type GeneratePlanBody = {
  title: string;
  description: string;
  stages: number;
  modelId?: string;
  startFromStage?: number;
  existingStages?: any[];
  projectContext?: {
    overview: string;
    folders: string[];
    files: string[];
  };
};

export const runtime = 'nodejs';

// Obtener endpoint por defecto según el provider/type
function getDefaultEndpoint(provider: string | undefined, type: string | undefined): string | undefined {
  const normalizedProvider = String(provider || '').toLowerCase();
  const normalizedType = String(type || '').toLowerCase();

  // Si type indica modelo remoto, usar endpoint correspondiente
  if (normalizedType === 'openai') return 'https://api.openai.com/v1/chat/completions';
  if (normalizedType === 'deepseek') return 'https://api.deepseek.com/chat/completions';
  if (normalizedType === 'google') return 'https://generativelanguage.googleapis.com/v1beta/models';
  if (normalizedType === 'anthropic') return 'https://api.anthropic.com/v1/messages';

  // Si provider indica modelo remoto, usar endpoint correspondiente
  if (normalizedProvider === 'openai') return 'https://api.openai.com/v1/chat/completions';
  if (normalizedProvider === 'deepseek') return 'https://api.deepseek.com/chat/completions';
  if (normalizedProvider === 'google') return 'https://generativelanguage.googleapis.com/v1beta/models';
  if (normalizedProvider === 'anthropic') return 'https://api.anthropic.com/v1/messages';

  return undefined;
}

async function getModelResponse(messages: any[], modelConfig: any) {
  const { endpoint, modelName, apiKey, provider, type, is_local } = modelConfig;
  const normalizedProvider = String(provider || '').toLowerCase();
  const normalizedType = String(type || '').toLowerCase();

  // Determinar si es local o remoto
  // El campo type tiene prioridad
  const isTypeLocal = normalizedType === 'local' || normalizedType === 'ollama' || normalizedType === 'lm studio';
  const isTypeRemote = normalizedType === 'openai' || normalizedType === 'deepseek' || normalizedType === 'google' || normalizedType === 'anthropic';

  // Si type indica explícitamente local o remoto, usar eso
  if (type) {
    if (isTypeRemote) {
      console.log('Conectando a modelo remoto (type: remote)...');
      return getModelResponseRemote(messages, modelConfig);
    }
    if (isTypeLocal) {
      console.log(`Conectando a modelo local (type: ${normalizedType})...`);
      const isOllama = normalizedProvider === 'ollama';
      const url = isOllama ? endpoint : `${endpoint}/v1/chat/completions`;

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: modelName,
            messages: messages,
            stream: false,
            temperature: 0.7,
          }),
        });

        if (!response.ok) {
          throw new Error(`Model API Error: ${response.statusText}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message.content || data.message?.content || data.response;
        console.log('[DEBUG] Respuesta del modelo local (data):', JSON.stringify(data).substring(0, 300));
        console.log('[DEBUG] Contenido extraído del modelo local:', content?.substring(0, 200));
        return content;
      } catch (error) {
        console.error('Error al conectar con modelo local:', error);
        throw new Error('No se pudo conectar con el modelo local.');
      }
    }
  }

  // Si no hay type pero is_local está definido, usar eso como fallback
  if (is_local !== undefined) {
    if (is_local === true) {
      console.log(`Conectando a modelo local (is_local: true)...`);
      const isOllama = normalizedProvider === 'ollama';
      const url = isOllama ? endpoint : `${endpoint}/v1/chat/completions`;

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: modelName,
            messages: messages,
            stream: false,
            temperature: 0.7,
          }),
        });

        if (!response.ok) {
          throw new Error(`Model API Error: ${response.statusText}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message.content || data.message?.content || data.response;
        console.log('[DEBUG] Respuesta del modelo local (data):', JSON.stringify(data).substring(0, 300));
        console.log('[DEBUG] Contenido extraído del modelo local:', content?.substring(0, 200));
        return content;
      } catch (error) {
        console.error('Error al conectar con modelo local:', error);
        throw new Error('No se pudo conectar con el modelo local.');
      }
    }
    // Si is_local es false, continuar con detección por provider o endpoint
  }

  // Si provider es desconocido pero hay API key y type es remoto, usar endpoint por defecto
  if (normalizedProvider === 'unknown' && apiKey && type) {
    const defaultEndpoint = getDefaultEndpoint(provider, type);
    if (defaultEndpoint) {
      console.log('Provider desconocido pero hay API key y type remoto, usando endpoint por defecto...');
      return getModelResponseRemote(messages, { ...modelConfig, endpoint: defaultEndpoint });
    }
  }

  // Si no hay type o is_local definido, pero hay API key, usar modelo remoto
  // Esto es porque si el usuario configuró una API key, quiere usar un servicio remoto
  if (apiKey && endpoint) {
    console.log('Conectando a modelo remoto (API key presente)...');
    return getModelResponseRemote(messages, modelConfig);
  }

  throw new Error('No hay configuración de modelo disponible');
}

async function getModelResponseRemote(messages: any[], modelConfig: any) {
  const { endpoint, modelName, apiKey, provider } = modelConfig;

  const content = await callModelGeneric(
    {
      provider: provider || 'openai',
      model: modelName,
      url: endpoint,
      apiKey,
    },
    messages,
    { temperature: 0.7 }
  );

  console.log('[DEBUG] Contenido extraído:', content?.substring(0, 200) + '...');
  return content;
}

export async function POST(request: NextRequest) {
  try {
    const body: GeneratePlanBody = await request.json();
    const { title, description, stages, modelId, startFromStage, existingStages, projectContext } = body;

    if (!title || !description || !stages) {
      return NextResponse.json(
        { error: 'Faltan parámetros requeridos: title, description, stages' },
        { status: 400 }
      );
    }

    // Obtener configuración del modelo
    let modelConfig: any = {
      endpoint: process.env.LM_STUDIO_URL || process.env.OPENAI_API_URL,
      modelName: process.env.LM_STUDIO_MODEL || process.env.OPENAI_MODEL || process.env.DEFAULT_CHAT_MODEL || 'gpt-4o-mini',
      apiKey: process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || '',
    };
    console.log('Configuración por defecto:', { endpoint: modelConfig.endpoint, modelName: modelConfig.modelName, hasApiKey: !!modelConfig.apiKey });

    // Si se proporciona modelId, intentar obtener la configuración desde PocketBase
    if (modelId) {
      try {
        const pb = new PocketBase(process.env.POCKETBASE_URL || 'https://zeus-basedatos.fly.dev');

        // Autenticar como admin si hay credenciales
        if (process.env.POCKETBASE_ADMIN_EMAIL && process.env.POCKETBASE_ADMIN_PASSWORD) {
          await pb.admins.authWithPassword(process.env.POCKETBASE_ADMIN_EMAIL, process.env.POCKETBASE_ADMIN_PASSWORD);
        }

        const modelRecord = await pb.collection(MODELOS_COLLECTION_NAME).getOne(modelId);

        if (modelRecord) {
          // Obtener endpoint por defecto según type o provider si base_url está vacío
          const getDefaultEndpointForProvider = (prov: string | undefined, typ: string | undefined): string | undefined => {
            const normalizedProvider = String(prov || '').toLowerCase();
            const normalizedType = String(typ || '').toLowerCase();
            if (normalizedType === 'openai' || normalizedProvider === 'openai') return 'https://api.openai.com/v1/chat/completions';
            if (normalizedType === 'deepseek' || normalizedProvider === 'deepseek') return 'https://api.deepseek.com/chat/completions';
            if (normalizedType === 'google' || normalizedProvider === 'google') return 'https://generativelanguage.googleapis.com/v1beta/models';
            return undefined;
          };

          const explicitEndpoint =
            modelRecord[MODELOS_FIELDS.BASE_URL] ||
            modelRecord.endpoint ||
            '';

          // Si endpoint está vacío pero hay type/provider con API key, usar endpoint por defecto
          const defaultEndpoint = explicitEndpoint
            ? undefined
            : getDefaultEndpointForProvider(
                modelRecord[MODELOS_FIELDS.PROVIDER] || modelRecord.provider,
                modelRecord[MODELOS_FIELDS.TYPE] || modelRecord.type
              );

          modelConfig = {
            endpoint: explicitEndpoint || defaultEndpoint || modelConfig.endpoint,
            modelName:
              modelRecord[MODELOS_FIELDS.MODEL_NAME] ||
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
            type:
              modelRecord[MODELOS_FIELDS.TYPE] ||
              modelRecord.type ||
              modelConfig.type,
            is_local:
              modelRecord[MODELOS_FIELDS.IS_LOCAL] !== undefined ?
                modelRecord[MODELOS_FIELDS.IS_LOCAL] :
                modelConfig.is_local,
          };
          console.log('Configuración obtenida de PocketBase:', {
            explicitEndpoint,
            defaultEndpoint,
            finalEndpoint: modelConfig.endpoint,
            hasApiKey: !!modelConfig.apiKey,
            provider: modelConfig.provider,
            type: modelConfig.type
          });
        }
      } catch (error) {
        console.error('Error al obtener configuración del modelo desde PocketBase:', error);
        // Continuar con configuración por defecto
      }
    }

    // Crear un stream para enviar las etapas una por una
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const requestedStartStage = typeof startFromStage === 'number' && startFromStage > 1
            ? Math.min(startFromStage, stages)
            : 1;

          const normalizedExistingStages = Array.isArray(existingStages)
            ? existingStages.filter((stage: any) => stage && typeof stage.number === 'number' && stage.number < requestedStartStage)
            : [];

          const effectiveStartStage = Math.max(1, normalizedExistingStages.length + 1);

          // Enviar metadata inicial
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'start',
                title,
                description,
                totalStages: stages,
                startFromStage: effectiveStartStage,
              })}\n\n`
            )
          );

          // Generar las etapas una por una
          const generatedStages: any[] = [...normalizedExistingStages];

          for (let i = effectiveStartStage; i <= stages; i++) {
            const remainingStages = stages - i + 1;
            const filesPlannedSoFar = generatedStages.reduce((acc: number, stage: any) => {
              return acc + (Array.isArray(stage.files) ? stage.files.length : 0);
            }, 0);
            const targetFilesPerStage = stages >= 20 ? '1-2' : stages >= 12 ? '2-3' : stages >= 8 ? '2-4' : '3-5';
            
            // Construir el contexto de etapas anteriores
            let previousContext = '';
            if (generatedStages.length > 0) {
              previousContext = '\n\nCONTEXTO DE ETAPAS ANTERIORES:\n';
              generatedStages.forEach((prevStage: any) => {
                previousContext += `\nEtapa ${prevStage.number}: ${prevStage.name}\n`;
                previousContext += `- Objetivo: ${prevStage.objective}\n`;
                if (prevStage.tasks && prevStage.tasks.length > 0) {
                  previousContext += `- Tareas: ${prevStage.tasks.join(', ')}\n`;
                }
                if (prevStage.files && prevStage.files.length > 0) {
                  previousContext += `- Archivos: ${prevStage.files.join(', ')}\n`;
                }
              });
              previousContext += '\nEstas etapas ya han sido planificadas. Genera la siguiente etapa teniendo en cuenta este contexto.\n';
            }

            // Construir el contexto del proyecto existente
            const existingProjectContext = projectContext
              ? `\n\nESTRUCTURA DEL PROYECTO EXISTENTE:\n${projectContext.overview}\n\nCARPETAS EXISTENTES:\n${projectContext.folders.slice(0, 60).join('\n')}${projectContext.folders.length > 60 ? '\n...' : ''}\n\nARCHIVOS EXISTENTES:\n${projectContext.files.slice(0, 80).join('\n')}${projectContext.files.length > 80 ? '\n...' : ''}\n\nINSTRUCCIÓN CRÍTICA: Este es un proyecto YA EXISTENTE. Todo lo que generes debe ser COMPATIBLE con la estructura, tecnologías y convenciones del proyecto existente. No generes archivos que ya existan a menos que se indique explícitamente que deben modificarse.`
              : '';

            // Construir el prompt para generar una etapa específica
            const systemPrompt = `Eres un experto en planificación de proyectos de desarrollo de software.
Tu tarea es desglosar un proyecto en etapas específicas para modelos de IA con recursos limitados.

INSTRUCCIONES:
1. Genera UNA sola etapa del proyecto
2. La etapa debe ser una unidad de trabajo completa y autónoma
3. La etapa debe seguir un orden lógico de desarrollo
4. Distribuye el trabajo global de forma equilibrada entre TODAS las etapas del plan
5. Distribuye también la cantidad de archivos de forma equilibrada entre etapas
6. Evita concentrar demasiadas tareas o demasiados archivos en una sola etapa
7. Para la etapa, especifica:
   - Objetivo claro de la etapa
   - Tareas específicas a realizar
   - Los archivos que se van a crear o modificar en esta etapa (puedes proponer nuevos archivos)
   - Dependencias con otras etapas
${projectContext ? `8. ESTE PROYECTO YA EXISTE: todo lo que planifiques debe integrarse perfectamente con la estructura, tecnologías y convenciones del proyecto existente.` : ''}

Responde en formato JSON con la siguiente estructura:
{
  "number": número de etapa,
  "name": "Nombre de la etapa",
  "objective": "Objetivo de esta etapa",
  "tasks": ["Tarea 1", "Tarea 2", ...],
  "files": ["archivo1.ext", "archivo2.ext", ...],
  "dependencies": []
}`;

            const userPrompt = `Genera la etapa ${i} de ${stages} para el siguiente proyecto:

PROYECTO: ${title}
DESCRIPCIÓN: ${description}${existingProjectContext}

ETAPA ACTUAL: ${i} de ${stages}
ETAPAS RESTANTES (incluyendo esta): ${remainingStages}
ARCHIVOS PLANIFICADOS HASTA AHORA: ${filesPlannedSoFar}
OBJETIVO DE ARCHIVOS APROXIMADO POR ETAPA: ${targetFilesPerStage}${previousContext}

REGLAS DE ARCHIVOS:
- Proporciona los archivos concretos que esta etapa debe crear o modificar.
- Puedes proponer nuevos archivos; asegúrate de que sean coherentes con el proyecto.
- No repitas archivos ni tareas ya cubiertas en etapas anteriores.
- SIEMPRE incluye el campo "files" en el JSON, aunque sea un array vacío.
- Si una etapa no necesita crear ni modificar archivos, deja el array de files vacío.
${projectContext ? `- NO generes archivos que ya existan en el proyecto, salvo que deban modificarse.` : ''}

Por favor, genera solo esta etapa en formato JSON como se especifica en las instrucciones.`;

            const messages = [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ];

            // Llamar al modelo para generar esta etapa
            const response = await getModelResponse(messages, modelConfig);

            // Debug: log de la respuesta antes de parsear
            console.log('[DEBUG] Respuesta recibida del modelo (antes de parsear):', response.substring(0, 300) + '...');

            // Intentar parsear la respuesta como JSON
            let parsedStage;
            try {
              const cleanedResponse = response.replace(/```json\n?|\n?```/g, '').trim();
              parsedStage = JSON.parse(cleanedResponse);
              console.log('[DEBUG] Respuesta parseada correctamente:', JSON.stringify(parsedStage).substring(0, 200));
            } catch (parseError) {
              console.error('[DEBUG] Error al parsear respuesta:', parseError);
              // Si no se puede parsear, enviar error
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: 'No se pudo parsear la respuesta como JSON' })}\n\n`));
              controller.close();
              return;
            }

            // Asegurar que la etapa tenga el número correcto
            parsedStage.number = i;

            // Asegurar que files sea un array de strings válidos
            const rawFiles = Array.isArray(parsedStage.files) ? parsedStage.files : [];
            const validFiles = rawFiles
              .filter((f: any) => typeof f === 'string' && f.trim())
              .map((f: string) => f.trim());

            parsedStage.files = validFiles;

            // Agregar a las etapas generadas
            generatedStages.push(parsedStage);

            // Enviar la etapa generada
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'stage_complete', stage: parsedStage })}\n\n`));
          }

          // Enviar señal de completado con todas las etapas
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'complete', data: { title, description, stages: generatedStages } })}\n\n`));
          controller.close();
        } catch (error: any) {
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
    console.error('Error en generate structure plan:', error);
    return NextResponse.json(
      { error: error.message || 'Error al generar el plan' },
      { status: 500 }
    );
  }
}

// Genera la estructura completa del proyecto antes de las etapas
async function generateProjectStructure(
  title: string,
  description: string,
  totalStages: number,
  modelConfig: any,
  controller: any,
  encoder: any
): Promise<{ folders: string[]; files: string[]; overview: string } | null> {
  try {
    const systemPrompt = `Eres un experto en arquitectura de software. Tu tarea es definir la estructura completa del proyecto antes de comenzar el desarrollo por etapas.

INSTRUCCIONES:
1. Analiza el proyecto y su descripción
2. Define la estructura de carpetas completa del proyecto
3. Define todos los archivos que se crearán (archivos clave, no todos los detalles)
4. La estructura debe estar bien organizada y permitir distribuir el trabajo en etapas
5. No implementes funcionalidad, solo define la estructura

Responde en formato JSON con la siguiente estructura:
{
  "overview": "Breve descripción de la arquitectura del proyecto",
  "folders": ["carpeta1", "carpeta2", ...],
  "files": ["archivo1.ext", "archivo2.ext", ...]
}`;

    const userPrompt = `Define la estructura completa del siguiente proyecto:

PROYECTO: ${title}
DESCRIPCIÓN: ${description}

TOTAL DE ETAPAS: ${totalStages}

La estructura debe:
- Incluir todas las carpetas necesarias (src, api, models, config, etc.)
- Incluir los archivos clave del proyecto (index, app, config, models, etc.)
- Estar organizada de forma lógica para permitir desarrollo por etapas
- Ser suficiente para distribuir el trabajo en ${totalStages} etapas

Por favor, genera solo la estructura en formato JSON.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const response = await getModelResponse(messages, modelConfig);
    console.log('[DEBUG] Respuesta estructura del proyecto:', response.substring(0, 300) + '...');

    try {
      const cleanedResponse = response.replace(/```json\n?|\n?```/g, '').trim();
      const parsedStructure = JSON.parse(cleanedResponse);
      console.log('[DEBUG] Estructura parseada:', JSON.stringify(parsedStructure).substring(0, 200));

      return {
        overview: parsedStructure.overview || `Estructura del proyecto: ${title}`,
        folders: Array.isArray(parsedStructure.folders)
          ? parsedStructure.folders.filter((f: any) => typeof f === 'string' && f.trim())
          : [],
        files: Array.isArray(parsedStructure.files)
          ? parsedStructure.files.filter((f: any) => typeof f === 'string' && f.trim())
          : [],
      };
    } catch (parseError) {
      console.error('[DEBUG] Error al parsear estructura:', parseError);
      console.warn('No se pudo parsear la estructura del proyecto, usando estructura básica');
      return null;
    }
  } catch (error: any) {
    console.error('Error al generar estructura del proyecto:', error);
    return null;
  }
}
