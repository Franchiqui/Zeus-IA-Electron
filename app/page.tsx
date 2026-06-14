'use client';

//import Footer from '@/components/layout/footer';
import { useState, useEffect, useCallback, useRef } from 'react';
import { generatePbSchema } from '@/lib/generatePbSchema';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Folder,
  File,
  Code,
  Play,
  Trash2,
  Edit,
  Search,
  Settings,
  Palette,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Plus,
  Save,
  Download,
  Upload,
  Copy,
  Maximize2,
  Minimize2,
  RefreshCw,
  Globe,
  History,
  LayoutDashboard,
  FileText,
  Terminal,
  Calendar,
  Users,
  Bell,
  CheckCircle,
  XCircle,
  AlertCircle,
  Menu,
  RotateCcw,
  Cpu,
  Signal,
  SignalHigh,
  User,
  Check,
  CheckSquare,
  ArrowLeft,
  ArrowUp,
  Home,
  Sparkles,
  Rocket,
  X,
  FolderOpen,
  Layers2,
  Wand2,
  Server,
  Zap,
  Database,
  List,
  Loader2,
  GitBranch,
  Scissors,
  Eye,
  Clipboard as ClipboardLucide
} from 'lucide-react';
import { Dialog } from '@headlessui/react';
import Image from 'next/image';
import zeusLogo from '../panel-central/src/assets/zeus-logo.png';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import JSZip from 'jszip';
import { ModelConfigModal } from '@/components/layout/ModelConfigModal';
import MonacoEditor from '@/components/MonacoEditor';
import { FloatingChatButton } from '@/components/FloatingChatButton';
import { ChatHistorySidebar } from '@/components/ChatHistorySidebar';
import pb from '@/lib/pocketbase';
import { initPocketBase, getPocketBase } from '../api/lib/pocketbaseForGenerateApi';
import { buildOpenApiPreviewPayload, mergeOptionalDependenciesFromApiCode, sanitizeGeneratedApiTsCode } from '../src/lib/sanitizeGeneratedApiCode';
import { MODELOS_COLLECTION_NAME, MODELOS_FIELDS, type ModeloRecord } from '@/lib/collections';
import { cn } from '@/lib/utils';
import { useStore } from '@/lib/store';
import { useTranslation } from '@/contexts/translation-context';
import IDETab from '@/components/ide/IDETab';
import StructurePlanTab from '@/components/ide/StructurePlanTab';
import PreviewTab from '@/components/ide/PreviewTab';
import ZeusStudio from '../app-preview/page';
import TwoStepAppGenerator from '@/components/template/TwoStepAppGenerator';
import AppLibrari from '../app-librari/page';
import { TerminalProvider } from '@/context/TerminalContext';
import { EditorProvider } from '@/context/editor-context';
import { ProjectProvider, useProject } from '@/context/ProjectContext';
import { clearTabState } from '@/lib/tab-state';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import UserInfo from '@/components/auth/UserInfo';
import GitHubModal from '@/components/ide/GitHubModal';
import { GitHubSvg } from '@/components/ui/github-icon';
import { ThemeEditorModal } from '@/components/ui/theme-editor-modal';
import { loadAndApplyTheme } from '@/lib/theme-engine';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel
} from '@/components/ui/dropdown-menu';

// Types
interface ApiEndpoint {
  id: string;
  name: string;
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  category: 'management' | 'manipulation' | 'planning' | 'history';
  description: string;
  parameters: ApiParameter[];
}

interface ApiParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'file' | 'code';
  required: boolean;
  description: string;
}

interface ApiResponse {
  success: boolean;
  data?: any;
  error?: string;
  timestamp: string;
}

interface FileSystemItem {
  type: 'folder' | 'file';
  name: string;
  path: string;
  size?: number;
  modified?: string;
}

type ExplorerDialogMode = 'create-folder' | 'create-file' | 'rename-item' | 'delete-item' | null;

interface Task {
  id: string;
  title: string;
  description: string;
  status: 'todo' | 'in-progress' | 'done';
  dueDate?: string;
  files: string[];
}

// Validation schemas
const endpointTestSchema = z.object({
  // File/Folder parameters
  name: z.string().optional(),
  newName: z.string().optional(),
  path: z.string().optional(),
  extension: z.string().optional(),
  type: z.string().optional(),
  content: z.string().optional(),

  // Plan parameters
  planId: z.string().optional(),
  planName: z.string().optional(),
  operation: z.string().optional(),
  fileName: z.string().optional(),
  folderName: z.string().optional(),

  // Line parameters
  lineNumber: z.string().optional(),
  startLine: z.number().optional(),
  endLine: z.number().optional(),
  numLines: z.string().optional(),

  // Character parameters
  startCharIndex: z.string().optional(),
  endCharIndex: z.string().optional(),
  position: z.string().optional(),

  // Task parameters
  id: z.string().optional(),
});

type EndpointTestFormData = z.infer<typeof endpointTestSchema>;

// Mock data for endpoints
const mockEndpoints: ApiEndpoint[] = [
  // Folder endpoints
  {
    id: '1',
    name: 'Create Folder',
    path: 'http://localhost:8742/api/folders',
    method: 'POST',
    category: 'management',
    description: 'Create a new folder',
    parameters: [
      { name: 'name', type: 'string', required: true, description: 'Folder name' },
      { name: 'path', type: 'string', required: true, description: 'Folder path' },
      { name: 'planName', type: 'string', required: false, description: 'Nombre del plan donde guardar la tarea' },
      { name: 'saveToPlan', type: 'boolean', required: false, description: 'Guardar en plan en lugar de ejecutar' }
    ]
  },
  {
    id: '2',
    name: 'List Folders',
    path: 'http://localhost:8742/api/folders',
    method: 'GET',
    category: 'management',
    description: 'List all folders in the file system',
    parameters: [
      { name: 'path', type: 'string', required: false, description: 'Path to list contents from' }
    ]
  },
  {
    id: '3',
    name: 'Update Folder',
    path: 'http://localhost:8742/api/folders/:name',
    method: 'PUT',
    category: 'management',
    description: 'Update folder name or path',
    parameters: [
      { name: 'name', type: 'string', required: true, description: 'Current folder name' },
      { name: 'newName', type: 'string', required: false, description: 'New folder name' },
      { name: 'path', type: 'string', required: false, description: 'Folder path' },
      { name: 'planName', type: 'string', required: false, description: 'Nombre del plan donde guardar la tarea' },
      { name: 'saveToPlan', type: 'boolean', required: false, description: 'Guardar en plan en lugar de ejecutar' }
    ]
  },
  {
    id: '4',
    name: 'Delete Folder',
    path: 'http://localhost:8742/api/folders/:name',
    method: 'DELETE',
    category: 'management',
    description: 'Delete a folder',
    parameters: [
      { name: 'name', type: 'string', required: true, description: 'Folder name to delete' },
      { name: 'path', type: 'string', required: true, description: 'Folder path' },
      { name: 'planName', type: 'string', required: false, description: 'Nombre del plan donde guardar la tarea' },
      { name: 'saveToPlan', type: 'string', required: false, description: 'true para guardar en plan en lugar de ejecutar' }
    ]
  },
  // File endpoints
  {
    id: '5',
    name: 'Create File',
    path: 'http://localhost:8742/api/files',
    method: 'POST',
    category: 'manipulation',
    description: 'Create a new file',
    parameters: [
      { name: 'name', type: 'string', required: true, description: 'File name' },
      { name: 'extension', type: 'string', required: false, description: 'File extension' },
      { name: 'type', type: 'string', required: false, description: 'File type' },
      { name: 'path', type: 'string', required: true, description: 'File path' },
      { name: 'content', type: 'code', required: false, description: 'File content' },
      { name: 'planName', type: 'string', required: false, description: 'Nombre del plan donde guardar la tarea' },
      { name: 'saveToPlan', type: 'boolean', required: false, description: 'Guardar en plan en lugar de ejecutar' }
    ]
  },
  {
    id: '6',
    name: 'Get File',
    path: 'http://localhost:8742/api/files/:name',
    method: 'GET',
    category: 'management',
    description: 'View file contents',
    parameters: [
      { name: 'name', type: 'string', required: true, description: 'File name' },
      { name: 'path', type: 'string', required: true, description: 'File path' }
    ]
  },
  {
    id: '7',
    name: 'List Files',
    path: 'http://localhost:8742/api/files',
    method: 'GET',
    category: 'management',
    description: 'List all files in a directory',
    parameters: [
      { name: 'path', type: 'string', required: true, description: 'Directory path' }
    ]
  },
  {
    id: '8',
    name: 'Update File',
    path: 'http://localhost:8742/api/files/:name',
    method: 'PUT',
    category: 'manipulation',
    description: 'Update file content or name',
    parameters: [
      { name: 'name', type: 'string', required: true, description: 'Current file name' },
      { name: 'path', type: 'string', required: false, description: 'File path' },
      { name: 'content', type: 'code', required: false, description: 'New file content' },
      { name: 'newName', type: 'string', required: false, description: 'New file name' },
      { name: 'planName', type: 'string', required: false, description: 'Nombre del plan donde guardar la tarea' },
      { name: 'saveToPlan', type: 'boolean', required: false, description: 'Guardar en plan en lugar de ejecutar' }
    ]
  },
  {
    id: '9',
    name: 'Delete File',
    path: 'http://localhost:8742/api/files/:name',
    method: 'DELETE',
    category: 'manipulation',
    description: 'Delete a file',
    parameters: [
      { name: 'name', type: 'string', required: true, description: 'File name to delete' },
      { name: 'path', type: 'string', required: true, description: 'File path' },
      { name: 'planName', type: 'string', required: false, description: 'Nombre del plan donde guardar la tarea' },
      { name: 'saveToPlan', type: 'string', required: false, description: 'true para guardar en plan en lugar de ejecutar' }
    ]
  },
  // Line endpoints
  {
    id: '10',
    name: 'Get Lines',
    path: 'http://localhost:8742/api/files/:name/lines',
    method: 'GET',
    category: 'manipulation',
    description: 'View specific lines from a file',
    parameters: [
      { name: 'name', type: 'string', required: true, description: 'File name' },
      { name: 'path', type: 'string', required: true, description: 'File path' },
      { name: 'startLine', type: 'number', required: false, description: 'Start line number' },
      { name: 'endLine', type: 'number', required: false, description: 'End line number' }
    ]
  },
  {
    id: '11',
    name: 'List All Lines',
    path: 'http://localhost:8742/api/files/:name/lines/list',
    method: 'GET',
    category: 'management',
    description: 'List all lines in a file',
    parameters: [
      { name: 'name', type: 'string', required: true, description: 'File name' },
      { name: 'path', type: 'string', required: true, description: 'File path' }
    ]
  },
  {
    id: '12',
    name: 'Insert Lines',
    path: 'http://localhost:8742/api/files/:name/lines',
    method: 'POST',
    category: 'manipulation',
    description: 'Insert new lines into a file',
    parameters: [
      { name: 'name', type: 'string', required: true, description: 'File name' },
      { name: 'path', type: 'string', required: true, description: 'File path' },
      { name: 'lineNumber', type: 'number', required: false, description: 'Line number to insert at' },
      { name: 'content', type: 'code', required: false, description: 'Line content to insert' },
      { name: 'planName', type: 'string', required: false, description: 'Nombre del plan donde guardar la tarea' },
      { name: 'saveToPlan', type: 'boolean', required: false, description: 'Guardar en plan en lugar de ejecutar' }
    ]
  },
  {
    id: '13',
    name: 'Replace Lines',
    path: 'http://localhost:8742/api/files/:name/lines/:lineNumber',
    method: 'PUT',
    category: 'manipulation',
    description: 'Replace specific lines in a file',
    parameters: [
      { name: 'name', type: 'string', required: true, description: 'File name' },
      { name: 'lineNumber', type: 'number', required: true, description: 'Line number to replace' },
      { name: 'path', type: 'string', required: true, description: 'File path' },
      { name: 'content', type: 'code', required: false, description: 'New line content' },
      { name: 'numLines', type: 'number', required: false, description: 'Number of lines to replace (default: 1)' },
      { name: 'planName', type: 'string', required: false, description: 'Nombre del plan donde guardar la tarea' },
      { name: 'saveToPlan', type: 'boolean', required: false, description: 'Guardar en plan en lugar de ejecutar' }
    ]
  },
  {
    id: '14',
    name: 'Delete Lines',
    path: 'http://localhost:8742/api/files/:name/lines/:lineNumber',
    method: 'DELETE',
    category: 'manipulation',
    description: 'Delete specific lines from a file',
    parameters: [
      { name: 'name', type: 'string', required: true, description: 'File name' },
      { name: 'lineNumber', type: 'number', required: true, description: 'Line number to delete from' },
      { name: 'path', type: 'string', required: true, description: 'File path' },
      { name: 'numLines', type: 'number', required: false, description: 'Number of lines to delete' },
      { name: 'planName', type: 'string', required: false, description: 'Nombre del plan donde guardar la tarea' },
      { name: 'saveToPlan', type: 'string', required: false, description: 'true para guardar en plan en lugar de ejecutar' }
    ]
  },
  // Character endpoints
  {
    id: '15',
    name: 'Get Characters',
    path: 'http://localhost:8742/api/files/:name/lines/:lineNumber/chars',
    method: 'GET',
    category: 'manipulation',
    description: 'View specific characters from a line',
    parameters: [
      { name: 'name', type: 'string', required: true, description: 'File name' },
      { name: 'lineNumber', type: 'number', required: true, description: 'Line number' },
      { name: 'path', type: 'string', required: true, description: 'File path' },
      { name: 'startCharIndex', type: 'number', required: true, description: 'Start character index' },
      { name: 'endCharIndex', type: 'number', required: true, description: 'End character index' }
    ]
  },
  {
    id: '16',
    name: 'List Characters',
    path: 'http://localhost:8742/api/files/:name/lines/:lineNumber/chars/list',
    method: 'GET',
    category: 'management',
    description: 'List all characters in a line',
    parameters: [
      { name: 'name', type: 'string', required: true, description: 'File name' },
      { name: 'lineNumber', type: 'number', required: true, description: 'Line number' },
      { name: 'path', type: 'string', required: true, description: 'File path' }
    ]
  },
  {
    id: '17',
    name: 'Insert Characters',
    path: 'http://localhost:8742/api/files/:name/lines/:lineNumber/chars',
    method: 'POST',
    category: 'manipulation',
    description: 'Insert characters into a line',
    parameters: [
      { name: 'name', type: 'string', required: true, description: 'File name' },
      { name: 'lineNumber', type: 'number', required: true, description: 'Line number' },
      { name: 'path', type: 'string', required: true, description: 'File path' },
      { name: 'position', type: 'number', required: false, description: 'Character position to insert at' },
      { name: 'content', type: 'string', required: false, description: 'Characters to insert' },
      { name: 'planName', type: 'string', required: false, description: 'Nombre del plan donde guardar la tarea' },
      { name: 'saveToPlan', type: 'boolean', required: false, description: 'Guardar en plan en lugar de ejecutar' }
    ]
  },
  {
    id: '18',
    name: 'Replace Characters',
    path: 'http://localhost:8742/api/files/:name/lines/:lineNumber/chars',
    method: 'PUT',
    category: 'manipulation',
    description: 'Replace specific characters in a line',
    parameters: [
      { name: 'name', type: 'string', required: true, description: 'File name' },
      { name: 'lineNumber', type: 'number', required: true, description: 'Line number' },
      { name: 'path', type: 'string', required: true, description: 'File path' },
      { name: 'startCharIndex', type: 'number', required: false, description: 'Start character index' },
      { name: 'endCharIndex', type: 'number', required: false, description: 'End character index' },
      { name: 'content', type: 'string', required: false, description: 'New characters' },
      { name: 'planName', type: 'string', required: false, description: 'Nombre del plan donde guardar la tarea' },
      { name: 'saveToPlan', type: 'boolean', required: false, description: 'Guardar en plan en lugar de ejecutar' }
    ]
  },
  {
    id: '19',
    name: 'Delete Characters',
    path: 'http://localhost:8742/api/files/:name/lines/:lineNumber/chars',
    method: 'DELETE',
    category: 'manipulation',
    description: 'Delete specific characters from a line',
    parameters: [
      { name: 'name', type: 'string', required: true, description: 'File name' },
      { name: 'lineNumber', type: 'number', required: true, description: 'Line number' },
      { name: 'path', type: 'string', required: true, description: 'File path' },
      { name: 'startCharIndex', type: 'number', required: true, description: 'Start character index' },
      { name: 'endCharIndex', type: 'number', required: true, description: 'End character index' },
      { name: 'planName', type: 'string', required: false, description: 'Nombre del plan donde guardar la tarea' },
      { name: 'saveToPlan', type: 'string', required: false, description: 'true para guardar en plan en lugar de ejecutar' }
    ]
  },
  // Plan/Task endpoints
  {
    id: '36',
    name: 'Create Plan',
    path: 'http://localhost:8742/api/plan',
    method: 'POST',
    category: 'planning',
    description: 'Create a new plan',
    parameters: [
      { name: 'name', type: 'string', required: true, description: 'Plan name (will be used as filename)' },
      { name: 'description', type: 'string', required: false, description: 'Plan description' }
    ]
  },
  {
    id: '47',
    name: 'Save Plan',
    path: 'http://localhost:8742/api/plan/save',
    method: 'POST',
    category: 'planning',
    description: 'Save a plan without executing it (creates new or updates existing)',
    parameters: [
      { name: 'name', type: 'string', required: true, description: 'Plan name (will be used as filename)' },
      { name: 'description', type: 'string', required: false, description: 'Plan description' }
    ]
  },
  {
    id: '37',
    name: 'List Plans',
    path: 'http://localhost:8742/api/plan',
    method: 'GET',
    category: 'planning',
    description: 'List all plans',
    parameters: []
  },
  {
    id: '38',
    name: 'Get Plan',
    path: 'http://localhost:8742/api/plan/:name',
    method: 'GET',
    category: 'planning',
    description: 'View a specific plan',
    parameters: [
      { name: 'name', type: 'string', required: true, description: 'Plan name or filename' }
    ]
  },
  {
    id: '48',
    name: 'Create Task',
    path: 'http://localhost:8742/api/plan/tasks/save',
    method: 'POST',
    category: 'planning',
    description: 'Save a task to the plan without executing it',
    parameters: [
      { name: 'planName', type: 'string', required: true, description: 'Select the plan to add this task to' },
      { name: 'name', type: 'string', required: true, description: 'Task name' },
      { name: 'type', type: 'string', required: true, description: 'Select element type' },
      { name: 'operation', type: 'string', required: true, description: 'Select operation to perform' },
      { name: 'path', type: 'string', required: false, description: 'Element path' },
      { name: 'extension', type: 'string', required: false, description: 'File extension (for files only)' },
      { name: 'content', type: 'code', required: false, description: 'File content (for create/update)' }
    ]
  },
  {
    id: '24',
    name: 'List Tasks',
    path: 'http://localhost:8742/api/plan/tasks',
    method: 'GET',
    category: 'planning',
    description: 'List tasks by selecting a plan file',
    parameters: [
      { name: 'fileName', type: 'string', required: false, description: 'Optional: Select a plan file to view its tasks' }
    ]
  },
  {
    id: '25',
    name: 'Get Task',
    path: 'http://localhost:8742/api/plan/tasks/:name',
    method: 'GET',
    category: 'planning',
    description: 'View a specific task',
    parameters: [
      { name: 'name', type: 'string', required: true, description: 'Task name' }
    ]
  },
  {
    id: '26',
    name: 'Update Task',
    path: 'http://localhost:8742/api/plan/tasks/:name',
    method: 'PUT',
    category: 'planning',
    description: 'Update a task',
    parameters: [
      { name: 'name', type: 'string', required: true, description: 'Task name' },
      { name: 'newName', type: 'string', required: false, description: 'New task name' },
      { name: 'extension', type: 'string', required: false, description: 'Task extension' },
      { name: 'type', type: 'string', required: false, description: 'Task type' },
      { name: 'path', type: 'string', required: false, description: 'Task path' }
    ]
  },
  {
    id: '27',
    name: 'Delete Task',
    path: 'http://localhost:8742/api/plan/tasks/:name',
    method: 'DELETE',
    category: 'planning',
    description: 'Delete a task',
    parameters: [
      { name: 'name', type: 'string', required: true, description: 'Task name' }
    ]
  },
  {
    id: '28',
    name: 'Create Task Folder',
    path: 'http://localhost:8742/api/plan/tasks/:name/folders',
    method: 'POST',
    category: 'planning',
    description: 'Create a folder within a task',
    parameters: [
      { name: 'name', type: 'string', required: true, description: 'Task name' },
      { name: 'folderName', type: 'string', required: true, description: 'Folder name' },
      { name: 'path', type: 'string', required: false, description: 'Folder path' }
    ]
  },
  {
    id: '29',
    name: 'List Task Folders',
    path: 'http://localhost:8742/api/plan/tasks/:name/folders',
    method: 'GET',
    category: 'planning',
    description: 'List folders in a task',
    parameters: [
      { name: 'name', type: 'string', required: true, description: 'Task name' }
    ]
  },
  {
    id: '30',
    name: 'Create Task File',
    path: 'http://localhost:8742/api/plan/tasks/:name/files',
    method: 'POST',
    category: 'planning',
    description: 'Create a file within a task',
    parameters: [
      { name: 'name', type: 'string', required: true, description: 'Task name' },
      { name: 'fileName', type: 'string', required: true, description: 'File name' },
      { name: 'extension', type: 'string', required: false, description: 'File extension' },
      { name: 'content', type: 'code', required: false, description: 'File content' }
    ]
  },
  {
    id: '40',
    name: 'List Task Files',
    path: 'http://localhost:8742/api/plan/tasks/:name/files',
    method: 'GET',
    category: 'planning',
    description: 'List files in a task',
    parameters: [
      { name: 'name', type: 'string', required: true, description: 'Task name' }
    ]
  },
  // Structure endpoints
  {
    id: '41',
    name: 'Create Structure',
    path: 'http://localhost:8742/api/structure',
    method: 'POST',
    category: 'planning',
    description: 'Prepare a complete folder/file structure',
    parameters: [
      { name: 'structure', type: 'code', required: true, description: 'JSON structure with folders and files (files can have sourcePath to copy existing files)' },
      { name: 'planName', type: 'string', required: false, description: 'Nombre del plan donde guardar la tarea' },
      { name: 'saveToPlan', type: 'boolean', required: false, description: 'Guardar en plan en lugar de ejecutar' }
    ]
  },
  {
    id: '42',
    name: 'Execute Structure',
    path: 'http://localhost:8742/api/structure/execute',
    method: 'POST',
    category: 'planning',
    description: 'Execute the prepared structure creation',
    parameters: [
      { name: 'planName', type: 'string', required: false, description: 'Nombre del plan donde guardar la tarea' },
      { name: 'saveToPlan', type: 'boolean', required: false, description: 'Guardar en plan en lugar de ejecutar' }
    ]
  },
  {
    id: '43',
    name: 'Execute Plan',
    path: 'http://localhost:8742/api/plan/execute',
    method: 'POST',
    category: 'planning',
    description: 'Execute all pending tasks in the plan',
    parameters: [
      { name: 'planName', type: 'string', required: true, description: 'Select the plan to execute' }
    ]
  },
  {
    id: '44',
    name: 'Get File History',
    path: 'http://localhost:8742/api/files/:name/history',
    method: 'GET',
    category: 'history',
    description: 'Get modification history for a specific file',
    parameters: [
      { name: 'name', type: 'string', required: true, description: 'File name' }
    ]
  },
  {
    id: '45',
    name: 'Undo Last Change',
    path: 'http://localhost:8742/api/files/:name/undo',
    method: 'POST',
    category: 'history',
    description: 'Undo the last modification to a file',
    parameters: [
      { name: 'name', type: 'string', required: true, description: 'File name' }
    ]
  },
  {
    id: '46',
    name: 'List Files with History',
    path: 'http://localhost:8742/api/history/files',
    method: 'GET',
    category: 'history',
    description: 'List all files that have modification history',
    parameters: []
  },
  {
    id: '35',
    name: 'Get Structure Tree',
    path: 'http://localhost:8742/api/structure/tree',
    method: 'GET',
    category: 'management',
    description: 'View the created structure as a tree',
    parameters: []
  }
];

