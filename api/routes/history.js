const express = require('express');
const router = express.Router();
const path = require('path');
const { getSessionCwd } = require('../middleware/sessionCwd');
const historyController = require('../controllers/historyController');

// Obtener historial de un archivo
router.get('/files/:name/history', async (req, res) => {
  const { name } = req.params;
  const { path: folderPath } = req.query;
  const cwd = getSessionCwd(req);
  if (!cwd) return res.status(400).json({ error: 'No hay sesión activa. Selecciona una carpeta de proyecto.' });
  const fullPath = folderPath ? path.join(cwd, folderPath, name) : null;

  try {
    const history = await historyController.getHistory(name, fullPath);
    res.json({
      success: true,
      file: name,
      path: folderPath,
      history: history,
      count: history.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Deshacer último cambio de un archivo
router.post('/files/:name/undo', async (req, res) => {
  const { name } = req.params;
  const { path: folderPath } = req.body;
  const cwd = getSessionCwd(req);
  if (!cwd) return res.status(400).json({ error: 'No hay sesión activa. Selecciona una carpeta de proyecto.' });
  const fullPath = path.join(cwd, folderPath || '', name);

  try {
    const result = await historyController.undoLastChange(name, fullPath);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Listar todos los archivos con historial
router.get('/history/files', async (req, res) => {
  try {
    const files = await historyController.listFilesWithHistory();
    res.json({
      success: true,
      files: files,
      count: files.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
