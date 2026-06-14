export const API_CONFIG = {
  BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8741/api',
  TIMEOUT: 30000,
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000,
} as const;

// HTTP Methods
export const HTTP_METHODS = {
  GET: 'GET',
  POST: 'POST',
  PUT: 'PUT',
  DELETE: 'DELETE',
  PATCH: 'PATCH',
} as const;

export type HttpMethod = typeof HTTP_METHODS[keyof typeof HTTP_METHODS];

// API Endpoints
export const API_ENDPOINTS = {
  // File Management
  FILES: '/files',
  FILE_BY_NAME: (name: string) => `/files/${name}`,
  FILE_CONTENT: (name: string) => `/files/${name}/content`,
  
  // Folder Management
  FOLDERS: '/folders',
  FOLDER_BY_PATH: (path: string) => `/folders?path=${encodeURIComponent(path)}`,
  
  // Line Operations
  FILE_LINES: (name: string) => `/files/${name}/lines`,
  FILE_LINE_BY_NUMBER: (name: string, lineNumber: number) => 
    `/files/${name}/lines/${lineNumber}`,
  
  // Character Operations
  LINE_CHARACTERS: (name: string, lineNumber: number) => 
    `/files/${name}/lines/${lineNumber}/chars`,
  
  // Plan/Task Management
  PLAN_TASKS: '/plan/tasks',
  PLAN_TASK_BY_ID: (id: string) => `/plan/tasks/${id}`,
  
  // Workspace Management
  WORKSPACES: '/workspaces',
  WORKSPACE_BY_ID: (id: string) => `/workspaces/${id}`,
} as const;

// Endpoint Categories
export const ENDPOINT_CATEGORIES = {
  MANAGEMENT: 'management',
  MANIPULATION: 'manipulation',
  PLANNING: 'planning',
} as const;

export type EndpointCategory = typeof ENDPOINT_CATEGORIES[keyof typeof ENDPOINT_CATEGORIES];

// Endpoint Definitions
export interface ApiEndpoint {
  id: string;
  name: string;
  path: string;
  method: HttpMethod;
  category: EndpointCategory;
  description: string;
  parameters: EndpointParameter[];
  requiresAuth: boolean;
}

export interface EndpointParameter {
  name: string;
  type: ParameterType;
  required: boolean;
  description: string;
  defaultValue?: string | number | boolean;
}

export const PARAMETER_TYPES = {
  STRING: 'string',
  NUMBER: 'number',
  BOOLEAN: 'boolean',
  FILE: 'file',
  TEXT_AREA: 'textarea',
  CODE_EDITOR: 'code_editor',
} as const;

export type ParameterType = typeof PARAMETER_TYPES[keyof typeof PARAMETER_TYPES];

