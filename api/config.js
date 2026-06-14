const path = require('path');
const fs = require('fs-extra');

// Helper para leer DATA_PATH desde el .env en tiempo real (siempre desde disco)
const readDataPathFromEnv = () => {
  // Usar ZEUS_API_ENV_PATH si está seteado (por Electron), sino usar el .env por defecto
  const envPath = process.env.ZEUS_API_ENV_PATH
    ? path.resolve(process.env.ZEUS_API_ENV_PATH)
    : path.join(__dirname, '.env');

  try {
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const dataPathMatch = envContent.match(/^DATA_PATH\s*=\s*"([^"]+)"/m);
      if (dataPathMatch) {
        const rawPath = dataPathMatch[1];
        return path.normalize(
          path.isAbsolute(rawPath) ? rawPath : path.resolve(__dirname, rawPath)
        );
      }
    }
  } catch (error) {
    console.error('[config] Error al leer DATA_PATH desde .env:', error.message);
  }
  return null;
};

// Exportar un objeto con DATA_DIR como getter para lectura dinámica
// El getter siempre lee el .env desde disco para detectar cambios en tiempo real
module.exports = {
  get DATA_DIR() {
    const dataPath = readDataPathFromEnv() || process.env.DATA_PATH;
    let dir = dataPath
      ? path.isAbsolute(dataPath) ? dataPath : path.resolve(__dirname, dataPath)
      : path.join(__dirname, 'data');
    return path.normalize(dir);
  }
};
