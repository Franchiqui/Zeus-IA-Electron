// Definición y ejecución de tool calls nativas (estilo F:\Agent).
// Las tools se ejecutan server-side contra el cwd de la sesión activa.
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required: string[];
    };
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolResult {
  tool_call_id: string;
  role: 'tool';
  content: string;
}

// ── Definiciones de tools (formato OpenAI) ──────────────────────────────────

export const ZEUS_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        'Read a file from the project. Returns file content with line numbers. ' +
        'Use offset and limit for large files. Paths are relative to the project root (cwd).',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative path to the file (e.g. "app/page.tsx", "lib/utils.ts")',
          },
          offset: {
            type: 'number',
            description: 'Line number to start reading from (1-indexed, default 1)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of lines to read (default 2000)',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        'Create or overwrite a file in the project. Paths are relative to the project root (cwd). ' +
        'Creates parent directories if needed.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative path to the file (e.g. "app/page.tsx")',
          },
          content: {
            type: 'string',
            description: 'Full content of the file',
          },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description:
        'List the contents of a directory. Returns files and folders with metadata. ' +
        'Paths are relative to the project root (cwd). Use empty path "" for root.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative directory path (e.g. "app", "components", "" for root)',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_dir',
      description:
        'Create a directory (and parent directories if needed). Paths are relative to the project root (cwd).',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative directory path to create (e.g. "components/ui")',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description:
        'Delete a file or directory. Paths are relative to the project root (cwd).',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative path to delete',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description:
        'Search for a text pattern in files (grep-like). Returns matching lines with file paths and line numbers. ' +
        'Paths are relative to the project root (cwd).',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Text or regex pattern to search for',
          },
          path: {
            type: 'string',
            description: 'Directory to search in (default: project root)',
          },
          glob: {
            type: 'string',
            description: 'File pattern to match (e.g. "*.tsx", "*.ts"). Default: all files.',
          },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description:
        'Run a shell command in the project directory. Returns stdout, stderr and exit code. ' +
        'Use for installing packages, running builds, git operations, etc.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'Shell command to execute',
          },
        },
        required: ['command'],
      },
    },
  },
];

// ── Ejecución de tools ──────────────────────────────────────────────────────

// Path traversal guard
function safeResolve(cwd: string, relPath: string): string | null {
  if (!relPath || typeof relPath !== 'string') relPath = '';
  const cleaned = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (/(^|\/)\.\.(\/|$)/.test(cleaned)) return null;
  const base = path.resolve(cwd);
  const resolved = path.resolve(base, cleaned || '.');
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
  return resolved;
}

// read_file con paginación y números de línea (estilo F:\Agent)
async function executeReadFile(cwd: string, args: any): Promise<string> {
  const relPath = String(args.path || '');
  const offset = Math.max(1, Number(args.offset) || 1);
  const limit = Math.min(5000, Math.max(1, Number(args.limit) || 2000));

  const abs = safeResolve(cwd, relPath);
  if (!abs) return JSON.stringify({ error: 'Path no permitido' });

  try {
    if (!fs.existsSync(abs)) {
      return JSON.stringify({ error: `Archivo no encontrado: ${relPath}` });
    }
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      return JSON.stringify({ error: `'${relPath}' es un directorio, no un archivo` });
    }

    // Archivos binarios
    const ext = path.extname(abs).toLowerCase();
    const binaryExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp',
      '.pdf', '.zip', '.rar', '.7z', '.tar', '.gz', '.mp4', '.mp3', '.wav',
      '.exe', '.dll', '.so', '.dylib', '.bin', '.dat'];
    if (binaryExts.includes(ext)) {
      return JSON.stringify({
        error: `Archivo binario (${ext}). No se puede leer como texto.`,
        size: stat.size,
        path: relPath,
      });
    }

    const content = await fsp.readFile(abs, 'utf8');
    const lines = content.split('\n');
    const totalLines = lines.length;
    const start = Math.min(offset, totalLines);
    const end = Math.min(start + limit - 1, totalLines);
    const slice = lines.slice(start - 1, end);

    // Formato con números de línea (igual que read_file de F:\Agent)
    const numbered = slice
      .map((line, i) => `${String(start + i).padStart(6, ' ')}|${line}`)
      .join('\n');

    const header = `Archivo: ${relPath} (${totalLines} líneas, ${stat.size} bytes)\nMostrando líneas ${start}-${end} de ${totalLines}\n\n`;

    return header + numbered;
  } catch (err: any) {
    return JSON.stringify({ error: `Error al leer archivo: ${err.message}` });
  }
}

