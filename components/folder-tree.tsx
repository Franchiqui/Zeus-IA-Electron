'use client';

import React, { useState } from 'react';
import { ChevronRight, ChevronDown, Folder, File } from 'lucide-react';

interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children: boolean;
  missingInA?: boolean;
  missingInB?: boolean;
}

interface FolderTreeProps {
  structure: TreeNode[];
  title: string;
  missingLabel?: string;
  isFolderA?: boolean;
}

function TreeNodeComponent({ node, level = 0, allNodes, childNodes, isFolderA }: { node: TreeNode; level?: number; allNodes: TreeNode[]; childNodes?: TreeNode[]; isFolderA?: boolean }) {
  const [expanded, setExpanded] = useState(level < 2);

  const handleClick = () => {
    if (node.isDirectory) {
      setExpanded(!expanded);
    }
  };

  const isMissing = isFolderA ? node.missingInB : node.missingInA;
  const textColor = isMissing ? 'text-destructive' : 'text-foreground/70';
  const bgColor = isMissing ? 'bg-red-900/20' : 'hover:bg-muted/30';

  // Obtener hijos directos de este nodo
  const directChildren = childNodes || allNodes.filter(n => {
    const nodePathParts = node.path.split('/');
    const childPathParts = n.path.split('/');
    return childPathParts.length === nodePathParts.length + 1 && 
           childPathParts.slice(0, -1).join('/') === node.path;
  });

  return (
    <div>
      <div
        onClick={handleClick}
        className={`flex items-center gap-2 px-2 py-1 cursor-pointer ${bgColor} rounded transition-colors`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
      >
        {node.isDirectory ? (
          <>
            {directChildren.length > 0 ? (
              expanded ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              )
            ) : (
              <span className="w-4 h-4" />
            )}
            <Folder className={`w-4 h-4 ${isMissing ? 'text-destructive' : 'text-primary'}`} />
          </>
        ) : (
          <span className="w-4 h-4" />
        )}
        {!node.isDirectory && <File className={`w-4 h-4 ${isMissing ? 'text-destructive' : 'text-muted-foreground'}`} />}
        <span className={`text-sm font-mono ${textColor}`}>{node.name}</span>
        {isMissing && (
          <span className="text-xs text-destructive ml-2">(no existe en la otra carpeta)</span>
        )}
      </div>
      {expanded && directChildren.length > 0 && (
        <div>
          {directChildren.map(child => (
            <TreeNodeComponent 
              key={child.path} 
              node={child} 
              level={level + 1} 
              allNodes={allNodes}
              isFolderA={isFolderA}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function FolderTree({ structure, title, missingLabel, isFolderA }: FolderTreeProps) {
  console.log('FolderTree received structure length:', structure.length);
  console.log('FolderTree isFolderA:', isFolderA);
  console.log('FolderTree sample:', structure.slice(0, 3));

  // Obtener nodos raíz (sin padre)
  const rootNodes = structure.filter(node => {
    const parts = node.path.split('/');
    return parts.length === 1;
  });

  console.log('FolderTree rootNodes length:', rootNodes.length);

  return (
    <div className="bg-card/50 backdrop-blur-sm rounded-xl p-4 border border-border/50">
      <h3 className="font-medium text-primary mb-3">{title}</h3>
      {missingLabel && (
        <p className="text-sm text-destructive mb-3">{missingLabel}</p>
      )}
      <div className="space-y-1 max-h-96 overflow-y-auto scrollbar-thin scrollbar-transparent">
        {rootNodes.map(node => (
          <TreeNodeComponent key={node.path} node={node} allNodes={structure} isFolderA={isFolderA} />
        ))}
      </div>
      <style jsx>{`
        .scrollbar-thin::-webkit-scrollbar {
          width: 6px;
        }
        .scrollbar-thin::-webkit-scrollbar-track {
          background: transparent;
        }
        .scrollbar-thin::-webkit-scrollbar-thumb {
          background: rgba(156, 163, 175, 0.3);
          border-radius: 3px;
        }
        .scrollbar-thin::-webkit-scrollbar-thumb:hover {
          background: rgba(156, 163, 175, 0.5);
        }
      `}</style>
    </div>
  );
}
