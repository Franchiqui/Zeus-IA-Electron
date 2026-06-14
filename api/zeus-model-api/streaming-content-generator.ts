/**
 * Shared helpers for generate-app content endpoints.
 * Handles Ollama Cloud streaming generation and common post-processing.
 */

import type { GenericMessage } from './generic-model-call';

export interface StreamChunk {
  type: 'content' | 'complete' | 'error';
  filePath: string;
  content?: string;
  chunk?: string;
  error?: string;
  metadata?: {
    linesGenerated?: number;
    estimatedTotal?: number;
    progress?: number;
    duration?: number;
    chunksProcessed?: number;
    validChunks?: number;
  };
}

export function cleanGeneratedContent(content: string): string {
  content = content.replace(/```[a-zA-Z]*\n?/g, '');
  content = content.replace(/```\n?/g, '');

  const lines = content.split('\n');
  let startIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line && !line.startsWith('//') && !line.startsWith('/*') && !line.startsWith('*') && !line.startsWith('<!--')) {
      startIndex = i;
      break;
    }
  }

  return lines.slice(startIndex).join('\n').trim();
}

export function finalizeContent(content: string, filePath: string, template?: string): string {
  let cleaned = cleanGeneratedContent(content);

  // Remove metadata/generateMetadata from page (metadata lives in app/metadata.ts only)
  if ((filePath === 'app/page.tsx' || filePath.endsWith('app/page.tsx')) && template === 'next-js') {
    const beforeMeta = cleaned;
    cleaned = cleaned.replace(/(^|\n)\s*export\s+const\s+metadata\s*=\s*\{[\s\S]*?\};\s*/m, '$1');
    cleaned = cleaned.replace(/(^|\n)\s*export\s+(?:async\s+)?function\s+generateMetadata\s*\([^)]*\)\s*\{[\s\S]*?\n\}\s*/m, '$1');
    if (cleaned !== beforeMeta) {
      console.log('✅ Removed metadata/generateMetadata from app/page.tsx (use app/metadata.ts)');
    }

    // Ensure Footer import is present
    const footerImport = "import Footer from '@/components/layout/footer';";
    if (!cleaned.includes(footerImport)) {
      const lines = cleaned.split('\n');
      let insertIndex = 0;

      // Skip 'use client' if present
      if (lines[0]?.trim() === "'use client';" || lines[0]?.trim() === '"use client";') {
        insertIndex = 1;
      }

      // Find where imports end (first non-import, non-empty line after 'use client')
      for (let i = insertIndex; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line && !line.startsWith('import ') && !line.startsWith('//') && !line.startsWith('/*')) {
          insertIndex = i;
          break;
        }
      }

      // Insert the Footer import
      lines.splice(insertIndex, 0, footerImport);
      cleaned = lines.join('\n');
      console.log('✅ Added Footer import to app/page.tsx');
    }
  }

  return cleaned;
}

export function isValidModelResponse(parsed: any): boolean {
  try {
    return parsed && typeof parsed === 'object' && (parsed.choices || parsed.delta || parsed.content);
  } catch {
    return false;
  }
}

