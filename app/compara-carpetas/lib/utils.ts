import * as fs from 'fs/promises';
import * as path from 'path';

// --- TYPESCRIPT DEFINITIONS PARA SCANNING --- //

/**
 * @typedef {'file'|'directory'} FileType
 * Representa un ítem encontrado durante el escaneo.
 */
export type FileType = 'file' | 'directory';

/**
 * @typedef {object} FileItem
 * @property {string} fullPath - La ruta completa del archivo o directorio.
 * @property {string} name - El nombre del archivo o directorio.
 * @property {FileType} type - El tipo de ítem (file o directory).
 */
export interface FileItem {
  fullPath: string;
  name: string;
  type: FileType;
}

/**
 * @typedef {object} ScanError
 * @property {string} path - La ruta que generó el error.
 * @property {string} message - Descripción del error.
 * @property {string} code - Código de error del sistema (ej. 'EACCES').
 */
export interface ScanError {
  path: string;
  message: string;
  code: string;
}

/**
 * @typedef {object} ScanResult
 * @property {FileItem[]} items - Lista de archivos y directorios escaneados exitosamente.
 * @property {ScanError[]} errors - Lista de errores de acceso o sistema encontrados.
 */
export interface ScanResult {
  items: FileItem[];
  errors: ScanError[];
}

// --- CORE UTILITIES (EXISTING PATTERNS) ---

/**
 * Expande un objeto de clases de utilidad (Tailwind CSS).
 * (Manteniendo la función existente si es que proveía esta utilidad de clase)
 * @param cls - Las clases a combinar.
 * @param opts - Opciones de intersección.
 * @returns {string} Las clases combinadas.
 */
export function cn(...cls: (string | boolean | undefined | null)[]): string {
  return cls.filter(Boolean).join(' ');
}

/**
 * Función core para escanear de forma recursiva un directorio.
 * Esta función maneja robustamente errores de permisos o rutas inválidas.
 * @param rootPath - La ruta base del directorio a escanear.
 * @returns {Promise<ScanResult>} Un objeto que contiene la lista de ítems y los errores encontrados.
 * @throws {Error} Si el rootPath es inválido o no se puede iniciar el escaneo.
 */
export async function walkTree(rootPath: string): Promise<ScanResult> {
  const result: ScanResult = { items: [], errors: [] };

  try {
    // Verificar si la ruta inicial existe y es un directorio
    await fs.stat(rootPath);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Ruta raíz no accesible o inválida: ${rootPath}. Error: ${error.message}`);
    }
    throw new Error(`Error al verificar la ruta raíz: ${rootPath}`);
  }

  // Función recursiva interna
  const traverse = async (currentPath: string) => {
    try {
      const entries = await fs.readdir(currentPath);

      for (const entryName of entries) {
        const fullItemPath = path.join(currentPath, entryName);

        try {
          // Obtener estadísticas para determinar si es archivo o directorio
          const stats = await fs.stat(fullItemPath);

          const item: FileItem = { 
            fullPath: fullItemPath,
            name: entryName,
            type: stats.isDirectory() ? 'directory' : 'file',
          };
          result.items.push(item);

          if (stats.isDirectory()) {
            // Llamada recursiva para subdirectorios
            await traverse(fullItemPath);
          }
        } catch (error) {
          // Captura errores por ítem (ej. permisos denegados en un subdirectorio)
          const errorDetails = error instanceof Error ? error : new Error(String(error));
          result.errors.push({
            path: fullItemPath,
            message: `Error al acceder o leer el ítem: ${errorDetails.message}`,
            code: (errorDetails as any).code || 'UNKNOWN_ITEM_ERROR',
          });
        }
      }
    } catch (error) {
      // Captura errores de lectura de directorio completo (ej. carpeta bloqueada)
      const errorDetails = error instanceof Error ? error : new Error(String(error));
      result.errors.push({
        path: currentPath,
        message: `Error de sistema al leer directorio: ${errorDetails.message}`,
        code: (errorDetails as any).code || 'DIR_READ_ERROR',
      });
    }
  };

  // Iniciar el recorrido
  await traverse(rootPath);

  return result;
}

