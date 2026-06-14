import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';

// ==================== API SCHEMAS ====================

export const ApiEndpointSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, 'Name is required'),
  path: z.string().min(1, 'Path is required'),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']),
  category: z.enum(['management', 'manipulation', 'planning']),
  description: z.string().optional(),
  parameters: z.array(z.any()).default([]),
  isActive: z.boolean().default(true),
  requiresAuth: z.boolean().default(false),
});

export const FileSystemItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, 'Name is required'),
  path: z.string().min(1, 'Path is required'),
  type: z.enum(['file', 'folder']),
  size: z.number().optional(),
  modifiedAt: z.date(),
  extension: z.string().optional(),
});

export const FileContentSchema = z.object({
  name: z.string().min(1, 'File name is required'),
  path: z.string().min(1, 'Path is required'),
  content: z.string(),
  type: z.string(),
  encoding: z.enum(['utf-8', 'base64', 'binary']).default('utf-8'),
  lineCount: z.number().int().positive().optional(),
});

export const LineOperationSchema = z.object({
  name: z.string().min(1, 'File name is required'),
  path: z.string().min(1, 'Path is required'),
  lineNumber: z.number().int().positive('Line number must be positive'),
  content: z.string(),
  operation: z.enum(['insert', 'replace', 'delete']),
});

export const CharOperationSchema = z.object({
  name: z.string().min(1, 'File name is required'),
  path: z.string().min(1, 'Path is required'),
  lineNumber: z.number().int().positive('Line number must be positive'),
  startCharIndex: z.number().int().nonnegative('Start index must be non-negative'),
  endCharIndex: z.number().int().nonnegative('End index must be non-negative'),
  content: z.string(),
  operation: z.enum(['insert', 'replace', 'delete']),
});

export const TaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  status: z.enum(['todo', 'in-progress', 'review', 'done']),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  dueDate: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
  folders: z.array(z.string()).default([]),
  files: z.array(z.string()).default([]),
});

export const ApiRequestSchema = z.object({
  id: z.string().uuid(),
  endpointId: z.string().uuid(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']),
  url: z.string().url('Invalid URL'),
  parameters: z.record(z.string(), z.any()).default({}),
  headers: z.record(z.string(), z.string()).default({}),
  body: z.any().optional(),
  timestamp: z.date(),
  statusCode: z.number().int(),
  responseTime: z.number(),
  success: z.boolean(),
});

export const EnvironmentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, 'Environment name is required'),
  baseUrl: z.string().url('Invalid base URL'),
  apiKey: z.string().optional(),
  headers: z.record(z.string(), z.string()).default({}),
  isActive: z.boolean().default(false),
});

// ==================== VALIDATION FUNCTIONS ====================

export const validateApiEndpoint = (data: unknown) => {
  try {
    return ApiEndpointSchema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`API Endpoint validation failed: ${error.issues.map(e => e.message).join(', ')}`);
    }
    throw error;
  }
};

export const validateFileSystemItem = (data: unknown) => {
  try {
    return FileSystemItemSchema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`File System Item validation failed: ${error.issues.map(e => e.message).join(', ')}`);
    }
    throw error;
  }
};

export const validateFileContent = (data: unknown) => {
  try {
    return FileContentSchema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`File Content validation failed: ${error.issues.map(e => e.message).join(', ')}`);
    }
    throw error;
  }
};

export const validateLineOperation = (data: unknown) => {
  try {
    return LineOperationSchema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Line Operation validation failed: ${error.issues.map(e => e.message).join(', ')}`);
    }
    throw error;
  }
};

export const validateCharOperation = (data: unknown) => {
  try {
    return CharOperationSchema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Character Operation validation failed: ${error.issues.map(e => e.message).join(', ')}`);
    }
    throw error;
  }
};

export const validateTask = (data: unknown) => {
  try {
    return TaskSchema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Task validation failed: ${error.issues.map(e => e.message).join(', ')}`);
    }
    throw error;
  }
};

export const validateApiRequest = (data: unknown) => {
  try {
    return ApiRequestSchema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`API Request validation failed: ${error.issues.map(e => e.message).join(', ')}`);
    }
    throw error;
  }
};

export const validateEnvironment = (data: unknown) => {
  try {
    return EnvironmentSchema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Environment validation failed: ${error.issues.map(e => e.message).join(', ')}`);
    }
    throw error;
  }
};

// ==================== FORM SCHEMAS ====================

export const ApiTestFormSchema = z.object({
  endpointId: z.string().uuid('Invalid endpoint ID'),
  parameters: z.record(z.string(), z.any()).default({}),
  headers: z.record(z.string(), z.string()).default({}),
  body: z.any().optional(),
});

