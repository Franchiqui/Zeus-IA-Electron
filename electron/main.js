const { app, BrowserWindow, ipcMain, shell, clipboard, dialog } = require('electron');
const { exec, spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');

// ===== MANEJO GLOBAL DE ERRORES (evita que la app se cierre por errores no capturados) =====
process.on('uncaughtException', (error) => {
  console.error('[MAIN] uncaughtException:', error);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[MAIN] unhandledRejection en:', promise, 'razón:', reason);
});

// ===== PERSISTENCIA DEL ESTADO DE VENTANA =====
const WINDOW_STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');
function loadWindowState() {
  try {
    if (fs.existsSync(WINDOW_STATE_FILE)) {
      const raw = fs.readFileSync(WINDOW_STATE_FILE, 'utf-8');
      const state = JSON.parse(raw);
      // Validar que las coordenadas estén en pantallas visibles
      const { screen } = require('electron');
      const displays = screen.getAllDisplays();
      const inBounds = displays.some(d => {
        const { x, y, width, height } = d.workArea;
        return state.x >= x - 50 && state.y >= y - 50 &&
               state.x + state.width <= x + width + 50 &&
               state.y + state.height <= y + height + 50;
      });
      if (inBounds) return state;
    }
  } catch (e) {
    console.warn('[ZEUS] No se pudo cargar el estado de ventana:', e.message);
  }
  return null;
}
function saveWindowState(win) {
  try {
    const bounds = win.getNormalBounds ? win.getNormalBounds() : win.getBounds();
    const state = {
      ...bounds,
      isMaximized: win.isMaximized(),
      isFullScreen: win.isFullScreen()
    };
    fs.writeFileSync(WINDOW_STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.warn('[ZEUS] No se pudo guardar el estado de ventana:', e.message);
  }
}

// ===== BLOQUEO DE INSTANCIA ÚNICA =====
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('[ZEUS] Ya existe una instancia en ejecución. Saliendo...');
  app.quit();
  process.exit(0);
}

// Cargar variables de entorno desde .env
try {
  require('dotenv').config();
} catch {
  console.warn('dotenv no está disponible, usando variables de entorno del sistema');
}
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
console.log('[MAIN] NODE_ENV:', process.env.NODE_ENV);
console.log('[MAIN] isDev:', isDev);
console.log('[MAIN] app.isPackaged:', app.isPackaged);
let nextProcess = null;
let apiProcess = null;
let terminalProcess = null;
let formatterProcess = null;
let pocketbaseProcess = null;
let pocketbaseAdminToken = null;
let previewServerProcess = null;
let raeApiProcess = null;

// Credenciales y URL para la base de datos local
const POCKETBASE_LOCAL_URL = process.env.POCKETBASE_LOCAL_URL || "http://127.0.0.1:8091";
const POCKETBASE_LOCAL_ADMIN_EMAIL = process.env.POCKETBASE_LOCAL_ADMIN_EMAIL || "zeus@ia.com";
const POCKETBASE_LOCAL_ADMIN_PASSWORD = process.env.POCKETBASE_LOCAL_ADMIN_PASSWORD || "1234567890";
const INITIAL_ZOOM = parseFloat(process.env.ELECTRON_ZOOM) || 1.0;

function getAppBasePath() {
  return isDev ? app.getAppPath() : path.join(process.resourcesPath, 'app');
}

ipcMain.handle('select-folder', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { canceled: true };

  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
    title: 'Seleccionar carpeta de trabajo (DATA_PATH)'
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  return { canceled: false, filePath: result.filePaths[0] };
});

ipcMain.handle('get-pocketbase-admin-token', async () => {
  if (pocketbaseAdminToken) return pocketbaseAdminToken;
  try {
    const tokenPath = getAdminTokenPath();
    if (fs.existsSync(tokenPath)) {
      const raw = fs.readFileSync(tokenPath, 'utf-8');
      const parsed = JSON.parse(raw);
      pocketbaseAdminToken = parsed.token;
      return parsed.token;
    }
  } catch (e) {
    console.error('Error leyendo admin token:', e.message);
  }
  return null;
});

ipcMain.handle('get-pocketbase-url', async () => {
  return POCKETBASE_LOCAL_URL;
});

// Control dinámico de PocketBase
ipcMain.handle('pocketbase:stop', async () => {
  console.log('[PB-IPC] Deteniendo PocketBase a petición del frontend...');
  if (pocketbaseProcess) {
    killProcess(pocketbaseProcess, 'PocketBase');
    pocketbaseProcess = null;
  }
  // Fallback: intentar liberar el puerto por si el proceso se perdió de vista
  const port = parseInt(POCKETBASE_LOCAL_URL.split(':').pop() || '8091');
  killProcessByPort(port);
  return { success: true };
});

ipcMain.handle('pocketbase:start', async () => {
  console.log('[PB-IPC] Reiniciando PocketBase a petición del frontend...');
  try {
    startPocketBase();
    return { success: true };
  } catch (error) {
    console.error('[PB-IPC] Error al reiniciar PocketBase:', error.message);
    return { success: false, error: error.message };
  }
});

// ===== LIMPIEZA DE CARPETA current-project (App Library) =====
/**
 * Borra el contenido de C:\Zeus-IA\serve\projects\current-project
 * Se invoca desde la pestaña "biblioteca" al renderizar una app (antes de
 * subir el ZIP) y al cerrar la preview, para garantizar que el preview
 * server siempre copie el ZIP en una carpeta limpia.
 */
function getCurrentProjectPath() {
  // In production (packaged), use a writable user directory instead of Program Files
  if (!isDev) {
    return path.join(process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir(), 'ZeusIA', 'projects', 'current-project');
  }
  return path.join(getAppBasePath(), 'serve', 'projects', 'current-project');
}

async function clearCurrentProjectFolder() {
  const target = getCurrentProjectPath();
  if (!fs.existsSync(target)) {
    return { success: true, message: 'La carpeta current-project no existía.' };
  }
  try {
    const entries = fs.readdirSync(target);
    for (const entry of entries) {
      const entryPath = path.join(target, entry);
      try {
        await deletePathRecursive(entryPath);
      } catch (entryErr) {
        console.warn('[LIB-CLEAR] No se pudo borrar', entryPath, '-', entryErr.message);
      }
    }
    console.log('[LIB-CLEAR] Carpeta current-project limpiada:', target);
    return { success: true, path: target };
  } catch (error) {
    console.error('[LIB-CLEAR] Error limpiando current-project:', error.message);
    return { success: false, error: error.message };
  }
}

ipcMain.handle('library:reset-current-project', async () => {
  console.log('[LIB-IPC] Limpiando carpeta current-project a petición del frontend...');
  return await clearCurrentProjectFolder();
});

ipcMain.handle('library:full-reset', async () => {
  console.log('[LIB-IPC] Reset completo: limpiando current-project + reiniciando PocketBase...');
  const clearResult = await clearCurrentProjectFolder();
  let pbResult = { success: true };
  try {
    if (pocketbaseProcess) {
      killProcess(pocketbaseProcess, 'PocketBase');
      pocketbaseProcess = null;
    }
    const port = parseInt(POCKETBASE_LOCAL_URL.split(':').pop() || '8091');
    killProcessByPort(port);
    startPocketBase();
  } catch (error) {
    console.error('[LIB-IPC] Error reiniciando PocketBase:', error.message);
    pbResult = { success: false, error: error.message };
  }
  return { clear: clearResult, pocketbase: pbResult };
});

ipcMain.on('window:minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.minimize();
});

ipcMain.on('window:maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});

ipcMain.on('window:close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.close();
});

ipcMain.on('window:set-titlebar-overlay', (event, { color, symbolColor }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && process.platform === 'win32') {
    try {
      win.setTitleBarOverlay({ color, symbolColor: symbolColor || '#9ca3af' });
    } catch (e) {
      console.warn('[ZEUS] Error aplicando titleBarOverlay:', e.message);
    }
  }
});

ipcMain.on('reload', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.webContents.reload();
});

ipcMain.on('force-reload', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.webContents.reloadIgnoringCache();
});

/** Abrir las DevTools de la ventana que invoca el IPC */
ipcMain.on('devtools:open', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.webContents.openDevTools();
});

/** Alternar visibilidad de las DevTools (abrir/cerrar) */
ipcMain.on('devtools:toggle', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.webContents.toggleDevTools();
});

ipcMain.handle('clipboard:writeText', (event, text) => {
  clipboard.writeText(String(text || ''));
  return { success: true };
});

ipcMain.on('navigate-to', (event, url) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || typeof url !== 'string' || !url.trim()) return;
  try {
    if (/^https?:\/\//i.test(url)) {
      win.loadURL(url);
      return;
    }
    win.loadURL(`http://localhost:8741${url.startsWith('/') ? url : `/${url}`}`);
  } catch (error) {
    console.error('navigate-to error:', error?.message || error);
  }
});