async function executeWriteFile(cwd: string, args: any): Promise<string> {
  const relPath = String(args.path || '');
  const content = String(args.content ?? '');

  const abs = safeResolve(cwd, relPath);
  if (!abs) return JSON.stringify({ error: 'Path no permitido' });

  try {
    const dir = path.dirname(abs);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(abs, content, 'utf8');
    const bytes = Buffer.byteLength(content, 'utf8');
    const lines = content.split('\n').length;
    return JSON.stringify({
      success: true,
      message: `Archivo escrito: ${relPath} (${lines} líneas, ${bytes} bytes)`,
    });
  } catch (err: any) {
    return JSON.stringify({ error: `Error al escribir: ${err.message}` });
  }
}

async function executeListDir(cwd: string, args: any): Promise<string> {
  const relPath = String(args.path || '');
  const abs = safeResolve(cwd, relPath);
  if (!abs) return JSON.stringify({ error: 'Path no permitido' });

  try {
    if (!fs.existsSync(abs)) {
      return JSON.stringify({ error: `Directorio no encontrado: ${relPath || '(raíz)'}` });
    }
    const entries = await fsp.readdir(abs, { withFileTypes: true });
    const items = entries
      .filter(e => e.name !== 'node_modules' && e.name !== '.next' && e.name !== '.git')
      .map(e => {
        const isDir = e.isDirectory();
        const fullPath = relPath ? `${relPath}/${e.name}` : e.name;
        return {
          name: e.name,
          path: fullPath,
          type: isDir ? 'directory' : 'file',
        };
      })
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    return JSON.stringify({
      success: true,
      path: relPath || '(raíz)',
      items,
      count: items.length,
    }, null, 2);
  } catch (err: any) {
    return JSON.stringify({ error: `Error al listar: ${err.message}` });
  }
}

async function executeCreateDir(cwd: string, args: any): Promise<string> {
  const relPath = String(args.path || '');
  const abs = safeResolve(cwd, relPath);
  if (!abs) return JSON.stringify({ error: 'Path no permitido' });

  try {
    await fsp.mkdir(abs, { recursive: true });
    return JSON.stringify({ success: true, message: `Directorio creado: ${relPath}` });
  } catch (err: any) {
    return JSON.stringify({ error: `Error al crear directorio: ${err.message}` });
  }
}

async function executeDeleteFile(cwd: string, args: any): Promise<string> {
  const relPath = String(args.path || '');
  const abs = safeResolve(cwd, relPath);
  if (!abs) return JSON.stringify({ error: 'Path no permitido' });
  if (abs === path.resolve(cwd)) return JSON.stringify({ error: 'No se puede borrar la raíz del proyecto' });

  try {
    if (!fs.existsSync(abs)) {
      return JSON.stringify({ error: `No encontrado: ${relPath}` });
    }
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      await fsp.rm(abs, { recursive: true });
    } else {
      await fsp.unlink(abs);
    }
    return JSON.stringify({ success: true, message: `Eliminado: ${relPath}` });
  } catch (err: any) {
    return JSON.stringify({ error: `Error al eliminar: ${err.message}` });
  }
}

