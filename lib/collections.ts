/**
 * Configuración de las colecciones de PocketBase usadas en la aplicación.
 * Nombres de campos según el esquema real de PocketBase.
 */

export const CONVERSATIONS_COLLECTION_ID = 'pbc_2982256985';
export const CONVERSATIONS_COLLECTION_NAME = 'conversations';

export const CONVERSATIONS_FIELDS = {
  PROJECT_ID: 'project_id',
  MODEL_ID: 'model_id',
  TITLE: 'title',
  USER: 'user',
} as const;

// ——— messages
export const MESSAGES_COLLECTION_ID = 'pbc_2605467279';
export const MESSAGES_COLLECTION_NAME = 'messages';

export const MESSAGES_FIELDS = {
  CONVERSATION_ID: 'conversation',
  ROLE: 'role',
  CONTENT_TEXT: 'content',
  TYPE: 'type',
  LANGUAGE: 'language',
  FILE_INFO: 'fileInfo',
  ACTION_TYPE: 'action_type',
} as const;

export const MESSAGE_TYPE = {
  CONTENT_TEXT: 'text',
  CONTENT_FILE: 'code',
} as const;

// ——— ai_models (colección desplegada en PocketBase)
export const MODELOS_COLLECTION_ID = 'pbc_2249708725';
export const MODELOS_COLLECTION_NAME = 'ai_models';

// ——— models (colección LOCAL en PocketBase, solo para modal API/local)
export const MODELOS_LOCAL_COLLECTION_NAME = 'models';

export const MODELOS_FIELDS = {
  NAME: 'name',
  TYPE: 'type',
  BASE_URL: 'base_url',
  API_KEY: 'api_key',
  MODEL_NAME: 'model_name',
  CONFIG: 'config',
  USER: 'user',
  PROVIDER: 'provider',
  IS_LOCAL: 'is_local',
} as const;

export interface ModeloRecord {
  nombre_modelo: string;
  id: string;
  name: string;
  model_name: string;
  modelName?: string;
  model?: string;
  type?: string;
  base_url?: string;
  api_key?: string;
  provider?: string;
  config?: any;
  user?: string;
  is_local?: boolean;
}
