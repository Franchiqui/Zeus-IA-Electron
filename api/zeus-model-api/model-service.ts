/**
 * Zeus Model API - Model Service
 * Centraliza todas las llamadas a modelos de IA (OpenAI, Deepseek, Ollama, LM Studio)
 * para ser usadas desde Next.js API Routes y el servidor Express.
 */

// Re-export del bucle de tool calls nativas
export { callModelWithTools, callModelWithToolsDetailed } from './tool-loop';
export type { ToolLogEntry, ToolLoopResult } from './tool-loop';
export type { ToolCall, ToolResult, ToolDefinition } from './tools';

import PocketBase from 'pocketbase';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const DEEPSEEK_URL = process.env.DEEPSEEK_API_URL ?? 'https://api.deepseek.com/chat/completions';
const LM_STUDIO_API_URL = process.env.LM_STUDIO_API_URL || 'http://localhost:1234';
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

export type ChatBody = {
  provider: 'OpenAI' | 'Deepseek' | 'Ollama' | 'Ollama Cloud' | 'LM Studio';
  model: string;
  history?: ChatMessage[];
  newMessage: ChatMessage;
  systemContext?: string;
  hiddenContext?: string;
  webSearch?: boolean;
  stream?: boolean;
  images?: string[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  cwd?: string;
};

export type ModelConfig = {
  baseURL: string;
  apiKey: string;
  model: string;
  name: string;
};

export function getModelConfig(): ModelConfig {
  const name =
    process.env.LM_STUDIO_MODEL ??
    process.env.OPENAI_MODEL ??
    process.env.DEFAULT_CHAT_MODEL ??
    'gpt-4o-mini';

  return {
    baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY || '',
    model: name,
    name,
  };
}

export type PersistedCodeBubble = { code: string; language: string; fileName: string };

function inferLanguageFromFileName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const languageMap: Record<string, string> = {
    js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    json: 'json', css: 'css', scss: 'scss', sass: 'sass', less: 'less',
    html: 'html', htm: 'html', xml: 'xml', md: 'markdown', py: 'python',
    java: 'java', c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp', go: 'go',
    rs: 'rust', php: 'php', rb: 'ruby', sh: 'shell', bash: 'shell',
    yml: 'yaml', yaml: 'yaml', sql: 'sql', vue: 'vue', svelte: 'svelte'
  };
  return languageMap[ext] || 'typescript';
}

export function validateReplacements(changes: any[]): boolean {
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

export function extractCodeChangeFromResponse(text: string): object | null {
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    const jsonBlockRegex = /```(?:json)?\s*({[\s\S]*?})\s*```/;
    const jsonBlockMatch = text.match(jsonBlockRegex);
    if (jsonBlockMatch) {
      try {
        parsed = JSON.parse(jsonBlockMatch[1]);
      } catch {
        // ignore
      }
    }
  }
  if (!parsed) {
    const codeChangeRegex = /{\s*"type"\s*:\s*"code_change"[\s\S]*?}\s*(?:,\s*"explanation"[\s\S]*?)?}/;
    const directMatch = text.match(codeChangeRegex);
    if (directMatch) {
      try {
        parsed = JSON.parse(directMatch[0]);
      } catch {
        // ignore
      }
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

export function buildAssistantStructuredContent(rawText: string): { content: string; codeBubbles: PersistedCodeBubble[] } {
  const codeBubbleByZeusBlockIndex: Record<number, PersistedCodeBubble> = {};
  const zeusCallPattern = /\[ZEUS_API_CALL\]([\s\S]*?)(?=\[ZEUS_API_CALL\]|\[\/ZEUS_API_CALL\]|\[TERMINAL_COMMAND\]|$)/g;
  let zeusBlockIndex = 0;
  let zeusMatch: RegExpExecArray | null;

  while ((zeusMatch = zeusCallPattern.exec(rawText)) !== null) {
    const currentIdx = zeusBlockIndex++;
    const callDef = cleanAndParseZeusCallJson(zeusMatch[1] || '');
    if (!callDef || !callDef.url) continue;

    const fileNameFromBody =
      (typeof callDef?.body?.name === 'string' && callDef.body.name) ||
      (typeof callDef?.name === 'string' && callDef.name) ||
      '';
    const fileNameFromUrl = String(callDef.url).split('/').pop()?.split('?')[0] || '';
    const resolvedFileName = fileNameFromBody || fileNameFromUrl || 'archivo.tsx';
    const contentFromBody = typeof callDef?.body?.content === 'string' ? callDef.body.content : '';

    if (contentFromBody.trim()) {
      codeBubbleByZeusBlockIndex[currentIdx] = {
        code: contentFromBody,
        language: inferLanguageFromFileName(resolvedFileName),
        fileName: resolvedFileName,
      };
    }
  }

  const codeBubbles: PersistedCodeBubble[] = [];
  let zeusReplaceIndex = 0;

  const textWithZeusMarkers = rawText.replace(
    /\[ZEUS_API_CALL\][\s\S]*?(?=\[ZEUS_API_CALL\]|\[\/ZEUS_API_CALL\]|\[TERMINAL_COMMAND\]|$)/g,
    () => {
      const bubble = codeBubbleByZeusBlockIndex[zeusReplaceIndex++];
      if (!bubble) return '';
      const markerIndex = codeBubbles.push(bubble) - 1;
      return `\n[CODE_BUBBLE_${markerIndex}]\n`;
    }
  );

  const textWithAllCodeMarkers = textWithZeusMarkers.replace(
    /```([a-zA-Z0-9_+-]+)?\n?([\s\S]*?)```/g,
    (_match: string, lang?: string, code?: string) => {
      const normalizedCode = (code || '').replace(/\n$/, '').trim();
      if (!normalizedCode) return '';
      const markerIndex = codeBubbles.push({
        code: normalizedCode,
        language: lang || 'typescript',
        fileName: '',
      }) - 1;
      return `\n[CODE_BUBBLE_${markerIndex}]\n`;
    }
  );

  const content = textWithAllCodeMarkers
    .replace(/\[\/ZEUS_API_CALL\]/g, '')
    .replace(/\[CODE_BUBBLE_\d+\]/g, (match) => {
      const markerIndex = parseInt(match.replace(/\[CODE_BUBBLE_|\]/g, ''), 10);
      const bubble = codeBubbles[markerIndex];
      return bubble ? bubble.code : '';
    });

  return { content, codeBubbles };
}

function cleanAndParseZeusCallJson(raw: string): any | null {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/\[\/ZEUS_API_CALL\]/g, '').replace(/<tool_call\|>.*$/s, '').trim();

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) return null;

  cleaned = cleaned.substring(firstBrace, lastBrace + 1);

  try {
    return JSON.parse(cleaned);
  } catch {
    const repaired = cleaned.replace(/\n/g, '\\n').replace(/\r/g, '\\r');
    try {
      return JSON.parse(repaired);
    } catch {
      return null;
    }
  }
}

