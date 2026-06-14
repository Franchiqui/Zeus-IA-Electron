'use client';

import React, { memo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Folder,
  File,
  ChevronRight,
  ChevronDown,
  Search,
  Filter,
  Plus,
  Trash2,
  Edit2,
  Play,
  AlertCircle,
  CheckCircle,
  Clock,
  FolderOpen,
  FileText,
  Code,
  Database,
  Settings,
  Globe,
  Server,
  Network,
  Zap,
  Terminal,
  Layers,
  FolderTree
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface APIEndpoint {
  id: string;
  name: string;
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  category: 'management' | 'manipulation' | 'planning';
  description?: string;
  parameters?: APIParameter[];
  children?: APIEndpoint[];
}

interface APIParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'file' | 'array';
  required: boolean;
  description?: string;
}

interface SidebarProps {
  endpoints: APIEndpoint[];
  selectedEndpoint?: APIEndpoint;
  onSelectEndpoint: (endpoint: APIEndpoint) => void;
  onDoubleClickEndpoint?: (endpoint: APIEndpoint) => void;
  onReorderEndpoints?: (endpoints: APIEndpoint[]) => void;
  className?: string;
}

const methodColors = {
  GET:    'bg-green-600/25 text-green-300 border-green-500/50',
  POST:   'bg-blue-600/25 text-blue-300 border-blue-500/50',
  PUT:    'bg-yellow-600/25 text-yellow-300 border-yellow-500/50',
  DELETE: 'bg-red-600/25 text-red-300 border-red-500/50',
  PATCH:  'bg-purple-600/25 text-purple-300 border-purple-500/50'
};

const categoryIcons = {
  management: FolderTree,
  manipulation: Code,
  planning: Layers
};

const categoryLabels = {
  management: 'Gestión',
  manipulation: 'Manipulación',
  planning: 'Planificación'
};

