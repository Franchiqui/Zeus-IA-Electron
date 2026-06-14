'use client';

import React, { useState, useCallback, useRef } from 'react';
import { FolderOpen, FileText, Download, Copy, Check, AlertTriangle, Loader2, List, TreeDeciduous } from 'lucide-react';
import FolderTree from '@/components/folder-tree';

interface ScanResult {
  folderA: { folders: number; files: number };
  folderB: { folders: number; files: number };
  structureA?: { name: string; path: string; isDirectory: boolean; children: boolean; missingInB?: boolean }[];
  structureB?: { name: string; path: string; isDirectory: boolean; children: boolean; missingInA?: boolean }[];
  differences: {
    missingFoldersB: string[];
    missingFilesA: string[];
    missingFilesB: string[];
    differentSizeFiles: { path: string; sizeA: number; sizeB: number }[];
  };
  scanErrors?: {
    folderA: string[];
    folderB: string[];
  };
}

export default function FolderComparatorTab() {
  const [folderAPath, setFolderAPath] = useState('');
  const [folderBPath, setFolderBPath] = useState('');
  const [folderAName, setFolderAName] = useState('');
  const [folderBName, setFolderBName] = useState('');
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'tree'>('list');
  const [scanProgress, setScanProgress] = useState(0);
  const [scanStatus, setScanStatus] = useState('');
  const folderInputRefA = useRef<HTMLInputElement>(null);
  const folderInputRefB = useRef<HTMLInputElement>(null);

  const handleSelectFolderA = useCallback(async () => {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.selectFolder) {
      const result = await (window as any).electronAPI.selectFolder();
      if (result && !result.canceled && result.filePath) {
        setFolderAPath(result.filePath);
        const folderName = result.filePath.split(/[/\\]/).pop() || 'Carpeta seleccionada';
        setFolderAName(folderName);
      }
    } else {
      folderInputRefA.current?.click();
    }
  }, []);

  const handleSelectFolderB = useCallback(async () => {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.selectFolder) {
      const result = await (window as any).electronAPI.selectFolder();
      if (result && !result.canceled && result.filePath) {
        setFolderBPath(result.filePath);
        const folderName = result.filePath.split(/[/\\]/).pop() || 'Carpeta seleccionada';
        setFolderBName(folderName);
      }
    } else {
      folderInputRefB.current?.click();
    }
  }, []);

  const handleFolderAChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const firstFile = files[0];
      const relativePath = (firstFile as any)?.webkitRelativePath || '';
      const folderName = relativePath ? relativePath.split('/')[0] : 'Carpeta seleccionada';
      setFolderAName(folderName);

      const filePath = (firstFile as any)?.path || '';
      if (filePath && relativePath) {
        setFolderAPath(filePath.slice(0, -relativePath.length));
      } else if (relativePath) {
        setFolderAPath(folderName);
      }
    }
  }, []);

  const handleFolderBChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const firstFile = files[0];
      const relativePath = (firstFile as any)?.webkitRelativePath || '';
      const folderName = relativePath ? relativePath.split('/')[0] : 'Carpeta seleccionada';
      setFolderBName(folderName);

      const filePath = (firstFile as any)?.path || '';
      if (filePath && relativePath) {
        setFolderBPath(filePath.slice(0, -relativePath.length));
      } else if (relativePath) {
        setFolderBPath(folderName);
      }
    }
  }, []);

  const handleScan = useCallback(async () => {
    if (!folderAPath || !folderBPath) {
      setError('Por favor selecciona ambas carpetas');
      return;
    }

    setScanning(true);
    setError(null);
    setResult(null);
    setScanProgress(0);
    setScanStatus('');

    try {
      const response = await fetch('/compara-carpetas/api/scan/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderA: folderAPath, folderB: folderBPath }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Error al escanear carpetas');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('No se pudo leer la respuesta');
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));
            
            if (data.error) {
              throw new Error(data.error);
            }
            
            if (data.progress !== undefined) {
              setScanProgress(data.progress);
            }
            
            if (data.status) {
              setScanStatus(data.status);
            }
            
            if (data.result) {
              setResult(data.result);
            }
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setScanning(false);
      setScanProgress(0);
      setScanStatus('');
    }
  }, [folderAPath, folderBPath]);

  const formatResult = useCallback(() => {
    if (!result) return '';

    const lines = [
      'CARPETA_A:',
      'Carpetas: ' + result.folderA.folders,
      'Archivos: ' + result.folderA.files,
      '',
      'CARPETA_B:',
      'Carpetas: ' + result.folderB.folders,
      'Archivos: ' + result.folderB.files,
      '',
      'DIFERENCIA:',
    ];

    if (result.differences.missingFoldersB.length > 0) {
      lines.push('Carpeta B tiene ' + result.differences.missingFoldersB.length + ' carpeta(s) que no tiene A:');
      result.differences.missingFoldersB.forEach(function (f) { lines.push(f); });
      lines.push('');
    }

    if (result.differences.missingFilesA.length > 0) {
      lines.push('Archivos solo en A (' + result.differences.missingFilesA.length + '):');
      result.differences.missingFilesA.forEach(function (f) { lines.push(f); });
      lines.push('');
    }

    if (result.differences.missingFilesB.length > 0) {
      lines.push('Archivos solo en B (' + result.differences.missingFilesB.length + '):');
      result.differences.missingFilesB.forEach(function (f) { lines.push(f); });
      lines.push('');
    }

    if (result.differences.differentSizeFiles.length > 0) {
      lines.push('Archivos con diferente tamaño:');
      result.differences.differentSizeFiles.forEach(function (f) {
        lines.push(f.path + ':');
        lines.push('  A: ' + f.sizeA + ' bytes');
        lines.push('  B: ' + f.sizeB + ' bytes');
        lines.push('');
      });
    }

    return lines.join('');
  }, [result]);

  const handleCopy = useCallback(async () => {
    const text = formatResult();
    if (!text) return;

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
        const success = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (!success) throw new Error('execCommand falló');
      }
      setCopied(true);
      setTimeout(function () { setCopied(false); }, 2000);
    } catch (e) {
      setError('Error al copiar al portapapeles');
    }
  }, [formatResult]);

  const handleDownload = useCallback(function () {
    var text = formatResult();
    if (!text) return;

    var blob = new Blob([text], { type: 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'comparacion-carpetas-' + Date.now() + '.txt';
    a.click();
    URL.revokeObjectURL(url);
  }, [formatResult]);

  return (
    <div className="flex flex-col h-full bg-transparent">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border/80 bg-transparent">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-3">
          <FolderOpen className="w-6 h-6 text-primary" />
          Comparador de Carpetas
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Compara el contenido de dos carpetas</p>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden bg-transparent">
        {/* Left Panel - Folder Selection */}
        <div className="flex-1 flex flex-col border-r border-border/80 bg-transparent">
          <div className="h-12 px-4 bg-background/40 border-b border-border/80 flex items-center">
            <h2 className="text-sm font-semibold text-foreground/70 flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-primary" />
              Selección de Carpetas
            </h2>
          </div>
          <div className="flex-1 p-4 flex flex-col overflow-auto bg-transparent">
            <div className="bg-card/40 backdrop-blur-sm rounded-xl p-6 border border-border/50">
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-foreground/70 mb-2">
                    Carpeta A
                  </label>
                  <div className="relative">
                    <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <input
                      type="text"
                      value={folderAPath}
                      onChange={function (e) { setFolderAPath(e.target.value); }}
                      placeholder="Ruta de la carpeta A"
                      className="w-full pl-10 pr-4 py-2 bg-muted border border-border/40 rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      ref={folderInputRefA}
                      type="file"
                      onChange={handleFolderAChange}
                      className="hidden"
                      {...({ webkitdirectory: 'true', directory: 'true' } as any)}
                    />
                    <button
                      type="button"
                      onClick={handleSelectFolderA}
                      className="px-3 py-1.5 text-sm bg-gradient-to-r from-emerald-700 to-emerald-600 hover:from-emerald-800 hover:to-emerald-700 text-foreground font-bold rounded-lg transition-all flex items-center gap-1.5 shadow-lg shadow-emerald-900/30"
                    >
                      <FolderOpen className="w-4 h-4" />
                      Seleccionar Carpeta
                    </button>
                    {folderAName && (
                      <span className="text-sm text-muted-foreground truncate max-w-[200px]">
                        {folderAName}
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground/70 mb-2">
                    Carpeta B
                  </label>
                  <div className="relative">
                    <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <input
                      type="text"
                      value={folderBPath}
                      onChange={function (e) { setFolderBPath(e.target.value); }}
                      placeholder="Ruta de la carpeta B"
                      className="w-full pl-10 pr-4 py-2 bg-muted border border-border/40 rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      ref={folderInputRefB}
                      type="file"
                      onChange={handleFolderBChange}
                      className="hidden"
                      {...({ webkitdirectory: 'true', directory: 'true' } as any)}
                    />
                    <button
                      type="button"
                      onClick={handleSelectFolderB}
                      className="px-3 py-1.5 text-sm bg-gradient-to-r from-emerald-700 to-emerald-600 hover:from-emerald-800 hover:to-emerald-700 text-foreground font-bold rounded-lg transition-all flex items-center gap-1.5 shadow-lg shadow-emerald-900/30"
                    >
                      <FolderOpen className="w-4 h-4" />
                      Seleccionar Carpeta
                    </button>
                    {folderBName && (
                      <span className="text-sm text-muted-foreground truncate max-w-[200px]">
                        {folderBName}
                      </span>
                    )}
                  </div>
                </div>

                <button
                  onClick={handleScan}
                  disabled={scanning}
                  className="w-full py-3 bg-gradient-to-r from-emerald-700 to-emerald-600 hover:from-emerald-800 hover:to-emerald-700 disabled:from-gray-600 disabled:to-gray-600 disabled:cursor-not-allowed text-foreground font-bold rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/30"
                >
                  {scanning ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Escaneando...
                    </>
                  ) : (
                    <>
                      <FileText className="w-5 h-5" />
                      Escanear Carpetas
                    </>
                  )}
                </button>

                {scanning && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-foreground/70">{scanStatus}</span>
                      <span className="text-sm text-foreground/70">{scanProgress}%</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300 ease-out"
                        style={{ width: `${scanProgress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {error && (
                <div className="mt-4 bg-red-900/50 backdrop-blur-sm rounded-lg p-4 border border-red-700 flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0" />
                  <p className="text-red-300 text-sm">{error}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Panel - Results */}
        <div className="flex-1 flex flex-col bg-transparent">
          <div className="h-12 px-4 bg-background/40 border-b border-border/80 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground/70 flex items-center gap-2">
              <FileText className="w-4 h-4 text-success" />
              Resultados
            </h2>
            {result && (
              <div className="flex gap-2">
                <button
                  onClick={handleCopy}
                  className="p-1.5 bg-card hover:bg-muted text-foreground/70 rounded text-xs font-medium transition-colors flex items-center gap-1"
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-success" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  {copied ? '¡Copiado!' : 'Copiar'}
                </button>
                <button
                  onClick={handleDownload}
                  className="p-1.5 bg-card hover:bg-muted text-foreground/70 rounded text-xs font-medium transition-colors flex items-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" />
                  Descargar
                </button>
              </div>
            )}
          </div>
          <div className="flex-1 p-4 overflow-auto bg-transparent">
            {!result ? (
              <div className="flex flex-col items-center justify-center h-full text-success bg-transparent">
                <FolderOpen className="w-16 h-16 mb-4" />
                <p className="text-sm font-medium tracking-widest uppercase">Selecciona carpetas para comparar</p>
              </div>
            ) : (
              <div className="bg-card/40 backdrop-blur-sm rounded-xl p-6 border border-border/50">
                {/* Tabs */}
                <div className="flex gap-2 mb-6 border-b border-border/50 pb-4">
                  <button
                    onClick={() => setViewMode('list')}
                    className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                      viewMode === 'list'
                        ? 'bg-yellow-400 text-gray-900 font-semibold'
                        : 'bg-emerald-700 text-foreground hover:bg-success'
                    }`}
                  >
                    <List className="w-4 h-4" />
                    Lista
                  </button>
                  <button
                    onClick={() => setViewMode('tree')}
                    className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                      viewMode === 'tree'
                        ? 'bg-yellow-400 text-gray-900 font-semibold'
                        : 'bg-emerald-700 text-foreground hover:bg-success'
                    }`}
                  >
                    <TreeDeciduous className="w-4 h-4" />
                    Árbol
                  </button>
                </div>

                {/* Vista de lista */}
                {viewMode === 'list' && (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                      <div className="bg-muted/50 rounded-lg p-4">
                        <h3 className="font-medium text-primary mb-2">Carpeta A</h3>
                        <p className="text-foreground/70">Carpetas: {result.folderA.folders}</p>
                        <p className="text-foreground/70">Archivos: {result.folderA.files}</p>
                      </div>
                      <div className="bg-muted/50 rounded-lg p-4">
                        <h3 className="font-medium text-accent mb-2">Carpeta B</h3>
                        <p className="text-foreground/70">Carpetas: {result.folderB.folders}</p>
                        <p className="text-foreground/70">Archivos: {result.folderB.files}</p>
                      </div>
                    </div>

                    {result.differences.missingFoldersB.length > 0 && (
                      <div className="mb-4">
                        <h3 className="font-medium text-warning mb-2">
                          Carpetas en B que no existen en A ({result.differences.missingFoldersB.length})
                        </h3>
                        <ul className="space-y-1">
                          {result.differences.missingFoldersB.map(function (folder, i) {
                            return <li key={i} className="text-foreground/70 text-sm font-mono bg-muted/30 rounded px-2 py-1">{folder}</li>
                          })}
                        </ul>
                      </div>
                    )}

                    {result.differences.missingFilesB.length > 0 && (
                      <div className="mb-4">
                        <h3 className="font-medium text-warning mb-2">
                          Archivos en B que no existen en A ({result.differences.missingFilesB.length})
                        </h3>
                        <ul className="space-y-1">
                          {result.differences.missingFilesB.map(function (file, i) {
                            return <li key={i} className="text-foreground/70 text-sm font-mono bg-muted/30 rounded px-2 py-1">{file}</li>
                          })}
                        </ul>
                      </div>
                    )}

                    {result.differences.differentSizeFiles.length > 0 && (
                      <div>
                        <h3 className="font-medium text-warning mb-2">
                          Archivos con diferente tamaño ({result.differences.differentSizeFiles.length})
                        </h3>
                        <div className="space-y-2">
                          {result.differences.differentSizeFiles.map(function (file, i) {
                            return (
                              <div key={i} className="bg-muted/30 rounded-lg p-3">
                                <p className="text-foreground/70 text-sm font-mono">{file.path}</p>
                                <div className="flex gap-4 mt-1 text-sm">
                                  <span className="text-primary">A: {file.sizeA} bytes</span>
                                  <span className="text-accent">B: {file.sizeB} bytes</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Vista de árbol */}
                {viewMode === 'tree' && result.structureA && result.structureB && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FolderTree
                      structure={result.structureA}
                      title="Carpeta A"
                      missingLabel="Elementos en rojo no existen en Carpeta B"
                      isFolderA={true}
                    />
                    <FolderTree
                      structure={result.structureB}
                      title="Carpeta B"
                      missingLabel="Elementos en rojo no existen en Carpeta A"
                      isFolderA={false}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
