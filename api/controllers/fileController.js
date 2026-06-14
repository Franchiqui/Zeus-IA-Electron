const fs = require('fs-extra');
const path = require('path');
const { saveTaskToPlan } = require('./planController');

// getDataDir - Lee DATA_PATH desde .env en tiempo real para detectar cambios
const getDataDir = () => {
  // Acceder dinámicamente a DATA_DIR para que siempre lea el .env actual
  return require('../config').DATA_DIR;
};

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

const fileController = {
  // Crear archivo
  createFile: async (req, res) => {
    const { name, extension, type, path: filePathBody, content, planName, saveToPlan } = req.body;
    const filePath = filePathBody || req.body.query || '';
    
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
    const fullPath = path.join(getDataDir(), filePath, fileName);
    const fileContent = content || '';
    
    try {
      await fs.ensureDir(path.dirname(fullPath));
      await fs.writeFile(fullPath, fileContent, 'utf8');
      
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
    const rawMode = req.query.raw === '1' || req.query.raw === 'true';
    
    if (!name) {
      return res.status(400).json({ error: 'El parámetro name es requerido' });
    }
    
    const fullPath = path.join(getDataDir(), filePath, name);
    
    try {
      const exists = await fs.pathExists(fullPath);
      if (!exists) {
        return res.status(404).json({ error: `Archivo no encontrado en: ${fullPath}` });
      }

      if (rawMode) {
        return res.sendFile(fullPath);
      }
      
      const content = await fs.readFile(fullPath, 'utf8');
      const stats = await fs.stat(fullPath);
      
      res.json({ 
        success: true, 
        name: name,
        path: filePath,
        size: stats.size,
        content: content 
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // Listar archivos
  listFiles: async (req, res) => {
    const filePath = extractPath(req);
    const fullPath = path.join(getDataDir(), filePath);
    
    try {
      const exists = await fs.pathExists(fullPath);
      if (!exists) {
        return res.status(404).json({ error: `Ruta no encontrada: ${fullPath}` });
      }
      
      const items = await fs.readdir(fullPath);
      const files = [];
      
      for (const item of items) {
        const itemPath = path.join(fullPath, item);
        const stat = await fs.stat(itemPath);
        if (stat.isFile()) {
          const ext = path.extname(item);
          const baseName = path.basename(item, ext);
          files.push({
            name: item,
            baseName: baseName,
            extension: ext.replace('.', ''),
            type: 'file',
            path: path.join(filePath, item),
            size: stat.size
          });
        }
      }
      
      res.json({ 
        success: true, 
        path: filePath || '/',
        files: files 
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // Actualizar archivo
  updateFile: async (req, res) => {
    const { name } = req.params;
    const { content, newName, planName, saveToPlan } = req.body;
    const filePath = extractPath(req);
    
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
    
    const oldPath = path.join(getDataDir(), filePath, name);
    
    try {
      const exists = await fs.pathExists(oldPath);
      if (!exists) {
        return res.status(404).json({ error: 'Archivo no encontrado' });
      }
      
      // Crear backup antes de modificar (historial desactivado)
      // await createBackup(oldPath, 'update', { filePath, newName, hasContent: content !== undefined });
      
      // Si se especifica un nuevo nombre, renombrar
      if (newName) {
        const newPath = path.join(getDataDir(), filePath, newName);
        await fs.move(oldPath, newPath);
        
        // Si también hay contenido, escribirlo
        if (content !== undefined) {
          await fs.writeFile(newPath, content, 'utf8');
        }
        
        res.json({
          success: true,
          message: `Archivo renombrado a ${newName}${content !== undefined ? ' y actualizado' : ''}`,
          oldName: name,
          newName: newName,
          backup: false
        });
      } else if (content !== undefined) {
        // Solo actualizar contenido
        await fs.writeFile(oldPath, content, 'utf8');
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
    
    const fullPath = path.join(getDataDir(), filePath, name);
    
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