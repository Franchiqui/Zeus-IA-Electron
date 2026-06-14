'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Check, ChevronDown, ChevronRight, GitBranch, Loader2, Wand2, Save, FolderOpen, Trash2, RefreshCw } from 'lucide-react';
import { useStore } from '@/lib/store';
import { useChatContext } from '@/components/ChatContext';
import pb, { saveToBothDatabases, deleteFromBothDatabases } from '@/lib/pocketbase';

interface StructurePlanTabProps {
  plans?: any[];
  setPlans?: (plans: any[]) => void;
}

interface StreamingStage {
  number: number;
  name: string;
  objective: string;
  tasks: string[];
  files: (string | { path: string; created: boolean })[];
  dependencies: string[];
  isStreaming: boolean;
  content: string;
  executionResult?: any;
  isExecuting?: boolean;
  executionCompleted?: boolean;
}

const DEFAULT_EXECUTION_CONFIG = {
  planningMaxTokens: 3500,
  fileMaxTokens: 4000,
  finalMaxTokens: 3000,
  maxFileContentChars: 50000,
};

// Helper: construir árbol de archivos desde listas planas
function buildFileTree(folders: string[] = [], files: string[] = []) {
  const tree: Record<string, any> = {};

  const addPath = (path: string, isFile: boolean) => {
    const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
    let current = tree;
    for (let i = 0; i < parts.length - (isFile ? 1 : 0); i++) {
      if (!current[parts[i]]) current[parts[i]] = {};
      current = current[parts[i]];
    }
    if (isFile) {
      const fileName = parts[parts.length - 1];
      current[fileName] = null; // null = archivo
    }
  };

  folders.forEach((f) => addPath(f, false));
  files.forEach((f) => addPath(f, true));

  return tree;
}

const FileTreeNode = ({ name, node, depth = 0 }: { name: string; node: any; depth?: number }) => {
  const isFile = node === null;
  const children = isFile ? [] : Object.entries(node).sort(([a], [b]) => {
    const aIsFile = node[a] === null;
    const bIsFile = node[b] === null;
    if (aIsFile !== bIsFile) return aIsFile ? 1 : -1;
    return a.localeCompare(b);
  });

  return (
    <div>
      <div className="flex items-center gap-1.5 py-0.5" style={{ paddingLeft: `${depth * 14}px` }}>
        {isFile ? (
          <>
            <span className="text-primary text-[8px]">📄</span>
            <span className="text-[8px] text-muted-foreground font-mono">{name}</span>
          </>
        ) : (
          <>
            <span className="text-accent text-[8px]">📁</span>
            <span className="text-[8px] text-accent font-medium">{name}</span>
          </>
        )}
      </div>
      {!isFile && children.map(([childName, childNode]) => (
        <FileTreeNode key={childName} name={childName} node={childNode} depth={depth + 1} />
      ))}
    </div>
  );
};

