const fs = require('fs-extra');
const path = require('path');

// Ruta absoluta al archivo .env de la API
const envPath = process.env.ZEUS_API_ENV_PATH
  ? path.resolve(process.env.ZEUS_API_ENV_PATH)
  : path.join(__dirname, '..', '.env');

// Helper para leer DATA_PATH directamente del .env
const readDataPathFromEnv = () => {
  try {
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const dataPathMatch = envContent.match(/^DATA_PATH\s*=\s*"([^"]+)"/m);
      if (dataPathMatch) {
        const rawPath = dataPathMatch[1];
        return path.normalize(
          path.isAbsolute(rawPath) ? rawPath : path.resolve(__dirname, '..', rawPath)
        );
      }
    }
  } catch (error) {
    console.error('[readDataPathFromEnv] Error:', error.message);
  }
  return null;
};

const configController = {
  // Actualizar DATA_PATH
  updateDataPath: async (req, res) => {
    try {
      const { dataPath } = req.body;
      
      if (!dataPath) {
        return res.status(400).json({ 
          error: 'Falta el parámetro dataPath' 
        });
      }

      // Validar que la ruta sea válida
      const normalizedPath = path.normalize(
        path.isAbsolute(dataPath) ? dataPath : path.resolve(__dirname, '..', dataPath)
      );
      
      // Intentar crear/verificar el directorio
      try {
        await fs.ensureDir(normalizedPath);
      } catch (error) {
        return res.status(400).json({ 
          error: `La ruta especificada no es válida o no se puede crear: ${error.message}` 
        });
      }

      // Leer el archivo .env actual
      let envContent = '';
      try {
        envContent = await fs.readFile(envPath, 'utf8');
      } catch (error) {
        // Si el archivo no existe, empezamos con contenido vacío
        console.log('Archivo .env no encontrado, se creará uno nuevo');
      }

      // Actualizar o añadir la variable DATA_PATH
      const lines = envContent.split('\n');
      let dataPathUpdated = false;
      
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('DATA_PATH=')) {
          lines[i] = `DATA_PATH="${normalizedPath.replace(/\\/g, '\\\\')}"`;
          dataPathUpdated = true;
          break;
        }
      }
      
      if (!dataPathUpdated) {
        lines.push(`DATA_PATH="${normalizedPath.replace(/\\/g, '\\\\')}"`);
      }

      // Escribir el archivo .env actualizado
      const newEnvContent = lines.join('\n');
      await fs.ensureDir(path.dirname(envPath));
      await fs.writeFile(envPath, newEnvContent, 'utf8');

      // Actualizar el runtime actual para que /config/data-path refleje el nuevo valor
      process.env.DATA_PATH = normalizedPath;

      console.log(`[CONFIG] DATA_PATH actualizado a: ${normalizedPath}`);

      res.json({ 
        success: true, 
        message: 'DATA_PATH actualizado correctamente',
        dataPath: normalizedPath 
      });

    } catch (error) {
      console.error('[CONFIG] Error al actualizar DATA_PATH:', error);
      res.status(500).json({ 
        error: 'Error interno del servidor al actualizar DATA_PATH',
        details: error.message 
      });
    }
  },

  // Obtener DATA_PATH actual
  getDataPath: async (req, res) => {
    try {
      // Primero intentar leer directamente del .env
      let currentPath = readDataPathFromEnv();

      // Fallback a process.env si no se encontró en .env
      if (!currentPath && process.env.DATA_PATH) {
        currentPath = path.normalize(process.env.DATA_PATH);
      }

      // Fallback final a DATA_DIR de config.js
      if (!currentPath) {
        const { DATA_DIR } = require('../config');
        currentPath = DATA_DIR;
      }

      res.json({
        success: true,
        dataPath: currentPath
      });

    } catch (error) {
      console.error('[CONFIG] Error al obtener DATA_PATH:', error);
      res.status(500).json({
        error: 'Error interno del servidor al obtener DATA_PATH',
        details: error.message
      });
    }
  }
};

module.exports = configController;