// Clipboard operations for file explorer
const CLIPBOARD_FORMAT = 'zeus-file-explorer';

ipcMain.handle('file-explorer:copy', (event, filePath) => {
  const data = JSON.stringify({
    operation: 'copy',
    path: filePath
  });
  clipboard.write({
    text: data,
    [CLIPBOARD_FORMAT]: data
  });
  return { success: true };
});

ipcMain.handle('file-explorer:cut', (event, filePath) => {
  const data = JSON.stringify({
    operation: 'cut',
    path: filePath
  });
  clipboard.write({
    text: data,
    [CLIPBOARD_FORMAT]: data
  });
  return { success: true };
});

ipcMain.handle('file-explorer:paste', (event, targetPath) => {
  try {
    const clipboardData = clipboard.readText();
    if (!clipboardData) {
      return { success: false, error: 'No hay contenido en el portapapeles' };
    }

    const data = JSON.parse(clipboardData);
    if (!data.operation || !data.path) {
      return { success: false, error: 'Formato de portapapeles inválido' };
    }

    // El sourcePath puede ser relativo (desde DATA_DIR) o absoluto
    // Construir la ruta absoluta del source
    const sourcePathRaw = data.path;
    const sourceName = path.basename(sourcePathRaw);

    // Usar la misma ruta que el backend API (DATA_PATH)
    const apiEnvPath = getApiEnvPath();
    const runtimeDataPath = path.join(app.getPath('userData'), 'api', 'data');

    // Leer DATA_PATH desde el archivo .env de la API
    let dataPath = runtimeDataPath;
    try {
      if (fs.existsSync(apiEnvPath)) {
        const envContent = fs.readFileSync(apiEnvPath, 'utf8');
        const dataPathMatch = envContent.match(/DATA_PATH\s*=\s*"([^"]+)"/);
        if (dataPathMatch) {
          let rawPath = dataPathMatch[1];
          // Convertir barras invertidas dobles a simples (C:\\\\ -> C:\\)
          rawPath = rawPath.replace(/\\\\/g, '\\');
          dataPath = path.normalize(path.isAbsolute(rawPath) ? rawPath : path.join(__dirname, '..', 'api', rawPath));
          console.log('DATA_PATH leído desde .env:', dataPath);
        } else {
          console.log('No se encontró DATA_PATH en .env, usando runtimeDataPath:', runtimeDataPath);
        }
      } else {
        console.log('Archivo .env no encontrado en:', apiEnvPath);
      }
    } catch (error) {
      console.warn('Error al leer DATA_PATH desde .env:', error.message);
    }

    // Construir ruta absoluta del source (si es relativa, se une con DATA_PATH)
    const absoluteSourcePath = path.isAbsolute(sourcePathRaw)
      ? path.normalize(sourcePathRaw)
      : path.join(dataPath, sourcePathRaw);

    console.log('Source path (raw):', sourcePathRaw);
    console.log('Source path (absolute):', absoluteSourcePath);
    console.log('Target path (input):', targetPath);

    // Convertir ruta relativa a absoluta usando DATA_PATH
    const absoluteTargetPath = path.isAbsolute(targetPath)
      ? path.normalize(targetPath)
      : path.join(dataPath, targetPath);
    let targetFilePath = path.join(absoluteTargetPath, sourceName);

    console.log('DATA_PATH usado:', dataPath);
    console.log('Absolute target path:', absoluteTargetPath);
    console.log('Target file path:', targetFilePath);

    // Verificar que el archivo origen existe
    if (!fs.existsSync(absoluteSourcePath)) {
      return { success: false, error: `El archivo origen no existe: ${absoluteSourcePath}` };
    }

    // Si el destino ya existe, añadir un número al nombre
    let counter = 1;
    const nameWithoutExt = path.parse(sourceName).name;
    const ext = path.parse(sourceName).ext;

    while (fs.existsSync(targetFilePath)) {
      targetFilePath = path.join(absoluteTargetPath, `${nameWithoutExt} (${counter})${ext}`);
      counter++;
    }

    // Asegurarse de que el directorio destino existe
    if (!fs.existsSync(absoluteTargetPath)) {
      fs.mkdirSync(absoluteTargetPath, { recursive: true });
    }

    if (data.operation === 'copy') {
      // Copiar archivo o carpeta
      if (fs.statSync(absoluteSourcePath).isDirectory()) {
        copyDirectoryRecursive(absoluteSourcePath, targetFilePath);
      } else {
        fs.copyFileSync(absoluteSourcePath, targetFilePath);
      }
      console.log('Archivo copiado exitosamente:', absoluteSourcePath, '->', targetFilePath);
      return { success: true, targetPath };
    } else if (data.operation === 'cut') {
      // Mover archivo o carpeta
      fs.renameSync(absoluteSourcePath, targetFilePath);
      // Limpiar el portapapeles después de cortar
      clipboard.clear();
      console.log('Archivo movido exitosamente:', absoluteSourcePath, '->', targetFilePath);
      return { success: true, targetPath };
    }
  } catch (error) {
    console.error('Error al pegar:', error);
    return { success: false, error: error.message || 'Error al pegar' };
  }
});

ipcMain.handle('file-explorer:has-clipboard-content', () => {
  try {
    const clipboardData = clipboard.readText();
    if (!clipboardData) {
      return false;
    }

    const data = JSON.parse(clipboardData);
    return data.operation === 'copy' || data.operation === 'cut';
  } catch (error) {
    return false;
  }
});

ipcMain.handle('file-explorer:delete', async (event, filePath) => {
  try {
    // Validar argumento
    if (typeof filePath !== 'string' || !filePath.trim()) {
      return { success: false, error: 'Ruta no válida' };
    }

    // Resolver DATA_PATH igual que en file-explorer:paste
    const apiEnvPath = getApiEnvPath();
    const runtimeDataPath = path.join(app.getPath('userData'), 'api', 'data');
    let dataPath = runtimeDataPath;
    try {
      if (fs.existsSync(apiEnvPath)) {
        const envContent = fs.readFileSync(apiEnvPath, 'utf8');
        const dataPathMatch = envContent.match(/DATA_PATH\s*=\s*"([^"]+)"/);
        if (dataPathMatch) {
          let rawPath = dataPathMatch[1].replace(/\\\\/g, '\\');
          dataPath = path.normalize(path.isAbsolute(rawPath) ? rawPath : path.join(__dirname, '..', 'api', rawPath));
        }
      }
    } catch (e) {
      console.warn('[file-explorer:delete] Error leyendo DATA_PATH:', e.message);
    }

    // Normalizar dataPath para la validación de seguridad
    const normalizedDataPath = path.normalize(dataPath).replace(/\\$/, '') + path.sep;

    const absolutePath = path.isAbsolute(filePath)
      ? path.normalize(filePath)
      : path.join(dataPath, filePath);

    if (!fs.existsSync(absolutePath)) {
      return { success: false, error: 'El archivo o carpeta no existe' };
    }

    // Validar que la ruta esté dentro de DATA_PATH por seguridad
    const normalizedAbsolute = path.normalize(absolutePath) + path.sep;
    if (!normalizedAbsolute.toLowerCase().startsWith(normalizedDataPath.toLowerCase())) {
      return { success: false, error: 'Ruta no permitida' };
    }

    // Borrado manual recursivo para evitar posibles bugs nativos de fs.promises.rm
    // en Node 24 / Windows con carpetas que contienen archivos de solo lectura.
    await deletePathRecursive(absolutePath);
    console.log('[file-explorer:delete] SUCCESS:', absolutePath);
    return { success: true };
  } catch (error) {
    console.error('[file-explorer:delete] Error:', error);
    let message = 'Error al eliminar';
    if (error && typeof error.message === 'string') {
      message = error.message;
    } else if (typeof error === 'string') {
      message = error;
    }
    // Mensajes claros para errores comunes de permisos en Windows
    const code = error?.code || '';
    if (code === 'EPERM' || code === 'EACCES') {
      message = 'No se tienen permisos para eliminar este elemento. Si está en "Archivos de programa", ejecuta la aplicación como administrador o mueve el proyecto a otra ubicación (ej. Documentos).';
    } else if (code === 'EBUSY') {
      message = 'El archivo está en uso por otro proceso (antivirus o aplicación). Inténtalo de nuevo en unos segundos.';
    }
    return { success: false, error: message };
  }
});

// Borrado recursivo manual con manejo de atributos de solo lectura en Windows.
async function deletePathRecursive(targetPath) {
  const stat = fs.statSync(targetPath);
  if (stat.isDirectory()) {
    const entries = fs.readdirSync(targetPath);
    for (const entry of entries) {
      await deletePathRecursive(path.join(targetPath, entry));
    }
    fs.rmdirSync(targetPath);
  } else {
    // En Windows, quitar atributo de solo lectura antes de borrar
    try {
      fs.chmodSync(targetPath, 0o666);
    } catch (chmodErr) {
      // Ignorar si chmod falla (quizás no tenemos permisos)
    }
    fs.unlinkSync(targetPath);
  }
}

