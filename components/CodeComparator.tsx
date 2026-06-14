'use client';

import { useState, useRef, useEffect } from 'react';
import { Upload, FileCode2, Download, Copy, RotateCcw, Search, ChevronUp, ChevronDown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import CodeEditorCM from '@/components/CodeEditorCM';
import { computeDiff, DiffLine } from '@/lib/diff-utils';
import { formatCode } from '@/lib/format-utils';
import { EditorView } from '@codemirror/view';

export default function CodeComparator({ onClose }: { onClose?: () => void }) {
  const [leftContent, setLeftContent] = useState('');
  const [rightContent, setRightContent] = useState('');
  const [leftSearchTerm, setLeftSearchTerm] = useState('');
  const [rightSearchTerm, setRightSearchTerm] = useState('');
  const [leftSearchIndex, setLeftSearchIndex] = useState(-1);
  const [rightSearchIndex, setRightSearchIndex] = useState(-1);
  const [leftSearchMatches, setLeftSearchMatches] = useState<number[]>([]);
  const [rightSearchMatches, setRightSearchMatches] = useState<number[]>([]);
  const leftEditorRef = useRef<any>(null);
  const rightEditorRef = useRef<any>(null);
  const leftFileInputRef = useRef<HTMLInputElement>(null);
  const rightFileInputRef = useRef<HTMLInputElement>(null);
  const [leftLanguage, setLeftLanguage] = useState('javascript');
  const [rightLanguage, setRightLanguage] = useState('javascript');
  const [leftFileName, setLeftFileName] = useState('');
  const [rightFileName, setRightFileName] = useState('');
  const [leftDiff, setLeftDiff] = useState<DiffLine[]>([]);
  const [rightDiff, setRightDiff] = useState<DiffLine[]>([]);

  // Funciones de búsqueda - Versión simple y directa
  const findSearchMatches = (content: string, searchTerm: string): number[] => {
    if (!searchTerm || searchTerm.trim().length === 0) return [];
    
    const matches: number[] = [];
    const lines = content.split('\n');
    const cleanTerm = searchTerm.trim().toLowerCase();
    
    console.log('=== BÚSQUEDA SIMPLE ===');
    console.log('Término:', `"${cleanTerm}"`);
    console.log('Total líneas:', lines.length);
    
    // Buscar línea por línea - coincidencia simple
    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      const lineLower = line.toLowerCase();
      
      // Búsqueda simple de substring
      if (lineLower.includes(cleanTerm)) {
        matches.push(lineNumber);
        console.log(`✅ Encontrado línea ${lineNumber}: "${line}"`);
      }
    });
    
    console.log('Total coincidencias:', matches.length);
    return matches;
  };

  const updateSearchMatches = (side: 'left' | 'right') => {
    const content = side === 'left' ? leftContent : rightContent;
    const searchTerm = side === 'left' ? leftSearchTerm : rightSearchTerm;
    
    console.log(`=== ACTUALIZANDO ${side.toUpperCase()} ===`);
    console.log('Término:', `"${searchTerm}"`);
    
    const matches = findSearchMatches(content, searchTerm);
    
    if (side === 'left') {
      setLeftSearchMatches(matches);
      setLeftSearchIndex(matches.length > 0 ? 0 : -1);
      console.log('Matches izquierdos:', matches);
    } else {
      setRightSearchMatches(matches);
      setRightSearchIndex(matches.length > 0 ? 0 : -1);
      console.log('Matches derechos:', matches);
    }
  };

  const navigateSearch = (side: 'left' | 'right', direction: 'up' | 'down') => {
    const searchTerm = side === 'left' ? leftSearchTerm : rightSearchTerm;
    const currentIndex = side === 'left' ? leftSearchIndex : rightSearchIndex;
    const matches = side === 'left' ? leftSearchMatches : rightSearchMatches;
    
    console.log(`=== NAVEGANDO ${side.toUpperCase()} ===`);
    console.log('Término:', `"${searchTerm}"`);
    console.log('Dirección:', direction);
    console.log('Índice actual:', currentIndex);
    console.log('Matches disponibles:', matches);
    
    if (!searchTerm || searchTerm.trim().length === 0) {
      console.log('❌ Término vacío');
      return;
    }
    
    if (matches.length === 0) {
      console.log('❌ No hay coincidencias');
      return;
    }
    
    // Calcular siguiente índice
    let newIndex;
    if (direction === 'down') {
      newIndex = currentIndex < matches.length - 1 ? currentIndex + 1 : 0;
    } else {
      newIndex = currentIndex > 0 ? currentIndex - 1 : matches.length - 1;
    }
    
    console.log(`Nuevo índice: ${newIndex}`);
    console.log(`Línea objetivo: ${matches[newIndex]}`);
    
    // Actualizar estado primero
    if (side === 'left') {
      setLeftSearchIndex(newIndex);
    } else {
      setRightSearchIndex(newIndex);
    }
    
    const targetLine = matches[newIndex];
    console.log('Navegando a línea:', targetLine);
    
    const editorRef = side === 'left' ? leftEditorRef : rightEditorRef;
    console.log('Editor ref disponible:', !!editorRef.current);
    
    if (editorRef.current && editorRef.current.view) {
      console.log('Editor view disponible:', !!editorRef.current.view);
      
      try {
        const editorView = editorRef.current.view;
        const line = editorView.state.doc.line(targetLine);
        
        console.log(`Línea ${targetLine}: "${line.text}"`);
        console.log('Posición línea:', line.from);
        
        // Navegar con scrollIntoView
        console.log('Ejecutando scrollIntoView...');
        editorView.dispatch({
          scrollIntoView: line.from
        });
        
        // Seleccionar la línea
        console.log('Ejecutando selección...');
        editorView.dispatch({
          selection: { anchor: line.from, head: line.from }
        });
        
        console.log('✅ Navegación completada');
      } catch (error) {
        console.error('Error en navegación:', error);
        console.error('Stack:', error instanceof Error ? error.stack : 'No stack available');
      }
    } else {
      console.log('❌ Editor no disponible');
      console.log('Editor ref:', editorRef.current);
      if (editorRef.current) {
        console.log('Editor ref keys:', Object.keys(editorRef.current));
      }
    }
  };

  const handleSearchChange = (side: 'left' | 'right', value: string) => {
    console.log(`Cambio de búsqueda ${side}:`, `"${value}"`);
    
    // Actualizar el término
    if (side === 'left') {
      setLeftSearchTerm(value);
    } else {
      setRightSearchTerm(value);
    }
  };

  // Actualizar matches cuando cambia el término de búsqueda (izquierdo)
  useEffect(() => {
    if (leftSearchTerm !== undefined) {
      updateSearchMatches('left');
    }
  }, [leftSearchTerm, leftContent]);

  // Actualizar matches cuando cambia el término de búsqueda (derecho)  
  useEffect(() => {
    if (rightSearchTerm !== undefined) {
      updateSearchMatches('right');
    }
  }, [rightSearchTerm, rightContent]);

  // Atajos de teclado para búsqueda
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // F3 - Siguiente coincidencia
      if (e.key === 'F3' && !e.shiftKey) {
        e.preventDefault();
        // Determinar qué editor tiene el foco o usar el izquierdo por defecto
        const activeElement = document.activeElement;
        const leftSearchInput = document.querySelector('input[placeholder="Buscar..."]') as HTMLInputElement;
        
        if (activeElement === leftSearchInput || leftSearchMatches.length > 0) {
          navigateSearch('left', 'down');
        } else if (rightSearchMatches.length > 0) {
          navigateSearch('right', 'down');
        }
      }
      // Shift+F3 - Anterior coincidencia
      else if (e.key === 'F3' && e.shiftKey) {
        e.preventDefault();
        // Determinar qué editor tiene el foco o usar el izquierdo por defecto
        const activeElement = document.activeElement;
        const leftSearchInput = document.querySelector('input[placeholder="Buscar..."]') as HTMLInputElement;
        
        if (activeElement === leftSearchInput || leftSearchMatches.length > 0) {
          navigateSearch('left', 'up');
        } else if (rightSearchMatches.length > 0) {
          navigateSearch('right', 'up');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [leftSearchMatches, rightSearchMatches, leftSearchIndex, rightSearchIndex]);

  const handleFileUpload = async (
    file: File,
    side: 'left' | 'right'
  ) => {
    const text = await file.text();
    const setter = side === 'left' ? setLeftContent : setRightContent;
    const nameSetter = side === 'left' ? setLeftFileName : setRightFileName;

    setter(text);
    nameSetter(file.name);

    const extension = file.name.split('.').pop()?.toLowerCase();
    const language = detectLanguage(extension || '');
    if (side === 'left') {
      setLeftLanguage(language);
    } else {
      setRightLanguage(language);
    }
  };

  const detectLanguage = (extension: string): string => {
    const languageMap: Record<string, string> = {
      js: 'javascript',
      jsx: 'javascript',
      ts: 'typescript',
      tsx: 'typescript',
      py: 'python',
      java: 'java',
      cpp: 'cpp',
      c: 'c',
      cs: 'csharp',
      php: 'php',
      rb: 'ruby',
      go: 'go',
      rs: 'rust',
      html: 'html',
      css: 'css',
      json: 'json',
      xml: 'xml',
      md: 'markdown',
      sql: 'sql',
    };
    return languageMap[extension] || 'plaintext';
  };

  const handleCompare = () => {
    const leftLines = leftContent.split('\n');
    const rightLines = rightContent.split('\n');
    
    console.log('=== DEBUG COMPARACIÓN ===');
    console.log('Left lines:', leftLines.length);
    console.log('Right lines:', rightLines.length);
    
    // Mostrar solo las primeras 10 líneas para depuración
    console.log('Primeras 10 líneas del archivo izquierdo:');
    for (let i = 0; i < Math.min(10, leftLines.length); i++) {
      console.log(`  ${i + 1}: "${leftLines[i]}"`);
    }
    
    console.log('Primeras 10 líneas del archivo derecho:');
    for (let i = 0; i < Math.min(10, rightLines.length); i++) {
      console.log(`  ${i + 1}: "${rightLines[i]}"`);
    }
    
    // Algoritmo simplificado pero preciso - tipo Git/VSCode
    const createPreciseDiff = (left: string[], right: string[]) => {
      const leftDiff: DiffLine[] = [];
      const rightDiff: DiffLine[] = [];
      
      console.log('=== ANÁLISIS PRECISO TIPO GIT ===');
      console.log('Total líneas izquierda:', left.length);
      console.log('Total líneas derecha:', right.length);
      
      let addedCount = 0;
      let removedCount = 0;
      let modifiedCount = 0;
      let unchangedCount = 0;
      
      // Encontrar la subsecuencia común más larga (LCS) - método más simple
      const lcs = findLongestCommonSubsequence(left, right);
      
      console.log('LCS encontrado:', lcs.length, 'líneas comunes');
      
      // Reconstruir diferencias basadas en LCS
      let leftIndex = 0;
      let rightIndex = 0;
      let lineNumber = 1;
      
      for (const match of lcs) {
        // Procesar líneas antes de la coincidencia
        while (leftIndex < match.leftIndex && rightIndex < match.rightIndex) {
          if (left[leftIndex] === right[rightIndex]) {
            // Líneas idénticas inesperadas
            leftDiff.push({
              lineNumber: lineNumber,
              content: left[leftIndex],
              type: 'unchanged',
            });
            rightDiff.push({
              lineNumber: lineNumber,
              content: right[rightIndex],
              type: 'unchanged',
            });
            unchangedCount++;
          } else {
            // Líneas diferentes
            leftDiff.push({
              lineNumber: lineNumber,
              content: left[leftIndex],
              type: 'modified',
            });
            rightDiff.push({
              lineNumber: lineNumber,
              content: right[rightIndex],
              type: 'modified',
            });
            modifiedCount++;
          }
          
          leftIndex++;
          rightIndex++;
          lineNumber++;
        }
        
        // Procesar líneas extra en el lado izquierdo (eliminadas)
        while (leftIndex < match.leftIndex) {
          leftDiff.push({
            lineNumber: lineNumber,
            content: left[leftIndex],
            type: 'removed',
          });
          rightDiff.push({
            lineNumber: lineNumber,
            content: '',
            type: 'removed',
          });
          removedCount++;
          
          leftIndex++;
          lineNumber++;
        }
        
        // Procesar líneas extra en el lado derecho (añadidas)
        while (rightIndex < match.rightIndex) {
          leftDiff.push({
            lineNumber: lineNumber,
            content: '',
            type: 'added',
          });
          rightDiff.push({
            lineNumber: lineNumber,
            content: right[rightIndex],
            type: 'added',
          });
          addedCount++;
          
          rightIndex++;
          lineNumber++;
        }
        
        // Agregar la coincidencia exacta
        leftDiff.push({
          lineNumber: lineNumber,
          content: left[match.leftIndex],
          type: 'unchanged',
        });
        rightDiff.push({
          lineNumber: lineNumber,
          content: right[match.rightIndex],
          type: 'unchanged',
        });
        unchangedCount++;
        
        leftIndex = match.leftIndex + 1;
        rightIndex = match.rightIndex + 1;
        lineNumber++;
      }
      
      // Procesar líneas restantes después de la última coincidencia
      while (leftIndex < left.length && rightIndex < right.length) {
        if (left[leftIndex] === right[rightIndex]) {
          // Líneas idénticas
          leftDiff.push({
            lineNumber: lineNumber,
            content: left[leftIndex],
            type: 'unchanged',
          });
          rightDiff.push({
            lineNumber: lineNumber,
            content: right[rightIndex],
            type: 'unchanged',
          });
          unchangedCount++;
        } else {
          // Líneas diferentes
          leftDiff.push({
            lineNumber: lineNumber,
            content: left[leftIndex],
            type: 'modified',
          });
          rightDiff.push({
            lineNumber: lineNumber,
            content: right[rightIndex],
            type: 'modified',
          });
          modifiedCount++;
        }
        
        leftIndex++;
        rightIndex++;
        lineNumber++;
      }
      
      // Procesar líneas restantes del archivo izquierdo
      while (leftIndex < left.length) {
        leftDiff.push({
          lineNumber: lineNumber,
          content: left[leftIndex],
          type: 'removed',
        });
        rightDiff.push({
          lineNumber: lineNumber,
          content: '',
          type: 'removed',
        });
        removedCount++;
        
        leftIndex++;
        lineNumber++;
      }
      
      // Procesar líneas restantes del archivo derecho
      while (rightIndex < right.length) {
        leftDiff.push({
          lineNumber: lineNumber,
          content: '',
          type: 'added',
        });
        rightDiff.push({
          lineNumber: lineNumber,
          content: right[rightIndex],
          type: 'added',
        });
        addedCount++;
        
        rightIndex++;
        lineNumber++;
      }
      
      console.log('=== RESUMEN ===');
      console.log('Líneas sin cambios (azul):', unchangedCount);
      console.log('Líneas añadidas (verde):', addedCount);
      console.log('Líneas eliminadas (rojo):', removedCount);
      console.log('Líneas modificadas (amarillo):', modifiedCount);
      console.log('Total líneas procesadas:', lineNumber - 1);
      
      return { leftDiff, rightDiff };
    };
    
    // Encontrar la subsecuencia común más larga (LCS) - método simple
    const findLongestCommonSubsequence = (left: string[], right: string[]) => {
      const m = left.length;
      const n = right.length;
      const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
      
      // Construir matriz DP
      for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
          if (left[i - 1] === right[j - 1]) {
            dp[i][j] = dp[i - 1][j - 1] + 1;
          } else {
            dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
          }
        }
      }
      
      // Reconstruir LCS
      const lcs: Array<{leftIndex: number, rightIndex: number}> = [];
      let i = m, j = n;
      
      while (i > 0 && j > 0) {
        if (left[i - 1] === right[j - 1]) {
          lcs.unshift({leftIndex: i - 1, rightIndex: j - 1});
          i--;
          j--;
        } else if (dp[i - 1][j] > dp[i][j - 1]) {
          i--;
        } else {
          j--;
        }
      }
      
      return lcs;
    };
    
    const { leftDiff: newLeftDiff, rightDiff: newRightDiff } = createPreciseDiff(leftLines, rightLines);
    setLeftDiff(newLeftDiff);
    setRightDiff(newRightDiff);
  };

  const handleFormat = (side: 'left' | 'right') => {
    const content = side === 'left' ? leftContent : rightContent;
    const language = side === 'left' ? leftLanguage : rightLanguage;
    const setter = side === 'left' ? setLeftContent : setRightContent;

    const formatted = formatCode(content, language);
    setter(formatted);
  };

  const handleClear = (side: 'left' | 'right') => {
    if (side === 'left') {
      setLeftContent('');
      setLeftFileName('');
      setLeftDiff([]);
    } else {
      setRightContent('');
      setRightFileName('');
      setRightDiff([]);
    }
  };

  const handleCopy = async (side: 'left' | 'right') => {
    const content = side === 'left' ? leftContent : rightContent;
    try {
      const electronAPI = (typeof window !== 'undefined' && (window as any).electronAPI) ? (window as any).electronAPI : null;
      if (electronAPI?.clipboard?.writeText) {
        await electronAPI.clipboard.writeText(content);
      } else if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = content;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
    } catch (err) {
      console.error('Error al copiar:', err);
    }
  };

  const handleSave = (side: 'left' | 'right') => {
    const content = side === 'left' ? leftContent : rightContent;
    const fileName = side === 'left' ? leftFileName : rightFileName;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName || `codigo_${side}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full h-full flex flex-col px-4 md:px-8 py-4 overflow-hidden bg-transparent border-none">
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-2 min-h-0 overflow-hidden">
        <Card className="p-4 flex flex-col shadow-xl border-2 min-h-0 overflow-hidden bg-transparent border-slate-200/20 dark:border-border/80/20">
          <div className="flex-shrink-0 space-y-3 mb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <h2 className="text-lg md:text-xl font-semibold text-slate-900 dark:text-foreground/90">
                  Archivo Original
                </h2>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Buscar..."
                      value={leftSearchTerm}
                      onChange={(e) => handleSearchChange('left', e.target.value)}
                      className="w-48 pl-10 pr-20 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent dark:bg-card dark:border-border/40 dark:text-foreground"
                    />
                    <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center gap-1">
                      <span className="text-xs text-muted-foreground/80 min-w-[30px] text-center">
                        {leftSearchMatches.length > 0 ? `${leftSearchIndex + 1}/${leftSearchMatches.length}` : ''}
                      </span>
                      <div className="flex flex-col">
                        <button
                          onClick={() => navigateSearch('left', 'up')}
                          disabled={leftSearchMatches.length === 0}
                          className="p-1 hover:bg-gray-200 dark:hover:bg-muted rounded disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Anterior (Shift+F3)"
                        >
                          <ChevronUp className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => navigateSearch('left', 'down')}
                          disabled={leftSearchMatches.length === 0}
                          className="p-1 hover:bg-gray-200 dark:hover:bg-muted rounded disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Siguiente (F3)"
                        >
                          <ChevronDown className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleFormat('left')}
                  title="Formatear código"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleCopy('left')}
                    title="Copiar contenido"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleSave('left')}
                    title="Guardar archivo"
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <input
                ref={leftFileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file, 'left');
                }}
              />
              <Button
                onClick={() => leftFileInputRef.current?.click()}
                variant="outline"
                className="flex-1"
              >
                <Upload className="mr-2 h-4 w-4" />
                Cargar Archivo
              </Button>

              <Select value={leftLanguage} onValueChange={setLeftLanguage}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="javascript">JavaScript</SelectItem>
                  <SelectItem value="typescript">TypeScript</SelectItem>
                  <SelectItem value="python">Python</SelectItem>
                  <SelectItem value="java">Java</SelectItem>
                  <SelectItem value="cpp">C++</SelectItem>
                  <SelectItem value="c">C</SelectItem>
                  <SelectItem value="csharp">C#</SelectItem>
                  <SelectItem value="php">PHP</SelectItem>
                  <SelectItem value="ruby">Ruby</SelectItem>
                  <SelectItem value="go">Go</SelectItem>
                  <SelectItem value="rust">Rust</SelectItem>
                  <SelectItem value="html">HTML</SelectItem>
                  <SelectItem value="css">CSS</SelectItem>
                  <SelectItem value="json">JSON</SelectItem>
                  <SelectItem value="xml">XML</SelectItem>
                  <SelectItem value="markdown">Markdown</SelectItem>
                  <SelectItem value="sql">SQL</SelectItem>
                  <SelectItem value="plaintext">Texto Plano</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {leftFileName && (
              <div className="flex items-center justify-between text-sm bg-slate-100 dark:bg-card p-2 rounded">
                <span className="text-muted-foreground/60 dark:text-muted-foreground truncate">
                  {leftFileName}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleClear('left')}
                >
                  Limpiar
                </Button>
              </div>
            )}
          </div>

          <div className="flex-1 min-h-0">
            <CodeEditorCM
              ref={leftEditorRef}
              content={leftContent}
              onChange={setLeftContent}
              language={leftLanguage}
              diff={leftDiff}
              searchTerm={leftSearchTerm}
              currentMatchIndex={leftSearchIndex}
              matches={leftSearchMatches}
            />
          </div>
        </Card>

        <Card className="p-4 flex flex-col shadow-xl border-2 min-h-0 overflow-hidden bg-transparent border-slate-200/20 dark:border-border/80/20">
          <div className="flex-shrink-0 space-y-3 mb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <h2 className="text-lg md:text-xl font-semibold text-slate-900 dark:text-foreground/90">
                  Archivo Modificado
                </h2>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Buscar..."
                      value={rightSearchTerm}
                      onChange={(e) => handleSearchChange('right', e.target.value)}
                      className="w-48 pl-10 pr-20 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent dark:bg-card dark:border-border/40 dark:text-foreground"
                    />
                    <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center gap-1">
                      <span className="text-xs text-muted-foreground/80 min-w-[30px] text-center">
                        {rightSearchMatches.length > 0 ? `${rightSearchIndex + 1}/${rightSearchMatches.length}` : ''}
                      </span>
                      <div className="flex flex-col">
                        <button
                          onClick={() => navigateSearch('right', 'up')}
                          disabled={rightSearchMatches.length === 0}
                          className="p-1 hover:bg-gray-200 dark:hover:bg-muted rounded disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Anterior (Shift+F3)"
                        >
                          <ChevronUp className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => navigateSearch('right', 'down')}
                          disabled={rightSearchMatches.length === 0}
                          className="p-1 hover:bg-gray-200 dark:hover:bg-muted rounded disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Siguiente (F3)"
                        >
                          <ChevronDown className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleFormat('right')}
                  title="Formatear código"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleCopy('right')}
                  title="Copiar contenido"
                >
                  <Copy className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSave('right')}
                  title="Guardar archivo"
                >
                  <Download className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="flex gap-3">
              <input
                ref={rightFileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file, 'right');
                }}
              />
              <Button
                onClick={() => rightFileInputRef.current?.click()}
                variant="outline"
                className="flex-1"
              >
                <Upload className="mr-2 h-4 w-4" />
                Cargar Archivo
              </Button>

              <Select value={rightLanguage} onValueChange={setRightLanguage}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="javascript">JavaScript</SelectItem>
                  <SelectItem value="typescript">TypeScript</SelectItem>
                  <SelectItem value="python">Python</SelectItem>
                  <SelectItem value="java">Java</SelectItem>
                  <SelectItem value="cpp">C++</SelectItem>
                  <SelectItem value="c">C</SelectItem>
                  <SelectItem value="csharp">C#</SelectItem>
                  <SelectItem value="php">PHP</SelectItem>
                  <SelectItem value="ruby">Ruby</SelectItem>
                  <SelectItem value="go">Go</SelectItem>
                  <SelectItem value="rust">Rust</SelectItem>
                  <SelectItem value="html">HTML</SelectItem>
                  <SelectItem value="css">CSS</SelectItem>
                  <SelectItem value="json">JSON</SelectItem>
                  <SelectItem value="xml">XML</SelectItem>
                  <SelectItem value="markdown">Markdown</SelectItem>
                  <SelectItem value="sql">SQL</SelectItem>
                  <SelectItem value="plaintext">Texto Plano</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {rightFileName && (
              <div className="flex items-center justify-between text-sm bg-slate-100 dark:bg-card p-2 rounded">
                <span className="text-muted-foreground/60 dark:text-muted-foreground truncate">
                  {rightFileName}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleClear('right')}
                >
                  Limpiar
                </Button>
              </div>
            )}
          </div>

          <div className="flex-1 min-h-0">
            <CodeEditorCM
              ref={rightEditorRef}
              content={rightContent}
              onChange={setRightContent}
              language={rightLanguage}
              diff={rightDiff}
              searchTerm={rightSearchTerm}
              currentMatchIndex={rightSearchIndex}
              matches={rightSearchMatches}
            />
          </div>
        </Card>
      </div>

      <div className="flex-shrink-0 grid grid-cols-2 sm:grid-cols-5 items-stretch gap-2 md:gap-4 text-center w-full mt-4">
        <Card className="p-3 md:p-4 bg-red-900/20 border-destructive/30 shadow-none flex flex-col justify-center">
          <div className="text-xs md:text-sm font-medium text-red-900 dark:text-red-300">
            Líneas Eliminadas
          </div>
          <div className="text-xl md:text-2xl font-bold text-red-600 dark:text-destructive mt-1">
            {leftDiff.filter((l) => l.type === 'removed').length}
          </div>
        </Card>
        <Card className="p-3 md:p-4 bg-green-900/20 border-green-500/30 shadow-none flex flex-col justify-center">
          <div className="text-xs md:text-sm font-medium text-green-900 dark:text-green-300">
            Líneas Añadidas
          </div>
          <div className="text-xl md:text-2xl font-bold text-green-600 dark:text-green-400 mt-1">
            {rightDiff.filter((l) => l.type === 'added').length}
          </div>
        </Card>

        <div className="flex flex-col gap-1 col-span-2 sm:col-span-1">
          <button
            onClick={handleCompare}
            className="w-full flex-1 py-1 px-2 text-foreground font-medium rounded-lg border border-blue-500 bg-gradient-to-b from-white/10 to-transparent shadow-[0_0_15px_rgba(59,130,246,0.3)] hover:shadow-[0_0_20px_rgba(59,130,246,0.5)] transition-all duration-300 backdrop-blur-sm hover:scale-[1.02] flex items-center justify-center gap-2"
          >
            <FileCode2 className="h-4 w-4" />
            <span className="text-xs md:text-sm leading-tight">Comparar Archivos</span>
          </button>
        </div>

        <Card className="p-3 md:p-4 bg-amber-900/20 border-amber-500/30 shadow-none flex flex-col justify-center">
          <div className="text-xs md:text-sm font-medium text-yellow-900 dark:text-yellow-300">
            Líneas Modificadas
          </div>
          <div className="text-xl md:text-2xl font-bold text-yellow-600 dark:text-warning mt-1">
            {rightDiff.filter((l) => l.type === 'modified').length}
          </div>
        </Card>
        <Card className="p-3 md:p-4 bg-background/20 border-zinc-500/30 shadow-none dark:bg-card/20 flex flex-col justify-center">
          <div className="text-xs md:text-sm font-medium text-zinc-900 dark:text-foreground/70">
            Líneas sin Cambios
          </div>
          <div className="text-xl md:text-2xl font-bold text-muted-foreground/60 dark:text-muted-foreground mt-1">
            {leftDiff.filter((l) => l.type === 'unchanged').length}
          </div>
        </Card>
      </div>
    </div>
  );
}
