const fs = require('fs');
const path = 'C:/Zeus-IA/app/api/structure-plan/generate/route.ts';
let content = fs.readFileSync(path, 'utf8');

// 1. Eliminar bloque generateProjectStructure
const startMarker = '          // Generar estructura completa del proyecto al inicio (antes de las etapas)';
const endMarker = '          // Generar las etapas una por una';
const startIdx = content.indexOf(startMarker);
const endIdx = content.indexOf(endMarker);
if (startIdx !== -1 && endIdx !== -1) {
  content = content.slice(0, startIdx) + '          // Generar las etapas una por una\n' + content.slice(endIdx + endMarker.length + 1);
}

// 2. Eliminar declaraciones que dependen de la estructura
content = content.replace(
  /const alreadyPlannedFiles = Array\.from\(plannedFileSet\);\n\s*const plannedFilesPreview = [\s\S]*?'Ninguno todavía';\n/,
  ''
);

// 3. Cambiar userPrompt - quitar referencias a estructura inicial
const oldUserBlock = `ESTRUCTURA INICIAL DEL PROYECTO (SOLO puedes usar estos archivos):
\${plannedFilesPreview.length > 0 ? plannedFilesPreview : 'No hay archivos definidos aún'}

REGLAS EXCLUSIVAS DE REPARTO DE ARCHIVOS:
- SOLO puedes asignar archivos que ya están definidos en la estructura inicial del proyecto
- NO inventes nuevos archivos ni rutas de archivos
- Distribuye los archivos existentes entre las etapas de forma equilibrada
- Cada archivo debe ser asignado a EXACTAMENTE una etapa
- No repitas archivos ni tareas ya cubiertas en etapas anteriores
- SIEMPRE incluye el campo "files" en el JSON, aunque sea un array vacío
- Si una etapa no necesita modificar archivos, deja el array de files vacío

CONTROL DE ARCHIVOS (OBLIGATORIO):
- Archivos disponibles en la estructura inicial: \${plannedFilesPreview.length > 0 ? plannedFilesPreview : 'Aún no definidos — usa tu criterio para proponer archivos clave de la etapa'}
- Archivos ya asignados a etapas anteriores: \${alreadyPlannedFiles.length > 0 ? alreadyPlannedFiles.join(', ') : 'Ninguno'}
- NO vuelvas a incluir en files un archivo que ya esté asignado.
- Solo incluye archivos NO asignados para esta etapa.

Por favor, genera solo esta etapa en formato JSON como se especifica en las instrucciones. NO INVENTES ARCHIVOS. SOLO usa archivos de la estructura inicial.`;

const newUserBlock = `REGLAS DE ARCHIVOS:
- Proporciona los archivos concretos que esta etapa debe crear o modificar.
- Puedes proponer nuevos archivos; asegúrate de que sean coherentes con el proyecto.
- No repitas archivos ni tareas ya cubiertas en etapas anteriores.
- SIEMPRE incluye el campo "files" en el JSON, aunque sea un array vacío.
- Si una etapa no necesita crear ni modificar archivos, deja el array de files vacío.

Por favor, genera solo esta etapa en formato JSON como se especifica en las instrucciones.`;

content = content.replace(oldUserBlock, newUserBlock);

// 4. Eliminar plannedFileSet filtering de archivos
const oldFilter = `            // Filtrar solo archivos nuevos (no asignados previamente)
            const rawFiles = Array.isArray(parsedStage.files) ? parsedStage.files : [];
            const uniqueFiles: string[] = [];

            rawFiles.forEach((file: any) => {
              if (typeof file !== 'string' || !file.trim()) return;

              const normalized = normalizeFilePath(file);
              if (plannedFileSet.has(normalized)) return;

              plannedFileSet.add(normalized);
              uniqueFiles.push(file.trim());
            });

            parsedStage.files = uniqueFiles;`;

const newFilter = `            // Asegurar que files sea un array de strings válidos
            const rawFiles = Array.isArray(parsedStage.files) ? parsedStage.files : [];
            const validFiles = rawFiles
              .filter((f: any) => typeof f === 'string' && f.trim())
              .map((f: string) => f.trim());

            parsedStage.files = validFiles;`;

content = content.replace(oldFilter, newFilter);

fs.writeFileSync(path, content, 'utf8');
console.log('Done');
