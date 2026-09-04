'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { MessageCircle, X, Send, Paperclip, Volume2, Radio, VolumeX, Sparkles, Copy, Check, Square, Terminal, MessageSquarePlus, Trash2, Edit, CheckCircle, XCircle, Globe, Play, Settings, History, Maximize2, Minimize2, Brain, Mic } from 'lucide-react';
import pb from '@/lib/pocketbase';
import { useStore } from '@/lib/store';
import { motion, AnimatePresence } from 'framer-motion';
import { type ChatMessage, useChatContext } from '@/components/ChatContext';
import { ToolCallDisplay, type ToolLogEntry } from '@/components/chat/ToolCallDisplay';
import { cleanTextForTTS } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { useEditor, type CorrectionChange, type PendingCorrection } from '@/context/editor-context';
import { useTranslation } from '@/contexts/translation-context';
import { smartReplace } from '@/lib/smartReplace';
import ChatTerminalBubble from './ChatTerminalBubble';
import ChatCodeBubble from './ChatCodeBubble';
import { ApiConfigModal } from './ApiConfigModal';
import { MODELOS_COLLECTION_NAME } from '@/lib/collections';
import { getActiveSessionId, getActiveProjectId, useProjectStore, sessionFetch } from '@/lib/projectStore';

type ApiCallResult = { success: boolean; text: string; blobUrl?: string; mimeType?: string; mediaType?: 'image' | 'video' | 'audio' | 'gif' };
type MessageCodeBubble = { code: string; language: string; fileName: string; isVisible: boolean };

// Tamaño máximo (en caracteres) del contenido de un archivo que se devuelve
// INLINE al modelo al leerlo por la API. Por encima de este umbral no se
// trunca (eso perdería información): se devuelve metadata + instrucciones
// para que el modelo lea el archivo POR PARTES con /files/{name}/lines.
// 100 000 chars ≈ 25k tokens: cubre archivos normales sin saturar el contexto.
const MAX_INLINE_FILE_CONTENT_CHARS = 100_000;

function inferLanguageFromName(name: string): string {
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

// smartReplace moved to @/lib/smartReplace (shared utility)

function extractFileNameFromApiUrl(url: string): string {
  if (!url) return '';

  let pathname = url;
  try {
    pathname = new URL(url, 'http://localhost').pathname;
  } catch {
    pathname = url;
  }

  const match = pathname.match(/\/api\/files\/([^/]+)/);
  if (!match?.[1]) return '';

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

async function consumeChatSSEStream(
  response: Response,
  onChunk: (chunk: string) => void,
): Promise<{ text: string; conversationId?: string; error?: string }> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No se pudo leer el stream de respuesta');

  const decoder = new TextDecoder();
  let buffer = '';
  let accumulatedText = '';
  let conversationId: string | undefined;
  let streamError: string | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;

      try {
        const event = JSON.parse(payload);
        if (typeof event.content === 'string') {
          accumulatedText += event.content;
          onChunk(event.content);
        }
        if (typeof event.conversationId === 'string') {
          conversationId = event.conversationId;
        }
        if (typeof event.error === 'string') {
          streamError = event.error;
        }
      } catch {
        // Ignorar eventos de estado del pipeline u otras líneas malformadas
      }
    }
  }

  return { text: accumulatedText, conversationId, error: streamError };
}

function normalizeZeusApiMarkers(text: string): string {
  if (!text || typeof text !== 'string') return text;

  return text
    .replace(/\[\s*"?\\?\/ZEUS_API_CALL"?\s*\]/g, '[/ZEUS_API_CALL]')
    .replace(/\["\/?ZEUS_API_CALL\]/g, '[/ZEUS_API_CALL]')
    .replace(/\[\\\/ZEUS_API_CALL\]/g, '[/ZEUS_API_CALL]');
}

function parseMaybeJson(value: unknown): any {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  if (value && typeof value === 'object') {
    return value;
  }

  return null;
}

/**
 * Repair JSON by escaping unescaped newlines/tabs ONLY inside string values.
 * Unlike the old approach (replace ALL \n → \\n), this preserves structural
 * JSON whitespace between properties, which is critical for code_change payloads
 * that contain multi-line code in string values.
 */
function repairJsonStrings(json: string): string {
  let result = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (esc) {
      esc = false;
      result += ch;
      continue;
    }
    if (ch === '\\' && inStr) {
      esc = true;
      result += ch;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      result += ch;
      continue;
    }
    if (inStr) {
      // Inside a string value: escape unescaped control characters
      if (ch === '\n') { result += '\\n'; continue; }
      if (ch === '\r') { result += '\\r'; continue; }
      if (ch === '\t') { result += '\\t'; continue; }
    }
    result += ch;
  }
  return result;
}

/**
 * Función robusta para parsear JSON proveniente de la IA.
 * Extrae el primer objeto JSON completo usando brace-counting (no first/last brace)
 * y repara errores comunes de escape solo dentro de strings.
 */
function safeJsonParse(text: string): any {
  if (!text || typeof text !== 'string') return null;

  // Limpiar ruido técnico de modelos (ej: <tool_call|>) antes de buscar el JSON
  const cleanedText = text
    .replace(/<tool_called\|?>/g, '')
    .replace(/<tool_call\|?>/g, '');

  // Bug 3 fix: Use brace-counting to extract the FIRST complete JSON object
  // instead of firstBrace..lastBrace which can span multiple objects and include garbage
  const firstBrace = cleanedText.indexOf('{');
  if (firstBrace === -1) return null;

  let depth = 0;
  let inStr = false;
  let esc = false;
  let closeBrace = -1;

  for (let i = firstBrace; i < cleanedText.length; i++) {
    const ch = cleanedText[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\' && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { closeBrace = i; break; }
    }
  }

  if (closeBrace === -1) return null;

  const jsonCandidate = cleanedText.substring(firstBrace, closeBrace + 1);

  try {
    return JSON.parse(jsonCandidate);
  } catch (e) {
    // Intentar reparar saltos de línea no escapados SOLO dentro de valores string
    // Bug 3 fix: Don't blindly replace ALL \n — that corrupts structural JSON whitespace
    try {
      const repaired = repairJsonStrings(jsonCandidate);
      return JSON.parse(repaired);
    } catch (e2) {
      console.log('🔄 Zeus IA: Recuperando contenido mediante extracción de emergencia (formato JSON no estándar detectado).');

      // EXTRACCIÓN DE EMERGENCIA (Basada en Regex):
      // Si el JSON es inválido, intentamos extraer los campos críticos manualmente
      try {
        const result: any = {};

        // Extraer método
        const methodMatch = jsonCandidate.match(/"method"\s*:\s*"([^"]+)"/);
        if (methodMatch) result.method = methodMatch[1];

        // Extraer url
        const urlMatch = jsonCandidate.match(/"url"\s*:\s*"([^"]+)"/);
        if (urlMatch) result.url = urlMatch[1];

        // Extraer descripción
        const descMatch = jsonCandidate.match(/"description"\s*:\s*"([^"]+)"/);
        if (descMatch) result.description = descMatch[1];

        // Extraer contenido (el campo más propenso a errores de escape)
        // Buscamos el contenido entre "content":" y el final o la siguiente propiedad
        const contentMatch = jsonCandidate.match(/"content"\s*:\s*"([\s\S]*?)"\s*[,}]/);
        if (contentMatch) {
          if (!result.body) result.body = {};
          // Limpiar escapes básicos si los hay
          result.body.content = contentMatch[1]
            .replace(/\\n/g, '\n')
            .replace(/\\r/g, '\r')
            .replace(/\\"/g, '"');
        }

        // Extracción robusta de campos clave mediante Regex
        const extract = (regex: RegExp) => {
          const m = jsonCandidate.match(regex);
          return m ? m[1] : null;
        };

        const planName = extract(/"(?:planName|plan)"\s*:\s*"([^"]+)"/);
        const name = extract(/"(?:name|taskName)"\s*:\s*"([^"]+)"/);
        const url = extract(/"url"\s*:\s*"([^"]+)"/);
        const method = extract(/"method"\s*:\s*"([^"]+)"/);
        const path = extract(/"path"\s*:\s*"([^"]+)"/);
        const type = extract(/"type"\s*:\s*"([^"]+)"/);
        const operation = extract(/"operation"\s*:\s*"([^"]+)"/);
        const content = extract(/"content"\s*:\s*"([\s\S]*?)"(?=\s*[,}])/) || extract(/"content"\s*:\s*"([\s\S]*?)$/);

        if (planName) { if (!result.body) result.body = {}; result.body.planName = planName; }
        if (name) { if (!result.body) result.body = {}; result.body.name = name; result.name = name; }
        if (path) { if (!result.body) result.body = {}; result.body.path = path; }
        if (type) { if (!result.body) result.body = {}; result.body.type = type; }
        if (operation) { if (!result.body) result.body = {}; result.body.operation = operation; }
        if (content) { if (!result.body) result.body = {}; result.body.content = content.replace(/\\n/g, '\n').replace(/\\"/g, '"'); }
        if (url) result.url = url;
        if (method) result.method = method;

        if (result.url || result.body?.content || result.body?.planName || result.body?.name) {
          return result;
        }
      } catch (e3) {
        console.error('La extracción de emergencia también falló:', e3);
      }
      return null;
    }
  }
}

/**
 * Finds all complete JSON objects containing "type": "code_change" in the text.
 * Uses brace counting with string/escape tracking to correctly handle nested objects.
 * The old regex [\s\S]*?\} matched the FIRST } after "code_change", breaking on nested }.
 */
function findCodeChangeJsonSpans(text: string): Array<{ start: number; end: number; json: string }> {
  const results: Array<{ start: number; end: number; json: string }> = [];
  if (!text || typeof text !== 'string') return results;

  const typeRegex = /"type"\s*:\s*"code_change"/g;
  let match;

  while ((match = typeRegex.exec(text)) !== null) {
    const typePos = match.index;

    // Find the opening { before typePos (last { before "type")
    let openBrace = text.lastIndexOf('{', typePos);
    if (openBrace === -1) continue;

    // Forward scan from openBrace with string/escape tracking to find matching }
    let depth = 0;
    let inStr = false;
    let esc = false;
    let closeBrace = -1;

    for (let i = openBrace; i < text.length; i++) {
      const ch = text[i];
      if (esc) { esc = false; continue; }
      if (ch === '\\' && inStr) { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { closeBrace = i; break; }
      }
    }

    if (closeBrace === -1) continue;

    // Verify typePos is within this span
    if (typePos < openBrace || typePos > closeBrace) continue;

    // Skip if already covered by a previous result
    const overlaps = results.some(r => openBrace >= r.start && openBrace < r.end);
    if (overlaps) continue;

    results.push({
      start: openBrace,
      end: closeBrace + 1,
      json: text.substring(openBrace, closeBrace + 1)
    });
  }

  results.sort((a, b) => a.start - b.start);
  return results;
}

function extractCodeChangeBlocks(text: string): any[] {
  if (!text || typeof text !== 'string') return [];

  const blocks: any[] = [];

  // Buscar dentro de bloques markdown json
  const markdownRegex = /\`\`\`(?:json)?\s*\n?([\s\S]*?)\n?\s*\`\`\`/g;
  let mdMatch;
  while ((mdMatch = markdownRegex.exec(text)) !== null) {
    const parsed = safeJsonParse(mdMatch[1].trim());
    if (parsed && parsed.type === 'code_change' && Array.isArray(parsed.changes)) {
      blocks.push(parsed);
    }
  }

  // Si no encontró en markdown, buscar objetos JSON sueltos con brace counting
  if (blocks.length === 0) {
    const spans = findCodeChangeJsonSpans(text);
    for (const span of spans) {
      const parsed = safeJsonParse(span.json);
      if (parsed && parsed.type === 'code_change' && Array.isArray(parsed.changes)) {
        blocks.push(parsed);
      }
    }
  }

  return blocks;
}

function buildCodeBubblesFromOriginalContent(rawText: string): MessageCodeBubble[] {
  if (!rawText.trim()) return [];

  const bubbles: MessageCodeBubble[] = [];

  const inferFileNameFromContext = (textBeforeCode: string) => {
    const patterns = [
      /Archivo\s+generado:\s*([^\n]+)/gi,
      /Archivo\s+creado:\s*([^\n]+)/gi,
      /Archivo:\s*([^\n]+)/gi,
    ];

    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      let lastPath = '';
      while ((match = pattern.exec(textBeforeCode)) !== null) {
        lastPath = String(match[1] || '').trim();
      }

      if (lastPath) {
        const cleanedPath = lastPath.replace(/[`"']/g, '').trim();
        const segments = cleanedPath.split(/[\\/]/).filter(Boolean);
        return segments[segments.length - 1] || cleanedPath;
      }
    }

    return '';
  };

  const zeusCallPattern = /\[ZEUS_API_CALL\]([\s\S]*?)(?=\[ZEUS_API_CALL\]|\[\/ZEUS_API_CALL\]|\[TERMINAL_COMMAND\]|$)/g;
  let zeusMatch: RegExpExecArray | null;

  while ((zeusMatch = zeusCallPattern.exec(rawText)) !== null) {
    const callDef = safeJsonParse(zeusMatch[1] || '');
    if (!callDef) continue;

    const fileNameFromBody =
      (typeof callDef?.body?.name === 'string' && callDef.body.name) ||
      (typeof callDef?.name === 'string' && callDef.name) ||
      '';
    const fileNameFromUrl = typeof callDef?.url === 'string'
      ? extractFileNameFromApiUrl(callDef.url)
      : '';
    const resolvedFileName = fileNameFromBody || fileNameFromUrl || 'archivo.tsx';
    const contentFromBody = typeof callDef?.body?.content === 'string' ? callDef.body.content : '';

    if (contentFromBody.trim()) {
      bubbles.push({
        code: contentFromBody,
        language: inferLanguageFromName(resolvedFileName),
        fileName: resolvedFileName,
        isVisible: true,
      });
    }
  }

  rawText.replace(/\`\`\`([a-zA-Z0-9_+-]+)?\n?([\s\S]*?)\`\`\`/g, (_match, lang, code, offset) => {
    const normalizedCode = (code || '').replace(/\n$/, '').trim();
    if (normalizedCode) {
      const textBeforeCode = rawText.slice(0, offset as number);
      const inferredFileName = inferFileNameFromContext(textBeforeCode);
      bubbles.push({
        code: normalizedCode,
        language: (lang || 'typescript').toLowerCase(),
        fileName: inferredFileName,
        isVisible: true,
      });
    }
    return '';
  });

  return bubbles;
}

async function executeZeusApiCall(callDef: {
  method?: string;
  url: string;
  body?: Record<string, unknown>;
  params?: Record<string, unknown>;
  isFormData?: boolean;
  description?: string;
}): Promise<ApiCallResult> {
  let url = callDef.url;

  // REDIRECCIÓN TRANSPARENTE: Si es una URL relativa que empieza por /api y coincide con rutas del backend Express
  if (url.startsWith('/api/') && !url.startsWith('http')) {
    const backendRoutes = [
      '/api/folders', '/api/files', '/api/lines', '/api/chars', 
      '/api/plan', '/api/structure', '/api/history', '/api/commands',
      '/api/schema', '/api/config'
    ];
    if (backendRoutes.some(route => url.startsWith(route))) {
      url = `http://localhost:8742${url}`;
    }
  }

  // REDIRECCIÓN TRANSPARENTE: Convertir "guardar" en "crear y ejecutar" inmediatamente

  const method = (callDef.method || 'GET').toUpperCase();

  if (callDef.params && ['GET', 'DELETE'].includes(method)) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(callDef.params)) sp.set(k, String(v));
    url += '?' + sp.toString();
  }

  const options: RequestInit = { method };

  // Anclar la llamada al cwd de la sesión activa (header X-Zeus-Session).
  const sid = getActiveSessionId();
  if (sid) {
    options.headers = { ...(options.headers as Record<string, string> || {}), 'X-Zeus-Session': sid };
  }

  if (['POST', 'PUT', 'PATCH'].includes(method) && callDef.body) {
    if (callDef.isFormData) {
      const fd = new FormData();
      for (const [k, v] of Object.entries(callDef.body)) fd.append(k, String(v));
      options.body = fd;
    } else {
      // Normalización de plan -> planName si es necesario
      if (callDef.body) {
        if (callDef.body.plan && !callDef.body.planName) {
          callDef.body.planName = callDef.body.plan;
        }
      }

      // Usar JSON por defecto para mejor compatibilidad con Express/PocketBase
      options.headers = { ...(options.headers as Record<string, string> || {}), 'Content-Type': 'application/json' };
      options.body = JSON.stringify(callDef.body);
    }
  }

  try {
    const res = await fetch(url, options);
    const ct = res.headers.get('content-type') || '';

    if (ct.startsWith('image/') || ct.startsWith('video/') || ct.startsWith('audio/')) {
      const blob = await res.blob();
      const mediaType: ApiCallResult['mediaType'] =
        ct === 'image/gif' ? 'gif' :
          ct.startsWith('image/') ? 'image' :
            ct.startsWith('video/') ? 'video' : 'audio';
      return { success: res.ok, text: `[${mediaType} recibido — ${(blob.size / 1024).toFixed(1)} KB]`, blobUrl: URL.createObjectURL(blob), mimeType: ct, mediaType };
    }
    if (ct.includes('application/json')) {
      const data = await res.json();
      // Lectura de archivo: si el contenido es enorme, NO se vuelca entero
      // (saturaría el contexto) ni se trunca (perdería información). Se
      // sustituye por metadata + instrucciones para leer POR PARTES con
      // /files/{name}/lines, conservando acceso a toda la información.
      if (data && typeof data === 'object' && typeof data.content === 'string'
          && data.content.length > MAX_INLINE_FILE_CONTENT_CHARS) {
        const fileContent: string = data.content;
        const totalLines = fileContent.split('\n').length;
        const fileName = typeof data.name === 'string' ? data.name : '';
        const filePath = typeof data.path === 'string' ? data.path : '';
        const size = typeof data.size === 'number' ? data.size : fileContent.length;
        const note =
          `[ARCHIVO GRANDE — contenido NO incluido para no saturar tu contexto. ` +
          `Total: ${totalLines} líneas, ${fileContent.length} caracteres. ` +
          `Léelo por partes con GET /api/files/${fileName}/lines?path=${filePath}&startLine=1&endLine=200 ` +
          `(avanza en bloques de ~200 líneas hasta llegar a ${totalLines}) ` +
          `o con /api/files/${fileName}/lines/list para ver todas las líneas numeradas. ` +
          `Así accedes a TODA la información sin truncamiento.]`;
        const summarized = {
          ...data,
          content: note,
          size,
          totalLines,
        };
        return { success: res.ok, text: JSON.stringify(summarized, null, 2) };
      }
      return { success: res.ok, text: JSON.stringify(data, null, 2) };
    }
    return { success: res.ok, text: (await res.text()) || '(respuesta vacía)' };
  } catch (err: any) {
    return { success: false, text: `Error de red: ${err.message}` };
  }
}

