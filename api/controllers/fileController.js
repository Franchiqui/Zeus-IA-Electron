const fs = require('fs-extra');
const path = require('path');
const { saveTaskToPlan } = require('./planController');
const { safeWriteFile } = require('../../utils/fileOps');
const { getSessionCwd } = require('../middleware/sessionCwd');

// El cwd de trabajo se ancla por sesión (header X-Zeus-Session), no a un
// DATA_PATH global. Cada handler lo resuelve desde req.
const getDataDir = (req) => getSessionCwd(req);

// Función auxiliar para extraer el path de forma flexible
const extractPath = (req) => {
  // Intentar obtener de query parameters primero
  if (req.query.path) return req.query.path;
  if (req.query.query) return req.query.query;

  // Intentar obtener del body (útil para peticiones GET con body que envía la IA)
  if (req.body) {
    if (req.body.path) return req.body.path;
    if (req.body.query) return req.body.query;
  }

  return '';
};

// Normaliza una ruta relativa enviada por la IA (acepta "app/page.tsx",
// "/app/page.tsx", "app\\page.tsx", etc.) y la valida contra el cwd de sesión.
const normalizeRelPath = (rawPath, cwd) => {
  if (rawPath === undefined || rawPath === null || typeof rawPath !== 'string') {
    rawPath = '';
  }
  let rel = rawPath.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  // Bloquear path traversal
  if (/(^|\/)\.\.(\/|$)/.test(rel)) return null;
  if (!cwd) return null;
  const dataDir = path.resolve(cwd);
  const resolved = path.resolve(dataDir, rel || '.');
  if (resolved !== dataDir && !resolved.startsWith(dataDir + path.sep)) return null;
  return { rel, abs: resolved, dataDir };
};

