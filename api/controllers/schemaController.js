const fs = require('fs-extra');
const path = require('path');
const { getSessionCwd } = require('../middleware/sessionCwd');

/**
 * Genera un esquema completo de archivos y carpetas en el cwd de sesión o en una ruta específica
 * Si se proporciona una ruta, muestra solo el contenido directo (no recursivo)
 * Si no se proporciona ruta, muestra el esquema completo recursivo del cwd
 */
const generateSchema = async (req, res) => {
  try {
    const DATA_DIR = getSessionCwd(req);
    if (!DATA_DIR) {
      return res.status(400).json({ error: 'No hay sesión activa. Selecciona una carpeta de proyecto.' });
    }
    // Obtener la ruta del query parameter, si no usar el cwd de sesión
    const requestedPath = req.query.path;
    let targetPath = DATA_DIR;

    if (requestedPath) {
      // Si se proporciona una ruta, combinarla con el cwd de sesión
      targetPath = path.join(DATA_DIR, requestedPath);
      // Mostrar solo el contenido directo (no recursivo)
      const schema = await buildDirectorySchemaDirect(targetPath, requestedPath);
      res.json({
        success: true,
        dataPath: targetPath,
        relativePath: requestedPath || '',
        schema: schema,
        generatedAt: new Date().toISOString()
      });
    } else {
      // Si no hay ruta, mostrar esquema completo recursivo del cwd
      const schema = await buildDirectorySchema(DATA_DIR, '');
      res.json({
        success: true,
        dataPath: DATA_DIR,
        relativePath: '',
        schema: schema,
        generatedAt: new Date().toISOString()
      });
    }
  } catch (error) {
    res.status(500).json({
      error: 'Failed to generate schema: ' + error.message
    });
  }
};

/**
 * Construye el esquema del directorio solo con contenido directo (no recursivo)
 */
const buildDirectorySchemaDirect = async (dirPath, relativePath = '') => {
  try {
    const items = await fs.readdir(dirPath);
    const schema = {
      name: relativePath || 'root',
      path: relativePath || '',
      fullPath: dirPath,
      type: 'directory',
      children: [],
      stats: null
    };

    // Obtener estadísticas del directorio
    try {
      const stats = await fs.stat(dirPath);
      schema.stats = {
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        accessed: stats.atime
      };
    } catch (statError) {
      // Ignorar error de estadísticas
    }

    // Procesar cada item en el directorio (solo nivel directo)
    for (const item of items) {
      const itemPath = path.join(dirPath, item);
      const itemRelativePath = relativePath ? path.join(relativePath, item) : item;

      try {
        const stats = await fs.stat(itemPath);

        if (stats.isDirectory()) {
          // Es un directorio, agregar sin procesar recursivamente
          const childSchema = {
            name: item,
            path: itemRelativePath,
            fullPath: itemPath,
            type: 'directory',
            children: [],
            stats: {
              size: stats.size,
              created: stats.birthtime,
              modified: stats.mtime,
              accessed: stats.atime
            }
          };
          schema.children.push(childSchema);
        } else {
          // Es un archivo
          const fileSchema = {
            name: item,
            path: itemRelativePath,
            fullPath: itemPath,
            type: 'file',
            extension: path.extname(item).toLowerCase(),
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime,
            accessed: stats.atime,
            preview: null
          };

          // Intentar obtener preview para archivos de texto comunes
          const textExtensions = ['.txt', '.js', '.ts', '.jsx', '.tsx', '.json', '.md', '.py', '.html', '.css', '.xml', '.yaml', '.yml', '.env', '.gitignore'];
          if (textExtensions.includes(fileSchema.extension) && stats.size < 50000) {
            try {
              const content = await fs.readFile(itemPath, 'utf8');
              fileSchema.preview = content.substring(0, 500) + (content.length > 500 ? '...' : '');
              fileSchema.lines = content.split('\n').length;
            } catch (readError) {
              fileSchema.preview = '[Binary file or unreadable]';
            }
          }

          schema.children.push(fileSchema);
        }
      } catch (itemError) {
        schema.children.push({
          name: item,
          path: itemRelativePath,
          fullPath: itemPath,
          type: 'error',
          error: itemError.message
        });
      }
    }

    // Ordenar children
    schema.children.sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;
      if (a.type === 'error' && b.type !== 'error') return 1;
      if (a.type !== 'error' && b.type === 'error') return -1;
      return a.name.localeCompare(b.name);
    });

    // Agregar estadísticas del directorio
    const fileCount = schema.children.filter(c => c.type === 'file').length;
    const dirCount = schema.children.filter(c => c.type === 'directory').length;
    const errorCount = schema.children.filter(c => c.type === 'error').length;

    schema.stats = {
      ...schema.stats,
      fileCount,
      dirCount,
      errorCount,
      totalItems: schema.children.length
    };

    return schema;
  } catch (error) {
    throw new Error(`Failed to build direct schema for ${dirPath}: ${error.message}`);
  }
};

/**
 * Construye recursivamente el esquema del directorio
 */
