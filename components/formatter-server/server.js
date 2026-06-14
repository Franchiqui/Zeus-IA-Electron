const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Función para formatear código como editor profesional
function formatCodeAsEditor(code, isJSON = false) {
    if (isJSON) {
        try {
            const parsed = JSON.parse(code);
            return JSON.stringify(parsed, null, 2);
        } catch (e) {
            // Si falla el parseo JSON, usar formato general
        }
    }
    
    // Detectar si es HTML (minificado o con saltos de línea)
    if (code.includes('<') && code.includes('>')) {
        // Si no tiene saltos de línea o es código HTML complejo, usar formateador HTML
        if (!code.includes('\n') || (code.includes('<html') && code.includes('</html>'))) {
            return formatHTML(code);
        }
    }
    
    // Formateo general para código no JSON
    let lines = code.split('\n');
    let formattedLines = [];
    let indentLevel = 0;
    let inString = false;
    let stringChar = '';
    
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        let trimmedLine = line.trim();
        
        if (!trimmedLine) {
            formattedLines.push('');
            continue;
        }
        
        // Manejar strings multilínea
        if (!inString && (trimmedLine.startsWith('"') || trimmedLine.startsWith("'") || trimmedLine.startsWith('`'))) {
            inString = true;
            stringChar = trimmedLine[0];
        } else if (inString && trimmedLine.endsWith(stringChar)) {
            inString = false;
        }
        
        // Si estamos en un string, mantener la línea como está
        if (inString) {
            formattedLines.push(line);
            continue;
        }
        
        // Ajustar indentación basado en el contenido
        if (trimmedLine.startsWith('}') || trimmedLine.startsWith(']') || trimmedLine.startsWith(')')) {
            indentLevel = Math.max(0, indentLevel - 1);
        }
        
        // Añadir la línea con indentación actual
        formattedLines.push('  '.repeat(indentLevel) + trimmedLine);
        
        // Aumentar indentación para la próxima línea
        if (trimmedLine.endsWith('{') || 
            trimmedLine.endsWith('[') || 
            trimmedLine.endsWith('(') ||
            trimmedLine.match(/^(if|for|while|function|class|try|catch|finally|switch|case).*\{$/)) {
            indentLevel++;
        }
    }
    
    return formattedLines.join('\n');
}

// Función específica para formatear HTML con estructura vertical como editor
function formatHTML(html) {
    let result = '';
    let indentLevel = 0;
    let pos = 0;
    
    while (pos < html.length) {
        // Encontrar la siguiente etiqueta
        const nextTagStart = html.indexOf('<', pos);
        
        if (nextTagStart === -1) {
            // No hay más etiquetas, añadir el resto del texto
            const remainingText = html.substring(pos).trim();
            if (remainingText) {
                result += '  '.repeat(indentLevel) + remainingText + '\n';
            }
            break;
        }
        
        // Añadir texto antes de la etiqueta
        if (nextTagStart > pos) {
            const textBefore = html.substring(pos, nextTagStart).trim();
            if (textBefore) {
                result += '  '.repeat(indentLevel) + textBefore + '\n';
            }
        }
        
        // Encontrar el fin de la etiqueta
        const tagEnd = html.indexOf('>', nextTagStart);
        if (tagEnd === -1) break;
        
        const tag = html.substring(nextTagStart, tagEnd + 1);
        
        // Procesar la etiqueta
        if (tag.startsWith('</')) {
            // Etiqueta de cierre
            indentLevel = Math.max(0, indentLevel - 1);
            result += '  '.repeat(indentLevel) + tag + '\n';
        } else if (tag.startsWith('<!')) {
            // DOCTYPE o comentario
            result += '  '.repeat(indentLevel) + tag + '\n';
        } else {
            // Etiqueta de apertura
            result += '  '.repeat(indentLevel) + tag + '\n';
            
            // Verificar si es auto-cerrada
            const selfClosing = tag.endsWith('/>') || 
                tag.match(/<(img|br|hr|input|meta|link|area|base|col|embed|param|source|track|wbr)\s/i);
            
            if (!selfClosing) {
                indentLevel++;
            }
        }
        
        pos = tagEnd + 1;
    }
    
    return result.trim();
}

