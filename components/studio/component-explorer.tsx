'use client';

import React, { useState } from 'react';
import { ScrollArea } from '../ui/scroll-area';
import { Input } from '../ui/input';
import { Search, Folder, File, Box, Type, Square, Circle, MousePointer } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Badge } from '../ui/badge';
import { useTranslation } from '../../contexts/translation-context';

interface ComponentNode {
  id: string;
  name: string;
  type: 'container' | 'button' | 'text' | 'image' | 'input' | 'custom';
  children?: ComponentNode[];
  selected?: boolean;
}

interface ComponentExplorerProps {
  components: ComponentNode[];
  selectedComponentId: string | null;
  onSelectComponent: (id: string) => void;
}

const typeIcons = {
  container: <Folder className="h-4 w-4 text-primary" />,
  button: <Square className="h-4 w-4 text-primary" />,
  text: <Type className="h-4 w-4 text-primary" />,
  image: <File className="h-4 w-4 text-primary" />,
  input: <Box className="h-4 w-4 text-primary" />,
  custom: <Circle className="h-4 w-4 text-primary" />,
};

function ComponentTreeNode({ 
  node, 
  depth = 0, 
  onSelect,
  selectedId 
}: { 
  node: ComponentNode; 
  depth: number; 
  onSelect: (id: string) => void;
  selectedId: string | null;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children && node.children.length > 0;

  return (
    <div>
      <div
        className={cn(
          "flex items-center px-3 py-2 text-sm rounded-md cursor-pointer transition-colors",
          "hover:bg-muted text-foreground/80",
          selectedId === node.id && "bg-primary/20 border-l-2 border-blue-500",
          depth > 0 && "ml-4"
        )}
        style={{ paddingLeft: `${depth * 20 + 12}px` }}
        onClick={() => onSelect(node.id)}
      >
        {hasChildren && (
          <button
            className="mr-1 h-4 w-4 flex items-center justify-center"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
          >
            <svg
              className={cn(
                "h-3 w-3 transition-transform",
                expanded && "rotate-90"
              )}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}
        {!hasChildren && <div className="w-4 mr-1" />}
        <span className="mr-2">{typeIcons[node.type]}</span>
        <span className="flex-1 truncate">{node.name}</span>
        <Badge variant="outline" className="text-xs font-mono">
          {node.type}
        </Badge>
      </div>
      {hasChildren && expanded && (
        <div>
          {node.children!.map((child) => (
            <ComponentTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              onSelect={onSelect}
              selectedId={selectedId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ComponentExplorer({ 
  components, 
  selectedComponentId, 
  onSelectComponent 
}: ComponentExplorerProps) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');

  // Debug: Log components when they change (only in development and when components change from empty to non-empty)
  React.useEffect(() => {
    if (process.env.NODE_ENV === 'development' && components.length > 0) {
      console.log('ComponentExplorer - Components loaded:', components.length, 'components');
    }
  }, [components]);

  const filteredComponents = searchQuery
    ? components.filter(comp => 
        comp.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        comp.type.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : components;

  // Always render, even if empty
  return (
    <div className="flex flex-col h-full w-full border-r bg-card overflow-hidden">
      <div className="p-4 border-b border-border/50 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground/80">{t('componentExplorer')}</h2>
          <div className="flex items-center text-sm text-muted-foreground">
            <MousePointer className="h-4 w-4 mr-1" />
            <span>{components.length} {t('components')}</span>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('searchComponents')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-muted border-border/40 text-foreground/80"
          />
        </div>
      </div>
      <ScrollArea className="flex-1 bg-card overflow-auto">
        <div className="p-2 min-h-full">
          {components.length === 0 ? (
            <div className="text-center py-12 px-4 text-muted-foreground">
              <Folder className="h-16 w-16 mx-auto mb-4 opacity-50 text-muted-foreground/60" />
              <p className="text-base font-semibold mb-2 text-foreground/70">{t('noComponentsFound')}</p>
              <p className="text-base text-success font-medium mb-4">
                {t('loadProjectInstructions')}
              </p>
              <p className="text-xs text-muted-foreground/60">
                {t('clickLoadProject')}
              </p>
            </div>
          ) : filteredComponents.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">{t('noComponentsFound')}</p>
              <p className="text-xs text-muted-foreground/80 mt-1">{t('tryAnotherSearch')}</p>
            </div>
          ) : (
            filteredComponents.map((component) => (
              <ComponentTreeNode
                key={component.id}
                node={component}
                depth={0}
                onSelect={onSelectComponent}
                selectedId={selectedComponentId}
              />
            ))
          )}
        </div>
      </ScrollArea>
      <div className="p-3 border-t border-border/50 text-xs text-muted-foreground bg-background">
        <div className="flex items-center justify-between">
          <span>{t('doubleClickToEdit')}</span>
          <span>{t('clickToSelect')}</span>
        </div>
      </div>
    </div>
  );
}