// System prompts
const ZEUS_SYSTEM_PROMPT_SHORT = `Eres un asistente de IA especializado en desarrollo de software.

## REGLAS CRÍTICAS
1. **AUTONOMÍA TOTAL**: NO pidas permiso. Simplemente EJECUTA. NUNCA preguntes al usuario si quiere continuar.
2. **CONTINUACIÓN AUTOMÁTICA**: El sistema te dará automáticamente un turno extra después de cada respuesta. NO uses [CONTINUAR]. Usa [FIN] solo cuando realmente hayas terminado todas las acciones.
3. **PROHIBIDO PREGUNTAR**: NUNCA uses frases como "¿quieres que proceda?", "¿continúo?", "¿te parece bien?", "dime si quieres que siga", "¿quieres que haga X?", "¿confirmas?", "¿estás de acuerdo?". Si el usuario te da una instrucción, EJECÚTALA directamente sin pedir confirmación.

## MÉTODO PRINCIPAL PARA CORRECCIONES: CODE CHANGE JSON
Para CUALQUIER corrección, modificación o cambio pequeño en archivos existentes, usa SIEMPRE el formato JSON "code_change". El sistema lo aplicará automáticamente.

FORMATO:
\`\`\`json
{
  "type": "code_change",
  "explanation": "Descripción breve",
  "changes": [
    {
      "file": "ruta/al/archivo.ts",
      "replacements": [
        {"old": "texto exacto actual", "new": "nuevo texto"}
      ]
    }
  ]
}
\`\`\`

REGLAS:
- "old" debe coincidir EXACTAMENTE con el contenido del archivo
- Para archivos nuevos: usa "old": ""
- Múltiples cambios = múltiples objetos en "replacements"

## CUÁNDO USAR CODE_CHANGE (90% de los casos)
- Correcciones de bugs, typos
- Cambiar texto, funciones, componentes
- Añadir/eliminar líneas de código
- Modificar configuraciones

## CUÁNDO USAR [ZEUS_API_CALL] (solo 10%)
- Crear aplicaciones completas desde cero
- Operaciones complejas que requieren planes
- Cuando code_change no sea suficiente

[ZEUS_API_CALL]{"method":"POST","url":"http://localhost:8742/api/..."}[/ZEUS_API_CALL]
`;

