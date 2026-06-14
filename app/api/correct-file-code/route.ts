import { NextRequest, NextResponse } from 'next/server';
import { UsageService, getProjectRoot, getModelsForUser } from '@/api/utils';
import { getPocketBase } from '@/lib/pocketbase';
import { applyCodeChanges } from '@/utils/codeApplier';
import { callModelGeneric } from '@/api/zeus-model-api/generic-model-call';
import fs from 'fs/promises';
import path from 'path';

function getModelConfig() {
  return {
    baseURL: process.env.OPENAI_URL || process.env.LM_STUDIO_URL || '',
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.LM_STUDIO_MODEL || process.env.OPENAI_MODEL || process.env.DEFAULT_CHAT_MODEL || 'gpt-4o-mini',
  };
}

// ✅ Función auxiliar para obtener el modelo seleccionado del usuario (copiada de fix-missing-imports)
async function getEffectiveModel(userId?: string, modelId?: string, userToken?: string): Promise<{ provider: string; model: string; url: string; apiKey: string }> {
  let effectiveModel: { provider?: string; model?: string; url?: string; apiKey?: string } | undefined;

  if (modelId) {
    try {
      const pb = await getPocketBase();
      if (userToken) {
        try { pb.authStore.save(userToken, null as any); } catch {}
      }
      try {
        const record: any = await pb.collection('ai_models').getOne(modelId, { $autoCancel: false } as any);
        effectiveModel = {
          provider: record.provider || record.type || 'openai',
          model: record.model_name,
          url: record.base_url,
          apiKey: record.api_key,
        };
        console.log(`[post-correct] Modelo seleccionado (ai_models): ${effectiveModel.model} (${effectiveModel.provider})`);
        return effectiveModel as { provider: string; model: string; url: string; apiKey: string };
      } catch (e) {
        console.warn('[post-correct] Failed to get model by ID:', e);
      }
    } catch (e) {
      console.warn('[post-correct] Error inicializando PocketBase:', e);
    }
  }

  if (userId) {
    try {
      if (modelId) {
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
        try {
          const allModels = await getModelsForUser(userId);
          if (allModels && allModels.length > 0) {
            const defaultModel = allModels[0];
            effectiveModel = {
              provider: defaultModel.provider || 'openai',
              model: defaultModel.model || defaultModel.model_name,
              url: defaultModel.url || defaultModel.base_url,
              apiKey: defaultModel.apiKey || defaultModel.api_key,
            };
          }
        } catch {}
      }
    } catch {}
  }

  if (!effectiveModel || !effectiveModel.model) {
    console.warn(`[post-correct] No se pudo resolver el modelo. Usando fallback sin apiKey.`);
    effectiveModel = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      url: 'https://api.openai.com/v1',
      apiKey: '',
    };
  }
  return effectiveModel as { provider: string; model: string; url: string; apiKey: string };
}

// Función para extraer importaciones del contenido
function extractImports(content: string): string[] {
  const imports: string[] = [];
  
  // Regex para capturar diferentes formatos de import
  const importRegex1 = /import\s+[^'"]+['"]([^'"]+)['"]/g;
  const importRegex2 = /import\s+(?:[\w{},\s*]+)\s+from\s+['"]([^'"]+)['"]/g;
  const importRegex3 = /import\(['"]([^'"]+)['"]\)/g;
  // ✅ NUEVA: Regex para capturar importaciones dinámicas de Next.js: dynamic(() => import('@/...'))
  const dynamicImportRegex = /dynamic\s*\(\s*\(\)\s*=>\s*import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  
  let match;
  
  // Procesar con todas las regex
  importRegex1.lastIndex = 0;
  while ((match = importRegex1.exec(content)) !== null) {
    if (match[1] && match[1].startsWith('@/')) {
      imports.push(match[1]);
    }
  }
  
  importRegex2.lastIndex = 0;
  while ((match = importRegex2.exec(content)) !== null) {
    if (match[1] && match[1].startsWith('@/')) {
      imports.push(match[1]);
    }
  }
  
  importRegex3.lastIndex = 0;
  while ((match = importRegex3.exec(content)) !== null) {
    if (match[1] && match[1].startsWith('@/')) {
      imports.push(match[1]);
    }
  }
  
  // ✅ NUEVA: Procesar importaciones dinámicas de Next.js
  dynamicImportRegex.lastIndex = 0;
  while ((match = dynamicImportRegex.exec(content)) !== null) {
    if (match[1] && match[1].startsWith('@/')) {
      console.log(`📝 [POST-CORRECT] Dynamic import detectado: "${match[1]}"`);
      imports.push(match[1]);
    }
  }
  
  // Eliminar duplicados
  return [...new Set(imports)];
}

// Función para guardar las importaciones detectadas
async function saveDetectedImports(projectId: string, imports: string[], projectRoot: string) {
  try {
    const importsData = {
      projectId,
      imports,
      detectedAt: new Date().toISOString(),
      sourceFile: 'app/page.tsx'
    };
    
    // Guardar en un archivo temporal en el projectRoot
    const importsFilePath = path.join(projectRoot, '.detected-imports.json');
    await fs.writeFile(importsFilePath, JSON.stringify(importsData, null, 2), 'utf-8');
    console.log(`📝 [POST-CORRECT] Importaciones detectadas guardadas en archivo: ${imports.length} imports`);
    console.log(`📝 [POST-CORRECT] Archivo: ${importsFilePath}`);
    
    // ✅ TAMBIÉN GUARDAR EN POCKETBASE (registro fijo en colección list_of_components)
    const FIXED_RECORD_ID = process.env.POCKETBASE_COMPONENTS_RECORD_ID || 'szh5nlfkb7zbgd6';
    try {
      const { getPocketBase } = await import('@/lib/pocketbase');
      const pb = await getPocketBase();
      
      const adminEmail = process.env.POCKETBASE_EMAIL || process.env.NEXT_PUBLIC_POCKETBASE_EMAIL;
      const adminPass = process.env.POCKETBASE_PASSWORD || process.env.NEXT_PUBLIC_POCKETBASE_PASSWORD;
      if (adminEmail && adminPass) {
        try {
          await pb.admins.authWithPassword(adminEmail, adminPass);
        } catch {
          await pb.collection('users').authWithPassword(adminEmail, adminPass);
        }
      }
      
      await pb.collection('list_of_components').update(FIXED_RECORD_ID, {
        components: importsData
      });
      console.log(`📝 [POST-CORRECT] Importaciones guardadas en PocketBase: ${imports.length} imports`);
      console.log(`📝 [POST-CORRECT] Imports:`, imports);
    } catch (pbError: any) {
      console.warn('⚠️ [POST-CORRECT] Error guardando en PocketBase (no crítico):', pbError?.message);
    }
    
    return true;
  } catch (error) {
    console.warn('⚠️ [POST-CORRECT] Error guardando importaciones detectadas:', error);
    return false;
  }
}

interface CorrectionRequest {
  projectPath?: string;
  fileName?: string;
  fileContent?: string; // Contenido del archivo para producción
  projectId?: string; // ID del proyecto para actualizar el ZIP
  userToken?: string; // Token de usuario para actualizar el ZIP
  modelConfig?: {
    [x: string]: string | undefined;
    url: string;
    apiKey: string;
    model: string;
    id?: string;
    name?: string;
  };
}

function extractMetadataSection(source: string): string {
  const s = source || '';
  const metaConstMatch = s.match(/(^|\n)export\s+const\s+metadata\s*=\s*\{[\s\S]*?\};\s*/m);
  if (metaConstMatch && metaConstMatch[0]) return metaConstMatch[0].trim() + '\n\n';

  const genMetaMatch = s.match(/(^|\n)export\s+(?:async\s+)?function\s+generateMetadata\s*\([\s\S]*?\n\}\s*/m);
  if (genMetaMatch && genMetaMatch[0]) return genMetaMatch[0].trim() + '\n\n';

  return '';
}

function hasMetadataExports(source: string): boolean {
  return /(export\s+const\s+metadata\b|export\s+(?:async\s+)?function\s+generateMetadata\b)/.test(source || '');
}

function stripUseClientDirective(source: string): string {
  return (source || '').replace(/^\s*("use client"|'use client');\s*\n+/m, '');
}

function stripMetadataExports(source: string): string {
  let s = source || '';
  s = s.replace(/(^|\n)export\s+const\s+metadata\s*=\s*\{[\s\S]*?\};\s*/m, '$1');
  s = s.replace(/(^|\n)export\s+(?:async\s+)?function\s+generateMetadata\s*\([\s\S]*?\n\}\s*/m, '$1');
  return s;
}

function sanitizeModelJson(raw: string): string {
  const input = raw || '';
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      out += ch;
      escaped = true;
      continue;
    }

    if (ch === '"') {
      out += ch;
      inString = !inString;
      continue;
    }

    if (inString) {
      if (ch === '\n') {
        out += '\\n';
        continue;
      }
      if (ch === '\r') {
        out += '\\r';
        continue;
      }
      if (ch === '\t') {
        out += '\\t';
        continue;
      }
    }

    out += ch;
  }

  return out;
}

