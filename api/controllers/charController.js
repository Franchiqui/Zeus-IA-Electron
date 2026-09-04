const fs = require('fs-extra');
const path = require('path');
const { createBackup } = require('./historyController');
const { saveTaskToPlan } = require('./planController');
const { getSessionCwd } = require('../middleware/sessionCwd');

const getDataDir = (req) => getSessionCwd(req);

const requireCwd = (req, res) => {
  const cwd = getDataDir(req);
  if (!cwd) {
    res.status(400).json({ error: 'No hay sesión activa. Selecciona una carpeta de proyecto.' });
    return null;
  }
  return cwd;
};

const charController = {
  // Ver caracteres específicos
  getChars: async (req, res) => {
    const { name, lineNumber } = req.params;
    const { path: filePath, startCharIndex, endCharIndex } = req.query;
    
    if (!startCharIndex || !endCharIndex) {
      return res.status(400).json({ error: 'Faltan parámetros: startCharIndex y endCharIndex son requeridos' });
    }
    
    const cwd = requireCwd(req, res); if (!cwd) return; const fullPath = path.join(cwd, filePath || '', name);
    
    try {
      const exists = await fs.pathExists(fullPath);
      if (!exists) {
        return res.status(404).json({ error: 'Archivo no encontrado' });
      }
      
      const content = await fs.readFile(fullPath, 'utf8');
      const lines = content.split('\n');
      
      const lineNum = parseInt(lineNumber);
      if (lineNum < 1 || lineNum > lines.length) {
        return res.status(400).json({ error: 'Número de línea inválido' });
      }
      
      const line = lines[lineNum - 1];
      const start = parseInt(startCharIndex);
      const end = parseInt(endCharIndex);
      
      if (start < 0 || end > line.length || start > end) {
        return res.status(400).json({ error: 'Índices de caracteres inválidos' });
      }
      
      const selectedChars = line.substring(start, end);
      
      res.json({
        success: true,
        file: name,
        lineNumber: lineNum,
        startCharIndex: start,
        endCharIndex: end,
        content: selectedChars,
        lineLength: line.length
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // Listar todos los caracteres de una línea
  listChars: async (req, res) => {
    const { name, lineNumber } = req.params;
    const { path: filePath } = req.query;
    
    const cwd = requireCwd(req, res); if (!cwd) return; const fullPath = path.join(cwd, filePath || '', name);
    
    try {
      const exists = await fs.pathExists(fullPath);
      if (!exists) {
        return res.status(404).json({ error: 'Archivo no encontrado' });
      }
      
      const content = await fs.readFile(fullPath, 'utf8');
      const lines = content.split('\n');
      
      const lineNum = parseInt(lineNumber);
      if (lineNum < 1 || lineNum > lines.length) {
        return res.status(400).json({ error: 'Número de línea inválido' });
      }
      
      const line = lines[lineNum - 1];
      const chars = line.split('').map((char, index) => ({
        position: index,
        character: char
      }));
      
      res.json({
        success: true,
        file: name,
        lineNumber: lineNum,
        length: line.length,
        characters: chars
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // Insertar caracteres
  insertChars: async (req, res) => {
    const { name, lineNumber } = req.params;
    const { path: filePath, position, content, planName, saveToPlan } = req.body;
    
    // Si se solicita guardar en plan en lugar de ejecutar
    if (saveToPlan && planName) {
      try {
        const result = await saveTaskToPlan({
          planName,
          name,
          type: 'file',
          operation: 'update',
          path: filePath,
          content
        });
        
        return res.status(201).json(result);
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }
    
    if (position === undefined || !content) {
      return res.status(400).json({ error: 'Faltan parámetros: position y content son requeridos' });
    }
    
    const cwd = requireCwd(req, res); if (!cwd) return; const fullPath = path.join(cwd, filePath || '', name);
    
    try {
      const exists = await fs.pathExists(fullPath);
      if (!exists) {
        return res.status(404).json({ error: 'Archivo no encontrado' });
      }
      
      // Crear backup antes de modificar
      await createBackup(fullPath, 'insertChars', { filePath, lineNumber, position, contentLength: content.length });
      
      const fileContent = await fs.readFile(fullPath, 'utf8');
      const lines = fileContent.split('\n');
      
      const lineNum = parseInt(lineNumber);
      const insertPos = parseInt(position);
      
      if (lineNum < 1 || lineNum > lines.length) {
        return res.status(400).json({ error: 'Número de línea inválido' });
      }
      
      const line = lines[lineNum - 1];
      if (insertPos < 0 || insertPos > line.length) {
        return res.status(400).json({ error: 'Posición inválida' });
      }
      
      const newLine = line.slice(0, insertPos) + content + line.slice(insertPos);
      lines[lineNum - 1] = newLine;
      
      const newContent = lines.join('\n');
      await fs.writeFile(fullPath, newContent, 'utf8');
      
      res.json({
        success: true,
        message: `Insertados ${content.length} caracteres en la posición ${insertPos}`,
        file: name,
        lineNumber: lineNum,
        position: insertPos,
        backup: true
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // Sustituir caracteres
  replaceChars: async (req, res) => {
    const { name, lineNumber } = req.params;
    const { path: filePath, startCharIndex, endCharIndex, content, planName, saveToPlan } = req.body;
    
    // Si se solicita guardar en plan en lugar de ejecutar
    if (saveToPlan && planName) {
      try {
        const result = await saveTaskToPlan({
          planName,
          name,
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
    
    if (startCharIndex === undefined || endCharIndex === undefined || !content) {
      return res.status(400).json({ error: 'Faltan parámetros: startCharIndex, endCharIndex y content son requeridos' });
    }
    
    const cwd = requireCwd(req, res); if (!cwd) return; const fullPath = path.join(cwd, filePath || '', name);
    
    try {
      const exists = await fs.pathExists(fullPath);
      if (!exists) {
        return res.status(404).json({ error: 'Archivo no encontrado' });
      }
      
      // Crear backup antes de modificar
      await createBackup(fullPath, 'replaceChars', { filePath, lineNumber, startCharIndex, endCharIndex, contentLength: content.length });
      
      const fileContent = await fs.readFile(fullPath, 'utf8');
      const lines = fileContent.split('\n');
      
      const lineNum = parseInt(lineNumber);
      const start = parseInt(startCharIndex);
      const end = parseInt(endCharIndex);
      
      if (lineNum < 1 || lineNum > lines.length) {
        return res.status(400).json({ error: 'Número de línea inválido' });
      }
      
      const line = lines[lineNum - 1];
      if (start < 0 || end > line.length || start > end) {
        return res.status(400).json({ error: 'Índices de caracteres inválidos' });
      }
      
      const newLine = line.slice(0, start) + content + line.slice(end);
      lines[lineNum - 1] = newLine;
      
      const newContent = lines.join('\n');
      await fs.writeFile(fullPath, newContent, 'utf8');
      
      res.json({
        success: true,
        message: `Sustituidos ${end - start} caracteres por ${content.length} caracteres`,
        file: name,
        lineNumber: lineNum,
        startCharIndex: start,
        endCharIndex: end,
        backup: true
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // Borrar carácter(es)
  deleteChars: async (req, res) => {
    const { name, lineNumber } = req.params;
    const { path: filePath, startCharIndex, endCharIndex, planName, saveToPlan } = req.query;
    
    // Si se solicita guardar en plan en lugar de ejecutar
    if (saveToPlan === 'true' && planName) {
      try {
        const result = await saveTaskToPlan({
          planName,
          name,
          type: 'file',
          operation: 'delete',
          path: filePath
        });
        
        return res.json(result);
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }
    
    if (!startCharIndex || !endCharIndex) {
      return res.status(400).json({ error: 'Faltan parámetros: startCharIndex y endCharIndex son requeridos' });
    }
    
    const cwd = requireCwd(req, res); if (!cwd) return; const fullPath = path.join(cwd, filePath || '', name);
    
    try {
      const exists = await fs.pathExists(fullPath);
      if (!exists) {
        return res.status(404).json({ error: 'Archivo no encontrado' });
      }
      
      // Crear backup antes de modificar
      await createBackup(fullPath, 'deleteChars', { filePath, lineNumber, startCharIndex, endCharIndex });
      
      const fileContent = await fs.readFile(fullPath, 'utf8');
      const lines = fileContent.split('\n');
      
      const lineNum = parseInt(lineNumber);
      const start = parseInt(startCharIndex);
      const end = parseInt(endCharIndex);
      
      if (lineNum < 1 || lineNum > lines.length) {
        return res.status(400).json({ error: 'Número de línea inválido' });
      }
      
      const line = lines[lineNum - 1];
      if (start < 0 || end > line.length || start > end) {
        return res.status(400).json({ error: 'Índices de caracteres inválidos' });
      }
      
      const deletedText = line.substring(start, end);
      const newLine = line.slice(0, start) + line.slice(end);
      lines[lineNum - 1] = newLine;
      
      const newContent = lines.join('\n');
      await fs.writeFile(fullPath, newContent, 'utf8');
      
      res.json({
        success: true,
        message: `Borrados ${end - start} caracteres`,
        file: name,
        lineNumber: lineNum,
        startCharIndex: start,
        endCharIndex: end,
        deletedText: deletedText,
        backup: true
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
};

module.exports = charController;