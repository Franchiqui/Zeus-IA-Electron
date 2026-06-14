'use client';

import { useEffect, useRef, forwardRef } from 'react';
import { DiffLine } from '@/lib/diff-utils';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, Decoration, DecorationSet, WidgetType } from '@codemirror/view';
import { StateField, StateEffect } from '@codemirror/state';

interface CodeEditorCMProps {
  content: string;
  onChange: (value: string) => void;
  language: string;
  diff: DiffLine[];
  searchTerm?: string;
  currentMatchIndex?: number;
  matches?: number[];
}

const CodeEditorCM = forwardRef<any, CodeEditorCMProps>(({
  content,
  onChange,
  language,
  diff,
  searchTerm,
  currentMatchIndex,
  matches,
}, ref) => {
  const internalEditorRef = useRef<any>(null);

  // Widget para botón de copiar por bloque
  class CopyBlockWidget extends WidgetType {
    constructor(private startLine: number, private endLine: number, private content: string, private type: string) {
      super();
    }

    eq(other: CopyBlockWidget) {
      return other.startLine === this.startLine && other.endLine === this.endLine;
    }

    toDOM() {
      const button = document.createElement('button');
      button.className = 'copy-block-button';
      button.type = 'button';
      button.setAttribute('data-block', `${this.startLine}-${this.endLine}`);
      
      // Determinar el color según el tipo de bloque
      let bgColor = 'bg-muted/80';
      let icon = '📋';
      if (this.type === 'added') {
        bgColor = 'bg-green-600';
        icon = '➕';
      } else if (this.type === 'removed') {
        bgColor = 'bg-destructive';
        icon = '➖';
      } else if (this.type === 'modified') {
        bgColor = 'bg-primary';
        icon = '✏️';
      }
      
      button.className = `copy-block-button ${bgColor} text-foreground px-2 py-1 rounded text-xs hover:opacity-80 transition-opacity ml-2 flex items-center gap-1`;
      button.title = `Copiar bloque líneas ${this.startLine}-${this.endLine}`;
      
      // Texto del botón
      const span = document.createElement('span');
      span.textContent = `${icon} Copiar (${this.endLine - this.startLine + 1})`;
      button.appendChild(span);
      
      // Manejador de eventos
      const handleCopy = async (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        
        try {
          // Usar el API moderno de clipboard
          if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(this.content);
          } else {
            // Fallback para navegadores antiguos
            const textArea = document.createElement('textarea');
            textArea.value = this.content;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            
            try {
              document.execCommand('copy');
            } catch (err) {
              console.error('Error al copiar con execCommand:', err);
              throw err;
            } finally {
              document.body.removeChild(textArea);
            }
          }
          
          // Feedback visual
          button.style.backgroundColor = '#10b981';
          span.textContent = '✅ ¡Copiado!';
          
          setTimeout(() => {
            try {
              // Restaurar el texto original
              span.textContent = `${icon} Copiar (${this.endLine - this.startLine + 1})`;
              button.style.backgroundColor = '';
            } catch (err) {
              console.log('Widget ya no existe, ignorando restauración');
            }
          }, 1500);
          
        } catch (err) {
          console.error('Error al copiar bloque:', err);
          span.textContent = '❌ Error';
          button.style.backgroundColor = '#ef4444';
          
          setTimeout(() => {
            try {
              span.textContent = `${icon} Copiar (${this.endLine - this.startLine + 1})`;
              button.style.backgroundColor = '';
            } catch (e) {
              // Ignorar si el widget ya no existe
            }
          }, 1500);
        }
      };
      
      button.addEventListener('click', handleCopy);
      button.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      
      return button;
    }

    ignoreEvent() {
      return false;
    }

    destroy() {
      // Limpieza si es necesario
    }
  }

  // Crear efecto para actualizar decoraciones
  const updateDiffEffect = StateEffect.define<DiffLine[]>({
    map: (diff, change) => diff
  });

  // Crear efecto para actualizar búsquedas
  const updateSearchEffect = StateEffect.define<{
    searchTerm: string;
    currentMatchIndex: number;
    matches: number[];
  }>({
    map: (searchData, change) => searchData
  });

  // Crear campo de estado para las decoraciones
  const highlightField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update: (decorations, tr) => {
      let newDecorations: any[] = [];
      
      // Procesar efectos de diferencias
      for (let effect of tr.effects) {
        if (effect.is(updateDiffEffect)) {
          console.log('=== CODEMIRROR DECORACIONES ===');
          console.log('Total líneas a procesar:', effect.value.length);
          
          // Agrupar líneas en bloques por tipo
          const blocks: { startLine: number, endLine: number, lines: string[], type: string }[] = [];
          
          effect.value.forEach((diffLine) => {
            let className = '';
            if (diffLine.type === 'added') {
              className = 'diff-line-added';
            } else if (diffLine.type === 'removed') {
              className = 'diff-line-removed';
            } else if (diffLine.type === 'modified') {
              className = 'diff-line-modified';
            } else if (diffLine.type === 'unchanged') {
              className = 'diff-line-unchanged';
            }
            
            try {
              // Verificar que el número de línea sea válido
              if (diffLine.lineNumber <= 0 || diffLine.lineNumber > tr.state.doc.lines) {
                console.warn(`Línea inválida ${diffLine.lineNumber}, documento tiene ${tr.state.doc.lines} líneas`);
              } else {
                // Obtener el contenido de la línea
                const line = tr.state.doc.line(diffLine.lineNumber);
                const lineContent = line.text;
                
                // Decorar la línea completa
                const decoration = Decoration.line({
                  class: className
                });
                newDecorations.push(decoration.range(line.from));
                
                // Agrupar en bloques (solo para líneas con diferencias)
                if (diffLine.type === 'added' || diffLine.type === 'removed' || diffLine.type === 'modified') {
                  // Buscar si hay un bloque existente que sea consecutivo
                  let blockFound = false;
                  
                  for (const block of blocks) {
                    if (block.type === diffLine.type && diffLine.lineNumber === block.endLine + 1) {
                      // Es consecutivo, agregar al bloque existente
                      block.endLine = diffLine.lineNumber;
                      block.lines.push(lineContent);
                      blockFound = true;
                      console.log(`Agregando línea ${diffLine.lineNumber} al bloque existente ${block.type}: ${block.startLine}-${block.endLine}`);
                      break;
                    }
                  }
                  
                  if (!blockFound) {
                    // No hay bloque consecutivo, crear nuevo bloque
                    const newBlock = {
                      startLine: diffLine.lineNumber,
                      endLine: diffLine.lineNumber,
                      lines: [lineContent],
                      type: diffLine.type
                    };
                    blocks.push(newBlock);
                    console.log(`Creando nuevo bloque ${diffLine.type}: ${newBlock.startLine}-${newBlock.endLine}`);
                  }
                }
                
                console.log(`Decorando línea ${diffLine.lineNumber}: ${diffLine.type} -> ${className}`);
              }
            } catch (error) {
              console.error(`Error al decorar línea ${diffLine.lineNumber}:`, error);
            }
          });
          
          // Agregar botones de copiar para cada bloque
          blocks.forEach((block, index) => {
            const blockContent = block.lines.join('\n');
            const copyWidget = new CopyBlockWidget(block.startLine, block.endLine, blockContent, block.type);
            
            // Agregar el widget al final de la última línea del bloque
            const lastLine = tr.state.doc.line(block.endLine);
            const widgetDecoration = Decoration.widget({
              widget: copyWidget,
              side: 1
            });
            newDecorations.push(widgetDecoration.range(lastLine.to));
            
            console.log(`Botón ${index + 1}/${blocks.length} para bloque ${block.type}: líneas ${block.startLine}-${block.endLine} (${block.lines.length} líneas)`);
          });
          
          console.log(`Total bloques encontrados: ${blocks.length}`);
          console.log('Total decoraciones de diff aplicadas:', newDecorations.length);
        }
        
        // Procesar efectos de búsqueda
        if (effect.is(updateSearchEffect)) {
          const { searchTerm, currentMatchIndex, matches } = effect.value;
          
          if (searchTerm.trim() && matches.length > 0) {
            console.log('=== BUSCANDO TEXTO ===');
            console.log('Término de búsqueda:', searchTerm);
            console.log('Match actual:', currentMatchIndex);
            console.log('Total matches (líneas):', matches.length);
            
            // Buscar en las líneas específicas donde hay coincidencias
            const doc = tr.state.doc;
            
            matches.forEach((lineNumber, matchIndex) => {
              try {
                const line = doc.line(lineNumber);
                const lineText = line.text;
                
                // Buscar todas las ocurrencias en esta línea
                let searchIndex = 0;
                let lineMatchCount = 0;
                
                while (true) {
                  const matchPos = lineText.indexOf(searchTerm, searchIndex);
                  if (matchPos === -1) break;
                  
                  // Determinar si es el match actual
                  const isCurrentMatch = matchIndex === currentMatchIndex;
                  const matchClass = isCurrentMatch ? 'search-highlight-current' : 'search-highlight';
                  
                  // Calcular posición absoluta en el documento
                  const absolutePos = line.from + matchPos;
                  
                  // Crear decoración para la coincidencia
                  const decoration = Decoration.mark({
                    class: matchClass
                  });
                  newDecorations.push(decoration.range(absolutePos, absolutePos + searchTerm.length));
                  
                  console.log(`Coincidencia línea ${lineNumber}, pos ${matchPos} -> abs ${absolutePos} ${isCurrentMatch ? '(ACTUAL)' : ''}`);
                  
                  lineMatchCount++;
                  searchIndex = matchPos + 1;
                }
              } catch (error) {
                console.error(`Error procesando línea ${lineNumber}:`, error);
              }
            });
            
            console.log('Total decoraciones de búsqueda aplicadas:', newDecorations.filter(d => d.spec && d.spec.class && d.spec.class.includes('search-highlight')).length);
          }
        }
      }
      
      // Ordenar decoraciones por posición (requerido por CodeMirror)
      newDecorations.sort((a, b) => {
        const fromA = a.from || (a.spec && a.spec.from ? a.spec.from : 0);
        const fromB = b.from || (b.spec && b.spec.from ? b.spec.from : 0);
        return fromA - fromB;
      });
      
      return Decoration.set(newDecorations);
    },
    provide: f => EditorView.decorations.from(f)
  });

  const extensions = [
    javascript({ jsx: true }),
    oneDark,
    highlightField,
    EditorView.lineWrapping,
    EditorView.theme({
      '.cm-scroller': {
        overflow: 'auto !important',
        height: '100% !important',
        maxHeight: '100% !important',
        scrollbarWidth: 'thin',
        backgroundColor: 'rgba(0, 0, 0, 0.8) !important', // Fondo negro puro
      },
      '.cm-scroller::-webkit-scrollbar': {
        width: '8px',
        height: '8px',
      },
      '.cm-scroller::-webkit-scrollbar-track': {
        background: 'transparent !important',
      },
      '.cm-content': {
        padding: '16px !important',
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace !important',
        fontSize: '14px !important',
        lineHeight: '1.5 !important',
        backgroundColor: 'rgba(0, 0, 0, 0.8) !important', // Fondo negro puro
      },
      '.cm-editor': {
        backgroundColor: 'rgba(0, 0, 0, 0.8) !important', // Fondo negro puro
      },
      '.cm-focused': {
        outline: 'none !important',
        backgroundColor: 'rgba(0, 0, 0, 0.8) !important', // Fondo negro puro
      },
      '.cm-lineNumbers .cm-gutterElement': {
        padding: '0 8px 0 16px !important',
        minWidth: '40px !important',
        fontSize: '12px !important',
        color: '#6b7280 !important',
        backgroundColor: 'rgba(0, 0, 0, 0.8) !important', // Fondo negro puro
      },
      '.cm-gutter': {
        backgroundColor: 'rgba(0, 0, 0, 0.8) !important', // Fondo negro puro
        borderRight: '1px solid #334155 !important',
      },
      '.diff-line-added': {
        backgroundColor: 'rgba(34, 197, 94, 0.2) !important',
        borderLeft: '4px solid rgba(34, 197, 94, 0.8) !important',
        paddingLeft: '8px !important',
      },
      '.diff-line-removed': {
        backgroundColor: 'rgba(239, 68, 68, 0.2) !important',
        borderLeft: '4px solid rgba(239, 68, 68, 0.8) !important',
        paddingLeft: '8px !important',
      },
      '.diff-line-unchanged': {
        backgroundColor: 'rgba(59, 130, 246, 0.1) !important',
        borderLeft: '4px solid rgba(59, 130, 246, 0.5) !important',
        paddingLeft: '8px !important',
      },
      '.diff-line-modified': {
        backgroundColor: 'rgba(251, 191, 36, 0.2) !important',
        borderLeft: '4px solid rgba(251, 191, 36, 0.8) !important',
        paddingLeft: '8px !important',
      },
      '.search-highlight': {
        backgroundColor: 'rgba(255, 255, 0, 0.3) !important',
        borderRadius: '2px !important',
        padding: '0 2px !important',
        border: '1px dashed rgba(255, 255, 0, 0.6) !important',
      },
      '.search-highlight-current': {
        backgroundColor: 'rgba(255, 165, 0, 0.5) !important',
        borderRadius: '3px !important',
        padding: '0 3px !important',
        border: '2px solid rgba(255, 165, 0, 0.8) !important',
        boxShadow: '0 0 8px rgba(255, 165, 0, 0.4) !important',
        animation: 'pulse 1.5s infinite !important',
      },
      '.copy-block-button': {
        display: 'inline-flex !important',
        alignItems: 'center !important',
        justifyContent: 'center !important',
        padding: '4px 8px !important',
        border: 'none !important',
        borderRadius: '4px !important',
        cursor: 'pointer !important',
        transition: 'all 0.2s ease !important',
        marginLeft: '8px !important',
        opacity: '0.8 !important',
        fontSize: '11px !important',
        fontWeight: '500 !important',
        gap: '4px !important',
      },
      '.copy-block-button:hover': {
        opacity: '1 !important',
        transform: 'scale(1.05) !important',
      },
      '.copy-block-button:active': {
        transform: 'scale(0.95) !important',
      },
      '@keyframes pulse': {
        '0%': {
          boxShadow: '0 0 8px rgba(255, 165, 0, 0.4) !important',
        },
        '50%': {
          boxShadow: '0 0 16px rgba(255, 165, 0, 0.8) !important',
        },
        '100%': {
          boxShadow: '0 0 8px rgba(255, 165, 0, 0.4) !important',
        },
      },
    }),
  ];

  // Actualizar decoraciones cuando cambian las diferencias
  useEffect(() => {
    if (internalEditorRef.current) {
      const view = internalEditorRef.current.view;
      if (view) {
        view.dispatch({
          effects: [updateDiffEffect.of(diff)]
        });
      }
    }
  }, [diff]);

  // Actualizar decoraciones cuando cambia la búsqueda
  useEffect(() => {
    if (internalEditorRef.current) {
      const view = internalEditorRef.current.view;
      if (view) {
        view.dispatch({
          effects: [updateSearchEffect.of({
            searchTerm: searchTerm || '',
            currentMatchIndex: currentMatchIndex || -1,
            matches: matches || []
          })]
        });
      }
    }
  }, [searchTerm, currentMatchIndex, matches]);

  // Exponer la referencia al componente padre
  useEffect(() => {
    if (ref) {
      (ref as any).current = internalEditorRef.current;
    }
  }, [ref]);

  return (
    <div className="w-full h-full rounded-lg border-2 border-black dark:border-white overflow-hidden bg-background/80">
      <CodeMirror
        value={content}
        height="100%"
        extensions={extensions}
        onChange={(value) => onChange(value)}
        theme={oneDark}
        editable={true}
        basicSetup={{
          lineNumbers: true,
        }}
        style={{
          height: '100%',
          overflow: 'auto',
        }}
        onCreateEditor={(view, state) => {
          internalEditorRef.current = { view, state };
          if (ref) {
            (ref as any).current = { view, state };
          }
        }}
      />
    </div>
  );
});

CodeEditorCM.displayName = 'CodeEditorCM';

export default CodeEditorCM;
