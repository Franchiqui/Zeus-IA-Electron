// Bucle de tool calls nativas para el chat de Zeus-IA.
// Funciona con cualquier provider compatible con la API de OpenAI
// (OpenAI, Deepseek, LM Studio, Ollama /api/chat).
// Si el modelo no soporta tools, hace fallback a texto plano.
import { ZEUS_TOOLS, executeTool, type ToolCall } from './tools';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface CallModelWithToolsOptions {
  provider: string;
  model: string;
  apiUrl: string;
  apiKey?: string;
  messages: ChatMessage[];
  cwd: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  isLocalModel?: boolean;
  maxIterations?: number;
  /** Callback que se llama cada vez que una tool se ejecuta (para streaming progresivo). */
  onToolProgress?: (entry: ToolLogEntry, totalSoFar: number) => void;
}

export interface ToolLogEntry {
  name: string;
  args: Record<string, any>;
  result: string;
  status: 'success' | 'error';
  durationMs: number;
}

export interface ToolLoopResult {
  text: string;
  toolLog: ToolLogEntry[];
}

const MAX_TOOL_ITERATIONS = 100;

export async function callModelWithTools(opts: CallModelWithToolsOptions): Promise<string> {
  const result = await callModelWithToolsDetailed(opts);
  return result.text;
}