function base64ToUtf8(value: string): string {
  if (!value) return '';
  try {
    // eslint-disable-next-line no-undef
    if (typeof Buffer !== 'undefined') {
      // eslint-disable-next-line no-undef
      return Buffer.from(value, 'base64').toString('utf8');
    }
  } catch {
    // ignore
  }
  try {
    // eslint-disable-next-line no-undef
    if (typeof atob !== 'undefined') {
      // eslint-disable-next-line no-undef
      const binary = atob(value);
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      return new TextDecoder('utf-8').decode(bytes);
    }
  } catch {
    // ignore
  }
  return '';
}

function extractAndParseCodeChangeJson(text: string): any {
  const assistantMessage = text || '';

  const jsonBlockMatch = assistantMessage.match(/```\s*json\s*(?:\r?\n)?([\s\S]*?)(?:\r?\n)?```/i);
  if (jsonBlockMatch) {
    const rawJson = jsonBlockMatch[1].trim();
    return JSON.parse(sanitizeModelJson(rawJson));
  }

  let braceCount = 0;
  let startIdx = -1;
  let endIdx = -1;

  for (let i = 0; i < assistantMessage.length; i++) {
    if (assistantMessage[i] === '{') {
      if (startIdx === -1) startIdx = i;
      braceCount++;
    } else if (assistantMessage[i] === '}') {
      braceCount--;
      if (braceCount === 0 && startIdx !== -1) {
        endIdx = i;
        break;
      }
    }
  }

  if (startIdx !== -1 && endIdx !== -1) {
    const jsonStr = assistantMessage.substring(startIdx, endIdx + 1);
    return JSON.parse(sanitizeModelJson(jsonStr));
  }

  return null;
}

/** Extrae "explanation" de un JSON truncado */
function extractExplanationFromTruncatedJson(text: string): string | null {
  const prefix = '"explanation":';
  const idx = text.indexOf(prefix);
  if (idx === -1) return null;
  let i = idx + prefix.length;
  while (i < text.length && /[\s\n\r]/.test(text[i])) i++;
  if (i >= text.length || text[i] !== '"') return null;
  i++;
  const result: string[] = [];
  while (i < text.length) {
    const c = text[i];
    if (c === '\\' && i + 1 < text.length) {
      const next = text[i + 1];
      if (next === 'n') { result.push('\n'); i += 2; continue; }
      if (next === 'r') { result.push('\r'); i += 2; continue; }
      if (next === 't') { result.push('\t'); i += 2; continue; }
      if (next === '"' || next === '\\') { result.push(next); i += 2; continue; }
    }
    if (c === '"') break;
    result.push(c);
    i++;
  }
  const s = result.join('').trim();
  return s.length > 0 ? s : null;
}

/** Extrae fullContent de un JSON truncado (cuando la respuesta del modelo se corta) */
function extractFullContentFromTruncatedJson(text: string): string | null {
  const prefix = '"fullContent":';
  const idx = text.indexOf(prefix);
  if (idx === -1) return null;
  const start = idx + prefix.length;
  let i = start;
  while (i < text.length && /[\s\n\r]/.test(text[i])) i++;
  if (i >= text.length || text[i] !== '"') return null;
  i++;
  const contentStart = i;
  const result: string[] = [];
  while (i < text.length) {
    const c = text[i];
    if (c === '\\' && i + 1 < text.length) {
      const next = text[i + 1];
      if (next === 'n') { result.push('\n'); i += 2; continue; }
      if (next === 'r') { result.push('\r'); i += 2; continue; }
      if (next === 't') { result.push('\t'); i += 2; continue; }
      if (next === '"' || next === '\\') { result.push(next); i += 2; continue; }
    }
    if (c === '"') break;
    result.push(c);
    i++;
  }
  const extracted = result.join('');
  return extracted.length > 100 && (extracted.includes('export') || extracted.includes('return') || extracted.includes('function')) ? extracted : null;
}

