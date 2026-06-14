import PocketBase from 'pocketbase';
import { NextRequest, NextResponse } from 'next/server';
import { getPocketBase, POCKETBASE_EMAIL, POCKETBASE_PASSWORD, PB_COLLECTIONS, authPocketBaseAdmin } from '@/lib/pb-api';
import {
  CONVERSATIONS_FIELDS,
  MESSAGES_FIELDS,
  MODELOS_FIELDS,
} from '@/lib/collections';
import codeApplierModule from '@/utils/codeApplier';
const { applyCodeChanges } = codeApplierModule;

import {
  callModel,
  createModelSSEStream,
  SSE_HEADERS,
  performWebSearch,
  handleWebSearchLoop,
  extractCodeChangeFromResponse,
  buildAssistantStructuredContent,
  type ChatBody,
  type ChatMessage,
  type PersistedCodeBubble,
} from '@/api/zeus-model-api/model-service';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const OLLAMA_CLOUD_API_KEY = process.env.OLLAMA_CLOUD_API_KEY;

async function persistConversation(pb: PocketBase, body: ChatBody & { newMessageClean?: { role: 'user' | 'assistant'; content: string } }, responseText: string) {
  console.log('=== persistConversation - Iniciando persistencia ===');

  let conversationId = (body as any).conversationId;

  // Usar mensaje limpio si está disponible
  const messageForPersistence = body.newMessageClean ?? body.newMessage;

  if (!conversationId) {
    console.log('🆕 Creando nueva conversación...');
    const conversationPayload: Record<string, any> = {
      [CONVERSATIONS_FIELDS.PROJECT_ID]: (body as any).projectId || '',
      [CONVERSATIONS_FIELDS.TITLE]: (body as any).title || `Chat ${new Date().toLocaleString('es-ES')}`,
    };

    if ((body as any).modelRecordId) {
      conversationPayload[CONVERSATIONS_FIELDS.MODEL_ID] = (body as any).modelRecordId;
    }

    if ((body as any).userId) {
      conversationPayload[CONVERSATIONS_FIELDS.USER] = (body as any).userId;
      console.log('👤 Vinculando a usuario:', (body as any).userId);
    } else {
      console.warn('⚠️ No se proporcionó userId para la nueva conversación');
    }

    try {
      const conversationRecord = await pb.collection(PB_COLLECTIONS.CONVERSATIONS).create(conversationPayload);
      conversationId = conversationRecord.id;
      console.log('✅ Conversación creada exitosamente con ID:', conversationId);
    } catch (error: any) {
      console.error('❌ Error al crear conversación en PocketBase:', error.data || error);
      throw new Error(`Fallo al crear conversación: ${JSON.stringify(error.data || error.message)}`);
    }
  }

  try {
    console.log('✉️ Guardando mensaje del usuario...');
    await pb.collection(PB_COLLECTIONS.MESSAGES).create({
      [MESSAGES_FIELDS.CONVERSATION_ID]: conversationId,
      [MESSAGES_FIELDS.ROLE]: 'user',
      [MESSAGES_FIELDS.CONTENT_TEXT]: messageForPersistence.content,
      [MESSAGES_FIELDS.TYPE]: 'text',
      [MESSAGES_FIELDS.LANGUAGE]: '',
      [MESSAGES_FIELDS.FILE_INFO]: {
        codeBubbles: [],
        originalContent: messageForPersistence.content,
      },
      [MESSAGES_FIELDS.ACTION_TYPE]: 'base de datos',
    });
  } catch (error: any) {
    console.error('❌ Error al guardar mensaje del usuario:', error.data || error);
  }

  try {
    console.log('🤖 Guardando respuesta del asistente...');
    const structured = buildAssistantStructuredContent(responseText);
    const hasCodeBubbles = structured.codeBubbles.length > 0;
    await pb.collection(PB_COLLECTIONS.MESSAGES).create({
      [MESSAGES_FIELDS.CONVERSATION_ID]: conversationId,
      [MESSAGES_FIELDS.ROLE]: 'assistant',
      [MESSAGES_FIELDS.CONTENT_TEXT]: structured.content || responseText,
      [MESSAGES_FIELDS.TYPE]: hasCodeBubbles ? 'code' : 'text',
      [MESSAGES_FIELDS.LANGUAGE]: hasCodeBubbles ? (structured.codeBubbles[0]?.language || 'typescript') : '',
      [MESSAGES_FIELDS.FILE_INFO]: {
        codeBubbles: structured.codeBubbles,
        originalContent: responseText,
      },
      [MESSAGES_FIELDS.ACTION_TYPE]: 'base de datos',
    });
  } catch (error: any) {
    console.error('❌ Error al guardar mensaje del asistente:', error.data || error);
  }

  return { conversationId };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatBody & {
      messages?: ChatMessage[];
      conversationId?: string;
      projectId?: string;
      title?: string;
      userId?: string;
      modelRecordId?: string;
      newMessageClean?: { role: 'user' | 'assistant'; content: string };  // Mensaje limpio sin contexto para UI
    };
    const authHeader = request.headers.get('authorization');
    const messages = body.messages ?? [...(body.history ?? []), body.newMessage];

    // Usar mensaje limpio para persistencia si está disponible (evita mostrar contexto enriquecido en UI)
    const messageForPersistence = body.newMessageClean ?? body.newMessage;

    if (!messages || messages.length === 0) {
      return NextResponse.json({ error: 'Mensajes de chat requeridos.' }, { status: 400 });
    }

    console.log('=== POST /api/chat ===');

    if (!body.provider || !body.model || !body.newMessage?.content) {
      return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 });
    }

    if (!POCKETBASE_EMAIL || !POCKETBASE_PASSWORD) {
      return NextResponse.json({ error: 'Credenciales de PocketBase no configuradas' }, { status: 500 });
    }

    const pb = getPocketBase();
    let userId = body.userId;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        pb.authStore.save(token, null);
        const authData = await pb.collection('users').authRefresh();
        userId = authData.record.id;
        console.log('✅ Usuario verificado en POST:', userId);
      } catch (error) {
        console.warn('⚠️ Token inválido en POST:', error);
      }
    }

    await authPocketBaseAdmin(pb);

    // Resolve model configuration early so both pipeline and direct paths can use it
    let modelId = body.model;
    let apiKey: string | undefined;
    let apiUrl: string | undefined;
    let modelStreamEnabled = body.stream === true;

    if (body.modelRecordId) {
      try {
        const modelRecord = await pb.collection(PB_COLLECTIONS.MODELOS).getOne(body.modelRecordId);
        apiKey = (modelRecord[MODELOS_FIELDS.API_KEY] as string) || undefined;
        apiUrl = (modelRecord[MODELOS_FIELDS.BASE_URL] as string) || undefined;
        if (modelRecord[MODELOS_FIELDS.MODEL_NAME]) {
          modelId = String(modelRecord[MODELOS_FIELDS.MODEL_NAME]);
        }
        if (modelRecord[MODELOS_FIELDS.PROVIDER]) {
          const dbProvider = modelRecord[MODELOS_FIELDS.PROVIDER];
          console.log('📦 Provider desde base de datos:', dbProvider);
          if (dbProvider === 'LM Studio' || dbProvider === 'local' || dbProvider === 'Local') {
            body.provider = 'LM Studio';
            console.log('🔄 Forzando provider a LM Studio desde BD');
          }
        }

        const cfg = modelRecord[MODELOS_FIELDS.CONFIG] as Record<string, any> | undefined;
        if (cfg) {
          if (typeof cfg.temperature === 'number') body.temperature = cfg.temperature;
          if (typeof cfg.max_token === 'number') body.maxTokens = cfg.max_token;
          if (typeof cfg.maxTokens === 'number') body.maxTokens = cfg.maxTokens;
          if (typeof cfg.topP === 'number') body.topP = cfg.topP;
          if (typeof cfg.top_p === 'number') body.topP = cfg.top_p;
          if (typeof cfg.frequencyPenalty === 'number') body.frequencyPenalty = cfg.frequencyPenalty;
          if (typeof cfg.presencePenalty === 'number') body.presencePenalty = cfg.presencePenalty;
          if (typeof cfg.stream === 'boolean') modelStreamEnabled = modelStreamEnabled || cfg.stream;
          console.log('⚙️ Parámetros del modelo cargados:', {
            temperature: body.temperature,
            maxTokens: body.maxTokens,
            topP: body.topP,
            stream: cfg.stream,
          });
        }
        if (typeof (modelRecord as any).stream === 'boolean') {
          modelStreamEnabled = modelStreamEnabled || (modelRecord as any).stream;
        }
      } catch {
        console.warn('Modelo no encontrado, usando defaults');
      }
    }

    const shouldStream = modelStreamEnabled && !body.webSearch;

    if (!apiKey) {
      if (body.provider === 'OpenAI') apiKey = OPENAI_API_KEY;
      else if (body.provider === 'Deepseek') apiKey = DEEPSEEK_API_KEY;
      else if (body.provider === 'Ollama Cloud') apiKey = OLLAMA_CLOUD_API_KEY;
      else if (body.provider === 'LM Studio') apiKey = '';
    }

    if (!apiUrl) {
      if (body.provider === 'OpenAI') apiUrl = 'https://api.openai.com/v1/chat/completions';
      else if (body.provider === 'Deepseek') apiUrl = process.env.DEEPSEEK_API_URL ?? 'https://api.deepseek.com/chat/completions';
      else if (body.provider === 'Ollama') apiUrl = 'http://localhost:11434/api/chat';
      else if (body.provider === 'Ollama Cloud') apiUrl = process.env.OLLAMA_CLOUD_URL ?? 'https://ollama.com/api/generate';
      else if (body.provider === 'LM Studio') apiUrl = `${process.env.LM_STUDIO_URL || 'http://localhost:1234'}/v1/chat/completions`;
    }

    // --- PIPELINE REDIRECTION LOGIC ---
    try {
      const localPbUrl = process.env.POCKETBASE_LOCAL_URL || 'http://localhost:8091';
      const localPb = new PocketBase(localPbUrl);
      const localAdminEmail = process.env.POCKETBASE_LOCAL_ADMIN_EMAIL || 'zeus@ia.com';
      const localAdminPass = process.env.POCKETBASE_LOCAL_ADMIN_PASSWORD || '1234567890';
      
      try {
        await localPb.admins.authWithPassword(localAdminEmail, localAdminPass);
      } catch {
        await localPb.collection('_superusers').authWithPassword(localAdminEmail, localAdminPass);
      }

      const pipelineRes = await localPb.collection('pipeline_configs').getList(1, 1, {
        filter: 'isActive = true'
      });

      if (pipelineRes.items.length > 0) {
        const activePipeline = pipelineRes.items[0];
        console.log(`🚀 [Pipeline] Pipeline activo detectado: ${activePipeline.name}. Redirigiendo...`);
        
        // Llamar a la API local de RAE que maneja el pipeline
        const raeApiUrl = 'http://localhost:3011/api/v1/chat/pipeline';
        const raeRes = await fetch(raeApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(300000), // 5 minutos timeout - compromiso entre 2 y 10 minutos
          body: JSON.stringify({
            message: body.newMessage.content,
            history: messages,
            pipelineConfigId: activePipeline.id,
            stream: shouldStream,
            modelConfig: {
              provider: body.provider,
              model: modelId,
              apiUrl,
              apiKey,
              temperature: body.temperature,
              maxTokens: body.maxTokens,
              topP: body.topP,
              frequencyPenalty: body.frequencyPenalty,
              presencePenalty: body.presencePenalty,
            },
            systemContext: body.systemContext || '',
            hiddenContext: body.hiddenContext || ''
          })
        });

        if (raeRes.ok) {
          const contentType = raeRes.headers.get('content-type') || '';
          if (shouldStream && contentType.includes('text/event-stream') && raeRes.body) {
            console.log('📡 [Pipeline] Proxy SSE streaming al cliente');
            return new Response(raeRes.body, { headers: SSE_HEADERS });
          }

          const raeData = await raeRes.json();
          const text = raeData.content || raeData.text || 'Sin respuesta del pipeline';

          // Persistir si hay conversación
          let conversationId = body.conversationId;
          const messageForPersistence = body.newMessageClean ?? body.newMessage;

          if (conversationId) {
            // Guardar mensaje del usuario (limpio, sin contexto)
            await pb.collection(PB_COLLECTIONS.MESSAGES).create({
              [MESSAGES_FIELDS.CONVERSATION_ID]: conversationId,
              [MESSAGES_FIELDS.ROLE]: 'user',
              [MESSAGES_FIELDS.CONTENT_TEXT]: messageForPersistence.content,
              [MESSAGES_FIELDS.TYPE]: 'text',
              [MESSAGES_FIELDS.LANGUAGE]: '',
              [MESSAGES_FIELDS.FILE_INFO]: {
                codeBubbles: [],
                originalContent: messageForPersistence.content,
              },
              [MESSAGES_FIELDS.ACTION_TYPE]: 'base de datos',
            });

            // Guardar respuesta del asistente
            await pb.collection(PB_COLLECTIONS.MESSAGES).create({
              [MESSAGES_FIELDS.CONVERSATION_ID]: conversationId,
              [MESSAGES_FIELDS.ROLE]: 'assistant',
              [MESSAGES_FIELDS.CONTENT_TEXT]: text,
              [MESSAGES_FIELDS.TYPE]: 'text',
              [MESSAGES_FIELDS.LANGUAGE]: '',
              [MESSAGES_FIELDS.FILE_INFO]: { originalContent: text, pipeline: raeData.pipeline },
              [MESSAGES_FIELDS.ACTION_TYPE]: 'pipeline',
            });
          }

          return NextResponse.json({ success: true, text, conversationId, fromPipeline: true }, { status: 200 });
        } else {
          console.error('❌ Error en API de Pipeline:', await raeRes.text());
          // Si falla el pipeline, podemos optar por caer al modo normal o devolver error
        }
      }
    } catch (pipelineErr) {
      console.warn('⚠️ Error al verificar pipeline activo, continuando modo normal:', pipelineErr);
    }
    // --- END PIPELINE REDIRECTION LOGIC ---

    let conversationId = body.conversationId;

    if (!conversationId) {
      console.log('🆕 Intentando crear conversación previa a IA...');
      if (!userId) {
        console.error('❌ Error: userId es nulo y es requerido por el esquema de PocketBase');
        return NextResponse.json({
          error: 'No se pudo identificar al usuario. Por favor, reinicia sesión.',
          details: 'userId is required for conversations relation'
        }, { status: 401 });
      }

      const conversationPayload: Record<string, any> = {
        [CONVERSATIONS_FIELDS.PROJECT_ID]: body.projectId || '',
        [CONVERSATIONS_FIELDS.TITLE]: body.title || `Chat ${new Date().toLocaleString('es-ES')}`,
        [CONVERSATIONS_FIELDS.USER]: userId,
      };

      if (body.modelRecordId) {
        conversationPayload[CONVERSATIONS_FIELDS.MODEL_ID] = body.modelRecordId;
      }

      try {
        const convRecord = await pb.collection(PB_COLLECTIONS.CONVERSATIONS).create(conversationPayload);
        conversationId = convRecord.id;
        console.log('✅ Conversación creada exitosamente con ID:', conversationId);
      } catch (err: any) {
        console.error('❌ Error crítico creando conversación en PocketBase:', err.data || err);
        return NextResponse.json({
          error: 'Error al crear la conversación en la base de datos',
          details: err.data || err.message
        }, { status: 400 });
      }
    }

    if (conversationId) {
      try {
        await pb.collection(PB_COLLECTIONS.MESSAGES).create({
          [MESSAGES_FIELDS.CONVERSATION_ID]: conversationId,
          [MESSAGES_FIELDS.ROLE]: 'user',
          [MESSAGES_FIELDS.CONTENT_TEXT]: messageForPersistence.content,
          [MESSAGES_FIELDS.TYPE]: 'text',
          [MESSAGES_FIELDS.LANGUAGE]: '',
          [MESSAGES_FIELDS.FILE_INFO]: {
            codeBubbles: [],
            originalContent: messageForPersistence.content,
          },
          [MESSAGES_FIELDS.ACTION_TYPE]: 'base de datos',
        });
        console.log('✅ Mensaje de usuario guardado');
      } catch (err: any) {
        console.error('❌ Error guardando mensaje usuario:', err.data || err);
      }
    }

    // Búsqueda web
    if (body.webSearch && body.newMessage?.content) {
      console.log('🔍 Búsqueda web activada para:', body.newMessage.content);
      const searchContext = await performWebSearch(body.newMessage.content);
      if (searchContext) {
        body.hiddenContext = (body.hiddenContext || '') + '\n\n' + searchContext;
        console.log('✅ Contexto web añadido al mensaje');
      }
    }

    const bodyForProvider = { ...body, model: modelId };

    if (shouldStream) {
      console.log('📡 Modo streaming activado para chat directo');
      const stream = createModelSSEStream(bodyForProvider, apiKey, apiUrl, {
        conversationId: conversationId || undefined,
        onComplete: async (fullText) => {
          if (!conversationId) return;
          try {
            const structured = buildAssistantStructuredContent(fullText);
            const hasCodeBubbles = structured.codeBubbles.length > 0;
            await pb.collection(PB_COLLECTIONS.MESSAGES).create({
              [MESSAGES_FIELDS.CONVERSATION_ID]: conversationId,
              [MESSAGES_FIELDS.ROLE]: 'assistant',
              [MESSAGES_FIELDS.CONTENT_TEXT]: structured.content || fullText,
              [MESSAGES_FIELDS.TYPE]: hasCodeBubbles ? 'code' : 'text',
              [MESSAGES_FIELDS.LANGUAGE]: hasCodeBubbles ? (structured.codeBubbles[0]?.language || 'typescript') : '',
              [MESSAGES_FIELDS.FILE_INFO]: {
                codeBubbles: structured.codeBubbles,
                originalContent: fullText,
              },
              [MESSAGES_FIELDS.ACTION_TYPE]: 'base de datos',
            });
            console.log('✅ Respuesta streaming del asistente guardada');
          } catch (err: any) {
            console.error('❌ Error guardando respuesta streaming:', err.data || err);
          }
        },
      });
      return new Response(stream, { headers: SSE_HEADERS });
    }

    let text: string;
    try {
      text = await callModel(bodyForProvider, apiKey, apiUrl);
    } catch (err: any) {
      console.error('❌ Error en IA:', err.message);
      text = `Error de IA: ${err.message}`;
    }

    if (body.webSearch && text) {
      console.log('🔍 Verificando si el modelo solicitó búsqueda web...');
      text = await handleWebSearchLoop(body, text, apiKey, apiUrl, modelId);
    }

    let codeChangeDetected = false;
    let codeChangeExplanation = '';
    const codeChangeObj = extractCodeChangeFromResponse(text);
    if (codeChangeObj) {
      console.log('🔧 Detectado code_change en la respuesta del modelo');
      codeChangeDetected = true;
      codeChangeExplanation = (codeChangeObj as any).explanation || 'Cambios sugeridos por el modelo';
    }

    if (conversationId) {
      try {
        const structured = buildAssistantStructuredContent(text);
        const hasCodeBubbles = structured.codeBubbles.length > 0;
        const messagePayload: any = {
          [MESSAGES_FIELDS.CONVERSATION_ID]: conversationId,
          [MESSAGES_FIELDS.ROLE]: 'assistant',
          [MESSAGES_FIELDS.CONTENT_TEXT]: structured.content || text,
          [MESSAGES_FIELDS.TYPE]: hasCodeBubbles ? 'code' : 'text',
          [MESSAGES_FIELDS.LANGUAGE]: hasCodeBubbles ? (structured.codeBubbles[0]?.language || 'typescript') : '',
          [MESSAGES_FIELDS.FILE_INFO]: {
            codeBubbles: structured.codeBubbles,
            originalContent: text,
            codeChangeApplied: codeChangeDetected,
            codeChangeExplanation,
          },
          [MESSAGES_FIELDS.ACTION_TYPE]: 'base de datos',
        };
        await pb.collection(PB_COLLECTIONS.MESSAGES).create(messagePayload);
        console.log('✅ Respuesta del asistente guardada');
      } catch (err: any) {
        console.error('❌ Error guardando respuesta asistente:', err.data || err);
      }
    }

    return NextResponse.json({ success: true, text, conversationId }, { status: 200 });

  } catch (error: any) {
    console.error('❌ Error en POST /api/chat:', error);
    return NextResponse.json(
      { error: error.message || 'Error interno del servidor' },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    console.log('🔄 GET /api/chat - Iniciando petición');
    const url = new URL(request.url);
    const conversationId = url.searchParams.get('conversationId');
    const modelRecordId = url.searchParams.get('modelRecordId');

    console.log('📋 Parámetros:', { conversationId, modelRecordId });

    console.log('🔐 Conectando a PocketBase...');
    const pb = getPocketBase();

    const authHeader = request.headers.get('authorization');
    let userId = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        pb.authStore.save(token, null);
        const authData = await pb.collection('users').authRefresh();
        userId = authData.record.id;
        console.log('✅ Usuario verificado en API:', userId);
      } catch (error) {
        console.warn('⚠️ Token inválido o expirado en API:', error);
        pb.authStore.clear();
      }
    }

    if (POCKETBASE_EMAIL && POCKETBASE_PASSWORD) {
      try {
        await authPocketBaseAdmin(pb);
      } catch (error) {
        console.error('❌ Error de autenticación admin en API:', error);
      }
    }

    if (!userId) {
      console.warn('⚠️ Intento de acceso sin autenticación. Devolviendo lista vacía.');
      return NextResponse.json({ conversations: [], messages: [] }, { status: 200 });
    }

    if (conversationId) {
      console.log('📥 Buscando conversación:', conversationId);
      try {
        const conversationFilter = userId
          ? `id = "${conversationId}" && ${CONVERSATIONS_FIELDS.USER} = "${userId}"`
          : `id = "${conversationId}"`;

        const conversation = await pb.collection(PB_COLLECTIONS.CONVERSATIONS).getFirstListItem(conversationFilter);

        let messages: any[] = [];
        try {
          console.log('📥 Buscando mensajes para conversación:', conversationId);
          const messagesFilter = `${MESSAGES_FIELDS.CONVERSATION_ID} = "${conversationId}"`;
          const messagesData = await pb.collection(PB_COLLECTIONS.MESSAGES).getList(1, 100, {
            filter: messagesFilter,
            sort: 'created',
          });

          messages = messagesData.items.map((item: any) => ({
            id: item.id,
            role: (item[MESSAGES_FIELDS.ROLE] || 'assistant') as 'user' | 'assistant',
            text: String(item[MESSAGES_FIELDS.CONTENT_TEXT] || ''),
            type: String(item[MESSAGES_FIELDS.TYPE] || 'text'),
            language: String(item[MESSAGES_FIELDS.LANGUAGE] || ''),
            fileInfo: item[MESSAGES_FIELDS.FILE_INFO] || null,
            action_type: String(item[MESSAGES_FIELDS.ACTION_TYPE] || ''),
            created: item.created,
          }));
          console.log(`✅ ${messages.length} mensajes procesados.`);
        } catch (msgError: any) {
          console.warn('⚠️ Error al cargar mensajes, devolviendo solo conversación:', msgError.message);
        }

        return NextResponse.json({ conversation, messages }, { status: 200 });
      } catch (pbError: any) {
        console.warn('⚠️ Conversación no encontrada o error de acceso:', pbError.message);
        return NextResponse.json({
          error: 'Conversación no encontrada',
          details: pbError.message
        }, { status: 404 });
      }
    }

    if (modelRecordId) {
      try {
        const modelFilter = userId
          ? `${CONVERSATIONS_FIELDS.MODEL_ID} = "${modelRecordId}" && ${CONVERSATIONS_FIELDS.USER} = "${userId}"`
          : `${CONVERSATIONS_FIELDS.MODEL_ID} = "${modelRecordId}"`;

        const conversations = await pb.collection(PB_COLLECTIONS.CONVERSATIONS).getList(1, 5, {
          sort: '-created',
          filter: modelFilter,
        });
        return NextResponse.json({ conversations: conversations.items }, { status: 200 });
      } catch (pbError) {
        console.warn('⚠️ Error obteniendo conversaciones por modelo, usando datos de ejemplo:', pbError);
        return NextResponse.json({
          conversations: [
            { id: 'conv1', title: 'Ejemplo Conversación 1', created: new Date().toISOString() },
            { id: 'conv2', title: 'Ejemplo Conversación 2', created: new Date(Date.now() - 3600000).toISOString() }
          ]
        }, { status: 200 });
      }
    }

    try {
      const userFilter = userId
        ? `${CONVERSATIONS_FIELDS.USER} = "${userId}"`
        : '';

      const conversations = await pb.collection(PB_COLLECTIONS.CONVERSATIONS).getList(1, 10, {
        sort: '-created',
        filter: userFilter || undefined,
      });
      return NextResponse.json({ conversations: conversations.items }, { status: 200 });
    } catch (pbError) {
      console.warn('⚠️ Error obteniendo lista de conversaciones, usando datos de ejemplo:', pbError);
      return NextResponse.json({
        conversations: [
          { id: 'ki2iqrf7bqc8e6z', title: 'Conversación de ejemplo', created: new Date().toISOString() },
          { id: 'abc123def456', title: 'Otra conversación', created: new Date(Date.now() - 3600000).toISOString() },
          { id: 'xyz789uvw012', title: 'Tercera conversación', created: new Date(Date.now() - 7200000).toISOString() }
        ]
      }, { status: 200 });
    }
  } catch (error: any) {
    console.error('❌ Error detallado en GET /api/chat:', error);
    return NextResponse.json({
      error: error.message || 'Error interno en el servidor',
      details: error.data || null
    }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const conversationId = url.searchParams.get('conversationId');

    console.log('🗑️ DELETE /api/chat - ID:', conversationId);

    if (!POCKETBASE_EMAIL || !POCKETBASE_PASSWORD) {
      return NextResponse.json({ error: 'Credenciales de PocketBase no configuradas' }, { status: 500 });
    }

    const pb = getPocketBase();
    await authPocketBaseAdmin(pb);

    if (conversationId) {
      try {
        const messages = await pb.collection(PB_COLLECTIONS.MESSAGES).getFullList({
          filter: `${MESSAGES_FIELDS.CONVERSATION_ID} = "${conversationId}"`
        });

        console.log(`💬 Eliminando ${messages.length} mensajes...`);
        for (const msg of messages) {
          await pb.collection(PB_COLLECTIONS.MESSAGES).delete(msg.id).catch(e => console.warn(`No se pudo borrar mensaje ${msg.id}:`, e.message));
        }
      } catch (e) {
        console.warn('Error al buscar mensajes para eliminar:', e);
      }

      console.log(`📂 Eliminando conversación ${conversationId}...`);
      await pb.collection(PB_COLLECTIONS.CONVERSATIONS).delete(conversationId);

      console.log('✅ Eliminación completada con éxito');
    } else {
      return NextResponse.json({ error: 'conversationId es requerido para eliminar' }, { status: 400 });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: any) {
    console.error('❌ Chat history delete error:', error);
    return NextResponse.json({
      error: error.message || 'Error interno al eliminar',
      details: error.data
    }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    if (!POCKETBASE_EMAIL || !POCKETBASE_PASSWORD) {
      return NextResponse.json({ error: 'Credenciales de PocketBase no configuradas' }, { status: 500 });
    }

    const pb = getPocketBase();
    await authPocketBaseAdmin(pb);

    const body = await request.json().catch(() => ({}));
    const conversationId = body.conversationId ?? body.id;
    const title = typeof body.title === 'string' ? body.title.trim() : '';

    if (!conversationId) {
      return NextResponse.json({ error: 'conversationId requerido' }, { status: 400 });
    }

    await pb.collection(PB_COLLECTIONS.CONVERSATIONS).update(conversationId, {
      [CONVERSATIONS_FIELDS.TITLE]: title || 'Sin título',
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Chat conversation update error', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}