const ZEUS_SYSTEM_PROMPT = `Eres un asistente de IA especializado en desarrollo de software.

## URL BASE DE LA API
http://localhost:8742/api

## REGLAS CRÍTICAS
1. Sé extremadamente breve y directo. Solo responde a lo que el usuario pida.
2. **AUTONOMÍA TOTAL**: NO pidas permiso. Simplemente EJECUTA. NUNCA preguntes al usuario si quiere continuar.
3. **CONTINUACIÓN AUTOMÁTICA**: El sistema te dará automáticamente un turno extra después de cada respuesta. NO uses [CONTINUAR]. Usa [FIN] solo cuando realmente hayas terminado todas las acciones.
4. Para comandos de terminal usa [TERMINAL_COMMAND]comando[/TERMINAL_COMMAND].
5. Las líneas empiezan en 1. Los caracteres empiezan en 0.

## PROHIBIDO PREGUNTAR AL USUARIO
Bajo NINGUNA circunstancia debes hacer preguntas al usuario como:
- "¿Quieres que proceda?"
- "¿Continúo?"
- "¿Te parece bien?"
- "¿Quieres que siga?"
- "¿Debería continuar?"
- "¿Necesitas algo más?"
- "¿Deseas que realice esta acción?"
- "¿Confirmas?"
- "¿Estás de acuerdo?"
- "¿Quieres que haga X?"

Si el usuario te da una instrucción, EJECÚTALA directamente sin pedir confirmación. NUNCA pidas aprobación o permiso. Actúa con autonomía total.

## MÉTODO PRINCIPAL: CODE CHANGE JSON (90% DE LOS CASOS)
Para CUALQUIER corrección, modificación o cambio en archivos existentes, usa SIEMPRE este formato JSON. El sistema lo aplicará automáticamente.

**FORMATO:**
\`\`\`json
{
  "type": "code_change",
  "explanation": "Descripción breve de los cambios",
  "changes": [
    {
      "file": "app/componentes/Header.tsx",
      "replacements": [
        {
          "old": "texto exacto actual del archivo",
          "new": "nuevo texto que reemplaza"
        }
      ]
    }
  ]
}
\`\`\`

**REGLAS IMPORTANTES:**
- "old" debe coincidir EXACTAMENTE con el contenido actual (espacios, tabs, saltos de línea incluidos)
- Múltiples reemplazos = más objetos en "replacements"
- Múltiples archivos = más objetos en "changes"
- Para crear archivo nuevo: usa "old": ""
- Saltos de línea en JSON: escapa como \\n

**USAR CODE_CHANGE PARA:**
- ✅ Correcciones de bugs, typos
- ✅ Cambiar texto, funciones, componentes, imports
- ✅ Añadir/eliminar código
- ✅ Modificar configuraciones
- ✅ Cualquier cambio que el usuario pida con "cambia", "corrige", "modifica", "actualiza"

**NO USAR CODE_CHANGE (usar [ZEUS_API_CALL] en su lugar):**
- ❌ Crear aplicaciones completas desde cero
- ❌ Operaciones que requieren guardar en planes para ejecución diferida

## [ZEUS_API_CALL] - SOLO PARA OPERACIONES COMPLEJAS (10% DE LOS CASOS)
Usar únicamente para crear aplicaciones completas o cuando code_change no sea suficiente.

[ZEUS_API_CALL]{"method":"POST","url":"http://localhost:8742/api/..."}[/ZEUS_API_CALL]

## TERMINAL COMMANDS
[TERMINAL_COMMAND]npm install[/TERMINAL_COMMAND]
[TERMINAL_COMMAND]git init[/TERMINAL_COMMAND]

## CREAR APLICACIONES COMPLETAS (único caso para [ZEUS_API_CALL])

### PASO 1: CREAR UN PLAN
Cuando el usuario te pida crear una aplicación completa, primero debes crear un PLAN que contenga todas las tareas necesarias.

Ejemplo de creación de plan:
[ZEUS_API_CALL]{"method":"POST","url":"http://localhost:8742/api/plan","body":{"name":"mi_aplicacion","description":"Aplicación completa con estructura de carpetas y archivos"},"description":"Creando plan para la aplicación"}[/ZEUS_API_CALL]

### PASO 2: CREAR CARPETA PRINCIPAL (PRIMERA TAREA)
La PRIMERA tarea del plan DEBE ser crear una carpeta principal para la aplicación. Todos los archivos y subcarpetas deben estar dentro de esta carpeta.

Ejemplo de crear carpeta principal:
[ZEUS_API_CALL]{"method":"POST","url":"http://localhost:8742/api/plan/tasks/save","body":{"planName":"mi_aplicacion","name":"mi_app","type":"folder","operation":"create","path":""},"description":"Creando carpeta principal para la aplicación"}[/ZEUS_API_CALL]

### PASO 3: GUARDAR TAREAS EN EL PLAN (NO EJECUTARLAS)
Cada archivo, carpeta o modificación debe guardarse como una TAREA dentro del plan, usando "saveToPlan": true.

**IMPORTANTE SOBRE EXTENSIONES:**
- Si el nombre del archivo YA incluye la extensión (ej: "index.html"), NO uses el parámetro "extension"
- Si el nombre NO incluye la extensión (ej: "index"), usa el parámetro "extension" (ej: "html")
- NUNCA uses ambos a la vez para evitar doble extensión como "layout.tsx.tsx"

### PASO 4: EJECUTAR EL PLAN COMPLETO
Una vez que todas las tareas están guardadas en el plan, **DEBES** ejecutar el plan completo:

[ZEUS_API_CALL]{"method":"POST","url":"http://localhost:8742/api/plan/execute","body":{"planName":"mi_aplicacion"},"description":"Ejecutando todas las tareas del plan mi_aplicacion"}[/ZEUS_API_CALL]

## FLUJO CORRECTO PARA ACTUALIZAR ARCHIVOS EXISTENTES

### CUANDO EL USUARIO PIDA ACTUALIZAR UN ARCHIVO EXISTENTE:

Usa SIEMPRE el formato JSON \`code_change\`. NO uses planes ni [ZEUS_API_CALL] para actualizar archivos existentes.

### EJEMPLO DE ACTUALIZACIÓN DE ARCHIVO:

Usuario: "Actualiza el archivo app/page.tsx con mejoras en la interfaz"

Tú debes responder con code_change:
\`\`\`json
{
  "type": "code_change",
  "explanation": "Mejorando interfaz de page.tsx",
  "changes": [
    {
      "file": "app/page.tsx",
      "replacements": [
        {
          "old": "<div className=\"old-class\">",
          "new": "<div className=\"new-class bg-blue-500\">"
        }
      ]
    }
  ]
}
\`\`\`

**NOTA CRÍTICA**: Para actualizar archivos existentes, usa SIEMPRE \`code_change\`. No uses planes, no uses [ZEUS_API_CALL] con \`operation: "update"\`.

1.  **ETAPA 1: Plan y Estructura**: Crea el plan y la carpeta raíz. **PROHIBIDO** terminal. Usa [CONTINUAR].
2.  **ETAPA 2: Configuración y Root**: Crea package.json, configs y archivos base (\`/api/folders\` o \`/api/plan/tasks/save\`). **PROHIBIDO** terminal (salvo \`cd\`). Usa [CONTINUAR].
3.  **ETAPA 3...N: Componentes y Lógica**: Crea los componentes y la lógica de la aplicación.
4.  **ETAPA FINAL: Ejecución**: Solo cuando TODOS los archivos y componentes necesarios existan, sugiere comandos como \`npm install\` o \`npm run dev\`.

## REGLA DE CONTINUACIÓN AUTOMÁTICA
**IMPORTANTE**: Cuando el usuario te pida crear una aplicación completa, NO te detengas después de crear el plan. Continúa automáticamente con los siguientes pasos:

1. **Crear el plan** (PASO 1)
2. **Crear carpeta principal** (PASO 2)
3. **Guardar todas las tareas** en el plan (PASO 3)
4. **Ejecutar el plan** (PASO 4)

**NO esperes confirmación del usuario entre pasos**. El usuario ya te ha dado la instrucción inicial, así que continúa automáticamente hasta completar toda la aplicación.

## ESTRUCTURA JERÁRQUICA CORRECTA
Siempre organiza los archivos en una estructura lógica:

1. **Carpeta principal** (ej: "mi_app")
2. **Subcarpetas** dentro de la principal (ej: "mi_app/src", "mi_app/public")
3. **Archivos** dentro de las carpetas correspondientes

### EJEMPLO COMPLETO DE FLUJO:
Usuario: "Crea una aplicación web simple con HTML, CSS y JavaScript"

Tú debes hacer:
1. Crear plan "app_web"
2. Guardar tarea: crear carpeta "mi_app" (carpeta principal)
3. Guardar tarea: crear carpeta "public" dentro de "mi_app"
4. Guardar tarea: crear archivo "index.html" en "mi_app/public"
5. Guardar tarea: crear archivo "style.css" en "mi_app/public"
6. Guardar tarea: crear archivo "app.js" en "mi_app/public"
7. Ejecutar plan "app_web"

**TODO EN UNA SOLA RESPUESTA**, sin pausas ni esperar confirmación del usuario.

### ERRORES COMUNES A EVITAR:
1. ❌ NO crear carpetas/archivos directamente sin plan (a menos que el usuario lo pida específicamente)
2. ❌ NO crear un plan vacío sin tareas
3. ❌ NO ejecutar tareas individualmente fuera del plan
4. ❌ NO detenerte después de crear el plan - CONTINÚA AUTOMÁTICAMENTE
5. ❌ NO olvidar ejecutar el plan al final
6. ❌ NO crear archivos sueltos sin carpeta principal
7. ❌ NO usar doble extensión (ej: "archivo.tsx.tsx")
8. ❌ NUNCA preguntar al usuario si quiere continuar (ej: NO digas "¿quieres que proceda?", "¿continúo?", "¿te parece bien?", "dime si quieres que siga")
9. ✅ SIEMPRE usar "saveToPlan": true para guardar tareas en el plan
10. ✅ ESPERAR a tener todas las tareas antes de ejecutar el plan
11. ✅ CONTINUAR automáticamente sin esperar confirmación del usuario
12. ✅ CREAR primero una carpeta principal para la aplicación
13. ✅ ORGANIZAR archivos en estructura jerárquica
14. ✅ Para actualizar archivos existentes: usa SIEMPRE code_change JSON (NO planes, NO operation: "update")

### REGLAS SOBRE EXTENSIONES:
1. Si el nombre YA tiene extensión (ej: "package.json", "index.html", "app.tsx"): NO usar parámetro "extension"
2. Si el nombre NO tiene extensión (ej: "index", "app", "styles"): usar parámetro "extension" (ej: "html", "js", "css")
3. NUNCA usar ambos a la vez

### DIFERENCIA ENTRE "create" Y "update":
- **"create"**: Para crear archivos NUEVOS que no existen
- **"update"**: Para MODIFICAR archivos EXISTENTES (cambiar su contenido)

Formato para llamar un endpoint:
[ZEUS_API_CALL]{"method":"POST","url":"http://localhost:8742/api/folders","body":{"name":"mi_proyecto","path":""},"description":"Creando carpeta de proyecto"}[/ZEUS_API_CALL]

Para GET: [ZEUS_API_CALL]{"method":"GET","url":"http://localhost:8742/api/files","params":{"path":"mi_proyecto"},"description":"Listando archivos"}[/ZEUS_API_CALL]

Para guardar en plan: [ZEUS_API_CALL]{"method":"POST","url":"http://localhost:8742/api/folders","body":{"name":"mi_proyecto","path":"","planName":"mi_plan","saveToPlan":true},"description":"Guardando creación de carpeta en plan"}[/ZEUS_API_CALL]

CAPACIDADES COMPLETAS DE LA API:

### GESTIÓN DE CARPETAS
- POST /folders - Crear carpeta (parámetros: name, path, [planName], [saveToPlan])
- GET /folders - Listar carpetas (parámetros: [path])
- PUT /folders/{name} - Actualizar/renombrar carpeta (parámetros: newName, path, [planName], [saveToPlan])
- DELETE /folders/{name} - Borrar carpeta (parámetros: path, [planName], [saveToPlan])

### GESTIÓN DE ARCHIVOS
- POST /files - Crear archivo (parámetros: name, path, [extension], [type], [content], [planName], [saveToPlan])
- GET /files/{name} - Ver archivo (parámetros: path)
- GET /files - Listar archivos (parámetros: path)
- PUT /files/{name} - Actualizar archivo (parámetros: path, [content], [newName], [planName], [saveToPlan])
- DELETE /files/{name} - Borrar archivo (parámetros: path, [planName], [saveToPlan])

### MANIPULACIÓN DE LÍNEAS
- GET /files/{name}/lines - Ver líneas específicas (parámetros: path, [startLine], [endLine])
- GET /files/{name}/lines/list - Listar todas las líneas (parámetros: path)
- POST /files/{name}/lines - Insertar línea(s) (parámetros: path, [lineNumber], content, [planName], [saveToPlan])
- PUT /files/{name}/lines/{lineNumber} - Sustituir línea(s) (parámetros: path, content, [numLines], [planName], [saveToPlan])
- DELETE /files/{name}/lines/{lineNumber} - Borrar línea(s) (parámetros: path, [numLines], [planName], [saveToPlan])

### MANIPULACIÓN DE CARACTERES
- GET /files/{name}/lines/{lineNumber}/chars - Ver caracteres específicos (parámetros: path, startCharIndex, endCharIndex)
- GET /files/{name}/lines/{lineNumber}/chars/list - Listar todos los caracteres de una línea (parámetros: path)
- POST /files/{name}/lines/{lineNumber}/chars - Insertar caracteres (parámetros: path, [position], content, [planName], [saveToPlan])
- PUT /files/{name}/lines/{lineNumber}/chars - Sustituir caracteres (parámetros: path, [startCharIndex], [endCharIndex], content, [planName], [saveToPlan])
- DELETE /files/{name}/lines/{lineNumber}/chars - Borrar carácter(es) (parámetros: path, startCharIndex, endCharIndex, [planName], [saveToPlan])

### PLANIFICACIÓN Y TAREAS
- POST /plan - Crear un nuevo plan (parámetros: name, [description])
- POST /plan/save - Guardar un plan sin ejecutar (parámetros: name, [description])
- GET /plan - Listar todos los planes
- GET /plan/{name} - Ver un plan específico (parámetros: name)
- PUT /plan/{name} - Actualizar un plan (parámetros: [newName], [description])
- DELETE /plan/{name} - Borrar un plan (parámetros: name)
- POST /plan/tasks/save - Guardar una tarea en el plan sin ejecutar (parámetros: planName, name, type, operation, [path], [extension], [content])
- GET /plan/tasks - Listar tareas del plan (parámetros: [fileName])
- GET /plan/tasks/{name} - Ver tarea específica (parámetros: name)
- PUT /plan/tasks/{name} - Actualizar tarea (parámetros: [newName], [extension], [type], [path])
- DELETE /plan/tasks/{name} - Borrar tarea (parámetros: name)
- POST /plan/execute - Ejecutar todas las tareas pendientes del plan (parámetros: planName)
- GET /plans/list - Obtener lista simplificada de planes para desplegable

### ESTRUCTURAS COMPLETAS
- POST /structure - Crear una estructura completa de carpetas/archivos (parámetros: structure [JSON], [planName], [saveToPlan])
- POST /structure/execute - Ejecutar la estructura preparada (parámetros: [planName], [saveToPlan])
- GET /structure/tree - Obtener el árbol de estructura creado
- POST /structure/save - Guardar estructura a archivo JSON (parámetros: structure, [name])
- GET /structure/list - Listar estructuras guardadas
- GET /structure/load - Cargar estructura desde archivo (parámetros: [fileName])

### HISTORIAL Y DESHACER
- GET /files/{name}/history - Obtener historial de cambios de un archivo (parámetros: name)
- POST /files/{name}/undo - Deshacer último cambio de un archivo (parámetros: name)
- GET /history/files - Listar todos los archivos con historial
`;

