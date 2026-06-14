import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { UsageService, getModelsForUser, getProjectRoot } from '@/api/utils';
import { callModelGeneric } from '@/api/zeus-model-api/generic-model-call';

/* ================================================================
   VALIDACIÓN Y CORRECCIÓN AUTOMÁTICA DE COMPONENTES (REFORZADA)
   ================================================================ */

const COMPONENT_EXTS = ['.tsx', '.ts', '.jsx', '.js'];
const SKIP_DIRS = ['node_modules', '.next', 'dist', 'build', '.git', '.vscode', '.idea', 'coverage', 'out', 'scripts'];

const HOOKS_RE = /\buseState\b|\buseEffect\b|\buseContext\b|\buseReducer\b|\buseCallback\b|\buseMemo\b|\buseRef\b|\buseLayoutEffect\b|\buseImperativeHandle\b|\buseId\b/;
const BROWSER_APIS_RE = /\bwindow\b|\bdocument\b|\blocalStorage\b|\bsessionStorage\b|\bnavigator\b|\blocation\b/;
const NEXT_ROUTER_OLD_RE = /from\s+['"]next\/router['"]/;
const USE_CLIENT_RE = /^\s*['"]use\s+client['"];?/m;
const USE_SERVER_RE = /^\s*['"]use\s+server['"];?/m;
const EXPORT_DEFAULT_RE = /export\s+default/;
const METADATA_RE = /export\s+(?:const|let|var)\s+metadata\s*[:=]/;

interface Issue {
  type: 'error' | 'warning' | 'info';
  severity: 'critical' | 'high' | 'medium' | 'low';
  message: string;
  suggestion?: string;
}

interface ComponentValidation {
  filePath: string;
  relativePath: string;
  isValid: boolean;
  issues: Issue[];
  propsAnalysis?: {
    propsDefined: string[];
    propsUsed: string[];
    missingProps?: string[];
    unusedProps?: string[];
    typeErrors?: string[];
  };
  functionalityIssues?: string[];
  correctedCode?: string;
  autoCorrected?: boolean;
}

interface ValidationResult {
  totalComponents: number;
  validatedComponents: number;
  validComponents: number;
  invalidComponents: number;
  components: ComponentValidation[];
  summary: string;
}

/* ================================================================
   UTILIDADES DE FS
   ================================================================ */

async function fileExists(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/* ================================================================
   WALKER DE ARCHIVOS
   ================================================================ */

async function walkDirectory(dir: string, projectRoot: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.includes(entry.name.toLowerCase())) continue;
        results.push(...await walkDirectory(fullPath, projectRoot));
      } else if (entry.isFile() && COMPONENT_EXTS.includes(path.extname(entry.name).toLowerCase())) {
        results.push(fullPath);
      }
    }
  } catch (error) {
    console.warn(`[validate-components] Error reading directory ${dir}:`, error);
  }
  return results;
}

/* ================================================================
   PRIORIZACIÓN DE ARCHIVOS
   ================================================================ */

function scoreFilePriority(filePath: string, projectRoot: string): number {
  const rel = path.relative(projectRoot, filePath).toLowerCase().replace(/\\/g, '/');
  let score = 0;
  if (rel.includes('layout')) score += 100;
  if (rel.includes('page') || rel.includes('route')) score += 90;
  if (rel.includes('loading')) score += 80;
  if (rel.includes('error')) score += 70;
  if (rel.includes('not-found')) score += 70;
  if (rel.includes('template')) score += 60;
  if (rel.includes('component')) score += 50;
  if (rel.endsWith('.tsx')) score += 10;
  if (rel.includes('test') || rel.includes('spec')) score -= 100;
  if (rel.includes('stories')) score -= 100;
  return score;
}

function prioritizeFiles(files: string[], projectRoot: string): string[] {
  return files
    .map(f => ({ path: f, score: scoreFilePriority(f, projectRoot) }))
    .sort((a, b) => b.score - a.score)
    .map(x => x.path);
}

/* ================================================================
   VALIDACIÓN DE IMPORTS EXISTENTES
   ================================================================ */

function extractImports(content: string): Array<{ source: string; isRelative: boolean; isAlias: boolean }> {
  const imports: Array<{ source: string; isRelative: boolean; isAlias: boolean }> = [];
  const regex = /import\s+(?:type\s+)?(?:{[^}]*}|\*?\s*\w+)?\s*(?:from\s+)?['"]([^'"]+)['"];?/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(content)) !== null) {
    const source = m[1];
    const isRelative = source.startsWith('.') || source.startsWith('/');
    const isAlias = source.startsWith('@/');
    imports.push({ source, isRelative, isAlias });
  }
  return imports;
}

async function resolveImportPath(source: string, fromFile: string, projectRoot: string): Promise<string | null> {
  if (!source.startsWith('.') && !source.startsWith('/')) {
    // package import — no lo validamos aquí para no penalizar dependencias externas
    return 'node_modules';
  }

  let base = source.startsWith('/') ? projectRoot : path.dirname(fromFile);
  let target = path.join(base, source);

  // Intentar directo
  if (await fileExists(target)) return target;
  if (await dirExists(target) && await fileExists(path.join(target, 'index.tsx'))) return path.join(target, 'index.tsx');
  if (await dirExists(target) && await fileExists(path.join(target, 'index.ts'))) return path.join(target, 'index.ts');
  if (await dirExists(target) && await fileExists(path.join(target, 'index.jsx'))) return path.join(target, 'index.jsx');
  if (await dirExists(target) && await fileExists(path.join(target, 'index.js'))) return path.join(target, 'index.js');

  // Probar extensiones
  for (const ext of COMPONENT_EXTS) {
    const withExt = target + ext;
    if (await fileExists(withExt)) return withExt;
  }

  // Alias @/
  if (source.startsWith('@/')) {
    const noPrefix = source.slice(2);
    const aliasTarget = path.join(projectRoot, noPrefix);
    if (await fileExists(aliasTarget)) return aliasTarget;
    for (const ext of COMPONENT_EXTS) {
      if (await fileExists(aliasTarget + ext)) return aliasTarget + ext;
    }
    const aliasDir = path.join(projectRoot, noPrefix);
    if (await dirExists(aliasDir)) {
      for (const idx of ['index.tsx', 'index.ts', 'index.jsx', 'index.js']) {
        if (await fileExists(path.join(aliasDir, idx))) return path.join(aliasDir, idx);
      }
    }
  }

  return null;
}

