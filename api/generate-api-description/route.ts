import type { NextRequest } from 'next/server';
import PocketBase from 'pocketbase';
import { UsageService } from '../utils';

let NextResponse: any;
try {
  ({ NextResponse } = require('next/server'));
} catch {
  NextResponse = null;
}

function getPocketBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_POCKETBASE_URL ||
    process.env.POCKETBASE_URL ||
    'https://zeus-basedatos.fly.dev'
  );
}

type AiModelRecord = {
  id: string;
  name?: string;
  api_key?: string;
  model_name?: string;
  base_url?: string;
  config?: { temperature?: number; max_tokens?: number };
  type?: string;
  provider?: string;
};

function jsonResponse(body: any, init?: { status?: number }) {
  const status = init?.status ?? 200;
  if (NextResponse) {
    return NextResponse.json(body, { status });
  }
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function resolveChatCompletionsUrl(baseUrl: string | undefined): string {
  const fallback = 'https://api.deepseek.com/v1/chat/completions';
  if (!baseUrl?.trim()) return fallback;
  
  let b = baseUrl.trim().replace(/\/$/, '');
  
  // Si ya tiene el endpoint de Ollama o OpenAI, devolverlo tal cual
  if (b.endsWith('/api/chat') || b.endsWith('/v1/chat/completions') || b.endsWith('/chat/completions')) {
    return b;
  }

  // Si es Ollama (puerto 11434)
  if (b.includes(':11434')) {
    // Limpiamos cualquier sufijo parcial para evitar duplicados
    b = b.replace(/\/v1$/, '').replace(/\/api$/, '');
    return `${b}/api/chat`;
  }

  // Por defecto añadir /v1/chat/completions si no lo tiene (OpenAI compat)
  if (!b.includes('/v1') && !b.includes('/api/')) {
    return `${b}/v1/chat/completions`;
  }
  
  // Si tiene /v1 pero no el resto
  if (b.includes('/v1') && !b.includes('/chat/completions')) {
      return `${b}/chat/completions`;
  }

  return b.includes('/') ? b : `${b}/v1/chat/completions`;
}

export async function POST(request: any) {
  try {
    const { userDescription, modelId, appType } = await request.json();

    if (!userDescription) {
      return jsonResponse({ error: 'User description is required' }, { status: 400 });
    }

    if (!modelId) {
      return jsonResponse({ error: 'Model ID is required' }, { status: 400 });
    }

    const pb = new PocketBase(getPocketBaseUrl());

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

    if (!pb.authStore.isValid || !pb.authStore.model?.id) {
      return jsonResponse({ error: 'User not authenticated' }, { status: 401 });
    }

    const userId = pb.authStore.model.id as string;

    const models = await pb.collection('ai_models').getFullList<AiModelRecord>({
      filter: `user = "${userId}"`
    });

    const model = models.find((m) => m.id === modelId);
    if (!model) {
      console.error('❌ Model not found in PocketBase:', modelId);
      return jsonResponse({ error: 'Model not found' }, { status: 404 });
    }

    console.log('🤖 Checking model for description improvement:', {
      name: model.name,
      type: model.type,
      provider: model.provider,
      hasApiKey: !!model.api_key
    });

    const isLocal = 
      model.type === 'local' || 
      model.type === 'LM Studio' || 
      model.type === 'Ollama' ||
      model.provider === 'LM Studio' || 
      model.provider === 'local' ||
      model.provider === 'Ollama' ||
      model.base_url?.includes('localhost') ||
      model.base_url?.includes('127.0.0.1') ||
      model.base_url?.includes(':11434') ||
      model.base_url?.includes(':1234');

    const apiKey = model.api_key?.trim();
    if (!isLocal && !apiKey) {
      console.error('❌ Model API key not found and model is not detected as local');
      return jsonResponse({ error: 'Model API key not found' }, { status: 400 });
    }

    const modelName = model.model_name || 'deepseek-chat';
    const temperature =
      typeof model.config?.temperature === 'number' ? model.config.temperature : 0.7;
    const max_tokens = model.config?.max_tokens ?? 2000;

    const prompt = `Actúa como un experto arquitecto de APIs y analista de sistemas. Tu tarea es crear una descripción detallada y sofisticada para una API REST basada en la descripción básica del usuario.

**Descripción del usuario:** ${userDescription}

**Tipo de aplicación:** API REST

Genera una descripción completa y profesional que incluya propósito, casos de uso, endpoints sugeridos, stack técnico, seguridad y modelo de datos.

**Tipo de API:** ${appType || 'API REST'}

**Genera una respuesta completa y profesional que sirva como base sólida para desarrollar una API de producción.**`;

    const apiUrl = resolveChatCompletionsUrl(model.base_url);
    console.log('📡 Calling Model API:', apiUrl, '| Model:', modelName);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        ...(apiKey && { Authorization: `Bearer ${apiKey}` }),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          {
            role: 'system',
            content:
              'Eres un experto arquitecto de APIs REST que genera descripciones detalladas y profesionales para sistemas de producción.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature,
        max_tokens,
        stream: false
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Error en API del modelo: ${response.status} - ${errorData}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        cache_hit_tokens?: number;
      };
    };
    const generatedPrompt = data.choices?.[0]?.message?.content;
    if (typeof generatedPrompt !== 'string' || !generatedPrompt.trim()) {
      return jsonResponse({ error: 'El modelo no devolvió texto' }, { status: 502 });
    }

    await UsageService.recordUsage(
      userId,
      {
        dbId: model.id,
        apiKey,
        name: model.name || modelName,
        type: 'api-description'
      },
      {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        cacheHitTokens: data.usage?.cache_hit_tokens || 0,
        requestId: `api-description-${Date.now()}`,
        metadata: { appType }
      }
    );

    return jsonResponse({
      prompt: generatedPrompt.trim(),
      usage: {
        tokens: data.usage?.total_tokens || 0,
        model: modelName
      }
    });
  } catch (error) {
    console.error('Error generating sophisticated prompt:', error);
    return jsonResponse(
      {
        error: 'Error generating sophisticated prompt',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

function expressHeaders(req: { headers: Record<string, string | string[] | undefined> }) {
  return {
    get: (n: string) => {
      const key = n.toLowerCase();
      const v = req.headers[key];
      return Array.isArray(v) ? v[0] : v;
    }
  };
}

export async function POST_EXPRESS(req: any, res: any): Promise<void> {
  try {
    console.log('[API Description] POST_EXPRESS received request');
    const fakeRequest = {
      json: async () => req.body,
      headers: expressHeaders(req)
    } as Request;
    
    const r = await POST(fakeRequest);
    
    // Si r no es un objeto con .json(), algo salió mal en POST
    if (!r || typeof r.json !== 'function') {
      console.error('[API Description] POST returned invalid response:', r);
      res.status(500).json({ error: 'Internal server error in POST handler' });
      return;
    }

    const data = await r.json();
    console.log('[API Description] POST returned status:', r.status);
    res.status(r.status).json(data);
  } catch (error) {
    console.error('[API Description] Critical error in POST_EXPRESS:', error);
    res.status(500).json({ 
      error: 'Critical error processing description', 
      details: error instanceof Error ? error.message : String(error) 
    });
  }
}