const WEB_SEARCH_INSTRUCTIONS = `

## HERRAMIENTA DE BÚSQUEDA WEB
Cuando necesites información actualizada de internet (versiones de dependencias, documentación reciente, noticias, APIs, etc.), usa el marcador:
[WEB_SEARCH]tu consulta en español o inglés[/WEB_SEARCH]

Ejemplos de cuándo usarlo:
- El usuario pregunta por la última versión de una librería
- Necesitas verificar si una función está deprecada
- El usuario pregunta sobre noticias o eventos recientes
- Necesitas datos actualizados sobre tecnologías

IMPORTANTE:
- Solo usa [WEB_SEARCH] cuando realmente necesites información fresca
- Después del marcador, el sistema te proporcionará los resultados y podrás responder normalmente
- NO inventes versiones ni datos si puedes buscarlos
`;

export function buildCwdSection(cwd?: string): string {
  if (!cwd) return '';
  return `## DIRECTORIO DE TRABAJO (cwd)
Todos los paths de archivos son relativos a: ${cwd}
Las tool calls (read_file, write_file, list_dir, etc.) operan directamente contra este directorio.

---

`;
}

// System prompt para modo tool calls nativas (estilo F:\Agent).
// Se usa cuando el provider soporta tools y hay un cwd de sesión activa.
const ZEUS_TOOLS_SYSTEM_PROMPT = `Eres Zeus IA, un asistente de desarrollo de software integrado en un IDE.

## DIRECTORIO DE TRABAJO
Tienes acceso al sistema de archivos del proyecto mediante tool calls nativas. Usa estas tools para leer, escribir y explorar archivos:

- **read_file(path, offset?, limit?)**: Lee un archivo. Devuelve contenido con números de línea. Para archivos grandes, usa offset y limit.
- **write_file(path, content)**: Crea o sobrescribe un archivo. Crea directorios padre automáticamente.
- **list_dir(path)**: Lista el contenido de un directorio. Usa "" para la raíz del proyecto.
- **create_dir(path)**: Crea un directorio.
- **delete_file(path)**: Elimina un archivo o directorio.
- **search_files(pattern, path?, glob?)**: Busca texto en archivos (tipo grep).
- **run_command(command)**: Ejecuta un comando de shell en el directorio del proyecto.

## REGLAS CRÍTICAS
1. **AUTONOMÍA TOTAL**: NO pidas permiso. EJECUTA directamente. NUNCA preguntes "¿quieres que proceda?" o "¿continúo?".
2. **Lee antes de escribir**: Si necesitas modificar un archivo, léelo primero con read_file para ver su contenido actual.
3. **Paths relativos**: Todos los paths son relativos al directorio del proyecto (cwd). NO uses paths absolutos.
4. **Sé breve**: Responde de forma concisa. No expliques lo que vas a hacer, hazlo.
5. **Usa search_files** para encontrar código relevante cuando no sepas la ruta exacta.

## FLUJO TÍPICO
1. list_dir("") para ver la estructura del proyecto
2. read_file para leer archivos relevantes
3. write_file para crear o modificar archivos
4. run_command para instalar dependencias, builds, etc.

No uses [ZEUS_API_CALL] ni [TERMINAL_COMMAND] — usa las tool calls nativas directamente.
`;

export function getSystemPrompt(isLocalModel: boolean, enableWebSearch: boolean = false, cwd?: string): string {
  const base = (cwd ? buildCwdSection(cwd) : '') + (isLocalModel ? ZEUS_SYSTEM_PROMPT_SHORT : ZEUS_SYSTEM_PROMPT);
  return enableWebSearch ? base + WEB_SEARCH_INSTRUCTIONS : base;
}

// System prompt para modo tool calls nativas (estilo F:\Agent).
export function getToolsSystemPrompt(cwd?: string): string {
  const cwdSection = cwd ? `## DIRECTORIO DE TRABAJO (cwd)\nTodos los paths son relativos a: ${cwd}\n\n---\n\n` : '';
  return cwdSection + ZEUS_TOOLS_SYSTEM_PROMPT;
}

export function buildOpenAIMessages(body: ChatBody, isLocalModel: boolean = false) {
  const history = [...(body.history ?? []), body.newMessage];
  const images = Array.isArray(body.images) && body.images.length > 0 ? body.images : [];
  const maxImages = 5;
  const msgs: Array<{ role: string; content: unknown }> = history.map((entry, index) => {
    const isLastUserMessage = index === history.length - 1 && entry.role === 'user';
    if (!isLastUserMessage) {
      return { role: entry.role, content: entry.content };
    }

    const finalContent = typeof entry.content === 'string' && body.hiddenContext
      ? entry.content + '\n\n' + body.hiddenContext
      : entry.content;

    if (images.length === 0) {
      return { role: 'user' as const, content: finalContent };
    }

    const content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [
      { type: 'text' as const, text: String(finalContent) }
    ];
    for (let i = 0; i < Math.min(images.length, maxImages); i++) {
      const url = images[i];
      if (typeof url === 'string' && url.startsWith('data:')) {
        content.push({ type: 'image_url' as const, image_url: { url } });
      }
    }
    return { role: 'user' as const, content };
  });

  const systemContext = body.systemContext || getSystemPrompt(isLocalModel, body.webSearch ?? false, body.cwd);
  if (systemContext) {
    msgs.unshift({ role: 'system', content: systemContext });
  }
  return msgs;
}

