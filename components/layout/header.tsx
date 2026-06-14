'use client';

import React, { memo, useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bars3Icon,
  XMarkIcon,
  Cog6ToothIcon,
  BellIcon,
  UserCircleIcon,
  ChevronDownIcon,
  CheckIcon,
  ArrowPathIcon,
  SignalIcon,
  SignalSlashIcon,
  CpuChipIcon,
} from '@heroicons/react/24/outline';
import { cn } from '@/lib/utils';
import pb from '@/lib/pocketbase';
import { MODELOS_COLLECTION_NAME, MODELOS_FIELDS, type ModeloRecord } from '@/lib/collections';
import { useStore } from '@/lib/store';

interface Environment {
  id: string;
  name: string;
  baseUrl: string;
  isActive: boolean;
}

interface Workspace {
  id: string;
  name: string;
  environments: Environment[];
}

interface HeaderProps {
  activeWorkspace?: Workspace;
  workspaces?: Workspace[];
  onWorkspaceChange?: (workspaceId: string) => void;
  onEnvironmentChange?: (environmentId: string) => void;
  onConnectionTest?: () => Promise<boolean>;
  className?: string;
}

const Header = memo(function Header({
  activeWorkspace,
  workspaces = [],
  onWorkspaceChange,
  onEnvironmentChange,
  onConnectionTest,
  className,
}: HeaderProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isWorkspaceDropdownOpen, setIsWorkspaceDropdownOpen] = useState(false);
  const [isEnvironmentDropdownOpen, setIsEnvironmentDropdownOpen] = useState(false);
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'testing'>('disconnected');
  const [customUrl, setCustomUrl] = useState('');
  const { models, selectedModel, setSelectedModel, isLoading: isLoadingModels } = useStore();

  const activeEnvironment = activeWorkspace?.environments.find(env => env.isActive);

  useEffect(() => {
    if (activeEnvironment?.baseUrl) {
      setCustomUrl(activeEnvironment.baseUrl);
    }
  }, [activeEnvironment]);

  
  const handleTestConnection = useCallback(async () => {
    if (!onConnectionTest) return;

    setConnectionStatus('testing');
    try {
      const isConnected = await onConnectionTest();
      setConnectionStatus(isConnected ? 'connected' : 'disconnected');
    } catch {
      setConnectionStatus('disconnected');
    }
  }, [onConnectionTest]);

  const handleWorkspaceSelect = useCallback((workspaceId: string) => {
    onWorkspaceChange?.(workspaceId);
    setIsWorkspaceDropdownOpen(false);
  }, [onWorkspaceChange]);

  const handleEnvironmentSelect = useCallback((environmentId: string) => {
    onEnvironmentChange?.(environmentId);
    setIsEnvironmentDropdownOpen(false);
  }, [onEnvironmentChange]);

  const handleModelSelect = useCallback((model: ModeloRecord) => {
    setSelectedModel(model);
    setIsModelDropdownOpen(false);
    // Persistir en localStorage o un store global si es necesario
  }, []);

  const handleCustomUrlSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (customUrl.trim() && activeEnvironment) {
      onEnvironmentChange?.(activeEnvironment.id);
    }
  }, [customUrl, activeEnvironment, onEnvironmentChange]);

  const ConnectionIndicator = useCallback(() => {
    const config = {
      connected: {
        icon: SignalIcon,
        color: 'text-success',
        bgColor: 'bg-success/10',
        label: 'Connected',
      },
      disconnected: {
        icon: SignalSlashIcon,
        color: 'text-rose-500',
        bgColor: 'bg-rose-500/10',
        label: 'Disconnected',
      },
      testing: {
        icon: ArrowPathIcon,
        color: 'text-amber-500',
        bgColor: 'bg-amber-500/10',
        label: 'Testing...',
      },
    };

    const { icon: Icon, color, bgColor, label } = config[connectionStatus];

    return (
      <div className="flex items-center gap-2">
        <Icon className={cn('w-4 h-4', color)} />
        <span className={cn('text-sm font-medium', color)}>{label}</span>
      </div>
    );
  }, [connectionStatus]);

  return (
    <header className={cn('sticky top-0 z-[100] w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60', className)}>
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo and App Name */}
          <div className="flex items-center">
            <button
              type="button"
              className="lg:hidden mr-3 p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-card"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              aria-label="Toggle mobile menu"
            >
              {isMobileMenuOpen ? (
                <XMarkIcon className="h-6 w-6" />
              ) : (
                <Bars3Icon className="h-6 w-6" />
              )}
            </button>

            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                <span className="text-foreground font-bold text-sm">AFC</span>
              </div>
              <div className="hidden sm:block">
                <h1 className="text-lg font-semibold text-foreground">Zeus IA</h1>
              </div>
            </div>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden lg:flex lg:items-center lg:gap-4">
            {/* AI Model Selector */}
            <div className="relative">
              <button
                type="button"
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-card hover:bg-muted text-foreground hover:text-foreground transition-colors"
                onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
                aria-expanded={isModelDropdownOpen}
              >
                <CpuChipIcon className="h-5 w-5 text-primary" />
                <span className="font-medium max-w-[150px] truncate">
                  {selectedModel ? selectedModel[MODELOS_FIELDS.NAME] : 'Select Model'}
                </span>
                <ChevronDownIcon className="h-4 w-4" />
              </button>

              <AnimatePresence>
                {isModelDropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="absolute right-0 mt-2 w-64 rounded-lg bg-card border border-border shadow-lg z-[70]"
                  >
                    <div className="p-2">
                      <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Available Models
                      </div>
                      <div className="max-h-64 overflow-y-auto custom-scrollbar">
                        {isLoadingModels ? (
                          <div className="px-3 py-4 text-center text-muted-foreground text-sm">
                            <ArrowPathIcon className="w-5 h-5 animate-spin mx-auto mb-2" />
                            Loading...
                          </div>
                        ) : models.length > 0 ? (
                          models.map(model => (
                            <button
                              key={model.id}
                              type="button"
                              className={cn(
                                'w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors',
                                model.id === selectedModel?.id
                                  ? 'bg-primary/20 text-primary'
                                  : 'text-foreground hover:bg-muted hover:text-foreground'
                              )}
                              onClick={() => handleModelSelect(model)}
                            >
                              <div className="flex flex-col items-start text-left">
                                <span className="font-medium">{model[MODELOS_FIELDS.NAME]}</span>
                                <span className="text-xs text-muted-foreground">
                                  {model[MODELOS_FIELDS.PROVIDER]} - {model[MODELOS_FIELDS.MODEL_NAME]}
                                </span>
                              </div>
                              {model.id === selectedModel?.id && (
                                <CheckIcon className="h-4 w-4 text-primary" />
                              )}
                            </button>
                          ))
                        ) : (
                          <div className="px-3 py-2 text-sm text-muted-foreground">No models found</div>
                        )}
                      </div>
                      <div className="border-t border-border mt-2 pt-2">
                        <button
                          type="button"
                          className="w-full px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors text-left"
                        >
                          + Manage Models
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Workspace Selector */}
            <div className="relative">
              <button
                type="button"
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary hover:text-primary transition-colors"
                onClick={() => setIsWorkspaceDropdownOpen(!isWorkspaceDropdownOpen)}
                aria-expanded={isWorkspaceDropdownOpen}
              >
                <UserCircleIcon className="h-5 w-5 text-primary" />
                <span className="font-medium max-w-[120px] truncate">{activeWorkspace?.name || 'Workspace'}</span>
                <ChevronDownIcon className="h-4 w-4 text-primary" />
              </button>

              <AnimatePresence>
                {isWorkspaceDropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="absolute right-0 mt-2 w-64 rounded-lg bg-card border border-border shadow-lg z-[70]"
                  >
                    <div className="p-2">
                      {workspaces.map(workspace => (
                        <button
                          key={workspace.id}
                          type="button"
                          className={cn(
                            'w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors',
                            workspace.id === activeWorkspace?.id
                              ? 'bg-primary/20 text-primary'
                              : 'text-foreground hover:bg-muted hover:text-foreground'
                          )}
                          onClick={() => handleWorkspaceSelect(workspace.id)}
                        >
                          <span>{workspace.name}</span>
                          {workspace.id === activeWorkspace?.id && (
                            <CheckIcon className="h-4 w-4 text-primary" />
                          )}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Environment Selector */}
            <div className="relative">
              <button
                type="button"
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-card hover:bg-muted text-foreground hover:text-foreground transition-colors"
                onClick={() => setIsEnvironmentDropdownOpen(!isEnvironmentDropdownOpen)}
                aria-expanded={isEnvironmentDropdownOpen}
              >
                <Cog6ToothIcon className="h-5 w-5" />
                <span className="font-medium max-w-[120px] truncate">{activeEnvironment?.name || 'Environment'}</span>
                <ChevronDownIcon className="h-4 w-4" />
              </button>

              <AnimatePresence>
                {isEnvironmentDropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="absolute right-0 mt-2 w-80 rounded-lg bg-card border border-border shadow-lg z-[70]"
                  >
                    <div className="p-4">
                      <form onSubmit={handleCustomUrlSubmit} className="mb-4">
                        <label htmlFor="custom-url" className="block text-sm font-medium text-foreground mb-2">
                          Custom API URL
                        </label>
                        <div className="flex gap-2">
                          <input
                            id="custom-url"
                            type="url"
                            value={customUrl}
                            onChange={(e) => setCustomUrl(e.target.value)}
                            placeholder="https://api.example.com"
                            className="flex-1 px-3 py-2 bg-background border border-border rounded-md text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                          />
                          <button
                            type="submit"
                            className="px-4 py-2 bg-primary text-foreground rounded-md hover:bg-primary/80 transition-colors text-sm font-medium"
                          >
                            Apply
                          </button>
                        </div>
                      </form>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Connection Status */}
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={connectionStatus === 'testing'}
              className="flex items-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Test connection"
            >
              <ConnectionIndicator />
            </button>

            {/* Notifications */}
            <button
              type="button"
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-card transition-colors relative"
              aria-label="Notifications"
            >
              <BellIcon className="h-6 w-6" />
              <span className="absolute top-1 right-1 h-2 w-2 bg-destructive rounded-full" />
            </button>

            {/* User Menu */}
            <button
              type="button"
              className="p-1 rounded-full hover:bg-card transition-colors"
              aria-label="User menu"
            >
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                <span className="text-foreground font-medium text-sm">DEV</span>
              </div>
            </button>
          </div>

          {/* Mobile menu button */}
          <div className="flex lg:hidden items-center gap-4">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={connectionStatus === 'testing'}
              className="p-2 disabled:opacity-50"
            >
              <ConnectionIndicator />
            </button>
            <button
              type="button"
              className="lg:hidden p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-card"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            >
              {isMobileMenuOpen ? (
                <XMarkIcon className="h-6 w-6" />
              ) : (
                <Bars3Icon className="h-6 w-6" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="lg:hidden border-t border-border bg-background"
          >
            <div className="px-4 py-4 space-y-4">
              {/* AI Model Selection */}
              <div>
                <label htmlFor="mobile-model" className="block text-sm font-medium text-foreground mb-2">
                  AI Model
                </label>
                <select
                  id="mobile-model"
                  value={selectedModel?.id || ''}
                  onChange={(e) => {
                    const model = models.find(m => m.id === e.target.value);
                    if (model) handleModelSelect(model);
                  }}
                  className="w-full px-3 py-2 bg-card border border-border rounded-md text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="" disabled>Select Model</option>
                  {models.map(model => (
                    <option key={model.id} value={model.id}>
                      {model[MODELOS_FIELDS.NAME]} ({model[MODELOS_FIELDS.PROVIDER]})
                    </option>
                  ))}
                </select>
              </div>

              {/* Workspace Selection */}
              <div>
                <label htmlFor="mobile-workspace" className="block text-sm font-medium text-foreground mb-2">
                  Workspace
                </label>
                <select
                  id="mobile-workspace"
                  value={activeWorkspace?.id || ''}
                  onChange={(e) => handleWorkspaceSelect(e.target.value)}
                  className="w-full px-3 py-2 bg-card border border-border rounded-md text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="" disabled>Select Workspace</option>
                  {workspaces.map(workspace => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Custom URL Input */}
              <form onSubmit={handleCustomUrlSubmit}>
                <label htmlFor="mobile-custom-url" className="block text-sm font-medium text-foreground mb-2">
                  Custom API URL
                </label>
                <div className="flex gap-2">
                  <input
                    id="mobile-custom-url"
                    type="url"
                    value={customUrl}
                    onChange={(e) => setCustomUrl(e.target.value)}
                    placeholder="https://api.example.com"
                    className="flex-1 px-3 py-2 bg-card border border-border rounded-md text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 bg-primary text-foreground rounded-md hover:bg-primary/80 transition-colors text-sm font-medium"
                  >
                    Apply
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
});

export default Header;