const Sidebar = memo(function Sidebar({
  endpoints,
  selectedEndpoint,
  onSelectEndpoint,
  onDoubleClickEndpoint,
  onReorderEndpoints,
  className
}: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [filterMethod, setFilterMethod] = useState<string>('all');
  const [isDragging, setIsDragging] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const filteredEndpoints = useCallback(() => {
    let filtered = endpoints;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filterEndpointsByQuery(endpoints, query);
    }

    if (filterMethod !== 'all') {
      filtered = filterEndpointsByMethod(filtered, filterMethod);
    }

    return filtered;
  }, [endpoints, searchQuery, filterMethod]);

  const filterEndpointsByQuery = (items: APIEndpoint[], query: string): APIEndpoint[] => {
    return items.reduce<APIEndpoint[]>((acc, item) => {
      const matches = item.name.toLowerCase().includes(query) ||
                     item.path.toLowerCase().includes(query) ||
                     item.description?.toLowerCase().includes(query);

      const children = item.children ? filterEndpointsByQuery(item.children, query) : [];

      if (matches || children.length > 0) {
        acc.push({
          ...item,
          children: children.length > 0 ? children : item.children
        });
      }

      return acc;
    }, []);
  };

  const filterEndpointsByMethod = (items: APIEndpoint[], method: string): APIEndpoint[] => {
    return items.reduce<APIEndpoint[]>((acc, item) => {
      const matches = item.method === method;

      const children = item.children ? filterEndpointsByMethod(item.children, method) : [];

      if (matches || children.length > 0) {
        acc.push({
          ...item,
          children: children.length > 0 ? children : item.children
        });
      }

      return acc;
    }, []);
  };

  const toggleFolder = useCallback((folderId: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  const handleDragStart = useCallback((e: any, endpointId: string) => {
    const dragEvent = e as React.DragEvent<Element>;
    dragEvent.dataTransfer.setData('text/plain', endpointId);
    setIsDragging(endpointId);
    dragEvent.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e: any, endpointId: string) => {
    const dragEvent = e as React.DragEvent<Element>;
    dragEvent.preventDefault();
    dragEvent.dataTransfer.dropEffect = 'move';
    setDragOverId(endpointId);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverId(null);
  }, []);

  const handleDrop = useCallback((e: any, targetId: string) => {
    const dragEvent = e as React.DragEvent<Element>;
    dragEvent.preventDefault();
    const sourceId = dragEvent.dataTransfer.getData('text/plain');
    
    if (sourceId && sourceId !== targetId && onReorderEndpoints) {
      const reordered = reorderEndpoints(endpoints, sourceId, targetId);
      onReorderEndpoints(reordered);
    }
    
    setIsDragging(null);
    setDragOverId(null);
  }, [endpoints, onReorderEndpoints]);

  const reorderEndpoints = (
    items: APIEndpoint[],
    sourceId: string,
    targetId: string
  ): APIEndpoint[] => {
    const findAndRemove = (list: APIEndpoint[]): { item?: APIEndpoint; remaining: APIEndpoint[] } => {
      for (let i = 0; i < list.length; i++) {
        if (list[i].id === sourceId) {
          return { item: list[i], remaining: [...list.slice(0, i), ...list.slice(i + 1)] };
        }
        if (list[i].children) {
          const result = findAndRemove(list[i].children!);
          if (result.item) {
            return {
              item: result.item,
              remaining: [
                ...list.slice(0, i),
                { ...list[i], children: result.remaining },
                ...list.slice(i + 1)
              ]
            };
          }
        }
      }
      return { remaining: list };
    };

    const insertAt = (
      list: APIEndpoint[],
      item: APIEndpoint,
      targetId: string
    ): APIEndpoint[] => {
      for (let i = 0; i < list.length; i++) {
        if (list[i].id === targetId) {
          return [...list.slice(0, i), item, ...list.slice(i)];
        }
        if (list[i].children) {
          const newChildren = insertAt(list[i].children!, item, targetId);
          if (newChildren !== list[i].children) {
            return [
              ...list.slice(0, i),
              { ...list[i], children: newChildren },
              ...list.slice(i + 1)
            ];
          }
        }
      }
      return list;
    };

    const { item, remaining } = findAndRemove(items);
    if (!item) return items;

    return insertAt(remaining, item, targetId);
  };

  const renderEndpointIcon = useCallback((method: APIEndpoint['method']) => {
    switch (method) {
      case 'GET': return <Globe className="w-4 h-4" />;
      case 'POST': return <Plus className="w-4 h-4" />;
      case 'PUT': return <Edit2 className="w-4 h-4" />;
      case 'DELETE': return <Trash2 className="w-4 h-4" />;
      case 'PATCH': return <Terminal className="w-4 h-4" />;
      default: return <Server className="w-4 h-4" />;
    }
  }, []);

  const renderCategorySection = useCallback((category: keyof typeof categoryIcons, items: APIEndpoint[]) => {
    const Icon = categoryIcons[category];
    const hasItems = items.some(item => item.category === category);

    if (!hasItems) return null;

    return (
      <div className="mb-6">
        <div className="flex items-center gap-2 px-3 py-2 mb-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          <Icon className="w-4 h-4" />
          <span>{categoryLabels[category]}</span>
          <span className="ml-auto text-xs bg-card px-2 py-1 rounded-full">
            {items.filter(item => item.category === category).length}
          </span>
        </div>
        <div className="space-y-1">
          {items
            .filter(item => item.category === category)
            .map(item => renderEndpointItem(item))}
        </div>
      </div>
    );
  }, []);

  const renderEndpointItem = useCallback((endpoint: APIEndpoint, depth = 0) => {
    const isFolder = endpoint.children && endpoint.children.length > 0;
    const isExpanded = expandedFolders.has(endpoint.id);
    const isSelected = selectedEndpoint?.id === endpoint.id;
    const isDragOver = dragOverId === endpoint.id;

    const handleClick = () => {
      if (isFolder) {
        toggleFolder(endpoint.id);
      } else {
        onSelectEndpoint(endpoint);
      }
    };

    const handleDoubleClick = () => {
      if (!isFolder && onDoubleClickEndpoint) {
        onDoubleClickEndpoint(endpoint);
      }
    };

    return (
      <div key={endpoint.id}>
        <motion.div
          draggable={!!onReorderEndpoints}
          onDragStart={(e) => handleDragStart(e, endpoint.id)}
          onDragOver={(e) => handleDragOver(e, endpoint.id)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, endpoint.id)}
          initial={false}
          animate={{
            backgroundColor: isSelected ? '#1e40af20' : isDragOver ? '#3b82f620' : 'transparent',
            borderLeftColor: isSelected ? '#3b82f6' : 'transparent'
          }}
          className={cn(
            'group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors',
            'border-l-4 hover:bg-card/50',
            isDragging === endpoint.id && 'opacity-50',
            depth > 0 && `ml-${depth * 4}`
          )}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          role="treeitem"
          aria-selected={isSelected}
          aria-expanded={isFolder ? isExpanded : undefined}
        >
          {isFolder ? (
            <>
              {isExpanded ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              )}
              <Folder className="w-4 h-4 text-primary flex-shrink-0" />
            </>
          ) : (
            <>
              <div className="w-6 flex-shrink-0" />
              {renderEndpointIcon(endpoint.method)}
            </>
          )}

          <div className="flex-1 min-w-0" style={{ paddingLeft: depth * 16 }}>
          <span className="truncate font-medium text-foreground/90 group-hover:text-foreground">
            {endpoint.name}
          </span>
          {endpoint.description && (
            <span className="hidden lg:inline text-sm text-muted-foreground truncate ml-2">
              {endpoint.description}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 ml-auto flex-shrink-0">
          <span
            className={cn(
              'px-2 py-1 text-xs font-medium rounded border',
              methodColors[endpoint.method]
            )}
          >
            {endpoint.method}
          </span>

          {endpoint.parameters && endpoint.parameters.some(p => p.required) && (
            <span className="text-xs text-destructive" title="Parámetros requeridos">*</span>
          )}
        </div>
        </motion.div>

        <AnimatePresence>
          {isFolder && isExpanded && endpoint.children && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3 }}
            >
              {endpoint.children.map(child => renderEndpointItem(child, depth + 1))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }, [
    expandedFolders,
    selectedEndpoint,
    dragOverId,
    isDragging,
    toggleFolder,
    onSelectEndpoint,
    onDoubleClickEndpoint,
    renderEndpointIcon,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop
  ]);


  return (
    <aside
      className={cn(
        'flex flex-col h-full bg-background border-r border-border/80',
        'transition-all duration-300 ease-in-out',
        className
      )}
      aria-label="Explorador de endpoints de API"
    >
      {/* Header */}
      <div className="p-4 border-b border-border/80">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Network className="w-5 h-5" />
            API Explorer
          </h2>
          <button
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-card rounded-lg transition-colors"
            aria-label="Configuración"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar endpoints..."
            className="w-full pl-10 pr-4 py-2 bg-card rounded-lg border border-border/50 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
            aria-label="Buscar endpoints"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilterMethod('all')}
            className={cn(
              'px-3 py-1 text-xs rounded-lg transition-colors',
              filterMethod === 'all'
                ? 'bg-primary text-foreground'
                : 'bg-muted text-foreground/80 hover:bg-muted/80'
            )}
            aria-label="Mostrar todos los métodos"
          >
            Todos
          </button>
          {Object.keys(methodColors).map(method => (
            <button
              key={method}
              onClick={() => setFilterMethod(method)}
              className={cn(
                'px-3 py-1 text-xs rounded-lg transition-colors',
                filterMethod === method
                  ? methodColors[method as keyof typeof methodColors]
                  : cn(
                      methodColors[method as keyof typeof methodColors].split(' ')[0],
                      'opacity-50 hover:opacity-100'
                    )
              )}
              aria-label={`Filtrar por método ${method}`}
            >
              {method}
            </button>
          ))}
        </div>
      </div>

      {/* Endpoints List */}
      <div className="flex-1 overflow-y-auto">
        <nav
          className="p-4 space-y-4"
          role="tree"
          aria-label="Lista de endpoints"
        >
          {renderCategorySection('management', filteredEndpoints())}
          {renderCategorySection('manipulation', filteredEndpoints())}
          {renderCategorySection('planning', filteredEndpoints())}

          {filteredEndpoints().length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <Search className="w-12 h-12 mx-auto mb-4" />
              <p>No se encontraron endpoints</p>
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="mt-2 text-sm text-primary hover:underline"
                >
                  Limpiar búsqueda
                </button>
              )}
            </div>
          )}
        </nav>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-border/80 bg-background">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{filteredEndpoints().length} endpoints</span>
          <span className="flex items-center gap-2">
            <Zap className="w-4 h-4" />
            Conectado
          </span>
        </div>
      </div>
    </aside>
  );
});