const buildDirectorySchema = async (dirPath, relativePath = '') => {
  try {
    const items = await fs.readdir(dirPath);
    const schema = {
      name: relativePath || 'root',
      path: relativePath || '',
      fullPath: dirPath,
      type: 'directory',
      children: [],
      stats: null
    };

    // Obtener estadísticas del directorio
    try {
      const stats = await fs.stat(dirPath);
      schema.stats = {
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        accessed: stats.atime
      };
    } catch (statError) {
      // Ignorar error de estadísticas
    }

    // Procesar cada item en el directorio
    for (const item of items) {
      const itemPath = path.join(dirPath, item);
      const itemRelativePath = relativePath ? path.join(relativePath, item) : item;
      
      try {
        const stats = await fs.stat(itemPath);
        
        if (stats.isDirectory()) {
          // Es un directorio, procesar recursivamente
          const childSchema = await buildDirectorySchema(itemPath, itemRelativePath);
          schema.children.push(childSchema);
        } else {
          // Es un archivo
          const fileSchema = {
            name: item,
            path: itemRelativePath,
            fullPath: itemPath,
            type: 'file',
            extension: path.extname(item).toLowerCase(),
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime,
            accessed: stats.atime,
            // Para archivos de texto, incluir un preview del contenido
            preview: null
          };

          // Intentar obtener preview para archivos de texto comunes
          const textExtensions = ['.txt', '.js', '.ts', '.jsx', '.tsx', '.json', '.md', '.py', '.html', '.css', '.xml', '.yaml', '.yml', '.env', '.gitignore'];
          if (textExtensions.includes(fileSchema.extension) && stats.size < 50000) { // Solo archivos < 50KB
            try {
              const content = await fs.readFile(itemPath, 'utf8');
              fileSchema.preview = content.substring(0, 500) + (content.length > 500 ? '...' : '');
              fileSchema.lines = content.split('\n').length;
            } catch (readError) {
              // No se pudo leer el archivo, probablemente binario
              fileSchema.preview = '[Binary file or unreadable]';
            }
          }

          schema.children.push(fileSchema);
        }
      } catch (itemError) {
        // No se pudo acceder a este item, agregar como error
        schema.children.push({
          name: item,
          path: itemRelativePath,
          fullPath: itemPath,
          type: 'error',
          error: itemError.message
        });
      }
    }

    // Ordenar children: directorios primero, luego archivos, ambos alfabéticamente
    schema.children.sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;
      if (a.type === 'error' && b.type !== 'error') return 1;
      if (a.type !== 'error' && b.type === 'error') return -1;
      return a.name.localeCompare(b.name);
    });

    // Agregar estadísticas del directorio
    const fileCount = schema.children.filter(c => c.type === 'file').length;
    const dirCount = schema.children.filter(c => c.type === 'directory').length;
    const errorCount = schema.children.filter(c => c.type === 'error').length;
    
    schema.stats = {
      ...schema.stats,
      fileCount,
      dirCount,
      errorCount,
      totalItems: schema.children.length
    };

    return schema;
  } catch (error) {
    throw new Error(`Failed to build schema for ${dirPath}: ${error.message}`);
  }
};

/**
 * Obtiene un esquema simplificado (solo estructura de carpetas)
 */
const getSimpleSchema = async (req, res) => {
  try {
    const DATA_DIR = getSessionCwd(req);
    if (!DATA_DIR) {
      return res.status(400).json({ error: 'No hay sesión activa. Selecciona una carpeta de proyecto.' });
    }
    const schema = await buildSimpleDirectorySchema(DATA_DIR);

    res.json({
      success: true,
      dataPath: DATA_DIR,
      schema: schema,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to generate simple schema: ' + error.message 
    });
  }
};

/**
 * Construye esquema simplificado (solo carpetas y nombres de archivos)
 */
const buildSimpleDirectorySchema = async (dirPath, relativePath = '', maxDepth = 10) => {
  if (maxDepth <= 0) return null;
  
  try {
    const items = await fs.readdir(dirPath);
    const schema = {
      name: relativePath || 'root',
      path: relativePath || '',
      type: 'directory',
      children: []
    };

    // Carpetas a ignorar para no saturar el contexto
    const ignoredFolders = ['node_modules', '.next', '.git', 'dist', 'build', '.vscode'];

    for (const item of items) {
      if (ignoredFolders.includes(item)) continue;

      const itemPath = path.join(dirPath, item);
      const itemRelativePath = relativePath ? path.join(relativePath, item) : item;
      
      try {
        const stats = await fs.stat(itemPath);
        
        if (stats.isDirectory()) {
          const childSchema = await buildSimpleDirectorySchema(itemPath, itemRelativePath, maxDepth - 1);
          if (childSchema) {
            schema.children.push(childSchema);
          }
        } else {
          schema.children.push({
            name: item,
            path: itemRelativePath,
            type: 'file',
            extension: path.extname(item).toLowerCase(),
            size: stats.size
          });
        }
      } catch (itemError) {
        // Ignorar errores individuales
      }
    }

    schema.children.sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;
      return a.name.localeCompare(b.name);
    });

    return schema;
  } catch (error) {
    return null;
  }
};

module.exports = {
  generateSchema,
  getSimpleSchema,
  buildDirectorySchema,
  buildSimpleDirectorySchema,
  buildDirectorySchemaDirect
};