export async function callOpenAI(body: ChatBody, apiKey?: string, apiUrl: string = OPENAI_URL, isLocalModel: boolean = false) {
  if (!apiKey) {
    throw new Error('OpenAI API key missing');
  }

  const messages = buildOpenAIMessages(body, isLocalModel);

  const payload: Record<string, any> = {
    model: body.model,
    messages
  };
  if (typeof body.temperature === 'number') payload.temperature = body.temperature;
  if (typeof body.maxTokens === 'number') payload.max_tokens = body.maxTokens;
  if (typeof body.topP === 'number') payload.top_p = body.topP;
  if (typeof body.frequencyPenalty === 'number') payload.frequency_penalty = body.frequencyPenalty;
  if (typeof body.presencePenalty === 'number') payload.presence_penalty = body.presencePenalty;

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI error: ${error}`);
  }

  const responseText = await response.text();
  let data: any;
  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error(`Invalid JSON response from OpenAI: ${responseText.substring(0, 200)}...`);
  }

  const answer = Array.isArray(data.choices)
    ? data.choices[0]?.message?.content ?? 'Sin respuesta'
    : data.output?.[0]?.content?.[0]?.text ?? 'Sin respuesta';
  return answer;
}

export async function callDeepseek(body: ChatBody, apiKey?: string, apiUrl: string = DEEPSEEK_URL) {
  if (!apiKey) {
    throw new Error('Deepseek API key missing');
  }

  const messages: Array<{ role: string; content: string }> = [...(body.history ?? [])].map((entry) => ({
    role: entry.role,
    content: entry.content,
  }));

  messages.push({
    role: body.newMessage.role,
    content: body.newMessage.content + (body.hiddenContext ? '\n\n' + body.hiddenContext : '')
  });

  const systemContext = body.systemContext || getSystemPrompt(false, body.webSearch ?? false);
  if (systemContext) {
    messages.unshift({ role: 'system', content: systemContext });
  }

  const payload: Record<string, any> = {
    model: body.model,
    messages
  };
  if (typeof body.temperature === 'number') payload.temperature = body.temperature;
  if (typeof body.maxTokens === 'number') payload.max_tokens = body.maxTokens;
  if (typeof body.topP === 'number') payload.top_p = body.topP;
  if (typeof body.frequencyPenalty === 'number') payload.frequency_penalty = body.frequencyPenalty;
  if (typeof body.presencePenalty === 'number') payload.presence_penalty = body.presencePenalty;

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Deepseek error: ${error}`);
  }

  const data: any = await response.json();
  const answer = data.outputText ?? data.reply ?? data.choices?.[0]?.message?.content ?? 'Sin respuesta';
  return answer;
}

export async function callOllama(body: ChatBody, apiUrl: string = 'http://localhost:11434/api/chat') {
  const messages: Array<{ role: string; content: string }> = [...(body.history ?? [])].map((entry) => ({
    role: entry.role,
    content: entry.content,
  }));

  messages.push({
    role: body.newMessage.role,
    content: body.newMessage.content + (body.hiddenContext ? '\n\n' + body.hiddenContext : '')
  });

  const systemContext = body.systemContext || getSystemPrompt(false, body.webSearch ?? false);
  if (systemContext) {
    messages.unshift({ role: 'system', content: systemContext });
  }

  const options: Record<string, any> = {};
  if (typeof body.temperature === 'number') options.temperature = body.temperature;
  if (typeof body.maxTokens === 'number') options.num_predict = body.maxTokens;
  if (typeof body.topP === 'number') options.top_p = body.topP;
  if (typeof body.frequencyPenalty === 'number') options.repeat_penalty = body.frequencyPenalty;
  if (typeof body.presencePenalty === 'number') options.presence_penalty = body.presencePenalty;

  const payload: Record<string, any> = {
    model: body.model,
    messages,
    stream: false,
    ...(Object.keys(options).length > 0 ? { options } : {})
  };

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Ollama error: ${error}`);
  }

  const data: any = await response.json();
  const answer = data.message?.content ?? 'Sin respuesta';
  return answer;
}

function buildOllamaGeneratePrompt(body: ChatBody): string {
  const systemContext = body.systemContext || getSystemPrompt(false, body.webSearch ?? false);
  const messages: Array<{ role: string; content: string }> = [...(body.history ?? [])].map((entry) => ({
    role: entry.role,
    content: entry.content,
  }));

  messages.push({
    role: body.newMessage.role,
    content: body.newMessage.content + (body.hiddenContext ? '\n\n' + body.hiddenContext : '')
  });

  const parts: string[] = [];
  if (systemContext) {
    parts.push(`### System:\n${systemContext}`);
  }
  for (const msg of messages) {
    const roleLabel = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : msg.role;
    parts.push(`### ${roleLabel}:\n${msg.content}`);
  }
  parts.push('### Assistant:\n');
  return parts.join('\n\n');
}

export async function callOllamaCloud(body: ChatBody, apiUrl: string = 'https://ollama.com/api/chat', apiKey?: string) {
  const messages = buildOllamaChatMessages(body);

  const payload: Record<string, any> = {
    model: body.model,
    messages,
    stream: false,
  };

  const options = buildOllamaOptions(body);
  if (Object.keys(options).length > 0) payload.options = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Ollama Cloud error: ${error}`);
  }

  const data: any = await response.json();
  // /api/chat devuelve la respuesta en data.message.content
  const answer = data.message?.content ?? (typeof data.response === 'string' ? data.response : 'Sin respuesta');
  return answer;
}

export async function callLMStudio(body: ChatBody, apiUrl: string = 'http://localhost:1234/v1/chat/completions', isLocalModel: boolean = true) {
  const newMessage = typeof body.newMessage === 'string'
    ? { role: 'user', content: body.newMessage }
    : body.newMessage;

  const safeNewMessage = {
    ...newMessage,
    role: (newMessage.role === 'user' || newMessage.role === 'assistant') ? newMessage.role : 'user',
    content: typeof newMessage.content === 'string' ? newMessage.content : String(newMessage.content),
  };

  const lastMessageContent = safeNewMessage.content + (body.hiddenContext ? '\n\n' + body.hiddenContext : '');

  let messages: Array<{ role: string; content: string }> = [
    ...(body.history ?? []).map((entry) => ({
      role: entry.role,
      content: typeof entry.content === 'string' ? entry.content : String(entry.content),
    })),
    {
      role: safeNewMessage.role,
      content: lastMessageContent,
    }
  ];

  const systemContext = body.systemContext || getSystemPrompt(isLocalModel, body.webSearch ?? false);
  if (systemContext) {
    messages.unshift({ role: 'system', content: systemContext });
  }

  const systemMessage = messages.length > 0 && messages[0].role === 'system' ? messages.shift() : null;

  const MAX_CONTEXT_TOKENS = 3500;
  let totalTokens = 0;

  if (systemMessage) {
    totalTokens += Math.ceil(String(systemMessage.content).length / 4);
  }

  const truncatedMessages: Array<{ role: string; content: string }> = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const msgTokens = Math.ceil(msg.content.length / 4);

    if (totalTokens + msgTokens <= MAX_CONTEXT_TOKENS) {
      truncatedMessages.unshift(msg);
      totalTokens += msgTokens;
    } else {
      break;
    }
  }

  while (truncatedMessages.length > 0 && truncatedMessages[0].role !== 'user') {
    const removed = truncatedMessages.shift();
    if (removed) {
      totalTokens -= Math.ceil(removed.content.length / 4);
    }
  }

  if (truncatedMessages.length === 0) {
    truncatedMessages.push({ role: 'user', content: lastMessageContent });
    totalTokens += Math.ceil(lastMessageContent.length / 4);
  }

  if (systemMessage) {
    truncatedMessages.unshift(systemMessage as any);
  }

  messages = truncatedMessages;

  const payload: Record<string, any> = {
    model: body.model,
    messages,
    temperature: typeof body.temperature === 'number' ? body.temperature : 0.7,
    max_tokens: typeof body.maxTokens === 'number' ? body.maxTokens : 1024,
    stream: false
  };
  if (typeof body.topP === 'number') payload.top_p = body.topP;
  if (typeof body.frequencyPenalty === 'number') payload.frequency_penalty = body.frequencyPenalty;
  if (typeof body.presencePenalty === 'number') payload.presence_penalty = body.presencePenalty;

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`LM Studio error: ${error}`);
  }

  const lmData: any = await response.json();
  const answer = lmData.choices?.[0]?.message?.content ?? 'Sin respuesta';
  return answer;
}

export async function performWebSearch(query: string): Promise<string | null> {
  if (!TAVILY_API_KEY) {
    console.warn('⚠️ TAVILY_API_KEY no configurada. No se puede realizar búsqueda web.');
    return null;
  }

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TAVILY_API_KEY}`
      },
      body: JSON.stringify({
        query,
        search_depth: 'basic',
        include_answer: true,
        max_results: 5,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('❌ Tavily API error:', errText);
      return null;
    }

    const data: any = await res.json();
    const answer = data.answer || '';
    const results = (data.results || []) as Array<{ title: string; url: string; content: string }>;

    if (!answer && results.length === 0) return null;

    let context = `## Información actualizada de internet sobre la consulta del usuario\n\n`;
    if (answer) {
      context += `Resumen: ${answer}\n\n`;
    }
    if (results.length > 0) {
      context += `Fuentes:\n`;
      results.forEach((r, i) => {
        context += `${i + 1}. ${r.title} - ${r.url}\n${r.content?.substring(0, 300) || ''}\n\n`;
      });
    }
    context += `---\n\n`;
    return context;
  } catch (error) {
    console.error('❌ Error en búsqueda web:', error);
    return null;
  }
}

