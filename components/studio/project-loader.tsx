'use client';
import React, { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import {
    Upload,
    FolderOpen,
    GitBranch,
    Clock,
    CheckCircle,
    AlertCircle,
    ExternalLink,
    FileCode,
    Folder,
    Trash2,
    Database,
    Download,
    Loader2
} from 'lucide-react';
import { Badge } from '../ui/badge';
import { useTranslation } from '../../contexts/translation-context';
import { useAuth } from '@/context/AuthContext';
import { getPocketBase } from '../../lib/pocketbase';
import JSZip from 'jszip';
import { toast } from '../../hooks/use-toast';

interface ProjectLoaderProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onProjectLoaded: (projectPath: string, files?: FileList) => void;
}

interface RecentProject {
    id: string;
    name: string;
    path: string;
    lastOpened: number; // Timestamp
    type: 'local' | 'git';
}

interface GitHubRepo {
    id: string;
    name: string;
    full_name: string;
    html_url: string;
    description: string | null;
    private: boolean;
    updated_at: string;
    is_nextjs?: boolean;
    default_branch?: string;
    owner?: {
        login: string;
    };
}

interface DatabaseProject {
    id: string;
    name: string;
    project_archive: string; // URL del archivo zip
    created: string;
    updated: string;
    [key: string]: any;
}

const STORAGE_KEY = 'zeus_recent_projects';
const MAX_RECENT_PROJECTS = 10;

// Helper function to format time ago
function formatTimeAgo(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);

    if (years > 0) return `${years} ${years === 1 ? 'año' : 'años'} atrás`;
    if (months > 0) return `${months} ${months === 1 ? 'mes' : 'meses'} atrás`;
    if (weeks > 0) return `${weeks} ${weeks === 1 ? 'semana' : 'semanas'} atrás`;
    if (days > 0) return `${days} ${days === 1 ? 'día' : 'días'} atrás`;
    if (hours > 0) return `${hours} ${hours === 1 ? 'hora' : 'horas'} atrás`;
    if (minutes > 0) return `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'} atrás`;
    return 'Hace un momento';
}

// Load recent projects from localStorage
function loadRecentProjects(): RecentProject[] {
    if (typeof window === 'undefined') return [];
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            const projects = JSON.parse(stored) as RecentProject[];
            // Sort by lastOpened (most recent first)
            return projects.sort((a, b) => b.lastOpened - a.lastOpened);
        }
    } catch (error) {
        console.error('Error loading recent projects:', error);
    }
    return [];
}