// Default Endpoints
export const DEFAULT_ENDPOINTS: ApiEndpoint[] = [
  {
    id: 'files-list',
    name: 'List Files',
    path: API_ENDPOINTS.FILES,
    method: HTTP_METHODS.GET,
    category: ENDPOINT_CATEGORIES.MANAGEMENT,
    description: 'Retrieve a list of all files',
    parameters: [],
    requiresAuth: false,
  },
  {
    id: 'file-create',
    name: 'Create File',
    path: API_ENDPOINTS.FILES,
    method: HTTP_METHODS.POST,
    category: ENDPOINT_CATEGORIES.MANAGEMENT,
    description: 'Create a new file',
    parameters: [
      {
        name: 'name',
        type: PARAMETER_TYPES.STRING,
        required: true,
        description: 'Name of the file to create',
      },
      {
        name: 'path',
        type: PARAMETER_TYPES.STRING,
        required: false,
        description: 'Path where to create the file',
      },
      {
        name: 'content',
        type: PARAMETER_TYPES.CODE_EDITOR,
        required: false,
        description: 'Initial content of the file',
      },
    ],
    requiresAuth: true,
  },
  {
    id: 'file-get',
    name: 'Get File',
    path: API_ENDPOINTS.FILE_BY_NAME('{name}'),
    method: HTTP_METHODS.GET,
    category: ENDPOINT_CATEGORIES.MANAGEMENT,
    description: 'Get file details by name',
    parameters: [
      {
        name: 'name',
        type: PARAMETER_TYPES.STRING,
        required: true,
        description: 'Name of the file to retrieve',
      },
    ],
    requiresAuth: false,
  },
  {
    id: 'file-update',
    name: 'Update File',
    path: API_ENDPOINTS.FILE_BY_NAME('{name}'),
    method: HTTP_METHODS.PUT,
    category: ENDPOINT_CATEGORIES.MANIPULATION,
    description: 'Update an existing file',
    parameters: [
      {
        name: 'name',
        type: PARAMETER_TYPES.STRING,
        required: true,
        description: 'Name of the file to update',
      },
      {
        name: 'content',
        type: PARAMETER_TYPES.CODE_EDITOR,
        required: true,
        description: 'New content for the file',
      },
    ],
    requiresAuth: true,
  },
  {
    id: 'file-delete',
    name: 'Delete File',
    path: API_ENDPOINTS.FILE_BY_NAME('{name}'),
    method: HTTP_METHODS.DELETE,
    category: ENDPOINT_CATEGORIES.MANAGEMENT,
    description: 'Delete a file by name',
    parameters: [
      {
        name: 'name',
        type: PARAMETER_TYPES.STRING,
        required: true,
        description: 'Name of the file to delete',
      },
    ],
    requiresAuth: true,
  },
  {
    id: 'folders-list',
    name: 'List Folders',
    path: API_ENDPOINTS.FOLDERS,
    method: HTTP_METHODS.GET,
    category: ENDPOINT_CATEGORIES.MANAGEMENT,
    description: 'Retrieve folder structure',
    parameters: [
      {
        name: 'path',
        type: PARAMETER_TYPES.STRING,
        required: false,
        description: 'Path to list contents from',
      },
    ],
    requiresAuth: false,
  },
  {
    id: 'file-lines-get',
    name: 'Get File Lines',
    path: API_ENDPOINTS.FILE_LINES('{name}'),
    method: HTTP_METHODS.GET,
    category: ENDPOINT_CATEGORIES.MANIPULATION,
    description: 'Get specific lines from a file',
    parameters: [
      {
        name: 'name',
        type: PARAMETER_TYPES.STRING,
        required: true,
        description: 'Name of the file',
      },
      {
        name: 'startLine',
        type: PARAMETER_TYPES.NUMBER,
        required: false,
        description: 'Starting line number (1-indexed)',
      },
      {
        name: 'endLine',
        type: PARAMETER_TYPES.NUMBER,
        required: false,
        description: 'Ending line number (1-indexed)',
      },
    ],
    requiresAuth: false,
  },
  {
    id: 'plan-tasks-list',
    name: 'List Tasks',
    path: API_ENDPOINTS.PLAN_TASKS,
    method: HTTP_METHODS.GET,
    category: ENDPOINT_CATEGORIES.PLANNING,
    description: 'Retrieve all plan tasks',
    parameters: [],
    requiresAuth: false,
  },
];