// ===== INSTALADOR DE EXTENSIONES VS CODE =====
/**
 * Resuelve el binario de VS Code. Prioriza ZEUS_VSCODE_BIN si está definido;
 * si no, usa 'code' (que en Windows se resuelve desde PATH gracias a shell: true).
 */
function resolveCodeBin() {
  return process.env.ZEUS_VSCODE_BIN || 'code';
}

/**
 * Limpia y trunca buffers de stdout/stderr para que sean seguros de enviar
 * al renderer: filtra NUL chars, normaliza saltos de línea y limita cada
 * línea a MAX_LOG_LINE chars.
 */
const MAX_LOG_LINE = 500;
function sanitizeOutput(text) {
  if (!text) return '';
  return String(text)
    .replace(/ /g, '')
    .split(/\r?\n/)
    .map((line) => (line.length > MAX_LOG_LINE ? line.slice(0, MAX_LOG_LINE) + '…' : line))
    .join('\n')
    .trim();
}

/**
 * Localiza el binario `code` en Windows. Devuelve la ruta absoluta si existe,
 * o null si no se encuentra. En otros SO devuelve 'code' (que se resolverá
 * por PATH).
 */
function locateCodeBin() {
  const bin = resolveCodeBin();
  if (process.platform !== 'win32') return bin;
  if (path.isAbsolute(bin)) return bin;
  // Buscar en las rutas típicas
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code Insiders', 'bin', 'code.cmd'),
    'C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd',
    'C:\\Program Files (x86)\\Microsoft VS Code\\bin\\code.cmd',
  ];
  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c)) return c;
    } catch (_) { /* ignore */ }
  }
  return null;
}

/**
 * Construye un objeto env con el PATH del usuario de Windows extendido con
 * las rutas típicas de VS Code. Las apps GUI de Windows (Electron) no heredan
 * automáticamente el PATH de HKCU, así que si el usuario marcó "Add to PATH"
 * durante la instalación, hay que añadirlo manualmente.
 */
function buildSpawnEnv() {
  if (process.platform !== 'win32') return process.env;
  const env = { ...process.env };
  const userPath = process.env.PATH || '';
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'bin'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code Insiders', 'bin'),
    'C:\\Program Files\\Microsoft VS Code\\bin',
    'C:\\Program Files (x86)\\Microsoft VS Code\\bin',
  ];
  const missing = candidates.filter(
    (c) => c && !userPath.toLowerCase().split(';').includes(c.toLowerCase()),
  );
  if (missing.length) {
    env.PATH = [...missing, userPath].filter(Boolean).join(';');
  }
  return env;
}

/**
 * Ejecuta un comando del CLI de VS Code con timeout y captura de streams.
 * Devuelve { code, stdout, stderr, error? }. Nunca lanza excepciones.
 */
function runCodeCommand(args, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const env = buildSpawnEnv();
    const isWin = process.platform === 'win32';
    const overrideBin = process.env.ZEUS_VSCODE_BIN;

    // En Windows, localizar el binario real (no podemos fiarnos del PATH
    // porque las GUI apps no heredan el PATH del usuario).
    let spawnBin;
    let spawnArgs;
    if (isWin && !overrideBin) {
      const located = locateCodeBin();
      if (!located) {
        resolve({
          code: -1,
          stdout: '',
          stderr: '',
          error:
            'No se encontró "code.cmd" en las rutas típicas de VS Code. ' +
            'Asegúrate de tener VS Code instalado. Si lo tienes, define la variable ' +
            'de entorno ZEUS_VSCODE_BIN con la ruta absoluta a code.cmd.',
          durationMs: 0,
        });
        return;
      }
      // .cmd debe ejecutarse a través de cmd.exe /c
      spawnBin = 'cmd.exe';
      spawnArgs = ['/c', located, ...args];
    } else {
      spawnBin = overrideBin || resolveCodeBin();
      spawnArgs = args;
    }

    let child;
    try {
      child = spawn(spawnBin, spawnArgs, {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
      });
    } catch (err) {
      resolve({
        code: -1,
        stdout: '',
        stderr: '',
        error: `No se pudo iniciar "${spawnBin}": ${err && err.message ? err.message : String(err)}`,
        durationMs: 0,
      });
      return;
    }

    let stdout = '';
    let stderr = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      try { child.kill(); } catch (_) { /* ignore */ }
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        code: -1,
        stdout: sanitizeOutput(stdout),
        stderr: sanitizeOutput(stderr),
        error: `Error al ejecutar "${spawnBin}": ${err && err.message ? err.message : String(err)}`,
        durationMs: Date.now() - started,
      });
    });

    child.on('exit', (code) => {
      clearTimeout(timer);
      if (killed) {
        resolve({
          code: -1,
          stdout: sanitizeOutput(stdout),
          stderr: sanitizeOutput(stderr),
          error: `Tiempo de espera agotado (${timeoutMs}ms) ejecutando "${spawnBin} ${spawnArgs.join(' ')}"`,
          durationMs: Date.now() - started,
        });
        return;
      }
      resolve({
        code: typeof code === 'number' ? code : 0,
        stdout: sanitizeOutput(stdout),
        stderr: sanitizeOutput(stderr),
        durationMs: Date.now() - started,
      });
    });
  });
}

ipcMain.handle('vscode-extensions:check', async () => {
  const result = await runCodeCommand(['--version'], 5000);
  if (result.code === 0 && result.stdout) {
    // `code --version` imprime varias líneas (versión, commit, arch). Tomamos la primera.
    const firstLine = result.stdout.split(/\r?\n/)[0].trim();
    return {
      available: true,
      version: firstLine || undefined,
      path: resolveCodeBin(),
    };
  }
  return {
    available: false,
    path: resolveCodeBin(),
    error:
      result.error ||
      'No se encontró el comando "code" en PATH. Asegúrate de tener VS Code instalado y, en Windows, marca "Add to PATH" durante la instalación.',
  };
});

ipcMain.handle('vscode-extensions:list', async () => {
  const started = Date.now();
  const result = await runCodeCommand(['--list-extensions'], 30000);
  return {
    success: result.code === 0,
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    operation: { kind: 'list' },
    durationMs: Date.now() - started,
    error: result.error,
  };
});

ipcMain.handle('vscode-extensions:install', async (event, payload) => {
  const started = Date.now();
  if (!payload || typeof payload !== 'object') {
    return {
      success: false,
      code: -1,
      stdout: '',
      stderr: '',
      operation: { kind: 'install-id', id: '' },
      durationMs: 0,
      error: 'Payload inválido',
    };
  }

  const { id, vsixPath } = payload;

  // Validación de id (formato publisher.name)
  if (id) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_.-]+\.[a-zA-Z0-9_.-]+$/.test(id)) {
      return {
        success: false,
        code: -1,
        stdout: '',
        stderr: '',
        operation: { kind: 'install-id', id: String(id) },
        durationMs: 0,
        error: `Identificador de extensión inválido: "${id}". Debe tener el formato "publisher.name" (sólo letras, números, ".", "_" y "-").`,
      };
    }
  }

  // Validación de vsixPath
  if (vsixPath) {
    if (typeof vsixPath !== 'string' || !vsixPath.trim()) {
      return {
        success: false,
        code: -1,
        stdout: '',
        stderr: '',
        operation: { kind: 'install-vsix', vsixPath: String(vsixPath) },
        durationMs: 0,
        error: 'Ruta de archivo .vsix inválida',
      };
    }
    const normalized = path.normalize(vsixPath);
    if (path.extname(normalized).toLowerCase() !== '.vsix') {
      return {
        success: false,
        code: -1,
        stdout: '',
        stderr: '',
        operation: { kind: 'install-vsix', vsixPath: normalized },
        durationMs: 0,
        error: 'El archivo seleccionado no tiene extensión .vsix',
      };
    }
    if (!fs.existsSync(normalized)) {
      return {
        success: false,
        code: -1,
        stdout: '',
        stderr: '',
        operation: { kind: 'install-vsix', vsixPath: normalized },
        durationMs: 0,
        error: `El archivo no existe: ${normalized}`,
      };
    }
  }

  if (!id && !vsixPath) {
    return {
      success: false,
      code: -1,
      stdout: '',
      stderr: '',
      operation: { kind: 'install-id', id: '' },
      durationMs: 0,
      error: 'Debes proporcionar un id o una ruta .vsix',
    };
  }

  const target = id || vsixPath;
  const result = await runCodeCommand(['--install-extension', target], 120000);
  return {
    success: result.code === 0,
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    operation: id
      ? { kind: 'install-id', id }
      : { kind: 'install-vsix', vsixPath: path.normalize(vsixPath) },
    durationMs: Date.now() - started,
    error: result.error,
  };
});

