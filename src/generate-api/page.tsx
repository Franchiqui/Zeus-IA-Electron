'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { generatePbSchema } from '@/lib/generatePbSchema';
import { motion, AnimatePresence } from 'framer-motion';
import {
  UploadIcon,
  Settings,
  Code2,
  FileText,
  Database,
  PlayCircle,
  History,
  ThumbsUp,
  ThumbsDown,
  RefreshCw,
  ChevronRight,
  ChevronLeft,
  X,
  CheckCircle,
  AlertCircle,
  Loader2,
  FolderIcon,
  FolderOpenIcon,
  DownloadIcon,
  Save,
  Folder,
  BarChart3,
  Zap,
  Box,
  Wand2,
  Wrench,
  LinkIcon,
  Rocket,
  Sparkles,
  MessageSquare,
  MonitorDown,
  FolderOpen,
  ChevronDown,
  GitCompare,
  FileImage,
  File as FileIcon,
  FileCode,
  FileJson,
  Eye,
  Code,
  Circle,
  Database as DatabaseIcon,
  Copy,
  List
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import JSZip from 'jszip';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { useProject } from '@/context/ProjectContext';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import Footer from '@/components/layout/footer';
import { filterBrowserFilesForContext, filterGenerateFileParts } from '../lib/generateApiContextFilter';
import { mergeOptionalDependenciesFromApiCode, sanitizeGeneratedApiTsCode } from '../lib/sanitizeGeneratedApiCode';

interface FileSystemDirectoryHandle {
  name: string;
  kind: 'directory';
}

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      mode?: 'read' | 'readwrite';
      startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
    }) => Promise<FileSystemDirectoryHandle>;
  }
}

interface FileWithRelativePath extends File {
  webkitRelativePath: string;
}

const projectSchema = z.object({
  title: z.string().min(1, 'El título es requerido').max(100),
  description: z.string().min(10, 'La descripción debe tener al menos 10 caracteres').max(50000),
  modelType: z.enum(['chat', 'reasoning']),
  selectedFolders: z.array(z.string()).optional(),
});

const modelConfigSchema = z.object({
  apiKey: z.string().optional(),
  model: z.string().min(1, 'El modelo es requerido'),
  temperature: z.number().min(0).max(2),
  apiBaseUrl: z.string().optional(),
  maxTokens: z.number().min(1).max(8192),
});

type ProjectFormData = z.infer<typeof projectSchema>;
type ModelConfigData = z.infer<typeof modelConfigSchema>;

interface ApiEndpoint {
  id: string;
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD';
  description: string;
  parameters: Record<string, any>;
}

interface GeneratedApi {
  id: string;
  title: string;
  description: string;
  code: string;
  documentation: string;
  schemas: string;
  endpoints: ApiEndpoint[];
  createdAt: Date;
}

// Función para normalizar datos de PocketBase a GeneratedApi
const normalizePocketBaseProject = (pbProject: any): GeneratedApi => {
  return {
    id: pbProject.id,
    title: pbProject.title || '',
    description: pbProject.description || '',
    code: pbProject.code || '',
    documentation: pbProject.documentation || '',
    schemas: pbProject.schemas || '',
    endpoints: typeof pbProject.endpoints === 'string' 
      ? JSON.parse(pbProject.endpoints || '[]') 
      : (pbProject.endpoints || []),
    createdAt: new Date(pbProject.created || pbProject.createdAt || Date.now())
  };
};

const testimonials = [
  {
    id: 1,
    name: 'Carlos Rodríguez',
    role: 'CTO en TechStartup',
    content: 'API Architect AI redujo nuestro tiempo de desarrollo de APIs en un 70%. Increíble herramienta.',
    avatar: 'CR',
  },
  {
    id: 2,
    name: 'Ana Martínez',
    role: 'Lead Developer',
    content: 'La calidad del código generado es excepcional. Los esquemas TypeScript son perfectos.',
    avatar: 'AM',
  },
  {
    id: 3,
    name: 'David Chen',
    role: 'Product Manager',
    content: 'De idea a API funcional en menos de 10 minutos. Revolucionario.',
    avatar: 'DC',
  },
];

const features = [
  {
    title: 'Código TypeScript',
    description: 'Genera APIs con TypeScript tipado y listo para producción.',
    icon: Code2,
    color: 'text-primary',
  },
  {
    title: 'Documentación Automática',
    description: 'Documentación OpenAPI generada automáticamente.',
    icon: FileText,
    color: 'text-green-500',
  },
  {
    title: 'Esquemas Validados',
    description: 'Esquemas Zod/TypeScript para validación de datos.',
    icon: Database,
    color: 'text-accent',
  },
  {
    title: 'Pruebas Integradas',
    description: 'Probador de endpoints integrado con ejemplos reales.',
    icon: PlayCircle,
    color: 'text-warning',
  },
  {
    title: 'Historial de Versiones',
    description: 'Mantén un historial completo de todas tus APIs generadas.',
    icon: History,
    color: 'text-destructive',
  },
  {
    title: 'Feedback Inteligente',
    description: 'Mejora iterativamente tus APIs con feedback contextual.',
    icon: RefreshCw,
    color: 'text-indigo-500',
  },
];

const categories = [
  { name: 'E-commerce', count: 12 },
  { name: 'Redes Sociales', count: 8 },
  { name: 'Fintech', count: 15 },
  { name: 'Salud', count: 7 },
  { name: 'Educación', count: 9 },
  { name: 'IoT', count: 11 },
];

const galleryImages = [
  { id: 1, title: 'API REST Completa', description: 'CRUD completo con autenticación' },
  { id: 2, title: 'WebSocket Real-time', description: 'Conexiones en tiempo real' },
  { id: 3, title: 'GraphQL Endpoint', description: 'Schema GraphQL optimizado' },
  { id: 4, title: 'Microservicios', description: 'Arquitectura distribuida' },
];

