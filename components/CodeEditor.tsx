'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Editor, { useMonaco, OnMount, BeforeMount } from '@monaco-editor/react';
import { Button } from '@/components/ui/button';
import { Save, File as FileIcon, SaveAll, Download, Code, Image as ImageIcon, Music, Video, Sparkles, Database, Folder, Zap, Check, X as CloseIcon, X, RotateCcw, ChevronsUp, ChevronsDown, ChevronUp, ChevronDown } from 'lucide-react';
import { useEditor } from '@/context/editor-context';
import { useToast } from '@/hooks/use-toast';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { useStore } from '@/lib/store';
import { onThemeChange, getStoredTheme, emitThemeChange } from '@/lib/zeus-monaco/theme';
import { getActiveMonacoTheme, onMonacoThemeChange } from '@/lib/zeus-monaco/monaco-theme-service';
// host se importa dinámicamente en beforeMount para no romper el SSR
// (host.ts → monaco-editor → window no definido en server).
// import { host as zeusHost } from '@/lib/zeus-monaco/host';

// Utilidades para detectar tipos de archivos multimedia
const isImageFile = (path: string): boolean => {
  const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.webp', '.ico'];
  return imageExtensions.some(ext => path.toLowerCase().endsWith(ext));
};

const isAudioFile = (path: string): boolean => {
  const audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'];
  return audioExtensions.some(ext => path.toLowerCase().endsWith(ext));
};

const isVideoFile = (path: string): boolean => {
  const videoExtensions = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv'];
  return videoExtensions.some(ext => path.toLowerCase().endsWith(ext));
};

// Escapar HTML para previsualizaciones seguras
const escapeHtml = (str: string): string => {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
};

// Tema oscuro personalizado con azul oscuro
const customTheme = {
  base: 'vs-dark' as const,
  inherit: true,
  rules: [{
    token: 'comment',
    foreground: '7FDBFF',
    fontStyle: 'italic'
  },
  {
    token: 'keyword',
    foreground: '7FB3FF',
    fontStyle: 'bold'
  },
  {
    token: 'string',
    foreground: 'FF9E7D'
  },
  {
    token: 'number',
    foreground: 'A5D8FF'
  },
  {
    token: 'type',
    foreground: '4EC9B0'
  }, {
    token: 'function',
    foreground: 'DCDCAA'
  }, {
    token: 'variable',
    foreground: 'B2DFFF'
  },
  {
    token: 'tag',
    foreground: '7FB3FF'
  },
  {
    token: 'attribute.name',
    foreground: 'B2DFFF'
  },
  {
    token: 'attribute.value',
    foreground: 'FF9E7D'
  }
  ],
  colors: {
    // Fondo del editor: el color de la app es gray-950 (#030712). El editor
    // usa un azul más profundo (#04070e) para distinguirse visualmente del
    // chrome del IDE (top bar, sidebars) que sí usa gray-950.
    'editor.background': '#04070e',
    'editor.foreground': '#E2E8F0',
    'editorLineNumber.foreground': '#444444',
    'editor.selectionBackground': '#222222',
    'editor.inactiveSelectionBackground': '#111111',
    'editorCursor.foreground': '#E2E8F0',
    'editorSuggestWidget.background': '#1E293B',
    'editorSuggestWidget.highlightForeground': '#7FB3FF',
    'editorSuggestWidget.selectedBackground': '#334155',
    'editor.wordHighlightBackground': '#33415580',
    'editor.wordHighlightStrongBackground': '#1E4E8C',
    'editor.findMatchBackground': '#3B82F6',
    'editor.findMatchHighlightBackground': '#3B82F680',
    'editor.findRangeHighlightBackground': '#3B82F640',
    'editor.hoverHighlightBackground': '#3B82F640',
    'editor.lineHighlightBorder': '#1E293B',
    'editor.rangeHighlightBackground': '#3B82F620',
    'editor.selectionHighlightBackground': '#3B82F640',
    'editor.selectionHighlightBorder': '#3B82F6',
    'editorInfo.foreground': '#7FB3FF',
    'editorWarning.foreground': '#FBBF24',
    'editorError.foreground': '#F87171',
    'editorBracketMatch.background': '#3B82F620',
    'editor.bracketMatch.border': '#7FB3FF',
    'editorBracketHighlight.foreground1': '#7FB3FF',
    'editorBracketHighlight.foreground2': '#F472B6',
    'editorBracketHighlight.foreground3': '#34D399',
    'editorBracketHighlight.foreground4': '#FBBF24',
    'editorBracketHighlight.foreground5': '#A78BFA',
    'editorBracketHighlight.foreground6': '#FCD34D',
    // Diff sin fondo tintado (solo subrayado vía decoraciones custom)
    'diffEditor.insertedTextBackground': '#00000000',
    'diffEditor.removedTextBackground': '#00000000',
    'diffEditor.insertedLineBackground': '#00000000',
    'diffEditor.removedLineBackground': '#00000000',
    'diffEditor.insertedTextBorder': '#00000000',
    'diffEditor.removedTextBorder': '#00000000',
    'diffEditor.diagonalFill': '#00000000',
    'diffEditorGutter.insertedLineBackground': '#00000000',
    'diffEditorGutter.removedLineBackground': '#00000000',
    'diffEditorOverview.insertedForeground': '#00000000',
    'diffEditorOverview.removedForeground': '#00000000',
    'diffEditorOverview.border': '#00000000',
    'editor.lineHighlightBackground': '#ffffff08',
    'editorBracketHighlight.unexpectedBracket.foreground': '#F87171'
  }
};


const normalizeCorrectionFolderPath = (rawPath: string | null | undefined, fileName: string): string => {
  if (!rawPath || typeof rawPath !== 'string') return '';

  let normalized = rawPath.replace(/\\/g, '/').trim();
  if (!normalized) return '';

  normalized = normalized.replace(/^\/+/, '').replace(/\/+$/, '');

  if (!normalized) return '';

  if (normalized === fileName) {
    return '';
  }

  if (normalized.endsWith(`/${fileName}`)) {
    normalized = normalized.slice(0, -(`/${fileName}`).length);
  }

  return normalized.replace(/\/+$/, '');
};

interface CodeEditorProps {
  content: string;
  onSave: (path: string, content: string) => Promise<void>;
  path: string | null;
  projectId?: string | null;
  projectRoot?: string | null;
  showGenerationToggle?: boolean;
  onToggleToGeneration?: () => void;
  readOnly?: boolean;
  onCorrectFile?: () => void;
  isCorrecting?: boolean;
}