ipcMain.handle('vscode-extensions:uninstall', async (event, payload) => {
  const started = Date.now();
  const id = payload && typeof payload === 'object' ? payload.id : null;
  if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9_.-]+\.[a-zA-Z0-9_.-]+$/.test(id)) {
    return {
      success: false,
      code: -1,
      stdout: '',
      stderr: '',
      operation: { kind: 'uninstall', id: String(id || '') },
      durationMs: 0,
      error: `Identificador de extensión inválido: "${id || ''}"`,
    };
  }
  const result = await runCodeCommand(['--uninstall-extension', id], 60000);
  return {
    success: result.code === 0,
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    operation: { kind: 'uninstall', id },
    durationMs: Date.now() - started,
    error: result.error,
  };
});

ipcMain.handle('vscode-extensions:toggle', async (event, payload) => {
  const started = Date.now();
  const id = payload && typeof payload === 'object' ? payload.id : null;
  const action = payload && typeof payload === 'object' ? payload.action : null;
  if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9_.-]+\.[a-zA-Z0-9_.-]+$/.test(id)) {
    return {
      success: false,
      code: -1,
      stdout: '',
      stderr: '',
      operation: { kind: action === 'enable' ? 'enable' : 'disable', id: String(id || '') },
      durationMs: 0,
      error: `Identificador de extensión inválido: "${id || ''}"`,
    };
  }
  if (action !== 'enable' && action !== 'disable') {
    return {
      success: false,
      code: -1,
      stdout: '',
      stderr: '',
      operation: { kind: 'disable', id },
      durationMs: 0,
      error: 'Acción inválida (debe ser "enable" o "disable")',
    };
  }
  const flag = action === 'enable' ? '--enable-extension' : '--disable-extension';
  const result = await runCodeCommand([flag, id], 30000);
  return {
    success: result.code === 0,
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    operation: { kind: action, id },
    durationMs: Date.now() - started,
    error: result.error,
  };
});

ipcMain.handle('vscode-extensions:pick-vsix', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { canceled: true };
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    title: 'Selecciona una extensión VS Code (.vsix)',
    filters: [
      { name: 'VS Code Extension', extensions: ['vsix'] },
      { name: 'Todos los archivos', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }
  return { canceled: false, filePath: result.filePaths[0] };
});

// ============================================================================
// Zeus VS Code Extensions IPC
//
// Estas APIs gestionan el ciclo de vida de las extensiones instaladas EN ZEUS
// (no en el VS Code del sistema como las APIs vscode-extensions:* de arriba).
// Las extensiones se guardan en userData/extensions/<publisher.name>/<version>/
// y el extension host de monaco-vscode-api las levanta al iniciar.
//
// Endpoints:
//   extensions:list         → lista extensiones instaladas leyendo package.json
//   extensions:install     → descarga .vsix desde Open VSX y lo extrae
//   extensions:uninstall   → borra la carpeta de la extensión
//   extensions:readBuffer   → lee un archivo dentro del .vsix extraído
// ============================================================================

const JSZip = require('jszip');
const ZEUS_EXTENSIONS_DIR = path.join(app.getPath('userData'), 'extensions');

function ensureExtensionsDir() {
  if (!fs.existsSync(ZEUS_EXTENSIONS_DIR)) {
    fs.mkdirSync(ZEUS_EXTENSIONS_DIR, { recursive: true });
  }
}

/**
 * Parsea un id de extensión estilo "publisher.name" y devuelve { namespace, name }.
 * Devuelve null si el formato no es válido.
 */
function parseExtensionId(id) {
  if (typeof id !== 'string') return null;
  const m = id.match(/^([a-zA-Z0-9_.-]+)\.([a-zA-Z0-9_.-]+)$/);
  if (!m) return null;
  return { namespace: m[1], name: m[2] };
}

ipcMain.handle('extensions:list', async () => {
  try {
    ensureExtensionsDir();
    const entries = fs.readdirSync(ZEUS_EXTENSIONS_DIR, { withFileTypes: true });
    const result = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const id = entry.name;
      const extDir = path.join(ZEUS_EXTENSIONS_DIR, id);
      // Cada carpeta puede tener múltiples versiones. Tomar la más alta (orden
      // lexicográfico basta para semver simple, no es ideal pero suficiente v1).
      let versions = [];
      try {
        versions = fs.readdirSync(extDir, { withFileTypes: true })
          .filter((v) => v.isDirectory())
          .map((v) => v.name)
          .sort()
          .reverse();
      } catch {
        continue;
      }
      if (versions.length === 0) continue;
      const version = versions[0];
      // Leer package.json dentro de extension/package.json
      const manifestPath = path.join(extDir, version, 'extension', 'package.json');
      let manifest = null;
      try {
        const raw = fs.readFileSync(manifestPath, 'utf-8');
        manifest = JSON.parse(raw);
      } catch {
        // Sin manifest, saltar
        continue;
      }
      result.push({
        id,
        namespace: manifest.publisher || id.split('.')[0],
        name: manifest.name || id.split('.').slice(1).join('.'),
        version,
        displayName: manifest.displayName || manifest.name || id,
        description: manifest.description || '',
        engines: manifest.engines || {},
        categories: manifest.categories || [],
        path: path.join(extDir, version),
      });
    }
    return { success: true, extensions: result };
  } catch (err) {
    console.error('[extensions:list]', err);
    return { success: false, error: err.message, extensions: [] };
  }
});

