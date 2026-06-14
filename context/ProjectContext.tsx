'use client';

import React, { createContext, useContext, ReactNode } from 'react';
import { useTabState } from '@/lib/tab-state';

interface ProjectContextType {
  projectRoot: string | null;
  projectId: string | null;
  files: Record<string, string>;
  setProjectRoot: (root: string | null) => void;
  setProjectId: (id: string | null) => void;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

interface ProjectProviderProps {
  children: ReactNode;
  projectRoot?: string | null;
  projectId?: string | null;
  files?: Record<string, string>;
  onSetProjectRoot?: (root: string | null) => void;
  onSetProjectId?: (id: string | null) => void;
  activeTabId?: string;
}

export function ProjectProvider({ children, projectRoot: externalRoot, projectId: externalId, files: externalFiles, onSetProjectRoot, onSetProjectId, activeTabId = 'default' }: ProjectProviderProps) {
  const [internalRoot, setInternalRoot] = useTabState<string | null>(activeTabId, 'projectInternalRoot', null);
  const [internalId, setInternalId] = useTabState<string | null>(activeTabId, 'projectInternalId', null);
  const [internalFiles, setInternalFiles] = useTabState<Record<string, string>>(activeTabId, 'projectFiles', {});

  const projectRoot = externalRoot !== undefined ? externalRoot : internalRoot;
  const projectId = externalId !== undefined ? externalId : internalId;
  const files = externalFiles !== undefined ? externalFiles : internalFiles;

  const setProjectRoot = (root: string | null) => {
    if (onSetProjectRoot) onSetProjectRoot(root);
    setInternalRoot(root);
  };
  const setProjectId = (id: string | null) => {
    if (onSetProjectId) onSetProjectId(id);
    setInternalId(id);
  };

  return (
    <ProjectContext.Provider value={{ projectRoot, projectId, files, setProjectRoot, setProjectId }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  const context = useContext(ProjectContext);
  if (context === undefined) {
    return {
      projectRoot: null,
      projectId: null,
      files: {},
      setProjectRoot: () => {},
      setProjectId: () => {}
    };
  }
  return context;
}
