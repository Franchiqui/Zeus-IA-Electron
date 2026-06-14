const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  versions: process.versions,
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowMaximize: () => ipcRenderer.send('window:maximize'),
  windowClose: () => ipcRenderer.send('window:close'),
  setTitleBarOverlay: (color, symbolColor) => ipcRenderer.send('window:set-titlebar-overlay', { color, symbolColor }),
  /** Navegar a una URL en la misma ventana (evita destello de la página anterior) */
  navigateTo: (url) => ipcRenderer.send('navigate-to', url),
  /** Operaciones del explorador de archivos */
  fileExplorer: {
    copyFile: (filePath) => ipcRenderer.invoke('file-explorer:copy', filePath),
    cutFile: (filePath) => ipcRenderer.invoke('file-explorer:cut', filePath),
    pasteFile: (targetPath) => ipcRenderer.invoke('file-explorer:paste', targetPath),
    hasClipboardContent: () => ipcRenderer.invoke('file-explorer:has-clipboard-content'),
    deleteFile: (filePath) => ipcRenderer.invoke('file-explorer:delete', filePath),
  },
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  /** Zoom nativo de Chromium (persistente en la sesión) */
  zoom: {
    get: () => webFrame.getZoomFactor(),
    set: (factor) => webFrame.setZoomFactor(factor),
  },
  /** Recarga de página */
  page: {
    reload: () => ipcRenderer.send('reload'),
    forceReload: () => ipcRenderer.send('force-reload'),
  },
  /** Abrir / alternar las DevTools de la ventana */
  devTools: {
    open: () => ipcRenderer.send('devtools:open'),
    toggle: () => ipcRenderer.send('devtools:toggle'),
  },
  clipboard: {
    writeText: (text) => ipcRenderer.invoke('clipboard:writeText', text),
  },
  /** Instalador de extensiones VS Code del sistema (legacy — invoca `code` CLI) */
  vscodeExtensions: {
    check: () => ipcRenderer.invoke('vscode-extensions:check'),
    list: () => ipcRenderer.invoke('vscode-extensions:list'),
    install: (payload) => ipcRenderer.invoke('vscode-extensions:install', payload),
    uninstall: (payload) => ipcRenderer.invoke('vscode-extensions:uninstall', payload),
    toggle: (payload) => ipcRenderer.invoke('vscode-extensions:toggle', payload),
    pickVsix: () => ipcRenderer.invoke('vscode-extensions:pick-vsix'),
  },
  /** Marketplace de extensiones de ZEUS (cargadas dentro del editor, no en VS Code del sistema) */
  zeusExtensions: {
    list: () => ipcRenderer.invoke('extensions:list'),
    install: (payload) => ipcRenderer.invoke('extensions:install', payload),
    uninstall: (payload) => ipcRenderer.invoke('extensions:uninstall', payload),
    readBuffer: (payload) => ipcRenderer.invoke('extensions:readBuffer', payload),
  },
  /** Control dinámico de PocketBase (App Library) */
  pocketbase: {
    stop: () => ipcRenderer.invoke('pocketbase:stop'),
    start: () => ipcRenderer.invoke('pocketbase:start'),
  },
  /** Operaciones sobre la carpeta de preview de la App Library */
  library: {
    resetCurrentProject: () => ipcRenderer.invoke('library:reset-current-project'),
    fullReset: () => ipcRenderer.invoke('library:full-reset'),
  },
});
