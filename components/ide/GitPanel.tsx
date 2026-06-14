'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import {
  GitBranch,
  GitCommit,
  GitPullRequest,
  GitMerge,
  RotateCcw,
  ArrowUp,
  ArrowDown,
  Plus,
  Check,
  CheckSquare,
  Square,
  FileText,
  FilePlus,
  FileMinus,
  Edit3,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Loader2,
  AlertCircle,
  Terminal,
  User,
  FolderOpen,
} from 'lucide-react';
import { GitHubSvg } from '@/components/ui/github-icon';
import GitHubModal from './GitHubModal';

interface GitFile {
  path: string;
  originalPath?: string | null;
  status: string;
  staged: boolean;
  indexStatus: string;
  worktreeStatus: string;
}

interface GitCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
  email: string;
}

interface GitStatus {
  isRepo: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: GitFile[];
  user: { name: string; email: string };
}

interface GitPanelProps {
  projectPath: string;
  isOpen: boolean;
  onSetExplorerPath?: (path: string) => void;
}

export default function GitPanel({ projectPath, isOpen, onSetExplorerPath }: GitPanelProps) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [branches, setBranches] = useState<{ current: string; branches: string[] }>({ current: '', branches: [] });
  const [commitMessage, setCommitMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRepo, setIsRepo] = useState<boolean | null>(null);
  const [selectedUnstaged, setSelectedUnstaged] = useState<Set<string>>(new Set());
  const [selectedStaged, setSelectedStaged] = useState<Set<string>>(new Set());
  const [showHistory, setShowHistory] = useState(true);
  const [showBranches, setShowBranches] = useState(false);
  const [isGitHubModalOpen, setIsGitHubModalOpen] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [diffFile, setDiffFile] = useState<{ path: string; diff: string; staged: boolean } | null>(null);
  const [gitRoot, setGitRoot] = useState<string | null>(null);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Evitar que el explorador entre en la carpeta .git como projectPath
  const safeProjectPath = projectPath ? projectPath.replace(/[/\\]\.git$/i, '') : projectPath;
  const effectivePath = gitRoot || safeProjectPath;

  const fetchWithTimeout = useCallback(async (url: string, opts?: RequestInit, timeout = 8000) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { ...opts, signal: controller.signal });
      clearTimeout(id);
      return res;
    } catch (err: any) {
      clearTimeout(id);
      if (err.name === 'AbortError') throw new Error('La petición tardó demasiado');
      throw err;
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    if (!effectivePath) return;
    try {
      const res = await fetchWithTimeout(`/api/git/status?path=${encodeURIComponent(effectivePath)}`);
      const data = await res.json();
      if (res.ok) {
        setStatus(data);
        setIsRepo(data.isRepo);
        setError(null);
      } else {
        setError(data.error || 'Error obteniendo estado de git');
        if (isRepo === null) setIsRepo(false);
      }
    } catch (e: any) {
      setError(e.message || 'Error de red');
      if (isRepo === null) setIsRepo(false);
    }
  }, [effectivePath, isRepo, fetchWithTimeout]);

  const fetchLog = useCallback(async () => {
    if (!effectivePath) return;
    try {
      const res = await fetchWithTimeout(`/api/git/log?path=${encodeURIComponent(effectivePath)}&limit=30`);
      const data = await res.json();
      if (res.ok) setCommits(data.commits || []);
    } catch { /* ignorar */ }
  }, [effectivePath, fetchWithTimeout]);

  const fetchBranches = useCallback(async () => {
    if (!effectivePath) return;
    try {
      const res = await fetchWithTimeout(`/api/git/branches?path=${encodeURIComponent(effectivePath)}`);
      const data = await res.json();
      if (res.ok) setBranches({ current: data.current, branches: data.branches || [] });
    } catch { /* ignorar */ }
  }, [effectivePath, fetchWithTimeout]);

  const checkRepo = useCallback(async () => {
    if (!safeProjectPath) { 
      setIsRepo(false); 
      setGitRoot(null);
      return; 
    }
    try {
      const res = await fetchWithTimeout(`/api/git/is-repo?path=${encodeURIComponent(safeProjectPath)}`);
      const data = await res.json();
      setIsRepo(data.isRepo);
      if (data.isRepo && data.gitRoot && data.gitRoot !== safeProjectPath) {
        setGitRoot(data.gitRoot);
      } else {
        setGitRoot(null);
      }
    } catch (e: any) {
      setIsRepo(false);
      setGitRoot(null);
      setError(e.message || 'No se pudo verificar el repositorio');
    }
  }, [safeProjectPath, fetchWithTimeout]);

  // Auto-refresh cada 5s cuando está abierto
  useEffect(() => {
    if (!isOpen || !effectivePath) return;
    checkRepo();
    fetchStatus();
    fetchLog();
    fetchBranches();

    intervalRef.current = setInterval(() => {
      fetchStatus();
    }, 5000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isOpen, effectivePath, checkRepo, fetchStatus, fetchLog, fetchBranches]);

  // Escuchar el evento `zeus:git-local-updated` que dispara el GitHubModal
  // cuando crea/vincula/actualiza un repo, para refrescar el panel inmediatamente
  // en vez de esperar al intervalo de 5s.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ path: string; source: string }>).detail;
      // Solo refrescar si el path del evento coincide con el proyecto actual
      if (detail?.path && safeProjectPath && detail.path !== safeProjectPath) {
        return;
      }
      console.log('[GitPanel] git-local-updated event → refresh');
      checkRepo();
      fetchStatus();
      fetchLog();
      fetchBranches();
    };
    window.addEventListener('zeus:git-local-updated', handler);
    return () => window.removeEventListener('zeus:git-local-updated', handler);
  }, [safeProjectPath, checkRepo, fetchStatus, fetchLog, fetchBranches]);

  const runAction = async (action: string, body: any, onSuccess?: () => void) => {
    setActionLoading(action);
    setError(null);
    try {
      const res = await fetch(`/api/git/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Error en ${action}`);
      onSuccess?.();
      await fetchStatus();
      if (['commit', 'checkout', 'branch', 'pull', 'push'].includes(action)) {
        await fetchLog();
        await fetchBranches();
      }
    } catch (e: any) {
      setError(e.message || `Error ejecutando ${action}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleStage = async (files: string[]) => {
    await runAction('add', { path: effectivePath, files });
    setSelectedUnstaged(prev => {
      const next = new Set(prev);
      files.forEach(f => next.delete(f));
      return next;
    });
  };

  const handleUnstage = async (files: string[]) => {
    await runAction('unstage', { path: effectivePath, files });
    setSelectedStaged(prev => {
      const next = new Set(prev);
      files.forEach(f => next.delete(f));
      return next;
    });
  };

  const handleCommit = async () => {
    if (!commitMessage.trim()) return;
    await runAction('commit', { path: effectivePath, message: commitMessage.trim() }, () => setCommitMessage(''));
  };

  const handlePush = async () => {
    await runAction('push', { path: effectivePath, branch: status?.branch || 'HEAD' });
  };

  const handlePull = async () => {
    await runAction('pull', { path: effectivePath });
  };

  const handleCheckout = async (branch: string) => {
    await runAction('checkout', { path: effectivePath, branch });
  };

  const handleCreateBranch = async () => {
    if (!newBranchName.trim()) return;
    await runAction('branch', { path: effectivePath, name: newBranchName.trim() }, () => setNewBranchName(''));
  };

  const handleInit = async () => {
    await runAction('init', { path: safeProjectPath });
    await checkRepo();
  };

  const handleSetConfig = async (name: string, email: string) => {
    await runAction('config', { path: effectivePath, name, email });
  };

  const toggleUnstaged = (filePath: string) => {
    setSelectedUnstaged(prev => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath); else next.add(filePath);
      return next;
    });
  };

  const toggleStaged = (filePath: string) => {
    setSelectedStaged(prev => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath); else next.add(filePath);
      return next;
    });
  };

  const selectAllUnstaged = () => {
    const all = (status?.files || []).filter(f => !f.staged).map(f => f.path);
    setSelectedUnstaged(new Set(all));
  };

  const selectAllStaged = () => {
    const all = (status?.files || []).filter(f => f.staged).map(f => f.path);
    setSelectedStaged(new Set(all));
  };

  const clearAllUnstaged = () => setSelectedUnstaged(new Set());
  const clearAllStaged = () => setSelectedStaged(new Set());

  const loadDiff = async (filePath: string, staged: boolean) => {
    try {
      const res = await fetch(`/api/git/diff?path=${encodeURIComponent(effectivePath)}&file=${encodeURIComponent(filePath)}&staged=${staged}`);
      const data = await res.json();
      if (res.ok) {
        setDiffFile({ path: filePath, diff: data.diff, staged });
      }
    } catch (e: any) {
      setError(e.message);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'added': return <FilePlus className="w-3.5 h-3.5 text-green-400" />;
      case 'deleted': return <FileMinus className="w-3.5 h-3.5 text-destructive" />;
      case 'renamed': return <Edit3 className="w-3.5 h-3.5 text-accent" />;
      case 'untracked': return <FileText className="w-3.5 h-3.5 text-muted-foreground" />;
      default: return <FileText className="w-3.5 h-3.5 text-amber-400" />;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'added': return 'Añadido';
      case 'deleted': return 'Eliminado';
      case 'renamed': return 'Renombrado';
      case 'untracked': return 'Nuevo';
      default: return 'Modificado';
    }
  };

  if (!isOpen) return null;

  // Estado de carga inicial
  if (isRepo === null) {
    return (
      <>
        <div className="flex flex-col h-full bg-background border-r border-border/80 w-full">
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground/80 px-4 text-center">
            {!projectPath ? (
              <>
                <FolderOpen className="w-8 h-8 mb-2 text-muted-foreground/60" />
                <span className="text-sm">Selecciona una carpeta en el explorador</span>
              </>
            ) : (
              <>
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                <span className="text-sm">Verificando repositorio...</span>
              </>
            )}
          </div>
        </div>
        <GitHubModal
          isOpen={isGitHubModalOpen}
          onClose={() => setIsGitHubModalOpen(false)}
          projectPath={projectPath}
          onCloneSuccess={onSetExplorerPath}
        />
      </>
    );
  }

  // No es repo git
  if (isRepo === false) {
    return (
      <div className="flex flex-col h-full bg-background border-r border-border/80 w-full overflow-y-auto">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border/80 bg-background/80">
          <GitBranch className="w-4 h-4 text-accent" />
          <span className="text-sm font-semibold text-foreground/80">Git</span>
        </div>
        <div className="flex flex-col items-center justify-center p-6 text-center">
          <GitBranch className="w-12 h-12 text-muted-foreground/60 mb-3" />
          <p className="text-sm text-muted-foreground mb-4">Este proyecto no tiene un repositorio Git.</p>
          <button
            onClick={handleInit}
            disabled={actionLoading === 'init'}
            className="px-4 py-2 bg-accent hover:bg-purple-700 text-foreground text-sm rounded-md transition-colors flex items-center gap-2"
          >
            {actionLoading === 'init' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Inicializar repositorio
          </button>
        </div>
      </div>
    );
  }

  const unstagedFiles = status?.files.filter(f => !f.staged) || [];
  const stagedFiles = status?.files.filter(f => f.staged) || [];
  const hasStaged = stagedFiles.length > 0;
  const hasUnstaged = unstagedFiles.length > 0;

  return (
    <>
    <div className="flex flex-col h-full bg-background border-r border-border/80 w-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/80 bg-background/80 shrink-0">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-accent" />
          <span className="text-sm font-semibold text-foreground/80">{status?.branch || '—'}</span>
          {(status?.ahead || 0) > 0 && (
            <span className="flex items-center text-[10px] text-primary bg-blue-400/10 px-1.5 py-0.5 rounded">
              <ArrowUp className="w-3 h-3 mr-0.5" />{status!.ahead}
            </span>
          )}
          {(status?.behind || 0) > 0 && (
            <span className="flex items-center text-[10px] text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">
              <ArrowDown className="w-3 h-3 mr-0.5" />{status!.behind}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handlePull}
            disabled={!!actionLoading}
            title="Pull"
            className="p-1.5 rounded hover:bg-card text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <GitPullRequest className="w-4 h-4" />
          </button>
          <button
            onClick={handlePush}
            disabled={!!actionLoading || !status?.upstream}
            title="Push"
            className="p-1.5 rounded hover:bg-card text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <GitMerge className="w-4 h-4" />
          </button>
          <button
            onClick={fetchStatus}
            disabled={!!actionLoading}
            title="Refrescar"
            className="p-1.5 rounded hover:bg-card text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("w-4 h-4", actionLoading && "animate-spin")} />
          </button>
          <button
            onClick={() => setIsGitHubModalOpen(true)}
            title="GitHub"
            className="p-1.5 rounded hover:bg-card text-muted-foreground hover:text-green-400 transition-colors"
          >
            <GitHubSvg className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="shrink-0 mx-3 mt-2 p-2 bg-red-900/20 border border-red-800/50 rounded text-destructive text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-destructive hover:text-red-300">✕</button>
        </div>
      )}

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto space-y-3 p-3">
        {/* Changes Section */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cambios</h3>

          {/* Staged */}
          {stagedFiles.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium text-green-400 uppercase">Staged ({stagedFiles.length})</span>
                <div className="flex items-center gap-1">
                  <button onClick={selectAllStaged} className="text-[10px] text-muted-foreground/80 hover:text-foreground/70">Todos</button>
                  <button onClick={clearAllStaged} className="text-[10px] text-muted-foreground/80 hover:text-foreground/70">Ninguno</button>
                </div>
              </div>
              <div className="space-y-0.5">
                {stagedFiles.map(file => (
                  <div
                    key={file.path}
                    className="flex items-center gap-2 px-2 py-1.5 rounded bg-green-500/5 border border-green-500/10 hover:bg-green-500/10 transition-colors cursor-pointer group"
                    onClick={() => toggleStaged(file.path)}
                  >
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleStaged(file.path); }}
                      className="shrink-0"
                    >
                      {selectedStaged.has(file.path) ? <CheckSquare className="w-3.5 h-3.5 text-green-400" /> : <Square className="w-3.5 h-3.5 text-muted-foreground/80" />}
                    </button>
                    <span className="shrink-0">{getStatusIcon(file.status)}</span>
                    <span className="text-xs text-foreground/70 truncate flex-1">{file.path}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); loadDiff(file.path, true); }}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground/80 hover:text-foreground/70 text-[10px]"
                      title="Ver diff"
                    >
                      Diff
                    </button>
                  </div>
                ))}
              </div>
              {selectedStaged.size > 0 && (
                <button
                  onClick={() => handleUnstage(Array.from(selectedStaged))}
                  disabled={actionLoading === 'unstage'}
                  className="w-full py-1 text-[10px] text-amber-400 border border-amber-400/30 rounded hover:bg-amber-400/10 transition-colors"
                >
                  {actionLoading === 'unstage' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : `Unstage ${selectedStaged.size} archivo(s)`}
                </button>
              )}
            </div>
          )}

          {/* Unstaged */}
          {unstagedFiles.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium text-amber-400 uppercase">Sin stage ({unstagedFiles.length})</span>
                <div className="flex items-center gap-1">
                  <button onClick={selectAllUnstaged} className="text-[10px] text-muted-foreground/80 hover:text-foreground/70">Todos</button>
                  <button onClick={clearAllUnstaged} className="text-[10px] text-muted-foreground/80 hover:text-foreground/70">Ninguno</button>
                </div>
              </div>
              <div className="space-y-0.5">
                {unstagedFiles.map(file => (
                  <div
                    key={file.path}
                    className="flex items-center gap-2 px-2 py-1.5 rounded bg-amber-500/5 border border-amber-500/10 hover:bg-amber-500/10 transition-colors cursor-pointer group"
                    onClick={() => toggleUnstaged(file.path)}
                  >
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleUnstaged(file.path); }}
                      className="shrink-0"
                    >
                      {selectedUnstaged.has(file.path) ? <CheckSquare className="w-3.5 h-3.5 text-amber-400" /> : <Square className="w-3.5 h-3.5 text-muted-foreground/80" />}
                    </button>
                    <span className="shrink-0">{getStatusIcon(file.status)}</span>
                    <span className="text-xs text-foreground/70 truncate flex-1">{file.path}</span>
                    <span className="text-[10px] text-muted-foreground/80 shrink-0">{getStatusLabel(file.status)}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); loadDiff(file.path, false); }}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground/80 hover:text-foreground/70 text-[10px]"
                      title="Ver diff"
                    >
                      Diff
                    </button>
                  </div>
                ))}
              </div>
              {selectedUnstaged.size > 0 && (
                <button
                  onClick={() => handleStage(Array.from(selectedUnstaged))}
                  disabled={actionLoading === 'add'}
                  className="w-full py-1 text-[10px] text-green-400 border border-green-400/30 rounded hover:bg-green-400/10 transition-colors"
                >
                  {actionLoading === 'add' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : `Stage ${selectedUnstaged.size} archivo(s)`}
                </button>
              )}
            </div>
          )}

          {/* Sin cambios */}
          {!hasStaged && !hasUnstaged && (
            <div className="text-center py-4 text-muted-foreground/80 text-xs">
              <Check className="w-5 h-5 mx-auto mb-1 text-green-500" />
              No hay cambios pendientes
            </div>
          )}
        </div>

        {/* Commit */}
        {(hasStaged || stagedFiles.length > 0) && (
          <div className="space-y-2">
            <input
              type="text"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder="Mensaje de commit..."
              className="w-full px-3 py-2 text-xs bg-card border border-border/50 rounded text-foreground/80 placeholder-muted-foreground/80 focus:outline-none focus:border-purple-500"
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleCommit(); } }}
            />
            <button
              onClick={handleCommit}
              disabled={!commitMessage.trim() || actionLoading === 'commit'}
              className="w-full py-1.5 bg-accent hover:bg-purple-700 disabled:bg-muted disabled:text-muted-foreground/80 text-foreground text-xs rounded transition-colors flex items-center justify-center gap-1.5"
            >
              {actionLoading === 'commit' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitCommit className="w-3.5 h-3.5" />}
              Commit
            </button>
          </div>
        )}

        {/* Git config mini-form if missing */}
        {status?.isRepo && !status?.user?.name && (
          <div className="p-2 bg-card/50 border border-border/50 rounded space-y-2">
            <div className="flex items-center gap-1.5 text-[10px] text-amber-400">
              <AlertCircle className="w-3 h-3" />
              Configura tu identidad de Git para poder commitear
            </div>
            <input
              type="text"
              placeholder="Nombre"
              id="git-config-name"
              className="w-full px-2 py-1 text-xs bg-background border border-border/50 rounded text-foreground/80 placeholder-muted-foreground/80 focus:outline-none focus:border-purple-500"
            />
            <input
              type="email"
              placeholder="Email"
              id="git-config-email"
              className="w-full px-2 py-1 text-xs bg-background border border-border/50 rounded text-foreground/80 placeholder-muted-foreground/80 focus:outline-none focus:border-purple-500"
            />
            <button
              onClick={() => {
                const name = (document.getElementById('git-config-name') as HTMLInputElement)?.value;
                const email = (document.getElementById('git-config-email') as HTMLInputElement)?.value;
                if (name && email) handleSetConfig(name, email);
              }}
              className="w-full py-1 bg-muted hover:bg-muted/80 text-foreground/80 text-[10px] rounded transition-colors"
            >
              Guardar configuración
            </button>
          </div>
        )}

        {/* Diff viewer (inline) */}
        {diffFile && (
          <div className="border border-border/50 rounded overflow-hidden">
            <div className="flex items-center justify-between px-2 py-1 bg-card border-b border-border/50">
              <span className="text-[10px] text-foreground/70 truncate">{diffFile.path} ({diffFile.staged ? 'staged' : 'unstaged'})</span>
              <button onClick={() => setDiffFile(null)} className="text-muted-foreground/80 hover:text-foreground/70">✕</button>
            </div>
            <pre className="p-2 text-[10px] text-foreground/70 overflow-auto max-h-48 font-mono whitespace-pre-wrap">{diffFile.diff || 'Sin cambios'}</pre>
          </div>
        )}

        {/* History */}
        <div className="space-y-2">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground/70 transition-colors"
          >
            {showHistory ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            Historial ({commits.length})
          </button>
          {showHistory && (
            <div className="space-y-1">
              {commits.map((commit) => (
                <div key={commit.hash} className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-card/50 transition-colors">
                  <GitCommit className="w-3.5 h-3.5 text-muted-foreground/80 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground/70 truncate">{commit.message}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] font-mono text-accent">{commit.shortHash}</span>
                      <span className="text-[10px] text-muted-foreground/80">{commit.author}</span>
                      <span className="text-[10px] text-muted-foreground/60">{commit.date}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Branches */}
        <div className="space-y-2">
          <button
            onClick={() => setShowBranches(!showBranches)}
            className="flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground/70 transition-colors"
          >
            {showBranches ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            Ramas ({branches.branches.length})
          </button>
          {showBranches && (
            <div className="space-y-2">
              <div className="flex gap-1">
                <input
                  type="text"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  placeholder="Nueva rama..."
                  className="flex-1 px-2 py-1 text-xs bg-card border border-border/50 rounded text-foreground/80 placeholder-muted-foreground/80 focus:outline-none focus:border-purple-500"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreateBranch(); }}
                />
                <button
                  onClick={handleCreateBranch}
                  disabled={!newBranchName.trim() || actionLoading === 'branch'}
                  className="px-2 py-1 bg-muted hover:bg-muted/80 text-foreground/80 text-xs rounded transition-colors"
                >
                  {actionLoading === 'branch' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                </button>
              </div>
              <div className="space-y-0.5">
                {branches.branches.map(b => {
                  const isCurrent = b === branches.current;
                  return (
                    <button
                      key={b}
                      onClick={() => !isCurrent && handleCheckout(b)}
                      disabled={isCurrent || !!actionLoading}
                      className={cn(
                        "w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors",
                        isCurrent ? "bg-accent/10 text-purple-300 border border-purple-500/20" : "hover:bg-card text-foreground/70"
                      )}
                    >
                      <GitBranch className={cn("w-3.5 h-3.5 shrink-0", isCurrent ? "text-accent" : "text-muted-foreground/80")} />
                      <span className="text-xs truncate">{b}</span>
                      {isCurrent && <span className="ml-auto text-[10px] text-accent">Activa</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
    <GitHubModal
      isOpen={isGitHubModalOpen}
      onClose={() => setIsGitHubModalOpen(false)}
      projectPath={effectivePath}
      onCloneSuccess={onSetExplorerPath}
    />
  </>
  );
}