async function validateImports(filePath: string, content: string, projectRoot: string): Promise<Issue[]> {
  const issues: Issue[] = [];
  const imports = extractImports(content);
  for (const imp of imports) {
    if (!imp.isRelative && !imp.isAlias) continue;
    const resolved = await resolveImportPath(imp.source, filePath, projectRoot);
    if (resolved === null) {
      issues.push({
        type: 'error',
        severity: 'high',
        message: `Import no resuelto: "${imp.source}"`,
        suggestion: `Crear el archivo o revisar la ruta de importación`
      });
    }
  }
  return issues;
}

/* ================================================================
   DETECCIÓN DE PROBLEMAS COMUNES (Next.js / React)
   ================================================================ */

function detectCommonIssues(content: string, filePath: string, projectRoot: string): Issue[] {
  const issues: Issue[] = [];
  const rel = path.relative(projectRoot, filePath).toLowerCase().replace(/\\/g, '/');
  const isAppDir = rel.startsWith('app/') || rel.includes('/app/');
  const hasUseClient = USE_CLIENT_RE.test(content);
  const hasUseServer = USE_SERVER_RE.test(content);

  // Hooks sin 'use client'
  if (HOOKS_RE.test(content) && !hasUseClient && !hasUseServer) {
    const hooksFound = [
      'useState', 'useEffect', 'useContext', 'useReducer',
      'useCallback', 'useMemo', 'useRef', 'useLayoutEffect',
      'useImperativeHandle', 'useId'
    ].filter(h => new RegExp(`\\b${h}\\b`).test(content));
    if (hooksFound.length > 0) {
      issues.push({
        type: 'error',
        severity: 'critical',
        message: `Uso de hooks de React (${hooksFound.join(', ')}) sin directiva 'use client'`,
        suggestion: `Añade "'use client';" en la primera línea del archivo si es un Client Component`
      });
    }
  }

  // Browser APIs sin 'use client'
  if (BROWSER_APIS_RE.test(content) && !hasUseClient && !hasUseServer) {
    issues.push({
      type: 'error',
      severity: 'critical',
      message: `Uso de APIs del navegador (window, document, localStorage, etc.) sin directiva 'use client'`,
      suggestion: `Añade "'use client';" en la primera línea del archivo`
    });
  }

  // next/router en App Router
  if (isAppDir && NEXT_ROUTER_OLD_RE.test(content)) {
    issues.push({
      type: 'error',
      severity: 'high',
      message: `Uso de 'next/router' en App Router. Debe ser 'next/navigation'`,
      suggestion: `Reemplaza "import { useRouter } from 'next/router'" por "import { useRouter } from 'next/navigation'"`
    });
  }

  // Metadata en client component
  if (hasUseClient && METADATA_RE.test(content)) {
    issues.push({
      type: 'error',
      severity: 'high',
      message: `Export de "metadata" en un Client Component no está permitido en Next.js`,
      suggestion: `Mueve metadata a un Server Component (layout.tsx o page.tsx sin 'use client')`
    });
  }

  // Falta export default en page/layout
  if ((rel.includes('page') || rel.includes('layout')) && !EXPORT_DEFAULT_RE.test(content)) {
    issues.push({
      type: 'error',
      severity: 'high',
      message: `Falta "export default" en archivo de página o layout`,
      suggestion: `Asegúrate de exportar el componente por defecto: export default function ...`
    });
  }

  // Manejo de eventos sin 'use client' (onClick, onSubmit, etc.)
  if (/\bon[A-Z]\w+\s*=/.test(content) && !hasUseClient && !hasUseServer) {
    issues.push({
      type: 'warning',
      severity: 'medium',
      message: `Manejadores de eventos JSX (onClick, onSubmit, etc.) requieren 'use client'`,
      suggestion: `Añade "'use client';" si el archivo maneja interacciones del usuario`
    });
  }

  return issues;
}

/* ================================================================
   DETECCIÓN DE PROBLEMAS DE SINTAXIS BÁSICOS
   ================================================================ */