export async function POST(request: NextRequest) {
  console.log('🔧 [POST-CORRECT] ============================================');
  console.log('🔧 [POST-CORRECT] API de post-corrección llamada');
  console.log('🔧 [POST-CORRECT] ============================================');
  
  try {
    const body: CorrectionRequest = await request.json();
    const { projectPath, fileName = 'app/page.tsx', fileContent: providedContent, projectId, userToken, modelConfig: customModelConfig } = body;
    
    console.log('🔧 [POST-CORRECT] Parámetros recibidos:', {
      fileName,
      hasProjectPath: !!projectPath,
      hasFileContent: !!providedContent,
      hasProjectId: !!projectId,
      hasUserToken: !!userToken,
      hasModelConfig: !!customModelConfig
    });

    let fileContent: string;

    // Si se proporciona el contenido directamente (producción), usarlo
    if (providedContent) {
      fileContent = providedContent;
      console.log('📄 Usando contenido proporcionado directamente (modo producción)');
    } 
    // Si no, intentar leer del sistema de archivos (desarrollo local)
    else if (projectPath) {
      try {
        const filePath = path.join(projectPath, fileName);
        fileContent = await fs.readFile(filePath, 'utf-8');
        console.log('📄 Archivo leído del sistema de archivos (modo desarrollo)');
      } catch (error) {
        return NextResponse.json(
          { error: `No se pudo leer el archivo: ${fileName}` },
          { status: 404 }
        );
      }
    } else {
      return NextResponse.json(
        { error: 'Se requiere projectPath o fileContent' },
        { status: 400 }
      );
    }

    // 🔍 DETECTAR Y GUARDAR IMPORTACIONES ANTES DE CORREGIR
    if (projectId && projectPath) {
      try {
        const detectedImports = extractImports(fileContent);
        if (detectedImports.length > 0) {
          console.log(`🔍 [POST-CORRECT] Detectadas ${detectedImports.length} importaciones en ${fileName}:`, detectedImports);
          await saveDetectedImports(projectId, detectedImports, projectPath);
        } else {
          console.log('🔍 [POST-CORRECT] No se detectaron importaciones con alias (@/) en el archivo');
        }
      } catch (importError) {
        console.warn('⚠️ [POST-CORRECT] Error detectando importaciones (no crítico):', importError);
      }
    }

    // Obtener configuración del modelo
    let modelConfig: any = customModelConfig;
    // Si customModelConfig no tiene url/apiKey, intentar obtener desde PocketBase
    if (!modelConfig?.url || !modelConfig?.apiKey) {
      try {
        const eff = await getEffectiveModel(undefined, modelConfig?.id || modelConfig?.model, userToken);
        modelConfig = {
          url: eff.url,
          apiKey: eff.apiKey,
          model: eff.model,
          ...modelConfig,
        };
        console.log('[POST-CORRECT] Modelo resuelto desde PocketBase:', eff.model, 'url:', eff.url);
      } catch {
        console.warn('[POST-CORRECT] No se pudo resolver modelo desde PocketBase, usando fallback');
      }
    }
    if (!modelConfig?.url) {
      const defaultModelConfig = getModelConfig();
      modelConfig = {
        url: defaultModelConfig.baseURL,
        apiKey: defaultModelConfig.apiKey,
        model: defaultModelConfig.model,
        ...modelConfig,
      };
    }

    // Detectar y corregir automáticamente errores comunes antes de enviar al modelo
    let preCorrectedContent = fileContent;
    
    // 1. Detectar y corregir llaves, paréntesis y corchetes sin cerrar antes del return (causa del error "Unexpected token div")
    if (preCorrectedContent.includes('return (') || preCorrectedContent.includes('return(') || preCorrectedContent.includes('return <')) {
      const returnMatch = preCorrectedContent.match(/return\s*[<(]/);
      if (returnMatch && returnMatch.index !== undefined) {
        const returnIndex = returnMatch.index;
        const beforeReturn = preCorrectedContent.substring(0, returnIndex);
        const functionMatch = beforeReturn.match(/export\s+default\s+function\s+\w*\s*\([^)]*\)\s*\{/);
        
        if (functionMatch) {
          const functionStart = functionMatch.index! + functionMatch[0].length;
          const functionBody = beforeReturn.substring(functionStart);
          
          // Contar llaves, paréntesis y corchetes en el cuerpo de la función (ignorando strings y comentarios)
          let braceCount = 0;
          let parenCount = 0;
          let bracketCount = 0;
          let inString = false;
          let stringChar = '';
          let inComment = false;
          let commentType = '';
          
          for (let i = 0; i < functionBody.length; i++) {
            const char = functionBody[i];
            const nextChar = i < functionBody.length - 1 ? functionBody[i + 1] : '';
            const prevChar = i > 0 ? functionBody[i - 1] : '';
            
            // Detectar comentarios
            if (!inString && !inComment) {
              if (char === '/' && nextChar === '/') {
                inComment = true;
                commentType = '//';
                i++;
                continue;
              } else if (char === '/' && nextChar === '*') {
                inComment = true;
                commentType = '/*';
                i++;
                continue;
              }
            }
            
            if (inComment) {
              if (commentType === '//' && char === '\n') {
                inComment = false;
                commentType = '';
              } else if (commentType === '/*' && char === '*' && nextChar === '/') {
                inComment = false;
                commentType = '';
                i++;
              }
              continue;
            }
            
            // Detectar strings
            if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
              if (!inString) {
                inString = true;
                stringChar = char;
              } else if (char === stringChar) {
                inString = false;
                stringChar = '';
              }
            }
            
            // Contar llaves, paréntesis y corchetes solo fuera de strings y comentarios
            if (!inString && !inComment) {
              if (char === '{') braceCount++;
              if (char === '}') braceCount--;
              if (char === '(') parenCount++;
              if (char === ')') parenCount--;
              if (char === '[') bracketCount++;
              if (char === ']') bracketCount--;
            }
          }
          
          // Si hay estructuras sin cerrar, agregarlas antes del return
          const fixes: string[] = [];
          if (braceCount > 0) {
            fixes.push(`${'}'.repeat(braceCount)}`);
            console.log(`🔧 Detectadas ${braceCount} llave(s) sin cerrar antes del return`);
          }
          if (parenCount > 0) {
            fixes.push(`${')'.repeat(parenCount)}`);
            console.log(`🔧 Detectados ${parenCount} paréntesis sin cerrar antes del return`);
          }
          if (bracketCount > 0) {
            fixes.push(`${']'.repeat(bracketCount)}`);
            console.log(`🔧 Detectados ${bracketCount} corchetes sin cerrar antes del return`);
          }
          
          if (fixes.length > 0) {
            const closingChars = fixes.join('') + '\n\n  ';
            preCorrectedContent = preCorrectedContent.substring(0, returnIndex) + closingChars + preCorrectedContent.substring(returnIndex);
            console.log('✅ Estructuras sin cerrar agregadas correctamente antes del return');
          }
        }
        
        // Validación adicional: Detectar arrays o constantes mal formadas antes del return
        // Buscar patrones como "const array = [" o "const array = {" que no estén cerrados
        const constArrayPattern = /const\s+\w+\s*=\s*\[[^\]]*$/m;
        const constObjectPattern = /const\s+\w+\s*=\s*\{[^}]*$/m;
        
        if (constArrayPattern.test(beforeReturn) || constObjectPattern.test(beforeReturn)) {
          // Buscar la última línea antes del return que parece ser una constante sin cerrar
          const lines = beforeReturn.split('\n');
          let lastConstLine = -1;
          for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i].trim();
            if ((line.includes('const ') && line.includes(' = [') && !line.includes('];')) ||
                (line.includes('const ') && line.includes(' = {') && !line.includes('};'))) {
              lastConstLine = i;
              break;
            }
          }
          
          if (lastConstLine !== -1) {
            // Buscar si hay un cierre en las líneas siguientes
            let foundClose = false;
            for (let i = lastConstLine + 1; i < lines.length; i++) {
              if (lines[i].includes('];') || lines[i].includes('};')) {
                foundClose = true;
                break;
              }
            }
            
            // Si no se encontró cierre antes del return, agregarlo
            if (!foundClose) {
              const lastLineIndex = beforeReturn.lastIndexOf('\n', returnIndex);
              const closing = beforeReturn.includes(' = [') ? '];' : '};';
              preCorrectedContent = preCorrectedContent.substring(0, lastLineIndex + 1) + closing + '\n\n' + preCorrectedContent.substring(lastLineIndex + 1);
              console.log(`✅ Agregado cierre de constante antes del return: ${closing}`);
            }
          }
        }
      }
    }
    
    // 2. Corregir automáticamente clases CSS con espacios múltiples (ej: opacity  50 -> opacity-50)
    preCorrectedContent = preCorrectedContent.replace(/className=["']([^"']*)["']/g, (match, classString) => {
    let fixedClass = classString;
      // Eliminar espacios múltiples en clases (ej: opacity  50 -> opacity-50, w  2 -> w-2)
      fixedClass = fixedClass.replace(/(\w+)\s{2,}(\d+)/g, '$1-$2');
      fixedClass = fixedClass.replace(/(\w+-\w+)\s{2,}(\d+)/g, '$1-$2');
      // Eliminar espacios alrededor de guiones
    fixedClass = fixedClass.replace(/(\w+)\s+-\s+(\w+)/g, '$1-$2');
    fixedClass = fixedClass.replace(/(\w+-\w+)\s+-\s+(\w+)/g, '$1-$2');
    fixedClass = fixedClass.replace(/(\w+)\s+-\s+(\d+)/g, '$1-$2');
      // Eliminar espacios en pseudo-clases y breakpoints
    fixedClass = fixedClass.replace(/:\s+/g, ':');
    fixedClass = fixedClass.replace(/\b(md|lg|sm|xl|2xl)\s+:/g, '$1:');
    return `className="${fixedClass}"`;
  });
  
    // 3. Corregir operadores + a - en clases CSS (ej: mb+6 -> mb-6, md+grid-cols -> md:grid-cols)
    preCorrectedContent = preCorrectedContent.replace(/(\w+)\+(\d+)/g, '$1-$2'); // mb+6 -> mb-6
    preCorrectedContent = preCorrectedContent.replace(/(\w+-\w+)\+(\d+)/g, '$1-$2'); // text-gray+300 -> text-gray-300
    preCorrectedContent = preCorrectedContent.replace(/\b(md|lg|sm|xl|2xl)\+(\w+)/g, '$1:$2'); // md+grid-cols -> md:grid-cols
    preCorrectedContent = preCorrectedContent.replace(/(\w+-\w+)\+(\$\{[^}]+\}|\w+)/g, '$1-$2'); // deployment-type+${value} -> deployment-type-${value}
    
    // 4. Corregir atributos mal formateados (sin espacio entre tag y atributo, ej: divclassName= -> <div className=)
    preCorrectedContent = preCorrectedContent.replace(/<([a-z]+)([a-z]+)=/g, (match, tag, attr) => {
      const commonAttrs = ['className', 'id', 'htmlFor', 'for', 'as', 'onClick', 'onChange', 'onSubmit', 'type', 'name', 'value', 'placeholder', 'disabled', 'required'];
      if (commonAttrs.some(a => attr.startsWith(a) || a.startsWith(attr))) {
        return `<${tag} ${attr}=`;
      }
      return match;
    });
    
    // 5. Corregir espacios incorrectos en atributos (ej: className= "text-lg" -> className="text-lg")
    preCorrectedContent = preCorrectedContent.replace(/(\w+)\s*=\s*(["'])/g, '$1=$2');
    
    // 6. Corregir textarea con children (debe usar value o defaultValue)
    // Buscar patrones como <textarea>contenido</textarea> y convertirlos a <textarea value="contenido" />
    preCorrectedContent = preCorrectedContent.replace(/<textarea([^>]*)>([\s\S]*?)<\/textarea>/g, (match, attrs, content) => {
      // Si ya tiene value o defaultValue, no modificar
      if (attrs.includes('value=') || attrs.includes('defaultValue=') || attrs.includes('value={') || attrs.includes('defaultValue={')) {
        return match;
      }
      
      // Si tiene contenido entre las etiquetas, convertirlo a value
      const trimmedContent = content.trim();
      if (trimmedContent) {
        // Escapar comillas dobles en el contenido
        const escapedContent = trimmedContent.replace(/"/g, '&quot;');
        // Si el contenido tiene saltos de línea o es multilínea, usar defaultValue con template literal
        if (trimmedContent.includes('\n')) {
          // Para contenido multilínea, usar defaultValue con template literal
          return `<textarea${attrs} defaultValue={\\\`${trimmedContent.replace(/\`/g, '\\\\\\`').replace(/\$\{/g, '\\\\\\$\\{')}\\\`} />`;
        } else {
          // Para contenido simple, usar value como string
          return `<textarea${attrs} value="${escapedContent}" />`;
        }
      }
      
      // Si no tiene contenido, dejar como está
      return match;
    });
    
    // 7. Detectar y corregir fragmentos JSX sin cerrar y código incompleto (errores "Expression expected" y "Unexpected eof")
    const trimmedContent = preCorrectedContent.trim();
    
    // Detectar fragmentos JSX sin cerrar
    const fragmentOpenCount = (preCorrectedContent.match(/<>/g) || []).length;
    const fragmentCloseCount = (preCorrectedContent.match(/<\/>/g) || []).length;
    const hasUnclosedFragment = fragmentOpenCount > fragmentCloseCount;
    
    // Detectar si el código termina abruptamente (error "Unexpected eof")
    // Buscar el patrón: código que termina con un tag de cierre JSX pero sin cerrar return ni función
    const endsWithJSXTag = /<\/[a-zA-Z]+(\.\w+)?>[\s\n]*$/.test(trimmedContent);
    const hasReturnClose = trimmedContent.includes(');');
    const hasFunctionClose = trimmedContent.endsWith('}');
    
    if (hasUnclosedFragment || (endsWithJSXTag && (!hasReturnClose || !hasFunctionClose))) {
      console.log('🔧 Detectado código incompleto o fragmento sin cerrar');
      
      // Buscar el return statement
      const returnMatch = preCorrectedContent.match(/return\s*\(/);
      if (returnMatch) {
        const returnStart = returnMatch.index! + returnMatch[0].length;
        const afterReturn = preCorrectedContent.substring(returnStart);
        
        // Buscar si hay un fragmento abierto después del return
        const fragmentAfterReturn = afterReturn.indexOf('<>');
        
        if (fragmentAfterReturn !== -1) {
          // Hay un fragmento abierto, buscar si está cerrado
          const afterFragment = afterReturn.substring(fragmentAfterReturn + 2);
          const hasFragmentClose = afterFragment.includes('</>');
          
          if (!hasFragmentClose) {
            // El fragmento no está cerrado, buscar dónde debería cerrarse
            // Buscar el último `</div>`, `</motion.div>`, etc. antes del final
            const lastTagMatch = trimmedContent.match(/(<\/[a-zA-Z]+(\.\w+)?>[\s\n]*)$/);
            
            if (lastTagMatch) {
              const insertPos = trimmedContent.lastIndexOf(lastTagMatch[1]);
              const beforeClose = trimmedContent.substring(0, insertPos).trim();
              const afterClose = trimmedContent.substring(insertPos + lastTagMatch[1].length);
              
              // Construir el cierre completo
              let toAdd = '\n      </>'; // Cerrar fragmento
              
              if (!hasReturnClose) {
                toAdd += '\n    );'; // Cerrar return
              }
              
              if (!hasFunctionClose) {
                toAdd += '\n  }'; // Cerrar función
              }
              
              preCorrectedContent = beforeClose + lastTagMatch[1] + toAdd + (afterClose ? '\n' + afterClose : '');
              console.log('✅ Agregado cierre de fragmento JSX y estructura (código incompleto)');
            }
          }
        }
      } else if (endsWithJSXTag) {
        // No hay return pero el código termina con tag JSX, agregar cierre completo
        let toAdd = '';
        if (hasUnclosedFragment) {
          toAdd += '\n      </>';
        }
        if (!hasReturnClose) {
          toAdd += '\n    );';
        }
        if (!hasFunctionClose) {
          toAdd += '\n  }';
        }
        if (toAdd) {
          preCorrectedContent = preCorrectedContent.trim() + toAdd;
          console.log('✅ Agregado cierre completo de estructura (Unexpected eof)');
        }
      }
    }
    
    // Usar el contenido pre-corregido para el prompt
    fileContent = preCorrectedContent;
    console.log('✅ Correcciones automáticas previas aplicadas');

    // Construir el prompt de corrección con pistas específicas
    const correctionPrompt = 'Analiza y corrige el siguiente código React/Next.js que fue generado automáticamente. El código tiene varios errores comunes que DEBES corregir:\n\n' +
      '**ERRORES CRÍTICOS A CORREGIR:**\n\n' +
      '1. **\'use client\' duplicado o con comillas incorrectas**: Si hay múltiples declaraciones de \'use client\' o "use client", deja solo UNA al inicio del archivo. IMPORTANTE: Usa SIEMPRE comillas simples: \'use client\'; (no comillas dobles).\n\n' +
      '2. **Constantes dentro del componente**: Todas las constantes de datos (testimonials, features, categories, galleryImages, etc.) DEBEN estar FUERA y ANTES de la definición del componente. Muévelas antes de la línea "export default function".\n\n' +
      '3. **Espacios en nombres de clases CSS**: Busca y corrige TODOS los casos donde hay espacios en lugar de guiones en las clases de Tailwind:\n' +
      '   - "w -20" → "w-20"\n' +
      '   - "h -20" → "h-20"\n' +
      '   - "mb -6" → "mb-6"\n' +
      '   - "text -gray -600" → "text-gray-600"\n' +
      '   - "grid -cols -1" → "grid-cols-1"\n' +
      '   - "opacity  50" → "opacity-50" (espacios múltiples)\n' +
      '   - "w  2" → "w-2"\n' +
      '   - "h  2" → "h-2"\n' +
      '   - "bg-blue  400" → "bg-blue-400"\n' +
      '   - Y TODOS los casos similares\n\n' +
      '4. **Operadores incorrectos en clases**: Busca y corrige TODOS los casos donde hay "+" en lugar de "-" o ":":\n' +
      '   - "to-green+900" → "to-green-900"\n' +
      '   - "px+6" → "px-6"\n' +
      '   - "text+3xl" → "text-3xl"\n' +
      '   - "mb+6" → "mb-6"\n' +
      '   - "md+grid-cols" → "md:grid-cols" (breakpoints con +)\n' +
      '   - "deployment-type+value" → "deployment-type-value"\n' +
      '   - Y TODOS los casos similares\n\n' +
      '5. **Llaves, paréntesis o corchetes sin cerrar antes del return**: Si hay estructuras sin cerrar antes del return statement, esto causa el error "Unexpected token div. Expected jsx identifier". Asegúrate de que:\n' +
      '   - Todas las llaves {} estén balanceadas\n' +
      '   - Todos los paréntesis () estén balanceados\n' +
      '   - Todos los corchetes [] estén balanceados\n' +
      '   - Todas las constantes (arrays u objetos) estén completamente cerradas con ]; o }; antes del return\n' +
      '   - Ejemplo: Si tienes const items = [ antes del return, asegúrate de que termine con ]; antes del return\n\n' +
      '6. **Código incompleto**: Si el código está cortado o incompleto:\n' +
      '   - Completa el footer correctamente\n' +
      '   - Asegúrate de cerrar todos los divs\n' +
      '   - Asegúrate de cerrar el componente con el cierre de la función\n' +
      '   - El footer debe tener secciones típicas: logo, enlaces, redes sociales, copyright\n\n' +
      '7. **Sintaxis JSX y fragmentos sin cerrar**: CRÍTICO - Detecta y corrige:\n' +
      '   - Fragmentos JSX sin cerrar: Si hay `<>` sin su correspondiente `</>`, debes cerrarlo antes del final del return\n' +
      '   - Código cortado al final: Si el archivo termina abruptamente con un `</div>` o `</motion.div>` sin cerrar el fragmento o la función, completa el código\n' +
      '   - Error "Expression expected" después de `<>`: Esto indica que falta contenido o cierre en el JSX\n' +
      '   - Error "Unexpected eof": Esto indica que el archivo está incompleto y faltan cierres de tags o la función\n' +
      '   - Ejemplo de corrección: Si el código termina con `</motion.div>` pero falta cerrar `</>` y `}`, agrega:\n' +
      '     ```\n' +
      '     </motion.div>\n' +
      '     </>\n' +
      '   );\n' +
      ' }\n' +
      '     ```\n\n' +
      '8. **Textarea con children**: Los elementos `<textarea>` NO deben usar children (contenido entre etiquetas). Deben usar la prop `value` o `defaultValue`:\n' +
      '   - INCORRECTO: `<textarea>contenido aquí</textarea>`\n' +
      '   - CORRECTO: `<textarea value="contenido aquí" />` o `<textarea defaultValue="contenido aquí" />`\n' +
      '   - Si el contenido es dinámico, usa: `<textarea value={variable} onChange={handleChange} />`\n' +
      '   - Busca TODOS los `<textarea>` en el código y corrígelos.\n\n' +
      '9. **Importaciones de iconos inválidas**: Si hay errores como "Module has no exported member \'X\'", verifica que todos los iconos importados de `lucide-react` existan. Los iconos comunes que NO existen en lucide-react incluyen: Motorcycle, Car, Bike. Reemplázalos con iconos válidos como: Bike (si existe), Car (si existe), o iconos similares como Zap, Sparkles, etc.\n\n' +
      '**FORMATO DE RESPUESTA REQUERIDO:**\n' +
      'Responde ÚNICAMENTE con un objeto JSON en este formato exacto (sin texto adicional antes o después):\n\n' +
      '```json\n' +
      '{\n' +
      '  "type": "code_change",\n' +
      '  "explanation": "Correcciones aplicadas: [lista breve de correcciones]",\n' +
      '  "fullContent": "OBLIGATORIO: el archivo COMPLETO ya corregido. Incluye todo el código desde la primera línea hasta la última.",\n' +
      '  "changes": [{\n' +
      '    "file": "' + fileName + '",\n' +
      '    "replacements": [{\n' +
      '      "old": "fragmento EXACTO del código original",\n' +
      '      "new": "fragmento corregido"\n' +
      '    }]\n' +
      '  }]\n' +
      '}\n' +
      '```\n\n' +
      '**CRÍTICO:** DEBES incluir "fullContent" con el archivo COMPLETO corregido. Sin fullContent, las correcciones pueden no aplicarse correctamente.\n\n' +
      '**IMPORTANTE - ESTRATEGIA DE CORRECCIÓN:** \n' +
      '- Para el \'use client\' duplicado o con comillas incorrectas: Busca TODO el bloque desde la primera línea hasta el primer import. Si hay múltiples declaraciones o comillas dobles, reemplázalas dejando solo UNA con comillas simples al inicio. Ejemplos:\n' +
      '  * Si encuentras: "use client";\\n\\n"use client";\\n\\nimport...\n' +
      '  * Reemplaza por: \'use client\';\\n\\nimport...\n' +
      '  * Si encuentras: "use client";\\n\\nimport...\n' +
      '  * Reemplaza por: \'use client\';\\n\\nimport...\n' +
      '- Para constantes dentro del componente: Busca cada constante completa (desde "const" hasta el "];" o "};") y muévela ANTES de "export default function"\n' +
      '- Para clases CSS con espacios: Busca bloques de JSX completos (por ejemplo, toda una sección <section>) y corrígelos\n' +
      '- Divide las correcciones en múltiples "replacements" pequeños y específicos\n' +
      '- Cada "old" debe ser un fragmento EXACTO que exista en el código (copia textualmente)\n' +
      '- Si no estás seguro del formato exacto, busca bloques más grandes que incluyan contexto\n' +
      '- NO agregues comentarios en el código corregido\n' +
      '- Mantén el estilo y estructura general del código\n\n' +
      '**CÓDIGO A CORREGIR:**\n\n' +
      '```tsx\n' +
      fileContent +
      '\n' +
      '```\n\n' +
      'Procede con las correcciones necesarias.';

    // Llamar al modelo para obtener las correcciones
    let apiUrl = modelConfig.url || modelConfig.baseURL || '';
    // Normalizar URL para que incluya /chat/completions
    if (apiUrl && !apiUrl.includes('/chat/completions')) {
      apiUrl = apiUrl.replace(/\/$/, '') + '/chat/completions';
    }
    if (!apiUrl) {
      apiUrl = 'http://localhost:1234/v1/chat/completions';
    }
    console.log('🔧 Post-corrección: Llamando al modelo en:', apiUrl);
    console.log('📊 Longitud del contenido a corregir:', fileContent.length, 'caracteres');

    // Detectar si el archivo es largo y necesita corrección por etapas
    const lineCount = fileContent.split('\n').length;
    const isLongFile = lineCount > 500;
    console.log(`📊 Archivo tiene ${lineCount} líneas. ¿Es largo? ${isLongFile}`);

    let assistantMessage: string;

    if (isLongFile) {
      // Modo etapas para archivos largos
      console.log('🔄 Archivo largo detectado. Usando corrección por etapas...');
      let accumulatedContent = '';
      const MAX_STAGES = 10;
      const stagePromptBase = correctionPrompt + '\n\n**MODO ETAPAS**: Este archivo es largo. Corrígelo completamente. Si no cabe todo en una respuesta, detente en un punto lógico (final de una función o bloque) y añade exactamente [ZEUS_EOF] al final. Si completas el archivo, también añade [ZEUS_EOF]. Responde SOLO con el código corregido (sin JSON), rodeado por ```tsx ... ```.';

      for (let stage = 1; stage <= MAX_STAGES; stage++) {
        const stagePrompt = stage === 1
          ? stagePromptBase
          : `Continúa corrigiendo el archivo desde donde te quedaste. Código corregido hasta ahora:\n\n\`\`\`tsx\n${accumulatedContent}\n\`\`\`\n\nCorrige el resto del archivo. Detente en un punto lógico si no cabe, y añade [ZEUS_EOF] al final. Responde SOLO con el código corregido (sin JSON), rodeado por \`\`\`tsx ... \`\`\`.`;

        let stageMessage: string;
        try {
          stageMessage = await callModelGeneric(
            {
              provider: modelConfig.provider,
              model: modelConfig.model,
              url: modelConfig.url,
              apiKey: modelConfig.apiKey,
            },
            [
              {
                role: 'system',
                content: 'Eres un experto en React, Next.js y Tailwind CSS. Tu tarea es corregir código generado automáticamente. Responde SOLO con código, sin explicaciones ni JSON.'
              },
              {
                role: 'user',
                content: stagePrompt
              }
            ],
            { temperature: 0.1, maxTokens: 32000 }
          );
        } catch (stageErr: any) {
          console.error('❌ Error del modelo en etapa', stage, ':', stageErr?.message || stageErr);
          break;
        }

        // Extraer bloque de código
        const tsxMatch = stageMessage.match(/```(?:tsx|ts|jsx|js)\s*\n([\s\S]*?)```/);
        const stageContent = tsxMatch && tsxMatch[1] ? tsxMatch[1].trim() : stageMessage.trim();

        const hasEof = stageContent.includes('[ZEUS_EOF]');
        const cleanedStage = stageContent.replace(/\[ZEUS_EOF\]\s*$/, '').trim();

        if (stage === 1) {
          accumulatedContent = cleanedStage;
        } else {
          accumulatedContent = (accumulatedContent + '\n' + cleanedStage).trim();
        }

        console.log(`✅ Etapa ${stage} completada. ${cleanedStage.length} chars. ¿EOF? ${hasEof}`);

        if (hasEof || cleanedStage.length < 100) break;
      }

      // Construir un mensaje artificial con el contenido acumulado para que el resto del flujo funcione
      assistantMessage = `\`\`\`json\n{\n  "type": "code_change",\n  "explanation": "Corrección por etapas aplicada",\n  "fullContent": ${JSON.stringify(accumulatedContent)},\n  "changes": []\n}\n\`\`\``;
      console.log('✅ Corrección por etapas completada. Total:', accumulatedContent.length, 'chars');
    } else {
      // Modo normal (archivo corto)
      try {
        assistantMessage = await callModelGeneric(
          {
            provider: modelConfig.provider,
            model: modelConfig.model,
            url: modelConfig.url,
            apiKey: modelConfig.apiKey,
          },
          [
            {
              role: 'system',
              content: 'Eres un experto en React, Next.js y Tailwind CSS. Tu tarea es corregir código generado automáticamente siguiendo las instrucciones exactas. Responde SOLO con el JSON de correcciones, sin texto adicional.'
            },
            {
              role: 'user',
              content: correctionPrompt
            }
          ],
          { temperature: 0.1, maxTokens: 32000 }
        );
      } catch (modelErr: any) {
        console.error('❌ Error del modelo:', modelErr?.message || modelErr);
        return NextResponse.json(
          {
            error: 'Error al llamar al modelo de corrección',
            details: modelErr?.message || String(modelErr),
            apiUrl: modelConfig.url
          },
          { status: 500 }
        );
      }

    }

    // Extraer el JSON de la respuesta (puede venir en un bloque ```json o directamente)
    let codeChangeJson: any = null;
    try {
      codeChangeJson = extractAndParseCodeChangeJson(assistantMessage);
    } catch (e: any) {
      console.error('❌ [POST-CORRECT] Error parseando JSON (posible truncado):', e?.message || e);
      codeChangeJson = null;
    }

    // Fallback: si el JSON está truncado, intentar extraer fullContent y explanation manualmente
    let fallbackFullContent: string | null = null;
    let fallbackExplanation: string | null = null;
    if ((!codeChangeJson || codeChangeJson.type !== 'code_change') && assistantMessage.includes('"fullContent":')) {
      fallbackFullContent = extractFullContentFromTruncatedJson(assistantMessage);
      fallbackExplanation = extractExplanationFromTruncatedJson(assistantMessage);
      if (fallbackFullContent) {
        console.log('✅ [POST-CORRECT] fullContent extraído de JSON truncado (' + fallbackFullContent.length + ' chars)');
        codeChangeJson = {
          type: 'code_change',
          fullContent: fallbackFullContent,
          explanation: fallbackExplanation || codeChangeJson?.explanation || 'Correcciones aplicadas (JSON truncado)',
          changes: []
        };
      }
    }

    if (!codeChangeJson || codeChangeJson.type !== 'code_change') {
      console.error('Respuesta del modelo no válida:', assistantMessage.substring(0, 300) + '...');
      return NextResponse.json(
        { 
          error: 'El modelo no devolvió un formato de corrección válido',
          modelResponse: assistantMessage.substring(0, 500)
        },
        { status: 500 }
      );
    }

    // Aplicar las correcciones
    try {
      const normalize = (s: string) => (s || '').replace(/\r\n/g, '\n');
      let finalContent: string;

      // 1) Si el modelo devolvió fullContent, usarlo directamente (más fiable)
      const fullContentRaw = codeChangeJson.fullContent || fallbackFullContent;
      if (fullContentRaw && typeof fullContentRaw === 'string' && fullContentRaw.trim().length > 50) {
        finalContent = normalize(fullContentRaw);
        console.log('✅ [POST-CORRECT] Usando fullContent del modelo (' + finalContent.length + ' chars)');
      } else {
        // 2) Aplicar replacements
        const applyReplacements = (content: string, changes: any[]): string => {
          let correctedContent = normalize(content);
          const fileChanges = Array.isArray(changes)
            ? changes.filter((c: any) => c && (c.file === fileName || c.file?.replace(/\\/g, '/') === fileName?.replace(/\\/g, '/')) && Array.isArray(c.replacements))
            : [];
          let appliedCount = 0;
          for (const change of fileChanges) {
            const replacementsWithIndices = (change.replacements || [])
              .map((rep: any) => {
                const oldText = typeof rep?.old === 'string'
                  ? normalize(rep.old)
                  : (typeof rep?.old_b64 === 'string' ? normalize(base64ToUtf8(rep.old_b64)) : '');
                const newText = typeof rep?.new === 'string'
                  ? normalize(rep.new)
                  : (typeof rep?.new_b64 === 'string' ? normalize(base64ToUtf8(rep.new_b64)) : '');
                const index = oldText ? correctedContent.indexOf(oldText) : -1;
                return { oldText, newText, index };
              })
              .filter((r: any) => r.index !== -1 && r.oldText);

            replacementsWithIndices.sort((a: any, b: any) => b.index - a.index);
            for (const rep of replacementsWithIndices) {
              correctedContent =
                correctedContent.substring(0, rep.index) +
                rep.newText +
                correctedContent.substring(rep.index + rep.oldText.length);
              appliedCount++;
            }
          }
          if (appliedCount === 0 && fileChanges.length > 0) {
            console.warn('⚠️ [POST-CORRECT] Ningún replacement coincidió (old no encontrado en el contenido). El modelo debe copiar EXACTAMENTE el texto.');
          } else if (appliedCount > 0) {
            console.log('✅ [POST-CORRECT] Aplicados', appliedCount, 'replacements');
          }
          return correctedContent;
        };

        finalContent = applyReplacements(fileContent, codeChangeJson.changes || []);

        // 3) Fallback: si no hubo cambios y la respuesta tiene un bloque ```tsx, usarlo
        if (finalContent === fileContent && assistantMessage) {
          const tsxMatch = assistantMessage.match(/```(?:tsx|ts|jsx|js)\s*\n([\s\S]*?)```/);
          if (tsxMatch && tsxMatch[1]) {
            const extracted = normalize(tsxMatch[1].trim());
            if (extracted.length > 100 && (extracted.includes('export') || extracted.includes('return'))) {
              finalContent = extracted;
              console.log('✅ [POST-CORRECT] Fallback: usando código del bloque ```tsx en la respuesta (' + extracted.length + ' chars)');
            }
          }
          if (finalContent === fileContent) {
            console.warn('⚠️ [POST-CORRECT] No se aplicó ninguna corrección. La respuesta del modelo podría no tener fullContent ni replacements válidos.');
          }
        }
      }

      // ✅ Requisito: eliminar metadata/generateMetadata porque puede causar errores
      // (especialmente si el archivo termina siendo client component o el entorno no soporta metadata)
      const hadMetadata = hasMetadataExports(finalContent);
      finalContent = stripMetadataExports(finalContent);
      if (hadMetadata && !hasMetadataExports(finalContent)) {
        console.log('✅ [POST-CORRECT] metadata/generateMetadata eliminada');
      }

      // Si ya no hay metadata, eliminar import type { Metadata } si quedó huérfano
      if (!hasMetadataExports(finalContent) && !/\bMetadata\b/.test(finalContent)) {
        finalContent = finalContent.replace(/^\s*import\s+type\s+\{\s*Metadata\s*\}\s+from\s+['"]next['"];\s*\n/m, '');
      }

      // Si quitamos metadata, podemos permitir 'use client'; no hacemos strip aquí.

      // Usar el archivo que el usuario seleccionó (respetar su elección)
      const effectiveFileName = (fileName || 'app/page.tsx').replace(/\\/g, '/').replace(/^\/+/, '');

      // Si hay projectPath o projectId, guardar también en disco
      // Resolver el projectRoot correcto usando getProjectRoot si tenemos projectId
      let correctProjectRoot: string | null = null;
      if (projectId) {
        try {
          correctProjectRoot = await getProjectRoot(projectId, projectPath);
          console.log('✅ [POST-CORRECT] Project root resuelto:', correctProjectRoot);
        } catch (rootError: any) {
          console.warn('⚠️ [POST-CORRECT] Error resolviendo project root (continuando sin guardar en disco):', rootError.message);
          // Continuar sin guardar en disco si no podemos resolver el root
        }
      } else if (projectPath) {
        // Si no hay projectId pero hay projectPath, verificar que existe
        try {
          await fs.access(projectPath);
          correctProjectRoot = projectPath;
        } catch (accessError) {
          console.warn('⚠️ [POST-CORRECT] Project path no existe (continuando sin guardar en disco):', projectPath);
        }
      }

      // ✅ CRÍTICO: Actualizar el ZIP en PocketBase SIEMPRE que tengamos projectId y contenido
      // Esto debe ejecutarse aunque correctProjectRoot falle (p.ej. path local en servidor remoto).
      // update-zip-from-memory actualiza el ZIP directamente sin depender del disco.
      let zipUpdated = false;
      if (projectId && effectiveFileName && finalContent) {
        const origin = new URL(request.url).origin;
        const normalizedFileName = effectiveFileName.replace(/\\/g, '/').replace(/^\/+/, '');
        try {
          console.log('📦 [POST-CORRECT] Actualizando ZIP en PocketBase (archivo:', normalizedFileName, ')...');
          const updateZipRes = await fetch(`${origin}/api/update-zip-from-memory`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId,
              fileUpdates: [{ filePath: normalizedFileName, content: finalContent }],
              userToken,
              updateBackup: false
            })
          });
          if (updateZipRes.ok) {
            zipUpdated = true;
            console.log('✅ [POST-CORRECT] ZIP actualizado en PocketBase:', normalizedFileName);
          } else {
            const errText = await updateZipRes.text();
            console.warn('⚠️ [POST-CORRECT] update-zip-from-memory falló:', errText);
          }
        } catch (updateErr: any) {
          console.warn('⚠️ [POST-CORRECT] Error en update-zip-from-memory:', updateErr?.message);
        }
      }

      if (correctProjectRoot) {
      try {
        const filePath = path.join(correctProjectRoot, effectiveFileName);
        const dirPath = path.dirname(filePath);
        await fs.mkdir(dirPath, { recursive: true });
        await fs.writeFile(filePath, finalContent, 'utf-8');
        console.log('✅ [POST-CORRECT] Archivo corregido guardado en disco:', filePath);
        if (!zipUpdated && projectId) {
          try {
            await new Promise(resolve => setTimeout(resolve, 300));
            const origin = new URL(request.url).origin;
            const saveArchiveRes = await fetch(`${origin}/api/project/save-archive`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                projectRoot: correctProjectRoot,
                projectId,
                userToken,
                isInitialSave: false
              })
            });
            if (saveArchiveRes.ok) {
              const saveResult = await saveArchiveRes.json().catch(() => ({}));
              zipUpdated = saveResult?.pbArchiveSaved;
            }
          } catch {}
        }
        return NextResponse.json({
          success: true,
          message: 'Correcciones aplicadas y guardadas' + (zipUpdated ? ' en PocketBase' : ''),
          explanation: codeChangeJson.explanation,
          appliedChanges: true,
          correctedContent: finalContent,
          zipUpdated,
          effectiveFileName
        });
      } catch (writeError: any) {
        console.error('Error escribiendo archivo corregido:', writeError);
      }
      }

      return NextResponse.json({
        success: true,
        message: 'Correcciones generadas y aplicadas' + (zipUpdated ? ' (ZIP actualizado en PocketBase)' : ''),
        explanation: codeChangeJson.explanation,
        corrections: codeChangeJson,
        correctedContent: finalContent,
        zipUpdated,
        effectiveFileName
      });
    } catch (applyError: any) {
      console.error('Error aplicando correcciones:', applyError);
      return NextResponse.json(
        { 
          error: 'Error al aplicar las correcciones',
          details: applyError.message,
          corrections: codeChangeJson
        },
        { status: 500 }
      );
    }

  } catch (error: any) {
    console.error('Error en post-correct-generated-page:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor', details: error.message },
      { status: 500 }
    );
  }
}
