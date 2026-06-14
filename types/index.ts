export interface ApiEndpoint {
  id: string;
  name: string;
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  category: 'management' | 'manipulation' | 'planning';
  description?: string;
  parameters: ApiParameter[];
  requiresAuth: boolean;
  isActive: boolean;
}

export interface ApiParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'file' | 'array' | 'object';
  required: boolean;
  description?: string;
  defaultValue?: any;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    enum?: string[];
  };
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp: string;
}

// File System types
export interface FileSystemItem {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'folder';
  size?: number;
  modifiedAt: string;
  createdAt: string;
  extension?: string;
}

export interface FileContent {
  name: string;
  path: string;
  content: string;
  type: string;
  size: number;
  lines: number;
}

export interface LineContent {
  lineNumber: number;
  content: string;
  startIndex: number;
  endIndex: number;
}

export interface CharacterRange {
  startCharIndex: number;
  endCharIndex: number;
  content: string;
}

// Task Plan types
export interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'in-progress' | 'completed' | 'archived';
  priority: 'low' | 'medium' | 'high';
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
  folders: string[];
  files: string[];
}

export interface TaskCreateDto {
  title: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high';
  dueDate?: string;
}

export interface TaskUpdateDto extends Partial<TaskCreateDto> {
  status?: Task['status'];
}

// Workspace & Environment types
export interface Environment {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  isActive: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  environments: Environment[];
  currentEnvironmentId: string;
}

// Request History types
export interface RequestHistoryItem {
  id: string;
  timestamp: string;
  method: ApiEndpoint['method'];
  endpoint: string;
  statusCode: number;
  statusText: string;
  duration: number;
  requestBody?: any;
  responseBody?: any;
}

export interface SavedQuery {
  id: string;
  name: string;
  endpointId: string;
  parameters: Record<string, any>;
  createdAt: string;
}

// UI State types
export interface AppState {
  currentEndpointId?: string;
  currentFilePath?: string;
  currentTaskId?: string;
  activePanel: 'explorer' | 'tester' | 'response' | 'tasks' | 'navigator';
}

export interface Notification {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message: string;
  duration?: number;
}

// Form types
export interface TestRequestForm {
  parameters: Record<string, any>;
}

export interface FileUploadForm {
  name: string;
  path: string;
  content?: string;
  file?: FileList;
}

export interface FolderCreateForm {
  name: string;
  path: string;
}

// Component Props types
export interface ApiExplorerProps {
  endpoints: ApiEndpoint[];
  onEndpointSelect: (endpointId: string) => void;
}

export interface ParameterInputProps {
  parameter: ApiParameter;
  value: any;
  onChange: (value: any) => void;
}

export interface FileNavigatorProps {
  currentPath?: string;
  onPathSelect: (path: string) => void;
}

export interface TaskCardProps {
  task: Task;
  onEdit: (taskId: string) => void;
  onDelete: (taskId: string) => void;
}

// Event types
export type DragEventData = {
  type: 'endpoint' | 'task' | 'file';
  id: string;
};

// Theme types
export interface ThemeColors {
  backgroundDark: string;
  backgroundMedium: string;
  backgroundLight: string;
  primary: string;
  success: string;
}

// Constants
export const API_CATEGORIES = ['management', 'manipulation', 'planning'] as const;

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const;

export const TASK_STATUSES = ['pending', 'in-progress', 'completed', 'archived'] as const;

export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const;

// Utility types
export type Nullable<T> = T | null;

export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

// Store types
export interface AppStore {
  // State
  currentWorkspaceId?: string;
  currentEnvironmentId?: string;
  
  // Actions
  setWorkspaceId: (id?: string) => void;
  
}