function detectSyntaxIssues(content: string): Issue[] {
  const issues: Issue[] = [];

  // JSX sin retorno (patrón común de IA: escribe JSX sin return)
  // Solo aplicar si parece componente
  const hasJSX = /<[A-Z]\w+|<\w+\s+className/.test(content);
  if (hasJSX) {
    const hasReturnBeforeJSX = /return\s*\(?\s*</.test(content);
    const isArrowImplicit = /=>\s*</.test(content);
    if (!hasReturnBeforeJSX && !isArrowImplicit) {
      issues.push({
        type: 'warning',
        severity: 'medium',
        message: `Posible JSX sin retorno explícito`,
        suggestion: `Asegúrate de que el JSX está dentro de un return o de una arrow function implícita`
      });
    }
  }

  // Llaves/corchetes/paréntesis desbalanceados (básico)
  const openBraces = (content.match(/{/g) || []).length;
  const closeBraces = (content.match(/}/g) || []).length;
  if (openBraces !== closeBraces) {
    issues.push({
      type: 'error',
      severity: 'high',
      message: `Llaves desbalanceadas ({ vs })`,
      suggestion: `Revisa la sintaxis de bloques y objetos`
    });
  }

  const openParens = (content.match(/\(/g) || []).length;
  const closeParens = (content.match(/\)/g) || []).length;
  if (openParens !== closeParens) {
    issues.push({
      type: 'error',
      severity: 'high',
      message: `Paréntesis desbalanceados`,
      suggestion: `Revisa las llamadas a funciones y expresiones`
    });
  }

  // Import no usado (básico)
  const imports = extractImports(content);
  for (const imp of imports) {
    // Simplificación: obtener el nombre importado por defecto o nombrado
    const lineMatch = content.match(new RegExp(`import\\s+.*?from\\s+['"]${imp.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"];?`));
    if (lineMatch) {
      const line = lineMatch[0];
      const namedMatch = line.match(/\{([^}]+)\}/);
      const defaultMatch = line.match(/import\s+(\w+)/);
      const names: string[] = [];
      if (namedMatch) names.push(...namedMatch[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()));
      if (defaultMatch) names.push(defaultMatch[1]);
      for (const name of names) {
        if (name && !['React', 'use', 'metadata', 'config'].includes(name)) {
          const usageRe = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
          const occurrences = content.split(usageRe).length - 1;
          if (occurrences <= 1) { // solo en la línea de import
            issues.push({
              type: 'warning',
              severity: 'low',
              message: `Import posiblemente no usado: "${name}" desde "${imp.source}"`,
              suggestion: `Elimina el import si no se utiliza`
            });
          }
        }
      }
    }
  }

  return issues;
}

/* ================================================================
   FETCH CON RETRY
   ================================================================ */

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = 2,
  backoffMs = 1500
): Promise<Response> {
  let lastErr: any;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, init);
      if (!res.ok && res.status >= 500 && i < retries) {
        await new Promise(r => setTimeout(r, backoffMs * (i + 1)));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (i < retries) {
        await new Promise(r => setTimeout(r, backoffMs * (i + 1)));
      }
    }
  }
  throw lastErr;
}

/* ================================================================
   AI VALIDATION
   ================================================================ */

function buildValidationPrompt(content: string, filePath: string, projectRoot: string, extraContext: string): string {
  const rel = path.relative(projectRoot, filePath).replace(/\\/g, '/');
  return `Eres un experto senior en React 18+, TypeScript y Next.js 14+ (App Router).
Tu tarea es VALIDAR con extrema severidad el siguiente archivo y devolver código corregido si hay cualquier problema.

## CONTEXTO DEL ARCHIVO
- Ruta relativa: ${rel}
- Es un proyecto Next.js con App Router (carpeta app/)
${extraContext}

## REGLAS DE NEXT.JS APP ROUTER (OBLIGATORIAS)
1. Si el archivo usa hooks de React (useState, useEffect, useContext, etc.) O APIs del navegador (window, document, localStorage, navigator, location), DEBE tener la directiva \`'use client';\` en la PRIMERA LÍNEA.
2. Si usa manejadores de eventos JSX (onClick, onSubmit, onChange, etc.) también requiere \`'use client';\`.
3. Los archivos en app/ que NO tengan \`'use client'\` son Server Components por defecto: no deben usar hooks ni browser APIs.
4. \`next/router\` está PROHIBIDO en App Router. Usa \`next/navigation\` (useRouter, usePathname, useSearchParams).
5. El export de \`metadata\` solo está permitido en Server Components (sin 'use client').
6. Los archivos \`page.tsx\` y \`layout.tsx\` deben exportar un componente por defecto.
7. \`async/await\` en Client Components solo funciona en Next.js 14+ si el componente es un Server Component. Si necesita async, verifica que no sea un Client Component.
8. Los Server Actions deben tener \`'use server'\` y no deben mezclarse con hooks de React en el mismo archivo.

## CRITERIOS DE VALIDACIÓN
1. **Sintaxis y compilación**: ¿Compila TypeScript sin errores?
2. **Imports**: ¿Todos los imports existen y están bien escritos?
3. **Props**: ¿Tipado correcto? ¿Props definidas coinciden con las usadas? ¿Hay props faltantes o sin usar?
4. **Hooks**: ¿Uso correcto de hooks? ¿Dependencias de useEffect correctas? ¿No hay hooks en loops/condicionales?
5. **JSX**: ¿Retorna JSX correctamente? ¿Etiquetas cerradas? ¿Atributos válidos?
6. **Next.js**: ¿Cumple las reglas de App Router arriba?
7. **A11y**: ¿Imágenes sin alt? ¿Inputs sin label?
8. **Performance**: ¿useEffect innecesarios? ¿Re-creación de objetos en render?

## INSTRUCCIONES DE RESPUESTA
- Responde ÚNICAMENTE con JSON válido. Sin markdown, sin texto extra.
- Si encuentras CUALQUIER problema (incluso leve), \`isValid\` debe ser false.
- Si \`isValid\` es false, OBLIGATORIO incluir \`correctedCode\` con el archivo COMPLETO corregido.
- El \`correctedCode\` debe ser código funcional, listo para escribir en disco, incluyendo TODOS los imports.
- Mantén nombres, estructura y comentarios útiles del original.

## FORMATO JSON
\`\`\`json
{
  "isValid": boolean,
  "issues": [
    {
      "type": "error" | "warning" | "info",
      "severity": "critical" | "high" | "medium" | "low",
      "message": "Descripción específica del problema",
      "suggestion": "Cómo solucionarlo"
    }
  ],
  "propsAnalysis": {
    "propsDefined": ["prop1"],
    "propsUsed": ["prop1"],
    "missingProps": ["prop que se usa pero no está definido"],
    "unusedProps": ["prop definido pero no usado"],
    "typeErrors": ["descripción"]
  },
  "functionalityIssues": ["lista de problemas de lógica/funcionalidad"],
  "correctedCode": "código completo corregido si hay problemas"
}
\`\`\`

## ARCHIVO A VALIDAR
\`\`\`tsx
${content}
\`\`\`

Analiza línea por línea y responde SOLO con el JSON.`;
}