export async function createOllamaCloudStream(options: {
  prompt: string;
  systemMessage: string;
  modelConfig: any;
  filePath: string;
  template?: string;
  optimizeForSpeed?: boolean;
  isLocalModel?: boolean;
}): Promise<ReadableStream> {
  const { prompt, systemMessage, modelConfig, filePath, template, optimizeForSpeed, isLocalModel } = options;
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const startTime = Date.now();
      const messages: GenericMessage[] = [
        { role: 'system', content: systemMessage },
        { role: 'user', content: prompt }
      ];

      // Construir el prompt consolidado que espera /api/generate
      const buildPrompt = (msgs: GenericMessage[]): string => {
        const parts: string[] = [];
        for (const msg of msgs) {
          const roleLabel =
            msg.role === 'user' ? 'User' :
            msg.role === 'assistant' ? 'Assistant' :
            msg.role === 'system' ? 'System' :
            msg.role;
          parts.push(`### ${roleLabel}:\n${msg.content}`);
        }
        parts.push('### Assistant:\n');
        return parts.join('\n\n');
      };

      const fullPrompt = buildPrompt(messages);
      const maxTokens = isLocalModel ? 8000 : (optimizeForSpeed ? 16000 : 32000);

      const endpoint = modelConfig.url;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (modelConfig.apiKey) {
        headers['Authorization'] = `Bearer ${modelConfig.apiKey}`;
      }

      // Estado compartido entre el try principal y el catch
      let clientClosed = false;
      const safeEnqueue = (sse: string) => {
        if (clientClosed) return;
        try {
          controller.enqueue(encoder.encode(sse));
        } catch {
          clientClosed = true;
        }
      };
      const safeClose = () => {
        if (clientClosed) return;
        try {
          controller.close();
        } catch {
          clientClosed = true;
        }
      };

      try {
        // ✅ Streaming real contra Ollama Cloud: recibimos NDJSON y emitimos
        //    eventos SSE incrementales para que el cliente vea progreso.
        const response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: modelConfig.model,
            prompt: fullPrompt,
            stream: true,
            temperature: optimizeForSpeed ? 0.3 : 0.1,
            num_predict: maxTokens,
            top_p: 0.9,
            repeat_penalty: 0.1,
          }),
        });

        if (!response.ok || !response.body) {
          const errText = await response.text().catch(() => '');
          throw new Error(`Ollama Cloud error (${response.status}): ${errText.slice(0, 200)}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let accumulated = '';
        let chunksProcessed = 0;
        let lastEmitAt = 0;

        // Emitir al menos un chunk cada 1.5s aunque el modelo esté pensando,
        // para que el cliente SSE vea progreso y no aborte por inactividad.
        const emitProgress = (force: boolean = false) => {
          if (clientClosed) return;
          const now = Date.now();
          if (!force && now - lastEmitAt < 1500) return;
          if (!accumulated) return;
          lastEmitAt = now;
          chunksProcessed++;
          const contentChunk: StreamChunk = {
            type: 'content',
            filePath,
            chunk: accumulated,
            metadata: {
              linesGenerated: accumulated.split('\n').length,
              estimatedTotal: Math.max(accumulated.split('\n').length, 1),
              progress: 50, // 50% mientras llega, 100% al cerrar
              chunksProcessed,
              validChunks: chunksProcessed,
            }
          };
          safeEnqueue(`data: ${JSON.stringify(contentChunk)}\n\n`);
        };

        // Heartbeat para mantener la conexión SSE viva mientras Ollama
        // "piensa" antes del primer chunk (puede tardar >3 min con
        // kimi-k2.6:cloud). Los comentarios SSE (líneas que empiezan con ":")
        // son ignorados por el cliente EventSource pero cuentan como bytes
        // en la conexión, evitando que el cliente aborte por inactividad.
        const SSE_KEEPALIVE = ': keepalive\n\n';
        const emitKeepalive = () => {
          if (clientClosed) {
            clearInterval(heartbeat);
            return;
          }
          // Si ya hay contenido acumulado, emitir progreso real; si no, keepalive.
          if (accumulated) {
            emitProgress();
          } else {
            safeEnqueue(SSE_KEEPALIVE);
          }
        };
        const heartbeat = setInterval(emitKeepalive, 5000);
        // Emitir un keepalive inmediato para que el cliente vea que el
        // stream está vivo antes incluso de que Ollama responda al fetch.
        safeEnqueue(SSE_KEEPALIVE);

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              try {
                const json = JSON.parse(trimmed);
                if (typeof json.response === 'string') {
                  accumulated += json.response;
                }
                if (json.done) {
                  break;
                }
              } catch {
                // ignorar líneas mal formadas
              }
            }

            emitProgress();
          }
        } finally {
          clearInterval(heartbeat);
        }

        const duration = Date.now() - startTime;
        const finalContent = finalizeContent(accumulated, filePath, template);

        // Emitir chunk final con el contenido completo
        const finalChunk: StreamChunk = {
          type: 'content',
          filePath,
          chunk: finalContent,
          metadata: {
            linesGenerated: finalContent.split('\n').length,
            estimatedTotal: finalContent.split('\n').length,
            progress: 100,
            chunksProcessed: chunksProcessed + 1,
            validChunks: chunksProcessed + 1,
          }
        };
        safeEnqueue(`data: ${JSON.stringify(finalChunk)}\n\n`);

        const completeChunk: StreamChunk = {
          type: 'complete',
          filePath,
          content: finalContent,
          metadata: {
            linesGenerated: finalContent.split('\n').length,
            progress: 100,
            duration,
            chunksProcessed: chunksProcessed + 1,
            validChunks: chunksProcessed + 1,
          }
        };
        safeEnqueue(`data: ${JSON.stringify(completeChunk)}\n\n`);
        safeClose();
      } catch (error: any) {
        const errorChunk: StreamChunk = {
          type: 'error',
          filePath,
          error: error.message || 'Ollama Cloud generation failed'
        };
        safeEnqueue(`data: ${JSON.stringify(errorChunk)}\n\n`);
        safeClose();
      }
    }
  });
}
