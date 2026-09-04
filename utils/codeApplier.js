'use strict';
//
// codeApplier.js — applies a "code_change" object (model output) to files.
//
// This used to chain a hand-rolled ladder of matching heuristics (exact,
// explicit regex, "relaxed" whitespace regex, flexible import matching,
// large-block first/last-line, `return (`-block, JSX closing-tag insertion)
// and plain `fs.writeFileSync`. It now uses the Hermes/Agent file-correction
// logic ported under utils/fileOps:
//
//   * each {old, new} replacement is applied with the 9-strategy fuzzy chain
//     (utils/fileOps/fuzzyMatch.js) — exact → line_trimmed → whitespace →
//     indent → escape → trimmed_boundary → unicode → block_anchor →
//     context_aware — with already-applied detection so a re-sent edit that
//     already landed is a success-shaped no-op;
//   * the file is persisted with safeWriteFile (atomic temp+rename, BOM + CRLF
//     preservation, fail-closed JSON/YAML/TOML syntax gate, sha256 verify,
//     lint-delta).
//
// Signature unchanged: applyCodeChanges(codeChangeObject, projectRoot, projectId).
// Kept: \n/\t literal→real normalization, postProcessFile/normalizeUseClient
// (BOM-aware), and the overwriteIfNoMatch/fallbackToOverwrite escape hatch.

const fs = require('fs');
const path = require('path');
const { fuzzyFindAndReplace, isAlreadyApplied, safeWriteFile } = require('./fileOps');

/**
 * Procesa un objeto de cambio de código y aplica los reemplazos a los archivos.
 * @param {object} codeChangeObject - El objeto JSON de tipo "code_change" recibido del modelo.
 * @param {string} projectRoot
 * @param {string} projectId
 */
