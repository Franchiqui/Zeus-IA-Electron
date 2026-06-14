'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Code, RefreshCw, Trash2, Copy, Check, Loader2 } from 'lucide-react';

export default function FormatCodeTab() {
  const [inputCode, setInputCode] = useState('');
  const [outputCode, setOutputCode] = useState('// El código formateado aparecerá aquí...');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [stats, setStats] = useState<{
    originalLength: number;
    formattedLength: number;
    linesCount: number;
    codeType: string;
  } | null>(null);
  const outputRef = useRef<HTMLPreElement>(null);

  // Cargar estado guardado al montar
  useEffect(() => {
    const savedInput = localStorage.getItem('formatCodeInput');
    const savedOutput = localStorage.getItem('formatCodeOutput');
    const savedStats = localStorage.getItem('formatCodeStats');
    
    if (savedInput) setInputCode(savedInput);
    if (savedOutput) setOutputCode(savedOutput);
    if (savedStats) setStats(JSON.parse(savedStats));
  }, []);

  // Guardar estado cuando cambie
  useEffect(() => {
    localStorage.setItem('formatCodeInput', inputCode);
  }, [inputCode]);

  useEffect(() => {
    localStorage.setItem('formatCodeOutput', outputCode);
  }, [outputCode]);

  useEffect(() => {
    if (stats) {
      localStorage.setItem('formatCodeStats', JSON.stringify(stats));
    } else {
      localStorage.removeItem('formatCodeStats');
    }
  }, [stats]);

  const formatCode = async () => {
    if (!inputCode.trim()) {
      setError('Por favor, ingresa algún código para formatear');
      return;
    }

    setError('');
    setIsLoading(true);
    setOutputCode('Procesando...');
    setStats(null);

    try {
      const response = await fetch('http://localhost:3010/api/format', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          escapedCode: inputCode
        })
      });

      const result = await response.json();

      if (response.ok) {
        setOutputCode(result.formattedCode);
        setStats({
          originalLength: result.originalCode.length,
          formattedLength: result.formattedCode.length,
          linesCount: result.metadata.lines,
          codeType: result.codeType.toUpperCase()
        });
      } else {
        setError(result.error || 'Error al formatear el código');
        setOutputCode('// El código formateado aparecerá aquí...');
      }
    } catch (err) {
      setError('Error de conexión: ' + (err as Error).message);
      setOutputCode('// El código formateado aparecerá aquí...');
    } finally {
      setIsLoading(false);
    }
  };

  const clearInput = () => {
    setInputCode('');
    setOutputCode('// El código formateado aparecerá aquí...');
    setStats(null);
    setError('');
  };

  const copyToClipboard = async () => {
    const text = outputCode;
    try {
      const electronAPI = (typeof window !== 'undefined' && (window as any).electronAPI) ? (window as any).electronAPI : null;
      if (electronAPI?.clipboard?.writeText) {
        await electronAPI.clipboard.writeText(text);
      } else if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
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
    } catch (err) {
      console.error('Error al copiar:', err);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border/80">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-3">
          <Code className="w-6 h-6 text-primary" />
          Formateador de Código
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Convierte código escapado o minificado a un formato legible</p>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Input Panel */}
        <div className="flex-1 flex flex-col border-r border-border/80">
          <div className="h-12 px-4 bg-background border-b border-border/80 flex items-center">
            <h2 className="text-sm font-semibold text-foreground/70 flex items-center gap-2">
              <Code className="w-4 h-4 text-primary" />
              Código Entrada
            </h2>
          </div>
          <div className="flex-1 p-4 flex flex-col">
            <textarea
              value={inputCode}
              onChange={(e) => setInputCode(e.target.value)}
              placeholder="Pega tu código escapado o minificado aquí..."
              spellCheck={false}
              className="flex-1 w-full bg-background border border-border/50 rounded-lg p-4 text-xs font-mono text-foreground/70 resize-none focus:outline-none focus:border-primary transition-colors"
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={formatCode}
                disabled={isLoading}
                className="flex items-center gap-2 px-3 py-1.5 bg-primary hover:bg-primary disabled:bg-primary text-foreground rounded-lg text-xs font-medium transition-colors"
              >
                {isLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                Formatear
              </button>
              <button
                onClick={clearInput}
                className="flex items-center gap-2 px-3 py-1.5 bg-muted hover:bg-muted/80 text-foreground rounded-lg text-xs font-medium transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Limpiar
              </button>
            </div>
            {error && (
              <div className="mt-3 px-4 py-2 bg-red-900/30 border border-red-800 rounded-lg text-sm text-destructive">
                {error}
              </div>
            )}
          </div>
        </div>

        {/* Output Panel */}
        <div className="flex-1 flex flex-col">
          <div className="h-12 px-4 bg-background border-b border-border/80 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground/70 flex items-center gap-2">
              <Code className="w-4 h-4 text-success" />
              Código Formateado
            </h2>
            <button
              onClick={copyToClipboard}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-card hover:bg-muted text-foreground/70 rounded text-xs font-medium transition-colors"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-success" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              {copied ? '¡Copiado!' : 'Copiar'}
            </button>
          </div>
          <div className="flex-1 p-4 overflow-auto">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground/80">
                <Loader2 className="w-8 h-8 animate-spin mb-2 text-primary" />
                <p className="text-sm">Formateando código...</p>
              </div>
            ) : (
              <pre
                ref={outputRef}
                className="w-full h-full bg-background border border-border/50 rounded-lg p-4 text-xs font-mono text-success overflow-auto whitespace-pre-wrap"
              >
                {outputCode}
              </pre>
            )}
          </div>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="px-4 py-2 border-t border-border/80 bg-background/50">
          <div className="flex gap-3">
            <div className="flex-1 bg-card rounded px-2 py-1 text-center">
              <div className="text-sm font-bold text-primary">{stats.originalLength.toLocaleString()}</div>
              <div className="text-[10px] text-muted-foreground/80">Caracteres Originales</div>
            </div>
            <div className="flex-1 bg-card rounded px-2 py-1 text-center">
              <div className="text-sm font-bold text-success">{stats.formattedLength.toLocaleString()}</div>
              <div className="text-[10px] text-muted-foreground/80">Caracteres Formateados</div>
            </div>
            <div className="flex-1 bg-card rounded px-2 py-1 text-center">
              <div className="text-sm font-bold text-accent">{stats.linesCount.toLocaleString()}</div>
              <div className="text-[10px] text-muted-foreground/80">Líneas</div>
            </div>
            <div className="flex-1 bg-card rounded px-2 py-1 text-center">
              <div className="text-sm font-bold text-amber-400">{stats.codeType}</div>
              <div className="text-[10px] text-muted-foreground/80">Tipo de Código</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