async function safeWriteClipboard(text: string): Promise<boolean> {
  try {
    const electronAPI = (typeof window !== 'undefined' && (window as any).electronAPI) ? (window as any).electronAPI : null;
    if (electronAPI?.clipboard?.writeText) {
      await electronAPI.clipboard.writeText(text);
      return true;
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    // Fallback para contextos sin clipboard API
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch (e) {
    console.error('Clipboard error:', e);
    return false;
  }
}

function renderMessageContent(
  content: string,
  t: (key: any) => string,
  setShowTerminal: (v: boolean) => void,
  messageId: string,
  executedCount: number,
  onCommandComplete: () => void,
  isErrorFromEditor: boolean = false,
  showInlineCodeBlocks: boolean = true,
  codeBubbles: MessageCodeBubble[] = [],
  isMaximized: boolean = false,
  onOpenTerminalFromMessage?: () => void,
  onApplyCodeChange?: (json: string) => void,
  appliedCodeChanges: Record<string, boolean> = {}
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];

  // Helper to check if a code_change bubble was already auto-applied
  const isCodeChangeApplied = (bubbleCode: string, bubbleFileName: string): boolean => {
    try {
      const parsed = JSON.parse(bubbleCode);
      if (parsed?.type !== 'code_change' || !Array.isArray(parsed.changes)) return false;
      for (const change of parsed.changes) {
        const fn = (change.file || bubbleFileName || '').replace(/\\/g, '/').split('/').pop() || '';
        if (appliedCodeChanges[`${messageId}:cc:${fn}`]) return true;
      }
    } catch { /* ignore */ }
    return false;
  };

  // 🧹 LIMPIEZA: eliminar basura HTML/JSX que el modelo a veces incluye al leer archivos
  let cleanedContent = content;
  // Detectar bloques de HTML basura (chunks de Next.js, scripts, etc.)
  // Nota: usamos new RegExp para evitar problemas de parsing con \n en regex literales
  const htmlGarbagePatterns = [
    // Bloque completo de HTML no deseado
    new RegExp('<!DOCTYPE html>[\\s\\S]*?<\\/html>', 'gi'),
    // Chunks de Next.js
    new RegExp('/_next/static/chunks/[^\\s"<>]+', 'gi'),
    // Scripts inline
    new RegExp('<script[\\s\\S]*?<\\/script>', 'gi'),
    // Links de CSS/JS
    new RegExp('<link[^>]*>', 'gi'),
    // Meta tags
    new RegExp('<meta[^>]*>', 'gi'),
    // Tags de cierre sueltos (</div>, </body>, etc.) sin apertura
    new RegExp('(?:<\\/[a-z]+\\s*>)\\s*(?:<\\/[a-z]+\\s*>)*', 'gi'),
  ];
  for (const pattern of htmlGarbagePatterns) {
    cleanedContent = cleanedContent.replace(pattern, '');
  }
  // Limpiar líneas que son puramente basura de chunks o tags HTML
  cleanedContent = cleanedContent.split('\n').map(line => {
    const trimmed = line.trim();
    // Si la línea es puramente chunks de Next.js o tags HTML sueltos
    if (/^\s*(?:\/_next\/static\/|node_modules_|\[root-of-the-server\]|turbopack-|chunks\/)/i.test(trimmed)) return '';
    if (/^\s*<\/?(?:script|link|meta|div|head|body|html|title)[^>]*>\s*$/i.test(trimmed)) return '';
    if (/^\s*<\?xml/i.test(trimmed)) return '';
    return line;
  }).join('\n');
  // Colapsar múltiples saltos de línea
  cleanedContent = cleanedContent.replace(/\n{3,}/g, '\n\n');

  // Filtrar bloques [ZEUS_API_CALL]: en el chat solo se muestra la descripción,
  // nunca el objeto JSON completo. También se eliminan los marcadores de estado.
  cleanedContent = cleanedContent
    .replace(
      /\[ZEUS_API_CALL\][\s\S]*?(?=\[ZEUS_API_CALL\]|\[\/ZEUS_API_CALL\]|\[TERMINAL_COMMAND\]|$)/g,
      (match) => {
        const jsonPart = match.replace(/^\[ZEUS_API_CALL\]/, '');
        const parsed = safeJsonParse(jsonPart);
        const desc = parsed && typeof parsed.description === 'string' ? parsed.description.trim() : '';
        return desc ? `\n[ZEUS_ACTION]${desc}[/ZEUS_ACTION]\n` : '';
      }
    )
    .replace(/\[\/ZEUS_API_CALL\]/g, '')
    .replace(/\[CONTINUAR\]/gi, '')
    .replace(/\[FIN\]/gi, '')
    .replace(/\n{3,}/g, '\n\n');

  // Procesar bloques de comando de terminal primero para manejarlos de forma especial
  const parts = cleanedContent.split(/(\[TERMINAL_COMMAND\][\s\S]*?\[\/TERMINAL_COMMAND\])/g);

  let keyIdx = 0;
  let commandIdx = 0;
  let codeBubbleIdx = 0;
  let renderedCodeBubbleMarker = false;

  const normalizeTerminalCommand = (rawCode: string): string => {
    const code = rawCode.trim();
    const terminalBaseDirName = String((window as any)?.chatTerminalBaseDirName || 'data').toLowerCase();

    // La sesión del terminal ya arranca dentro de DATA_PATH.
    // Evitamos rutas duplicadas como: cd data/audio-player-app (o con otro nombre base)
    // y también variantes con barras invertidas.
    const escapedBaseDir = terminalBaseDirName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const duplicatedBaseDirPattern = new RegExp(`^cd\\s+(?:\\./|/)?${escapedBaseDir}[\\/]`, 'i');
    if (duplicatedBaseDirPattern.test(code)) {
      return code.replace(duplicatedBaseDirPattern, 'cd ');
    }

    return code;
  };

  const waitForTerminalAndExecute = (code: string, retries: number = 45): Promise<boolean> => {
    return new Promise((resolve) => {
      const tryDispatch = (remaining: number) => {
        if (typeof window === 'undefined') {
          resolve(false);
          return;
        }

        const executeTerminalCommand = (window as any).executeTerminalCommand;
        const isTerminalReady = Boolean((window as any).isChatTerminalReady);
        if (typeof executeTerminalCommand === 'function' && isTerminalReady) {
          // Colchón aumentado: asegurar que xterm, el socket y la PTY del backend estén estabilizados.
          // El usuario reporta que el terminal a veces no procesa el primer CD si es demasiado rápido.
          window.setTimeout(() => {
            const dispatched = Boolean(executeTerminalCommand(code, { queueIfNotReady: false }));
            if (dispatched) {
              resolve(true);
              return;
            }

            if (remaining <= 0) {
              resolve(false);
              return;
            }

            window.setTimeout(() => tryDispatch(remaining - 1), 200);
          }, 450); // Aumentado de 180 a 450 para mayor estabilidad inicial
          return;
        }

        if (remaining <= 0) {
          resolve(false);
          return;
        }

        window.setTimeout(() => tryDispatch(remaining - 1), 140);
      };

      tryDispatch(retries);
    });
  };

  const handleExecuteInTerminal = async (code: string): Promise<boolean> => {
    setShowTerminal(true);
    onOpenTerminalFromMessage?.();
    let normalizedCode = normalizeTerminalCommand(code);

    // Eliminar redirecciones tipo 2>&1 que el terminal maneja solo
    normalizedCode = normalizedCode.replace(/\s*2>&1\s*$/gi, '').trim();

    // Si el modelo sigue enviando comandos encadenados con &&, separarlos y ejecutar secuencialmente
    const parts = normalizedCode.split(/&&/).map(p => p.trim()).filter(Boolean);
    if (parts.length > 1) {
      for (let i = 0; i < parts.length; i++) {
        const dispatched = await waitForTerminalAndExecute(parts[i]);
        if (!dispatched) return false;
        if (i < parts.length - 1) {
          await new Promise(r => setTimeout(r, 700));
        }
      }
      return true;
    }

    return waitForTerminalAndExecute(normalizedCode);
  };

  let pauseAfterCommandCard = false;

  for (const part of parts) {
    if (pauseAfterCommandCard) {
      break;
    }

    const terminalMatch = part.match(/\[TERMINAL_COMMAND\]([\s\S]*?)\[\/TERMINAL_COMMAND\]/);

    if (terminalMatch) {
      const currentIdx = commandIdx++;
      const command = terminalMatch[1].trim();

      if (currentIdx < executedCount) {
        // Mostrar como ya ejecutado (versión compacta)
        nodes.push(
          <div key={keyIdx++} className="my-1.5 w-fit max-w-[520px] px-3 py-2 bg-success/5 border border-emerald-500/10 rounded-lg flex items-center justify-between gap-3 opacity-50">
            <div className="flex items-center gap-2 overflow-hidden">
              <CheckCircle className="w-3.5 h-3.5 text-success shrink-0" />
              <code className="text-[11px] leading-tight text-emerald-300/70 truncate font-mono max-w-[300px] md:max-w-[420px]">{command}</code>
            </div>
            <span className="text-[8px] font-bold uppercase text-success/60 shrink-0 tracking-[0.18em]">{t('chatReady')}</span>
          </div>
        );
      } else if (currentIdx === executedCount) {
        // Mostrar la tarjeta interactiva para el comando actual
        nodes.push(
          <TerminalActionCard
            key={keyIdx++}
            command={command}
            onExecute={() => handleExecuteInTerminal(command)}
            onComplete={onCommandComplete}
          />
        );
        pauseAfterCommandCard = true;
      } else {
        // Mostrar indicador de comando pendiente
        nodes.push(
          <div key={keyIdx++} className="my-2 p-3 bg-card/20 border border-border/50/20 rounded-xl flex items-center gap-3 opacity-30">
            <Terminal className="w-4 h-4 text-muted-foreground/60" />
            <span className="text-xs text-muted-foreground/60 font-mono italic tracking-tight">{t('commandQueued')}</span>
          </div>
        );
        pauseAfterCommandCard = true;
      }
    } else {
      // Procesar el resto del contenido (líneas, código, etc)
      const lines = part.split('\n');
      let i = 0;

      while (i < lines.length) {
        const line = lines[i];

        // Image marker: [IMG:blob:...]
        const imgMatch = line.match(/^\[IMG:(blob:[^\]]+)\]$/);
        if (imgMatch) {
          nodes.push(
            <img key={keyIdx++} src={imgMatch[1]} alt="resultado" className="max-w-full h-auto rounded-lg mt-2 border border-border/40" />
          );
          i++;
          continue;
        }

        // Descripción de acción Zeus (de bloques [ZEUS_API_CALL] filtrados)
        const zeusActionMatch = line.match(/^\[ZEUS_ACTION\]([\s\S]*?)\[\/ZEUS_ACTION\]$/);
        if (zeusActionMatch) {
          nodes.push(
            <div key={keyIdx++} className="my-2 px-3 py-2 rounded-lg border border-amber-400/30 bg-amber-400/5 flex items-center gap-2 text-xs text-amber-300 break-words">
              <span className="shrink-0">▸</span>
              <span className="break-words">{zeusActionMatch[1]}</span>
            </div>
          );
          i++;
          continue;
        }

        // Code bubble marker injected during parsing: [CODE_BUBBLE_n]
        const codeBubbleMarkerMatch = line.trim().match(/^\[CODE_BUBBLE_(\d+)\]$/);
        if (codeBubbleMarkerMatch) {
          const markerIndex = Number(codeBubbleMarkerMatch[1]);
          const bubbleForMarker = codeBubbles[markerIndex];

          if (bubbleForMarker) {
            renderedCodeBubbleMarker = true;
            nodes.push(
              <ChatCodeBubble
                key={keyIdx++}
                code={bubbleForMarker.code}
                language={bubbleForMarker.language}
                fileName={bubbleForMarker.fileName}
                isVisible={bubbleForMarker.isVisible}
                isMaximized={isMaximized}
                onApplyCodeChange={onApplyCodeChange}
                codeChangeApplied={isCodeChangeApplied(bubbleForMarker.code, bubbleForMarker.fileName)}
              />
            );
          }

          i++;
          continue;
        }

        // Code block: \`\`\`
        if (line.trimStart().startsWith('\`\`\`')) {
          const langMatch = line.match(/\`\`\`(\w+)?/);
          const lang = langMatch ? langMatch[1] : '';
          const codeLines: string[] = [];
          i++;
          while (i < lines.length && !lines[i].trimStart().startsWith('\`\`\`')) {
            codeLines.push(lines[i]);
            i++;
          }
          i++; // skip closing \`\`\`
          const fullCode = codeLines.join('\n');

          const bubbleForThisCodeBlock = codeBubbles[codeBubbleIdx];
          if (bubbleForThisCodeBlock) {
            nodes.push(
              <ChatCodeBubble
                key={keyIdx++}
                code={bubbleForThisCodeBlock.code}
                language={bubbleForThisCodeBlock.language}
                fileName={bubbleForThisCodeBlock.fileName}
                isVisible={bubbleForThisCodeBlock.isVisible}
                isMaximized={isMaximized}
                onApplyCodeChange={onApplyCodeChange}
                codeChangeApplied={isCodeChangeApplied(bubbleForThisCodeBlock.code, bubbleForThisCodeBlock.fileName)}
              />
            );
            codeBubbleIdx++;
            continue;
          }

          if (!showInlineCodeBlocks) {
            continue;
          }

          const isExecutable = ['bash', 'sh', 'powershell', 'ps1', 'cmd', 'shell', 'zsh'].includes(lang?.toLowerCase() || '');

          nodes.push(
            <div key={keyIdx++} className="relative group/code my-2">
              <pre className="bg-card rounded p-3 text-xs text-green-300 overflow-x-auto font-mono whitespace-pre-wrap max-w-full border border-border/50">
                {fullCode}
              </pre>
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover/code:opacity-100 transition-opacity">
                {isExecutable && (
                  <button
                    onClick={() => handleExecuteInTerminal(fullCode)}
                    className="p-1.5 bg-green-600/80 hover:bg-green-600 text-foreground rounded shadow-lg flex items-center gap-1 text-[10px] font-bold uppercase"
                    title={t('executeInTerminal')}
                  >
                    <Terminal className="w-3 h-3" />
                    Ejecutar
                  </button>
                )}
                {(() => {
                  const maybeChange = safeJsonParse(fullCode);
                  const isCodeChange = maybeChange && maybeChange.type === 'code_change' && Array.isArray(maybeChange.changes);
                  return isCodeChange && onApplyCodeChange ? (
                    <button
                      onClick={() => onApplyCodeChange(fullCode)}
                      className="p-1.5 bg-primary/80 hover:bg-primary text-foreground rounded shadow-lg flex items-center gap-1 text-[10px] font-bold uppercase"
                      title={t('applyChanges')}
                    >
                      <Play className="w-3 h-3" />
                      Aplicar
                    </button>
                  ) : null;
                })()}
                <button
                  onClick={() => safeWriteClipboard(fullCode).catch(() => {})}
                  className="p-1.5 bg-muted/80 hover:bg-muted/80 text-foreground rounded shadow-lg"
                  title={t('copyCode')}
                >
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            </div>
          );
          continue;
        }

        // Error description highlighting for editor errors
        if (isErrorFromEditor && line.startsWith('Error: ')) {
          const errorText = line.substring(7); // Remove "Error: " prefix
          nodes.push(
            <span key={keyIdx++} className="block break-words">
              <span className="text-rose-400">Error: </span>
              <span className="text-rose-300">{errorText}</span>
            </span>
          );
          i++;
          continue;
        }

        // Bold **text** inline within line
        const boldParts = line.split(/(\*\*[^*]+\*\*)/g);
        const rendered = boldParts.map((part, pi) =>
          part.startsWith('**') && part.endsWith('**')
            ? <strong key={pi}>{part.slice(2, -2)}</strong>
            : part
        );
        nodes.push(<span key={keyIdx++} className="block whitespace-pre-wrap break-words">{rendered}</span>);
        i++;
      }
    }
  }

  // Fallback para historiales antiguos o mensajes sin marcadores explícitos.
  // Si el mensaje trae metadata de burbujas pero no se renderizó ninguna por marcador,
  // añadimos las restantes al final para no perder el editor visual.
  if (!renderedCodeBubbleMarker && codeBubbleIdx < codeBubbles.length) {
    for (let idx = codeBubbleIdx; idx < codeBubbles.length; idx++) {
      const bubble = codeBubbles[idx];
      nodes.push(
        <ChatCodeBubble
          key={keyIdx++}
          code={bubble.code}
          language={bubble.language}
          fileName={bubble.fileName}
          isVisible={bubble.isVisible}
          isMaximized={isMaximized}
          onApplyCodeChange={onApplyCodeChange}
          codeChangeApplied={isCodeChangeApplied(bubble.code, bubble.fileName)}
        />
      );
    }
  }

  return nodes;
}

// Componente auxiliar para las acciones de terminal con confirmación
function TerminalActionCard({ command, onExecute, onComplete }: { command: string; onExecute: () => Promise<boolean> | boolean; onComplete?: () => void }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<'pending' | 'executed' | 'cancelled'>('pending');

  const handleExecute = async () => {
    const dispatched = await Promise.resolve(onExecute());
    if (!dispatched) {
      return;
    }

    setStatus('executed');
    setTimeout(() => onComplete?.(), 500);
  };

  const handleCancel = () => {
    setStatus('cancelled');
    setTimeout(() => onComplete?.(), 500);
  };

  if (status === 'executed') {
    return null;
  }

  if (status === 'cancelled') {
    return (
      <div className="my-3 w-full max-w-[560px] p-4 bg-muted/60/10 border border-border/30/20 rounded-xl flex items-center justify-between gap-4 opacity-60">
        <div className="flex items-center gap-3 overflow-hidden">
          <X className="w-5 h-5 text-muted-foreground shrink-0" />
          <code className="text-xs text-muted-foreground/80 truncate font-mono">{command}</code>
        </div>
        <span className="text-[10px] font-bold uppercase text-muted-foreground/80 shrink-0 tracking-widest">{t('skipped')}</span>
      </div>
    );
  }

  return (
    <div className="my-6 w-full max-w-[560px] overflow-hidden rounded-xl border border-white/10 shadow-2xl" style={{ backgroundColor: '#000000' }}>
      {/* Header del terminal (MISMO NEGRO QUE EL CUERPO) */}
      <div className="flex items-center justify-between px-6 py-3 shrink-0" style={{ backgroundColor: '#000000', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="flex items-center gap-3">
          <Terminal className="w-4 h-4 text-green-400" />
          <div className="flex gap-1.5 ml-1">
          </div>
        </div>
        <div className="flex items-center gap-2 px-2.5 py-1 rounded text-[10px] text-success font-bold uppercase tracking-widest">
          <span className="w-2 h-2 bg-success rounded-full animate-pulse"></span>
          Ready
        </div>
      </div>

      {/* Cuerpo del terminal (MÁS ANCHO CON MARGEN NEGATIVO) */}
      <div className="p-3" style={{ backgroundColor: '#000000' }}>
        <div className="flex items-start gap-3 mb-8">
          <span className="text-green-500/60 font-mono text-sm shrink-0 select-none">$</span>
          <pre className="text-sm text-foreground/90 font-mono whitespace-pre-wrap break-all leading-relaxed tracking-tight">
            {command}
          </pre>
        </div>

        <div className="flex gap-3 justify-end pt-2 border-t border-white/5">
          <button
            onClick={handleExecute}
            className="px-9 py-1 bg-success/90 hover:bg-success text-foreground rounded-md font-bold text-[10px] transition-all shadow-lg shadow-emerald-900/20 active:scale-95 uppercase tracking-wider"
          >
            EJECUTAR
          </button>
          <button
            onClick={handleCancel}
            className="px-9 py-1 bg-background/80 hover:bg-card text-muted-foreground rounded-md font-bold text-[10px] border border-white/5 transition-all active:scale-95 uppercase tracking-wider"
          >
            OMITIR
          </button>
        </div>
      </div>
    </div>
  );
}



export function FloatingChatButton() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('zeus_chat_open') === '1';
  });
  const [isMaximized, setIsMaximized] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [useLucideIcons, setUseLucideIcons] = useState(false);
  const { messages, setMessages, conversationId, setConversationId, triggerRefreshConversations, refreshConversations, loadConversation: loadConv, startNewChat } = useChatContext();
  const [editingConvId, setEditingConvId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newConvTitle, setNewConvTitle] = useState('');
  const [pendingConversationTitle, setPendingConversationTitle] = useState<string | null>(null);
  const [conversations, setConversations] = useState<any[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const {
    correctionQueue,
    pendingCorrection,
    addCorrection,
    removeCorrection,
    openFile,
    activeFile,
    openFiles,
    setOpenFiles,
    externalMessage,
    clearExternalMessage,
    hiddenContext,
    clearHiddenContext
  } = useEditor();

  const generateMessageId = () =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const createChatMessage = (role: 'user' | 'assistant', content: string): ChatMessage => ({
    id: generateMessageId(),
    role,
    content,
    createdAt: new Date().toISOString(),
  });
  const [input, setInput] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const [autoPlayResponses, setAutoPlayResponses] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const speechSynthRef = useRef<SpeechSynthesisUtterance | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  // Mapa para guardar el texto plano de cada mensaje (para TTS con posición)
  const messagePlainTextMap = useRef<Map<number, string>>(new Map());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const { selectedModel, setSelectedModel, refreshExplorer, refreshPlans } = useStore();
  const { user: authUser } = useAuth();
  const [hasSelection, setHasSelection] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [isApiConfigModalOpen, setIsApiConfigModalOpen] = useState(false);
  const [isVoiceConfigModalOpen, setIsVoiceConfigModalOpen] = useState(false);
  const [isStreamingEnabled, setIsStreamingEnabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('zeus_streaming_enabled') === '1';
  });

  // Nuevos estados para configuración de streaming
  const [streamSpeed, setStreamSpeed] = useState(() => {
    if (typeof window === 'undefined') return 100;
    return parseInt(localStorage.getItem('zeus_stream_speed') || '100');
  });
  const [streamChars, setStreamChars] = useState(() => {
    if (typeof window === 'undefined') return 10;
    return parseInt(localStorage.getItem('zeus_stream_chars') || '10');
  });
  const [streamWarmup, setStreamWarmup] = useState(() => {
    if (typeof window === 'undefined') return 1200;
    return parseInt(localStorage.getItem('zeus_stream_warmup') || '1200');
  });

  // Actualizar localStorage y modelos (locales y remotos) cuando cambia isStreamingEnabled
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('zeus_streaming_enabled', isStreamingEnabled ? '1' : '0');
      
      // Actualizar todos los modelos locales en RAE API
      const updateLocalModelsStream = async () => {
        try {
          const RAE_API_URL = 'http://localhost:3011';
          const res = await fetch(`${RAE_API_URL}/api/v1/models?limit=100`);
          const data = res.ok ? await res.json() : { records: [] };
          const models = data.records || data.items || [];

          // Actualizar cada modelo con el nuevo valor de stream
          for (const model of models) {
            if (model.id) {
              await fetch(`${RAE_API_URL}/api/v1/models/${model.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ stream: isStreamingEnabled })
              });
            }
          }
          console.log(`[Streaming] Actualizados ${models.length} modelos locales (RAE) a stream=${isStreamingEnabled}`);
        } catch (error) {
          console.error('[Streaming] Error actualizando modelos locales:', error);
        }
      };

      // Actualizar modelos remotos en PocketBase
      const updateRemoteModelsStream = async () => {
        try {
          const records = await pb.collection(MODELOS_COLLECTION_NAME).getFullList();
          
          for (const record of records) {
            await pb.collection(MODELOS_COLLECTION_NAME).update(record.id, {
              stream: isStreamingEnabled
            });
          }
          console.log(`[Streaming] Actualizados ${records.length} modelos remotos (PocketBase) a stream=${isStreamingEnabled}`);
        } catch (error) {
          console.error('[Streaming] Error actualizando modelos remotos:', error);
        }
      };

      // Ejecutar ambas actualizaciones en paralelo
      Promise.all([
        updateLocalModelsStream(),
        updateRemoteModelsStream()
      ]);
    }
  }, [isStreamingEnabled]);

  const [voiceRate, setVoiceRate] = useState(0.95);
  const [voicePitch, setVoicePitch] = useState(1.0);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string>('');
  const [showAllVoices, setShowAllVoices] = useState(false);

  // Estado para rastrear cuántos comandos se han ejecutado en cada mensaje
  const [executedCommands, setExecutedCommands] = useState<Record<string, number>>({});
  const [appliedCodeChanges, setAppliedCodeChanges] = useState<Record<string, boolean>>({});

  // Estados para burbujas de código por mensaje (permite múltiples por conversación y por mensaje)
  const [messageCodeBubbles, setMessageCodeBubbles] = useState<Record<string, MessageCodeBubble[]>>({});
  const codeStreamIntervalsRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const [terminalAnchorMessageId, setTerminalAnchorMessageId] = useState<string | null>(null);
  const terminalResolveRef = useRef<(() => void) | null>(null);

  const stopCodeStreamByKey = useCallback((streamKey: string) => {
    const interval = codeStreamIntervalsRef.current[streamKey];
    if (interval) {
      clearInterval(interval);
      delete codeStreamIntervalsRef.current[streamKey];
    }
  }, []);

  const stopAllCodeStreams = useCallback(() => {
    Object.keys(codeStreamIntervalsRef.current).forEach((key) => {
      clearInterval(codeStreamIntervalsRef.current[key]);
      delete codeStreamIntervalsRef.current[key];
    });
  }, []);

  const streamCodeBubbleForMessage = useCallback((
    messageId: string,
    bubbleIdx: number,
    sourceCode: string,
    language: string,
    fileName: string
  ): Promise<void> => {
    const streamKey = `${messageId}:${bubbleIdx}`;
    const normalizedCode = sourceCode.trim();

    stopCodeStreamByKey(streamKey);

    if (!normalizedCode) {
      return Promise.resolve();
    }

    setMessageCodeBubbles((prev) => {
      const existing = [...(prev[messageId] || [])];
      existing[bubbleIdx] = { code: '', language, fileName, isVisible: true };
      return { ...prev, [messageId]: existing };
    });

    // Dividimos por líneas para poder procesar el efecto de "crear líneas"
    const lines = normalizedCode.split('\n');
    let currentLineIdx = 0;
    let currentCharIdx = 0;
    let currentText = '';

    return new Promise((resolve) => {
      // Usamos un intervalo más razonable para no sobrecargar React
      codeStreamIntervalsRef.current[streamKey] = setInterval(() => {
        if (currentLineIdx < lines.length) {
          const currentLine = lines[currentLineIdx];

          if (currentCharIdx < currentLine.length) {
            // Escribir varios caracteres por tick para reducir actualizaciones
            const charsToAdd = Math.min(3, currentLine.length - currentCharIdx);
            currentText += currentLine.substring(currentCharIdx, currentCharIdx + charsToAdd);
            currentCharIdx += charsToAdd;

            // Actualizar la UI
            setMessageCodeBubbles((prev) => {
              const existing = [...(prev[messageId] || [])];
              const previousBubble = existing[bubbleIdx] || { code: '', language, fileName, isVisible: true };
              existing[bubbleIdx] = { ...previousBubble, code: currentText, language, fileName, isVisible: true };
              return { ...prev, [messageId]: existing };
            });
          } else {
            // Fin de la línea alcanzado, añadir salto de línea y pasar a la siguiente
            currentText += '\n';
            currentLineIdx++;
            currentCharIdx = 0;
          }
        } else {
          stopCodeStreamByKey(streamKey);
          resolve();
        }
      }, 20); // 20ms es más razonable para React
    });
  }, [stopCodeStreamByKey]);

  useEffect(() => {
    return () => {
      stopAllCodeStreams();
    };
  }, [stopAllCodeStreams]);

  const handleCommandComplete = (messageId: string) => {
    setExecutedCommands(prev => ({
      ...prev,
      [messageId]: (prev[messageId] || 0) + 1
    }));
    // Resolver la promesa de sincronización si el proceso principal está esperando
    if (terminalResolveRef.current) {
      terminalResolveRef.current();
      terminalResolveRef.current = null;
    }
  };

  // Limpiar historial al cerrar sesión
  useEffect(() => {
    if (!authUser) {
      setConversations([]);
    }
  }, [authUser]);

  useEffect(() => {
    setMounted(true);
    // Restaurar estado del terminal tras hidratación
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('zeus_chat_terminal');
      if (saved === '1') setShowTerminal(true);
    }
  }, []);

  // Listen for Lucide icon toggle from theme editor
  useEffect(() => {
    const saved = localStorage.getItem('zeus-use-lucide-icons') === 'true';
    setUseLucideIcons(saved);
    const handler = (e: Event) => {
      const custom = e as CustomEvent;
      setUseLucideIcons(custom.detail?.useLucideIcons ?? false);
    };
    window.addEventListener('zeus-theme-icons-changed', handler);
    return () => window.removeEventListener('zeus-theme-icons-changed', handler);
  }, []);

  // Persistir estado local del chat para que no se pierda al cambiar de pestaña
  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('zeus_chat_open', open ? '1' : '0');
  }, [open]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('zeus_chat_terminal', showTerminal ? '1' : '0');
  }, [showTerminal]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('zeus_chat_input', input);
  }, [input]);

  // Restaurar input de localStorage tras hidratación (evita mismatch SSR)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = localStorage.getItem('zeus_chat_input');
    if (saved) setInput(saved);
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = textarea.scrollHeight + 'px';
    }
  }, [input]);

  // Función para hacer scroll automático al final del terminal
  const scrollToTerminalBottom = useCallback(() => {
    if (terminalRef.current) {
      setTimeout(() => {
        terminalRef.current?.scrollTo({
          top: terminalRef.current.scrollHeight,
          behavior: 'smooth'
        });
      }, 100);
    }
  }, []);

  // Funciones para manejar conversaciones
  const startEditingTitle = (convId: string, currentTitle: string) => {
    setEditingConvId(convId);
    setEditingTitle(currentTitle);
  };

  const saveTitle = async () => {
    if (editingConvId && editingTitle.trim()) {
      try {
        // Obtener token de PocketBase para autenticación
        let headers: Record<string, string> = {
          'Content-Type': 'application/json'
        };

        if (typeof window !== 'undefined') {
          const pbAuth = localStorage.getItem('pb_auth');
          if (pbAuth) {
            try {
              const authData = JSON.parse(pbAuth);
              if (authData.token) {
                headers['Authorization'] = `Bearer ${authData.token}`;
                console.log('Token de autenticación encontrado para guardar título');
              }
            } catch (e) {
              console.warn('Error al leer token de localStorage:', e);
            }
          }
        }

        const res = await fetch('/api/chat', {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ conversationId: editingConvId, title: editingTitle.trim() }),
        });

        if (!res.ok) {
          console.error('Error al guardar título:', res.statusText);
          return;
        }

        // Actualizar localmente
        setConversations((prev) =>
          prev.map((c) => (c.id === editingConvId ? { ...c, title: editingTitle.trim() } : c))
        );

        triggerRefreshConversations();
        console.log('Título guardado exitosamente');
      } catch (error) {
        console.error('Error al guardar título:', error);
      }
    }
    setEditingConvId(null);
    setEditingTitle('');
  };

  const cancelEditing = () => {
    setEditingConvId(null);
    setEditingTitle('');
  };

  const loadConversation = async (id: string) => {
    console.log('Cargando conversación:', id);
    try {
      await loadConv(id);
      console.log('Conversación cargada exitosamente');
    } catch (error) {
      console.error('Error al cargar conversación:', error);
    }
  };

  const deleteConversation = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    console.log('Eliminando conversación:', id);
    if (!confirm(t('deleteConversationConfirm'))) return;

    try {
      // Obtener token de PocketBase para autenticación
      let headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      if (typeof window !== 'undefined') {
        const pbAuth = localStorage.getItem('pb_auth');
        if (pbAuth) {
          try {
            const authData = JSON.parse(pbAuth);
            if (authData.token) {
              headers['Authorization'] = `Bearer ${authData.token}`;
              console.log('Token de autenticación encontrado para eliminar');
            }
          } catch (e) {
            console.warn('Error al leer token de localStorage:', e);
          }
        }
      }

      const res = await fetch(`/api/chat?conversationId=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers
      });

      if (!res.ok) {
        console.error('Error al eliminar:', res.statusText);
        return;
      }

      if (conversationId === id) {
        console.log('La conversación eliminada era la actual, iniciando nuevo chat');
        startNewChat();
      }

      triggerRefreshConversations();
      setConversations((prev) => prev.filter((c) => c.id !== id));
      console.log('Conversación eliminada exitosamente');
    } catch (error) {
      console.error('Error al eliminar conversación:', error);
    }
  };

  const startCreatingNew = () => {
    setIsCreatingNew(true);
    setNewConvTitle(t('newConversation'));
  };

  const createNewConversation = () => {
    console.log('🆕 Iniciando nueva conversación con título:', newConvTitle);
    // Iniciar nuevo chat en el contexto (limpia mensajes e ID)
    startNewChat();
    // Guardar el título para cuando se envíe el primer mensaje
    setPendingConversationTitle(newConvTitle.trim() || null);
    // Limpiar estados locales de UI
    setNewConvTitle('');
    setIsCreatingNew(false);
    // Asegurar que el input esté vacío para la nueva conversación
    setInput('');
    console.log('✅ Nuevo chat listo con título pendiente');
  };

  const cancelCreatingNew = () => {
    setNewConvTitle('');
    setIsCreatingNew(false);
  };

  // Función para cargar todas las conversaciones
  const loadConversations = useCallback(async () => {
    setLoadingConversations(true);
    try {
      console.log('🔄 Obteniendo conversaciones en panel lateral...');

      // Obtener token de PocketBase para autenticación
      let headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      // Intentar obtener el token del localStorage (donde PocketBase lo guarda)
      if (typeof window !== 'undefined') {
        const pbAuth = localStorage.getItem('pb_auth');
        if (pbAuth) {
          try {
            const authData = JSON.parse(pbAuth);
            if (authData.token) {
              headers['Authorization'] = `Bearer ${authData.token}`;
              console.log('✅ Token de autenticación encontrado para el historial');
            }
          } catch (e) {
            console.warn('⚠️ Error al leer token de localStorage:', e);
          }
        }
      }

      const res = await fetch('/api/chat', { headers });
      console.log('📡 Response status (historial):', res.status);
      if (!res.ok) {
        console.error('❌ Error en respuesta del historial:', res.statusText);
        setConversations([]);
        return;
      }

      const data = await res.json();
      console.log('📋 Conversaciones recibidas en panel:', data);

      const items = (data.conversations || []).map((c: any) => ({
        id: c.id,
        title: c.title || `Conversación ${c.id.slice(0, 8)}`,
        created: c.created,
        updatedAt: c.updated,
        messageCount: c.messageCount || 0,
        lastMessage: c.lastMessage || null
      }));

      setConversations(items);
      console.log('✅ Conversaciones procesadas en panel:', items.length);
    } catch (error) {
      console.error('❌ Error al cargar conversaciones:', error);
      setConversations([]);
    } finally {
      setLoadingConversations(false);
    }
  }, []);

  // Escuchar mensajes externos (ej. errores del editor)
  useEffect(() => {
    if (externalMessage) {
      console.log('Mensaje externo recibido:', externalMessage);
      console.log('Modelo seleccionado:', selectedModel);

      setOpen(true);

      // Usamos un pequeño delay para asegurar que el estado 'open' se propague
      // y que tengamos un modelo seleccionado antes de intentar enviar
      const timer = setTimeout(() => {
        if (selectedModel) {
          // Si hay un modelo, intentamos enviar directamente usando el mensaje externo
          console.log('Enviando mensaje directo a Zeus');
          sendDirectMessage(externalMessage);
          clearExternalMessage();
        } else {
          // Si no hay modelo, solo ponemos el texto en el input
          setInput(externalMessage);
          clearExternalMessage();
        }
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [externalMessage, selectedModel, clearExternalMessage]);

  // En Electron/Chromium las voces se cargan de forma asíncrona; prepararlas al abrir el chat.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    
    let retryCount = 0;
    const maxRetries = 10;

    const pickVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length === 0 && retryCount < maxRetries) {
        retryCount++;
        setTimeout(pickVoice, 200);
        return;
      }

      setAvailableVoices(voices);
      
      const savedVoiceURI = localStorage.getItem('zeus_voice_uri');
      if (savedVoiceURI) {
        const found = voices.find(v => v.voiceURI === savedVoiceURI);
        if (found) {
          voiceRef.current = found;
          setSelectedVoiceURI(savedVoiceURI);
        }
      }

      if (!voiceRef.current && voices.length > 0) {
        // Preferencia: Voces en español populares o la primera disponible
        const es = voices.find((v) => v.lang.startsWith('es') && /alvaro|helena|monica|laura|paulina|conchita/i.test(v.name)) 
                || voices.find((v) => v.lang.startsWith('es'))
                || voices[0];
        
        voiceRef.current = es || null;
        if (voiceRef.current) setSelectedVoiceURI(voiceRef.current.voiceURI);
      }
    };

    pickVoice();
    
    // El evento onvoiceschanged es crucial en Chromium/Electron
    window.speechSynthesis.onvoiceschanged = pickVoice;
    
    const savedRate = localStorage.getItem('zeus_voice_rate');
    if (savedRate) setVoiceRate(parseFloat(savedRate));
    const savedPitch = localStorage.getItem('zeus_voice_pitch');
    if (savedPitch) setVoicePitch(parseFloat(savedPitch));

    return () => {
      if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = null;
    };
  }, [open]);

  // Detectar selección de texto en el chat
  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      const hasText = selection && selection.toString().trim().length > 0;
      setHasSelection(Boolean(hasText));
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, []);


  const scrollToBottom = useCallback(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  // Flag: ¿el usuario ha subido manualmente (wheel/touch hacia arriba)?
  const userScrolledUpRef = useRef(false);

  // Detectar la INTENCIÓN del usuario:
  //  - rueda/gesto hacia arriba → quiere leer algo más arriba → pausar auto-scroll
  //  - vuelve al fondo → reanudar auto-scroll
  useEffect(() => {
    const container = messagesEndRef.current?.parentElement;
    if (!container || !open) return;

    const onScroll = () => {
      const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 40;
      if (atBottom) userScrolledUpRef.current = false;
    };
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) userScrolledUpRef.current = true;
    };
    const onTouchMove = (e: TouchEvent) => {
      const touch = e.touches?.[0];
      if (touch && touch.clientY > 0) {
        // Detectar arrastre hacia abajo (subir contenido): comparar con la posición previa
        const prev = lastTouchYRef.current ?? touch.clientY;
        if (touch.clientY > prev) userScrolledUpRef.current = true;
        lastTouchYRef.current = touch.clientY;
      }
    };
    const lastTouchYRef = { current: 0 };

    container.addEventListener('scroll', onScroll);
    container.addEventListener('wheel', onWheel, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: true });
    return () => {
      container.removeEventListener('scroll', onScroll);
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('touchmove', onTouchMove);
    };
  }, [open]);

  // Scroll automático: baja SIEMPRE que el usuario NO haya subido manualmente.
  // Si subió para leer, se respeta su posición hasta que vuelva al fondo.
  const smartScrollToBottom = useCallback(() => {
    const end = messagesEndRef.current;
    if (!end) return;
    if (userScrolledUpRef.current) return; // usuario subió → no forzar
    end.scrollIntoView({ behavior: 'auto' });
  }, []);

  const copyChatSelection = () => {
    console.log('copyChatSelection called');
    const selection = window.getSelection();
    console.log('Selection:', selection);
    console.log('Selection text:', selection?.toString());
    console.log('Selection length:', selection?.toString().trim().length);
    if (selection && selection.toString().trim().length > 0) {
      console.log('Attempting to copy to clipboard...');
      safeWriteClipboard(selection.toString()).then((ok) => {
        if (ok) {
          console.log('Text copied to clipboard successfully');
          setHasSelection(false);
          selection.removeAllRanges();
        } else {
          console.error('Error copying to clipboard');
        }
      });
    } else {
      console.log('No selection found or empty selection');
    }
  };

  // Scroll automático inicial al abrir el chat
  useEffect(() => {
    if (open) {
      // Un pequeño retraso para asegurar que la animación de apertura ha terminado y el DOM está listo
      const timer = setTimeout(() => scrollToBottom(), 100);
      return () => clearTimeout(timer);
    }
  }, [open, scrollToBottom]);

  // Scroll cuando cambian los mensajes o el estado de carga.
  // Usa la versión INTELIGENTE: si el usuario subió para leer, no le fuerza
  // el scroll hacia abajo mientras el modelo escribe.
  useEffect(() => {
    smartScrollToBottom();
    // Pequeño delay para asegurar que el DOM se ha actualizado tras el renderizado de componentes complejos
    const timer = setTimeout(smartScrollToBottom, 50);
    return () => clearTimeout(timer);
  }, [messages, loading, showTerminal, messageCodeBubbles, smartScrollToBottom]);

  // Restaurar burbujas de código desde metadata persistida al recargar conversación.
  useEffect(() => {
    setMessageCodeBubbles((prev) => {
      const next: Record<string, MessageCodeBubble[]> = {};

      messages.forEach((msg) => {
        const msgId = msg.id;
        if (!msgId) return;

        const current = prev[msgId] || [];
        if (current.length > 0) {
          next[msgId] = current;
          return;
        }

        const fileInfo = parseMaybeJson((msg as any).fileInfo);
        const persistedBubbles = Array.isArray(fileInfo?.codeBubbles) ? fileInfo.codeBubbles : [];
        const hydratedFromFileInfo = persistedBubbles
          .filter((b: any) => typeof b?.code === 'string' && b.code.trim().length > 0)
          .map((b: any) => ({
            code: b.code,
            language: typeof b?.language === 'string' && b.language ? b.language : 'typescript',
            fileName: typeof b?.fileName === 'string' ? b.fileName : '',
            isVisible: true,
          }));

        if (hydratedFromFileInfo.length > 0) {
          next[msgId] = hydratedFromFileInfo;
          return;
        }

        // Fallback robusto: reconstruir desde originalContent si existe.
        const originalContent = typeof fileInfo?.originalContent === 'string' ? fileInfo.originalContent : '';
        const reconstructed = buildCodeBubblesFromOriginalContent(originalContent);
        if (reconstructed.length > 0) {
          next[msgId] = reconstructed;
          return;
        }

        // Último fallback para conversaciones antiguas con markdown fenced code.
        const fromRenderedContent = buildCodeBubblesFromOriginalContent(typeof msg.content === 'string' ? msg.content : '');
        if (fromRenderedContent.length > 0) {
          next[msgId] = fromRenderedContent;
        }
      });

      return next;
    });
  }, [messages]);

  // Observar cambios de tamaño en el contenedor de mensajes (para mensajes que crecen)
  useEffect(() => {
    const container = messagesEndRef.current?.parentElement;
    if (!container) return;

    const resizeObserver = new ResizeObserver(() => {
      scrollToBottom();
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [scrollToBottom]);

  const providerRaw = (selectedModel?.provider as string)?.toLowerCase() || '';
  const provider = providerRaw.includes('ollama cloud')
    ? 'Ollama Cloud'
    : providerRaw.includes('deepseek')
      ? 'Deepseek'
      : providerRaw.includes('ollama')
        ? 'Ollama'
        : (providerRaw.includes('lm studio') || providerRaw === 'local')
          ? 'LM Studio'
          : 'OpenAI';
  const modelId = (selectedModel?.model_name as string) || (selectedModel?.name as string) || 'gpt-4';
  const modelStreamEnabled = selectedModel?.config?.stream === true || (selectedModel as { stream?: boolean })?.stream === true;
  const streamEnabled = isStreamingEnabled || modelStreamEnabled;
  const normalizedModelId = modelId.toLowerCase();
  const strictLowModelKeywords = [
    '0.5b',
    '1b',
    'tiny',
    'mini',
    'small',
    'qwen2.5:0.5b',
    'qwen2.5:1.5b'
  ];
  const isStrictLowModel = provider === 'Ollama' && strictLowModelKeywords.some((keyword) => normalizedModelId.includes(keyword));

  const [isStreaming, setIsStreaming] = useState(false);
  const currentPlaybackIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const stopGeneration = () => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
    }
    
    // Limpiar intervalo de streaming inmediatamente
    if (currentPlaybackIntervalRef.current) {
      clearInterval(currentPlaybackIntervalRef.current);
      currentPlaybackIntervalRef.current = null;
    }
    
    setLoading(false);
    setIsStreaming(false);
    stopSpeaking();
    setSpeakingIndex(null);
  };

  // Limpiar el intervalo de playback al desmontar.
  // Sin esto, un hot-reload deja el setInterval anterior vivo disparando
  // setMessages sobre una instancia obsoleta -> "Maximum update depth exceeded".
  useEffect(() => {
    return () => {
      if (currentPlaybackIntervalRef.current) {
        clearInterval(currentPlaybackIntervalRef.current);
        currentPlaybackIntervalRef.current = null;
      }
    };
  }, []);

  const getAuthHeaders = useCallback(() => {
    let headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (typeof window !== 'undefined') {
      const authDataString = localStorage.getItem('pb_auth') || localStorage.getItem('pocketbase_auth');
      if (authDataString) {
        try {
          const authData = JSON.parse(authDataString);
          if (authData.token) {
            headers['Authorization'] = `Bearer ${authData.token}`;
            console.log('✅ Token de autenticación recuperado para la petición');
          }
        } catch (e) {
          console.warn('⚠️ Error al leer token de localStorage:', e);
        }
      }
    }
    return headers;
  }, []);

  const isFileUpdate = (callDef: any) => {
    const url = callDef.url || '';
    const method = (callDef.method || '').toUpperCase();

    // Detectar actualización completa (PUT /files/:name)
    const isFullFilePut = method === 'PUT' && /\/api\/files\/[^/]+(\?.*)?$/.test(url) && !url.includes('/lines');

    // Detectar modificación de líneas (POST o PUT /files/:name/lines)
    const isLinesUpdate = (method === 'POST' || method === 'PUT') && /\/api\/files\/[^/]+\/lines/.test(url);

    // Detectar modificación de caracteres (PUT /files/:name/lines/:n/chars)
    const isCharsUpdate = method === 'PUT' && /\/api\/files\/[^/]+\/lines\/\d+\/chars/.test(url);

    return isFullFilePut || isLinesUpdate || isCharsUpdate;
  };

  const looksLikePartialFullFileReplacement = (originalContent: string, proposedContent: string) => {
    if (!originalContent || !proposedContent) return false;

    const originalTrim = originalContent.trim();
    const proposedTrim = proposedContent.trim();

    if (!originalTrim || !proposedTrim) return false;

    const originalLines = originalTrim.split('\n').length;
    const proposedLines = proposedTrim.split('\n').length;

    const isLargeOriginal = originalLines >= 40 || originalTrim.length >= 2000;
    const isMuchSmaller = proposedTrim.length < originalTrim.length * 0.6 || proposedLines < Math.max(4, Math.floor(originalLines * 0.4));
    const isIncludedSnippet = originalTrim.includes(proposedTrim);
    const isDangerouslySmallForLargeFile = isLargeOriginal && (proposedTrim.length < originalTrim.length * 0.75 || proposedLines < Math.floor(originalLines * 0.7));

    return (isMuchSmaller && isIncludedSnippet) || isDangerouslySmallForLargeFile;
  };

  const buildProposedContentFromCall = (callDef: any, originalContent: string) => {
    const method = (callDef?.method || '').toUpperCase();
    const rawUrl = String(callDef?.url || '');
    const body = callDef?.body || {};

    let pathname = rawUrl;
    try {
      pathname = new URL(rawUrl, 'http://localhost').pathname;
    } catch {
      pathname = rawUrl;
    }

    const originalLines = originalContent.split('\n');

    // PUT /api/files/:name => normalmente reemplazo completo
    if (method === 'PUT' && /\/api\/files\/[^/]+$/.test(pathname) && !pathname.includes('/lines')) {
      const proposed = typeof body.content === 'string' ? body.content : '';
      if (looksLikePartialFullFileReplacement(originalContent, proposed)) {
        return {
          content: originalContent,
          warning: t('partialProposalBlocked'),
          blocked: true
        };
      }

      return { content: proposed || originalContent, warning: null, blocked: false };
    }

    // POST|PUT /api/files/:name/lines => insertar líneas
    if ((method === 'POST' || method === 'PUT') && /\/api\/files\/[^/]+\/lines$/.test(pathname)) {
      const next = [...originalLines];
      const insertLine = body.lineNumber ? Number(body.lineNumber) : next.length + 1;
      const safeInsertLine = Number.isFinite(insertLine) ? Math.max(1, Math.min(insertLine, next.length + 1)) : next.length + 1;
      const newLines = String(body.content || '').split('\n');
      next.splice(safeInsertLine - 1, 0, ...newLines);
      return { content: next.join('\n'), warning: null, blocked: false };
    }

    // PUT /api/files/:name/lines/:lineNumber => reemplazar líneas
    const replaceLinesMatch = pathname.match(/\/api\/files\/[^/]+\/lines\/(\d+)$/);
    if (method === 'PUT' && replaceLinesMatch) {
      const next = [...originalLines];
      const lineNum = Number(replaceLinesMatch[1]);
      const linesToDelete = body.numLines ? Number(body.numLines) : 1;
      const safeLine = Number.isFinite(lineNum) ? Math.max(1, Math.min(lineNum, next.length)) : 1;
      const safeDelete = Number.isFinite(linesToDelete) ? Math.max(1, linesToDelete) : 1;
      const newLines = String(body.content || '').split('\n');
      next.splice(safeLine - 1, safeDelete, ...newLines);
      return { content: next.join('\n'), warning: null, blocked: false };
    }

    // POST /api/files/:name/lines/:lineNumber/chars => insertar chars
    const charsLineMatch = pathname.match(/\/api\/files\/[^/]+\/lines\/(\d+)\/chars$/);
    if (charsLineMatch && method === 'POST') {
      const next = [...originalLines];
      const lineNum = Number(charsLineMatch[1]);
      const safeLine = Number.isFinite(lineNum) ? Math.max(1, Math.min(lineNum, next.length)) : 1;
      const line = next[safeLine - 1] ?? '';
      const insertPosRaw = Number(body.position);
      const insertPos = Number.isFinite(insertPosRaw) ? Math.max(0, Math.min(insertPosRaw, line.length)) : line.length;
      const insertContent = String(body.content || '');
      next[safeLine - 1] = line.slice(0, insertPos) + insertContent + line.slice(insertPos);
      return { content: next.join('\n'), warning: null, blocked: false };
    }

    // PUT /api/files/:name/lines/:lineNumber/chars => reemplazar chars
    if (charsLineMatch && method === 'PUT') {
      const next = [...originalLines];
      const lineNum = Number(charsLineMatch[1]);
      const safeLine = Number.isFinite(lineNum) ? Math.max(1, Math.min(lineNum, next.length)) : 1;
      const line = next[safeLine - 1] ?? '';
      const startRaw = Number(body.startCharIndex);
      const endRaw = Number(body.endCharIndex);
      const start = Number.isFinite(startRaw) ? Math.max(0, Math.min(startRaw, line.length)) : 0;
      const end = Number.isFinite(endRaw) ? Math.max(start, Math.min(endRaw, line.length)) : start;
      const replaceContent = String(body.content || '');
      next[safeLine - 1] = line.slice(0, start) + replaceContent + line.slice(end);
      return { content: next.join('\n'), warning: null, blocked: false };
    }

    return {
      content: typeof body.content === 'string' && body.content.length > 0 ? body.content : originalContent,
      warning: null,
      blocked: false
    };
  };

  const sendDirectMessage = async (text: string) => {
    if (!text.trim() || !selectedModel) return;

    // Cancelar cualquier generación anterior
    if (abortController) {
      abortController.abort();
    }

    const controller = new AbortController();
    setAbortController(controller);

    const userMessage: ChatMessage = createChatMessage('user', text);
    setMessages((m) => [...m, userMessage]);
    setLoading(true);

    await processChatFlow(text, controller);
  };

  // Función para obtener el esquema del directorio DATA_PATH
  const getDirectorySchema = async () => {
    try {
      const response = await sessionFetch('/api/schema/simple');
      if (!response.ok) {
        console.error('Error al obtener esquema:', response.statusText);
        return null;
      }
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error al obtener esquema del directorio:', error);
      return null;
    }
  };

  const handleApplyCodeChange = useCallback(async (jsonText: string, sourceMessageId?: string): Promise<{ ok: boolean; message: string }> => {
    try {
      const parsed = JSON.parse(jsonText);
      if (parsed.type !== 'code_change' || !Array.isArray(parsed.changes)) {
        return { ok: false, message: t('invalidCodeChangeJSON') };
      }

      const schemaData = await getDirectorySchema();
      const results: string[] = [];

      for (const change of parsed.changes) {
        const rawFileField = change.file || 'archivo.ts';
        const lastSlashIdx = rawFileField.replace(/\\/g, '/').lastIndexOf('/');
        const fileName = lastSlashIdx >= 0 ? rawFileField.slice(lastSlashIdx + 1) : rawFileField;
        const inferredPath = lastSlashIdx >= 0 ? rawFileField.slice(0, lastSlashIdx) : '';
        const changePath = change.path || inferredPath;

        // Intentar encontrar el archivo probando varias rutas candidatas
        let resolvedFilePath = '';
        let originalContent = '';
        let found = false;

        const candidates: string[] = [];

        // 1. Archivo activo
        if (typeof activeFile === 'string' && activeFile.endsWith(`/${fileName}`)) {
          candidates.push(activeFile.slice(0, -(`/${fileName}`).length));
        }

        // 2. Ruta del JSON
        if (changePath && typeof changePath === 'string') {
          let normalized = changePath.replace(/\\/g, '/').trim().replace(/\/+$/, '');
          if (normalized) candidates.push(normalized);
        }

        // 3. Buscar en el schema
        if (schemaData?.success && schemaData?.schema) {
          const foundPaths: string[] = [];
          const walk = (node: any, currentPath: string, isRoot: boolean) => {
            if (!node || typeof node !== 'object') return;
            const nodeType = node.type;
            const nodeName = typeof node.name === 'string' ? node.name : '';
            if (nodeType === 'directory') {
              const nextPath = isRoot ? currentPath : (currentPath ? `${currentPath}/${nodeName}` : nodeName);
              if (Array.isArray(node.children)) {
                node.children.forEach((child: any) => walk(child, nextPath, false));
              }
            } else if (nodeType === 'file' && nodeName === fileName) {
              foundPaths.push(currentPath.replace(/^\/+/, '').replace(/\/+$/, ''));
            }
          };
          walk(schemaData.schema, '', true);
          for (const p of Array.from(new Set(foundPaths))) {
            if (!candidates.includes(p)) candidates.push(p);
          }
        }

        // 4. Raíz
        if (!candidates.includes('')) candidates.push('');

        // Probar cada candidato
        for (const candidatePath of candidates) {
          try {
            const getRes = await sessionFetch(`/api/ide-files?name=${encodeURIComponent(fileName)}&path=${encodeURIComponent(candidatePath)}`);
            const getResult = await getRes.json();
            if (getRes.ok && getResult?.success) {
              resolvedFilePath = candidatePath;
              originalContent = typeof getResult.content === 'string' ? getResult.content : '';
              found = true;
              break;
            }
          } catch {
            // ignore
          }
        }

        if (!found) {
          results.push(`❌ ${fileName}: no se encontró (rutas probadas: ${candidates.join(', ')})`);
          continue;
        }

        // Bug 4 fix: Normalize CRLF → LF for consistent matching on Windows
        let newContent = originalContent.replace(/\r\n/g, '\n');
        const normalizedReplacements: { old: string; new: string }[] = [];
        let failedReplacements: string[] = [];
        for (const rep of (change.replacements || [])) {
          const oldStr = (rep.old || '').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\r\n/g, '\n');
          const newStr = (rep.new || '').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\r\n/g, '\n');
          normalizedReplacements.push({ old: oldStr, new: newStr });
          // Bug 1 + Bug 2 fix: Use smartReplace instead of String.replace()
          const sr = smartReplace(newContent, oldStr, newStr);
          if (sr.applied) {
            newContent = sr.result;
            console.log(`[handleApplyCodeChange] Replacement applied via ${sr.method} (occurrences=${sr.occurrences})`);
          } else {
            failedReplacements.push(oldStr.substring(0, 60));
            console.warn(`[handleApplyCodeChange] Replacement FAILED for:`, oldStr.substring(0, 80));
          }
        }
        if (failedReplacements.length > 0) {
          results.push(`⚠️ ${fileName}: ${failedReplacements.length} replacement(s) no coincidieron (se aplicaron los demás)`);
          // Don't skip entirely - still apply the replacements that DID match
        }

        // En lugar de guardar directamente, encolar para que el editor muestre las diferencias (rojo/verde)
        addCorrection({
          file: fileName,
          path: resolvedFilePath,
          originalContent,
          newContent,
          changes: [],
          type: 'file',
          replacements: normalizedReplacements
        });
        // Mark as applied so the button shows "Aplicado"
        if (sourceMessageId) {
          const codeChangeKey = `${sourceMessageId}:cc:${fileName}`;
          setAppliedCodeChanges(prev => ({ ...prev, [codeChangeKey]: true }));
        }
        results.push(`📋 ${fileName}: abriendo en el editor para revisión...`);
      }
      return { ok: true, message: results.join('\n') };
    } catch (e: any) {
      return { ok: false, message: `Error procesando code_change: ${e.message}` };
    }
  }, [activeFile, addCorrection]);

  // Función para formatear el esquema como texto para el contexto
  const formatSchemaForContext = (schema: any, depth = 0): string => {
    if (!schema) return '';

    const indent = '  '.repeat(depth);
    let result = '';

    if (schema.type === 'directory') {
      result += `${indent}**${schema.name}** (carpeta)\n`;
      if (schema.children && schema.children.length > 0) {
        schema.children.forEach((child: any) => {
          result += formatSchemaForContext(child, depth + 1);
        });
      }
    } else if (schema.type === 'file') {
      const sizeInfo = schema.size ? ` (${(schema.size / 1024).toFixed(1)}KB)` : '';
      result += `${indent}**${schema.name}**${sizeInfo}\n`;
    }

    return result;
  };

  const sendMessage = async () => {
    const text = input.trim();
    const hasContent = text || attachedFiles.length > 0;
    if (!hasContent) return;

    // Verificar autenticación antes de enviar
    if (!authUser) {
      const userMsg = createChatMessage('user', text);
      const assistantMsg = createChatMessage('assistant',
        '⚠️ **No hay sesión activa.**\n\nPara usar el chat debes iniciar sesión primero:\n\n1. Pulsa el botón **⚙️** (configuración) en la barra superior\n2. Ve a la pestaña **Usuario**\n3. Inicia sesión con tu email y contraseña\n\nSi no tienes cuenta, puedes registrarte ahí mismo.'
      );
      setMessages((m) => [...m, userMsg, assistantMsg]);
      setInput('');
      setAttachedFiles([]);
      return;
    }

    if (!selectedModel) {
      const userReminder = createChatMessage('user', text + (attachedFiles.length ? ` [Adjuntos: ${attachedFiles.map((f) => f.name).join(', ')}]` : ''));
      const assistantReminder = createChatMessage('assistant', t('selectModelToChat'));
      setMessages((m) => [...m, userReminder, assistantReminder]);
      setInput('');
      setAttachedFiles([]);
      return;
    }

    // Cancelar cualquier generación anterior
    if (abortController) {
      abortController.abort();
    }

    const controller = new AbortController();
    setAbortController(controller);

    const fileNames = attachedFiles.map((f) => f.name).join(', ');
    const contentWithFiles = fileNames ? (text ? `${text}\n[Archivos adjuntos: ${fileNames}]` : `[Archivos adjuntos: ${fileNames}]`) : text;
    setInput('');
    setAttachedFiles([]);
    const userMessage: ChatMessage = createChatMessage('user', contentWithFiles);
    setMessages((m) => [...m, userMessage]);
    setLoading(true);

    await processChatFlow(contentWithFiles, controller);
  };

  const stopSpeaking = () => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    speechSynthRef.current = null;
    setSpeakingIndex(null);
    setIsPaused(false);
  };

  const togglePauseSpeaking = () => {
    if (typeof window === 'undefined' || !window.speechSynthesis || speakingIndex === null) return;
    if (isPaused) {
      window.speechSynthesis.resume();
      setIsPaused(false);
    } else {
      window.speechSynthesis.pause();
      setIsPaused(true);
    }
  };

  const speakMessage = (index: number, text: string, charOffset: number = 0) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const plainText = cleanTextForTTS(text);
    if (!plainText) return;

    // Guardar el texto plano para este mensaje
    messagePlainTextMap.current.set(index, plainText);

    // Si estamos reproduciendo el mismo mensaje y no hay offset, pausar/reanudar
    if (speakingIndex === index && charOffset === 0) {
      togglePauseSpeaking();
      return;
    }

    stopSpeaking();

    // Si hay un offset, empezar desde esa posición
    const textToSpeak = charOffset > 0 && charOffset < plainText.length
      ? plainText.substring(charOffset)
      : plainText;

    if (!textToSpeak.trim()) return;

    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.lang = voiceRef.current?.lang || 'es-ES';
    utterance.rate = voiceRate;
    utterance.pitch = voicePitch;
    if (voiceRef.current) utterance.voice = voiceRef.current;

    // Track character position during speech
    let currentOffset = charOffset;
    utterance.onboundary = (event: SpeechSynthesisEvent) => {
      if (event.name === 'word' && typeof event.charIndex === 'number') {
        currentOffset = charOffset + event.charIndex;
      }
    };

    utterance.onend = () => {
      setSpeakingIndex(null);
      setIsPaused(false);
    };

    speechSynthRef.current = utterance;
    window.speechSynthesis.speak(utterance);
    setSpeakingIndex(index);
    setIsPaused(false);
  };

  // Handle click on message text to jump to specific position
  const handleTextClick = (index: number, event: React.MouseEvent<HTMLDivElement>) => {
    if (speakingIndex !== index) return; // Only handle clicks during playback

    const plainText = messagePlainTextMap.current.get(index);
    if (!plainText) return;

    // Get click position relative to text element
    const rect = event.currentTarget.getBoundingClientRect();
    const clickY = event.clientY - rect.top;
    const totalHeight = rect.height;

    // Estimate character offset based on click position (rough approximation)
    const clickRatio = clickY / totalHeight;
    const estimatedOffset = Math.floor(plainText.length * clickRatio);

    // Restart speech from clicked position
    speakMessage(index, plainText, estimatedOffset);
  };

  const processChatFlow = async (textContent: string, controller: AbortController) => {
    const contextParts: string[] = [];
    // ... rest of prompt logic ...

    // Obtener y agregar el esquema del directorio al contexto
    const schemaData = await getDirectorySchema();
    let schemaContext = '';
    if (schemaData && schemaData.success) {
      schemaContext = `## ESQUEMA DEL DIRECTORIO DATA_PATH
**Ruta:** ${schemaData.dataPath}
**Generado:** ${new Date(schemaData.generatedAt).toLocaleString('es-ES')}

**Estructura de archivos y carpetas:**
${formatSchemaForContext(schemaData.schema)}

---

`;
    } else {
      schemaContext = `## ESQUEMA DEL DIRECTORIO DATA_PATH
No se pudo obtener el esquema del directorio. El modelo no tendrá acceso a la estructura de archivos actual.

---

`;
    }

    const normalizeApiFolderPath = (rawPath: unknown, fileName: string) => {
      if (typeof rawPath !== 'string') return '';

      let normalized = rawPath.replace(/\\/g, '/').trim();
      if (!normalized) return '';

      normalized = normalized.replace(/^file:\/\//i, '').replace(/\/+$/, '');

      if (!normalized) return '';
      if (normalized.endsWith(`/${fileName}`)) {
        normalized = normalized.slice(0, -(`/${fileName}`).length);
      }

      const dataPathRaw = typeof schemaData?.dataPath === 'string' ? schemaData.dataPath : '';
      const dataPath = dataPathRaw.replace(/\\/g, '/').replace(/\/+$/, '');

      if (dataPath) {
        const lowerNormalized = normalized.toLowerCase();
        const lowerDataPath = dataPath.toLowerCase();

        if (lowerNormalized === lowerDataPath) {
          normalized = '';
        } else if (lowerNormalized.startsWith(`${lowerDataPath}/`)) {
          normalized = normalized.slice(dataPath.length + 1);
        }
      } else {
        const isWindowsAbsolute = /^[a-zA-Z]:\//.test(normalized);
        const isUnixAbsolute = normalized.startsWith('/');

        if (isWindowsAbsolute || isUnixAbsolute) {
          const parts = normalized.split('/').filter(Boolean);
          if (parts.length > 0) {
            normalized = parts[parts.length - 1] || normalized;
          }
        }
      }

      normalized = normalized.replace(/^\/+/, '').replace(/\/+$/, '');
      if (!normalized || normalized === '.' || normalized === fileName) return '';

      return normalized;
    };

    const getSchemaCandidatePaths = (fileName: string, rawPath: unknown) => {
      if (!schemaData?.success || !schemaData?.schema) return [] as string[];

      const normalizedRawPath = normalizeApiFolderPath(rawPath, fileName).toLowerCase();
      const foundPaths: string[] = [];

      const walk = (node: any, currentPath: string, isRoot: boolean) => {
        if (!node || typeof node !== 'object') return;

        const nodeType = node.type;
        const nodeName = typeof node.name === 'string' ? node.name : '';

        if (nodeType === 'directory') {
          const nextPath = isRoot
            ? currentPath
            : (currentPath ? `${currentPath}/${nodeName}` : nodeName);

          if (Array.isArray(node.children)) {
            node.children.forEach((child: any) => walk(child, nextPath, false));
          }
          return;
        }

        if (nodeType === 'file' && nodeName === fileName) {
          foundPaths.push(currentPath.replace(/^\/+/, '').replace(/\/+$/, ''));
        }
      };

      walk(schemaData.schema, '', true);

      const unique = Array.from(new Set(foundPaths));
      if (!normalizedRawPath) return unique;

      return unique.sort((a, b) => {
        const aScore = a.toLowerCase().includes(normalizedRawPath) ? 1 : 0;
        const bScore = b.toLowerCase().includes(normalizedRawPath) ? 1 : 0;
        return bScore - aScore;
      });
    };

    const resolveExistingFileContext = async (fileName: string, rawPath: unknown) => {
      // Priorizar SIEMPRE el archivo activo actual como primer candidato
      const activeFileFolder = typeof activeFile === 'string' && activeFile.endsWith(`/${fileName}`)
        ? activeFile.slice(0, -(`/${fileName}`).length)
        : '';

      // Normalizar rawPath si existe
      const rawPathFolder = rawPath && typeof rawPath === 'string' && rawPath.trim() !== ''
        ? normalizeApiFolderPath(rawPath, fileName)
        : '';

      const schemaCandidates = getSchemaCandidatePaths(fileName, rawPath);

      // Orden de prioridad: 1) activeFileFolder, 2) rawPathFolder, 3) schema candidates, 4) raíz
      const candidatePaths = Array.from(new Set([
        activeFileFolder,  // Priorizar archivo activo
        rawPathFolder,
        ...schemaCandidates,
        ''
      ])).filter(p => p !== null && p !== undefined);

      console.log('[resolveExistingFileContext] Buscando:', { fileName, activeFile, activeFileFolder, rawPathFolder, candidates: candidatePaths });

      for (const candidatePath of candidatePaths) {
        try {
          const getRes = await sessionFetch(`/api/ide-files?name=${encodeURIComponent(fileName)}&path=${encodeURIComponent(candidatePath)}`);
          const getResult = await getRes.json();

          if (getRes.ok && getResult?.success) {
            console.log('[resolveExistingFileContext] Encontrado en:', candidatePath);
            return {
              found: true,
              filePath: candidatePath,
              originalContent: typeof getResult.content === 'string' ? getResult.content : ''
            };
          }
        } catch (e) {
          console.warn('[resolveExistingFileContext] Error en', candidatePath, e);
        }
      }

      console.warn('[resolveExistingFileContext] No encontrado, devolviendo:', rawPathFolder);
      return {
        found: false,
        filePath: rawPathFolder,
        originalContent: ''
      };
    };

    contextParts.push(schemaContext);

    // Preparar el contexto oculto del editor para anexarlo al mensaje del usuario si existe
    let hiddenContextToInject = '';
    if (hiddenContext) {
      hiddenContextToInject = `\n\n${hiddenContext}`;
      clearHiddenContext();
    }

    contextParts.push(`Eres un asistente de IA especializado en desarrollo de software. Tu tarea es utilizar una API que te permite manipular y crear aplicaciones completas mediante operaciones sobre carpetas, archivos, líneas de código y caracteres.

## OBJETIVO
Debes ser capaz de crear, modificar y organizar proyectos de software completos utilizando los endpoints de la API. Piensa como un desarrollador que construye aplicaciones paso a paso.

## URL BASE DE LA API
/api

## FORMATO DE LAS PETICIONES
TODAS las peticiones deben enviarse en formato: application/x-www-form-urlencoded (usando bloques [ZEUS_API_CALL]).

## REGLAS CRÍTICAS
1. Sé extremadamente breve y directo. No expliques lo que puedes hacer al iniciar. Solo responde a lo que el usuario te pida.
2. **AUTONOMÍA TOTAL**: NO pidas permiso para realizar acciones (ej: NO digas "¿puedo buscar el archivo?", "procederé a...", "¿te parece bien?", "¿quieres que continúe?"). Simplemente EJECUTA la acción necesaria.
3. **CONTINUACIÓN AUTOMÁTICA**: Si después de tu mensaje actual tienes que realizar otra acción (buscar un archivo, editar código, ejecutar un comando), DEBES añadir obligatoriamente el marcador [CONTINUAR] al final de tu mensaje. SIEMPRE. NUNCA esperes confirmación del usuario.
3b. **FIN DE TAREA**: Solo cuando hayas completado TODAS las acciones necesarias y no quede nada más por hacer, añade el marcador [FIN] al final de tu mensaje. NO uses [FIN] si aún quedan pasos pendientes. NO uses [FIN] después de una sola acción si la tarea requiere múltiples pasos.
4. Cuando el usuario te pida realizar una operación de archivos, usa [ZEUS_API_CALL].
5. Si necesitas ejecutar algo en la consola (instalar paquetes, inicializar git, mover archivos del sistema), usa [TERMINAL_COMMAND]comando[/TERMINAL_COMMAND].
6. **IMPORTANTE**: Pon CADA comando en su propio bloque [TERMINAL_COMMAND] por separado. No los agrupes.
6b. **NUNCA uses &&, ||, ; ni redirecciones como 2>&1 dentro de un bloque [TERMINAL_COMMAND]**. El terminal ejecuta los comandos de uno en uno y no admite operadores de encadenamiento. Si necesitas cambiar de directorio y ejecutar un comando, envía PRIMERO [TERMINAL_COMMAND]cd ruta[/TERMINAL_COMMAND] y DESPUÉS en otro bloque separado [TERMINAL_COMMAND]comando[/TERMINAL_COMMAND]. NO añadas 2>&1 — el terminal captura la salida automáticamente.
7. **REGLA DE ORO: LEER ANTES DE MODIFICAR**: No se inyecta automáticamente el contenido de los archivos abiertos en el editor. Antes de modificar CUALQUIER archivo, debes leerlo tú mismo para conocer su contenido exacto.
   - **PRIMERO**: Lee el archivo con [ZEUS_API_CALL]{"method":"GET","url":"/api/files/nombre.ext","params":{"path":"ruta"},"description":"Leyendo archivo para conocer su contenido"}[/ZEUS_API_CALL]. Recibirás el contenido **COMPLETO** (nunca truncado).
   - **ARCHIVOS GRANDES**: Si al leer un archivo la respuesta indica que es muy grande (contiene "ARCHIVO GRANDE" y un total de líneas), NO tienes el contenido inline. Léelo **por partes** con [ZEUS_API_CALL]{"method":"GET","url":"/api/files/nombre.ext/lines","params":{"path":"ruta","startLine":1,"endLine":200},"description":"Leyendo líneas 1-200"}[/ZEUS_API_CALL] y avanza en bloques (startLine=201&endLine=400, etc.) hasta cubrir todo el archivo. También puedes usar /api/files/{name}/lines/list para ver todas las líneas numeradas. Así accedes a TODA la información sin truncamiento.
   - **SEGUNDO**: Añade SIEMPRE el marcador [CONTINUAR] al final.
   - **TERCERO**: Una vez el sistema te devuelva el contenido en el siguiente turno, aplica el \`code_change\` con el texto EXACTO.
   - **NUNCA** adivines el contenido ni inventes líneas de código para el campo "old". Si no estás seguro del contenido actual, LÉELO primero (por partes si es grande).
8. Las líneas empiezan en 1. Los caracteres empiezan en 0.
9. Siempre especifica el parámetro "path" en todas las operaciones. Todas las rutas son relativas a la carpeta "data/".
10. Para operaciones que pueden guardarse en un plan en lugar de ejecutarse inmediatamente, usa los parámetros "planName" y "saveToPlan".

## MÉTODO PRINCIPAL PARA MODIFICAR ARCHIVOS EXISTENTES: CODE CHANGE JSON

Para **CUALQUIER** cambio en archivos existentes (correcciones, añadir código, eliminar líneas, cambiar imports, modificar funciones), debes usar SIEMPRE el formato JSON \`code_change\`.

### FORMATO code_change:
\`\`\`json
{
  "type": "code_change",
  "explanation": "Descripción breve del cambio",
  "changes": [
    {
      "file": "ruta/al/archivo.ts",
      "replacements": [
        {
          "old": "texto exacto actual del archivo (copia literal)",
          "new": "texto nuevo que reemplaza al anterior"
        }
      ]
    }
  ]
}
\`\`\`

### REGLAS DEL code_change:
- **"old"** debe ser el texto EXACTO que existe actualmente en el archivo (incluyendo espacios, tabs, saltos de línea).
- Incluye SIEMPRE al menos 2-3 líneas completas de contexto en "old" para evitar coincidencias ambiguas. NUNCA uses solo una palabra o una línea suelta.
- **"new"** es el texto que reemplazará al "old".
- Puedes tener múltiples replacements en un mismo archivo.
- Puedes tener múltiples archivos en un mismo code_change.
- Si el archivo usa saltos de línea Windows (\r\n), usa \n en el JSON; el sistema los normaliza automáticamente.

### CUÁNDO USAR code_change (90% de los casos):
- ✅ Corregir bugs, typos, errores de sintaxis
- ✅ Cambiar texto, funciones, componentes, imports
- ✅ Añadir o eliminar líneas de código
- ✅ Modificar configuraciones
- ✅ Cualquier cambio que el usuario pida con "cambia", "corrige", "modifica", "actualiza", "añade", "elimina"

### CUÁNDO NO USAR code_change (usar [ZEUS_API_CALL] solo en estos casos):
- ❌ Crear aplicaciones completas desde cero
- ❌ Crear carpetas o archivos nuevos (en ese caso, usa planes)

### EJEMPLOS:

**Usuario**: "Corrige el typo en app/page.tsx donde dice 'recieve' por 'receive'"
**Respuesta correcta** (code_change):
\`\`\`json
{
  "type": "code_change",
  "explanation": "Corrigiendo typo recieve -> receive",
  "changes": [
    {
      "file": "app/page.tsx",
      "replacements": [
        {"old": "recieve", "new": "receive"}
      ]
    }
  ]
}
\`\`\`

**Usuario**: "Añade un botón de 'Guardar' después del formulario en app/page.tsx"
**Respuesta correcta** (code_change):
\`\`\`json
{
  "type": "code_change",
  "explanation": "Añadiendo botón Guardar después del formulario",
  "changes": [
    {
      "file": "app/page.tsx",
      "replacements": [
        {"old": "</form>", "new": "</form>\n<button onClick={handleSave}>Guardar</button>"}
      ]
    }
  ]
}
\`\`\`

**Usuario**: "Elimina la función obsoleta calculateTotal en app/utils.ts"
**Respuesta correcta** (code_change):
\`\`\`json
{
  "type": "code_change",
  "explanation": "Eliminando función obsoleta calculateTotal",
  "changes": [
    {
      "file": "app/utils.ts",
      "replacements": [
        {"old": "function calculateTotal(items) {\n  return items.reduce((sum, item) => sum + item.price, 0);\n}\n", "new": ""}
      ]
    }
  ]
}
\`\`\`

### ERRORES COMUNES A EVITAR:
❌ NO uses [ZEUS_API_CALL] para correcciones o cambios pequeños en archivos existentes.
❌ NO reescribas el archivo completo si solo cambia una pequeña parte.
✅ SIEMPRE usa code_change para modificaciones en archivos existentes.
✅ El sistema aplicará los reemplazos automáticamente y mostrará las diferencias con sombra roja (lo que se elimina) y verde (lo que se añade).

## FLUJO CORRECTO PARA CREAR APLICACIONES COMPLETAS

### PASO 1: CREAR UN PLAN
Cuando el usuario te pida crear una aplicación completa, primero debes crear un PLAN que contenga todas las tareas necesarias.

Ejemplo de creación de plan:
[ZEUS_API_CALL]{"method":"POST","url":"/api/plan","body":{"name":"mi_aplicacion","description":"Aplicación completa con estructura de carpetas y archivos"},"description":"Creando plan para la aplicación"}[/ZEUS_API_CALL]

### PASO 2: CREAR CARPETA PRINCIPAL (PRIMERA TAREA)
La PRIMERA tarea del plan DEBE ser crear una carpeta principal para la aplicación. Todos los archivos y subcarpetas deben estar dentro de esta carpeta.

Ejemplo de crear carpeta principal:
[ZEUS_API_CALL]{"method":"POST","url":"/api/plan/tasks/save","body":{"planName":"mi_aplicacion","name":"mi_app","type":"folder","operation":"create","path":""},"description":"Creando carpeta principal para la aplicación"}[/ZEUS_API_CALL]

### PASO 3: GUARDAR TAREAS EN EL PLAN (NO EJECUTARLAS)
Cada archivo, carpeta o modificación debe guardarse como una TAREA dentro del plan, usando "saveToPlan": true.

**IMPORTANTE SOBRE EXTENSIONES:**
- Si el nombre del archivo YA incluye la extensión (ej: "index.html"), NO uses el parámetro "extension"
- Si el nombre NO incluye la extensión (ej: "index"), usa el parámetro "extension" (ej: "html")
- NUNCA uses ambos a la vez para evitar doble extensión como "layout.tsx.tsx"

### PASO 4: EJECUTAR EL PLAN COMPLETO
Una vez que todas las tareas están guardadas en el plan, **DEBES** ejecutar el plan completo:

[ZEUS_API_CALL]{"method":"POST","url":"/api/plan/execute","body":{"planName":"mi_aplicacion"},"description":"Ejecutando todas las tareas del plan mi_aplicacion"}[/ZEUS_API_CALL]

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
        {"old": "<div className=\"old-class\">", "new": "<div className=\"new-class bg-primary\">"}
      ]
    }
  ]
}
\`\`\`

**NOTA CRÍTICA**: Para actualizar archivos existentes, usa SIEMPRE \`code_change\`. No uses planes, no uses [ZEUS_API_CALL] con \`operation: "update"\`.

1.  **ETAPA 1: Plan y Estructura**: Crea el plan y la carpeta raíz. **PROHIBIDO** terminal. Usa [CONTINUAR].
2.  **ETAPA 2: Configuración y Root**: Crea package.json, configs y archivos base (\`/plan/tasks/create\`). **PROHIBIDO** terminal (salvo \`cd\`). Usa [CONTINUAR].
3.  **ETAPA 3...N: Componentes y Lógica**: Crea los componentes y la lógica de la aplicación.
4.  **ETAPA FINAL: Ejecución**: Solo cuando TODOS los archivos y componentes necesarios existan, sugiere comandos como \`npm install\` o \`npm run dev\`.

**NOTA CRÍTICA**: Para actualizar un archivo existente, debes usar:
- \`"type": "file"\`
- \`"operation": "update"\` (NO "create")
- \`"path"\`: La ruta donde está el archivo (ej: "mi_app/app")
- \`"content"\`: El nuevo contenido completo del archivo

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
8. ❌ NO usar [ZEUS_API_CALL] para actualizar archivos existentes (usa code_change JSON)
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
[ZEUS_API_CALL]{"method":"POST","url":"/api/folders","body":{"name":"mi_proyecto","path":""},"description":"Creando carpeta de proyecto"}[/ZEUS_API_CALL]

Para GET: [ZEUS_API_CALL]{"method":"GET","url":"/api/files","params":{"path":"mi_proyecto"},"description":"Listando archivos"}[/ZEUS_API_CALL]

Para guardar en plan: [ZEUS_API_CALL]{"method":"POST","url":"/api/folders","body":{"name":"mi_proyecto","path":"","planName":"mi_plan","saveToPlan":true},"description":"Guardando creación de carpeta en plan"}[/ZEUS_API_CALL]

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
`);

    if (isStrictLowModel) {
      contextParts.push(`## MODO ESTRICTO PARA MODELO DE BAJA CAPACIDAD
Esta regla aplica SOLO para este modelo.

1. NO actualices archivos existentes para correcciones (prohibido usar PUT /files/:name para editar contenido).
2. Para corregir un archivo existente, crea SIEMPRE un archivo nuevo con el contenido completo corregido.
3. Usa POST /files con:
   - name: nombre original + ".zeus-fixed" (ejemplo: "globals.css.zeus-fixed")
   - path: la misma carpeta del archivo original
   - content: contenido completo final corregido
4. En la descripción indica claramente: "archivo corregido alternativo, no sobrescribe original".
5. Solo usa endpoints de líneas/chars si el usuario lo pide explícitamente.
`);
    }



    // Refactorización para bucle de continuación automática
    let currentConversationId = conversationId;
    let iterations = 0;
    const MAX_ITERATIONS = 50;
    let shouldContinue = true;
    let currentNextMessageContent = textContent;
    let currentHistory = [...messages.map((msg) => ({ role: msg.role, content: msg.content }))];

    // Una sola burbuja de asistente por mensaje del usuario. Antes esto se
    // declaraba DENTRO del while, generando un id nuevo en cada iteración de
    // auto-continue y apilando burbujas vacías una tras otra. Ahora todas las
    // iteraciones actualizan la misma burbuja. `lastAssistantText` alimenta el
    // guard anti-bucle (modelo atascado repitiéndose).
    const assistantMessageId = generateMessageId();
    let streamingMessageCreated = false;
    let lastAssistantText = '';

    try {
      const projectState = useProjectStore.getState();
      const activeCwd = projectState.activeCwd || projectState.resolveNewSessionCwd() || '';
      const cwdSection = activeCwd
        ? `## DIRECTORIO DE TRABAJO (cwd)\nTodos los paths de archivos son relativos a: ${activeCwd}\nLos [ZEUS_API_CALL] se ejecutan anclados a este directorio (header X-Zeus-Session).\n\n---\n\n`
        : '';
      const editorSystemContext = cwdSection + contextParts.join('\n\n---\n\n');

      // NOTA: Ya NO se inyecta automáticamente el contenido de los archivos
      // abiertos/mencionados en el mensaje del usuario. Antes esto truncaba el
      // contenido (pérdida de información) e incluía archivos irrelevantes para
      // la tarea actual. Ahora el modelo debe leer él mismo los archivos que
      // necesite con [ZEUS_API_CALL] GET /api/files/{name} (contenido completo,
      // o por partes con /api/files/{name}/lines si son muy grandes). El
      // esquema del directorio (estructura, sin contenido) sí se incluye en el
      // system context, así el modelo sabe qué archivos existen y sus rutas.

      while (shouldContinue && iterations < MAX_ITERATIONS) {
        iterations++;
        const newMessageForApi = { role: 'user' as const, content: currentNextMessageContent };
        // Mensaje limpio para mostrar en la UI (sin contexto enriquecido)
        const cleanMessageForUi = { role: 'user' as const, content: currentNextMessageContent };

        const res = await sessionFetch('/api/chat', {
          method: 'POST',
          headers: { ...getAuthHeaders() },
          signal: controller.signal,
          body: JSON.stringify({
            provider,
            model: modelId,
            modelId: modelId,
            modelRecordId: selectedModel?.id,
            userId: authUser?.id,
            projectId: getActiveProjectId() || undefined,
            history: currentHistory,
            newMessage: newMessageForApi,
            newMessageClean: cleanMessageForUi,  // Mensaje limpio sin contexto para mostrar en UI
            hiddenContext: hiddenContextToInject,
            conversationId: currentConversationId ?? undefined,
            title: !currentConversationId ? pendingConversationTitle : undefined,
            systemContext: editorSystemContext,
            webSearch: webSearchEnabled,
            // Forzar stream:false siempre — el path de streaming no soporta
            // tool calls nativas ni procesa bien el systemContext en algunos modelos.
            stream: false,
          }),
        });

        const responseContentType = res.headers.get('content-type') || '';
        // El backend puede responder con SSE (text/event-stream) cuando hay cwd,
        // emitiendo cada tool a medida que se ejecuta. Detectarlo aquí.
        const isToolSSE = responseContentType.includes('text/event-stream');
        let assistantText = '';
        let responseToolLog: any[] = [];

        if (isToolSSE) {
          // Procesar SSE de tools: cada evento es { type: 'tool', tool, total } o { type: 'done', text, ... }
          if (!res.ok) {
            const errText = await res.text().catch(() => '');
            throw new Error(errText || 'Error al enviar');
          }

          // Crear el mensaje del asistente con el assistantMessageId correcto.
          if (!streamingMessageCreated) {
            setMessages((m) => [...m, { id: assistantMessageId, role: 'assistant' as const, content: '', type: 'text', createdAt: new Date().toISOString(), toolLog: [] } as any]);
            streamingMessageCreated = true;
          }

          const reader = res.body!.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          const liveToolLog: any[] = [];

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith('data: ')) continue;
              if (trimmed === 'data: [DONE]') continue;
              try {
                const evt = JSON.parse(trimmed.slice(6));
                if (evt.type === 'tool') {
                  // Añadir tool al log y actualizar el mensaje.
                  // El backend envía el tool YA terminado (status final), pero
                  // para mostrar el spinner "en curso" como F:\Agent, el último
                  // tool se marca como 'running' mientras el stream continúa.
                  // Los anteriores conservan su status real.
                  const incoming = { ...evt.tool };
                  liveToolLog.push(incoming);
                  setMessages((prevMsgs) => {
                    const idx = prevMsgs.findIndex(m => m.id === assistantMessageId);
                    if (idx !== -1) {
                      const displayLog = liveToolLog.map((t, ti) =>
                        ti === liveToolLog.length - 1 ? { ...t, status: 'running' as const } : t
                      );
                      prevMsgs[idx] = { ...prevMsgs[idx], toolLog: [...displayLog] };
                    }
                    return [...prevMsgs];
                  });
                  // Notificar al IDE que un archivo fue modificado por el modelo
                  // (write_file, delete_file, create_dir) para refrescar editor + preview en tiempo real
                  const modTool = evt.tool;
                  if (modTool && modTool.status === 'success') {
                    const modPaths: string[] = [];
                    if (modTool.name === 'write_file' || modTool.name === 'delete_file') {
                      if (modTool.args?.path) modPaths.push(String(modTool.args.path));
                    } else if (modTool.name === 'create_dir') {
                      if (modTool.args?.path) modPaths.push(String(modTool.args.path));
                    }
                    if (modPaths.length > 0) {
                      window.dispatchEvent(new CustomEvent('zeus:file-changed', {
                        detail: { paths: modPaths, tool: modTool.name }
                      }));
                    }
                  }
                } else if (evt.type === 'done') {
                  assistantText = evt.text || 'Sin respuesta';
                  responseToolLog = evt.toolLog || liveToolLog;
                  if (evt.conversationId) {
                    if (!currentConversationId) setPendingConversationTitle(null);
                    currentConversationId = evt.conversationId;
                    setConversationId(evt.conversationId as any);
                    triggerRefreshConversations();
                  }
                  // Aplicar el toolLog FINAL (status reales: success/error) para
                  // que el último tool deje de mostrar el spinner y el run se
                  // colapse al resumen. Sin esto, el último tool se quedaba
                  // 'running' para siempre y su contenido nunca se veía.
                  setMessages((prevMsgs) => {
                    const idx = prevMsgs.findIndex(m => m.id === assistantMessageId);
                    if (idx !== -1) {
                      prevMsgs[idx] = { ...prevMsgs[idx], toolLog: responseToolLog || prevMsgs[idx].toolLog, content: '' };
                    }
                    return [...prevMsgs];
                  });
                  // Efecto de escritura (typewriter) visible: ritmo adaptativo
                  // según la longitud del texto para que SIEMPRE se perciba el
                  // flujo (corto = claro, largo = ágil pero no instantáneo).
                  let typed = 0;
                  const textLen = assistantText.length;
                  const typeSpeed = 22; // ms por tick
                  // 1 char/tick (<600 chars) → 3 chars/tick (>2500) → 45 chars/s mínimo
                  const typeStep = textLen < 600 ? 1 : textLen < 1500 ? 2 : textLen < 3000 ? 3 : 5;
                  const typeInterval = setInterval(() => {
                    typed += typeStep;
                    const chunk = assistantText.slice(0, typed);
                    setMessages((prevMsgs) => {
                      const idx = prevMsgs.findIndex(m => m.id === assistantMessageId);
                      if (idx !== -1) {
                        prevMsgs[idx] = { ...prevMsgs[idx], content: chunk };
                      }
                      return [...prevMsgs];
                    });
                    if (typed >= assistantText.length) {
                      clearInterval(typeInterval);
                      // Asegurar el texto completo exacto
                      setMessages((prevMsgs) => {
                        const idx = prevMsgs.findIndex(m => m.id === assistantMessageId);
                        if (idx !== -1) {
                          prevMsgs[idx] = { ...prevMsgs[idx], content: assistantText };
                        }
                        return [...prevMsgs];
                      });
                      // AutoPlay: cuando el texto termina de escribirse y el
                      // botón Auto play está activado, reproducir la respuesta
                      // completa por los altavoces. (El flujo SSE de tools no
                      // usaba el TTS — solo el flujo de texto viejo lo hacía.)
                      if (autoPlayResponses && assistantText.trim()) {
                        speakMessage(messages.length, assistantText);
                      }
                    }
                  }, typeSpeed);
                  if (messagesEndRef.current) smartScrollToBottom();
                } else if (evt.type === 'error') {
                  throw new Error(evt.error || 'Error en tools');
                }
              } catch (parseErr) {
                // ignorar líneas no-JSON
              }
            }
          }
        } else if (false) {
          if (!res.ok) {
            const errText = await res.text().catch(() => '');
            throw new Error(errText || 'Error al enviar');
          }

          const placeholderMessage = createChatMessage('assistant', '');
          placeholderMessage.id = assistantMessageId;
          setMessages((m) => [...m, placeholderMessage]);
          streamingMessageCreated = true;

          let fullTextFromStream = '';
          let displayedInUi = '';
          let spokenText = '';
          let streamDone = false;
          let isWarmingUp = true;

          if (autoPlayResponses) stopSpeaking();

          // Fase de "calentamiento": Esperamos 1.2 segundos para estabilizar el buffer
          setTimeout(() => {
            isWarmingUp = false;
          }, 1200);

          setIsStreaming(true);
          // Evitar intervalos huérfanos si se inicia un nuevo stream antes
          // de que el anterior se haya autolimpidado.
          if (currentPlaybackIntervalRef.current) {
            clearInterval(currentPlaybackIntervalRef.current as any);
            currentPlaybackIntervalRef.current = null;
          }
          const playbackInterval = setInterval(() => {
            if (isWarmingUp && !streamDone) return;

            // 1. Actualización del texto en la UI (Atómica para evitar duplicados)
            if (displayedInUi.length < fullTextFromStream.length) {
              const remaining = fullTextFromStream.slice(displayedInUi.length);
              
              // Throttling: si la voz se queda atrás, frenamos el texto
              if (autoPlayResponses && (displayedInUi.length - spokenText.length) > 180) {
                return;
              }

              const nextSpace = remaining.indexOf(' ');
              const nextNewline = remaining.indexOf('\n');
              let toAdd = '';
              
              if (nextSpace !== -1 || nextNewline !== -1) {
                const index = (nextSpace !== -1 && nextNewline !== -1) 
                  ? Math.min(nextSpace, nextNewline) 
                  : (nextSpace !== -1 ? nextSpace : nextNewline);
                toAdd = remaining.slice(0, index + 1);
              } else if (streamDone) {
                toAdd = remaining;
              } else if (remaining.length > 10) {
                toAdd = remaining.slice(0, 6);
              }

              if (toAdd) {
                displayedInUi += toAdd;
                
                // IMPORTANTE: Usar actualización funcional para evitar que React mezcle estados
                setMessages((prevMsgs) => {
                  const newMsgs = [...prevMsgs];
                  const idx = newMsgs.findIndex(m => m.id === assistantMessageId);
                  if (idx !== -1) {
                    newMsgs[idx] = { ...newMsgs[idx], content: displayedInUi };
                  }
                  return newMsgs;
                });

                if (messagesEndRef.current) {
                  smartScrollToBottom();
                }

                // 2. Sincronización de Voz
                if (autoPlayResponses) {
                  const currentClean = cleanTextForTTS(displayedInUi);
                  const alreadySpokenClean = cleanTextForTTS(spokenText);
                  const pendingToSpeak = currentClean.slice(alreadySpokenClean.length).trim();

                  // Fragmentación por oraciones para mayor naturalidad
                  const hasSentenceBreak = /[.?!;:\n]/.test(toAdd);
                  const isLongEnough = pendingToSpeak.split(' ').length >= 6;

                  if (pendingToSpeak.length > 0 && (hasSentenceBreak || isLongEnough || streamDone)) {
                    const utterance = new SpeechSynthesisUtterance(pendingToSpeak);
                    utterance.lang = voiceRef.current?.lang || 'es-ES';
                    // Aumentar un poco la velocidad de la voz respecto al ajuste del usuario para que sea más ágil
                    utterance.rate = voiceRate + 0.15; 
                    utterance.pitch = voicePitch;
                    if (voiceRef.current) utterance.voice = voiceRef.current;
                    
                    utterance.onstart = () => setSpeakingIndex(messages.length);
                    utterance.onend = () => {
                      if (streamDone && displayedInUi.length === fullTextFromStream.length && !window.speechSynthesis.speaking) {
                        setSpeakingIndex(null);
                      }
                    };
                    
                    window.speechSynthesis.speak(utterance);
                    spokenText = displayedInUi;
                  }
                }
              }
            } else if (streamDone) {
              if (autoPlayResponses && displayedInUi.length > spokenText.length) {
                const currentClean = cleanTextForTTS(displayedInUi);
                const alreadySpokenClean = cleanTextForTTS(spokenText);
                const finalPart = currentClean.slice(alreadySpokenClean.length).trim();
                
                if (finalPart) {
                  const utterance = new SpeechSynthesisUtterance(finalPart);
                  utterance.lang = voiceRef.current?.lang || 'es-ES';
                  utterance.rate = voiceRate + 0.15;
                  utterance.pitch = voicePitch;
                  if (voiceRef.current) utterance.voice = voiceRef.current;
                  utterance.onend = () => setSpeakingIndex(null);
                  window.speechSynthesis.speak(utterance);
                  spokenText = displayedInUi;
                }
              }
              
              if (!window.speechSynthesis.speaking || !autoPlayResponses) {
                 clearInterval(playbackInterval);
                 currentPlaybackIntervalRef.current = null;
                 setIsStreaming(false);
              }
            }
          }, 500); 

          currentPlaybackIntervalRef.current = playbackInterval;

          const streamResult = await consumeChatSSEStream(res, (chunk) => {
            fullTextFromStream += chunk;
          });

          streamDone = true;
          // Detener el playback inmediatamente. Sin esto, el intervalo (500 ms)
          // sigue setMessages(displayedInUi) con el parcial en CRUDO y, cuando el
          // flujo principal aplica el texto limpio vía updateAssistantMessage,
          // la próxima tick del intervalo lo sobrescribe → reaparece "texto
          // anterior". Volcamos el texto completo de una vez y soltamos el
          // intervalo; el flujo principal lo sustituirá por la versión limpia.
          if (currentPlaybackIntervalRef.current) {
            clearInterval(currentPlaybackIntervalRef.current as any);
            currentPlaybackIntervalRef.current = null;
          }
          displayedInUi = fullTextFromStream;
          setMessages((prevMsgs) => {
            const idx = prevMsgs.findIndex(m => m.id === assistantMessageId);
            if (idx === -1) return prevMsgs;
            const newMsgs = [...prevMsgs];
            newMsgs[idx] = { ...newMsgs[idx], content: fullTextFromStream };
            return newMsgs;
          });
          setIsStreaming(false);
          // Aseguramos que el texto final sea el correcto
          if (streamResult.error) {
            throw new Error(streamResult.error);
          }

          assistantText = streamResult.text || 'Sin respuesta';
          if (streamResult.conversationId) {
            if (!currentConversationId) {
              setPendingConversationTitle(null);
            }
            currentConversationId = streamResult.conversationId as any;
            setConversationId(streamResult.conversationId as any);
            triggerRefreshConversations();
          }
        } else {
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error || 'Error al enviar');

          assistantText = data.text || 'Sin respuesta';
          responseToolLog = data.toolLog || [];
          if (data.conversationId) {
            if (!currentConversationId) {
              setPendingConversationTitle(null);
            }
            currentConversationId = data.conversationId;
            setConversationId(data.conversationId);
            triggerRefreshConversations();
          }

          // Poner el texto final directamente.
          setMessages((prevMsgs) => {
            const idx = prevMsgs.findIndex(m => m.id === assistantMessageId);
            if (idx !== -1) {
              prevMsgs[idx] = { ...prevMsgs[idx], toolLog: responseToolLog, content: assistantText };
            }
            return [...prevMsgs];
          });
          if (messagesEndRef.current) smartScrollToBottom();
          // AutoPlay: reproducir la respuesta completa (flujo JSON sin tools)
          if (autoPlayResponses && assistantText.trim()) {
            speakMessage(messages.length, assistantText);
          }
        }

        // Actualizar historial local: usar mensaje limpio para UI, pero contexto completo para siguiente iteración de API
        currentHistory.push(newMessageForApi);  // Para la siguiente llamada a API (necesita contexto)
        currentHistory.push({ role: 'assistant', content: assistantText });

        // --- 1. Definición de utilidades y estado local ---
        const apiCallResults: Array<{ description: string; text: string }> = [];
        const rawApiCallResults: Array<{ description: string; text: string }> = [];
        const codeBubbleByZeusBlockIndex: Record<number, { code: string; language: string; fileName: string }> = {};

        const inferLanguage = (name: string): string => {
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
        };

        const updateAssistantMessage = (currentDisplayText: string, currentApiResults: typeof apiCallResults, currentToolLog?: any[]) => {
          let content = currentDisplayText;
          // Filtrar resultados técnicos de "save tasks" para mantener el chat limpio si el usuario lo prefiere
          // o si el código ya se está mostrando en burbujas.
          const visibleResults = currentApiResults.filter(r => {
            const desc = r.description.toLowerCase();
            // Solo ocultar si es una tarea de guardado de ARCHIVO específica (muy repetitiva)
            // NO ocultar creación de planes ni carpetas de proyecto
            const isBoringSave = (desc.includes('guardando') || desc.includes('tarea')) && !desc.includes('plan');
            const hasError = r.text.includes('❌') || r.text.toLowerCase().includes('error');
            const isMissingPlanName = r.text.includes('planName');

            if (isBoringSave && (!hasError || isMissingPlanName)) return false;
            return true;
          });

          if (visibleResults.length > 0) {
            const resultsText = visibleResults.map(r => {
              // Si el texto contiene JSON (empieza con { o tiene {), mostrar solo lo anterior al JSON
              let cleanText = r.text;
              if (cleanText.includes('{')) {
                cleanText = cleanText.split('{')[0].trim();
              }
              // Asegurar que si hay un emoji de éxito/error se mantenga
              return `**${r.description}**: ${cleanText}`;
            }).join('\n\n');
            // PONER LOS RESULTADOS ARRIBA para que las burbujas de código (al final) sean lo que quede a la vista al hacer scroll
            content = `📡 **Resultados:**\n\n${resultsText}\n\n---\n\n${currentDisplayText}`.trim();
          }
          setMessages((prevMsgs) =>
            prevMsgs.map((m) => m.id === assistantMessageId ? { ...m, content: content, toolLog: currentToolLog || m.toolLog } : m)
          );
        };

        const normalizedAssistantText = normalizeZeusApiMarkers(assistantText);

        // --- 2. Pre-procesamiento de burbujas de código ---
        // Usamos la MISMA regex que en el reemplazo para asegurar consistencia
        const callPatternForBubbles = /\[ZEUS_API_CALL\]([\s\S]*?)(?=\[ZEUS_API_CALL\]|\[\/ZEUS_API_CALL\]|\[TERMINAL_COMMAND\]|$)/g;
        let bubbleMatch;
        let tempZeusIndex = 0;
        while ((bubbleMatch = callPatternForBubbles.exec(normalizedAssistantText)) !== null) {
          const callDef = safeJsonParse(bubbleMatch[1]);
          if (callDef) {
            const fileNameFromBody = (callDef?.body?.name) || (callDef?.name) || '';
            const fileNameFromUrl = extractFileNameFromApiUrl(String(callDef?.url || ''));
            const resolvedFileName = fileNameFromBody || fileNameFromUrl || 'archivo.tsx';
            const contentFromBody = typeof callDef?.body?.content === 'string' ? callDef.body.content : '';

            if (contentFromBody.trim()) {
              codeBubbleByZeusBlockIndex[tempZeusIndex] = {
                code: contentFromBody,
                language: inferLanguage(resolvedFileName),
                fileName: resolvedFileName,
              };
            }
          }
          tempZeusIndex++;
        }

        // --- 3. Limpieza de texto y marcadores ---
        const codeBubblesForMessage: Array<{ code: string; language: string; fileName: string }> = [];
        let zeusReplaceIndex = 0;

        const textWithZeusMarkers = normalizedAssistantText.replace(
          /\[ZEUS_API_CALL\][\s\S]*?(?=\[ZEUS_API_CALL\]|\[\/ZEUS_API_CALL\]|\[TERMINAL_COMMAND\]|$)/g,
          (match) => {
            const bubble = codeBubbleByZeusBlockIndex[zeusReplaceIndex++];
            if (!bubble) {
              // Sin contenido de archivo: mostrar solo la descripción de la acción
              const parsed = safeJsonParse(match.replace(/^\[ZEUS_API_CALL\]/, ''));
              const desc = parsed && typeof parsed.description === 'string' ? parsed.description.trim() : '';
              return desc ? `\n[ZEUS_ACTION]${desc}[/ZEUS_ACTION]\n` : '';
            }
            const markerIndex = codeBubblesForMessage.push(bubble) - 1;
            return `\n[CODE_BUBBLE_${markerIndex}]\n`;
          }
        );

        const textWithAllCodeMarkers = textWithZeusMarkers.replace(
          /\`\`\`([a-zA-Z0-9_+-]+)?\n?([\s\S]*?)\`\`\`/g,
          (_match: string, lang?: string, code?: string) => {
            const normalizedCode = (code || '').replace(/\n$/, '').trim();
            if (!normalizedCode) return '';
            // Check if this is a code_change block — only those get an inline marker
            const isCodeChangeBlock = normalizedCode.includes('"type"') && normalizedCode.includes('"code_change"');
            const markerIndex = codeBubblesForMessage.push({
              code: normalizedCode,
              language: lang || 'typescript',
              fileName: '',
            }) - 1;
            if (isCodeChangeBlock) {
              return `\n[CODE_BUBBLE_${markerIndex}]\n`;
            }
            // Non-code_change blocks: still register the bubble (available collapsed at end),
            // but remove from inline text so chat shows only comments
            return '';
          }
        );

        // Filtrar bloques code_change del texto visible (ya se procesan aparte en el editor)
        // Primero eliminar code_change dentro de bloques markdown (los backticks delimitan el bloque)
        let textWithoutCodeChanges = textWithAllCodeMarkers
          .replace(/```(?:json|typescript|ts|js)?\s*\n?[\s\S]*?"type"\s*:\s*"code_change"[\s\S]*?```/g, '');

        // Luego eliminar code_change sueltos usando brace counting (la regex [\s\S]*?\} rompía en } anidadas)
        const codeChangeSpans = findCodeChangeJsonSpans(textWithoutCodeChanges);
        for (let si = codeChangeSpans.length - 1; si >= 0; si--) {
          const span = codeChangeSpans[si];
          textWithoutCodeChanges = textWithoutCodeChanges.substring(0, span.start) + textWithoutCodeChanges.substring(span.end);
        }

        textWithoutCodeChanges = textWithoutCodeChanges
          // Eliminar cualquier marcador residual
          .replace(/\[\/ZEUS_API_CALL\]/g, '')
          .replace(/\[CONTINUAR\]/gi, '')
          .replace(/\[FIN\]/gi, '')
          // Eliminar líneas vacías resultantes
          .replace(/\n\s*\n\s*\n/g, '\n\n')




















          .trim();

        const displayText = textWithoutCodeChanges;

        // --- 4. Segmentación para Revelación Progresiva ---
        const messageSegments = displayText.split(/(\[TERMINAL_COMMAND\][\s\S]*?\[\/TERMINAL_COMMAND\])/g);
        let currentVisibleText = messageSegments[0] || '';

        // --- 5. Crear mensaje inicial en la UI (solo con el primer segmento) ---
        if (!streamingMessageCreated) {
          const initialAssistantMessage = createChatMessage('assistant', currentVisibleText);
          initialAssistantMessage.id = assistantMessageId;
          if (responseToolLog && responseToolLog.length > 0) {
            initialAssistantMessage.toolLog = responseToolLog;
          }
          setMessages((m) => [...m, initialAssistantMessage]);
          streamingMessageCreated = true;
        } else {
          updateAssistantMessage(currentVisibleText, apiCallResults, responseToolLog);
        }

        // Reproducción automática de voz si está activa
        if (autoPlayResponses) {
          // Usamos un pequeño delay para asegurar que el estado de los mensajes se ha actualizado
          // y evitar conflictos con otras inicializaciones.
          setTimeout(() => {
            speakMessage(messages.length, displayText);
          }, 200);
        }

        // --- 6. Procesar code_change JSON ---
        const codeChangeBlocks = extractCodeChangeBlocks(assistantText);
        console.log('[code_change] Bloques extraídos:', codeChangeBlocks.length);
        for (const codeChange of codeChangeBlocks) {
          for (const change of (codeChange.changes || [])) {
            const rawFileField = change.file || 'archivo.ts';
            // El campo "file" puede incluir la ruta completa (ej: "projects/app/header.tsx")
            // debemos separar nombre de archivo y carpeta para resolveExistingFileContext
            const lastSlashIdx = rawFileField.replace(/\\/g, '/').lastIndexOf('/');
            const fileName = lastSlashIdx >= 0 ? rawFileField.slice(lastSlashIdx + 1) : rawFileField;
            const inferredPath = lastSlashIdx >= 0 ? rawFileField.slice(0, lastSlashIdx) : '';
            const changePath = change.path || inferredPath;
            console.log('[code_change] Procesando:', { rawFileField, fileName, changePath });
            try {
              const resolved = await resolveExistingFileContext(fileName, changePath);
              console.log('[code_change] Resuelto:', { found: resolved.found, filePath: resolved.filePath, originalContentLength: resolved.originalContent.length });
              if (!resolved.found) {
                apiCallResults.push({ description: `❌ ${fileName}`, text: `No se encontró el archivo para aplicar code_change (ruta: ${changePath}).` });
                updateAssistantMessage(currentVisibleText, apiCallResults);
                continue;
              }

              // Normalizar saltos de línea del archivo (CRLF -> LF)
              let newContent = resolved.originalContent.replace(/\r\n/g, '\n');
              const normalizedReplacements: { old: string; new: string }[] = [];
              let failedCount = 0;
              let appliedCount = 0;
              for (const rep of (change.replacements || [])) {
                let oldStr = (rep.old || '').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\r\n/g, '\n');
                let newStr = (rep.new || '').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\r\n/g, '\n');
                normalizedReplacements.push({ old: oldStr, new: newStr });
                // Bug 1 + Bug 2 fix: Use smartReplace with prefer-last + fuzzy matching
                const sr = smartReplace(newContent, oldStr, newStr);
                if (sr.applied) {
                  newContent = sr.result;
                  appliedCount++;
                  console.log(`[code_change] Replacement aplicado vía ${sr.method} (occurrences=${sr.occurrences}, old length: ${oldStr.length})`);
                } else {
                  failedCount++;
                  console.warn('[code_change] Replacement NO coincidió (ni exacto ni fuzzy). old length:', oldStr.length, 'preview:', oldStr.slice(0, 60).replace(/\n/g, '\\n'));
                }
              }
              const allMatched = failedCount === 0;
              console.log('[code_change] Resultado: applied=', appliedCount, 'failed=', failedCount, 'total=', (change.replacements || []).length);

              if (appliedCount > 0) {
                // ALWAYS use addCorrection for manual review, NEVER auto-save directly to disk
                // to prevent file corruption or accidental deletions.
                addCorrection({
                  file: fileName,
                  path: resolved.filePath,
                  originalContent: resolved.originalContent,
                  newContent,
                  changes: [],
                  type: 'file',
                  replacements: normalizedReplacements
                });

                // ✅ NUEVO: Refrescar el explorador de archivos para mostrar cambios (especialmente si es un archivo nuevo)
                console.log('[code_change] Refrescando explorador tras propuesta...');
                refreshExplorer();
                
                if (allMatched) {
                  apiCallResults.push({ description: `Propuesta: ${fileName}`, text: `${appliedCount} cambio(s) listos para revisión en el editor.` });
                } else {
                  apiCallResults.push({ description: `Propuesta parcial: ${fileName}`, text: `${appliedCount} cambio(s) aplicados, ${failedCount} no coincidieron. Revisa en el editor.` });
                }
                updateAssistantMessage(currentVisibleText, apiCallResults);
              } else {
                // Ningún replacement coincidió - encolar para revisión manual
                console.warn('[code_change] Ningún replacement coincidió para:', fileName);
                addCorrection({
                  file: fileName,
                  path: resolved.filePath,
                  originalContent: resolved.originalContent,
                  newContent,
                  changes: [],
                  type: 'file',
                  replacements: normalizedReplacements
                });
                apiCallResults.push({ description: `❌ ${fileName}`, text: `Ninguno de los ${failedCount} replacement(s) coincidió con el archivo actual. Revisa manualmente en el editor.` });
                updateAssistantMessage(currentVisibleText, apiCallResults);
              }
            } catch (e) {
              console.error('Error procesando code_change:', e);
            }
          }
        }

        // --- 5. Ejecución de llamadas API ---
        const callPattern = /\[ZEUS_API_CALL\]([\s\S]*?)(?=\[ZEUS_API_CALL\]|\[\/ZEUS_API_CALL\]|\[TERMINAL_COMMAND\]|$)/g;
        let callMatch;

        while ((callMatch = callPattern.exec(normalizedAssistantText)) !== null) {
          try {
            let callContent = callMatch[1].trim();
            const callDef = safeJsonParse(callContent);

            if (!callDef || !callDef.url) continue;

            if (isFileUpdate(callDef) && !callDef.body?.saveToPlan) {
              const fileName = extractFileNameFromApiUrl(String(callDef.url || '')) || String(callDef.body?.name || 'archivo.tsx');
              const rawFilePath = callDef.body?.path;
              const resolvedFileContext = await resolveExistingFileContext(fileName, rawFilePath);
              const filePath = resolvedFileContext.filePath;
              const fullPath = filePath ? `${filePath}/${fileName}` : fileName;

              if (!resolvedFileContext.found) {
                apiCallResults.push({
                  description: `❌ ${fileName}`,
                  text: `No se encontró el archivo para aplicar corrección (path recibido: ${String(rawFilePath || '')}).`
                });
                updateAssistantMessage(currentVisibleText, apiCallResults);
                continue;
              }

              const originalContent = resolvedFileContext.originalContent;
              const proposed = buildProposedContentFromCall(callDef, originalContent);

              if (proposed.warning) {
                apiCallResults.push({ description: `⚠️ ${fileName}`, text: proposed.warning });
                updateAssistantMessage(currentVisibleText, apiCallResults);
              }

              if (proposed.blocked) {
                apiCallResults.push({
                  description: `Propuesta omitida: ${fileName}`,
                  text: 'Se detectó un reemplazo total inseguro y no se envió a revisión.'
                });
                updateAssistantMessage(currentVisibleText, apiCallResults);
                continue;
              }

              if ((proposed.content || '') === (originalContent || '')) {
                apiCallResults.push({
                  description: `Sin cambios: ${fileName}`,
                  text: 'La propuesta no modifica el archivo actual, se omitió la corrección.'
                });
                updateAssistantMessage(currentVisibleText, apiCallResults);
                continue;
              }

              addCorrection({
                file: fileName,
                path: filePath,
                originalContent,
                newContent: proposed.content,
                changes: [],
                type: 'file'
              });

              // OMITIMOS executeZeusApiCall para dar control al usuario mediante Aceptar/Cancelar en el Editor
              // El CodeEditor se encargará de abrir el archivo al detectar pendingCorrection

              apiCallResults.push({ description: `Propuesta de cambio: ${fileName}`, text: 'Esperando aprobación en el editor...' });
              updateAssistantMessage(currentVisibleText, apiCallResults);
            } else if (callDef.url.includes('/api/plan/execute')) {
              const planName = callDef.body?.planName || '';
              apiCallResults.push({ description: `Plan: ${planName}`, text: 'Obteniendo tareas...' });
              updateAssistantMessage(currentVisibleText, apiCallResults);

              try {
                const tasksRes = await sessionFetch(`/api/plan/tasks?fileName=${planName.toLowerCase().replace(/\s+/g, '-')}.json`);
                const tasksData = await tasksRes.json();
                const tasks = tasksData.tasks || [];

                if (tasks.length === 0) {
                  apiCallResults[apiCallResults.length - 1].text = 'El plan no tiene tareas pendientes.';
                  updateAssistantMessage(currentVisibleText, apiCallResults);
                } else {
                  for (const task of tasks) {
                    if (task.status === 'pending') {
                      const taskDesc = `${task.operation.toUpperCase()} ${task.type}: ${task.name}`;
                      apiCallResults.push({ description: taskDesc, text: 'Ejecutando...' });
                      updateAssistantMessage(currentVisibleText, apiCallResults);

                      const executeRes = await sessionFetch('/api/plan/tasks/execute', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams({ planName, taskId: task.id }).toString()
                      });

                      const executeData = await executeRes.json();
                      const lastResultIdx = apiCallResults.length - 1;
                      apiCallResults[lastResultIdx].text = executeData.success ? '✅ Completado' : `❌ Error: ${executeData.error || 'Desconocido'}`;
                      updateAssistantMessage(currentVisibleText, apiCallResults);
                      await new Promise(r => setTimeout(r, 400));
                    }
                  }
                }
              } catch (err: any) {
                apiCallResults.push({ description: 'Error plan', text: err.message });
                updateAssistantMessage(currentVisibleText, apiCallResults);
              }
            } else {
              // Para otras llamadas API, mostrar estado de procesamiento secuencial
              const callDesc = callDef.description || callDef.url;
              apiCallResults.push({ description: callDesc, text: '⏳ Procesando...' });
              updateAssistantMessage(currentVisibleText, apiCallResults);

              // Pequeña pausa para que el usuario vea que empieza el procesamiento
              await new Promise(r => setTimeout(r, 300));

              const result = await executeZeusApiCall(callDef);
              const lastIdx = apiCallResults.length - 1;
              apiCallResults[lastIdx].text = result.success ? `✅ ${result.text}` : `❌ ${result.text}`;
              updateAssistantMessage(currentVisibleText, apiCallResults);

              // Guardar resultado raw para inyectarlo al historial como contexto
              rawApiCallResults.push({ description: callDesc, text: result.text });

              // Pausa tras finalizar la tarea para que no pasen demasiado rápido
              await new Promise(r => setTimeout(r, 600));
            }
          } catch (e) {
            console.error('❌ Error ejecutando ZEUS_API_CALL:', e);
          }
        }

        if (apiCallResults.length > 0) {
          refreshExplorer();
        }

        // Inyectar resultados de llamadas API al historial para que el modelo los vea en la siguiente iteración
        if (rawApiCallResults.length > 0) {
          const resultsSummary = rawApiCallResults.map(r => `--- ${r.description} ---\n${r.text}`).join('\n\n');
          currentHistory.push({
            role: 'user',
            content: `Resultados de las llamadas API que solicitaste:\n\n${resultsSummary}\n\nProcede con la siguiente acción basándote en estos resultados.`
          });
        }

        // --- 6. Iniciar streaming de burbujas de código ---
        if (codeBubblesForMessage.length > 0) {
          setMessageCodeBubbles((prev) => ({
            ...prev,
            [assistantMessageId]: codeBubblesForMessage.map((item) => ({
              code: '',
              language: item.language,
              fileName: item.fileName,
              isVisible: false,
            })),
          }));

          // EJECUCIÓN SECUENCIAL: Esperar a que cada burbuja termine de escribirse
          for (let idx = 0; idx < codeBubblesForMessage.length; idx++) {
            const item = codeBubblesForMessage[idx];
            await streamCodeBubbleForMessage(assistantMessageId, idx, item.code, item.language, item.fileName);
          }
        }

        // --- 7. Revelar y Esperar a Comandos de Terminal ---
        if (messageSegments.length > 1) {
          for (let i = 1; i < messageSegments.length; i++) {
            const segment = messageSegments[i];
            const isTerminalBlock = segment.startsWith('[TERMINAL_COMMAND]');

            if (isTerminalBlock) {
              currentVisibleText += segment;
              updateAssistantMessage(currentVisibleText, apiCallResults);
              await new Promise<void>((resolve) => {
                terminalResolveRef.current = resolve;
                // Timeout de seguridad: si el terminal no confirma en 90s,
                // resolver automáticamente para que el chat no se quede colgado.
                const timeout = setTimeout(() => {
                  if (terminalResolveRef.current === resolve) {
                    console.warn('[Chat] Terminal timeout — resolviendo automáticamente');
                    terminalResolveRef.current = null;
                    resolve();
                  }
                }, 90000);
                // Limpiar el timeout si se resuelve antes
                const originalResolve = resolve;
                terminalResolveRef.current = () => {
                  clearTimeout(timeout);
                  originalResolve();
                };
              });
            } else {
              currentVisibleText += segment;
              updateAssistantMessage(currentVisibleText, apiCallResults);
            }
          }
        }

        // Decidir si continuar automáticamente
        // El modelo usa [CONTINUAR] para indicar que debe seguir, y [FIN] para indicar que terminó.
        // Si la respuesta contiene acciones (ZEUS_API_CALL, TERMINAL_COMMAND, code_change) pero no [FIN],
        // también continuamos automáticamente porque es probable que falten más pasos.
        const hasContinueMarker = /\[CONTINUAR\]/i.test(assistantText);
        const hasFinMarker = /\[FIN\]/i.test(assistantText);
        const hasActionableContent = /\[ZEUS_API_CALL\]/i.test(assistantText) || /\[TERMINAL_COMMAND\]/i.test(assistantText) || /"type"\s*:\s*"code_change"/i.test(assistantText);

        // Guard anti-bucle: si el modelo responde exactamente lo mismo que en
        // la iteración anterior, está atascado repitiéndose (síntoma: "repite
        // siempre lo mismo"). Detener el auto-continue en vez de seguir girando.
        const isStuckRepeating = lastAssistantText.trim().length > 0
          && assistantText.trim() === lastAssistantText.trim();
        lastAssistantText = assistantText;

        const shouldStop = hasFinMarker || iterations >= MAX_ITERATIONS || controller.signal.aborted || isStuckRepeating;
        if (!shouldStop) {
          // Si el modelo indicó [CONTINUAR] o si hubo acciones en la respuesta, continuar con instrucción clara
          if (hasContinueMarker || hasActionableContent) {
            currentNextMessageContent = 'Continúa con la siguiente acción necesaria para completar la tarea. Si ya completaste todo, responde solo con [FIN].';
            // Pausa breve entre turnos automáticos
            await new Promise(r => setTimeout(r, 500));
          } else {
            // No hubo acciones ni [CONTINUAR] → la tarea probablemente terminó, detener el bucle
            // Evitamos enviar un mensaje de verificación que dispara una respuesta innecesaria del modelo
            shouldContinue = false;
          }
        } else {
          shouldContinue = false;
        }
      } // fin while
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) {
        setMessages((m) => [...m, createChatMessage('assistant', e instanceof Error ? e.message : 'Error de conexión')]);
      }
    } finally {
      setLoading(false);
      setAbortController(null);
    }
  };

  const handleClose = () => { stopSpeaking(); setOpen(false); };

  const copyToClipboard = (text: string, index: number) => {
    safeWriteClipboard(text).then(() => {
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    });
  };

  const isHiddenPage = pathname === '/auth' || pathname === '/terms' || pathname === '/privacy';
  if (isHiddenPage) return null;

  const chatFullContent = (
    <div
      id="zeus-chat-container"
      className={`flex flex-col fondo-zeus overflow-hidden transition-all duration-300 ${isMaximized
        ? 'fixed inset-0 z-[9999] rounded-none border-0 m-0 p-0 w-full h-full'
        : 'h-full rounded-none border border-border/80'
        }`}
      style={isMaximized ? { top: 0, left: 0, right: 0, bottom: 0 } : {}}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-card border-b border-border/80">
        <div className="flex items-center gap-3">
          <MessageCircle className="w-5 h-5 text-success" />
          <div>
            <h3 className="font-semibold text-foreground">Zeus IA</h3>
            <p className="text-xs text-muted-foreground/80"></p>
          </div>
        </div>

        <div className={`flex items-center gap-2 mr-6 ${isMaximized ? 'pr-[200px]' : ''}`}>
          {hasSelection && (
            <button
              onClick={copyChatSelection}
              className="p-2 rounded-lg transition-colors text-muted-foreground hover:text-foreground hover:bg-muted"
              title="Copiar selección"
            >
              {useLucideIcons ? <Copy className="w-4 h-4" style={{ color: 'hsl(var(--tab-icon))' }} /> : <img src="/iconos/copiar.png" alt="Copiar" className="w-4 h-4" />}
            </button>
          )}
          <button
            onClick={() => setIsVoiceConfigModalOpen(true)}
            className="p-2 rounded-lg transition-colors text-muted-foreground hover:text-foreground hover:bg-muted"
            title="Configuración de Voz"
          >
            {useLucideIcons ? <Settings className="w-4 h-4" style={{ color: 'hsl(var(--tab-icon))' }} /> : <img src="/iconos/Settings.png" alt="Configuración de Voz" className="w-4 h-4" />}
          </button>
          <button
            onClick={() => {
              // Abrir el sidebar del historial mediante evento global
              const event = new CustomEvent('toggleChatHistory');
              window.dispatchEvent(event);
            }}
            className="p-2 rounded-lg transition-colors text-muted-foreground hover:text-foreground hover:bg-muted"
            title={t('openHistory')}
          >
            {useLucideIcons ? <History className="w-4 h-4" style={{ color: 'hsl(var(--tab-icon))' }} /> : <img src="/iconos/Historial.png" alt="Historial" className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setIsApiConfigModalOpen(true)}
            className="p-2 rounded-lg transition-colors text-muted-foreground hover:text-foreground hover:bg-muted"
            title="Configuración de API"
          >
            {useLucideIcons ? <Brain className="w-4 h-4" style={{ color: 'hsl(var(--tab-icon))' }} /> : <img src="/iconos/Brain.png" alt="Configuración" className="w-4 h-4" />}
          </button>
          <button
            onClick={() => {
              const nextShow = !showTerminal;
              setShowTerminal(nextShow);
              if (nextShow) {
                const filtered = messages.filter((m) => !(m.role === 'assistant' && String(m.id || '').startsWith('stage-typing-')));
                const lastAssistantIndex = [...filtered].reverse().findIndex((m) => m.role === 'assistant');
                if (lastAssistantIndex >= 0) {
                  const actualIndex = filtered.length - 1 - lastAssistantIndex;
                  const lastAssistantMessage = filtered[actualIndex];
                  const anchorId = lastAssistantMessage?.id || `msg-${actualIndex}-${lastAssistantMessage?.content?.substring(0, 10) || ''}`;
                  setTerminalAnchorMessageId(anchorId);
                  setTimeout(scrollToTerminalBottom, 100);
                } else {
                  setTerminalAnchorMessageId('__floating-terminal__');
                  setTimeout(scrollToTerminalBottom, 100);
                }
              } else {
                setTerminalAnchorMessageId(null);
              }
            }}
            className={`p-2 rounded-lg transition-colors ${showTerminal
              ? 'text-success bg-emerald-400/10 hover:bg-emerald-400/20'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            title={showTerminal ? t('closeTerminal') : t('openTerminal')}
          >
            {useLucideIcons ? <Terminal className="w-4 h-4" style={{ color: 'hsl(var(--tab-icon))' }} /> : <img src="/iconos/Terminal.png" alt="Terminal" className="w-4 h-4" />}
          </button>
          {isMaximized ? (
            <button onClick={() => setIsMaximized(false)} className="p-2 rounded-lg text-primary bg-blue-400/10 hover:bg-blue-400/20" title={t('restore')}>
              {useLucideIcons ? <Minimize2 className="w-4 h-4" style={{ color: 'hsl(var(--tab-icon))' }} /> : <img src="/iconos/Expandir.png" alt="Restaurar" className="w-4 h-4" />}
            </button>
          ) : (
            <button onClick={() => setIsMaximized(true)} className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted" title={t('maximize')}>
              {useLucideIcons ? <Maximize2 className="w-4 h-4" style={{ color: 'hsl(var(--tab-icon))' }} /> : <img src="/iconos/Expandir.png" alt="Maximizar" className="w-4 h-4" />}
            </button>
          )}
          <button
            onClick={() => {
              if (speakingIndex !== null) {
                // Si hay reproducción activa, pausar/reanudar
                togglePauseSpeaking();
              } else {
                // Si no, toggle auto-play
                setAutoPlayResponses((v) => !v);
              }
            }}
            className={`p-2 rounded-lg ${
              speakingIndex !== null
                ? (isPaused ? 'bg-yellow-500/30 text-yellow-400' : 'bg-green-500/30 text-green-400 animate-pulse')
                : (autoPlayResponses ? 'bg-green-500/30 text-green-400' : 'text-muted-foreground hover:text-foreground hover:bg-muted')
            }`}
            title={speakingIndex !== null ? (isPaused ? 'Reanudar reproducción' : 'Pausar reproducción') : (autoPlayResponses ? 'Desactivar auto-play' : 'Activar auto-play')}
          >
            {useLucideIcons ? (
              speakingIndex !== null
                ? (isPaused ? <Play className="w-4 h-4" /> : <Square className="w-4 h-4" />)
                : <Mic className="w-4 h-4" />
            ) : (
              <img src="/iconos/Voz.png" alt="Voz" className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {!mounted ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground/80">
            <div className="w-12 h-12 bg-gradient-to-r from-emerald-400 to-blue-400 rounded-full flex items-center justify-center mb-4">
              <span className="text-foreground text-xl font-bold">Z</span>
            </div>
            <p className="text-sm">{t('loadingChat')}</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground/80">
            <div className="w-16 h-16 flex items-center justify-center mb-4">
              <img src="/LOGO_ZEUS.png" alt="Zeus IA Logo" className="w-full h-full object-contain" />
            </div>
            <p className="text-sm text-zeus-orange">{t('helloZeusIA')}</p>
            <p className="text-xs mt-1">{t('howCanIHelp')}</p>
          </div>
        ) : (
          messages
            .filter((msg) => !(msg.role === 'assistant' && String(msg.id || '').startsWith('stage-typing-')))
            // Evitar claves duplicadas: si el historial (o un mensaje optimista re-ecoado por el
            // servidor) contiene dos mensajes con el mismo id, React duplica/omite hijos. Nos
            // quedamos con la primera aparición de cada id.
            .filter((msg, i, self) => {
              const key = msg.id || `idx-${i}`;
              return self.findIndex((m, j) => (m.id || `idx-${j}`) === key) === i;
            })
            .map((msg, i) => {
            // Asegurar que tenemos un ID para el mensaje (especialmente para los cargados del historial).
            // El dedup previo garantiza que cada id aparece una sola vez, así que la clave es única.
            const msgId = msg.id || `msg-${i}-${msg.content.substring(0, 10)}`;
            const isErrorFromEditor = msg.role === 'user' && (msg.content.includes('Hola Zeus, tengo este error') || msg.content.includes('Enviado a Zeus para corrección'));
            const messageDate = msg.createdAt ? new Date(msg.createdAt) : null;
            const messageTime = messageDate && !Number.isNaN(messageDate.getTime())
              ? messageDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : '';
            const msgExecutedCount = executedCommands[msgId] || 0;
            const msgCodeBubbles = messageCodeBubbles[msgId] || [];
            const showInlineCodeBlocks = !(msg.role === 'assistant' && msgCodeBubbles.length > 0);
            const shouldExpandMessageContainer =
              msg.role === 'assistant' && (msgCodeBubbles.length > 0 || (showTerminal && terminalAnchorMessageId === msgId));

            return (
              <div key={msgId} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} group`}>
                {/* Header del mensaje con remitente y fecha */}
                <div className={`flex items-center gap-2 mb-1 text-xs text-muted-foreground/80 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'
                  }`}>
                  {msg.role === 'assistant' ? (
                    <>
                      <span className="font-medium text-success">Zeus</span>
                      {messageTime && <span>{messageTime}</span>}
                    </>
                  ) : (
                    <>
                      <span className="font-medium text-primary">User</span>
                      {messageTime && <span>{messageTime}</span>}
                    </>
                  )}
                </div>

                <div
                  className={`${shouldExpandMessageContainer ? 'w-full max-w-none' : 'max-w-[90%]'} rounded-2xl px-4 py-3 text-sm font-medium overflow-hidden relative shadow-none ${msg.role === 'user' ? 'rounded-br-sm' : 'rounded-bl-sm'
                    } ${speakingIndex === i && msg.role === 'assistant' ? 'cursor-pointer hover:bg-white/5' : ''}`}
                  style={{
                    background: msg.role === 'user'
                      ? isErrorFromEditor
                        ? 'linear-gradient(to left, rgba(225, 29, 72, 0.2), rgba(225, 29, 72, 0))'
                        : 'linear-gradient(to left, rgba(16, 185, 129, 0.15), rgba(16, 185, 129, 0))'
                      : 'linear-gradient(to right, rgba(75, 85, 99, 0.25), rgba(75, 85, 99, 0))',
                    color: '#ffffff',
                    borderRight: msg.role === 'user' ? '2px solid rgba(16, 185, 129, 0.3)' : 'none',
                    borderLeft: msg.role === 'assistant' ? '2px solid rgba(156, 163, 175, 0.3)' : 'none',
                    backdropFilter: 'none',
                  }}
                  onClick={(e) => {
                    if (speakingIndex === i && msg.role === 'assistant') {
                      handleTextClick(i, e);
                    }
                  }}
                  title={speakingIndex === i && msg.role === 'assistant' ? 'Haz click para saltar a esta posición' : undefined}
                >
                  {msg.toolLog && msg.toolLog.length > 0 && (
                    <ToolCallDisplay toolLog={msg.toolLog} />
                  )}

                  {renderMessageContent(
                    msg.content,
                    t,
                    setShowTerminal,
                    msgId,
                    msgExecutedCount,
                    () => handleCommandComplete(msgId),
                    isErrorFromEditor,
                    showInlineCodeBlocks,
                    msgCodeBubbles,
                    isMaximized,
                    () => setTerminalAnchorMessageId(msgId),
                    async (json) => {
                      const result = await handleApplyCodeChange(json, msgId);
                      if (!result.ok) {
                        alert('Error aplicando cambios:\n' + result.message);
                      }
                      // Si ok, addCorrection ya encoló la corrección → IDETab abrirá el archivo y CodeEditor mostrará diff rojo/verde con botones aceptar/cancelar
                    },
                    appliedCodeChanges
                  )}

                  {showTerminal && terminalAnchorMessageId === msgId && (
                    <div className="mt-3">
                      <ChatTerminalBubble isVisible={true} isMaximized={isMaximized} />
                    </div>
                  )}
                </div>
                <div className={`flex items-center gap-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                  <button
                    onClick={() => copyToClipboard(msg.content, i)}
                    className="p-1 rounded hover:bg-card text-muted-foreground/80 transition-colors"
                    title={t('copy')}
                  >
                    {copiedIndex === i ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  {speakingIndex === i ? (
                    <>
                      <button
                        onClick={togglePauseSpeaking}
                        className={`p-1 rounded hover:bg-card transition-colors text-green-400`}
                        title={isPaused ? 'Reanudar' : 'Pausar'}
                      >
                        {isPaused ? <Play className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => stopSpeaking()}
                        className="p-1 rounded hover:bg-card transition-colors text-red-400"
                        title="Detener"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => speakMessage(i, msg.content)}
                      className={`p-1 rounded hover:bg-card transition-colors text-muted-foreground/80`}
                      title={t('listen')}
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}

        {showTerminal && terminalAnchorMessageId === '__floating-terminal__' && (
          <div className="flex flex-col items-start w-full mt-4">
            <div className="flex items-center gap-2 mb-1 text-xs text-muted-foreground/80">
              <span className="font-medium text-success">Zeus</span>
            </div>
            <div className="w-full">
              <ChatTerminalBubble isVisible={true} isMaximized={isMaximized} />
            </div>
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-start group">
            <div className="flex items-center gap-2 mb-1 text-xs text-muted-foreground/80">
              <span className="font-medium text-success">Zeus</span>
            </div>
            <div
              className="max-w-[90%] rounded-2xl px-4 py-3 text-sm font-medium overflow-hidden relative shadow-none rounded-bl-sm"
              style={{
                background: 'linear-gradient(to right, rgba(75, 85, 99, 0.25), rgba(75, 85, 99, 0))',
                color: '#ffffff',
                borderLeft: '2px solid rgba(156, 163, 175, 0.3)',
                backdropFilter: 'none',
              }}
            >
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce"></div>
              </div>
            </div>
          </div>
        )}

        {!loading && (() => {
          const typingMessages = messages.filter(
            (m) => m.role === 'assistant' && String(m.id || '').startsWith('stage-typing-')
          );
          if (typingMessages.length === 0) return null;

          const activeTyping = typingMessages[typingMessages.length - 1];
          return (
            <div className="flex flex-col items-start group">
              <div className="flex items-center gap-2 mb-1 text-xs text-muted-foreground/80">
                <span className="font-medium text-success">Zeus</span>
              </div>
              <div
                className="max-w-[90%] rounded-2xl px-4 py-3 text-sm font-medium overflow-hidden relative shadow-none rounded-bl-sm"
                style={{
                  background: 'linear-gradient(to right, rgba(75, 85, 99, 0.25), rgba(75, 85, 99, 0))',
                  color: '#ffffff',
                  borderLeft: '2px solid rgba(156, 163, 175, 0.3)',
                  backdropFilter: 'none',
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm text-foreground/80">
                    {String(activeTyping.content || '').replace(/\.{1,3}$/, '')}
                  </span>
                  <div className="flex items-center gap-1">
                    <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                    <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                    <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" />
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={(e) => { e.preventDefault(); sendMessage(); }} className="p-3 border-t border-border/50 bg-background flex gap-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            // Aquí puedes manejar los archivos seleccionados
            console.log('Archivos seleccionados:', files);
            // Resetear el input para permitir seleccionar los mismos archivos nuevamente
            e.target.value = '';
          }}
        />
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted"
            title={t('attachFile')}
          >
            <Paperclip className="w-4 h-4" />
          </button>
          {(loading || isStreaming) && (
            <button
              type="button"
              onClick={stopGeneration}
              className="p-1.5 text-rose-500 hover:text-rose-400 transition-colors animate-pulse"
              title={t('stopZeus')}
            >
              <Square className="w-4 h-4 fill-current" />
            </button>
          )}
        </div>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('typeMessage')}
          className="flex-1 bg-card border border-border/50 rounded-xl px-3 py-2 text-foreground text-sm outline-none focus:ring-2 focus:ring-emerald-500 resize-y min-h-[72px] max-h-[120px]"
          rows={2}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
        />
        <div className="flex flex-col gap-1">
          <button
            type="submit"
            disabled={!input.trim() && attachedFiles.length === 0}
            className="p-2.5 bg-success hover:bg-emerald-700 rounded-xl text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            <Send className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setWebSearchEnabled((prev) => !prev)}
            title={webSearchEnabled ? 'Desactivar búsqueda web' : 'Activar búsqueda web'}
            className={`p-2.5 rounded-xl text-foreground transition-all ${
              webSearchEnabled
                ? 'bg-sky-600 hover:bg-sky-700'
                : 'bg-muted hover:bg-muted/80'
            }`}
          >
            <Globe className={`w-4 h-4 ${webSearchEnabled ? 'animate-pulse' : ''}`} />
          </button>
        </div>
      </form>
    </div>
  );

  if (isMaximized && mounted && typeof document !== 'undefined') {
    return (
      <>
        {createPortal(chatFullContent, document.body)}
        <ApiConfigModal
          isOpen={isApiConfigModalOpen}
          onClose={() => setIsApiConfigModalOpen(false)}
          selectedModel={selectedModel ? {
            id: selectedModel.id,
            name: selectedModel.name || selectedModel.nombre_modelo,
            provider: selectedModel.provider || '',
            apiUrl: selectedModel.base_url || '',
            apiKey: selectedModel.api_key || '',
            modelName: selectedModel.modelName || selectedModel.name || selectedModel.model_name || selectedModel.model || '',
            temperature: selectedModel.config?.temperature ?? 0.7,
            maxTokens: selectedModel.config?.maxTokens ?? 2048,
            topP: selectedModel.config?.topP ?? 1,
            frequencyPenalty: selectedModel.config?.frequencyPenalty ?? 0,
            presencePenalty: selectedModel.config?.presencePenalty ?? 0,
            systemPrompt: selectedModel.config?.systemPrompt ?? ''
          } : null}
          models={(useStore.getState().models || []).map(m => ({
            id: m.id,
            name: m.name || m.nombre_modelo,
            provider: m.provider || '',
            apiUrl: m.base_url || '',
            apiKey: m.api_key || '',
            modelName: m.model_name || '',
            temperature: m.config?.temperature ?? 0.7,
            maxTokens: m.config?.maxTokens ?? 2048,
            topP: m.config?.topP ?? 1,
            frequencyPenalty: m.config?.frequencyPenalty ?? 0,
            presencePenalty: m.config?.presencePenalty ?? 0,
            systemPrompt: m.config?.systemPrompt ?? ''
          }))}
        />
      </>
    );
  }

  return (
    <>
      {chatFullContent}
      <ApiConfigModal
        isOpen={isApiConfigModalOpen}
        onClose={() => setIsApiConfigModalOpen(false)}
        selectedModel={selectedModel ? {
          id: selectedModel.id,
          name: selectedModel.name || selectedModel.nombre_modelo,
          provider: selectedModel.provider || '',
          apiUrl: selectedModel.base_url || '',
          apiKey: selectedModel.api_key || '',
          modelName: selectedModel.model || selectedModel.model_name || '',
          temperature: selectedModel.config?.temperature ?? 0.7,
          maxTokens: selectedModel.config?.maxTokens ?? 2048,
          topP: selectedModel.config?.topP ?? 1,
          frequencyPenalty: selectedModel.config?.frequencyPenalty ?? 0,
          presencePenalty: selectedModel.config?.presencePenalty ?? 0,
          systemPrompt: selectedModel.config?.systemPrompt ?? ''
        } : null}
        models={(useStore.getState().models || []).map(m => ({
          id: m.id,
          name: m.name || m.nombre_modelo,
          provider: m.provider || '',
          apiUrl: m.base_url || '',
          apiKey: m.api_key || '',
          modelName: m.model_name || '',
          temperature: m.config?.temperature ?? 0.7,
          maxTokens: m.config?.maxTokens ?? 2048,
          topP: m.config?.topP ?? 1,
          frequencyPenalty: m.config?.frequencyPenalty ?? 0,
          presencePenalty: m.config?.presencePenalty ?? 0,
          systemPrompt: m.config?.systemPrompt ?? ''
        }))}
      />
      <VoiceConfigModal
        isOpen={isVoiceConfigModalOpen}
        onClose={() => setIsVoiceConfigModalOpen(false)}
        rate={voiceRate}
        setRate={(v) => { setVoiceRate(v); localStorage.setItem('zeus_voice_rate', String(v)); }}
        pitch={voicePitch}
        setPitch={(v) => { setVoicePitch(v); localStorage.setItem('zeus_voice_pitch', String(v)); }}
        voices={availableVoices}
        selectedVoiceURI={selectedVoiceURI}
        onVoiceChange={(uri) => {
          setSelectedVoiceURI(uri);
          localStorage.setItem('zeus_voice_uri', uri);
          const voice = availableVoices.find(v => v.voiceURI === uri);
          if (voice) voiceRef.current = voice;
        }}
        showAll={showAllVoices}
        setShowAll={setShowAllVoices}
        isStreamingEnabled={isStreamingEnabled}
        setIsStreamingEnabled={setIsStreamingEnabled}
        streamSpeed={streamSpeed}
        setStreamSpeed={(v) => { setStreamSpeed(v); localStorage.setItem('zeus_stream_speed', String(v)); }}
        streamChars={streamChars}
        setStreamChars={(v) => { setStreamChars(v); localStorage.setItem('zeus_stream_chars', String(v)); }}
        streamWarmup={streamWarmup}
        setStreamWarmup={(v) => { setStreamWarmup(v); localStorage.setItem('zeus_stream_warmup', String(v)); }}
      />
      </>
      );
      }

      function VoiceConfigModal({
      isOpen,
      onClose,
      rate,
      setRate,
      pitch,
      setPitch,
      voices,
      selectedVoiceURI,
      onVoiceChange,
      showAll,
      setShowAll,
      isStreamingEnabled,
      setIsStreamingEnabled,
      streamSpeed,
      setStreamSpeed,
      streamChars,
      setStreamChars,
      streamWarmup,
      setStreamWarmup
      }: {
      isOpen: boolean;
      onClose: () => void;
      rate: number;
      setRate: (v: number) => void;
      pitch: number;
      setPitch: (v: number) => void;
      voices: SpeechSynthesisVoice[];
      selectedVoiceURI: string;
      onVoiceChange: (uri: string) => void;
      showAll: boolean;
      setShowAll: (v: boolean) => void;
      isStreamingEnabled: boolean;
      setIsStreamingEnabled: (v: boolean) => void;
      streamSpeed: number;
      setStreamSpeed: (v: number) => void;
      streamChars: number;
      setStreamChars: (v: number) => void;
      streamWarmup: number;
      setStreamWarmup: (v: number) => void;
      }) {
      if (!isOpen) return null;

      const filteredVoices = voices
      .filter(v => {
      if (showAll) return true;
      const l = v.lang.toLowerCase();
      const n = v.name.toLowerCase();
      return l.includes('es') || l.includes('spa') || n.includes('spanish') || n.includes('español');
      })
      .sort((a, b) => a.lang.localeCompare(b.lang));

      return createPortal(
      <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-background/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md bg-card border border-border/80 rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between p-4 border-b border-border/80">
          <div className="flex items-center gap-2">
            <Volume2 className="w-5 h-5 text-success" />
            <h3 className="font-semibold text-foreground text-lg">Ajustes de Voz y Stream</h3>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-card rounded-lg text-muted-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
          {/* SECCIÓN: VOZ */}
          <div className="space-y-4 pb-4 border-b border-border/40">
            <h4 className="text-[10px] font-bold text-success uppercase tracking-widest">Sintetizador de Voz</h4>

            {/* Selección de Voz */}
            <div className="space-y-2">
              <div className="flex justify-between items-end">
                <label className="text-xs font-medium text-muted-foreground">Voz Seleccionada</label>
                <button 
                  onClick={() => setShowAll(!showAll)}
                  className="text-[10px] text-success hover:underline font-bold"
                >
                  {showAll ? 'Español' : 'Ver Todas'}
                </button>
              </div>
              <select
                value={selectedVoiceURI}
                onChange={(e) => onVoiceChange(e.target.value)}
                className="w-full bg-background border border-border/50 rounded-xl px-3 py-2 text-foreground text-sm outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {filteredVoices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
            </div>

            {/* Sliders Voz */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <label className="text-xs text-muted-foreground">Velocidad</label>
                  <span className="text-[10px] font-mono text-success">{rate}x</span>
                </div>
                <input type="range" min="0.5" max="2" step="0.1" value={rate} onChange={(e) => setRate(parseFloat(e.target.value))} className="w-full accent-emerald-500 bg-muted h-1 rounded-lg appearance-none cursor-pointer" />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <label className="text-xs text-muted-foreground">Tono</label>
                  <span className="text-[10px] font-mono text-success">{pitch}</span>
                </div>
                <input type="range" min="0.5" max="2" step="0.1" value={pitch} onChange={(e) => setPitch(parseFloat(e.target.value))} className="w-full accent-emerald-500 bg-muted h-1 rounded-lg appearance-none cursor-pointer" />
              </div>
            </div>
          </div>

          {/* SECCIÓN: STREAMING */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-[10px] font-bold text-success uppercase tracking-widest">Ajustes de Streaming</h4>
              <button
                onClick={() => setIsStreamingEnabled(!isStreamingEnabled)}
                className={`relative w-9 h-5 rounded-full transition-colors ${isStreamingEnabled ? 'bg-emerald-500' : 'bg-muted'}`}
              >
                <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${isStreamingEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </div>

            {isStreamingEnabled && (
              <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                {/* Velocidad Stream */}
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <label className="text-xs text-muted-foreground">Pausa entre palabras (ms)</label>
                    <span className="text-[10px] font-mono text-success">{streamSpeed}ms</span>
                  </div>
                  <input type="range" min="20" max="5000" step="10" value={streamSpeed} onChange={(e) => setStreamSpeed(parseInt(e.target.value))} className="w-full accent-emerald-500 bg-muted h-1 rounded-lg appearance-none cursor-pointer" />
                </div>

                {/* Caracteres por frame */}
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <label className="text-xs text-muted-foreground">Caracteres por impulso</label>
                    <span className="text-[10px] font-mono text-success">{streamChars}</span>
                  </div>
                  <input type="range" min="1" max="500" step="1" value={streamChars} onChange={(e) => setStreamChars(parseInt(e.target.value))} className="w-full accent-emerald-500 bg-muted h-1 rounded-lg appearance-none cursor-pointer" />
                </div>

                {/* Retraso Inicial */}
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <label className="text-xs text-muted-foreground">Retraso inicial (ms)</label>
                    <span className="text-[10px] font-mono text-success">{streamWarmup}ms</span>
                  </div>
                  <input type="range" min="0" max="30000" step="100" value={streamWarmup} onChange={(e) => setStreamWarmup(parseInt(e.target.value))} className="w-full accent-emerald-500 bg-muted h-1 rounded-lg appearance-none cursor-pointer" />
                </div>
              </div>
            )}
          </div>

          <button
            onClick={onClose}
            className="w-full py-3 bg-success/20 hover:bg-success/30 text-success border border-success/30 rounded-xl font-bold text-xs uppercase tracking-widest transition-all mt-4"
          >
            Aplicar Cambios
          </button>
        </div>
      </motion.div>
      </div>,
      document.body
      );
      }