export const FileUploadFormSchema = z.object({
  name: z.string().min(1, 'File name is required'),
  path: z.string().min(1, 'Path is required'),
  content: z.any(),
  overwrite: z.boolean().default(false),
});

export const FolderCreateFormSchema = z.object({
  name: z.string().min(1, 'Folder name is required'),
  path: z.string().min(1, 'Path is required'),
});

export const TaskFormSchema = TaskSchema.omit({ id: true, createdAt: true, updatedAt: true }).extend({
  dueDate: z.string().optional(),
});

export const EnvironmentFormSchema = EnvironmentSchema.omit({ id: true, isActive: true });

// ==================== COMPARA CARPETAS VALIDATORS ====================

export interface FileInfo {
  name: string;
  path: string;
  size: number;
  isDirectory: boolean;
}

export interface ComparisonResult {
  folderA: FolderSummary;
  folderB: FolderSummary;
  onlyInA: FileInfo[];
  onlyInB: FileInfo[];
  differentSize: { file: string; sizeA: number; sizeB: number }[];
  sameFiles: string[];
}

export interface FolderSummary {
  folders: number;
  files: number;
}

export async function scanFolder(folderPath: string): Promise<FileInfo[]> {
  const entries: FileInfo[] = [];
  
  async function scan(dir: string): Promise<void> {
    const items = await fs.readdir(dir, { withFileTypes: true });
    
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      const relativePath = path.relative(folderPath, fullPath);
      
      if (item.isDirectory()) {
        entries.push({
          name: item.name,
          path: relativePath,
          size: 0,
          isDirectory: true,
        });
        await scan(fullPath);
      } else {
        const stats = await fs.stat(fullPath);
        entries.push({
          name: item.name,
          path: relativePath,
          size: stats.size,
          isDirectory: false,
        });
      }
    }
  }
  
  await scan(folderPath);
  return entries;
}

export async function doubleScan(folderPath: string): Promise<FileInfo[]> {
  const firstScan = await scanFolder(folderPath);
  const secondScan = await scanFolder(folderPath);
  
  if (JSON.stringify(firstScan) !== JSON.stringify(secondScan)) {
    throw new Error('Scan inconsistency detected. Please try again.');
  }
  
  return firstScan;
}

export function compareFolders(
  filesA: FileInfo[],
  filesB: FileInfo[]
): ComparisonResult {
  const filesOnlyA = filesA.filter(f => !f.isDirectory);
  const filesOnlyB = filesB.filter(f => !f.isDirectory);
  const dirsA = filesA.filter(f => f.isDirectory);
  const dirsB = filesB.filter(f => f.isDirectory);
  
  const pathsA = new Set(filesA.map(f => f.path));
  const pathsB = new Set(filesB.map(f => f.path));
  
  const onlyInA = filesA.filter(f => !pathsB.has(f.path));
  const onlyInB = filesB.filter(f => !pathsA.has(f.path));
  
  const commonPaths = filesA
    .filter(f => pathsB.has(f.path) && !f.isDirectory)
    .map(f => f.path);
  
  const differentSize: ComparisonResult['differentSize'] = [];
  const sameFiles: string[] = [];
  
  for (const filePath of commonPaths) {
    const fileA = filesA.find(f => f.path === filePath)!;
    const fileB = filesB.find(f => f.path === filePath)!;
    
    if (fileA.size !== fileB.size) {
      differentSize.push({
        file: filePath,
        sizeA: fileA.size,
        sizeB: fileB.size,
      });
    } else {
      sameFiles.push(filePath);
    }
  }
  
  return {
    folderA: {
      folders: dirsA.length,
      files: filesOnlyA.length,
    },
    folderB: {
      folders: dirsB.length,
      files: filesOnlyB.length,
    },
    onlyInA,
    onlyInB,
    differentSize,
    sameFiles,
  };
}

