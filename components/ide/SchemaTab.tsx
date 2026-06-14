'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { FolderTree, RefreshCw, Loader2, File, Folder, ChevronRight, ChevronDown, Maximize2, Minimize2, Copy, Download, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface SchemaItem {
  name: string;
  path: string;
  fullPath?: string;
  type: 'directory' | 'file' | 'error';
  extension?: string;
  size?: number;
  children?: SchemaItem[];
  preview?: string;
  lines?: number;
  error?: string;
  stats?: {
    fileCount?: number;
    dirCount?: number;
    totalItems?: number;
    size?: number;
    created?: string;
    modified?: string;
  };
}

interface SchemaResponse {
  success: boolean;
  dataPath: string;
  schema: SchemaItem;
  generatedAt: string;
  error?: string;
}

const EXCLUDED_FOLDERS = ['node_modules', '.next'];

export default function SchemaTab({ currentPath, refreshTrigger }: { currentPath: string; refreshTrigger?: number }) {
  const [schema, setSchema] = useState<SchemaItem | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  /**
   * Construye una representación en Markdown del esquema con el mejor diseño posible.
   * Estructura:
   *   1) Encabezado con título, ruta y fecha de generación
   *   2) Resumen con estadísticas globales (archivos, carpetas, tamaño)
   *   3) Árbol jerárquico con emojis y bloques de código
   */
  const buildSchemaMarkdown = useCallback((root: SchemaItem): string => {
    const generatedAt = new Date();

    // Estadísticas globales
    let totalDirs = 0;
    let totalFiles = 0;
    let totalSize = 0;
    const extensionMap = new Map<string, number>();

    const walkStats = (item: SchemaItem) => {
      if (item.type === 'directory') {
        totalDirs++;
        item.children?.forEach(walkStats);
      } else if (item.type === 'file') {
        totalFiles++;
        if (typeof item.size === 'number') totalSize += item.size;
        const ext = (item.extension || item.name.split('.').pop() || 'sin extensión').toLowerCase();
        extensionMap.set(ext, (extensionMap.get(ext) || 0) + 1);
      }
    };
    walkStats(root);

    const formatSize = (bytes: number) => {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    };

    const getFileIcon = (item: SchemaItem): string => {
      if (item.type === 'directory') return '📁';
      if (item.type === 'error') return '⚠️';
      return '📄';
    };

    // Construye el árbol en estilo "tree" (├── └── │) respetando jerarquía
    const lines: string[] = [];
    const buildTree = (item: SchemaItem, prefix: string, isLast: boolean, isRoot: boolean) => {
      const connector = isRoot ? '' : (isLast ? '└── ' : '├── ');
      const icon = getFileIcon(item);
      // El tamaño se muestra SIEMPRE que la API lo provea. Para archivos: obligatorio si existe.
      // Para directorios, el backend no suele enviar size, así que se omite.
      const size = item.size != null ? `  📏 _${formatSize(item.size)}_` : '';
      const lines_count = item.type === 'file' && item.lines != null ? `  📐 _${item.lines} líneas_` : '';
      const ext = item.type === 'file' && item.extension ? `  \`[${item.extension}]\`` : '';
      const stats = item.stats
        ? `  _(${item.stats.dirCount ?? 0} dirs · ${item.stats.fileCount ?? 0} files · ${formatSize(item.stats.size ?? 0)})_`
        : '';
      lines.push(`${prefix}${connector}${icon} **${item.name}**${ext}${size}${lines_count}${stats}`);

      if (item.type === 'directory' && item.children && item.children.length > 0) {
        const childPrefix = isRoot ? '' : prefix + (isLast ? '    ' : '│   ');
        const filtered = item.children.filter(c => !EXCLUDED_FOLDERS.includes(c.name));
        filtered.forEach((child, i) => {
          buildTree(child, childPrefix, i === filtered.length - 1, false);
        });
      }
    };

    buildTree(root, '', true, true);
    const treeBlock = lines.join('\n');

    // Resumen por extensión
    const extSummary = Array.from(extensionMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([ext, count]) => `| 📄 \`${ext || 'sin extensión'}\` | ${count} |`)
      .join('\n');

    const location = currentPath || 'DATA_PATH (sin selección)';
    const projectName = root.name || location.split('/').filter(Boolean).pop() || 'Proyecto';

    // Lista plana detallada de archivos (para vista exhaustiva)
    const flatFiles: string[] = [];
    const collectFiles = (item: SchemaItem, parentPath: string) => {
      if (item.type === 'directory') {
        const nextPath = parentPath ? `${parentPath}/${item.name}` : item.name;
        item.children?.forEach(child => collectFiles(child, nextPath));
      } else if (item.type === 'file') {
        const fullPath = parentPath ? `${parentPath}/${item.name}` : item.name;
        const icon = getFileIcon(item);
        // El tamaño SIEMPRE se muestra (si la API lo provee, que es lo habitual para archivos)
        const size = item.size != null ? ` — 📏 ${formatSize(item.size)}` : '';
        const ext = item.extension ? ` \`[${item.extension}]\`` : '';
        flatFiles.push(`- ${icon} \`${fullPath}\`${ext}${size}`);
      }
    };
    collectFiles(root, '');

    return [
      `# 📂 Esquema del Proyecto: \`${projectName}\``,
      '',
      '> **Documento generado automáticamente por Zeus-IA** — representa la estructura de carpetas y archivos del proyecto.',
      '',
      '## 📍 Información General',
      '',
      '| Campo | Valor |',
      '|-------|-------|',
      `| **Ruta** | \`${location}\` |`,
      `| **Proyecto** | \`${projectName}\` |`,
      `| **Fecha de generación** | ${generatedAt.toLocaleString('es-ES')} |`,
      `| **Carpetas** | ${totalDirs} |`,
      `| **Archivos** | ${totalFiles} |`,
      `| **Tamaño total** | ${formatSize(totalSize)} |`,
      '',
      '## 🌳 Estructura Jerárquica',
      '',
      '```text',
      `${projectName}/`,
      treeBlock,
      '```',
      '',
      ...(extSummary ? [
        '## 📊 Distribución por Tipo de Archivo',
        '',
        '| Extensión | Cantidad |',
        '|-----------|---------:|',
        extSummary,
        '',
      ] : []),
      ...(flatFiles.length > 0 ? [
        '## 📑 Listado Completo de Archivos',
        '',
        `**Total: ${flatFiles.length} archivo${flatFiles.length === 1 ? '' : 's'}.**`,
        '',
        flatFiles.join('\n'),
        '',
      ] : []),
      '---',
      '',
      '_Generado con ❤️ por **Zeus-IA** — Tu asistente de desarrollo con IA._',
    ].join('\n');
  }, [currentPath]);

  const markdownContent = useMemo(() => {
    if (!schema) return '';
    return buildSchemaMarkdown(schema);
  }, [schema, buildSchemaMarkdown]);

  const handleCopySchema = useCallback(async () => {
    if (!markdownContent) return;
    try {
      // 1) Preferencia: API de Electron expuesta por el preload (funciona en la app empaquetada)
      const electronAPI = (typeof window !== 'undefined' && (window as any).electronAPI)
        ? (window as any).electronAPI
        : null;
      if (electronAPI?.clipboard?.writeText) {
        await electronAPI.clipboard.writeText(markdownContent);
      } else if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText && window.isSecureContext) {
        // 2) API moderna del navegador (solo en contextos seguros)
        await navigator.clipboard.writeText(markdownContent);
      } else {
        // 3) Fallback universal con textarea temporal + execCommand
        const textarea = document.createElement('textarea');
        textarea.value = markdownContent;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '0';
        textarea.setAttribute('readonly', '');
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (!ok) throw new Error('execCommand devolvió false');
      }
      setCopied(true);
      toast({
        title: 'Esquema copiado',
        description: 'El Markdown del esquema se ha copiado al portapapeles.',
      });
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast({
        title: 'No se pudo copiar',
        description: (err as Error)?.message || 'Error desconocido al copiar al portapapeles.',
        variant: 'destructive',
      });
    }
  }, [markdownContent, toast]);

  const handleDownloadSchema = useCallback(() => {
    if (!markdownContent) return;
    try {
      const projectName = schema?.name || currentPath.split('/').filter(Boolean).pop() || 'esquema';
      const safeName = projectName.replace(/[^a-zA-Z0-9_\-]/g, '_');
      const filename = `schema-${safeName}.md`;

      // Añadir BOM UTF-8 para asegurar correcta apertura en editores Windows
      const blob = new Blob(['﻿' + markdownContent], {
        type: 'text/markdown;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      // Liberar memoria tras un breve retraso para que el navegador procese la descarga
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast({
        title: 'Descarga iniciada',
        description: `Archivo "${filename}" listo para guardar.`,
      });
    } catch (err) {
      toast({
        title: 'No se pudo descargar',
        description: (err as Error)?.message || 'Error desconocido al generar el archivo.',
        variant: 'destructive',
      });
    }
  }, [markdownContent, schema, currentPath, toast]);

  const fetchSchema = async () => {
    setIsLoading(true);
    setError('');
    try {
      const url = currentPath
        ? `/api/ide-schema?path=${encodeURIComponent(currentPath)}`
        : '/api/ide-schema';

      const response = await fetch(url);
      const result: SchemaResponse = await response.json();

      if (response.ok && result.success) {
        setSchema(result.schema);
      } else {
        setError(result.error || 'Error al obtener el esquema');
      }
    } catch (err) {
      setError('Error de conexión: ' + (err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setSchema(null);
    setExpandedFolders(new Set());
    fetchSchema();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath, refreshTrigger]);

  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const getAllFolderPaths = useCallback((item: SchemaItem): string[] => {
    if (item.type !== 'directory') return [];
    const paths = [item.path];
    const filteredChildren = item.children?.filter(child => !EXCLUDED_FOLDERS.includes(child.name)) || [];
    filteredChildren.forEach(child => {
      paths.push(...getAllFolderPaths(child));
    });
    return paths;
  }, []);

  const expandAll = useCallback(() => {
    if (!schema) return;
    const allPaths = getAllFolderPaths(schema);
    setExpandedFolders(new Set(allPaths));
  }, [schema, getAllFolderPaths]);

  const collapseAll = useCallback(() => {
    setExpandedFolders(new Set());
  }, []);

  const filterChildren = (children?: SchemaItem[]) => {
    return children?.filter(child => !EXCLUDED_FOLDERS.includes(child.name)) || [];
  };

  const renderSchemaItem = (item: SchemaItem, level: number = 0) => {
    // Indentación base (24px) + 16px por nivel de profundidad
    const paddingLeft = level * 16 + 24;
    // Emoji que identifica el tipo de elemento (sustituye al icono lucide)
    const typeEmoji = item.type === 'directory' ? '📁' : item.type === 'error' ? '⚠️' : '📄';

    if (item.type === 'directory') {
      const isExpanded = expandedFolders.has(item.path);
      const filteredChildren = filterChildren(item.children);

      return (
        <div key={item.path}>
          <div
            className="flex items-center gap-2 py-1 hover:bg-card transition-colors cursor-pointer select-none"
            style={{ paddingLeft: `${paddingLeft}px` }}
            onClick={() => toggleFolder(item.path)}
          >
            {filteredChildren.length > 0 ? (
              isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/80" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/80" />
              )
            ) : (
              <span className="w-3.5" />
            )}
            <span className="text-sm text-foreground/70 font-medium">
              <span className="mr-1.5 text-base leading-none" aria-hidden="true">{typeEmoji}</span>
              {item.name}
            </span>
            {item.stats && (
              <span className="text-xs text-muted-foreground/80 ml-auto">
                {item.stats.dirCount} dirs, {item.stats.fileCount} files
              </span>
            )}
          </div>
          {isExpanded && filteredChildren.length > 0 && (
            <div>
              {filteredChildren.map(child => renderSchemaItem(child, level + 1))}
            </div>
          )}
        </div>
      );
    }

    if (item.type === 'file') {
      return (
        <div
          key={item.path}
          className="flex items-center gap-2 py-1 hover:bg-card transition-colors"
          style={{ paddingLeft: `${paddingLeft + 20}px` }}
        >
          <span className="w-3.5" />
          <span className="text-base leading-none" aria-hidden="true">{typeEmoji}</span>
          <span className="text-sm text-muted-foreground">{item.name}</span>
          {item.lines != null && (
            <span className="text-xs text-muted-foreground/60">
              {item.lines} lines
            </span>
          )}
          {item.size != null && (
            <span className="text-xs text-success ml-2">
              · {formatSize(item.size)}
            </span>
          )}
        </div>
      );
    }

    if (item.type === 'error') {
      return (
        <div
          key={item.path}
          className="flex items-center gap-2 py-1 bg-red-900/20"
          style={{ paddingLeft: `${paddingLeft + 20}px` }}
        >
          <span className="w-3.5" />
          <span className="text-sm text-destructive">
            <span className="mr-1.5 text-base leading-none" aria-hidden="true">{typeEmoji}</span>
            {item.name}
          </span>
          <span className="text-xs text-destructive">{item.error}</span>
        </div>
      );
    }

    return null;
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div className="flex flex-col h-full bg-transparent">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border/80 bg-transparent">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-foreground flex items-center gap-3">
              <FolderTree className="w-6 h-6 text-primary" />
              Esquema de Carpetas
            </h1>
            <span className="text-xs text-muted-foreground bg-card px-2 py-1 rounded-md border border-border/50">
              {currentPath || 'DATA_PATH (sin selección)'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopySchema}
              disabled={!schema}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary disabled:bg-card disabled:text-muted-foreground/60 text-foreground rounded-lg text-xs font-medium transition-colors shadow-sm"
              title="Copiar esquema al portapapeles en formato Markdown"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? '¡Copiado!' : 'Copiar esquema'}
            </button>
            <button
              onClick={handleDownloadSchema}
              disabled={!schema}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-success hover:bg-success disabled:bg-card disabled:text-muted-foreground/60 text-foreground rounded-lg text-xs font-medium transition-colors shadow-sm"
              title="Descargar esquema como archivo Markdown (.md)"
            >
              <Download className="w-3.5 h-3.5" />
              Descargar .md
            </button>
            <button
              onClick={expandAll}
              disabled={!schema}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-muted hover:bg-muted/80 disabled:bg-card disabled:text-muted-foreground/60 text-foreground rounded-lg text-xs font-medium transition-colors"
              title="Abrir todo"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              Abrir todo
            </button>
            <button
              onClick={collapseAll}
              disabled={!schema}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-muted hover:bg-muted/80 disabled:bg-card disabled:text-muted-foreground/60 text-foreground rounded-lg text-xs font-medium transition-colors"
              title="Cerrar todo"
            >
              <Minimize2 className="w-3.5 h-3.5" />
              Cerrar todo
            </button>
            <button
              onClick={fetchSchema}
              disabled={isLoading}
              className="flex items-center gap-2 px-3 py-1.5 bg-muted hover:bg-muted/80 disabled:bg-card text-foreground rounded-lg text-xs font-medium transition-colors"
            >
              {isLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              Actualizar
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {isLoading && !schema ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground/80">
            <Loader2 className="w-8 h-8 animate-spin mb-2 text-accent" />
            <p className="text-sm">Cargando esquema...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="px-4 py-2 bg-red-900/30 border border-red-800 rounded-lg text-sm text-destructive">
              {error}
            </div>
          </div>
        ) : schema ? (
          <div className="bg-card/40 backdrop-blur-sm border border-border/50 rounded-lg p-4">
            {renderSchemaItem(schema)}
          </div>
        ) : null}
      </div>
    </div>
  );
}
