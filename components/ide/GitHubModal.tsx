'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useStore } from '@/lib/store';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  LogIn,
  Plus,
  Upload,
  Download,
  Copy,
  CheckCircle,
  AlertCircle,
  Trash2,
  ExternalLink,
  RefreshCw,
  FolderOpen,
  Search,
  Zap,
  GitBranch,
  Calendar,
  Lock,
  Globe,
  Link2Off,
} from 'lucide-react';
import { GitHubSvg } from '@/components/ui/github-icon';
import { sessionFetch } from '@/lib/projectStore';

interface GitHubModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectPath?: string;
  onCloneSuccess?: (newPath: string) => void;
}

const LS_TOKEN_KEY = 'ZEUS_GITHUB_TOKEN';
const LS_REPOS_PREFIX = 'ZEUS_GITHUB_REPOS_'; // Per-project storage
const LS_DETECTED_KEY = 'ZEUS_GITHUB_DETECTED_CACHE';

// Helper to get repos key for a specific project path
const getReposKey = (projectPath?: string) => {
  if (!projectPath) return LS_REPOS_PREFIX + 'default';
  // Sanitize path to be a valid localStorage key
  const sanitized = projectPath.replace(/[^a-zA-Z0-9]/g, '_');
  return LS_REPOS_PREFIX + sanitized;
};

interface GithubRepo {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  private: boolean;
  updated_at: string;
  default_branch: string;
  isNextjs?: boolean;
  detecting?: boolean;
  language?: string | null;
  stargazers_count?: number;
}