// Save recent project to localStorage
function saveRecentProject(path: string, name: string, type: 'local' | 'git') {
    if (typeof window === 'undefined') return;
    try {
        const projects = loadRecentProjects();
        
        // Remove if already exists
        const filtered = projects.filter(p => p.path !== path);
        
        // Add new project at the beginning
        const newProject: RecentProject = {
            id: `project-${Date.now()}`,
            name,
            path,
            lastOpened: Date.now(),
            type
        };
        
        // Keep only MAX_RECENT_PROJECTS
        const updated = [newProject, ...filtered].slice(0, MAX_RECENT_PROJECTS);
        
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (error) {
        console.error('Error saving recent project:', error);
    }
}

export function ProjectLoader({ open, onOpenChange, onProjectLoaded }: ProjectLoaderProps) {
    const { t } = useTranslation();
    const { user } = useAuth();
    const [dragActive, setDragActive] = useState(false);
    const [gitUrl, setGitUrl] = useState('');
    const [loading, setLoading] = useState(false);
    const [projectPath, setProjectPath] = useState('');
    const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
    const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
    const [databaseProjects, setDatabaseProjects] = useState<DatabaseProject[]>([]);
    const [loadingDatabase, setLoadingDatabase] = useState(false);
    const [downloadingProject, setDownloadingProject] = useState<string | null>(null);
    const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);
    const [loadingGithub, setLoadingGithub] = useState(false);
    const [githubToken, setGithubToken] = useState('');
    const [autoDetectedGithubToken, setAutoDetectedGithubToken] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Load recent projects when component mounts or dialog opens
    useEffect(() => {
        if (open) {
            setRecentProjects(loadRecentProjects());
            if (user) {
                loadDatabaseProjects();
            }
            // Load GitHub repos if token is available
            if (githubToken) {
                loadGithubRepositories();
            }
        }
    }, [open, user, githubToken]);

    // Load GitHub repositories
    const loadGithubRepositories = async () => {
        if (!user) return;
        
        // Use either the manually entered token or the auto-detected one
        const tokenToUse = githubToken || user.githubAccessToken;
        
        if (!tokenToUse) {
          console.warn('No GitHub token available');
          return;
        }
        
        setLoadingGithub(true);
        try {
          const response = await fetch('https://api.github.com/user/repos', {
            headers: {
              'Authorization': `token ${tokenToUse}`,
              'Accept': 'application/vnd.github.v3+json',
            }
          });
          
          if (response.ok) {
            let repos = await response.json();
            
            // Detect Next.js projects by checking package.json content
            repos = await Promise.all(repos.map(async (repo: any) => {
              try {
                // Fetch package.json to check if it's a Next.js project
                const packageResponse = await fetch(`https://api.github.com/repos/${repo.full_name}/contents/package.json`, {
                  headers: {
                    'Authorization': `token ${tokenToUse}`,
                    'Accept': 'application/vnd.github.v3+json',
                  }
                });
                
                if (packageResponse.ok) {
                  const packageData = await packageResponse.json();
                  const packageJson = JSON.parse(atob(packageData.content));
                  
                  // Check if it's a Next.js project
                  const isNextJS = packageJson.dependencies?.next || 
                                  packageJson.devDependencies?.next ||
                                  packageJson.scripts?.dev?.includes('next') ||
                                  packageJson.scripts?.build?.includes('next');
                  
                  return {
                    ...repo,
                    is_nextjs: isNextJS,
                    default_branch: packageData.sha ? repo.default_branch : undefined
                  };
                }
              } catch (error) {
                console.warn(`Could not check if ${repo.name} is Next.js project:`, error);
              }
              
              return repo;
            }));
            
            setGithubRepos(repos);
            
            // If we used the auto-detected token, show a success message
            if (!githubToken && user.githubAccessToken && !autoDetectedGithubToken) {
              setAutoDetectedGithubToken(true);
              toast({
                title: '✅ GitHub conectado',
                description: 'Se ha detectado automáticamente tu token de GitHub desde Zeus',
              });
            }
          } else {
            console.error('Failed to load GitHub repositories:', response.status);
            if (!githubToken && user.githubAccessToken) {
              toast({
                title: 'Error de GitHub',
                description: 'El token de GitHub detectado no es válido. Ingresa uno manualmente.',
                variant: 'destructive'
              });
            }
          }
        } catch (error) {
          console.error('Error loading GitHub repositories:', error);
        } finally {
          setLoadingGithub(false);
        }
    };

    // Load projects from PocketBase
    const loadDatabaseProjects = async () => {
        if (!user) return;
        
        setLoadingDatabase(true);
        try {
            const pb = await getPocketBase();
            const projects = await pb.collection('projects').getList<DatabaseProject>(1, 50, {
                sort: '-created',
            });
            setDatabaseProjects(projects.items);
        } catch (error: any) {
            console.error('Error loading database projects:', error);
        } finally {
            setLoadingDatabase(false);
        }
    };

    // Helper to convert Base64 to Blob
const base64ToBlob = (base64: string, type: string = 'application/octet-stream'): Blob => {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type });
};