// UI Constants
export const UI = {
  // Colors
  COLORS_PRIMARY_DARKEST_0F172A: '#0f172a', // Background dark
  COLORS_SECONDARY_DARK_1E293B: '#1e293b', // Panels
  COLORS_TERTIARY_DARK_334155: '#334155', // Interactive elements
  COLORS_PRIMARY_BLUE_3B82F6: '#3b82f6', // Primary blue accent
  COLORS_SUCCESS_GREEN_10B981: '#10b981', // Success green
  COLORS_WARNING_ORANGE_F59E0B: '#f59e0b', // Warning orange
  COLORS_ERROR_RED_EF4444: '#ef4444', // Error red
  COLORS_TEXT_LIGHT_F8FAFC: '#f8fafc', // Light text
  COLORS_TEXT_MEDIUM_CBD5E1: '#cbd5e1', // Medium text
  COLORS_TEXT_DARK_64748B: '#64748b', // Dark text

  // Spacing
  SPACING_UNIT: '0.25rem', // 4px
  SPACING_XS: '0.25rem', // 4px
  SPACING_SM: '0.5rem', // 8px
  SPACING_MD: '1rem', // 16px
  SPACING_LG: '1.5rem', // 24px
  SPACING_XL: '2rem', // 32px

  // Border Radius
  BORDER_RADIUS_SM: '0.5rem', // 8px
  BORDER_RADIUS_MD: '1rem', // 16px
  BORDER_RADIUS_LG: '1.5rem', // 24px

  // Shadows
  SHADOW_SM: '0 0.25rem 0.5rem rgba(0,0,0,0.1)',
  SHADOW_MD: '0 0.5rem 1rem rgba(0,0,0,0.15)',
  SHADOW_LG: '0 1rem 1.5rem rgba(0,0,0,0.2)',

  // Transitions
  TRANSITION_DURATION_FAST: '150ms',
  TRANSITION_DURATION_NORMAL: '300ms',
  TRANSITION_DURATION_SLOW: '500ms',

  // Z-Index Layers
  Z_INDEX_DROPDOWN: 1000,
  Z_INDEX_STICKY: 1020,
  Z_INDEX_FIXED: 1030,
  Z_INDEX_MODAL_BACKDROP: 1040,
  Z_INDEX_MODAL: 1050,
  Z_INDEX_POPOVER: 1060,
  Z_INDEX_TOOLTIP: 1070,

  // Breakpoints (Tailwind defaults)
  BREAKPOINT_SM: '640px',
  BREAKPOINT_MD: '768px',
  BREAKPOINT_LG: '1024px',
  BREAKPOINT_XL: '1280px',
  BREAKPOINT_2XL: '1536px',

  // Panel Sizes
  PANEL_WIDTH_SIDEBAR: '280px',
  PANEL_WIDTH_SIDEBAR_COLLAPSED: '64px',
  PANEL_HEIGHT_HEADER: '64px',

  // Animation Keyframes (as CSS strings)
  ANIMATION_PULSE: `@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }`,

  ANIMATION_SPIN: `@keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }`,

  ANIMATION_FADE_IN: `@keyframes fadeIn {
    0% { opacity: 0; }
    100% { opacity: 1; }
  }`,

  ANIMATION_SLIDE_IN_RIGHT: `@keyframes slideInRight {
    0% { transform: translateX(100%); }
    100% { transform: translateX(0); }
  }`,

  ANIMATION_SLIDE_IN_LEFT: `@keyframes slideInLeft {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(0); }
  }`,

  // Skeleton Animation
  SKELETON_ANIMATION: `animation: pulse 500ms cubic-bezier(0.4,0,0.6,1) infinite;`,

} as const;

// File Types and Icons
export const FILE_TYPES = {
  TEXT: 'text/plain',
  JSON: 'application/json',
  JAVASCRIPT: 'application/javascript',
  TYPESCRIPT: 'text/typescript',
  HTML: 'text/html',
  CSS: 'text/css',
  MARKDOWN: 'text/markdown',

  // Extensions mapping
  EXTENSIONS: {
txt:'text/plain',
json:'application/json',
js:'application/javascript',
ts:'text/typescript',
jsx:'application/javascript',
tsx:'text/typescript',
html:'text/html',
htm:'text/html',
css:'text/css',
md:'text/markdown',

},
} as const;

export type FileType=typeof FILE_TYPES[keyof typeof FILE_TYPES];

// Task Statuses
export const TASK_STATUSES={
TODO:'todo',
IN_PROGRESS:'in_progress',
REVIEW:'review',
DONE:'done',

} as const;

export type TaskStatus=typeof TASK_STATUSES[keyof typeof TASK_STATUSES];

// Task Priority Levels
export const TASK_PRIORITIES={
LOW:'low',
MEDIUM:'medium',

HIGH:'high',

CRITICAL:'critical',

} as const;

export type TaskPriority=typeof TASK_PRIORITIES[keyof typeof TASK_PRIORITIES];

// Workspace Environments
export const WORKSPACE_ENVIRONMENTS={
DEVELOPMENT:'development',

STAGING:'staging',

PRODUCTION:'production',

CUSTOM:'custom',

} as const;

export type WorkspaceEnvironment=typeof WORKSPACE_ENVIRONMENTS[keyof typeof WORKSPACE_ENVIRONMENTS];

// Default Workspace Configuration
export interface WorkspaceConfig{
id:string;
name:string;
environment :WorkspaceEnvironment;
apiBaseUrl:string;
requiresAuth :boolean;
authToken?:string;
createdAt :Date;
updatedAt :Date;

}