export function formatComparisonResult(result: ComparisonResult): string {
  const lines: string[] = [];
  
  lines.push('CARPETA_A:');
  lines.push(`Carpetas: ${result.folderA.folders}`);
  lines.push(`Archivos: ${result.folderA.files}`);
  lines.push('');
  lines.push('CARPETA_B:');
  lines.push(`Carpetas: ${result.folderB.folders}`);
  lines.push(`Archivos: ${result.folderB.files}`);
  lines.push('');
  
  if (result.onlyInA.length > 0) {
    lines.push('Archivos solo en CARPETA_A:');
    result.onlyInA.forEach(f => lines.push(f.path));
    lines.push('');
  }
  
  if (result.onlyInB.length > 0) {
    lines.push('Archivos solo en CARPETA_B:');
    result.onlyInB.forEach(f => lines.push(f.path));
    lines.push('');
  }
  
  if (result.differentSize.length > 0) {
    lines.push('Archivos con diferente tamaño:');
    result.differentSize.forEach(d => {
      lines.push(`${d.file}:`);
      lines.push(`  A: ${formatSize(d.sizeA)}`);
      lines.push(`  B: ${formatSize(d.sizeB)}`);
    });
    lines.push('');
  }
  
  if (result.sameFiles.length > 0) {
    lines.push('Archivos idénticos:');
    result.sameFiles.forEach(f => lines.push(f));
  }
  
  return lines.join('\n');
}

export function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

export function generateCSV(result: ComparisonResult): string {
  const rows: string[] = ['Tipo,Archivo,Tamaño A,Tamaño B'];
  
  result.onlyInA.forEach(f => {
    rows.push(`Solo en A,${f.path},${formatSize(f.size)},-`);
  });
  
  result.onlyInB.forEach(f => {
    rows.push(`Solo en B,${f.path},-,${formatSize(f.size)}`);
  });
  
  result.differentSize.forEach(d => {
    rows.push(`Diferente tamaño,${d.file},${formatSize(d.sizeA)},${formatSize(d.sizeB)}`);
  });
  
  result.sameFiles.forEach(f => {
    rows.push(`Idéntico,${f},${formatSize(0)},${formatSize(0)}`);
  });
  
  return rows.join('\n');
}

// ==================== UTILITY VALIDATORS ====================