// Load Next.js project directly from GitHub
const handleLoadNextJSProject = async (repo: GitHubRepo) => {
    if (!user) return;
      
    setLoading(true);
    try {
      toast({
        title: 'Cargando...',
        description: `Descargando y extrayendo: ${repo.name}...`
      });
        
      const response = await fetch('/api/github-load', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          repoUrl: repo.html_url,
          repoName: repo.name,
          repoFullName: repo.full_name,
          branch: repo.default_branch || 'main',
          token: githubToken || user?.githubAccessToken
        })
      });
        
      if (response.ok) {
        const data = await response.json();
          
        if (!data.files || data.files.length === 0) {
            throw new Error('No files returned from the server.');
        }

        // Create File objects from the response
        const projectFiles = data.files.map((fileData: { name: string, path: string, content: string }) => {
            const blob = base64ToBlob(fileData.content);
            const file = new File([blob], fileData.name, { type: blob.type });
            // Add _relativePath to maintain folder structure
            (file as any)._relativePath = fileData.path;
            return file;
        });

        // Create a FileList-like object
        const dataTransfer = new DataTransfer();
        projectFiles.forEach((file: File) => dataTransfer.items.add(file));
        const fileList = dataTransfer.files;

        // Save GitHub project info for later saving
        localStorage.setItem('githubProjectInfo', JSON.stringify({
          repoFullName: repo.full_name,
          repoUrl: repo.html_url,
          branch: repo.default_branch || 'main',
          projectId: `github-${repo.id}`
        }));
          
        // Load the project with the retrieved files
        onProjectLoaded(`github:${repo.id}`, fileList);
        onOpenChange(false);
          
        toast({
          title: '✅ Éxito',
          description: `Proyecto Next.js cargado: ${repo.name}`
        });
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to load repository');
      }
    } catch (error: any) {
      console.error('Error loading Next.js project:', error);
      toast({
        title: 'Error',
        description: `Error al cargar proyecto Next.js: ${error.message}`,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
};
    
    // Download and load project from database
    const handleLoadDatabaseProject = async (project: DatabaseProject) => {
        if (!user) return;
        
        setDownloadingProject(project.id);
        try {
            const pb = await getPocketBase();
            // Get the file URL
            const fileUrl = pb.files.getUrl(project, project.project_archive);
            
            // Download the zip file
            const response = await fetch(fileUrl);
            if (!response.ok) throw new Error('Failed to download project');
            
            const arrayBuffer = await response.arrayBuffer();
            
            // Extract zip contents using JSZip
            const zip = await JSZip.loadAsync(arrayBuffer);
            const files: File[] = [];
            
            // Process all files in the zip
            for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
                if (zipEntry.dir) continue; // Skip directories
                
                // Filter out unwanted files
                if (relativePath.includes('node_modules') || 
                    relativePath.includes('.next') || 
                    relativePath.includes('package-lock.json') ||
                    relativePath.includes('.git') ||
                    relativePath.includes('dist') ||
                    relativePath.includes('build')) {
                    continue;
                }
                
                // Get file content
                const blob = await zipEntry.async('blob');
                
                // Create File object with _relativePath for folder structure
                // Note: webkitRelativePath is read-only, so we use _relativePath instead
                const file = new File([blob], relativePath.split('/').pop() || relativePath, {
                    type: blob.type || 'application/octet-stream',
                });
                
                // Add _relativePath to maintain folder structure (webkitRelativePath is read-only)
                (file as any)._relativePath = relativePath;
                
                files.push(file);
            }
            
            if (files.length === 0) {
                throw new Error('No se encontraron archivos válidos en el proyecto');
            }
            
            // Create a FileList-like object
            const dataTransfer = new DataTransfer();
            files.forEach(file => dataTransfer.items.add(file));
            const fileList = dataTransfer.files;
            
            // Extract project name
            const projectName = project.name || 'Database Project';
            
            // Save to recent projects
            saveRecentProject(`database:${project.id}`, projectName, 'local');
            setRecentProjects(loadRecentProjects());
            
            // Load the project
            onProjectLoaded(`database:${project.id}`, fileList);
            onOpenChange(false);
        } catch (error: any) {
            console.error('Error loading database project:', error);
            alert('Error al cargar el proyecto: ' + (error.message || 'Error desconocido'));
        } finally {
            setDownloadingProject(null);
        }
    };

    const handleDrag = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') {
            setDragActive(true);
        } else if (e.type === 'dragleave') {
            setDragActive(false);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            // Filter out node_modules, .next, package-lock.json, etc.
            const filteredFiles = Array.from(e.dataTransfer.files).filter(file => {
                const filePath = (file as any).webkitRelativePath || (file as any).path || file.name;
                return !filePath.includes('node_modules') && 
                       !filePath.includes('.next') && 
                       !filePath.includes('package-lock.json') &&
                       !filePath.includes('.git') &&
                       !filePath.includes('dist') &&
                       !filePath.includes('build');
            });
            
            if (filteredFiles.length === 0) {
                return;
            }
            
            // Create a new FileList-like object with filtered files
            const dataTransfer = new DataTransfer();
            filteredFiles.forEach(file => dataTransfer.items.add(file));
            const newFileList = dataTransfer.files;
            
            setSelectedFiles(newFileList);
            const file = filteredFiles[0];
            
            // Try to get the directory path
            let path = '';
            
            // For webkitRelativePath (when folder is selected via input)
            if (file.webkitRelativePath) {
                const parts = file.webkitRelativePath.split('/');
                path = parts[0] || file.name;
            } 
            // For file.path (Electron or some browsers)
            else if ((file as any).path) {
                const fullPath = (file as any).path;
                const lastSlash = fullPath.lastIndexOf('\\') > fullPath.lastIndexOf('/') 
                    ? fullPath.lastIndexOf('\\') 
                    : fullPath.lastIndexOf('/');
                path = lastSlash >= 0 ? fullPath.substring(0, lastSlash) : fullPath;
            }
            // Fallback: use file name as folder indicator
            else {
                path = `Selected: ${filteredFiles.length} file(s)`;
            }
            
            if (path) {
                setProjectPath(path);
            }
        }
    };

    const handleBrowseClick = () => {
        fileInputRef.current?.click();
    };

    const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            // Filter out node_modules, .next, package-lock.json, etc.
            const filteredFiles = Array.from(files).filter(file => {
                const filePath = (file as any).webkitRelativePath || (file as any).path || file.name;
                return !filePath.includes('node_modules') && 
                       !filePath.includes('.next') && 
                       !filePath.includes('package-lock.json') &&
                       !filePath.includes('.git') &&
                       !filePath.includes('dist') &&
                       !filePath.includes('build');
            });
            
            if (filteredFiles.length === 0) {
                return;
            }
            
            // Create a new FileList-like object with filtered files
            const dataTransfer = new DataTransfer();
            filteredFiles.forEach(file => dataTransfer.items.add(file));
            const newFileList = dataTransfer.files;
            
            setSelectedFiles(newFileList);
            const firstFile = filteredFiles[0];
            let path = '';
            
            // Try webkitRelativePath first (works when folder is selected)
            if (firstFile.webkitRelativePath) {
                const parts = firstFile.webkitRelativePath.split('/');
                path = parts[0] || 'Selected Folder';
            }
            // Try file.path (Electron or some browsers)
            else if ((firstFile as any).path) {
                const fullPath = (firstFile as any).path;
                const lastSlash = fullPath.lastIndexOf('\\') > fullPath.lastIndexOf('/') 
                    ? fullPath.lastIndexOf('\\') 
                    : fullPath.lastIndexOf('/');
                path = lastSlash >= 0 ? fullPath.substring(0, lastSlash) : fullPath;
            }
            // Fallback: show that folder was selected
            else {
                path = `Selected Folder (${filteredFiles.length} files)`;
            }
            
            setProjectPath(path);
        }
    };

    const handleSelectFolderClick = () => {
        fileInputRef.current?.click();
    };

    const handleLoadProject = async (path?: string) => {
        const finalPath = path || projectPath;
        if (!finalPath) {
            return;
        }
        setLoading(true);
        
        try {
            // Extract project name from path
            const projectName = finalPath.split(/[\\/]/).pop() || 'Project';
            
            // Determine type (git if it's a URL, local otherwise)
            const type: 'local' | 'git' = finalPath.startsWith('http') || finalPath.startsWith('git@') ? 'git' : 'local';
            
            // Save to recent projects
            saveRecentProject(finalPath, projectName, type);
            
            // Reload recent projects list
            setRecentProjects(loadRecentProjects());
            
            // For recent projects, try to restore files from localStorage if they exist
            let filesToLoad: FileList | undefined = selectedFiles || undefined;
            
            // If no files were selected (recent project case), try to restore from saved data
            if (!filesToLoad) {
                const savedData = localStorage.getItem('zeus-studio-data');
                if (savedData) {
                    try {
                        const data = JSON.parse(savedData);
                        // Check if saved data matches the project path
                        if (data.projectPath === finalPath && data.projectFiles) {
                            // Create FileList from saved files
                            const dataTransfer = new DataTransfer();
                            Object.entries(data.projectFiles).forEach(([filePath, content]) => {
                                const blob = new Blob([content as string], { type: 'text/plain' });
                                const fileName = filePath.split('/').pop() || filePath;
                                const file = new File([blob], fileName, { type: 'text/plain' });
                                (file as any)._relativePath = filePath;
                                dataTransfer.items.add(file);
                            });
                            filesToLoad = dataTransfer.files;
                            console.log('[ProjectLoader] 📂 Restaurando archivos del proyecto reciente:', Object.keys(data.projectFiles).length);
                        }
                    } catch (error) {
                        console.warn('[ProjectLoader] ⚠️ Error restaurando archivos del proyecto:', error);
                    }
                }
            }
            
            onProjectLoaded(finalPath, filesToLoad);
            onOpenChange(false);
            setProjectPath('');
            setSelectedFiles(null);
        } catch (error) {
            console.error('[ProjectLoader] ❌ Error cargando proyecto:', error);
            toast({
                title: 'Error',
                description: 'Error al cargar el proyecto',
                variant: 'destructive'
            });
        } finally {
            setLoading(false);
        }
    };

    const handleGitClone = () => {
        if (!gitUrl) return;
        setLoading(true);
        setTimeout(() => {
            setLoading(false);
            
            // Extract project name from git URL
            const projectName = gitUrl.split('/').pop()?.replace('.git', '') || 'Git Project';
            
            // Save to recent projects
            saveRecentProject(gitUrl, projectName, 'git');
            
            // Reload recent projects list
            setRecentProjects(loadRecentProjects());
            
            onProjectLoaded(gitUrl);
            onOpenChange(false);
            setGitUrl('');
        }, 2000);
    };

    const handleRemoveRecentProject = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (typeof window === 'undefined') return;
        try {
            const projects = loadRecentProjects();
            const filtered = projects.filter(p => p.id !== id);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
            setRecentProjects(filtered);
        } catch (error) {
            console.error('Error removing recent project:', error);
        }
    };

    // Auto-load GitHub repositories when user is available
    useEffect(() => {
        if (user) {
            // If user has GitHub token, load repositories automatically
            if (user.githubAccessToken || githubToken) {
                loadGithubRepositories();
            }
        }
    }, [user, githubToken]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>{t('loadProject')}</DialogTitle>
                    <DialogDescription>
                        {t('loadProjectInstructions')}
                    </DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="recent" className="flex-1 flex flex-col">
                    <TabsList className="grid grid-cols-5">
                        <TabsTrigger value="recent">{t('recentProjects')}</TabsTrigger>
                        <TabsTrigger value="local">{t('localProject')}</TabsTrigger>
                        <TabsTrigger value="git">{t('gitRepository')}</TabsTrigger>
                        <TabsTrigger value="github-repos">{t('githubRepositories')}</TabsTrigger>
                        <TabsTrigger value="database">{t('database')}</TabsTrigger>
                    </TabsList>

                    <div className="flex-1 overflow-auto py-4">
                        {/* Recent Projects */}
                        <TabsContent value="recent" className="space-y-4 m-0">
                            {recentProjects.length === 0 ? (
                                <div className="text-center py-12">
                                    <Folder className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                                    <h3 className="text-lg font-semibold mb-2">{t('noRecentProjects')}</h3>
                                    <p className="text-sm text-muted-foreground">
                                        {t('noRecentProjectsDesc')}
                                    </p>
                                </div>
                            ) : (
                                <div className="grid gap-4 max-h-96 overflow-y-auto pr-2">
                                    {recentProjects.map((project) => (
                                        <Card 
                                            key={project.id} 
                                            className="hover:bg-accent/50 transition-colors cursor-pointer"
                                            onClick={() => handleLoadProject(project.path)}
                                        >
                                            <CardContent className="p-4">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center space-x-3 flex-1 min-w-0">
                                                        <div className={`p-2 rounded-lg flex-shrink-0 ${project.type === 'git' ? 'bg-primary/20' : 'bg-primary/20'}`}>
                                                            {project.type === 'git' ? (
                                                                <GitBranch className="h-5 w-5 text-primary" />
                                                            ) : (
                                                                <Folder className="h-5 w-5 text-primary" />
                                                            )}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center space-x-2">
                                                                <h3 className="font-semibold truncate">{project.name}</h3>
                                                                <Badge variant="outline" className="text-xs flex-shrink-0">
                                                                    {project.type === 'git' ? 'Git' : 'Local'}
                                                                </Badge>
                                                            </div>
                                                            <p className="text-sm text-muted-foreground truncate">
                                                                {project.path}
                                                            </p>
                                                            <div className="flex items-center space-x-4 mt-1">
                                                                <span className="text-xs text-muted-foreground flex items-center">
                                                                    <Clock className="h-3 w-3 mr-1" />
                                                                    {formatTimeAgo(project.lastOpened)}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center space-x-2 flex-shrink-0">
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleLoadProject(project.path);
                                                            }}
                                                        >
                                                            {t('open')}
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={(e) => handleRemoveRecentProject(project.id, e)}
                                                            className="text-muted-foreground hover:text-destructive"
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    ))}
                                </div>
                            )}
                        </TabsContent>

                        {/* Local Project */}
                        <TabsContent value="local" className="space-y-6 m-0">
                            <input
                                ref={fileInputRef}
                                type="file"
                                {...({ webkitdirectory: '', directory: '' } as any)}
                                multiple
                                style={{ display: 'none' }}
                                onChange={handleFolderSelect}
                            />
                            <div className="space-y-4">
                                <div>
                                    <Label htmlFor="project-path">{t('projectDirectoryPath')}</Label>
                                    <div className="flex space-x-2 mt-2">
                                        <Input
                                            id="project-path"
                                            placeholder={`C:\\path\\to\\your\\nextjs\\project or click ${t('browse')}`}
                                            value={projectPath}
                                            onChange={(e) => setProjectPath(e.target.value)}
                                            className="flex-1"
                                        />
                                        <Button variant="outline" onClick={handleBrowseClick}>
                                            <FolderOpen className="h-4 w-4 mr-2" />
                                            {t('browse')}
                                        </Button>
                                    </div>
                                </div>

                                <div
                                    className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                                        dragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'
                                    }`}
                                    onDragEnter={handleDrag}
                                    onDragLeave={handleDrag}
                                    onDragOver={handleDrag}
                                    onDrop={handleDrop}
                                >
                                    <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                                    <h3 className="font-semibold mb-2">{t('dragDropProjectFolder')}</h3>
                                    <p className="text-sm text-muted-foreground mb-4">
                                        {t('orClickToBrowse')}
                                    </p>
                                    <Button variant="outline" onClick={handleSelectFolderClick}>
                                        {t('selectFolder')}
                                    </Button>
                                </div>

                                <div className="bg-muted/30 rounded-lg p-4">
                                    <div className="flex items-start space-x-3">
                                        <AlertCircle className="h-5 w-5 text-warning mt-0.5" />
                                        <div className="space-y-2">
                                            <h4 className="font-medium">{t('projectRequirements')}</h4>
                                            <ul className="text-sm space-y-1 text-muted-foreground">
                                                <li className="flex items-center">
                                                    <CheckCircle className="h-4 w-4 text-success mr-2" />
                                                    {t('nextjsStructure')}
                                                </li>
                                                <li className="flex items-center">
                                                    <CheckCircle className="h-4 w-4 text-success mr-2" />
                                                    {t('packageJsonRequired')}
                                                </li>
                                                <li className="flex items-center">
                                                    <CheckCircle className="h-4 w-4 text-success mr-2" />
                                                    {t('reactComponents')}
                                                </li>
                                            </ul>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="flex justify-end">
                                <Button 
                                    onClick={() => handleLoadProject()}
                                    disabled={loading || !projectPath}
                                >
                                    {loading ? t('loading') : t('loadProject')}
                                </Button>
                            </div>
                        </TabsContent>

                        {/* GitHub Repositories */}
                        <TabsContent value="github-repos" className="space-y-6 m-0">
                            <div className="space-y-4">
                                <div>
                                    <Label htmlFor="github-token">GitHub Personal Access Token</Label>
                                    <div className="flex space-x-2 mt-2">
                                        <Input
                                            id="github-token"
                                            type="password"
                                            placeholder={user?.githubAccessToken 
                                              ? "Token detectado automáticamente ✓" 
                                              : "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                                            }
                                            value={githubToken}
                                            onChange={(e) => setGithubToken(e.target.value)}
                                            className="flex-1"
                                            disabled={!!user?.githubAccessToken && !githubToken}
                                        />
                                        <Button 
                                            onClick={loadGithubRepositories}
                                            disabled={(!githubToken && !user?.githubAccessToken) || loadingGithub}
                                        >
                                            {loadingGithub ? t('loading') : (
                                              user?.githubAccessToken && !githubToken ? '✓ Cargado' : t('loadRepos')
                                            )}
                                        </Button>
                                    </div>
                                    <p className="text-sm text-muted-foreground mt-2">
                                        {t('generateToken')} <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">GitHub Settings</a>
                                    </p>
                                    {(user?.githubAccessToken || autoDetectedGithubToken) && (
                                        <p className="text-sm text-success mt-2">
                                            ✅ Token de GitHub detectado automáticamente desde Zeus
                                        </p>
                                    )}

                                </div>

                                {githubRepos.length > 0 && (
                                    <div className="grid gap-4 max-h-96 overflow-y-auto pr-2">
                                        {githubRepos.map((repo) => (
                                            <Card 
                                                key={repo.id} 
                                                className={`hover:bg-accent/50 transition-colors cursor-pointer ${repo.is_nextjs ? 'ring-2 ring-blue-500/30' : ''}`}
                                                onClick={() => {
                                                    if (repo.is_nextjs) {
                                                        // For Next.js projects, load directly
                                                        handleLoadNextJSProject(repo);
                                                    } else {
                                                        // For other projects, use the traditional flow
                                                        setGitUrl(repo.html_url);
                                                        // Switch to git tab and trigger clone
                                                        setTimeout(() => {
                                                            const gitTab = document.querySelector('[data-value="git"]') as HTMLElement;
                                                            if (gitTab) {
                                                                gitTab.click();
                                                                // Auto-trigger clone after switching tabs
                                                                setTimeout(() => {
                                                                    const cloneButton = document.querySelector('[data-testid="clone-button"]') as HTMLButtonElement;
                                                                    if (cloneButton) cloneButton.click();
                                                                }, 300);
                                                            }
                                                        }, 100);
                                                    }
                                                }}
                                            >
                                                <CardContent className="p-4">
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center space-x-3 flex-1 min-w-0">
                                                            <div className={`p-2 rounded-lg flex-shrink-0 ${repo.private ? 'bg-destructive/20' : 'bg-success/20'}`}>
                                                                <GitBranch className={`h-5 w-5 ${repo.private ? 'text-destructive' : 'text-success'}`} />
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-center space-x-2">
                                                                    <h3 className="font-semibold truncate">{repo.name}</h3>
                                                                    <Badge variant="outline" className="text-xs flex-shrink-0">
                                                                        {repo.private ? 'Private' : 'Public'}
                                                                    </Badge>
                                                                    {repo.is_nextjs && (
                                                                        <Badge variant="default" className="text-xs flex-shrink-0 bg-primary">
                                                                            Next.js
                                                                        </Badge>
                                                                    )}
                                                                </div>
                                                                <p className="text-sm text-muted-foreground truncate">
                                                                    {repo.description || 'No description'}
                                                                </p>
                                                                <div className="flex items-center space-x-4 mt-1">
                                                                    <span className="text-xs text-muted-foreground">
                                                                        Updated: {new Date(repo.updated_at).toLocaleDateString()}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center space-x-2 flex-shrink-0">
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    window.open(repo.html_url, '_blank');
                                                                }}
                                                            >
                                                                <ExternalLink className="h-4 w-4" />
                                                            </Button>
                                                        </div>
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        ))}
                                    </div>
                                )}

                                {githubToken && githubRepos.length === 0 && !loadingGithub && (
                                    <div className="text-center py-8">
                                        <FolderOpen className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                                        <h3 className="text-lg font-semibold mb-2">{t('noReposFound')}</h3>
                                        <p className="text-sm text-muted-foreground">
                                            Make sure your token has the 'repo' scope and you have repositories on GitHub.
                                        </p>
                                    </div>
                                )}
                            </div>
                        </TabsContent>

                        {/* Git Repository */}
                        <TabsContent value="git" className="space-y-6 m-0">
                            <div className="space-y-4">
                                <div>
                                    <Label htmlFor="git-url">{t('gitRepositoryUrl')}</Label>
                                    <div className="flex space-x-2 mt-2">
                                        <Input
                                            id="git-url"
                                            placeholder="https://github.com/username/repository.git"
                                            value={gitUrl}
                                            onChange={(e) => setGitUrl(e.target.value)}
                                            className="flex-1"
                                        />
                                        <Button variant="outline">
                                            <ExternalLink className="h-4 w-4 mr-2" />
                                            {t('browseGitHub')}
                                        </Button>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <Card>
                                        <CardHeader className="pb-3">
                                            <CardTitle className="text-sm">{t('publicRepository')}</CardTitle>
                                            <CardDescription>{t('publicRepoDesc')}</CardDescription>
                                        </CardHeader>
                                        <CardContent>
                                            <ul className="text-sm space-y-2 text-muted-foreground">
                                                <li className="flex items-center">
                                                    <CheckCircle className="h-4 w-4 text-success mr-2" />
                                                    {t('noAuthRequired')}
                                                </li>
                                                <li className="flex items-center">
                                                    <CheckCircle className="h-4 w-4 text-success mr-2" />
                                                    {t('readOnlyAccess')}
                                                </li>
                                            </ul>
                                        </CardContent>
                                    </Card>

                                    <Card>
                                        <CardHeader className="pb-3">
                                            <CardTitle className="text-sm">{t('privateRepository')}</CardTitle>
                                            <CardDescription>{t('privateRepoDesc')}</CardDescription>
                                        </CardHeader>
                                        <CardContent>
                                            <ul className="text-sm space-y-2 text-muted-foreground">
                                                <li className="flex items-center">
                                                    <FileCode className="h-4 w-4 text-primary mr-2" />
                                                    {t('githubToken')}
                                                </li>
                                                <li className="flex items-center">
                                                    <FileCode className="h-4 w-4 text-primary mr-2" />
                                                    {t('readWritePermissions')}
                                                </li>
                                            </ul>
                                        </CardContent>
                                    </Card>
                                </div>

                                <div className="bg-muted/30 rounded-lg p-4">
                                    <div className="flex items-start space-x-3">
                                        <AlertCircle className="h-5 w-5 text-primary mt-0.5" />
                                        <div>
                                            <h4 className="font-medium">{t('gitIntegrationFeatures')}</h4>
                                            <p className="text-sm text-muted-foreground mt-1">
                                                {t('gitIntegrationDesc')}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="flex justify-end space-x-2">
                                <Button variant="outline" onClick={() => setGitUrl('')}>
                                    {t('clear')}
                                </Button>
                                <Button 
                                    onClick={handleGitClone}
                                    disabled={!gitUrl || loading}
                                >
                                    {loading ? t('cloning') : t('cloneAndLoad')}
                                </Button>
                            </div>
                        </TabsContent>

                        {/* Database Projects */}
                        <TabsContent value="database" className="space-y-4 m-0">
                            {!user ? (
                                <div className="text-center py-12">
                                    <Database className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                                    <h3 className="text-lg font-semibold mb-2">{t('loginRequired')}</h3>
                                    <p className="text-sm text-muted-foreground mb-4">
                                        {t('loginRequiredDesc')}
                                    </p>
                                </div>
                            ) : loadingDatabase ? (
                                <div className="text-center py-12">
                                    <Loader2 className="h-12 w-12 mx-auto mb-4 text-muted-foreground animate-spin" />
                                    <p className="text-sm text-muted-foreground">{t('loading')}</p>
                                </div>
                            ) : databaseProjects.length === 0 ? (
                                <div className="text-center py-12">
                                    <Database className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                                    <h3 className="text-lg font-semibold mb-2">{t('noDatabaseProjects')}</h3>
                                    <p className="text-sm text-muted-foreground">
                                        {t('noDatabaseProjectsDesc')}
                                    </p>
                                </div>
                            ) : (
                                <div className="grid gap-4 max-h-96 overflow-y-auto pr-2">
                                    {databaseProjects.map((project) => (
                                        <Card 
                                            key={project.id} 
                                            className="hover:bg-accent/50 transition-colors cursor-pointer"
                                            onClick={() => handleLoadDatabaseProject(project)}
                                        >
                                            <CardContent className="p-4">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center space-x-3 flex-1 min-w-0">
                                                        <div className="p-2 rounded-lg flex-shrink-0 bg-accent/20">
                                                            <Database className="h-5 w-5 text-accent" />
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center space-x-2">
                                                                <h3 className="font-semibold truncate">{project.name || 'Sin nombre'}</h3>
                                                                <Badge variant="outline" className="text-xs flex-shrink-0">
                                                                    Base de Datos
                                                                </Badge>
                                                            </div>
                                                            <p className="text-sm text-muted-foreground">
                                                                {new Date(project.created).toLocaleDateString('es-ES', {
                                                                    year: 'numeric',
                                                                    month: 'long',
                                                                    day: 'numeric'
                                                                })}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center space-x-2 flex-shrink-0">
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleLoadDatabaseProject(project);
                                                            }}
                                                            disabled={downloadingProject === project.id}
                                                        >
                                                            {downloadingProject === project.id ? (
                                                                <>
                                                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                                                    {t('downloading')}
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <Download className="h-4 w-4 mr-2" />
                                                                    {t('load')}
                                                                </>
                                                            )}
                                                        </Button>
                                                    </div>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    ))}
                                </div>
                            )}
                        </TabsContent>
                    </div>
                </Tabs>

                <div className="border-t pt-4">
                    <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center space-x-2 text-muted-foreground">
                            <AlertCircle className="h-4 w-4" />
                            <span>{t('projectAnalysisTime')}</span>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                            {t('cancel')}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