const endpointNameKeys: Record<string, string> = {
  '1': 'epCreateFolder',
  '2': 'epListFolders',
  '3': 'epUpdateFolder',
  '4': 'epDeleteFolder',
  '5': 'epCreateFile',
  '6': 'epGetFile',
  '7': 'epListFiles',
  '8': 'epUpdateFile',
  '9': 'epDeleteFile',
  '10': 'epGetLines',
  '11': 'epListAllLines',
  '12': 'epInsertLines',
  '13': 'epReplaceLines',
  '14': 'epDeleteLines',
  '15': 'epGetCharacters',
  '16': 'epListCharacters',
  '17': 'epInsertCharacters',
  '18': 'epReplaceCharacters',
  '19': 'epDeleteCharacters',
  '36': 'epCreatePlan',
  '47': 'epSavePlan',
  '37': 'epListPlans',
  '38': 'epGetPlan',
  '48': 'epCreateTask',
  '24': 'epListTasks',
  '25': 'epGetTask',
  '26': 'epUpdateTask',
  '27': 'epDeleteTask',
  '28': 'epCreateTaskFolder',
  '29': 'epListTaskFolders',
  '30': 'epCreateTaskFile',
  '40': 'epListTaskFiles',
  '41': 'epCreateStructure',
  '42': 'epExecuteStructure',
  '43': 'epExecutePlan',
  '44': 'epGetFileHistory',
  '45': 'epUndoLastChange',
  '46': 'epListFilesWithHistory',
  '35': 'epGetStructureTree',
};

const endpointDescKeys: Record<string, string> = {
  '1': 'epCreateFolderDesc',
  '2': 'epListFoldersDesc',
  '3': 'epUpdateFolderDesc',
  '4': 'epDeleteFolderDesc',
  '5': 'epCreateFileDesc',
  '6': 'epGetFileDesc',
  '7': 'epListFilesDesc',
  '8': 'epUpdateFileDesc',
  '9': 'epDeleteFileDesc',
  '10': 'epGetLinesDesc',
  '11': 'epListAllLinesDesc',
  '12': 'epInsertLinesDesc',
  '13': 'epReplaceLinesDesc',
  '14': 'epDeleteLinesDesc',
  '15': 'epGetCharactersDesc',
  '16': 'epListCharactersDesc',
  '17': 'epInsertCharactersDesc',
  '18': 'epReplaceCharactersDesc',
  '19': 'epDeleteCharactersDesc',
  '36': 'epCreatePlanDesc',
  '47': 'epSavePlanDesc',
  '37': 'epListPlansDesc',
  '38': 'epGetPlanDesc',
  '48': 'epCreateTaskDesc',
  '24': 'epListTasksDesc',
  '25': 'epGetTaskDesc',
  '26': 'epUpdateTaskDesc',
  '27': 'epDeleteTaskDesc',
  '28': 'epCreateTaskFolderDesc',
  '29': 'epListTaskFoldersDesc',
  '30': 'epCreateTaskFileDesc',
  '40': 'epListTaskFilesDesc',
  '41': 'epCreateStructureDesc',
  '42': 'epExecuteStructureDesc',
  '43': 'epExecutePlanDesc',
  '44': 'epGetFileHistoryDesc',
  '45': 'epUndoLastChangeDesc',
  '46': 'epListFilesWithHistoryDesc',
  '35': 'epGetStructureTreeDesc',
};

// Mock data for tasks
const mockTasks: Task[] = [
  {
    id: '1',
    title: 'Implement API endpoints',
    description: 'Create all necessary API endpoints for file management',
    status: 'in-progress',
    dueDate: '2024-01-15',
    files: ['api.ts', 'routes.ts']
  },
  {
    id: '2',
    title: 'Add authentication',
    description: 'Implement user authentication system',
    status: 'todo',
    dueDate: '2024-01-20',
    files: ['auth.ts', 'middleware.ts']
  },
  {
    id: '3',
    title: 'Write documentation',
    description: 'Create comprehensive API documentation',
    status: 'done',
    files: ['README.md', 'api-docs.md']
  }
];

// Mock data for file system
const mockFileSystem: FileSystemItem[] = [
  { type: 'folder', name: 'src', path: '/src', size: 4096, modified: '2024-01-10' },
  { type: 'folder', name: 'public', path: '/public', size: 2048, modified: '2024-01-09' },
  { type: 'file', name: 'index.ts', path: '/src/index.ts', size: 1024, modified: '2024-01-10' },
  { type: 'file', name: 'app.tsx', path: '/src/app.tsx', size: 2048, modified: '2024-01-10' },
  { type: 'file', name: 'package.json', path: '/package.json', size: 512, modified: '2024-01-08' }
];

