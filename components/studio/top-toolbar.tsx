'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Separator } from '../ui/separator';
import { 
  Upload, 
  Save, 
  Undo, 
  Redo, 
  RefreshCw, 
  Monitor,
  Tablet,
  Smartphone,
  User,
  Loader2,
  Hash,
  LogOut,
  Download,
  Wifi,
  WifiOff,
  Database,
  Zap,
  Sparkles,
  Folder
} from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group';
import { Badge } from '../ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { useTranslation } from '../../contexts/translation-context';
import { useAuth } from '@/context/AuthContext';
import { getPocketBase } from '../../lib/pocketbase';

interface TopToolbarProps {
  selectedComponent: string | null;
  projectName?: string;
  projectType?: 'local' | 'database' | 'pocketbase' | 'github' | 'zeus';
  projectId?: string;
  onLoadProject: () => void | Promise<void>;
  onSaveChanges: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onReset: () => void;
  onApplyStylesToCode?: () => void;
  onViewModeChange?: (mode: 'desktop' | 'tablet' | 'mobile') => void;
  viewMode?: 'desktop' | 'tablet' | 'mobile';
  isSaving?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  hasUnsavedChanges?: boolean;
  currentPort?: string;
  onPortChange?: (port: string) => void;
  onDirectPortChange?: (port: string) => void;
  isTunnelConnected?: boolean;
  onConnectTunnel?: () => void;
  isConnectingTunnel?: boolean;

}

export function TopToolbar({
  selectedComponent,
  projectName,
  projectType,
  projectId,
  onLoadProject,
  onSaveChanges,
  onUndo,
  onRedo,
  onReset,
  onApplyStylesToCode,
  onViewModeChange,
  viewMode = 'desktop',
  isSaving = false,
  canUndo = false,
  canRedo = false,
  hasUnsavedChanges = false,
  currentPort = '3000',
  onPortChange,
  onDirectPortChange,
  isTunnelConnected = false,
  onConnectTunnel,
  isConnectingTunnel = false,

}: TopToolbarProps) {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const router = useRouter();

  // Debug user data
  React.useEffect(() => {
    if (user) {
      console.log('[TopToolbar] User data:', {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        hasAvatar: !!user.avatar
      });
    }
  }, [user]);

  const handleAccountClick = () => {
    if (user) {
      logout();
      router.push('/');
    } else {
      router.push('/auth');
    }
  };

  return (
    <div className="relative z-20 border-b bg-background border-border/50">
      <div className="relative flex h-16 items-center px-4">
        <Separator orientation="vertical" className="mx-4 h-8" />

        {/* Project Actions */}
        <div className="flex items-center space-x-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={onLoadProject}
                className="border-border/50 bg-card text-foreground/80 hover:bg-muted hover:text-foreground"
              >
                <Upload className="mr-2 h-4 w-4 text-success" />
                {t('loadProject')}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {t('loadProjectTooltip')}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={onSaveChanges}
                disabled={isSaving}
                className="relative border-border/50 bg-card text-foreground/80 hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    <span>Guardando...</span>
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4 text-warning" />
                    <span>{t('saveChanges')}</span>
                  </>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isSaving ? 'Guardando cambios...' : 'Guardar cambios del proyecto'}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={onApplyStylesToCode}
                className="border-border/50 bg-card text-foreground/80 hover:bg-muted hover:text-foreground"
              >
                <Sparkles className="mr-2 h-4 w-4 text-primary" />
                <span>{t('applyStylesToCode')}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {t('applyStylesToCodeTooltip')}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={onUndo}
                disabled={!canUndo}
                className={`border-border/50 bg-card text-foreground/80 hover:bg-muted hover:text-foreground ${!canUndo ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <Undo className="h-4 w-4 text-accent" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {canUndo ? 'Deshacer (Ctrl+Z)' : 'No hay cambios para deshacer'}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={onRedo}
                disabled={!canRedo}
                className={`border-border/50 bg-card text-foreground/80 hover:bg-muted hover:text-foreground ${!canRedo ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <Redo className="h-4 w-4 text-cyan-500" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {canRedo ? 'Rehacer (Ctrl+Y)' : 'No hay cambios para rehacer'}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={onReset}
                className="border-border/50 bg-card text-foreground/80 hover:bg-muted hover:text-foreground"
              >
                <RefreshCw className="h-4 w-4 text-orange-500" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reset All</TooltipContent>
          </Tooltip>
        </div>

        {/* Project Status Indicator */}
        {(projectName || projectType) && (
          <div className="flex items-center space-x-3 px-4">
            <div className="flex items-center space-x-2">
              {projectType === 'database' && (
                <Database className="h-4 w-4 text-primary" />
              )}
              {projectType === 'pocketbase' && (
                <Database className="h-4 w-4 text-primary" />
              )}
              {projectType === 'zeus' && (
                <Zap className="h-4 w-4 text-warning" />
              )}
              {(!projectType || projectType === 'local') && (
                <Folder className="h-4 w-4 text-success" />
              )}
              <div className="flex flex-col">
                <span className="text-sm font-medium text-foreground truncate max-w-[150px]">
                  {projectName || 'Proyecto'}
                </span>
                <span className="text-xs text-muted-foreground capitalize">
                  {projectType === 'database' && 'Base de Datos'}
                  {projectType === 'pocketbase' && 'PocketBase'}
                  {projectType === 'github' && 'GitHub'}
                  {projectType === 'zeus' && 'Zeus'}
                  {(!projectType || projectType === 'local') && 'Local'}
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="ml-auto flex items-center space-x-4">
          {/* View Mode Selector */}
          {onViewModeChange && (
            <div className="flex items-center space-x-2">
              <span className="text-sm text-muted-foreground">View:</span>
              <ToggleGroup type="single" value={viewMode} onValueChange={(value: string) => {
                if (value) onViewModeChange(value as 'desktop' | 'tablet' | 'mobile');
              }}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <ToggleGroupItem value="desktop" aria-label="Desktop view">
                      <Monitor className="h-4 w-4" />
                    </ToggleGroupItem>
                  </TooltipTrigger>
                  <TooltipContent>Desktop View</TooltipContent>
                </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <ToggleGroupItem value="tablet" aria-label="Tablet view">
                    <Tablet className="h-4 w-4" />
                  </ToggleGroupItem>
                </TooltipTrigger>
                <TooltipContent>Tablet View</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <ToggleGroupItem value="mobile" aria-label="Mobile view">
                    <Smartphone className="h-4 w-4" />
                  </ToggleGroupItem>
                </TooltipTrigger>
                <TooltipContent>Mobile View</TooltipContent>
              </Tooltip>
            </ToggleGroup>
          </div>
          )}


          {/* 🔥 NUEVO: Selector de tipo de componente */}
          {/* REMOVED - Moved to property editor panel */}



        </div>
      </div>
    </div>
  );
}
