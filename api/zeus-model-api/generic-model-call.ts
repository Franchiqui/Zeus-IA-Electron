/**
 * Generic model call helper for API routes.
 * Normalizes calls to any provider (OpenAI, Deepseek, LM Studio, Ollama, Ollama Cloud)
 * so routes don't need to duplicate provider-specific logic.
 */

export interface GenericMessage {
  role: string;
  content: string;
}

export interface GenericModelConfig {
  provider?: string;
  model: string;
  url: string;
  apiKey?: string;
}

export interface GenericCallOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stream?: boolean;
  signal?: AbortSignal;
}

function buildPromptFromMessages(messages: GenericMessage[]): string {
  const parts: string[] = [];
  for (const msg of messages) {
    const roleLabel =
      msg.role === 'user' ? 'User' :
      msg.role === 'assistant' ? 'Assistant' :
      msg.role === 'system' ? 'System' :
      msg.role;
    parts.push(`### ${roleLabel}:\n${msg.content}`);
  }
  parts.push('### Assistant:\n');
  return parts.join('\n\n');
}

function normalizeUrlForChatCompletions(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/$/, '');
  if (trimmed.includes('/chat/completions') || trimmed.includes('/api/generate') || trimmed.includes('/api/chat')) {
    return trimmed;
  }
  return `${trimmed}/chat/completions`;
}

export async function callModelGeneric(
  config: GenericModelConfig,
  messages: GenericMessage[],
  options: GenericCallOptions = {}
): Promise<string> {
  const provider = String(config.provider || '').toLowerCase().trim();
  const urlLower = String(config.url || '').toLowerCase();
  const isOllamaCloud =
    provider === 'ollama cloud' || provider === 'ollama_cloud' || provider === 'ollama-cloud' ||
    urlLower.includes('ollama.com') || urlLower.includes('ollama.cloud');

  if (isOllamaCloud) {
    let endpoint = config.url;
    if (!endpoint.includes('/api/generate') && !endpoint.includes('/chat/completions') && !endpoint.includes('/api/chat')) {
      endpoint = `${endpoint.replace(/\/$/, '')}/api/generate`;
    }

    const payload: Record<string, any> = {
      model: config.model,
      prompt: buildPromptFromMessages(messages),
      stream: options.stream ?? false,
    };

    if (typeof options.temperature === 'number') payload.temperature = options.temperature;
    if (typeof options.maxTokens === 'number') payload.num_predict = options.maxTokens;
    if (typeof options.topP === 'number') payload.top_p = options.topP;
    if (typeof options.frequencyPenalty === 'number') payload.repeat_penalty = options.frequencyPenalty;
    if (typeof options.presencePenalty === 'number') payload.presence_penalty = options.presencePenalty;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: options.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama Cloud error (${response.status}): ${error.slice(0, 200)}`);
    }

    const data: any = await response.json();
    return typeof data.response === 'string'
      ? data.response
      : data.message?.content ?? data.output?.[0]?.content?.[0]?.text ?? '';
  }

  // Default: OpenAI-compatible /chat/completions
  const endpoint = normalizeUrlForChatCompletions(config.url);

  const payload: Record<string, any> = {
    model: config.model,
    messages,
    stream: options.stream ?? false,
  };

  if (typeof options.temperature === 'number') payload.temperature = options.temperature;
  if (typeof options.maxTokens === 'number') payload.max_tokens = options.maxTokens;
  if (typeof options.topP === 'number') payload.top_p = options.topP;
  if (typeof options.frequencyPenalty === 'number') payload.frequency_penalty = options.frequencyPenalty;
  if (typeof options.presencePenalty === 'number') payload.presence_penalty = options.presencePenalty;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: options.signal,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Model API error (${response.status}): ${error.slice(0, 200)}`);
  }

  const data: any = await response.json();
  return data.choices?.[0]?.message?.content ?? data.message?.content ?? data.response ?? '';
}

/**
 * Parse a model config from the various shapes PocketBase and the client send.
 */
export function normalizeModelConfig(raw: any): GenericModelConfig | null {
  if (!raw || typeof raw !== 'object') return null;

  const provider = String(raw.provider ?? raw.type ?? 'openai').toLowerCase();
  const model = String(raw.model ?? raw.model_name ?? raw.modelName ?? raw.nombre_modelo ?? '').trim();
  let url = String(raw.url ?? raw.base_url ?? raw.baseURL ?? raw.endpoint ?? '').trim();
  let apiKey = String(raw.apiKey ?? raw.api_key ?? '').trim();

  if (!model) return null;

  // Fallbacks for env-based keys when missing
  if (!apiKey) {
    if (provider.includes('deepseek')) {
      apiKey = process.env.DEEPSEEK_API_KEY || process.env.API_KEY_DEEPSEEK || '';
    } else if (provider.includes('openai')) {
      apiKey = process.env.OPENAI_API_KEY || '';
    }
  }

  // Fallbacks for URLs when missing
  if (!url) {
    if (provider.includes('deepseek')) {
      url = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions';
    } else if (provider.includes('ollama') && !provider.includes('cloud')) {
      url = process.env.LM_STUDIO_URL || 'http://localhost:11434/api/chat';
    } else if (provider.includes('ollama cloud') || provider.includes('ollama_cloud') || provider.includes('ollama-cloud')) {
      url = 'https://ollama.com/api/generate';
    } else {
      url = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions';
    }
  }

  return { provider, model, url, apiKey };
}