const WEB_SEARCH_PATTERN = /\[WEB_SEARCH\]([\s\S]*?)\[\/WEB_SEARCH\]/i;

export async function handleWebSearchLoop(
  body: ChatBody,
  initialText: string,
  apiKey: string | undefined,
  apiUrl: string | undefined,
  modelId: string
): Promise<string> {
  let currentText = initialText;
  let iterations = 0;
  const MAX_SEARCH_ITERATIONS = 3;

  while (iterations < MAX_SEARCH_ITERATIONS) {
    const match = currentText.match(WEB_SEARCH_PATTERN);
    if (!match) break;

    const searchQuery = match[1].trim();
    console.log(`🔍 Búsqueda web detectada en respuesta del modelo (iteración ${iterations + 1}): "${searchQuery}"`);

    const searchContext = await performWebSearch(searchQuery);
    if (!searchContext) {
      console.warn('⚠️ La búsqueda web no devolvió resultados');
      break;
    }

    const searchMessage: ChatMessage = {
      role: 'user',
      content: `Resultados de búsqueda web para: "${searchQuery}"\n\n${searchContext}`,
    };

    const assistantMessage: ChatMessage = { role: 'assistant', content: currentText };
    const updatedHistory = [...(body.history ?? []), body.newMessage, assistantMessage, searchMessage];
    const bodyForSecondCall: ChatBody = {
      ...body,
      model: modelId,
      history: updatedHistory,
      newMessage: searchMessage,
      hiddenContext: undefined,
      webSearch: false,
    };

    let secondText: string;
    try {
      if (body.provider === 'OpenAI') {
        secondText = await callOpenAI(bodyForSecondCall, apiKey, apiUrl);
      } else if (body.provider === 'Deepseek') {
        secondText = await callDeepseek(bodyForSecondCall, apiKey, apiUrl);
      } else if (body.provider === 'Ollama') {
        secondText = await callOllama(bodyForSecondCall, apiUrl ?? 'http://localhost:11434/api/chat');
      } else if (body.provider === 'Ollama Cloud') {
        secondText = await callOllamaCloud(bodyForSecondCall, apiUrl ?? 'https://ollama.com/api/generate', apiKey);
      } else if (body.provider === 'LM Studio') {
        secondText = await callLMStudio(bodyForSecondCall, apiUrl ?? 'http://localhost:1234/v1/chat/completions', true);
      } else {
        throw new Error('Proveedor no soportado');
      }
    } catch (err: any) {
      console.error('❌ Error en segunda llamada de IA:', err.message);
      return currentText;
    }

    currentText = secondText;
    iterations++;
  }

  return currentText;
}

// ============================================
// Plan / Model Service
// ============================================

export type PlanModelConfig = {
  provider?: string;
  model?: string;
  url?: string;
  apiKey?: string;
};

export type ExplorerNode = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: ExplorerNode[];
};

export type PlanAction = {
  type: 'create_file' | 'update_file' | 'create_folder';
  path: string;
  purpose?: string;
  language?: 'tsx' | 'ts' | 'js';
  routeKind?: 'page' | 'route' | 'layout' | 'api' | 'component' | 'file';
  content?: string;
  replacements?: Array<{ old: string; new: string }>;
  markers?: Array<{ start: string; end: string; newContent: string; includeMarkers?: boolean }>;
};

export type RouteKind = 'page' | 'route' | 'layout' | 'api' | 'component' | 'file';

function safeParseJSON(input: string): any {
  try {
    return JSON.parse(input);
  } catch {
    const trimmed = input.trim();
    const match = trimmed.match(/```json([\s\S]*?)```/i);
    if (match) {
      try { return JSON.parse(match[1]); } catch { /* ignore */ }
    }
    return {};
  }
}

function toPascalCase(str: string): string {
  return str
    .replace(/[-_]+/g, ' ')
    .replace(/(?:^\w|[A-Z]|\b\w)/g, (word) => word.toUpperCase())
    .replace(/\s+/g, '');
}

