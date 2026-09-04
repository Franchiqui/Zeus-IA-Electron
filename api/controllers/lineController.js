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

const lineController = {
  // Ver líneas específicas
  getLines: async (req, res) => {
    const { name } = req.params;
    const { path: filePath, startLine, endLine } = req.query;
    
    const cwd = requireCwd(req, res); if (!cwd) return; const fullPath = path.join(cwd, filePath, name);
    
    try {
      const exists = await fs.pathExists(fullPath);
      if (!exists) {
        return res.status(404).json({ error: 'Archivo no encontrado' });
      }
      
      const content = await fs.readFile(fullPath, 'utf8');
      const lines = content.split('\n');
      
      const start = startLine ? parseInt(startLine) : 1;
      const end = endLine ? parseInt(endLine) : lines.length;
      
      if (start < 1 || end > lines.length || start > end) {
        return res.status(400).json({ error: 'Rango de líneas inválido' });
      }
      
      const selectedLines = lines.slice(start - 1, end);
      
      res.json({
        success: true,
        file: name,
        startLine: start,
        endLine: end,
        lines: selectedLines,
        totalLines: lines.length
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // Listar todas las líneas
  listLines: async (req, res) => {
    const { name } = req.params;
    const { path: filePath } = req.query;
    
    const cwd = requireCwd(req, res); if (!cwd) return; const fullPath = path.join(cwd, filePath, name);
    
    try {
      const exists = await fs.pathExists(fullPath);
      if (!exists) {
        return res.status(404).json({ error: 'Archivo no encontrado' });
      }
      
      const content = await fs.readFile(fullPath, 'utf8');
      const lines = content.split('\n');
      
      const linesWithNumbers = lines.map((line, index) => ({
        lineNumber: index + 1,
        content: line
      }));
      
      res.json({
        success: true,
        file: name,
        totalLines: lines.length,
        lines: linesWithNumbers
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // Insertar línea(s)
  insertLines: async (req, res) => {
    const { name } = req.params;
    const { path: filePath, lineNumber, content, planName, saveToPlan } = req.body;
    
    if (!content) {
      return res.status(400).json({ error: 'Falta el parámetro content' });
    }
    
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
    
    const cwd = requireCwd(req, res); if (!cwd) return; const fullPath = path.join(cwd, filePath, name);
    
    try {
      const exists = await fs.pathExists(fullPath);
      if (!exists) {
        return res.status(404).json({ error: 'Archivo no encontrado' });
      }
      
      // Crear backup antes de modificar
      await createBackup(fullPath, 'insertLines', { filePath, lineNumber, contentLength: content.length });
      
      const fileContent = await fs.readFile(fullPath, 'utf8');
      let lines = fileContent.split('\n');
      
      let insertLine;
      if (lineNumber) {
        insertLine = parseInt(lineNumber);
        if (insertLine < 1 || insertLine > lines.length + 1) {
          return res.status(400).json({ error: 'Número de línea inválido' });
        }
      } else {
        // Si no se especifica lineNumber, insertar al final
        insertLine = lines.length + 1;
      }
      
      const newLines = content.split('\n');
      lines.splice(insertLine - 1, 0, ...newLines);
      
      const newContent = lines.join('\n');
      await fs.writeFile(fullPath, newContent, 'utf8');
      
      res.json({
        success: true,
        message: `Insertadas ${newLines.length} líneas en la línea ${insertLine}`,
        file: name,
        lineNumber: insertLine,
        backup: true
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // Sustituir línea(s)
  replaceLines: async (req, res) => {
    const { name, lineNumber } = req.params;
    const { path: filePath, content, numLines, planName, saveToPlan } = req.body;
    
    if (!content) {
      return res.status(400).json({ error: 'Falta el parámetro content' });
    }
    
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
    
    const cwd = requireCwd(req, res); if (!cwd) return; const fullPath = path.join(cwd, filePath, name);
    
    try {
      const exists = await fs.pathExists(fullPath);
      if (!exists) {
        return res.status(404).json({ error: 'Archivo no encontrado' });
      }
      
      // Crear backup antes de modificar
      await createBackup(fullPath, 'replaceLines', { filePath, lineNumber, numLines, contentLength: content.length });
      
      const fileContent = await fs.readFile(fullPath, 'utf8');
      let lines = fileContent.split('\n');
      
      const lineNum = parseInt(lineNumber);
      const linesToDelete = numLines ? parseInt(numLines) : 1;
      
      if (lineNum < 1 || lineNum + linesToDelete - 1 > lines.length) {
        return res.status(400).json({ error: 'Rango de líneas inválido' });
      }
      
      const newLines = content.split('\n');
      lines.splice(lineNum - 1, linesToDelete, ...newLines);
      
      const newContent = lines.join('\n');
      await fs.writeFile(fullPath, newContent, 'utf8');
      
      res.json({
        success: true,
        message: `Sustituidas ${linesToDelete} líneas por ${newLines.length} nuevas líneas desde la línea ${lineNum}`,
        file: name,
        lineNumber: lineNum,
        numLines: linesToDelete,
        newLinesCount: newLines.length,
        backup: true
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // Borrar línea(s)
  deleteLines: async (req, res) => {
    const { name, lineNumber } = req.params;
    const { path: filePath, numLines, planName, saveToPlan } = req.query;
    
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
    
    const cwd = requireCwd(req, res); if (!cwd) return; const fullPath = path.join(cwd, filePath || '', name);
    
    try {
      const exists = await fs.pathExists(fullPath);
      if (!exists) {
        return res.status(404).json({ error: 'Archivo no encontrado' });
      }
      
      // Crear backup antes de modificar
      await createBackup(fullPath, 'deleteLines', { filePath, lineNumber, numLines });
      
      const fileContent = await fs.readFile(fullPath, 'utf8');
      let lines = fileContent.split('\n');
      
      const lineNum = parseInt(lineNumber);
      const linesToDelete = numLines ? parseInt(numLines) : 1;
      
      if (lineNum < 1 || lineNum > lines.length) {
        return res.status(400).json({ error: 'Número de línea inválido' });
      }
      
      if (lineNum + linesToDelete - 1 > lines.length) {
        return res.status(400).json({ error: 'Rango de líneas inválido' });
      }
      
      // Guardar las líneas que se van a borrar
      const deletedLines = lines.slice(lineNum - 1, lineNum - 1 + linesToDelete);
      
      // Borrar las líneas
      lines.splice(lineNum - 1, linesToDelete);
      
      const newContent = lines.join('\n');
      await fs.writeFile(fullPath, newContent, 'utf8');
      
      res.json({
        success: true,
        message: `Borradas ${linesToDelete} líneas desde la línea ${lineNum}`,
        file: name,
        lineNumber: lineNum,
        numLines: linesToDelete,
        deletedLines: deletedLines,
        backup: true
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
};

module.exports = lineController;