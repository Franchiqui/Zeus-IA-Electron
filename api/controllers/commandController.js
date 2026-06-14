const { exec } = require('child_process');
const path = require('path');

const getDataDir = () => require('../config').DATA_DIR;

const commandController = {
  runCommand: async (req, res) => {
    const { command, path: subPath } = req.body;
    
    if (!command) {
      return res.status(400).json({ error: 'No se proporcionó ningún comando' });
    }

    // Ejecutar en la carpeta de datos o en una subcarpeta si se especifica
    const workingDir = subPath ? path.join(getDataDir(), subPath) : getDataDir();

    console.log(`[ZEUS COMMAND] Ejecutando: "${command}" en ${workingDir}`);

    exec(command, { cwd: workingDir }, (error, stdout, stderr) => {
      if (error) {
        return res.json({
          success: false,
          exitCode: error.code,
          message: error.message,
          stdout: stdout,
          stderr: stderr
        });
      }
      
      res.json({
        success: true,
        message: 'Comando ejecutado con éxito',
        stdout: stdout,
        stderr: stderr
      });
    });
  }
};

module.exports = commandController;