export function buildPlannerPrompt(args: {
  description: string;
  explorer?: ExplorerNode[] | Record<string, any>;
  structure?: any;
  hints?: { path?: string; type?: RouteKind };
  fileSamples?: Array<{ path: string; contentSample: string }>;
  autonomy?: 'guided' | 'semi' | 'full';
  protectedPaths?: string[];
  allowedExtensions?: string[];
  uiLibrary?: string;
  deliverables?: 'plan' | 'plan_and_skeletons';
  activeFile?: { path: string; content: string };
  contextFiles?: Array<{ path: string; content: string }>;
}): string {
  const { description, explorer, structure, hints, fileSamples = [], autonomy, protectedPaths = [], allowedExtensions = [], uiLibrary, deliverables, activeFile, contextFiles = [] } = args;

  const explorerStr = (() => {
    try {
      if (!explorer) return '[]';
      if (Array.isArray(explorer)) {
        const paths: string[] = [];
        const traverse = (nodes: any[]) => {
          for (const node of nodes) {
            if (node.path) paths.push(`${node.type === 'folder' ? '[DIR] ' : ''}${node.path.replace(/\\/g, '/')}`);
            if (node.children && Array.isArray(node.children)) traverse(node.children);
          }
        };
        traverse(explorer);
        if (paths.length > 1500) {
          return paths.slice(0, 1500).join('\n') + `\n... (truncado, total: ${paths.length} archivos)`;
        }
        return paths.join('\n');
      }
      return JSON.stringify(explorer, null, 2);
    } catch {
      return '[]';
    }
  })();

  const instructions = `Eres un experto Ingeniero de Software Senior y Arquitecto Frontend especializado en Next.js, React y TypeScript.
Tu objetivo es planificar y generar cambios de código de ALTA CALIDAD, siguiendo las mejores prácticas de la industria.

REGLAS DE GENERACIÓN:
- Genera componentes MODERNOS, COMPLETOS y VISUALMENTE ATRACTIVOS.
- Utiliza hooks (useState, useEffect, useMemo, etc.), estados complejos y handlers de eventos cuando sea necesario.
- Si el proyecto usa Lucide React para iconos o Framer Motion para animaciones, empléalos para mejorar la UI/UX.
- Respeta la arquitectura existente pero no temas proponer mejoras estructurales si benefician la mantenibilidad.
- IMPORTANTE: Cuando se solicita "plan_and_skeletons", incluye el contenido REAL y COMPLETO en los archivos creados. NO generes placeholders o comentarios "TODO" si puedes escribir la lógica funcional.
- REGLA DE ORO PARA REEMPLAZOS: Si necesitas usar "update_file", asegúrate de que el texto en "old" coincida EXACTAMENTE con el contenido mostrado en "ARCHIVO ACTIVO" o "ARCHIVOS DE CONTEXTO". Si el archivo no está en esos bloques, NO inventes los reemplazos; en su lugar, usa el campo "content" para proporcionar el archivo completo si crees que es necesario, o pide contexto adicional.

ESTRUCTURA DE RESPUESTA:
Debes devolver exclusivamente un JSON con la forma:
{
  "actions": [
    {"type": "create_folder", "path": "relative/posix/path", "purpose": "..."},
    {"type": "create_file", "path": "relative/posix/path.tsx", "purpose": "...", "routeKind": "page|route|layout|api|component|file", "language": "tsx|ts|js", "content": "contenido completo del archivo"},
    {"type": "update_file", "path": "relative/posix/path.tsx", "purpose": "...",
      "replacements": [{ "old": "texto exacto a reemplazar", "new": "texto nuevo" }],
      "markers": [{ "start": "// @zeus:begin X", "end": "// @zeus:end X", "newContent": "...", "includeMarkers": false }],
      "content": "(fallback) contenido completo a escribir si los replacements son demasiado complejos"
    }
  ]
}

REGLAS PARA PATHS:
- Usa siempre separadores '/'.
- Rutas relativas al root del proyecto.
- Verifica si el archivo YA existe en la lista "Estructura actual del proyecto" antes de usar "create_file".
- Si ya existe, usa "update_file".

RESTRICCIONES:
- NO propongas acciones en rutas protegidas (${protectedPaths.join(', ') || 'ninguna'}).
- Extensiones permitidas: ${allowedExtensions.join(', ') || 'cualquiera'}.
- Preferencias: autonomy=${autonomy ?? 'guided'}, uiLibrary=${uiLibrary ?? 'default'}, deliverables=${deliverables ?? 'plan'}.
`;

  const context = {
    description,
    hints: hints ? JSON.stringify(hints) : '(no se proporcionó hint path)',
    structure: JSON.stringify(structure, null, 2),
    explorer: explorerStr,
    fileSamples: fileSamples?.slice(0, 8) || [],
    autonomy: autonomy ?? 'guided',
    protectedPaths,
    allowedExtensions,
    uiLibrary: uiLibrary ?? null,
    deliverables: deliverables ?? 'plan',
  };

  const prompt = `${instructions}
DESCRIPCIÓN DEL OBJETIVO (LO QUE EL USUARIO QUIERE):
${context.description}

HINTS TÉCNICOS:
${context.hints}

ARQUITECTURA DEL PROYECTO:
${context.structure}

ESTRUCTURA ACTUAL DE ARCHIVOS (ÚSALO PARA SABER QUÉ EXISTE):
${context.explorer}

${contextFiles.length > 0 ? `=== ARCHIVOS DE CONTEXTO ADICIONALES (MENCIONADOS POR EL USUARIO) ===
${contextFiles.map(f => `Ruta: ${f.path}\n--- CONTENIDO ---\n${f.content.length > 20000 ? f.content.substring(0, 20000) + '\n... (truncado)' : f.content}\n--- FIN ---`).join('\n\n')}

IMPORTANTE: Usa este contenido para entender cómo integrar los nuevos cambios.` : ''}

${activeFile && activeFile.path && activeFile.content
    ? `=== ARCHIVO EN EL QUE EL USUARIO ESTÁ TRABAJANDO (ACTIVO) ===
Ruta: ${activeFile.path.replace(/\\/g, '/').replace(/^\/+/, '')}

--- CONTENIDO ACTUAL ---
${activeFile.content.length > 50000
      ? activeFile.content.substring(0, 50000) + '\n\n... (contenido truncado)'
      : activeFile.content}
--- FIN CONTENIDO ---

IMPORTANTE: Para "update_file" en este archivo, los campos "old" deben coincidir EXACTAMENTE con el contenido mostrado arriba.`
    : ''}

PREFERENCIAS DE ESTILO:
${JSON.stringify({
      autonomy: context.autonomy,
      uiLibrary: context.uiLibrary,
      deliverables: context.deliverables,
    }, null, 2)}`;

  return prompt;
}

export async function generatePlanWithModel(args: {
  description: string;
  explorer?: ExplorerNode[] | Record<string, any>;
  structure?: any;
  hints?: { path?: string; type?: RouteKind };
  fileSamples?: Array<{ path: string; contentSample: string }>;
  model?: PlanModelConfig;
  modelId?: string;
  userId?: string;
  autonomy?: 'guided' | 'semi' | 'full';
  protectedPaths?: string[];
  allowedExtensions?: string[];
  uiLibrary?: string;
  deliverables?: 'plan' | 'plan_and_skeletons';
  activeFile?: { path: string; content: string };
  contextFiles?: Array<{ path: string; content: string }>;
}): Promise<PlanAction[]> {
  const { description, explorer, structure, hints, fileSamples, model, modelId, userId, autonomy, protectedPaths, allowedExtensions, uiLibrary, deliverables, activeFile, contextFiles } = args;

  const provider = (model?.provider ?? 'openai').toLowerCase();
  let modelName = model?.model ?? (provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini');
  const defaultUrl =
    provider === 'deepseek'
      ? 'https://api.deepseek.com/chat/completions'
      : process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions';
  const apiUrl = (model?.url && String(model.url).trim()) || defaultUrl;
  const apiKey =
    model?.apiKey ||
    process.env.OPENAI_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.API_KEY_DEEPSEEK ||
    '';

  console.log('[generatePlanWithModel] Provider:', provider, 'Model:', modelName, 'API URL:', apiUrl);

  if (!apiKey && !apiUrl.includes('localhost') && !apiUrl.includes('127.0.0.1')) {
    console.log('[generatePlanWithModel] No API key found for remote URL, returning empty actions');
    return [];
  }

  const unsupportedModels: string[] = [];
  if (unsupportedModels.includes(modelName)) {
    modelName = 'deepseek-chat';
  }

  const prompt = buildPlannerPrompt({ description, explorer, structure, hints, fileSamples, autonomy, protectedPaths, allowedExtensions, uiLibrary, deliverables, activeFile, contextFiles });

  try {
    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Eres un planificador de cambios de código para proyectos Next.js. Respondes exclusivamente en JSON válido.' },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      console.error('[generatePlanWithModel] API error response:', errorText);
      return [];
    }

    const data: any = await resp.json();
    const content = data?.choices?.[0]?.message?.content ?? '{}';
    const parsed = safeParseJSON(content);
    const rawActions: any[] = Array.isArray(parsed?.actions) ? parsed.actions : [];

    return rawActions;
  } catch (err) {
    console.error('[generatePlanWithModel] Error calling API:', err);
    return [];
  }
}