async function executeSearchFiles(cwd: string, args: any): Promise<string> {
  const pattern = String(args.pattern || '');
  const relPath = String(args.path || '');
  const glob = String(args.glob || '');
  if (!pattern) return JSON.stringify({ error: 'Pattern requerido' });

  const abs = safeResolve(cwd, relPath);
  if (!abs) return JSON.stringify({ error: 'Path no permitido' });

  try {
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, 'i');
    } catch {
      regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }

    const results: Array<{ file: string; line: number; content: string }> = [];
    const skipDirs = new Set(['node_modules', '.next', '.git', 'dist', 'build', '.venv']);

    // Si el path apunta a un ARCHIVO (los modelos suelen pasarlo), buscar
    // solo en ese archivo en vez de hacer scandir (ENOTDIR).
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      if (glob && !path.basename(abs).match(globToRegex(glob))) {
        return JSON.stringify({ success: true, results, count: 0 }, null, 2);
      }
      try {
        const content = await fsp.readFile(abs, 'utf8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length && results.length < 100; i++) {
          if (regex.test(lines[i])) {
            results.push({ file: relPath, line: i + 1, content: lines[i].trim().slice(0, 200) });
          }
        }
      } catch { /* skip binary/unreadable */ }
      return JSON.stringify({ success: true, results, count: results.length }, null, 2);
    }

    async function walk(dir: string, relBase: string) {
      if (results.length >= 100) return;
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= 100) return;
        if (skipDirs.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(full, rel);
        } else {
          if (glob && !entry.name.match(globToRegex(glob))) continue;
          try {
            const content = await fsp.readFile(full, 'utf8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length && results.length < 100; i++) {
              if (regex.test(lines[i])) {
                results.push({ file: rel, line: i + 1, content: lines[i].trim().slice(0, 200) });
              }
            }
          } catch { /* skip binary/unreadable */ }
        }
      }
    }

    await walk(abs, relPath);
    return JSON.stringify({ success: true, results, count: results.length }, null, 2);
  } catch (err: any) {
    return JSON.stringify({ error: `Error en búsqueda: ${err.message}` });
  }
}

function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.*+?^${}()|[\]\\]/g, c => c === '*' ? '.*' : c === '?' ? '.' : '\\' + c);
  return new RegExp('^' + escaped + '$');
}

async function executeRunCommand(cwd: string, args: any): Promise<string> {
  const command = String(args.command || '');
  if (!command) return JSON.stringify({ error: 'Comando requerido' });

  try {
    const { exec } = require('child_process') as typeof import('child_process');
    const result = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
      exec(command, {
        cwd,
        maxBuffer: 1024 * 1024 * 5,
        timeout: 60000,
      }, (err, stdout, stderr) => {
        resolve({
          stdout: stdout?.slice(0, 10000) || '',
          stderr: stderr?.slice(0, 5000) || '',
          code: err ? (err as any).code || 1 : 0,
        });
      });
    });
    return JSON.stringify({
      success: result.code === 0,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.code,
    }, null, 2);
  } catch (err: any) {
    return JSON.stringify({ error: `Error al ejecutar comando: ${err.message}` });
  }
}

// ── Dispatcher ──────────────────────────────────────────────────────────────

export async function executeTool(
  toolName: string,
  args: Record<string, any>,
  cwd: string
): Promise<string> {
  try {
    switch (toolName) {
      case 'read_file':
        return await executeReadFile(cwd, args);
      case 'write_file':
        return await executeWriteFile(cwd, args);
      case 'list_dir':
        return await executeListDir(cwd, args);
      case 'create_dir':
        return await executeCreateDir(cwd, args);
      case 'delete_file':
        return await executeDeleteFile(cwd, args);
      case 'search_files':
        return await executeSearchFiles(cwd, args);
      case 'run_command':
        return await executeRunCommand(cwd, args);
      default:
        return JSON.stringify({ error: `Tool desconocida: ${toolName}` });
    }
  } catch (err: any) {
    return JSON.stringify({ error: `Error ejecutando ${toolName}: ${err.message}` });
  }
}