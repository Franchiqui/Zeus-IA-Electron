import { NextRequest, NextResponse } from 'next/server';
import PocketBase from 'pocketbase';
import { MODELOS_COLLECTION_NAME, MODELOS_FIELDS } from '@/lib/collections';

export const runtime = 'nodejs';

async function getModelResponse(messages: any[], modelConfig: any) {
  const { endpoint, modelName, apiKey, provider } = modelConfig;
  const normalizedProvider = String(provider || '').toLowerCase();

  if (!endpoint) throw new Error('El modelo no tiene URL (endpoint).');
  const safeEndpoint = String(endpoint).trim();

  // Función interna para llamada OpenAI Compatible (LM Studio, etc.)
  const callOpenAI = async (url: string) => {
    let finalUrl = url.replace(/\/$/, '');
    if (finalUrl.includes('localhost') || finalUrl.includes('127.0.0.1')) {
      if (!finalUrl.endsWith('/v1/chat/completions') && !finalUrl.endsWith('/api/chat')) {
        finalUrl = `${finalUrl}/v1/chat/completions`;
      }
    }
    
    const response = await fetch(finalUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: modelName,
        messages: messages,
        stream: false,
        temperature: 0.7,
        max_tokens: 4000
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Error API (${response.status}): ${errorText.slice(0, 100)}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || data.message?.content || data.response || '';
  };

  function buildOllamaPromptFromMessages(msgs: any[]): string {
    const parts: string[] = [];
    for (const msg of msgs) {
      const roleLabel = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : msg.role === 'system' ? 'System' : msg.role;
      parts.push(`### ${roleLabel}:\n${msg.content}`);
    }
    parts.push('### Assistant:\n');
    return parts.join('\n\n');
  }

  try {
    // Ollama Cloud usa formato /api/generate con prompt y Bearer auth
    if (normalizedProvider === 'ollama cloud') {
      const ollamaEndpoint = safeEndpoint.includes('/api/generate')
        ? safeEndpoint
        : `${safeEndpoint.replace(/\/$/, '')}/api/generate`;

      const response = await fetch(ollamaEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: modelName,
          prompt: buildOllamaPromptFromMessages(messages),
          stream: false,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama Cloud error (${response.status}): ${errorText.slice(0, 100)}`);
      }

      const data = await response.json();
      return data.response || data.message?.content || '';
    }

    // Si parece Ollama local, intentamos Ollama primero
    if (normalizedProvider === 'ollama' || safeEndpoint.includes(':11434')) {
      const ollamaEndpoint = safeEndpoint.includes('/api/chat')
        ? safeEndpoint
        : `${safeEndpoint.replace(/\/$/, '')}/api/chat`;

      try {
        const response = await fetch(ollamaEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: modelName,
            messages: messages,
            stream: false,
          }),
        });

        const data = await response.json();

        // SI OLLAMA DICE QUE NO ENCUENTRA EL MODELO, PROBAMOS VÍA OPENAI (LM STUDIO)
        if (!response.ok && (data.error?.includes('not found') || response.status === 404)) {
          console.log(`[Varita] Ollama no encontró el modelo. Reintentando vía OpenAI/LM Studio...`);
          return await callOpenAI(safeEndpoint);
        }

        if (!response.ok) throw new Error(data.error || response.statusText);
        return data.message?.content || data.response || '';

      } catch (ollamaErr: any) {
        // Si hay un error de conexión con Ollama, también probamos la otra vía
        console.log(`[Varita] Error en Ollama, probando vía OpenAI/LM Studio...`);
        return await callOpenAI(safeEndpoint);
      }
    }

    // Si no es Ollama, vamos directos a OpenAI Compatible
    return await callOpenAI(safeEndpoint);

  } catch (err: any) {
    throw new Error(`Error final: ${err.message}`);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userDescription, modelId, isLocalTarget } = body;

    const pbUrl = process.env.POCKETBASE_URL || 'http://localhost:8091';
    const pb = new PocketBase(pbUrl);
    
    const adminEmail = process.env.POCKETBASE_ADMIN_EMAIL || process.env.POCKETBASE_EMAIL;
    const adminPassword = process.env.POCKETBASE_ADMIN_PASSWORD || process.env.POCKETBASE_PASSWORD;

    if (adminEmail && adminPassword) {
      try { await pb.admins.authWithPassword(adminEmail, adminPassword); } catch (e) {}
    }

    const modelRecord = await pb.collection(MODELOS_COLLECTION_NAME).getOne(modelId);
    if (!modelRecord) return NextResponse.json({ error: 'Modelo no encontrado' }, { status: 404 });

    const modelConfig = {
      endpoint: modelRecord[MODELOS_FIELDS.BASE_URL] || modelRecord.base_url || modelRecord.endpoint,
      modelName: modelRecord[MODELOS_FIELDS.MODEL_NAME] || modelRecord.model_name || modelRecord[MODELOS_FIELDS.NAME] || modelRecord.name,
      apiKey: modelRecord[MODELOS_FIELDS.API_KEY] || modelRecord.api_key,
      provider: modelRecord[MODELOS_FIELDS.PROVIDER] || modelRecord.provider || '',
    };

    const systemPrompt = `Eres un experto arquitecto de software. Transforma esta descripción en una especificación técnica profesional. 
    ${isLocalTarget ? 'Sé conciso.' : 'Sé detallado.'} Responde SOLO con la descripción mejorada.`;

    const improvedDescription = await getModelResponse([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userDescription },
    ], modelConfig);

    return NextResponse.json({ sophisticatedPrompt: improvedDescription || '' });
  } catch (error: any) {
    return NextResponse.json({ error: `ERROR CRÍTICO: ${error.message}` }, { status: 500 });
  }
}