export default function CodeEditor({
  content,
  onSave,
  path,
  projectId,
  projectRoot,
  showGenerationToggle = false,
  onToggleToGeneration,
  readOnly = false,
  onCorrectFile,
  isCorrecting = false
}: CodeEditorProps) {
  const editorRef = useRef<any>(null);
  const monaco = useMonaco();
  const {
    setEditorRef,
    correctionQueue,
    pendingCorrection,
    removeCorrection,
    setOpenFiles,
    openFiles,
    activeFile,
    openFile,
    askZeus
  } = useEditor();
  const [code, setCode] = useState(content);
  const [isDirty, setIsDirty] = useState(false);
  const [showSavedCheck, setShowSavedCheck] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  // Tema activo del editor. Refleja el id persistido en localStorage
  // y se actualiza cuando el ThemePicker emite 'zeus:monaco-theme-changed'.
  // Se pasa como prop `theme` al <Editor> para que Monaco lo aplique en
  // mount, y también se usa como fallback en handleEditorDidMount.
  const [activeTheme, setActiveTheme] = useState<string>(() => {
    if (typeof window === 'undefined') return 'zeus-dark';
    try {
      return window.localStorage.getItem('zeus.monaco.theme') || 'zeus-dark';
    } catch {
      return 'zeus-dark';
    }
  });

  // Sincronizar code con content cuando cambia el archivo
  useEffect(() => {
    setCode(content);
    setIsDirty(false);
  }, [content]);

  // Scroll automático al final cuando el contenido cambia en modo readOnly (streaming)
  useEffect(() => {
    if (!readOnly || !editorRef.current || !content) return;
    const editor = editorRef.current;
    const model = editor.getModel?.();
    if (model) {
      const lineCount = model.getLineCount();
      editor.revealLine(lineCount);
    }
  }, [content, readOnly]);

  const [isEditorReady, setIsEditorReady] = useState(false);
  const { toast } = useToast();

  // Estado para corrección de errores con IA (solo loading)
  const [isAnalyzingError, setIsAnalyzingError] = useState(false);

  // Retry counter para forzar re-procesamiento de correcciones pendientes
  const [correctionRetry, setCorrectionRetry] = useState(0);

  const decorationIdsRef = useRef<string[]>([]);
  const monacoRef = useRef<any>(null);
  const processedCorrectionRef = useRef<string | null>(null);

  // Nuevo sistema de correcciones inline (code_change con replacements)
  interface CodeReplacement {
    id: string;
    oldText: string;
    newText: string;
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
    status: 'pending' | 'accepted' | 'rejected';
  }

  const [replacements, setReplacements] = useState<CodeReplacement[]>([]);
  const [activeReplacementIndex, setActiveReplacementIndex] = useState(0);
  const [replacementDecorationIds, setReplacementDecorationIds] = useState<string[]>([]);
  const viewZonesRef = useRef<Record<string, string>>({}); // rep.id -> zoneId

  useEffect(() => {
    setIsMounted(true);
    return () => {
      setIsMounted(false);
    };
  }, []);

  const triggerSavedCheck = useCallback(() => {
    setShowSavedCheck(true);
    setTimeout(() => setShowSavedCheck(false), 2500);
  }, []);


  // Función para obtener corrección de error desde IA en segundo plano
  // Devuelve { suggestedFix: string, codeChange: object|null }
  const fetchErrorCorrection = useCallback(async (
    errorCode: string,
    errorMessage: string,
    language: string,
    contextStartLine?: number,
    attempt: number = 1,
    openFiles?: Array<{ path: string; name: string; content: string }>,
    projectStructure?: string
  ): Promise<{ suggestedFix: string; codeChange: any | null }> => {
    const MAX_ATTEMPTS = 3;

    try {
      const storeState = useStore.getState();
      console.log('[CodeEditor] Estado del store:', {
        selectedModel: storeState.selectedModel?.nombre_modelo,
        hasModels: storeState.models.length,
        user: storeState.user?.email
      });

      const selectedModel = storeState.selectedModel || (storeState.models.length > 0 ? storeState.models[0] : null);

      if (!selectedModel) {
        console.warn('[CodeEditor] No hay modelos configurados');
        toast({
          title: 'Sin modelos',
          description: 'Configura un modelo en la barra de navegación',
          variant: 'destructive'
        });
        return { suggestedFix: errorCode, codeChange: null };
      }

      console.log('[CodeEditor] Solicitando corrección a IA...', {
        error: errorMessage,
        language,
        model: selectedModel.nombre_modelo,
        provider: selectedModel.provider,
        contextStartLine,
        attempt
      });

      console.log('[CodeEditor] Enviando modelRecordId:', selectedModel.id);

      const response = await fetch('/api/fix-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: errorCode,
          error: errorMessage,
          language,
          modelRecordId: selectedModel.id,
          contextStartLine,
          attempt,
          openFiles,
          projectStructure
        })
      });

      if (response.ok) {
        const data = await response.json();
        console.log('[CodeEditor] Respuesta de IA:', data);

        // Nuevo formato: code_change con replacements
        if (data.codeChange && data.codeChange.changes?.length > 0) {
          console.log('[CodeEditor] code_change recibido con', data.codeChange.changes.length, 'cambio(s)');
          // Generar vista previa del código corregido aplicando los replacements
          let previewCode = errorCode;
          for (const change of data.codeChange.changes) {
            for (const rep of change.replacements) {
              const oldStr = (rep.old || '').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
              const newStr = (rep.new || '').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
              if (oldStr && previewCode.includes(oldStr)) {
                previewCode = previewCode.replace(oldStr, newStr);
              } else if (!oldStr) {
                // Insertar al inicio del archivo
                previewCode = newStr + '\n' + previewCode;
              }
            }
          }
          return { suggestedFix: previewCode, codeChange: data.codeChange };
        }

        // Sin corrección disponible
        if (data.message) {
          console.warn('[CodeEditor] IA devolvió mensaje:', data.message);
          if (attempt < MAX_ATTEMPTS) {
            console.log('[CodeEditor] Reintentando...', attempt + 1);
            return fetchErrorCorrection(errorCode, errorMessage, language, contextStartLine, attempt + 1, openFiles, projectStructure);
          }
          toast({
            title: 'Sin corrección',
            description: data.message,
            variant: 'default'
          });
        } else {
          console.warn('[CodeEditor] IA no devolvió code_change');
          if (attempt < MAX_ATTEMPTS) {
            console.log('[CodeEditor] Reintentando automáticamente...', attempt + 1);
            return fetchErrorCorrection(errorCode, errorMessage, language, contextStartLine, attempt + 1, openFiles, projectStructure);
          }
        }
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.warn('[CodeEditor] Error en API de corrección:', response.status, errorData);
        if (attempt < MAX_ATTEMPTS) {
          console.log('[CodeEditor] Reintentando por error de API...', attempt + 1);
          return fetchErrorCorrection(errorCode, errorMessage, language, contextStartLine, attempt + 1, openFiles, projectStructure);
        }
        toast({
          title: 'Error en corrección',
          description: errorData.error || 'Error al conectar con la IA',
          variant: 'destructive'
        });
      }
    } catch (error) {
      console.error('[CodeEditor] Error al obtener corrección:', error);
      if (attempt < MAX_ATTEMPTS) {
        console.log('[CodeEditor] Reintentando por excepción...', attempt + 1);
        return fetchErrorCorrection(errorCode, errorMessage, language, contextStartLine, attempt + 1, openFiles, projectStructure);
      }
      toast({
        title: 'Error',
        description: 'No se pudo obtener la corrección',
        variant: 'destructive'
      });
    }
    return { suggestedFix: errorCode, codeChange: null };
  }, []);

  // Manejar click en un marcador de error
  const handleErrorClick = useCallback(async (marker: any, model: any, monacoInstance: any) => {
    const range = new monacoInstance.Range(
      marker.startLineNumber,
      marker.startColumn,
      marker.endLineNumber,
      marker.endColumn
    );

    // Obtener el código afectado
    const errorCode = model.getValueInRange(range);

    // Enviar SIEMPRE el archivo completo para que el modelo tenga todo el contexto
    const fullFileCode = model.getValue();
    const totalLines = model.getLineCount();

    // Calcular la línea exacta del error para indicársela al modelo
    const errorLine = marker.startLineNumber;

    // Obtener la ruta real del archivo desde marker.resource
    const errorFilePath = marker.resource?.path
      ? marker.resource.path.replace(/^\//, '').replace(/\//g, '\\')
      : path;

    console.log('[CodeEditor] Error click:', {
      message: marker.message,
      errorCode,
      errorLine,
      totalLines,
      sendingFullFile: true,
      errorFilePath,
      markerResource: marker.resource?.toString()
    });

    // Mostrar estado de carga
    setIsAnalyzingError(true);

    // Enviar solo el archivo completo para contexto (sin archivos adicionales)
    const openFilesContext: any[] = [];

    // Obtener estructura del proyecto en segundo plano
    let structureTree = '';
    try {
      const response = await fetch('/api/schema/simple');
      const result = await response.json();
      if (result.success && result.schema) {
        const formatSchema = (node: any, depth = 0): string => {
          if (!node) return '';
          const indent = '  '.repeat(depth);
          if (node.type === 'directory') {
            let out = `${indent}${node.name}/\n`;
            if (node.children) node.children.forEach((c: any) => { out += formatSchema(c, depth + 1); });
            return out;
          } else if (node.type === 'file') {
            return `${indent}${node.name}\n`;
          }
          return '';
        };
        structureTree = `\n\n🌳 ESTRUCTURA DEL PROYECTO:\n${formatSchema(result.schema)}`;
      }
    } catch (error) {
      console.warn('[CodeEditor] No se pudo obtener la estructura del proyecto:', error);
    }

    const correctionResult = await fetchErrorCorrection(
      fullFileCode,
      marker.message,
      model.getLanguageId(),
      errorLine,
      1,
      openFilesContext,
      structureTree
    );

    setIsAnalyzingError(false);

    // Si hay code_change, procesar con el nuevo sistema
    if (correctionResult.codeChange) {
      processCodeChange(correctionResult.codeChange);
      return;
    }

    // Si no hay code_change, aplicar decoración de error simple
    const editor = editorRef.current;
    if (editor) {
      const errorDecorationId = editor.deltaDecorations(
        [],
        [{
          range,
          options: {
            isWholeLine: false,
            className: 'zeus-error-highlight',
            hoverMessage: { value: marker.message }
          }
        }]
      );
      return errorDecorationId;
    }

    return [];
  }, [fetchErrorCorrection]);

  const getLanguageFromPath = useCallback((filePath: string | null): string => {
    if (!filePath) return 'javascript';
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    const languageMap: Record<string, string> = {
      'js': 'javascript', 'jsx': 'javascript', 'ts': 'typescript', 'tsx': 'typescript',
      'json': 'json', 'css': 'css', 'scss': 'scss', 'sass': 'sass', 'less': 'less',
      'html': 'html', 'htm': 'html', 'xml': 'xml', 'md': 'markdown', 'py': 'python',
      'java': 'java', 'c': 'c', 'cpp': 'cpp', 'h': 'c', 'hpp': 'cpp', 'go': 'go',
      'rs': 'rust', 'php': 'php', 'rb': 'ruby', 'sh': 'shell', 'bash': 'shell',
      'yml': 'yaml', 'yaml': 'yaml', 'sql': 'sql', 'vue': 'vue', 'svelte': 'svelte'
    };
    return languageMap[ext] || 'javascript';
  }, []);

  useEffect(() => {
    if (!path || !monaco || !editorRef.current) return;

    const model = editorRef.current.getModel?.();
    if (!model) return;

    const detectedLang = getLanguageFromPath(path);
    const currentLang = model.getLanguageId();

    if (currentLang !== detectedLang) {
      monaco.editor.setModelLanguage(model, detectedLang);
    }
    // NOTA: No limpiar los marcadores de error - dejar que TypeScript los genere
  }, [path, monaco, getLanguageFromPath]);

  // Manejo de Correcciones Pendientes (Sincronización de Archivos)
  // NUEVO SISTEMA: Procesar code_change y crear replacements

  // Función auxiliar: normalizar texto para comparación fuzzy
  const normalizeForMatch = useCallback((text: string): string => {
    return text
      .replace(/\r\n/g, '\n')           // normalizar saltos de línea
      .replace(/\t/g, '  ')              // tabs → 2 espacios
      .replace(/ +/g, ' ')              // múltiples espacios → uno
      .replace(/ +\n/g, '\n')           // espacios al final de línea
      .replace(/\n{2,}/g, '\n\n')       // múltiples líneas vacías → máximo 2
      .trim();
  }, []);

  // Función auxiliar: buscar oldStr en fullContent con matching fuzzy
  const findOldStrOffset = useCallback((fullContent: string, oldStr: string): { offset: number; matchedText: string } | null => {
    // 1. Match exacto
    const exactOffset = fullContent.indexOf(oldStr);
    if (exactOffset !== -1) {
      return { offset: exactOffset, matchedText: oldStr };
    }

    // 2. Match normalizando espacios/saltos de línea
    const normalizedContent = normalizeForMatch(fullContent);
    const normalizedOld = normalizeForMatch(oldStr);
    const normOffset = normalizedContent.indexOf(normalizedOld);
    if (normOffset !== -1) {
      // Buscar línea por línea en el contenido original
      const oldLines = oldStr.split('\n').map(l => l.trim());
      const contentLines = fullContent.split('\n');
      for (let startLine = 0; startLine < contentLines.length; startLine++) {
        let match = true;
        for (let j = 0; j < oldLines.length && startLine + j < contentLines.length; j++) {
          if (contentLines[startLine + j].trim() !== oldLines[j]) {
            match = false;
            break;
          }
        }
        if (match && oldLines.length > 0) {
          let offset = 0;
          for (let i = 0; i < startLine; i++) {
            offset += contentLines[i].length + 1;
          }
          const matchedText = contentLines.slice(startLine, startLine + oldLines.length).join('\n');
          return { offset, matchedText };
        }
      }
    }

    // 3. Match por primera y última línea (para bloques grandes)
    const oldLinesFiltered = oldStr.split('\n').filter(l => l.trim());
    if (oldLinesFiltered.length >= 2) {
      const firstLine = oldLinesFiltered[0].trim();
      const lastLine = oldLinesFiltered[oldLinesFiltered.length - 1].trim();
      const contentLines = fullContent.split('\n');

      for (let startLine = 0; startLine < contentLines.length; startLine++) {
        if (contentLines[startLine].trim() === firstLine) {
          for (let endLine = startLine; endLine < contentLines.length; endLine++) {
            if (contentLines[endLine].trim() === lastLine) {
              const matchedText = contentLines.slice(startLine, endLine + 1).join('\n');
              let offset = 0;
              for (let i = 0; i < startLine; i++) {
                offset += contentLines[i].length + 1;
              }
              return { offset, matchedText };
            }
          }
        }
      }
    }

    // 4. Match por subcadena en líneas individuales (para old de 1 línea)
    const oldTrimmed = oldStr.trim();
    if (oldTrimmed.length > 0) {
      const contentLines = fullContent.split('\n');
      for (let i = 0; i < contentLines.length; i++) {
        const line = contentLines[i];
        const lineTrimmed = line.trim();
        // a) El old exacto está contenido en la línea
        const exactIdx = line.indexOf(oldTrimmed);
        if (exactIdx !== -1) {
          let offset = 0;
          for (let k = 0; k < i; k++) {
            offset += contentLines[k].length + 1;
          }
          return { offset: offset + exactIdx, matchedText: oldTrimmed };
        }
        // b) La línea está contenida dentro del old (old truncado)
        if (oldTrimmed.includes(lineTrimmed) && lineTrimmed.length > 0) {
          let offset = 0;
          for (let k = 0; k < i; k++) {
            offset += contentLines[k].length + 1;
          }
          return { offset, matchedText: line };
        }
      }
    }

    // 5. Buscar subcadena parcial: si old es largo, buscar la parte más larga que sí esté
    if (oldTrimmed.length >= 20) {
      // Probar con la primera mitad
      const firstHalf = oldTrimmed.slice(0, Math.floor(oldTrimmed.length * 0.7));
      const idx = fullContent.indexOf(firstHalf);
      if (idx !== -1) {
        // Encontrar líneas completas que contengan esta subcadena
        const contentLines = fullContent.split('\n');
        let currentOffset = 0;
        for (let i = 0; i < contentLines.length; i++) {
          const line = contentLines[i];
          if (currentOffset <= idx && idx < currentOffset + line.length) {
            return { offset: currentOffset, matchedText: line };
          }
          currentOffset += line.length + 1;
        }
      }
    }

    return null;
  }, [normalizeForMatch]);

  const processCodeChange = useCallback((codeChange: any) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco || !codeChange?.changes) {
      console.warn('[CodeEditor][processCodeChange] Editor/Monaco/codeChange no disponible:', { editor: !!editor, monaco: !!monaco, codeChange });
      return;
    }

    const model = editor.getModel();
    if (!model) {
      console.warn('[CodeEditor][processCodeChange] Model no disponible');
      return;
    }

    const fullContent = model.getValue().replace(/\r\n/g, '\n');
    const reps: CodeReplacement[] = [];

    console.log('[CodeEditor][processCodeChange] Procesando code_change:', codeChange);
    console.log('[CodeEditor][processCodeChange] Contenido del archivo (primeros 200 chars):', fullContent.substring(0, 200));

    for (const change of codeChange.changes) {
      console.log('[CodeEditor][processCodeChange] Procesando change:', change.file);
      for (const rep of change.replacements) {
        let oldStr = (rep.old || '').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\r\n/g, '\n');
        const newStr = (rep.new || '').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\r\n/g, '\n');

        console.log('[CodeEditor][processCodeChange] Replacement:', {
          oldStr: oldStr.substring(0, 80),
          newStr: newStr.substring(0, 80),
          found: fullContent.includes(oldStr)
        });

        if (!oldStr && !newStr) continue;

        if (!oldStr) {
          reps.push({
            id: `rep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            oldText: '',
            newText: newStr,
            startLine: 1,
            startCol: 1,
            endLine: 1,
            endCol: 1,
            status: 'pending'
          });
          continue;
        }

        // Intentar match exacto primero
        let offset = fullContent.indexOf(oldStr);
        let matchedText = oldStr;

        // Si no hay match exacto, intentar fuzzy matching
        if (offset === -1) {
          const fuzzyResult = findOldStrOffset(fullContent, oldStr);
          if (fuzzyResult) {
            offset = fuzzyResult.offset;
            matchedText = fuzzyResult.matchedText;
            console.log('[CodeEditor][processCodeChange] Match fuzzy encontrado en offset:', offset, 'longitud original:', oldStr.length, 'longitud matched:', matchedText.length);
          }
        }

        if (offset === -1) {
          const contentPreview = fullContent.substring(0, 300).replace(/\n/g, '\\n');
          console.warn('[CodeEditor] No se encontró oldStr (ni exacto ni fuzzy):', oldStr.substring(0, 100));
          console.warn('[CodeEditor] Contenido del archivo (primeros 300 chars):', contentPreview);
          console.warn('[CodeEditor] Longitud oldStr:', oldStr.length, 'Longitud contenido:', fullContent.length);
          continue;
        }

        const startPos = model.getPositionAt(offset);
        const endPos = model.getPositionAt(offset + matchedText.length);

        reps.push({
          id: `rep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          oldText: matchedText,
          newText: newStr,
          startLine: startPos.lineNumber,
          startCol: startPos.column,
          endLine: endPos.lineNumber,
          endCol: endPos.column,
          status: 'pending'
        });
      }
    }

    console.log('[CodeEditor][processCodeChange] Replacements creados:', reps.length);
    if (reps.length > 0) {
      setReplacements(reps);
      setActiveReplacementIndex(0);
      applyReplacementDecorations(reps);
      editor.revealLineInCenter(reps[0].startLine);
      console.log('[CodeEditor][processCodeChange] View zones aplicadas, replacements:', reps);
    } else {
      console.warn('[CodeEditor][processCodeChange] NO se crearon replacements válidos');
      // Bug fix: Remove stuck correction so it doesn't block the queue forever
      if (pendingCorrection) {
        console.warn('[CodeEditor][processCodeChange] Eliminando corrección atascada de la cola:', pendingCorrection.id);
        setTimeout(() => removeCorrection(pendingCorrection.id), 0);
      }
      toast({ title: 'Corrección fallida', description: 'No se encontró el texto a reemplazar en el archivo. El cambio no se aplicó.', variant: 'destructive' });
    }
  }, [findOldStrOffset, pendingCorrection, removeCorrection]);

  // Refs para handlers de view zones (evitan dependencias circulares)
  const handleAcceptReplacementRef = useRef<((index: number) => void) | null>(null);
  const handleRejectReplacementRef = useRef<((index: number) => void) | null>(null);

  const createViewZone = useCallback((rep: CodeReplacement, index: number, editor: any) => {
    // Crear nodo principal (código nuevo en verde)
    const domNode = document.createElement('div');
    domNode.className = 'zeus-view-zone-line';
    domNode.style.cssText = 'width: 100%; height: 100%; display: flex; align-items: center; font-family: "Fira Code", monospace; font-size: 12px; background: rgba(34,197,94,0.22); border-left: 3px solid rgba(34,197,94,0.85); color: #86efac; padding-left: 8px; box-sizing: border-box; pointer-events: none; text-shadow: 0 0 4px rgba(34,197,94,0.4);';

    // Truncar a 1 línea
    const firstLine = rep.newText.split('\n')[0];
    const suffix = rep.newText.includes('\n') ? ' …' : '';
    domNode.textContent = firstLine + suffix || '(eliminar)';

    // Crear nodo para gutter (botones a la izquierda)
    const marginNode = document.createElement('div');
    marginNode.style.cssText = 'width: 100%; height: 100%; display: flex; align-items: center; justify-content: flex-start; gap: 3px; padding-left: 4px; pointer-events: auto; position: relative; z-index: 50;';

    const acceptBtn = document.createElement('button');
    acceptBtn.textContent = '✓';
    acceptBtn.style.cssText = 'width: 16px; height: 16px; font-size: 10px; line-height: 14px; font-weight: 900; border-radius: 2px; border: none; background: rgba(16,185,129,0.9); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 3px rgba(0,0,0,0.3);';
    acceptBtn.onclick = () => handleAcceptReplacementRef.current?.(index);

    const rejectBtn = document.createElement('button');
    rejectBtn.textContent = '✕';
    rejectBtn.style.cssText = 'width: 16px; height: 16px; font-size: 10px; line-height: 14px; font-weight: 900; border-radius: 2px; border: none; background: rgba(244,63,94,0.9); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 3px rgba(0,0,0,0.3);';
    rejectBtn.onclick = () => handleRejectReplacementRef.current?.(index);

    marginNode.appendChild(acceptBtn);
    marginNode.appendChild(rejectBtn);

    // La view zone se registra dentro de changeViewZones; devolvemos los nodos
    return { domNode, marginNode };
  }, []);

  const applyReplacementDecorations = useCallback((reps: CodeReplacement[]) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    // Limpiar view zones anteriores
    editor.changeViewZones((accessor: any) => {
      Object.values(viewZonesRef.current).forEach((id: any) => accessor.removeZone(id));
    });
    viewZonesRef.current = {};

    const decorations: any[] = [];

    editor.changeViewZones((accessor: any) => {
      for (const rep of reps) {
        if (rep.status !== 'pending') continue;
        if (rep.oldText) {
          decorations.push({
            range: new monaco.Range(rep.startLine, rep.startCol, rep.endLine, rep.endCol),
            options: {
              className: 'zeus-replacement-old',
              inlineClassName: 'zeus-replacement-old-inline',
              overviewRuler: { color: '#ef444480', position: monaco.editor.OverviewRulerLane.Full }
            }
          });
        } else {
          decorations.push({
            range: new monaco.Range(1, 1, 1, 1),
            options: {
              isWholeLine: true,
              className: 'zeus-replacement-insert-line',
              glyphMarginClassName: 'zeus-replacement-insert-glyph'
            }
          });
        }

        const { domNode, marginNode } = createViewZone(rep, reps.indexOf(rep), editor);
        const zoneId = accessor.addZone({
          afterLineNumber: rep.endLine,
          heightInLines: 1,
          domNode,
          marginDomNode: marginNode
        });
        viewZonesRef.current[rep.id] = zoneId;
      }
    });

    const decIds = editor.deltaDecorations(replacementDecorationIds, decorations);
    setReplacementDecorationIds(decIds);
  }, [replacementDecorationIds, createViewZone]);

  const handleAcceptReplacement = useCallback((index: number) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    const model = editor.getModel();
    if (!model) return;

    setReplacements(prev => {
      const updated = [...prev];
      const rep = updated[index];
      if (!rep || rep.status !== 'pending') return prev;

      if (rep.oldText) {
        const range = new monaco.Range(rep.startLine, rep.startCol, rep.endLine, rep.endCol);
        editor.executeEdits('zeus-rep-accept', [{ range, text: rep.newText }]);
      } else {
        editor.executeEdits('zeus-rep-accept', [{
          range: new monaco.Range(1, 1, 1, 1),
          text: rep.newText + '\n'
        }]);
      }

      updated[index] = { ...rep, status: 'accepted' };

      // Recalcular posiciones de los replacements pendientes
      const newContent = model.getValue();
      const oldLinesCount = rep.oldText.split('\n').length;
      const newLinesCount = rep.newText.split('\n').length;
      const lineDelta = newLinesCount - oldLinesCount;

      const recalculated = updated.map((r, i) => {
        if (i === index || r.status !== 'pending') return r;

        // Ajustar líneas de replacements que están DESPUÉS del aceptado
        if (r.startLine > rep.endLine) {
          // Buscar el oldText cerca de la nueva posición esperada
          const expectedLine = r.startLine + lineDelta;
          const expectedOffset = model.getOffsetAt({ lineNumber: expectedLine, column: 1 });
          const searchStart = Math.max(0, expectedOffset - 100);
          const searchEnd = Math.min(newContent.length, expectedOffset + r.oldText.length + 100);
          const nearbyText = newContent.substring(searchStart, searchEnd);
          const localIdx = nearbyText.indexOf(r.oldText);

          if (localIdx !== -1) {
            const actualOffset = searchStart + localIdx;
            const startPos = model.getPositionAt(actualOffset);
            const endPos = model.getPositionAt(actualOffset + r.oldText.length);
            return {
              ...r,
              startLine: startPos.lineNumber,
              startCol: startPos.column,
              endLine: endPos.lineNumber,
              endCol: endPos.column
            };
          }

          // Fallback: solo ajustar líneas si no encontramos el texto cerca
          return {
            ...r,
            startLine: r.startLine + lineDelta,
            endLine: r.endLine + lineDelta
          };
        }

        // Para replacements en la misma región o ANTES, buscar en todo el archivo
        const offset = newContent.indexOf(r.oldText);
        if (offset === -1) return r;
        const startPos = model.getPositionAt(offset);
        const endPos = model.getPositionAt(offset + r.oldText.length);
        return {
          ...r,
          startLine: startPos.lineNumber,
          startCol: startPos.column,
          endLine: endPos.lineNumber,
          endCol: endPos.column
        };
      });

      // Eliminar view zone del replacement aceptado
      const zoneId = viewZonesRef.current[rep.id];
      if (zoneId) {
        editor.changeViewZones((accessor: any) => accessor.removeZone(zoneId));
        delete viewZonesRef.current[rep.id];
      }

      const pending = recalculated.filter(r => r.status === 'pending');
      if (pending.length === 0) {
        editor.deltaDecorations(replacementDecorationIds, []);
        setReplacementDecorationIds([]);
        editor.changeViewZones((accessor: any) => {
          Object.values(viewZonesRef.current).forEach((id: any) => accessor.removeZone(id));
        });
        viewZonesRef.current = {};
        setReplacements([]);
        processedCorrectionRef.current = null;  // Limpiar corrección procesada

        // Guardar cambios en el archivo y sincronizar con openFiles
        const newContent = model.getValue();
        if (path) {
          // Extraer nombre del archivo y ruta
          const lastSlashIndex = path.lastIndexOf('/');
          const fileName = lastSlashIndex >= 0 ? path.substring(lastSlashIndex + 1) : path;
          const folderPath = lastSlashIndex >= 0 ? path.substring(0, lastSlashIndex) : '';

          // Guardar vía API
          fetch('/api/ide-files', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'save', path: folderPath, name: fileName, content: newContent })
          }).then(() => {
            // Sincronizar con openFiles para que todas las pestañas tengan el nuevo contenido
            setOpenFiles(prev => prev.map(f =>
              f.path === path ? { ...f, content: newContent } : f
            ));
            toast({ title: 'Archivo guardado', description: `Cambios aplicados en ${fileName}` });
          }).catch(err => {
            console.error('Error guardando archivo:', err);
            toast({ title: 'Error al guardar', description: 'Los cambios se aplicaron pero no se pudieron guardar', variant: 'destructive' });
          });
        }

        if (pendingCorrection) {
          setTimeout(() => removeCorrection(pendingCorrection.id), 0);
        }
        toast({ title: 'Corrección completada', description: 'Todos los cambios han sido aplicados' });
      } else {
        applyReplacementDecorations(recalculated);
      }

      return recalculated;
    });
  }, [replacementDecorationIds, applyReplacementDecorations, pendingCorrection, removeCorrection, path, setOpenFiles]);

  const handleRejectReplacement = useCallback((index: number) => {
    const editor = editorRef.current;
    setReplacements(prev => {
      const updated = [...prev];
      const rep = updated[index];
      if (!rep) return prev;
      updated[index] = { ...rep, status: 'rejected' };

      if (editor) {
        const zoneId = viewZonesRef.current[rep.id];
        if (zoneId) {
          editor.changeViewZones((accessor: any) => accessor.removeZone(zoneId));
          delete viewZonesRef.current[rep.id];
        }
      }

      const pending = updated.filter(r => r.status === 'pending');
      if (pending.length === 0) {
        if (editor) {
          editor.deltaDecorations(replacementDecorationIds, []);
        }
        setReplacementDecorationIds([]);
        if (editor) {
          editor.changeViewZones((accessor: any) => {
            Object.values(viewZonesRef.current).forEach((id: any) => accessor.removeZone(id));
          });
          viewZonesRef.current = {};
        }
        setReplacements([]);
        processedCorrectionRef.current = null;  // Limpiar corrección procesada
        if (pendingCorrection) {
          setTimeout(() => removeCorrection(pendingCorrection.id), 0);
        }
      } else {
        applyReplacementDecorations(updated);
      }

      return updated;
    });
  }, [replacementDecorationIds, applyReplacementDecorations, pendingCorrection, removeCorrection]);

  const handleAcceptAllReplacements = useCallback(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    const model = editor.getModel();
    if (!model) return;

    let content = model.getValue();
    replacements.forEach(rep => {
      if (rep.status !== 'pending') return;
      if (rep.oldText && content.includes(rep.oldText)) {
        content = content.replace(rep.oldText, rep.newText);
      } else if (!rep.oldText) {
        content = rep.newText + '\n' + content;
      }
    });

    const fullRange = model.getFullModelRange();
    editor.executeEdits('zeus-rep-accept-all', [{ range: fullRange, text: content }]);

    editor.deltaDecorations(replacementDecorationIds, []);
    setReplacementDecorationIds([]);
    editor.changeViewZones((accessor: any) => {
      Object.values(viewZonesRef.current).forEach((id: any) => accessor.removeZone(id));
    });
    viewZonesRef.current = {};
    setReplacements([]);
    processedCorrectionRef.current = null;  // Limpiar corrección procesada

    // Guardar cambios en el archivo y sincronizar con openFiles
    if (path) {
      const lastSlashIndex = path.lastIndexOf('/');
      const fileName = lastSlashIndex >= 0 ? path.substring(lastSlashIndex + 1) : path;
      const folderPath = lastSlashIndex >= 0 ? path.substring(0, lastSlashIndex) : '';

      fetch('/api/ide-files', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', path: folderPath, name: fileName, content })
      }).then(() => {
        setOpenFiles(prev => prev.map(f =>
          f.path === path ? { ...f, content } : f
        ));
        toast({ title: 'Archivo guardado', description: `Cambios aplicados en ${fileName}` });
      }).catch(err => {
        console.error('Error guardando archivo:', err);
        toast({ title: 'Error al guardar', description: 'Los cambios se aplicaron pero no se pudieron guardar', variant: 'destructive' });
      });
    }

    if (pendingCorrection) {
      setTimeout(() => removeCorrection(pendingCorrection.id), 0);
    }
    toast({ title: 'Corrección completada', description: 'Todos los cambios han sido aplicados' });
  }, [replacements, replacementDecorationIds, pendingCorrection, removeCorrection, path, setOpenFiles]);

  const handleRejectAllReplacements = useCallback(() => {
    const editor = editorRef.current;
    if (editor) {
      editor.deltaDecorations(replacementDecorationIds, []);
      editor.changeViewZones((accessor: any) => {
        Object.values(viewZonesRef.current).forEach((id: any) => accessor.removeZone(id));
      });
      viewZonesRef.current = {};
    }
    setReplacementDecorationIds([]);
    setReplacements([]);
    processedCorrectionRef.current = null;  // Limpiar corrección procesada
    if (pendingCorrection) {
      setTimeout(() => removeCorrection(pendingCorrection.id), 0);
    }
    toast({ title: 'Corrección rechazada', description: 'Los cambios no se aplicaron' });
  }, [replacementDecorationIds, pendingCorrection, removeCorrection]);

  // Asignar handlers a refs para que los botones de las view zones puedan acceder
  useEffect(() => {
    handleAcceptReplacementRef.current = handleAcceptReplacement;
  }, [handleAcceptReplacement]);
  useEffect(() => {
    handleRejectReplacementRef.current = handleRejectReplacement;
  }, [handleRejectReplacement]);

  // Escuchar cambios de tema del ThemePicker. Aplica el tema sobre la
  // instancia de Monaco que está usando este editor. Si el editor aún
  // no está montado, el tema persistido se aplicará en el siguiente
  // onMount (getStoredTheme() lo lee de localStorage).
  // Escuchar cambios de tema (locales y remotos).
  useEffect(() => {
    // 1. Cambios locales vía CustomEvent (ThemePicker en la misma pestaña)
    const unsubLocal = onThemeChange((themeId) => {
      console.log('[CodeEditor] Cambio de tema local recibido:', themeId);
      setActiveTheme(themeId);
      if (monacoRef.current) monacoRef.current.editor.setTheme(themeId);
    });

    // 2. Cambios remotos vía PocketBase Realtime (otra pestaña o sesión)
    const unsubRemote = onMonacoThemeChange((themeId) => {
      console.log('[CodeEditor] Cambio de tema realtime recibido:', themeId);
      setActiveTheme(themeId);
      if (monacoRef.current) monacoRef.current.editor.setTheme(themeId);
      // Sincronizar localmente también por si acaso
      emitThemeChange(themeId);
    });

    return () => {
      unsubLocal();
      unsubRemote();
    };
  }, []);

  const goToReplacement = useCallback((index: number) => {
    const editor = editorRef.current;
    if (!editor) return;

    const clamped = Math.max(0, Math.min(index, replacements.length - 1));
    const rep = replacements[clamped];
    if (!rep) return;

    setActiveReplacementIndex(clamped);
    editor.revealLineInCenter(rep.startLine);
    editor.setPosition({ lineNumber: rep.startLine, column: rep.startCol });
  }, [replacements]);

  // Si hay pendingCorrection del contexto, convertirlo al nuevo sistema
  useEffect(() => {
    if (!pendingCorrection) {
      processedCorrectionRef.current = null;
      return;
    }

    // Evitar procesar la misma corrección múltiples veces
    if (processedCorrectionRef.current === pendingCorrection.id) {
      return;
    }

    const normalizedPath = normalizeCorrectionFolderPath(pendingCorrection.path, pendingCorrection.file);
    const fullPath = normalizedPath ? `${normalizedPath}/${pendingCorrection.file}` : pendingCorrection.file;

    // Si el archivo correcto no está activo, esperar (IDETab se encarga de abrirlo)
    if (activeFile !== fullPath) {
      console.log('[ZEUS QUEUE] Esperando archivo activo:', fullPath, '(activo:', activeFile, ')');
      return;
    }

    // Esperar a que el editor esté listo
    const editor = editorRef.current;
    if (!editor) {
      console.log('[ZEUS QUEUE] Editor no disponible, reintentando en 300ms...');
      const timer = setTimeout(() => setCorrectionRetry(r => r + 1), 300);
      return () => clearTimeout(timer);
    }

    const model = editor.getModel();
    if (!model) {
      console.warn('[ZEUS QUEUE] Modelo no disponible, reintentando en 300ms...');
      const timer = setTimeout(() => setCorrectionRetry(r => r + 1), 300);
      return () => clearTimeout(timer);
    }

    // Verificar que el contenido del editor coincide con lo esperado
    const editorContent = model.getValue();
    const expectedContent = openFiles.find(f => f.path === activeFile)?.content;
    if (expectedContent !== undefined && expectedContent.length > 0 && editorContent !== expectedContent) {
      console.log('[ZEUS QUEUE] Sincronizando contenido del editor...');
      editor.setValue(expectedContent);
    }

    // Marcar como procesada solo cuando realmente vamos a aplicarla
    processedCorrectionRef.current = pendingCorrection.id;

    console.log('[ZEUS QUEUE] Procesando corrección para:', fullPath, 'replacements:', !!pendingCorrection.replacements?.length);

    // Strategy: Try individual replacements first; if ALL fail, fall back to full-content diff
    if (pendingCorrection.replacements && pendingCorrection.replacements.length > 0) {
      const codeChange = {
        type: 'code_change',
        changes: [{
          file: pendingCorrection.file,
          replacements: pendingCorrection.replacements.map(r => ({ old: r.old, new: r.new }))
        }]
      };
      // Check if any replacement can match before processing
      const editorContent = model.getValue();
      let anyCanMatch = false;
      for (const rep of pendingCorrection.replacements) {
        const oldStr = (rep.old || '').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
        if (!oldStr || editorContent.includes(oldStr) || findOldStrOffset(editorContent, oldStr)) {
          anyCanMatch = true;
          break;
        }
      }

      if (anyCanMatch) {
        processCodeChange(codeChange);
        return;
      }

      // All individual replacements failed to match — fall back to newContent diff
      console.warn('[ZEUS QUEUE] Ningún replacement individual hizo match. Intentando fallback con newContent...');
    }

    // Fallback: use pre-computed newContent from FloatingChatButton's smartReplace
    if (pendingCorrection.newContent && pendingCorrection.originalContent &&
        pendingCorrection.newContent !== pendingCorrection.originalContent) {
      const codeChange = {
        type: 'code_change',
        changes: [{
          file: pendingCorrection.file,
          replacements: [{
            old: pendingCorrection.originalContent.replace(/\r\n/g, '\n'),
            new: pendingCorrection.newContent
          }]
        }]
      };
      processCodeChange(codeChange);
    } else if (pendingCorrection.newContent && pendingCorrection.originalContent) {
      // newContent === originalContent means smartReplace also failed entirely
      console.warn('[ZEUS QUEUE] newContent es idéntico a originalContent — no hay cambios que aplicar');
      if (pendingCorrection) {
        setTimeout(() => removeCorrection(pendingCorrection.id), 0);
      }
      toast({ title: 'Sin cambios', description: 'El texto a reemplazar no se encontró en el archivo.', variant: 'destructive' });
    }
  }, [pendingCorrection, activeFile, openFile, processCodeChange, isEditorReady, openFiles, correctionRetry]);


  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    setEditorRef(editor);
    monacoRef.current = monaco;

    // Aplicar el tema persistido. Priorizamos PocketBase, luego localStorage.
    const applyTheme = async () => {
      try {
        const pbTheme = await getActiveMonacoTheme();
        const stored = getStoredTheme();
        const themeToApply = pbTheme?.themeId || stored || 'zeus-dark';
        
        if (monacoRef.current) {
          monacoRef.current.editor.setTheme(themeToApply);
          setActiveTheme(themeToApply);
          console.log('[CodeEditor] onMount: tema aplicado:', themeToApply, pbTheme ? '(desde PB)' : '(desde localStorage)');
        }
      } catch (err) {
        console.warn('[CodeEditor] onMount: fallo al aplicar tema persistido, fallback zeus-dark', err);
        if (monacoRef.current) {
          monacoRef.current.editor.setTheme('zeus-dark');
          setActiveTheme('zeus-dark');
        }
      }
    };
    
    void applyTheme();

    console.log('[CodeEditor] Editor montado - language:', getLanguageFromPath(path), 'path:', path);
    console.log('[CodeEditor] Monaco instance:', !!monaco);
    console.log('[CodeEditor] TypeScript language service:', !!monaco?.languages?.typescript);

    // Escuchar eventos de validación
    monaco?.languages.typescript?.typescriptDefaults?.onDidChange?.(() => {
      console.log('[CodeEditor] TypeScript defaults cambiaron');
    });

    // Detectar cambios en el contenido
    editor.onDidChangeModelContent(() => {
      if (!isDirty) {
        setIsDirty(true);
      }
    });

    // Listener para clicks en marcadores de error
    editor.onMouseDown((e: any) => {
      if (!e.target || !e.target.position) return;

      const model = editor.getModel();
      if (!model) return;

      const markers = monaco.editor.getModelMarkers({ resource: model.uri });
      const clickedMarker = markers.find((m: any) => {
        return e.target.position.lineNumber >= m.startLineNumber &&
          e.target.position.lineNumber <= m.endLineNumber &&
          e.target.position.column >= m.startColumn &&
          e.target.position.column <= m.endColumn;
      });

      if (clickedMarker) {
        console.log('[CodeEditor] Click en error:', clickedMarker.message);
        handleErrorClick(clickedMarker, model, monaco);
      }
    });

    const model = editor.getModel();
    if (model && path) {
      const detectedLang = getLanguageFromPath(path);
      const currentLang = model.getLanguageId();
      console.log('[CodeEditor] Modelo obtenido:', {
        uri: model.uri.toString(),
        currentLang,
        detectedLang,
        path
      });

      if (currentLang !== detectedLang) {
        monaco.editor.setModelLanguage(model, detectedLang);
        console.log('[CodeEditor] Lenguaje cambiado de', currentLang, 'a', detectedLang);
      }
      setIsEditorReady(true);
    } else {
      console.log('[CodeEditor] No hay modelo o path:', { hasModel: !!model, path });
    }

    // Verificar marcadores periódicamente y forzar validación
    [1500, 3000, 5000].forEach(delay => {
      setTimeout(() => {
        const model = editor.getModel();
        if (!model) return;

        // Forzar validación disparando un cambio de contenido
        const tsServices = monaco.languages.typescript as any;
        if (tsServices?.typescriptDefaults) {
          // Re-aplicar configuración para forzar refresh (manteniendo códigos ignorados)
          tsServices.typescriptDefaults.setDiagnosticsOptions({
            noSemanticValidation: false,
            noSyntaxValidation: false,
            noSuggestionDiagnostics: false,
            diagnosticCodesToIgnore: [
              2792,  // Cannot find module (jsx-runtime)
              2307,  // Cannot find module (general)
              2304,  // Cannot find name
              2503,  // Cannot find namespace
              7005,  // Implicit 'any' type
              7006   // Implicit parameter 'any'
            ]
          });
        }

        const markers = monaco.editor.getModelMarkers({ resource: model.uri });
        console.log(`[CodeEditor] Marcadores a los ${delay}ms:`, markers.length, 'para', model.uri.toString());

        if (markers.length > 0) {
          markers.forEach((m: any, i: number) => {
            console.log(`[CodeEditor] Error ${i + 1}:`, {
              line: m.startLineNumber,
              message: m.message,
              severity: m.severity,
              owner: m.owner
            });
          });
        } else {
          console.log('[CodeEditor] NO HAY ERRORES - ¿El código es válido o hay un problema de configuración?');
          console.log('[CodeEditor] Contenido del archivo (primeras 200 chars):', editor.getValue().substring(0, 200));
        }
      }, delay);
    });

    // --- CONFIGURACIÓN DE ERRORES Y ZEUS ---

    // 2. Registrar comando para enviar a Zeus
    const askZeusAction = editor.addCommand(0, async (_ctx: any, errorData: any) => {
      const { message, code, file } = errorData;

      // Archivo actual completo
      const fullFileContent = editorRef.current?.getModel()?.getValue() || code;

      // Mensaje visible mínimo en el chat
      const visiblePrompt = `🔴 Error en ${file}: "${message}" — Enviado a Zeus para corrección.`;

      // Obtener estructura del proyecto en segundo plano
      let structureTree = '';
      try {
        const response = await fetch('/api/schema/simple');
        const result = await response.json();
        if (result.success && result.schema) {
          const formatSchema = (node: any, depth = 0): string => {
            if (!node) return '';
            const indent = '  '.repeat(depth);
            if (node.type === 'directory') {
              let out = `${indent}${node.name}/\n`;
              if (node.children) node.children.forEach((c: any) => { out += formatSchema(c, depth + 1); });
              return out;
            } else if (node.type === 'file') {
              return `${indent}${node.name}\n`;
            }
            return '';
          };
          structureTree = `\n\n🌳 ESTRUCTURA DEL PROYECTO:\n${formatSchema(result.schema)}`;
        }
      } catch (error) {
        console.warn('[CodeEditor] No se pudo obtener la estructura del proyecto:', error);
      }

      // No enviar contexto de otros archivos abiertos, solo el archivo con el error y la estructura
      const openFilesString = '';

      // Contexto oculto que se envía al modelo en segundo plano (no aparece en la burbuja)
      const hiddenPrompt = `CONTEXTO DE ERROR DEL EDITOR (enviado automáticamente):
Archivo: ${file}
Error: "${message}"

CÓDIGO AFECTADO:
\`\`\`
${code}
\`\`\`

ARCHIVO COMPLETO ACTUALIZADO:
\`\`\`
${fullFileContent}
\`\`\`${openFilesString}${structureTree}

INSTRUCCIONES ESTRICTAS:
1. ATENCIÓN: Este es el código ACTUALIZADO del archivo. IGNORA cualquier versión o corrección anterior que haya en el historial del chat.
2. Basa tus reemplazos ("old" y "new") ÚNICAMENTE en el código completo actualizado que aparece arriba.
3. El texto en "old" DEBE existir EXACTAMENTE IGUAL en el archivo actualizado.
4. Usa ÚNICAMENTE el formato code_change JSON para corregir el error.
5. NO expliques, NO leas archivos, simplemente emite el JSON code_change.`;

      console.log('Enviando a Zeus (visible):', visiblePrompt);
      askZeus(visiblePrompt, hiddenPrompt);
    });

    // 3. Proveedor de información al pasar el ratón (Hover)
    monaco.languages.registerHoverProvider('*', {
      provideHover: (model: { uri: any; getValueInRange: (arg0: any) => any; }, position: { lineNumber: number; column: number; }) => {
        const markers = monaco.editor.getModelMarkers({ resource: model.uri });
        const marker = markers.find((m: { startLineNumber: number; endLineNumber: number; startColumn: number; endColumn: number; }) => 
          position.lineNumber >= m.startLineNumber && 
          position.lineNumber <= m.endLineNumber &&
          position.column >= m.startColumn &&
          position.column <= m.endColumn
        );

        if (marker && askZeusAction) {
          const errorRange = new monaco.Range(
            marker.startLineNumber,
            marker.startColumn,
            marker.endLineNumber,
            marker.endColumn
          );
          const affectedCode = model.getValueInRange(errorRange);

          // Obtener la ruta real del archivo donde está el error desde el URI del modelo
          const errorUri = marker.resource || model.uri;
          const errorFilePath = monaco.Uri.parse(errorUri.toString()).path.replace(/^\//, '').replace(/\//g, '\\');

          console.log('[CodeEditor][Hover] Marker info:', {
            resource: marker.resource?.toString(),
            modelUri: model.uri.toString(),
            errorFilePath,
            path: path,
            activeFile: activeFile,
            message: marker.message
          });

          const errorData = {
            message: marker.message,
            code: affectedCode,
            file: errorFilePath  // Usar la ruta real del error desde marker.resource
          };

          return {
            range: errorRange,
            contents: [
              { value: `**🤖 Zeus Debugger**` },
              { value: `${marker.message}` },
              { 
                value: `[✨ Solucionar con Zeus](command:${askZeusAction}?${encodeURIComponent(JSON.stringify(errorData))})`,
                isTrusted: true,
                supportHtml: true
              }
            ]
          };
        }
        return null;
      }
    });
  };

  const handleBeforeMount: BeforeMount = (monaco) => {
    console.log('[CodeEditor] BeforeMount ejecutado');

    // Re-bindear el host de extensiones a ESTA instancia de Monaco. La razón
    // es que `@monaco-editor/react` usa `@monaco-editor/loader` que lazy-loads
    // su propia copia de Monaco (desde CDN por defecto), y esa instancia es
    // DIFERENTE del `monaco` que `lib/zeus-monaco/init.ts` importa vía webpack.
    // Si no re-bindeamos, los temas/grammars de extensiones instaladas
    // quedan registrados en una instancia que el editor nunca usa.
    // Import dinámico para no romper el SSR.
    import('@/lib/zeus-monaco/host').then(({ host }) => {
      try {
        host.bindMonaco(monaco);
        host.lockMonaco();
        console.log('[CodeEditor] host rebindeado y bloqueado a la instancia del editor');
      } catch (err) {
        console.warn('[CodeEditor] rebind del host falló:', err);
      }
    });

    // Registramos el tema oscuro de Zeus con el id 'zeus-dark' (el que usa
    // el ThemePicker) y, por compatibilidad con sesiones anteriores, también
    // como 'custom-dark'. Antes solo estaba 'custom-dark' y al introducir el
    // ThemePicker que persiste 'zeus-dark', Monaco no encontraba el id y
    // caía al default claro (fondo blanco).
    monaco.editor.defineTheme('zeus-dark', customTheme as any);
    monaco.editor.defineTheme('custom-dark', customTheme as any);

    // Configurar TypeScript ANTES de que el editor se monte
    const tsServices = monaco.languages.typescript as any;

    console.log('[CodeEditor] BeforeMount: tsServices disponible:', !!tsServices);
    console.log('[CodeEditor] BeforeMount: typescriptDefaults disponible:', !!tsServices?.typescriptDefaults);

    if (tsServices?.javascriptDefaults) {
      tsServices.javascriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: false,
        noSyntaxValidation: false,
        noSuggestionDiagnostics: false,
        diagnosticCodesToIgnore: [
          2792,  // Cannot find module (jsx-runtime)
          2307,  // Cannot find module (general)
          2304,  // Cannot find name
          2503,  // Cannot find namespace
          7005,  // Implicit 'any' type
          7006   // Implicit parameter 'any'
        ]
      });
      tsServices.javascriptDefaults.setCompilerOptions({
        noEmit: true,
        allowJs: true,
        isolatedModules: true,
        strict: false,
        skipLibCheck: true
      });
      console.log('[CodeEditor] JavaScript defaults configurados');
    }

    if (tsServices?.typescriptDefaults) {
      tsServices.typescriptDefaults.setCompilerOptions({
        noEmit: true,
        allowJs: true,
        isolatedModules: true,
        skipLibCheck: true,
        strict: false,
        noImplicitAny: false,
        target: monaco.languages.typescript.ScriptTarget.Latest,
        module: monaco.languages.typescript.ModuleKind.ESNext,
        moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
        jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        baseUrl: '.',
        paths: {
          '@/*': ['./*']
        }
      });
      // Ignorar errores de módulos de runtime de React (jsx-runtime) y tipos no encontrados
      tsServices.typescriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: false,
        noSyntaxValidation: false,
        noSuggestionDiagnostics: false,
        diagnosticCodesToIgnore: [
          2792,  // Cannot find module (jsx-runtime)
          2307,  // Cannot find module (general)
          2304,  // Cannot find name
          2503,  // Cannot find namespace
          7005,  // Implicit 'any' type
          7006   // Implicit parameter 'any'
        ]
      });
      console.log('[CodeEditor] TypeScript defaults configurados (config minimalista)');
    }

    // Forzar refresh de validación
    setTimeout(() => {
      console.log('[CodeEditor] Forzando refresh de validación después de 500ms');
    }, 500);
  };

  const projectType = useMemo(() => {
    if (!path) return 'unknown';
    const dbId = typeof window !== 'undefined' ? localStorage.getItem('databaseProjectId') : null;
    const ghInfo = typeof window !== 'undefined' ? localStorage.getItem('githubProjectInfo') : null;
    if (dbId) return 'database';
    if (ghInfo) return 'github';
    return 'local';
  }, [path]);

  const [isUndoing, setIsUndoing] = useState(false);

  const mediaPreviewUrl = useMemo(() => {
    if (!path) return '';

    const normalizedPath = path.replace(/\\/g, '/');
    const lastSlashIndex = normalizedPath.lastIndexOf('/');
    const fileName = lastSlashIndex >= 0 ? normalizedPath.substring(lastSlashIndex + 1) : normalizedPath;
    const folderPath = lastSlashIndex >= 0 ? normalizedPath.substring(0, lastSlashIndex) : '';

    if (!fileName) return '';

    return `/api/ide-files?name=${encodeURIComponent(fileName)}&path=${encodeURIComponent(folderPath)}&raw=1`;
  }, [path]);

  const handleUndo = async () => {
    if (!path) return;
    setIsUndoing(true);
    try {
      const fileName = path.split(/[\\/]/).pop() || '';
      const filePath = path.substring(0, Math.max(0, path.lastIndexOf('/') !== -1 ? path.lastIndexOf('/') : path.lastIndexOf('\\')));
      
      const response = await fetch('/api/ide-files/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, name: fileName })
      });

      const result = await response.json();
      if (result.success) {
        const restoredContent = result.content || '';
        toast({ title: 'Cambio revertido', description: 'Se ha restaurado la versión anterior del archivo' });
        
        // 1. Recargar el archivo en el editor de Monaco
        if (editorRef.current) {
          editorRef.current.setValue(restoredContent);
        }
        
        // 2. Actualizar estados locales
        setCode(restoredContent);
        setIsDirty(false);

        // 3. Sincronizar el estado global del IDE para que no se pierda al navegar o redimensionar
        setOpenFiles(prev => prev.map(f => f.path === path ? { ...f, content: restoredContent } : f));
        
      } else {
        throw new Error(result.error || 'No hay más cambios para deshacer');
      }
    } catch (error: any) {
      toast({ title: 'Error al deshacer', description: error.message, variant: 'destructive' });
    } finally {
      setIsUndoing(false);
    }
  };

  const handleSaveFile = async () => {
    if (!path || !editorRef.current) return;
    const currentContent = editorRef.current.getValue();
    try {
      await onSave(path, currentContent);
      setIsDirty(false);
      triggerSavedCheck();
      toast({ title: 'Guardado', description: 'Archivo guardado correctamente' });
    } catch (error: any) {
      toast({ title: 'Error al guardar', description: error.message, variant: 'destructive' });
    }
  };

  if (!isMounted) return <div className="flex items-center justify-center h-full bg-background"><div className="animate-pulse text-muted-foreground/80">Iniciando editor...</div></div>;

  return (
    <div className="h-full flex flex-col bg-[#050505] text-[#E2E8F0]">
      <div className="flex justify-between items-center px-4 py-2 border-b border-border/80 bg-[#060a14]">
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-primary/10 rounded-md"><FileIcon className="h-4 w-4 text-primary" /></div>
          <span className="text-xs font-semibold tracking-tight text-foreground/70">{path || 'Sin archivo'}</span>
          {isDirty && <div className="w-2 h-2 rounded-full bg-warning animate-pulse" title="Cambios sin guardar" />}
        </div>
        
        <div className="flex items-center gap-2">
          {!isImageFile(path || '') && !isAudioFile(path || '') && !isVideoFile(path || '') && (
            <>
              {readOnly && onCorrectFile ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onCorrectFile}
                  disabled={isCorrecting || !path}
                  className="h-8 gap-2 text-xs font-medium hover:bg-success/10 hover:text-success border border-transparent hover:border-emerald-500/20"
                >
                  <Sparkles className={`h-3.5 w-3.5 ${isCorrecting ? 'animate-spin' : ''}`} />
                  {isCorrecting ? 'Corrigiendo...' : 'Corregir'}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleUndo}
                  disabled={isUndoing || !path}
                  className="h-8 gap-2 text-xs font-medium hover:bg-destructive/10 hover:text-destructive border border-transparent hover:border-destructive/20"
                >
                  <RotateCcw className={`h-3.5 w-3.5 ${isUndoing ? 'animate-spin' : ''}`} />
                  {isUndoing ? 'Deshaciendo...' : 'Deshacer'}
                </Button>
              )}
              <div className="h-4 w-px bg-card mx-1" />
            </>
          )}

          {!isImageFile(path || '') && !isAudioFile(path || '') && !isVideoFile(path || '') && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={handleSaveFile}
              className={cn(
                "h-8 gap-2 text-xs font-medium transition-all",
                isDirty 
                  ? "bg-primary/10 text-primary hover:bg-primary/20 border border-blue-500/30" 
                  : "text-muted-foreground/80 hover:bg-card border border-transparent"
              )}
            >
              {showSavedCheck ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Save className="h-3.5 w-3.5" />}
              {isDirty ? 'Guardar' : 'Guardado'}
            </Button>
          )}
          
          <div className="h-4 w-px bg-card mx-1" />
          
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-background border border-border/80">
            <div className="text-[10px] font-bold text-muted-foreground/80 uppercase">{projectType}</div>
            <div className="w-1 h-1 rounded-full bg-muted" />
            <div className="text-[10px] font-bold text-primary uppercase">Next.js</div>
          </div>
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden min-h-[400px]">
        {isImageFile(path || '') ? (
          <div className="h-full flex items-center justify-center p-8 bg-background/50">
            <img src={mediaPreviewUrl} className="max-w-full max-h-full object-contain rounded shadow-2xl" alt="Preview" />
          </div>
        ) : isAudioFile(path || '') ? (
          <div className="h-full flex flex-col items-center justify-center p-8 bg-background/50 gap-6">
            <div className="p-4 rounded-xl bg-success/10 border border-emerald-500/20">
              <Music className="w-10 h-10 text-success" />
            </div>
            <audio controls className="w-full max-w-2xl" src={mediaPreviewUrl}>
              Tu navegador no soporta audio HTML5.
            </audio>
          </div>
        ) : isVideoFile(path || '') ? (
          <div className="h-full flex items-center justify-center p-6 bg-background/50">
            <video controls className="max-w-full max-h-full rounded-xl shadow-2xl border border-border/80" src={mediaPreviewUrl}>
              Tu navegador no soporta video HTML5.
            </video>
          </div>
        ) : (
          <Editor
            height="100%"
            path={path ? `file:///${path.replace(/\\/g, '/')}` : 'file:///inmemory/zeus/current.tsx'}
            language={getLanguageFromPath(path)}
            value={code}
            onMount={handleEditorDidMount}
            beforeMount={handleBeforeMount}
            theme={activeTheme}
            options={{
              automaticLayout: true,
              fontSize: 12,
              fontFamily: 'Fira Code, monospace',
              minimap: { enabled: true },
              scrollBeyondLastLine: false,
              renderLineHighlight: 'all',
              lineNumbers: 'on',
              padding: { top: 10, bottom: 40 },
              readOnly
            }}
          />
        )}

        {/* Overlay de correcciones inline (nuevo sistema) */}
        {replacements.length > 0 && (
          <>
            {/* Barra inferior de navegación global */}
            <div className="absolute bottom-0 left-0 right-0 z-[100] flex items-center justify-center gap-2 px-4 py-2 bg-background/90 backdrop-blur border-t border-border/80">
              <div className="flex items-center gap-1 px-2 py-1 bg-background/80 border border-border/50 rounded-md">
                <Sparkles className="w-3 h-3 text-warning" />
                <span className="text-[9px] font-bold text-foreground uppercase">Zeus</span>
                <span className="text-[9px] font-bold text-primary-foreground">
                  {activeReplacementIndex + 1}/{replacements.length}
                </span>
              </div>

              <button
                onClick={() => goToReplacement(Math.max(0, activeReplacementIndex - 1))}
                disabled={activeReplacementIndex <= 0}
                className="h-6 px-2 inline-flex items-center gap-1 text-[9px] font-bold rounded-md bg-card/90 hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed border border-border/50"
                title="Corrección anterior"
              >
                <ChevronUp className="w-3 h-3" />
              </button>
              <button
                onClick={() => goToReplacement(Math.min(replacements.length - 1, activeReplacementIndex + 1))}
                disabled={activeReplacementIndex >= replacements.length - 1}
                className="h-6 px-2 inline-flex items-center gap-1 text-[9px] font-bold rounded-md bg-card/90 hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed border border-border/50"
                title="Corrección siguiente"
              >
                <ChevronDown className="w-3 h-3" />
              </button>

              <div className="w-px h-4 bg-muted" />

              <button
                onClick={handleAcceptAllReplacements}
                className="h-6 px-3 inline-flex items-center gap-1 text-[9px] font-black rounded-md bg-success/85 hover:bg-success text-foreground border border-emerald-400/20"
                title="Aceptar todos los cambios"
              >
                <Check className="w-3 h-3" /> ACEPTAR TODO
              </button>
              <button
                onClick={handleRejectAllReplacements}
                className="h-6 px-3 inline-flex items-center gap-1 text-[9px] font-black rounded-md bg-rose-600/85 hover:bg-rose-500 text-foreground border border-rose-400/20"
                title="Cancelar todos los cambios"
              >
                <X className="w-3 h-3" /> CANCELAR TODO
              </button>
            </div>
          </>
        )}

        {/* Loading de análisis de error */}
        {isAnalyzingError && (
          <div className="absolute top-4 right-4 z-[100] px-4 py-3 bg-background/95 backdrop-blur border border-border/50 rounded-lg shadow-2xl flex items-center gap-3">
            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-primary font-medium">Analizando con IA...</span>
          </div>
        )}
      </div>

      <style jsx global>{`
        .monaco-diff-editor .line-insert,
        .monaco-diff-editor .line-delete,
        .monaco-diff-editor .char-insert,
        .monaco-diff-editor .char-delete,
        .monaco-diff-editor .char-insert + span,
        .monaco-diff-editor .char-delete + span,
        .monaco-editor .line-insert,
        .monaco-editor .line-delete,
        .monaco-editor .char-insert,
        .monaco-editor .char-delete {
          background: transparent !important;
          border: none !important;
          outline: none !important;
          box-shadow: none !important;
        }

        .monaco-diff-editor .margin-view-overlays .line-insert,
        .monaco-diff-editor .margin-view-overlays .line-delete,
        .monaco-diff-editor .overviewRuler,
        .monaco-diff-editor .diffOverview {
          background: transparent !important;
        }

        /* Resaltar código con error (fondo rojo) */
        .zeus-error-highlight {
          background-color: rgba(239, 68, 68, 0.2) !important;
          border-bottom: 2px solid rgba(239, 68, 68, 0.5) !important;
        }

        /* NUEVO SISTEMA: Replacement old (rojo semitransparente) */
        .zeus-replacement-old {
          background-color: rgba(239, 68, 68, 0.35) !important;
          border-radius: 2px;
        }
        .zeus-replacement-old-inline {
          background-color: rgba(239, 68, 68, 0.35) !important;
        }

        /* NUEVO SISTEMA: Línea de inserción (verde) */
        .zeus-replacement-insert-line {
          background-color: rgba(34, 197, 94, 0.28) !important;
          border-left: 3px solid rgba(34, 197, 94, 0.85) !important;
        }
        .zeus-replacement-insert-glyph {
          background-color: rgba(34, 197, 94, 0.85) !important;
          width: 6px !important;
          border-radius: 3px;
        }
      `}</style>
    </div>
  );
}
