'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Code2, Copy, Check, Trash2, ExternalLink, Play, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import Editor from '@monaco-editor/react';
import { useEditor } from '@/context/editor-context';
import { smartReplace } from '@/lib/smartReplace';
import { useChatMonacoTheme, ensureReactMonacoLoader } from '@/lib/zeus-monaco/react-loader';

interface ChatCodeBubbleProps {
  code: string;
  language?: string;
  fileName?: string;
  isVisible: boolean;
  isMaximized?: boolean;
  onApplyCodeChange?: (json: string) => void;
  codeChangeApplied?: boolean;
}

const ChatCodeBubble = ({ code, language = 'typescript', fileName, isVisible, isMaximized = false, onApplyCodeChange, codeChangeApplied }: ChatCodeBubbleProps) => {
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);
  const editorRef = useRef<any>(null);
  // Tema activo del selector de arriba (ThemePicker), misma fuente que el
  // editor principal (colección monaco_themes de PocketBase local). Antes
  // forzaba 'zeus-black' fijo con setTheme GLOBAL, lo que pisaba el tema del
  // editor principal cada vez que el modelo escribía una burbuja de código.
  const theme = useChatMonacoTheme();

  // Asegurar que @monaco-editor/react use la instancia LOCAL de Monaco
  // (donde están definidos zeus-dark y los temas de extensiones). Sin esto,
  // el chat carga su propia instancia CDN y los temas de Zeus no existen →
  // fondo blanco por defecto. Se llama en el cuerpo (no solo en useEffect)
  // porque el <Editor> puede montarse en el primer render (burbujas
  // code_change abren por defecto) y el import debe estar lanzado ya.
  ensureReactMonacoLoader();

  // code_change bubbles auto-expand; regular code bubbles start collapsed
  const isCodeChange = (() => {
    try {
      const parsed = JSON.parse(code);
      return parsed?.type === 'code_change' && Array.isArray(parsed.changes);
    } catch { return false; }
  })();
  const [expanded, setExpanded] = useState(isCodeChange);

  // Sincronizar expanded con isCodeChange (importante para streaming)
  useEffect(() => {
    if (isCodeChange) {
      setExpanded(true);
    }
  }, [isCodeChange]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Efecto para auto-scroll cuando el código cambia
  useEffect(() => {
    if (editorRef.current && code) {
      const model = editorRef.current.getModel();
      if (model) {
        const lineCount = model.getLineCount();
        editorRef.current.revealLine(lineCount);
      }
    }
  }, [code]);

  const handleEditorDidMount = (editor: any, monaco: any) => {
    editorRef.current = editor;
    // NO llamar a monaco.editor.setTheme() aquí: es GLOBAL y pisaría el tema
    // elegido por el usuario en el ThemePicker (editor principal incluido).
    // El tema se controla vía la prop `theme` del <Editor>, sincronizada con
    // el selector de arriba ('zeus.monaco.theme' + evento de cambio).
  };

  const handleCopy = async () => {
    try {
      const electronAPI = (typeof window !== 'undefined' && (window as any).electronAPI) ? (window as any).electronAPI : null;
      if (electronAPI?.clipboard?.writeText) {
        await electronAPI.clipboard.writeText(code);
      } else if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = code;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const maybeParsed = isCodeChange ? (() => {
    try {
      const parsed = JSON.parse(code);
      return parsed?.type === 'code_change' && Array.isArray(parsed.changes) ? parsed : null;
    } catch {
      return null;
    }
  })() : null;

  const { addCorrection } = useEditor();

  const handleApplyCodeChange = async () => {
    if (!maybeParsed) return;
    try {
      for (const change of maybeParsed.changes) {
        const rawFileField = change.file || 'archivo.ts';
        const lastSlashIdx = rawFileField.replace(/\\/g, '/').lastIndexOf('/');
        const changeFileName = lastSlashIdx >= 0 ? rawFileField.slice(lastSlashIdx + 1) : rawFileField;
        const changePath = lastSlashIdx >= 0 ? rawFileField.slice(0, lastSlashIdx) : '';

        // Buscar el archivo en varias rutas candidatas
        const candidates = [changePath, ''];
        let resolvedFilePath = '';
        let originalContent = '';
        let found = false;

        for (const candidatePath of candidates) {
          try {
            const getRes = await fetch(`/api/ide-files?name=${encodeURIComponent(changeFileName)}&path=${encodeURIComponent(candidatePath)}`);
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
          alert(`❌ ${changeFileName}: no se encontró el archivo`);
          continue;
        }

        // Construir newContent aplicando replacements con smartReplace (fuzzy matching)
        let newContent = originalContent.replace(/\r\n/g, '\n');
        const normalizedReplacements: { old: string; new: string }[] = [];
        const failedReplacements: string[] = [];
        for (const rep of (change.replacements || [])) {
          const oldStr = (rep.old || '').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\r\n/g, '\n');
          const newStr = (rep.new || '').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\r\n/g, '\n');
          normalizedReplacements.push({ old: oldStr, new: newStr });
          if (oldStr === '') {
            newContent = newStr + newContent;
          } else {
            // Use smartReplace for fuzzy matching (same as FloatingChatButton handler)
            const sr = smartReplace(newContent, oldStr, newStr);
            if (sr.applied) {
              newContent = sr.result;
            } else {
              failedReplacements.push(oldStr.substring(0, 60));
            }
          }
        }

        if (failedReplacements.length > 0 && failedReplacements.length === normalizedReplacements.length) {
          // ALL replacements failed — can't apply anything
          alert(`❌ ${changeFileName}: ningún texto coincidió con el archivo`);
          continue;
        }

        // Encolar corrección para que el editor abra el archivo y muestre diff rojo/verde con botones aceptar/cancelar
        addCorrection({
          file: changeFileName,
          path: resolvedFilePath,
          originalContent,
          newContent,
          changes: [],
          type: 'file',
          replacements: normalizedReplacements
        });
      }
    } catch (e: any) {
      alert(`Error aplicando code_change: ${e.message}`);
    }
  };

  if (!mounted) return null;

  // Count lines for preview hint
  const lineCount = code.split('\n').length;

  return (
    <div className={cn(
      "chat-code-bubble",
      "w-full max-w-[610px] flex flex-col overflow-hidden rounded-xl border-2 transition-all duration-500 shadow-[0_0_20px_rgba(0,0,0,0.5)] relative",
      isVisible 
        ? (isCodeChange 
            ? (isMaximized ? "opacity-100 h-[326px] max-h-[48vh] my-4 border-blue-500/30" : "opacity-100 h-[270px] max-h-[40vh] my-4 border-blue-500/30")
            : (expanded 
                ? (isMaximized ? "opacity-100 h-[326px] max-h-[48vh] my-4 border-border/80" : "opacity-100 h-[270px] max-h-[40vh] my-4 border-border/80")
                : "opacity-100 my-1 border-border/80/40"))
        : "opacity-0 h-0 overflow-hidden border-transparent pointer-events-none"
    )} style={{ backgroundColor: 'hsl(var(--card))' }}>
      
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 shrink-0 border-b border-white/10 bg-background">
        <div 
          className="flex items-center gap-3 cursor-pointer select-none flex-1 min-w-0"
          onClick={() => !isCodeChange && setExpanded(e => !e)}
        >
          {!isCodeChange && (
            expanded 
              ? <ChevronUp className="w-3 h-3 text-muted-foreground/80 shrink-0" />
              : <ChevronDown className="w-3 h-3 text-muted-foreground/80 shrink-0" />
          )}
          <Code2 className={cn("w-4 h-4 shrink-0", isCodeChange ? "text-primary" : "text-muted-foreground/80")} />
          <span className={cn("text-[10px] font-black uppercase tracking-widest truncate", isCodeChange ? "text-primary" : "text-muted-foreground")}>
            {fileName || 'Zeus Code Editor'}
          </span>
          <span className={cn(
            "flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[8px] font-bold border shrink-0",
            isCodeChange 
              ? "bg-primary/10 text-primary border-blue-500/20" 
              : "bg-muted/60/10 text-muted-foreground/80 border-border/30/20"
          )}>
            {language.toUpperCase()}
          </span>
          {!expanded && !isCodeChange && lineCount > 0 && (
            <span className="text-[8px] text-muted-foreground/60 shrink-0">{lineCount} líneas</span>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          {maybeParsed && (
            codeChangeApplied ? (
              <span className="flex items-center gap-1 text-[10px] font-bold text-success px-1.5 py-0.5 rounded bg-success/10 border border-emerald-500/20">
                <Check className="w-3 h-3" />
                Aplicado
              </span>
            ) : (
              <button
                onClick={() => {
                  if (onApplyCodeChange) {
                    onApplyCodeChange(code);
                  } else {
                    handleApplyCodeChange();
                  }
                }}
                className="p-1 hover:bg-white/10 rounded text-primary transition-colors flex items-center gap-1 text-[10px] font-bold"
                title="Aplicar cambios"
              >
                <Play className="w-3 h-3" />
                Aplicar
              </button>
            )
          )}
          <button
            onClick={handleCopy}
            className="p-1 hover:bg-white/10 rounded text-muted-foreground/80 transition-colors"
            title="Copiar código"
          >
            {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {/* Editor Canvas — only rendered when expanded */}
      {expanded && (
        <div className="flex-1 bg-background relative">
          <style jsx global>{`
            .chat-code-bubble .monaco-editor .scroll-decoration { box-shadow: none !important; }
            .chat-code-bubble .monaco-scrollable-element::-webkit-scrollbar { width: 3px !important; height: 3px !important; }
            .chat-code-bubble .monaco-scrollable-element::-webkit-scrollbar-track { background: transparent !important; }
            .chat-code-bubble .monaco-scrollable-element::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15) !important; border-radius: 2px !important; }
            .chat-code-bubble .monaco-scrollable-element::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.25) !important; }
          `}</style>
          <Editor
            height="100%"
            language={language.toLowerCase()}
            onMount={handleEditorDidMount}
            value={code}
            theme={theme}
            options={{
              readOnly: true,
              fontSize: 11,
              fontFamily: 'JetBrains Mono, Consolas, monospace',
              minimap: { enabled: false },
              scrollbar: {
                vertical: 'auto',
                horizontal: 'auto',
                useShadows: false,
                verticalScrollbarSize: 3,
                horizontalScrollbarSize: 3
              },
              lineNumbers: 'on',
              renderLineHighlight: 'all',
              padding: { top: 10, bottom: 10 },
              folding: true,
              glyphMargin: false,
              lineDecorationsWidth: 10,
              lineNumbersMinChars: 3,
              automaticLayout: true,
            }}
          />
        </div>
      )}
    </div>
  );
};

export default ChatCodeBubble;