// Función para detectar tipo de código
function detectCodeType(code) {
    const trimmed = code.trim();
    
    // Detectar JSON
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
            JSON.parse(trimmed);
            return 'json';
        } catch (e) {
            // No es JSON válido
        }
    }
    
    // Detectar HTML
    if (trimmed.includes('<') && trimmed.includes('>')) {
        return 'html';
    }
    
    // Detectar JavaScript
    if (trimmed.includes('function') || trimmed.includes('const') || trimmed.includes('let') || 
        trimmed.includes('var') || trimmed.includes('=>') || trimmed.includes('class ')) {
        return 'javascript';
    }
    
    return 'text';
}

// Endpoint principal para formatear código
app.post('/api/format', (req, res) => {
    try {
        const { escapedCode } = req.body;
        
        if (!escapedCode) {
            return res.status(400).json({ 
                error: 'Se requiere el código escapado' 
            });
        }

        // Decodificar secuencias de escape comunes
        let decodedCode = escapedCode
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t')
            .replace(/\\"/g, '"')
            .replace(/\\'/g, "'")
            .replace(/\\\\/g, '\\')
            .replace(/\\r/g, '\r')
            .replace(/\\b/g, '\b')
            .replace(/\\f/g, '\f');

        // Detectar tipo de código
        const codeType = detectCodeType(decodedCode);
        
        // Intentar parsear como JSON si es posible
        let isValidJSON = false;
        let parsedJSON = null;
        let formattedCode = decodedCode;
        
        try {
            parsedJSON = JSON.parse(decodedCode);
            isValidJSON = true;
            formattedCode = formatCodeAsEditor(decodedCode, true);
        } catch (e) {
            // Si no es JSON, aplicar formato general
            formattedCode = formatCodeAsEditor(decodedCode, false);
        }

        res.json({
            success: true,
            originalCode: escapedCode,
            decodedCode: decodedCode,
            formattedCode: formattedCode,
            codeType: codeType,
            isValidJSON: isValidJSON,
            parsedJSON: parsedJSON,
            metadata: {
                lines: formattedCode.split('\n').length,
                characters: formattedCode.length,
                hasEscapes: escapedCode !== decodedCode
            }
        });

    } catch (error) {
        res.status(500).json({ 
            error: 'Error al procesar el código', 
            details: error.message 
        });
    }
});

// Endpoint para validar JSON
app.post('/api/validate-json', (req, res) => {
    try {
        const { jsonString } = req.body;
        
        if (!jsonString) {
            return res.status(400).json({ 
                error: 'Se requiere el string JSON' 
            });
        }

        try {
            const parsed = JSON.parse(jsonString);
            res.json({
                valid: true,
                parsed: parsed,
                formatted: JSON.stringify(parsed, null, 2)
            });
        } catch (error) {
            res.json({
                valid: false,
                error: error.message,
                line: getErrorLine(error.message)
            });
        }
    } catch (error) {
        res.status(500).json({ 
            error: 'Error al validar JSON', 
            details: error.message 
        });
    }
});

// Endpoint para reconstruir código malformateado
app.post('/api/reconstruct', (req, res) => {
    try {
        const { malformedCode } = req.body;
        
        if (!malformedCode) {
            return res.status(400).json({ 
                error: 'Se requiere el código malformateado' 
            });
        }

        // Función para reconstruir código malformateado
        function reconstructMalformedHTML(input) {
            let reconstructed = '';
            let lines = input.split('\n');
            let indentLevel = 1; // Empezar después de <body>
            let inSVG = false;
            let svgAttributes = [];
            
            reconstructed += '<!DOCTYPE html>\n<html lang="es">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>Código Reconstruido</title>\n</head>\n<body>\n';
            
            for (let i = 0; i < lines.length; i++) {
                let line = lines[i].trim();
                if (!line) continue;
                
                // Patrón para detectar clases CSS
                const classMatch = line.match(/^class="([^"]+)"/);
                // Patrón para detectar atributos SVG
                const svgMatch = line.match(/^(width|height|viewBox|fill|stroke|stroke-width|stroke-linecap|stroke-linejoin|d|cx|cy|r|x|y|points|polyline|path)="([^"]*)"/);
                // Patrón para detectar contenido de texto
                const textPattern = /^[a-zA-ZáéíóúñÁÉÍÓÚÑ\s]+$/;
                const isText = textPattern.test(line) && !line.includes('=');
                
                if (classMatch) {
                    // Es una clase CSS, crear un div
                    if (inSVG && svgAttributes.length > 0) {
                        // Cerrar el SVG anterior si había uno abierto
                        reconstructed += '  '.repeat(indentLevel) + '<svg';
                        svgAttributes.forEach(attr => reconstructed += ` ${attr}`);
                        reconstructed += '>\n';
                        indentLevel++;
                        inSVG = false;
                        svgAttributes = [];
                    }
                    
                    reconstructed += '  '.repeat(indentLevel) + `<div ${line}>\n`;
                    indentLevel++;
                } else if (svgMatch) {
                    // Es un atributo SVG, acumularlo
                    svgAttributes.push(line);
                    inSVG = true;
                } else if (isText) {
                    // Es texto contenido
                    if (inSVG && svgAttributes.length > 0) {
                        // Crear el SVG con los atributos acumulados
                        reconstructed += '  '.repeat(indentLevel) + '<svg';
                        svgAttributes.forEach(attr => reconstructed += ` ${attr}`);
                        reconstructed += '>\n';
                        indentLevel++;
                        inSVG = false;
                        svgAttributes = [];
                    }
                    
                    reconstructed += '  '.repeat(indentLevel) + `<span>${line}</span>\n`;
                } else if (line.includes('>')) {
                    // Podría ser el final de un atributo SVG
                    if (inSVG && svgAttributes.length > 0) {
                        // Crear elemento SVG
                        reconstructed += '  '.repeat(indentLevel) + '<svg';
                        svgAttributes.forEach(attr => reconstructed += ` ${attr}`);
                        reconstructed += '>\n';
                        indentLevel++;
                        inSVG = false;
                        svgAttributes = [];
                    }
                }
                
                // Revisar si la próxima línea indica que debemos cerrar algo
                if (i < lines.length - 1) {
                    const nextLine = lines[i + 1].trim();
                    const nextClassMatch = nextLine.match(/^class="([^"]+)"/);
                    
                    if (nextClassMatch && indentLevel > 1) {
                        // La próxima línea es una nueva clase, cerrar el div actual
                        indentLevel--;
                        reconstructed += '  '.repeat(indentLevel) + `</div>\n`;
                    }
                }
            }
            
            // Cerrar SVG si quedó abierto
            if (inSVG && svgAttributes.length > 0) {
                reconstructed += '  '.repeat(indentLevel) + '<svg';
                svgAttributes.forEach(attr => reconstructed += ` ${attr}`);
                reconstructed += '>\n';
                indentLevel++;
            }
            
            // Cerrar todos los divs abiertos
            while (indentLevel > 1) {
                indentLevel--;
                reconstructed += '  '.repeat(indentLevel) + `</div>\n`;
            }
            
            reconstructed += '</body>\n</html>';
            
            return reconstructed;
        }

        const reconstructedHTML = reconstructMalformedHTML(malformedCode);
        
        res.json({
            success: true,
            originalCode: malformedCode,
            reconstructedHTML: reconstructedHTML,
            originalLength: malformedCode.length,
            reconstructedLength: reconstructedHTML.length
        });

    } catch (error) {
        res.status(500).json({ 
            error: 'Error al reconstruir el código', 
            details: error.message 
        });
    }
});

// Función auxiliar para obtener la línea del error
function getErrorLine(errorMessage) {
    const match = errorMessage.match(/line (\d+)/i);
    return match ? parseInt(match[1]) : null;
}

// Servir archivos estáticos
app.use(express.static(__dirname));

module.exports = app;