export default function StructurePlanTab({ plans = [], setPlans }: StructurePlanTabProps) {
  const { selectedModel, models, refreshExplorer } = useStore();
  const { setMessages, startNewChat } = useChatContext();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [stages, setStages] = useState('');
  const [isStageDropdownOpen, setIsStageDropdownOpen] = useState(false);
  const [isPlanModelDropdownOpen, setIsPlanModelDropdownOpen] = useState(false);
  const [isExecutionModelDropdownOpen, setIsExecutionModelDropdownOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isImprovingDescription, setIsImprovingDescription] = useState(false);
  const [isLocalTarget, setIsLocalTarget] = useState(true);
  const [streamingPlan, setStreamingPlan] = useState<{
    title: string;
    description: string;
    totalStages: number;
    stages: StreamingStage[];
    structure?: {
      overview?: string;
      folders?: string[];
      files?: string[];
    };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [executionConfig, setExecutionConfig] = useState(DEFAULT_EXECUTION_CONFIG);
  const [selectedPlanModelId, setSelectedPlanModelId] = useState<string>('');
  const [selectedExecutionModelId, setSelectedExecutionModelId] = useState<string>('');
  const [isAutoMode, setIsAutoMode] = useState(false);
  const [isProjectContextMode, setIsProjectContextMode] = useState(false);
  const [projectContext, setProjectContext] = useState<{
    overview: string;
    folders: string[];
    files: string[];
  } | null>(null);
  const [isScanningProject, setIsScanningProject] = useState(false);
  const [isModelConfigHydrated, setIsModelConfigHydrated] = useState(false);
  const [expandedExecutionResults, setExpandedExecutionResults] = useState<Record<number, boolean>>({});
  const [savedPlans, setSavedPlans] = useState<any[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const stageDropdownRef = useRef<HTMLDivElement>(null);
  const autoResumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Limpiar timeout al desmontar
  useEffect(() => {
    return () => {
      if (autoResumeTimeoutRef.current) {
        clearTimeout(autoResumeTimeoutRef.current);
      }
    };
  }, []);

  // Cargar configuración de auto modo
  useEffect(() => {
    const savedAuto = localStorage.getItem('structurePlanAutoMode');
    if (savedAuto === 'true') setIsAutoMode(true);
  }, []);

  useEffect(() => {
    localStorage.setItem('structurePlanAutoMode', String(isAutoMode));
  }, [isAutoMode]);

  // Cargar configuración de modo contexto de proyecto
  useEffect(() => {
    const savedContextMode = localStorage.getItem('structurePlanProjectContextMode');
    if (savedContextMode === 'true') setIsProjectContextMode(true);

    const savedContext = localStorage.getItem('structurePlanProjectContext');
    if (savedContext) {
      try {
        setProjectContext(JSON.parse(savedContext));
      } catch {
        // ignorar
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('structurePlanProjectContextMode', String(isProjectContextMode));
  }, [isProjectContextMode]);

  useEffect(() => {
    if (projectContext) {
      localStorage.setItem('structurePlanProjectContext', JSON.stringify(projectContext));
    } else {
      localStorage.removeItem('structurePlanProjectContext');
    }
  }, [projectContext]);

  const planModelDropdownRef = useRef<HTMLDivElement>(null);
  const executionModelDropdownRef = useRef<HTMLDivElement>(null);
  const executionControllersRef = useRef<Record<number, AbortController>>({});
  const executionTypingIntervalsRef = useRef<Record<number, ReturnType<typeof setInterval>>>({});
  const canResumeGeneration =
    !!streamingPlan &&
    !isLoading &&
    streamingPlan.stages.length > 0 &&
    streamingPlan.stages.length < streamingPlan.totalStages;

  // Cargar plan guardado al montar
  useEffect(() => {
    const savedPlan = localStorage.getItem('structurePlan');
    if (savedPlan) {
      try {
        setStreamingPlan(JSON.parse(savedPlan));
      } catch (e) {
        console.error('Error loading saved plan:', e);
      }
    }
  }, []);

  // Cargar planes guardados de PocketBase
  useEffect(() => {
    loadSavedPlans();
  }, []);

  const loadSavedPlans = async () => {
    try {
      const records = await pb.collection('structure_plans').getFullList({
        sort: '-created'
      });
      setSavedPlans(records);
    } catch (e) {
      console.warn('Error al cargar planes guardados (se usará lista vacía):', e instanceof Error ? e.message : e);
      setSavedPlans([]);
    }
  };

  const handleLoadPlan = async (planId: string) => {
    try {
      const record = await pb.collection('structure_plans').getOne(planId);

      setStreamingPlan({
        title: record.title,
        description: record.description,
        totalStages: record.total_stages,
        stages: record.stages_json,
        structure: record.project_structure || undefined
      });

      if (record.model_id) {
        setSelectedPlanModelId(record.model_id);
        setSelectedExecutionModelId(record.model_id);
      }

      console.log('Plan cargado:', record.title);
    } catch (e) {
      console.error('Error al cargar plan:', e);
      setError('Error al cargar el plan seleccionado');
    }
  };

  const handleSavePlan = async () => {
    if (!streamingPlan) {
      setError('No hay un plan para guardar');
      return;
    }

    try {
      console.log('streamingPlan:', streamingPlan);
      console.log('effectivePlanModelId:', effectivePlanModelId);

      const payload = {
        title: streamingPlan.title,
        description: streamingPlan.description,
        total_stages: streamingPlan.totalStages,
        stages_json: streamingPlan.stages,
        model_id: effectivePlanModelId,
        created_files_count: streamingPlan.stages.reduce((count, stage) => {
          return count + stage.files.filter(f => typeof f === 'object' && f.created).length;
        }, 0),
        pending_files_count: streamingPlan.stages.reduce((count, stage) => {
          return count + stage.files.filter(f => typeof f === 'object' && !f.created).length;
        }, 0),
        stages_completed: streamingPlan.stages.filter(s => s.executionCompleted).length,
        stages_pending: streamingPlan.stages.filter(s => !s.executionCompleted).length,
        // Guardar estructura del proyecto si existe
        project_structure: streamingPlan.structure || null,
      };

      console.log('payload antes de guardar:', payload);

      await saveToBothDatabases('structure_plans', payload);

      // Recargar la lista de planes
      await loadSavedPlans();

      console.log('Plan guardado exitosamente');
    } catch (e) {
      console.error('Error al guardar plan:', e);
      setError('Error al guardar el plan');
    }
  };

  const handleDeletePlan = async () => {
    if (!selectedPlanId) {
      setError('No hay ningún plan seleccionado para borrar');
      return;
    }

    if (!confirm('¿Estás seguro de que quieres borrar este plan? Esta acción no se puede deshacer.')) {
      return;
    }

    try {
      await deleteFromBothDatabases('structure_plans', selectedPlanId);

      // Limpiar selección
      setSelectedPlanId('');

      // Recargar la lista de planes
      await loadSavedPlans();

      console.log('Plan borrado exitosamente');
    } catch (e) {
      console.error('Error al borrar plan:', e);
      setError('Error al borrar el plan');
    }
  };

  const scanProjectStructure = async () => {
    setIsScanningProject(true);
    setError(null);
    try {
      const res = await fetch('/api/project-structure');
      const data = await res.json();
      if (data.success && data.structure) {
        setProjectContext({
          overview: data.structure.overview || '',
          folders: data.structure.folders || [],
          files: data.structure.files || [],
        });
      } else {
        setError(data.error || 'No se pudo escanear la estructura del proyecto');
      }
    } catch (err: any) {
      setError(err.message || 'Error al escanear el proyecto');
    } finally {
      setIsScanningProject(false);
    }
  };

  const toggleProjectContextMode = async () => {
    const next = !isProjectContextMode;
    setIsProjectContextMode(next);
    if (next) {
      // Si se activa y no hay contexto cargado, escanear
      if (!projectContext) {
        await scanProjectStructure();
      }
    } else {
      // Si se desactiva, limpiar contexto
      setProjectContext(null);
    }
  };

  // Guardar plan en localStorage cuando cambie
  useEffect(() => {
    if (streamingPlan) {
      localStorage.setItem('structurePlan', JSON.stringify(streamingPlan));
    } else {
      localStorage.removeItem('structurePlan');
    }
  }, [streamingPlan]);

  useEffect(() => {
    const savedConfig = localStorage.getItem('structurePlanExecutionConfig');
    if (!savedConfig) return;

    try {
      const parsed = JSON.parse(savedConfig);
      setExecutionConfig((prev) => ({
        ...prev,
        ...parsed,
      }));
    } catch (e) {
      console.error('Error loading execution config:', e);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('structurePlanExecutionConfig', JSON.stringify(executionConfig));
  }, [executionConfig]);

  useEffect(() => {
    const savedModelConfig = localStorage.getItem('structurePlanModelConfig');
    if (!savedModelConfig) {
      setIsModelConfigHydrated(true);
      return;
    }

    try {
      const parsed = JSON.parse(savedModelConfig);
      if (parsed?.planModelId) setSelectedPlanModelId(parsed.planModelId);
      if (parsed?.executionModelId) setSelectedExecutionModelId(parsed.executionModelId);
    } catch (e) {
      console.error('Error loading model config:', e);
    } finally {
      setIsModelConfigHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!isModelConfigHydrated) return;
    if (!selectedModel?.id) return;
    if (!selectedPlanModelId) setSelectedPlanModelId(selectedModel.id);
    if (!selectedExecutionModelId) setSelectedExecutionModelId(selectedModel.id);
  }, [isModelConfigHydrated, selectedModel?.id, selectedPlanModelId, selectedExecutionModelId]);

  useEffect(() => {
    if (!selectedModel?.id || !Array.isArray(models) || models.length === 0) return;

    const isPlanModelValid = selectedPlanModelId ? models.some((m) => m.id === selectedPlanModelId) : false;
    const isExecutionModelValid = selectedExecutionModelId ? models.some((m) => m.id === selectedExecutionModelId) : false;

    if (selectedPlanModelId && !isPlanModelValid) {
      setSelectedPlanModelId(selectedModel.id);
    }

    if (selectedExecutionModelId && !isExecutionModelValid) {
      setSelectedExecutionModelId(selectedModel.id);
    }
  }, [models, selectedModel?.id, selectedPlanModelId, selectedExecutionModelId]);

  useEffect(() => {
    if (!isModelConfigHydrated) return;
    localStorage.setItem('structurePlanModelConfig', JSON.stringify({
      planModelId: selectedPlanModelId,
      executionModelId: selectedExecutionModelId,
    }));
  }, [isModelConfigHydrated, selectedPlanModelId, selectedExecutionModelId]);

  const getModelDisplayName = (model: any) => {
    if (!model) return 'Modelo no disponible';
    return model.nombre_modelo || model.name || model.model_name || model.id || 'Modelo no disponible';
  };

  const startStageTypingIndicator = (stageNumber: number, stageName: string) => {
    const messageId = `stage-typing-${stageNumber}`;
    const frames = ['.', '..', '...'];
    let frameIndex = 0;

    setMessages((prev: any) => {
      const alreadyExists = prev.some((msg: any) => msg.id === messageId);
      if (alreadyExists) return prev;

      return [
        ...prev,
        {
          id: messageId,
          role: 'assistant',
          content: `Ejecutando etapa ${stageNumber}: ${stageName}${frames[frameIndex]}`,
          createdAt: new Date().toISOString(),
        },
      ];
    });

    if (executionTypingIntervalsRef.current[stageNumber]) {
      clearInterval(executionTypingIntervalsRef.current[stageNumber]);
    }

    executionTypingIntervalsRef.current[stageNumber] = setInterval(() => {
      frameIndex = (frameIndex + 1) % frames.length;
      setMessages((prev: any) =>
        prev.map((msg: any) =>
          msg.id === messageId
            ? {
                ...msg,
                content: `Ejecutando etapa ${stageNumber}: ${stageName}${frames[frameIndex]}`,
              }
            : msg
        )
      );
    }, 450);
  };

  const stopStageTypingIndicator = (stageNumber: number) => {
    const interval = executionTypingIntervalsRef.current[stageNumber];
    if (interval) {
      clearInterval(interval);
      delete executionTypingIntervalsRef.current[stageNumber];
    }

    setMessages((prev: any) => prev.filter((msg: any) => msg.id !== `stage-typing-${stageNumber}`));
  };

  const getModelNameById = (id: string) => {
    const model = models?.find((m) => m.id === id);
    return getModelDisplayName(model);
  };

  const getModelConfigById = (id: string) => {
    const model = models?.find((m) => m.id === id);
    if (!model) return null;

    return {
      endpoint: model.base_url || (model as any).endpoint || '',
      modelName: model.model_name || model.name || model.nombre_modelo || '',
      apiKey: model.api_key || '',
      provider: model.provider || '',
    };
  };

  const effectivePlanModelId =
    selectedPlanModelId && models?.some((m) => m.id === selectedPlanModelId)
      ? selectedPlanModelId
      : (selectedModel?.id || '');

  const effectiveExecutionModelId =
    selectedExecutionModelId && models?.some((m) => m.id === selectedExecutionModelId)
      ? selectedExecutionModelId
      : (selectedModel?.id || '');

  useEffect(() => {
    // Scroll automático al final cuando se actualiza el contenido
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [streamingPlan?.stages]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (stageDropdownRef.current && !stageDropdownRef.current.contains(event.target as Node)) {
        setIsStageDropdownOpen(false);
      }

      if (planModelDropdownRef.current && !planModelDropdownRef.current.contains(event.target as Node)) {
        setIsPlanModelDropdownOpen(false);
      }

      if (executionModelDropdownRef.current && !executionModelDropdownRef.current.contains(event.target as Node)) {
        setIsExecutionModelDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleCreatePlan = async (resume = false) => {
    if (!resume && (!title || !description || !stages)) {
      setError('Por favor completa todos los campos');
      return;
    }

    if (resume && !streamingPlan) {
      setError('No hay un plan parcial para reanudar');
      return;
    }

    setIsLoading(true);
    setError(null);

    const planModelOverride = getModelConfigById(effectivePlanModelId);

    let payload: any;

    if (resume && streamingPlan) {
      payload = {
        title: streamingPlan.title,
        description: streamingPlan.description,
        stages: streamingPlan.totalStages,
        startFromStage: streamingPlan.stages.length + 1,
        modelId: effectivePlanModelId,
        existingStages: streamingPlan.stages.map((stage) => ({
          number: stage.number,
          name: stage.name,
          objective: stage.objective,
          tasks: stage.tasks,
          files: stage.files,
          dependencies: stage.dependencies,
        })),
      };
    } else {
      payload = {
        title,
        description,
        stages: parseInt(stages),
        modelId: effectivePlanModelId,
      };

      setStreamingPlan({
        title,
        description,
        totalStages: parseInt(stages),
        stages: [],
      });
    }

    // Incluir contexto del proyecto existente si el modo está activo
    if (isProjectContextMode && projectContext) {
      payload.projectContext = projectContext;
    }

    try {
      const response = await fetch('/api/structure-plan/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...payload,
          modelConfigOverride: planModelOverride || undefined,
          executionConfig, // Enviamos la configuración de tokens aquí
        }),
      });

      if (!response.ok) {
        throw new Error('Error al generar el plan');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('No se pudo leer el stream');
      }

      let sseBuffer = '';
      let isPlanFullyCompleted = false;

      const handleGenerateSseLine = (line: string) => {
        if (!line.startsWith('data: ')) return;

        try {
          const data = JSON.parse(line.slice(6));

          switch (data.type) {
            case 'start':
              setStreamingPlan(prev => prev ? ({
                ...prev,
                title: data.title,
                description: data.description,
                totalStages: data.totalStages,
              }) : null);
              break;

            case 'project_structure':
              setStreamingPlan(prev => prev ? ({
                ...prev,
                structure: data.structure,
              }) : null);
              break;

            case 'stage_complete':
              setStreamingPlan(prev => {
                if (!prev) return null;
                const incomingFiles = Array.isArray(data.stage?.files) ? data.stage.files : [];
                const updatedStages = [
                  ...prev.stages.filter((stage) => stage.number !== data.stage.number),
                  {
                    ...data.stage,
                    files: incomingFiles,
                    isStreaming: false,
                    content: JSON.stringify(data.stage, null, 2),
                    executionResult: undefined,
                    isExecuting: false,
                    executionCompleted: false,
                  },
                ].sort((a, b) => a.number - b.number);

                // Auto-ejecución de la etapa 1 si está en auto mode
                if (isAutoMode && data.stage.number === 1) {
                  // Pequeño delay para asegurar que el estado se asiente
                  setTimeout(() => handleExecuteStage(0), 500);
                }

                return { ...prev, stages: updatedStages };
              });
              break;

            case 'complete':
              isPlanFullyCompleted = true;
              setStreamingPlan(prev => prev ? ({
                ...prev,
                stages: prev.stages.map(stage => ({ ...stage, isStreaming: false })),
              }) : null);
              setError(null);
              setIsLoading(false);
              break;

            case 'error':
              setError(data.error);
              setIsLoading(false);
              // Auto reanudar si falló y estamos en auto mode
              if (isAutoMode && !isPlanFullyCompleted) {
                console.log('Error en generación, reintentando en 5s (Auto Mode)...');
                if (autoResumeTimeoutRef.current) clearTimeout(autoResumeTimeoutRef.current);
                autoResumeTimeoutRef.current = setTimeout(() => handleCreatePlan(true), 5000);
              }
              break;
          }
        } catch (e) {
          console.error('Error parsing SSE data:', e);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop() || '';

        for (const line of lines) {
          handleGenerateSseLine(line);
        }
      }

      const trailing = sseBuffer.trim();
      if (trailing) {
        handleGenerateSseLine(trailing);
      }

      // Si terminó el stream pero no recibimos 'complete', y estamos en auto mode, reintentar
      if (!isPlanFullyCompleted && isAutoMode && !isLoading) {
         console.log('Stream cerrado sin completar, reintentando en 5s (Auto Mode)...');
         if (autoResumeTimeoutRef.current) clearTimeout(autoResumeTimeoutRef.current);
         autoResumeTimeoutRef.current = setTimeout(() => handleCreatePlan(true), 5000);
      }
    } catch (err: any) {
      setError(err.message || 'Error al generar el plan');
      // Auto reanudar si hubo excepción y estamos en auto mode
      if (isAutoMode) {
        console.log('Excepción en generación, reintentando en 5s (Auto Mode)...');
        if (autoResumeTimeoutRef.current) clearTimeout(autoResumeTimeoutRef.current);
        autoResumeTimeoutRef.current = setTimeout(() => handleCreatePlan(true), 5000);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleImproveDescription = async () => {
    if (!description.trim()) {
      setError('Escribe una descripción básica primero para poder mejorarla.');
      return;
    }

    setIsImprovingDescription(true);
    setError(null);

    // Priorizamos el modelo de la barra de navegación (selectedModel) 
    // sobre el seleccionado específicamente en la pestaña de plan
    const modelIdToUse = selectedModel?.id || selectedPlanModelId || '';

    if (!modelIdToUse) {
      setError('Por favor, selecciona un modelo en la barra de navegación o en el selector de plan.');
      setIsImprovingDescription(false);
      return;
    }

    try {
      const response = await fetch('/api/generate-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userDescription: description,
          modelId: modelIdToUse,
          isLocalTarget,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Error al mejorar la descripción');
      }

      const data = await response.json();
      console.log('Datos recibidos de la varita mágica:', data);
      
      if (data.sophisticatedPrompt) {
        setDescription(data.sophisticatedPrompt);
        
        // Intentar extraer un título si el modelo generó uno (línea que empieza por "Título:" o similar)
        const titleMatch = data.sophisticatedPrompt.match(/^(?:Título|Title|Proyecto):\s*(.+)$/m);
        if (titleMatch && titleMatch[1]) {
          setTitle(titleMatch[1].trim());
        }
      }
    } catch (err: any) {
      setError(err.message || 'Error al conectar con la IA para mejorar el prompt');
    } finally {
      setIsImprovingDescription(false);
    }
  };

  const handleExecuteStage = async (stageIndex: number) => {
    if (!streamingPlan) return;

    const stage = streamingPlan.stages[stageIndex];
    const shouldResetChatBeforeExecution = stageIndex > 0;
    const previousStages = streamingPlan.stages.slice(0, stageIndex);
    const abortController = new AbortController();
    const executionModelOverride = getModelConfigById(effectiveExecutionModelId);
    executionControllersRef.current[stage.number] = abortController;

    if (shouldResetChatBeforeExecution) {
      startNewChat();
    }

    startStageTypingIndicator(stage.number, stage.name);

    setStreamingPlan(prev => prev ? ({
      ...prev,
      stages: prev.stages.map((s, i) =>
        i === stageIndex
          ? { ...s, isExecuting: true, executionCompleted: false, executionResult: { summary: '', files: [], explanation: '', nextSteps: [] } }
          : s
      ),
    }) : null);

    // Enviar mensaje de usuario al chat
    const userMessage = `Ejecutando etapa ${stage.number}: ${stage.name}\n\nObjetivo: ${stage.objective}`;
    setMessages((prev: any) => [
      ...prev,
      {
        id: `stage-${stage.number}-${Date.now()}`,
        role: 'user',
        content: userMessage,
        createdAt: new Date().toISOString(),
      },
    ]);

    const chatMessageBase = `stage-stream-${stage.number}`;

    // Filtrar archivos ya creados para no volver a generarlos
    const pendingFiles = stage.files
      .filter((f: any) => !(typeof f === 'object' && f.created))
      .map((f: any) => typeof f === 'string' ? f : f.path);
    const alreadyCreatedFiles = stage.files
      .filter((f: any) => typeof f === 'object' && f.created)
      .map((f: any) => f.path);

    try {
      const response = await fetch('/api/structure-plan/execute-stage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: abortController.signal,
        body: JSON.stringify({
          stage: {
            number: stage.number,
            name: stage.name,
            objective: stage.objective,
            tasks: stage.tasks,
            files: pendingFiles,
            dependencies: stage.dependencies,
          },
          alreadyCreatedFiles,
          previousStages,
          modelId: effectiveExecutionModelId,
          modelConfigOverride: executionModelOverride || undefined,
          projectTitle: streamingPlan.title,
          projectDescription: streamingPlan.description,
          projectStructure: streamingPlan.structure || undefined,
          executionConfig,
          projectContext: isProjectContextMode ? projectContext : undefined,
        }),
      });

      if (!response.ok) {
        throw new Error('Error al ejecutar la etapa');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('No se pudo leer el stream');
      }

      let executionResult: any = { summary: '', files: [], explanation: '', nextSteps: [] };
      let sseBuffer = '';
      let didReceiveComplete = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              switch (data.type) {
                case 'start':
                  // Metadata inicial
                  break;

                case 'summary':
                  executionResult.summary = data.content;
                  setStreamingPlan(prev => prev ? ({
                    ...prev,
                    stages: prev.stages.map((s, i) =>
                      i === stageIndex ? { ...s, executionResult: { ...executionResult, summary: data.content } } : s
                    ),
                  }) : null);

                  setMessages((prev: any) => [
                    ...prev,
                    {
                      id: `${chatMessageBase}-summary-${Date.now()}`,
                      role: 'assistant',
                      content: `Resumen etapa ${stage.number}:\n${data.content}`,
                      createdAt: new Date().toISOString(),
                    },
                  ]);
                  break;

                case 'file_start':
                  // Indicar que se está generando un archivo
                  setStreamingPlan(prev => prev ? ({
                    ...prev,
                    stages: prev.stages.map((s, i) =>
                      i === stageIndex ? { ...s, executionResult: { ...executionResult, currentFile: data.path } } : s
                    ),
                  }) : null);
                  break;

                case 'file_skipped':
                  // Archivo saltado porque ya estaba creado — marcarlo como creado en el plan
                  setStreamingPlan(prev => prev ? ({
                    ...prev,
                    stages: prev.stages.map((s, i) =>
                      i === stageIndex ? {
                        ...s,
                        files: s.files.map(f => {
                          const fPath = typeof f === 'string' ? f : f.path;
                          const normalizedSkipped = data.path.replace(/\\/g, '/').toLowerCase();
                          const normalizedPlanned = fPath.replace(/\\/g, '/').toLowerCase();
                          if (normalizedSkipped === normalizedPlanned || normalizedSkipped.endsWith('/' + normalizedPlanned) || normalizedPlanned.endsWith('/' + normalizedSkipped)) {
                            return { path: fPath, created: true };
                          }
                          return f;
                        }),
                      } : s
                    ),
                  }) : null);
                  setMessages((prev: any) => [
                    ...prev,
                    {
                      id: `${chatMessageBase}-skipped-${Date.now()}`,
                      role: 'assistant',
                      content: `⏭️ Archivo saltado (ya creado): ${data.path}`,
                      createdAt: new Date().toISOString(),
                    },
                  ]);
                  break;

                case 'file':
                  const nextFiles = [...executionResult.files, data.file];
                  executionResult.files = nextFiles;
                  setStreamingPlan(prev => prev ? ({
                    ...prev,
                    stages: prev.stages.map((s, i) =>
                      i === stageIndex ? { 
                        ...s, 
                        files: s.files.map(f => {
                          const fPath = typeof f === 'string' ? f : f.path;
                          const normalizedReceived = data.file.path.replace(/\\/g, '/').toLowerCase();
                          const normalizedPlanned = fPath.replace(/\\/g, '/').toLowerCase();
                          
                          if (normalizedReceived === normalizedPlanned || normalizedReceived.endsWith('/' + normalizedPlanned)) {
                            return { path: fPath, created: true };
                          }
                          return f;
                        }),
                        executionResult: { ...executionResult, files: nextFiles, currentFile: undefined } 
                      } : s
                    ),
                  }) : null);

                  setMessages((prev: any) => [
                    ...prev,
                    {
                      id: `${chatMessageBase}-file-${Date.now()}`,
                      role: 'assistant',
                      content: `Archivo generado: ${data.file.path}\n\n\`\`\`${data.file.path.split('.').pop() || 'text'}\n${data.file.content}\n\`\`\``,
                      createdAt: new Date().toISOString(),
                    },
                  ]);

                  refreshExplorer();
                  break;

                case 'explanation':
                  executionResult.explanation = data.content;
                  setStreamingPlan(prev => prev ? ({
                    ...prev,
                    stages: prev.stages.map((s, i) =>
                      i === stageIndex ? { ...s, executionResult: { ...executionResult, explanation: data.content } } : s
                    ),
                  }) : null);

                  setMessages((prev: any) => [
                    ...prev,
                    {
                      id: `${chatMessageBase}-explanation-${Date.now()}`,
                      role: 'assistant',
                      content: `Explicación etapa ${stage.number}:\n${data.content}`,
                      createdAt: new Date().toISOString(),
                    },
                  ]);
                  break;

                case 'nextSteps':
                  executionResult.nextSteps = data.steps;
                  setStreamingPlan(prev => prev ? ({
                    ...prev,
                    stages: prev.stages.map((s, i) =>
                      i === stageIndex ? { ...s, executionResult: { ...executionResult, nextSteps: data.steps } } : s
                    ),
                  }) : null);

                  if (Array.isArray(data.steps) && data.steps.length > 0) {
                    setMessages((prev: any) => [
                      ...prev,
                      {
                        id: `${chatMessageBase}-nextsteps-${Date.now()}`,
                        role: 'assistant',
                        content: `Próximos pasos etapa ${stage.number}:\n${data.steps.map((step: string) => `- ${step}`).join('\n')}`,
                        createdAt: new Date().toISOString(),
                      },
                    ]);
                  }
                  break;

                case 'complete':
                  didReceiveComplete = true;
                  executionResult = data.data;
                  stopStageTypingIndicator(stage.number);
                  setStreamingPlan(prev => {
                    if (!prev) return null;
                    const updatedStages = prev.stages.map((s, i) =>
                      i === stageIndex ? { ...s, isExecuting: false, executionCompleted: true, executionResult: data.data } : s
                    );

                    // Auto-ejecución de la siguiente etapa si está en auto mode
                    if (isAutoMode) {
                      const nextIndex = stageIndex + 1;
                      if (nextIndex < updatedStages.length) {
                        const nextStage = updatedStages[nextIndex];
                        if (!nextStage.isExecuting && !nextStage.executionCompleted) {
                          console.log(`Auto-ejecutando etapa ${nextStage.number}...`);
                          setTimeout(() => handleExecuteStage(nextIndex), 1000);
                        }
                      }
                    }

                    return { ...prev, stages: updatedStages };
                  });

                  setMessages((prev: any) => [
                    ...prev,
                    {
                      id: `stage-result-${stage.number}-${Date.now()}`,
                      role: 'assistant',
                      content: `✅ Etapa ${stage.number} completada: ${stage.name}`,
                      createdAt: new Date().toISOString(),
                    },
                  ]);
                  refreshExplorer();
                  break;

                case 'error':
                  stopStageTypingIndicator(stage.number);
                  setError(data.error || 'Error al ejecutar la etapa');
                  setStreamingPlan(prev => prev ? ({
                    ...prev,
                    stages: prev.stages.map((s, i) =>
                      i === stageIndex ? { ...s, isExecuting: false, executionCompleted: false } : s
                    ),
                  }) : null);

                  setMessages((prev: any) => [
                    ...prev,
                    {
                      id: `stage-error-${stage.number}-${Date.now()}`,
                      role: 'assistant',
                      content: `Error al ejecutar etapa ${stage.number}: ${data.error || 'Error desconocido'}`,
                      createdAt: new Date().toISOString(),
                    },
                  ]);
                  return;
              }
            } catch (e) {
              console.error('Error parsing SSE data:', e);
            }
          }
        }
      }

      if (sseBuffer.trim().startsWith('data: ')) {
        try {
          const data = JSON.parse(sseBuffer.trim().slice(6));
          if (data.type === 'complete') {
            didReceiveComplete = true;
            executionResult = data.data;
            stopStageTypingIndicator(stage.number);
            setStreamingPlan(prev => prev ? ({
              ...prev,
              stages: prev.stages.map((s, i) =>
                i === stageIndex ? { ...s, isExecuting: false, executionCompleted: true, executionResult: data.data } : s
              ),
            }) : null);

            setMessages((prev: any) => [
              ...prev,
              {
                id: `stage-result-${stage.number}-${Date.now()}`,
                role: 'assistant',
                content: `✅ Etapa ${stage.number} completada: ${stage.name}`,
                createdAt: new Date().toISOString(),
              },
            ]);
            refreshExplorer();
          }
        } catch (e) {
          console.error('Error parsing trailing SSE data:', e);
        }
      }

      if (!didReceiveComplete) {
        const hasExecutionOutput = !!(executionResult?.summary || executionResult?.files?.length || executionResult?.explanation);
        setStreamingPlan(prev => prev ? ({
          ...prev,
          stages: prev.stages.map((s, i) =>
            i === stageIndex
              ? {
                  ...s,
                  isExecuting: false,
                  executionCompleted: hasExecutionOutput,
                  executionResult: {
                    ...(s.executionResult || {}),
                    ...executionResult,
                    currentFile: undefined,
                  },
                }
              : s
          ),
        }) : null);

        if (hasExecutionOutput) {
          refreshExplorer();
        }
      }
    } catch (err: any) {
      stopStageTypingIndicator(stage.number);
      if (err?.name === 'AbortError') {
        setStreamingPlan(prev => prev ? ({
          ...prev,
          stages: prev.stages.map((s, i) =>
            i === stageIndex ? { ...s, isExecuting: false, executionCompleted: false } : s
          ),
        }) : null);
        return;
      }

      setError(err.message || 'Error al ejecutar la etapa');
      setStreamingPlan(prev => prev ? ({
        ...prev,
        stages: prev.stages.map((s, i) =>
          i === stageIndex ? { ...s, isExecuting: false, executionCompleted: false } : s
        ),
      }) : null);

      // Enviar mensaje de error al chat
      setMessages((prev: any) => [
        ...prev,
        {
          id: `stage-error-${stage.number}-${Date.now()}`,
          role: 'assistant',
          content: `Error al ejecutar etapa ${stage.number}: ${err.message}`,
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      stopStageTypingIndicator(stage.number);
      delete executionControllersRef.current[stage.number];
    }
  };

  const handleStopStageExecution = (stageIndex: number) => {
    if (!streamingPlan) return;

    const stage = streamingPlan.stages[stageIndex];
    const controller = executionControllersRef.current[stage.number];

    if (controller) {
      controller.abort();
      delete executionControllersRef.current[stage.number];
    }

    stopStageTypingIndicator(stage.number);

    setStreamingPlan(prev => prev ? ({
      ...prev,
      stages: prev.stages.map((s, i) =>
        i === stageIndex ? { ...s, isExecuting: false, executionCompleted: false } : s
      ),
    }) : null);
  };

  useEffect(() => {
    return () => {
      Object.values(executionTypingIntervalsRef.current).forEach((interval) => clearInterval(interval));
      executionTypingIntervalsRef.current = {};
    };
  }, []);

  return (
    <div className="bg-transparent rounded-none border border-border/80 p-6 h-full overflow-y-auto custom-scrollbar" ref={scrollContainerRef}>
      <div className="flex items-center justify-between mb-10">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-success/20 border border-success rounded-xl">
            <GitBranch className="w-6 h-6 text-success" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">Structure Plan</h2>
            <p className="text-sm text-muted-foreground/80 font-medium">Generate project structure by stages</p>
          </div>
        </div>
        {selectedModel && (
          <div className="flex flex-col gap-2 px-3 py-2 bg-background border border-blue-800 rounded-lg min-w-[260px]">
            <span className="text-[11px] font-bold text-success uppercase tracking-wider mb-1">Modo Automático</span>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-primary-foreground shrink-0">Plan</span>
              <select
                value={effectivePlanModelId}
                onChange={(e) => setSelectedPlanModelId(e.target.value)}
                disabled={!models || models.length === 0}
                className="w-full bg-background border border-blue-800 rounded-md px-2 py-1 text-[11px] text-foreground outline-none"
              >
                {models?.length ? (
                  models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {getModelDisplayName(model)}
                    </option>
                  ))
                ) : (
                  <option value="">No hay modelos</option>
                )}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-purple-300 shrink-0">Plan Guardado</span>
              <select
                value={selectedPlanId}
                onChange={(e) => {
                  setSelectedPlanId(e.target.value);
                  if (e.target.value) {
                    handleLoadPlan(e.target.value);
                  }
                }}
                disabled={savedPlans.length === 0}
                className="w-full bg-background border border-purple-800 rounded-md px-2 py-1 text-[11px] text-foreground outline-none"
              >
                <option value="">Seleccionar plan...</option>
                {savedPlans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.title} ({plan.total_stages} etapas)
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-cyan-300 shrink-0">Ejecución</span>
              <select
                value={effectiveExecutionModelId}
                onChange={(e) => setSelectedExecutionModelId(e.target.value)}
                disabled={!models || models.length === 0}
                className="w-full bg-background border border-cyan-800 rounded-md px-2 py-1 text-[11px] text-foreground outline-none"
              >
                {models?.length ? (
                  models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {getModelDisplayName(model)}
                    </option>
                  ))
                ) : (
                  <option value="">No hay modelos</option>
                )}
              </select>
            </div>
            <div className="h-[1px] bg-card w-full mt-1 mb-1" />
            {/* Toggle Contexto de Proyecto */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">Contexto de Proyecto</span>
                <span className="text-[9px] text-muted-foreground/80">
                  {isProjectContextMode
                    ? (projectContext
                        ? `${projectContext.files.length} archivos, ${projectContext.folders.length} carpetas`
                        : 'Escaneando...')
                    : 'Incluir estructura existente'}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {isProjectContextMode && (
                  <button
                    onClick={scanProjectStructure}
                    disabled={isScanningProject}
                    className="p-1 hover:bg-card rounded text-muted-foreground/80 hover:text-amber-400 transition-colors"
                    title="Re-escanear estructura del proyecto"
                  >
                    {isScanningProject ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3 h-3" />
                    )}
                  </button>
                )}
                <button
                  onClick={toggleProjectContextMode}
                  className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors focus:outline-none ${
                    isProjectContextMode ? 'bg-amber-600' : 'bg-muted'
                  }`}
                >
                  <span
                    className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                      isProjectContextMode ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
            <div className="h-[1px] bg-card w-full mt-1 mb-1" />
            <div className="flex items-center justify-between gap-4">
              <button
                onClick={() => setIsAutoMode(!isAutoMode)}
                className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors focus:outline-none ${
                  isAutoMode ? 'bg-success' : 'bg-muted'
                }`}
              >
                <span
                  className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                    isAutoMode ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleSavePlan}
                  disabled={!streamingPlan}
                  className="flex items-center gap-1.5 px-2 py-1 bg-success/20 hover:bg-success/50 border border-success rounded-md text-[11px] text-success transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Guardar plan en base de datos"
                >
                  <Save className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={handleDeletePlan}
                  disabled={!selectedPlanId}
                  className="flex items-center gap-1.5 px-2 py-1 bg-red-900/30 hover:bg-red-800/50 border border-red-800 rounded-md text-[11px] text-destructive transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Borrar plan seleccionado"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="max-w-5xl mx-auto">
        {!streamingPlan ? (
          <div className="bg-background border border-blue-800 rounded-xl p-6">
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Título</label>
                <input
                  type="text"
                  placeholder="Ej: Aplicación de notas"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-card border border-border/50 rounded-lg px-4 py-3 text-sm text-foreground outline-none focus:border-success transition-all"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Descripción</label>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={isLocalTarget}
                        onChange={(e) => setIsLocalTarget(e.target.checked)}
                        className="w-3.5 h-3.5 rounded border-border/50 bg-card text-success focus:ring-success focus:ring-offset-gray-900 transition-all cursor-pointer"
                      />
                      <span className="text-[10px] text-muted-foreground/80 group-hover:text-muted-foreground transition-colors">Optimizar para local</span>
                    </label>
                    <button
                      onClick={handleImproveDescription}
                      disabled={isImprovingDescription || !description.trim()}
                      title="Mejorar descripción con IA"
                      className="flex items-center gap-1.5 px-2 py-1 bg-primary/30 hover:bg-primary/50 border border-blue-800 rounded-md text-[11px] text-primary transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                    >
                      {isImprovingDescription ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Wand2 className="w-3.5 h-3.5 group-hover:rotate-12 transition-transform" />
                      )}
                      Mejorar con IA
                    </button>
                  </div>
                </div>
                <textarea
                  placeholder="Describe el propósito de este proyecto..."
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-card border border-border/50 rounded-lg px-4 py-3 text-sm text-foreground outline-none focus:border-success transition-all resize-none"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Número de Etapas</label>
                <div className="relative" ref={stageDropdownRef}>
                  <button
                    type="button"
                    onClick={() => setIsStageDropdownOpen((prev) => !prev)}
                    className="w-full bg-card border border-border/50 rounded-lg px-4 py-3 text-sm text-foreground outline-none focus:border-success transition-all text-left flex items-center justify-between"
                  >
                    <span>{stages ? `${stages} Etapas` : 'Seleccionar cantidad de etapas...'}</span>
                    <span className="text-muted-foreground/80">▾</span>
                  </button>

                  {isStageDropdownOpen && (
                    <div className="absolute z-30 mt-2 w-full bg-card border border-border/50 rounded-lg shadow-xl max-h-48 overflow-y-auto custom-scrollbar">
                      {Array.from({ length: 30 }, (_, i) => i + 1).map((count) => (
                        <button
                          key={count}
                          type="button"
                          onClick={() => {
                            setStages(String(count));
                            setIsStageDropdownOpen(false);
                          }}
                          className={`w-full text-left px-4 py-2 text-sm transition-all ${
                            stages === String(count)
                              ? 'bg-success/30 text-success'
                              : 'text-foreground/70 hover:bg-muted'
                          }`}
                        >
                          {count} {count === 1 ? 'Etapa' : 'Etapas'}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Modelos</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[11px] text-muted-foreground/80">Modelo para generar plan</label>
                    <div className="relative" ref={planModelDropdownRef}>
                      <button
                        type="button"
                        onClick={() => {
                          if (!models?.length) return;
                          setIsPlanModelDropdownOpen((prev) => !prev);
                          setIsExecutionModelDropdownOpen(false);
                        }}
                        disabled={!models || models.length === 0}
                        className="w-full bg-card border border-border/50 rounded-lg px-3 py-2 text-xs text-foreground outline-none focus:border-success transition-all text-left flex items-center justify-between disabled:text-muted-foreground/80 disabled:cursor-not-allowed"
                      >
                        <span className="truncate">
                          {models?.length
                            ? getModelNameById(effectivePlanModelId)
                            : 'No hay modelos disponibles'}
                        </span>
                        <span className="text-muted-foreground/80 ml-2">▾</span>
                      </button>

                      {isPlanModelDropdownOpen && (
                        <div className="absolute z-30 mt-2 w-full bg-card border border-border/50 rounded-lg shadow-xl max-h-40 overflow-y-auto custom-scrollbar">
                          {models.map((model) => (
                            <button
                              key={model.id}
                              type="button"
                              onClick={() => {
                                setSelectedPlanModelId(model.id);
                                setIsPlanModelDropdownOpen(false);
                              }}
                              className={`w-full text-left px-3 py-2 text-xs transition-all ${
                                effectivePlanModelId === model.id
                                  ? 'bg-success/30 text-success'
                                  : 'text-foreground/70 hover:bg-muted'
                              }`}
                            >
                              <span className="block truncate">{getModelDisplayName(model)}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] text-muted-foreground/80">Modelo para ejecutar etapas</label>
                    <div className="relative" ref={executionModelDropdownRef}>
                      <button
                        type="button"
                        onClick={() => {
                          if (!models?.length) return;
                          setIsExecutionModelDropdownOpen((prev) => !prev);
                          setIsPlanModelDropdownOpen(false);
                        }}
                        disabled={!models || models.length === 0}
                        className="w-full bg-card border border-border/50 rounded-lg px-3 py-2 text-xs text-foreground outline-none focus:border-success transition-all text-left flex items-center justify-between disabled:text-muted-foreground/80 disabled:cursor-not-allowed"
                      >
                        <span className="truncate">
                          {models?.length
                            ? getModelNameById(effectiveExecutionModelId)
                            : 'No hay modelos disponibles'}
                        </span>
                        <span className="text-muted-foreground/80 ml-2">▾</span>
                      </button>

                      {isExecutionModelDropdownOpen && (
                        <div className="absolute z-30 mt-2 w-full bg-card border border-border/50 rounded-lg shadow-xl max-h-40 overflow-y-auto custom-scrollbar">
                          {models.map((model) => (
                            <button
                              key={model.id}
                              type="button"
                              onClick={() => {
                                setSelectedExecutionModelId(model.id);
                                setIsExecutionModelDropdownOpen(false);
                              }}
                              className={`w-full text-left px-3 py-2 text-xs transition-all ${
                                effectiveExecutionModelId === model.id
                                  ? 'bg-success/30 text-success'
                                  : 'text-foreground/70 hover:bg-muted'
                              }`}
                            >
                              <span className="block truncate">{getModelDisplayName(model)}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Configuración del Modelo (Ejecución por Etapa)</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[11px] text-muted-foreground/80">Tokens planning</label>
                    <input
                      type="number"
                      min={100}
                      step={50}
                      value={executionConfig.planningMaxTokens}
                      onChange={(e) => setExecutionConfig((prev) => ({
                        ...prev,
                        planningMaxTokens: Math.max(100, Number(e.target.value) || 100),
                      }))}
                      className="w-full bg-card border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-success transition-all"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] text-muted-foreground/80">Tokens por archivo</label>
                    <input
                      type="number"
                      min={200}
                      step={50}
                      value={executionConfig.fileMaxTokens}
                      onChange={(e) => setExecutionConfig((prev) => ({
                        ...prev,
                        fileMaxTokens: Math.max(200, Number(e.target.value) || 200),
                      }))}
                      className="w-full bg-card border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-success transition-all"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] text-muted-foreground/80">Tokens respuesta final</label>
                    <input
                      type="number"
                      min={100}
                      step={50}
                      value={executionConfig.finalMaxTokens}
                      onChange={(e) => setExecutionConfig((prev) => ({
                        ...prev,
                        finalMaxTokens: Math.max(100, Number(e.target.value) || 100),
                      }))}
                      className="w-full bg-card border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-success transition-all"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] text-muted-foreground/80">Máx. caracteres por archivo</label>
                    <input
                      type="number"
                      min={2000}
                      step={500}
                      value={executionConfig.maxFileContentChars}
                      onChange={(e) => setExecutionConfig((prev) => ({
                        ...prev,
                        maxFileContentChars: Math.max(2000, Number(e.target.value) || 2000),
                      }))}
                      className="w-full bg-card border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-success transition-all"
                    />
                  </div>
                </div>
              </div>

              {error && (
                <div className="p-3 bg-red-900/30 border border-red-800 rounded-lg">
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              )}

              <div className="pt-4">
                <button
                  onClick={() => handleCreatePlan(false)}
                  disabled={isLoading}
                  className="w-full px-6 py-3 bg-success hover:bg-success disabled:bg-success/80 disabled:cursor-not-allowed text-foreground rounded-lg font-bold transition-all shadow-lg shadow-success/20 flex items-center justify-center gap-2"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Generando plan...
                    </>
                  ) : (
                    'Generar Plan'
                  )}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="bg-transparent rounded-xl p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold text-foreground">{streamingPlan.title}</h3>
                <div className="flex items-center gap-3">
                  {canResumeGeneration && (
                    <button
                      onClick={() => handleCreatePlan(true)}
                      disabled={isLoading}
                      className="px-4 py-2 bg-success hover:bg-success disabled:bg-success/80 disabled:cursor-not-allowed text-foreground rounded-lg text-sm font-medium transition-all"
                    >
                      Reanudar desde etapa {streamingPlan.stages.length + 1}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setStreamingPlan(null);
                      setTitle('');
                      setDescription('');
                      setStages('');
                      setError(null);
                    }}
                    className="px-4 py-2 bg-card hover:bg-muted text-foreground/70 rounded-lg text-sm font-medium transition-all"
                  >
                    Nuevo Plan
                  </button>
                </div>
              </div>
              
              <div className="mb-6">
                <p className="text-xs font-bold text-muted-foreground/80 uppercase tracking-widest mb-2">Descripción del Proyecto</p>
                <div className="bg-input border border-border/40 rounded-lg p-4 max-h-40 overflow-y-auto custom-scrollbar">
                  <p className="text-muted-foreground text-sm whitespace-pre-wrap">{streamingPlan.description}</p>
                </div>
              </div>

              {/* Mostrar estructura del proyecto como árbol */}
              {streamingPlan.structure && (
                <div className="mb-6">
                  <p className="text-xs font-bold text-muted-foreground/80 uppercase tracking-widest mb-2">Estructura del Proyecto</p>
                  <div className="bg-input border border-border/40 rounded-lg p-4">
                    {streamingPlan.structure.overview && (
                      <p className="text-xs text-muted-foreground mb-3">{streamingPlan.structure.overview}</p>
                    )}
                    <div className="bg-input border border-border/40 rounded-lg p-3 max-h-72 overflow-y-auto custom-scrollbar">
                      {(() => {
                        const tree = buildFileTree(streamingPlan.structure?.folders, streamingPlan.structure?.files);
                        return Object.keys(tree).length > 0 ? (
                          Object.entries(tree).map(([name, node]) => (
                            <FileTreeNode key={name} name={name} node={node} />
                          ))
                        ) : (
                          <p className="text-[10px] text-muted-foreground/60 italic">No se definió estructura</p>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-4">
                {isLoading && (
                  streamingPlan.stages.length === 0 ? (
                    <div className="bg-input border border-border/40 rounded-lg p-8 flex flex-col items-center justify-center gap-4">
                      <div className="flex gap-2">
                        <span className="w-3 h-3 bg-success rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                        <span className="w-3 h-3 bg-success rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                        <span className="w-3 h-3 bg-success rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                      </div>
                      <p className="text-muted-foreground text-sm">Generando plan...</p>
                    </div>
                  ) : (
                    <div className="bg-input border border-border/40 rounded-lg p-3 flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Generando siguientes etapas...</span>
                      <div className="flex gap-1.5">
                        <span className="w-2 h-2 bg-success rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                        <span className="w-2 h-2 bg-success rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                        <span className="w-2 h-2 bg-success rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                      </div>
                    </div>
                  )
                )}

                {streamingPlan.stages.map((stage: StreamingStage, index: number) => (
                  <div key={index} className="bg-input border border-border/40 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-success/20 border border-success rounded-lg flex items-center justify-center flex-shrink-0">
                          <span className="text-success font-bold text-lg">{stage.number}</span>
                        </div>
                        <div>
                          <h4 className="text-foreground font-bold text-lg">{stage.name}</h4>
                          <p className="text-xs text-muted-foreground/80 uppercase tracking-widest">Etapa {stage.number}</p>
                        </div>
                        {stage.isStreaming && (
                          <Loader2 className="w-4 h-4 text-success animate-spin ml-2" />
                        )}
                      </div>
                      {!stage.isStreaming && (
                        stage.isExecuting ? (
                          <button
                            onClick={() => handleStopStageExecution(index)}
                            className="px-4 py-2 bg-destructive hover:bg-destructive text-foreground rounded-lg text-sm font-medium transition-all flex items-center gap-2"
                          >
                            STOP
                          </button>
                        ) : (
                          <div className="flex items-center gap-2">
                            {stage.executionCompleted && (
                              <span className="px-2 py-1 bg-success/30 border border-success rounded text-success text-xs font-medium flex items-center gap-1">
                                <Check className="w-3.5 h-3.5" />
                                OK
                              </span>
                            )}
                            <button
                              onClick={() => handleExecuteStage(index)}
                              className="px-4 py-2 bg-success hover:bg-success text-foreground rounded-lg text-sm font-medium transition-all flex items-center gap-2"
                            >
                              Ejecutar
                            </button>
                          </div>
                        )
                      )}
                    </div>
                    
                    {stage.isStreaming ? (
                      <div className="bg-input border border-border/40 rounded-lg p-4 max-h-60 overflow-y-auto custom-scrollbar">
                        <pre className="text-sm text-muted-foreground font-mono whitespace-pre-wrap">{stage.content}</pre>
                      </div>
                    ) : (
                      <div className="space-y-4 ml-13">
                        <div>
                          <p className="text-xs font-bold text-muted-foreground/80 uppercase tracking-widest mb-2">Objetivo</p>
                          <p className="text-sm text-foreground/70">{stage.objective}</p>
                        </div>
                        
                        {stage.tasks && stage.tasks.length > 0 && (
                          <div>
                            <p className="text-xs font-bold text-muted-foreground/80 uppercase tracking-widest mb-2">Tareas</p>
                            <ul className="space-y-2">
                              {stage.tasks.map((task: string, taskIndex: number) => (
                                <li key={taskIndex} className="text-sm text-muted-foreground flex items-start gap-2">
                                  <span className="text-success mt-0.5">•</span>
                                  <span>{task}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        
                        <div>
                          <p className="text-xs font-bold text-muted-foreground/80 uppercase tracking-widest mb-2">Archivos</p>
                          {stage.files && stage.files.length > 0 ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                              {stage.files.map((file: string | { path: string; created: boolean }, fileIndex: number) => {
                                const filePath = typeof file === 'string' ? file : file.path;
                                const isCreated = typeof file === 'object' && file.created;
                                const fileName = filePath.split('/').pop() || filePath;
                                return (
                                  <div
                                    key={fileIndex}
                                    className={`rounded-lg border p-2.5 flex items-center gap-2 transition-colors bg-input border-border/40 ${
                                      isCreated
                                        ? 'text-success'
                                        : 'text-muted-foreground'
                                    }`}
                                    title={filePath}
                                  >
                                    <span className="text-xs shrink-0">
                                      {isCreated ? '✅' : '📄'}
                                    </span>
                                    <span className="text-[11px] font-mono truncate">{fileName}</span>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground/60 italic">Sin archivos asignados</p>
                          )}
                        </div>
                        
                        {stage.dependencies && stage.dependencies.length > 0 && (
                          <div>
                            <p className="text-xs font-bold text-muted-foreground/80 uppercase tracking-widest mb-2">Dependencias</p>
                            <div className="flex flex-wrap gap-2">
                              {stage.dependencies.map((dep: string, depIndex: number) => (
                                <span key={depIndex} className="px-3 py-1.5 bg-primary/30 border border-blue-800 rounded text-xs text-primary">
                                  {dep}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {stage.executionResult && (
                          <div className="mt-6 pt-6 border-t border-border/80">
                            <button
                              type="button"
                              onClick={() => setExpandedExecutionResults((prev) => ({
                                ...prev,
                                [stage.number]: !prev[stage.number],
                              }))}
                              className="w-full text-left text-xs font-bold text-success uppercase tracking-widest mb-3 flex items-center justify-between gap-2"
                            >
                              <span className="flex items-center gap-2">
                                <span className="w-2 h-2 bg-success rounded-full"></span>
                                Resultado de Ejecución
                                {stage.isExecuting && stage.executionResult.currentFile && (
                                  <span className="ml-2 text-success text-xs normal-case tracking-normal">
                                    Generando: {stage.executionResult.currentFile}
                                  </span>
                                )}
                              </span>
                              {expandedExecutionResults[stage.number] ? (
                                <ChevronDown className="w-4 h-4 text-success" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-success" />
                              )}
                            </button>

                            {expandedExecutionResults[stage.number] && (
                              stage.executionResult.raw ? (
                                <div className="bg-input border border-border/40 rounded-lg p-4">
                                  <p className="text-xs text-muted-foreground/80 mb-2">Respuesta del modelo:</p>
                                  <pre className="text-sm text-foreground/70 whitespace-pre-wrap">{stage.executionResult.raw}</pre>
                                </div>
                              ) : (
                                <div className="space-y-4">
                                  {stage.executionResult.summary && (
                                    <div>
                                      <p className="text-xs font-bold text-muted-foreground/80 uppercase tracking-widest mb-2">Resumen</p>
                                      <p className="text-sm text-foreground/70">{stage.executionResult.summary}</p>
                                    </div>
                                  )}

                                  {stage.executionResult.files && stage.executionResult.files.length > 0 && (
                                    <div>
                                      <p className="text-xs font-bold text-muted-foreground/80 uppercase tracking-widest mb-2">Archivos Generados</p>
                                      <div className="space-y-3">
                                        {stage.executionResult.files.map((file: any, fileIndex: number) => (
                                          <div
                                            key={fileIndex}
                                            className="rounded-lg p-3 border bg-input border-border/40"
                                          >
                                            <p className="text-xs text-success font-mono mb-2">{file.path}</p>
                                            {file?.persisted && (
                                              <div className="mb-2 text-[11px]">
                                                {file.persisted.saved ? (
                                                  <div className="text-success space-y-1">
                                                    <p>✅ Guardado en plan: <span className="font-mono">{file.persisted.planName}</span></p>
                                                    {file.persisted.taskResult?.result?.path && (
                                                      <p className="text-muted-foreground">Ruta real: <span className="font-mono">{file.persisted.taskResult.result.path}</span></p>
                                                    )}
                                                  </div>
                                                ) : (
                                                  <p className="text-rose-400">⚠️ No se pudo persistir: {file.persisted.error}</p>
                                                )}
                                              </div>
                                            )}
                                            <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap max-h-40 overflow-y-auto custom-scrollbar">{file.content}</pre>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {stage.executionResult.explanation && (
                                    <div>
                                      <p className="text-xs font-bold text-muted-foreground/80 uppercase tracking-widest mb-2">Explicación</p>
                                      <p className="text-sm text-foreground/70 whitespace-pre-wrap">{stage.executionResult.explanation}</p>
                                    </div>
                                  )}

                                  {stage.executionResult.nextSteps && stage.executionResult.nextSteps.length > 0 && (
                                    <div>
                                      <p className="text-xs font-bold text-muted-foreground/80 uppercase tracking-widest mb-2">Próximos Pasos</p>
                                      <ul className="space-y-1">
                                        {stage.executionResult.nextSteps.map((step: string, stepIndex: number) => (
                                          <li key={stepIndex} className="text-sm text-muted-foreground flex items-start gap-2">
                                            <span className="text-success mt-0.5">→</span>
                                            <span>{step}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                </div>
                              )
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