export default function APIFileCommander() {
  // Global Store State
  const {
    models,
    selectedModel,
    fetchModels,
    setSelectedModel,
    init: initStore,
    explorerRefreshTrigger
  } = useStore();
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [isLangDropdownOpen, setIsLangDropdownOpen] = useState(false);
  const { t, language, setLanguage } = useTranslation();
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'testing'>('disconnected');

  // Initialize store and fetch models
  useEffect(() => {
    const initialize = async () => {
      setIsLoadingModels(true);
      await initStore();
      await fetchModels();
      setIsLoadingModels(false);
    };
    initialize();
  }, [initStore, fetchModels]);

  // Listen for Lucide icon toggle from theme editor
  useEffect(() => {
    const saved = localStorage.getItem('zeus-use-lucide-icons') === 'true';
    setUseLucideIcons(saved);
    const handler = (e: Event) => {
      const custom = e as CustomEvent;
      setUseLucideIcons(custom.detail?.useLucideIcons ?? false);
    };
    window.addEventListener('zeus-theme-icons-changed', handler);
    return () => window.removeEventListener('zeus-theme-icons-changed', handler);
  }, []);

  // App-wide tab state
  const [appTabs, setAppTabs] = useState<any[]>([
    {
      id: '1',
      name: 'Workspace 1',
      selectedEndpoint: null,
      apiResponse: null,
      fileSystem: [...mockFileSystem],
      tasks: [...mockTasks],
      searchQuery: '',
      structureItems: [],
      structureTree: null,
      activeMainTab: 'explorer',
      currentPath: '',
      folderContents: [],
      navigationHistory: [],
      explorerDialogMode: null as any,
      explorerDialogValue: '',
      explorerContextMenu: { visible: false, x: 0, y: 0, item: null as any, targetPath: null as any },
      hasClipboardContent: false,
      explorerDialogItem: null as any,
      sidebarApiSource: 'zeus',
      sidebarApiEndpoints: [] as any[],
      isSidebarApiLoading: false,
      selectedPlan: null as any,
      expandedPlanIds: {} as Record<string, boolean>,
      executedPlanIds: {} as Record<string, boolean>,
      executedTaskKeys: {} as Record<string, boolean>,
      executingPlanIds: {} as Record<string, boolean>,
      executingTaskKeys: {} as Record<string, boolean>,
      saveToPlan: false,
      showPlanTasks: false,
      selectedFiles: {} as Record<string, File | null>,
      pocketBaseRecords: [] as any[],
      projectRoot: null as string | null,
      projectId: null as string | null,
      projectName: ''
    }
  ]);
  const [activeAppTab, setActiveAppTab] = useState('1');

  // Get current tab data (with defaults for backward compatibility)
  const getCurrentTab = () => {
    const tab = appTabs.find(tab => tab.id === activeAppTab) || appTabs[0];
    return {
      currentPath: '',
      folderContents: [],
      navigationHistory: [],
      explorerDialogMode: null,
      explorerDialogValue: '',
      explorerContextMenu: { visible: false, x: 0, y: 0, item: null, targetPath: null },
      hasClipboardContent: false,
      explorerDialogItem: null,
      sidebarApiSource: 'zeus',
      sidebarApiEndpoints: [],
      isSidebarApiLoading: false,
      selectedPlan: null,
      expandedPlanIds: {},
      executedPlanIds: {},
      executedTaskKeys: {},
      executingPlanIds: {},
      executingTaskKeys: {},
      saveToPlan: false,
      showPlanTasks: false,
      selectedFiles: {},
      pocketBaseRecords: [],
      projectRoot: null,
      projectId: null,
      projectName: '',
      ...tab
    };
  };

  // Update current tab
  const updateCurrentTab = (updates: any) => {
    setAppTabs(tabs =>
      tabs.map(tab =>
        tab.id === activeAppTab ? { ...tab, ...updates } : tab
      )
    );
  };

  // Tab management functions
  const createNewTab = () => {
    const newTabId = (appTabs.length + 1).toString();
    const newTab = {
      id: newTabId,
      name: `Workspace ${newTabId}`,
      selectedEndpoint: null,
      apiResponse: null,
      fileSystem: [...mockFileSystem],
      tasks: [...mockTasks],
      searchQuery: '',
      structureItems: [],
      structureTree: null,
      activeMainTab: 'explorer',
      currentPath: '',
      folderContents: [],
      navigationHistory: [],
      explorerDialogMode: null as any,
      explorerDialogValue: '',
      explorerContextMenu: { visible: false, x: 0, y: 0, item: null as any, targetPath: null as any },
      hasClipboardContent: false,
      explorerDialogItem: null as any,
      sidebarApiSource: 'zeus',
      sidebarApiEndpoints: [] as any[],
      isSidebarApiLoading: false,
      selectedPlan: null as any,
      expandedPlanIds: {} as Record<string, boolean>,
      executedPlanIds: {} as Record<string, boolean>,
      executedTaskKeys: {} as Record<string, boolean>,
      executingPlanIds: {} as Record<string, boolean>,
      executingTaskKeys: {} as Record<string, boolean>,
      saveToPlan: false,
      showPlanTasks: false,
      selectedFiles: {} as Record<string, File | null>,
      pocketBaseRecords: [] as any[],
      projectRoot: null as string | null,
      projectId: null as string | null,
      projectName: ''
    };

    setAppTabs([...appTabs, newTab]);
    setActiveAppTab(newTabId);
  };

  const closeTab = (tabId: string) => {
    if (appTabs.length <= 1) return;

    const newTabs = appTabs.filter(tab => tab.id !== tabId);

    if (activeAppTab === tabId) {
      setActiveAppTab(newTabs[0].id);
    }

    setAppTabs(newTabs);
    clearTabState(tabId);
  };

  // Helper state getters from current tab
  const currentTab = getCurrentTab();
  const selectedEndpoint: ApiEndpoint | null = currentTab.selectedEndpoint;
  const apiResponse: any = currentTab.apiResponse;
  const searchQuery: string = currentTab.searchQuery || '';
  const fileSystem: any[] = currentTab.fileSystem || [];
  const tasks: any[] = currentTab.tasks || [];
  const structureItems: any[] = currentTab.structureItems || [];
  const structureTree: any = currentTab.structureTree;
  const activeMainTab: string = currentTab.activeMainTab || 'explorer';

  const setSelectedEndpoint = useCallback((endpoint: ApiEndpoint | null) => {
    updateCurrentTab({ selectedEndpoint: endpoint });
  }, [activeAppTab]);

  const setApiResponse = useCallback((response: any) => {
    updateCurrentTab({ apiResponse: response });
  }, [activeAppTab]);

  const setSearchQuery = useCallback((query: string) => {
    updateCurrentTab({ searchQuery: query });
  }, [activeAppTab]);

  const setActiveTab = useCallback((tab: string) => {
    console.log('setActiveTab called with:', tab);
    updateCurrentTab({ activeMainTab: tab });
  }, [activeAppTab]);

  const setStructureItems = useCallback((items: any[]) => {
    updateCurrentTab({ structureItems: items });
  }, [activeAppTab]);

  // Project state per tab
  const tabProjectRoot: string | null = currentTab.projectRoot || null;
  const tabProjectId: string | null = currentTab.projectId || null;
  const tabProjectName: string = currentTab.projectName || '';
  const setTabProjectRoot = useCallback((root: string | null) => updateCurrentTab({ projectRoot: root }), [activeAppTab]);
  const setTabProjectId = useCallback((id: string | null) => updateCurrentTab({ projectId: id }), [activeAppTab]);
  const setTabProjectName = useCallback((name: string) => updateCurrentTab({ projectName: name }), [activeAppTab]);

  // Per-tab getters for newly migrated states
  const currentPath: string = currentTab.currentPath || '';
  const folderContents: any[] = currentTab.folderContents || [];
  const navigationHistory: string[] = currentTab.navigationHistory || [];
  const explorerDialogMode: any = currentTab.explorerDialogMode;
  const explorerDialogValue: string = currentTab.explorerDialogValue || '';
  const explorerContextMenu: any = currentTab.explorerContextMenu || { visible: false, x: 0, y: 0, item: null, targetPath: null };
  const hasClipboardContent: boolean = currentTab.hasClipboardContent || false;
  const explorerDialogItem: any = currentTab.explorerDialogItem;
  const sidebarApiSource: 'zeus' | 'project' | string = currentTab.sidebarApiSource || 'zeus';
  const sidebarApiEndpoints: ApiEndpoint[] = currentTab.sidebarApiEndpoints || [];
  const isSidebarApiLoading: boolean = currentTab.isSidebarApiLoading || false;
  const selectedPlan: any = currentTab.selectedPlan;
  const expandedPlanIds: Record<string, boolean> = currentTab.expandedPlanIds || {};
  const executedPlanIds: Record<string, boolean> = currentTab.executedPlanIds || {};
  const executedTaskKeys: Record<string, boolean> = currentTab.executedTaskKeys || {};
  const executingPlanIds: Record<string, boolean> = currentTab.executingPlanIds || {};
  const executingTaskKeys: Record<string, boolean> = currentTab.executingTaskKeys || {};
  const saveToPlan: boolean = currentTab.saveToPlan || false;
  const showPlanTasks: boolean = currentTab.showPlanTasks || false;
  const selectedFiles: Record<string, File | null> = currentTab.selectedFiles || {};
  const pocketBaseRecords: any[] = currentTab.pocketBaseRecords || [];

  // Per-tab setters
  const setCurrentPath = useCallback((path: string) => updateCurrentTab({ currentPath: path }), [activeAppTab]);
  const setFolderContents = useCallback((contents: any[]) => updateCurrentTab({ folderContents: contents }), [activeAppTab]);
  const setNavigationHistory = useCallback((history: string[] | ((prev: string[]) => string[])) => {
    setAppTabs(tabs => tabs.map(tab => {
      if (tab.id !== activeAppTab) return tab;
      const current = tab.navigationHistory || [];
      const next = typeof history === 'function' ? history(current) : history;
      return { ...tab, navigationHistory: next };
    }));
  }, [activeAppTab]);
  const setExplorerDialogMode = useCallback((mode: any) => updateCurrentTab({ explorerDialogMode: mode }), [activeAppTab]);
  const setExplorerDialogValue = useCallback((value: string) => updateCurrentTab({ explorerDialogValue: value }), [activeAppTab]);
  const setExplorerContextMenu = useCallback((menu: any) => updateCurrentTab({ explorerContextMenu: menu }), [activeAppTab]);
  const setHasClipboardContent = useCallback((val: boolean) => updateCurrentTab({ hasClipboardContent: val }), [activeAppTab]);
  const setExplorerDialogItem = useCallback((item: any) => updateCurrentTab({ explorerDialogItem: item }), [activeAppTab]);
  const setSidebarApiSource = useCallback((source: 'zeus' | 'project' | string) => updateCurrentTab({ sidebarApiSource: source }), [activeAppTab]);
  const setSidebarApiEndpoints = useCallback((endpoints: ApiEndpoint[]) => updateCurrentTab({ sidebarApiEndpoints: endpoints }), [activeAppTab]);
  const setIsSidebarApiLoading = useCallback((loading: boolean) => updateCurrentTab({ isSidebarApiLoading: loading }), [activeAppTab]);
  const setSelectedPlan = useCallback((plan: any) => updateCurrentTab({ selectedPlan: plan }), [activeAppTab]);
  const setExpandedPlanIds = useCallback((ids: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => {
    setAppTabs(tabs => tabs.map(tab => {
      if (tab.id !== activeAppTab) return tab;
      const current = tab.expandedPlanIds || {};
      const next = typeof ids === 'function' ? ids(current) : ids;
      return { ...tab, expandedPlanIds: next };
    }));
  }, [activeAppTab]);
  const setExecutedPlanIds = useCallback((ids: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => {
    setAppTabs(tabs => tabs.map(tab => {
      if (tab.id !== activeAppTab) return tab;
      const current = tab.executedPlanIds || {};
      const next = typeof ids === 'function' ? ids(current) : ids;
      return { ...tab, executedPlanIds: next };
    }));
  }, [activeAppTab]);
  const setExecutedTaskKeys = useCallback((keys: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => {
    setAppTabs(tabs => tabs.map(tab => {
      if (tab.id !== activeAppTab) return tab;
      const current = tab.executedTaskKeys || {};
      const next = typeof keys === 'function' ? keys(current) : keys;
      return { ...tab, executedTaskKeys: next };
    }));
  }, [activeAppTab]);
  const setExecutingPlanIds = useCallback((ids: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => {
    setAppTabs(tabs => tabs.map(tab => {
      if (tab.id !== activeAppTab) return tab;
      const current = tab.executingPlanIds || {};
      const next = typeof ids === 'function' ? ids(current) : ids;
      return { ...tab, executingPlanIds: next };
    }));
  }, [activeAppTab]);
  const setExecutingTaskKeys = useCallback((keys: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => {
    setAppTabs(tabs => tabs.map(tab => {
      if (tab.id !== activeAppTab) return tab;
      const current = tab.executingTaskKeys || {};
      const next = typeof keys === 'function' ? keys(current) : keys;
      return { ...tab, executingTaskKeys: next };
    }));
  }, [activeAppTab]);
  const setSaveToPlan = useCallback((val: boolean) => updateCurrentTab({ saveToPlan: val }), [activeAppTab]);
  const setShowPlanTasks = useCallback((val: boolean) => updateCurrentTab({ showPlanTasks: val }), [activeAppTab]);
  const setSelectedFiles = useCallback((files: Record<string, File | null> | ((prev: Record<string, File | null>) => Record<string, File | null>)) => {
    setAppTabs(tabs => tabs.map(tab => {
      if (tab.id !== activeAppTab) return tab;
      const current = tab.selectedFiles || {};
      const next = typeof files === 'function' ? files(current) : files;
      return { ...tab, selectedFiles: next };
    }));
  }, [activeAppTab]);
  const setPocketBaseRecords = useCallback((records: any[]) => updateCurrentTab({ pocketBaseRecords: records }), [activeAppTab]);

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [chatWidth, setChatWidth] = useState(400); // Ancho inicial por defecto
  const [isResizingChat, setIsResizingChat] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const tabsScrollRef = useRef<HTMLDivElement>(null);
  const [useLucideIcons, setUseLucideIcons] = useState(false);

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingChat(true);
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizingChat(false);
  }, []);

  const resize = useCallback((e: MouseEvent) => {
    if (isResizingChat) {
      const newWidth = window.innerWidth - e.clientX;
      if (newWidth > 300 && newWidth < 800) {
        setChatWidth(newWidth);
      }
    }
  }, [isResizingChat]);

  useEffect(() => {
    if (isResizingChat) {
      window.addEventListener('mousemove', resize);
      window.addEventListener('mouseup', stopResizing);
    }
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [isResizingChat, resize, stopResizing]);

  // Detectar cuando hay scroll disponible en las pestañas
  useEffect(() => {
    const checkScroll = () => {
      if (tabsScrollRef.current) {
        const { scrollLeft, scrollWidth, clientWidth } = tabsScrollRef.current;
        setCanScrollLeft(scrollLeft > 0);
        setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 1);
      }
    };

    checkScroll();
    window.addEventListener('resize', checkScroll);
    tabsScrollRef.current?.addEventListener('scroll', checkScroll);

    return () => {
      window.removeEventListener('resize', checkScroll);
      tabsScrollRef.current?.removeEventListener('scroll', checkScroll);
    };
  }, []);

  const scrollTabs = (direction: 'left' | 'right') => {
    if (tabsScrollRef.current) {
      const scrollAmount = 300;
      tabsScrollRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };
  const [isModelModalOpen, setIsModelModalOpen] = useState(false);
  const [isThemeEditorOpen, setIsThemeEditorOpen] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      void loadAndApplyTheme();
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const [isGitHubModalOpen, setIsGitHubModalOpen] = useState(false);
  const [isApiModalOpen, setIsApiModalOpen] = useState(false);
  const [selectedApiProject, setSelectedApiProject] = useState<any>(null);
  const [apiProjects, setApiProjects] = useState<any[]>([]);
  const [apiProjectsLoading, setApiProjectsLoading] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [savedStructures, setSavedStructures] = useState<any[]>([]);
  // NOTE: selectedPlan, expandedPlanIds, executedPlanIds, executedTaskKeys,
  // executingPlanIds, executingTaskKeys are now stored per-tab in appTabs.
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const loadApiProjects = useCallback(async () => {
    setApiProjectsLoading(true);
    try {
      const pb = getPocketBase();
      const records = await pb.collection('projects_api').getList(1, 50, {
        sort: '-created'
      });
      setApiProjects(records.items);
    } catch (e) {
      console.error('Error al cargar proyectos:', e);
      setApiProjects([]);
    } finally {
      setApiProjectsLoading(false);
    }
  }, []);

  const handleDeleteApiProject = useCallback(async (projectId: string) => {
    try {
      const pb = getPocketBase();
      await pb.collection('projects_api').delete(projectId);
      setNotification({ type: 'success', message: 'Proyecto eliminado correctamente' });
      await loadApiProjects();
    } catch (e) {
      console.error('Error al eliminar proyecto API:', e);
      setNotification({ type: 'error', message: 'No se pudo eliminar el proyecto' });
    }
  }, [loadApiProjects]);

  useEffect(() => {
    if (activeMainTab === 'api-generator') {
      const initializeAndLoad = async () => {
        try {
          await initPocketBase();
          loadApiProjects();
        } catch (error) {
          console.error('Error al inicializar PocketBase:', error);
        }
      };
      initializeAndLoad();
    }
  }, [activeMainTab, loadApiProjects]);

  // Cargar proyectos API al inicio para el sidebar
  useEffect(() => {
    const init = async () => {
      try {
        await initPocketBase();
        loadApiProjects();
      } catch (error) {
        console.error('Error al inicializar PocketBase para sidebar:', error);
      }
    };
    init();
  }, [loadApiProjects]);

  const togglePlanExpansion = useCallback((planId: string) => {
    setExpandedPlanIds((prev) => ({ ...prev, [planId]: !prev[planId] }));
  }, []);

  const testConnection = useCallback(async () => {
    setConnectionStatus('testing');
    try {
      const response = await fetch('http://localhost:8742/api/folders');
      setConnectionStatus(response.ok ? 'connected' : 'disconnected');
    } catch {
      setConnectionStatus('disconnected');
    }
  }, []);

  useEffect(() => {
    testConnection();
  }, [testConnection]);

  const loadSavedList = useCallback(async () => {
    try {
      const response = await fetch('http://localhost:8742/api/structure/list');
      const result = await response.json();
      if (result.success) setSavedStructures(result.saves);
    } catch (error) {
      console.error('Failed to load saved structures list');
    }
  }, []);

  useEffect(() => {
    loadSavedList();
  }, [loadSavedList]);

  // Load structure tree
  const loadStructureTree = useCallback(async () => {
    try {
      const response = await fetch('http://localhost:8742/api/structure/tree');
      const result = await response.json();

      if (result.success) {
        updateCurrentTab({ structureTree: result.tree });
      }
    } catch (error) {
      setNotification({
        type: 'error',
        message: 'Failed to load structure tree'
      });
    }
  }, [activeAppTab]);

  // Form
  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<EndpointTestFormData>({
    resolver: zodResolver(endpointTestSchema)
  });

  // Query client
  const queryClient = useQueryClient();

  // State for plans
  const [plans, setPlans] = useState<any[]>([]);

  // Fetch plans
  const fetchPlans = useCallback(async () => {
    console.log('🔄 fetchPlans called');
    try {
      const response = await fetch('http://localhost:8742/api/plans/list');
      console.log('📡 Response status:', response.status);
      console.log('📡 Response headers:', response.headers);
      const result = await response.json();
      console.log('📋 Plans API response:', result);
      console.log('📋 Response success:', result.success);
      console.log('📋 Plans array:', result.plans);
      console.log('📋 Plans length:', result.plans?.length);
      if (result.success) {
        console.log('✅ Setting plans:', result.plans || []);
        setPlans(result.plans || []);
      }
    } catch (error) {
      console.error('❌ Failed to fetch plans:', error);
    }
  }, []);

  // Cargar planes al montar el componente
  useEffect(() => {
    console.log('🚀 Component mounted, fetching initial plans...');
    fetchPlans();
  }, [fetchPlans]);

  // Log para depuración del estado de planes
  useEffect(() => {
    console.log('📊 Plans state updated:', plans);
  }, [plans]);

  // NOTE: saveToPlan, showPlanTasks, selectedFiles, currentPath, sidebarApiSource,
  // sidebarApiEndpoints, isSidebarApiLoading are now stored per-tab in appTabs.
  const [dataPath, setDataPath] = useState('');
  const { projectRoot: contextProjectRoot } = useProject();
  const effectiveProjectRoot = contextProjectRoot || currentPath || dataPath || '';

  useEffect(() => {
    fetch('/api/config/data-path')
      .then(res => res.json())
      .then(data => { if (data.success) setDataPath(data.dataPath); })
      .catch(() => {});
  }, []);

  const loadSidebarProjectEndpoints = useCallback(async () => {
    if (!effectiveProjectRoot) {
      setSidebarApiEndpoints([]);
      return;
    }
    setIsSidebarApiLoading(true);
    try {
      const res = await fetch('/api/read-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: 'API/zeus-api-config.json', projectRoot: effectiveProjectRoot })
      });
      if (!res.ok) {
        setSidebarApiEndpoints([]);
        return;
      }
      const { content } = await res.json();
      const parsed = JSON.parse(content);
      const endpoints: ApiEndpoint[] = (parsed.endpoints || []).map((ep: any, idx: number) => ({
        id: ep.id || `dyn-${idx}`,
        name: ep.description || ep.path || 'Endpoint',
        path: ep.path || '',
        method: (['GET','POST','PUT','DELETE'].includes(ep.method) ? ep.method : 'GET') as ApiEndpoint['method'],
        category: 'management' as ApiEndpoint['category'],
        description: ep.description || '',
        parameters: Object.entries(ep.parameters || {}).map(([name, info]: [string, any]) => ({
          name,
          type: (info?.type || 'string') as ApiParameter['type'],
          required: !!info?.required,
          description: info?.description || ''
        }))
      }));
      setSidebarApiEndpoints(endpoints);
    } catch (e) {
      console.error('Error cargando endpoints del proyecto:', e);
      setSidebarApiEndpoints([]);
    } finally {
      setIsSidebarApiLoading(false);
    }
  }, [effectiveProjectRoot, activeAppTab]); // ← activeAppTab para que el closure apunte a la pestaña actual

  const loadSidebarSavedApiEndpoints = useCallback(async (apiId: string) => {
    if (!apiId) {
      setSidebarApiEndpoints([]);
      return;
    }
    setIsSidebarApiLoading(true);
    try {
      const pb = getPocketBase();
      const record = await pb.collection('projects_api').getOne(apiId);
      const endpointsRaw = typeof record.endpoints === 'string' ? JSON.parse(record.endpoints || '[]') : (record.endpoints || []);
      const endpoints: ApiEndpoint[] = endpointsRaw.map((ep: any, idx: number) => ({
        id: ep.id || `dyn-${idx}`,
        name: ep.description || ep.path || 'Endpoint',
        path: ep.path || '',
        method: (['GET','POST','PUT','DELETE'].includes(ep.method) ? ep.method : 'GET') as ApiEndpoint['method'],
        category: 'management' as ApiEndpoint['category'],
        description: ep.description || '',
        parameters: Object.entries(ep.parameters || {}).map(([name, info]: [string, any]) => ({
          name,
          type: (info?.type || 'string') as ApiParameter['type'],
          required: !!info?.required,
          description: info?.description || ''
        }))
      }));
      setSidebarApiEndpoints(endpoints);
    } catch (e) {
      console.error('Error cargando endpoints de API guardada:', e);
      setSidebarApiEndpoints([]);
    } finally {
      setIsSidebarApiLoading(false);
    }
  }, [activeAppTab]); // ← activeAppTab para que el closure apunte a la pestaña actual

  const sidebarApiKey = `${activeAppTab}-${sidebarApiSource}`;

  useEffect(() => {
    if (sidebarApiSource === 'zeus') {
      setSidebarApiEndpoints(mockEndpoints);
    } else if (sidebarApiSource === 'project') {
      loadSidebarProjectEndpoints();
    } else {
      loadSidebarSavedApiEndpoints(sidebarApiSource);
    }
  }, [sidebarApiKey, loadSidebarProjectEndpoints, loadSidebarSavedApiEndpoints]);

  const handleLoadSavedApi = useCallback(async () => {
    try {
      const res = await fetch('/api/read-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: 'API/zeus-api-config.json', projectRoot: currentPath || '' })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'No se encontró una API guardada en este proyecto.');
      }
      const { content } = await res.json();
      const parsed = JSON.parse(content);
      setSelectedApiProject(parsed);
      setNotification({ type: 'success', message: 'API cargada correctamente desde el proyecto.' });
    } catch (e) {
      setNotification({ type: 'error', message: e instanceof Error ? e.message : 'Error al cargar la API guardada.' });
    }
  }, [currentPath]);

  // NOTE: folderContents, navigationHistory, explorerDialogMode, explorerDialogValue,
  // explorerContextMenu, hasClipboardContent, explorerDialogItem, pocketBaseRecords
  // are now stored per-tab in appTabs.

  // Fetch Pocket Base records
  const fetchPocketBaseRecords = useCallback(async () => {
    try {
      const pocketBaseUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL || 'http://localhost:8091';
      const possibleUrls = [
        `${pocketBaseUrl}/api/collections/file_path/records`,
        `${pocketBaseUrl}/api/collections/file_path/records?page=1&perPage=100`
      ];

      let result = null;
      let workingUrl = null;

      for (const url of possibleUrls) {
        try {
          const response = await fetch(url);
          if (response.ok) {
            result = await response.json();
            workingUrl = url;
            break;
          }
        } catch (urlError) {
          continue;
        }
      }

      if (result && result.items) {
        setPocketBaseRecords(result.items || []);
      } else {
        setPocketBaseRecords([
          {
            id: "example_1",
            nombre: "ejemplo.txt",
            contenido: "Este es un archivo de ejemplo",
            ruta: "/proyecto/ejemplo.txt"
          }
        ]);
      }
    } catch (error) {
      setPocketBaseRecords([
        {
          id: "example_1",
          nombre: "ejemplo.txt",
          contenido: "Este es un archivo de ejemplo",
          ruta: "/proyecto/ejemplo.txt"
        }
      ]);
    }
  }, []);

  // Folder navigation functions
  const navigateToFolder = useCallback(async (folderPath: string) => {
    try {
      // Fetch both folders and files
      const [foldersResponse, filesResponse] = await Promise.all([
        fetch(`http://localhost:8742/api/folders?path=${encodeURIComponent(folderPath)}`),
        fetch(`http://localhost:8742/api/files?path=${encodeURIComponent(folderPath)}`)
      ]);

      const foldersResult = await foldersResponse.json();
      const filesResult = await filesResponse.json();

      if (foldersResult.success || filesResult.success) {
        const combinedContents = [
          ...(foldersResult.folders || []).map((folder: any) => ({
            ...folder,
            type: 'folder',
            size: 0 // Default size for folders
          })),
          ...(filesResult.files || []).map((file: any) => ({
            ...file,
            type: 'file'
          }))
        ];

        setFolderContents(combinedContents);
        setCurrentPath(folderPath);
        setNavigationHistory(prev => [...prev, folderPath]);
      }
    } catch (error) {
      console.error('Failed to navigate to folder:', error);
    }
  }, []);

  // Refrescar explorador cuando lo solicite el chat
  useEffect(() => {
    if (explorerRefreshTrigger > 0) {
      console.log('🔄 Chat solicitó actualización del explorador...');
      fetchPlans();
      navigateToFolder(currentPath);
    }
  }, [explorerRefreshTrigger, fetchPlans, navigateToFolder, currentPath]);

  // Load data on component mount
  useEffect(() => {
    fetchPlans();
    fetchPocketBaseRecords();

    // Load initial root folder contents
    navigateToFolder('');
  }, [fetchPlans, fetchPocketBaseRecords, navigateToFolder]);

  const navigateBack = useCallback(() => {
    if (navigationHistory.length > 1) {
      const newHistory = navigationHistory.slice(0, -1);
      const previousPath = newHistory[newHistory.length - 1] || '';

      // Update state immediately
      setNavigationHistory(newHistory);
      setCurrentPath(previousPath);

      // Load contents of previous folder without adding to history again
      const loadPreviousFolder = async () => {
        try {
          const [foldersResponse, filesResponse] = await Promise.all([
            fetch(`http://localhost:8742/api/folders?path=${encodeURIComponent(previousPath)}`),
            fetch(`http://localhost:8742/api/files?path=${encodeURIComponent(previousPath)}`)
          ]);

          const foldersResult = await foldersResponse.json();
          const filesResult = await filesResponse.json();

          if (foldersResult.success || filesResult.success) {
            const combinedContents = [
              ...(foldersResult.folders || []).map((folder: any) => ({
                ...folder,
                type: 'folder',
                size: 0
              })),
              ...(filesResult.files || []).map((file: any) => ({
                ...file,
                type: 'file'
              }))
            ];

            setFolderContents(combinedContents);
          }
        } catch (error) {
          console.error('Failed to load previous folder:', error);
        }
      };

      loadPreviousFolder();
    } else if (navigationHistory.length === 1) {
      // Go back to root
      setNavigationHistory([]);
      setCurrentPath('');
      setFolderContents([]);
    }
  }, [navigationHistory]);

  // Check clipboard content when context menu opens
  useEffect(() => {
    if (explorerContextMenu.visible) {
      const checkClipboard = async () => {
        if (typeof window !== 'undefined' && (window as any).electronAPI?.fileExplorer) {
          try {
            const hasContent = await (window as any).electronAPI.fileExplorer.hasClipboardContent();
            setHasClipboardContent(hasContent);
          } catch (error) {
            console.error('Error checking clipboard:', error);
            setHasClipboardContent(false);
          }
        }
      };
      checkClipboard();
    }
  }, [explorerContextMenu.visible]);

  const navigateToParent = useCallback(() => {
    if (currentPath) {
      const parentPath = currentPath.split('/').slice(0, -1).join('/');
      navigateToFolder(parentPath);
    }
  }, [currentPath, navigateToFolder]);

  const splitExplorerItemPath = useCallback((itemPath: string) => {
    const normalized = itemPath.replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    const name = parts.pop() || '';
    const parentPath = parts.join('/');
    return { name, parentPath };
  }, []);

  const executeCreateExplorerFolder = useCallback(async (folderName: string) => {
    try {
      const response = await fetch('http://localhost:8742/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: folderName.trim(), path: currentPath || '' })
      });

      const result = await response.json();
      if (!response.ok || !result?.success) {
        throw new Error(result?.error || 'No se pudo crear la carpeta');
      }

      await navigateToFolder(currentPath);
      setNotification({ type: 'success', message: 'Carpeta creada correctamente' });
    } catch (error) {
      setNotification({ type: 'error', message: error instanceof Error ? error.message : 'Error al crear carpeta' });
    }
  }, [currentPath, navigateToFolder]);

  const handleCreateExplorerFolder = useCallback(() => {
    setExplorerDialogMode('create-folder');
    setExplorerDialogValue('');
    setExplorerDialogItem(null);
  }, []);

  const executeCreateExplorerFile = useCallback(async (fileName: string) => {
    try {
      const response = await fetch('http://localhost:8742/api/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: fileName.trim(), path: currentPath || '', content: '' })
      });

      const result = await response.json();
      if (!response.ok || !result?.success) {
        throw new Error(result?.error || 'No se pudo crear el archivo');
      }

      await navigateToFolder(currentPath);
      setNotification({ type: 'success', message: 'Archivo creado correctamente' });
    } catch (error) {
      setNotification({ type: 'error', message: error instanceof Error ? error.message : 'Error al crear archivo' });
    }
  }, [currentPath, navigateToFolder]);

  const handleCreateExplorerFile = useCallback(() => {
    setExplorerDialogMode('create-file');
    setExplorerDialogValue('');
    setExplorerDialogItem(null);
  }, []);

  const executeRenameExplorerItem = useCallback(async (item: FileSystemItem, newName: string) => {
    const { name, parentPath } = splitExplorerItemPath(item.path);

    try {
      if (item.type === 'folder') {
        const response = await fetch(`http://localhost:8742/api/folders/${encodeURIComponent(name)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newName: newName.trim(), path: parentPath })
        });

        const result = await response.json();
        if (!response.ok || !result?.success) {
          throw new Error(result?.error || 'No se pudo renombrar la carpeta');
        }
      } else {
        const response = await fetch(`http://localhost:8742/api/files/${encodeURIComponent(name)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newName: newName.trim(), path: parentPath })
        });

        const result = await response.json();
        if (!response.ok || !result?.success) {
          throw new Error(result?.error || 'No se pudo renombrar el archivo');
        }
      }

      await navigateToFolder(currentPath);
      setNotification({ type: 'success', message: `${item.type === 'folder' ? 'Carpeta' : 'Archivo'} renombrado` });
    } catch (error) {
      setNotification({ type: 'error', message: error instanceof Error ? error.message : 'Error al renombrar' });
    }
  }, [currentPath, navigateToFolder, splitExplorerItemPath]);

  const handleRenameExplorerItem = useCallback((item: FileSystemItem) => {
    setExplorerDialogMode('rename-item');
    setExplorerDialogItem(item);
    setExplorerDialogValue(item.name);
  }, []);

  const executeDeleteExplorerItem = useCallback(async (item: FileSystemItem) => {
    try {
      // En Electron, usar IPC nativo para evitar crash del servidor Next.js empaquetado
      if (typeof window !== 'undefined' && (window as any).electronAPI?.fileExplorer?.deleteFile) {
        const result = await (window as any).electronAPI.fileExplorer.deleteFile(item.path);
        if (!result?.success) {
          throw new Error(result?.error || (item.type === 'folder' ? 'No se pudo borrar la carpeta' : 'No se pudo borrar el archivo'));
        }
        await navigateToFolder(currentPath);
        setNotification({ type: 'success', message: `${item.type === 'folder' ? 'Carpeta' : 'Archivo'} eliminado` });
        return;
      }

      // Fallback para modo web
      const { name, parentPath } = splitExplorerItemPath(item.path);
      if (item.type === 'folder') {
        const response = await fetch(`http://localhost:8742/api/folders/${encodeURIComponent(name)}?path=${encodeURIComponent(parentPath)}`, {
          method: 'DELETE'
        });

        const result = await response.json();
        if (!response.ok || !result?.success) {
          throw new Error(result?.error || 'No se pudo borrar la carpeta');
        }
      } else {
        const response = await fetch(`http://localhost:8742/api/files/${encodeURIComponent(name)}?path=${encodeURIComponent(parentPath)}`, {
          method: 'DELETE'
        });

        const result = await response.json();
        if (!response.ok || !result?.success) {
          throw new Error(result?.error || 'No se pudo borrar el archivo');
        }
      }

      await navigateToFolder(currentPath);
      setNotification({ type: 'success', message: `${item.type === 'folder' ? 'Carpeta' : 'Archivo'} eliminado` });
    } catch (error) {
      setNotification({ type: 'error', message: error instanceof Error ? error.message : 'Error al borrar' });
    }
  }, [currentPath, navigateToFolder, splitExplorerItemPath]);

  const handleDeleteExplorerItem = useCallback((item: FileSystemItem) => {
    setExplorerDialogMode('delete-item');
    setExplorerDialogItem(item);
    setExplorerDialogValue('');
  }, []);

  // Clipboard handlers for explorer
  const handleExplorerCopy = useCallback(async (item: FileSystemItem) => {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.fileExplorer) {
      try {
        await (window as any).electronAPI.fileExplorer.copyFile(item.path);
        setExplorerContextMenu({ visible: false, x: 0, y: 0, item: null, targetPath: null });
      } catch (error) {
        console.error('Error al copiar:', error);
      }
    }
  }, []);

  const handleExplorerCut = useCallback(async (item: FileSystemItem) => {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.fileExplorer) {
      try {
        await (window as any).electronAPI.fileExplorer.cutFile(item.path);
        setExplorerContextMenu({ visible: false, x: 0, y: 0, item: null, targetPath: null });
      } catch (error) {
        console.error('Error al cortar:', error);
      }
    }
  }, []);

  const handleExplorerPaste = useCallback(async (targetPath: string) => {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.fileExplorer) {
      try {
        console.log('Intentando pegar en:', targetPath);
        const result = await (window as any).electronAPI.fileExplorer.pasteFile(targetPath);
        console.log('Resultado de pegar:', result);
        if (result.success) {
          // Refresh the folder contents
          const loadFolder = async () => {
            try {
              console.log('Refrescando carpeta:', targetPath);
              const [foldersResponse, filesResponse] = await Promise.all([
                fetch(`http://localhost:8742/api/folders?path=${encodeURIComponent(targetPath)}`),
                fetch(`http://localhost:8742/api/files?path=${encodeURIComponent(targetPath)}`)
              ]);

              const foldersResult = await foldersResponse.json();
              const filesResult = await filesResponse.json();

              console.log('Carpetas:', foldersResult);
              console.log('Archivos:', filesResult);

              if (foldersResult.success || filesResult.success) {
                const combinedContents = [
                  ...(foldersResult.folders || []).map((folder: any) => ({
                    ...folder,
                    type: 'folder',
                    size: 0
                  })),
                  ...(filesResult.files || []).map((file: any) => ({
                    ...file,
                    type: 'file'
                  }))
                ];
                console.log('Contenido combinado:', combinedContents);
                setFolderContents(combinedContents);
              }
            } catch (error) {
              console.error('Failed to refresh folder:', error);
            }
          };
          await loadFolder();
          setExplorerContextMenu({ visible: false, x: 0, y: 0, item: null, targetPath: null });
        } else {
          console.error('Error al pegar:', result.error);
          alert(result.error || 'Error al pegar');
        }
      } catch (error) {
        console.error('Error al pegar:', error);
      }
    }
  }, []);

  const handleExplorerContextMenu = useCallback((e: React.MouseEvent, item: FileSystemItem | null = null) => {
    e.preventDefault();
    e.stopPropagation();
    const targetPath = item ? item.path : currentPath;
    console.log('handleExplorerContextMenu - item:', item, 'currentPath:', currentPath, 'targetPath:', targetPath);
    setExplorerContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      item,
      targetPath
    });
  }, [currentPath]);

  const closeExplorerContextMenu = useCallback(() => {
    setExplorerContextMenu({ visible: false, x: 0, y: 0, item: null, targetPath: null });
  }, []);

  const closeExplorerDialog = useCallback(() => {
    setExplorerDialogMode(null);
    setExplorerDialogItem(null);
    setExplorerDialogValue('');
  }, []);

  const submitExplorerDialog = useCallback(async () => {
    if (explorerDialogMode === 'create-folder') {
      if (!explorerDialogValue.trim()) return;
      await executeCreateExplorerFolder(explorerDialogValue);
      closeExplorerDialog();
      return;
    }

    if (explorerDialogMode === 'create-file') {
      if (!explorerDialogValue.trim()) return;
      await executeCreateExplorerFile(explorerDialogValue);
      closeExplorerDialog();
      return;
    }

    if (explorerDialogMode === 'rename-item' && explorerDialogItem) {
      const trimmedName = explorerDialogValue.trim();
      if (!trimmedName || trimmedName === explorerDialogItem.name) return;
      await executeRenameExplorerItem(explorerDialogItem, trimmedName);
      closeExplorerDialog();
      return;
    }

    if (explorerDialogMode === 'delete-item' && explorerDialogItem) {
      await executeDeleteExplorerItem(explorerDialogItem);
      closeExplorerDialog();
    }
  }, [
    closeExplorerDialog,
    executeCreateExplorerFile,
    executeCreateExplorerFolder,
    executeDeleteExplorerItem,
    executeRenameExplorerItem,
    explorerDialogItem,
    explorerDialogMode,
    explorerDialogValue
  ]);

  // Get dropdown options for specific fields
  const getDropdownOptions = (paramName: string) => {
    switch (paramName) {
      case 'type':
        return [
          { value: 'file', label: t('typeFile') },
          { value: 'folder', label: t('typeFolder') },
          { value: 'line', label: t('typeLine') },
          { value: 'character', label: t('typeCharacter') }
        ];
      case 'operation':
        return [
          { value: 'create', label: t('opCreate') },
          { value: 'update', label: t('opUpdate') },
          { value: 'delete', label: t('opDelete') }
        ];
      case 'planName':
        return plans.map(plan => ({
          value: plan.name,
          label: `${plan.name}`
        }));
      case 'fileName':
        return plans.map(plan => ({
          value: `${plan.id}.json`,
          label: `${plan.name} (${plan.id}.json)`
        }));
      default:
        return [];
    }
  };

  // Translate parameter labels and descriptions
  const translateParamLabel = (name: string): string => {
    const map: Record<string, string> = {
      name: t('paramName'),
      path: t('paramPath'),
      content: t('paramContent'),
      newName: t('paramNewName'),
      extension: t('paramExtension'),
      type: t('paramFileType'),
      lineNumber: t('paramLineNumber'),
      startLine: t('paramStartLine'),
      endLine: t('paramEndLine'),
      startCharIndex: t('paramStartCharIndex'),
      endCharIndex: t('paramEndCharIndex'),
      numLines: t('paramNumLines'),
      position: t('paramPosition'),
      planName: t('paramPlanName'),
      taskName: t('paramTaskName'),
      description: t('paramPlanDescription'),
      operation: t('paramOperation'),
      saveToPlan: t('paramSaveToPlan'),
    };
    return map[name] || name;
  };

  const translateParamDescription = (name: string, desc: string): string => {
    const map: Record<string, string> = {
      name: t('paramName'),
      path: t('paramPath'),
      content: t('paramContent'),
      newName: t('paramNewName'),
      extension: t('paramExtension'),
      type: t('paramFileType'),
      lineNumber: t('paramLineNumber'),
      startLine: t('paramStartLine'),
      endLine: t('paramEndLine'),
      startCharIndex: t('paramStartCharIndex'),
      endCharIndex: t('paramEndCharIndex'),
      numLines: t('paramNumLines'),
      position: t('paramPosition'),
      planName: t('paramPlanName'),
      taskName: t('paramTaskName'),
      description: t('paramPlanDescription'),
      operation: t('paramOperation'),
      saveToPlan: t('paramSaveToPlan'),
    };
    return map[name] || desc;
  };

  // Check if a parameter should be rendered as dropdown
  const shouldRenderAsDropdown = (param: ApiParameter) => {
    return ['type', 'operation', 'planName', 'fileName'].includes(param.name);
  };

  // Fetch file system
  const { data: fileSystemData, isLoading: isLoadingFiles } = useQuery({
    queryKey: ['fileSystem', activeAppTab],
    queryFn: async () => {
      const response = await fetch('http://localhost:8742/api/data');
      if (!response.ok) throw new Error('Failed to fetch file system');
      return response.json();
    }
  });

  // Fetch plans for Task Plan Manager
  const { data: plansData } = useQuery({
    queryKey: ['plans', activeAppTab],
    queryFn: async () => {
      const response = await fetch('http://localhost:8742/api/plan');
      if (!response.ok) throw new Error('Failed to fetch plans');
      return response.json();
    }
  });

  // Escuchar eventos de actualización de planes
  useEffect(() => {
    const handleRefreshPlans = () => {
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      fetchPlans(); // También actualizar la lista del dropdown
    };

    window.addEventListener('refreshPlans', handleRefreshPlans);
    return () => window.removeEventListener('refreshPlans', handleRefreshPlans);
  }, [queryClient]);

  // Resetear explorador cuando cambia DATA_PATH
  useEffect(() => {
    const handleResetExplorer = () => {
      setCurrentPath('');
      setNavigationHistory([]);
      setFolderContents([]);
    };
    window.addEventListener('resetExplorerPath', handleResetExplorer);
    return () => window.removeEventListener('resetExplorerPath', handleResetExplorer);
  }, []);

  // Fetch tasks
  const { data: tasksData } = useQuery({
    queryKey: ['tasks', activeAppTab],
    queryFn: async () => {
      const response = await fetch('http://localhost:8742/api/plan/tasks');
      if (!response.ok) throw new Error('Failed to fetch tasks');
      return response.json();
    }
  });

  // Effects
  useEffect(() => {
    if (fileSystemData && fileSystemData.items) {
      updateCurrentTab({ fileSystem: fileSystemData.items });
    }
  }, [fileSystemData, activeAppTab]);

  useEffect(() => {
    if (tasksData) {
      updateCurrentTab({ tasks: tasksData });
    }
  }, [tasksData, activeAppTab]);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  // Handlers
  const handleEndpointSelect = useCallback((endpoint: ApiEndpoint) => {
    setSelectedEndpoint(endpoint);
    reset();
    setSelectedFiles({});
    setActiveTab('editor');
  }, [reset, setSelectedEndpoint, setActiveTab]);

  const handleExecuteRequest = useCallback(async (data: EndpointTestFormData) => {
    if (!selectedEndpoint) return;

    try {
      let url = selectedEndpoint.path;
      if (data.name && url.includes(':name')) {
        url = url.replace(':name', encodeURIComponent(data.name));
      }
      if (data.id && url.includes(':id')) {
        url = url.replace(':id', encodeURIComponent(data.id));
      }
      if (data.lineNumber && url.includes(':lineNumber')) {
        url = url.replace(':lineNumber', data.lineNumber.toString());
      }

      if (selectedEndpoint.method === 'GET' || selectedEndpoint.method === 'DELETE') {
        const queryParams = new URLSearchParams();
        if (data.path && !url.includes(':path')) queryParams.append('path', data.path);
        if (data.startLine && !url.includes(':startLine')) queryParams.append('startLine', data.startLine.toString());
        if (data.endLine && !url.includes(':endLine')) queryParams.append('endLine', data.endLine.toString());

        if (saveToPlan) {
          if (data.planName) queryParams.append('planName', data.planName);
          queryParams.append('saveToPlan', 'true');
        }

        const queryString = queryParams.toString();
        if (queryString) url += (url.includes('?') ? '&' : '?') + queryString;
      }

      const hasFileParam = selectedEndpoint.parameters.some(p => p.type === 'file');
      let bodyData: BodyInit | undefined = undefined;
      let requestHeaders: HeadersInit | undefined = undefined;

      if (selectedEndpoint.method !== 'GET' && selectedEndpoint.method !== 'DELETE') {
        if (hasFileParam) {
          const form = new FormData();
          Object.entries(data).forEach(([key, value]) => {
            if (value !== undefined && value !== '') {
              form.append(key, value?.toString() || '');
            }
          });
          selectedEndpoint.parameters.forEach(p => {
            if (p.type === 'file' && selectedFiles[p.name]) {
              form.append(p.name, selectedFiles[p.name]!);
            }
          });
          if (saveToPlan) {
            form.append('saveToPlan', 'true');
            if (data.planName) form.append('planName', data.planName);
          }
          bodyData = form;
        } else {
          bodyData = new URLSearchParams(
            Object.fromEntries(
              Object.entries({
                ...Object.fromEntries(
                  Object.entries(data).map(([key, value]) => [key, value?.toString() || ''])
                ),
                ...(saveToPlan && {
                  saveToPlan: 'true',
                  ...(data.planName && { planName: data.planName })
                })
              }).filter(([_, value]) => value !== undefined && value !== '')
            )
          ).toString();
          requestHeaders = { 'Content-Type': 'application/x-www-form-urlencoded' };
        }
      }

      const response = await fetch(url, {
        method: selectedEndpoint.method,
        ...(requestHeaders ? { headers: requestHeaders } : {}),
        body: bodyData,
      });

      const result = await response.json();
      setApiResponse(result);

      setNotification({
        type: response.ok ? 'success' : 'error',
        message: response.ok ? t('requestExecutedSuccessfully') : t('requestFailed')
      });
    } catch (error) {
      setNotification({ type: 'error', message: t('networkErrorOccurred') });
    }
  }, [selectedEndpoint, saveToPlan, selectedFiles]);

  const handleUndo = useCallback(async () => {
    if (!selectedEndpoint || !apiResponse) return;
    const fileName = apiResponse.file || (selectedEndpoint.path.match(/\/files\/:(\w+)/)?.[1]);
    if (!fileName) return;
    try {
      const response = await fetch(`http://localhost:8742/api/files/${fileName}/undo`, { method: 'POST' });
      const result = await response.json();
      if (response.ok) setApiResponse(result);
    } catch (error) { }
  }, [selectedEndpoint, apiResponse]);

  // Handle plan deletion
  const handleDeletePlan = useCallback(async (planId: string, planName: string) => {
    if (!confirm(`Are you sure you want to delete the plan "${planName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      const response = await fetch(`http://localhost:8742/api/plan/${planName}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        setNotification({ type: 'success', message: `Plan "${planName}" deleted successfully` });
        // Refetch plans to update the list
        queryClient.invalidateQueries({ queryKey: ['plans'] });
      } else {
        const error = await response.json();
        setNotification({ type: 'error', message: error.error || 'Failed to delete plan' });
      }
    } catch (error) {
      setNotification({ type: 'error', message: 'Failed to delete plan' });
    }
  }, [queryClient, setNotification]);

  // Handle plan editing
  const handleEditPlan = useCallback((plan: any) => {
    // For now, just show a notification. In a real implementation, 
    // this would open an edit modal or navigate to an edit page
    setNotification({ type: 'success', message: `Edit functionality for plan "${plan.name}" - Coming soon!` });
  }, [setNotification]);

  const isTaskAlreadyExecuted = useCallback((status?: string) => {
    return ['completed', 'failed', 'done'].includes(String(status || '').toLowerCase());
  }, []);

  const getTaskExecutionKey = useCallback((planId: string, task: any, taskIndex: number) => {
    const taskIdentifier = typeof task === 'object' ? (task?.id || task?.name || taskIndex) : taskIndex;
    return `${planId}:${String(taskIdentifier)}`;
  }, []);

  const handleExecutePlanRun = useCallback(async (plan: any) => {
    const planId = String(plan?.id || plan?.name || 'unknown-plan');
    const planTasks = Array.isArray(plan?.tasks) ? plan.tasks : [];
    const hasExecutedTasks = planTasks.some((task: any) => isTaskAlreadyExecuted(task?.status));
    const shouldReexecute = Boolean(executedPlanIds[planId] || hasExecutedTasks);

    setExecutingPlanIds((prev) => ({ ...prev, [planId]: true }));
    try {
      const body = new URLSearchParams();
      body.append('planName', plan.name);
      if (shouldReexecute) body.append('force', 'true');

      const response = await fetch('http://localhost:8742/api/plan/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      const result = await response.json();
      if (!response.ok) {
        setNotification({ type: 'error', message: result?.error || 'No se pudo ejecutar el plan' });
        return;
      }

      setExecutedPlanIds((prev) => ({ ...prev, [planId]: true }));
      setNotification({ type: 'success', message: result?.message || (shouldReexecute ? 'Plan reejecutado' : 'Plan ejecutado') });
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      fetchPlans();
    } catch {
      setNotification({ type: 'error', message: 'Error de red al ejecutar el plan' });
    } finally {
      setExecutingPlanIds((prev) => ({ ...prev, [planId]: false }));
    }
  }, [executedPlanIds, fetchPlans, isTaskAlreadyExecuted, queryClient]);

  const handleExecuteSingleTaskRun = useCallback(async (plan: any, task: any, taskIndex: number) => {
    const planId = String(plan?.id || plan?.name || 'unknown-plan');
    const taskKey = getTaskExecutionKey(planId, task, taskIndex);
    const taskStatus = typeof task === 'object' ? task?.status : undefined;
    const shouldReexecute = Boolean(executedTaskKeys[taskKey] || isTaskAlreadyExecuted(taskStatus));
    const taskId = typeof task === 'object' ? task?.id : undefined;
    const taskName = typeof task === 'object' ? task?.name : String(task || `Task ${taskIndex + 1}`);

    if (!taskId && !taskName) {
      setNotification({ type: 'error', message: 'No se pudo identificar la tarea a ejecutar' });
      return;
    }

    setExecutingTaskKeys((prev) => ({ ...prev, [taskKey]: true }));
    try {
      const body = new URLSearchParams();
      body.append('planName', plan.name);
      if (taskId) body.append('taskId', taskId);
      else body.append('taskName', taskName);
      if (shouldReexecute) body.append('force', 'true');

      const response = await fetch('http://localhost:8742/api/plan/tasks/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      const result = await response.json();
      if (!response.ok) {
        setNotification({ type: 'error', message: result?.error || 'No se pudo ejecutar la tarea' });
        return;
      }

      setExecutedTaskKeys((prev) => ({ ...prev, [taskKey]: true }));
      setExecutedPlanIds((prev) => ({ ...prev, [planId]: true }));
      setNotification({ type: 'success', message: result?.message || (shouldReexecute ? 'Tarea reejecutada' : 'Tarea ejecutada') });
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      fetchPlans();
    } catch {
      setNotification({ type: 'error', message: 'Error de red al ejecutar la tarea' });
    } finally {
      setExecutingTaskKeys((prev) => ({ ...prev, [taskKey]: false }));
    }
  }, [executedTaskKeys, fetchPlans, getTaskExecutionKey, isTaskAlreadyExecuted, queryClient]);

  return (
    <div className="fondo-zeus h-screen text-foreground/90 overflow-hidden flex flex-col">
      <style>{`
        .fondo-zeus {
          background-color: hsl(var(--background));
          background-image: radial-gradient(hsl(var(--foreground) / 0.33) 1px, transparent 1px);
          background-size: 24px 24px;
        }
        .custom-scrollbar::-webkit-scrollbar { width: 3px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.25); }
      `}</style>
      {/* Notification */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`fixed top-32 right-4 z-[9999] px-4 py-3 rounded-lg shadow-2xl border ${notification.type === 'success' ? 'bg-success/90 border-success' : 'bg-red-900/95 border-destructive'
              }`}
          >
            <div className="flex items-center gap-2">
              {notification.type === 'success' ? <CheckCircle className="w-5 h-5 text-success" /> : <XCircle className="w-5 h-5 text-destructive" />}
              <span>{notification.message}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {explorerDialogMode && (
        <div className="fixed inset-0 z-[10000]" onClick={(e) => { if (e.target === e.currentTarget) closeExplorerDialog(); }}>
          <div className="fixed inset-0 bg-background/60 backdrop-blur-sm" aria-hidden="true" />
          <div className="fixed inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-xl border border-border/50 bg-background p-5">
              <h3 className="text-sm font-semibold text-foreground mb-3">
                {explorerDialogMode === 'create-folder' && 'Crear carpeta'}
                {explorerDialogMode === 'create-file' && 'Crear archivo'}
                {explorerDialogMode === 'rename-item' && `Renombrar ${explorerDialogItem?.type === 'folder' ? 'carpeta' : 'archivo'}`}
                {explorerDialogMode === 'delete-item' && `Eliminar ${explorerDialogItem?.type === 'folder' ? 'carpeta' : 'archivo'}`}
              </h3>

              {(explorerDialogMode === 'create-folder' || explorerDialogMode === 'create-file' || explorerDialogMode === 'rename-item') && (
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground block">
                    {explorerDialogMode === 'create-folder'
                      ? 'Nombre de la carpeta'
                      : explorerDialogMode === 'rename-item'
                        ? 'Nuevo nombre'
                        : t('fileNameWithExtension')}
                  </label>
                  <input
                    value={explorerDialogValue}
                    onChange={(e) => setExplorerDialogValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void submitExplorerDialog();
                    }}
                    autoFocus
                    className="w-full rounded-lg bg-background border border-border/50 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
                  />
                </div>
              )}

              {explorerDialogMode === 'delete-item' && (
                <p className="text-sm text-foreground/80">
                  ¿Seguro que quieres borrar {explorerDialogItem?.type === 'folder' ? 'la carpeta' : 'el archivo'}{' '}
                  <span className="font-semibold text-foreground">{explorerDialogItem?.name}</span>?
                </p>
              )}

              <div className="mt-5 flex justify-end gap-2">
                <button
                  onClick={closeExplorerDialog}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-border/50 text-foreground/80 hover:bg-card"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => void submitExplorerDialog()}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary hover:bg-primary/80 text-foreground"
                >
                  {explorerDialogMode === 'delete-item' ? 'Eliminar' : explorerDialogMode === 'rename-item' ? 'Renombrar' : 'Guardar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Header Integrated */}
      <header className="bg-background/50 backdrop-blur-md border-b border-border/80 sticky top-0 z-50 electron-drag">
        <div className="w-full px-4 sm:px-6 lg:px-8">
          <div className="flex items-center h-16">
            {/* Logo Section */}
            <div className="flex items-center gap-4">
              <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 rounded-lg hover:bg-card transition-colors electron-no-drag">
                <Menu className="w-5 h-5 text-muted-foreground" />
              </button>
              <div className="flex items-center gap-3">
                <Image
                  src="/LOGO_ZEUS.png"
                  alt="Logo Zeus"
                  width={32}
                  height={32}
                  className="h-8 w-8 object-contain"
                />
                <h1 className="text-xl font-semibold bg-gradient-to-r from-blue-400 to-zeus-orange bg-clip-text text-transparent">
                  Zeus IA
                </h1>
              </div>
            </div>

            {/* Selectors and Actions Section */}
            <div className="hidden lg:flex flex-1 items-center justify-center gap-4 px-6">
              {/* AI Model Selector */}
              <div className="relative electron-no-drag">
                <button
                  onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-transparent hover:bg-card text-foreground/80 hover:text-foreground border border-border/50 transition-all"
                >
                  <Cpu className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium max-w-[120px] truncate">
                    {selectedModel ? selectedModel[MODELOS_FIELDS.NAME] : 'Select Model'}
                  </span>
                  <ChevronDown className="w-4 h-4 text-muted-foreground/80" />
                </button>

                <AnimatePresence>
                  {isModelDropdownOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="absolute right-0 mt-2 w-64 rounded-xl bg-background border border-border/80 shadow-2xl z-50 p-2"
                    >
                      <div className="px-3 py-2 text-xs font-semibold text-muted-foreground/80 uppercase tracking-wider border-b border-border/80 mb-2">
                        Available AI Models
                      </div>
                      <div className="max-h-40 overflow-y-auto custom-scrollbar">
                        {isLoadingModels ? (
                          <div className="flex justify-center p-4"><RefreshCw className="w-5 h-5 animate-spin text-primary" /></div>
                        ) : models.map(model => (
                          <button
                            key={model.id}
                            onClick={() => { setSelectedModel(model); setIsModelDropdownOpen(false); }}
                            className={cn(
                              "w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors mb-1",
                              selectedModel?.id === model.id ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-card hover:text-foreground"
                            )}
                          >
                            <div className="flex flex-col items-start text-left">
                              <span className="font-medium">{model[MODELOS_FIELDS.NAME]}</span>
                              <span className="text-[10px] text-muted-foreground/80 uppercase">{model[MODELOS_FIELDS.PROVIDER]}</span>
                            </div>
                            {selectedModel?.id === model.id && <Check className="w-4 h-4" />}
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Connection Status */}
              <button
                onClick={testConnection}
                className={cn(
                  "flex items-center gap-2 transition-all electron-no-drag",
                  connectionStatus === 'connected' ? "text-[#26aa08]" :
                    connectionStatus === 'testing' ? "text-amber-400 animate-pulse" :
                      "text-destructive"
                )}
              >
                {connectionStatus === 'connected' ? <SignalHigh className="w-4 h-4" /> : <Signal className="w-4 h-4" />}
                <span className="text-sm font-medium capitalize">{t(connectionStatus)}</span>
              </button>

              <div className="h-6 w-px bg-card mx-2" />

              {/* Language Selector */}
              <div className="relative electron-no-drag">
                <button
                  onClick={() => setIsLangDropdownOpen(!isLangDropdownOpen)}
                  className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-transparent hover:bg-card text-foreground/80 hover:text-foreground border border-border/50 transition-all text-xs font-bold uppercase"
                >
                  <Globe className="w-4 h-4 text-primary" />
                  {language === 'es' ? 'ES' : language === 'fr' ? 'FR' : language === 'de' ? 'DE' : 'EN'}
                  <ChevronDown className="w-3 h-3 text-muted-foreground/80" />
                </button>

                <AnimatePresence>
                  {isLangDropdownOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="absolute right-0 mt-2 w-32 rounded-xl bg-background border border-border/80 shadow-2xl z-50 p-2"
                    >
                      {(['es', 'en', 'fr', 'de'] as const).map((lang) => (
                        <button
                          key={lang}
                          onClick={() => { setLanguage(lang); setIsLangDropdownOpen(false); }}
                          className={cn(
                            "w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors mb-1",
                            language === lang ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-card hover:text-foreground"
                          )}
                        >
                          <span className="font-medium uppercase">{lang === 'es' ? 'Español' : lang === 'en' ? 'English' : lang === 'fr' ? 'Français' : 'Deutsch'}</span>
                          {language === lang && <Check className="w-4 h-4" />}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <button onClick={() => setIsModelModalOpen(true)} className="p-2 rounded-lg hover:bg-card transition-colors text-muted-foreground electron-no-drag">
                <Settings className="w-5 h-5" />
              </button>

              <button onClick={() => setIsThemeEditorOpen(true)} className="p-2 rounded-lg hover:bg-card transition-colors text-muted-foreground electron-no-drag" title="Editor de temas">
                <Palette className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-3 pl-2 border-l border-border/80">
                <div className="flex flex-col items-end">
                  <span className="text-xs font-bold uppercase tracking-tighter">Api - Generator</span>
                  <span className="text-[11px] text-muted-foreground/80">v2.0.4</span>
                </div>
                <div className="h-8 w-8 rounded-full bg-gradient-to-br bg-success/20 flex items-center justify-center border border-white/14 shadow-lg">
                  <span className="text-foreground text-xl font-bold font-mono">ZEUS</span>
                </div>
                <div className="ml-3" title="GitHub">
                  <img src="/iconos/GitHub.gif" alt="GitHub" className="w-7 h-7" />
                </div>
              </div>

            </div>

            <div className="hidden lg:flex items-center pl-2 border-l border-border/80 electron-no-drag pr-[240px]">
              <UserInfo />
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="flex items-center gap-1 border-t border-border/80 px-4 py-2 electron-no-drag">
            {appTabs.map((tab) => (
              <div
                key={tab.id}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg cursor-pointer transition-colors ${tab.id === activeAppTab ? 'bg-primary/10 text-primary hover:bg-primary/20 border border-blue-400' : 'bg-card text-muted-foreground hover:bg-muted'
                  }`}
                onClick={() => setActiveAppTab(tab.id)}
              >
                <span className="text-sm font-medium">{tab.name}</span>
                {appTabs.length > 1 && (
                  <button onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }} className="w-4 h-4 rounded hover:bg-destructive flex items-center justify-center transition-colors border-0">
                    <XCircle className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
            <button onClick={createNewTab} className="px-2 py-1.5 bg-primary/10 hover:bg-primary/20 rounded-lg border border-blue-400 text-primary hover:text-primary transition-colors">
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="w-full mx-auto pb-0 flex-1 min-h-0">
        <div className="flex gap-0 h-full">
          {/* Sidebar */}
          <AnimatePresence>
            {isSidebarOpen && (
              <motion.aside
                initial={{ x: -300, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -300, opacity: 0 }}
                className="w-64 flex-shrink-0 bg-muted rounded-none border border-border/80 p-4 h-full overflow-y-auto custom-scrollbar"
              >
                <div className="relative mb-6">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder={t('searchEndpoints')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-muted/50 border border-border/50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                <div className="mb-4">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="w-full flex items-center justify-between px-3 py-2 bg-muted/50 border border-border/50 rounded-lg text-sm text-foreground/90 hover:bg-muted transition-colors">
                        <span className="flex items-center gap-2">
                          <Server className="w-4 h-4 text-primary" />
                          {sidebarApiSource === 'zeus'
                            ? t('apisOfZeus')
                            : sidebarApiSource === 'project'
                              ? t('openProject')
                              : apiProjects.find(p => p.id === sidebarApiSource)?.title || t('selectApi')}
                        </span>
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-56 bg-background border border-border/50 text-foreground/90">
                      <DropdownMenuLabel className="text-muted-foreground">{t('endpointSources')}</DropdownMenuLabel>
                      <DropdownMenuSeparator className="bg-muted" />
                      <DropdownMenuItem
                        onSelect={() => setSidebarApiSource('zeus')}
                        className="cursor-pointer hover:bg-card focus:bg-card"
                      >
                        <Zap className="w-4 h-4 mr-2 text-warning" />
                        {t('apisOfZeus')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => setSidebarApiSource('project')}
                        className="cursor-pointer hover:bg-card focus:bg-card"
                      >
                        <FolderOpen className="w-4 h-4 mr-2 text-success" />
                        {t('openProject')}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator className="bg-muted" />
                      {apiProjectsLoading ? (
                        <DropdownMenuItem disabled className="text-muted-foreground/80">
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          {t('loadingAPIs')}
                        </DropdownMenuItem>
                      ) : apiProjects.length === 0 ? (
                        <DropdownMenuItem disabled className="text-muted-foreground/80">
                          {t('noSavedAPIs')}
                        </DropdownMenuItem>
                      ) : (
                        apiProjects.map((project) => (
                          <DropdownMenuItem
                            key={project.id}
                            onSelect={() => setSidebarApiSource(project.id)}
                            className="cursor-pointer hover:bg-card focus:bg-card"
                          >
                            <Database className="w-4 h-4 mr-2 text-accent" />
                            {project.title}
                          </DropdownMenuItem>
                        ))
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <nav className="space-y-2">
                  <h3 className="text-xs font-semibold text-muted-foreground/80 uppercase tracking-widest mb-3 px-2">
                    {t('apiEndpoints')}
                  </h3>

                  {isSidebarApiLoading ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="w-5 h-5 animate-spin text-primary" />
                      <span className="ml-2 text-sm text-muted-foreground">{t('loadingEndpoints')}</span>
                    </div>
                  ) : sidebarApiEndpoints.length > 0 ? (
                    sidebarApiEndpoints
                      .filter(endpoint =>
                        endpoint.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        endpoint.path.toLowerCase().includes(searchQuery.toLowerCase())
                      )
                      .map((endpoint) => (
                        <button
                          key={endpoint.id}
                          onClick={() => handleEndpointSelect(endpoint)}
                          className={`w-full text-left px-3 py-2 rounded-lg transition-all flex items-center gap-3 border ${selectedEndpoint?.id === endpoint.id ? 'bg-primary/20 border-blue-700/50 text-blue-100 shadow-inner' : 'border-transparent hover:bg-card/50 hover:border-border/50 text-muted-foreground hover:text-foreground/90'
                            }`}
                        >
                          <div className={`p-1.5 rounded flex items-center justify-center font-mono text-[10px] font-bold min-w-[20px] shadow-sm ${endpoint.method === 'GET' ? 'bg-[#22c55e]/25 text-[#22c55e] border border-[#22c55e]/50' :
                              endpoint.method === 'POST' ? 'bg-[#3b82f6]/25 text-[#3b82f6] border border-[#3b82f6]/50' :
                                endpoint.method === 'PUT' ? 'bg-[#eab308]/25 text-[#eab308] border border-[#eab308]/50' :
                                  endpoint.method === 'DELETE' ? 'bg-[#ef4444]/25 text-[#ef4444] border border-[#ef4444]/50' :
                                    'bg-[#a855f7]/25 text-[#a855f7] border border-[#a855f7]/50'
                            }`}>
                            {endpoint.method.substring(0, 1)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-xs truncate">{sidebarApiSource === 'zeus' ? t((endpointNameKeys[endpoint.id] || endpoint.name) as any) : endpoint.name}</div>
                            <div className="text-[10px] text-muted-foreground/80 truncate">{sidebarApiSource === 'zeus' ? t((endpointDescKeys[endpoint.id] || endpoint.description) as any) : endpoint.path}</div>
                          </div>
                        </button>
                      ))
                  ) : (
                    <div className="px-2 py-4 text-sm text-muted-foreground/80 text-center">
                      {sidebarApiSource === 'zeus'
                        ? t('systemEndpointsNotFound')
                        : sidebarApiSource === 'project'
                          ? (effectiveProjectRoot ? t('noApiFoundInOpenProject') : t('noOpenProject'))
                          : t('noEndpointsInThisApi')}
                    </div>
                  )}
                </nav>

                <div className="mt-8 pt-6 border-t border-border/80">
                  <h3 className="text-xs font-semibold text-muted-foreground/80 uppercase tracking-widest mb-3 px-2">
                    {t('recentFiles')}
                  </h3>
                  {isLoadingFiles ? (
                    <div className="space-y-2 px-2 animate-pulse">
                      <div className="h-4 bg-card rounded w-3/4" />
                      <div className="h-4 bg-card rounded w-1/2" />
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {Array.isArray(fileSystem) ? fileSystem.slice(0, 8).map((item) => (
                        <button key={item.path} className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-card/30 text-xs text-muted-foreground hover:text-foreground/90 transition-colors">
                          {item.type === 'folder' ? <Folder className="w-3 h-3 text-primary/70" /> : <File className="w-3 h-3 text-muted-foreground/80" />}
                          <span className="truncate">{item.name}</span>
                        </button>
                      )) : null}
                    </div>
                  )}
                </div>
              </motion.aside>
            )}
          </AnimatePresence>

          {/* Main Content Area - Takes remaining space */}
          <div className="flex-1 flex flex-col min-w-0 h-full w-full">
            {/* Dynamic Content */}
            <div className="flex-1 overflow-hidden w-full">
              <AuthProvider>
                <ProjectProvider activeTabId={activeAppTab} projectRoot={tabProjectRoot} projectId={tabProjectId} onSetProjectRoot={setTabProjectRoot} onSetProjectId={setTabProjectId}>
                  <TerminalProvider activeTabId={activeAppTab}>
                    <EditorProvider activeTabId={activeAppTab}>
                      <div className="flex h-full gap-0">
                        <div className="flex-1 h-full min-w-0 flex flex-col overflow-hidden">
                          {/* Main Tabs */}
                          <div className="relative flex border-b border-border/80 bg-card">
                            {/* Flecha izquierda */}
                            {canScrollLeft && (
                              <button
                                onClick={() => scrollTabs('left')}
                                className="absolute left-0 top-0 bottom-0 z-10 px-4 bg-gradient-to-r from-card via-card/95 to-transparent hover:from-card hover:via-card hover:to-card/90 transition-colors"
                              >
                                <ChevronLeft className="w-4 h-4 text-muted-foreground" />
                              </button>
                            )}

                            <div
                              ref={tabsScrollRef}
                              className="flex overflow-x-auto overflow-y-hidden scrollbar-hide pl-4 pr-4"
                              onWheel={(e) => {
                                if (e.deltaY !== 0) {
                                  e.currentTarget.scrollLeft += e.deltaY;
                                }
                              }}
                            >
                              {[
                                { id: 'explorer', image: '/iconos/Explorer.png', label: t('tabExplorer'), Icon: FolderOpen },
                                { id: 'ide', image: '/iconos/IDE.png', label: t('tabIDE'), Icon: Code },
                                { id: 'editor', image: '/iconos/API_Tester.png', label: t('tabApiTester'), Icon: Zap },
                                { id: 'tasks', image: '/iconos/APP_Generator.png', label: t('tabAppGenerator'), Icon: Rocket },
                                { id: 'structure', image: '/iconos/S_Creator.png', label: t('tabStructureCreator'), Icon: Layers2 },
                                { id: 'structure-plan', image: '/iconos/S_Plan.png', label: t('tabStructurePlan'), Icon: ClipboardLucide },
                                { id: 'api-generator', image: '/iconos/API.png', label: t('tabApiGenerator'), Icon: Server },
                                { id: 'preview', image: '/iconos/Preview.png', label: t('tabPreview'), Icon: Eye },
                                { id: 'componentes', image: '/iconos/Componentes.png', label: t('tabComponents'), Icon: Wand2 },
                                { id: 'library', image: '/iconos/Brain.png', label: t('tabLibrary'), Icon: Sparkles }
                              ].map(tab => (
                                <button
                                  key={tab.id}
                                  onClick={() => setActiveTab(tab.id)}
                                  className={`flex items-center gap-2 px-6 py-3 font-medium text-sm transition-all relative flex-shrink-0 ${activeMainTab === tab.id ? 'text-foreground bg-card/50' : 'text-muted-foreground/80 hover:text-foreground/80 hover:bg-card/30'
                                    }`}
                                >
                                  <span className="w-5 h-5 flex items-center justify-center">
                                    {useLucideIcons ? (
                                      <tab.Icon className="w-5 h-5" style={{ color: 'hsl(var(--tab-icon))' }} />
                                    ) : (
                                      <img src={tab.image} alt={tab.label} className="max-w-full max-h-full object-contain" />
                                    )}
                                  </span>
                                  {tab.label}
                                  {activeMainTab === tab.id && <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-success" />}
                                </button>
                              ))}
                            </div>

                            {/* Flecha derecha */}
                            {canScrollRight && (
                              <button
                                onClick={() => scrollTabs('right')}
                                className="absolute right-0 top-0 bottom-0 z-10 px-4 bg-gradient-to-l from-card via-card/95 to-transparent hover:from-card hover:via-card hover:to-card/90 transition-colors"
                              >
                                <ChevronRight className="w-4 h-4 text-muted-foreground" />
                              </button>
                            )}
                          </div>

                          <div className="flex-1 overflow-hidden">
                            <AnimatePresence mode="wait">
                            <motion.div
                              key="main-tab-content"
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -10 }}
                              transition={{ duration: 0.2 }}
                              className="h-full w-full overflow-hidden"
                            >
                              {activeMainTab === 'ide' && (
                                <div className="h-full">
                                  <IDETab onOpenPreview={() => setActiveTab('preview')} onOpenGitHubModal={() => setIsGitHubModalOpen(true)} />
                                </div>
                              )}

                              {activeMainTab === 'explorer' && (
                                <div className="h-full w-full min-h-0">
                                  {/* ... resto del contenido de explorer ... */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 h-full w-full min-h-0">
                      {/* Project Explorer */}
                      <div
                        className="bg-transparent rounded-none border border-border/80 p-4 shadow-sm h-full flex flex-col min-w-0 min-h-0"
                        onClick={closeExplorerContextMenu}
                        onContextMenu={(e) => handleExplorerContextMenu(e, null)}
                      >
                        <div className="flex items-center justify-between mb-6">
                          <h2 className="text-lg font-semibold flex items-center gap-2 text-blue-100">
                            <Folder className="w-5 h-5 text-primary" />
                            {t('projectExplorer')}
                          </h2>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={handleCreateExplorerFile}
                              className="px-2.5 py-1.5 rounded-lg bg-success/15 hover:bg-success/25 border border-success/30 transition-colors text-success text-xs font-semibold"
                              title={t('createFile')}
                            >
                              {t('file')}
                            </button>
                            <button
                              onClick={handleCreateExplorerFolder}
                              className="px-2.5 py-1.5 rounded-lg bg-primary/15 hover:bg-primary/25 border border-blue-500/30 transition-colors text-primary-foreground text-xs font-semibold"
                              title={t('createFolder')}
                            >
                              {t('folder')}
                            </button>
                            {navigationHistory.length > 0 && (
                              <button
                                onClick={navigateBack}
                                className="p-2 rounded-lg hover:bg-card transition-colors text-muted-foreground hover:text-foreground"
                                title={t('goBack')}
                              >
                                <ArrowLeft className="w-4 h-4" />
                              </button>
                            )}
                            {currentPath && (
                              <button
                                onClick={navigateToParent}
                                className="p-2 rounded-lg hover:bg-card transition-colors text-muted-foreground hover:text-foreground"
                                title={t('goToParent')}
                              >
                                <ArrowUp className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setCurrentPath('');
                                setNavigationHistory([]);
                                // Load root folder contents
                                const loadRootFolder = async () => {
                                  try {
                                    const [foldersResponse, filesResponse] = await Promise.all([
                                      fetch(`http://localhost:8742/api/folders?path=`),
                                      fetch(`http://localhost:8742/api/files?path=`)
                                    ]);

                                    const foldersResult = await foldersResponse.json();
                                    const filesResult = await filesResponse.json();

                                    if (foldersResult.success || filesResult.success) {
                                      const combinedContents = [
                                        ...(foldersResult.folders || []).map((folder: any) => ({
                                          ...folder,
                                          type: 'folder',
                                          size: 0
                                        })),
                                        ...(filesResult.files || []).map((file: any) => ({
                                          ...file,
                                          type: 'file'
                                        }))
                                      ];

                                      setFolderContents(combinedContents);
                                    }
                                  } catch (error) {
                                    console.error('Failed to load root folder:', error);
                                  }
                                };

                                loadRootFolder();
                              }}
                              className="p-2 rounded-lg hover:bg-card transition-colors text-muted-foreground hover:text-foreground"
                              title={t('goToRoot')}
                            >
                              <Home className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        {/* Current path breadcrumb */}
                        {currentPath && (
                          <div className="mb-4 p-2 bg-background rounded-lg border border-border/50/50">
                            <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
                              <span className="text-primary">Path:</span>
                              <span className="text-foreground/80">/{currentPath}</span>
                            </div>
                          </div>
                        )}

                        <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar">
                          {currentPath ? (
                            // Show folder contents when navigating
                            folderContents.length > 0 ? (
                              folderContents.map((item) => (
                                <div
                                  key={item.path}
                                  onClick={() => item.type === 'folder' && navigateToFolder(item.path)}
                                  onContextMenu={(e) => handleExplorerContextMenu(e, item as FileSystemItem)}
                                  className={cn(
                                    "flex items-center justify-between p-3 rounded-lg border transition-all group",
                                    item.type === 'folder'
                                      ? "bg-input hover:bg-card/80 border-border/40 hover:border-border/70 cursor-pointer"
                                      : "bg-input border-border/40 hover:border-border/70"
                                  )}
                                >
                                  <div className="flex items-center gap-3">
                                    {item.type === 'folder' ? (
                                      <Folder className="w-5 h-5 text-primary/80 group-hover:text-primary" />
                                    ) : (
                                      <File className="w-5 h-5 text-muted-foreground/80" />
                                    )}
                                    <div>
                                      <div className="font-medium text-sm text-foreground/90">{item.name}</div>
                                      <div className="text-[10px] text-muted-foreground/80 font-mono">{item.path}</div>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleRenameExplorerItem(item as FileSystemItem);
                                      }}
                                      className="p-1.5 rounded text-muted-foreground/80 hover:text-amber-300 hover:bg-card/80 opacity-0 group-hover:opacity-100 transition-all"
                                      title={t('rename')}
                                    >
                                      <Edit className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteExplorerItem(item as FileSystemItem);
                                      }}
                                      className="p-1.5 rounded text-muted-foreground/80 hover:text-rose-300 hover:bg-card/80 opacity-0 group-hover:opacity-100 transition-all"
                                      title={t('delete')}
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                    {item.type === 'folder' && (
                                      <ChevronRight className="w-4 h-4 text-muted-foreground/80 group-hover:text-foreground/80" />
                                    )}
                                    <span className="text-[10px] font-mono text-muted-foreground/60">{(item.size / 1024).toFixed(1)} KB</span>
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="text-center py-12 text-muted-foreground/60 text-sm italic">
                                No files found in workspace
                              </div>
                            )
                          ) : (
                            // Show root contents: priorizar listado dinámico (folders/files) como en IDE
                            (folderContents.length > 0 ? folderContents : (Array.isArray(fileSystem) ? fileSystem : [])).length > 0 ? (
                              (folderContents.length > 0 ? folderContents : (Array.isArray(fileSystem) ? fileSystem : [])).map((item) => (
                                <div
                                  key={item.path}
                                  onClick={() => item.type === 'folder' && navigateToFolder(item.path)}
                                  onContextMenu={(e) => handleExplorerContextMenu(e, item as FileSystemItem)}
                                  className={cn(
                                    "flex items-center justify-between p-3 rounded-lg border transition-all group",
                                    item.type === 'folder'
                                      ? "bg-input hover:bg-card/80 border-border/40 hover:border-border/70 cursor-pointer"
                                      : "bg-input border-border/40 hover:border-border/70"
                                  )}
                                >
                                  <div className="flex items-center gap-3">
                                    {item.type === 'folder' ? (
                                      <Folder className="w-5 h-5 text-primary/80 group-hover:text-primary" />
                                    ) : (
                                      <File className="w-5 h-5 text-muted-foreground/80" />
                                    )}
                                    <div>
                                      <div className="font-medium text-sm text-foreground/90">{item.name}</div>
                                      <div className="text-[10px] text-muted-foreground/80 font-mono">{item.path}</div>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleRenameExplorerItem(item as FileSystemItem);
                                      }}
                                      className="p-1.5 rounded text-muted-foreground/80 hover:text-amber-300 hover:bg-card/80 opacity-0 group-hover:opacity-100 transition-all"
                                      title={t('rename')}
                                    >
                                      <Edit className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteExplorerItem(item as FileSystemItem);
                                      }}
                                      className="p-1.5 rounded text-muted-foreground/80 hover:text-rose-300 hover:bg-card/80 opacity-0 group-hover:opacity-100 transition-all"
                                      title={t('delete')}
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                    {item.type === 'folder' && (
                                      <ChevronRight className="w-4 h-4 text-muted-foreground/80 group-hover:text-foreground/80" />
                                    )}
                                    <span className="text-[10px] font-mono text-muted-foreground/60">{(item.size / 1024).toFixed(1)} KB</span>
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="text-center py-12 text-muted-foreground/60 text-sm italic">
                                No files found in workspace
                              </div>
                            )
                          )}
                        </div>

                        {explorerContextMenu.visible && (
                          <div
                            className="fixed z-50 bg-card border border-border/50 rounded-lg shadow-xl py-1 min-w-[160px]"
                            style={{
                              left: `${explorerContextMenu.x}px`,
                              top: `${explorerContextMenu.y}px`
                            }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {explorerContextMenu.item ? (
                              <>
                                <button
                                  onClick={() => handleExplorerCut(explorerContextMenu.item!)}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground/80 hover:bg-muted hover:text-foreground transition-colors"
                                >
                                  <Scissors className="w-3.5 h-3.5" />
                                  Cortar
                                </button>
                                <button
                                  onClick={() => handleExplorerCopy(explorerContextMenu.item!)}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground/80 hover:bg-muted hover:text-foreground transition-colors"
                                >
                                  <Copy className="w-3.5 h-3.5" />
                                  Copiar
                                </button>
                                {explorerContextMenu.item.type === 'folder' && (
                                  <button
                                    onClick={() => handleExplorerPaste(explorerContextMenu.item!.path)}
                                    disabled={!hasClipboardContent}
                                    className={cn(
                                      "w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors",
                                      hasClipboardContent
                                        ? "text-foreground/80 hover:bg-muted hover:text-foreground"
                                        : "text-muted-foreground/60 cursor-not-allowed"
                                    )}
                                  >
                                    <ClipboardLucide className="w-3.5 h-3.5" />
                                    Pegar
                                  </button>
                                )}
                              </>
                            ) : (
                              // Menú para área vacía (pegar en carpeta actual)
                              <button
                                onClick={() => handleExplorerPaste(explorerContextMenu.targetPath || currentPath)}
                                disabled={!hasClipboardContent}
                                className={cn(
                                  "w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors",
                                  hasClipboardContent
                                    ? "text-foreground/80 hover:bg-muted hover:text-foreground"
                                    : "text-muted-foreground/60 cursor-not-allowed"
                                )}
                              >
                                <ClipboardLucide className="w-3.5 h-3.5" />
                                Pegar
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Active Plans */}
                      <div className="bg-transparent rounded-none border border-border/80 p-4 shadow-sm h-full flex flex-col min-w-0 min-h-0">
                        <div className="flex items-center justify-between mb-6">
                          <h2 className="text-lg font-semibold flex items-center gap-2 text-success">
                            <Calendar className="w-5 h-5 text-success" />
                            {t('activePlans')}
                          </h2>
                          <button
                            onClick={() => {
                              queryClient.invalidateQueries({ queryKey: ['plans'] });
                              fetchPlans();
                            }}
                            className="px-3 py-2 bg-success/20 hover:bg-success/30 border border-success/30 rounded-lg transition-all duration-200 group"
                            title={t('refreshPlans')}
                          >
                            <svg className="w-4 h-4 text-success group-hover:text-success transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                          </button>
                        </div>
                        <div className="flex-1 min-h-0 overflow-y-auto space-y-3 custom-scrollbar">
                          {plansData?.plans?.length > 0 ? (
                            plansData.plans.map((plan: any, planIndex: number) => {
                              const planUiKey = `${String(plan?.id || plan?.name || 'plan')}-${planIndex}`;
                              const planTasks = Array.isArray(plan.tasks) ? plan.tasks : [];
                              const isExpanded = Boolean(expandedPlanIds[planUiKey]);
                              const hasExecutedTasks = planTasks.some((task: any) => isTaskAlreadyExecuted(task?.status));
                              const shouldReexecutePlan = Boolean(executedPlanIds[planUiKey] || hasExecutedTasks);
                              const isExecutingPlan = Boolean(executingPlanIds[planUiKey]);

                              return (
                              <div
                                key={planUiKey}
                                onClick={() => togglePlanExpansion(planUiKey)}
                                className="p-4 rounded-xl border border-border/50/50 bg-background hover:border-border/40/50 transition-all group cursor-pointer"
                              >                                <div className="flex items-start justify-between mb-3">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-3 mb-2">
                                      <h3 className="font-bold text-lg text-foreground/90">{plan.name}</h3>
                                      <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-indigo-900/20 border border-indigo-800 text-indigo-400 uppercase tracking-tighter">
                                        {plan.tasks?.length || 0} {t('tasksCount')}
                                      </span>
                                      <span className={cn(
                                        "px-2 py-0.5 text-[9px] font-black rounded-full uppercase tracking-widest border",
                                        shouldReexecutePlan
                                          ? "bg-success/20 border-success/40 text-success"
                                          : "bg-card/50 border-border/50 text-muted-foreground"
                                      )}>
                                        {shouldReexecutePlan ? t('executed') : t('pending')}
                                      </span>
                                      <span className="inline-flex items-center justify-center p-1 rounded-md bg-card/60 border border-border/50/60">
                                        <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform duration-200", isExpanded ? "rotate-180" : "rotate-0")} />
                                      </span>
                                    </div>
                                    <p className="text-sm text-muted-foreground/80 mb-6 leading-relaxed max-w-3xl">{plan.description || t('noDescriptionAvailable')}</p>
                                    <div className="flex items-center gap-6">
                                      <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                                        <FileText className="w-3.5 h-3.5 text-muted-foreground/60" />
                                        {t('planId')} {plan.id}
                                      </div>
                                      <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                                        <Calendar className="w-3.5 h-3.5 text-muted-foreground/60" />
                                        {t('updated')}: {new Date(plan.updatedAt).toLocaleDateString()}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-all translate-x-2 group-hover:translate-x-0">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleExecutePlanRun(plan);
                                      }}
                                      disabled={isExecutingPlan}
                                      className="px-3 py-2 bg-success/20 hover:bg-success/30 text-success border border-success/30 rounded-xl transition-all text-[10px] font-bold uppercase tracking-wider disabled:opacity-60 disabled:cursor-not-allowed"
                                      title={shouldReexecutePlan ? t('reExecutePlan') : t('executePlan')}
                                    >
                                      {isExecutingPlan ? t('executing') : (shouldReexecutePlan ? t('reExecute') : t('executePlan'))}
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleEditPlan(plan);
                                      }}
                                      className="p-2.5 bg-card/80 hover:bg-primary text-muted-foreground hover:text-foreground rounded-xl transition-all shadow-lg"
                                      title={t('editPlan')}
                                    >
                                      <Edit className="w-4 h-4" />
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeletePlan(plan.id, plan.name);
                                      }}
                                      className="p-2.5 bg-card/80 hover:bg-destructive text-muted-foreground hover:text-foreground rounded-xl transition-all shadow-lg"
                                      title={t('deletePlan')}
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                </div>

                                {isExpanded && (
                                  <div className="mt-2 pt-3 border-t border-border/50/50 space-y-2">
                                    {planTasks.length > 0 ? (
                                      planTasks.map((task: any, taskIndex: number) => {
                                        const taskTitle = typeof task === 'string'
                                          ? task
                                          : task?.title || task?.name || `Task ${taskIndex + 1}`;
                                        const taskStatus = typeof task === 'object' ? task?.status : undefined;
                                        const taskOperation = typeof task === 'object' ? String(task?.operation || '').toLowerCase() : '';
                                        const taskKey = getTaskExecutionKey(planUiKey, task, taskIndex);
                                        const taskExecuted = Boolean(executedTaskKeys[taskKey] || isTaskAlreadyExecuted(taskStatus));
                                        const isExecutingTask = Boolean(executingTaskKeys[taskKey]);

                                        return (
                                          <div key={`${plan.id}-task-${task?.id ?? taskIndex}`} className="flex items-center justify-between gap-3 rounded-lg border border-border/50/50 bg-background/40 px-3 py-2">
                                            <span className="text-xs text-foreground/80 truncate">{taskTitle}</span>
                                            <div className="flex items-center gap-2 shrink-0">
                                              {taskOperation && (
                                                <span className={cn(
                                                  "px-2 py-0.5 text-[9px] font-black rounded-full uppercase tracking-widest border",
                                                  taskOperation === 'create' && "bg-success/20 border-success/40 text-success",
                                                  taskOperation === 'update' && "bg-primary/20 border-blue-700/40 text-primary",
                                                  taskOperation === 'delete' && "bg-rose-900/20 border-rose-700/40 text-rose-400"
                                                )}>
                                                  {taskOperation === 'create' ? 'Crear' : taskOperation === 'update' ? 'Actualizar' : taskOperation === 'delete' ? 'Borrar' : taskOperation}
                                                </span>
                                              )}
                                              {taskStatus && (
                                                <span className={cn(
                                                  "px-2 py-0.5 text-[9px] font-black rounded-full uppercase tracking-widest border",
                                                  taskStatus === 'done' && "bg-success/20 border-success/40 text-success",
                                                  taskStatus === 'completed' && "bg-success/20 border-success/40 text-success",
                                                  taskStatus === 'failed' && "bg-rose-900/20 border-rose-700/40 text-rose-400",
                                                  taskStatus === 'in-progress' && "bg-amber-900/20 border-amber-700/40 text-amber-400",
                                                  taskStatus === 'todo' && "bg-card/50 border-border/50 text-muted-foreground",
                                                  taskStatus === 'pending' && "bg-card/50 border-border/50 text-muted-foreground"
                                                )}>
                                                  {taskStatus}
                                                </span>
                                              )}
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleExecuteSingleTaskRun(plan, task, taskIndex);
                                                }}
                                                disabled={isExecutingTask}
                                                className="px-2.5 py-1 bg-primary/20 hover:bg-primary/30 text-primary-foreground border border-blue-500/30 rounded-lg transition-all text-[9px] font-bold uppercase tracking-wider disabled:opacity-60 disabled:cursor-not-allowed"
                                                title={taskExecuted ? t('reExecuteTask') : t('executeTask')}
                                              >
                                                {isExecutingTask ? t('executing') : (taskExecuted ? t('reExecute') : t('execute'))}
                                              </button>
                                            </div>
                                          </div>
                                        );
                                      })
                                    ) : (
                                      <div className="text-xs text-muted-foreground/80 italic">{t('noTasksInThisPlan')}</div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                            })
                          ) : (
                            <div className="text-center py-12">
                              <Calendar className="w-12 h-12 text-muted-foreground/60 mx-auto mb-4 opacity-50" />
                              <h3 className="text-lg font-semibold text-muted-foreground mb-2">{t('noTasksFound')}</h3>
                              <p className="text-sm text-muted-foreground/60">{t('createPlansAndTasks')}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeMainTab === 'editor' && selectedEndpoint && (
                  <div className="bg-input rounded-none border border-border/80 p-8 relative overflow-hidden h-full overflow-y-auto custom-scrollbar">
                    <div className="absolute top-0 right-0 p-8 opacity-5"><Terminal className="w-32 h-32" /></div>
                    <div className="relative z-10">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                        <div>
                          <div className="flex items-center gap-3 mb-2">
                            <span className={cn("px-3 py-1 text-[10px] font-black rounded-md shadow-sm border",
                              selectedEndpoint.method === 'GET' ? 'bg-success/30 border-success text-success' :
                                selectedEndpoint.method === 'POST' ? 'bg-primary/40 border-blue-800 text-primary' :
                                  selectedEndpoint.method === 'PUT' ? 'bg-yellow-900/40 border-yellow-800 text-warning' :
                                    'bg-red-900/40 border-red-800 text-destructive'
                            )}>{selectedEndpoint.method}</span>
                            <h2 className="text-2xl font-bold tracking-tight text-foreground">{t((endpointNameKeys[selectedEndpoint.id] || selectedEndpoint.name) as any)}</h2>
                          </div>
                          <p className="text-sm text-muted-foreground max-w-2xl">{t((endpointDescKeys[selectedEndpoint.id] || selectedEndpoint.description) as any)}</p>
                        </div>
                        <div className="font-mono text-[10px] bg-background/40 px-3 py-2 rounded-lg border border-border/80 text-muted-foreground/80 select-all">{selectedEndpoint.path}</div>
                      </div>

                      <form onSubmit={handleSubmit(handleExecuteRequest)} className="space-y-8">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                          {selectedEndpoint.parameters.map((param) => (
                            <div key={param.name} className="space-y-2">
                              <label className="text-[11px] font-bold text-muted-foreground/80 uppercase tracking-widest flex items-center justify-between px-1">
                                <span>{translateParamLabel(param.name)} {param.required && <span className="text-destructive">*</span>}</span>
                                <span className="text-[9px] lowercase font-normal italic">({param.type})</span>
                              </label>
                              {param.type === 'code' ? (
                                <textarea {...register(param.name as any)} className="w-full h-48 bg-background border border-border/80 rounded-xl p-4 text-xs font-mono text-primary-foreground focus:border-primary focus:ring-1 focus:ring-primary transition-all custom-scrollbar outline-none shadow-inner" placeholder={`// ${translateParamDescription(param.name, param.description || '')}`} />
                              ) : param.type === 'file' ? (
                                <div className="relative">
                                  <input
                                    type="file"
                                    id={`file-param-${param.name}`}
                                    onChange={(e) => {
                                      const file = e.target.files?.[0] || null;
                                      setSelectedFiles(prev => ({ ...prev, [param.name]: file }));
                                      if (file) {
                                        setValue(param.name as any, file.name);
                                      } else {
                                        setValue(param.name as any, '');
                                      }
                                    }}
                                    className="hidden"
                                  />
                                  <label
                                    htmlFor={`file-param-${param.name}`}
                                    className="flex items-center gap-2 w-full bg-background border border-border/80 rounded-xl px-4 py-3 text-sm cursor-pointer hover:border-blue-500 transition-all text-foreground/80"
                                  >
                                    {selectedFiles[param.name] ? (
                                      <>
                                        <File className="w-4 h-4 text-primary" />
                                        <span className="truncate">{selectedFiles[param.name]?.name}</span>
                                        <span className="ml-auto text-xs text-muted-foreground/80">{(selectedFiles[param.name]!.size / 1024).toFixed(1)} KB</span>
                                      </>
                                    ) : (
                                      <>
                                        <Upload className="w-4 h-4 text-muted-foreground/80" />
                                        <span className="text-muted-foreground/80">{t('selectFile')}</span>
                                      </>
                                    )}
                                  </label>
                                </div>
                              ) : shouldRenderAsDropdown(param) ? (
                                <select {...register(param.name as any)} className="w-full bg-background border border-border/80 rounded-xl px-4 py-3 text-sm focus:border-primary outline-none transition-all appearance-none cursor-pointer text-foreground/80">
                                  <option value="">{t('selectOption')}</option>
                                  {getDropdownOptions(param.name).map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                </select>
                              ) : (
                                <input type={param.type === 'number' ? 'number' : 'text'} {...register(param.name as any)} className="w-full bg-background border border-border/80 rounded-xl px-4 py-3 text-sm focus:border-primary outline-none transition-all text-foreground/80" placeholder={translateParamDescription(param.name, param.description || '')} />
                              )}
                            </div>
                          ))}
                        </div>

                        <div className="p-2 bg-primary/5 rounded-2xl border border-blue-900/20 space-y-4">
                          <div className="flex items-center gap-3">
                            <input type="checkbox" id="saveToPlan" checked={saveToPlan} onChange={(e) => setSaveToPlan(e.target.checked)} className="w-4 h-4 rounded border-border/50 bg-background text-primary focus:ring-primary focus:ring-offset-gray-900 transition-all" />
                            <label htmlFor="saveToPlan" className="text-sm font-semibold text-foreground/80 cursor-pointer">{t('storeOperationInPlan')}</label>
                          </div>
                          <AnimatePresence>
                            {saveToPlan && (
                              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                                <div className="flex gap-2">
                                  <select {...register('planName' as any)} className="flex-1 bg-background border border-blue-900/30 rounded-xl px-4 py-3 text-sm outline-none">
                                    <option value="">{t('targetPlan')}</option>
                                    {plans.map(p => <option key={p.id} value={p.name}>{p.name} ({p.taskCount} {t('activeTasks')})</option>)}
                                  </select>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      fetchPlans();
                                      queryClient.invalidateQueries({ queryKey: ['plans'] });
                                    }}
                                    className="px-3 py-3 bg-primary/20 hover:bg-primary/30 border border-blue-600/30 rounded-xl transition-all duration-200 group"
                                    title={t('refreshPlansList')}
                                  >
                                    <svg className="w-4 h-4 text-primary group-hover:text-primary-foreground transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                  </button>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>

                        <div className="flex items-center gap-4 pt-4">
                          <button type="submit" className={cn("px-8 py-1.5 rounded-xl font-bold flex items-center gap-3 transition-all transform active:scale-95 shadow-xl", saveToPlan ? "bg-success hover:bg-success shadow-success/20" : "bg-primary hover:bg-primary shadow-blue-900/20")}>
                            {saveToPlan ? <Save className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                            {saveToPlan ? t('addToPlan') : t('executeTransaction')}
                          </button>
                          <button type="button" onClick={() => { reset(); setSelectedFiles({}); }} className="px-6 py-1.5 bg-card hover:bg-muted rounded-xl font-bold flex items-center gap-2 transition-all">
                            <RotateCcw className="w-4 h-4" />
                            {t('resetForm')}
                          </button>
                        </div>
                      </form>

                      {apiResponse && (
                        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mt-12 space-y-4">
                          <div className="flex items-center justify-between px-2">
                            <h3 className="text-sm font-bold text-muted-foreground/80 uppercase tracking-widest flex items-center gap-2">
                              <Code className="w-4 h-4" /> {t('executionResult')}
                            </h3>
                            <div className="flex items-center gap-2">
                              {apiResponse.backup && <button onClick={handleUndo} className="px-3 py-1.5 bg-orange-600/20 text-orange-400 border border-orange-800 rounded-lg text-xs font-bold hover:bg-orange-600/30 transition-all">{t('rollback')}</button>}
                              <button onClick={() => { navigator.clipboard.writeText(JSON.stringify(apiResponse, null, 2)); setNotification({ type: 'success', message: t('resultCopied') }); }} className="p-1.5 hover:bg-card rounded-lg transition-all text-muted-foreground/80 hover:text-foreground"><Copy className="w-4 h-4" /></button>
                            </div>
                          </div>
                          <div className="bg-input border border-border/80 rounded-2xl p-6 shadow-inner font-mono text-[11px] leading-relaxed h-64 overflow-auto custom-scrollbar">
                            <pre className="text-success/90">{JSON.stringify(apiResponse, null, 2)}</pre>
                          </div>
                        </motion.div>
                      )}
                    </div>
                  </div>
                )}

                {activeMainTab === 'tasks' && (
                  <div className="h-full w-full overflow-hidden flex flex-col">
                    <TwoStepAppGenerator selectedModel={selectedModel} />
                  </div>
                )}

                {activeMainTab === 'structure' && (
                  <div className="bg-transparent rounded-none border border-border/80 p-8 h-full overflow-y-auto custom-scrollbar">
                    <div className="flex items-center justify-between mb-10">
                      <div className="flex items-center gap-4">
                        <div className="p-3 bg-success/30 border border-success rounded-xl"><LayoutDashboard className="w-6 h-6 text-success" /></div>
                        <div>
                          <h2 className="text-xl font-bold text-foreground">Project Blueprint Designer</h2>
                          <p className="text-sm text-muted-foreground/80 font-medium">Map out your file system architecture before building</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <button onClick={() => setStructureItems([...structureItems, { type: 'folder', name: '', path: '', content: '', extension: '', sourcePath: '' }])} className="px-5 py-2.5 bg-primary/10 hover:bg-primary text-primary hover:text-foreground rounded-xl font-bold border border-blue-600/20 transition-all flex items-center gap-2 text-sm shadow-xl shadow-blue-900/10">
                          <Folder className="w-4 h-4" /> New Folder
                        </button>
                        <button onClick={() => setStructureItems([...structureItems, { type: 'file', name: '', path: '', content: '', extension: '', sourcePath: '' }])} className="px-5 py-2.5 bg-success/10 hover:bg-success text-success hover:text-foreground rounded-xl font-bold border border-success/20 transition-all flex items-center gap-2 text-sm shadow-xl shadow-success/10">
                          <File className="w-4 h-4" /> New File
                        </button>
                      </div>
                    </div>

                    <div className="space-y-6">
                      {structureItems.map((item: any, index: number) => (
                        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} key={index} className="bg-input border border-border/80 rounded-2xl p-6 relative group overflow-hidden">
                          <div className={cn("absolute left-0 top-0 bottom-0 w-1", item.type === 'folder' ? "bg-primary" : "bg-success")} />
                          <div className="grid grid-cols-1 xl:grid-cols-6 gap-6 items-start">
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-widest px-1">Type</label>
                              <div className="relative">
                                <select value={item.type} onChange={(e) => { const n = [...structureItems]; n[index].type = e.target.value; setStructureItems(n); }} className="w-full bg-background border border-border/80 rounded-xl px-4 py-2.5 text-xs outline-none appearance-none cursor-pointer">
                                  <option value="folder">FOLDER</option>
                                  <option value="file">FILE</option>
                                </select>
                                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60 pointer-events-none" />
                              </div>
                            </div>
                            <div className="xl:col-span-2 space-y-1.5">
                              <label className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-widest px-1">Entity Name</label>
                              <input type="text" value={item.name} onChange={(e) => { const n = [...structureItems]; n[index].name = e.target.value; setStructureItems(n); }} className="w-full bg-background border border-border/80 rounded-xl px-4 py-2.5 text-xs outline-none" placeholder="e.g. project-core" />
                            </div>
                            <div className="xl:col-span-2 space-y-1.5">
                              <label className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-widest px-1">Virtual Path</label>
                              <input type="text" value={item.path} onChange={(e) => { const n = [...structureItems]; n[index].path = e.target.value; setStructureItems(n); }} className="w-full bg-background border border-border/80 rounded-xl px-4 py-2.5 text-xs outline-none" placeholder="e.g. /src/internal" />
                            </div>
                            <div className="flex justify-end pt-5">
                              <button onClick={() => setStructureItems(structureItems.filter((_, i) => i !== index))} className="p-2.5 bg-destructive/10 hover:bg-destructive text-destructive hover:text-foreground rounded-xl transition-all border border-red-900/20 shadow-lg"><Trash2 className="w-4 h-4" /></button>
                            </div>
                            {item.type === 'file' && (
                              <div className="xl:col-span-6 grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
                                <div className="space-y-1.5">
                                  <label className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-widest px-1">Extension</label>
                                  <input type="text" value={item.extension} onChange={(e) => setStructureItems(structureItems.map((it, idx) => idx === index ? { ...it, extension: e.target.value } : it))} className="w-full bg-background border border-border/80 rounded-xl px-4 py-2.5 text-xs outline-none font-mono" placeholder="ts, py, md..." />
                                </div>
                                <div className="md:col-span-2 space-y-3">
                                  <div className="flex items-center justify-between px-1">
                                    <label className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-widest">Data Source</label>
                                    <div className="flex items-center gap-2 cursor-pointer" onClick={() => setStructureItems(structureItems.map((it, idx) => idx === index ? { ...it, usePocketBase: !it.usePocketBase } : it))}>
                                      <div className={cn("w-6 h-3.5 rounded-full transition-all relative", item.usePocketBase ? "bg-primary" : "bg-card")}>
                                        <div className={cn("absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-all shadow-sm", item.usePocketBase ? "left-3" : "left-0.5")} />
                                      </div>
                                      <span className="text-[10px] font-bold text-muted-foreground/80 uppercase tracking-tighter">Sync PocketBase</span>
                                    </div>
                                  </div>
                                  {item.usePocketBase ? (
                                    <div className="relative">
                                      <select onChange={(e) => { const r = pocketBaseRecords.find(re => re.id === e.target.value); if (r) setStructureItems(structureItems.map((it, idx) => idx === index ? { ...it, sourcePath: r.ruta, content: r.contenido, name: r.nombre } : it)); }} className="w-full bg-background border border-blue-900/30 rounded-xl px-4 py-2.5 text-xs outline-none appearance-none cursor-pointer">
                                        <option value="">Map Record...</option>
                                        {pocketBaseRecords.map(r => <option key={r.id} value={r.id}>{r.ruta}</option>)}
                                      </select>
                                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60 pointer-events-none" />
                                    </div>
                                  ) : (
                                    <input type="text" value={item.sourcePath || ''} onChange={(e) => setStructureItems(structureItems.map((it, idx) => idx === index ? { ...it, sourcePath: e.target.value } : it))} className="w-full bg-background border border-border/80 rounded-xl px-4 py-2.5 text-xs outline-none font-mono" placeholder="Local file path mapping (C:/...)" />
                                  )}
                                </div>
                                <div className="xl:col-span-3 space-y-1.5">
                                  <label className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-widest px-1">Raw Content</label>
                                  <textarea value={item.content} onChange={(e) => setStructureItems(structureItems.map((it, idx) => idx === index ? { ...it, content: e.target.value } : it))} className="w-full h-32 bg-background border border-border/80 rounded-xl p-4 text-xs font-mono text-success focus:border-success transition-all outline-none custom-scrollbar" placeholder="// Injected payload content..." disabled={!!item.sourcePath} />
                                </div>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      ))}
                    </div>

                    <div className="mt-12 flex items-center gap-4">
                      <button onClick={async () => { try { const res = await fetch('http://localhost:8742/api/structure', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ structure: structureItems }) }); const r = await res.json(); setNotification({ type: r.success ? 'success' : 'error', message: r.success ? 'Blueprint staged for deployment' : 'Blueprint validation failed' }); } catch { } }} className="px-10 py-1.5 bg-success hover:bg-success rounded-xl font-bold flex items-center gap-3 transition-all shadow-xl shadow-success/20 active:scale-95">
                        <Upload className="w-5 h-5" /> Deploy Blueprint
                      </button>
                    </div>
                  </div>
                )}

                <div className={activeMainTab === 'structure-plan' ? 'h-full' : 'hidden'}>
                  <StructurePlanTab plans={plans} setPlans={setPlans} />
                </div>

                {activeMainTab === 'api-generator' && (
                  <>
                    <ApiGeneratorModal
                      isOpen={isApiModalOpen}
                      onClose={() => setIsApiModalOpen(false)}
                      onProjectCreated={loadApiProjects}
                      onProjectSelected={(project) => setSelectedApiProject(project)}
                      selectedModel={selectedModel}
                    />
                    {selectedApiProject ? (
                      <ApiProjectInterface project={selectedApiProject} onBack={() => setSelectedApiProject(null)} selectedModel={selectedModel} projectRoot={currentPath} />
                    ) : (
                      <div className="bg-transparent rounded-none border border-border/80 p-8 h-full">
                      <div className="max-w-5xl mx-auto">
                        {/* Header */}
                        <div className="flex flex-col items-center text-center mb-1 py-6 relative">
                          <div className="absolute inset-0 bg-gradient-to-b from-success/10 to-transparent rounded-full blur-[60px] -z-10 h-32 w-full" />
                          <h1 className="text-2xl md:text-3xl font-bold tracking-tight mb-3 leading-snug max-w-xl text-foreground whitespace-nowrap mx-auto">
                            Transforma tu código en una <span className="text-success">API completa</span>
                          </h1>
                          <p className="text-muted-foreground text-sm max-w-xl mb-6 leading-relaxed whitespace-nowrap mx-auto">
                            * Genera endpoints, validaciones y documentación mientras defines tu lógica de negocio.
                          </p>
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => setIsApiModalOpen(true)}
                              className="px-6 py-2 bg-transparent border border-success rounded-full font-bold text-success text-sm hover:bg-success hover:text-foreground transition-colors"
                            >
                              Comenzar ahora
                            </button>
                            <button
                              onClick={handleLoadSavedApi}
                              className="px-6 py-2 bg-transparent border border-blue-400 rounded-full font-bold text-primary text-sm hover:bg-blue-400 hover:text-foreground transition-colors flex items-center gap-2"
                            >
                              <FolderOpen className="w-4 h-4" />
                              Cargar API guardada
                            </button>
                          </div>
                        </div>

                      {/* Capacidades - 6 tarjetas */}
                      <div className="mb-8 relative">
                        <div className="text-center mb-4">
                          <p className="text-xs font-bold uppercase tracking-[0.2em] text-success mb-1">
                          
                          </p>
                          <p className="text-muted-foreground/80 text-sm max-w-xl leading-snug whitespace-nowrap mx-auto">
                            
                          </p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {[
                            { icon: Code, title: 'TypeScript', desc: 'Tipos y contratos seguros.' },
                            { icon: FileText, title: 'Docs', desc: 'OpenAPI / Swagger al instante.' },
                            { icon: Rocket, title: t('validation'), desc: t('schemasReadyToUse') },
                            { icon: Terminal, title: 'Tests', desc: 'Pruebas generadas por IA.' },
                            { icon: ChevronRight, title: 'Versiones', desc: 'Historial de cambios.' },
                            { icon: Sparkles, title: 'Sugerencias', desc: 'Feedback en tiempo real.' },
                          ].map((feature, i) => {
                            const accentPurple = i % 2 === 1;
                            return (
                              <div
                                key={i}
                                className="group relative rounded-xl p-px bg-gradient-to-br hover:opacity-100 opacity-95 transition-all duration-300 hover:scale-[1.02] hover:-translate-y-px cursor-pointer"
                                style={{
                                  background: accentPurple
                                    ? 'linear-gradient(to bottom right, hsl(var(--success) / 0.5), hsl(var(--success) / 0.25), hsl(var(--success) / 0.15))'
                                    : 'linear-gradient(to bottom right, hsl(var(--success) / 0.5), hsl(var(--success) / 0.2), transparent)'
                                }}
                              >
                                <div className="rounded-[11px] bg-background/95 backdrop-blur-md border border-border/50/50 h-full p-4 transition-colors duration-300 group-hover:border-success/50 group-hover:bg-card/80">
                                  <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/5 transition-all duration-300 group-hover:scale-105"
                                    style={{
                                      background: accentPurple
                                        ? 'linear-gradient(to bottom right, hsl(var(--success) / 0.35), hsl(var(--success) / 0.15), rgba(30,30,40,1))'
                                        : 'linear-gradient(to bottom right, rgba(74,222,128,0.4), hsl(var(--success) / 0.1), rgba(30,30,40,1))'
                                    }}
                                  >
                                    <feature.icon size={20} strokeWidth={2.1} className={accentPurple ? 'text-success' : 'text-cyan-400'} />
                                  </div>
                                  <h3 className="text-xs font-bold text-foreground tracking-tight group-hover:text-success transition-colors duration-200 leading-tight mb-1">
                                    {feature.title}
                                  </h3>
                                  <p className="text-muted-foreground text-xs leading-snug line-clamp-2">
                                    {feature.desc}
                                  </p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Proyectos generados */}
                      <div className="pt-6">
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <h2 className="text-sm font-bold text-foreground">Proyectos generados</h2>
                            <p className="text-muted-foreground/80 text-xs">
                              {apiProjects.length} proyecto{apiProjects.length === 1 ? '' : 's'}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
                              className="px-4 py-2 bg-muted hover:bg-muted/80 text-foreground rounded-lg font-medium text-xs transition-colors flex items-center"
                              title={viewMode === 'grid' ? t('listView') : t('gridView')}
                            >
                              {viewMode === 'grid' ? <List className="h-4 w-4 mr-2" /> : <FolderOpen className="h-4 w-4 mr-2" />}
                              {viewMode === 'grid' ? 'Lista' : 'Grid'}
                            </button>
                            <button
                              onClick={() => setIsApiModalOpen(true)}
                              className="px-4 py-2 bg-success hover:bg-success text-foreground rounded-lg font-medium text-xs transition-colors"
                            >
                              + Nuevo Proyecto
                            </button>
                          </div>
                        </div>

                        {apiProjectsLoading ? (
                          <div className="text-center py-10">
                            <div className="w-8 h-8 border-2 border-success border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                            <p className="text-muted-foreground text-sm">Cargando proyectos...</p>
                          </div>
                        ) : apiProjects.length === 0 ? (
                          <div className="text-center py-10 bg-input rounded-xl border border-border/80">
                            <Sparkles className="w-12 h-12 text-muted-foreground/60 mx-auto mb-3" />
                            <p className="text-muted-foreground text-sm">No hay proyectos generados aún</p>
                            <p className="text-muted-foreground/80 text-xs mt-1">Crea tu primer proyecto para comenzar</p>
                          </div>
                        ) : (
                          viewMode === 'grid' ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                              {apiProjects.slice(0, 6).map((project) => (
                                <div
                                  key={project.id}
                                  onClick={() => setSelectedApiProject(project)}
                                  className="bg-input border border-border/80 rounded-xl p-4 hover:border-success/50 transition-colors cursor-pointer"
                                >
                                  <div className="flex items-start justify-between mb-3">
                                    <div className="w-10 h-10 rounded-lg bg-success/20 flex items-center justify-center text-success border border-success">
                                      <Sparkles className="w-5 h-5" />
                                    </div>
                                    {typeof project.status === 'string' && project.status.trim() ? (
                                      <span className={`px-2 py-1 rounded-full text-[10px] font-medium border ${
                                        project.status === 'Saludable'
                                          ? 'bg-success/20 text-success border-success'
                                          : 'bg-yellow-900/20 text-warning border-yellow-800'
                                      }`}>
                                        {project.status}
                                      </span>
                                    ) : null}
                                  </div>
                                  <h3 className="text-sm font-bold text-foreground mb-2 truncate">{project.title}</h3>
                                  <div className="flex items-center justify-between text-xs text-muted-foreground/80">
                                    <span>{project.endpoints?.length || 0} endpoints</span>
                                    <span>{new Date(project.created).toLocaleDateString()}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="space-y-3 max-h-[350px] overflow-y-auto pr-2 pb-4">
                              {apiProjects.map((project) => (
                                <div
                                  key={project.id}
                                  onClick={() => setSelectedApiProject(project)}
                                  className="group bg-background/50 border border-border/80 rounded-xl p-4 hover:border-success/50 transition-colors cursor-pointer"
                                >
                                  <div className="flex items-start justify-between">
                                    <div className="flex items-start gap-4 flex-1">
                                      <div className="w-10 h-10 rounded-lg bg-success/20 flex items-center justify-center text-success border border-success shrink-0">
                                        <Sparkles className="w-5 h-5" />
                                      </div>
                                      <div className="flex-1">
                                        <div className="flex items-center gap-3 mb-2">
                                          <h3 className="text-sm font-bold text-foreground">{project.title}</h3>
                                          {typeof project.status === 'string' && project.status.trim() ? (
                                            <span className={`px-2 py-1 rounded-full text-[10px] font-medium border ${
                                              project.status === 'Saludable'
                                                ? 'bg-success/20 text-success border-success'
                                                : 'bg-yellow-900/20 text-warning border-yellow-800'
                                            }`}>
                                              {project.status}
                                            </span>
                                          ) : null}
                                        </div>
                                        <div className="flex items-center gap-4 text-xs text-muted-foreground/80">
                                          <span>{project.endpoints?.length || 0} endpoints</span>
                                          <span>{new Date(project.created).toLocaleDateString()}</span>
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          void handleDeleteApiProject(project.id);
                                        }}
                                        className="p-2 rounded-lg bg-red-900/20 text-destructive hover:bg-red-900/35 hover:text-red-300 transition-all opacity-0 group-hover:opacity-100"
                                        title={t('deleteProject')}
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                      <ChevronRight className="w-5 h-5 text-muted-foreground" />
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                  )}
                </>
                )}

                {activeMainTab === 'preview' && (
                  <div className="h-full w-full">
                    <PreviewTab />
                  </div>
                )}

                {activeMainTab === 'componentes' && (
                  <div className="h-full w-full bg-card">
                    <ZeusStudio />
                  </div>
                )}

                {activeMainTab === 'library' && (
                  <div className="h-full w-full">
                    <AppLibrari />
                  </div>
                )}

              </motion.div>
            </AnimatePresence>
                        </div>
                        </div>

                        {/* Chat Column - Always visible on the right */}
                        <div 
                          className="flex-shrink-0 flex relative"
                          style={{ width: `${chatWidth}px` }}
                        >
                          {/* Resize Handle */}
                          <div
                            onMouseDown={startResizing}
                            className={`absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-50 transition-colors hover:bg-primary/30 ${isResizingChat ? 'bg-primary/50' : ''}`}
                          />
                          <div className="flex-1 fondo-zeus rounded-none border-l border-border/80 h-full flex flex-col overflow-hidden">
                            <FloatingChatButton />
                          </div>
                        </div>
                      </div>
                    </EditorProvider>
                  </TerminalProvider>
                </ProjectProvider>
              </AuthProvider>
            </div>
          </div>
        </div>
      </main>

      <ModelConfigModal
        isOpen={isModelModalOpen}
        onClose={() => setIsModelModalOpen(false)}
        onSaved={() => {
          const { fetchModels } = useStore.getState();
          fetchModels();
        }}
      />

      <GitHubModal
        isOpen={isGitHubModalOpen}
        onClose={() => setIsGitHubModalOpen(false)}
        projectPath={effectiveProjectRoot}
      />

      <ThemeEditorModal
        open={isThemeEditorOpen}
        onClose={() => {
          setIsThemeEditorOpen(false);
          void loadAndApplyTheme();
        }}
      />

      <ChatHistorySidebar />

    </div>
  );
}

function ApiProjectInterface({ project, onBack, selectedModel, projectRoot }: { project: any; onBack: () => void; selectedModel?: any; projectRoot?: string }) {
  const { t } = useTranslation();
  const { token, user } = useAuth();
  const [activeTab, setActiveTab] = useState('codigo');
  const [isMaximized, setIsMaximized] = useState(false);
  const [showCheckmark, setShowCheckmark] = useState(false);
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);
  const [downloadZipError, setDownloadZipError] = useState<string | null>(null);
  const [isExecutingApi, setIsExecutingApi] = useState(false);
  const [executeApiError, setExecuteApiError] = useState<string | null>(null);
  
  // Estados para el contenido del proyecto
  const [code, setCode] = useState(project.code || '');
  const [documentation, setDocumentation] = useState(project.documentation || '');
  const [schemas, setSchemas] = useState(project.schemas || '');
  const [endpoints, setEndpoints] = useState<any[]>([]);
  
  // Estados para el probador y feedback
  const [selectedEndpointId, setSelectedEndpointId] = useState('');
  const [testParamValues, setTestParamValues] = useState<Record<string, string>>({});
  const [testResponse, setTestResponse] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [saveProjectError, setSaveProjectError] = useState<string | null>(null);
  const [saveProjectSuccess, setSaveProjectSuccess] = useState<string | null>(null);

  // Cargar endpoints del proyecto al iniciar
  useEffect(() => {
    if (project.endpoints) {
      try {
        const parsedEndpoints = typeof project.endpoints === 'string' 
          ? JSON.parse(project.endpoints) 
          : project.endpoints;
        setEndpoints(Array.isArray(parsedEndpoints) ? parsedEndpoints : []);
      } catch (e) {
        console.error('Error parseando endpoints:', e);
        setEndpoints([]);
      }
    }
  }, [project.endpoints]);

  const flattenInputValues = (value: unknown, prefix = '', out: Record<string, string> = {}) => {
    if (value === null || value === undefined) return out;
    if (typeof value === 'string') {
      const t = value.trim();
      if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
        try {
          const parsed = JSON.parse(t);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return flattenInputValues(parsed, prefix, out);
          }
        } catch {
          // keep original string
        }
      }
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
      if (prefix) out[prefix] = String(value ?? '');
      return out;
    }
    const obj = value as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        flattenInputValues(v, key, out);
      } else {
        out[key] = String(v ?? '');
      }
    }
    return out;
  };

  const parseInputValue = (raw: string): unknown => {
    const t = String(raw ?? '').trim();
    if (!t) return '';
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
    if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
      try { return JSON.parse(t); } catch { return raw; }
    }
    return raw;
  };

  const buildNestedPayload = (flat: Record<string, string>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [flatKey, rawVal] of Object.entries(flat)) {
      const parts = flatKey.split('.').filter(Boolean);
      if (parts.length === 0) continue;
      let cur: Record<string, unknown> = out;
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i];
        if (!cur[p] || typeof cur[p] !== 'object' || Array.isArray(cur[p])) {
          cur[p] = {};
        }
        cur = cur[p] as Record<string, unknown>;
      }
      cur[parts[parts.length - 1]] = parseInputValue(rawVal);
    }
    return out;
  };

  useEffect(() => {
    const selected = endpoints.find((ep, idx) => String(ep.id || idx) === String(selectedEndpointId));
    if (!selected) {
      setTestParamValues({});
      return;
    }
    const paramsObj = selected.parameters && typeof selected.parameters === 'object' && !Array.isArray(selected.parameters)
      ? (selected.parameters as Record<string, unknown>)
      : {};
    const defaults = Object.fromEntries(Object.keys(paramsObj).map((k) => [k, '']));
    const fromTaskRaw =
      selected?.testTask?.inputValues &&
      typeof selected.testTask.inputValues === 'object' &&
      !Array.isArray(selected.testTask.inputValues)
        ? (selected.testTask.inputValues as Record<string, unknown>)
        : {};
    const fromTask = flattenInputValues(fromTaskRaw);
    const merged = { ...defaults, ...fromTask };

    const parentKeysToDrop = Object.keys(merged).filter((k) =>
      Object.keys(merged).some((candidate) => candidate !== k && candidate.startsWith(`${k}.`))
    );
    for (const pk of parentKeysToDrop) {
      delete merged[pk];
    }

    setTestParamValues(merged);
  }, [selectedEndpointId, endpoints]);

  const handleCopy = () => {
    const textToCopy = activeTab === 'codigo' ? code : activeTab === 'docs' ? documentation : schemas;
    navigator.clipboard.writeText(textToCopy);
    setShowCheckmark(true);
    setTimeout(() => setShowCheckmark(false), 1500);
  };

  const handleRunTest = async () => {
    const effectiveEndpointId =
      selectedEndpointId ||
      String(endpoints?.[0]?.id || 'list');
    const safeEndpointId = encodeURIComponent(String(effectiveEndpointId));
    
    setIsTesting(true);
    setTestResponse(null);
    
    try {
      const payload = buildNestedPayload(testParamValues);
      const formData = new FormData();
      for (const [k, v] of Object.entries(testParamValues)) {
        formData.append(k, String(v ?? ''));
      }
      formData.append('payload', JSON.stringify(payload));
      
      const targetEndpoint = endpoints?.find(e => String(e.id) === String(effectiveEndpointId));
      if (targetEndpoint) {
        formData.append('_method', String(targetEndpoint.method || 'GET'));
        formData.append('_path', String(targetEndpoint.path || '/'));
      }
      const requestOptions: RequestInit = {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: formData
      };

      const baseUrls = ['', 'http://localhost:8743', 'http://localhost:8742'];
      let response: Response | null = null;
      let lastError: unknown = null;

      for (const baseUrl of baseUrls) {
        try {
          const candidate = await fetch(`${baseUrl}/api/generate-api/test/${safeEndpointId}`, requestOptions);
          if (candidate.status !== 404) {
            response = candidate;
            break;
          }
          response = candidate;
        } catch (err) {
          lastError = err;
        }
      }

      if (!response) {
        throw (lastError instanceof Error ? lastError : new Error(t('couldNotContactApiTester')));
      }

      if (response.status === 404) {
        const fallbackBody = {
          message: t('apiTesterFallback'),
          endpointId: effectiveEndpointId,
          echo: payload,
          timestamp: new Date().toISOString()
        };
        setTestResponse(`HTTP 200 OK\n\n${JSON.stringify(fallbackBody, null, 2)}`);
        return;
      }
      
      const statusLine = `HTTP ${response.status} ${response.statusText}`;
      const data = await response.json().catch(() => ({}));
      setTestResponse(`${statusLine}\n\n${JSON.stringify(data, null, 2)}`);
    } catch (e) {
      setTestResponse(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsTesting(false);
    }
  };

  const selectedEndpoint = endpoints.find((ep, idx) => String(ep.id || idx) === String(selectedEndpointId));
  const effectiveSelectedEndpointId = selectedEndpointId || String(endpoints?.[0]?.id || 'list');
  const selectedEndpointParamNames =
    Object.keys(testParamValues).length > 0
      ? Object.keys(testParamValues)
      : selectedEndpoint &&
          selectedEndpoint.parameters &&
          typeof selectedEndpoint.parameters === 'object' &&
          !Array.isArray(selectedEndpoint.parameters)
        ? Object.keys(selectedEndpoint.parameters as Record<string, unknown>)
        : [];

  const getDeclaredParamType = (paramKey: string): string | null => {
    if (!selectedEndpoint || !selectedEndpoint.parameters || typeof selectedEndpoint.parameters !== 'object' || Array.isArray(selectedEndpoint.parameters)) {
      return null;
    }
    const rootKey = paramKey.split('.')[0];
    const spec = (selectedEndpoint.parameters as Record<string, unknown>)[rootKey];
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return null;
    const t = (spec as Record<string, unknown>).type;
    return typeof t === 'string' ? t.toLowerCase() : null;
  };

  const inferInputKind = (paramKey: string): 'number' | 'boolean' | 'datetime-local' | 'text' => {
    const declared = getDeclaredParamType(paramKey);
    if (declared === 'number' || declared === 'integer' || declared === 'int' || declared === 'float' || declared === 'double') return 'number';
    if (declared === 'boolean' || declared === 'bool') return 'boolean';

    const k = paramKey.toLowerCase();
    if (/(^is[A-Z]|^has[A-Z])/.test(paramKey) || /^is_|^has_|enabled$|active$|deleted$|visible$/.test(k)) return 'boolean';
    if (/\b(size|count|total|limit|offset|page|index|qty|quantity|amount|number)\b/.test(k)) return 'number';
    if (/date|time|_at$|at$/i.test(paramKey)) return 'datetime-local';
    return 'text';
  };

  const currentPayloadPreview = buildNestedPayload(testParamValues);
  const curlFormPreviewLines = Object.entries(testParamValues).map(
    ([k, v]) => `  -F '${k}=${String(v ?? '').replace(/'/g, "\\'")}'`
  );

  const handleSendFeedback = async () => {
    if (!feedback.trim() || isGenerating) return;
    
    setIsGenerating(true);
    setFeedbackError(null);
    try {
      const formData = new FormData();
      formData.append('title', project.title);
      formData.append('description', project.description);
      formData.append('modelType', 'typescript');
      formData.append('existing_code', code);
      formData.append('feedback_text', feedback.trim());
      
      // Obtener configuración del modelo seleccionado
      if (!selectedModel) {
        throw new Error('No hay ningún modelo seleccionado. Por favor, selecciona uno en la barra superior.');
      }
      const modelConfig = {
        modelId: selectedModel.id,
        apiKey: selectedModel[MODELOS_FIELDS.API_KEY] || '',
        model: selectedModel[MODELOS_FIELDS.MODEL_NAME] || 'deepseek-chat',
        temperature: selectedModel[MODELOS_FIELDS.CONFIG]?.temperature || 0.7,
        maxTokens: selectedModel[MODELOS_FIELDS.CONFIG]?.max_tokens || 8192,
        apiBaseUrl: selectedModel[MODELOS_FIELDS.BASE_URL] || undefined,
        type: selectedModel[MODELOS_FIELDS.TYPE] || '',
        provider: selectedModel[MODELOS_FIELDS.PROVIDER] || '',
      };

      const response = await fetch('/api/generate-api/generate', {
        method: 'POST',
        headers: {
          'x-model-config': JSON.stringify(modelConfig),
          'Authorization': `Bearer ${token}`
        },
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => `HTTP ${response.status}`);
        throw new Error(`Error al aplicar feedback: ${errorText}`);
      }
      
      const result = await response.json();
      
      // Actualizar el proyecto con el nuevo código
      if (result.code) setCode(result.code);
      if (result.documentation) setDocumentation(result.documentation);
      if (result.schemas) setSchemas(result.schemas);
      if (result.endpoints) setEndpoints(result.endpoints);
      
      setFeedback('');
      // Aquí podrías mostrar una notificación de éxito
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error desconocido';
      setFeedbackError(msg);
      console.error('Error en feedback:', e);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownloadProjectZip = async () => {
    if (isDownloadingZip) return;

    setDownloadZipError(null);
    setIsDownloadingZip(true);

    try {
      const projectTitle = String(project.title || 'zeus-api');
      const projectDescription = String(project.description || 'API generada con Zeus IA');

      const apiCode = sanitizeGeneratedApiTsCode(
        code || '',
        projectTitle,
        projectDescription,
        endpoints,
        documentation || ''
      );

      const packageJson: {
        name: string;
        version: string;
        description: string;
        main: string;
        scripts: Record<string, string>;
        dependencies: Record<string, string>;
        devDependencies: Record<string, string>;
      } = {
        name: projectTitle.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'zeus-api',
        version: '1.0.0',
        description: projectDescription,
        main: 'api.ts',
        scripts: {
          start: 'ts-node api.ts',
          dev: 'ts-node-dev --respawn --transpile-only api.ts',
          build: 'tsc'
        },
        dependencies: {
          express: '^4.18.2',
          zod: '^3.22.4',
          pocketbase: '^0.21.1',
          'swagger-ui-express': '^5.0.0',
          'swagger-jsdoc': '^6.2.8',
          cors: '^2.8.5',
          dotenv: '^16.3.1'
        },
        devDependencies: {
          '@types/express': '^4.17.21',
          '@types/swagger-ui-express': '^4.1.6',
          '@types/swagger-jsdoc': '^6.0.4',
          '@types/cors': '^2.8.17',
          '@types/node': '^20.10.5',
          'ts-node': '^10.9.2',
          'ts-node-dev': '^2.0.0',
          typescript: '^5.3.3'
        }
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

      const docsBody = (documentation || '').trim() || '# Documentación\n\nNo hay documentación generada.';
      const schemasBody = (schemas || '').trim() || '// No hay esquemas generados';

      const readme = [
        `# ${projectTitle}`,
        '',
        projectDescription,
        '',
        '## Instalación',
        '',
        '```bash',
        'npm install',
        '```',
        '',
        '## Ejecución',
        '',
        '```bash',
        'npm start',
        '```',
        '',
        '## Desarrollo',
        '',
        '```bash',
        'npm run dev',
        '```',
        '',
        '## Swagger',
        '',
        'Abre `http://localhost:8741/api-docs` una vez iniciado el servidor.'
      ].join('\n');

      const zip = new JSZip();
      zip.file('package.json', JSON.stringify(packageJson, null, 2));
      zip.file('tsconfig.json', JSON.stringify(tsConfig, null, 2));
      zip.file('README.md', readme);
      zip.file('api.ts', apiCode);
      zip.file('schemas.ts', schemasBody);
      zip.file('documentation.md', docsBody);
      zip.file('endpoints.json', JSON.stringify(endpoints || [], null, 2));
      zip.file('.env.example', 'PORT=3000\n# POCKETBASE_URL=http://localhost:8090\n');
      zip.file('.gitignore', 'node_modules/\ndist/\n.env\n');

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${packageJson.name || 'zeus-api'}-project.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Error al generar el ZIP';
      setDownloadZipError(message);
    } finally {
      setIsDownloadingZip(false);
    }
  };

  const handleSaveToProject = async () => {
    if (isSavingProject) return;
    setSaveProjectError(null);
    setSaveProjectSuccess(null);
    setIsSavingProject(true);
    try {
      const projectTitle = String(project.title || 'zeus-api');
      const projectDescription = String(project.description || 'API generada con Zeus IA');

      const apiCode = sanitizeGeneratedApiTsCode(
        code || '',
        projectTitle,
        projectDescription,
        endpoints,
        documentation || ''
      );

      const packageJson = {
        name: projectTitle.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'zeus-api',
        version: '1.0.0',
        description: projectDescription,
        main: 'api.ts',
        scripts: {
          start: 'ts-node api.ts',
          dev: 'ts-node-dev --respawn --transpile-only api.ts',
          build: 'tsc'
        },
        dependencies: {
          express: '^4.18.2',
          zod: '^3.22.4',
          pocketbase: '^0.21.1',
          'swagger-ui-express': '^5.0.0',
          'swagger-jsdoc': '^6.2.8',
          cors: '^2.8.5',
          dotenv: '^16.3.1'
        },
        devDependencies: {
          '@types/express': '^4.17.21',
          '@types/swagger-ui-express': '^4.1.6',
          '@types/swagger-jsdoc': '^6.0.4',
          '@types/cors': '^2.8.17',
          '@types/node': '^20.10.5',
          'ts-node': '^10.9.2',
          'ts-node-dev': '^2.0.0',
          typescript: '^5.3.3'
        }
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

      const docsBody = (documentation || '').trim() || '# Documentación\n\nNo hay documentación generada.';
      const schemasBody = (schemas || '').trim() || '// No hay esquemas generados';

      const readme = [
        `# ${projectTitle}`,
        '',
        projectDescription,
        '',
        '## Instalación',
        '',
        '```bash',
        'npm install',
        '```',
        '',
        '## Ejecución',
        '',
        '```bash',
        'npm start',
        '```',
        '',
        '## Desarrollo',
        '',
        '```bash',
        'npm run dev',
        '```',
        '',
        '## Swagger',
        '',
        'Abre `http://localhost:8741/api-docs` una vez iniciado el servidor.'
      ].join('\n');

      const files = [
        { filePath: 'API/package.json', content: JSON.stringify(packageJson, null, 2) },
        { filePath: 'API/tsconfig.json', content: JSON.stringify(tsConfig, null, 2) },
        { filePath: 'API/README.md', content: readme },
        { filePath: 'API/api.ts', content: apiCode },
        { filePath: 'API/schemas.ts', content: schemasBody },
        { filePath: 'API/documentation.md', content: docsBody },
        { filePath: 'API/endpoints.json', content: JSON.stringify(endpoints || [], null, 2) },
        { filePath: 'API/.env.example', content: 'PORT=3000\n# POCKETBASE_URL=http://localhost:8090\n' },
        { filePath: 'API/.gitignore', content: 'node_modules/\ndist/\n.env\n' },
        {
          filePath: 'API/zeus-api-config.json',
          content: JSON.stringify({
            id: project.id,
            title: project.title,
            description: project.description,
            code,
            documentation,
            schemas,
            endpoints,
            created: new Date().toISOString()
          }, null, 2)
        },
        {
          filePath: 'API/pb_schema.json',
          content: generatePbSchema(endpoints || [], projectTitle)
        }
      ];

      for (const file of files) {
        const res = await fetch('/api/save-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filePath: file.filePath,
            content: file.content,
            projectRoot: projectRoot || ''
          })
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Error guardando ${file.filePath}`);
        }
      }

      setSaveProjectSuccess('API guardada en el proyecto correctamente.');
    } catch (e) {
      setSaveProjectError(e instanceof Error ? e.message : 'Error al guardar en el proyecto.');
    } finally {
      setIsSavingProject(false);
    }
  };

  const handleExecuteApi = async () => {
    if (isExecutingApi) return;

    setExecuteApiError(null);
    setIsExecutingApi(true);

    let popup: Window | null = null;

    try {
      const apiCode = (code || '').trim();
      if (!apiCode) {
        throw new Error('No hay código para ejecutar en este proyecto.');
      }

      const runtimeCode = sanitizeGeneratedApiTsCode(
        apiCode,
        String(project.title || 'API'),
        String(project.description || ''),
        endpoints,
        documentation
      );

      const runtimeCodeWithForcedPaths = runtimeCode;

      const runtimeHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      };

      const configuredBase =
        typeof window !== 'undefined' && typeof (window as any).__ZEUS_API_BASE__ === 'string' && (window as any).__ZEUS_API_BASE__.trim()
          ? String((window as any).__ZEUS_API_BASE__).trim().replace(/\/$/, '')
          : '';
      const envRuntimeBase =
        typeof process !== 'undefined' && typeof process.env.NEXT_PUBLIC_ZEUS_API_BASE === 'string' && process.env.NEXT_PUBLIC_ZEUS_API_BASE.trim()
          ? process.env.NEXT_PUBLIC_ZEUS_API_BASE.trim().replace(/\/$/, '')
          : '';
      const sameOriginBase = typeof window !== 'undefined' ? window.location.origin.replace(/\/$/, '') : '';

      const runtimeBases = Array.from(
        new Set([configuredBase, envRuntimeBase, sameOriginBase, 'http://localhost:8743', 'http://localhost:8742'].filter(Boolean))
      );
      const requestRuntime = async (endpointPath: string, init: RequestInit) => {
        let lastNetworkError: unknown = null;

        for (const base of runtimeBases) {
          try {
            const response = await fetch(`${base}${endpointPath}`, init);
            if (response.status === 404) continue;
            return { response, base };
          } catch (error) {
            lastNetworkError = error;
          }
        }

        if (lastNetworkError instanceof Error && /Failed to fetch/i.test(lastNetworkError.message)) {
          throw new Error(`No se pudo conectar con el runtime de la API (${runtimeBases.join(', ')}). Verifica que el backend esté levantado.`);
        }

        throw new Error(`No se encontró el endpoint del runtime de la API en las bases configuradas (${runtimeBases.join(', ')}).`);
      };

      const { response: installRes } = await requestRuntime('/api/install-dependencies', {
        method: 'POST',
        headers: runtimeHeaders
      });

      if (!installRes.ok) {
        const installJson = await installRes.json().catch(() => ({}));
        const installErr =
          typeof installJson.error === 'string' && installJson.error.trim()
            ? installJson.error
            : `Error instalando dependencias (HTTP ${installRes.status})`;
        const installStderr =
          typeof installJson.stderr === 'string' && installJson.stderr.trim()
            ? `\n${installJson.stderr.trim()}`
            : '';
        throw new Error(`${installErr}${installStderr}`);
      }

      const { response: runRes, base: runBase } = await requestRuntime('/api/run-api-runtime', {
        method: 'POST',
        headers: runtimeHeaders,
        body: JSON.stringify({
          code: runtimeCodeWithForcedPaths,
          title: String(project.title || 'API'),
          description: String(project.description || ''),
          endpoints,
          documentation
        })
      });

      const runJson = await runRes.json().catch(() => ({}));
      if (!runRes.ok) {
        const baseError = typeof runJson.error === 'string' ? runJson.error : 'No se pudo iniciar la API.';
        const tail = Array.isArray((runJson as any).runtimeLogTail)
          ? (runJson as any).runtimeLogTail
              .map((x: unknown) => String(x ?? '').trim())
              .filter(Boolean)
              .slice(-8)
          : [];
        if (tail.length > 0) {
          throw new Error(`${baseError}\n\nLogs runtime (tail):\n${tail.join('\n')}`);
        }
        throw new Error(baseError);
      }

      const targetUrl =
        typeof runJson.url === 'string' && runJson.url.trim()
          ? runJson.url
          : typeof runJson.runtimeDocsUrl === 'string' && runJson.runtimeDocsUrl.trim()
            ? runJson.runtimeDocsUrl
          : runBase
            ? `${runBase.replace(/\/$/, '')}/api-docs`
            : 'http://localhost:8745/api-docs';

      await new Promise((resolve) => setTimeout(resolve, 1500));
      const isElectronRuntime = typeof window !== 'undefined' && Boolean((window as any).electronAPI);
      popup = window.open(targetUrl, '_blank');
      if (!popup && !isElectronRuntime) {
        throw new Error('El navegador bloqueó la pestaña emergente. Permite popups para abrir Swagger.');
      }
    } catch (e) {
      if (popup && !popup.closed) popup.close();
      setExecuteApiError(e instanceof Error ? e.message : 'Error al ejecutar la API.');
    } finally {
      setIsExecutingApi(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border/80 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-card transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="p-2 bg-success/20 border border-success rounded-lg">
            <Sparkles className="w-5 h-5 text-success" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">{project.title}</h2>
            <p className="text-muted-foreground text-xs">ID: {project.id}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExecuteApi}
            disabled={isExecutingApi}
            className="px-3 py-2 rounded-lg border border-cyan-700/70 text-cyan-400 hover:bg-cyan-900/20 hover:text-cyan-300 transition-colors text-xs font-semibold flex items-center gap-2 disabled:opacity-60"
            title={t('installDepsAndRunAPI')}
          >
            {isExecutingApi ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {isExecutingApi ? 'Ejecutando...' : 'Ejecutar'}
          </button>
          <button
            onClick={handleDownloadProjectZip}
            disabled={isDownloadingZip}
            className="px-3 py-2 rounded-lg border border-success/70 text-success hover:bg-success/20 hover:text-success transition-colors text-xs font-semibold flex items-center gap-2 disabled:opacity-60"
            title={t('downloadProjectZIP')}
          >
            {isDownloadingZip ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {isDownloadingZip ? 'Generando ZIP...' : 'Descargar'}
          </button>
          <button
            onClick={handleSaveToProject}
            disabled={isSavingProject}
            className="px-3 py-2 rounded-lg border border-blue-700/70 text-primary hover:bg-primary/20 hover:text-primary-foreground transition-colors text-xs font-semibold flex items-center gap-2 disabled:opacity-60"
            title={t('saveAPIInProject')}
          >
            {isSavingProject ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isSavingProject ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
      {executeApiError ? (
        <div className="px-4 py-2 border-b border-amber-900/40 bg-amber-900/10 text-amber-200 text-xs">
          {executeApiError}
        </div>
      ) : null}
      {downloadZipError ? (
        <div className="px-4 py-2 border-b border-red-900/40 bg-red-900/10 text-red-300 text-xs">
          {downloadZipError}
        </div>
      ) : null}
      {saveProjectError ? (
        <div className="px-4 py-2 border-b border-red-900/40 bg-red-900/10 text-red-300 text-xs">
          {saveProjectError}
        </div>
      ) : null}
      {saveProjectSuccess ? (
        <div className="px-4 py-2 border-b border-success/40 bg-success/10 text-success text-xs">
          {saveProjectSuccess}
        </div>
      ) : null}

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mitad arriba: 3 pestañas */}
        <div className={`${isMaximized ? 'h-full' : 'h-1/2'} border-b border-border/80 flex flex-col`}>
          <div className="flex border-b border-border/80 shrink-0">
            {[
              { id: 'codigo', label: t('code'), icon: Code },
              { id: 'docs', label: t('docs'), icon: FileText },
              { id: 'esquemas', label: t('schemas'), icon: Layers2 },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'text-success bg-success/20 border-b-2 border-success'
                    : 'text-muted-foreground hover:text-foreground hover:bg-card'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
            <div className="flex items-center gap-2 ml-auto pr-2">
              <button
                onClick={handleCopy}
                className="p-2 rounded-lg text-muted-foreground hover:text-success hover:bg-card transition-colors"
                title={t('copyContent')}
              >
                {showCheckmark ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
              </button>
              <button
                onClick={() => setIsMaximized(!isMaximized)}
                className="p-2 rounded-lg text-muted-foreground hover:text-success hover:bg-card transition-colors"
                title={isMaximized ? 'Restaurar' : 'Maximizar'}
              >
                {isMaximized ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-4">
            {activeTab === 'codigo' && (
              <div className="h-full bg-background rounded-lg border border-border/50 overflow-hidden">
                <MonacoEditor
                  value={code}
                  onChange={setCode}
                  language="typescript"
                  height="100%"
                  disableDiagnostics
                />
              </div>
            )}
            {activeTab === 'docs' && (
              <div className="h-full bg-background rounded-lg border border-border/50 p-4 overflow-auto custom-scrollbar">
                <pre className="text-success text-xs font-mono whitespace-pre-wrap">{documentation || t('noDocumentation')}</pre>
              </div>
            )}
            {activeTab === 'esquemas' && (
              <div className="h-full bg-background rounded-lg border border-border/50 p-4 overflow-auto custom-scrollbar">
                <pre className="text-success text-xs font-mono whitespace-pre-wrap">{schemas || 'No hay esquemas generados.'}</pre>
              </div>
            )}
          </div>
        </div>

        {/* Mitad abajo: tarjetas */}
        {!isMaximized && (
          <div className="h-1/2 p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Petición + Respuesta (un solo contenedor) */}
            <div className="rounded-xl border border-border/50 bg-background p-4 flex flex-col overflow-hidden">
              <h3 className="text-sm font-bold text-foreground mb-3 shrink-0">{t('apiRequestAndResponse')}</h3>
              <div className="h-1/3 min-h-[90px] mb-3 overflow-hidden flex flex-col">
                <p className="text-[11px] font-semibold text-foreground/80 mb-2">{t('apiRequestCurl')}</p>
                <div className="bg-background rounded-lg border border-border/80 p-3 font-mono text-[10px] text-success overflow-auto flex-1">
                  <p>{`$ curl -sS -X POST "http://localhost:8743/api/generate-api/test/${effectiveSelectedEndpointId}"`}</p>
                  <p className="text-muted-foreground/80">  # multipart/form-data</p>
                  {curlFormPreviewLines.map((line, i) => (
                    <p key={i} className="text-muted-foreground/80">{line}</p>
                  ))}
                  <p className="text-muted-foreground/80">{`  -F 'payload=${JSON.stringify(currentPayloadPreview).replace(/'/g, "\\'")}'`}</p>
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                <p className="text-[11px] font-semibold text-foreground/80 mb-2">{t('apiResponse')}</p>
                <div className="bg-background rounded-lg border border-border/80 flex-1 overflow-auto p-3">
                  <pre className="font-mono text-[10px] text-foreground/80 whitespace-pre-wrap">
                    {testResponse || t('runTestToSeeResponse')}
                  </pre>
                </div>
              </div>
            </div>

            {/* Probador + Feedback */}
            <div className="flex flex-col gap-4 overflow-hidden">
              <div className="h-1/2 rounded-xl border border-border/50 bg-background p-4 flex flex-col">
                <h3 className="text-sm font-bold text-foreground mb-1 flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-cyan-400" />
                  {t('apiTesterTitle')}
                </h3>
                <p className="text-[10px] text-muted-foreground mb-3">{t('apiTesterHarness')}</p>
                <div className="flex flex-col gap-3">
                  <select 
                    value={selectedEndpointId}
                    onChange={(e) => setSelectedEndpointId(e.target.value)}
                    className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
                  >
                    <option value="">{t('selectEndpoint')}</option>
                    {endpoints.map((ep, idx) => (
                      <option key={idx} value={ep.id || idx}>
                        {ep?.testTask?.title || `${ep.method} ${ep.path}`}
                      </option>
                    ))}
                  </select>

                  <button 
                    onClick={handleRunTest}
                    disabled={isTesting}
                    className="w-full px-4 py-2 bg-success hover:bg-success text-foreground rounded-lg font-medium text-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isTesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                    {t('runTest')}
                  </button>
                </div>
              </div>

              <div className="h-1/2 rounded-xl border border-border/50 bg-background p-4 flex flex-col">
                <h3 className="text-sm font-bold text-foreground mb-2 flex items-center gap-2">
                  <Wand2 className="w-4 h-4 text-success" />
                  {t('apiFeedbackToModel')}
                </h3>
                <div className="flex-1 flex flex-col gap-2 min-h-0">
                  <textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    className="flex-1 bg-background border border-border/80 rounded-lg p-2.5 text-xs text-foreground resize-none focus:outline-none focus:border-success"
                    placeholder={t('requestChangesPlaceholder')}
                  />
                  {feedbackError && (
                    <div className="text-[11px] text-destructive bg-red-950/30 border border-red-900/50 rounded-lg p-2">
                      {feedbackError}
                    </div>
                  )}
                  <div className="flex justify-end">
                    <button 
                      onClick={handleSendFeedback}
                      disabled={isGenerating || !feedback.trim()}
                      className="px-3 py-1 bg-success hover:bg-success text-foreground rounded-lg font-medium text-[11px] transition-colors flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {isGenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                      {t('applyImprovements')}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Endpoints */}
            <div className="rounded-xl border border-border/50 bg-background p-4 flex flex-col overflow-hidden">
              <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2 shrink-0">
                <Server className="w-4 h-4 text-success" />
                {t('apiEndpointsCount').replace('{count}', String(endpoints.length))}
              </h3>
              <div className="flex-1 overflow-auto custom-scrollbar space-y-2">
                {endpoints.length > 0 ? endpoints.map((ep, idx) => (
                  <div 
                    key={idx}
                    onClick={() => setSelectedEndpointId(ep.id || idx)}
                    className={`bg-background rounded-lg p-3 border transition-colors cursor-pointer ${selectedEndpointId === (ep.id || idx) ? 'border-success bg-success/20' : 'border-border/80 hover:border-border/40'}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
                        ep.method === 'GET' ? 'bg-success/20 text-success' :
                        ep.method === 'POST' ? 'bg-primary/30 text-primary' :
                        ep.method === 'PUT' ? 'bg-yellow-900/30 text-warning' :
                        ep.method === 'DELETE' ? 'bg-red-900/30 text-destructive' :
                        'bg-muted text-foreground/80'
                      }`}>
                        {ep.method}
                      </span>
                      <p className="text-xs text-foreground font-medium truncate">{ep.path}</p>
                    </div>
                    {ep?.testTask?.title && (
                      <p className="text-[10px] text-cyan-300/80 truncate">{ep.testTask.title}</p>
                    )}
                    {ep.description && <p className="text-[10px] text-muted-foreground line-clamp-1">{ep.description}</p>}
                  </div>
                )) : (
                  <p className="text-xs text-muted-foreground/80 italic">{t('noEndpointsDetectedInCode')}</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Función para filtrar archivos críticos del proyecto
function filterCriticalFiles(files: File[], maxFiles: number = 6): File[] {
  const ignorePatterns = ['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '__tests__', '.test.', '.spec.'];

  // Filtrar archivos ignorados
  const filtered = files.filter(file => {
    const path = file.webkitRelativePath || file.name;
    return !ignorePatterns.some(pattern => path.includes(pattern));
  });

  // Detectar tipo de aplicación y seleccionar archivos principales
  const fileNames = filtered.map(f => f.webkitRelativePath || f.name);
  
  // Detectar tipo de aplicación
  const isNextJS = fileNames.some(f => f.includes('next.config.') || f.includes('next-env.d.ts'));
  const isReact = fileNames.some(f => f.includes('App.') || f.includes('index.') || f.includes('package.json'));
  const isNodeJS = fileNames.some(f => f.includes('server.js') || f.includes('index.js') || f.includes('app.js'));
  const isPython = fileNames.some(f => f.includes('requirements.txt') || f.includes('main.py') || f.includes('app.py'));
  const isGo = fileNames.some(f => f.includes('go.mod') || f.includes('main.go'));
  const isJava = fileNames.some(f => f.includes('pom.xml') || f.includes('build.gradle') || f.includes('Main.java'));
  const isRust = fileNames.some(f => f.includes('Cargo.toml') || f.includes('main.rs'));

  const priorityFiles: string[] = [];

  // Archivos comunes a todos los proyectos
  priorityFiles.push('package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml');
  priorityFiles.push('.env', '.env.local', '.env.example');
  priorityFiles.push('README.md', 'README');

  // Archivos específicos por tipo de aplicación
  if (isNextJS) {
    priorityFiles.push('next.config.js', 'next.config.mjs', 'next.config.ts');
    priorityFiles.push('app/layout.tsx', 'app/page.tsx', 'pages/_app.tsx', 'pages/index.tsx');
    priorityFiles.push('tailwind.config.js', 'tailwind.config.ts');
  } else if (isReact) {
    priorityFiles.push('src/App.tsx', 'src/App.jsx', 'App.tsx', 'App.jsx');
    priorityFiles.push('src/index.tsx', 'src/index.jsx', 'index.tsx', 'index.jsx');
    priorityFiles.push('vite.config.ts', 'vite.config.js', 'webpack.config.js');
  } else if (isNodeJS) {
    priorityFiles.push('server.js', 'index.js', 'app.js', 'main.js');
    priorityFiles.push('src/server.js', 'src/index.js', 'src/app.js');
  } else if (isPython) {
    priorityFiles.push('requirements.txt', 'pyproject.toml', 'setup.py');
    priorityFiles.push('main.py', 'app.py', 'src/main.py', 'src/app.py');
  } else if (isGo) {
    priorityFiles.push('go.mod', 'go.sum', 'main.go', 'cmd/main.go', 'src/main.go');
  } else if (isJava) {
    priorityFiles.push('pom.xml', 'build.gradle', 'src/main/java/Main.java');
  } else if (isRust) {
    priorityFiles.push('Cargo.toml', 'Cargo.lock', 'src/main.rs');
  }

  // Archivos generales importantes
  priorityFiles.push('tsconfig.json', 'tsconfig.json');
  priorityFiles.push('.gitignore', '.eslintrc.js', '.prettierrc');

  // Buscar archivos prioritarios
  const selectedFiles: File[] = [];
  const usedPaths = new Set<string>();

  for (const priorityFile of priorityFiles) {
    if (selectedFiles.length >= maxFiles) break;
    
    const found = filtered.find(f => {
      const path = f.webkitRelativePath || f.name;
      const fileName = path.split('/').pop() || path;
      return fileName === priorityFile || path.endsWith(priorityFile);
    });

    if (found && !usedPaths.has(found.webkitRelativePath || found.name)) {
      selectedFiles.push(found);
      usedPaths.add(found.webkitRelativePath || found.name);
    }
  }

  // Si no hay suficientes archivos prioritarios, agregar otros archivos importantes
  if (selectedFiles.length < maxFiles) {
    const criticalExtensions = ['.ts', '.tsx', '.js', '.jsx', '.json', '.py', '.go', '.java', '.rs'];
    const criticalPaths = ['src', 'lib', 'app', 'components', 'pages', 'api', 'server', 'config'];
    
    const remaining = filtered.filter(f => {
      const path = f.webkitRelativePath || f.name;
      if (usedPaths.has(path)) return false;
      
      const ext = path.substring(path.lastIndexOf('.'));
      const isInCriticalPath = criticalPaths.some(p => path.includes(p));
      const isCriticalExtension = criticalExtensions.includes(ext);
      
      return isInCriticalPath || isCriticalExtension;
    });

    selectedFiles.push(...remaining.slice(0, maxFiles - selectedFiles.length));
  }

  return selectedFiles.slice(0, maxFiles);
}

function ApiGeneratorModal({ isOpen, onClose, onProjectCreated, onProjectSelected, selectedModel }: { isOpen: boolean; onClose: () => void; onProjectCreated?: () => void; onProjectSelected?: (project: any) => void; selectedModel?: any }) {
  const { t } = useTranslation();
  const { token } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [folderScanning, setFolderScanning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isGeneratingDescription, setIsGeneratingDescription] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      initPocketBase();
    }
  }, [isOpen]);

  const onFolderPicked = (picked: File[]) => {
    if (!picked.length) return;
    setFolderScanning(true);
    setTimeout(() => {
      const filtered = filterCriticalFiles(picked, 6);
      setFiles(filtered);
      setFolderScanning(false);
    }, 500);
  };

  const handleGenerateDescription = async () => {
    if (!description.trim()) {
      setError('Por favor escribe una breve descripción de tu API antes de mejorarla con IA.');
      return;
    }

    if (!selectedModel) {
      setError('Por favor selecciona un modelo en la barra de navegación superior.');
      return;
    }

    setIsGeneratingDescription(true);
    setError(null);
    
    try {
      const requestBody = JSON.stringify({
        userDescription: description,
        modelId: selectedModel.id,
        appType: 'API REST'
      });

      const requestHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      };

      const tryImproveDescription = async (url: string) => {
        const response = await fetch(url, {
          method: 'POST',
          headers: requestHeaders,
          body: requestBody,
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          const message =
            typeof errData.error === 'string' && errData.error.trim()
              ? errData.error
              : `Error al mejorar la descripción con IA (HTTP ${response.status})`;
          throw new Error(message);
        }

        return response.json();
      };

      const descriptionUrls = [
        '/api/generate-api-description',
        'http://localhost:8742/api/generate-api-description',
        'http://localhost:8743/api/generate-api-description'
      ];

      let result: any = null;
      let lastErr: unknown = null;
      const attempts: string[] = [];

      for (const url of descriptionUrls) {
        try {
          result = await tryImproveDescription(url);
          attempts.push(`${url} -> OK`);
          break;
        } catch (err) {
          lastErr = err;
          attempts.push(`${url} -> ${err instanceof Error ? err.message : 'ERROR'}`);
        }
      }

      if (!result) {
        throw new Error(
          `No se pudo mejorar la descripción con IA. Intentos: ${attempts.join(' | ')}` +
            (lastErr instanceof Error ? ` (${lastErr.message})` : '')
        );
      }
      
      if (result.prompt) {
        // Limpiar la descripción de marcas innecesarias para el formulario
        const improved = result.prompt
          .replace(/\*\*/g, '')
          .replace(/(?<!\*)\*(?!\*)/g, '')
          .replace(/^---+$/gm, '')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
          
        setDescription(improved);
      }
      
    } catch (err) {
      console.error('Error generando descripción:', err);
      setError(err instanceof Error ? err.message : 'Error inesperado al mejorar la descripción');
    } finally {
      setIsGeneratingDescription(false);
    }
  };

  const handleGenerate = async () => {
    setError(null);
    if (!title.trim() || !description.trim()) {
      setError('Título y descripción son obligatorios.');
      return;
    }

    if (!selectedModel) {
      setError('Por favor selecciona un modelo en la aplicación.');
      return;
    }

    setLoading(true);
    try {
      const pb = getPocketBase();

      const buildGenerateFormData = () => {
        const fd = new FormData();
        fd.append('title', title.trim());
        fd.append('description', description.trim());
        fd.append('modelType', 'typescript');
        if (files && files.length > 0) {
          files.forEach((file) => {
            fd.append('files', file);
          });
        }
        return fd;
      };

      // 2. Preparar configuración del modelo para el header
      const modelConfig = {
        apiKey: selectedModel[MODELOS_FIELDS.API_KEY] || '',
        model: selectedModel[MODELOS_FIELDS.MODEL_NAME] || 'deepseek-chat',
        temperature: selectedModel[MODELOS_FIELDS.CONFIG]?.temperature || 0.7,
        maxTokens: selectedModel[MODELOS_FIELDS.CONFIG]?.max_tokens || 4000,
        apiBaseUrl: selectedModel[MODELOS_FIELDS.BASE_URL] || undefined,
        type: selectedModel[MODELOS_FIELDS.TYPE] || '',
        provider: selectedModel[MODELOS_FIELDS.PROVIDER] || '',
      };

      const modelConfigStr = JSON.stringify(modelConfig);

      // 3. Llamar a la API de generación con fallback de base URL
      const generateUrls = [
        'http://localhost:8742/api/generate-api/generate',
        'http://localhost:8743/api/generate-api/generate',
        '/api/generate-api/generate'
      ];

      let response: Response | null = null;
      let lastError: unknown = null;
      const attempts: string[] = [];

      for (const url of generateUrls) {
        try {
          const candidate = await fetch(url, {
            method: 'POST',
            headers: {
              'x-model-config': modelConfigStr,
              'Authorization': `Bearer ${token}`
            },
            body: buildGenerateFormData()
          });

          attempts.push(`${url} -> HTTP ${candidate.status}`);

          if (candidate.ok) {
            response = candidate;
            break;
          }

          if (candidate.status === 404 || candidate.status === 502 || candidate.status === 503) {
            continue;
          }

          response = candidate;
          break;
        } catch (err) {
          lastError = err;
          attempts.push(`${url} -> NETWORK ERROR`);
        }
      }

      if (!response) {
        const details = attempts.length > 0 ? ` Intentos: ${attempts.join(' | ')}` : '';
        throw new Error(
          lastError instanceof Error
            ? `No se pudo conectar al servidor de generación. ${lastError.message}.${details}`
            : `No se encontró un servidor de generación disponible.${details}`
        );
      }

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Error en la generación (${response.status})`);
      }

      const result = await response.json();
      console.log('✅ API Generada con éxito:', result);

      // Cerrar el modal después de generar exitosamente
      setTitle('');
      setDescription('');
      setFiles([]);
      onClose();
      
      if (onProjectCreated) {
        onProjectCreated();
      }

      // Abrir el proyecto generado directamente si se proporciona la función
      if (onProjectSelected && result) {
        onProjectSelected(result);
      }

    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Error al generar la API: ${msg}`);
      console.error('❌ Error al generar proyecto:', e);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-background border border-border/50 rounded-2xl shadow-2xl w-full max-w-lg p-6">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
        >
          <X className="w-5 h-5" />
        </button>
        
        <div className="flex flex-col items-center text-center mb-6">
          <Image
            src={zeusLogo}
            alt="Zeus Logo"
            width={64}
            height={64}
            className="w-16 h-16 mb-4 object-contain"
          />
          <h2 className="text-lg font-bold text-zeus-orange mb-2">Api Generator Zeus</h2>
          <p className="text-muted-foreground text-sm">Genera una API completa a partir de tu descripción</p>
        </div>

        <div className="space-y-4">
          {error && (
            <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-3 text-destructive text-xs">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-2">Modelo de IA (Seleccionado en Navbar)</label>
            <div className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border transition-colors ${selectedModel ? 'bg-success/5 border-success/20' : 'bg-card border-border/50'}`}>
              <div className={`w-2 h-2 rounded-full ${selectedModel ? 'bg-success animate-pulse' : 'bg-muted/80'}`} />
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">
                  {selectedModel ? (selectedModel[MODELOS_FIELDS.NAME] || selectedModel.name) : t('noModelSelected')}
                </p>
                {selectedModel && (
                  <p className="text-[10px] text-muted-foreground/80 uppercase tracking-wider">
                    {selectedModel[MODELOS_FIELDS.PROVIDER] || 'IA Provider'} · {selectedModel[MODELOS_FIELDS.MODEL_NAME] || 'Default'}
                  </p>
                )}
              </div>
              {!selectedModel && <AlertCircle className="w-4 h-4 text-destructive" />}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-2">Título del Proyecto</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('exampleAuthSystem')}
              className="w-full bg-card border border-border/50 rounded-lg px-4 py-2.5 text-foreground text-sm focus:outline-none focus:border-success"
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-xs font-medium text-muted-foreground">Descripción</label>
              <button
                type="button"
                onClick={handleGenerateDescription}
                disabled={isGeneratingDescription || !selectedModel}
                className="flex items-center gap-1.5 px-2 py-1 text-[10px] bg-success/20 text-success border border-success/30 rounded hover:bg-success/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={!selectedModel ? t('selectModelTopBar') : t('improveWithAI')}
              >
                {isGeneratingDescription ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Wand2 className="w-3 h-3" />
                )}
                Mejorar con IA
              </button>
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={description.length > 200 ? 10 : 5}
              placeholder="Describe con todo el detalle que necesites: recursos, reglas, auth, ejemplos JSON, errores, etc."
              className="w-full bg-card border border-border/50 rounded-lg px-4 py-2.5 text-foreground text-sm focus:outline-none focus:border-success resize-y transition-all"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-2">Carpeta del proyecto</label>
            <p className="text-muted-foreground/80 text-xs mb-3">
              Elige la carpeta completa del proyecto para el que quieres generar la API. Zeus incluirá los archivos necesarios para documentarse.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              disabled={folderScanning}
              {...({ webkitdirectory: '', directory: '' } as object)}
              onChange={(e) => {
                const picked = e.target.files?.length ? Array.from(e.target.files) : [];
                e.target.value = '';
                onFolderPicked(picked);
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={folderScanning}
              className="w-full border-2 border-dashed border-border/50 rounded-lg p-4 flex flex-col items-center cursor-pointer hover:border-success/50 transition-colors"
            >
              <div className="w-10 h-10 rounded-full bg-success/20 flex items-center justify-center text-success mb-2">
                {folderScanning ? (
                  <div className="w-5 h-5 border-2 border-success border-t-transparent rounded-full animate-spin" />
                ) : (
                  <FolderOpen className="w-5 h-5" />
                )}
              </div>
              <p className="text-sm text-foreground/80 text-center">
                {folderScanning ? 'Leyendo archivos de la carpeta…' : 'Elegir carpeta del proyecto'}
              </p>
              {files.length > 0 && !folderScanning ? (
                <p className="text-xs text-success mt-2 text-center">
                  {files.length} archivo{files.length === 1 ? '' : 's'} (carpeta y subcarpetas)
                </p>
              ) : null}
            </button>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              onClick={onClose}
              disabled={loading}
              className="flex-1 px-4 py-2.5 bg-card hover:bg-muted text-foreground rounded-lg font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancelar
            </button>
            <button
              onClick={handleGenerate}
              disabled={loading}
              className="flex-1 px-4 py-2.5 bg-success hover:bg-success text-foreground rounded-lg font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Generando…
                </>
              ) : (
                'Generar API'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}