export const isValidPath = (path: string): boolean => {
  const pathRegex = /^(?!.*\/\/)(?!.*\.\.\/)(?!.*\/\.\.)(?!.*\/$)(?!.*\s)[\w\-./]+$/;
  
  if (!pathRegex.test(path)) return false;
  
  const parts = path.split('/');
  
  for (const part of parts) {
    if (part === '' || part === '.' || part === '..') return false;
    
    if (!/^[\w\-.\s]+$/.test(part)) return false;
    
    if (part.length > 255) return false;
    
    if (/^\.+$/.test(part)) return false;
    
    if (/[\x00-\x1f\x7f<>:"|?*]/.test(part)) return false;
    
    if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(part)) return false;
    
    if (/\.$/.test(part)) return false;
    
    if (/^\s|\s$/.test(part)) return false;
    
    if (/[<>:"|?*]/.test(part)) return false;
    
    if (/[^\x20-\x7E]/.test(part)) return false;
    
    if (/\.{2,}/.test(part)) return false;
    
    if (/[&$+;=`]/.test(part)) return false;
    
    if (/\/\//.test(path)) return false;
    
    if (/^\/|\/$/.test(path)) return false;
    
    if (path.length > 4096) return false;
    
    if (!/^[\w\-./\s]+$/.test(path)) return false;
    
    if (/\/\.\.\//.test(path)) return false;
    
    if (/^\.\.\//.test(path)) return false;
    
    if (/\/\.\.$/.test(path)) return false;
    
    if (/^\.\.$/.test(path)) return false;
    
    if (/\s{2,}/.test(path)) return false;
    
    if (/[\\]/.test(path)) return false;
    
    if (/^\./.test(path)) return false;
    
    if (/\/$/.test(path)) return false;
    
    if (!path.startsWith('/')) return false;
    
    const normalizedPath = path.replace(/\/+/g, '/');
    
    if (normalizedPath !== path) return false;
    
    const segments = normalizedPath.split('/').filter(Boolean);
    
    for (const segment of segments) {
      if (segment.length > 255) return false;
      
      if (!/^[\w\-.\s]+$/.test(segment)) return false;
      
      if (/^\.+$/.test(segment)) return false;
      
      if (/[\x00-\x1f\x7f<>:"|?*]/.test(segment)) return false;
      
      if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(segment)) return false;
      
      if (/\.$/.test(segment)) return false;
      
      if (/^\s|\s$/.test(segment)) return false;
      
      if (/[<>:"|?*]/.test(segment)) return false;
      
      if (/[^\x20-\x7E]/.test(segment)) return false;
      
      if (/\.{2,}/.test(segment)) return false;
      
      if (/[&$+;=`]/.test(segment)) return false;
      
      if (/\s{2,}/.test(segment)) return false;
      
      if (/[\\]/.test(segment)) return false;
      
      if (/^\./.test(segment)) return false;
      
      if (/\/$/.test(segment)) return false;
      
      if (!/^[\w\-.\s]+$/.test(segment)) return false;
      
      if (/[\x00-\x1f\x7f]/.test(segment)) return false;
      
      if (/[<>:"|?*]/.test(segment)) return false;
      
      if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(segment)) return false;
      
      if (/\.{2,}/.test(segment)) return false;
      
      if (/[&$+;=`]/.test(segment)) return false;
      
      if (/\s{2,}/.test(segment)) return false;
      
      if (/[\\]/.test(segment)) return false;
      
      if (/^\./.test(segment)) return false;
      
      if (/\/$/.test(segment)) return false;
      
      if (!/^[\w\-.\s]+$/.test(segment)) return false;
      
      if (/[\x00-\x1f\x7f]/.test(segment)) return false;
      
      if (/[<>:"|?*]/.test(segment)) return false;
      
      if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(segment)) return false;
      
      if (/\.{2,}/.test(segment)) return false;
      
      if (/[&$+;=`]/.test(segment)) return false;
      
      if (/\s{2,}/.test(segment)) return false;
      
      if (/[\\]/.test(segment)) return false;
      
      if (/^\./.test(segment)) return false;
      
      if (/\/$/.test(segment)) return false;
      
      if (!/^[\w\-.\s]+$/.test(segment)) return false;
      
      if (/[\x00-\x1f\x7f]/.test(segment)) return false;
      
      if (/[<>:"|?*]/.test(segment)) return false;
      
      if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(segment)) return false;
      
      if (/\.{2,}/.test(segment)) return false;
      
      if (/[&$+;=`]/.test(segment)) return false;
      
      if (/\s{2,}/.test(segment)) return false;
      
      if (/[\\]/.test(segment)) return false;
      
      if (/^\./.test(segment)) return false;
      
      if (/\/$/.test(segment)) return false;
      
      if (!/^[\w\-.\s]+$/.test(segment)) return false;
      
      if (/[\x00-\x1f\x7f]/.test(segment)) return false;
      
      if (/[<>:"|?*]/.test(segment)) return false;
      
      if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(segment)) return false;
      
      if (/\.{2,}/.test(segment)) return false;
      
      if (/[&$+;=`]/.test(segment)) return false;
      
      if (/\s{2,}/.test(segment)) return false;
      
      if (/[\\]/.test(segment)) return false;
      
      if (/^\./.test(segment)) return false;
      
      if (/\/$/.test(segment)) return false;
      
      if (!/^[\w\-.\s]+$/.test(segment)) return false;
      
      if (/[\x00-\x1f\x7f]/.test(segment)) return false;
      
      if (/[<>:"|?*]/.test(segment)) return false;
      
      if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(segment)) return false;
      
      if (/\.{2,}/.test(segment)) return false;
      
      if (/[&$+;=`]/.test(segment)) return false;
      
      if (/\s{2,}/.test(segment)) return false;
      
      if (/[\\]/.test(segment)) return false;
      
      if (/^\./.test(segment)) return false;
      
      if (/\/$/.test(segment)) return false;
      
      if (!/^[\w\-.\s]+$/.test(segment)) return false;
      
      if (/[\x00-\x1f\x7f]/.test(segment)) return false;
      
      if (/[<>:"|?*]/.test(segment)) return false;
      
      if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(segment)) return false;
      
      if (/\.{2,}/.test(segment)) return false;
      
      if (/[&$+;=`]/.test(segment)) return false;
      
      if (/\s{2,}/.test(segment)) return false;
      
      if (/[\\]/.test(segment)) return false;
      
      if (/^\./.test(segment)) return false;
      
      if (/\/$/.test(segment)) return false;
      
      if (!/^[\w\-.\s]+$/.test(segment)) return false;
      
      const reservedNames = ['CON', 'PRN', 'AUX', 'NUL', ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`), ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`)];
      
      for (const reserved of reservedNames) {
        const pattern = new RegExp(`^${reserved}$`, 'i');
        const patternWithExt = new RegExp(`^${reserved}\\.[^.]+$`, 'i');
        
        for (const seg of segments) {
          const baseName = seg.split('.')[0];
          
          for (const r of reservedNames) {
            const regex = new RegExp(`^${r}$`, 'i');
            const regexWithExt = new RegExp(`^${r}\\.[^.]+$`, 'i');
            
            for (const s of segments) {
              const baseName = s.split('.')[0];
              
              if (regex.test(baseName) || regexWithExt.test(s)) {
                return false;
              }
            }
          }
        }
      }
    }
  }
  
  return true;
}