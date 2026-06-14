const fs = require('fs');
const path = require('path');

/**
 * Procesa un objeto de cambio de código y aplica los reemplazos a los archivos.
 * @param {object} codeChangeObject - El objeto JSON de tipo "code_change" recibido del modelo.
 */
async function applyCodeChanges(codeChangeObject, projectRoot, projectId) {
    if (!codeChangeObject || codeChangeObject.type !== 'code_change' || !codeChangeObject.changes) {
        console.error('Objeto de cambio de código inválido o incompleto.');
        return;
    }

    console.log('Aplicando cambios de código...');

    for (const change of codeChangeObject.changes) {
        const fileToProcess = change.file;
        let filePath;

        // Check if fileToProcess is already an absolute path
        if (path.isAbsolute(fileToProcess)) {
            filePath = fileToProcess;
        } else {
            filePath = path.join(projectRoot, fileToProcess);
        }
        const replacements = change.replacements;

        if (!filePath || !replacements || !Array.isArray(replacements)) {
            console.warn(`Cambio inválido detectado, saltando: ${JSON.stringify(change)}`);
            continue;
        }

        console.log(`Procesando archivo: ${filePath}`);

        try {
            let fileContent = '';
            let fileExists = true;
            try {
                fileContent = fs.readFileSync(filePath, 'utf8');
            } catch (readErr) {
                if (readErr && readErr.code === 'ENOENT') {
                    fileExists = false;
                } else {
                    throw readErr;
                }
            }

            const hasFullNewFromChange = typeof change.newFullContent === 'string' && change.newFullContent.length >= 0;
            const fullNewFromReplacementObj = Array.isArray(replacements) ? replacements.find(r => r && r.fullNewContent === true && typeof r.new === 'string') : null;
            const hasFullNewFromReplacement = !!fullNewFromReplacementObj;
            
            // Detectar si hay un replacement con old vacío (señal de creación de archivo)
            const emptyOldReplacement = Array.isArray(replacements) ? replacements.find(r => r && (!r.old || r.old === '') && typeof r.new === 'string') : null;
            
            const fullNewContent = hasFullNewFromChange ? change.newFullContent : (hasFullNewFromReplacement ? fullNewFromReplacementObj.new : (emptyOldReplacement ? emptyOldReplacement.new : undefined));

            // Si el archivo no existe y contamos con contenido completo nuevo, créalo directamente
            if (!fileExists) {
                if (typeof fullNewContent === 'string') {
                    ensureDirSync(path.dirname(filePath));
                    const processedNew = postProcessFile(filePath, fullNewContent);
                    fs.writeFileSync(filePath, processedNew, 'utf8');
                    console.log(`Archivo creado exitosamente: ${filePath}`);
                    continue;
                } else {
                    console.warn(`  - El archivo no existe y no se proporcionó contenido para crear, se omite: ${filePath}`);
                    continue;
                }
            }

            let contentModified = false;

            for (const replacement of replacements) {
                let oldString = replacement.old;
                let newString = replacement.new;

                if (typeof newString !== 'string') {
                    console.warn(`Reemplazo inválido (new no es string), se omite: ${JSON.stringify(replacement)}`);
                    continue;
                }

                // Si old está vacío, ya se manejó la creación antes del loop, saltar
                if (!oldString || oldString === '') {
                    console.log(`  - Replacement con old vacío ya procesado en creación de archivo`);
                    continue;
                }

                // Normalizar saltos de línea: convertir \n literales a saltos de línea reales
                // Esto es necesario porque el JSON puede tener \n como string literal
                if (typeof oldString === 'string') {
                    // Reemplazar secuencias \n literales por saltos de línea reales
                    oldString = oldString.replace(/\\n/g, '\n');
                    // También manejar \r\n
                    oldString = oldString.replace(/\\r\\n/g, '\r\n');
                    // Y \r solo
                    oldString = oldString.replace(/\\r/g, '\r');
                    // Normalizar tabs
                    oldString = oldString.replace(/\\t/g, '\t');
                }
                if (typeof newString === 'string') {
                    // Normalizar también newString para consistencia
                    newString = newString.replace(/\\n/g, '\n');
                    newString = newString.replace(/\\r\\n/g, '\r\n');
                    newString = newString.replace(/\\r/g, '\r');
                    newString = newString.replace(/\\t/g, '\t');
                }

                // 1) Coincidencia exacta literal (comportamiento actual)
                if (typeof oldString === 'string' && fileContent.includes(oldString)) {
                    fileContent = fileContent.replace(oldString, newString);
                    contentModified = true;
                    console.log(`  - Reemplazado (exacto) "${String(oldString).substring(0, 30).replace(/\n/g, '\\n')}..."`);
                    continue;
                } else if (typeof oldString === 'string') {
                    // Debug: mostrar por qué no coincidió
                    const oldLines = oldString.split('\n').length;
                    const oldFirstLine = oldString.split('\n')[0];
                    console.log(`  - DEBUG: Coincidencia exacta falló. oldString tiene ${oldLines} líneas, primera línea: "${oldFirstLine.substring(0, 60)}"`);
                    // Buscar si al menos la primera línea existe
                    if (fileContent.includes(oldFirstLine.trim())) {
                        console.log(`  - DEBUG: Primera línea encontrada en archivo, pero el bloque completo no coincide`);
                    }
                }

                // 2) Soporte explícito de regex si se indica
                const hasExplicitRegex = typeof replacement.oldRegex === 'string' || replacement.useRegex === true;
                if (hasExplicitRegex) {
                    try {
                        // oldString ya está normalizado arriba, usarlo directamente
                        const pattern = typeof replacement.oldRegex === 'string' ? replacement.oldRegex : String(oldString ?? '');
                        if (!pattern) throw new Error('Patrón vacío');
                        const addGlobal = replacement.global === true ? 'g' : '';
                        const userFlags = typeof replacement.flags === 'string' ? replacement.flags : '';
                        const flagsSet = new Set((userFlags + 's' + addGlobal).split(''));
                        const flags = Array.from(flagsSet).join('');
                        const rx = new RegExp(pattern, flags);
                        const before = fileContent;
                        fileContent = fileContent.replace(rx, newString);
                        if (fileContent !== before) {
                            contentModified = true;
                            console.log(`  - Reemplazado (regex:${flags}) /${pattern}/`);
                            continue;
                        } else {
                            console.warn(`  - Regex no hizo match: /${pattern}/${flags}`);
                        }
                    } catch (e) {
                        console.warn(`  - Regex inválido u error aplicando: ${e?.message || e}`);
                    }
                }

                // 3) Modo tolerante: construir un regex relajado a partir del literal
                if (typeof oldString === 'string' && oldString.length > 0) {
                    const relaxed = buildRelaxedRegexFromLiteral(oldString);
                    const addGlobal = replacement?.global === true ? 'g' : '';
                    const flags = 's' + addGlobal; // dotAll + opcional global
                    try {
                        const rx = new RegExp(relaxed, flags);
                        const before = fileContent;
                        fileContent = fileContent.replace(rx, newString);
                        if (fileContent !== before) {
                            contentModified = true;
                            console.log('  - Reemplazado (relajado, ignora espacios/saltos)');
                            continue;
                        } else {
                            // Debug: verificar si el patrón regex tiene algún match
                            const testMatch = fileContent.match(rx);
                            if (!testMatch) {
                                console.log(`  - DEBUG: Regex relajado no encontró match. Patrón: ${relaxed.substring(0, 100)}...`);
                            }
                        }
                    } catch (e) {
                        console.warn(`  - Error en regex relajado: ${e?.message || e}`);
                    }
                }
                
                // 3.5) Estrategia adicional: buscar por líneas clave si es un bloque de imports
                if (typeof oldString === 'string' && oldString.includes('import ') && !contentModified) {
                    // Normalizar comillas y espacios para comparación flexible
                    const normalizeForComparison = (str) => {
                        return str
                            .trim()
                            .replace(/['"]/g, '"') // Normalizar todas las comillas a dobles
                            .replace(/\s+/g, ' ') // Normalizar espacios múltiples
                            .toLowerCase();
                    };
                    
                    // Si es una sola línea de import, buscar y reemplazar de manera flexible
                    const oldLines = oldString.split('\n').filter(line => line.trim() !== '');
                    if (oldLines.length === 1 && oldLines[0].trim().startsWith('import ')) {
                        const oldImportLine = oldLines[0].trim();
                        const normalizedOld = normalizeForComparison(oldImportLine);
                        
                        // Buscar la línea en el archivo con matching flexible
                        const fileLines = fileContent.split('\n');
                        let foundLineIndex = -1;
                        
                        for (let i = 0; i < fileLines.length; i++) {
                            const fileLine = fileLines[i].trim();
                            if (fileLine.startsWith('import ')) {
                                const normalizedFile = normalizeForComparison(fileLine);
                                // Comparar normalizado (sin importar comillas o espacios)
                                if (normalizedFile === normalizedOld) {
                                    foundLineIndex = i;
                                    break;
                                }
                            }
                        }
                        
                        if (foundLineIndex !== -1) {
                            // Reemplazar la línea encontrada
                            const newImportLines = newString.split('\n').filter(line => line.trim() !== '');
                            fileLines[foundLineIndex] = newImportLines[0];
                            // Si hay más líneas en newString, insertarlas después
                            if (newImportLines.length > 1) {
                                fileLines.splice(foundLineIndex + 1, 0, ...newImportLines.slice(1));
                            }
                            fileContent = fileLines.join('\n');
                            contentModified = true;
                            console.log(`  - Reemplazado (matching flexible de import, línea ${foundLineIndex + 1})`);
                            continue;
                        } else {
                            console.log(`  - DEBUG: Línea de import no encontrada con matching flexible. Buscando: "${normalizedOld}"`);
                        }
                    }
                    
                    // Extraer las líneas de import del oldString (para bloques múltiples)
                    const oldImportLines = oldString.split('\n').filter(line => line.trim().startsWith('import '));
                    if (oldImportLines.length > 0) {
                        // Buscar si todas las líneas de import existen en el archivo (en cualquier orden)
                        const allImportsFound = oldImportLines.every(importLine => {
                            const normalizedImport = normalizeForComparison(importLine);
                            // Buscar la línea de import en el archivo (puede tener espacios diferentes o comillas diferentes)
                            return fileContent.split('\n').some(fileLine => {
                                const normalizedFile = normalizeForComparison(fileLine);
                                return normalizedFile === normalizedImport;
                            });
                        });
                        
                        if (allImportsFound) {
                            // Si todas las líneas de import existen, intentar un reemplazo más inteligente
                            // Buscar el bloque de imports en el archivo y reemplazarlo
                            const lines = fileContent.split('\n');
                            let importStartIdx = -1;
                            let importEndIdx = -1;
                            
                            // Encontrar dónde empiezan y terminan los imports
                            for (let i = 0; i < lines.length; i++) {
                                if (lines[i].trim().startsWith('import ')) {
                                    if (importStartIdx === -1) importStartIdx = i;
                                    importEndIdx = i;
                                } else if (importStartIdx !== -1 && lines[i].trim() !== '' && !lines[i].trim().startsWith('//')) {
                                    // Si encontramos una línea no vacía que no es import ni comentario, terminamos
                                    break;
                                }
                            }
                            
                            if (importStartIdx !== -1 && importEndIdx !== -1) {
                                // Construir el bloque de imports nuevo
                                const newImportLines = newString.split('\n').filter(line => line.trim() !== '');
                                const beforeImports = lines.slice(0, importStartIdx).join('\n');
                                const afterImports = lines.slice(importEndIdx + 1).join('\n');
                                fileContent = beforeImports + (beforeImports ? '\n' : '') + newImportLines.join('\n') + (afterImports ? '\n' : '') + afterImports;
                                contentModified = true;
                                console.log('  - Reemplazado (estrategia de imports, reordenamiento inteligente)');
                                continue;
                            }
                        }
                    }
                }

                // 3.6) Estrategia para archivos completos o bloques muy grandes
                // Si oldString es muy grande (más de 20 líneas), puede ser un reemplazo de archivo completo
                if (typeof oldString === 'string' && oldString.length > 500 && !contentModified) {
                    const oldLines = oldString.split('\n').length;
                    console.log(`  - DEBUG: oldString es muy grande (${oldLines} líneas, ${oldString.length} caracteres). Intentando estrategia de archivo completo...`);
                    
                    // Función auxiliar para normalizar (similar a normalizeForComparison pero más simple)
                    const normalizeSimple = (str) => {
                        if (!str) return '';
                        return str
                            .trim()
                            .replace(/['"]/g, '"')
                            .replace(/\s+/g, ' ')
                            .toLowerCase();
                    };
                    
                    // Si oldString comienza con "use client" o similar, puede ser un archivo completo
                    const startsWithDirective = oldString.trim().match(/^["']use\s+(client|server)["'];?/i);
                    if (startsWithDirective) {
                        // Verificar si el archivo también comienza con la misma directiva
                        const fileStartsWithDirective = fileContent.trim().match(/^["']use\s+(client|server)["'];?/i);
                        if (fileStartsWithDirective) {
                            // Comparar las primeras líneas para verificar que es el mismo archivo
                            const oldFirstLines = oldString.split('\n').slice(0, 5).join('\n');
                            const fileFirstLines = fileContent.split('\n').slice(0, 5).join('\n');
                            
                            // Normalizar para comparación
                            if (normalizeSimple(oldFirstLines) === normalizeSimple(fileFirstLines)) {
                                // Es el mismo archivo, reemplazar todo el contenido
                                fileContent = newString;
                                contentModified = true;
                                console.log('  - Reemplazado (archivo completo, matching por directiva inicial)');
                                continue;
                            } else {
                                console.log(`  - DEBUG: Primeras líneas no coinciden. Old: "${oldFirstLines.substring(0, 50)}..." File: "${fileFirstLines.substring(0, 50)}..."`);
                            }
                        }
                    }
                    
                    // Estrategia alternativa: buscar por líneas clave al inicio y al final
                    const oldFirstLine = oldString.split('\n')[0].trim();
                    const oldLastLine = oldString.split('\n').filter(l => l.trim()).slice(-1)[0]?.trim();
                    
                    if (oldFirstLine && oldLastLine) {
                        const fileLines = fileContent.split('\n');
                        const fileFirstLineIdx = fileLines.findIndex(l => {
                            return normalizeSimple(l) === normalizeSimple(oldFirstLine);
                        });
                        
                        const fileLastLineIdx = fileLines.findIndex((l, idx) => {
                            if (fileFirstLineIdx === -1 || idx <= fileFirstLineIdx) return false;
                            return normalizeSimple(l) === normalizeSimple(oldLastLine);
                        });
                        
                        if (fileFirstLineIdx !== -1 && fileLastLineIdx !== -1 && fileLastLineIdx > fileFirstLineIdx) {
                            // Encontramos el bloque, reemplazarlo
                            const before = fileLines.slice(0, fileFirstLineIdx).join('\n');
                            const after = fileLines.slice(fileLastLineIdx + 1).join('\n');
                            const newLines = newString.split('\n');
                            fileContent = before + (before ? '\n' : '') + newLines.join('\n') + (after ? '\n' : '') + after;
                            contentModified = true;
                            console.log(`  - Reemplazado (bloque grande, matching por líneas clave: ${fileFirstLineIdx + 1}-${fileLastLineIdx + 1})`);
                            continue;
                        } else {
                            console.log(`  - DEBUG: No se encontraron líneas clave. FirstLineIdx: ${fileFirstLineIdx}, LastLineIdx: ${fileLastLineIdx}`);
                        }
                    }
                }

                // 4) Estrategia adicional: buscar por líneas clave para bloques JSX que comienzan con "return ("
                if (typeof oldString === 'string' && oldString.trim().startsWith('return (') && !contentModified) {
                    // Normalizar espacios y saltos de línea para comparación
                    const normalizeForMatching = (str) => {
                        return str
                            .replace(/\s+/g, ' ') // Normalizar espacios múltiples a uno
                            .replace(/\n\s*/g, ' ') // Normalizar saltos de línea a espacios
                            .trim();
                    };
                    
                    const normalizedOld = normalizeForMatching(oldString);
                    const fileLines = fileContent.split('\n');
                    
                    // Buscar la línea que contiene "return ("
                    let returnLineIdx = -1;
                    for (let i = 0; i < fileLines.length; i++) {
                        if (fileLines[i].trim().startsWith('return (')) {
                            returnLineIdx = i;
                            break;
                        }
                    }
                    
                    if (returnLineIdx !== -1) {
                        // Intentar encontrar el bloque completo desde "return (" hasta el cierre correspondiente
                        let braceCount = 0;
                        let foundOpening = false;
                        let endIdx = returnLineIdx;
                        
                        for (let i = returnLineIdx; i < fileLines.length; i++) {
                            const line = fileLines[i];
                            for (const char of line) {
                                if (char === '(') {
                                    braceCount++;
                                    foundOpening = true;
                                } else if (char === ')') {
                                    braceCount--;
                                    if (foundOpening && braceCount === 0) {
                                        endIdx = i;
                                        break;
                                    }
                                }
                            }
                            if (foundOpening && braceCount === 0) break;
                        }
                        
                        if (foundOpening && braceCount === 0) {
                            // Encontramos el bloque, reemplazarlo
                            const before = fileLines.slice(0, returnLineIdx).join('\n');
                            const after = fileLines.slice(endIdx + 1).join('\n');
                            const newLines = newString.split('\n');
                            fileContent = before + (before ? '\n' : '') + newLines.join('\n') + (after ? '\n' : '') + after;
                            contentModified = true;
                            console.log(`  - Reemplazado (bloque JSX return, líneas ${returnLineIdx + 1}-${endIdx + 1})`);
                            continue;
                        }
                    }
                }
                
                // 5) Sin coincidencias - intentar estrategia para errores de parsing JSX
                console.warn(`  - No se encontró coincidencia (exacta/regex/relajada) para: "${String(oldString).substring(0, 50)}..."`);
                
                // 6) Estrategia específica para errores de parsing JSX (elemento sin etiqueta de cierre)
                // Si newCode contiene una etiqueta de cierre que no está en oldCode, podría ser un error de parsing
                const jsxClosingTagMatch = newString.match(/<\/(\w+)>/);
                if (jsxClosingTagMatch && !contentModified) {
                    const closingTag = jsxClosingTagMatch[1];
                    const fullClosingTag = `</${closingTag}>`;
                    
                    // Verificar si el archivo tiene la etiqueta de apertura pero no la de cierre
                    const openingTagRegex = new RegExp(`<${closingTag}(?:\\s|>|className|id|on[A-Z]|key)`, 'i');
                    const hasOpening = openingTagRegex.test(fileContent);
                    const hasClosing = new RegExp(`</${closingTag}>`, 'i').test(fileContent);
                    
                    if (hasOpening && !hasClosing && newString.includes(fullClosingTag)) {
                        console.log(`  - Detectado posible error de parsing JSX: falta etiqueta de cierre ${fullClosingTag}`);
                        
                        // Buscar dónde insertar la etiqueta de cierre
                        const lines = fileContent.split('\n');
                        let insertionPoint = -1;
                        let openingTagLine = -1;
                        
                        // Primero, encontrar dónde está la etiqueta de apertura
                        for (let i = 0; i < lines.length; i++) {
                            if (openingTagRegex.test(lines[i]) && !lines[i].includes(fullClosingTag) && !lines[i].trim().endsWith('/>')) {
                                openingTagLine = i;
                                break;
                            }
                        }
                        
                        // Si encontramos la línea de apertura, buscar el punto de inserción relativo a ella
                        if (openingTagLine !== -1) {
                            // Buscar después del último </style> pero después de la línea de apertura
                            for (let i = Math.max(openingTagLine, lines.length - 50); i < lines.length; i++) {
                                if (lines[i].includes('`}</style>') || lines[i].trim().endsWith('`}</style>')) {
                                    insertionPoint = i;
                                    break;
                                }
                            }
                            
                            // Si no encontramos </style>, buscar antes de export default pero después de la apertura
                            if (insertionPoint === -1) {
                                for (let i = openingTagLine + 1; i < lines.length; i++) {
                                    if (lines[i].includes('export default')) {
                                        insertionPoint = i;
                                        break;
                                    }
                                }
                            }
                        }
                        
                        // Fallback: Buscar después del último </style> sin importar dónde esté
                        if (insertionPoint === -1) {
                            for (let i = lines.length - 1; i >= 0; i--) {
                                if (lines[i].includes('`}</style>') || lines[i].trim().endsWith('`}</style>')) {
                                    insertionPoint = i;
                                    break;
                                }
                            }
                        }
                        
                        // Fallback: Buscar antes de export default
                        if (insertionPoint === -1) {
                            for (let i = 0; i < lines.length; i++) {
                                if (lines[i].includes('export default')) {
                                    insertionPoint = i;
                                    break;
                                }
                            }
                        }
                        
                        // Fallback: Buscar antes del último cierre de función/componente
                        if (insertionPoint === -1) {
                            let braceCount = 0;
                            let foundReturn = false;
                            for (let i = 0; i < lines.length; i++) {
                                if (lines[i].includes('return') && !lines[i].includes('//')) {
                                    foundReturn = true;
                                }
                                if (foundReturn) {
                                    braceCount += (lines[i].match(/{/g) || []).length;
                                    braceCount -= (lines[i].match(/}/g) || []).length;
                                    if (braceCount === 0 && lines[i].trim().includes('}')) {
                                        insertionPoint = i;
                                        break;
                                    }
                                }
                            }
                        }
                        
                        // Último fallback: Insertar antes de la última línea
                        if (insertionPoint === -1) {
                            insertionPoint = lines.length - 1;
                        }
                        
                        // Extraer la parte que falta del newCode
                        // Intentar encontrar todo lo que viene después de </style> en newCode
                        let missingPart = '';
                        const lastStyleInNew = newString.lastIndexOf('`}</style>');
                        if (lastStyleInNew !== -1) {
                            const afterStyle = newString.substring(lastStyleInNew + '`}</style>'.length).trim();
                            const closingIndex = afterStyle.indexOf(fullClosingTag);
                            if (closingIndex !== -1) {
                                missingPart = afterStyle.substring(closingIndex);
                            }
                        } else {
                            // Si no hay </style>, buscar directamente la etiqueta de cierre
                            const closingIndex = newString.indexOf(fullClosingTag);
                            if (closingIndex !== -1) {
                                missingPart = newString.substring(closingIndex);
                                // Limitar a solo la etiqueta y lo necesario
                                const exportIndex = missingPart.indexOf('export default');
                                if (exportIndex !== -1) {
                                    missingPart = missingPart.substring(0, exportIndex).trim();
                                }
                            }
                        }
                        
                        if (missingPart && missingPart.includes(fullClosingTag)) {
                            // Usar la indentación del elemento de apertura para el cierre
                            let closingIndent = '';
                            if (openingTagLine !== -1) {
                                closingIndent = (lines[openingTagLine].match(/^(\s*)/) || [''])[0];
                            } else {
                                // Fallback: usar la indentación de la línea de inserción
                                const insertionLine = lines[insertionPoint] || '';
                                closingIndent = (insertionLine.match(/^(\s*)/) || [''])[0];
                            }
                            
                            // Limpiar la parte faltante y aplicar indentación correcta
                            const cleanedMissingPart = missingPart.trim();
                            const indentedClosing = cleanedMissingPart.split('\n').map((line, idx) => {
                                if (idx === 0) {
                                    // Primera línea usa la indentación del elemento de apertura
                                    return closingIndent + line.trim();
                                }
                                // Las líneas siguientes mantienen su indentación relativa o usan la base
                                return line;
                            }).join('\n');
                            
                            // Insertar la parte faltante
                            const beforeInsertion = lines.slice(0, insertionPoint + 1).join('\n');
                            const afterInsertion = lines.slice(insertionPoint + 1).join('\n');
                            
                            // Si la línea de inserción es `}</style>`, la etiqueta de cierre debe ir después
                            // Si es export default, debe ir antes
                            const insertionLine = lines[insertionPoint] || '';
                            const isStyleLine = insertionLine.includes('</style>');
                            const isExportLine = insertionLine.includes('export default');
                            
                            let finalContent;
                            if (isStyleLine) {
                                // Insertar después de </style>
                                finalContent = beforeInsertion + '\n' + indentedClosing + (afterInsertion ? '\n' + afterInsertion : '');
                            } else if (isExportLine) {
                                // Insertar antes de export default
                                const beforeExport = lines.slice(0, insertionPoint).join('\n');
                                const exportLine = lines[insertionPoint];
                                finalContent = beforeExport + '\n' + indentedClosing + '\n' + exportLine + (lines.length > insertionPoint + 1 ? '\n' + lines.slice(insertionPoint + 1).join('\n') : '');
                            } else {
                                // Insertar en el punto encontrado
                                finalContent = beforeInsertion + '\n' + indentedClosing + (afterInsertion ? '\n' + afterInsertion : '');
                            }
                            
                            fileContent = finalContent;
                            contentModified = true;
                            console.log(`  - Insertada etiqueta de cierre JSX ${fullClosingTag} en línea ${insertionPoint + 1} (indentación: ${closingIndent.length} espacios)`);
                            continue; // Continuar con el siguiente replacement
                        }
                    }
                }
            }

            if (contentModified) {
                const processed = postProcessFile(filePath, fileContent);
                fs.writeFileSync(filePath, processed, 'utf8');
                console.log(`Archivo actualizado exitosamente: ${filePath}`);
            } else {
                // Si no hubo coincidencias, podemos sobrescribir todo el archivo si así se indicó
                const allowOverwrite = change.overwriteIfNoMatch === true
                    || (fullNewFromReplacementObj && fullNewFromReplacementObj.fallbackToOverwrite !== false);
                if (allowOverwrite && typeof fullNewContent === 'string') {
                    ensureDirSync(path.dirname(filePath));
                    const processedNew = postProcessFile(filePath, fullNewContent);
                    fs.writeFileSync(filePath, processedNew, 'utf8');
                    console.log(`Archivo sobrescrito (fallback sin match): ${filePath}`);
                } else {
                    // Heurísticas adicionales (solo si no hubo reemplazos previos):
                    // 1) Coma entre objetos adyacentes en arrays: '}' + nueva línea + '{' -> '},\n  {'
                    // 2) Coma entre item string y objeto siguiente: '"' + nueva línea + '{' -> '",\n  {'
                    // 3) Coma entre objeto y string siguiente: '}' + nueva línea + '"' -> '},\n  "'
                    // 4) Coma entre strings adyacentes: '"' + nueva línea + '"' -> '",\n  "'
                    try {
                        const beforeHeuristic = fileContent;
                        let changed = false;

                        const heuristics = [
                            {
                                rx: /}\s*\n\s*{/,
                                repl: '},\n  {',
                                note: 'añadida coma entre objetos adyacentes'
                            },
                            {
                                rx: /"\s*\n\s*{/,
                                repl: '",\n  {',
                                note: 'añadida coma entre string y objeto siguiente'
                            },
                            {
                                rx: /}\s*\n\s*"/,
                                repl: '},\n  "',
                                note: 'añadida coma entre objeto y string siguiente'
                            },
                            {
                                rx: /"\s*\n\s*"/,
                                repl: '",\n  "',
                                note: 'añadida coma entre strings adyacentes'
                            }
                        ];

                        for (const h of heuristics) {
                            if (h.rx.test(fileContent)) {
                                fileContent = fileContent.replace(h.rx, h.repl);
                                changed = true;
                                console.log('  - Heurística aplicada:', h.note);
                                break; // aplicar solo una heurística por pasada para minimizar riesgos
                            }
                        }

                        if (changed && fileContent !== beforeHeuristic) {
                            const processed = postProcessFile(filePath, fileContent);
                            ensureDirSync(path.dirname(filePath));
                            fs.writeFileSync(filePath, processed, 'utf8');
                            console.log(`Archivo actualizado exitosamente (heurística): ${filePath}`);
                        } else {
                            console.log(`No se realizaron cambios en el archivo: ${filePath}`);
                        }
                    } catch (e) {
                        console.warn('  - Error aplicando heurísticas automáticas:', e?.message || e);
                        console.log(`No se realizaron cambios en el archivo: ${filePath}`);
                    }
                }
            }

        } catch (error) {
            console.error(`Error al procesar el archivo ${filePath}:`, error.message);
        }
    }
}

// Ejemplo de uso
const exampleCodeChange = {
    "type": "code_change",
    "explanation": "Se cambió el título 'Alarma-2' por 'Recordatorios'",
    "changes": [
        {
            "file": "/ruta/completa/al/archivo/page.tsx",
            "replacements": [
                {
                    "old": "<title>Alarma-2 | Reminder App</title>",
                    "new": "<title>Recordatorios | Reminder App</title>"
                },
                {
                    "old": "<h1 className=\"text-3xl md:text-4xl font-bold mb-8 text-center\">\n  Alarma-2\n</h1>",
                    "new": "<h1 className=\"text-3xl md:text-4xl font-bold mb-8 text-center\">\n  Recordatorios\n</h1>"
                }
            ]
        }
    ]
};

// Para ejecutar: applyCodeChanges(exampleCodeChange);

// ---- Helpers: Normalización de 'use client' ----
function normalizeUseClient(content) {
    const BOM = '\uFEFF';
    let hasBOM = false;
    if (content.startsWith(BOM)) {
        hasBOM = true;
        content = content.slice(1);
    }
    const headerSlice = content.slice(0, 5000);
    const hadDirective = /["'` ]use client["'`];?/i.test(headerSlice) || /(^|\n)\s*["'`]use client["'`];?\s*(\n|$)/i.test(content);
    let cleaned = content.replace(/["'`]use client["'`];?/gi, '');
    cleaned = cleaned.replace(/^[\s;]+/, '');
    if (hadDirective) {
        const result = `'use client';\n\n${cleaned}`;
        return hasBOM ? BOM + result : result;
    }
    return hasBOM ? BOM + cleaned : cleaned;
}

function postProcessFile(relativePath, content) {
    const lower = (relativePath || '').toLowerCase();
    const isCode = lower.endsWith('.tsx') || lower.endsWith('.jsx') || lower.endsWith('.ts') || lower.endsWith('.js');
    if (!isCode) return content;
    return normalizeUseClient(content);
}

// ---- Helpers Regex ----
function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildRelaxedRegexFromLiteral(literal) {
    // Convierte un literal en un patrón regex que tolera:
    // - Diferencias de espacios (espacios, tabs, saltos) usando \s+
    // - Distintas indentaciones
    // - Mantiene el resto escapado
    const parts = String(literal)
        // normalizamos saltos de línea CRLF -> LF para el patrón
        .replace(/\r\n/g, '\n')
        // colapsamos cualquier tramo de espacios y saltos en un token
        .split(/\s+/);
    // Unimos permitiendo cualquier cantidad de espacio entre tokens
    const escapedTokens = parts.map(p => escapeRegExp(p));
    const pattern = escapedTokens.join('\\s+');
    return pattern;
}

module.exports = { applyCodeChanges };

// ---- FS Helpers ----
function ensureDirSync(dirPath) {
    try {
      fs.mkdirSync(dirPath, { recursive: true });
    } catch (e) {
      // Si ya existe o hay un error no crítico, lo ignoramos
    }
  }