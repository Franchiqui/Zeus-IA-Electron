const fs = require('fs-extra');
const path = require('path');

const { saveTaskToPlan } = require('./planController');
const { getSessionCwd } = require('../middleware/sessionCwd');

// El cwd se ancla por sesión (header X-Zeus-Session), no a un DATA_PATH global.
const getDataDir = (req) => getSessionCwd(req);

// Garantiza que haya sesión activa; devuelve el cwd o responde 400.
const requireCwd = (req, res) => {
  const cwd = getDataDir(req);
  if (!cwd) {
    res.status(400).json({ error: 'No hay sesión activa. Selecciona una carpeta de proyecto.' });
    return null;
  }
  return cwd;
};

const folderController = {
  // Crear carpeta
  createFolder: async (req, res) => {
    const { name, path: folderPath, planName, saveToPlan } = req.body;
    
    if (!name || folderPath === undefined) {
      return res.status(400).json({ error: 'Faltan parámetros: name y path son requeridos' });
    }
    
    // Si se solicita guardar en plan en lugar de ejecutar
    if (saveToPlan && planName) {
      try {
        const result = await saveTaskToPlan({
          planName,
          name,
          type: 'folder',
          operation: 'create',
          path: folderPath
        });
        
        return res.status(201).json(result);
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }
    
    const cwd = requireCwd(req, res);
    if (!cwd) return;
    const fullPath = path.join(cwd, folderPath, name);

    try {
      await fs.ensureDir(fullPath);
      res.status(201).json({ 
        success: true, 
        message: 'Carpeta creada', 
        path: fullPath,
        name: name 
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // Listar carpetas
  listFolders: async (req, res) => {
    const { path: folderPath } = req.query;
    const cwd = requireCwd(req, res);
    if (!cwd) return;
    const fullPath = path.join(cwd, folderPath || '');
    
    try {
      const exists = await fs.pathExists(fullPath);
      if (!exists) {
        return res.status(404).json({ error: 'Ruta no encontrada' });
      }
      
      const items = await fs.readdir(fullPath);
      const folders = [];
      
      for (const item of items) {
        const itemPath = path.join(fullPath, item);
        const stat = await fs.stat(itemPath);
        if (stat.isDirectory()) {
          folders.push({
            name: item,
            path: path.join(folderPath || '', item)
          });
        }
      }
      
      res.json({ 
        success: true, 
        path: folderPath || '/',
        folders: folders 
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // Actualizar carpeta (renombrar)
  updateFolder: async (req, res) => {
    const { name } = req.params;
    const { newName, path: folderPath, planName, saveToPlan } = req.body;
    
    if (!newName) {
      return res.status(400).json({ error: 'Falta el parámetro newName' });
    }
    
    // Si se solicita guardar en plan en lugar de ejecutar
    if (saveToPlan && planName) {
      try {
        const result = await saveTaskToPlan({
          planName,
          name: newName,
          type: 'folder',
          operation: 'update',
          path: folderPath
        });
        
        return res.json(result);
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }
    
    const cwd = requireCwd(req, res);
    if (!cwd) return;
    const oldPath = path.join(cwd, folderPath, name);
    const newPath = path.join(cwd, folderPath, newName);
    
    try {
      const exists = await fs.pathExists(oldPath);
      if (!exists) {
        return res.status(404).json({ error: 'Carpeta no encontrada' });
      }
      
      await fs.move(oldPath, newPath);
      res.json({ 
        success: true, 
        message: 'Carpeta renombrada', 
        oldName: name,
        newName: newName,
        path: path.join(folderPath, newName)
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // Borrar carpeta
  deleteFolder: async (req, res) => {
    const { name } = req.params;
    const { path: folderPath, planName, saveToPlan } = req.query;
    
    // Si se solicita guardar en plan en lugar de ejecutar
    if (saveToPlan === 'true' && planName) {
      try {
        const result = await saveTaskToPlan({
          planName,
          name,
          type: 'folder',
          operation: 'delete',
          path: folderPath
        });
        
        return res.json(result);
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }
    
    const cwd = requireCwd(req, res);
    if (!cwd) return;
    const fullPath = path.join(cwd, folderPath, name);

    try {
      const exists = await fs.pathExists(fullPath);
      if (!exists) {
        return res.status(404).json({ error: 'Carpeta no encontrada' });
      }

      await fs.remove(fullPath);
      res.json({ 
        success: true, 
        message: 'Carpeta borrada', 
        name: name,
        path: folderPath
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
};

module.exports = folderController;