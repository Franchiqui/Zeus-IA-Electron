const fs = require('fs-extra');
const path = require('path');

const HISTORY_DIR = path.join(__dirname, '..', 'history');

// Asegurar que el directorio de historial existe
const ensureHistoryDir = async () => {
  await fs.ensureDir(HISTORY_DIR);
};

// Guardar una copia de seguridad de un archivo antes de modificarlo
const createBackup = async (filePath, operation, metadata = {}) => {
  await ensureHistoryDir();
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = path.basename(filePath);
  const backupFileName = `${timestamp}_${fileName}`;
  const backupPath = path.join(HISTORY_DIR, backupFileName);
  
  // Copiar el archivo original
  await fs.copy(filePath, backupPath);
  
  // Guardar metadatos de la operación
  const metadataPath = path.join(HISTORY_DIR, `${backupFileName}.meta.json`);
  const historyEntry = {
    timestamp,
    operation,
    originalPath: filePath,
    backupPath,
    metadata,
    fileName
  };
  
  await fs.writeJson(metadataPath, historyEntry, { spaces: 2 });
  
  return historyEntry;
};

// Obtener el historial de cambios para un archivo específico (por nombre y ruta completa)
const getHistory = async (fileName, fullPath = null) => {
  await ensureHistoryDir();
  
  const files = await fs.readdir(HISTORY_DIR);
  const metaFiles = files.filter(file => file.endsWith('.meta.json'));
  
  const history = [];
  
  for (const metaFile of metaFiles) {
    try {
      const metadata = await fs.readJson(path.join(HISTORY_DIR, metaFile));
      
      // Filtrar por nombre de archivo y, si se proporciona, por ruta completa
      if (metadata.fileName === fileName) {
        if (!fullPath || metadata.originalPath === fullPath) {
          history.push(metadata);
        }
      }
    } catch (error) {
      // Ignorar errores de lectura de metadatos
    }
  }
  
  // Ordenar por timestamp (más reciente primero)
  return history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
};

// Deshacer el último cambio para un archivo específico
const undoLastChange = async (fileName, fullPath = null) => {
  await ensureHistoryDir();
  
  const history = await getHistory(fileName, fullPath);
  
  if (history.length === 0) {
    throw new Error('No hay cambios para deshacer en este archivo específico');
  }
  
  const lastChange = history[0];
  
  // Restaurar el archivo desde el backup
  await fs.copy(lastChange.backupPath, lastChange.originalPath);
  
  // Leer el contenido restaurado para devolverlo al cliente
  const restoredContent = await fs.readFile(lastChange.originalPath, 'utf8');
  
  // Eliminar el backup y metadatos
  await fs.remove(lastChange.backupPath);
  await fs.remove(path.join(HISTORY_DIR, `${path.basename(lastChange.backupPath)}.meta.json`));
  
  return {
    success: true,
    message: `Deshacer cambio: ${lastChange.operation} en ${lastChange.timestamp}`,
    operation: lastChange.operation,
    timestamp: lastChange.timestamp,
    content: restoredContent
  };
};

// Listar todos los archivos con historial
const listFilesWithHistory = async () => {
  await ensureHistoryDir();
  
  const files = await fs.readdir(HISTORY_DIR);
  const metaFiles = files.filter(file => file.endsWith('.meta.json'));
  
  const fileSet = new Set();
  
  for (const metaFile of metaFiles) {
    try {
      const metadata = await fs.readJson(path.join(HISTORY_DIR, metaFile));
      fileSet.add(metadata.fileName);
    } catch (error) {
      // Ignorar errores de lectura de metadatos
    }
  }
  
  return Array.from(fileSet).sort();
};

module.exports = {
  createBackup,
  getHistory,
  undoLastChange,
  listFilesWithHistory
};