function sanitizeAction(a: any): PlanAction | null {
  if (!a || typeof a !== 'object') return null;
  const type = a.type as PlanAction['type'];
  let path = String(a.path ?? '').replace(/\\/g, '/');
  if (!type || !path) return null;

  const routeKind = (a.routeKind as RouteKind) ?? undefined;
  const language = (a.language as 'tsx' | 'ts' | 'js') ?? 'tsx';

  const result: PlanAction = {
    type,
    path,
    purpose: a.purpose ?? undefined,
    language,
    routeKind,
    content: typeof a.content === 'string' && a.content.length > 0 ? a.content : undefined,
  };

  if (Array.isArray(a?.replacements)) {
    result.replacements = a.replacements
      .filter((r: any) => r && typeof r.old === 'string' && typeof r.new === 'string')
      .map((r: any) => ({ old: r.old, new: r.new }))
      .filter((r: any) => r.old.trim().length > 0);
  }
  if (Array.isArray(a?.markers)) {
    result.markers = a.markers
      .filter((m: any) => m && typeof m.start === 'string' && typeof m.end === 'string' && typeof m.newContent === 'string')
      .map((m: any) => ({ start: m.start, end: m.end, newContent: m.newContent, includeMarkers: !!m.includeMarkers }));
  }
  return result;
}

// ============================================
// Unified entrypoint
// ============================================

export async function callModel(body: ChatBody, apiKey?: string, apiUrl?: string): Promise<string> {
  const bodyForProvider = { ...body };

  if (body.provider === 'OpenAI') {
    return await callOpenAI(bodyForProvider, apiKey, apiUrl);
  } else if (body.provider === 'Deepseek') {
    return await callDeepseek(bodyForProvider, apiKey, apiUrl);
  } else if (body.provider === 'Ollama') {
    return await callOllama(bodyForProvider, apiUrl ?? 'http://localhost:11434/api/chat');
  } else if (body.provider === 'Ollama Cloud') {
    return await callOllamaCloud(bodyForProvider, apiUrl ?? 'https://ollama.com/api/generate', apiKey);
  } else if (body.provider === 'LM Studio') {
    return await callLMStudio(bodyForProvider, apiUrl ?? 'http://localhost:1234/v1/chat/completions', true);
  } else {
    throw new Error('Proveedor no soportado');
  }
}

function buildOllamaChatMessages(body: ChatBody): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [...(body.history ?? [])].map((entry) => ({
    role: entry.role,
    content: entry.content,
  }));

  messages.push({
    role: body.newMessage.role,
    content: body.newMessage.content + (body.hiddenContext ? '\n\n' + body.hiddenContext : ''),
  });

  const systemContext = body.systemContext || getSystemPrompt(false, body.webSearch ?? false);
  if (systemContext) {
    messages.unshift({ role: 'system', content: systemContext });
  }

  return messages;
}

function buildOllamaOptions(body: ChatBody): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  if (typeof body.temperature === 'number') options.temperature = body.temperature;
  if (typeof body.maxTokens === 'number') options.num_predict = body.maxTokens;
  if (typeof body.topP === 'number') options.top_p = body.topP;
  if (typeof body.frequencyPenalty === 'number') options.repeat_penalty = body.frequencyPenalty;
  if (typeof body.presencePenalty === 'number') options.presence_penalty = body.presencePenalty;
  return options;
}

function buildOpenAICompatiblePayload(body: ChatBody, isLocalModel: boolean, stream: boolean): Record<string, unknown> {
  const messages = body.provider === 'OpenAI'
    ? buildOpenAIMessages(body, isLocalModel)
    : (() => {
        const historyMessages: Array<{ role: string; content: string }> = [...(body.history ?? [])].map((entry) => ({
          role: entry.role,
          content: entry.content,
        }));
        historyMessages.push({
          role: body.newMessage.role,
          content: body.newMessage.content + (body.hiddenContext ? '\n\n' + body.hiddenContext : ''),
        });
        const systemContext = body.systemContext || getSystemPrompt(isLocalModel, body.webSearch ?? false);
        if (systemContext) {
          historyMessages.unshift({ role: 'system', content: systemContext });
        }
        return historyMessages;
      })();

  const payload: Record<string, unknown> = {
    model: body.model,
    messages,
    stream,
  };
  if (typeof body.temperature === 'number') payload.temperature = body.temperature;
  if (typeof body.maxTokens === 'number') payload.max_tokens = body.maxTokens;
  if (typeof body.topP === 'number') payload.top_p = body.topP;
  if (typeof body.frequencyPenalty === 'number') payload.frequency_penalty = body.frequencyPenalty;
  if (typeof body.presencePenalty === 'number') payload.presence_penalty = body.presencePenalty;
  return payload;
}

async function fetchProviderStream(body: ChatBody, apiKey?: string, apiUrl?: string): Promise<Response> {
  const provider = body.provider;

  if (provider === 'Ollama') {
    const options = buildOllamaOptions(body);
    return fetch(apiUrl ?? 'http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: body.model,
        messages: buildOllamaChatMessages(body),
        stream: true,
        ...(Object.keys(options).length > 0 ? { options } : {}),
      }),
    });
  }

  if (provider === 'Ollama Cloud') {
    const prompt = buildOllamaGeneratePrompt(body);
    const payload: Record<string, unknown> = {
      model: body.model,
      prompt,
      stream: true,
    };
    if (typeof body.temperature === 'number') payload.temperature = body.temperature;
    if (typeof body.maxTokens === 'number') payload.num_predict = body.maxTokens;
    if (typeof body.topP === 'number') payload.top_p = body.topP;
    if (typeof body.frequencyPenalty === 'number') payload.repeat_penalty = body.frequencyPenalty;
    if (typeof body.presencePenalty === 'number') payload.presence_penalty = body.presencePenalty;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    return fetch(apiUrl ?? 'https://ollama.com/api/generate', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  }

  const isLocalModel = provider === 'LM Studio';
  const resolvedUrl = apiUrl ?? (
    provider === 'OpenAI'
      ? 'https://api.openai.com/v1/chat/completions'
      : provider === 'Deepseek'
        ? DEEPSEEK_URL
        : 'http://localhost:1234/v1/chat/completions'
  );
  const payload = buildOpenAICompatiblePayload(body, isLocalModel, true);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (provider !== 'LM Studio' && apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return fetch(resolvedUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
}

function extractProviderStreamChunk(
  provider: string | undefined,
  line: string
): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  if (provider === 'Ollama Cloud' || provider === 'Ollama') {
    try {
      const chunk = JSON.parse(trimmed);
      if (provider === 'Ollama Cloud' && typeof chunk.response === 'string') {
        return chunk.response;
      }
      if (provider === 'Ollama' && typeof chunk.message?.content === 'string') {
        return chunk.message.content;
      }
    } catch {
      return null;
    }
    return null;
  }

  if (trimmed === 'data: [DONE]') return null;
  if (!trimmed.startsWith('data: ')) return null;
  try {
    const chunk = JSON.parse(trimmed.slice(6));
    const content = chunk.choices?.[0]?.delta?.content;
    return typeof content === 'string' ? content : null;
  } catch {
    return null;
  }
}

export function createModelSSEStream(
  body: ChatBody,
  apiKey?: string,
  apiUrl?: string,
  meta?: { conversationId?: string; onComplete?: (fullText: string) => Promise<void> }
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const provider = body.provider;

  return new ReadableStream({
    async start(controller) {
      let fullText = '';

      const enqueueSSE = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      try {
        const providerRes = await fetchProviderStream(body, apiKey, apiUrl);
        if (!providerRes.ok || !providerRes.body) {
          const errText = await providerRes.text().catch(() => '');
          throw new Error(errText || `Provider error ${providerRes.status}`);
        }

        const reader = providerRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const content = extractProviderStreamChunk(provider, line);
            if (content) {
              fullText += content;
              enqueueSSE({ content });
            }
          }
        }

        if (meta?.onComplete) {
          await meta.onComplete(fullText);
        }
        if (meta?.conversationId) {
          enqueueSSE({ conversationId: meta.conversationId });
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      } catch (error: any) {
        const message = error?.message || 'Error de streaming';
        enqueueSSE({ error: message });
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    },
  });
}

export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
};