export default function GitHubModal({ isOpen, onClose, projectPath, onCloneSuccess }: GitHubModalProps) {
  const { toast } = useToast();
  const { refreshExplorer } = useStore();

  const [activeTab, setActiveTab] = useState('auth');
  const [token, setToken] = useState('');
  const [userInfo, setUserInfo] = useState<{ login: string; avatar_url?: string } | null>(null);

  const [repoName, setRepoName] = useState('');
  const [repoDescription, setRepoDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [repoUrl, setRepoUrl] = useState('');
  const [openRepoUrl, setOpenRepoUrl] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [projectRepos, setProjectRepos] = useState<any[]>([]);

  // My repos tab
  const [githubRepos, setGithubRepos] = useState<GithubRepo[]>([]);
  const [repoFilter, setRepoFilter] = useState('');
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [detectedCache, setDetectedCache] = useState<Record<string, boolean>>({});
  const abortDetectRef = useRef<AbortController | null>(null);

  // Load token, repos and detection cache on mount
  useEffect(() => {
    const savedToken = localStorage.getItem(LS_TOKEN_KEY)?.trim();
    if (savedToken) {
      setToken(savedToken);
      validateToken(savedToken);
    }
    try {
      const savedDetected = localStorage.getItem(LS_DETECTED_KEY);
      if (savedDetected) setDetectedCache(JSON.parse(savedDetected));
    } catch { /* ignore */ }
  }, []);

  const refreshProjectRepos = useCallback(() => {
    if (!projectPath) {
      setProjectRepos([]);
      return;
    }
    try {
      const reposKey = getReposKey(projectPath);
      const savedRepos = localStorage.getItem(reposKey);
      if (savedRepos) {
        setProjectRepos(JSON.parse(savedRepos));
      } else {
        setProjectRepos([]);
      }
    } catch {
      setProjectRepos([]);
    }
  }, [projectPath]);

  // Load repos specific to this project path whenever projectPath changes
  useEffect(() => {
    refreshProjectRepos();
  }, [projectPath, refreshProjectRepos]);

  // Sincronizar los repos vinculados con GitHub: si el usuario borró alguno
  // directamente en github.com, lo quitamos del localStorage y del estado
  // para que no aparezca como "vinculado" un repo que ya no existe.
  // Se ejecuta al montar el modal y cada vez que cambia el proyecto o el token.
  useEffect(() => {
    if (!projectPath || !token || !isOpen) return;
    const reposKey = getReposKey(projectPath);
    let saved: any[] = [];
    try {
      const raw = localStorage.getItem(reposKey);
      if (raw) saved = JSON.parse(raw);
    } catch { /* ignore */ }
    if (!Array.isArray(saved) || saved.length === 0) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await sessionFetch('/api/github/check-linked', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, urls: saved.map((r) => r.url) }),
        });
        if (!res.ok) {
          console.warn('[GitHubModal] check-linked falló:', res.status);
          return;
        }
        const data = await res.json();
        const results: { url: string; exists: boolean; status: number | string; owner?: string; repo?: string }[] = data.results || [];
        const validUrls = new Set(results.filter((r) => r.exists).map((r) => r.url));
        const missing = results.filter((r) => !r.exists);
        if (missing.length === 0 || cancelled) return;

        // Filtrar los repos que aún existen
        const next = saved.filter((r) => validUrls.has(r.url));
        setProjectRepos(next);
        localStorage.setItem(reposKey, JSON.stringify(next));

        // Limpiar el remote `origin` (o el que coincida) del repo local para
        // que el panel Git no intente hacer push/pull contra un repo borrado.
        // Es una limpieza opcional, no bloqueante: si falla, el repo local
        // simplemente seguirá con un remote roto pero el panel lo indicará.
        for (const m of missing) {
          try {
            await sessionFetch('/api/github/remove-remote', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: projectPath, remoteName: 'origin' }),
            });
          } catch (e) {
            console.warn('[GitHubModal] remove-remote warning:', e);
          }
        }

        // Notificar al usuario
        const names = missing.map((m) => {
          const local = saved.find((s) => s.url === m.url);
          return local?.name || m.repo || m.url;
        });
        toast({
          title: 'Repos eliminados de GitHub',
          description: `${names.length} repositorio(s) ya no existen en GitHub y se desvinculan del proyecto: ${names.join(', ')}`,
          variant: 'destructive',
          duration: 6000,
        });
        console.log('[GitHubModal] repos purgados por no existir en GitHub:', names);

        // Disparar el evento para que el panel Git local se entere
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('zeus:git-local-updated', { detail: { path: projectPath, source: 'check-linked' } }));
        }
      } catch (e: any) {
        console.warn('[GitHubModal] check-linked error:', e?.message);
      }
    })();

    return () => { cancelled = true; };
  }, [projectPath, token, isOpen]);

  // Persist detection cache
  useEffect(() => {
    localStorage.setItem(LS_DETECTED_KEY, JSON.stringify(detectedCache));
  }, [detectedCache]);

  const validateToken = async (t: string) => {
    const tokenTrim = t.trim();
    if (!tokenTrim) {
      setUserInfo(null);
      return;
    }
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${tokenTrim}`, Accept: 'application/vnd.github.v3+json' },
      });
      if (res.ok) {
        const data = await res.json();
        setUserInfo({ login: data.login, avatar_url: data.avatar_url });
      } else {
        setUserInfo(null);
        // 401/403: el token no es válido o ha caducado. Se avisa al usuario
        // en vez de fallar en silencio y dejar el error solo en consola.
        if (res.status === 401 || res.status === 403) {
          toast({
            title: 'Token de GitHub no válido',
            description: 'Tu token ha caducado o no tiene permisos. Genéralo de nuevo en github.com y guárdalo.',
            variant: 'destructive',
            duration: 6000,
          });
        }
      }
    } catch {
      setUserInfo(null);
    }
  };

  const handleSaveToken = () => {
    if (!token.trim()) return;
    localStorage.setItem(LS_TOKEN_KEY, token.trim());
    validateToken(token.trim());
    toast({ title: 'Token guardado', description: 'Tu token de GitHub se ha guardado localmente.' });
  };

  const handleClearToken = () => {
    localStorage.removeItem(LS_TOKEN_KEY);
    setToken('');
    setUserInfo(null);
    toast({ title: 'Token eliminado', description: 'Tu token de GitHub se ha eliminado.' });
  };

  const addProjectRepo = (name: string, url: string) => {
    const next = [...projectRepos.filter((r) => r.url !== url), { name, url }];
    setProjectRepos(next);
    const reposKey = getReposKey(projectPath);
    localStorage.setItem(reposKey, JSON.stringify(next));
  };

  const createRepository = async () => {
    if (!repoName.trim()) {
      toast({ title: 'Error', description: 'Ingresa un nombre para el repositorio.', variant: 'destructive' });
      return;
    }
    if (!token) {
      toast({ title: 'Error', description: 'Guarda tu token de GitHub primero.', variant: 'destructive' });
      return;
    }
    if (!projectPath) {
      toast({ title: 'Sin proyecto', description: 'Abre una carpeta en el explorador para poder crear un repositorio.', variant: 'destructive' });
      return;
    }
    setIsLoading(true);
    try {
      const res = await sessionFetch('/api/github/create-repo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          path: projectPath,
          repoName: repoName.trim(),
          repoDescription: repoDescription.trim(),
          isPrivate,
        }),
      });

      // Handle non-JSON responses (e.g., HTML error pages)
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await res.text();
        throw new Error(`El servidor respondió con HTML: ${text.substring(0, 100)}`);
      }

      const data = await res.json();
      if (!res.ok) {
        toast({ title: 'Error', description: data.error || 'No se pudo crear el repositorio.', variant: 'destructive' });
        return;
      }
      setRepoUrl(data.repoUrl);
      addProjectRepo(repoName.trim(), data.repoUrl);
      toast({ title: '¡Repositorio creado!', description: data.message || 'Repositorio creado y archivos subidos.' });
      setRepoName('');
      setRepoDescription('');

      // Sincronizar repo local tras crear
      if (projectPath) {
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const safeMsg = `Init ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
        try {
          const syncRes = await sessionFetch('/api/github/sync-local', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: projectPath, message: safeMsg }),
          });
          const syncData = await syncRes.json().catch(() => ({}));
          console.log('[GitHubModal] /api/github/sync-local (create) status:', syncRes.status, 'data:', syncData);
          // Avisar al panel Git local (en caso de que esté montado) para que
          // refresque isRepo / status / log sin esperar al intervalo de 5s.
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('zeus:git-local-updated', { detail: { path: projectPath, source: 'create-repo' } }));
          }
        } catch (syncErr) {
          console.warn('[GitHubModal] local sync warning:', syncErr);
        }
      }

      setTimeout(() => {
        refreshExplorer();
      }, 300);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Error de conexión', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const updateRepository = async (targetUrl?: string) => {
    const url = targetUrl || (projectRepos.length > 0 ? projectRepos[0].url : null);
    if (!url) {
      toast({ title: 'Error', description: 'No hay repositorios vinculados. Crea uno primero.', variant: 'destructive' });
      return;
    }
    if (!token) {
      toast({ title: 'Error', description: 'Guarda tu token de GitHub primero.', variant: 'destructive' });
      return;
    }
    if (!projectPath) {
      toast({ title: 'Sin proyecto', description: 'Abre una carpeta en el explorador para poder actualizar un repositorio.', variant: 'destructive' });
      return;
    }
    setIsLoading(true);
    try {
      const res = await sessionFetch('/api/github/update-repo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, path: projectPath, repoUrl: url }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: 'Error', description: data.error || 'No se pudo actualizar el repositorio.', variant: 'destructive' });
        return;
      }
      toast({ title: '¡Repositorio actualizado!', description: data.message || 'Archivos subidos exitosamente.' });

      // Forzar sincronización local: stage + commit de los cambios, para que `git status` quede limpio
      // y el explorador deje de marcar archivos en verde.
      // Usamos un endpoint dedicado (/api/github/sync-local) que escribe el mensaje a un archivo
      // temporal y usa execFile, evitando cualquier problema de escape con cmd.exe.
      if (projectPath) {
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const safeMsg = `Sync ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
        try {
          const syncRes = await sessionFetch('/api/github/sync-local', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: projectPath, message: safeMsg }),
          });
          const syncData = await syncRes.json().catch(() => ({}));
          console.log('[GitHubModal] /api/github/sync-local status:', syncRes.status, 'data:', syncData);
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('zeus:git-local-updated', { detail: { path: projectPath, source: 'update-repo' } }));
          }
          if (!syncRes.ok) {
            toast({
              title: 'Aviso',
              description: `El commit local falló: ${syncData.error || 'Error desconocido'}. Los archivos pueden seguir en verde hasta que commitees manualmente.`,
              variant: 'destructive'
            });
          }
        } catch (syncErr: any) {
          console.error('[GitHubModal] local sync error:', syncErr);
        }
      }

      // Pequeño delay para que el commit local se asiente antes de refrescar
      setTimeout(() => {
        refreshExplorer();
      }, 300);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Error de conexión', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const cloneRepository = async (targetUrl?: string) => {
    const url = targetUrl || openRepoUrl;
    if (!url || !url.trim()) {
      toast({ title: 'Error', description: 'Ingresa la URL del repositorio.', variant: 'destructive' });
      return;
    }
    const normalized = url.trim().replace(/\.git$/, '');
    const match = normalized.match(/github\.com\/([\w-]+)\/([\w-]+)/);
    if (!match) {
      toast({ title: 'Error', description: 'URL de GitHub inválida.', variant: 'destructive' });
      return;
    }
    setIsLoading(true);
    try {
      const res = await sessionFetch('/api/github/clone-repo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoUrl: normalized,
          token: token || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: 'Error', description: data.error || 'No se pudo clonar el repositorio.', variant: 'destructive' });
        return;
      }
      toast({ title: '¡Repositorio clonado!', description: data.message || 'Clonado exitosamente.' });
      setOpenRepoUrl('');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('zeus:git-local-updated', { detail: { path: data.projectPath, source: 'clone-repo' } }));
      }
      refreshExplorer();
      if (data.projectPath && onCloneSuccess) {
        onCloneSuccess(data.projectPath);
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Error de conexión', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  // Borra un repositorio de GitHub a partir de owner/repo explícitos.
  // Reutilizable desde la pestaña "Repositorios vinculados" y desde "Mis repositorios".
  const deleteRepositoryFromGitHub = async (owner: string, repo: string, displayName?: string) => {
    const label = displayName || `${owner}/${repo}`;
    if (!token) {
      toast({ title: 'Error', description: 'Guarda tu token de GitHub primero.', variant: 'destructive' });
      return false;
    }
    if (!confirm(`¿Estás seguro de eliminar el repositorio "${label}" de GitHub?`)) return false;
    setIsLoading(true);
    try {
      const res = await sessionFetch('/api/github/delete-repo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, owner, repo }),
      });
      const data = await res.json();
      if (!res.ok) {
        const fullDescription = data.hint
          ? `${data.error || 'No se pudo eliminar.'} — ${data.hint}`
          : data.error || 'No se pudo eliminar.';
        toast({
          title: 'No se pudo eliminar el repositorio',
          description: fullDescription,
          variant: 'destructive',
          duration: 9000,
        });
        console.error('[GitHubModal] delete-repo failed', {
          status: res.status,
          error: data.error,
          hint: data.hint,
          documentation_url: data.documentation_url,
        });
        return false;
      }
      return true;
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Error de conexión', variant: 'destructive' });
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const unlinkRepository = (url: string) => {
    const next = projectRepos.filter((r) => r.url !== url);
    setProjectRepos(next);
    if (projectPath) {
      const reposKey = getReposKey(projectPath);
      localStorage.setItem(reposKey, JSON.stringify(next));
    }
    toast({ title: 'Repositorio desvinculado', description: 'Se ha eliminado la vinculación local con este proyecto.' });
  };

  const deleteRepository = async (name: string) => {
    const match = projectRepos.find((r) => r.name === name)?.url?.match(/github\.com\/([\w-]+)\/([\w-]+)/);
    if (!match) {
      toast({ title: 'Error', description: 'No se pudo extraer owner/repo.', variant: 'destructive' });
      return;
    }
    const ok = await deleteRepositoryFromGitHub(match[1], match[2], name);
    if (!ok) return;
    const next = projectRepos.filter((r) => r.name !== name);
    setProjectRepos(next);
    const reposKey = getReposKey(projectPath);
    localStorage.setItem(reposKey, JSON.stringify(next));
    toast({ title: 'Repositorio eliminado', description: `El repositorio "${name}" se eliminó de GitHub.` });
  };

  // ===== My Repos tab logic =====
  const fetchUserRepos = useCallback(async () => {
    if (!token) {
      toast({ title: 'Token requerido', description: 'Guarda tu token de GitHub primero.', variant: 'destructive' });
      return;
    }
    setLoadingRepos(true);
    setGithubRepos([]);
    try {
      const perPage = 50;
      const pages = [1, 2];
      const allRepos: GithubRepo[] = [];
      for (const page of pages) {
        const res = await fetch(`https://api.github.com/user/repos?sort=updated&per_page=${perPage}&page=${page}&affiliation=owner,collaborator`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' },
        });
        if (!res.ok) throw new Error('No se pudo obtener la lista de repositorios');
        const data = await res.json();
        if (!Array.isArray(data) || data.length === 0) break;
        allRepos.push(...data.map((r: any) => ({
          id: r.id,
          name: r.name,
          full_name: r.full_name,
          html_url: r.html_url,
          description: r.description,
          private: r.private,
          updated_at: r.updated_at,
          default_branch: r.default_branch || 'main',
          language: r.language,
          stargazers_count: r.stargazers_count,
        })));
        if (data.length < perPage) break;
      }
      setGithubRepos(allRepos);
      // Start Next.js detection
      detectNextJsInRepos(allRepos);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Error cargando repositorios', variant: 'destructive' });
    } finally {
      setLoadingRepos(false);
    }
  }, [token, toast]);

  const detectNextJsInRepos = async (repos: GithubRepo[]) => {
    if (!token) return;
    if (abortDetectRef.current) abortDetectRef.current.abort();
    const controller = new AbortController();
    abortDetectRef.current = controller;

    const batchSize = 5;
    for (let i = 0; i < repos.length; i += batchSize) {
      if (controller.signal.aborted) return;
      const batch = repos.slice(i, i + batchSize);
      await Promise.all(batch.map(async (repo) => {
        if (controller.signal.aborted) return;
        // Use cache if available
        if (detectedCache[repo.full_name] !== undefined) {
          setGithubRepos(prev => prev.map(r => r.id === repo.id ? { ...r, isNextjs: detectedCache[repo.full_name], detecting: false } : r));
          return;
        }
        setGithubRepos(prev => prev.map(r => r.id === repo.id ? { ...r, detecting: true } : r));
        try {
          const rawUrl = `https://raw.githubusercontent.com/${repo.full_name}/${repo.default_branch}/package.json`;
          const res = await fetch(rawUrl, {
            headers: { Authorization: `token ${token}` },
            signal: controller.signal,
          });
          if (!res.ok) {
            setDetectedCache(prev => ({ ...prev, [repo.full_name]: false }));
            setGithubRepos(prev => prev.map(r => r.id === repo.id ? { ...r, isNextjs: false, detecting: false } : r));
            return;
          }
          const text = await res.text();
          let isNext = false;
          try {
            const pkg = JSON.parse(text);
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };
            isNext = !!deps && (deps.next || deps['next']);
          } catch {
            isNext = false;
          }
          setDetectedCache(prev => ({ ...prev, [repo.full_name]: isNext }));
          setGithubRepos(prev => prev.map(r => r.id === repo.id ? { ...r, isNextjs: isNext, detecting: false } : r));
        } catch {
          setDetectedCache(prev => ({ ...prev, [repo.full_name]: false }));
          setGithubRepos(prev => prev.map(r => r.id === repo.id ? { ...r, isNextjs: false, detecting: false } : r));
        }
      }));
    }
  };

  useEffect(() => {
    if (activeTab === 'my-repos' && githubRepos.length === 0 && token) {
      fetchUserRepos();
    }
  }, [activeTab, token]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredRepos = githubRepos.filter(r => {
    const q = repoFilter.toLowerCase();
    return (
      r.name.toLowerCase().includes(q) ||
      (r.description || '').toLowerCase().includes(q) ||
      (r.language || '').toLowerCase().includes(q)
    );
  });

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch { return iso; }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl h-[85vh] bg-background border-border/50 text-foreground/80 flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitHubSvg className="h-6 w-6 text-green-400" />
            Integración con GitHub
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="grid w-full grid-cols-5 bg-card">
            <TabsTrigger value="auth" className="data-[state=active]:bg-green-600">
              <LogIn className="h-4 w-4 mr-2" />
              Auth
            </TabsTrigger>
            <TabsTrigger value="my-repos" className="data-[state=active]:bg-green-600">
              <GitHubSvg className="h-4 w-4 mr-2" />
              Mis Repos
            </TabsTrigger>
            <TabsTrigger value="new-repo" className="data-[state=active]:bg-green-600">
              <Plus className="h-4 w-4 mr-2" />
              Nuevo
            </TabsTrigger>
            <TabsTrigger value="update-repo" className="data-[state=active]:bg-green-600">
              <Upload className="h-4 w-4 mr-2" />
              Actualizar
            </TabsTrigger>
            <TabsTrigger value="clone-repo" className="data-[state=active]:bg-green-600">
              <Download className="h-4 w-4 mr-2" />
              Clonar
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto p-4">
            {/* Auth */}
            <TabsContent value="auth" className="space-y-4 mt-0">
              <Card className="bg-card border-border/40">
                <CardHeader>
                  <CardTitle className="text-foreground flex items-center gap-2">
                    <GitHubSvg className="h-5 w-5 text-green-400" />
                    Token de GitHub
                  </CardTitle>
                  <CardDescription>
                    Guarda tu Personal Access Token (PAT) con scope <code className="text-green-400">repo</code>.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Input
                    type="password"
                    placeholder="ghp_xxxxxxxxxxxx"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    className="bg-muted border-border/40 text-foreground"
                  />
                  {!userInfo ? (
                    <Button onClick={handleSaveToken} disabled={!token.trim()} className="w-full bg-green-600 hover:bg-green-500">
                      Guardar Token
                    </Button>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-green-400">
                        <CheckCircle className="h-5 w-5" />
                        <span>Conectado como <strong>{userInfo.login}</strong></span>
                      </div>
                      <Button onClick={handleClearToken} variant="outline" className="w-full border-destructive text-destructive hover:bg-red-900/20">
                        Eliminar Token
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* My Repos */}
            <TabsContent value="my-repos" className="space-y-4 mt-0">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/80" />
                  <Input
                    value={repoFilter}
                    onChange={(e) => setRepoFilter(e.target.value)}
                    placeholder="Buscar repositorios..."
                    className="pl-9 bg-card border-border/40 text-foreground"
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={fetchUserRepos}
                  disabled={loadingRepos || !token}
                  className="border-border/40 text-foreground/70 hover:bg-muted"
                >
                  <RefreshCw className={cn("h-4 w-4", loadingRepos && "animate-spin")} />
                </Button>
              </div>

              {!token && (
                <div className="text-center py-8">
                  <AlertCircle className="h-10 w-10 text-warning mx-auto mb-2" />
                  <p className="text-muted-foreground">Guarda tu token de GitHub en la pestaña "Auth" para ver tus repositorios.</p>
                </div>
              )}

              {token && loadingRepos && githubRepos.length === 0 && (
                <div className="text-center py-8">
                  <RefreshCw className="h-8 w-8 text-muted-foreground/80 mx-auto mb-2 animate-spin" />
                  <p className="text-muted-foreground">Cargando repositorios...</p>
                </div>
              )}

              {token && !loadingRepos && githubRepos.length === 0 && (
                <div className="text-center py-8">
                  <FolderOpen className="h-10 w-10 text-muted-foreground/60 mx-auto mb-2" />
                  <p className="text-muted-foreground">No se encontraron repositorios.</p>
                </div>
              )}

              <div className="space-y-2">
                {filteredRepos.map((repo) => (
                  <Card key={repo.id} className="bg-card border-border/50 hover:border-border/40 transition-colors">
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-foreground truncate">{repo.name}</span>
                            {repo.private ? (
                              <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">
                                <Lock className="h-3 w-3" /> Privado
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] text-green-400 bg-green-400/10 px-1.5 py-0.5 rounded">
                                <Globe className="h-3 w-3" /> Público
                              </span>
                            )}
                            {repo.isNextjs === true && (
                              <span className="inline-flex items-center gap-1 text-[10px] text-purple-300 bg-accent/15 px-1.5 py-0.5 rounded border border-purple-500/20">
                                <Zap className="h-3 w-3" /> Next.js
                              </span>
                            )}
                            {repo.isNextjs === undefined && repo.detecting && (
                              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                <RefreshCw className="h-3 w-3 animate-spin" /> Detectando...
                              </span>
                            )}
                          </div>
                          {repo.description && (
                            <p className="text-xs text-muted-foreground mt-1 truncate">{repo.description}</p>
                          )}
                          <div className="flex items-center gap-3 mt-1.5">
                            {repo.language && (
                              <span className="text-[10px] text-muted-foreground/80">{repo.language}</span>
                            )}
                            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/80">
                              <Calendar className="h-3 w-3" /> {formatDate(repo.updated_at)}
                            </span>
                            {typeof repo.stargazers_count === 'number' && repo.stargazers_count > 0 && (
                              <span className="text-[10px] text-warning">★ {repo.stargazers_count}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button size="sm" variant="outline" onClick={() => window.open(repo.html_url, '_blank')} className="text-green-400 border-green-500/50 h-8 w-8 p-0" title="Abrir en GitHub">
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => cloneRepository(repo.html_url)} disabled={isLoading} className="text-accent border-purple-500/50 h-8 w-8 p-0" title="Clonar">
                            <Download className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              if (!repo.full_name) return;
                              const [owner, name] = repo.full_name.split('/');
                              if (!owner || !name) {
                                toast({ title: 'Error', description: 'No se pudo extraer owner/repo.', variant: 'destructive' });
                                return;
                              }
                              const ok = await deleteRepositoryFromGitHub(owner, name, repo.name);
                              if (ok) {
                                setGithubRepos((prev) => prev.filter((r) => r.id !== repo.id));
                                // Limpia también la referencia en repos vinculados, si existía
                                setProjectRepos((prev) => {
                                  const next = prev.filter((r) => {
                                    const m = r.url?.match(/github\.com\/([\w-]+)\/([\w-]+)/);
                                    return !(m && m[1] === owner && m[2] === name);
                                  });
                                  if (next.length !== prev.length && projectPath) {
                                    const reposKey = getReposKey(projectPath);
                                    localStorage.setItem(reposKey, JSON.stringify(next));
                                  }
                                  return next;
                                });
                                toast({ title: 'Repositorio eliminado', description: `El repositorio "${repo.name}" se eliminó de GitHub.` });
                              }
                            }}
                            disabled={isLoading}
                            className="text-destructive border-destructive/50 h-8 w-8 p-0"
                            title="Borrar de GitHub"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {filteredRepos.length === 0 && githubRepos.length > 0 && repoFilter && (
                <p className="text-center text-muted-foreground/80 text-sm py-4">Ningún repositorio coincide con "{repoFilter}"</p>
              )}
            </TabsContent>

            {/* New Repo */}
            <TabsContent value="new-repo" className="space-y-4 mt-0">
              <Card className="bg-card border-border/40">
                <CardHeader>
                  <CardTitle className="text-foreground flex items-center gap-2">
                    <Plus className="h-5 w-5 text-green-400" />
                    Crear Nuevo Repositorio
                  </CardTitle>
                  <CardDescription>
                    Crea un repo en GitHub y sube los archivos del proyecto actual.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <label className="text-sm text-foreground/70">Nombre</label>
                    <Input value={repoName} onChange={(e) => setRepoName(e.target.value)} placeholder="mi-proyecto" className="bg-muted border-border/40 text-foreground" />
                  </div>
                  <div>
                    <label className="text-sm text-foreground/70">Descripción</label>
                    <Input value={repoDescription} onChange={(e) => setRepoDescription(e.target.value)} placeholder="Descripción breve" className="bg-muted border-border/40 text-foreground" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch id="repo-private" checked={isPrivate} onCheckedChange={setIsPrivate} />
                    <label htmlFor="repo-private" className="text-sm text-foreground/70">Repositorio privado</label>
                  </div>
                  <Button onClick={createRepository} disabled={isLoading || !repoName.trim()} className="w-full bg-green-600 hover:bg-green-500">
                    {isLoading ? 'Creando...' : 'Crear y Subir Archivos'}
                  </Button>
                  {repoUrl && (
                    <div className="p-3 bg-muted/50 border border-green-500/30 rounded">
                      <p className="text-green-400 text-sm">¡Repositorio creado!</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Input readOnly value={repoUrl} className="bg-card border-border/40 text-foreground/70 flex-1 text-sm" />
                        <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(repoUrl); toast({ title: 'URL copiada' }); }}>
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {projectRepos.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground/70">Repositorios vinculados ({projectRepos.length})</h3>
                  {projectRepos.map((r, i) => (
                    <Card key={i} className="bg-muted border-border/40">
                      <CardContent className="p-3 flex items-center justify-between">
                        <div className="min-w-0">
                          <p className="text-foreground font-medium truncate">{r.name}</p>
                          <p className="text-muted-foreground text-xs truncate">{r.url}</p>
                        </div>
                        <div className="flex items-center gap-1 ml-2">
                          <Button size="sm" variant="outline" onClick={() => window.open(r.url, '_blank')} className="text-green-400 border-green-500/50">
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => updateRepository(r.url)} className="text-primary border-blue-500/50">
                            <Upload className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => deleteRepository(r.name)} className="text-destructive border-destructive/50">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* Update Repo */}
            <TabsContent value="update-repo" className="space-y-4 mt-0">
              <Card className="bg-card border-border/40">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <CardTitle className="text-foreground flex items-center gap-2">
                        <Upload className="h-5 w-5 text-primary" />
                        Actualizar Repositorio
                      </CardTitle>
                      <CardDescription>
                        Sube la versión actual del proyecto a un repositorio existente.
                      </CardDescription>
                    </div>
                    <Button 
                      size="sm" 
                      variant="outline" 
                      onClick={() => {
                        refreshProjectRepos();
                        toast({ title: 'Refrescado', description: 'Se han recargado los repositorios para la ruta actual.' });
                      }}
                      className="h-8 border-border/40"
                    >
                      <RefreshCw className="h-3.5 w-3.5 mr-2" />
                      Refrescar
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-2 bg-muted/30 border border-border/40 rounded flex items-center gap-2">
                    <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] text-muted-foreground uppercase font-semibold">Proyecto actual:</p>
                      <p className="text-xs text-foreground/70 truncate font-mono">{projectPath || 'No hay carpeta abierta'}</p>
                    </div>
                  </div>

                  {projectRepos.length > 0 ? (
                    <div className="space-y-3">
                      <p className="text-sm text-foreground/70">Repositorios vinculados a este proyecto:</p>
                      <div className="space-y-2">
                        {projectRepos.map((r, i) => (
                          <div key={i} className="flex flex-col p-3 bg-muted rounded border border-border/40 gap-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <span className="text-sm font-semibold text-foreground truncate block">{r.name}</span>
                                <span className="text-[10px] text-muted-foreground truncate block">{r.url}</span>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <Button size="sm" variant="outline" onClick={() => window.open(r.url, '_blank')} className="h-8 w-8 p-0 text-green-400 border-green-500/50" title="Ver en GitHub">
                                  <ExternalLink className="h-4 w-4" />
                                </Button>
                                <Button 
                                  size="sm" 
                                  variant="outline" 
                                  onClick={() => unlinkRepository(r.url)} 
                                  className="h-8 w-8 p-0 text-amber-400 border-amber-500/50" 
                                  title="Desvincular localmente (No borra en GitHub)"
                                >
                                  <Link2Off className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                            <Button 
                              onClick={() => updateRepository(r.url)} 
                              disabled={isLoading} 
                              className="w-full bg-primary hover:bg-primary h-9"
                            >
                              {isLoading ? (
                                <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Subiendo...</>
                              ) : (
                                <><Upload className="h-4 w-4 mr-2" /> Subir Cambios de este Proyecto</>
                              )}
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="text-center py-4">
                        <AlertCircle className="h-10 w-10 text-warning mx-auto mb-2" />
                        <p className="text-muted-foreground">No hay repositorios vinculados.</p>
                        <p className="text-muted-foreground/80 text-sm mb-4">Vincula un repositorio existente de GitHub.</p>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm text-foreground/70">URL del repositorio GitHub:</label>
                        <Input
                          value={openRepoUrl}
                          onChange={(e) => setOpenRepoUrl(e.target.value)}
                          placeholder="https://github.com/usuario/nombre-repo"
                          className="bg-muted border-border/40 text-foreground"
                        />
                        <Button
                          onClick={() => {
                            if (openRepoUrl.trim()) {
                              const name = openRepoUrl.match(/github\.com\/[^/]+\/([^/]+)/)?.[1] || 'repositorio';
                              addProjectRepo(name, openRepoUrl.trim());
                              toast({ title: 'Repositorio vinculado', description: 'Ahora puedes subir cambios.' });
                            }
                          }}
                          disabled={!openRepoUrl.trim() || !token}
                          className="w-full bg-primary hover:bg-primary"
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          Vincular Repositorio Existente
                        </Button>
                        {!token && (
                          <p className="text-xs text-amber-400">Necesitas un token de GitHub en la pestaña "Auth"</p>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Clone Repo */}
            <TabsContent value="clone-repo" className="space-y-4 mt-0">
              <Card className="bg-card border-border/40">
                <CardHeader>
                  <CardTitle className="text-foreground flex items-center gap-2">
                    <Download className="h-5 w-5 text-accent" />
                    Clonar Repositorio
                  </CardTitle>
                  <CardDescription>
                    Descarga un repositorio de GitHub al workspace local.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Input
                    value={openRepoUrl}
                    onChange={(e) => setOpenRepoUrl(e.target.value)}
                    placeholder="https://github.com/usuario/nombre-repo"
                    className="bg-muted border-border/40 text-foreground"
                  />
                  <Button onClick={() => cloneRepository()} disabled={isLoading || !openRepoUrl.trim()} className="w-full bg-accent hover:bg-accent">
                    {isLoading ? 'Clonando...' : 'Clonar Repositorio'}
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