function buildSimpleValidationPrompt(content: string, filePath: string, projectRoot: string, extraContext: string): string {
  const rel = path.relative(projectRoot, filePath).replace(/\\/g, '/');
  return `Valida este componente React/Next.js y responde SOLO con JSON.

REGLAS CRÍTICAS:
1. Si usa hooks o browser APIs, debe tener 'use client'.
2. No usar next/router en App Router (usar next/navigation).
3. metadata solo en Server Components.
4. Export default en page.tsx/layout.tsx.

ARCHIVO: ${rel}
${extraContext}

FORMATO JSON:
{\n  "isValid": boolean,\n  "issues": [{"type":"error|warning|info","severity":"critical|high|medium|low","message":"...","suggestion":"..."}],\n  "correctedCode": "código corregido completo si hay problemas"\n}

CÓDIGO:
\`\`\`tsx
${content}
\`\`\`

Responde SOLO con el JSON.`;
}

async function validateWithAI(
  content: string,
  filePath: string,
  projectRoot: string,
  modelConfig: { provider: string; model: string; url: string; apiKey: string; id?: string },
  userId?: string,
  extraContext = '',
  useSimplePrompt = false
): Promise<{ validation: any; usage?: any; raw: string }> {
  const prompt = useSimplePrompt
    ? buildSimpleValidationPrompt(content, filePath, projectRoot, extraContext)
    : buildValidationPrompt(content, filePath, projectRoot, extraContext);

  const aiContent = await callModelGeneric(
    {
      provider: modelConfig.provider,
      model: modelConfig.model,
      url: modelConfig.url,
      apiKey: modelConfig.apiKey,
    },
    [
      {
        role: 'system',
        content: 'Eres un experto validador de código React/Next.js. Responde ÚNICAMENTE con JSON válido, sin markdown, sin texto adicional.'
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    { temperature: 0.15, maxTokens: useSimplePrompt ? 8192 : 16384 }
  );

  let jsonContent = aiContent.trim();
  const jsonMatch = jsonContent.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
  if (jsonMatch) jsonContent = jsonMatch[1];

  let validationResult: any;
  try {
    validationResult = JSON.parse(jsonContent);
  } catch {
    validationResult = {
      isValid: false,
      issues: [{ type: 'error', severity: 'high', message: 'Respuesta de IA no parseable como JSON', suggestion: 'Revisar manualmente' }],
      correctedCode: undefined
    };
  }

  return { validation: validationResult, usage: undefined, raw: aiContent };
}

async function requestCorrectionFromAI(
  content: string,
  issues: Issue[],
  modelConfig: { provider: string; model: string; url: string; apiKey: string; id?: string },
  userId?: string
): Promise<string | null> {
  const prompt = `Eres un experto programador React/TypeScript. Corrige el siguiente componente.

PROBLEMAS DETECTADOS:
${issues.map(i => `- [${i.severity.toUpperCase()}] ${i.message}${i.suggestion ? ` -> ${i.suggestion}` : ''}`).join('\n')}

INSTRUCCIONES:
- Proporciona SOLO el código corregido COMPLETO del archivo.
- Incluye TODOS los imports.
- Corrige TODOS los problemas.
- Código funcional y listo para escribir en disco.
- Sin explicaciones, sin JSON, sin markdown.

ARCHIVO A CORREGIR:
\`\`\`tsx
${content}
\`\`\`

Responde SOLO con el código.`;

  try {
    const raw = await callModelGeneric(
      {
        provider: modelConfig.provider,
        model: modelConfig.model,
        url: modelConfig.url,
        apiKey: modelConfig.apiKey,
      },
      [
        { role: 'system', content: 'Eres un experto programador. Responde SOLO con código, sin texto adicional.' },
        { role: 'user', content: prompt }
      ],
      { temperature: 0.15, maxTokens: 16384 }
    );

    let code = raw.trim();
    const blockMatch = code.match(/```(?:tsx|ts|jsx|js)?\n?([\s\S]*?)\n?```/);
    if (blockMatch) code = blockMatch[1].trim();
    return code || null;
  } catch {
    return null;
  }
}

async function fixMissingNamedExports(filePath: string, content: string, projectRoot: string): Promise<{ issues: Issue[]; fixedFiles: { path: string; content: string }[] }> {
  const issues: Issue[] = [];
  const fixedFiles: { path: string; content: string }[] = [];

  const namedImportRegex = /import\s+\{\s*([^}]+)\s*\}\s+from\s+['"]([^'"]+)['"];?/g;
  let match: RegExpExecArray | null;

  while ((match = namedImportRegex.exec(content)) !== null) {
    const namesStr = match[1];
    const source = match[2];
    if (!source.includes('/ui/')) continue;

    const names = namesStr.split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim());
    const resolved = await resolveImportPath(source, filePath, projectRoot);
    if (!resolved || resolved === 'node_modules') continue;

    try {
      const targetContent = await fs.readFile(resolved, 'utf8');
      for (const name of names) {
        if (!name) continue;
        // ¿Ya tiene named export?
        const hasNamedExport =
          new RegExp(`export\\s+(?:const|let|var|function|class|interface|type|enum)\\s+${name}\\b`).test(targetContent) ||
          new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`).test(targetContent);
        if (hasNamedExport) continue;

        // ¿Tiene default export con ese nombre?
        const defaultExportMatch = targetContent.match(/export\s+default\s+(?:function\s+|class\s+)?(\w+)/);
        const defaultName = defaultExportMatch ? defaultExportMatch[1] : null;

        if (defaultName === name) {
          issues.push({
            type: 'warning',
            severity: 'medium',
            message: `El archivo "${path.relative(projectRoot, resolved)}" solo tiene default export para "${name}"`,
            suggestion: `Añadir "export { ${name} };" para compatibilidad con imports nombrados`
          });

          if (!targetContent.includes(`export { ${name} }`)) {
            const newContent = targetContent.trimEnd() + `\n\nexport { ${name} };\n`;
            fixedFiles.push({ path: resolved, content: newContent });
          }
        }
      }
    } catch {
      // Ignorar si no se puede leer el archivo destino
    }
  }

  return { issues, fixedFiles };
}

async function sanitizeAuthConfigHome(projectRoot: string): Promise<{ fixed: boolean; path?: string; message: string }> {
  const candidates = [
    path.join(projectRoot, 'lib', 'auth-config.ts'),
    path.join(projectRoot, 'lib', 'auth-config.tsx'),
    path.join(projectRoot, 'src', 'lib', 'auth-config.ts'),
    path.join(projectRoot, 'src', 'lib', 'auth-config.tsx'),
  ];
  let fixed = false;
  let lastPath = '';
  let messages: string[] = [];

  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate).catch(() => null);
      if (!stat || !stat.isFile()) continue;
      
      let content = await fs.readFile(candidate, 'utf8');
      const original = content;
      
      // Regex más flexible para capturar variaciones de home: '/dashboard'
      content = content.replace(/home\s*:\s*(?:process\.env\.[A-Z0-9_]+\s*\?\?\s*)?['"]\/dashboard['"]/g, "home: '/'");
      
      if (content !== original) {
        await fs.writeFile(candidate, content, 'utf8');
        fixed = true;
        lastPath = candidate;
        messages.push(`Corregido home en ${path.relative(projectRoot, candidate)}`);
      }
    } catch (e) {
      continue;
    }
  }
  
  if (fixed) {
    return { fixed: true, path: lastPath, message: messages.join(', ') };
  }
  return { fixed: false, message: 'auth-config no encontrado o no requería corrección' };
}

/* ================================================================
   VALIDACIÓN COMPLETA DE UN COMPONENTE
   ================================================================ */

async function validateComponent(
  filePath: string,
  projectRoot: string,
  modelConfig: { provider: string; model: string; url: string; apiKey: string; id?: string },
  userId?: string,
  allFilePaths?: string[], // para construir contexto adicional
  autoCorrect = false
): Promise<ComponentValidation> {
  const relativePath = path.relative(projectRoot, filePath).replace(/\\/g, '/');

  try {
    let content = await fs.readFile(filePath, 'utf8');

    // 1) Validación estática de imports
    const importIssues = await validateImports(filePath, content, projectRoot);

    // 2) Detección de problemas comunes Next.js/React
    const commonIssues = detectCommonIssues(content, filePath, projectRoot);

    // 3) Detección básica de sintaxis
    const syntaxIssues = detectSyntaxIssues(content);

    // Si ya hay problemas críticos graves (hooks sin use client, imports no resueltos), podemos
    // intentar corregir directamente con la IA sin validación profunda para ahorrar tokens.
    const hasCriticalStatic = [...importIssues, ...commonIssues, ...syntaxIssues].some(i => i.severity === 'critical');

    // Construir contexto adicional (vecinos del mismo directorio)
    let extraContext = '';
    if (allFilePaths && allFilePaths.length > 0) {
      const dir = path.dirname(filePath);
      const siblings = allFilePaths
        .filter(f => f !== filePath && path.dirname(f) === dir)
        .map(f => path.relative(projectRoot, f).replace(/\\/g, '/'));
      if (siblings.length > 0) {
        extraContext = `- Archivos en el mismo directorio: ${siblings.join(', ')}`;
      }
    }

    // 4) Validación con IA
    let aiResult: any = null;
    let correctedCode: string | undefined;

    // Si el archivo es demasiado grande (>800 líneas o >50KB), truncar para IA y advertir
    const lines = content.split('\n');
    const isOversized = lines.length > 800 || Buffer.byteLength(content, 'utf8') > 50 * 1024;
    let truncatedForAI = false;
    if (isOversized) {
      truncatedForAI = true;
      // Mantener imports + primeras 700 líneas + últimas 50 (cierre)
      const head = lines.slice(0, 700).join('\n');
      const tail = lines.slice(-50).join('\n');
      content = head + '\n\n/* ... [truncado por tamaño para validación IA] ... */\n\n' + tail;
      extraContext += `\n- NOTA: Archivo muy grande (>800 líneas). Se envió versión truncada a la IA.`;
    }

    try {
      const ai = await validateWithAI(content, filePath, projectRoot, modelConfig, userId, extraContext);
      aiResult = ai.validation;
    } catch (firstError: any) {
      console.warn(`[validate-components] Primer intento IA falló para ${relativePath}, reintentando con prompt simplificado...`, firstError.message);
      try {
        const ai = await validateWithAI(content, filePath, projectRoot, modelConfig, userId, extraContext, true);
        aiResult = ai.validation;
        console.log(`[validate-components] Prompt simplificado funcionó para ${relativePath}`);
      } catch (secondError: any) {
        throw new Error(`Ambos prompts fallaron. Último error: ${secondError.message}`);
      }
    }

    try {
      // Este bloque procesa el resultado de la IA (ya sea del primer o segundo intento)

      // Unir issues: si la IA devolvió issues, usarlos; si no, mantener los estáticos
      const aiIssues: Issue[] = Array.isArray(aiResult?.issues) ? aiResult.issues : [];
      const allIssues = [...importIssues, ...commonIssues, ...syntaxIssues, ...aiIssues];

      // Deduplicar por mensaje exacto
      const deduped = allIssues.filter((issue, idx, self) =>
        idx === self.findIndex(i => i.message === issue.message && i.severity === issue.severity)
      );

      const hasIssues = deduped.length > 0 || aiResult?.isValid === false;
      correctedCode = aiResult?.correctedCode;

      // Si no hay correctedCode pero hay issues críticos/altos (incluyendo estáticos), pedir corrección
      const needsCorrection = hasIssues && !correctedCode && deduped.some((i: Issue) => i.severity === 'critical' || i.severity === 'high');
      if (needsCorrection) {
        const fallbackCode = await requestCorrectionFromAI(
          await fs.readFile(filePath, 'utf8'), // usar original completo
          deduped,
          modelConfig,
          userId
        );
        if (fallbackCode) correctedCode = fallbackCode;
      }

      // Solo escribir en disco si autoCorrect está activo y hay problemas graves
      let autoCorrected = false;
      if (autoCorrect && correctedCode && deduped.some((i: Issue) => i.severity === 'critical' || i.severity === 'high')) {
        try {
          await fs.writeFile(filePath, correctedCode, 'utf8');
          autoCorrected = true;
          console.log(`[validate-components] Auto-corrected ${relativePath}`);
        } catch (writeErr) {
          console.warn(`[validate-components] Failed to auto-correct ${relativePath}:`, writeErr);
        }
      }

      // Si truncamos, añadir issue informativo
      if (truncatedForAI) {
        deduped.unshift({
          type: 'info',
          severity: 'low',
          message: 'Archivo muy grande: la validación IA se hizo sobre una muestra truncada',
          suggestion: 'Revisar manualmente si hay problemas en la parte omitida'
        });
      }

      return {
        filePath,
        relativePath,
        isValid: !hasIssues,
        issues: deduped,
        propsAnalysis: aiResult?.propsAnalysis,
        functionalityIssues: aiResult?.functionalityIssues,
        correctedCode: correctedCode || undefined,
        autoCorrected
      };
    } catch (aiError: any) {
      console.error(`[validate-components] AI validation failed for ${relativePath}:`, aiError.message, aiError.stack);
      const allIssues = [...importIssues, ...commonIssues, ...syntaxIssues];
      // Siempre incluir el error real de la IA para diagnóstico
      allIssues.unshift({
        type: 'warning',
        severity: 'medium',
        message: `IA no respondió: ${aiError.message || 'Error desconocido'}`,
        suggestion: 'Reintentar manualmente o revisar conexión con el modelo'
      });
      return {
        filePath,
        relativePath,
        isValid: false,
        issues: allIssues,
        correctedCode: undefined,
        autoCorrected: false
      };
    }
  } catch (error: any) {
    console.error(`[validate-components] Error reading/validating ${relativePath}:`, error);
    return {
      filePath,
      relativePath,
      isValid: false,
      issues: [{
        type: 'error',
        severity: 'high',
        message: `Error al leer/validar: ${error.message}`,
        suggestion: 'Revisar permisos o codificación del archivo'
      }],
      correctedCode: undefined,
      autoCorrected: false
    };
  }
}

/* ================================================================
   POST HANDLER
   ================================================================ */

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      projectRoot: providedRoot,
      projectId,
      userId,
      modelId,
      filesToValidate,
      userToken,
      modelConfig: bodyModelConfig,
      autoCorrect = true // por defecto sí corrige archivos en disco
    } = body as {
      projectRoot?: string;
      projectId?: string;
      userId?: string;
      modelId?: string;
      filesToValidate?: string[];
      userToken?: string;
      modelConfig?: {
        url?: string;
        base_url?: string;
        apiKey?: string;
        api_key?: string;
        model?: string;
        model_name?: string;
        provider?: string;
        id?: string;
        name?: string;
      };
      autoCorrect?: boolean;
    };

    if (!providedRoot && !projectId) {
      return NextResponse.json({ error: 'projectRoot o projectId es requerido' }, { status: 400 });
    }

    // Resolver project root
    let officialRoot: string;
    try {
      if (projectId) {
        officialRoot = await getProjectRoot(projectId, providedRoot);
      } else if (providedRoot) {
        await fs.access(providedRoot);
        officialRoot = providedRoot;
      } else {
        throw new Error('Se requiere projectId o projectRoot');
      }
    } catch (rootError: any) {
      return NextResponse.json({ error: 'Error al obtener ruta del proyecto', details: rootError.message }, { status: 400 });
    }

    if (!officialRoot) {
      return NextResponse.json({ error: 'No se pudo determinar la ruta del proyecto' }, { status: 400 });
    }

    try {
      await fs.access(officialRoot);
    } catch {
      return NextResponse.json({ error: 'El directorio del proyecto no existe', details: officialRoot }, { status: 404 });
    }

    console.log(`[validate-components] Starting validation for: ${officialRoot}`);

    // Detecta Ollama Cloud para no concatenar /chat/completions a /api/generate.
    const isOllamaCloudProvider = (provider: string | undefined): boolean => {
      const p = String(provider || '').toLowerCase();
      return p.includes('ollama cloud') || p.includes('ollama_cloud') || p.includes('ollama-cloud');
    };
    const isOllamaCloudUrl = (url: string | undefined): boolean => {
      const u = String(url || '').toLowerCase();
      return u.includes('ollama.com') || u.includes('ollama.cloud');
    };

    const normalizeChatUrl = (raw: string, provider?: string): string => {
      let u = raw.trim().replace(/\/$/, '');
      if (isOllamaCloudProvider(provider) || isOllamaCloudUrl(u)) {
        // Ollama Cloud usa /api/generate o /api/chat (con NDJSON), NO /chat/completions
        if (!u.includes('/api/generate') && !u.includes('/api/chat') && !u.includes('/chat/completions')) {
          u = u + '/api/generate';
        }
        return u;
      }
      if (!u.includes('/chat/completions')) u += '/chat/completions';
      return u;
    };

    /** Unifica campos del cliente (url/base_url, apiKey/api_key, model/model_name) y proveedores tipo DeepSeek */
    const resolveFromBodyConfig = (cfg: typeof bodyModelConfig): { provider: string; model: string; url: string; apiKey: string; id?: string } | null => {
      if (!cfg || typeof cfg !== 'object') return null;
      const c = cfg as Record<string, unknown>;
      let apiKey = String(c.apiKey ?? c.api_key ?? '').trim();
      let url = String(c.url ?? c.base_url ?? '').trim();
      const model = String(c.model ?? c.model_name ?? 'gpt-4o').trim();
      const id = c.id != null ? String(c.id) : undefined;
      const providerRaw = String(c.provider ?? 'openai').toLowerCase();

      if (!apiKey) {
        apiKey =
          (providerRaw.includes('deepseek')
            ? process.env.DEEPSEEK_API_KEY || process.env.API_KEY_DEEPSEEK
            : '') ||
          process.env.OPENAI_API_KEY ||
          '';
      }

      if (!apiKey) return null;

      if (!url) {
        if (providerRaw.includes('deepseek')) {
          url = normalizeChatUrl(process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions');
        } else {
          url = normalizeChatUrl(process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions');
        }
      } else {
        url = normalizeChatUrl(url, providerRaw);
      }

      return { provider: providerRaw, model, url, apiKey, id };
    };

    let modelConfig: { provider: string; model: string; url: string; apiKey: string; id?: string } | null =
      resolveFromBodyConfig(bodyModelConfig);

    if (!modelConfig && userId && modelId) {
      try {
        const allModels = await getModelsForUser(userId);
        const userModel = allModels.find((m: any) => m.id === modelId);
        if (userModel) {
          let apiUrl = userModel.url || userModel.base_url || '';
          let apiKey = userModel.apiKey || userModel.api_key || '';
          if (!apiKey)
            apiKey =
              String(userModel.provider || '').toLowerCase().includes('deepseek')
                ? process.env.DEEPSEEK_API_KEY || process.env.API_KEY_DEEPSEEK || ''
                : process.env.OPENAI_API_KEY || '';
          const userProvider = String(userModel.provider || '').toLowerCase();
          if (!apiUrl) {
            apiUrl = userProvider.includes('deepseek')
              ? 'https://api.deepseek.com/chat/completions'
              : 'https://api.openai.com/v1/chat/completions';
          }
          // No concatenar /chat/completions si es Ollama Cloud
          if (isOllamaCloudProvider(userProvider) || isOllamaCloudUrl(apiUrl)) {
            if (!apiUrl.includes('/api/generate') && !apiUrl.includes('/api/chat') && !apiUrl.includes('/chat/completions')) {
              apiUrl = apiUrl.replace(/\/$/, '') + '/api/generate';
            }
          } else if (!apiUrl.includes('/chat/completions')) {
            apiUrl = apiUrl.replace(/\/$/, '') + '/chat/completions';
          }
          modelConfig = {
            provider: userModel.provider || 'openai',
            model: userModel.model || userModel.model_name || 'gpt-4o',
            url: apiUrl,
            apiKey,
            id: userModel.id,
          };
        }
      } catch (e) {
        console.warn('[validate-components] Failed to load model from PocketBase:', e);
      }
    }

    if (!modelConfig) {
      modelConfig = {
        provider: 'openai',
        model: process.env.OPENAI_MODEL || 'gpt-4o',
        url: normalizeChatUrl(process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions'),
        apiKey: process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || '',
      };
    }

    if (!modelConfig.apiKey) {
      return NextResponse.json({ error: 'No se pudo obtener la configuración del modelo de IA (falta apiKey / api_key)' }, { status: 500 });
    }

    console.log(`[validate-components] Model: ${modelConfig.model} URL: ${modelConfig.url}`);

    // Resolver archivos a validar
    let componentFiles: string[] = [];

    if (Array.isArray(filesToValidate) && filesToValidate.length > 0) {
      const unique = new Set<string>();
      for (const rel of filesToValidate) {
        if (!rel || typeof rel !== 'string') continue;
        const normalizedRel = rel.replace(/\\/g, '/').replace(/^\/+/, '');
        const fullPath = path.join(officialRoot, normalizedRel);
        const ext = path.extname(fullPath).toLowerCase();
        if (!COMPONENT_EXTS.includes(ext)) continue;
        if (await fileExists(fullPath)) unique.add(fullPath);
      }
      componentFiles = Array.from(unique);
    } else {
      componentFiles = await walkDirectory(officialRoot, officialRoot);
    }

    if (componentFiles.length === 0) {
      return NextResponse.json({ totalComponents: 0, validatedComponents: 0, validComponents: 0, invalidComponents: 0, components: [], summary: 'No se encontraron componentes para validar' });
    }

    // Priorizar y limitar (los builds locales/Electron pueden tener muchos componentes generados)
    componentFiles = prioritizeFiles(componentFiles, officialRoot);
    const envMax = process.env.VALIDATE_COMPONENTS_MAX;
    const parsedMax = envMax ? parseInt(envMax, 10) : NaN;
    const defaultMax = process.env.VERCEL ? 18 : 200;
    const MAX_COMPONENTS = Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : defaultMax;
    const totalFound = componentFiles.length;
    if (componentFiles.length > MAX_COMPONENTS) {
      componentFiles = componentFiles.slice(0, MAX_COMPONENTS);
      console.warn(
        `[validate-components] Limitando a ${MAX_COMPONENTS}/${totalFound} componentes (ajusta VALIDATE_COMPONENTS_MAX o amplía lotes en el cliente)`
      );
    }

    // Validar por lotes
    const validations: ComponentValidation[] = [];
    const BATCH_SIZE = 1; // 1 en paralelo para máxima estabilidad con modelos locales

    for (let i = 0; i < componentFiles.length; i += BATCH_SIZE) {
      const batch = componentFiles.slice(i, i + BATCH_SIZE);
      try {
        const batchResults = await Promise.all(
          batch.map(f => validateComponent(f, officialRoot, modelConfig!, userId, componentFiles, autoCorrect))
        );
        validations.push(...batchResults);
        console.log(`[validate-components] Procesado ${validations.length}/${componentFiles.length}: ${batch.map(f => path.relative(officialRoot, f)).join(', ')}`);
      } catch (batchErr: any) {
        console.error(`[validate-components] Batch error:`, batchErr);
        for (const f of batch) {
          validations.push({
            filePath: f,
            relativePath: path.relative(officialRoot, f).replace(/\\/g, '/'),
            isValid: false,
            issues: [{ type: 'error', severity: 'high', message: `Error en batch: ${batchErr.message}`, suggestion: 'Reintentar' }],
            correctedCode: undefined,
            autoCorrected: false
          });
        }
      }

      if (i + BATCH_SIZE < componentFiles.length) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    // Corrección de auth-config home
    const authConfigFix = await sanitizeAuthConfigHome(officialRoot);
    if (authConfigFix.fixed) {
      console.log(`[validate-components] ${authConfigFix.message}`);
    }

    // Estadísticas
    const realValidated = validations.filter(v => !v.issues.some(i => i.type === 'info' && i.message.includes('no parece ser un componente'))).length;
    const validComponents = validations.filter(v => v.isValid).length;
    const invalidComponents = validations.filter(v => !v.isValid).length;
    const autoCorrectedCount = validations.filter(v => v.autoCorrected).length;

    const criticalIssues = validations.reduce((sum, v) => sum + v.issues.filter(i => i.severity === 'critical').length, 0);
    const highIssues = validations.reduce((sum, v) => sum + v.issues.filter(i => i.severity === 'high').length, 0);

    const summaryLines = [
      `Validación completada:`,
      `- Total escaneados: ${totalFound}`,
      `- Validados: ${realValidated}`,
      `- Válidos: ${validComponents}`,
      `- Inválidos: ${invalidComponents}`,
      `- Auto-corrected: ${autoCorrectedCount}`,
      `- Críticos: ${criticalIssues}`,
      `- Altos: ${highIssues}`
    ];
    if (authConfigFix.fixed) {
      summaryLines.push(`- Auth config home corregido: ${authConfigFix.message}`);
    }
    const summary = summaryLines.join('\n');

    const result: ValidationResult = {
      totalComponents: totalFound,
      validatedComponents: realValidated,
      validComponents,
      invalidComponents,
      components: validations,
      summary
    };

    console.log(`[validate-components] Done. ${summary}`);

    // Limpiar respuesta para evitar problemas de serialización
    const safeResult: ValidationResult = {
      ...result,
      components: validations.map(v => {
        const safe = { ...v };
        if (safe.correctedCode && safe.correctedCode.length > 30 * 1024) {
          safe.correctedCode = safe.correctedCode.substring(0, 30 * 1024) + '\n// ... [truncated por tamaño]';
        }
        if (safe.correctedCode) {
          safe.correctedCode = safe.correctedCode.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ');
        }
        return safe;
      })
    };

    const jsonString = JSON.stringify(safeResult);
    const jsonSizeMB = Buffer.byteLength(jsonString, 'utf8') / (1024 * 1024);
    if (jsonSizeMB > 4) {
      console.warn(`[validate-components] Response large (${jsonSizeMB.toFixed(2)}MB), truncating correctedCode aggressively`);
      safeResult.components = safeResult.components.map(c => ({
        ...c,
        correctedCode: c.correctedCode ? c.correctedCode.substring(0, 5000) + '\n// ... [truncated]' : undefined
      }));
    }

    return NextResponse.json(safeResult);

  } catch (error: any) {
    console.error('[validate-components] Fatal error:', error);
    return NextResponse.json({
      error: 'Error al validar componentes',
      details: error.message || 'Error desconocido',
      errorType: error.name || 'UnknownError',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  }
}
