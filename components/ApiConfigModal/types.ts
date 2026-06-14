// Types for ApiConfigModal component

export interface ApiEndpoint {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  description: string;
  parameters: Parameter[];
  requestBody?: RequestBody;
}

export interface Parameter {
  name: string;
  type: string;
  required: boolean;
  description: string;
  in: 'query' | 'path' | 'body' | 'header' | 'cookie';
}

export interface RequestBody {
  contentType: string;
  fields: Field[];
}

export interface Field {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export interface Model {
  id?: string;
  name: string;
  provider: string;
  apiUrl: string;
  apiKey: string;
  modelName: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  frequencyPenalty: number;
  presencePenalty: number;
  systemPrompt: string;
  stream?: boolean;
}

export interface PipelineConfig {
  id: string;
  name: string;
  isActive: boolean;
  ingestionModelId: string | null;
  retrievalModelId: string | null;
  orchestrationModelId: string | null;
  generationModelId: string | null;
  chunkSize: number;
  chunkOverlap: number;
  topK?: number;
  embeddingModelId: string | null;
  systemPrompt: string | null;
  ingestionActive?: boolean;
  retrievalActive?: boolean;
  orchestrationActive?: boolean;
  generationActive?: boolean;
}

export interface ApiConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  models?: Model[];
  pipelineConfigs?: PipelineConfig[];
  activePipeline?: PipelineConfig | null;
  selectedModel?: Model | null;
  isDarkMode?: boolean;
}
