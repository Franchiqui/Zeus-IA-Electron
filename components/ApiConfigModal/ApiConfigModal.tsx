'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Modal } from '@/components/ui/modal';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { ChevronDownIcon, BeakerIcon, Cog6ToothIcon, RocketLaunchIcon } from '@heroicons/react/24/outline';
import { Bot } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ApiConfigModalProps, ApiEndpoint, Parameter, PipelineConfig, Model } from './types';
import { ENDPOINTS } from './endpoints';
import { getMethodColor, themeClasses } from './utils';
import pb from '@/lib/pocketbase';
import { MODELOS_COLLECTION_NAME } from '@/lib/collections';

const RAE_API_URL = 'http://localhost:3011';

export default function ApiConfigModal({
  isOpen,
  onClose,
  models = [],
  pipelineConfigs = [],
  activePipeline = null,
  selectedModel: initialSelectedModel = null,
  isDarkMode = true
}: ApiConfigModalProps) {
  const [selectedEndpoint, setSelectedEndpoint] = useState<ApiEndpoint | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [apiResponse, setApiResponse] = useState<any>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [pipelineConfig, setPipelineConfig] = useState<PipelineConfig | null>(null);
  const [isSavingPipeline, setIsSavingPipeline] = useState(false);
  const [localModelConfig, setLocalModelConfig] = useState<Model | null>(initialSelectedModel);
  const [isSavingModel, setIsSavingModel] = useState(false);
  const [localPipelineModels, setLocalPipelineModels] = useState<any[]>([]);

  // Update local model config when prop changes
  useEffect(() => {
    setLocalModelConfig(initialSelectedModel);
  }, [initialSelectedModel]);

  // Fetch pipeline config and local models from API when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchPipelineConfig();
      fetchLocalPipelineModels();
    }
  }, [isOpen]);

  const fetchLocalPipelineModels = async () => {
    try {
      // Obtener modelos y proveedores de la base local
      const [resModels, resProviders] = await Promise.all([
        fetch(`${RAE_API_URL}/api/v1/models?limit=100`),
        fetch(`${RAE_API_URL}/api/v1/providers?limit=100`)
      ]);

      const dataModels = resModels.ok ? await resModels.json() : { records: [] };
      const dataProviders = resProviders.ok ? await resProviders.json() : { records: [] };

      // Mapa de proveedores por ID
      const providersMap = new Map<string, any>();
      (dataProviders.records || dataProviders.items || []).forEach((p: any) => {
        providersMap.set(p.id, p);
      });

      // Enriquecer cada modelo con los datos de su proveedor
      const recordsModels = (dataModels.records || dataModels.items || []).map((m: any) => {
        const provider = providersMap.get(m.providerId) || null;
        return {
          ...m,
          _collection: 'models',
          // Datos del proveedor para el formulario
          provider: provider?.name || m.provider || '',
          apiUrl: provider?.baseUrl || provider?.base_url || m.base_url || m.apiUrl || '',
          apiKey: provider?.apiKey || provider?.api_key || m.api_key || m.apiKey || '',
        };
      });

      setLocalPipelineModels(recordsModels);
    } catch (error) {
      console.error('Error fetching local pipeline models:', error);
    }
  };

  const saveModelConfig = async () => {
    if (!localModelConfig) return;
    setIsSavingModel(true);
    try {
      let providerId = '';

      // 1. Buscar proveedor por NOMBRE (nunca usar el nombre como ID)
      if (localModelConfig.provider) {
        const searchRes = await fetch(`${RAE_API_URL}/api/v1/providers?filter=${encodeURIComponent(`name = "${localModelConfig.provider}"`)}&limit=1`);
        const searchData = searchRes.ok ? await searchRes.json() : { records: [] };
        const existing = (searchData.records || searchData.items || [])[0];

        if (existing) {
          providerId = existing.id;
          // Actualizar URL y key del proveedor existente
          await fetch(`${RAE_API_URL}/api/v1/providers/${providerId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              baseUrl: localModelConfig.apiUrl || existing.baseUrl || '',
              apiKey: localModelConfig.apiKey || existing.apiKey || ''
            })
          });
        } else if (localModelConfig.apiUrl) {
          // Crear nuevo proveedor
          const createRes = await fetch(`${RAE_API_URL}/api/v1/providers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: localModelConfig.provider,
              baseUrl: localModelConfig.apiUrl,
              apiKey: localModelConfig.apiKey || ''
            })
          });
          if (createRes.ok) {
            const created = await createRes.json();
            providerId = created.id;
          }
        }
      }

      // 2. Guardar el modelo con solo los campos que existen en el esquema RAE
      // (name, providerId, modelName, temperature, maxTokens, isActive)
      const modelUpdateData: any = {
        name: localModelConfig.modelName || localModelConfig.name || 'modelo',
        providerId: providerId || localModelConfig.provider || '',
        temperature: localModelConfig.temperature ?? 0.7,
        maxTokens: localModelConfig.maxTokens ?? 2048,
        stream: localModelConfig.stream ?? false,
        isActive: true
      };
      if (localModelConfig.modelName) modelUpdateData.modelName = localModelConfig.modelName;

      const isNewModel = !localModelConfig.id;
      const url = isNewModel
        ? `${RAE_API_URL}/api/v1/models`
        : `${RAE_API_URL}/api/v1/models/${localModelConfig.id}`;
      const method = isNewModel ? 'POST' : 'PATCH';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(modelUpdateData)
      });

      if (res.ok) {
        const saved = await res.json();
        if (isNewModel && saved.id) {
          setLocalModelConfig((prev) => prev ? { ...prev, id: saved.id } : prev);
        }
        alert(isNewModel ? 'Modelo creado correctamente' : 'Configuración guardada');
        await fetchLocalPipelineModels();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('refreshModels'));
        }
      } else {
        const errorText = await res.text();
        throw new Error(`Error ${res.status}: ${errorText}`);
      }
    } catch (error) {
      console.error('Error saving model config:', error);
      alert(`Error al guardar: ${error}`);
    } finally {
      setIsSavingModel(false);
    }
  };

  const startNewLocalModel = () => {
    setLocalModelConfig({
      name: '',
      provider: 'Ollama',
      apiUrl: 'http://localhost:11434',
      apiKey: '',
      modelName: '',
      temperature: 0.7,
      maxTokens: 2048,
      topP: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
      systemPrompt: '',
      stream: false
    });
  };

  const handleModelParamChange = (field: keyof Model, value: any) => {
    if (!localModelConfig) return;
    setLocalModelConfig({
      ...localModelConfig,
      [field]: value
    });
  };

  const fetchPipelineConfig = async () => {
    try {
      // Primero intentar obtener la activa
      const resActive = await fetch(`${RAE_API_URL}/api/v1/pipeline-configs/active`);
      if (resActive.ok) {
        const config = await resActive.json();
        setPipelineConfig(config);
        return;
      }

      // Si no hay activa, obtener todas y pillar la primera (o la más reciente)
      const resAll = await fetch(`${RAE_API_URL}/api/v1/pipeline-configs?limit=1&sort=-created`);
      if (resAll.ok) {
        const data = await resAll.json();
        const configs = data.records || data.items || [];
        if (configs.length > 0) {
          setPipelineConfig(configs[0]);
        } else {
          setPipelineConfig(null);
        }
      } else {
        setPipelineConfig(null);
      }
    } catch (error) {
      console.error('Error fetching pipeline config:', error);
      setPipelineConfig(null);
    }
  };

  const savePipelineConfig = async () => {
    if (!pipelineConfig) return;
    setIsSavingPipeline(true);
    try {
      console.log('Saving pipeline config:', pipelineConfig);
      console.log('Embedding model ID being saved:', pipelineConfig.embeddingModelId);
      const res = await fetch(`${RAE_API_URL}/api/v1/pipeline-configs/${pipelineConfig.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pipelineConfig)
      });
      if (res.ok) {
        const updated = await res.json();
        console.log('Pipeline config saved successfully:', updated);
        console.log('Saved embedding model ID:', updated.embeddingModelId);
        setPipelineConfig(updated);
        alert('Configuración guardada correctamente');
      } else {
        const errorText = await res.text();
        console.error('Error saving pipeline config:', res.status, errorText);
        alert(`Error al guardar configuración: ${res.status} - ${errorText}`);
      }
    } catch (error) {
      console.error('Error saving pipeline config:', error);
      alert(`Error al guardar configuración: ${error}`);
    } finally {
      setIsSavingPipeline(false);
    }
  };

  const createDefaultPipelineConfig = async () => {
    setIsSavingPipeline(true);
    try {
      // First, create the embedding model if it doesn't exist
      const embeddingModelRes = await fetch(`${RAE_API_URL}/api/v1/models/create-embedding-model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      let embeddingModelId = '';
      if (embeddingModelRes.ok) {
        const embeddingModel = await embeddingModelRes.json();
        embeddingModelId = embeddingModel.id || embeddingModel.modelId || 'nomic-embed-text';
        console.log('Embedding model created/found:', embeddingModel);
      } else {
        console.warn('Could not create embedding model, using default ID');
        embeddingModelId = 'nomic-embed-text';
      }

      const defaultConfig = {
        name: 'Pipeline Activado',
        isActive: true,
        ingestionModelId: '',
        retrievalModelId: '',
        orchestrationModelId: '',
        generationModelId: '',
        chunkSize: 1000,
        chunkOverlap: 200,
        embeddingModelId: embeddingModelId,
        systemPrompt: 'Eres una asistente experto. Responde siempre en español.'
      };
      const res = await fetch(`${RAE_API_URL}/api/v1/pipeline-configs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(defaultConfig)
      });
      if (res.ok) {
        const created = await res.json();
        setPipelineConfig(created);
      } else {
        const errorText = await res.text();
        console.error('Error creating pipeline config:', res.status, errorText);
        alert(`Error al crear configuración: ${res.status} - ${errorText}`);
      }
    } catch (error) {
      console.error('Error creating pipeline config:', error);
      alert(`Error al crear configuración: ${error}`);
    } finally {
      setIsSavingPipeline(false);
    }
  };

  const fixEmbeddingModel = async () => {
    setIsSavingPipeline(true);
    try {
      const res = await fetch(`${RAE_API_URL}/api/v1/pipeline-configs/fix-embedding-model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        const data = await res.json();
        console.log('Embedding model fixed:', data);
        setPipelineConfig(data.config);
        alert('Modelo de embedding corregido correctamente');
        // Reload the pipeline config
        await fetchPipelineConfig();
      } else {
        const errorText = await res.text();
        console.error('Error fixing embedding model:', res.status, errorText);
        alert(`Error al corregir modelo de embedding: ${res.status} - ${errorText}`);
      }
    } catch (error) {
      console.error('Error fixing embedding model:', error);
      alert(`Error al corregir modelo de embedding: ${error}`);
    } finally {
      setIsSavingPipeline(false);
    }
  };

  const handleEndpointSelect = useCallback((endpoint: ApiEndpoint) => {
    setSelectedEndpoint(endpoint);
    setFormData({});
    setApiResponse(null);
    setApiError(null);
  }, []);

  const handleInputChange = useCallback((name: string, value: any) => {
    setFormData(prev => ({ ...prev, [name]: value }));
  }, []);

  const executeEndpoint = useCallback(async () => {
    if (!selectedEndpoint) return;

    setIsLoading(true);
    setApiError(null);
    setApiResponse(null);

    try {
      // Build URL
      let url = `http://localhost:3011${selectedEndpoint.path}`;
      
      // Replace path parameters
      selectedEndpoint.parameters
        .filter(p => p.in === 'path')
        .forEach(param => {
          const value = formData[param.name];
          if (value) {
            url = url.replace(`{${param.name}}`, encodeURIComponent(value));
          }
        });

      // Build query parameters
      const queryParams = new URLSearchParams();
      selectedEndpoint.parameters
        .filter(p => p.in === 'query')
        .forEach(param => {
          const value = formData[param.name];
          if (value !== undefined && value !== '') {
            queryParams.append(param.name, String(value));
          }
        });

      if (queryParams.toString()) {
        url += `?${queryParams.toString()}`;
      }

      // Build request
      const options: RequestInit = {
        method: selectedEndpoint.method,
        headers: {}
      };

      // Handle body
      if (selectedEndpoint.method !== 'GET' && selectedEndpoint.method !== 'DELETE') {
        if (selectedEndpoint.requestBody?.contentType === 'multipart/form-data') {
          const formDataObj = new FormData();
          Object.entries(formData).forEach(([key, value]) => {
            if (value instanceof File) {
              formDataObj.append(key, value);
            }
          });
          options.body = formDataObj;
          delete options.headers;
        } else {
          options.headers = { 'Content-Type': 'application/json' };
          const bodyData: Record<string, any> = {};
          selectedEndpoint.parameters
            .filter(p => p.in === 'body')
            .forEach(param => {
              const value = formData[param.name];
              if (value !== undefined && value !== '') {
                bodyData[param.name] = value;
              }
            });
          options.body = JSON.stringify(bodyData);
        }
      }

      const response = await fetch(url, options);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      setApiResponse(data);
    } catch (error: any) {
      setApiError(error.message || 'Error al ejecutar el endpoint');
    } finally {
      setIsLoading(false);
    }
  }, [selectedEndpoint, formData]);

  const renderFormField = (param: Parameter) => {
    const value = formData[param.name] || '';

    if (param.type === 'file') {
      return (
        <div key={param.name} className="flex flex-col">
          <label className="text-xs text-muted-foreground mb-1">
            {param.name} {param.required && <span className="text-destructive">*</span>}
          </label>
          <input
            type="file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleInputChange(param.name, file);
            }}
            className="bg-muted border border-border/40 rounded px-2 py-1.5 text-sm text-foreground"
          />
          <p className="text-xs text-muted-foreground/80 mt-1">{param.description}</p>
        </div>
      );
    }

    if (param.type === 'integer' || param.type === 'number') {
      return (
        <div key={param.name} className="flex flex-col">
          <label className="text-xs text-muted-foreground mb-1">
            {param.name} {param.required && <span className="text-destructive">*</span>}
          </label>
          <input
            type="number"
            value={value}
            onChange={(e) => handleInputChange(param.name, e.target.value)}
            className={cn('px-2 py-1.5 text-sm rounded border', themeClasses.input)}
            placeholder={param.description}
          />
          <p className="text-xs text-muted-foreground/80 mt-1">{param.description}</p>
        </div>
      );
    }

    return (
      <div key={param.name} className="flex flex-col">
        <label className="text-xs text-muted-foreground mb-1">
          {param.name} {param.required && <span className="text-destructive">*</span>}
        </label>
        <input
          type="text"
          value={value}
          onChange={(e) => handleInputChange(param.name, e.target.value)}
          className={cn('px-2 py-1.5 text-sm rounded border', themeClasses.input)}
          placeholder={param.description}
        />
        <p className="text-xs text-muted-foreground/80 mt-1">{param.description}</p>
      </div>
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="API, Configuración y Pipeline"
      size="lg"
    >
      <Tabs defaultValue="api" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="api" className="flex items-center gap-2">
            <BeakerIcon className="w-4 h-4" />
            API
          </TabsTrigger>
          <TabsTrigger value="config" className="flex items-center gap-2">
            <Cog6ToothIcon className="w-4 h-4" />
            Configuración
          </TabsTrigger>
          <TabsTrigger value="pipeline" className="flex items-center gap-2">
            <RocketLaunchIcon className="w-4 h-4" />
            Pipeline
          </TabsTrigger>
        </TabsList>

        {/* API Tab */}
        <TabsContent value="api" className="mt-4">
          <div className="space-y-4">
            {/* Endpoint Selector */}
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full justify-between">
                    {selectedEndpoint ? (
                      <span className="flex items-center gap-2">
                        <span className={cn('px-2 py-0.5 rounded text-xs font-bold', getMethodColor(selectedEndpoint.method))}>
                          {selectedEndpoint.method}
                        </span>
                        {selectedEndpoint.path}
                      </span>
                    ) : (
                      'Seleccionar endpoint'
                    )}
                    <ChevronDownIcon className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-full min-w-[var(--radix-dropdown-menu-trigger-width)] max-h-96 overflow-y-auto z-[200]">
                  <DropdownMenuLabel>Endpoints disponibles</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {ENDPOINTS.map((endpoint) => (
                    <DropdownMenuItem
                      key={endpoint.id}
                      onClick={() => handleEndpointSelect(endpoint)}
                      className="flex flex-col items-start gap-1 p-3"
                    >
                      <div className="flex items-center gap-2">
                        <span className={cn('px-2 py-0.5 rounded text-xs font-bold', getMethodColor(endpoint.method))}>
                          {endpoint.method}
                        </span>
                        <span className="font-mono text-sm">{endpoint.path}</span>
                      </div>
                      <span className="text-xs text-muted-foreground/80">{endpoint.description}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Dynamic Form */}
            {selectedEndpoint && (
              <div className="space-y-4">
                <div className={cn('p-4 rounded-lg border', themeClasses.card)}>
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <span className={cn('px-2 py-0.5 rounded text-xs font-bold', getMethodColor(selectedEndpoint.method))}>
                      {selectedEndpoint.method}
                    </span>
                    {selectedEndpoint.path}
                  </h3>
                  <p className="text-xs text-muted-foreground mb-4">{selectedEndpoint.description}</p>
                  
                  <div className="space-y-3">
                    {selectedEndpoint.parameters.map(renderFormField)}
                  </div>

                  <Button
                    onClick={executeEndpoint}
                    disabled={isLoading}
                    className="mt-4 w-full"
                  >
                    {isLoading ? 'Ejecutando...' : 'Ejecutar'}
                  </Button>

                  {apiError && (
                    <div className="mt-4 p-3 bg-red-900/20 border border-red-800 rounded text-destructive text-sm">
                      {apiError}
                    </div>
                  )}

                  {apiResponse && (
                    <div className="mt-4 p-3 bg-green-900/20 border border-green-800 rounded">
                      <h4 className="text-sm font-semibold text-green-400 mb-2">Respuesta:</h4>
                      <pre className="text-xs text-green-300 overflow-auto max-h-64">
                        {JSON.stringify(apiResponse, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        {/* Configuration Tab */}
        <TabsContent value="config" className="mt-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold flex items-center space-x-2">
                <Cog6ToothIcon className="w-5 h-5 text-primary" />
                <span>Configuración de Modelos Locales</span>
              </h2>
              {localModelConfig && (
                <Button
                  onClick={saveModelConfig}
                  disabled={isSavingModel}
                  size="sm"
                  className="bg-primary hover:bg-primary"
                >
                  {isSavingModel ? 'Guardando...' : 'Guardar'}
                </Button>
              )}
            </div>

            <div className="mb-4 flex items-end gap-2">
              <div className="flex-1">
                <label className="text-xs font-medium text-muted-foreground/80 mb-1 block">Seleccionar modelo para editar</label>
                <select
                  className={cn('w-full px-3 py-2 text-sm rounded border bg-background/20', themeClasses.input)}
                  onChange={(e) => {
                    const selected = localPipelineModels.find(m => m.id === e.target.value);
                    if (selected) {
                      // La colección 'models' local guarda campos directos (no dentro de config)
                      // pero damos fallback a config por compatibilidad con registros antiguos
                      setLocalModelConfig({
                        id: selected.id,
                        name: selected.name || selected.nombre_modelo || '',
                        provider: selected.provider || '',
                        apiUrl: selected.apiUrl || selected.base_url || '',
                        apiKey: selected.apiKey || selected.api_key || '',
                        modelName: selected.modelName || selected.model_name || '',
                        temperature: selected.temperature ?? selected.config?.temperature ?? 0.7,
                        maxTokens: selected.maxTokens ?? selected.config?.maxTokens ?? 2048,
                        topP: selected.topP ?? selected.config?.topP ?? 1,
                        frequencyPenalty: selected.frequencyPenalty ?? selected.config?.frequencyPenalty ?? 0,
                        presencePenalty: selected.presencePenalty ?? selected.config?.presencePenalty ?? 0,
                        systemPrompt: selected.systemPrompt || selected.config?.systemPrompt || '',
                        stream: selected.stream ?? selected.config?.stream ?? false,
                        // @ts-ignore
                        _collection: selected._collection
                      });
                    } else {
                      setLocalModelConfig(null);
                    }
                  }}
                  value={localModelConfig?.id || ''}
                >
                  <option value="">-- Seleccionar modelo local --</option>
                  {localPipelineModels.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.modelName || m.model_name || m.name || m.nombre_modelo}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                onClick={startNewLocalModel}
                size="sm"
                variant="outline"
                className="shrink-0"
              >
                + Nuevo
              </Button>
            </div>

            {localModelConfig ? (
                <div className="space-y-4">
                  {/* Model Info - Editable */}
                  <div className={cn('p-3 rounded-lg space-y-3', themeClasses.bgTertiary)}>
                    <div className="grid grid-cols-1 gap-3">
                      <div>
                        <label className="text-[10px] font-medium text-muted-foreground/80 uppercase">ID del Modelo (Model Name)</label>
                        <input 
                          type="text" 
                          value={localModelConfig.modelName} 
                          onChange={(e) => handleModelParamChange('modelName', e.target.value)}
                          className={cn('w-full mt-1 px-2 py-1 text-xs rounded border bg-background/20', themeClasses.border, 'text-foreground/70')}
                          placeholder="p.ej: gpt-4o, llama3"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-medium text-muted-foreground/80 uppercase">Proveedor (Opcional)</label>
                        <input 
                          type="text" 
                          value={localModelConfig.provider} 
                          onChange={(e) => handleModelParamChange('provider', e.target.value)}
                          className={cn('w-full mt-1 px-2 py-1 text-xs rounded border bg-background/20', themeClasses.border, 'text-foreground/70')}
                          placeholder="OpenAI, Ollama..."
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] font-medium text-muted-foreground/80 uppercase">URL de la API (Base URL)</label>
                      <input 
                        type="text" 
                        value={localModelConfig.apiUrl} 
                        onChange={(e) => handleModelParamChange('apiUrl', e.target.value)}
                        className={cn('w-full mt-1 px-2 py-1 text-xs rounded border bg-background/20', themeClasses.border, 'text-foreground/70')}
                        placeholder="https://api.openai.com/v1"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-medium text-muted-foreground/80 uppercase">API Key</label>
                      <input 
                        type="password" 
                        value={localModelConfig.apiKey} 
                        onChange={(e) => handleModelParamChange('apiKey', e.target.value)}
                        className={cn('w-full mt-1 px-2 py-1 text-xs rounded border bg-background/20', themeClasses.border, 'text-foreground/70')}
                        placeholder="••••••••••••••••"
                      />
                    </div>
                  </div>

                  {/* Parameters */}
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground/80">Temperatura</label>
                      <div className="flex items-center space-x-2">
                        <input 
                          type="range" 
                          min="0" 
                          max="2" 
                          step="0.1" 
                          value={localModelConfig.temperature} 
                          onChange={(e) => handleModelParamChange('temperature', parseFloat(e.target.value))}
                          className="flex-1" 
                        />
                        <span className="text-sm font-mono">{localModelConfig.temperature}</span>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground/80">Max Tokens</label>
                      <div className="flex items-center space-x-2">
                        <input 
                          type="range" 
                          min="1" 
                          max="8192" 
                          step="1" 
                          value={localModelConfig.maxTokens} 
                          onChange={(e) => handleModelParamChange('maxTokens', parseInt(e.target.value))}
                          className="flex-1" 
                        />
                        <span className="text-sm font-mono">{localModelConfig.maxTokens}</span>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground/80">Top P</label>
                      <div className="flex items-center space-x-2">
                        <input 
                          type="range" 
                          min="0" 
                          max="1" 
                          step="0.05" 
                          value={localModelConfig.topP} 
                          onChange={(e) => handleModelParamChange('topP', parseFloat(e.target.value))}
                          className="flex-1" 
                        />
                        <span className="text-sm font-mono">{localModelConfig.topP}</span>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground/80">Frequency Penalty</label>
                      <div className="flex items-center space-x-2">
                        <input 
                          type="range" 
                          min="0" 
                          max="2" 
                          step="0.1" 
                          value={localModelConfig.frequencyPenalty} 
                          onChange={(e) => handleModelParamChange('frequencyPenalty', parseFloat(e.target.value))}
                          className="flex-1" 
                        />
                        <span className="text-sm font-mono">{localModelConfig.frequencyPenalty}</span>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground/80">Presence Penalty</label>
                      <div className="flex items-center space-x-2">
                        <input 
                          type="range" 
                          min="0" 
                          max="2" 
                          step="0.1" 
                          value={localModelConfig.presencePenalty} 
                          onChange={(e) => handleModelParamChange('presencePenalty', parseFloat(e.target.value))}
                          className="flex-1" 
                        />
                        <span className="text-sm font-mono">{localModelConfig.presencePenalty}</span>
                      </div>
                    </div>
                  </div>

                  {/* Streaming Switch */}
                  <div className={cn('p-3 rounded-lg border flex items-center justify-between', themeClasses.bgTertiary, themeClasses.border)}>
                    <div>
                      <label className="text-sm font-semibold text-purple-300">Streaming</label>
                      <p className="text-xs text-muted-foreground/80">Recibir la respuesta en tiempo real (modo stream).</p>
                    </div>
                    <Switch
                      checked={localModelConfig.stream || false}
                      onCheckedChange={(checked) => handleModelParamChange('stream', checked)}
                    />
                  </div>

                  {/* System Prompt */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground/80">System Prompt</label>
                    <textarea
                      value={localModelConfig.systemPrompt}
                      onChange={(e) => handleModelParamChange('systemPrompt', e.target.value)}
                      className={cn('mt-1 w-full p-3 rounded-lg text-sm font-mono bg-transparent border', themeClasses.bgTertiary, themeClasses.border)}
                      rows={4}
                      placeholder="Escribe el system prompt aquí..."
                    />
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-sm text-muted-foreground/80">
                    Selecciona un modelo desde el menú desplegable en la barra de navegación.
                  </p>
                </div>
              )}
          </div>
        </TabsContent>

        {/* Pipeline Tab */}
        <TabsContent value="pipeline" className="mt-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <h2 className="text-lg font-semibold flex items-center space-x-2">
                  <RocketLaunchIcon className="w-5 h-5 text-accent" />
                  <span>Pipeline</span>
                </h2>
                {pipelineConfig && (
                  <div className="flex items-center space-x-2">
                    <Switch
                      checked={pipelineConfig.isActive}
                      onCheckedChange={async (checked) => {
                        setPipelineConfig(prev => prev ? { ...prev, isActive: checked } : null);
                        // Guardar automáticamente en la base de datos
                        try {
                          const res = await fetch(`${RAE_API_URL}/api/v1/pipeline-configs/${pipelineConfig.id}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ isActive: checked })
                          });
                          if (res.ok) {
                            console.log(`[Pipeline] Estado actualizado a ${checked ? 'activo' : 'inactivo'}`);
                          } else {
                            console.error('[Pipeline] Error actualizando estado:', res.status);
                          }
                        } catch (error) {
                          console.error('[Pipeline] Error actualizando estado:', error);
                        }
                      }}
                    />
                    <span className="text-xs text-muted-foreground">{pipelineConfig.isActive ? 'Activo' : 'Inactivo'}</span>
                  </div>
                )}
              </div>
            </div>

            {pipelineConfig ? (
              <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Columna izquierda: Fases del pipeline */}
                <div className="space-y-4">
                  <div className={cn('p-3 rounded-lg border', themeClasses.bgTertiary, themeClasses.border)}>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className={cn('text-sm font-semibold', 'text-purple-300')}>1. Ingesta / Pre-procesamiento</h3>
                      <Switch
                        checked={pipelineConfig.ingestionActive !== false}
                        onCheckedChange={(checked) => setPipelineConfig(prev => prev ? { ...prev, ingestionActive: checked } : null)}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground/80 mb-2">Resume chunks grandes para embedding.</p>
                    <select
                      value={pipelineConfig.ingestionModelId || ''}
                      onChange={(e) => setPipelineConfig(prev => prev ? { ...prev, ingestionModelId: e.target.value } : null)}
                      className={cn('w-full px-2 py-1.5 text-sm rounded border', themeClasses.input)}
                    >
                      <option value="">Sin modelo</option>
                      {localPipelineModels.map(m => (
                        <option key={m.id} value={m.id}>{m.name || m.nombre_modelo || m.modelName}</option>
                      ))}
                    </select>
                  </div>

                  <div className={cn('p-3 rounded-lg border', themeClasses.bgTertiary, themeClasses.border)}>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className={cn('text-sm font-semibold', 'text-purple-300')}>2. Recuperación (R)</h3>
                      <Switch
                        checked={pipelineConfig.retrievalActive !== false}
                        onCheckedChange={(checked) => setPipelineConfig(prev => prev ? { ...prev, retrievalActive: checked } : null)}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground/80 mb-2">Re-ranking de chunks recuperados.</p>
                    <select
                      value={pipelineConfig.retrievalModelId || ''}
                      onChange={(e) => setPipelineConfig(prev => prev ? { ...prev, retrievalModelId: e.target.value } : null)}
                      className={cn('w-full px-2 py-1.5 text-sm rounded border', themeClasses.input)}
                    >
                      <option value="">Sin modelo</option>
                      {localPipelineModels.map(m => (
                        <option key={m.id} value={m.id}>{m.name || m.nombre_modelo || m.modelName}</option>
                      ))}
                    </select>
                  </div>

                  <div className={cn('p-3 rounded-lg border', themeClasses.bgTertiary, themeClasses.border)}>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className={cn('text-sm font-semibold', 'text-purple-300')}>3. Orquestación (L)</h3>
                      <Switch
                        checked={pipelineConfig.orchestrationActive !== false}
                        onCheckedChange={(checked) => setPipelineConfig(prev => prev ? { ...prev, orchestrationActive: checked } : null)}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground/80 mb-2">Descomponer la pregunta en sub-preguntas.</p>
                    <select
                      value={pipelineConfig.orchestrationModelId || ''}
                      onChange={(e) => setPipelineConfig(prev => prev ? { ...prev, orchestrationModelId: e.target.value } : null)}
                      className={cn('w-full px-2 py-1.5 text-sm rounded border', themeClasses.input)}
                    >
                      <option value="">Sin modelo</option>
                      {localPipelineModels.map(m => (
                        <option key={m.id} value={m.id}>{m.name || m.nombre_modelo || m.modelName}</option>
                      ))}
                    </select>
                  </div>

                  <div className={cn('p-3 rounded-lg border', themeClasses.bgTertiary, themeClasses.border)}>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className={cn('text-sm font-semibold', 'text-purple-300')}>4. Generación Final (L)</h3>
                      <Switch
                        checked={pipelineConfig.generationActive !== false}
                        onCheckedChange={(checked) => setPipelineConfig(prev => prev ? { ...prev, generationActive: checked } : null)}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground/80 mb-2">Sintetizar la respuesta final con contexto.</p>
                    <select
                      value={pipelineConfig.generationModelId || ''}
                      onChange={(e) => setPipelineConfig(prev => prev ? { ...prev, generationModelId: e.target.value } : null)}
                      className={cn('w-full px-2 py-1.5 text-sm rounded border', themeClasses.input)}
                    >
                      <option value="">Sin modelo</option>
                      {localPipelineModels.map(m => (
                        <option key={m.id} value={m.id}>{m.name || m.nombre_modelo || m.modelName}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex justify-start pt-2">
                    <Button
                      onClick={savePipelineConfig}
                      disabled={isSavingPipeline}
                      size="sm"
                      className="bg-accent hover:bg-purple-700"
                    >
                      {isSavingPipeline ? 'Guardando...' : 'Guardar'}
                    </Button>
                  </div>
                </div>

                {/* Columna derecha: Configuración de RAG */}
                <div className="space-y-4">
                  <div className={cn('p-3 rounded-lg border', themeClasses.bgTertiary, themeClasses.border)}>
                    <div className="mb-2">
                      <h3 className={cn('text-sm font-semibold', 'text-purple-300')}>Modelo de Embeddings</h3>
                    </div>
                    <p className="text-xs text-muted-foreground/80 mb-2">Modelo para generar vectores de los chunks.</p>
                    <select
                      value={pipelineConfig.embeddingModelId || ''}
                      onChange={(e) => setPipelineConfig(prev => prev ? { ...prev, embeddingModelId: e.target.value } : null)}
                      className={cn('w-full px-2 py-1.5 text-sm rounded border', themeClasses.input)}
                    >
                      <option value="">Sin modelo</option>
                      {localPipelineModels.map(m => (
                        <option key={m.id} value={m.id}>{m.name || m.nombre_modelo || m.modelName}</option>
                      ))}
                    </select>
                  </div>

                  <div className={cn('p-3 rounded-lg border', themeClasses.bgTertiary, themeClasses.border)}>
                    <h3 className="text-sm font-semibold mb-2 text-purple-300">Tamaño de Chunk</h3>
                    <input
                      type="number"
                      value={pipelineConfig.chunkSize}
                      onChange={(e) => setPipelineConfig(prev => prev ? { ...prev, chunkSize: Number(e.target.value) } : null)}
                      className={cn('w-full px-2 py-1.5 text-sm rounded border', themeClasses.input)}
                    />
                  </div>

                  <div className={cn('p-3 rounded-lg border', themeClasses.bgTertiary, themeClasses.border)}>
                    <h3 className="text-sm font-semibold mb-2 text-purple-300">Resultados de recuperación (Top K)</h3>
                    <p className="text-xs text-muted-foreground/80 mb-2">Número de fragmentos de contexto a recuperar para la generación.</p>
                    <input
                      type="number"
                      value={pipelineConfig.topK || 5}
                      onChange={(e) => setPipelineConfig(prev => prev ? { ...prev, topK: Number(e.target.value) } : null)}
                      className={cn('w-full px-2 py-1.5 text-sm rounded border', themeClasses.input)}
                      min={1}
                      max={20}
                    />
                  </div>

                  <div className={cn('p-3 rounded-lg border', themeClasses.bgTertiary, themeClasses.border)}>
                    <h3 className="text-sm font-semibold mb-2 text-purple-300">Solapamiento de Chunk</h3>
                    <input
                      type="number"
                      value={pipelineConfig.chunkOverlap}
                      onChange={(e) => setPipelineConfig(prev => prev ? { ...prev, chunkOverlap: Number(e.target.value) } : null)}
                      className={cn('w-full px-2 py-1.5 text-sm rounded border', themeClasses.input)}
                    />
                  </div>

                  <div className={cn('p-3 rounded-lg border', themeClasses.bgTertiary, themeClasses.border)}>
                    <h3 className="text-sm font-semibold mb-2 text-purple-300">System Prompt</h3>
                    <p className="text-xs text-muted-foreground/80 mb-2">Instrucciones de comportamiento para el modelo en todas las fases.</p>
                    <textarea
                      value={pipelineConfig.systemPrompt || ''}
                      onChange={(e) => setPipelineConfig(prev => prev ? { ...prev, systemPrompt: e.target.value } : null)}
                      className={cn('w-full px-2 py-1.5 text-sm rounded border', themeClasses.input)}
                      rows={4}
                    />
                  </div>
                </div>
              </div>
              </>
            ) : (
              <div className={cn('p-6 rounded-xl border text-center', themeClasses.bgTertiary, themeClasses.border)}>
                <RocketLaunchIcon className="w-10 h-10 text-muted-foreground/60 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground mb-4">No hay configuración de pipeline guardada.</p>
                <Button
                  onClick={createDefaultPipelineConfig}
                  disabled={isSavingPipeline}
                  size="sm"
                  className="bg-accent hover:bg-purple-700"
                >
                  {isSavingPipeline ? 'Creando...' : 'Crear configuración por defecto'}
                </Button>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </Modal>
  );
}