export const DEFAULT_WORKSPACE_CONFIGS :WorkspaceConfig[]=[
{
id:'dev-local',

name:'Local Development',

environment :WORKSPACE_ENVIRONMENTS.DEVELOPMENT,

apiBaseUrl:'http://localhost :3000/api',

requiresAuth :false,

createdAt :new Date(),

updatedAt :new Date(),

},
{
id:'prod-main',

name:'Production',

environment :WORKSPACE_ENVIRONMENTS.PRODUCTION,

apiBaseUrl:'https://api.example.com/v1',

requiresAuth :true,

createdAt :new Date(),

updatedAt :new Date(),

},

];

// Local Storage Keys
export const STORAGE_KEYS={
WORKSPACE_CURRENT:'api-file-commander-current-workspace',

WORKSPACE_CONFIGS:'api-file-commander-workspace-configs',

REQUEST_HISTORY:'api-file-commander-request-history',

SAVED_QUERIES:'api-file-commander-saved-queries',

UI_SETTINGS:'api-file-commander-ui-settings',

AUTH_TOKEN:'api-file-commander-auth-token',

RECENT_ENDPOINTS:'api-file-commander-recent-endpoints',

TASK_FILTERS:'api-file-commander-task-filters',

FILE_EXPLORER_STATE:'api-file-commander-file-explorer-state',

} as const;

// Validation Constants
export const VALIDATION={
FILE_NAME_MAX_LENGTH :255,

FILE_PATH_MAX_LENGTH :4096,

FILE_CONTENT_MAX_SIZE :10*1024*1024,//10MB

TASK_TITLE_MAX_LENGTH :100,

TASK_DESCRIPTION_MAX_LENGTH :1000,

WORKSPACE_NAME_MAX_LENGTH :50,

API_URL_MAX_LENGTH :2048,

QUERY_NAME_MAX_LENGTH :50,

PARAMETER_NAME_MAX_LENGTH :50,

PARAMETER_VALUE_MAX_LENGTH :50000,

} as const;

// Error Messages
export const ERROR_MESSAGES={
API_CONNECTION_FAILED:'Failed to connect to API.Please check your network connection and API URL.',

API_TIMEOUT:'Request timed out.Please try again.',

INVALID_API_RESPONSE:'Received invalid response from API.',

FILE_NOT_FOUND:'File not found.',

FOLDER_NOT_FOUND:'Folder not found.',

TASK_NOT_FOUND:'Task not found.',

UNAUTHORIZED:'Unauthorized access.Please check your authentication credentials.',

FORBIDDEN:'Access forbidden.You do not have permission to perform this action.',

VALIDATION_FAILED:'Validation failed.Please check your input.',

UNKNOWN_ERROR:'An unknown error occurred.',

NETWORK_ERROR:'Network error.Please check your internet connection.',

} as const;

// Success Messages
export const SUCCESS_MESSAGES={
FILE_CREATED:'File created successfully.',

FILE_UPDATED:'File updated successfully.',

FILE_DELETED:'File deleted successfully.',

FOLDER_CREATED:'Folder created successfully.',

TASK_CREATED:'Task created successfully.',

TASK_UPDATED:'Task updated successfully.',

TASK_DELETED:'Task deleted successfully.',

QUERY_EXECUTED:'Query executed successfully.',

QUERY_SAVED:'Query saved successfully.',

SETTINGS_SAVED:'Settings saved successfully.',

WORKSPACE_SWITCHED:'Workspace switched successfully.',

} as const;

// Notification Types
export const NOTIFICATION_TYPES={
SUCCESS:'success',

ERROR:'error',

WARNING:'warning',

INFO:'info',

} as const;

export type NotificationType=typeof NOTIFICATION_TYPES[keyof typeof NOTIFICATION_TYPES];

// Keyboard Shortcuts
export const KEYBOARD_SHORTCUTS={
EXECUTE_QUERY:{key:'Enter',modifiers :['Ctrl']},

SAVE_QUERY:{key:'s',modifiers :['Ctrl']},

NEW_TAB:{key:'t',modifiers :['Ctrl']},

CLOSE_TAB:{key:'w',modifiers :['Ctrl']}

} as const;