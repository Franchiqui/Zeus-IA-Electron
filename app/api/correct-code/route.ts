import { NextRequest, NextResponse } from 'next/server';
import { UsageService, getModelsForUser } from '@/api/utils';
import { getPocketBase } from '@/lib/pocketbase';
import { callModelGeneric } from '@/api/zeus-model-api/generic-model-call';
import fs from 'fs/promises';
import path from 'path';

interface ModelConfig {
  provider: string;
  model: string;
  url: string;
  apiKey: string;
  id?: string;
}

interface UpdateItem {
  filePath: string;
  issueSummary: string;
  patchSnippet?: string;
  currentContent?: string;
}

async function getEffectiveModel(userId?: string, modelId?: string, userToken?: string): Promise<ModelConfig> {
  let effectiveModel: Partial<ModelConfig> | undefined;

  if (modelId && userId) {
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
      }
    } catch {}
  }

  if (!effectiveModel || !effectiveModel.model) {
    effectiveModel = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      url: 'https://api.openai.com/v1',
      apiKey: process.env.OPENAI_API_KEY || '',
    };
  }
  return effectiveModel as ModelConfig;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { updates, projectRoot, projectId, userId, model: clientModel, modelConfig: clientModelConfig, modelId } = body;

    if (!Array.isArray(updates) || updates.length === 0) {
      console.warn('[correct-code] No se recibieron actualizaciones válidas');
      return NextResponse.json({ error: 'updates debe ser un array no vacío' }, { status: 400 });
    }

    const userToken = request.headers.get('authorization')?.split(' ')[1];
    const incomingModel = clientModel || clientModelConfig;
    const modelConfig = incomingModel?.apiKey ? incomingModel : await getEffectiveModel(userId, modelId, userToken);

    console.log(`[correct-code] 🚀 Iniciando corrección de ${updates.length} archivos`);
    console.log(`[correct-code] 🤖 Usando modelo: ${modelConfig.model} (URL: ${modelConfig.url})`);

    const results = await Promise.all(updates.map(async (update: UpdateItem) => {
      try {
        let content = update.currentContent;
        const normalizedPath = update.filePath.replace(/\\/g, '/').replace(/^\/+/, '');

        // Si no hay contenido, intentar leer del disco
        if (!content && projectRoot) {
          try {
            const fullPath = path.join(projectRoot, normalizedPath);
            console.log(`[correct-code] 🔍 Leyendo ${normalizedPath} desde ${fullPath}`);
            content = await fs.readFile(fullPath, 'utf8');
          } catch (e: any) {
            console.warn(`[correct-code] ⚠️ No se pudo leer ${normalizedPath}:`, e.message);
          }
        }

        if (!content) {
          console.error(`[correct-code] ❌ No hay contenido para ${normalizedPath}`);
          return { filePath: normalizedPath, error: 'No se pudo obtener el contenido del archivo', success: false };
        }

        console.log(`[correct-code] 🛠️ Corrigiendo ${normalizedPath} (${content.length} bytes)`);

        const prompt = `Actúa como un experto Ingeniero de Software Senior. Tu tarea es aplicar cambios específicos a un archivo de código basándote en un objetivo y piezas de código (reemplazos) que fallaron al aplicarse automáticamente.

ARCHIVO: ${normalizedPath}
OBJETIVO: ${update.issueSummary}

${update.patchSnippet ? `DETALLES DE LOS CAMBIOS (REEMPLAZOS QUE FALLARON):\n${update.patchSnippet}\n` : ''}

CONTENIDO ACTUAL DEL ARCHIVO:
---
${content}
---

INSTRUCCIONES CRÍTICAS:
1. Analiza el contenido actual y aplica las modificaciones solicitadas.
2. Si los reemplazos fallaron por diferencias de espacios o indentación, búscalos de forma flexible y aplícalos.
3. Mantén el resto del archivo EXACTAMENTE igual (importaciones, lógica no relacionada, etc.).
4. Devuelve EXCLUSIVAMENTE el código fuente completo del archivo resultante.
5. NO incluyas bloques de código markdown (como \`\`\`tsx).
6. NO incluyas ninguna explicación, prefacio ni comentario fuera del código.
7. Si el cambio ya parece estar aplicado, devuelve el contenido original.

CÓDIGO RESULTANTE:`;

        let correctedContent: string;
        try {
          correctedContent = await callModelGeneric(
            {
              provider: modelConfig.provider,
              model: modelConfig.model,
              url: modelConfig.url,
              apiKey: modelConfig.apiKey,
            },
            [{ role: 'user', content: prompt }],
            { temperature: 0.1, maxTokens: 4000 }
          );
        } catch (err: any) {
          throw new Error(`API Error: ${err?.message || String(err)}`);
        }

        // Limpieza agresiva de markdown
        correctedContent = correctedContent.trim();
        if (correctedContent.startsWith('```')) {
          correctedContent = correctedContent.replace(/^```[a-z]*\n/i, '').replace(/\n```$/m, '');
        }

        console.log(`[correct-code] ✅ ${normalizedPath} corregido exitosamente (${correctedContent.length} bytes)`);

        return {
          filePath: normalizedPath,
          correctedContent,
          success: true
        };
      } catch (err: any) {
        console.error(`[correct-code] ❌ Error en ${update.filePath}:`, err.message);
        return { filePath: update.filePath, error: err.message, success: false };
      }
    }));

    const successCount = results.filter(r => r.success).length;
    console.log(`[correct-code] 🏁 Proceso finalizado. Éxitos: ${successCount}/${results.length}`);

    return NextResponse.json({ results });
  } catch (error: any) {
    console.error('[correct-code] Error general:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
