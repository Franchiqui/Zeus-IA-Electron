import PocketBase from 'pocketbase';
import { NextRequest, NextResponse } from 'next/server';
import { getPocketBase, POCKETBASE_EMAIL, POCKETBASE_PASSWORD, PB_COLLECTIONS, authPocketBaseAdmin } from '@/lib/pb-api';
import { MODELOS_FIELDS } from '@/lib/collections';

/**
 * Corrige un error de código usando IA en segundo plano
 * Recibe el código con error y el mensaje de error, devuelve un objeto code_change con reemplazos
 * Usa el modelo seleccionado por el usuario en la barra de navegación
 */

function validateReplacements(changes: any[]): boolean {
  if (!Array.isArray(changes)) return false;
  for (const change of changes) {
    if (!Array.isArray(change.replacements)) return false;
    for (const rep of change.replacements) {
      if (!rep || typeof rep !== 'object') return false;
      if (!('old' in rep)) return false;
      if (!('new' in rep)) return false;
    }
  }
  return true;
}

function extractCodeChange(raw: string): any | null {
  let parsed: any = null;

  // Intentar parsear directamente como JSON
  try {
    parsed = JSON.parse(raw);
  } catch {}

  // Buscar JSON dentro de bloques de código markdown
  if (!parsed) {
    const jsonBlockMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (jsonBlockMatch) {
      try {
        parsed = JSON.parse(jsonBlockMatch[1].trim());
      } catch {}
    }
  }

  // Buscar el objeto JSON más externo que contenga "type":"code_change"
  if (!parsed) {
    const codeChangeMatch = raw.match(/\{[\s\S]*?"type"\s*:\s*"code_change"[\s\S]*?\}/);
    if (codeChangeMatch) {
      try {
        parsed = JSON.parse(codeChangeMatch[0]);
      } catch {}
    }
  }

  if (
    parsed &&
    parsed.type === 'code_change' &&
    Array.isArray(parsed.changes) &&
    validateReplacements(parsed.changes)
  ) {
    return parsed;
  }

  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { code, error, language = 'typescript', modelRecordId, contextStartLine, attempt = 1, openFiles = [], projectStructure = '' } = body;

    if (!code || !error) {
      return NextResponse.json(
        { error: 'Se requiere el código y el mensaje de error' },
        { status: 400 }
      );
    }

    // Prompt para corregir el error usando formato code_change
    const systemPrompt = `Eres un experto en corrección de código ${language}.
Tu trabajo es corregir errores devolviendo un JSON con los reemplazos exactos necesarios.

FORMATO DE RESPUESTA OBLIGATORIO:
Devuelve ÚNICAMENTE un JSON con esta estructura exacta. CADA replacement DEBE incluir AMBOS campos "old" y "new". NUNCA omitas "new":

{
  "type": "code_change",
  "explanation": "Descripción breve del cambio",
  "changes": [
    {
      "file": "nombre_del_archivo",
      "replacements": [
        {
          "old": "texto exacto que existe en el archivo y debe ser reemplazado",
          "new": "texto nuevo que reemplazará al anterior"
        }
      ]
    }
  ]
}

EJEMPLO CORRECTO - importación errónea:
{
  "old": "import 'react/jsx-runtime';",
  "new": "import React from 'react';"
}

EJEMPLO CORRECTO - tipo incorrecto:
{
  "old": "const x: string = 42;",
  "new": "const x: number = 42;"
}

EJEMPLO CORRECTO - añadir importación nueva:
{
  "old": "",
  "new": "import { useState } from 'react';\n"
}

REGLAS ESTRICTAS:
1. El campo "old" debe ser texto EXACTO que existe en el código proporcionado (copia literal)
2. El campo "new" SIEMPRE debe estar presente y contener el texto corregido completo
3. NO incluyas líneas que no cambian en los replacements
4. Si el error es de importación, pon la línea antigua en "old" y la corregida en "new"
5. Si el error es de tipo, pon solo la expresión con error en "old" y la corregida en "new"
6. Si el error es de sintaxis, pon el fragmento erróneo en "old" y el corregido en "new"
7. Puedes hacer múltiples replacements si el error afecta varias líneas
8. NO optimices, NO refactorices - solo corrige el error específico
9. Respeta la indentación original exactamente
10. Devuelve SOLO el JSON, sin bloques de código markdown ni explicaciones`;

    const errorLineInfo = contextStartLine ? `El error está alrededor de la línea ${contextStartLine}.` : '';

    // Preparar contexto de archivos abiertos
    const openFilesContext = openFiles.length > 0
      ? `\n\nARCHIVOS ADICIONALES DISPONIBLES (puedes referenciarlos si es necesario):\n${openFiles.map((f: any) => `\n--- ${f.name} (ruta: ${f.path}) ---\n${f.content}`).join('\n')}`
      : '';

    const attemptInfo = attempt > 1 ? `\n\nIMPORTANTE: Este es el intento ${attempt} de ${3}. La corrección anterior no funcionó. Analiza mejor el error y prueba una solución diferente.` : '';

    const structureContext = projectStructure ? `\n\n${projectStructure}` : '';

    const userPrompt = `Corrige este error en ${language}.

${errorLineInfo}${attemptInfo}
Error específico: ${error}

CÓDIGO COMPLETO:
${code}${openFilesContext}${structureContext}

INSTRUCCIONES:
1. Analiza el error indicado
2. Identifica qué línea o líneas causan el error
3. Copia el texto exacto del error en "old" y la versión corregida en "new"
4. Si necesitas añadir una importación, pon una replacement con old vacío y new con la importación
5. Devuelve SOLO el JSON code_change`;

    // Conectar con PocketBase para obtener la configuración del modelo
    const pb = await getPocketBase();
    await authPocketBaseAdmin(pb);

    let apiKey: string | undefined;
    let apiBaseUrl: string | undefined;
    let model: string = 'gpt-4o-mini';
    let provider: string = 'OpenAI';
    let isLocal = false;

    if (modelRecordId) {
      try {
        console.log('[fix-error] Obteniendo modelo de PocketBase:', modelRecordId);
        const modelRecord = await pb.collection(PB_COLLECTIONS.MODELOS).getOne(modelRecordId);

        apiKey = (modelRecord[MODELOS_FIELDS.API_KEY] as string) || undefined;
        apiBaseUrl = (modelRecord[MODELOS_FIELDS.BASE_URL] as string) || undefined;
        model = (modelRecord[MODELOS_FIELDS.MODEL_NAME] as string) || 'gpt-4o-mini';
        provider = (modelRecord[MODELOS_FIELDS.PROVIDER] as string) || 'OpenAI';
        isLocal = (modelRecord[MODELOS_FIELDS.IS_LOCAL] as boolean) || false;

        console.log('[fix-error] Modelo obtenido de BD:', {
          model,
          provider,
          isLocal,
          hasApiKey: !!apiKey,
          apiBaseUrl: apiBaseUrl || 'default'
        });

        if (provider === 'LM Studio' || provider === 'local' || provider === 'Local') {
          isLocal = true;
          if (!apiKey) apiKey = 'not-needed';
          console.log('[fix-error] Provider es local/LM Studio, usando endpoint local');
        } else if (provider === 'Ollama' || provider === 'Ollama Cloud') {
          if (!apiBaseUrl) apiBaseUrl = provider === 'Ollama Cloud' ? 'https://ollama.com/api/generate' : 'http://localhost:11434/api/chat';
          console.log('[fix-error] Provider es Ollama/Ollama Cloud, usando endpoint:', apiBaseUrl);
        }
      } catch (err) {
        console.error('[fix-error] Error al obtener modelo:', err);
      }
    }

    if (!apiKey) {
      console.log('[fix-error] Sin API key, usando corrección básica');
      return NextResponse.json({
        codeChange: null,
        message: 'No hay API key configurada para este modelo.'
      });
    }

    const isLocalModel = isLocal || (apiBaseUrl && (apiBaseUrl.includes('localhost') || apiBaseUrl.includes('127.0.0.1')));
    const isOllamaCloud = provider === 'Ollama Cloud';

    let endpoint: string;
    if (isLocalModel && apiBaseUrl) {
      if (apiBaseUrl.includes('/v1/chat/completions')) {
        endpoint = apiBaseUrl.replace(/\/$/, '');
      } else {
        endpoint = `${apiBaseUrl.replace(/\/$/, '')}/v1/chat/completions`;
      }
    } else if (provider === 'Deepseek' || provider === 'DeepSeek') {
      endpoint = 'https://api.deepseek.com/chat/completions';
    } else if (isOllamaCloud && apiBaseUrl) {
      endpoint = apiBaseUrl.replace(/\/$/, '');
    } else if (provider === 'Ollama' && apiBaseUrl) {
      endpoint = `${apiBaseUrl.replace(/\/$/, '')}/api/chat`;
    } else {
      endpoint = 'https://api.openai.com/v1/chat/completions';
    }

    console.log('[fix-error] Tipo de modelo:', { isLocalModel, isOllamaCloud, endpoint, provider, apiBaseUrl });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    // Función común para procesar la respuesta del modelo
    const processModelResponse = (rawContent: string) => {
      console.log('[fix-error] Respuesta raw del modelo:', rawContent.substring(0, 300));

      // Intentar extraer el code_change JSON
      const codeChange = extractCodeChange(rawContent);

      if (codeChange) {
        console.log('[fix-error] code_change extraído exitosamente:', JSON.stringify(codeChange).substring(0, 200));
        return { codeChange };
      }

      // Fallback: si el modelo devolvió código completo en vez de code_change
      console.warn('[fix-error] El modelo no devolvió code_change, intentando fallback');
      const cleanedCode = rawContent
        .replace(/^```[a-z]*\n?/i, '')
        .replace(/\n```$/i, '')
        .replace(/\n```\n*$/i, '')
        .trim();

      return { codeChange: null, fallbackFullCode: cleanedCode };
    };

    headers['Authorization'] = `Bearer ${apiKey}`;

    let response: Response;

    if (isOllamaCloud) {
      // Ollama Cloud usa /api/generate con prompt string y stream: false
      const prompt = `System: ${systemPrompt}\n\nUser: ${userPrompt}\n\nAssistant:`;
      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          options: {
            temperature: 0.3,
            num_predict: 16384
          }
        })
      });
    } else {
      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: 16384,
          temperature: 0.3
        })
      });
    }

    if (!response.ok) {
      const errorData = await response.text();
      console.error('[fix-error] Error en API:', errorData);

      if (response.status === 401 || errorData.includes('Incorrect API key') || errorData.includes('invalid_api_key')) {
        return NextResponse.json(
          { error: 'API key inválida', details: 'La API key configurada para este modelo no es válida.' },
          { status: 500 }
        );
      }

      return NextResponse.json(
        { error: 'Error al conectar con la IA', details: errorData },
        { status: 500 }
      );
    }

    let rawContent: string;
    if (isOllamaCloud) {
      const data = await response.json() as any;
      rawContent = data.response || '';
    } else {
      const data = await response.json();
      rawContent = data.choices?.[0]?.message?.content || '';
    }

    const result = processModelResponse(rawContent);

    if (result.codeChange) {
      return NextResponse.json({ codeChange: result.codeChange });
    }

    // Fallback: si no se pudo extraer code_change
    return NextResponse.json({
      codeChange: null,
      message: 'El modelo no devolvió el formato code_change esperado. Intenta de nuevo.'
    });

  } catch (error: any) {
    console.error('[fix-error] Error interno:', error);
    return NextResponse.json(
      { error: 'Error interno al corregir el código', details: error.message },
      { status: 500 }
    );
  }
}