export async function callModelWithToolsDetailed(opts: CallModelWithToolsOptions): Promise<ToolLoopResult> {
  const {
    provider, model, apiUrl, apiKey, messages, cwd,
    temperature, maxTokens, topP, frequencyPenalty, presencePenalty,
    isLocalModel = false,
    maxIterations = MAX_TOOL_ITERATIONS,
    onToolProgress,
  } = opts;

  // Ollama Cloud usa el MISMO /api/chat que Ollama local (soporta tools).
  // Si el modelo no soporta tools, el propio loop hace fallback sin tools.
  const isOllama = provider === 'Ollama' || provider === 'Ollama Cloud';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey && provider !== 'Ollama' && provider !== 'LM Studio') {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  let currentMessages = [...messages];
  let lastText = '';
  const toolLog: ToolLogEntry[] = [];

  for (let iter = 0; iter < maxIterations; iter++) {
    // Construir payload
    const payload: Record<string, any> = {
      model,
      messages: currentMessages,
      stream: false,
      tools: ZEUS_TOOLS,
      tool_choice: 'auto',
    };

    if (typeof temperature === 'number') payload.temperature = temperature;
    if (typeof maxTokens === 'number') {
      payload.max_tokens = maxTokens;
      // Ollama usa num_predict
      if (isOllama) {
        payload.options = { ...(payload.options || {}), num_predict: maxTokens };
        delete payload.max_tokens;
      }
    }
    if (typeof topP === 'number') {
      payload.top_p = topP;
      if (isOllama) {
        payload.options = { ...(payload.options || {}), top_p: topP };
        delete payload.top_p;
      }
    }
    if (typeof frequencyPenalty === 'number') {
      payload.frequency_penalty = frequencyPenalty;
      if (isOllama) {
        payload.options = { ...(payload.options || {}), repeat_penalty: frequencyPenalty };
        delete payload.frequency_penalty;
      }
    }
    if (typeof presencePenalty === 'number') {
      payload.presence_penalty = presencePenalty;
      if (isOllama) {
        payload.options = { ...(payload.options || {}), presence_penalty: presencePenalty };
        delete payload.presence_penalty;
      }
    }

    // Ollama /api/chat usa stream: false directamente
    if (isOllama) {
      payload.stream = false;
    }

    let response: Response;
    try {
      response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
    } catch (err: any) {
      // Si falla con tools, intentar sin tools
      console.warn(`[toolLoop] fetch error (iter ${iter}), fallback sin tools:`, err.message);
      return callWithoutTools(opts);
    }

    if (!response.ok) {
      const errorText = await response.text();
      // Si el error es por tools no soportadas (400/422), fallback sin tools
      if (response.status === 400 || response.status === 422) {
        console.warn(`[toolLoop] Provider ${provider} rechazó tools (${response.status}), fallback sin tools: ${errorText.slice(0, 200)}`);
        return callWithoutTools(opts);
      }
      throw new Error(`${provider} error: ${errorText}`);
    }

    const data: any = await response.json();

    // Extraer mensaje de la respuesta (formato OpenAI compatible)
    const choice = data.choices?.[0];
    const ollamaMsg = data.message;
    const assistantMsg = choice?.message ?? ollamaMsg;

    if (!assistantMsg) {
      console.warn('[toolLoop] Respuesta sin mensaje, datos:', JSON.stringify(data).slice(0, 200));
      return { text: lastText || 'Sin respuesta del modelo', toolLog };
    }

    const text = assistantMsg.content ?? '';
    const toolCalls = assistantMsg.tool_calls;

    // Si no hay tool_calls, el modelo terminó — devolver el texto.
    // Algunos modelos locales (p. ej. Qwen3.5-4B en llama.cpp) ejecutan las
    // tools con content vacío y terminan con un mensaje final vacío (el
    // trabajo se hizo vía write_file). En ese caso forzar una llamada final
    // sin tools pidiendo el resumen; si aún así sale vacía, sintetizarlo del
    // toolLog para que la burbuja nunca quede sin respuesta.
    if (!toolCalls || !Array.isArray(toolCalls) || toolCalls.length === 0) {
      if (text) return { text, toolLog };
      if (lastText) return { text: lastText, toolLog };
      if (toolLog.length > 0) {
        const summary = await callForFinalSummary(opts, currentMessages, toolLog);
        return { text: summary, toolLog };
      }
      return { text: 'Sin respuesta', toolLog };
    }

    lastText = text;

    // Añadir el mensaje del asistente (con tool_calls) al historial
    currentMessages.push({
      role: 'assistant',
      content: text || '',
      tool_calls: toolCalls,
    });

    // Ejecutar cada tool call y añadir los resultados
    for (const tc of toolCalls) {
      const toolName = tc.function?.name || '';
      const rawArgs = tc.function?.arguments;
      let args: Record<string, any> = {};
      // OpenAI devuelve arguments como STRING JSON ("{\"path\":...}").
      // Ollama (local y Cloud) devuelve un OBJETO ya parseado.
      // Si JSON.parse falla (o no es string), usar el objeto tal cual.
      if (typeof rawArgs === 'string' && rawArgs.trim()) {
        try {
          args = JSON.parse(rawArgs);
        } catch {
          args = {};
        }
      } else if (rawArgs && typeof rawArgs === 'object') {
        args = rawArgs as Record<string, any>;
      }

      console.log(`[toolLoop] iter ${iter} → ${toolName}(${JSON.stringify(args).slice(0, 100)})`);

      const startTime = Date.now();
      const result = await executeTool(toolName, args, cwd);
      const durationMs = Date.now() - startTime;

      // Determinar status
      let status: 'success' | 'error' = 'success';
      try {
        const parsed = JSON.parse(result);
        if (parsed.error) status = 'error';
      } catch { /* texto plano = success */ }

      // Registrar en el log
      toolLog.push({ name: toolName, args, result, status, durationMs });

      // Notificar progreso para streaming
      if (onToolProgress) {
        try { onToolProgress({ name: toolName, args, result, status, durationMs }, toolLog.length); } catch {}
      }

      // Log truncado para debugging
      console.log(`[toolLoop] ${toolName} (${durationMs}ms) resultado: ${result.slice(0, 200)}${result.length > 200 ? '...' : ''}`);

      currentMessages.push({
        role: 'tool',
        content: result,
        tool_call_id: tc.id,
      } as ChatMessage);
    }

    // Continuar el bucle — el modelo verá los resultados y decidirá si necesita más tools
  }

  // Si llegamos al límite de iteraciones, devolver lo último
  console.warn(`[toolLoop] Alcanzado límite de ${maxIterations} iteraciones`);
  if (lastText) return { text: lastText, toolLog };
  if (toolLog.length > 0) {
    const summary = await callForFinalSummary(opts, currentMessages, toolLog);
    return { text: summary, toolLog };
  }
  return { text: 'Se alcanzó el límite de iteraciones de tools sin respuesta final.', toolLog };
}