export default function HomePage() {
  const { user } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const { models, selectedModel, setSelectedModelId } = useModel();
  const { projectRoot, projectId } = useProject();
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState < File[] > ([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingDescription, setIsGeneratingDescription] = useState(false);
  const [activeTab, setActiveTab] = useState < 'code' | 'docs' | 'schemas' > ('code');
  const [selectedEndpoint, setSelectedEndpoint] = useState < string > ('');
  const [testResponse, setTestResponse] = useState < any > (null);
  const [isTesting, setIsTesting] = useState(false);
  const [generatedApi, setGeneratedApi] = useState < GeneratedApi | null > (null);
  const [feedback, setFeedback] = useState('');
  const [projects, setProjects] = useState < GeneratedApi[] > ([]);
  const [availableFolders, setAvailableFolders] = useState < string[] > ([]);
  const [isFolderSelectorOpen, setIsFolderSelectorOpen] = useState(false);
  const [modelConfig, setModelConfig] = useState < ModelConfigData | null > (null);
  
  // Estado adicional para el header del editor
  const [isProjectLoaderOpen, setIsProjectLoaderOpen] = useState(false);
  const [projectRefreshKey, setProjectRefreshKey] = useState(0);
  const [externalSelect, setExternalSelect] = useState<{ projectId?: string; conversationId?: string } | null>(null);
  const [isConversationHistoryOpen, setIsConversationHistoryOpen] = useState(false);
  const [activeProject, setActiveProject] = useState(null);
  const [projectTypeIndicator, setProjectTypeIndicator] = useState<'database' | 'local' | 'unknown'>('unknown');
  const [isUtilitiesOpen, setIsUtilitiesOpen] = useState(false);
  const [currentBranch, setCurrentBranch] = useState('main');
  const [isBackupRunning, setIsBackupRunning] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // Funciones para manejar modelos
  const handleModelSelect = useCallback((modelId: string) => {
    setSelectedModelId(modelId);
  }, [setSelectedModelId]);

  // Funciones adicionales para el header
  const handleSelectConversation = useCallback((conversationId: string) => {
    console.log('Seleccionando conversación:', conversationId);
  }, []);

  const handleProjectChange = useCallback((project: any) => {
    setActiveProject(project);
  }, []);

  useEffect(() => {
    if (!projectId || !user?.id) return;
    fetch(`/api/projects?id=${projectId}&userId=${user.id}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) setActiveProject(data); })
      .catch(() => {});
  }, [projectId, user?.id]);

  const handleOpenCreateProjectDialog = useCallback(() => {
    setIsProjectModalOpen(true);
  }, []);

  const handleSaveAllChanges = useCallback(() => {
    console.log('Guardando cambios...');
  }, []);

  // Función para obtener configuración del modelo seleccionado
  const getSelectedModelConfig = useCallback(() => {
    console.log('🔍 getSelectedModelConfig llamado');
    console.log('📋 selectedModel:', selectedModel);
    console.log('📁 models:', models);
    console.log('📊 models.length:', models.length);
    
    if (!selectedModel) {
      console.log('❌ No hay modelo seleccionado');
      return null;
    }
    
    if (!models || models.length === 0) {
      console.log('❌ No hay modelos disponibles');
      return null;
    }
    
    console.log('🎯 Modelo encontrado:', selectedModel);
    
    const config: { 
      apiKey?: string; 
      model: string; 
      temperature: number; 
      maxTokens: number; 
      apiBaseUrl?: string;
      type?: string;
      provider?: string;
    } = {
      apiKey: selectedModel.apiKey || '',
      model: selectedModel.model || 'deepseek-chat',
      temperature: selectedModel.temperature || 0.7,
      maxTokens: selectedModel.maxTokens || 4000,
      apiBaseUrl: (selectedModel as any).apiBaseUrl || undefined,
      type: (selectedModel as any).type || '',
      provider: (selectedModel as any).provider || '',
    };
    
    console.log('✅ Configuración del modelo:', config);
    console.log('🔑 API Key existe:', !!config.apiKey);
    
    return config;
  }, [selectedModel, models]);

  // Función para cargar archivos del proyecto actual
  const loadCurrentProjectFiles = useCallback(async () => {
    if (!projectRoot) {
      toast({
        title: 'Error',
        description: 'No hay un proyecto abierto en el editor',
        variant: 'destructive'
      });
      return;
    }

    try {
      // Listar archivos del proyecto actual
      const response = await fetch('/api/list-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectRoot })
      });

      if (!response.ok) {
        throw new Error('Error al listar archivos del proyecto');
      }

      const data = await response.json();
      const projectFiles = data.files;

      // Convertir projectFiles a array si es un objeto
      let filesArray: any[] = [];
      if (Array.isArray(projectFiles)) {
        filesArray = projectFiles;
      } else if (projectFiles && typeof projectFiles === 'object') {
        // Convertir objeto a array de nodos
        filesArray = Object.entries(projectFiles).map(([path, content]) => ({
          path,
          content,
          name: path.split('/').pop() || path
        }));
      }

      // Verificar que tengamos archivos
      if (filesArray.length === 0) {
        console.error('Error: No se encontraron archivos válidos');
        toast({
          title: 'Error',
          description: 'La respuesta del servidor no contiene archivos válidos',
          variant: 'destructive'
        });
        return;
      }

      type PathPart = { originalname: string; content: string };
      const pathParts: PathPart[] = [];

      const processFileNode = (node: any) => {
        if (node.path && node.content && typeof node.content === 'string') {
          const rel = String(node.path).replace(/\\/g, '/');
          pathParts.push({ originalname: rel, content: node.content });
        }
        if (node.children && Array.isArray(node.children)) {
          node.children.forEach((child: any) => processFileNode(child));
        }
      };

      filesArray.forEach((file: any) => processFileNode(file));

      const { kept, dropped, usedFallback } = filterGenerateFileParts(pathParts, 25);
      const files: File[] = kept.map((p) => {
        const blob = new Blob([p.content], { type: 'text/plain' });
        return new File([blob], p.originalname, { type: 'text/plain' }) as unknown as File;
      });

      setUploadedFiles(files);

      toast({
        title: 'Proyecto cargado',
        description:
          dropped > 0
            ? `${files.length} archivos relevantes (pages/API/rutas). Omitidos ${dropped} del proyecto completo${usedFallback ? ' (fallback acotado).' : '.'}`
            : `Se cargaron ${files.length} archivos del proyecto actual`,
        variant: 'default'
      });

    } catch (error) {
      console.error('Error cargando archivos del proyecto:', error);
      toast({
        title: 'Error',
        description: 'No se pudieron cargar los archivos del proyecto',
        variant: 'destructive'
      });
    }
  }, [projectRoot, toast, setUploadedFiles]);

  // Función para cargar una API guardada desde el proyecto actual
  const handleLoadSavedApi = useCallback(async () => {
    if (!projectRoot) {
      toast({
        title: 'Error',
        description: 'No hay un proyecto abierto en el editor',
        variant: 'destructive'
      });
      return;
    }

    try {
      const response = await fetch('/api/read-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: 'API/zeus-api-config.json', projectRoot })
      });

      if (!response.ok) {
        throw new Error('No se encontró una API guardada en este proyecto (API/zeus-api-config.json)');
      }

      const data = await response.json();
      if (!data.success || !data.content) {
        throw new Error('El archivo de configuración está vacío o corrupto');
      }

      const config = JSON.parse(data.content);
      const loadedApi: GeneratedApi = {
        id: config.id || `local-${Date.now()}`,
        title: config.title || 'API sin título',
        description: config.description || '',
        code: config.code || '',
        documentation: config.documentation || '',
        schemas: config.schemas || '',
        endpoints: Array.isArray(config.endpoints) ? config.endpoints : [],
        createdAt: config.createdAt ? new Date(config.createdAt) : new Date()
      };

      setGeneratedApi(loadedApi);
      toast({
        title: 'API cargada',
        description: `"${loadedApi.title}" cargada desde el proyecto`,
        variant: 'default'
      });
    } catch (error: any) {
      console.error('Error cargando API guardada:', error);
      toast({
        title: 'Error',
        description: error.message || 'No se pudo cargar la API guardada',
        variant: 'destructive'
      });
    }
  }, [projectRoot, toast]);

  const isLocalProject = useCallback((project: any, projectRoot: string) => {
    return !projectRoot || projectRoot.startsWith('local-');
  }, []);

  const shortenPath = useCallback((path: string) => {
    if (!path) return '';
    const parts = path.split(/[\/\\]/);
    if (parts.length <= 3) return path;
    return '.../' + parts.slice(-2).join('/');
  }, []);

  const navigateToProtectedUrl = useCallback((url: string, user: any, router: any, toast: any, selectedModel: any, isBackupRunning: boolean) => {
    if (!user) {
      toast({
        title: 'Error',
        description: 'Debes iniciar sesión para acceder',
        variant: 'destructive'
      });
      return;
    }
    window.open(url, '_blank');
  }, []);

  const projectForm = useForm < ProjectFormData > ({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      title: '',
      description: '',
      modelType: 'chat',
      selectedFolders: [],
    },
  });

  const modelConfigForm = useForm < ModelConfigData > ({
    resolver: zodResolver(modelConfigSchema),
    defaultValues: {
      apiKey: '',
      model: 'deepseek-chat',
      temperature: 0.7,
      maxTokens: 2000,
    },
  });

  const handleFileSelect = useCallback((files: FileList) => {
    const newFiles = Array.from(files).filter(
      (file) =>
        file.name.endsWith('.ts') ||
        file.name.endsWith('.tsx') ||
        file.name.endsWith('.js') ||
        file.name.endsWith('.jsx') ||
        file.name.endsWith('.json')
    );
    const filtered = filterBrowserFilesForContext(newFiles, 25);
    setUploadedFiles((prev) => [...prev, ...filtered]);
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelect(e.dataTransfer.files);
    }
  }, [handleFileSelect]);

  const handleGenerateApi = useCallback(async (data: ProjectFormData) => {
    setIsGenerating(true);

    try {
      // Verificar que hay un modelo seleccionado
      let modelConfigFromContext = getSelectedModelConfig();
      console.log('🚀 Iniciando handleGenerateApi');
      console.log('📋 ModelConfig del contexto:', modelConfigFromContext);
      
      // Si no hay modelo del contexto, usar el modelConfig local
      let finalModelConfig = modelConfigFromContext;
      if (!modelConfigFromContext && modelConfig) {
        console.log('🔄 Usando modelConfig local como fallback');
        finalModelConfig = modelConfig;
      }
      
      console.log('📋 ModelConfig final:', finalModelConfig);
      
      if (!finalModelConfig) {
        console.log('❌ No hay configuración del modelo disponible');
        toast({
          title: 'Error de configuración',
          description: 'Por favor selecciona un modelo en la barra de navegación superior y asegúrate de que tenga una API Key configurada',
          variant: 'destructive'
        });
        throw new Error('Por favor selecciona un modelo en la barra de navegación superior y asegúrate de que tenga una API Key configurada');
      }
      
      if (!finalModelConfig.apiKey) {
        console.log('❌ La API Key está vacía');
        toast({
          title: 'API Key faltante',
          description: 'El modelo seleccionado no tiene una API Key configurada. Por favor, configura la API Key en el selector de modelos.',
          variant: 'destructive'
        });
        throw new Error('El modelo seleccionado no tiene una API Key configurada');
      }

      const formData = new FormData();
      formData.append('title', data.title);
      formData.append('description', data.description);
      formData.append('modelType', data.modelType);
      
      // Añadir carpetas seleccionadas
      if (data.selectedFolders && data.selectedFolders.length > 0) {
        data.selectedFolders.forEach(folder => {
          formData.append('selectedFolders', folder);
        });
      }
      
      uploadedFiles.forEach(file => {
        formData.append('files', file);
      });

      // Obtener configuración del modelo seleccionado
      const modelConfigStr = finalModelConfig ? JSON.stringify(finalModelConfig) : null;
      
      const response = await fetch('/api/generate-api/generate', {
        method: 'POST',
        headers: {
          // Enviar configuración del modelo en headers
          ...(modelConfigStr && { 'x-model-config': modelConfigStr }),
          // Enviar userId si el usuario está autenticado
          ...(user?.id && { 'x-user-id': user.id })
        },
        body: formData,
      });

      if (!response.ok) {
        let errorMsg = 'Error generando API';
        try {
          const errorData = await response.json();
          errorMsg = errorData.error || errorMsg;
        } catch {
          errorMsg = await response.text().catch(() => errorMsg);
        }
        throw new Error(errorMsg);
      }

      const result = await response.json();
      
      console.log('📋 Datos recibidos de la API:', result);
      console.log('📋 Datos del formulario (data):', {
        title: data.title,
        description: data.description
      });
      
      const newApi: GeneratedApi = {
        id: Date.now().toString(),
        title: data.title,
        description: data.description,
        code: result.code || '// API generada aquí\n',
        documentation: result.documentation || '# Documentación\n',
        schemas: result.schemas || '// Esquemas TypeScript\n',
        endpoints: result.endpoints || [],
        createdAt: new Date(),
      };

      setGeneratedApi(newApi);
      
      // Guardar en la base de datos a través de nuestra API
      try {
        const saveResponse = await fetch('/api/generate-api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newApi),
        });
        
        if (saveResponse.ok) {
          const savedProject = await saveResponse.json();
          console.log('✅ Proyecto guardado en PocketBase:', savedProject);
          console.log('📋 Actualizando lista de proyectos...');
          
          // Normalizar el proyecto guardado
          const normalizedProject = normalizePocketBaseProject(savedProject);
          
          setProjects(prev => {
            console.log('📋 Proyectos antes:', prev.length);
            const updated = [normalizedProject, ...prev];
            console.log('📋 Proyectos después:', updated.length);
            return updated;
          });
        } else {
          console.error('❌ Error guardando proyecto:', saveResponse.status);
          // Fallback si la base de datos no está lista
          setProjects(prev => [newApi, ...prev]);
        }
      } catch (error) {
        console.error('Error guardando proyecto:', error);
        setProjects(prev => [newApi, ...prev]);
      }
      
      setIsProjectModalOpen(false);

    } catch (error) {
      console.error('Error:', error);
      alert('Error generando API: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsGenerating(false);
    }
  }, [uploadedFiles, getSelectedModelConfig, modelConfig, user, toast]);

  const handleTestEndpoint = useCallback(async () => {
    if (!selectedEndpoint || !generatedApi) return;

    setIsTesting(true);
    try {
      const endpoint = generatedApi.endpoints.find(e => e.id === selectedEndpoint);
      if (!endpoint) return;

      // Construir opciones de fetch basadas en el método
      const fetchOptions: RequestInit = {
        method: endpoint.method,
        headers: { 'Content-Type': 'application/json' },
      };

      // Solo incluir body para métodos que lo permiten (POST, PUT, DELETE, PATCH)
      if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(endpoint.method)) {
        fetchOptions.body = JSON.stringify(endpoint.parameters);
      }

      // Replace path parameters like {id}, {userId} etc. with a sample value
      const testPath = endpoint.path
        .replace(/\{[^}]+\}/g, '1')
        .replace(/^\//, '');
      const response = await fetch(`/api/test/${testPath}`, fetchOptions);

      // Verificar si la respuesta es válida antes de parsear JSON
      let data;
      const responseText = await response.text();
      
      if (responseText.trim()) {
        try {
          data = JSON.parse(responseText);
        } catch (jsonError) {
          console.error('Error parsing JSON:', jsonError);
          data = { error: 'Invalid JSON response', rawResponse: responseText };
        }
      } else {
        data = { message: 'Empty response', status: response.status };
      }

      setTestResponse({
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: data,
      });
    } catch (error) {
      console.error('Error testing endpoint:', error);
      setTestResponse({
        status: 500,
        headers: {},
        body: { error: 'Network error', message: error instanceof Error ? error.message : 'Unknown error' }
      });
    } finally {
      setIsTesting(false);
    }
  }, [selectedEndpoint, generatedApi]);

  const handleDeleteProject = async (projectId: string) => {
    if (!confirm('¿Estás seguro de que quieres eliminar este proyecto?')) return;
    
    try {
      // Eliminar de la base de datos a través de nuestra API
      const response = await fetch(`/api/generate-api/projects/${projectId}`, {
        method: 'DELETE',
      });
      
      if (response.ok) {
        setProjects(prev => prev.filter(p => p.id !== projectId));
        console.log('Proyecto eliminado de la base de datos:', projectId);
      } else {
        // Fallback: eliminar del estado aunque falle el servidor
        setProjects(prev => prev.filter(p => p.id !== projectId));
      }
    } catch (error) {
      console.error('Error eliminando proyecto:', error);
      setProjects(prev => prev.filter(p => p.id !== projectId));
    }
  };

  const handleDownloadProject = useCallback(() => {
    if (!generatedApi) return;
    
    // Crear un objeto con todos los archivos del proyecto
    const apiCode = sanitizeGeneratedApiTsCode(
      generatedApi.code,
      generatedApi.title,
      generatedApi.description || '',
      generatedApi.endpoints,
      generatedApi.documentation
    );

    const packageJson = {
      name: generatedApi.title.toLowerCase().replace(/\s+/g, '-'),
      version: '1.0.0',
      description: generatedApi.description,
      main: 'api.ts',
      scripts: {
        start: 'ts-node api.ts',
        dev: 'ts-node-dev api.ts'
      },
      dependencies: {
        'express': '^4.18.2',
        'zod': '^3.22.4',
        'pocketbase': '^0.21.1',
        'swagger-ui-express': '^5.0.0',
        'swagger-jsdoc': '^6.2.8',
        'cors': '^2.8.5',
        'dotenv': '^16.3.1'
      } as Record<string, string>,
      devDependencies: {
        '@types/express': '^4.17.21',
        '@types/swagger-ui-express': '^4.1.6',
        '@types/swagger-jsdoc': '^6.0.4',
        '@types/cors': '^2.8.17',
        '@types/node': '^20.10.5',
        'ts-node': '^10.9.2',
        'ts-node-dev': '^2.0.0',
        'typescript': '^5.3.3'
      } as Record<string, string>
    };

    mergeOptionalDependenciesFromApiCode(apiCode, packageJson.dependencies, packageJson.devDependencies);

    const tsConfig = {
      compilerOptions: {
        target: 'ES2020',
        module: 'CommonJS',
        lib: ['ES2020'],
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        outDir: './dist'
      }
    };

    const projectFiles = {
      'package.json': JSON.stringify(packageJson, null, 2),
      'tsconfig.json': JSON.stringify(tsConfig, null, 2),
      'README.md': `# ${generatedApi.title}\n\n${generatedApi.description}\n\n## Instalación\n\n\`\`\`bash\nnpm install\n\`\`\`\n\n## Ejecución\n\n\`\`\`bash\nnpm start\n\`\`\`\n\n## Documentación API\n\nVisita \`http://localhost:3150/api-docs\` una vez iniciado el servidor.\n\n${generatedApi.documentation}`,
      'api.ts': apiCode,
      'schemas.ts': generatedApi.schemas,
      '.env.example': 'POCKETBASE_URL=http://localhost:8090\nPORT=3150\nAPI_URL=http://localhost:3150',
      'documentation.md': generatedApi.documentation,
      'endpoints.json': JSON.stringify(generatedApi.endpoints, null, 2)
    };
    
    // Crear un ZIP con todos los archivos
    const zip = new JSZip();
    
    // Añadir cada archivo al ZIP
    Object.entries(projectFiles).forEach(([filename, content]) => {
      zip.file(filename, content);
    });
    
    // Generar el ZIP y descargarlo
    zip.generateAsync({ type: 'blob' })
      .then((blob: Blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${generatedApi.title.replace(/\s+/g, '-')}-api-project.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      })
      .catch((error: Error) => {
        console.error('Error generando ZIP:', error);
        alert('Error al descargar el proyecto');
      });
  }, [generatedApi]);

  const handleSaveToProject = useCallback(async () => {
    if (!generatedApi) return;
    if (!projectRoot) {
      toast({
        title: 'Error',
        description: 'No hay un proyecto abierto en el editor. Abre un proyecto primero.',
        variant: 'destructive'
      });
      return;
    }

    const apiCode = sanitizeGeneratedApiTsCode(
      generatedApi.code,
      generatedApi.title,
      generatedApi.description || '',
      generatedApi.endpoints,
      generatedApi.documentation
    );

    const packageJson = {
      name: generatedApi.title.toLowerCase().replace(/\s+/g, '-'),
      version: '1.0.0',
      description: generatedApi.description,
      main: 'api.ts',
      scripts: {
        start: 'ts-node api.ts',
        dev: 'ts-node-dev api.ts'
      },
      dependencies: {
        'express': '^4.18.2',
        'zod': '^3.22.4',
        'pocketbase': '^0.21.1',
        'swagger-ui-express': '^5.0.0',
        'swagger-jsdoc': '^6.2.8',
        "multer": "^1.4.5-lts.1",
        'cors': '^2.8.5',
        'dotenv': '^16.3.1'
      } as Record<string, string>,
      devDependencies: {
        '@types/express': '^4.17.21',
        '@types/swagger-ui-express': '^4.1.6',
        '@types/swagger-jsdoc': '^6.0.4',
        '@types/cors': '^2.8.17',
        "@types/multer": "^1.4.12",
        '@types/node': '^20.10.5',
        'ts-node': '^10.9.2',
        'ts-node-dev': '^2.0.0',
        'typescript': '^5.3.3'
      } as Record<string, string>
    };

    mergeOptionalDependenciesFromApiCode(apiCode, packageJson.dependencies, packageJson.devDependencies);

    const tsConfig = {
      compilerOptions: {
        target: 'ES2020',
        module: 'CommonJS',
        lib: ['ES2020'],
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        outDir: './dist'
      }
    };

    const filesToSave: Record<string, string> = {
      'API/package.json': JSON.stringify(packageJson, null, 2),
      'API/tsconfig.json': JSON.stringify(tsConfig, null, 2),
      'API/README.md': `# ${generatedApi.title}\n\n${generatedApi.description}\n\n## Instalación\n\n\`\`\`bash\nnpm install\n\`\`\`\n\n## Ejecución\n\n\`\`\`bash\nnpm start\n\`\`\`\n\n## Documentación API\n\nVisita \`http://localhost:3150/api-docs\` una vez iniciado el servidor.\n\n${generatedApi.documentation}`,
      'API/api.ts': apiCode,
      'API/schemas.ts': generatedApi.schemas,
      'API/.env.example': 'POCKETBASE_URL=http://localhost:8090\nPORT=3150\nAPI_URL=http://localhost:3150',
      'API/documentation.md': generatedApi.documentation,
      'API/endpoints.json': JSON.stringify(generatedApi.endpoints, null, 2),
      'API/zeus-api-config.json': JSON.stringify({
        title: generatedApi.title,
        description: generatedApi.description,
        code: generatedApi.code,
        documentation: generatedApi.documentation,
        schemas: generatedApi.schemas,
        endpoints: generatedApi.endpoints,
        createdAt: generatedApi.createdAt.toISOString?.() || new Date().toISOString(),
        zeusApiVersion: '1.0'
      }, null, 2),
      'API/pb_schema.json': generatePbSchema(generatedApi.endpoints || [], generatedApi.title)
    };

    let savedCount = 0;
    let errorCount = 0;

    for (const [filePath, content] of Object.entries(filesToSave)) {
      try {
        const res = await fetch('/api/save-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath, content, projectRoot })
        });
        if (res.ok) {
          savedCount++;
          console.log(`[API Generator] Guardado: ${filePath}`);
        } else {
          errorCount++;
          console.error(`[API Generator] Error guardando ${filePath}:`, await res.text());
        }
      } catch (err) {
        errorCount++;
        console.error(`[API Generator] Excepción guardando ${filePath}:`, err);
      }
    }

    toast({
      title: errorCount === 0 ? 'API guardada en el proyecto' : 'API guardada con advertencias',
      description: `${savedCount} archivo(s) guardado(s) en la carpeta API.${errorCount > 0 ? ` ${errorCount} error(es).` : ''}`,
      variant: errorCount === 0 ? 'default' : 'destructive'
    });
  }, [generatedApi, projectRoot, toast]);

  const handleRegenerateWithFeedback = useCallback(async () => {
    if (!generatedApi || !feedback) return;

    setIsGenerating(true);
    try {
      // Verificar que hay un modelo seleccionado
      let modelConfigFromContext = getSelectedModelConfig();
      
      // Si no hay modelo del contexto, usar el modelConfig local
      let finalModelConfig = modelConfigFromContext;
      if (!modelConfigFromContext && modelConfig) {
        finalModelConfig = modelConfig;
      }
      
      if (!finalModelConfig) {
        toast({
          title: 'Error de configuración',
          description: 'Por favor selecciona un modelo en la barra de navegación superior',
          variant: 'destructive'
        });
        return;
      }
      
      const formData = new FormData();
      
      // Agregar los datos del proyecto original
      formData.append('title', generatedApi.title);
      formData.append('description', generatedApi.description);
      formData.append('modelType', 'rest-api');
      
      // Pasar el código existente y el feedback por separado para que el backend
      // use buildFeedbackPrompt (modifica la API existente en vez de crear una nueva)
      formData.append('existing_code', generatedApi.code || '');
      formData.append('feedback_text', feedback);
      
      // Indicar al endpoint que NO guarde en PocketBase (evitar duplicados)
      // La actualización se hace con PUT más abajo
      formData.append('skip_save', 'true');
      
      // Obtener configuración del modelo seleccionado
      const modelConfigStr = finalModelConfig ? JSON.stringify(finalModelConfig) : null;
      
      const response = await fetch('/api/generate-api/generate', {
        method: 'POST',
        headers: {
          // Enviar configuración del modelo en headers
          ...(modelConfigStr && { 'x-model-config': modelConfigStr }),
          // Enviar userId si el usuario está autenticado
          ...(user?.id && { 'x-user-id': user.id })
        },
        body: formData,
      });

      if (!response.ok) {
        let errorMsg = 'Error regenerando API';
        try {
          const errorData = await response.json();
          errorMsg = errorData.error || errorMsg;
        } catch {
          errorMsg = await response.text().catch(() => errorMsg);
        }
        throw new Error(errorMsg);
      }

      const result = await response.json();
      
      const updatedApi = generatedApi ? { ...generatedApi, ...result } : null;
      setGeneratedApi(updatedApi);
      setFeedback('');

      // Guardar cambios en PocketBase si el proyecto tiene ID
      if (updatedApi && generatedApi?.id) {
        try {
          const saveRes = await fetch(`/api/generate-api/projects/${generatedApi.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code: updatedApi.code,
              documentation: updatedApi.documentation,
              schemas: updatedApi.schemas,
              endpoints: updatedApi.endpoints,
            }),
          });
          if (saveRes.ok) {
            console.log('✅ Proyecto actualizado en PocketBase tras feedback');
            setProjects(prev => prev.map(p => p.id === generatedApi.id ? updatedApi : p));
          } else {
            console.error('❌ Error actualizando proyecto:', saveRes.status);
          }
        } catch (saveErr) {
          console.error('Error guardando feedback en PocketBase:', saveErr);
        }
      }

    } catch (error) {
      console.error('Error:', error);
      toast({
        title: 'Error',
        description: 'No se pudo regenerar la API con el feedback',
        variant: 'destructive'
      });
    } finally {
      setIsGenerating(false);
    }
  }, [generatedApi, feedback, modelConfig, getSelectedModelConfig, user, toast]);

  useEffect(() => {
    const loadProjects = async () => {
      try {
        const headers: Record<string, string> = {};
        if (user?.token) headers['Authorization'] = `Bearer ${user.token}`;
        const response = await fetch('/api/generate-api/projects', { headers });
        if (response.ok) {
          const data = await response.json();
          console.log('📋 Proyectos crudos desde PocketBase:', data);
          console.log('📋 Número de proyectos:', data.length);
          
          // Normalizar los datos de PocketBase
          const normalizedProjects = data.map(normalizePocketBaseProject);
          console.log('📋 Proyectos normalizados:', normalizedProjects);
          
          setProjects(normalizedProjects);
        } else {
          console.error('❌ Error cargando proyectos:', response.status);
        }
      } catch (error) {
        console.error('Error loading projects:', error);
      }
    };

    loadProjects();
  }, [user]);

  const selectNativeFolder = async () => {
    try {
      // Usar File System Access API para seleccionar carpetas
      if (window.showDirectoryPicker) {
        const dirHandle = await window.showDirectoryPicker({
          mode: 'read',
          startIn: 'documents'
        });
        
        // Obtener la ruta de la carpeta seleccionada
        const folderPath = dirHandle.name;
        
        // Añadir a las carpetas seleccionadas si no existe
        const currentFolders = projectForm.getValues('selectedFolders') || [];
        if (!currentFolders.includes(folderPath)) {
          projectForm.setValue('selectedFolders', [...currentFolders, folderPath]);
        }
        
        // También añadir a la lista de carpetas disponibles para mostrar
        if (!availableFolders.includes(folderPath)) {
          setAvailableFolders(prev => [...prev, folderPath]);
        }
      } else {
        // Fallback para navegadores que no soportan File System Access API
        const input = document.createElement('input') as HTMLInputElement;
        input.type = 'file';
        input.setAttribute('webkitdirectory', '');
        input.multiple = true;
        
        input.onchange = (event) => {
          const target = event.target as HTMLInputElement;
          const files = target.files;
          if (files && files.length > 0) {
            // Extraer la ruta de la carpeta del primer archivo
            const firstFile = files[0] as FileWithRelativePath;
            const folderPath = firstFile.webkitRelativePath?.split('/')[0] || 'Carpeta seleccionada';
            
            const currentFolders = projectForm.getValues('selectedFolders') || [];
            if (!currentFolders.includes(folderPath)) {
              projectForm.setValue('selectedFolders', [...currentFolders, folderPath]);
            }
            
            if (!availableFolders.includes(folderPath)) {
              setAvailableFolders(prev => [...prev, folderPath]);
            }
          }
        };
        
        input.click();
      }
    } catch (error) {
      console.error('Error seleccionando carpeta:', error);
      // Mostrar mensaje de error al usuario
      alert('No se pudo seleccionar la carpeta. Por favor, intenta de nuevo.');
    }
  };

  const loadAvailableFolders = async () => {
    try {
      // Cargar carpetas comunes como sugerencias
      const commonFolders = [
        'Documentos',
        'Descargas',
        'Escritorio',
        'Imágenes',
        'Vídeos',
        'Música',
        'Proyectos',
        'src',
        'lib',
        'components',
        'pages'
      ];
      setAvailableFolders(commonFolders);
    } catch (error) {
      console.error('Error loading folders:', error);
    }
  };

  const toggleFolderSelection = (folder: string) => {
    const currentFolders = projectForm.getValues('selectedFolders') || [];
    const isSelected = currentFolders.includes(folder);
    
    if (isSelected) {
      projectForm.setValue('selectedFolders', currentFolders.filter(f => f !== folder));
    } else {
      projectForm.setValue('selectedFolders', [...currentFolders, folder]);
    }
  };

  const openFolderSelector = () => {
    loadAvailableFolders();
    setIsFolderSelectorOpen(true);
  };

  const handleSaveModelConfig = (data: ModelConfigData) => {
    // Guardar la configuración en el estado
    setModelConfig(data);
    
    // También guardar en localStorage para persistencia
    localStorage.setItem('modelConfig', JSON.stringify(data));
    
    // Cerrar el modal
    setIsConfigModalOpen(false);
    
    // Mostrar mensaje de éxito
    alert('Configuración guardada exitosamente');
  };

  const handleGenerateDescription = async () => {
    const currentDescription = projectForm.getValues('description');
    
    if (!selectedModel) {
      toast({
        title: 'Error',
        description: 'Por favor selecciona un modelo en la barra de navegación superior',
        variant: 'destructive'
      });
      return;
    }

    if (!modelConfig?.apiKey) {
      toast({
        title: 'API Key faltante',
        description: 'El modelo seleccionado no tiene una API Key configurada. Por favor, configura la API Key en el selector de modelos.',
        variant: 'destructive'
      });
      return;
    }

    if (!currentDescription || currentDescription.trim().length < 10) {
      toast({
        title: 'Descripción requerida',
        description: 'Por favor escribe una breve descripción de tu API antes de generar el prompt mejorado.',
        variant: 'destructive'
      });
      return;
    }

    setIsGeneratingDescription(true);
    
    try {
      console.log('🪄 Enviando solicitud para mejorar descripción...');
      console.log('📋 Descripción actual:', currentDescription);
      console.log('🤖 Modelo seleccionado:', selectedModel?.name);
      console.log('🔑 API Key presente:', !!modelConfig?.apiKey);
      
      const response = await fetch('/api/generate-api-description', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user?.token}`,
        },
        body: JSON.stringify({
          userDescription: currentDescription,
          modelId: selectedModel.id,
          appType: 'API REST'
        }),
      });

      console.log('📡 Status response:', response.status);
      console.log('📡 Response OK:', response.ok);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Error en respuesta:', errorText);
        throw new Error(`Error generando descripción: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      console.log('📋 Resultado recibido, longitud:', result.prompt?.length);
      
      let improvedDescription = currentDescription;
      
      if (result.prompt) {
        // Usar la respuesta completa del modelo — tiene endpoints, specs técnicas, modelo de datos, etc.
        // Esto mejora drásticamente la calidad de la API generada
        improvedDescription = result.prompt
          // Limpiar marcadores markdown de negrita
          .replace(/\*\*/g, '')
          // Limpiar asteriscos simples de cursiva
          .replace(/(?<!\*)\*(?!\*)/g, '')
          // Limpiar líneas de separación
          .replace(/^---+$/gm, '')
          // Eliminar líneas en blanco excesivas (más de 2 consecutivas)
          .replace(/\n{3,}/g, '\n\n')
          .trim();
      }
      
      console.log('✨ Descripción mejorada completa, longitud:', improvedDescription.length);
      
      // Reemplazar la descripción con la versión mejorada completa
      projectForm.setValue('description', improvedDescription);
      
      toast({
        title: '✨ Descripción mejorada',
        description: `Spec completo generado (${improvedDescription.length} caracteres). Revísalo y pulsa "Generar API".`,
        variant: 'default'
      });
      
    } catch (error) {
      console.error('Error generando descripción:', error);
      toast({
        title: 'Error',
        description: 'No se pudo mejorar la descripción. Por favor, intenta de nuevo.',
        variant: 'destructive'
      });
    } finally {
      setIsGeneratingDescription(false);
    }
  };

  // Cargar configuración guardada al montar el componente
  useEffect(() => {
    // Cargar configuración del modelo
    const savedConfig = localStorage.getItem('modelConfig');
    if (savedConfig) {
      try {
        const config = JSON.parse(savedConfig);
        setModelConfig(config);
        // Actualizar los valores del formulario con la configuración guardada
        modelConfigForm.reset(config);
      } catch (error) {
        console.error('Error cargando configuración guardada:', error);
      }
    }
    
    // Cargar proyectos guardados
    const savedProjects = localStorage.getItem('generatedApis');
    if (savedProjects) {
      try {
        const projects = JSON.parse(savedProjects);
        setProjects(projects);
      } catch (error) {
        console.error('Error cargando proyectos guardados:', error);
      }
    }
  }, []);

  // Cargar configuración específica del modelo seleccionado desde PocketBase
  useEffect(() => {
    if (selectedModel) {
      // El modelo ya viene de PocketBase con la API Key incluida
      console.log(`✅ Modelo cargado desde PocketBase: ${selectedModel.name}`);
      console.log(`✅ API Key presente:`, !!selectedModel.apiKey);
      
      // Actualizar el estado con la configuración del modelo
      const modelConfig = {
        apiKey: selectedModel.apiKey || '',
        model: selectedModel.model || 'deepseek-chat',
        temperature: selectedModel.temperature || 0.7,
        maxTokens: selectedModel.maxTokens || 2048,
        apiBaseUrl: (selectedModel as any).apiBaseUrl || '',
        type: (selectedModel as any).type || '',
        provider: (selectedModel as any).provider || '',
      };
      
      setModelConfig(modelConfig);
      
      // También guardar en localStorage para compatibilidad con otras partes
      localStorage.setItem('modelConfig', JSON.stringify(modelConfig));
    }
  }, [selectedModel]);

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <header className="bg-card p-2">

          <div className="flex items-center">
            <img src="/image/logo-dark.png" alt="ZEUS Logo" className="h-16 w-auto" />
          </div>
        
            <span className="flex items-center text-xs text-green-400 bg-green-900/30 px-2 py-0.5 rounded-full border border-green-700/50">
              <span className="relative flex h-2 w-2 mr-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
              API Generator Activo
            </span>
           
          <div className="flex items-center space-x-4 mr-16">
            <div className="flex flex-col text-sm mr-4">
              {/* Línea 1: Nombre del proyecto */}
              <span
                className="font-semibold text-green-300"
                title={(activeProject as any)?.name || localStorage.getItem('projectName') || (projectRoot ? projectRoot.split(/[\/\\]/).pop() || 'Proyecto' : 'API Architect AI')}
              >
                {(() => {
                  const name = (activeProject as any)?.name || localStorage.getItem('projectName');
                  if (name) {
                    return name.length > 40 
                      ? name.slice(0, 40) + '…' 
                      : name;
                  }
                  if (projectRoot) {
                    const folderName = projectRoot.split(/[\/\\]/).pop() || 'Proyecto';
                    return folderName.length > 40 
                      ? folderName.slice(0, 40) + '…' 
                      : folderName;
                  }
                  return 'API Architect AI';
                })()}
              </span>
              
              {/* Línea 2: Ubicación */}
              <span
                className="text-foreground/80 max-w-[480px] truncate"
                title={projectRoot || 'Generador de APIs Inteligente'}
              >
                {projectRoot ? projectRoot : 'Generador de APIs Inteligente'}
              </span>
            </div>
            
            {/* Botón Generador de APIs - Navegar al Editor */}
            <button
              onClick={() => router.push('/editor')}
              className="flex items-center gap-2 p-2 rounded-md hover:bg-muted text-foreground/70 hover:text-foreground transition-colors border border-violet-400 shadow-[0_0_8px_rgba(167,139,250,0.8)]"
              title="Ir al Editor"
              type="button"
            >
              <ChevronLeft className="h-5 w-5" />
              <span>Editor</span>
            </button>
            
            
            
            
            <button
              onClick={() => window.open('/depura-rendimiento', '_blank')}
              className="p-2 rounded-md hover:bg-muted text-foreground/70 hover:text-foreground transition-colors border border-orange-400 shadow-[0_0_8px_rgba(251,146,60,0.8)]"
              title="Depurador de Rendimiento"
              type="button"
            >
              <BarChart3 className="h-5 w-5" />
            </button>
            
            <button
              onClick={() => navigateToProtectedUrl("https://components.zeus-ia.com/", user, null, null, selectedModel, isBackupRunning)}
              className="p-2 rounded-md hover:bg-muted text-foreground/70 hover:text-foreground transition-colors border border-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]"
              title="Editor de Componentes"
              type="button"
            >
              <Box className="h-5 w-5" />
            </button>
            
            {/* Utilities dropdown */}
            <DropdownMenu open={isUtilitiesOpen} onOpenChange={setIsUtilitiesOpen}>
              <DropdownMenuTrigger asChild>
                <button className="p-2 rounded-md hover:bg-muted text-foreground/70 hover:text-foreground transition-colors border border-blue-400 shadow-[0_0_8px_rgba(59,130,246,0.8)]" title="Utilidades">
                  <Wrench className="h-5 w-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="bg-card border border-border/50 text-foreground/80">
                <DropdownMenuLabel className="text-warning">Utilidades</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => console.log('Vincular BD')} className="cursor-pointer text-primary">
                  <LinkIcon className="h-4 w-4 mr-2 text-primary" />
                  <span className="text-primary">Vincular base de datos con aplicación</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => console.log('Desplegar BD')} className="cursor-pointer text-green-400">
                  <Database className="h-4 w-4 mr-2 text-green-400" />
                  <span className="text-green-400">Desplegar base de datos</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => window.open('https://www.clonador.zeus-ia.com', '_blank')} className="cursor-pointer text-primary">
                  <Database className="h-4 w-4 mr-2 text-primary" />
                  <span className="text-primary">PocketBase Cloner</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => window.open('/pb_backups', '_blank')} className="cursor-pointer text-sky-300">
                  <FolderOpen className="h-4 w-4 mr-2 text-sky-300" />
                  <span className="text-sky-300">Hacer backups de Pocket Base</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => console.log('Desplegar app')} className="cursor-pointer text-green-400">
                  <Rocket className="h-4 w-4 mr-2 text-green-400" />
                  <span className="text-green-400">Desplegar aplicación</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setIsConfigModalOpen(true)} className="cursor-pointer text-accent">
                  <Sparkles className="h-4 w-4 mr-2 text-accent" />
                  <span className="text-accent">Crear tu API key Gemini</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => console.log('Restaurar backup')} className="cursor-pointer text-orange-400">
                  <RefreshCw className="h-4 w-4 mr-2 text-orange-400" />
                  <span className="text-orange-400">Restaurar desde Backup</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => console.log('Actualizar backup')} className="cursor-pointer text-warning">
                  <RefreshCw className="h-4 w-4 mr-2 text-warning" />
                  <span className="text-warning">Actualizar Backup</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => console.log('Crear icono')} className="cursor-pointer text-amber-400">
                  <FileImage className="h-4 w-4 mr-2 text-amber-400" />
                  <span className="text-amber-400">Crear icono</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => window.open('https://comparador.zeus-ia.com/', '_blank')} className="cursor-pointer text-indigo-400">
                  <GitCompare className="h-4 w-4 mr-2 text-indigo-400" />
                  <span className="text-indigo-400">Comparador de código</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => console.log('Sugerencias modelo')} className="cursor-pointer text-cyan-400">
                  <MessageSquare className="h-4 w-4 mr-2 text-cyan-400" />
                  <span className="text-cyan-400">Sugerencias modelo</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => window.open('https://drive.usercontent.google.com/download?id=1nwQz0aLzzyzjImab2UsrrtlJiA-QCne3&export=download&authuser=0&confirm=t&uuid=ff6d5744-3509-4f7f-af46-e542722a7906&at=APcXIO1EYC9UdER4cbVN00D2RnBg%3A1771886439984', '_blank')} className="cursor-pointer text-sky-400">
                  <MonitorDown className="h-4 w-4 mr-2 text-sky-400" />
                  <span className="text-sky-400">Descargar ZeusDesktop</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            
       
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {generatedApi ? (
          <div className="space-y-8">
            <div className="bg-white rounded-xl shadow-2xl p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">{generatedApi.title}</h2>
                  <p className="text-muted-foreground/60 mt-2">{generatedApi.description}</p>
                </div>
                <div className="flex items-center space-x-4">
                  <button
                    onClick={handleDownloadProject}
                    className="px-4 py-2 bg-green-600 text-foreground font-semibold rounded-lg hover:bg-green-700 flex items-center"
                  >
                    <DownloadIcon className="h-5 w-5 mr-2" />
                    Descargar Proyecto
                  </button>
                  <button
                    onClick={handleSaveToProject}
                    disabled={!projectRoot}
                    className="px-4 py-2 bg-primary text-foreground font-semibold rounded-lg hover:bg-primary disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center"
                    title={projectRoot ? 'Guardar API en el proyecto abierto' : 'Abre un proyecto primero'}
                  >
                    <Save className="h-5 w-5 mr-2" />
                    Guardar en proyecto
                  </button>
                  <button
                    onClick={() => setGeneratedApi(null)}
                    className="px-4 py-2 text-muted-foreground/60 hover:text-gray-900"
                  >
                    Volver al inicio
                  </button>
                  <button
                    onClick={() => setIsProjectModalOpen(true)}
                    className="px-4 py-2 bg-[#1e6feb] text-foreground rounded-lg hover:bg-[#1a63d4]"
                  >
                    Nuevo Proyecto
                  </button>
                  <button
                    onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
                    className="px-4 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80 flex items-center"
                    title={viewMode === 'grid' ? 'Vista de lista' : 'Vista de cuadrícula'}
                  >
                    {viewMode === 'grid' ? <List className="h-5 w-5" /> : <FolderOpen className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              <div className="border-b border-gray-200 mb-6">
                <nav className="-mb-px flex space-x-8">
                  {['code', 'docs', 'schemas'].map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab as any)}
                      className={`py-2 px-1 border-b-2 font-medium text-sm ${activeTab === tab
                          ? 'border-[#64ffda] text-[#64ffda]'
                          : 'border-transparent text-muted-foreground/80 hover:text-gray-700 hover:border-gray-300'
                        }`}
                    >
                      {tab === 'code' && <Code2 className="inline h-4 w-4 mr-2" />}
                      {tab === 'docs' && <FileText className="inline h-4 w-4 mr-2" />}
                      {tab === 'schemas' && <Database className="inline h-4 w-4 mr-2" />}
                      {tab === 'code' ? 'Código' : tab === 'docs' ? 'Documentación' : 'Esquemas'}
                    </button>
                  ))}
                </nav>
              </div>

              <div className="bg-background rounded-lg p-4 mb-6">
                <pre className="text-green-400 overflow-x-auto !text-green-400">
                  <code>
                    {activeTab === 'code' && generatedApi.code}
                    {activeTab === 'docs' && generatedApi.documentation}
                    {activeTab === 'schemas' && generatedApi.schemas}
                  </code>
                </pre>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2">
                  <div className="bg-gray-50 rounded-xl p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Probador de API</h3>

                    <div className="space-y-4">
                      <div className="flex items-center space-x-4">
                        <select
                          value={selectedEndpoint}
                          onChange={(e) => setSelectedEndpoint(e.target.value)}
                          className="flex-grow px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#64ffda] focus:border-transparent bg-white text-gray-900"
                        >
                          <option value="">Seleccionar endpoint</option>
                          {generatedApi.endpoints.map(endpoint => (
                            <option key={endpoint.id} value={endpoint.id}>
                              {endpoint.method} {endpoint.path}
                            </option>
                          ))}
                        </select>

                        <button
                          onClick={handleTestEndpoint}
                          disabled={!selectedEndpoint || isTesting}
                          className="px-4 py-2 bg-[#1e6feb] text-foreground rounded-lg hover:bg-[#1a63d4] disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                        >
                          {isTesting ? (
                            <Loader2 className="h-5 w-5 animate-spin mr-2" />
                          ) : (
                            <PlayCircle className="h-5 w-5 mr-2" />
                          )}
                          Ejecutar Prueba
                        </button>
                      </div>

                      {testResponse && (
                        <div className="mt-4">
                          <h4 className="font-medium text-gray-900 mb-2">Respuesta:</h4>
                          <div className="bg-background rounded-lg p-4">
                            <pre className="text-green-400 overflow-x-auto text-sm !text-green-400">
                              {JSON.stringify(testResponse, null, 2)}
                            </pre>
                          </div>
                        </div>
                      )}

                      <div className="pt-4 border-t border-gray-200">
                        <h4 className="font-medium text-gray-900 mb-2">Snippets de integración:</h4>
                        <div className="bg-background rounded-lg p-4">
                          <pre className="text-green-400 overflow-x-auto text-sm !text-green-400">
                            {`// Ejemplo de uso en Next.js
import useSWR from 'swr';

export function useApiData() {
  const { data, error } = useSWR('/api/your-endpoint', fetcher);
  
  return {
    data,
    isLoading: !error && !data,
    error
  };
}`}
                          </pre>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="bg-gray-50 rounded-xl p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Feedback</h3>

                    <textarea
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                      placeholder="¿Cómo podemos mejorar esta API? Ejemplo: Añade validación de datos, mejora la paginación..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#64ffda] focus:border-transparent min-h-[120px] bg-white text-gray-900 placeholder-muted-foreground/80"
                    />

                    <button
                      onClick={handleRegenerateWithFeedback}
                      disabled={!feedback || isGenerating}
                      className="w-full mt-4 px-4 py-2 bg-[#64ffda] text-[#0a192f] font-semibold rounded-lg hover:bg-[#52e6c4] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                    >
                      {isGenerating ? (
                        <Loader2 className="h-5 w-5 animate-spin mr-2" />
                      ) : (
                        <RefreshCw className="h-5 w-5 mr-2" />
                      )}
                      Regenerar con Feedback
                    </button>

                    <div className="flex justify-center space-x-4 mt-4">
                      <button className="p-2 text-green-600 hover:text-green-700">
                        <ThumbsUp className="h-6 w-6" />
                      </button>
                      <button className="p-2 text-red-600 hover:text-red-700">
                        <ThumbsDown className="h-6 w-6" />
                      </button>
                    </div>
                  </div>

                  <div className="bg-gray-50 rounded-xl p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Endpoints Disponibles</h3>
                    <ul className="space-y-3">
                      {generatedApi.endpoints.map(endpoint => (
                        <li key={endpoint.id} className="flex items-center justify-between p-3 bg-white rounded-lg border border-gray-200">
                          <div>
                            <span className={`inline-block px-2 py-1 text-xs font-medium rounded mr-2 ${endpoint.method === 'GET' ? 'bg-green-100 text-green-800' :
                                endpoint.method === 'POST' ? 'bg-blue-100 text-blue-800' :
                                  endpoint.method === 'PUT' ? 'bg-yellow-100 text-yellow-800' :
                                    endpoint.method === 'DELETE' ? 'bg-red-100 text-red-800' :
                                      'bg-purple-100 text-purple-800'
                              }`}>
                              {endpoint.method}
                            </span>
                            <span className="text-sm font-medium text-gray-900">{endpoint.path}</span>
                          </div>
                          <ChevronRight className="h-5 w-5 text-muted-foreground" />
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-12">
            <section className="text-center py-12">
              <h1 className="text-5xl font-bold text-foreground mb-6">
                Transforma tu código en una <span className="text-[#64ffda]">API completa</span>
              </h1>
              <p className="text-xl text-foreground/90 max-w-3xl mx-auto mb-10">
                Sube tus archivos TypeScript/JavaScript y obtén una API REST funcional con documentación,
                esquemas TypeScript y pruebas integradas en minutos.
              </p>
              <div className="flex items-center justify-center space-x-4">
                <button
                  onClick={() => setIsProjectModalOpen(true)}
                  className="px-8 py-4 bg-[#64ffda] text-[#0a192f] font-bold text-lg rounded-xl hover:bg-[#52e6c4] transition-all transform hover:scale-105 shadow-2xl"
                >
                  Comenzar Ahora
                </button>
                <button
                  onClick={handleLoadSavedApi}
                  disabled={!projectRoot}
                  className="px-8 py-4 bg-primary text-foreground font-bold text-lg rounded-xl hover:bg-primary disabled:bg-muted/80 disabled:cursor-not-allowed transition-all transform hover:scale-105 shadow-2xl flex items-center"
                  title={projectRoot ? 'Cargar API guardada en el proyecto actual' : 'Abre un proyecto primero'}
                >
                  <FolderOpenIcon className="h-5 w-5 mr-2" />
                  Cargar API guardada
                </button>
              </div>
            </section>

            <section className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {features.map((feature, index) => (
                <div key={index} className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/20 hover:border-[#64ffda]/50 transition-all">
                  <div className="flex items-center mb-4">
                    <div className={`p-3 rounded-lg bg-white/10 ${feature.color}`}>
                      <feature.icon className="h-8 w-8" />
                    </div>
                    <h3 className="text-xl font-bold text-foreground ml-4">{feature.title}</h3>
                  </div>
                  <p className="text-foreground/80">{feature.description}</p>
                </div>
              ))}
            </section>

            <section className="bg-white/10 backdrop-blur-sm rounded-2xl p-8 border border-white/20">
              <div className="flex justify-between items-center mb-8">
                <h2 className="text-3xl font-bold text-foreground text-center">Proyectos Generados</h2>
                <button
                  onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
                  className="px-4 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80 flex items-center"
                  title={viewMode === 'grid' ? 'Vista de lista' : 'Vista de cuadrícula'}
                >
                  {viewMode === 'grid' ? <List className="h-5 w-5" /> : <FolderOpen className="h-5 w-5" />}
                </button>
              </div>
              {viewMode === 'grid' ? (
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {projects.slice(0, 6).map((project) => (
                    <div key={project.id} className="bg-white/15 rounded-xl p-6 border border-white/20 hover:border-[#64ffda]/30 transition-all">
                      <h3 className="text-xl font-bold text-foreground mb-2">{project.title}</h3>
                      <p className="text-foreground/70 mb-4">{project.description.substring(0, 100)}...</p>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-foreground/60">
                          {project.endpoints.length} endpoints
                        </span>
                        <button
                          onClick={() => {
                            setGeneratedApi(project);
                            // Establecer configuración del modelo por defecto si no existe
                            if (!modelConfig) {
                              setModelConfig({
                                apiKey: '',
                                model: 'deepseek-chat',
                                temperature: 0.7,
                                maxTokens: 2000,
                              });
                            }
                          }}
                          className="text-[#64ffda] hover:text-[#52e6c4] font-medium"
                        >
                          Ver detalles →
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-4">
                  {projects.slice(0, 6).map((project) => (
                    <div key={project.id} className="bg-white/15 rounded-xl p-6 border border-white/20 hover:border-[#64ffda]/30 transition-all">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <h3 className="text-xl font-bold text-foreground mb-2">{project.title}</h3>
                          <p className="text-foreground/70 mb-4">{project.description.substring(0, 200)}...</p>
                          <span className="text-sm text-foreground/60">
                            {project.endpoints.length} endpoints
                          </span>
                        </div>
                        <button
                          onClick={() => {
                            setGeneratedApi(project);
                            // Establecer configuración del modelo por defecto si no existe
                            if (!modelConfig) {
                              setModelConfig({
                                apiKey: '',
                                model: 'deepseek-chat',
                                temperature: 0.7,
                                maxTokens: 2000,
                              });
                            }
                          }}
                          className="text-[#64ffda] hover:text-[#52e6c4] font-medium ml-4"
                        >
                          Ver detalles →
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </main>

      {/* Modal de Api Generator Zeus */}
      <AnimatePresence>
        {isProjectModalOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsProjectModalOpen(false)}
              className="fixed inset-0 bg-background/50 backdrop-blur-sm z-[60]"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="fixed inset-x-0 inset-y-0 m-auto z-[70] w-full max-w-md h-fit p-4"
            >
              <div className="rounded-xl bg-background shadow-xl border border-border/50 overflow-hidden">
                <div className="p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-base font-semibold text-zeus-orange">
                      Api Generator Zeus
                    </h3>
                    <button
                      onClick={() => setIsProjectModalOpen(false)}
                      className="p-2 rounded-lg hover:bg-card focus:outline-none focus:ring-2 focus:ring-[#64ffda]"
                      aria-label="Cerrar modal"
                    >
                      <X className="h-5 w-5 text-muted-foreground" />
                    </button>
                  </div>

                  <form onSubmit={projectForm.handleSubmit(handleGenerateApi)}>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-foreground/70 mb-2">
                          Título del Proyecto
                        </label>
                        <input
                          type="text"
                          {...projectForm.register("title")}
                          className="w-full px-3 py-2 border border-border/40 rounded-lg focus:ring-2 focus:ring-[#64ffda] focus:border-transparent bg-card text-foreground placeholder-muted-foreground/80"
                          placeholder="Mi API de usuarios"
                        />
                        {projectForm.formState.errors.title && (
                          <p className="mt-1 text-sm text-destructive">
                            {projectForm.formState.errors.title.message}
                          </p>
                        )}
                      </div>

                      <div>
                        <div className="flex justify-between items-center mb-2">
                          <label className="block text-sm font-medium text-foreground/70">
                            Descripción
                          </label>
                          <button
                            type="button"
                            onClick={handleGenerateDescription}
                            disabled={isGeneratingDescription || !selectedModel || !modelConfig?.apiKey}
                            className="flex items-center gap-1 px-2 py-1 text-xs bg-[#64ffda] text-gray-900 rounded-md hover:bg-[#52e6c4] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            title={
                      isGeneratingDescription 
                        ? "Generando descripción..."
                        : !selectedModel 
                        ? "Selecciona un modelo en la barra de navegación superior"
                        : !modelConfig?.apiKey
                        ? "Configura la API Key del modelo seleccionado"
                        : "Mejorar descripción con IA"
                    }
                          >
                            {isGeneratingDescription ? (
                              <>
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Mejorando...
                              </>
                            ) : (
                              <>
                                <Wand2 className="h-3 w-3" />
                                Mejorar
                              </>
                            )}
                          </button>
                        </div>
                        <textarea
                          {...projectForm.register("description")}
                          rows={isGeneratingDescription ? 3 : (projectForm.watch('description')?.length > 200 ? 12 : 4)}
                          className="w-full px-3 py-2 border border-border/40 rounded-lg focus:ring-2 focus:ring-[#64ffda] focus:border-transparent bg-card text-foreground placeholder-muted-foreground/80 transition-all duration-300 resize-y"
                          placeholder="Describe la API que quieres generar... (ej: API para gestionar usuarios con roles y permisos)"
                        />
                        {projectForm.formState.errors.description && (
                          <p className="mt-1 text-sm text-destructive">
                            {projectForm.formState.errors.description.message}
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-foreground/70 mb-2">
                          Subir Archivos
                        </label>
                        <div
                          onDragEnter={handleDragEnter}
                          onDragOver={handleDragOver}
                          onDragLeave={handleDragLeave}
                          onDrop={handleDrop}
                          onClick={() => document.getElementById('file-input')?.click()}
                          className={`border border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                            isDragging
                              ? 'border-[#64ffda] bg-[#64ffda]/10'
                              : 'border-border/40 hover:border-gray-400'
                          }`}
                        >
                          <UploadIcon className="mx-auto h-12 w-12 text-muted-foreground/80 mb-4" />
                          <p className="text-muted-foreground">
                            Arrastra y suelta archivos aquí o haz clic para seleccionar
                          </p>
                          <p className="text-sm text-muted-foreground/80 mt-2">
                            Archivos .ts, .tsx, .js, .jsx, .json
                          </p>
                        </div>
                        <input
                          id="file-input"
                          type="file"
                          multiple
                          accept=".ts,.tsx,.js,.jsx,.json"
                          onChange={(e) => e.target.files && handleFileSelect(e.target.files)}
                          className="hidden"
                        />
                        {uploadedFiles.length > 0 && (
                          <div className="mt-4">
                            <p className="text-sm font-medium text-foreground/70 mb-2">
                              Archivos seleccionados ({uploadedFiles.length})
                            </p>
                            <ul className="space-y-2 max-h-40 overflow-y-auto">
                              {uploadedFiles.map((file, index) => (
                                <li key={index} className="flex items-center justify-between p-2 bg-card rounded">
                                  <span className="text-sm text-foreground/70 truncate">
                                    {file.name}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => setUploadedFiles(files => files.filter((_, i) => i !== index))}
                                    className="text-destructive hover:text-red-600"
                                  >
                                    <X className="h-4 w-4" />
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-foreground/70 mb-2">
                          Seleccionar Carpetas
                        </label>
                        <div className="space-y-2">
                          <button
                            type="button"
                            onClick={selectNativeFolder}
                            className="w-full px-4 py-3 border-2 border-dashed border-[#64ffda] bg-[#64ffda]/10 rounded-lg hover:border-[#52e6c4] hover:bg-[#52e6c4]/20 focus:ring-2 focus:ring-[#64ffda] focus:border-transparent bg-card text-foreground flex items-center justify-center"
                          >
                            <div className="flex items-center">
                              <FolderOpenIcon className="h-5 w-5 mr-2 text-[#64ffda]" />
                              <span className="text-[#64ffda] font-medium">
                                Seleccionar carpeta del sistema...
                              </span>
                            </div>
                          </button>
                          
                          <button
                            type="button"
                            onClick={loadCurrentProjectFiles}
                            className="w-full px-4 py-3 border border-border/40 rounded-lg hover:border-[#64ffda] focus:ring-2 focus:ring-[#64ffda] focus:border-transparent bg-card text-foreground flex items-center justify-between"
                          >
                            <div className="flex items-center">
                              <FolderIcon className="h-5 w-5 mr-2 text-muted-foreground" />
                              <span className="text-foreground/70">
                                {projectRoot ? 
                                  `Cargar proyecto actual: ${(activeProject as any)?.name || projectRoot.split(/[\/\\]/).pop() || 'Proyecto'}` 
                                  : 'Cargar proyecto actual'
                                }
                              </span>
                            </div>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </button>
                        </div>
                        
                        {(projectForm.watch('selectedFolders') || []).length > 0 && (
                          <div className="mt-3">
                            <p className="text-sm font-medium text-foreground/70 mb-2">
                              Carpetas seleccionadas:
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {(projectForm.watch('selectedFolders') || []).map((folder, index) => (
                                <span
                                  key={index}
                                  className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-[#64ffda]/20 text-[#64ffda] border border-[#64ffda]/30"
                                >
                                  <FolderIcon className="h-3 w-3 mr-1" />
                                  {folder}
                                  <button
                                    type="button"
                                    onClick={() => toggleFolderSelection(folder)}
                                    className="ml-2 text-[#64ffda] hover:text-destructive"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-6 flex justify-end space-x-3">
                      <button
                        type="button"
                        onClick={() => setIsProjectModalOpen(false)}
                        className="px-4 py-2 text-muted-foreground hover:text-foreground"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        disabled={isGenerating}
                        className="px-4 py-2 bg-[#64ffda] text-gray-900 font-semibold rounded-lg hover:bg-[#52e6c4] disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                      >
                        {isGenerating ? (
                          <>
                            <Loader2 className="h-5 w-5 animate-spin mr-2" />
                            Generando...
                          </>
                        ) : (
                          "Generar API"
                        )}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Modal de Selección de Carpetas */}
      <AnimatePresence>
        {isFolderSelectorOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsFolderSelectorOpen(false)}
              className="fixed inset-0 bg-background/50 backdrop-blur-sm z-[60]"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="fixed inset-x-0 inset-y-0 m-auto z-[70] w-full max-w-md h-fit p-4 max-h-[80vh] overflow-y-auto"
            >
              <div className="rounded-xl bg-white dark:bg-background shadow-xl border border-gray-200 dark:border-border/80 overflow-hidden">
                <div className="p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-foreground">
                      Seleccionar Carpetas
                    </h3>
                    <button
                      onClick={() => setIsFolderSelectorOpen(false)}
                      className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-card focus:outline-none focus:ring-2 focus:ring-primary"
                      aria-label="Cerrar selector de carpetas"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {availableFolders.map((folder) => {
                      const isSelected = (projectForm.watch('selectedFolders') || []).includes(folder);
                      return (
                        <div
                          key={folder}
                          onClick={() => toggleFolderSelection(folder)}
                          className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                            isSelected
                              ? 'border-[#64ffda] bg-[#64ffda]/10'
                              : 'border-gray-300 dark:border-border/40 hover:border-[#64ffda]'
                          }`}
                        >
                          <div className="flex items-center">
                            {isSelected ? (
                              <FolderOpenIcon className="h-5 w-5 mr-3 text-[#64ffda]" />
                            ) : (
                              <FolderIcon className="h-5 w-5 mr-3 text-muted-foreground/80" />
                            )}
                            <span className="text-gray-900 dark:text-foreground">{folder}</span>
                          </div>
                          {isSelected && (
                            <CheckCircle className="h-5 w-5 text-[#64ffda]" />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-6 flex justify-end space-x-3">
                    <button
                      type="button"
                      onClick={() => setIsFolderSelectorOpen(false)}
                      className="px-4 py-2 text-gray-700 dark:text-foreground/70 hover:text-gray-900 dark:hover:text-foreground"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsFolderSelectorOpen(false)}
                      className="px-4 py-2 bg-[#64ffda] text-[#0a192f] font-semibold rounded-lg hover:bg-[#52e6c4]"
                    >
                      Aceptar
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
      <Footer />

    

      </div>
      
  );
}

function useModel(): { models: any; selectedModel: any; setSelectedModelId: any; } {
  throw new Error('Function not implemented.');
}