async function applyCodeChanges(codeChangeObject, projectRoot, projectId) {
    if (!codeChangeObject || codeChangeObject.type !== 'code_change' || !codeChangeObject.changes) {
        console.error('Objeto de cambio de código inválido o incompleto.');
        return;
    }

    console.log('Aplicando cambios de código (fuzzy + safeWriteFile)...');

    for (const change of codeChangeObject.changes) {
        const fileToProcess = change.file;
        if (!fileToProcess) {
            console.warn(`Cambio sin campo "file", saltando: ${JSON.stringify(change).slice(0, 120)}`);
            continue;
        }

        let filePath;
        if (path.isAbsolute(fileToProcess)) {
            filePath = fileToProcess;
        } else {
            filePath = path.join(projectRoot, fileToProcess);
        }
        const replacements = change.replacements;

        if (!filePath || !replacements || !Array.isArray(replacements)) {
            console.warn(`Cambio inválido detectado, saltando: ${JSON.stringify(change).slice(0, 120)}`);
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

            // Resolve a full-new-content candidate (change.newFullContent, a
            // replacement flagged fullNewContent=true, or a replacement with an
            // empty old — the "create file" signal).
            const hasFullNewFromChange = typeof change.newFullContent === 'string';
            const fullNewFromReplacementObj = Array.isArray(replacements)
                ? replacements.find((r) => r && r.fullNewContent === true && typeof r.new === 'string')
                : null;
            const emptyOldReplacement = Array.isArray(replacements)
                ? replacements.find((r) => r && (!r.old || r.old === '') && typeof r.new === 'string')
                : null;
            const fullNewContent = hasFullNewFromChange
                ? change.newFullContent
                : (fullNewFromReplacementObj ? fullNewFromReplacementObj.new : (emptyOldReplacement ? emptyOldReplacement.new : undefined));

            // ── File creation ───────────────────────────────────────────
            if (!fileExists) {
                if (typeof fullNewContent === 'string') {
                    const processedNew = postProcessFile(filePath, fullNewContent);
                    const res = await safeWriteFile(filePath, processedNew);
                    if (res.success) {
                        console.log(`Archivo creado exitosamente: ${filePath}`);
                    } else {
                        console.error(`Error creando archivo ${filePath}: ${res.error}`);
                    }
                    continue;
                }
                console.warn(`  - El archivo no existe y no se proporcionó contenido para crear, se omite: ${filePath}`);
                continue;
            }

            // ── In-memory fuzzy replacements ────────────────────────────
            let contentModified = false;
            let appliedCount = 0;
            let alreadyAppliedCount = 0;
            let noMatchCount = 0;

            for (const replacement of replacements) {
                let oldString = replacement.old;
                let newString = replacement.new;

                if (typeof newString !== 'string') {
                    console.warn(`Reemplazo inválido (new no es string), se omite: ${JSON.stringify(replacement).slice(0, 120)}`);
                    continue;
                }

                // Empty old → already handled via create / fullNewContent above.
                if (!oldString || oldString === '') {
                    continue;
                }

                // Normalize literal \n / \r\n / \r / \t sequences the model may
                // have sent as two-character strings in JSON tool-call args.
                oldString = normalizeEscapeLiterals(oldString);
                newString = normalizeEscapeLiterals(newString);

                const result = fuzzyFindAndReplace(fileContent, oldString, newString, !!replacement.replace_all);
                if (result.matchCount > 0) {
                    fileContent = result.newContent;
                    contentModified = true;
                    appliedCount++;
                    console.log(`  - Reemplazado (fuzzy:${result.strategy}) "${preview(oldString)}"`);
                    continue;
                }

                // No fuzzy match — maybe the edit already landed.
                if (isAlreadyApplied(fileContent, oldString, newString)) {
                    alreadyAppliedCount++;
                    console.log(`  - Ya aplicado (no-op): "${preview(oldString)}"`);
                    continue;
                }

                noMatchCount++;
                console.warn(`  - Sin coincidencia fuzzy para: "${preview(oldString)}"${result.error ? ' — ' + result.error.split('\n')[0] : ''}`);
            }

            if (contentModified) {
                const processed = postProcessFile(filePath, fileContent);
                const res = await safeWriteFile(filePath, processed);
                if (res.success) {
                    console.log(`Archivo actualizado exitosamente: ${filePath} (${appliedCount} aplicados, ${alreadyAppliedCount} ya-aplicados, ${noMatchCount} sin coincidencia)`);
                } else {
                    console.error(`Error escribiendo archivo ${filePath}: ${res.error}`);
                }
                continue;
            }

            // No fuzzy replacement modified the file. Honor the explicit
            // overwrite escape hatch when the model requested it.
            const allowOverwrite = change.overwriteIfNoMatch === true
                || (fullNewFromReplacementObj && fullNewFromReplacementObj.fallbackToOverwrite !== false);
            if (allowOverwrite && typeof fullNewContent === 'string') {
                const processedNew = postProcessFile(filePath, fullNewContent);
                const res = await safeWriteFile(filePath, processedNew);
                if (res.success) {
                    console.log(`Archivo sobrescrito (fallback sin match): ${filePath}`);
                } else {
                    console.error(`Error sobrescribiendo archivo ${filePath}: ${res.error}`);
                }
                continue;
            }

            console.log(`No se realizaron cambios en el archivo: ${filePath}`);
        } catch (error) {
            console.error(`Error al procesar el archivo ${filePath}:`, error.message || error);
        }
    }
}

function preview(s) {
    return String(s).substring(0, 40).replace(/\n/g, '\\n');
}

/** Convert literal "\\n"/"\\r\\n"/"\\r"/"\\t" two-char sequences to real bytes. */
function normalizeEscapeLiterals(s) {
    if (typeof s !== 'string') return s;
    // Order matters: \r\n before \r and \n.
    return s
        .split('\\r\\n').join('\r\n')
        .split('\\r').join('\r')
        .split('\\n').join('\n')
        .split('\\t').join('\t');
}

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

module.exports = { applyCodeChanges };