// Llamada final sin tools: algunos modelos locales (p. ej. Qwen3.5-4B en
// llama.cpp) terminan el turno con content VACÍO tras ejecutar las tools
// (hacen el trabajo vía write_file y se detienen sin resumen). Esta llamada
// les pide explícitamente la respuesta final; si aún así sale vacía, se
// sintetiza un resumen a partir del toolLog para que la burbuja nunca quede
// sin respuesta.
async function callForFinalSummary(
  opts: CallModelWithToolsOptions,
  messages: ChatMessage[],
  toolLog: ToolLogEntry[]
): Promise<string> {
  const { provider, model, apiUrl, apiKey, temperature, maxTokens, topP } = opts;
  const isOllama = provider === 'Ollama' || provider === 'Ollama Cloud';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey && provider !== 'Ollama' && provider !== 'LM Studio') {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const nudgeMessages: ChatMessage[] = [
    ...messages,
    {
      role: 'user',
      content: 'Escribe tu respuesta final ahora: resume brevemente qué has hecho con las herramientas y cuál es el resultado.',
    },
  ];

  // Sin tools: forzar que el modelo responda en texto plano.
  const payload: Record<string, any> = {
    model,
    messages: nudgeMessages,
    stream: false,
  };
  if (typeof temperature === 'number') payload.temperature = temperature;
  if (typeof maxTokens === 'number') {
    payload.max_tokens = maxTokens;
    if (isOllama) {
      payload.options = { ...(payload.options || {}), num_predict: maxTokens };
      delete payload.max_tokens;
    }
  }
  if (typeof topP === 'number') {
    payload.top_p = topP;
    if (isOllama) {
      payload.options = { ...(payload.options || {}), top_p: topP };
      delete payload.top_p;
    }
  }

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      console.warn('[toolLoop] Llamada final de resumen falló:', (await response.text()).slice(0, 200));
      return '';
    }
    const data: any = await response.json();
    const choice = data.choices?.[0];
    const ollamaMsg = data.message;
    const answer = (choice?.message?.content ?? ollamaMsg?.content ?? '').trim();
    if (answer) return answer;
  } catch (err: any) {
    console.warn('[toolLoop] Error en llamada final de resumen:', err.message);
  }

  // Último recurso: sintetizar resumen del toolLog para que la burbuja no quede vacía.
  if (toolLog.length > 0) {
    const actions = [...new Set(toolLog.map(t => t.name))];
    return `He completado las siguientes acciones con las herramientas: ${actions.join(', ')}.`;
  }
  return 'Sin respuesta';
}

// Fallback: llamada sin tools (sistema anterior)
async function callWithoutTools(opts: CallModelWithToolsOptions): Promise<ToolLoopResult> {
  const { provider, model, apiUrl, apiKey, messages, temperature, maxTokens, topP, frequencyPenalty, presencePenalty } = opts;

  const isOllama = provider === 'Ollama';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey && provider !== 'Ollama' && provider !== 'LM Studio') {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  // Quitar mensajes de tool del historial (no soportados sin tools)
  const cleanMessages = messages.filter(m => m.role !== 'tool' && !m.tool_calls);
  // Quitar tool_call_id y tool_calls de los mensajes
  const safeMessages = cleanMessages.map(m => ({
    role: m.role,
    content: m.content,
  }));

  const payload: Record<string, any> = {
    model,
    messages: safeMessages,
    stream: false,
  };

  if (typeof temperature === 'number') payload.temperature = temperature;
  if (typeof maxTokens === 'number') {
    if (isOllama) {
      payload.options = { num_predict: maxTokens };
    } else {
      payload.max_tokens = maxTokens;
    }
  }
  if (typeof topP === 'number') {
    if (isOllama) {
      payload.options = { ...(payload.options || {}), top_p: topP };
    } else {
      payload.top_p = topP;
    }
  }
  if (typeof frequencyPenalty === 'number') {
    if (isOllama) {
      payload.options = { ...(payload.options || {}), repeat_penalty: frequencyPenalty };
    } else {
      payload.frequency_penalty = frequencyPenalty;
    }
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${provider} error (fallback): ${errorText}`);
  }

  const data: any = await response.json();
  const choice = data.choices?.[0];
  const ollamaMsg = data.message;
  const answer = choice?.message?.content ?? ollamaMsg?.content ?? 'Sin respuesta';
  return { text: answer, toolLog: [] };
}