ipcMain.handle('extensions:install', async (event, payload) => {
  try {
    const { id, version } = payload || {};
    const parsed = parseExtensionId(id);
    if (!parsed) {
      return { success: false, error: `ID de extensión inválido: "${id}"` };
    }
    ensureExtensionsDir();
    const extDir = path.join(ZEUS_EXTENSIONS_DIR, id);
    // Determinar versión: usar la que pidió el usuario, o la más reciente
    // consultando Open VSX.
    let targetVersion = version;
    if (!targetVersion) {
      try {
        const metaUrl = `https://open-vsx.org/api/${parsed.namespace}/${parsed.name}`;
        const metaRes = await fetch(metaUrl);
        if (!metaRes.ok) {
          return { success: false, error: `No se pudo obtener metadata de Open VSX: HTTP ${metaRes.status}` };
        }
        const meta = await metaRes.json();
        // La respuesta tiene la forma:
        //   { version: "2.0.12",         ← última versión estable
        //     allVersions: { "2.0.12": "...", "2.0.5": "...", ... },
        //     preRelease: false, ... }
        // Si viene `version` (la latest), la usamos. Si no, hacemos fallback
        // a las claves de allVersions ordenadas por semver descendente.
        let versions = [];
        if (meta.version && !meta.preRelease) {
          versions = [meta.version];
        } else if (meta.allVersions && typeof meta.allVersions === 'object') {
          versions = Object.keys(meta.allVersions).sort((a, b) => {
            const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
            const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
            for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
              if ((pb[i] || 0) !== (pa[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
            }
            return 0;
          });
          // Si la latest es preRelease, descartarla y tomar la siguiente estable
          if (meta.preRelease && versions.length > 1) {
            versions = versions.slice(1);
          }
        }
        if (versions.length === 0) {
          return { success: false, error: 'La extensión no tiene versiones publicadas en Open VSX' };
        }
        targetVersion = versions[0];
      } catch (err) {
        return { success: false, error: `Error consultando Open VSX: ${err.message}` };
      }
    }
    const versionDir = path.join(extDir, targetVersion);
    // Si ya existe, no reinstalar
    if (fs.existsSync(path.join(versionDir, 'extension', 'package.json'))) {
      return {
        success: true,
        alreadyInstalled: true,
        id,
        version: targetVersion,
        path: versionDir,
      };
    }
    // Descargar el .vsix desde Open VSX
    const downloadUrl = `https://open-vsx.org/api/${parsed.namespace}/${parsed.name}/${targetVersion}/file/${parsed.namespace}.${parsed.name}-${targetVersion}.vsix`;
    console.log(`[extensions:install] Downloading ${downloadUrl}`);
    const downloadRes = await fetch(downloadUrl);
    if (!downloadRes.ok) {
      return { success: false, error: `No se pudo descargar el .vsix: HTTP ${downloadRes.status}` };
    }
    const buffer = Buffer.from(await downloadRes.arrayBuffer());
    // Extraer con JSZip
    const zip = await JSZip.loadAsync(buffer);
    fs.mkdirSync(versionDir, { recursive: true });
    const entries = [];
    zip.forEach((relativePath, file) => {
      entries.push({ relativePath, file });
    });
    for (const { relativePath, file } of entries) {
      const outPath = path.join(versionDir, relativePath);
      if (file.dir) {
        fs.mkdirSync(outPath, { recursive: true });
      } else {
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        // JSZip.loadAsync lee los archivos perezosamente, hay que .async()
        const content = await file.async('nodebuffer');
        fs.writeFileSync(outPath, content);
      }
    }
    return {
      success: true,
      id,
      version: targetVersion,
      path: versionDir,
    };
  } catch (err) {
    console.error('[extensions:install]', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('extensions:uninstall', async (event, payload) => {
  try {
    const { id } = payload || {};
    const parsed = parseExtensionId(id);
    if (!parsed) {
      return { success: false, error: `ID de extensión inválido: "${id}"` };
    }
    const extDir = path.join(ZEUS_EXTENSIONS_DIR, id);
    if (!fs.existsSync(extDir)) {
      return { success: true, alreadyAbsent: true };
    }
    fs.rmSync(extDir, { recursive: true, force: true });
    return { success: true };
  } catch (err) {
    console.error('[extensions:uninstall]', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('extensions:readBuffer', async (event, payload) => {
  try {
    const { id, version, path: relPath } = payload || {};
    const parsed = parseExtensionId(id);
    if (!parsed) {
      return { success: false, error: `ID de extensión inválido: "${id}"` };
    }
    // Si no se pasa version, usar la más alta disponible
    let targetVersion = version;
    if (!targetVersion) {
      const extDir = path.join(ZEUS_EXTENSIONS_DIR, id);
      if (!fs.existsSync(extDir)) {
        return { success: false, error: `Extensión no instalada: ${id}` };
      }
      const versions = fs.readdirSync(extDir, { withFileTypes: true })
        .filter((v) => v.isDirectory())
        .map((v) => v.name)
        .sort()
        .reverse();
      if (versions.length === 0) {
        return { success: false, error: `No hay versiones instaladas de ${id}` };
      }
      targetVersion = versions[0];
    }
    // relPath es relativo a <extDir>/<version>/
    const fullPath = path.join(ZEUS_EXTENSIONS_DIR, id, targetVersion, relPath);
    // Path traversal guard: el path resuelto tiene que seguir dentro de la carpeta de la extensión
    const resolvedPath = path.resolve(fullPath);
    const extBasePath = path.resolve(ZEUS_EXTENSIONS_DIR, id, targetVersion);
    if (!resolvedPath.startsWith(extBasePath + path.sep) && resolvedPath !== extBasePath) {
      return { success: false, error: 'Path traversal detectado' };
    }
    if (!fs.existsSync(resolvedPath)) {
      return { success: false, error: `Archivo no encontrado: ${relPath}` };
    }
    const content = fs.readFileSync(resolvedPath);
    // Si es texto (json, js, ts, css, html, md, tmLanguage) devolver string;
    // si es binario, devolver base64. Para simplificar v1 devolvemos siempre string.
    return { success: true, content: content.toString('utf-8'), path: relPath };
  } catch (err) {
    console.error('[extensions:readBuffer]', err);
    return { success: false, error: err.message };
  }
});

function copyDirectoryRecursive(source, target) {
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }

  const entries = fs.readdirSync(source, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(source, entry.name);
    const destPath = path.join(target, entry.name);

    if (entry.isDirectory()) {
      copyDirectoryRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function getApiEnvPath() {
  if (isDev) {
    return path.join(getAppBasePath(), 'api', '.env');
  }

  const envDir = path.join(app.getPath('userData'), 'api');
  fs.mkdirSync(envDir, { recursive: true });
  return path.join(envDir, '.env');
}

function getRuntimeBaseCandidates() {
  const candidates = [
    path.join(process.resourcesPath, 'app'),
    app.getAppPath()
  ];

  return [...new Set(candidates.filter(Boolean))];
}

function resolveRuntimeFile(relativeSegments) {
  const runtimeBases = getRuntimeBaseCandidates();

  for (const basePath of runtimeBases) {
    const candidatePath = path.join(basePath, ...relativeSegments);
    if (fs.existsSync(candidatePath)) {
      return {
        basePath,
        filePath: candidatePath
      };
    }
  }

  return null;
}

function buildRuntimeNodePath() {
  const entries = getRuntimeBaseCandidates().flatMap((basePath) => [
    path.join(basePath, 'api', 'node_modules'),
    path.join(basePath, 'terminal-server', 'node_modules'),
    path.join(basePath, 'components', 'formatter-server', 'node_modules'),
    path.join(basePath, 'node_modules')
  ]).filter((entry, index, arr) => fs.existsSync(entry) && arr.indexOf(entry) === index);

  if (process.env.NODE_PATH) {
    entries.push(process.env.NODE_PATH);
  }

  return entries.join(path.delimiter);
}

function ensureApiEnvDataPath(apiEnvPath, defaultDataPath) {
  try {
    const envDir = path.dirname(apiEnvPath);
    fs.mkdirSync(envDir, { recursive: true });

    let envContent = '';
    if (fs.existsSync(apiEnvPath)) {
      envContent = fs.readFileSync(apiEnvPath, 'utf8');
    }

    const hasDataPath = /^\s*DATA_PATH\s*=\s*.+$/m.test(envContent);
    if (!hasDataPath) {
      const escapedPath = defaultDataPath.replace(/\\/g, '\\\\');
      const trimmed = envContent.trimEnd();
      const separator = trimmed.length > 0 ? '\n' : '';
      const nextContent = `${trimmed}${separator}DATA_PATH="${escapedPath}"\n`;
      fs.writeFileSync(apiEnvPath, nextContent, 'utf8');
      console.log(`[CONFIG] DATA_PATH por defecto guardado en .env: ${defaultDataPath}`);
    }
  } catch (error) {
    console.error('[CONFIG] No se pudo asegurar DATA_PATH en .env:', error.message);
  }
}

function runNodeScript(scriptPath, args = [], options = {}) {
  return spawn(process.execPath, [scriptPath, ...args], {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.env,
      ELECTRON_RUN_AS_NODE: '1'
    },
    shell: false,
    windowsHide: true
  });
}

function createWindow() {
  const appBasePath = getAppBasePath();
  const headerColor = '#111827';

  // Dimensiones objetivo de la ventana de contenido
  const TARGET_WIDTH = 1400;
  const TARGET_HEIGHT = 820;

  // Cargar estado previo o usar valores por defecto
  const savedState = loadWindowState();
  const initialWidth = savedState ? savedState.width : TARGET_WIDTH;
  const initialHeight = savedState ? savedState.height : TARGET_HEIGHT;
  const initialX = savedState ? savedState.x : undefined;
  const initialY = savedState ? savedState.y : undefined;

  const win = new BrowserWindow({
    width: initialWidth,
    height: initialHeight,
    x: initialX,
    y: initialY,
    useContentSize: true,
    autoHideMenuBar: true,
    backgroundColor: '#060a14',
    ...(process.platform === 'win32' ? {
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#0b111e',
        symbolColor: '#9ca3af',
        height: 32
      }
    } : {}),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(getAppBasePath(), 'public', 'LOGO_ZEUS-ico.ico'),
    show: false
  });

  // Restaurar estado maximizado
  if (savedState && savedState.isMaximized) {
    win.maximize();
  }

  win.setMenuBarVisibility(false);
  win.removeMenu();

  // Forzar dimensiones exactas después de mostrar la ventana
  // (necesario en producción empaquetada donde DPI scaling altera el tamaño)
  const enforceWindowSize = () => {
    if (win.isDestroyed()) return;
    const [w, h] = win.getContentSize();
    if (w !== TARGET_WIDTH || h !== TARGET_HEIGHT) {
      console.log(`[ZEUS] Ajustando tamaño de ventana: ${w}x${h} → ${TARGET_WIDTH}x${TARGET_HEIGHT}`);
      win.setContentSize(TARGET_WIDTH, TARGET_HEIGHT, true);
      win.setBounds({ width: TARGET_WIDTH, height: TARGET_HEIGHT });
    }
  };

  // Solo forzar tamaño exacto si NO hay estado guardado del usuario
  if (!savedState) {
    win.once('ready-to-show', enforceWindowSize);
    win.on('show', enforceWindowSize);
    setTimeout(enforceWindowSize, 500);
    setTimeout(enforceWindowSize, 1500);
  }

  // Guardar estado al cerrar
  win.on('close', () => saveWindowState(win));

  // Aplicar zoom inicial
  if (INITIAL_ZOOM !== 1.0) {
    win.webContents.setZoomFactor(INITIAL_ZOOM);
  }

  // Permitir acceso al micrófono para reconocimiento de voz
  win.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const allowedPermissions = ['media', 'microphone'];
    if (allowedPermissions.includes(permission)) {
      callback(true);
    } else {
      callback(false);
    }
  });

  win.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    const allowedPermissions = ['media', 'microphone'];
    return allowedPermissions.includes(permission);
  });

  const isBlockedLocalUrl = (url) => {
    try {
      const u = new URL(url);
      const blockedHosts = ['127.0.0.1', 'localhost'];
      const blockedPorts = ['8091'];
      return blockedHosts.includes(u.hostname) && blockedPorts.includes(u.port);
    } catch {
      return false;
    }
  };

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isBlockedLocalUrl(url)) {
      console.log('Bloqueada apertura de URL local de PocketBase:', url);
      return { action: 'deny' };
    }
    if (url) {
      shell.openExternal(url).catch((err) => {
        console.error('No se pudo abrir URL externa:', err?.message || err);
      });
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (isBlockedLocalUrl(url)) {
      console.log('Bloqueada navegacion a URL local de PocketBase:', url);
      event.preventDefault();
    }
  });

  const loadApp = async () => {
    try {
      const url = 'http://localhost:8741';
      console.log('Cargando URL:', url);
      
      // Mostrar la ventana inmediatamente (sin enfocar para evitar flicker)
      win.showInactive();
      console.log('Ventana mostrada forzosamente');
      
      if (isDev) {
        win.webContents.openDevTools();
      }
      
      await win.loadURL(url);

      // Manejar errores de carga
      win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        // Ignorar errores de iframes (previews de proyectos, etc.)
        if (!isMainFrame) {
          console.warn(`[did-fail-load] Ignorando error de iframe/subframe: ${validatedURL} -> ${errorDescription} (${errorCode})`);
          return;
        }

        console.error('Error al cargar la aplicación (main frame):', errorCode, errorDescription, validatedURL);

        // Solo reintentar si la URL que falló es la URL principal de la app
        if (validatedURL && validatedURL.includes('localhost:8741')) {
          // Reintentar después de un delay
          setTimeout(() => {
            console.log('Reintentando cargar la aplicación...');
            loadApp();
          }, 3000);
        }
      });

    } catch (error) {
      console.error('Error en loadApp:', error);
      
      // Asegurar que la ventana se muestre incluso con error
      win.showInactive();
      
      // Si falla completamente, mostrar una página de error
      win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
        <html>
          <body style="font-family: Arial, sans-serif; padding: 40px; background: #f5f5f5;">
            <h1 style="color: #e74c3c;">Error al cargar la aplicación</h1>
            <p>No se pudo conectar con el servidor Next.js en localhost:8741</p>
            <p>Verifica que el servidor esté en ejecución y vuelve a intentarlo.</p>
            <button onclick="location.reload()" style="padding: 10px 20px; background: #3498db; color: white; border: none; border-radius: 5px; cursor: pointer;">
              Reintentar
            </button>
          </body>
        </html>
      `));
    }
  };

  loadApp();

  // Asegurar que la aplicación se cierre al cerrar esta ventana
  win.on('closed', () => {
    console.log('Ventana principal cerrada, saliendo de la aplicación...');
    app.quit();
  });
  
  // Timeout de seguridad para mostrar la ventana si no se ha mostrado
  setTimeout(() => {
    if (!win.isVisible()) {
      console.log('Timeout: Forzando muestra de la ventana');
      win.showInactive();
    }
  }, 5000);
  
}

function isDirEmptyOrMissing(dir) {
  try {
    if (!fs.existsSync(dir)) return true;
    const files = fs.readdirSync(dir);
    return files.length === 0;
  } catch {
    return true;
  }
}

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      const lowerName = entry.name.toLowerCase();
      if (lowerName.endsWith('.db-shm') || lowerName.endsWith('.db-wal')) {
        console.log('[PB-SEED] Skipping lock file:', entry.name);
        continue;
      }
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function getAdminTokenPath() {
  return path.join(app.getPath('userData'), 'pocketbase', 'admin-token.json');
}

function saveAdminToken(token) {
  try {
    fs.writeFileSync(getAdminTokenPath(), JSON.stringify({ token, timestamp: Date.now() }, null, 2));
    pocketbaseAdminToken = token;
    console.log('PocketBase admin token guardado.');
  } catch (error) {
    console.error('Error guardando admin token:', error.message);
  }
}

async function waitForPocketBase(timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      http.get(`${POCKETBASE_LOCAL_URL}/api/health`, (res) => {
        if (res.statusCode === 200) {
          resolve(true);
        } else {
          retry();
        }
      }).on('error', retry);

      function retry() {
        if (Date.now() - start > timeoutMs) {
          reject(new Error('PocketBase no respondio a tiempo'));
          return;
        }
        setTimeout(check, 500);
      }
    };
    check();
  });
}

async function authenticatePocketBaseAdmin() {
  try {
    await waitForPocketBase();
  } catch (error) {
    console.error('PocketBase no esta disponible para autenticacion:', error.message);
    return;
  }

  const loginPayload = JSON.stringify({
    identity: POCKETBASE_LOCAL_ADMIN_EMAIL,
    password: POCKETBASE_LOCAL_ADMIN_PASSWORD
  });

  return new Promise((resolve, reject) => {
    const req = http.request(`${POCKETBASE_LOCAL_URL}/api/collections/_superusers/auth-with-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(loginPayload)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', async () => {
        try {
          const json = JSON.parse(data);
          if (json.token) {
            saveAdminToken(json.token);
            resolve(json.token);
          } else {
            console.error('Fallo el login de PocketBase (Admin):', json.message || json);
            reject(new Error(json.message || 'Auth sin token'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(loginPayload);
    req.end();
  });
}


function startBackendServices() {
  const apiEnvPath = getApiEnvPath();
  const appBasePath = getAppBasePath();
  const runtimeDataPath = path.join(app.getPath('userData'), 'api', 'data');

  try {
    fs.mkdirSync(runtimeDataPath, { recursive: true });
  } catch (error) {
    console.error('No se pudo preparar DATA_PATH en userData:', error.message);
  }

  ensureApiEnvDataPath(apiEnvPath, runtimeDataPath);

  // Inicia la API
  if (isDev) {
    console.log('Iniciando API en modo desarrollo...');
    apiProcess = exec('npx tsx api/server.js', { cwd: appBasePath }, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error al iniciar la API: ${error.message}`);
        return;
      }
      if (stderr) {
        console.error(`API stderr: ${stderr}`);
      }
      console.log(`API stdout: ${stdout}`);
    });
  } else {
    console.log('Iniciando API en modo producción...');
    const runtimeNodePath = buildRuntimeNodePath();
    const apiResolved = resolveRuntimeFile(['api', 'server.js']);

    if (!apiResolved) {
      console.error('No se encontró api/server.js en ninguna ruta candidata:', getRuntimeBaseCandidates());
      return;
    }

    console.log('API script seleccionado:', apiResolved.filePath);
    apiProcess = runNodeScript(apiResolved.filePath, [], {
      cwd: apiResolved.basePath,
      env: {
        ZEUS_API_ENV_PATH: apiEnvPath,
        NODE_PATH: runtimeNodePath
      }
    });
    apiProcess.stdout?.on('data', (data) => console.log(`API stdout: ${data.toString()}`));
    apiProcess.stderr?.on('data', (data) => console.error(`API stderr: ${data.toString()}`));
    apiProcess.on('error', (error) => console.error('Error al iniciar la API:', error));
  }

   // ===== Inicia la API RAE (api/api-rae/api.ts) =====
  if (isDev) {
    console.log('Iniciando API RAE en modo desarrollo...');
    const raeApiDir = path.join(appBasePath, 'api', 'api-rae');
    // Usar ts-node local de api-rae/node_modules si existe, si no, el global
    const tsNodeLocal = path.join(raeApiDir, 'node_modules', '.bin', 'ts-node.cmd');
    const tsNodeFallback = path.join(raeApiDir, 'node_modules', '.bin', 'ts-node');
    const tsNodeBin = fs.existsSync(tsNodeLocal) ? tsNodeLocal : tsNodeFallback;
    raeApiProcess = spawn(tsNodeBin, ['api.ts'], {
      cwd: raeApiDir,
      env: { ...process.env },
      shell: true,
      windowsHide: true
    });
    raeApiProcess.stdout?.on('data', (data) => console.log(`RAE-API stdout: ${data.toString()}`));
    raeApiProcess.stderr?.on('data', (data) => console.error(`RAE-API stderr: ${data.toString()}`));
    raeApiProcess.on('error', (error) => console.error('Error al iniciar API RAE:', error));
  } else {
    console.log('Iniciando API RAE en modo producción...');
    const runtimeNodePath = buildRuntimeNodePath();
    // Buscar el JS compilado: primero dist/api.js, luego api.js directamente
    const raeResolved =
      resolveRuntimeFile(['api', 'api-rae', 'dist', 'api.js']) ||
      resolveRuntimeFile(['api', 'api-rae', 'api.js']);
    if (!raeResolved) {
      console.warn('[RAE-API] No se encontró el script compilado (api/api-rae/dist/api.js ni api/api-rae/api.js). La API RAE no se iniciará.');
    } else {
      console.log('[RAE-API] Script seleccionado:', raeResolved.filePath);
      raeApiProcess = runNodeScript(raeResolved.filePath, [], {
        cwd: path.join(raeResolved.basePath, 'api', 'api-rae'),
        env: { NODE_PATH: runtimeNodePath }
      });
      raeApiProcess.stdout?.on('data', (data) => console.log(`RAE-API stdout: ${data.toString()}`));
      raeApiProcess.stderr?.on('data', (data) => console.error(`RAE-API stderr: ${data.toString()}`));
      raeApiProcess.on('error', (error) => console.error('Error al iniciar API RAE:', error));
    }
  }

  // Inicia el servidor de terminal
  if (isDev) {
    console.log('Iniciando servidor de terminal en modo desarrollo...');
    terminalProcess = exec('node dist/terminal-server.js', { cwd: path.join(appBasePath, 'terminal-server') }, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error al iniciar el servidor de terminal: ${error.message}`);
        return;
      }
      if (stderr) {
        console.error(`Terminal stderr: ${stderr}`);
      }
      console.log(`Terminal stdout: ${stdout}`);
    });
  } else {
    console.log('Iniciando servidor de terminal en modo producción...');
    const runtimeNodePath = buildRuntimeNodePath();
    const terminalResolved = resolveRuntimeFile(['terminal-server', 'dist', 'terminal-server.js']);

    if (!terminalResolved) {
      console.error('No se encontró terminal-server/dist/terminal-server.js en ninguna ruta candidata:', getRuntimeBaseCandidates());
      return;
    }

    console.log('Terminal script seleccionado:', terminalResolved.filePath);
    terminalProcess = runNodeScript(terminalResolved.filePath, [], {
      cwd: terminalResolved.basePath,
      env: {
        ZEUS_API_ENV_PATH: apiEnvPath,
        NODE_PATH: runtimeNodePath
      }
    });
    terminalProcess.stdout?.on('data', (data) => console.log(`Terminal stdout: ${data.toString()}`));
    terminalProcess.stderr?.on('data', (data) => console.error(`Terminal stderr: ${data.toString()}`));
    terminalProcess.on('error', (error) => console.error('Error al iniciar el servidor de terminal:', error));
  }

  // Inicia el servidor del formateador
  if (isDev) {
    console.log('Iniciando servidor del formateador en modo desarrollo...');
    formatterProcess = exec('node index.js', { cwd: path.join(appBasePath, 'components', 'formatter-server') }, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error al iniciar el servidor del formateador: ${error.message}`);
        return;
      }
      if (stderr) {
        console.error(`Formatter stderr: ${stderr}`);
      }
      console.log(`Formatter stdout: ${stdout}`);
    });
  } else {
    console.log('Iniciando servidor del formateador en modo producción...');
    const runtimeNodePath = buildRuntimeNodePath();
    const formatterResolved = resolveRuntimeFile(['components', 'formatter-server', 'index.js']);

    if (!formatterResolved) {
      console.error('No se encontró components/formatter-server/index.js en ninguna ruta candidata:', getRuntimeBaseCandidates());
      return;
    }

    console.log('Formatter script seleccionado:', formatterResolved.filePath);
    formatterProcess = runNodeScript(formatterResolved.filePath, [], {
      cwd: formatterResolved.basePath,
      env: {
        NODE_PATH: runtimeNodePath
      }
    });
    formatterProcess.stdout?.on('data', (data) => console.log(`Formatter stdout: ${data.toString()}`));
    formatterProcess.stderr?.on('data', (data) => console.error(`Formatter stderr: ${data.toString()}`));
    formatterProcess.on('error', (error) => console.error('Error al iniciar el servidor del formateador:', error));
  }

  // Inicia PocketBase (base de datos local)
  startPocketBase();
}

/** Inicia el proceso de PocketBase (base de datos local) */
function startPocketBase() {
  if (pocketbaseProcess) {
    console.log('[PB] PocketBase ya está en ejecución.');
    return;
  }

  const appBasePath = getAppBasePath();
  const resourcesPocketbasePath = isDev
    ? path.join(appBasePath, 'pocket-base-zeus', 'pocket-base')
    : path.join(process.resourcesPath, 'pocket-base-zeus', 'pocket-base');

  const userDataPocketbaseDir = path.join(app.getPath('userData'), 'pocketbase');
  const userDataPocketbaseBinDir = path.join(userDataPocketbaseDir, 'bin');
  const pocketbaseDataPath = path.join(userDataPocketbaseDir, 'pb_data');
  const pocketbaseExePath = path.join(userDataPocketbaseBinDir, 'pocketbase.exe');

  // En producción, inicializar la carpeta de PocketBase en userData si no existe
  if (!isDev) {
    const userDataExists = fs.existsSync(userDataPocketbaseDir);
    const exeExists = fs.existsSync(pocketbaseExePath);

    if (!userDataExists || !exeExists) {
      console.log('[PB-SETUP] Inicializando PocketBase en userData por primera vez...');
      try {
        if (!fs.existsSync(userDataPocketbaseDir)) {
          fs.mkdirSync(userDataPocketbaseDir, { recursive: true });
        }
        if (!fs.existsSync(userDataPocketbaseBinDir)) {
          fs.mkdirSync(userDataPocketbaseBinDir, { recursive: true });
        }

        // Copia inicial íntegra desde resources
        if (fs.existsSync(resourcesPocketbasePath)) {
          console.log('[PB-SETUP] Copiando archivos base desde resources...');
          copyDirRecursive(resourcesPocketbasePath, userDataPocketbaseDir);

          // Asegurar que el ejecutable esté en la carpeta /bin
          const sourceExe = path.join(resourcesPocketbasePath, 'pocketbase.exe');
          if (fs.existsSync(sourceExe)) {
            fs.copyFileSync(sourceExe, pocketbaseExePath);
          }
        }
      } catch (error) {
        console.error('[PB-SETUP] Error en la inicialización:', error.message);
      }
    }
  }

  // Definir la ruta final del binario
  const finalPocketbasePath = isDev ? path.join(resourcesPocketbasePath, 'pocketbase.exe') : pocketbaseExePath;
  const finalDataPath = isDev ? path.join(resourcesPocketbasePath, 'pb_data') : pocketbaseDataPath;

  console.log(`[PB-START] Iniciando PocketBase desde: ${finalPocketbasePath}`);

  const pocketbaseHttpAddr = POCKETBASE_LOCAL_URL.replace(/^https?:\/\//, '');

  // Asegurar que el puerto esté libre antes de iniciar
  const port = parseInt(pocketbaseHttpAddr.split(':').pop() || '8091');
  killProcessByPort(port);

  pocketbaseProcess = spawn(finalPocketbasePath, ['serve', '--dir', finalDataPath, `--http=${pocketbaseHttpAddr}`], {
    cwd: isDev ? resourcesPocketbasePath : userDataPocketbaseDir,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  pocketbaseProcess.stdout?.on('data', (data) => console.log(`PocketBase stdout: ${data.toString()}`));
  pocketbaseProcess.stderr?.on('data', (data) => console.error(`PocketBase stderr: ${data.toString()}`));
  pocketbaseProcess.on('error', (error) => console.error('Error al iniciar PocketBase:', error));

  // Autenticación (o creación inicial)
  if (typeof authenticatePocketBaseAdmin === 'function') {
    authenticatePocketBaseAdmin().catch(err => console.error('Admin auth error:', err.message));
  }
}

function startNextServer() {
  return new Promise((resolve, reject) => {
    const resourcePath = getAppBasePath();
    const nextRuntimePath = app.getAppPath();
    
    console.log('Resource path:', resourcePath);
    console.log('Next runtime path:', nextRuntimePath);

    if (isDev) {
      // Misma fuente que en producción: Next lee DATA_PATH del api/.env que Electron gestiona
      const apiEnvPath = getApiEnvPath();
      nextProcess = exec('npm run dev', {
        cwd: resourcePath,
        env: {
          ...process.env,
          NODE_ENV: 'development',
          PORT: '8741',
          ZEUS_API_ENV_PATH: apiEnvPath
        },
        shell: true
      });
    } else {
      const nodePathEntries = [
        path.join(resourcePath, 'api', 'node_modules'),
        path.join(resourcePath, 'node_modules'),
        path.join(nextRuntimePath, 'node_modules')
      ].filter((entry) => fs.existsSync(entry));

      const nextCliCandidates = [
        path.join(resourcePath, 'api', 'node_modules', 'next', 'dist', 'bin', 'next'),
        path.join(resourcePath, 'node_modules', 'next', 'dist', 'bin', 'next'),
        path.join(nextRuntimePath, 'node_modules', 'next', 'dist', 'bin', 'next')
      ];
      const nextCli = nextCliCandidates.find((candidate) => fs.existsSync(candidate));

      if (!nextCli) {
        reject(new Error(`No se encontró Next CLI. Revisado: ${nextCliCandidates.join(' | ')}`));
        return;
      }

      const nextCwdCandidates = [resourcePath, nextRuntimePath];
      const nextCwd = nextCwdCandidates.find((candidate) => fs.existsSync(path.join(candidate, '.next'))) || resourcePath;

      console.log('Next CLI selected:', nextCli);
      console.log('Next CWD selected:', nextCwd);
      console.log('Next NODE_PATH entries:', nodePathEntries.join(path.delimiter));

      nextProcess = runNodeScript(nextCli, ['start', '-p', '8741'], {
        cwd: nextCwd,
        env: {
          NODE_ENV: 'production',
          PORT: '8741',
          ZEUS_API_ENV_PATH: getApiEnvPath(),
          ZEUS_UPLOADS_PATH: path.join(app.getPath('userData'), 'uploads'),
          NODE_PATH: [
            ...nodePathEntries,
            process.env.NODE_PATH || ''
          ].filter(Boolean).join(path.delimiter)
        }
      });
    }

    let serverStarted = false;
    let portAlreadyInUse = false;
    let settled = false;
    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };

    const timeout = setTimeout(() => {
      if (!serverStarted && !portAlreadyInUse) {
        rejectOnce(new Error('Timeout esperando el servidor Next.js'));
      }
    }, 45000);

    nextProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`Next.js stdout: ${output}`);
      
      if (output.includes('ready') || 
          output.includes('started') || 
          output.includes('localhost:8741') ||
          output.includes('> Ready on') ||
          output.includes('> Local:')) {
        serverStarted = true;
        console.log('Servidor Next.js detectado como iniciado');
        setTimeout(resolveOnce, 2000); // Esperar un poco más para asegurar que esté completamente listo
      }
    });

    nextProcess.stderr.on('data', (data) => {
      const output = data.toString();
      console.error(`Next.js stderr: ${output}`);
      if (output.includes('EADDRINUSE')) {
        portAlreadyInUse = true;
        console.warn('Puerto 8741 en uso: se reutilizará el servidor existente.');
      }
    });

    nextProcess.on('close', (code) => {
      if (portAlreadyInUse && !serverStarted) {
        console.log('Next.js ya estaba ejecutándose en localhost:8741. Continuando arranque...');
        resolveOnce();
        return;
      }

      if (code !== 0 && !serverStarted) {
        rejectOnce(new Error(`Next.js server exited with code ${code}`));
      }
    });

    nextProcess.on('error', (error) => {
      console.error('Error al ejecutar Next.js:', error);
      rejectOnce(error);
    });
  });
}

app.whenReady().then(async () => {
  try {
    console.log('Iniciando servidor Next.js...');
    await startNextServer();

    console.log('Iniciando servicios de backend...');
    startBackendServices();

    // Iniciar preview server (serve/server.js) automáticamente
    const appBasePath = getAppBasePath();
    const previewServerPath = path.join(appBasePath, 'serve', 'server.js');
    if (fs.existsSync(previewServerPath)) {
      console.log('Iniciando preview server...');

      // En producción empaquetada, usar un directorio del usuario para escritura (evita EACCES en Program Files)
      const previewWorkDir = path.join(process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir(), 'ZeusIA');
      const previewProjectsDir = path.join(previewWorkDir, 'projects', 'current-project');
      const previewUploadsDir = path.join(previewWorkDir, 'uploads');
      try {
        fs.mkdirSync(previewProjectsDir, { recursive: true });
        fs.mkdirSync(previewUploadsDir, { recursive: true });
        console.log('[PreviewServer] Directorios de trabajo preparados:', previewWorkDir);
      } catch (dirErr) {
        console.error('[PreviewServer] No se pudieron crear directorios de trabajo:', dirErr.message);
      }

      previewServerProcess = runNodeScript(previewServerPath, [], {
        cwd: path.join(appBasePath, 'serve'),
        env: {
          DISABLE_TUNNEL: 'true',
          PROJECTS_DIR: previewProjectsDir,
          UPLOADS_DIR: previewUploadsDir,
          ZEUS_PACKAGED: '1'
        }
      });
      previewServerProcess.stdout?.on('data', (data) => console.log(`PreviewServer stdout: ${data.toString()}`));
      previewServerProcess.stderr?.on('data', (data) => console.error(`PreviewServer stderr: ${data.toString()}`));
      previewServerProcess.on('error', (error) => console.error('Error al iniciar preview server:', error));
      previewServerProcess.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          console.error(`[PreviewServer] Proceso terminado con código ${code}`);
        }
      });

      // Verificar que realmente escuche en 8744 tras unos segundos
      setTimeout(() => {
        try {
          const testReq = http.get('http://localhost:8744/api/project-status/test', (res) => {
            console.log(`[PreviewServer] Verificación de puerto 8744: HTTP ${res.statusCode} ✅`);
          });
          testReq.on('error', (err) => {
            console.warn('[PreviewServer] Puerto 8744 no responde todavía:', err.message);
          });
          testReq.setTimeout(3000, () => testReq.destroy());
        } catch (e) {
          console.warn('[PreviewServer] No se pudo verificar puerto 8744:', e.message);
        }
      }, 8000);
    } else {
      console.warn('No se encontró serve/server.js en:', previewServerPath);
    }

    console.log('Servidor Next.js e hilos de backend iniciados, creando ventana...');
    createWindow();

    // Forzar dimensiones exactas tras 3 segundos (garantía contra DPI scaling)
    setTimeout(() => {
      BrowserWindow.getAllWindows().forEach((w) => {
        if (!w.isDestroyed()) {
          w.showInactive();
          w.setBounds({ width: 1400, height: 820 });
        }
      });
    }, 3000);

    // Guardar estado de ventana cada 30 segundos
    setInterval(() => {
      BrowserWindow.getAllWindows().forEach((w) => {
        if (!w.isDestroyed()) saveWindowState(w);
      });
    }, 30000);
  } catch (error) {
    console.error('Error al iniciar la aplicación:', error);
    app.quit();
  }
});

// Al intentar abrir una segunda instancia, enfocar la ventana existente
app.on('second-instance', (event, commandLine, workingDirectory) => {
  console.log('[ZEUS] Segunda instancia detectada. Enfocando ventana existente...');
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
    win.show();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

function killProcess(child, name) {
  if (child && child.pid) {
    console.log(`Terminando proceso: ${name} (PID: ${child.pid})`);
    try {
      if (process.platform === 'win32') {
        // Usar execSync para asegurar que el proceso muera ANTES de que Electron continúe el cierre
        // /F fuerza el cierre, /T cierra todo el árbol de procesos, /PID especifica el ID
        execSync(`taskkill /pid ${child.pid} /f /t`);
        console.log(`Proceso ${name} terminado exitosamente.`);
      } else {
        child.kill('SIGTERM');
      }
    } catch (e) {
      console.error(`Error al intentar matar ${name}: ${e.message}`);
    }
  }
}

function killProcessByPort(port) {
  if (process.platform === 'win32') {
    try {
      console.log(`Buscando proceso en puerto ${port}...`);
      const stdout = execSync(`netstat -ano | findstr :${port}`).toString();
      const lines = stdout.split('\n');
      const pids = new Set();
      
      lines.forEach(line => {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5) {
          const pid = parts[parts.length - 1];
          if (parseInt(pid) > 0) pids.add(pid);
        }
      });

      pids.forEach(pid => {
        try {
          console.log(`Liberando puerto ${port} (PID: ${pid})...`);
          // Quitamos /t para no matar todo el árbol (la interfaz), solo el proceso del puerto
          execSync(`taskkill /pid ${pid} /f`);
        } catch (e) {
          // Ignorar errores si el proceso ya no existe
        }
      });
    } catch (e) {
      // Ignorar si no hay procesos en ese puerto
    }
  }
}

app.on('before-quit', () => {
  console.log('Aplicación cerrándose, limpiando procesos hijos y liberando puertos...');

  // Limpiar procesos por referencia
  killProcess(nextProcess, 'Next.js');
  killProcess(apiProcess, 'API');
  killProcess(terminalProcess, 'Terminal');
  killProcess(formatterProcess, 'Formatter');
  killProcess(pocketbaseProcess, 'PocketBase');
  killProcess(previewServerProcess, 'PreviewServer');
  killProcess(raeApiProcess, 'RAE-API');

  // Matar previews activos registrados por el backend
  try {
    const activePreviewsPath = path.join(path.dirname(getApiEnvPath()), 'active-previews.json');
    if (fs.existsSync(activePreviewsPath)) {
      const activePreviews = JSON.parse(fs.readFileSync(activePreviewsPath, 'utf8'));
      for (const preview of activePreviews) {
        if (preview.pid) {
          try {
            execSync(`taskkill /pid ${preview.pid} /f /t`);
            console.log(`[ZEUS] Preview detenido (PID: ${preview.pid}, puerto: ${preview.port})`);
          } catch (e) {
            // Ya podría estar muerto
          }
        }
        if (preview.port) {
          killProcessByPort(preview.port);
        }
      }
      try { fs.unlinkSync(activePreviewsPath); } catch {}
    }
  } catch (e) {
    console.error('Error limpiando previews activos:', e.message);
  }

  // Liberar puertos específicos de Zeus y Ollama + puertos comunes de dev
  const portsToFree = [8741, 8742, 8745, 11434, 3010, 8091, 8744, 3000, 3001, 5173, 5174, 8080, 3011];
  portsToFree.forEach(port => killProcessByPort(port));
});