// Resuelve una ruta relativa y responde con el contenido del archivo (si es archivo)
// o el listado de la carpeta (si es directorio). Pensado para ser tolerante con la IA,
// que a veces envía la ruta completa en la URL en lugar de separar `name` y `path`.
const respondByPath = async (relPath, req, res) => {
  const cwd = getDataDir(req);
  if (!cwd) {
    return res.status(400).json({ error: 'No hay sesión activa (falta X-Zeus-Session o sesión inválida). Selecciona una carpeta de proyecto.' });
  }
  const norm = normalizeRelPath(relPath, cwd);
  if (norm === null) {
    return res.status(400).json({ error: 'Ruta no permitida (path traversal o fuera del directorio de datos)' });
  }
  const { rel, abs, dataDir } = norm;

  if (!rel) {
    return res.status(400).json({ error: 'Falta la ruta del archivo o carpeta' });
  }

  try {
    const exists = await fs.pathExists(abs);
    if (!exists) {
      return res.status(404).json({ error: `No encontrado: ${rel}` });
    }

    const stat = await fs.stat(abs);
    const rawMode = req.query.raw === '1' || req.query.raw === 'true';

    // Es un archivo -> devolver contenido
    if (stat.isFile()) {
      if (rawMode) return res.sendFile(abs);
      const content = await fs.readFile(abs, 'utf8');
      const name = path.basename(abs);
      const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      return res.json({
        success: true,
        name,
        path: dir,
        size: stat.size,
        content
      });
    }

    // Es un directorio -> listar archivos
    const items = await fs.readdir(abs);
    const files = [];
    for (const item of items) {
      const itemPath = path.join(abs, item);
      const s = await fs.stat(itemPath);
      if (s.isFile()) {
        const ext = path.extname(item);
        files.push({
          name: item,
          baseName: path.basename(item, ext),
          extension: ext.replace('.', ''),
          type: 'file',
          path: rel ? `${rel}/${item}` : item,
          size: s.size
        });
      }
    }
    return res.json({ success: true, path: rel || '/', files });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

const fileController = {
  // Crear archivo
  createFile: async (req, res) => {
    const { name, extension, type, path: filePathBody, content, planName, saveToPlan } = req.body;
    const filePath = filePathBody || req.body.query || '';
    const cwd = getDataDir(req);
    if (!cwd) {
      return res.status(400).json({ error: 'No hay sesión activa. Selecciona una carpeta de proyecto.' });
    }

    if (!name || (filePath === undefined)) {
      return res.status(400).json({ error: 'Faltan parámetros: name y path son requeridos' });
    }
    
    // Si se solicita guardar en plan en lugar de ejecutar
    if (saveToPlan && planName) {
      try {
        const result = await saveTaskToPlan({
          planName,
          name,
          extension,
          type: type || 'file',
          operation: 'create',
          path: filePath,
          content
        });
        
        return res.status(201).json(result);
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }
    
    const fileName = extension ? `${name}.${extension}` : name;
    const fullPath = path.join(cwd, filePath, fileName);
    const fileContent = content || '';
    
    try {
      await fs.ensureDir(path.dirname(fullPath));
      const wr = await safeWriteFile(fullPath, fileContent);
      if (!wr.success) {
        return res.status(500).json({ error: wr.error });
      }

      res.status(201).json({
        success: true,
        message: 'Archivo creado',
        path: fullPath,
        name: fileName,
        extension: extension || '',
        type: type || 'file'
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // Ver archivo
  getFile: async (req, res) => {
    const { name } = req.params;
    const filePath = extractPath(req);
    const cwd = getDataDir(req);
    if (!cwd) {
      return res.status(400).json({ error: 'No hay sesión activa. Selecciona una carpeta de proyecto.' });
    }

    if (!name) {
      return res.status(400).json({ error: 'El parámetro name es requerido' });
    }

    // Construir la ruta relativa y validarla (incluye path traversal)
    const rel = (filePath ? filePath + '/' : '') + name;
    const norm = normalizeRelPath(rel, cwd);
    if (norm === null) {
      return res.status(400).json({ error: 'Ruta no permitida' });
    }
    const { abs } = norm;

    try {
      const exists = await fs.pathExists(abs);
      if (!exists) {
        return res.status(404).json({ error: `Archivo no encontrado en: ${abs}` });
      }

      const stat = await fs.stat(abs);

      // Tolerancia: si la IA pidió un "archivo" pero la ruta es realmente una
      // carpeta, listamos su contenido en lugar de fallar con EISDIR (500).
      if (stat.isDirectory()) {
        return respondByPath(rel, req, res);
      }

      const rawMode = req.query.raw === '1' || req.query.raw === 'true';
      if (rawMode) {
        return res.sendFile(abs);
      }

      const content = await fs.readFile(abs, 'utf8');

      res.json({
        success: true,
        name: name,
        path: filePath,
        size: stat.size,
        content: content
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // Listar archivos
  listFiles: async (req, res) => {
    const filePath = extractPath(req);
    const cwd = getDataDir(req);
    if (!cwd) {
      return res.status(400).json({ error: 'No hay sesión activa. Selecciona una carpeta de proyecto.' });
    }
    // Tolerancia: si la IA mandó la ruta completa de un ARCHIVO en `path`,
    // devolvemos su contenido en lugar de fallar al hacer readdir.
    const norm = normalizeRelPath(filePath, cwd);
    if (norm === null) {
      return res.status(400).json({ error: 'Ruta no permitida' });
    }
    const { abs, rel } = norm;

    try {
      const exists = await fs.pathExists(abs);
      if (!exists) {
        return res.status(404).json({ error: `Ruta no encontrada: ${rel}` });
      }

      const stat = await fs.stat(abs);
      if (stat.isFile()) {
        const rawMode = req.query.raw === '1' || req.query.raw === 'true';
        if (rawMode) return res.sendFile(abs);
        const content = await fs.readFile(abs, 'utf8');
        const name = path.basename(abs);
        const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
        return res.json({
          success: true,
          name,
          path: dir,
          size: stat.size,
          content
        });
      }

      const items = await fs.readdir(abs);
      const files = [];

      for (const item of items) {
        const itemPath = path.join(abs, item);
        const statItem = await fs.stat(itemPath);
        if (statItem.isFile()) {
          const ext = path.extname(item);
          const baseName = path.basename(item, ext);
          files.push({
            name: item,
            baseName: baseName,
            extension: ext.replace('.', ''),
            type: 'file',
            path: rel ? `${rel}/${item}` : item,
            size: statItem.size
          });
        }
      }

      res.json({
        success: true,
        path: rel || '/',
        files: files
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // Resolvedor tolerante para rutas completas enviadas en la URL
  // (ej. GET /api/files/app/page.tsx). Acepta la ruta completa y responde con
  // el contenido del archivo o el listado de la carpeta.
  resolveByPath: async (req, res) => {
    // req.params[0] viene del wildcard '*' del router (incluye barras iniciales)
    let relPath = req.params && (req.params.fullPath || req.params[0] || '');
    if (typeof relPath !== 'string') relPath = '';
    relPath = relPath.replace(/^\/+/, '');

    // Si no vino en la URL, intentar con ?path= (la IA a veces mezcla estilos)
    if (!relPath) {
      relPath = (req.query.path || req.query.query || '').replace(/^\/+/, '');
    }
    return respondByPath(relPath, req, res);
  },

  // Actualizar archivo
  updateFile: async (req, res) => {
    const { name } = req.params;
    const { content, newName, planName, saveToPlan } = req.body;
    const filePath = extractPath(req);
    const cwd = getDataDir(req);
    if (!cwd) {
      return res.status(400).json({ error: 'No hay sesión activa. Selecciona una carpeta de proyecto.' });
    }

    if (!name) {
      return res.status(400).json({ error: 'El parámetro name es requerido' });
    }
    
    // Si se solicita guardar en plan en lugar de ejecutar
    if (saveToPlan && planName) {
      try {
        const result = await saveTaskToPlan({
          planName,
          name: newName || name,
          extension: name.includes('.') ? name.split('.').pop() : '',
          type: 'file',
          operation: 'update',
          path: filePath,
          content
        });
        
        return res.json(result);
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }
    
    const oldPath = path.join(cwd, filePath, name);

    try {
      const exists = await fs.pathExists(oldPath);
      if (!exists) {
        return res.status(404).json({ error: 'Archivo no encontrado' });
      }

      // Crear backup antes de modificar (historial desactivado)
      // await createBackup(oldPath, 'update', { filePath, newName, hasContent: content !== undefined });

      // Si se especifica un nuevo nombre, renombrar
      if (newName) {
        const newPath = path.join(cwd, filePath, newName);
        await fs.move(oldPath, newPath);

        // Si también hay contenido, escribirlo (escritura segura)
        if (content !== undefined) {
          const wr = await safeWriteFile(newPath, content);
          if (!wr.success) {
            return res.status(500).json({ error: wr.error });
          }
        }

        res.json({
          success: true,
          message: `Archivo renombrado a ${newName}${content !== undefined ? ' y actualizado' : ''}`,
          oldName: name,
          newName: newName,
          backup: false
        });
      } else if (content !== undefined) {
        // Solo actualizar contenido (escritura segura: atómica, BOM/CRLF,
        // fail-closed JSON/YAML/TOML, verificación sha256, lint-delta)
        const wr = await safeWriteFile(oldPath, content);
        if (!wr.success) {
          return res.status(500).json({ error: wr.error });
        }
        res.json({
          success: true,
          message: 'Archivo actualizado',
          file: name,
          backup: false
        });
      } else {
        return res.status(400).json({ error: 'No se especificaron cambios' });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // Borrar archivo
  deleteFile: async (req, res) => {
    const { name } = req.params;
    const { planName, saveToPlan } = req.query;
    const filePath = extractPath(req);
    const cwd = getDataDir(req);
    if (!cwd) {
      return res.status(400).json({ error: 'No hay sesión activa. Selecciona una carpeta de proyecto.' });
    }

    if (!name) {
      return res.status(400).json({ error: 'El parámetro name es requerido' });
    }
    
    // Si se solicita guardar en plan en lugar de ejecutar
    if (saveToPlan === 'true' && planName) {
      try {
        const result = await saveTaskToPlan({
          planName,
          name,
          extension: name.includes('.') ? name.split('.').pop() : '',
          type: 'file',
          operation: 'delete',
          path: filePath
        });
        
        return res.json(result);
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }
    
    const fullPath = path.join(cwd, filePath, name);

    try {
      const exists = await fs.pathExists(fullPath);
      if (!exists) {
        return res.status(404).json({ error: 'Archivo no encontrado' });
      }
      
      await fs.remove(fullPath);
      res.json({ 
        success: true, 
        message: 'Archivo borrado', 
        name: name,
        path: filePath
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
};

module.exports = fileController;