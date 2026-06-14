const express = require('express');
const multer = require('multer');
const yauzl = require('yauzl');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const { spawn, exec } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const os = require('os');
const WebSocket = require('ws');
const net = require('net'); // Added for port checking
let PocketBase; // Will be loaded dynamically if available

// Load environment variables from .env file if it exists
// Try multiple locations: serve/.env, ../.env.local, ../.env
try {
  const dotenv = require('dotenv');
  const serveEnvPath = path.join(__dirname, '.env');
  const parentEnvLocalPath = path.join(__dirname, '..', '.env.local');
  const parentEnvPath = path.join(__dirname, '..', '.env');
  
  // Try to load .env files in order of priority
  if (fs.existsSync(serveEnvPath)) {
    dotenv.config({ path: serveEnvPath });
    console.log('[PreviewServer] Loaded environment variables from serve/.env');
  } else if (fs.existsSync(parentEnvLocalPath)) {
    dotenv.config({ path: parentEnvLocalPath });
    console.log('[PreviewServer] Loaded environment variables from .env.local');
  } else if (fs.existsSync(parentEnvPath)) {
    dotenv.config({ path: parentEnvPath });
    console.log('[PreviewServer] Loaded environment variables from .env');
  } else {
    console.log('[PreviewServer] No .env file found. Using system environment variables.');
  }
} catch (e) {
  // dotenv not available or error loading - use system environment variables
  console.log('[PreviewServer] dotenv not available. Using system environment variables only.');
}

async function callCompleteSyncWithFallback(options) {
  const {
    nextJsUrl,
    userToken,
    projectId,
    updatedFiles
  } = options || {};

  const candidates = [];
  if (nextJsUrl && typeof nextJsUrl === 'string') candidates.push(nextJsUrl);
  candidates.push('http://localhost:8741');
  candidates.push('http://127.0.0.1:8741');
  candidates.push('http://localhost:8741');
  candidates.push('http://127.0.0.1:8741');

  for (const base of candidates) {
    const isValidUrl = base &&
      !String(base).includes('tu-tunnel-url') &&
      !String(base).includes('example.com') &&
      !String(base).includes('placeholder') &&
      String(base).startsWith('http');

    if (!isValidUrl) continue;

    const syncUrl = `${String(base).replace(/\/$/, '')}/api/project/complete-sync`;
    console.log('[PreviewServer][Sync] Calling complete-sync endpoint:', syncUrl);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const syncResponse = await fetch(syncUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(userToken ? { 'Authorization': `Bearer ${userToken}` } : {})
        },
        body: JSON.stringify({
          projectId,
          updatedFiles: Array.isArray(updatedFiles) ? updatedFiles : []
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (syncResponse.ok) {
        const syncResult = await syncResponse.json().catch(() => ({}));
        console.log('[PreviewServer][Sync] ✅ Cache invalidated and project synced');
        console.log('[PreviewServer][Sync] Base URL used:', base);
        console.log('[PreviewServer][Sync] Result:', JSON.stringify(syncResult).substring(0, 300));
        return true;
      }

      const errorText = await syncResponse.text().catch(() => '');
      console.warn('[PreviewServer][Sync] ⚠️ Sync endpoint returned error (non-critical):', syncResponse.status, syncResponse.statusText);
      if (errorText) console.warn('[PreviewServer][Sync] ⚠️ Details:', errorText.substring(0, 300));
    } catch (err) {
      clearTimeout(timeoutId);
      if (err && err.name === 'AbortError') {
        console.warn('[PreviewServer][Sync] ⚠️ Sync request timed out after 8 seconds (non-critical)');
      } else {
        console.warn('[PreviewServer][Sync] ⚠️ Sync request failed (non-critical):', err?.message || err);
        if (err?.cause) console.warn('[PreviewServer][Sync] ⚠️ Cause:', err.cause?.message || String(err.cause));
        if (err?.stack) console.warn('[PreviewServer][Sync] ⚠️ Stack:', String(err.stack).substring(0, 300));
      }
    }
  }

  return false;
}

// ✅ Resolve PocketBase 'projects' record id from an input id/path.
// Prefer direct PB record ID; fallback to path lookup.
async function resolvePocketBaseProjectRecordId(baseUrl, token, projectId, projectPath) {
  console.log('[RESOLVE-PB-ID] Iniciando resolución de ID de PocketBase...');
  console.log(`[RESOLVE-PB-ID] Base URL: ${baseUrl}, Project ID (inicial): ${projectId}, Project Path: ${projectPath}`);

  const safeBaseUrl = (baseUrl || '').replace(/\/$/, '');
  if (!safeBaseUrl) {
    console.log('[RESOLVE-PB-ID] ❌ safeBaseUrl es null/vacío.');
    return null;
  }
  if (!token) {
    console.log('[RESOLVE-PB-ID] ❌ Token de autenticación es null/vacío.');
    return null;
  }

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  // 1) Intentar obtener directamente por ID (PATCH/GET de registro)
  if (projectId) {
    const recordUrl = `${safeBaseUrl}/api/collections/projects/records/${projectId}`;
    try {
      console.log(`[RESOLVE-PB-ID] Intento 1: Buscar por record ID directo: ${recordUrl}`);
      const resp = await fetch(recordUrl, { method: 'GET', headers });
      if (resp.ok) {
        console.log(`[RESOLVE-PB-ID] ✅ Encontrado registro directo con ID ${projectId}`);
        return projectId;
      }
      const errorText = await resp.text().catch(() => '');
      console.log(`[RESOLVE-PB-ID] Intento 1 falló (GET ${recordUrl}). Status: ${resp.status}, Error: ${errorText.substring(0,100)}`);
    } catch (e) {
      console.log(`[RESOLVE-PB-ID] Excepción en Intento 1: ${e.message}`);
    }
  }

  // 2) Fallback: search by path/path_local
  if (!projectPath) {
    console.log('[RESOLVE-PB-ID] ❌ projectPath es null/vacío, no se puede buscar por ruta.');
    return null;
  }

  console.log(`[RESOLVE-PB-ID] Intento 2: Buscar por projectPath '${projectPath}'.`);
  const escapedPath = String(projectPath).replace(/'/g, "\\'");
  const filterByPath = `(path = '${escapedPath}' || path_local = '${escapedPath}')`;
  const listUrlByPath = `${safeBaseUrl}/api/collections/projects/records?perPage=1&page=1&filter=${encodeURIComponent(filterByPath)}`;

  try {
    console.log(`[RESOLVE-PB-ID] Fetching list URL (by path): ${listUrlByPath}`);
    const resp = await fetch(listUrlByPath, { method: 'GET', headers });
    if (!resp.ok) {
      const errorText = await resp.text().catch(() => 'Error desconocido.');
      console.log(`[RESOLVE-PB-ID] Falló el Intento 2 (GET ${listUrlByPath}). Status: ${resp.status}, Error: ${errorText.substring(0, 100)}`);
      return null;
    }
    const data = await resp.json().catch(() => null);
    const item = data?.items?.[0];
    if (item?.id) {
      console.log(`[RESOLVE-PB-ID] ✅ Encontrado con Project Path. ID de registro de PocketBase: ${item.id}`);
      return item.id; // Return the actual PocketBase record ID
    } else {
      console.log('[RESOLVE-PB-ID] No se encontraron elementos con Project Path.');
      return null;
    }
  } catch (e) {
    console.log(`[RESOLVE-PB-ID] Excepción en Intento 2: ${e.message}`);
    return null;
  }
}

// Use global fetch if available (Node 18+), otherwise use node-fetch
let fetch;
if (typeof globalThis.fetch !== 'undefined') {
  fetch = globalThis.fetch;
} else {
  try {
    fetch = require('node-fetch');
  } catch (e) {
    console.warn('[PreviewServer] fetch not available. AI features may not work. Install node-fetch or use Node 18+');
  }
}

const app = express();
// Base directory: when packaged with pkg or running inside Electron, use the folder of the executable; otherwise use the source directory
const isPackaged = typeof process.pkg !== 'undefined' || !!process.versions.electron || process.env.ELECTRON_RUN_AS_NODE === '1' || process.env.ZEUS_PACKAGED === '1';
const baseDir = isPackaged ? path.dirname(process.execPath) : __dirname;

// Asegurar que exista la carpeta de uploads (use writable user dir when packaged)
const userWritableUploadsDir = path.join(process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir(), 'ZeusIA', 'uploads');
const uploadsBaseDir = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : (isPackaged ? userWritableUploadsDir : path.join(baseDir, 'uploads'));
fs.ensureDirSync(uploadsBaseDir);

// Asegurar que exista la carpeta de logs (use writable user dir when packaged)
const userWritableLogsDir = path.join(process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir(), 'ZeusIA', 'logs');
const logsBaseDir = isPackaged ? userWritableLogsDir : path.join(baseDir, 'logs');
fs.ensureDirSync(logsBaseDir);

let previewPort;
let wss = null; // WebSocket Server instance
let uploadInProgress = false; // Mutex para serializar renders
let cleanupInProgress = false; // Mutex para serializar limpieza
let autoBuildFixInProgress = false; // Mutex para prevenir ejecuciones concurrentes de Auto Build Fix

// ✅ PocketBase save scheduler con debounce de 3 segundos
let pocketBaseSaveTimeout = null;
let pendingSaveData = null;

function schedulePocketBaseSave(projectId, projectPath, userToken = null) {
  // Cancelar el timeout anterior si existe
  if (pocketBaseSaveTimeout) {
    clearTimeout(pocketBaseSaveTimeout);
    pocketBaseSaveTimeout = null;
  }
  
  // Guardar los datos pendientes
  pendingSaveData = { projectId, projectPath, userToken };
  
  // Programar el guardado con debounce de 3 segundos
  pocketBaseSaveTimeout = setTimeout(async () => {
    if (!pendingSaveData) {
      console.log('[schedulePocketBaseSave] ⚠️ No hay datos pendientes para guardar');
      return;
    }
    
    const { projectId: pid, projectPath: ppath, userToken: utoken } = pendingSaveData;
    pendingSaveData = null;
    pocketBaseSaveTimeout = null;
    
    console.log('[schedulePocketBaseSave] 💾 Ejecutando guardado en PocketBase (debounce completado)...');
    console.log('[schedulePocketBaseSave] Project ID:', pid);
    console.log('[schedulePocketBaseSave] Project Path:', ppath);
    
    try {
      // Determinar URL de Next.js
      const isProduction = process.env.NODE_ENV === 'production' || 
                           process.env.PRODUCTION === 'true' ||
                           (process.env.NEXT_PUBLIC_API_URL && process.env.NEXT_PUBLIC_API_URL.includes('zeus-ia.com'));
      const tunnelUrl = process.env.NEXT_PUBLIC_PREVIEW_SERVER_URL || process.env.PREVIEW_SERVER_TUNNEL_URL;
      const explicitNextJsUrl = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_JS_URL;
      const defaultNextJsUrl = isProduction ? 'https://zeus-ia.com' : 'http://localhost:8741';
      
      let nextJsUrl;
      if (tunnelUrl && !tunnelUrl.includes('localhost') && !tunnelUrl.includes('127.0.0.1')) {
        nextJsUrl = tunnelUrl;
      } else if (explicitNextJsUrl) {
        nextJsUrl = explicitNextJsUrl;
      } else {
        nextJsUrl = defaultNextJsUrl;
      }
      
      const isLocalNextJsEndpoint = nextJsUrl.includes('localhost') || nextJsUrl.includes('127.0.0.1') || nextJsUrl.includes('::1');
      
      if (isLocalNextJsEndpoint) {
        // Usar endpoint de Next.js
        const saveArchiveResponse = await fetch(`${nextJsUrl}/api/project/save-archive`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'User-Agent': 'ZEUS-Preview-Server/1.0'
          },
          body: JSON.stringify({
            projectRoot: ppath,
            projectId: pid,
            userToken: utoken,
            isInitialSave: false
          })
        });
        
        if (saveArchiveResponse.ok) {
          console.log('[schedulePocketBaseSave] ✅ ZIP actualizado exitosamente en PocketBase');
        } else {
          console.warn('[schedulePocketBaseSave] ⚠️ Error al actualizar ZIP:', saveArchiveResponse.status);
        }
      } else {
        console.warn('[schedulePocketBaseSave] ⚠️ Endpoint de Next.js es remoto, no se puede guardar desde servidor de vista previa');
      }
    } catch (error) {
      console.error('[schedulePocketBaseSave] ❌ Error al guardar en PocketBase:', error?.message || error);
    }
  }, 3000); // Debounce de 3 segundos
}

// Ensure npm has writable HOME and cache directories (especially in serverless environments)
const fallbackHomeDir = path.join(os.tmpdir(), 'preview-home');
const fallbackNpmCacheDir = path.join(os.tmpdir(), 'preview-npm-cache');
try {
  if (!process.env.HOME || process.env.HOME.trim() === '') {
    process.env.HOME = fallbackHomeDir;
  }
  if (!process.env.USERPROFILE || process.env.USERPROFILE.trim() === '') {
    process.env.USERPROFILE = process.env.HOME;
  }
  if (!process.env.NPM_CONFIG_CACHE || process.env.NPM_CONFIG_CACHE.trim() === '') {
    process.env.NPM_CONFIG_CACHE = fallbackNpmCacheDir;
  }
  fs.ensureDirSync(process.env.HOME);
  fs.ensureDirSync(process.env.NPM_CONFIG_CACHE);
} catch (envPrepError) {
  console.warn('[PreviewServer] Failed to prepare fallback HOME/NPM directories:', envPrepError?.message || envPrepError);
}

// Set console encoding to UTF-8 on Windows to properly display emojis and special characters
if (process.platform === 'win32') {
  // Try to set the console code page to UTF-8
  exec('chcp 65001', (error) => {
    if (error) {
      console.log('Warning: Could not set console to UTF-8 mode');
    }
  });
}

// Function to run npm command and stream output
function runNpmCommandStreaming(projectPath, command, onStdout, onStderr) {
  return new Promise((resolve, reject) => {
    const npmProcess = spawn('npm', command.split(' '), {
      cwd: projectPath,
      stdio: 'pipe',
      shell: true
    });

    let output = '';
    let errorOutput = '';

    npmProcess.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      if (onStdout) onStdout(text);
    });

    npmProcess.stderr.on('data', (data) => {
      const text = data.toString();
      errorOutput += text;
      if (onStderr) onStderr(text);
    });

    npmProcess.on('close', (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        const fullOutput = `${output}\n${errorOutput}`.trim();
        const error = new Error(`Command failed with code ${code}: ${fullOutput}`);
        error.stdout = output;
        error.stderr = errorOutput;
        error.fullOutput = fullOutput;
        reject(error);
      }
    });
  });
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '200mb' }));

// Middleware para deshabilitar caché en archivos estáticos durante desarrollo
// Esto asegura que los cambios se vean en tiempo real
app.use((req, res, next) => {
  // Log todas las peticiones para debugging (especialmente /proxy/3000)
  if (req.path.includes('/proxy/')) {
    console.log(`[Middleware] 📥 Petición recibida: ${req.method} ${req.path}`);
    console.log(`[Middleware] 📥 URL completa: ${req.url}`);
    console.log(`[Middleware] 📥 Host: ${req.get('host')}`);
  }
  
  // Deshabilitar caché para todos los archivos estáticos
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Permitir que el contenido se muestre en iframes desde cualquier origen
  res.removeHeader('X-Frame-Options'); // Eliminar si está configurado
  next();
});

// Proxy endpoint para acceder al servidor Next.js en el puerto 3000 a través del túnel
// IMPORTANTE: Debe estar ANTES de express.static para que no sea interceptado
console.log('[Proxy] ✅ Endpoint /proxy/3000 registrado en el servidor');
app.use('/proxy/3000', async (req, res) => {
  console.log(`[Proxy] ⚡ Endpoint /proxy/3000 alcanzado!`);
  console.log(`[Proxy] 📥 Método: ${req.method}`);
  console.log(`[Proxy] 📥 URL: ${req.url}`);
  console.log(`[Proxy] 📥 Path: ${req.path}`);
  console.log(`[Proxy] 📥 Original URL: ${req.originalUrl}`);
  
  // Detectar si es una petición de imagen
  const isImageRequest = /\.(jpg|jpeg|png|gif|webp|svg|ico|bmp)(\?.*)?$/i.test(req.url);
  if (isImageRequest) {
    console.log(`[Proxy] 🖼️ Petición de imagen detectada: ${req.url}`);
  }
  
  try {
    const http = require('http');
    const url = require('url');
    
    // Extraer la ruta después de /proxy/3000
    // req.url puede ser "/proxy/3000" o "/proxy/3000/_next/static/..." o "/proxy/3000/_next/image?url=..."
    let targetPath = req.url;
    
    // Si la URL empieza con /proxy/3000, removerlo
    if (targetPath.startsWith('/proxy/3000')) {
      targetPath = targetPath.replace('/proxy/3000', '') || '/';
    }
    
    // Decodificar la URL si está codificada (para debugging y para asegurar que se procesa correctamente)
    let decodedPath = targetPath;
    try {
      decodedPath = decodeURIComponent(targetPath);
      if (decodedPath !== targetPath) {
        console.log(`[Proxy] 🔍 URL codificada detectada:`);
        console.log(`[Proxy] 🔍 Original: ${targetPath}`);
        console.log(`[Proxy] 🔍 Decodificada: ${decodedPath}`);
        // Usar la versión decodificada para la petición
        targetPath = decodedPath;
      }
    } catch (e) {
      // Si no se puede decodificar, usar la original
      console.log(`[Proxy] ⚠️ No se pudo decodificar la URL: ${targetPath}`);
    }
    
    // Construir la URL completa para el servidor Next.js
    // targetPath ya incluye el query string si existe
    const targetUrl = `http://localhost:3000${targetPath}`;
    const parsedUrl = url.parse(targetUrl, true); // true para parsear query string
    
    console.log(`[Proxy] 🔄 Proxying request to Next.js server: ${targetUrl}`);
    console.log(`[Proxy] 🔍 Target path: ${targetPath}`);
    if (parsedUrl.query && Object.keys(parsedUrl.query).length > 0) {
      console.log(`[Proxy] 🔍 Query params:`, parsedUrl.query);
    }
    
    // Opciones para la petición HTTP
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 3000,
      path: parsedUrl.path,
      method: req.method,
      headers: {
        ...req.headers,
        host: `${parsedUrl.hostname}:${parsedUrl.port || 3000}`,
        'x-forwarded-for': req.ip || req.connection.remoteAddress,
        'x-forwarded-proto': req.protocol,
        'x-forwarded-host': req.get('host')
      }
    };
    
    // Hacer la petición al servidor Next.js
    const proxyReq = http.request(options, (proxyRes) => {
      const zlib = require('zlib');
      const contentEncoding = proxyRes.headers['content-encoding'];
      const contentType = proxyRes.headers['content-type'] || '';
      const isHTML = contentType.includes('text/html');
      
      // Detectar si es un archivo estático (CSS, JS, etc.) que NO debe ser reescrito
      // Verificar tanto por extensión en la URL como por Content-Type
      const isStaticFileByExtension = /\.(css|js|json|woff|woff2|ttf|eot|otf|svg|png|jpg|jpeg|gif|webp|ico|map)(\?.*)?$/i.test(targetPath);
      const isStaticFileByContentType = contentType.includes('text/css') || 
                                        contentType.includes('application/javascript') ||
                                        contentType.includes('application/json') ||
                                        contentType.includes('font/') ||
                                        contentType.includes('image/');
      const isStaticFile = isStaticFileByExtension || isStaticFileByContentType;
      
      if (isStaticFile) {
        console.log(`[Proxy] 📄 Archivo estático detectado: ${targetPath}, Content-Type: ${contentType}`);
      }
      
      // Primero, eliminar explícitamente X-Frame-Options de la respuesta antes de copiar headers
      res.removeHeader('X-Frame-Options');
      
      // Copiar headers de respuesta (excepto content-encoding si vamos a descomprimir)
      res.statusCode = proxyRes.statusCode;
      Object.keys(proxyRes.headers).forEach(key => {
        const lowerKey = key.toLowerCase();
        
        // Eliminar X-Frame-Options para permitir que el contenido se muestre en iframes
        if (lowerKey === 'x-frame-options') {
          console.log(`[Proxy] Eliminando header X-Frame-Options: ${proxyRes.headers[key]}`);
          return; // No copiar este header
        }
        
        // Si el contenido está comprimido, lo descomprimiremos, así que eliminamos content-encoding
        if (lowerKey === 'content-encoding' && contentEncoding) {
          // No copiar content-encoding, descomprimiremos el contenido
          return;
        }
        
        // No copiar content-length si vamos a descomprimir o reescribir HTML (el tamaño cambiará)
        // PERO mantenerlo para archivos estáticos que no se reescriben
        if (lowerKey === 'content-length' && (contentEncoding || (isHTML && !isStaticFile))) {
          return;
        }
        
        res.setHeader(key, proxyRes.headers[key]);
      });

      // Agregar headers CORS si es necesario
      if (!res.getHeader('Access-Control-Allow-Origin')) {
        res.setHeader('Access-Control-Allow-Origin', '*');
      }

      // Permitir que el contenido se muestre en iframes desde cualquier origen
      res.removeHeader('X-Frame-Options'); // Asegurarse de que no esté configurado
      console.log('[Proxy] Asegurando que X-Frame-Options esté eliminado de la respuesta final.');

      // Obtener la URL base del túnel para reescribir URLs en HTML
      const tunnelBaseUrl = req.get('host') ? `${req.protocol}://${req.get('host')}` : '';
      const proxyBasePath = '/proxy/3000';

      // Si es un archivo estático (CSS, JS, etc.), NO reescribir, solo enviar directamente
      if (isStaticFile) {
        console.log(`[Proxy] 📄 Enviando archivo estático directamente sin reescribir: ${targetPath}`);
        
        // Si está comprimido, descomprimirlo antes de enviarlo
        if (contentEncoding === 'gzip') {
          proxyRes.pipe(zlib.createGunzip()).pipe(res);
        } else if (contentEncoding === 'deflate') {
          proxyRes.pipe(zlib.createInflate()).pipe(res);
        } else if (contentEncoding === 'br') {
          proxyRes.pipe(zlib.createBrotliDecompress()).pipe(res);
        } else {
          // No está comprimido, enviar directamente
          proxyRes.pipe(res);
        }
        return; // Salir temprano, no procesar como HTML
      }

      // Si es HTML, necesitamos reescribir las URLs relativas para que apunten al proxy
      if (isHTML) {
        console.log('[Proxy] 📝 Reescribiendo URLs en HTML para que apunten al proxy');
        
        let chunks = [];
        
        // Si está comprimido, descomprimir primero
        let stream = proxyRes;
        if (contentEncoding === 'gzip') {
          stream = proxyRes.pipe(zlib.createGunzip());
        } else if (contentEncoding === 'deflate') {
          stream = proxyRes.pipe(zlib.createInflate());
        } else if (contentEncoding === 'br') {
          stream = proxyRes.pipe(zlib.createBrotliDecompress());
        }
        
        // Acumular el contenido HTML
        stream.on('data', (chunk) => {
          chunks.push(chunk);
        });
        
        stream.on('end', () => {
          try {
            const html = Buffer.concat(chunks).toString('utf8');
            
            // Reescribir URLs relativas en el HTML para que apunten al proxy
            // Patrones comunes en Next.js:
            // - /_next/static/... -> /proxy/3000/_next/static/...
            // - /_next/image?url=... -> /proxy/3000/_next/image?url=...
            // - /static/... -> /proxy/3000/static/...
            // - href="/..." -> href="/proxy/3000/..."
            // - src="/..." -> src="/proxy/3000/..."
            // - url("/...") -> url("/proxy/3000/...")
            
            let rewrittenHtml = html;
            
            // Log para debugging: buscar imágenes en el HTML
            const imageMatches = html.match(/<img[^>]+src\s*=\s*["']([^"']+)["'][^>]*>/gi);
            if (imageMatches) {
              console.log('[Proxy] 🖼️ Imágenes encontradas en HTML:', imageMatches.length);
              imageMatches.forEach((match, index) => {
                const srcMatch = match.match(/src\s*=\s*["']([^"']+)["']/i);
                if (srcMatch) {
                  console.log(`[Proxy] 🖼️ Imagen ${index + 1}: ${srcMatch[1]}`);
                }
              });
            }
            
            // PRIMERO: Reescribir URLs de Next.js Image (_next/image?url=...)
            // Estas URLs pueden tener parámetros de consulta, así que necesitamos manejarlas antes
            rewrittenHtml = rewrittenHtml.replace(
              /(href|src|action|data-src|data-href)\s*=\s*["'](\/_next\/image\?[^"']+)["']/gi,
              (match, attr, path) => {
                if (path.startsWith('/proxy/3000')) {
                  return match;
                }
                // Decodificar la URL para ver la URL real
                try {
                  const decodedPath = decodeURIComponent(path);
                  console.log(`[Proxy] 🖼️ Reescribiendo URL de Next.js Image (original): ${path}`);
                  console.log(`[Proxy] 🖼️ Reescribiendo URL de Next.js Image (decodificada): ${decodedPath}`);
                } catch (e) {
                  console.log(`[Proxy] 🖼️ Reescribiendo URL de Next.js Image: ${path}`);
                }
                return `${attr}="${proxyBasePath}${path}"`;
              }
            );
            
            // SEGUNDO: Reescribir rutas que empiezan con /_next/ o /static/ o cualquier ruta absoluta
            // pero NO reescribir si ya incluye /proxy/3000
            rewrittenHtml = rewrittenHtml.replace(
              /(href|src|action|data-src|data-href|url)\s*=\s*["'](\/(?!proxy\/3000)[^"']+)["']/gi,
              (match, attr, path) => {
                // Si la ruta ya es relativa al proxy, no hacer nada
                if (path.startsWith('/proxy/3000')) {
                  return match;
                }
                // Si la ruta es absoluta (empieza con /), agregar /proxy/3000
                if (path.startsWith('/')) {
                  return `${attr}="${proxyBasePath}${path}"`;
                }
                return match;
              }
            );
            
            // Reescribir URLs en CSS (url(...))
            rewrittenHtml = rewrittenHtml.replace(
              /url\s*\(\s*["']?(\/(?!proxy\/3000)[^"')]+)["']?\s*\)/gi,
              (match, path) => {
                if (path.startsWith('/proxy/3000')) {
                  return match;
                }
                if (path.startsWith('/')) {
                  return `url("${proxyBasePath}${path}")`;
                }
                return match;
              }
            );
            
            // Reescribir rutas en <link>, <script>, <img>, <source>, <video>, <audio> tags
            // Manejar casos donde el atributo puede estar antes o después de otros atributos
            rewrittenHtml = rewrittenHtml.replace(
              /<(link|script|img|source|video|audio|picture)\s+([^>]*?)(href|src|srcset|data-src|data-srcset)\s*=\s*["'](\/(?!proxy\/3000)[^"']+)["']([^>]*)>/gi,
              (match, tag, before, attr, path, after) => {
                if (path.startsWith('/proxy/3000')) {
                  return match;
                }
                if (path.startsWith('/')) {
                  return `<${tag} ${before}${attr}="${proxyBasePath}${path}"${after}>`;
                }
                return match;
              }
            );
            
            // Reescribir srcset con múltiples URLs (para imágenes responsivas)
            rewrittenHtml = rewrittenHtml.replace(
              /srcset\s*=\s*["']([^"']+)["']/gi,
              (match, srcset) => {
                // srcset puede contener múltiples URLs separadas por comas
                const rewrittenSrcset = srcset.split(',').map(item => {
                  const trimmed = item.trim();
                  // Cada item puede ser "url width" o "url"
                  const parts = trimmed.split(/\s+/);
                  const url = parts[0];
                  const rest = parts.slice(1).join(' ');
                  
                  if (url.startsWith('/proxy/3000')) {
                    return trimmed;
                  }
                  if (url.startsWith('/')) {
                    return `${proxyBasePath}${url}${rest ? ' ' + rest : ''}`;
                  }
                  return trimmed;
                }).join(', ');
                
                return `srcset="${rewrittenSrcset}"`;
              }
            );
            
            // Reescribir URLs en atributos style con background-image
            rewrittenHtml = rewrittenHtml.replace(
              /style\s*=\s*["']([^"']*background[^"']*url\s*\(\s*["']?(\/(?!proxy\/3000)[^"')]+)["']?\s*\)[^"']*)["']/gi,
              (match, styleContent, url) => {
                if (url.startsWith('/proxy/3000')) {
                  return match;
                }
                if (url.startsWith('/')) {
                  const newStyle = styleContent.replace(url, `${proxyBasePath}${url}`);
                  return `style="${newStyle}"`;
                }
                return match;
              }
            );
            
            console.log('[Proxy] ✅ HTML reescrito, enviando respuesta');
            
            // Enviar el HTML reescrito
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Content-Length', Buffer.byteLength(rewrittenHtml, 'utf8'));
            res.end(rewrittenHtml);
          } catch (error) {
            console.error('[Proxy] ❌ Error reescribiendo HTML:', error);
            // Si hay error, enviar el contenido original
            res.end(Buffer.concat(chunks));
          }
        });
        
        stream.on('error', (error) => {
          console.error('[Proxy] ❌ Error en stream:', error);
          if (!res.headersSent) {
            res.status(500).end('Error procesando respuesta');
          }
        });
      } else {
        // Para contenido no HTML, enviar directamente (puede estar comprimido)
        if (contentEncoding === 'gzip') {
          proxyRes.pipe(zlib.createGunzip()).pipe(res);
        } else if (contentEncoding === 'deflate') {
          proxyRes.pipe(zlib.createInflate()).pipe(res);
        } else if (contentEncoding === 'br') {
          proxyRes.pipe(zlib.createBrotliDecompress()).pipe(res);
        } else {
          // No está comprimido, enviar directamente
          proxyRes.pipe(res);
        }
      }
    });
    
    proxyReq.on('error', (error) => {
      console.error(`[Proxy] Error proxying to Next.js server:`, error);
      console.error(`[Proxy] Error code:`, error.code);
      console.error(`[Proxy] Error message:`, error.message);
      console.error(`[Proxy] Target URL:`, targetUrl);
      if (!res.headersSent) {
        // Agregar headers CORS para que el error se pueda ver en el iframe
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.status(502).json({ 
          error: 'Error conectando al servidor Next.js',
          message: error.message,
          code: error.code,
          targetUrl: targetUrl,
          hint: 'Asegúrate de que el servidor Next.js esté corriendo en el puerto 3000'
        });
      }
    });
    
    // Agregar timeout para evitar que la petición se quede colgada
    proxyReq.setTimeout(10000, () => {
      console.error(`[Proxy] Timeout al conectar al servidor Next.js en ${targetUrl}`);
      if (!res.headersSent) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.status(504).json({ 
          error: 'Timeout conectando al servidor Next.js',
          message: 'El servidor no respondió en 10 segundos',
          targetUrl: targetUrl,
          hint: 'Verifica que el servidor Next.js esté corriendo en el puerto 3000'
        });
      }
      proxyReq.destroy();
    });
    
    // Enviar el body de la petición si existe
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      req.pipe(proxyReq);
    } else {
      proxyReq.end();
    }
  } catch (error) {
    console.error('[Proxy] Error en proxy endpoint:', error);
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Error interno del proxy',
        message: error.message 
      });
    }
  }
});

// ✅ NUEVO: Proxy endpoint para la API de Python en el puerto 8000
console.log('[Proxy] ✅ Endpoint /proxy/8000 registrado para Backup API');
app.use('/proxy/8000', async (req, res) => {
  try {
    const http = require('http');
    const url = require('url');
    let targetPath = req.url;
    if (targetPath.startsWith('/proxy/8000')) {
      targetPath = targetPath.replace('/proxy/8000', '') || '/';
    }
    const targetUrl = `http://localhost:8000${targetPath}`;
    const parsedUrl = url.parse(targetUrl);
    
    const options = {
      hostname: 'localhost',
      port: 8000,
      path: parsedUrl.path,
      method: req.method,
      headers: { ...req.headers, host: 'localhost:8000' }
    };
    
    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    
    proxyReq.on('error', (err) => {
      res.status(502).json({ error: 'Python API offline', details: err.message });
    });
    
    if (req.method !== 'GET') req.pipe(proxyReq);
    else proxyReq.end();
  } catch (e) {
    res.status(500).json({ error: 'Proxy error', details: e.message });
  }
});

app.post('/api/save-local-file', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const body = req.body || {};
    const { filePath, content, projectRoot } = body;
    if (!filePath || content === undefined) {
      return res.status(400).json({ success: false, error: 'filePath and content are required' });
    }

    const normalizedFilePath = String(filePath).replace(/\\/g, '/').replace(/^\/+/, '');
    // Si no se pasa projectRoot, usar el proyecto actual del preview server
    const normalizedRoot = projectRoot
      ? String(projectRoot).replace(/\\/g, '/')
      : detectProjectRoot(currentProjectBasePath);
    const absoluteTarget = path.join(normalizedRoot, normalizedFilePath);

    await fs.ensureDir(path.dirname(absoluteTarget));
    await fs.writeFile(absoluteTarget, typeof content === 'string' ? content : '', 'utf8');

    return res.json({ success: true, savedPath: absoluteTarget });
  } catch (error) {
    console.error('[PreviewServer][SaveLocalFile] Error:', error?.message || error);
    return res.status(500).json({ success: false, error: error?.message || 'save failed' });
  }
});

app.use((req, res, next) => {
  const currentProjectPath = currentProjectBasePath;
  
  // No log every request to avoid spam, but keep the logic
  // console.log(`[Static Middleware] Request for: ${req.path}`);

  if (!fs.existsSync(currentProjectPath)) {
    return next();
  }

  // Case 1: Check for public folder directly in current-project
  const directPublicPath = path.join(currentProjectPath, 'public');
  if (fs.existsSync(directPublicPath)) {
    // console.log(`[Static Middleware] Found public dir directly at: ${directPublicPath}. Serving...`);
    return express.static(directPublicPath)(req, res, next);
  }

  // Case 2: Check for a subdirectory containing the project
  try {
    const projectDirs = fs.readdirSync(currentProjectPath).filter(file => {
      const filePath = path.join(currentProjectPath, file);
      try {
        return fs.statSync(filePath).isDirectory() && !file.startsWith('__');
      } catch (statError) {
        return false;
      }
    });

    if (projectDirs.length > 0) {
      const projectName = projectDirs[0]; // Assume the first directory is the project root
      const nestedPublicPath = path.join(currentProjectPath, projectName, 'public');
      
      if (fs.existsSync(nestedPublicPath)) {
        // console.log(`[Static Middleware] Found nested public dir at: ${nestedPublicPath}. Serving...`);
        return express.static(nestedPublicPath)(req, res, next);
      }
    }
  } catch (readError) {
    // If we can't read the directory, just continue
    return next();
  }

  // If neither case matched, just continue
  next();
});

app.use(express.static(path.join(baseDir, 'public'), {
  // Deshabilitar ETags para evitar problemas de caché
  etag: false,
  // Forzar que siempre se sirvan archivos frescos
  lastModified: false
}));

// Servir imágenes subidas desde /uploads
app.use('/uploads', express.static(uploadsBaseDir, {
  etag: false,
  lastModified: false
}));

// Health endpoint for external detection
app.get('/api/health', (req, res) => {
  try {
    return res.json({ ok: true, port: previewPort || null, uptime: process.uptime() });
  } catch (e) {
    return res.status(500).json({ ok: false });
  }
});

// ✅ Endpoint /api/save-now para forzar guardado inmediato en PocketBase
app.post('/api/save-now', async (req, res) => {
  try {
    const { projectId, projectPath, userToken } = req.body || {};
    
    if (!projectId || !projectPath) {
      return res.status(400).json({ 
        ok: false, 
        error: 'projectId y projectPath son requeridos' 
      });
    }
    
    console.log('[save-now] 💾 Forzando guardado inmediato en PocketBase...');
    console.log('[save-now] Project ID:', projectId);
    console.log('[save-now] Project Path:', projectPath);
    
    // Cancelar cualquier guardado pendiente programado
    if (pocketBaseSaveTimeout) {
      clearTimeout(pocketBaseSaveTimeout);
      pocketBaseSaveTimeout = null;
      console.log('[save-now] ⏹️ Guardado programado cancelado');
    }
    
    // Ejecutar guardado inmediato
    try {
      const isProduction = process.env.NODE_ENV === 'production' || 
                           process.env.PRODUCTION === 'true' ||
                           (process.env.NEXT_PUBLIC_API_URL && process.env.NEXT_PUBLIC_API_URL.includes('zeus-ia.com'));
      const tunnelUrl = process.env.NEXT_PUBLIC_PREVIEW_SERVER_URL || process.env.PREVIEW_SERVER_TUNNEL_URL;
      const explicitNextJsUrl = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_JS_URL;
      const defaultNextJsUrl = isProduction ? 'https://zeus-ia.com' : 'http://localhost:8741';
      
      let nextJsUrl;
      if (tunnelUrl && !tunnelUrl.includes('localhost') && !tunnelUrl.includes('127.0.0.1')) {
        nextJsUrl = tunnelUrl;
      } else if (explicitNextJsUrl) {
        nextJsUrl = explicitNextJsUrl;
      } else {
        nextJsUrl = defaultNextJsUrl;
      }
      
      const isLocalNextJsEndpoint = nextJsUrl.includes('localhost') || nextJsUrl.includes('127.0.0.1') || nextJsUrl.includes('::1');
      
      if (isLocalNextJsEndpoint) {
        const saveArchiveResponse = await fetch(`${nextJsUrl}/api/project/save-archive`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'User-Agent': 'ZEUS-Preview-Server/1.0'
          },
          body: JSON.stringify({
            projectRoot: projectPath,
            projectId: projectId,
            userToken: userToken || null,
            isInitialSave: false
          })
        });
        
        if (saveArchiveResponse.ok) {
          const result = await saveArchiveResponse.json().catch(() => ({}));
          console.log('[save-now] ✅ ZIP guardado exitosamente en PocketBase');
          return res.json({ 
            ok: true, 
            message: 'ZIP guardado exitosamente en PocketBase',
            result 
          });
        } else {
          const errorText = await saveArchiveResponse.text().catch(() => '');
          console.warn('[save-now] ⚠️ Error al guardar ZIP:', saveArchiveResponse.status, errorText);
          return res.status(saveArchiveResponse.status).json({ 
            ok: false, 
            error: `Error al guardar ZIP: ${saveArchiveResponse.status}`,
            details: errorText 
          });
        }
      } else {
        console.warn('[save-now] ⚠️ Endpoint de Next.js es remoto, no se puede guardar desde servidor de vista previa');
        return res.status(400).json({ 
          ok: false, 
          error: 'Endpoint de Next.js es remoto, no se puede guardar desde servidor de vista previa' 
        });
      }
    } catch (saveError) {
      console.error('[save-now] ❌ Error al guardar en PocketBase:', saveError?.message || saveError);
      return res.status(500).json({ 
        ok: false, 
        error: 'Error al guardar en PocketBase',
        details: saveError?.message || String(saveError) 
      });
    }
  } catch (error) {
    console.error('[save-now] ❌ Error en endpoint:', error?.message || error);
    return res.status(500).json({ 
      ok: false, 
      error: 'Error interno del servidor',
      details: error?.message || String(error) 
    });
  }
});

// Compat: servir un stub para component-selector.js si algún proyecto aún lo solicita
app.get('/component-selector.js', (req, res) => {
  res.type('application/javascript').send(`// Deprecated: component-selector.js\n` +
    `// Este stub evita errores 404. El nuevo cliente es /inspector-client.js`);
});

// Guardar snapshot HTML del iframe para persistencia/manual diff
app.post('/api/save-snapshot', async (req, res) => {
  try {
    const { html, name } = req.body || {};
    if (!html || typeof html !== 'string') {
      return res.status(400).json({ ok: false, error: 'html requerido' });
    }
    const projectRoot = currentProjectBasePath;
    const snapshotsDir = path.join(projectRoot, 'inspector-snapshots');
    fs.ensureDirSync(snapshotsDir);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const base = name && typeof name === 'string' ? name.replace(/[^a-z0-9-_]/gi, '_') : 'snapshot';
    const filePath = path.join(snapshotsDir, `${base}-${ts}.html`);
    fs.writeFileSync(filePath, html, 'utf8');
    return res.json({ ok: true, filePath });
  } catch (e) {
    console.error('[SaveSnapshot] Error:', e?.message || e);
    return res.status(500).json({ ok: false, error: e?.message || 'unknown error' });
  }
});

// Proxy endpoint to reuse Next.js Auto Build Fix API when running in preview server
const isProductionEnv = process.env.NODE_ENV === 'production' ||
  process.env.VERCEL_ENV === 'production' ||
  process.env.PRODUCTION === 'true';
function resolveAutoBuildFixTarget(req, override) {
  if (override === 'production') {
    return 'https://zeus-ia.com';
  }
  if (override === 'local') {
    return 'http://localhost:8741';
  }

  const explicitTarget = process.env.AUTO_BUILD_FIX_TARGET;
  if (explicitTarget && explicitTarget.trim() !== '') {
    return explicitTarget.trim();
  }

  const hostHeader = req?.headers?.host || '';
  const originHeader = req?.headers?.origin || req?.headers?.referer || '';
  const combined = `${hostHeader} ${originHeader}`.toLowerCase();
  const isLocalHost =
    (hostHeader && (hostHeader.includes('localhost') || hostHeader.includes('127.0.0.1') || hostHeader.includes('::1'))) ||
    combined.includes('localhost') ||
    combined.includes('127.0.0.1') ||
    combined.includes('::1') ||
    combined.includes('.local') ||
    combined.includes('192.168.') ||
    combined.includes('10.') ||
    combined.includes('172.') ||
    hostHeader.trim() === '';
  if (!isLocalHost) {
    return 'https://zeus-ia.com';
  }

  return isProductionEnv ? 'https://zeus-ia.com' : 'http://localhost:8741';
}

// Function to parse build errors from build output
// Next.js/ESLint errors come in multiline format:
// ./app/page.tsx
// 372:66  Error: `"` can be escaped...
function parseBuildErrors(errorOutput) {
  // Remove ANSI escape codes from the entire output first
  // ANSI codes: ESC[ followed by numbers and letters (for colors, formatting, etc.)
  // Use a more conservative approach to avoid removing important information
  const cleanOutput = errorOutput
    .replace(/\x1b\[[0-9;]*m/g, '')  // Remove color codes (ESC[number;number;...m)
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')  // Remove other ANSI codes (ESC[number;number;...letter)
    .replace(/\x1b\[K/g, '')  // Remove clear line codes
    .replace(/\x1b\[[0-9]*[A-Z]/g, '')  // Remove cursor movement codes
    .replace(/\x1b\[[0-9;]*H/g, '')  // Remove cursor positioning
    .replace(/\x1b\[[0-9;]*J/g, '')  // Remove screen clearing
    .replace(/\x1b\[[0-9;]*[fG]/g, '');  // Remove more cursor codes
  
  const lines = cleanOutput.split('\n');
  
  // Debug: Log first few lines to verify cleaning didn't remove important info
  if (lines.length > 0 && (lines[0].includes('Error') || lines[0].includes('Failed'))) {
    console.log('[parseBuildErrors] First line after cleaning:', lines[0].substring(0, 100));
  }
  
  // Debug: Log output length to verify we're processing the full output
  console.log(`[parseBuildErrors] Processing ${lines.length} lines from ${errorOutput.length} character output`);
  const errors = [];
  let currentFile = null;
  let i = 0;
  let webpackErrorMode = false; // Track if we're in webpack error format

  // Process lines to handle multiline error format
  // Next.js/ESLint format:
  // ./app/page.tsx
  // 372:66  Error: message
  // Webpack format:
  // Build failed because of webpack errors
  // [file:line:col]
  //   code context
  //   ^^^^
  // Caused by: Syntax Error
  while (i < lines.length) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    
    // Skip empty lines - but don't reset currentFile
    // Empty lines can appear between file path and errors
    if (!line) {
      i++;
      continue;
    }
    
    // Check for webpack error format
    // Format: Build failed because of webpack errors
    if (line.includes('Build failed because of webpack errors') || 
        line.includes('build failed because of webpack errors')) {
      webpackErrorMode = true;
      console.log('[parseBuildErrors] Webpack error format detected');
      i++;
      continue;
    }
    
    // PRIORITY: Check for webpack error file location format FIRST (before standard file format)
    // Format: [C:\path\to\file.tsx:33:1] or [./file.tsx:33:1]
    // Also handles: ,-[C:\path\to\file.tsx:33:1] (with leading comma and dash, possibly with spaces)
    // Also handles: file.tsx:33:1] at the end of a line
    let webpackFileMatch = null;
    // Try format with leading ,-[ first (most specific webpack format)
    // Note: The format is "    ,-[file:line:col]" with spaces before
    webpackFileMatch = line.match(/\s*,-\[(.+?\.(tsx?|jsx?|ts|js)):(\d+):(\d+)\]$/);
    if (!webpackFileMatch) {
      // Try standard bracket format
      webpackFileMatch = line.match(/\[(.+?\.(tsx?|jsx?|ts|js)):(\d+):(\d+)\]$/);
    }
    if (!webpackFileMatch) {
      // Try format without brackets at end (but with closing bracket)
      webpackFileMatch = line.match(/(.+?\.(tsx?|jsx?|ts|js)):(\d+):(\d+)\]$/);
    }
    
    // Debug: log if we found a webpack file match
    if (webpackFileMatch) {
      console.log(`[parseBuildErrors] Found webpack file match: ${webpackFileMatch[1]}:${webpackFileMatch[3]}:${webpackFileMatch[4]}`);
    }
    
    // Check for webpack error message format
    // Format 1: "Error:" on its own line, then "  x Unexpected token..." on next line
    // Format 2: "Error: x Unexpected token..." on same line
    // Note: In webpack format, the error message comes BEFORE the file location
    let errorMsgMatch = null;
    let errorMessage = null;
    
    // Format 1: "Error:" on its own line
    // This format appears in webpack errors: "Error:" -> (empty) -> "  x Unexpected token..."
    if (line.trim() === 'Error:' || line.match(/^\s*Error:\s*$/)) {
      console.log(`[parseBuildErrors] Found "Error:" line at ${i}, searching for error message in next 15 lines...`);
      // Look ahead for the actual error message (next non-empty line, usually 1-2 lines after)
      for (let k = i + 1; k < Math.min(i + 15, lines.length); k++) {
        const nextLine = lines[k];
        if (!nextLine) {
          console.log(`[parseBuildErrors] Line ${k} is null/undefined, continuing...`);
          continue;
        }
        if (!nextLine.trim()) {
          console.log(`[parseBuildErrors] Line ${k} is empty, continuing...`);
          continue; // Skip empty lines
        }
        console.log(`[parseBuildErrors] Checking line ${k} for error message: "${nextLine.substring(0, 80)}"`);
        
        // Note: ANSI codes are already cleaned at the start of parseBuildErrors
        // No need to clean again here - use nextLine directly
        const cleanLine = nextLine;
        
        // Check for "x Unexpected token..." format
        // The format is "  x Unexpected token..." or "x Unexpected token..."
        // Use trim() and check if it starts with "x " for more reliable matching
        const trimmed = cleanLine.trim();
        console.log(`[parseBuildErrors] Line ${k} cleaned and trimmed: "${trimmed.substring(0, 80)}" (length: ${trimmed.length})`);
        
        // Try multiple approaches to match "x Unexpected..."
        let matched = false;
        
        // Approach 1: Direct string check (most reliable)
        if (trimmed && trimmed.length > 2 && trimmed[0] === 'x' && trimmed[1] === ' ') {
          errorMessage = trimmed.substring(2).trim(); // Get everything after "x "
          errorMsgMatch = { message: errorMessage, lineIndex: i };
          console.log(`[parseBuildErrors] ✓ Found error message (approach 1, char-by-char) at line ${k}: ${errorMessage.substring(0, 80)}...`);
          matched = true;
        } else if (trimmed && trimmed.startsWith('x ')) {
          errorMessage = trimmed.substring(2).trim(); // Get everything after "x "
          errorMsgMatch = { message: errorMessage, lineIndex: i };
          console.log(`[parseBuildErrors] ✓ Found error message (approach 1, startsWith) at line ${k}: ${errorMessage.substring(0, 80)}...`);
          matched = true;
        } else {
          // Approach 2: Regex patterns as fallback (on cleaned line)
          const msgMatch = cleanLine.match(/^\s*x\s+(.+)$/);
          if (msgMatch) {
            errorMessage = msgMatch[1].trim();
            errorMsgMatch = { message: errorMessage, lineIndex: i };
            console.log(`[parseBuildErrors] ✓ Found error message (approach 2, regex) at line ${k}: ${errorMessage.substring(0, 80)}...`);
            matched = true;
          } else {
            // Approach 3: More flexible regex (match "x " anywhere in line)
            const msgMatch2 = cleanLine.match(/x\s+(.+)/);
            if (msgMatch2) {
              errorMessage = msgMatch2[1].trim();
              errorMsgMatch = { message: errorMessage, lineIndex: i };
              console.log(`[parseBuildErrors] ✓ Found error message (approach 3, flexible regex) at line ${k}: ${errorMessage.substring(0, 80)}...`);
              matched = true;
            }
          }
        }
        
        if (!matched) {
          console.log(`[parseBuildErrors] Line ${k} does not match "x ..." pattern. Trimmed: "${trimmed.substring(0, 50)}"`);
        }
        
        // If we found the error message, we can break and continue to find file location
        if (errorMsgMatch) {
          break;
        }
      }
      if (!errorMsgMatch) {
        console.log(`[parseBuildErrors] ⚠️ Could not find error message after "Error:" at line ${i}`);
      }
    }
    
    // Format 2: "Error: x Unexpected token..." on same line
    if (!errorMsgMatch) {
      const sameLineMatch = line.match(/^\s*Error:\s+x\s+(.+)$/);
      if (sameLineMatch) {
        errorMessage = sameLineMatch[1].trim();
        errorMsgMatch = { message: errorMessage, lineIndex: i };
        console.log(`[parseBuildErrors] Found error message (format 2): ${errorMessage.substring(0, 50)}...`);
      }
    }
    
    if (errorMsgMatch) {
      // Check if we're in webpack mode or if we have webpack file match, or check if next lines suggest webpack format
      let hasWebpackFormat = webpackErrorMode || webpackFileMatch;
      if (!hasWebpackFormat) {
        // Look ahead for webpack format file location (it comes AFTER the error message)
        for (let k = i + 1; k < Math.min(i + 20, lines.length); k++) {
          const nextLine = lines[k];
          if (nextLine && (nextLine.includes(',-[') || nextLine.match(/\s*,-\[.+?:\d+:\d+\]$/))) {
            hasWebpackFormat = true;
            console.log(`[parseBuildErrors] Found webpack format ahead at line ${k}`);
            break;
          }
        }
        // Also check backwards
        if (!hasWebpackFormat) {
          for (let k = Math.max(0, i - 5); k < i; k++) {
            const prevLine = lines[k];
            if (prevLine && (prevLine.includes(',-[') || prevLine.match(/\s*,-\[.+?:\d+:\d+\]$/))) {
              hasWebpackFormat = true;
              console.log(`[parseBuildErrors] Found webpack format behind at line ${k}`);
              break;
            }
          }
        }
      }
      
      if (hasWebpackFormat) {
        let lineNum = 0;
        let colNum = 0;
        let filePath = null;
        
        // Look backwards AND forwards for file:line:col pattern
        // In webpack format, the file location can come BEFORE or AFTER the error message
        let foundFileLocation = false;
        
        // First, look ahead (most common in webpack format - file location comes AFTER error message)
        // Search from errorMsgMatch.lineIndex (where we found "Error:") instead of current line i
        // The format is: Error: -> (empty line) -> x Unexpected token... -> (code lines) -> ,-[file:line:col]
        const searchStart = errorMsgMatch.lineIndex !== undefined ? errorMsgMatch.lineIndex : i;
        // Search up to 30 lines ahead to find the file location (it can be after several code lines)
        for (let k = searchStart + 1; k < Math.min(searchStart + 30, lines.length); k++) {
          const nextLine = lines[k];
          if (!nextLine) continue;
          // Check for webpack format: ,-[file:line:col]
          const fileLocMatch = nextLine.match(/\s*,-\[(.+?\.(tsx?|jsx?|ts|js)):(\d+):(\d+)\]$/) ||
                              nextLine.match(/\[(.+?\.(tsx?|jsx?|ts|js)):(\d+):(\d+)\]$/);
          if (fileLocMatch) {
            filePath = fileLocMatch[1].trim();
            lineNum = parseInt(fileLocMatch[3]);
            colNum = parseInt(fileLocMatch[4]);
            foundFileLocation = true;
            console.log(`[parseBuildErrors] Found file location ahead at line ${k}: ${filePath}:${lineNum}:${colNum}`);
            break;
          }
        }
        
        // If not found ahead, look backwards
        if (!foundFileLocation) {
          for (let k = Math.max(0, i - 10); k < i; k++) {
            const prevLine = lines[k];
            if (!prevLine) continue;
            const fileLocMatch = prevLine.match(/\s*,-\[(.+?\.(tsx?|jsx?|ts|js)):(\d+):(\d+)\]$/) ||
                                prevLine.match(/\[(.+?\.(tsx?|jsx?|ts|js)):(\d+):(\d+)\]$/);
            if (fileLocMatch) {
              filePath = fileLocMatch[1].trim();
              lineNum = parseInt(fileLocMatch[3]);
              colNum = parseInt(fileLocMatch[4]);
              foundFileLocation = true;
              console.log(`[parseBuildErrors] Found file location behind: ${filePath}:${lineNum}:${colNum}`);
              break;
            }
          }
        }
        
        if (foundFileLocation) {
          // Normalize path
          let normalizedPath = filePath;
          const pathMatch = filePath.match(/[\\/](?:app|components|lib|hooks|context|src|pages)[\\/](.+)$/);
          if (pathMatch) {
            const fullMatch = filePath.match(/([\\/])(?:app|components|lib|hooks|context|src|pages)([\\/].+)$/);
            if (fullMatch) {
              normalizedPath = fullMatch[0].substring(1).replace(/\\/g, '/');
            } else {
              normalizedPath = pathMatch[0].replace(/\\/g, '/').replace(/^\//, '');
            }
          } else {
            const simpleMatch = filePath.match(/(app|components|lib|hooks|context|src|pages)[\\/](.+)$/);
            if (simpleMatch) {
              normalizedPath = simpleMatch[0].replace(/\\/g, '/');
            } else {
              const filenameMatch = filePath.match(/([^\\/]+\.(tsx?|jsx?|ts|js))$/);
              if (filenameMatch) {
                normalizedPath = filenameMatch[1];
              }
            }
          }
          
          currentFile = normalizedPath;
          webpackErrorMode = true;
        }
        
        if (currentFile) {
          const existingError = errors.find(e => 
            e.file === currentFile && 
            e.line === lineNum &&
            e.message === errorMessage
          );
          
          if (!existingError) {
            errors.push({
              file: currentFile,
              line: lineNum || 0,
              column: colNum || 0,
              message: errorMessage,
              context: [rawLine],
              type: 'error',
              errorType: 'webpack_syntax'
            });
            console.log(`[parseBuildErrors] ✓ Added ERROR (Webpack error message): ${currentFile}:${lineNum}:${colNum} - ${errorMessage.substring(0, 70)}...`);
          }
          i++;
          continue;
        }
      }
    }
    
    if (webpackErrorMode || webpackFileMatch) {
      if (webpackFileMatch) {
        const filePath = webpackFileMatch[1].trim();
        const lineNum = parseInt(webpackFileMatch[3]);
        const colNum = parseInt(webpackFileMatch[4]);
        // Normalize path: remove drive letter and convert to relative path if needed
        let normalizedPath = filePath;
        
        // Extract relative path from absolute path
        // E.g., C:\Users\...\projects\current-project\app\layout.tsx -> app/layout.tsx
        // Try to find app, components, lib, hooks, context, src, or pages in the path
        const pathMatch = filePath.match(/[\\/](?:app|components|lib|hooks|context|src|pages)[\\/](.+)$/);
        if (pathMatch) {
          // Extract from the matched directory onwards
          const fullMatch = filePath.match(/([\\/])(?:app|components|lib|hooks|context|src|pages)([\\/].+)$/);
          if (fullMatch) {
            normalizedPath = fullMatch[0].substring(1).replace(/\\/g, '/'); // Remove leading / or \
          } else {
            normalizedPath = pathMatch[0].replace(/\\/g, '/').replace(/^\//, '');
          }
        } else {
          // Try to match patterns like app/layout.tsx or components/...
          const simpleMatch = filePath.match(/(app|components|lib|hooks|context|src|pages)[\\/](.+)$/);
          if (simpleMatch) {
            normalizedPath = simpleMatch[0].replace(/\\/g, '/');
          } else {
            // If no match, try to extract just the filename if path is very long
            const filenameMatch = filePath.match(/([^\\/]+\.(tsx?|jsx?|ts|js))$/);
            if (filenameMatch) {
              normalizedPath = filenameMatch[1];
            }
          }
        }
        
        // If still couldn't normalize, use the original path but clean it up
        if (normalizedPath === filePath && filePath.includes('\\')) {
          const parts = filePath.split(/[\\/]/);
          const fileName = parts[parts.length - 1];
          normalizedPath = fileName;
        }
        
        currentFile = normalizedPath;
        webpackErrorMode = true;
        
        // Look backwards for error message (Error: x Unexpected token...)
        let errorMessage = 'Syntax Error'; // Default message for webpack errors
        let foundErrorMarker = false; // Track if we found ^^^^ marker
        
        // Look backwards first (error message might be before file location in webpack format)
        for (let k = Math.max(0, i - 10); k < i; k++) {
          const prevLine = lines[k].trim();
          const errorMsgMatch = prevLine.match(/^\s*Error:\s+x\s+(.+)$/);
          if (errorMsgMatch) {
            errorMessage = errorMsgMatch[1].trim();
            break;
          }
        }
        
        // Look ahead for "Caused by:" message and error marker (^^^^)
        let j = i + 1;
        while (j < lines.length && j < i + 20) {
          const nextLine = lines[j].trim();
          
          // Check for error position marker (^^^^)
          if (nextLine.match(/^\^+$/)) {
            foundErrorMarker = true;
            // Try to get context from the line above the marker
            if (j > i + 1) {
              const contextLine = lines[j - 1].trim();
              // Extract the problematic code (if it's a code line, not a line number)
              if (contextLine.length > 0 && !contextLine.match(/^\d+\s*\|/)) {
                errorMessage = `Syntax Error near: ${contextLine.substring(0, 80)}`;
              }
            }
          }
          
          // Check for "Caused by:" message
          if (nextLine.match(/^Caused by:\s*(.+)$/i)) {
            const causeMatch = nextLine.match(/^Caused by:\s*(.+)$/i);
            if (causeMatch) {
              errorMessage = causeMatch[1].trim() || errorMessage;
            }
            j++;
            break;
          }
          
          // Check for error message format (Error: x ...)
          const errorMsgMatch = nextLine.match(/^\s*Error:\s+x\s+(.+)$/);
          if (errorMsgMatch && errorMessage === 'Syntax Error') {
            errorMessage = errorMsgMatch[1].trim();
          }
          
          // Stop if we hit another file path or error format
          if (nextLine.match(/\s*,-\[.+?\.(tsx?|jsx?|ts|js):\d+:\d+\]$/) ||
              nextLine.match(/^\[.+?\.(tsx?|jsx?|ts|js):\d+:\d+\]$/) ||
              nextLine.match(/^\.\//) ||
              (nextLine.includes('Build failed') && j > i + 2) ||
              (nextLine.includes('Failed to compile') && j > i + 2)) {
            break;
          }
          
          j++;
        }
        
        // Add the error
        const existingError = errors.find(e => 
          e.file === currentFile && 
          e.line === lineNum && 
          e.column === colNum &&
          e.message === errorMessage
        );
        
        if (!existingError) {
          errors.push({
            file: currentFile,
            line: lineNum,
            column: colNum,
            message: errorMessage,
            context: [rawLine, ...lines.slice(Math.max(0, i - 3), Math.min(i + 10, j)).filter(l => l && l.trim())],
            type: 'error',
            errorType: 'webpack_syntax'
          });
          console.log(`[parseBuildErrors] ✓ Added ERROR (Webpack): ${currentFile}:${lineNum}:${colNum} - ${errorMessage.substring(0, 70)}...`);
        }
        
        i = j;
        continue;
      }
    }
    
    // Skip info messages and build progress
    // IMPORTANT: Don't skip "Failed to compile" as it's part of the error context
    // But skip "Import trace" lines as they're just context
    if (line.includes('Import trace for requested module') ||
        line.includes('info') || 
        line.includes('Need to disable') ||
        line.includes('Creating an optimized') ||
        line.includes('Compiled successfully') ||
        line.includes('Linting and checking') ||
        line.includes('packages are looking') ||
        line.includes('run `npm fund`') ||
        line.includes('found 0 vulnerabilities') ||
        line.includes('▲ Next.js') ||
        (line.startsWith('>') && !webpackErrorMode) ||
        (line.startsWith('npm') && !line.includes('Error') && !line.includes('Warning')) ||
        line.includes('Command failed with code')) {
      i++;
      continue;
    }
    
    // Skip "Failed to compile." message but continue processing errors
    if (line === 'Failed to compile.' || line.trim() === 'Failed to compile') {
      i++;
      continue;
    }

    // Check if this line is a file path with line:column (TypeScript error format)
    // Format: ./components/ui/input.tsx:277:36
    const fileWithLocationMatch = line.match(/^\.\/(.+?\.(tsx?|jsx?|ts|js)):(\d+):(\d+)$/);
    if (fileWithLocationMatch) {
      currentFile = fileWithLocationMatch[1].trim();
      const lineNum = parseInt(fileWithLocationMatch[3]);
      const colNum = parseInt(fileWithLocationMatch[4]);
      
      // Look ahead for the error message (next non-empty line)
      // TypeScript errors format:
      // ./file.tsx:line:col
      // Type error: message
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) {
        j++;
      }
      
      if (j < lines.length) {
        const errorLine = lines[j].trim();
        // Check for Type error, Parse error, etc.
        // Match pattern: "Type error: message" or "Parse error: message"
        const typeErrorMatch = errorLine.match(/^(Type error|Parse error|Error):\s*(.+)$/i);
        if (typeErrorMatch) {
          const errorType = typeErrorMatch[1];
          let message = typeErrorMatch[2].trim();
          
          // Check if message continues on next lines (until we hit code context like "> 277 |")
          // Or until we hit another file path or error
          let messageLines = [message];
          let k = j + 1;
          while (k < lines.length && k < j + 5) { // Limit to 5 lines of message
            const nextLine = lines[k].trim();
            // Stop if we hit code context (line numbers), file paths, or empty lines followed by code
            if (nextLine.match(/^>\s*\d+\s*\|/) || 
                nextLine.match(/^\.\//) ||
                (nextLine === '' && k + 1 < lines.length && lines[k + 1].trim().match(/^>\s*\d+\s*\|/))) {
              break;
            }
            if (nextLine && !nextLine.match(/^(Type error|Parse error|Error):/i)) {
              messageLines.push(nextLine);
            } else {
              break;
            }
            k++;
          }
          
          message = messageLines.join(' ').trim();
          
          const existingError = errors.find(e => 
            e.file === currentFile && 
            e.line === lineNum && 
            e.column === colNum &&
            e.message === message
          );
          
          if (!existingError) {
            errors.push({
              file: currentFile,
              line: lineNum,
              column: colNum,
              message: message,
              context: [rawLine, lines[j], ...messageLines.slice(1).map((_, idx) => lines[j + idx + 1]).filter(l => l && l.trim())],
              type: 'error'
            });
            console.log(`[parseBuildErrors] ✓ Added ERROR (TypeScript): ${currentFile}:${lineNum}:${colNum} - ${message.substring(0, 70)}...`);
          }
          i = k; // Skip all message lines
          continue;
        }
      }
      
      // If no error message found, set the file context and continue
      // The error message might appear later or in a different format
      console.log(`[parseBuildErrors] Found file path with location: ${currentFile}:${lineNum}:${colNum} (no error message found yet)`);
      i++;
      continue;
    }

    // Check if this line is a file path (starts with ./)
    // Format: ./app/page.tsx
    // IMPORTANT: Only process if NOT in webpack mode, as webpack format has priority
    const fileMatch = line.match(/^\.\/(.+?\.(tsx?|jsx?|ts|js|css|scss))$/);
    if (fileMatch && !webpackErrorMode) {
      currentFile = fileMatch[1].trim();
      console.log(`[parseBuildErrors] Found file path: ${currentFile}`);
      i++;
      continue;
    }

    // Check if this line contains an error/warning with line:column format
    // Format: 372:66  Error: message
    // Or: 372:66  Warning: message
    // This appears on its own line after a file path
    // IMPORTANT: Must have currentFile set, otherwise skip
    if (!currentFile) {
      // No file context yet, skip this line
      i++;
      continue;
    }
    
    const errorMatch = line.match(/^(\d+):(\d+)\s+(Error|Warning):\s*(.+)$/i);
    if (errorMatch) {
      const lineNum = parseInt(errorMatch[1]);
      const colNum = parseInt(errorMatch[2]);
      const errorType = errorMatch[3]; // Keep original case
      const message = errorMatch[4].trim();
      const isError = errorType.toLowerCase() === 'error';
      
      // CRITICAL: Only process actual ERRORS, not warnings
      // Warnings don't cause build failures in Next.js/ESLint by default
      // But if ESLint is configured to treat warnings as errors, we need to fix them too
      // For now, only process errors to avoid false positives
      if (isError) {
        // Check if we already have this exact error
        const existingError = errors.find(e => 
          e.file === currentFile && 
          e.line === lineNum && 
          e.column === colNum &&
          e.message === message
        );
        
        if (!existingError) {
          errors.push({
            file: currentFile,
            line: lineNum,
            column: colNum,
            message: message,
            context: [rawLine],
            type: 'error'
          });
          console.log(`[parseBuildErrors] ✓ Added ERROR: ${currentFile}:${lineNum}:${colNum} - ${message.substring(0, 70)}...`);
        }
      } else {
        // Log warnings for debugging but DO NOT process them
        // Warnings don't block the build
        console.log(`[parseBuildErrors] ⊗ Skipping WARNING: ${currentFile}:${lineNum}:${colNum} - ${message.substring(0, 70)}...`);
      }
      // Keep currentFile - same file can have multiple errors/warnings
      i++;
      continue;
    }

    // Check for single-line error format: ./app/page.tsx 372:66 Error: ...
    // This format is less common but can appear in some build outputs
    const singleLineErrorMatch = line.match(/^\.\/(.+?\.(tsx?|jsx?|ts|js))\s+(\d+):(\d+)\s+(Error|Warning):\s*(.+)$/i);
    if (singleLineErrorMatch) {
      const file = singleLineErrorMatch[1].trim();
      const lineNum = parseInt(singleLineErrorMatch[3]);
      const colNum = parseInt(singleLineErrorMatch[4]);
      const errorType = singleLineErrorMatch[5];
      const message = singleLineErrorMatch[6].trim();
      const isError = errorType.toLowerCase() === 'error';
      
      // Only process actual ERRORS
      if (isError) {
        currentFile = file; // Update current file
        const existingError = errors.find(e => 
          e.file === file && 
          e.line === lineNum && 
          e.column === colNum &&
          e.message === message
        );
        
        if (!existingError) {
          errors.push({
            file: file,
            line: lineNum,
            column: colNum,
            message: message,
            context: [rawLine],
            type: 'error'
          });
          console.log(`[parseBuildErrors] ✓ Added ERROR (single-line): ${file}:${lineNum}:${colNum} - ${message.substring(0, 60)}...`);
        }
      }
      i++;
      continue;
    }

    // Check for TypeScript error format: ./app/page.tsx(182,6): error TS...
    // This format is less common in Next.js builds
    const tsErrorMatch = line.match(/^\.\/(.+?\.(tsx?|jsx?|ts|js))\((\d+),(\d+)\):\s*error\s*(.+)$/i);
    if (tsErrorMatch) {
      const file = tsErrorMatch[1].trim();
      const lineNum = parseInt(tsErrorMatch[3]);
      const colNum = parseInt(tsErrorMatch[4]);
      const message = tsErrorMatch[5].trim();
      
      currentFile = file; // Update current file
      const existingError = errors.find(e => 
        e.file === file && 
        e.line === lineNum && 
        e.column === colNum &&
        e.message === message
      );
      
      if (!existingError) {
        errors.push({
          file: file,
          line: lineNum,
          column: colNum,
          message: message,
          context: [rawLine],
          type: 'error'
        });
        console.log(`[parseBuildErrors] ✓ Added ERROR (TypeScript legacy): ${file}:${lineNum}:${colNum} - ${message.substring(0, 60)}...`);
      }
      i++;
      continue;
    }
    
    // Check for standalone Type error messages (when file:line:col was on previous line)
    // This handles cases where we already parsed the file location but need the error message
    // Format: Type error: Property 'audioRef' does not exist...
    // This should only trigger if we haven't already processed this error
    const typeErrorMatch = line.match(/^(Type error|Parse error):\s*(.+)$/i);
    if (typeErrorMatch && currentFile) {
      // Check if we already have an error for this file from the fileWithLocationMatch above
      // If not, try to find the line number from context
      const message = typeErrorMatch[2].trim();
      let lineNum = 0;
      let colNum = 0;
      
      // Look backwards for file:line:col pattern (should be very recent)
      for (let k = Math.max(0, i - 3); k < i; k++) {
        const prevLine = lines[k].trim();
        const fileLocMatch = prevLine.match(/^\.\/(.+?\.(tsx?|jsx?|ts|js)):(\d+):(\d+)$/);
        if (fileLocMatch) {
          lineNum = parseInt(fileLocMatch[3]);
          colNum = parseInt(fileLocMatch[4]);
          break;
        }
      }
      
      // Only add if we found a line number or if we have a currentFile set
      if (lineNum > 0 || currentFile) {
        const existingError = errors.find(e => 
          e.file === currentFile && 
          e.line === lineNum &&
          e.message === message
        );
        
        if (!existingError) {
          errors.push({
            file: currentFile,
            line: lineNum || 0,
            column: colNum || 0,
            message: message,
            context: [rawLine],
            type: 'error'
          });
          console.log(`[parseBuildErrors] ✓ Added ERROR (Type error standalone): ${currentFile}:${lineNum}:${colNum} - ${message.substring(0, 70)}...`);
        }
      }
      i++;
      continue;
    }

    // Skip lines that don't match any pattern
    // This prevents false positives from fallback matching

    i++;
  }

  // Debug: log parsed errors with more detail
  console.log(`[parseBuildErrors] === PARSING COMPLETE ===`);
  console.log(`[parseBuildErrors] Total lines processed: ${lines.length}`);
  console.log(`[parseBuildErrors] Errors found: ${errors.length}`);
  
  if (errors.length > 0) {
    console.log(`[parseBuildErrors] ERROR DETAILS:`);
    errors.forEach((err, idx) => {
      console.log(`  ${idx + 1}. File: ${err.file}`);
      console.log(`     Line: ${err.line}:${err.column}`);
      console.log(`     Type: ${err.type}`);
      console.log(`     Message: ${err.message.substring(0, 100)}...`);
      console.log(`     Context: ${err.context.join(' | ').substring(0, 100)}...`);
    });
  } else {
    console.log('[parseBuildErrors] ⚠️ No ERRORS found in output');
    console.log('[parseBuildErrors] This might indicate:');
    console.log('[parseBuildErrors] 1. All issues are warnings (not errors)');
    console.log('[parseBuildErrors] 2. Error format is not recognized');
    console.log('[parseBuildErrors] 3. Output was cleaned too aggressively');
    console.log('[parseBuildErrors] Full output (first 1500 chars):');
    console.log(errorOutput.substring(0, 1500));
    console.log('[parseBuildErrors] Full output (last 500 chars):');
    console.log(errorOutput.substring(Math.max(0, errorOutput.length - 500)));
    console.log('[parseBuildErrors] Cleaned output (first 1500 chars):');
    console.log(cleanOutput.substring(0, 1500));
    console.log('[parseBuildErrors] Cleaned output (last 500 chars):');
    console.log(cleanOutput.substring(Math.max(0, cleanOutput.length - 500)));
  }

  // Remove duplicates
  const uniqueErrors = [];
  const seen = new Set();
  for (const error of errors) {
    const key = `${error.file}:${error.line}:${error.column}:${error.message.substring(0, 100)}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueErrors.push(error);
    }
  }

  // Sort by file and line number
  uniqueErrors.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.line - b.line;
  });

  return uniqueErrors.slice(0, 20); // Limit to 20 errors
}

// Function to load project files for AI context
async function loadProjectFiles(projectPath) {
  const files = {};
  
  async function readProjectFiles(dirPath, basePath = dirPath) {
    try {
      const items = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const item of items) {
        const fullPath = path.join(dirPath, item.name);
        const relativePath = path.relative(basePath, fullPath);
        
        // Skip node_modules, .git, build outputs, etc.
        if (item.name.startsWith('.') ||
            item.name === 'node_modules' ||
            item.name === 'dist' ||
            item.name === 'build' ||
            item.name === '.next' ||
            item.name === 'coverage' ||
            relativePath.includes('node_modules')) {
          continue;
        }
        
        if (item.isDirectory()) {
          await readProjectFiles(fullPath, basePath);
        } else if (item.isFile()) {
          const ext = path.extname(item.name).toLowerCase();
          if (['.js', '.jsx', '.ts', '.tsx', '.json', '.css', '.scss', '.md'].includes(ext)) {
            try {
              const content = await fs.readFile(fullPath, 'utf-8');
              if (content.length < 50000) { // 50KB limit per file
                files[relativePath] = content;
              }
            } catch (err) {
              console.warn(`[PreviewServer][AutoBuildFix] Could not read file ${relativePath}:`, err.message);
            }
          }
        }
      }
    } catch (err) {
      console.warn(`[PreviewServer][AutoBuildFix] Error reading directory ${dirPath}:`, err.message);
    }
  }
  
  await readProjectFiles(projectPath);
  return files;
}

// Function to send errors to AI model for fixing
async function sendErrorsToAI(errors, attemptNumber, modelConfig, projectPath) {
  try {
    console.log(`[PreviewServer][AutoBuildFix] Sending ${errors.length} errors to AI model (attempt ${attemptNumber})`);

    // Filter to only include actual errors (type === 'error')
    // The parser should only add items with type 'error', but double-check
    const errorList = errors.filter(e => e.type === 'error');
    
    if (errorList.length === 0) {
      console.log('[PreviewServer][AutoBuildFix] No errors to fix. Parsed errors:', errors.map(e => `${e.file}:${e.line} (${e.type})`).join(', '));
      return { success: false, error: 'No errors to fix - only warnings or parsing issue' };
    }
    
    console.log(`[PreviewServer][AutoBuildFix] Filtered to ${errorList.length} actual errors (out of ${errors.length} parsed items)`);

    // Load project files for context first
    console.log('[PreviewServer][AutoBuildFix] Loading project files for context...');
    const projectFiles = await loadProjectFiles(projectPath);
    console.log(`[PreviewServer][AutoBuildFix] Loaded ${Object.keys(projectFiles).length} project files`);
    
    // Enhanced error context: Group errors by file and provide more context
    const errorsByFile = {};
    errorList.forEach(error => {
      if (!errorsByFile[error.file]) {
        errorsByFile[error.file] = [];
      }
      errorsByFile[error.file].push(error);
    });
    
    // Create enhanced error context with file-level grouping and cross-references
    // This helps the AI understand related errors in the same file
    const enhancedErrorContext = Object.entries(errorsByFile).map(([file, fileErrors]) => {
      const errorsText = fileErrors.map((err, idx) => `
Error ${idx + 1} in ${file}:
  Line: ${err.line}:${err.column}
  Message: ${err.message}
  Context: ${err.context && err.context.length > 0 ? err.context.join(' | ') : 'N/A'}`).join('\n');
      
      // Add hint about related issues
      const hasHookError = fileErrors.some(e => e.message.includes('Hook') || e.message.includes('hook'));
      const hasPropertyError = fileErrors.some(e => e.message.includes('Property') || e.message.includes('does not exist'));
      const hasNameError = fileErrors.some(e => e.message.includes('Cannot find name'));
      
      let relatedHints = '';
      if (hasHookError && hasNameError) {
        relatedHints = '\n  ⚠️ NOTA: Este archivo tiene errores relacionados. Si un hook se usa incorrectamente, asegúrate de desestructurar TODAS las propiedades necesarias del hook al inicio del componente.';
      }
      if (hasPropertyError && hasNameError) {
        relatedHints = '\n  ⚠️ NOTA: Este archivo tiene errores relacionados. Si falta una propiedad/variable, busca TODAS las referencias a esa propiedad/variable en TODO el archivo y corrígelas todas.';
      }
      
      return `=== ${file} ===
${errorsText}
TOTAL: ${fileErrors.length} error(s) in this file${relatedHints}`;
    }).join('\n\n');
    
    // Use enhanced error context
    const errorContext = enhancedErrorContext;
    
    // Log errors by file for debugging
    console.log('[PreviewServer][AutoBuildFix] Errors grouped by file:');
    Object.entries(errorsByFile).forEach(([file, fileErrors]) => {
      console.log(`  ${file}: ${fileErrors.length} error(s)`);
      fileErrors.forEach(err => {
        console.log(`    - Line ${err.line}:${err.column} - ${err.message.substring(0, 80)}...`);
      });
    });

    // Create system prompt with improved instructions
    const systemPrompt = `Eres un experto desarrollador de software especializado en React, TypeScript y Next.js. Tu tarea es analizar errores de compilación/build y proporcionar correcciones COMPLETAS y PRECISAS.

**ERRORES A CORREGIR:**
${errorContext}

**INSTRUCCIONES CRÍTICAS:**
1. **LEE COMPLETAMENTE LOS ARCHIVOS PROPORCIONADOS** para entender la estructura completa del código
2. Analiza CADA error individualmente y entiende su CONTEXTO COMPLETO
3. Proporciona correcciones COMPLETAS que resuelvan TODOS los aspectos del error
4. Si un error requiere cambios en múltiples lugares, proporciona TODAS las correcciones necesarias
5. Asegúrate de que las correcciones NO introduzcan nuevos errores
6. Usa el código EXACTO del archivo proporcionado
7. Incluye suficiente contexto (5-10 líneas antes y después) para matches exactos

**ERRORES COMUNES Y SOLUCIONES COMPLETAS:**

**React/no-unescaped-entities:**
- Busca comillas sin escapar en JSX: \`"\`
- Reemplaza con entidades HTML: \`&quot;\`, \`&ldquo;\`, \`&#34;\`, \`&rdquo;\`
- Ejemplo: \`<p>"texto"</p>\` → \`<p>&quot;texto&quot;</p>\`

**React-hooks/rules-of-hooks:**
- Hooks NO pueden usarse dentro de callbacks, condicionales, loops, o funciones anidadas
- Mueve el hook al nivel superior del componente/función
- Si el hook se usa en JSX (como \`ref={useAudioPlayer().audioRef}\`), mueve la llamada al hook fuera del JSX
- Desestructura el hook al inicio del componente: \`const { audioRef, ... } = useAudioPlayer();\`
- Luego usa la variable en JSX: \`<audio ref={audioRef} />\`
- Si necesitas usar funciones del hook en callbacks, desestructúralas también del hook

**TypeScript - Property does not exist (CASO CRÍTICO):**
- Si el error dice "Property 'X' does not exist on type 'Y'":
  1. VERIFICA si el hook realmente retorna 'X' (lee el código del hook, busca el return)
  2. SI EL HOOK RETORNA 'X' PERO EL TIPO NO LO INCLUYE:
     - Busca la definición del tipo de retorno del hook (ej: const useHook = (): TypeA & TypeB => {)
     - Busca si hay una interfaz que debería incluir 'X' (ej: interface AudioPlayerRefs { audioRef: ... })
     - Si existe una interfaz separada, agrégala al tipo de retorno: TypeA & TypeB & RefsType
     - Si NO existe, créala: interface HookRefs { X: TipoDeX; } y agrégala al tipo de retorno
  3. SI EL HOOK NO RETORNA 'X':
     - Agrega 'X' al objeto de retorno del hook (en el return { ... })
     - Actualiza el tipo de retorno para incluir 'X' (crea o actualiza la interfaz)
  4. IMPORTANTE: Si el error es "Property 'audioRef' does not exist", verifica:
     - Si audioRef está creado en el hook (busca const audioRef = useRef<...>(null))
     - Si audioRef está en el return { ... } del hook
     - Si el tipo de retorno incluye audioRef
     - Si falta alguno de estos, corrige TODOS en una sola corrección

**TypeScript - Cannot find name:**
- Si el error dice "Cannot find name 'X'":
  1. **BUSCA EN TODO EL ARCHIVO** dónde se usa 'X' (puede estar en múltiples lugares)
  2. **VERIFICA** si 'X' viene de un hook (busca patrones como useHook().X o const { ... } = useHook())
  3. **SI VIENE DE UN HOOK:**
     - Si el hook ya está desestructurado al inicio, AGREGA 'X' a la desestructuración
     - Si el hook NO está desestructurado, mueve la llamada al hook al inicio y desestructura TODAS las propiedades necesarias (incluyendo 'X' y cualquier otra que se use)
     - Reemplaza TODAS las referencias directas al hook con las variables desestructuradas
  4. **SI VIENE DE UN IMPORT:**
     - Verifica que el import es correcto
  5. **SI SE USA EN UN CALLBACK:**
     - Asegúrate de que está disponible en ese scope (desestructúrala del hook al inicio del componente)
  6. **IMPORTANTE:** Busca TODAS las referencias a 'X' en el archivo y corrígelas TODAS en una sola corrección

**TypeScript - Type errors:**
- Si el error es sobre tipos incompatibles:
  - Verifica que los tipos coincidan exactamente
  - Si falta una propiedad en el tipo de retorno, agrégala
  - Si el tipo de retorno no coincide, ajusta el tipo o el valor retornado

**EJEMPLOS DE CORRECCIONES CORRECTAS:**

**Ejemplo 1 - Hook en JSX (INCORRECTO):**
\`\`\`tsx
const Component = () => {
  return <audio ref={useAudioPlayer().audioRef} />;
};
\`\`\`

**Corrección (CORRECTO):**
\`\`\`tsx
const Component = () => {
  const { audioRef, play, pause } = useAudioPlayer();
  return <audio ref={audioRef} />;
};
\`\`\`

**Ejemplo 2 - Hook en callback (INCORRECTO):**
\`\`\`tsx
const Component = () => {
  return <button onClick={() => useAudioPlayer().play()}>Play</button>;
};
\`\`\`

**Corrección (CORRECTO):**
\`\`\`tsx
const Component = () => {
  const { play } = useAudioPlayer();
  return <button onClick={() => play()}>Play</button>;
};
\`\`\`

**Ejemplo 3 - Propiedad faltante en tipo (CASO REAL ACTUAL):**
Si el error es "Property 'audioRef' does not exist on type 'AudioPlayerState & AudioPlayerActions'":

ANÁLISIS DEL PROBLEMA:
1. El hook useAudioPlayer tiene el tipo de retorno: AudioPlayerState & AudioPlayerActions
2. El hook crea audioRef con: const audioRef = useRef<HTMLAudioElement>(null);
3. PERO el hook NO retorna audioRef en el objeto de retorno
4. Y el tipo de retorno NO incluye audioRef

SOLUCIÓN COMPLETA (debe incluir TODOS estos cambios):

PASO 1: Crear la interfaz AudioPlayerRefs (ANTES de AudioPlayerActions o después):
interface AudioPlayerRefs {
  audioRef: React.RefObject<HTMLAudioElement>;
}

PASO 2: Actualizar el tipo de retorno del hook:
const useAudioPlayer = (): AudioPlayerState & AudioPlayerActions & AudioPlayerRefs => {

PASO 3: Agregar audioRef al objeto de retorno del hook:
return {
  ...state,
  play,
  pause,
  seek,
  setVolume,
  toggleMute,
  loadFile,
  addToPlaylist,
  clearPlaylist,
  nextTrack,
  previousTrack,
  audioRef,
};

IMPORTANTE: 
- La corrección debe incluir TODOS los cambios (interfaz + tipo + retorno) en UNA SOLA corrección
- El oldCode debe incluir suficiente contexto para encontrar el código exacto
- Si no existe la interfaz AudioPlayerRefs, créala ANTES de AudioPlayerActions o después de ella
- El newCode debe incluir la interfaz completa, el tipo actualizado, y el retorno actualizado

**REGLAS IMPORTANTES:**
- SIEMPRE proporciona correcciones COMPLETAS que resuelvan TODOS los problemas relacionados
- Si un error menciona una propiedad faltante, verifica TODAS las referencias a esa propiedad en TODO el archivo
- Si un error menciona una variable no encontrada, verifica TODAS las referencias a esa variable en TODO el archivo
- NO dejes correcciones parciales que causen nuevos errores
- Si necesitas hacer múltiples cambios en el mismo archivo, proporciona UNA SOLA corrección con oldCode que incluya TODO el bloque afectado (desde el inicio del componente hasta donde se usan las variables)
- Cuando corrijas un hook usado incorrectamente:
  * Identifica TODOS los lugares donde se usa el hook (en JSX, callbacks, etc.) buscando en TODO el archivo
  * Mueve la llamada al hook al inicio del componente (justo después de los estados locales)
  * Desestructura TODAS las propiedades que se usan en cualquier parte del componente (incluyendo audioRef, loadFile, y cualquier otra)
  * Reemplaza TODAS las referencias directas al hook (como useAudioPlayer().audioRef) con las variables desestructuradas (como audioRef)
  * Incluye TODOS estos cambios en una sola corrección con contexto suficiente (oldCode debe incluir desde la desestructuración hasta donde se usan las variables)
- Cuando el error es "Property 'X' does not exist on type 'Y'":
  * Si el hook crea 'X' pero NO lo retorna: AGREGA 'X' al objeto de retorno del hook
  * Si el tipo no incluye 'X': CREA la interfaz necesaria y ACTUALIZA el tipo de retorno
  * Proporciona UNA SOLA corrección que incluya:
    - La creación de la interfaz (si no existe)
    - La actualización del tipo de retorno
    - La actualización del objeto de retorno
  * El oldCode debe incluir suficiente contexto para identificar ÚNICAMENTE el código a cambiar (ej: desde la definición de la interfaz anterior hasta el final del return del hook)
  * El newCode debe incluir TODOS los cambios necesarios

**FORMATO DE RESPUESTA:**
Responde ÚNICAMENTE con un objeto JSON válido:
{
  "corrections": [
    {
      "file": "ruta/al/archivo.tsx",
      "oldCode": "código EXACTO a reemplazar (con contexto suficiente para match único)",
      "newCode": "código COMPLETAMENTE corregido (sin errores)",
      "explanation": "Explicación detallada de la corrección"
    }
  ]
}

**CONTEXTO DE ARCHIVOS:**
${Object.keys(projectFiles).length > 0 ?
  Object.entries(projectFiles).map(([filePath, content]) =>
    `=== ${filePath} ===
${content}`).join('\n\n') :
  'No se pudieron cargar archivos del proyecto'}`;

    const userMessage = `Analiza estos errores de compilación y proporciona correcciones COMPLETAS usando el formato JSON requerido.

**ERRORES A CORREGIR:**
${errorContext}

**ANÁLISIS REQUERIDO:**
1. Lee COMPLETAMENTE el archivo que contiene el error
2. Identifica TODAS las partes del código relacionadas con el error
3. Si el error menciona una propiedad/variable faltante, busca TODAS las referencias a esa propiedad/variable en el archivo
4. Si el error es sobre un hook usado incorrectamente, identifica TODOS los lugares donde se usa ese hook incorrectamente

**EJEMPLO 1 - Hook ya desestructurado, falta propiedad:**
Si el error es "Cannot find name 'loadFile'" en la línea 454, y el hook ya está desestructurado así:
const { audioRef, play, pause, ... } = useAudioPlayer();
Entonces:
- BUSCA en TODO el archivo dónde se usa 'loadFile' (puede ser en línea 454: onClick={() => loadFile(file)})
- VERIFICA que useAudioPlayer() retorna 'loadFile' (revisa la definición del hook en el archivo)
- AGREGA 'loadFile' a la desestructuración existente
- La corrección debe incluir TODA la desestructuración (oldCode) y la desestructuración actualizada (newCode) con 'loadFile' agregado

**EJEMPLO 2 - Hook no desestructurado, se usa directamente:**
Si el error es "Cannot find name 'audioRef'" en la línea 282, pero hay useAudioPlayer().audioRef en la línea 277, entonces:
- DEBES mover el hook useAudioPlayer() al inicio del componente (después de los estados locales)
- DEBES desestructurar TODAS las propiedades necesarias: audioRef, loadFile, y cualquier otra que se use
- DEBES reemplazar TODAS las referencias directas al hook (useAudioPlayer().property) con las variables desestructuradas (property)
- La corrección debe incluir TODOS estos cambios en un solo objeto de corrección

**EJEMPLO 3 - Property does not exist (CASO ACTUAL):**
Si el error es "Property 'audioRef' does not exist on type 'AudioPlayerState & AudioPlayerActions'":

1. VERIFICA el hook useAudioPlayer en el archivo:
   - Busca const audioRef = useRef<HTMLAudioElement>(null); (debe estar en el hook)
   - Busca el return { ... } del hook
   - Verifica si audioRef está en el return (si NO está, ese es el problema)
   - Verifica el tipo de retorno: const useAudioPlayer = (): AudioPlayerState & AudioPlayerActions => {

2. SOLUCIÓN COMPLETA (hacer TODOS estos cambios):
   a) Crear interfaz AudioPlayerRefs ANTES de AudioPlayerActions:
      interface AudioPlayerRefs {
        audioRef: React.RefObject<HTMLAudioElement>;
      }
   
   b) Actualizar tipo de retorno del hook:
      const useAudioPlayer = (): AudioPlayerState & AudioPlayerActions & AudioPlayerRefs => {
   
   c) Agregar audioRef al return del hook:
      return {
        ...state,
        play,
        pause,
        seek,
        setVolume,
        toggleMute,
        loadFile,
        addToPlaylist,
        clearPlaylist,
        nextTrack,
        previousTrack,
        audioRef,  // <- AGREGAR esta línea
      };

3. FORMATO DE LA CORRECCIÓN:
   - oldCode debe incluir: interface AudioPlayerActions { ... } Y const useAudioPlayer = (): AudioPlayerState & AudioPlayerActions => { ... return { ...state, ... previousTrack, }; };
   - newCode debe incluir: interface AudioPlayerRefs { audioRef: React.RefObject<HTMLAudioElement>; } interface AudioPlayerActions { ... } const useAudioPlayer = (): AudioPlayerState & AudioPlayerActions & AudioPlayerRefs => { ... return { ...state, ... previousTrack, audioRef, }; };

**IMPORTANTE:**
- Los archivos del proyecto están incluidos arriba en el system prompt
- Debes usar el código EXACTO de esos archivos para crear las correcciones
- Proporciona correcciones COMPLETAS que resuelvan TODOS los aspectos de cada error
- Si un error requiere cambios en múltiples lugares del mismo archivo, proporciona UNA SOLA corrección que incluya TODOS los cambios necesarios con suficiente contexto
- Asegúrate de que las correcciones NO introduzcan nuevos errores
- Verifica que todas las variables, funciones y propiedades referenciadas estén disponibles en el scope correcto
- Si corriges un hook, asegúrate de desestructurar TODAS las propiedades que se usan en el componente`;

    // Prepare API request based on model type
    // Support different API formats (OpenAI, DeepSeek, etc.)
    const modelUrl = modelConfig.url || modelConfig.endpoint;
    const modelName = modelConfig.model || modelConfig.name;
    const apiKey = modelConfig.apiKey || modelConfig.key;
    
    if (!modelUrl || !modelName || !apiKey) {
      return { success: false, error: 'Model configuration incomplete. Need url, model, and apiKey' };
    }

    // Determine API format based on URL
    const isOpenAIFormat = modelUrl.includes('openai.com') || modelUrl.includes('api.openai.com');
    const isDeepSeekFormat = modelUrl.includes('deepseek.com') || modelUrl.includes('api.deepseek.com');
    
    // Prepare request body
    let requestBody;
    if (isOpenAIFormat || isDeepSeekFormat) {
      // OpenAI/DeepSeek format
      requestBody = {
        model: modelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.1,
        max_tokens: 8192
      };
    } else {
      // Generic format (try OpenAI-compatible first)
      requestBody = {
        model: modelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.1,
        max_tokens: 8192
      };
    }

    // Call AI API
    const aiResponse = await fetch(modelUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('[PreviewServer][AutoBuildFix] AI model error:', errorText);
      return { success: false, error: `AI model error: ${aiResponse.status}` };
    }

    const aiData = await aiResponse.json();
    
    // Parse response from different API formats
    let aiContent;
    if (aiData.choices && aiData.choices[0] && aiData.choices[0].message) {
      // OpenAI format
      aiContent = aiData.choices[0].message.content?.trim();
    } else if (aiData.content) {
      // Direct content format
      aiContent = aiData.content.trim();
    } else if (aiData.message && aiData.message.content) {
      // Alternative format
      aiContent = aiData.message.content.trim();
    } else if (aiData.response) {
      // Some APIs wrap in response
      aiContent = aiData.response.trim();
    } else if (typeof aiData === 'string') {
      // Direct string response
      aiContent = aiData.trim();
    }

    if (!aiContent) {
      return { success: false, error: 'Empty response from AI model' };
    }

    console.log('[PreviewServer][AutoBuildFix] AI model response received');

    // Parse AI response
    let corrections = [];
    try {
      let jsonString = aiContent;
      const jsonMatch = jsonString.match(/```json\s*([\s\S]*?)\s*```/i) ||
                       jsonString.match(/```\s*([\s\S]*?)\s*```/i);

      if (jsonMatch && jsonMatch[1]) {
        jsonString = jsonMatch[1].trim();
      }

      const jsonStart = jsonString.indexOf('{');
      const jsonEnd = jsonString.lastIndexOf('}');

      if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
        jsonString = jsonString.substring(jsonStart, jsonEnd + 1);
      }

      const parsedResponse = JSON.parse(jsonString);

      if (parsedResponse.corrections && Array.isArray(parsedResponse.corrections)) {
        corrections = parsedResponse.corrections;
        // Add error line numbers to corrections for better matching
        corrections = corrections.map((correction, index) => {
          // Try to find corresponding error for this correction
          const matchingError = errorList.find(err => 
            err.file === correction.file && 
            (err.line > 0 || correction.file.includes(err.file.split('/').pop()))
          );
          if (matchingError && matchingError.line > 0) {
            correction.line = matchingError.line;
          }
          return correction;
        });
        console.log(`[PreviewServer][AutoBuildFix] AI provided ${corrections.length} corrections`);
      } else {
        console.warn('[PreviewServer][AutoBuildFix] AI response does not contain corrections array');
        return { success: false, error: 'AI did not provide corrections in expected format' };
      }
    } catch (parseError) {
      console.error('[PreviewServer][AutoBuildFix] Failed to parse AI response:', parseError);
      console.error('[PreviewServer][AutoBuildFix] Raw AI response (first 500 chars):', aiContent.substring(0, 500));
      return { success: false, error: 'Failed to parse AI corrections' };
    }

    if (corrections.length === 0) {
      console.log('[PreviewServer][AutoBuildFix] No corrections provided by AI');
      return { success: false, error: 'No automatic fixes available for these errors' };
    }

    // Apply corrections (pass error context for better matching)
    console.log(`[PreviewServer][AutoBuildFix] Applying ${corrections.length} AI-generated corrections...`);
    const applyResult = await applyCorrections(corrections, projectPath, errorList);
    console.log(`[PreviewServer][AutoBuildFix] AI corrections applied: ${applyResult.applied}/${applyResult.total} (${applyResult.failed} failed)`);
    
    return {
      success: true,
      corrections: corrections,
      applied: applyResult.applied,
      failed: applyResult.failed,
      total: applyResult.total
    };

  } catch (apiError) {
    console.warn('[PreviewServer][AutoBuildFix] Failed to send errors to AI:', apiError.message);
    return { success: false, error: apiError.message };
  }
}

// Function to apply corrections to files
// Helper function to normalize whitespace for comparison
function normalizeWhitespace(code) {
  return code
    .replace(/\r\n/g, '\n')  // Normalize line endings
    .replace(/\r/g, '\n')     // Handle old Mac line endings
    .replace(/[ \t]+/g, ' ')  // Normalize spaces and tabs
    .replace(/\n\s*\n\s*\n/g, '\n\n')  // Normalize multiple blank lines
    .trim();
}

// Helper function to find code by line number with context
function findCodeByLineNumber(fileContent, targetLine, contextLines = 10) {
  const lines = fileContent.split('\n');
  const lineIndex = targetLine - 1; // Convert to 0-based index
  
  if (lineIndex < 0 || lineIndex >= lines.length) {
    return null;
  }
  
  // Get context around the target line
  const startLine = Math.max(0, lineIndex - contextLines);
  const endLine = Math.min(lines.length, lineIndex + contextLines);
  const contextCode = lines.slice(startLine, endLine).join('\n');
  
  return {
    code: contextCode,
    startLine: startLine,
    endLine: endLine,
    targetLine: lineIndex
  };
}

// Helper function to calculate similarity between two strings
function calculateSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  if (str1 === str2) return 1;
  
  // If one contains the other, return high similarity
  if (str1.includes(str2)) {
    return str2.length / str1.length;
  }
  if (str2.includes(str1)) {
    return str1.length / str2.length;
  }
  
  // Calculate longest common subsequence ratio
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  // Simple word-based similarity
  const words1 = str1.split(/\s+/).filter(w => w.length > 2);
  const words2 = str2.split(/\s+/).filter(w => w.length > 2);
  
  if (words1.length === 0 || words2.length === 0) {
    // Fallback to character-based similarity
    const set1 = new Set(str1.split(''));
    const set2 = new Set(str2.split(''));
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    return union.size > 0 ? intersection.size / union.size : 0;
  }
  
  // Count matching words
  const set2 = new Set(words2);
  const matchingWords = words1.filter(w => set2.has(w));
  const similarity = matchingWords.length / Math.max(words1.length, words2.length);
  
  return similarity;
}

async function applyCorrections(corrections, projectPath, errorContext = {}) {
  // Track applied corrections for statistics
  let appliedCount = 0;
  let failedCount = 0;
  
  // Create a map of file -> line -> error for better lookup
  const errorMap = {};
  let errorContextByFile = {}; // Structure: { fileName: [error1, error2, ...] }
  
  if (errorContext && Array.isArray(errorContext)) {
    errorContext.forEach(error => {
      if (!errorMap[error.file]) {
        errorMap[error.file] = {};
      }
      errorMap[error.file][error.line] = error;
      
      // Also build errorContextByFile for Strategy 6
      if (!errorContextByFile[error.file]) {
        errorContextByFile[error.file] = [];
      }
      errorContextByFile[error.file].push(error);
    });
  } else if (errorContext && typeof errorContext === 'object' && !Array.isArray(errorContext)) {
    // If it's already in the file-based format
    errorContextByFile = errorContext;
    // Also build errorMap from it
    for (const fileName in errorContext) {
      if (Array.isArray(errorContext[fileName])) {
        if (!errorMap[fileName]) {
          errorMap[fileName] = {};
        }
        errorContext[fileName].forEach(error => {
          errorMap[fileName][error.line] = error;
        });
      }
    }
  }
  
  for (const correction of corrections) {
    try {
      const filePath = path.join(projectPath, correction.file);
      
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        console.warn(`[PreviewServer][AutoBuildFix] File not found: ${filePath}`);
        continue;
      }

      // Read file content
      let fileContent = await fs.readFile(filePath, 'utf-8');
      const lines = fileContent.split('\n');
      
      // Get error line number from correction or error context
      let errorLine = null;
      if (correction.line) {
        errorLine = correction.line;
      } else if (errorMap[correction.file]) {
        // Try to find the error line from context
        const fileErrors = errorMap[correction.file];
        const errorLines = Object.keys(fileErrors).map(Number).sort((a, b) => a - b);
        if (errorLines.length > 0) {
          errorLine = errorLines[0]; // Use first error line
        }
      }
      
      let applied = false;
      
      // Strategy 1: Try exact match
      let oldCodeIndex = fileContent.indexOf(correction.oldCode);
      if (oldCodeIndex !== -1) {
        fileContent = fileContent.substring(0, oldCodeIndex) + 
                     correction.newCode + 
                     fileContent.substring(oldCodeIndex + correction.oldCode.length);
        console.log(`[PreviewServer][AutoBuildFix] Applied exact match correction in ${filePath}`);
        applied = true;
      }
      
      // Strategy 2: Try normalized whitespace match
      if (!applied) {
        const normalizedOldCode = normalizeWhitespace(correction.oldCode);
        const normalizedFileContent = normalizeWhitespace(fileContent);
        const normalizedIndex = normalizedFileContent.indexOf(normalizedOldCode);
        
        if (normalizedIndex !== -1) {
          // Find the corresponding position in original file
          // This is approximate but should work for most cases
          const beforeNormalized = normalizedFileContent.substring(0, normalizedIndex);
          const normalizedLineCount = beforeNormalized.split('\n').length;
          
          // Try to find the actual position
          let actualIndex = 0;
          let normalizedPos = 0;
          let targetNormalizedPos = normalizedIndex;
          
          for (let i = 0; i < fileContent.length && normalizedPos < targetNormalizedPos; i++) {
            const char = fileContent[i];
            const normalizedChar = char.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/[ \t]+/g, ' ');
            if (normalizedChar === normalizedFileContent[normalizedPos]) {
              normalizedPos++;
            }
            if (normalizedPos <= targetNormalizedPos) {
              actualIndex = i + 1;
            }
          }
          
          // Find the actual old code around this position
          const searchRadius = Math.max(200, correction.oldCode.length * 2);
          const searchStart = Math.max(0, actualIndex - searchRadius);
          const searchEnd = Math.min(fileContent.length, actualIndex + searchRadius);
          const searchArea = fileContent.substring(searchStart, searchEnd);
          
          // Try to find a match in the search area with more flexible matching
          const oldCodeLines = correction.oldCode.trim().split('\n');
          const firstLine = oldCodeLines[0].trim();
          const lastLine = oldCodeLines[oldCodeLines.length - 1].trim();
          
          const firstLineIndex = searchArea.indexOf(firstLine);
          if (firstLineIndex !== -1) {
            // Found first line, try to find the rest
            let matchStart = searchStart + firstLineIndex;
            let matchEnd = matchStart;
            
            // Try to find where the old code ends
            const remainingSearch = fileContent.substring(matchStart);
            const normalizedRemaining = normalizeWhitespace(remainingSearch);
            const normalizedOld = normalizeWhitespace(correction.oldCode);
            
            if (normalizedRemaining.startsWith(normalizedOld)) {
              // Found a match! Now find the exact boundaries
              let charsMatched = 0;
              let normalizedCharsMatched = 0;
              const targetNormalizedLength = normalizedOld.length;
              
              for (let i = matchStart; i < fileContent.length && normalizedCharsMatched < targetNormalizedLength; i++) {
                const char = fileContent[i];
                const normalizedChar = char.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/[ \t]+/g, ' ');
                if (normalizedChar === normalizedOld[normalizedCharsMatched]) {
                  normalizedCharsMatched++;
                }
                charsMatched++;
              }
              
              matchEnd = matchStart + charsMatched;
              
              fileContent = fileContent.substring(0, matchStart) + 
                           correction.newCode + 
                           fileContent.substring(matchEnd);
              console.log(`[PreviewServer][AutoBuildFix] Applied normalized match correction in ${filePath}`);
              applied = true;
            }
          }
        }
      }
      
      // Strategy 3: Try to find by line number with context matching
      if (!applied && errorLine && errorLine > 0) {
        console.log(`[PreviewServer][AutoBuildFix] Attempting line-based correction for ${filePath} at line ${errorLine}`);
        
        // Get context around error line
        const contextInfo = findCodeByLineNumber(fileContent, errorLine, 15);
        if (contextInfo) {
          const contextCode = contextInfo.code;
          const normalizedContext = normalizeWhitespace(contextCode);
          const normalizedOld = normalizeWhitespace(correction.oldCode);
          
          // Try to find old code in context
          if (normalizedContext.includes(normalizedOld)) {
            // Find the position in the context
            const contextIndex = normalizedContext.indexOf(normalizedOld);
            
            // Calculate approximate position in original file
            const beforeContext = fileContent.split('\n').slice(0, contextInfo.startLine).join('\n');
            const contextStart = beforeContext.length + (beforeContext ? 1 : 0); // +1 for newline
            
            // Find exact match in context area
            const contextArea = fileContent.substring(contextStart, contextStart + contextCode.length);
            const contextOldIndex = normalizeWhitespace(contextArea).indexOf(normalizedOld);
            
            if (contextOldIndex !== -1) {
              // Find actual boundaries by counting characters
              let actualStart = contextStart;
              let normalizedPos = 0;
              
              for (let i = contextStart; i < fileContent.length && normalizedPos < contextOldIndex; i++) {
                const char = fileContent[i];
                const normalizedChar = char.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/[ \t]+/g, ' ');
                if (normalizedChar && normalizedContext[normalizedPos] === normalizedChar) {
                  normalizedPos++;
                }
                actualStart = i + 1;
              }
              
              // Find end of old code
              let actualEnd = actualStart;
              normalizedPos = contextOldIndex;
              const targetEnd = contextOldIndex + normalizedOld.length;
              
              for (let i = actualStart; i < fileContent.length && normalizedPos < targetEnd; i++) {
                const char = fileContent[i];
                const normalizedChar = char.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/[ \t]+/g, ' ');
                if (normalizedChar && normalizedContext[normalizedPos] === normalizedChar) {
                  normalizedPos++;
                }
                actualEnd = i + 1;
              }
              
              // Try to refine by finding exact line boundaries
              const oldCodeLines = correction.oldCode.trim().split('\n');
              const firstOldLine = oldCodeLines[0].trim();
              
              // Find the line containing the error - but also search more broadly
              // The error might be on a different line than where the oldCode starts
              // Search in a wider range around the error line
              let matchStart = -1;
              let matchEnd = -1;
              const searchRange = 30; // Search 30 lines before and after error line
              
              // First, try to find old code by searching for its first line
              for (let searchStart = Math.max(0, errorLine - searchRange - 1); 
                   searchStart < Math.min(lines.length, errorLine + searchRange); 
                   searchStart++) {
                
                // Try different window sizes
                for (let windowSize = oldCodeLines.length; 
                     windowSize <= oldCodeLines.length + 10 && 
                     searchStart + windowSize <= lines.length; 
                     windowSize++) {
                  
                  const candidate = lines.slice(searchStart, searchStart + windowSize).join('\n');
                  const normalizedCandidate = normalizeWhitespace(candidate);
                  
                  // Check for match - be more lenient
                  const similarity = calculateSimilarity(normalizedCandidate, normalizedOld);
                  if (similarity > 0.7) { // 70% similarity threshold
                    matchStart = searchStart;
                    matchEnd = searchStart + windowSize;
                    console.log(`[PreviewServer][AutoBuildFix] Found potential match with ${(similarity * 100).toFixed(1)}% similarity at lines ${matchStart + 1}-${matchEnd}`);
                    break;
                  }
                }
                if (matchStart !== -1) break;
              }
              
              // If we found a match, replace it
              if (matchStart !== -1 && matchEnd !== -1) {
                const before = lines.slice(0, matchStart).join('\n');
                const after = lines.slice(matchEnd).join('\n');
                
                fileContent = before + (before ? '\n' : '') + 
                             correction.newCode + 
                             (after ? '\n' : '') + after;
                console.log(`[PreviewServer][AutoBuildFix] Applied line-based correction in ${filePath} (lines ${matchStart + 1}-${matchEnd})`);
                applied = true;
              }
            }
          }
        }
      }
      
      // Strategy 4: Try partial matching with key identifiers
      if (!applied) {
        const oldCodeLines = correction.oldCode.trim().split('\n').filter(l => l.trim());
        if (oldCodeLines.length > 0) {
          // Find lines that contain key parts of old code
          const keyLine = oldCodeLines.find(l => l.trim().length > 20) || oldCodeLines[0];
          const keyPattern = keyLine.trim().substring(0, Math.min(50, keyLine.length));
          
          // Search for this pattern in the file
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(keyPattern) || normalizeWhitespace(lines[i]).includes(normalizeWhitespace(keyPattern))) {
              // Found potential match, try to extract context
              const contextStart = Math.max(0, i - 5);
              const contextEnd = Math.min(lines.length, i + oldCodeLines.length + 5);
              const context = lines.slice(contextStart, contextEnd).join('\n');
              const normalizedContext = normalizeWhitespace(context);
              const normalizedOld = normalizeWhitespace(correction.oldCode);
              
              // Check if context contains old code
              if (normalizedContext.includes(normalizedOld) || normalizedOld.includes(normalizedContext.substring(0, Math.min(normalizedOld.length, normalizedContext.length * 0.8)))) {
                // Try to replace
                const before = lines.slice(0, contextStart).join('\n');
                const after = lines.slice(contextEnd).join('\n');
                
                // Extract the actual old code from context
                // For now, replace the entire context window (risky but might work)
                fileContent = before + (before ? '\n' : '') + 
                             correction.newCode + 
                             (after ? '\n' : '') + after;
                console.log(`[PreviewServer][AutoBuildFix] Applied partial match correction in ${filePath} (around line ${i + 1})`);
                applied = true;
                break;
              }
            }
          }
        }
      }
      
      // Strategy 5: For parsing errors with unclosed JSX tags, try appending at the end
      if (!applied && errorLine) {
        const errorMsg = (errorContextByFile[correction.file] || []).find(e => e.line === errorLine)?.message || '';
        const isParsingError = errorMsg.includes('Parsing error') || 
                              errorMsg.includes('no corresponding closing tag') ||
                              errorMsg.includes('Unterminated');
        
        if (isParsingError) {
          // Check if the file ends abruptly (doesn't have proper closing)
          const lastLine = lines[lines.length - 1] || '';
          const fileEndsWithStyle = lastLine.trim().endsWith('`}</style>') || lastLine.trim().endsWith('`}');
          const newCodeEndsWithClosing = correction.newCode.trim().endsWith('</header>') || 
                                         correction.newCode.trim().endsWith('</div>') ||
                                         correction.newCode.trim().includes('export default');
          
          // If file ends abruptly and newCode has closing tags, try appending
          if (fileEndsWithStyle && newCodeEndsWithClosing) {
            // Extract what should be appended from newCode
            // Try to find the closing part of newCode that doesn't exist in oldCode
            const normalizedOldEnd = normalizeWhitespace(correction.oldCode.trim());
            const normalizedNewEnd = normalizeWhitespace(correction.newCode.trim());
            
            // If newCode ends with something not in oldCode, it might be the missing closing
            if (!normalizedNewEnd.includes(normalizedOldEnd) || normalizedNewEnd.length > normalizedOldEnd.length * 1.5) {
              // Try to find the difference - what needs to be appended
              // Look for closing tags in newCode that aren't at the end of the file
              const closingMatch = correction.newCode.match(/(<\/\w+>[\s\S]*?)(?:export\s+default[\s\S]*?)?;?\s*$/);
              if (closingMatch) {
                const toAppend = closingMatch[1].trim();
                const needsExport = correction.newCode.includes('export default');
                const exportMatch = needsExport ? correction.newCode.match(/(export\s+default\s+\w+;?)\s*$/) : null;
                
                // Append the missing closing tags
                fileContent = fileContent.trim() + '\n' + toAppend + (exportMatch ? '\n\n' + exportMatch[1] : '');
                console.log(`[PreviewServer][AutoBuildFix] Applied append strategy for parsing error in ${filePath}`);
                applied = true;
              } else {
                // Fallback: if newCode is significantly different and longer, use it as replacement for the end
                const oldCodeEnd = correction.oldCode.trim().split('\n').slice(-5).join('\n');
                const newCodeEnd = correction.newCode.trim().split('\n').slice(-10).join('\n');
                
                // If oldCodeEnd exists in file's end, replace it with newCodeEnd
                const fileEnd = lines.slice(Math.max(0, lines.length - 10)).join('\n');
                if (fileEnd.includes(oldCodeEnd) || normalizeWhitespace(fileEnd).includes(normalizeWhitespace(oldCodeEnd))) {
                  const beforeEnd = lines.slice(0, Math.max(0, lines.length - 5)).join('\n');
                  fileContent = beforeEnd + '\n' + newCodeEnd;
                  console.log(`[PreviewServer][AutoBuildFix] Applied end-replacement strategy for parsing error in ${filePath}`);
                  applied = true;
                } else {
                  // Last resort: if file ends with </style> and newCode has closing tags, append the closing from newCode
                  // Extract closing tags from newCode (everything after the last </style> or similar)
                  const lastStyleInNew = correction.newCode.lastIndexOf('`}</style>');
                  if (lastStyleInNew !== -1) {
                    const afterStyle = correction.newCode.substring(lastStyleInNew + '`}</style>'.length).trim();
                    if (afterStyle) {
                      fileContent = fileContent.trim() + '\n' + afterStyle;
                      console.log(`[PreviewServer][AutoBuildFix] Applied simple append strategy for parsing error in ${filePath}`);
                      applied = true;
                    }
                  }
                }
              }
            }
          }
        }
      }
      
      // Strategy 6: For parsing errors where oldCode doesn't match, try to find the opening tag and append closing from newCode
      if (!applied && errorLine) {
        const errorMsg = (errorContextByFile[correction.file] || []).find(e => e.line === errorLine)?.message || 
                         (errorMap[correction.file] && errorMap[correction.file][errorLine])?.message || '';
        const isParsingError = errorMsg.includes('Parsing error') || 
                              errorMsg.includes('no corresponding closing tag') ||
                              errorMsg.includes('Unterminated');
        
        if (isParsingError) {
          // Try to find the opening tag mentioned in the error (e.g., '<header>' or "JSX element 'header'")
          // More flexible regex to match different formats
          let tagName = null;
          const tagPatterns = [
            /JSX element ['"]([\w-]+)['"]/i,  // "JSX element 'header'"
            /element ['"]([\w-]+)['"] has no/i,  // "element 'header' has no"
            /<\s*(\w+)\s+className/i  // Try to extract from the actual error line
          ];
          
          for (const pattern of tagPatterns) {
            const match = errorMsg.match(pattern);
            if (match && match[1]) {
              tagName = match[1];
              console.log(`[PreviewServer][AutoBuildFix] Strategy 6: Found tag name from error message: ${tagName}`);
              break;
            }
          }
          
          // If not found in error message, try to extract from the error line itself
          if (!tagName && errorLine > 0 && errorLine <= lines.length) {
            const errorLineContent = lines[errorLine - 1] || '';
            const lineTagMatch = errorLineContent.match(/<\s*(\w+)(?:\s|>|className)/);
            if (lineTagMatch && lineTagMatch[1]) {
              tagName = lineTagMatch[1];
              console.log(`[PreviewServer][AutoBuildFix] Strategy 6: Found tag name from error line: ${tagName}`);
            }
          }
          
          if (tagName) {
            const openingTagPattern = new RegExp(`<${tagName}(?:\\s|>|className|id|on[A-Z]|key)`, 'i');
            const closingTag = `</${tagName}>`;
            const closingTagEscaped = closingTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            
            // Check if file has opening tag but not closing tag
            const hasOpening = openingTagPattern.test(fileContent);
            const hasClosing = new RegExp(closingTagEscaped, 'i').test(fileContent);
            
            console.log(`[PreviewServer][AutoBuildFix] Strategy 6: Checking for ${tagName} - hasOpening: ${hasOpening}, hasClosing: ${hasClosing}`);
            
            if (hasOpening && !hasClosing && correction.newCode.includes(closingTag)) {
              console.log(`[PreviewServer][AutoBuildFix] Strategy 6: File has <${tagName}> but missing </${tagName}>, attempting to fix...`);
              
              // Find the opening tag line
              let openingTagLine = -1;
              for (let i = 0; i < lines.length; i++) {
                if (openingTagPattern.test(lines[i]) && !lines[i].trim().endsWith('/>')) {
                  openingTagLine = i;
                  break;
                }
              }
              
              // Find insertion point - after last </style>, before export default, or at the end
              let insertionPoint = -1;
              
              // 1. Try after last </style>
              for (let i = lines.length - 1; i >= (openingTagLine !== -1 ? openingTagLine : 0); i--) {
                if (lines[i].includes('`}</style>') || lines[i].trim().endsWith('`}</style>')) {
                  insertionPoint = i;
                  break;
                }
              }
              
              // 2. Try before export default
              if (insertionPoint === -1) {
                for (let i = (openingTagLine !== -1 ? openingTagLine + 1 : 0); i < lines.length; i++) {
                  if (lines[i].includes('export default')) {
                    insertionPoint = i - 1;
                    break;
                  }
                }
              }
              
              // 3. Fallback: end of file
              if (insertionPoint === -1) {
                insertionPoint = lines.length - 1;
              }
              
              // Extract the closing tag and content from newCode
              // Look for the closing tag in newCode
              let missingPart = '';
              
              // Find where the closing tag is in newCode, and extract from after </style> to that point
              const lastStyleInNew = correction.newCode.lastIndexOf('`}</style>');
              
              if (lastStyleInNew !== -1) {
                const afterStyle = correction.newCode.substring(lastStyleInNew + '`}</style>'.length).trim();
                const closingIndex = afterStyle.indexOf(closingTag);
                if (closingIndex !== -1) {
                  // Extract from closing tag to before export default (if exists)
                  const extractToExport = afterStyle.substring(closingIndex);
                  const exportIndex = extractToExport.indexOf('export default');
                  missingPart = exportIndex !== -1 
                    ? extractToExport.substring(0, exportIndex).trim()
                    : extractToExport.trim();
                }
              } else {
                // No </style> in newCode, extract just the closing part
                const closingIndex = correction.newCode.indexOf(closingTag);
                if (closingIndex !== -1) {
                  const extractToExport = correction.newCode.substring(closingIndex);
                  const exportIndex = extractToExport.indexOf('export default');
                  if (exportIndex !== -1) {
                    missingPart = extractToExport.substring(0, exportIndex).trim();
                  } else {
                    // Just extract the closing tag itself
                    missingPart = closingTag;
                  }
                }
              }
              
              if (missingPart && missingPart.includes(closingTag)) {
                // Get indentation from opening tag line
                let indent = '';
                if (openingTagLine !== -1) {
                  const openingMatch = lines[openingTagLine].match(/^(\s*)/);
                  if (openingMatch) {
                    indent = openingMatch[1];
                  }
                }
                
                // Apply indentation to closing tag
                const indentedClosing = indent + closingTag;
                
                // Insert after the insertion point
                const insertionLine = lines[insertionPoint] || '';
                if (insertionLine.includes('`}</style>') || insertionLine.trim().endsWith('`}</style>')) {
                  // Insert after </style>
                  const before = lines.slice(0, insertionPoint + 1).join('\n');
                  const after = lines.slice(insertionPoint + 1).join('\n');
                  fileContent = before + '\n' + indentedClosing + (after ? '\n' + after : '');
                } else if (insertionLine.includes('export default')) {
                  // Insert before export default
                  const before = lines.slice(0, insertionPoint).join('\n');
                  const after = lines.slice(insertionPoint).join('\n');
                  fileContent = before + '\n' + indentedClosing + '\n' + after;
                } else {
                  // Insert at end
                  fileContent = fileContent.trim() + '\n' + indentedClosing;
                }
                
                console.log(`[PreviewServer][AutoBuildFix] Strategy 6: Applied tag-closing append for ${tagName} in ${filePath} at line ${insertionPoint + 1}`);
                applied = true;
              } else {
                console.warn(`[PreviewServer][AutoBuildFix] Strategy 6: Could not extract closing tag from newCode`);
              }
            } else {
              if (!hasOpening) {
                console.warn(`[PreviewServer][AutoBuildFix] Strategy 6: File does not have opening tag <${tagName}>`);
              } else if (hasClosing) {
                console.warn(`[PreviewServer][AutoBuildFix] Strategy 6: File already has closing tag </${tagName}>`);
              } else if (!correction.newCode.includes(closingTag)) {
                console.warn(`[PreviewServer][AutoBuildFix] Strategy 6: newCode does not contain closing tag ${closingTag}`);
              }
            }
          } else {
            console.warn(`[PreviewServer][AutoBuildFix] Strategy 6: Could not extract tag name from error message or error line`);
          }
        }
      }
      
      // Strategy 7: For TypeScript errors about undefined variables in object literals
      if (!applied && errorLine) {
        const errorMsg = (errorContextByFile[correction.file] || []).find(e => e.line === errorLine)?.message || 
                         (errorMap[correction.file] && errorMap[correction.file][errorLine])?.message || '';
        const isUndefinedVarError = errorMsg.includes('No value exists in scope for the shorthand property') ||
                                    errorMsg.includes('is not defined') ||
                                    (errorMsg.includes('Type error') && errorMsg.includes('shorthand property'));
        
        if (isUndefinedVarError) {
          // Extract the variable name from the error message
          const varNameMatch = errorMsg.match(/shorthand property ['"]([\w]+)['"]/i) ||
                              errorMsg.match(/['"](\w+)['"] is not defined/i) ||
                              errorMsg.match(/shorthand property (\w+)/i);
          
          if (varNameMatch && varNameMatch[1] && errorLine > 0 && errorLine <= lines.length) {
            const varName = varNameMatch[1];
            const errorLineContent = lines[errorLine - 1] || '';
            
            console.log(`[PreviewServer][AutoBuildFix] Strategy 7: Detected undefined variable '${varName}' on line ${errorLine}`);
            console.log(`[PreviewServer][AutoBuildFix] Strategy 7: Error line content: ${errorLineContent}`);
            
            // Check if the error line contains the variable in an object literal context
            // Look for patterns like: "varName," or ",varName," or "varName," at the end of a line
            const varPattern = new RegExp(`\\b${varName}\\s*,?`, 'i');
            if (varPattern.test(errorLineContent)) {
              // Try to find the object literal that contains this line
              // Look backwards for the opening brace of the return statement
              let objectStart = -1;
              let braceCount = 0;
              
              // Search backwards from error line to find the opening brace of the object
              for (let i = errorLine - 1; i >= 0; i--) {
                const line = lines[i];
                // Count braces to find the matching opening brace
                braceCount += (line.match(/{/g) || []).length;
                braceCount -= (line.match(/}/g) || []).length;
                
                // Look for return statement followed by an object
                if (line.includes('return') && (line.includes('{') || i + 1 < lines.length && lines[i + 1].includes('{'))) {
                  objectStart = i;
                  break;
                }
                
                // If we found the opening brace of the object
                if (braceCount > 0 && line.includes('{')) {
                  // Check if this looks like a return object
                  const prevLines = lines.slice(Math.max(0, i - 5), i).join('\n');
                  if (prevLines.includes('return') || line.includes('return')) {
                    objectStart = i;
                    break;
                  }
                }
              }
              
              // Directly remove the undefined variable from the file
              // Since the error says it's not defined, we should remove it regardless of oldCode/newCode
              let foundVar = false;
              
              // First, try to remove from the exact error line
              if (errorLine > 0 && errorLine <= lines.length) {
                const line = lines[errorLine - 1];
                const trimmedLine = line.trim();
                
                // Check if this line contains only the variable (with comma and whitespace)
                if (trimmedLine === `${varName},` || trimmedLine === varName || 
                    (trimmedLine.startsWith(varName + ',') && trimmedLine.length <= varName.length + 10)) {
                  // Remove this entire line
                  lines.splice(errorLine - 1, 1);
                  fileContent = lines.join('\n');
                  console.log(`[PreviewServer][AutoBuildFix] Strategy 7: Removed entire line ${errorLine} containing '${varName}'`);
                  applied = true;
                  foundVar = true;
                } else if (line.includes(varName + ',')) {
                  // Variable is on a line with other content, remove just the variable
                  // Handle cases like: "    updateState," or "previousTrack,\n    updateState,"
                  let newLine = line;
                  
                  // Remove the variable with its comma and surrounding whitespace
                  // Pattern: whitespace + varName + comma + optional whitespace
                  newLine = newLine.replace(new RegExp(`\\s*${varName}\\s*,?\\s*`, 'i'), '');
                  
                  // Clean up: if we're left with just whitespace, remove the line entirely
                  // Otherwise, clean up any double spaces or trailing commas
                  const cleanedLine = newLine.trim();
                  if (!cleanedLine || cleanedLine === ',') {
                    lines.splice(errorLine - 1, 1);
                    // Also clean up the previous line if it ends with a comma
                    if (errorLine > 1) {
                      const prevLine = lines[errorLine - 2] || '';
                      lines[errorLine - 2] = prevLine.replace(/,\s*$/, '');
                    }
                  } else {
                    // Clean up trailing comma if this was the last item
                    lines[errorLine - 1] = cleanedLine.replace(/,\s*$/, '');
                    // Clean up previous line if this line is now empty/near-empty
                    if (errorLine > 1 && cleanedLine.length < 10) {
                      const prevLine = lines[errorLine - 2] || '';
                      lines[errorLine - 2] = prevLine.replace(/,\s*$/, '');
                    }
                  }
                  
                  fileContent = lines.join('\n');
                  console.log(`[PreviewServer][AutoBuildFix] Strategy 7: Removed '${varName}' from line ${errorLine}`);
                  applied = true;
                  foundVar = true;
                }
              }
              
              // If we didn't find it on the exact error line, search nearby lines
              if (!foundVar) {
                for (let i = Math.max(0, errorLine - 10); i < Math.min(lines.length, errorLine + 5); i++) {
                  const line = lines[i];
                  const trimmedLine = line.trim();
                  
                  // Check if this line contains only the variable and comma
                  if (trimmedLine === `${varName},` || trimmedLine === varName) {
                    // Remove this entire line
                    lines.splice(i, 1);
                    fileContent = lines.join('\n');
                    console.log(`[PreviewServer][AutoBuildFix] Strategy 7: Removed line ${i + 1} containing '${varName}'`);
                    applied = true;
                    foundVar = true;
                    break;
                  } else if (line.includes(varName + ',')) {
                    // Variable is on a line with other content, try to remove just the variable
                    let newLine = line.replace(new RegExp(`\\s*${varName}\\s*,?\\s*`, 'i'), '');
                    const cleanedLine = newLine.trim();
                    if (!cleanedLine || cleanedLine === ',') {
                      lines.splice(i, 1);
                      if (i > 0) {
                        const prevLine = lines[i - 1] || '';
                        lines[i - 1] = prevLine.replace(/,\s*$/, '');
                      }
                    } else {
                      lines[i] = cleanedLine.replace(/,\s*$/, '');
                    }
                    fileContent = lines.join('\n');
                    console.log(`[PreviewServer][AutoBuildFix] Strategy 7: Removed '${varName}' from line ${i + 1}`);
                    applied = true;
                    foundVar = true;
                    break;
                  }
                }
              }
              
              // If we still haven't found it, try using newCode as a template to replace the return object
              if (!foundVar) {
                // Try to match the return statement structure in newCode and apply it
                const newCodeReturnMatch = correction.newCode.match(/return\s*\{[\s\S]*?\};?/);
                
                if (newCodeReturnMatch) {
                  const newReturnObj = newCodeReturnMatch[0];
                  
                  // Find the return statement in the file
                  for (let i = Math.max(0, errorLine - 30); i < Math.min(lines.length, errorLine + 5); i++) {
                    if (lines[i].includes('return')) {
                      // Try to find the full return object
                      let returnObj = '';
                      let j = i;
                      let braceBalance = 0;
                      let foundOpen = false;
                      
                      while (j < lines.length) {
                        const line = lines[j];
                        returnObj += line + '\n';
                        
                        braceBalance += (line.match(/{/g) || []).length;
                        braceBalance -= (line.match(/}/g) || []).length;
                        
                        if (line.includes('{')) foundOpen = true;
                        if (foundOpen && braceBalance === 0 && line.includes('}')) {
                          break;
                        }
                        j++;
                      }
                      
                      // Check if the return object contains the variable we want to remove
                      if (returnObj.includes(varName)) {
                        // Replace with newCode version (which should not have the variable)
                        const beforeReturn = lines.slice(0, i).join('\n');
                        const afterReturn = lines.slice(j + 1).join('\n');
                        fileContent = beforeReturn + '\n' + newReturnObj.trim() + (afterReturn ? '\n' + afterReturn : '');
                        console.log(`[PreviewServer][AutoBuildFix] Strategy 7: Replaced return object to remove '${varName}' using newCode`);
                        applied = true;
                        foundVar = true;
                        break;
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      
      if (!applied) {
        // Last resort: Log detailed info for debugging
        console.warn(`[PreviewServer][AutoBuildFix] Could not find oldCode in ${filePath}`);
        console.warn(`[PreviewServer][AutoBuildFix] OldCode preview (first 200 chars): ${correction.oldCode.substring(0, 200)}...`);
        console.warn(`[PreviewServer][AutoBuildFix] OldCode preview (last 200 chars): ...${correction.oldCode.substring(Math.max(0, correction.oldCode.length - 200))}`);
        
        if (errorLine) {
          console.warn(`[PreviewServer][AutoBuildFix] Error line: ${errorLine}`);
          const errorLineContent = lines[errorLine - 1] || 'N/A';
          console.warn(`[PreviewServer][AutoBuildFix] Line ${errorLine} content: ${errorLineContent}`);
          console.warn(`[PreviewServer][AutoBuildFix] Context around line ${errorLine} (10 lines before/after):`);
          const contextStart = Math.max(0, errorLine - 11);
          const contextEnd = Math.min(lines.length, errorLine + 10);
          const contextLines = lines.slice(contextStart, contextEnd);
          contextLines.forEach((line, idx) => {
            const lineNum = contextStart + idx + 1;
            const marker = lineNum === errorLine ? '>>> ' : '    ';
            console.warn(`${marker}${lineNum}: ${line}`);
          });
        } else {
          console.warn(`[PreviewServer][AutoBuildFix] File preview (first 1000 chars): ${fileContent.substring(0, 1000)}...`);
        }
        continue;
      }

      // Write file back
      await fs.writeFile(filePath, fileContent, 'utf-8');
      console.log(`[PreviewServer][AutoBuildFix] Applied correction to ${filePath}`);
      appliedCount++;
      
    } catch (err) {
      console.error(`[PreviewServer][AutoBuildFix] Error applying correction to ${correction.file}:`, err.message);
      console.error(`[PreviewServer][AutoBuildFix] Stack:`, err.stack);
      failedCount++;
    }
  }
  
  return {
    applied: appliedCount,
    failed: failedCount,
    total: corrections.length
  };
}

// Helper function to notify WebSocket clients about project refresh
function notifyWebSocketClients(projectId, delayMs = 4000) {
  setTimeout(() => {
    if (wss && wss.clients && wss.clients.size > 0) {
      try {
        const notification = {
          type: 'project-refreshed',
          projectId: projectId,
          timestamp: Date.now(),
          message: 'Project files updated. Please reload the page.',
          forceReload: true,
          waitBeforeReload: 3000
        };
        
        const notificationStr = JSON.stringify(notification);
        console.log('[AutoBuildFix] 📤 Notifying WebSocket clients about ZIP update...');
        
        let sentCount = 0;
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            try {
              client.send(notificationStr);
              sentCount++;
            } catch (sendErr) {
              console.warn('[AutoBuildFix] ⚠️ Error sending WebSocket notification:', sendErr.message);
            }
          }
        });
        
        if (sentCount > 0) {
          console.log(`[AutoBuildFix] ✅ WebSocket notification sent to ${sentCount} clients`);
        } else {
          console.log('[AutoBuildFix] ⚠️ No WebSocket clients connected');
        }
      } catch (wsErr) {
        console.warn('[AutoBuildFix] ⚠️ Error in WebSocket notification:', wsErr.message);
      }
    } else {
      console.log('[AutoBuildFix] ⚠️ No WebSocket server or clients available');
    }
  }, delayMs);
}

// Function to update project ZIP in PocketBase
async function updateProjectZipInPocketBase(projectId, projectPath, appliedCorrections = [], userToken = null) {
  if (!projectId || projectId === 'local-project') {
    console.log('[PreviewServer][AutoBuildFix] Local project detected; no ZIP update will be sent to PocketBase.');
    return false;
  }
  try {
    // Log function call with resolved paths
    console.log('[PreviewServer][AutoBuildFix] ========================================');
    console.log('[PreviewServer][AutoBuildFix] updateProjectZipInPocketBase called');
    console.log('[PreviewServer][AutoBuildFix] Project ID:', projectId);
    console.log('[PreviewServer][AutoBuildFix] Project path (raw):', projectPath);
    console.log('[PreviewServer][AutoBuildFix] Project path (resolved):', path.resolve(projectPath));
    console.log('[PreviewServer][AutoBuildFix] Project path exists:', fs.existsSync(projectPath));

    console.log('[PreviewServer][AutoBuildFix] Applied corrections:', appliedCorrections.length);
    if (userToken) {
      console.log('[PreviewServer][AutoBuildFix] User token provided, length:', userToken.length);
    } else {
      console.log('[PreviewServer][AutoBuildFix] No user token provided, will use admin credentials');
    }
    console.log('[PreviewServer][AutoBuildFix] ========================================');
    
    // Check if archiver is available
    let archiver;
    try {
      archiver = require('archiver');
    } catch (e) {
      console.warn('[PreviewServer][AutoBuildFix] archiver not available, skipping PocketBase update');
      return false;
    }
    
    // Try to use Next.js save-archive endpoint first (preferred method)
    // Detect production environment
    const isProduction = process.env.NODE_ENV === 'production' || 
                         process.env.PRODUCTION === 'true' ||
                         (process.env.NEXT_PUBLIC_API_URL && process.env.NEXT_PUBLIC_API_URL.includes('zeus-ia.com'));
    
    // Priority: Use explicit tunnel URL if configured, then production URL, then localhost
    // This allows the preview server to communicate with Next.js through Cloudflare Tunnel
    const tunnelUrl = process.env.NEXT_PUBLIC_PREVIEW_SERVER_URL || process.env.PREVIEW_SERVER_TUNNEL_URL;
    const explicitNextJsUrl = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_JS_URL;
    const defaultNextJsUrl = isProduction ? 'https://zeus-ia.com' : 'http://localhost:8741';
    
    // If tunnel URL is configured and we're not in localhost, use it (tunnel typically points to Next.js)
    // Otherwise, use explicit Next.js URL or default
    let nextJsUrl;
    if (tunnelUrl && !tunnelUrl.includes('localhost') && !tunnelUrl.includes('127.0.0.1')) {
      // Tunnel URL detected - use it for Next.js communication
      nextJsUrl = tunnelUrl;
      console.log('[PreviewServer][AutoBuildFix] 🌐 Using Cloudflare Tunnel URL for Next.js:', nextJsUrl);
    } else if (explicitNextJsUrl) {
      nextJsUrl = explicitNextJsUrl;
    } else {
      nextJsUrl = defaultNextJsUrl;
    }
    const useNextJsEndpoint = process.env.USE_NEXTJS_SAVE_ARCHIVE !== 'false'; // Default to true
    
    const pocketBaseUrl = process.env.POCKETBASE_URL || process.env.NEXT_PUBLIC_POCKETBASE_URL || 'https://zeus-basedatos.fly.dev';
    // ✅ Prefer PB_SUPERUSER_TOKEN (superuser token, no authentication needed)
    const superuserToken = process.env.PB_SUPERUSER_TOKEN || process.env.POCKETBASE_ADMIN_TOKEN || process.env.PB_ADMIN_TOKEN || process.env.ADMIN_TOKEN;
    // Use the same environment variable names as zip-and-upload/route.ts
    const adminEmail = process.env.POCKETBASE_ADMIN_EMAIL || process.env.POCKETBASE_EMAIL || process.env.NEXT_PUBLIC_POCKETBASE_EMAIL;
    const adminPass = process.env.POCKETBASE_ADMIN_PASSWORD || process.env.POCKETBASE_PASSWORD || process.env.NEXT_PUBLIC_POCKETBASE_PASSWORD;
    
    console.log('[PreviewServer][AutoBuildFix] Configuration:');
    console.log(`[PreviewServer][AutoBuildFix] - Next.js URL: ${nextJsUrl}`);
    console.log(`[PreviewServer][AutoBuildFix] - Use Next.js endpoint: ${useNextJsEndpoint}`);
    console.log(`[PreviewServer][AutoBuildFix] - PocketBase URL: ${pocketBaseUrl}`);
    console.log(`[PreviewServer][AutoBuildFix] - Superuser Token: ${superuserToken ? '***SET***' : 'NOT SET'}`);
    console.log(`[PreviewServer][AutoBuildFix] - Email: ${adminEmail ? adminEmail.substring(0, 3) + '***' : 'NOT SET'}`);
    console.log(`[PreviewServer][AutoBuildFix] - Password: ${adminPass ? '***SET***' : 'NOT SET'}`);
    
    // If using Next.js endpoint, we don't need PocketBase credentials here
    if (!useNextJsEndpoint && (!adminEmail || !adminPass)) {
      console.error('[PreviewServer][AutoBuildFix] ❌ PocketBase credentials not configured');
      console.error('[PreviewServer][AutoBuildFix] Please set POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD environment variables');
      console.error('[PreviewServer][AutoBuildFix] (Or use POCKETBASE_EMAIL and POCKETBASE_PASSWORD as fallback)');
      console.error('[PreviewServer][AutoBuildFix] Or set USE_NEXTJS_SAVE_ARCHIVE=true to use Next.js endpoint');
      return false;
    }
    
    // Create ZIP file from project directory
    // Exclude unnecessary files and directories
    const tempZipPath = path.join(os.tmpdir(), `project_${projectId}_corrected_${Date.now()}.zip`);
    const output = fs.createWriteStream(tempZipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    // Files/directories to exclude from ZIP
    const excludePatterns = [
      'node_modules',
      '.next',
      '.git',
      'dist',
      'build',
      'coverage',
      '.cache',
      '.turbo',
      '*.log',
      '.DS_Store',
      'Thumbs.db'
    ];
    
    console.log('[PreviewServer][AutoBuildFix] Creating ZIP from project directory:', projectPath);
    console.log('[PreviewServer][AutoBuildFix] Excluding:', excludePatterns.join(', '));
    
    // Validate that projectPath exists and has content
    if (!fs.existsSync(projectPath)) {
      console.error(`[PreviewServer][AutoBuildFix] ❌ Project path does not exist: ${projectPath}`);
      return false;
    }
    
    const projectStat = fs.statSync(projectPath);
    if (!projectStat.isDirectory()) {
      console.error(`[PreviewServer][AutoBuildFix] ❌ Project path is not a directory: ${projectPath}`);
      return false;
    }
    
    // Check if directory has any files
    try {
      const filesInDir = fs.readdirSync(projectPath);
      console.log(`[PreviewServer][AutoBuildFix] Found ${filesInDir.length} items in project directory`);
      if (filesInDir.length === 0) {
        console.error(`[PreviewServer][AutoBuildFix] ❌ Project directory is empty: ${projectPath}`);
        return false;
      }
      // List some files for debugging
      const sampleFiles = filesInDir.slice(0, 10);
      console.log(`[PreviewServer][AutoBuildFix] Sample files in directory:`, sampleFiles.join(', '));
    } catch (readError) {
      console.error(`[PreviewServer][AutoBuildFix] ❌ Error reading project directory: ${readError.message}`);
      return false;
    }
    
    return new Promise((resolve, reject) => {
      output.on('close', async () => {
        try {
          const zipSize = archive.pointer();
          console.log('[PreviewServer][AutoBuildFix] ZIP created successfully, size:', zipSize, 'bytes');
          
          if (zipSize === 0) {
            console.error('[PreviewServer][AutoBuildFix] ZIP file is empty!');
            await fs.remove(tempZipPath);
            resolve(false);
            return;
          }
          
          // Try to use Next.js save-archive endpoint first (preferred method)
          // BUT: Only if it's a local endpoint. Remote endpoints can't access local file paths
          const isLocalNextJsEndpoint = nextJsUrl.includes('localhost') || nextJsUrl.includes('127.0.0.1') || nextJsUrl.includes('::1');
          
          if (useNextJsEndpoint && isLocalNextJsEndpoint) {
            try {
              console.log('[PreviewServer][AutoBuildFix] Attempting to use Next.js save-archive endpoint (local)...');
              console.log(`[PreviewServer][AutoBuildFix] Next.js URL: ${nextJsUrl}`);
              console.log(`[PreviewServer][AutoBuildFix] Calling: ${nextJsUrl}/api/project/save-archive`);
              console.log(`[PreviewServer][AutoBuildFix] Project path: ${projectPath}`);
              console.log(`[PreviewServer][AutoBuildFix] Project ID: ${projectId}`);
              
              // Send projectRoot and projectId to Next.js endpoint (only works for local endpoints)
              const saveArchiveResponse = await fetch(`${nextJsUrl}/api/project/save-archive`, {
                method: 'POST',
                headers: { 
                  'Content-Type': 'application/json',
                  'User-Agent': 'ZEUS-Preview-Server/1.0'
                },
                body: JSON.stringify({
                  projectRoot: projectPath,
                  projectId: projectId,
                  isInitialSave: false
                })
              });
              
              console.log(`[PreviewServer][AutoBuildFix] Response status: ${saveArchiveResponse.status} ${saveArchiveResponse.statusText}`);
              
              if (saveArchiveResponse.ok) {
                const result = await saveArchiveResponse.json().catch(() => ({}));
                console.log('[PreviewServer][AutoBuildFix] ✅ ZIP updated successfully via Next.js endpoint (local)');
                console.log('[PreviewServer][AutoBuildFix] Response:', JSON.stringify(result).substring(0, 200));
                await fs.remove(tempZipPath);
                // Notify WebSocket clients to refresh preview
                if (projectId) {
                  notifyWebSocketClients(projectId, 4000);
                }
                resolve(true);
                return;
              } else {
                const errorText = await saveArchiveResponse.text().catch(() => '');
                console.warn('[PreviewServer][AutoBuildFix] ⚠️ Next.js endpoint failed, falling back to direct PocketBase update');
                console.warn(`[PreviewServer][AutoBuildFix] Status: ${saveArchiveResponse.status} ${saveArchiveResponse.statusText}`);
                console.warn(`[PreviewServer][AutoBuildFix] Error: ${errorText.substring(0, 500)}`);
                // Continue to direct PocketBase update
              }
            } catch (nextJsError) {
              console.warn('[PreviewServer][AutoBuildFix] ⚠️ Next.js endpoint error, falling back to direct PocketBase update');
              console.warn('[PreviewServer][AutoBuildFix] Error:', nextJsError?.message || nextJsError);
              console.warn('[PreviewServer][AutoBuildFix] Stack:', nextJsError?.stack?.substring(0, 500));
              // Continue to direct PocketBase update
            }
          } else if (useNextJsEndpoint && !isLocalNextJsEndpoint) {
            console.log('[PreviewServer][AutoBuildFix] Next.js endpoint is remote, skipping (remote servers cannot access local paths)');
            console.log('[PreviewServer][AutoBuildFix] Will use direct PocketBase update instead');
          }
          
          // Fallback to direct PocketBase update
          // Read ZIP file
          const zipBuffer = await fs.readFile(tempZipPath);
          console.log('[PreviewServer][AutoBuildFix] ZIP file read into buffer, size:', zipBuffer.length, 'bytes');
          
          // Authenticate with PocketBase using the PocketBase SDK (same as save-archive/route.ts)
          console.log('[PreviewServer][AutoBuildFix] Authenticating with PocketBase directly...');
          
          // ✅ Priority order: userToken > superuserToken > admin credentials
          // Prefiere token de admin/superuser para asegurar permisos de actualización
  let token = superuserToken || userToken;
          if (userToken) {
            console.log('[PreviewServer][AutoBuildFix] ✅ Using provided user token, length:', userToken.length);
          } else if (superuserToken) {
            console.log('[PreviewServer][AutoBuildFix] ✅ Using PB_SUPERUSER_TOKEN (superuser token, no authentication needed)');
            token = superuserToken;
          } else {
            console.log('[PreviewServer][AutoBuildFix] No token provided, will authenticate with admin credentials');
            token = null; // Will be set during authentication
          }
          
          // Ensure URL doesn't have trailing slash
          const baseUrl = pocketBaseUrl.replace(/\/$/, '');
          console.log(`[PreviewServer][AutoBuildFix] Base URL: ${baseUrl}`);

          // ✅ IMPORTANTE: si ya tenemos token (user/superuser), NO intentar cargar PocketBase SDK.
          // En algunos entornos empaquetados esto provoca: "Invalid host defined options".
          if (!token) {
            // Try to load PocketBase SDK using dynamic import (it's an ES module)
            if (!PocketBase) {
              try {
                // Use dynamic import for ES modules
                const pbModule = await import('pocketbase');
                PocketBase = pbModule.default || pbModule;
                console.log('[PreviewServer][AutoBuildFix] PocketBase SDK loaded successfully using dynamic import');
              } catch (e) {
                console.warn('[PreviewServer][AutoBuildFix] ⚠️ PocketBase SDK not available (will use fetch-based auth):', e.message);
                if (e.message && !e.message.includes('Cannot find module')) {
                  console.warn('[PreviewServer][AutoBuildFix] Error details:', e.stack?.substring(0, 300));
                }
                PocketBase = null;
              }
            }
          }
          
          let pb = null;
          
          // ✅ If we have a token (userToken or superuserToken), use it directly without authentication
          if (token) {
            console.log('[PreviewServer][AutoBuildFix] ✅ Using provided token (user or superuser), skipping authentication');
            // Token is already set, proceed to upload
          } else if (PocketBase) {
            // Use PocketBase SDK (same as save-archive/route.ts)
            try {
              pb = new PocketBase(baseUrl);
              console.log('[PreviewServer][AutoBuildFix] Attempting PocketBase authentication with SDK...');
              
              // Try user auth first (seems more reliable), then admin as fallback
              try {
                await pb.collection('users').authWithPassword(adminEmail, adminPass);
                token = pb.authStore.token;
                console.log('[PreviewServer][AutoBuildFix] ✅ PocketBase user authentication successful (SDK)');
                console.log('[PreviewServer][AutoBuildFix] Token received, length:', token ? token.length : 0);
              } catch (userErr) {
                // If user auth fails, try admin auth as fallback
                console.log('[PreviewServer][AutoBuildFix] User auth failed, trying admin auth as fallback...');
                console.log('[PreviewServer][AutoBuildFix] User error:', userErr?.message || userErr);
                try {
                  await pb.admins.authWithPassword(adminEmail, adminPass);
                  token = pb.authStore.token;
                  console.log('[PreviewServer][AutoBuildFix] ✅ Admin authentication successful (fallback, SDK)');
                  console.log('[PreviewServer][AutoBuildFix] Token received, length:', token ? token.length : 0);
                } catch (adminErr) {
                  console.error('[PreviewServer][AutoBuildFix] ❌ PocketBase authentication failed (both user and admin)');
                  console.error('[PreviewServer][AutoBuildFix] User error:', userErr?.message || userErr);
                  console.error('[PreviewServer][AutoBuildFix] Admin error:', adminErr?.message || adminErr);
                  console.error('[PreviewServer][AutoBuildFix] Verify PocketBase credentials and URL are correct');
                  await fs.remove(tempZipPath);
                  resolve(false);
                  return;
                }
              }
            } catch (pbError) {
              console.error('[PreviewServer][AutoBuildFix] ❌ Error initializing PocketBase SDK:', pbError?.message || pbError);
              console.error('[PreviewServer][AutoBuildFix] Stack:', pbError.stack?.substring(0, 300));
              await fs.remove(tempZipPath);
              resolve(false);
              return;
            }
          } else {
            // Fallback to fetch-based authentication (original approach)
            // Try user auth first (seems more reliable), then admin as fallback
            console.log('[PreviewServer][AutoBuildFix] Attempting PocketBase authentication with fetch...');
            
            try {
              // Try user authentication first
              const userAuthUrl = `${baseUrl}/api/collections/users/auth-with-password`;
              console.log(`[PreviewServer][AutoBuildFix] Trying user auth at: ${userAuthUrl}`);
              const userAuthResponse = await fetch(userAuthUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identity: adminEmail, password: adminPass })
              });
              
              console.log(`[PreviewServer][AutoBuildFix] User auth response status: ${userAuthResponse.status} ${userAuthResponse.statusText}`);
              
              if (userAuthResponse.ok) {
                const userAuthData = await userAuthResponse.json();
                token = userAuthData.token || userAuthData.accessToken;
                console.log('[PreviewServer][AutoBuildFix] ✅ User authentication successful (fetch)');
                console.log('[PreviewServer][AutoBuildFix] Token received, length:', token ? token.length : 0);
              } else {
                // If user auth fails, try admin auth as fallback
                console.log('[PreviewServer][AutoBuildFix] User auth failed, trying admin auth as fallback...');
                const adminAuthUrl = `${baseUrl}/api/admins/auth-with-password`;
                console.log(`[PreviewServer][AutoBuildFix] Trying admin auth at: ${adminAuthUrl}`);
                const adminAuthResponse = await fetch(adminAuthUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ identity: adminEmail, password: adminPass })
                });
                
                console.log(`[PreviewServer][AutoBuildFix] Admin auth response status: ${adminAuthResponse.status} ${adminAuthResponse.statusText}`);
                
                if (adminAuthResponse.ok) {
                  const adminAuthData = await adminAuthResponse.json();
                  token = adminAuthData.token || adminAuthData.accessToken;
                  console.log('[PreviewServer][AutoBuildFix] ✅ Admin authentication successful (fallback, fetch)');
                  console.log('[PreviewServer][AutoBuildFix] Token received, length:', token ? token.length : 0);
                } else {
                  const userErrorText = await userAuthResponse.text().catch(() => '');
                  const adminErrorText = await adminAuthResponse.text().catch(() => '');
                  console.error('[PreviewServer][AutoBuildFix] ❌ PocketBase authentication failed (both user and admin)');
                  console.error(`[PreviewServer][AutoBuildFix] User status: ${userAuthResponse.status} ${userAuthResponse.statusText}`);
                  console.error(`[PreviewServer][AutoBuildFix] User error: ${userErrorText.substring(0, 300)}`);
                  console.error(`[PreviewServer][AutoBuildFix] Admin status: ${adminAuthResponse.status} ${adminAuthResponse.statusText}`);
                  console.error(`[PreviewServer][AutoBuildFix] Admin error: ${adminErrorText.substring(0, 300)}`);
                  console.error('[PreviewServer][AutoBuildFix] Verify PocketBase credentials and URL are correct');
                  await fs.remove(tempZipPath);
                  resolve(false);
                  return;
                }
              }
            } catch (fetchError) {
              console.error('[PreviewServer][AutoBuildFix] ❌ Fetch error during PocketBase authentication:', fetchError.message);
              console.error('[PreviewServer][AutoBuildFix] Stack:', fetchError.stack?.substring(0, 300));
              await fs.remove(tempZipPath);
              resolve(false);
              return;
            }
          }
          
          if (!token) {
            console.error('[PreviewServer][AutoBuildFix] ❌ No token received from PocketBase');
            await fs.remove(tempZipPath);
            resolve(false);
            return;
          }
          
          // Upload ZIP to PocketBase using multipart/form-data
          // Use the same approach as zip-and-upload/route.ts
          // Try to use native FormData (Node 18+) first, fallback to form-data package
          let FormDataClass;
          let useNativeFormData = false;
          
          // Check if native FormData is available (Node 18+)
          if (typeof globalThis.FormData !== 'undefined' && typeof globalThis.Blob !== 'undefined') {
            FormDataClass = globalThis.FormData;
            useNativeFormData = true;
            console.log('[PreviewServer][AutoBuildFix] Using native FormData and Blob (Node 18+)');
          } else {
            // Fallback to form-data package
            try {
              FormDataClass = require('form-data');
              console.log('[PreviewServer][AutoBuildFix] Using form-data package');
            } catch (e) {
              console.error('[PreviewServer][AutoBuildFix] ❌ FormData not available. Install form-data package or use Node 18+');
              await fs.remove(tempZipPath);
              resolve(false);
              return;
            }
          }
          
          const formData = new FormDataClass();
          
          if (useNativeFormData) {
            // Use Blob with native FormData (same as zip-and-upload/route.ts)
            const blob = new globalThis.Blob([zipBuffer], { type: 'application/zip' });
            formData.append('project_archive', blob, `project_${projectId}_corrected.zip`);
          } else {
            // Use form-data package (Node < 18)
            formData.append('project_archive', zipBuffer, {
              filename: `project_${projectId}_corrected.zip`,
              contentType: 'application/zip'
            });
          }
          
          const headers = {
            'Authorization': `Bearer ${token}`
          };
          
          // If form-data package is used, get headers with boundary
          if (formData.getHeaders) {
            Object.assign(headers, formData.getHeaders());
          }
          
          // Upload ZIP to PocketBase
          console.log('[PreviewServer][AutoBuildFix] Uploading ZIP to PocketBase...');
          console.log(`[PreviewServer][AutoBuildFix] ZIP size: ${zipBuffer.length} bytes`);
          
          // ✅ If we have a user token, prefer fetch-based upload (more reliable with user tokens)
          // ✅ Only use SDK if we authenticated with SDK and have a valid authStore
          if (pb && pb.authStore.isValid && !userToken) {
            // Use PocketBase SDK (same as save-archive/route.ts)
            try {
              const archiveBlob = new Blob([zipBuffer], { type: 'application/zip' });
              const pbFormData = new FormData();
              pbFormData.append('project_archive', archiveBlob, `project_${projectId}_corrected.zip`);
              
              console.log('[PreviewServer][AutoBuildFix] Updating project record with PocketBase SDK...');
              const updateData = await pb.collection('projects').update(projectId, pbFormData);
              
              console.log('[PreviewServer][AutoBuildFix] ✅ ZIP updated successfully in PocketBase');
              console.log('[PreviewServer][AutoBuildFix] Updated record ID:', updateData.id || projectId);
              console.log('[PreviewServer][AutoBuildFix] ZIP file field updated in PocketBase');
              
              // Clean up temp file
              await fs.remove(tempZipPath);
              // Notify WebSocket clients to refresh preview
              if (projectId) {
                notifyWebSocketClients(projectId, 4000);
              }
              resolve(true);
            } catch (updateError) {
              console.error('[PreviewServer][AutoBuildFix] ❌ Failed to update ZIP in PocketBase using SDK');
              console.error('[PreviewServer][AutoBuildFix] Error:', updateError?.message || updateError);
              console.error('[PreviewServer][AutoBuildFix] Error details:', JSON.stringify(updateError, null, 2).substring(0, 1000));
              
              // Clean up temp file
              await fs.remove(tempZipPath);
              resolve(false);
            }
          } else {
            // Fallback to fetch-based upload (original approach)
            // ✅ Resolve the real PocketBase record id to avoid 404 when projectId is not a PB record id
            const resolvedRecordId = await resolvePocketBaseProjectRecordId(baseUrl, token, projectId, projectPath);
            const effectiveRecordId = resolvedRecordId || projectId;
            if (resolvedRecordId && resolvedRecordId !== projectId) {
              console.log('[PreviewServer][AutoBuildFix] ✅ Resolved PocketBase record id:', resolvedRecordId, '(input projectId was:', projectId, ')');
            }

            const updateUrl = `${baseUrl}/api/collections/projects/records/${effectiveRecordId}`;
            console.log(`[PreviewServer][AutoBuildFix] Update URL: ${updateUrl}`);
            
            let updateResponse;
            try {
              updateResponse = await fetch(updateUrl, {
                method: 'PATCH',
                headers: headers,
                body: formData
              });
            } catch (fetchError) {
              console.error('[PreviewServer][AutoBuildFix] ❌ Fetch error during ZIP upload:', fetchError.message);
              await fs.remove(tempZipPath);
              resolve(false);
              return;
            }
            
            console.log(`[PreviewServer][AutoBuildFix] Update response status: ${updateResponse.status} ${updateResponse.statusText}`);
            
            // Clean up temp file
            await fs.remove(tempZipPath);
            
            if (updateResponse.ok) {
              let updateData;
              try {
                updateData = await updateResponse.json().catch(() => ({}));
                console.log('[PreviewServer][AutoBuildFix] ✅ ZIP updated successfully in PocketBase');
                console.log('[PreviewServer][AutoBuildFix] Updated record ID:', updateData.id || projectId);
                console.log('[PreviewServer][AutoBuildFix] ZIP file field updated in PocketBase');
                
                // ✅ CRÍTICO: Invalidar caché y sincronizar después de actualizar el ZIP
                // Esto asegura que cuando se vuelva a desplegar, se use el ZIP actualizado
                if (projectId) {
                  try {
                    console.log('[PreviewServer][AutoBuildFix] Invalidando caché y sincronizando después de actualizar ZIP...');
                    await callCompleteSyncWithFallback({
                      nextJsUrl,
                      userToken,
                      projectId,
                      updatedFiles: appliedCorrections.map(c => c.file).filter(Boolean)
                    });
                  } catch (syncError) {
                    console.warn('[PreviewServer][AutoBuildFix] ⚠️ Excepción al sincronizar después de actualizar ZIP:', syncError?.message || syncError);
                    // No fallar la operación si la sincronización falla, solo loguear
                  }
                }
                
                // Notify WebSocket clients to refresh preview
                if (projectId) {
                  notifyWebSocketClients(projectId, 4000);
                }
                resolve(true);
              } catch (parseError) {
                console.error('[PreviewServer][AutoBuildFix] ⚠️ ZIP uploaded but failed to parse response:', parseError.message);
                // Still consider it successful if status is OK
                resolve(true);
              }
            } else {
              let errorText = '';
              try {
                errorText = await updateResponse.text();
                console.error('[PreviewServer][AutoBuildFix] ❌ Failed to update ZIP in PocketBase');
                console.error('[PreviewServer][AutoBuildFix] Response status:', updateResponse.status, updateResponse.statusText);
                console.error('[PreviewServer][AutoBuildFix] Error details:', errorText.substring(0, 1000));
              } catch (e) {
                console.error('[PreviewServer][AutoBuildFix] ❌ Could not read error response:', e.message);
              }
              resolve(false);
            }
          }
        } catch (error) {
          console.error('[PreviewServer][AutoBuildFix] Error updating PocketBase:', error);
          fs.remove(tempZipPath).catch(() => {});
          resolve(false);
        }
      });
      
      archive.on('error', (err) => {
        console.error('[PreviewServer][AutoBuildFix] ZIP creation error:', err);
        fs.remove(tempZipPath).catch(() => {});
        resolve(false);
      });
      
      archive.pipe(output);
      
      // Track which files are being added to verify corrected files are included
      const addedFiles = [];
      const correctedFilesToCheck = appliedCorrections.map(c => c.file).filter(Boolean);
      
      // Add files to archive, excluding unnecessary directories
      const addDirectory = (dirPath, basePath = '') => {
        try {
          const items = fs.readdirSync(dirPath);
          for (const item of items) {
            const fullPath = path.join(dirPath, item);
            const relativePath = path.join(basePath, item).replace(/\\/g, '/');
            
            // Check if item should be excluded
            const shouldExclude = excludePatterns.some(pattern => {
              if (pattern.includes('*')) {
                // Wildcard pattern
                const regex = new RegExp(pattern.replace(/\*/g, '.*'));
                return regex.test(item) || regex.test(relativePath);
              }
              return item === pattern || relativePath.includes(pattern);
            });
            
            if (shouldExclude) {
              console.log(`[PreviewServer][AutoBuildFix] Excluding: ${relativePath}`);
              continue;
            }
            
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
              addDirectory(fullPath, relativePath);
            } else {
              archive.file(fullPath, { name: relativePath });
              addedFiles.push(relativePath);
              
              // Log if this is a corrected file
              if (correctedFilesToCheck.some(cf => relativePath.replace(/\\/g, '/').includes(cf.replace(/\\/g, '/')))) {
                console.log(`[PreviewServer][AutoBuildFix] ✓ Including corrected file: ${relativePath}`);
              }
            }
          }
        } catch (err) {
          console.warn(`[PreviewServer][AutoBuildFix] Error reading directory ${dirPath}:`, err.message);
        }
      };
      
      // Start adding files
      console.log('[PreviewServer][AutoBuildFix] Starting to add files to ZIP...');
      console.log('[PreviewServer][AutoBuildFix] Source directory (absolute):', path.resolve(projectPath));
      if (correctedFilesToCheck.length > 0) {
        console.log(`[PreviewServer][AutoBuildFix] Looking for ${correctedFilesToCheck.length} corrected files:`, correctedFilesToCheck.join(', '));
      }
      
      // Verify projectPath again before adding files
      if (!fs.existsSync(projectPath)) {
        console.error(`[PreviewServer][AutoBuildFix] ❌ Project path does not exist when trying to add files: ${projectPath}`);
        archive.abort();
        reject(new Error(`Project directory does not exist: ${projectPath}`));
        return;
      }
      
      addDirectory(projectPath);
      console.log(`[PreviewServer][AutoBuildFix] Finished adding ${addedFiles.length} files to ZIP, finalizing...`);
      
      if (addedFiles.length === 0) {
        console.error(`[PreviewServer][AutoBuildFix] ❌ No files were added to ZIP! This indicates a problem with the project directory.`);
        console.error(`[PreviewServer][AutoBuildFix] Project path: ${projectPath}`);
        console.error(`[PreviewServer][AutoBuildFix] Resolved path: ${path.resolve(projectPath)}`);
        archive.abort();
        reject(new Error(`No files found in project directory: ${projectPath}`));
        return;
      }
      
      // Verify corrected files are included
      if (correctedFilesToCheck.length > 0) {
        const foundCorrectedFiles = correctedFilesToCheck.filter(cf => {
          const normalized = cf.replace(/\\/g, '/');
          return addedFiles.some(af => af.replace(/\\/g, '/').includes(normalized) || normalized.includes(af.replace(/\\/g, '/')));
        });
        console.log(`[PreviewServer][AutoBuildFix] Verified ${foundCorrectedFiles.length}/${correctedFilesToCheck.length} corrected files in ZIP`);
        if (foundCorrectedFiles.length < correctedFilesToCheck.length) {
          const missing = correctedFilesToCheck.filter(cf => !foundCorrectedFiles.includes(cf));
          console.warn(`[PreviewServer][AutoBuildFix] ⚠️ Missing corrected files in ZIP:`, missing.join(', '));
        }
      }
      
      archive.finalize();
    });
  } catch (error) {
    console.error('[PreviewServer][AutoBuildFix] Error in updateProjectZipInPocketBase:', error);
    return false;
  }
}

app.options('/api/auto-build-fix', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-preview-server, User-Agent');
  res.status(200).end();
});

app.post('/api/sync-files', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const body = req.body || {};
    const { projectId, files, clear } = body;
    if (!projectId) {
      return res.status(400).json({ success: false, error: 'projectId is required' });
    }
    if (!Array.isArray(files)) {
      return res.status(400).json({ success: false, error: 'files must be an array' });
    }

    projectPath = currentProjectBasePath;
    await fs.ensureDir(projectPath);
    if (clear) {
      await fs.emptyDir(projectPath);
    }

    for (const file of files) {
      if (!file || typeof file.path !== 'string') continue;
      if (file.path.endsWith('/')) {
        continue;
      }
      if (typeof file.content !== 'string') {
        continue;
      }
      if (file.content.length === 0 && !file.path.includes('.')) {
        continue;
      }
      const safePath = file.path.replace(/^[/\\]+/, '');
      const targetPath = path.join(projectPath, safePath);
      if (await fs.pathExists(targetPath)) {
        const stat = await fs.stat(targetPath).catch(() => null);
        if (stat?.isDirectory()) {
          continue;
        }
      }
      await fs.ensureDir(path.dirname(targetPath));
      await fs.writeFile(targetPath, file.content, 'utf8');
    }

    return res.json({ success: true, message: `Synced ${files.length} files`, projectPath });
  } catch (error) {
    console.error('[PreviewServer][SyncFiles] Error:', error?.message || error);
    return res.status(500).json({ success: false, error: error?.message || 'sync failed' });
  }
});

app.options('/api/update-zip', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-preview-server, User-Agent');
  res.status(200).end();
});

// Manual ZIP update endpoint
app.post('/api/update-zip', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  try {
    const body = req.body || {};
    const { projectId, userToken } = body;
    
    // Get user token from Authorization header if not in body
    const authHeader = req.headers.authorization;
    const tokenFromHeader = authHeader && authHeader.startsWith('Bearer ') 
      ? authHeader.substring(7) 
      : null;
    const finalUserToken = userToken || tokenFromHeader;
    
    if (finalUserToken) {
      console.log('[PreviewServer][UpdateZip] User token provided, length:', finalUserToken.length);
    } else {
      console.log('[PreviewServer][UpdateZip] No user token provided, will use admin credentials');
    }

    console.log('[PreviewServer][UpdateZip] Request received for project:', projectId);
    console.log('[PreviewServer][UpdateZip] projectsDir:', projectsDir);
    console.log('[PreviewServer][UpdateZip] baseDir:', baseDir);

    // Check if we have a current project
    const projectPath = currentProjectBasePath;
    const resolvedProjectPath = path.resolve(projectPath);
    
    console.log('[PreviewServer][UpdateZip] Project path (raw):', projectPath);
    console.log('[PreviewServer][UpdateZip] Project path (resolved):', resolvedProjectPath);
    console.log('[PreviewServer][UpdateZip] Project path exists:', fs.existsSync(projectPath));
    
    if (!fs.existsSync(projectPath)) {
      console.error('[PreviewServer][UpdateZip] ❌ Project path does not exist!');
      return res.status(400).json({
        success: false,
        error: `No hay proyecto actual disponible. La ruta ${resolvedProjectPath} no existe. Sube un proyecto primero.`
      });
    }
    
    // Verify it's a directory with files
    try {
      const projectStat = fs.statSync(projectPath);
      if (!projectStat.isDirectory()) {
        console.error('[PreviewServer][UpdateZip] ❌ Project path is not a directory!');
        return res.status(400).json({
          success: false,
          error: `La ruta del proyecto no es un directorio: ${resolvedProjectPath}`
        });
      }
      
      const filesInDir = fs.readdirSync(projectPath);
      console.log(`[PreviewServer][UpdateZip] Found ${filesInDir.length} items in project directory`);
      if (filesInDir.length === 0) {
        console.error('[PreviewServer][UpdateZip] ❌ Project directory is empty!');
        return res.status(400).json({
          success: false,
          error: `El directorio del proyecto está vacío: ${resolvedProjectPath}`
        });
      }
      console.log('[PreviewServer][UpdateZip] Sample files:', filesInDir.slice(0, 10).join(', '));
    } catch (statError) {
      console.error('[PreviewServer][UpdateZip] ❌ Error checking project directory:', statError.message);
      return res.status(400).json({
        success: false,
        error: `Error al verificar el directorio del proyecto: ${statError.message}`
      });
    }

    if (!projectId) {
      return res.status(400).json({
        success: false,
        error: 'projectId es requerido'
      });
    }

    console.log('[PreviewServer][UpdateZip] ⚠️ CRITICAL: Attempting to update ZIP in PocketBase...');
    console.log('[PreviewServer][UpdateZip] Using project path:', resolvedProjectPath);
    
    // ✅ Wait a bit to ensure all file writes are flushed to disk
    console.log('[PreviewServer][UpdateZip] Waiting 500ms to ensure all file writes are complete...');
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // ✅ Update ZIP in PocketBase
    const updated = await updateProjectZipInPocketBase(projectId, projectPath, [], finalUserToken);
    
    if (updated) {
      console.log('[PreviewServer][UpdateZip] ✅ ZIP updated successfully in PocketBase');
      
      // ✅ CRÍTICO: Wait a bit more to ensure ZIP update is fully committed
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // ✅ CRÍTICO: Invalidate cache and sync after updating ZIP
      // This ensures that when the project is reloaded, it uses the updated ZIP from PocketBase
      try {
        console.log('[PreviewServer][UpdateZip] Invalidating cache and syncing after ZIP update...');
        
        // ✅ Detect Next.js URL (same logic as in updateProjectZipInPocketBase, but with validation)
        const isProduction = process.env.NODE_ENV === 'production' || 
                             process.env.PRODUCTION === 'true' ||
                             (process.env.NEXT_PUBLIC_API_URL && process.env.NEXT_PUBLIC_API_URL.includes('zeus-ia.com'));
        const tunnelUrl = process.env.NEXT_PUBLIC_PREVIEW_SERVER_URL || process.env.PREVIEW_SERVER_TUNNEL_URL;
        const explicitNextJsUrl = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_JS_URL;
        const defaultNextJsUrl = isProduction ? 'https://zeus-ia.com' : 'http://localhost:8741';
        
        // ✅ Validate tunnel URL - skip if it's an example/placeholder URL
        const isValidTunnelUrl = tunnelUrl && 
                                 !tunnelUrl.includes('localhost') && 
                                 !tunnelUrl.includes('127.0.0.1') &&
                                 !tunnelUrl.includes('tu-tunnel-url') &&
                                 !tunnelUrl.includes('example.com') &&
                                 !tunnelUrl.includes('placeholder') &&
                                 tunnelUrl.startsWith('http');
        
        let nextJsUrl;
        if (isValidTunnelUrl) {
          nextJsUrl = tunnelUrl;
          console.log('[PreviewServer][UpdateZip] 🌐 Using validated tunnel URL for Next.js:', nextJsUrl);
        } else if (explicitNextJsUrl) {
          nextJsUrl = explicitNextJsUrl;
          console.log('[PreviewServer][UpdateZip] Using explicit Next.js URL:', nextJsUrl);
        } else {
          nextJsUrl = defaultNextJsUrl;
          console.log('[PreviewServer][UpdateZip] Using default Next.js URL:', nextJsUrl);
        }
        
        // ✅ Call complete-sync endpoint to invalidate cache and sync (with timeout)
        const syncUrl = `${nextJsUrl}/api/project/complete-sync`;
        console.log('[PreviewServer][UpdateZip] Calling complete-sync endpoint:', syncUrl);
        
        // ✅ Use AbortController for timeout (5 seconds)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        try {
          const syncResponse = await fetch(syncUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(finalUserToken ? { 'Authorization': `Bearer ${finalUserToken}` } : {})
            },
            body: JSON.stringify({
              projectId: projectId,
              updatedFiles: [] // Empty array since we're updating the entire ZIP
            }),
            signal: controller.signal
          });
          
          clearTimeout(timeoutId);
          
          if (syncResponse.ok) {
            const syncResult = await syncResponse.json().catch(() => ({}));
            console.log('[PreviewServer][UpdateZip] ✅ Cache invalidated and project synced after ZIP update');
            console.log('[PreviewServer][UpdateZip] Sync result:', JSON.stringify(syncResult).substring(0, 200));
          } else {
            const syncErrorText = await syncResponse.text().catch(() => '');
            console.warn('[PreviewServer][UpdateZip] ⚠️ Sync endpoint returned error (non-critical):', syncResponse.status, syncErrorText.substring(0, 200));
          }
        } catch (fetchError) {
          clearTimeout(timeoutId);
          if (fetchError.name === 'AbortError') {
            console.warn('[PreviewServer][UpdateZip] ⚠️ Sync request timed out after 5 seconds (non-critical)');
          } else {
            console.warn('[PreviewServer][UpdateZip] ⚠️ Error calling sync endpoint (non-critical):', fetchError?.message || fetchError);
          }
        }
      } catch (syncError) {
        console.warn('[PreviewServer][UpdateZip] ⚠️ Error syncing after ZIP update (non-critical):', syncError?.message || syncError);
        // Don't fail the operation if sync fails, just log it
      }
      
      return res.json({
        success: true,
        message: '✅ ZIP actualizado exitosamente en PocketBase. El proyecto ha sido sincronizado.'
      });
    } else {
      console.error('[PreviewServer][UpdateZip] ❌ FAILED to update ZIP in PocketBase');
      return res.status(500).json({
        success: false,
        error: '⚠️ No se pudo actualizar el ZIP en PocketBase. Revisa los logs del servidor para más detalles.'
      });
    }
  } catch (error) {
    console.error('[PreviewServer][UpdateZip] Error:', error);
    return res.status(500).json({
      success: false,
      error: `Error al actualizar ZIP: ${error.message || error}`
    });
  }
});

app.post('/api/auto-build-fix', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const shouldStream = req.query?.stream === '1' || req.query?.stream === 'true' || req.body?.stream === true;
  const sendSse = (payload) => {
    if (!shouldStream) return;
    try {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch (err) {
      console.warn('[PreviewServer][AutoBuildFix] ⚠️ Error sending SSE payload:', err?.message || err);
    }
  };
  if (shouldStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
  }
  const fail = (status, payload) => {
    if (shouldStream || res.headersSent) {
      sendSse({ type: 'error', message: payload?.error || 'Error interno en Auto Build Fix.' });
      return res.end();
    }
    return res.status(status).json(payload);
  };
  
  // Prevent concurrent executions
  if (autoBuildFixInProgress) {
    console.warn('[PreviewServer][AutoBuildFix] ⚠️ Auto Build Fix already in progress, rejecting new request');
    return fail(429, {
      success: false,
      error: 'Auto Build Fix ya está en ejecución. Espera a que termine antes de intentar de nuevo.',
      code: 'already_in_progress',
      reminder: true
    });
  }
  
  autoBuildFixInProgress = true;
  
  let projectId = null;
  let selectedModel = null;
  let appliedCorrections = [];
  let totalCorrectionsApplied = 0;
  let totalCorrectionsFailed = 0;
  let projectPath = null;
  
  try {
    const body = req.body || {};
    ({ projectId, selectedModel } = body);
    const { userToken: bodyUserToken, files: incomingFiles } = body;
    
    // ✅ Get user token from Authorization header if not in body
    const authHeader = req.headers.authorization;
    const tokenFromHeader = authHeader && authHeader.startsWith('Bearer ') 
      ? authHeader.substring(7) 
      : null;
    const userToken = bodyUserToken || tokenFromHeader;
    
    if (userToken) {
      console.log('[PreviewServer][AutoBuildFix] User token provided, length:', userToken.length);
    } else {
      console.log('[PreviewServer][AutoBuildFix] No user token provided, will use admin credentials');
    }

    console.log('[PreviewServer][AutoBuildFix] Request received for project:', projectId);
    console.log('[PreviewServer][AutoBuildFix] projectsDir:', projectsDir);
    console.log('[PreviewServer][AutoBuildFix] baseDir:', baseDir);

    // Check if we have a current project
    const projectPath = currentProjectBasePath;
    const resolvedProjectPath = path.resolve(projectPath);
    
    console.log('[PreviewServer][AutoBuildFix] Project path (raw):', projectPath);
    console.log('[PreviewServer][AutoBuildFix] Project path (resolved):', resolvedProjectPath);
    console.log('[PreviewServer][AutoBuildFix] Project path exists:', fs.existsSync(projectPath));

    // If files are provided from the explorer, hydrate current-project before build
    if (Array.isArray(incomingFiles) && incomingFiles.length > 0) {
      console.log(`[PreviewServer][AutoBuildFix] Hydrating current-project with ${incomingFiles.length} files from explorer...`);
      try {
        await fs.ensureDir(projectPath);
        const existing = await fs.readdir(projectPath).catch(() => []);
        if (existing.length > 0) {
          await fs.emptyDir(projectPath);
        }
        for (const file of incomingFiles) {
          if (!file || typeof file.path !== 'string') continue;
          const safePath = file.path.replace(/^[/\\]+/, '');
          const targetPath = path.join(projectPath, safePath);
          await fs.ensureDir(path.dirname(targetPath));
          await fs.writeFile(targetPath, typeof file.content === 'string' ? file.content : '', 'utf8');
        }
        console.log('[PreviewServer][AutoBuildFix] current-project hydrated successfully.');
      } catch (writeError) {
        console.error('[PreviewServer][AutoBuildFix] ❌ Failed to hydrate current-project:', writeError?.message || writeError);
        autoBuildFixInProgress = false;
        return fail(400, {
          success: false,
          error: `No se pudieron escribir los archivos del proyecto: ${writeError?.message || writeError}`,
          code: 'hydrate_failed',
          reminder: true
        });
      }
    }
    
    if (!fs.existsSync(projectPath)) {
      console.error('[PreviewServer][AutoBuildFix] ❌ Project path does not exist!');
      autoBuildFixInProgress = false;
      return fail(400, {
        success: false,
        error: `No hay proyecto activo. La ruta ${resolvedProjectPath} no existe. Primero sube y despliega un proyecto.`,
        code: 'no_project',
        reminder: true
      });
    }
    
    // Verify it's a directory with files
    try {
      const projectStat = fs.statSync(projectPath);
      if (!projectStat.isDirectory()) {
        console.error('[PreviewServer][AutoBuildFix] ❌ Project path is not a directory!');
        autoBuildFixInProgress = false;
        return fail(400, {
          success: false,
          error: `La ruta del proyecto no es un directorio: ${resolvedProjectPath}`,
          code: 'invalid_project',
          reminder: true
        });
      }
      
      const filesInDir = fs.readdirSync(projectPath);
      console.log(`[PreviewServer][AutoBuildFix] Found ${filesInDir.length} items in project directory`);
      console.log('[PreviewServer][AutoBuildFix] Sample files:', filesInDir.slice(0, 10).join(', '));
    } catch (statError) {
      console.error('[PreviewServer][AutoBuildFix] ❌ Error checking project directory:', statError.message);
      autoBuildFixInProgress = false;
      return fail(400, {
        success: false,
        error: `Error al verificar el directorio del proyecto: ${statError.message}`,
        code: 'invalid_project',
        reminder: true
      });
    }

    // Check if package.json exists
    const packageJsonPath = path.join(projectPath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      autoBuildFixInProgress = false;
      return fail(400, {
        success: false,
        error: 'El proyecto no tiene package.json. Asegúrate de subir un proyecto válido.',
        code: 'invalid_project',
        reminder: true
      });
    }

    // Check if build script exists
    let packageJson;
    try {
      packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    } catch (e) {
      autoBuildFixInProgress = false;
      return fail(400, {
        success: false,
        error: 'Error al leer package.json: ' + e.message,
        code: 'package_json_error',
        reminder: true
      });
    }

    if (!packageJson.scripts || !packageJson.scripts.build) {
      autoBuildFixInProgress = false;
      return fail(400, {
        success: false,
        error: 'El proyecto no tiene script de build definido en package.json.',
        code: 'no_build_script',
        reminder: true
      });
    }

    const nodeModulesPath = path.join(projectPath, 'node_modules');
    if (!fs.existsSync(nodeModulesPath)) {
      if (shouldStream) {
        sendSse({ type: 'status', message: 'Instalando dependencias (npm install)...' });
      }
      console.log('[PreviewServer][AutoBuildFix] node_modules not found. Running npm install...');
      try {
        if (shouldStream) {
          await runNpmCommandStreaming(projectPath, 'install --ignore-scripts',
            (text) => sendSse({ type: 'stdout', output: text }),
            (text) => sendSse({ type: 'stderr', output: text })
          );
        } else {
          await runNpmCommand(projectPath, 'install --ignore-scripts');
        }
      } catch (installError) {
        autoBuildFixInProgress = false;
        return fail(500, {
          success: false,
          error: `Error ejecutando npm install: ${installError.message || installError}`,
          code: 'install_failed',
          reminder: true
        });
      }
    }

    if (!selectedModel) {
      autoBuildFixInProgress = false;
      return fail(400, {
        success: false,
        error: 'Modelo no proporcionado. Selecciona un modelo de IA antes de ejecutar Auto Build Fix.',
        code: 'no_model',
        reminder: true
      });
    }

    if (shouldStream) {
      sendSse({ type: 'status', message: 'Iniciando Auto Build Fix en servidor de vista previa...' });
      sendSse({ type: 'info', message: `Proyecto: ${projectId}` });
    }

    console.log('[PreviewServer][AutoBuildFix] Executing build locally in:', projectPath);
    console.log('[PreviewServer][AutoBuildFix] Using model:', selectedModel.name || selectedModel.model);

    // Execute build with automatic error fixing
    const maxAttempts = 5;
    let attempt = 0;
    let lastErrors = [];
    let initialErrorCount = 0;
    totalCorrectionsApplied = 0;
    totalCorrectionsFailed = 0;
    appliedCorrections = []; // Store applied corrections for verification

    while (attempt < maxAttempts) {
      attempt++;
      console.log(`[PreviewServer][AutoBuildFix] === Attempt ${attempt}/${maxAttempts} ===`);

      try {
        // Execute build
        console.log('[PreviewServer][AutoBuildFix] Running build...');
        const buildOutput = shouldStream
          ? await runNpmCommandStreaming(projectPath, 'run build',
              (text) => sendSse({ type: 'stdout', output: text }),
              (text) => sendSse({ type: 'stderr', output: text })
            )
          : await runNpmCommand(projectPath, 'run build');
        console.log('[PreviewServer][AutoBuildFix] Build completed successfully.');
        if (shouldStream) {
          sendSse({ type: 'build_success', message: 'Build completado exitosamente.' });
        }

        // Build successful - prepare detailed response
        const correctionsApplied = totalCorrectionsApplied;
        const correctionsFailed = totalCorrectionsFailed;
        
        let message = `✅ Build completado exitosamente en ${attempt} ${attempt === 1 ? 'intento' : 'intentos'}.`;
        if (initialErrorCount > 0) {
          message += `\n\n📊 Estadísticas:\n• Errores encontrados inicialmente: ${initialErrorCount}\n• Correcciones aplicadas: ${correctionsApplied}\n• Correcciones fallidas: ${correctionsFailed}`;
          if (correctionsApplied > 0) {
            message += `\n• Errores corregidos: ${correctionsApplied}`;
          }
        }
        
        // Try to update ZIP in PocketBase if projectId is provided and corrections were applied
        let pocketBaseUpdated = false;
        if (projectId && correctionsApplied > 0) {
          try {
            console.log('[PreviewServer][AutoBuildFix] Attempting to update ZIP in PocketBase...');
            console.log('[PreviewServer][AutoBuildFix] Waiting 500ms to ensure all file writes are complete...');
            // Small delay to ensure all file writes are flushed to disk
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Verify that corrected files exist before creating ZIP
            console.log('[PreviewServer][AutoBuildFix] Verifying corrected files exist...');
            if (appliedCorrections.length > 0) {
              const correctedFiles = appliedCorrections.map(c => path.join(projectPath, c.file)).filter(f => fs.existsSync(f));
              console.log(`[PreviewServer][AutoBuildFix] Found ${correctedFiles.length}/${appliedCorrections.length} corrected files on disk`);
              if (correctedFiles.length < appliedCorrections.length) {
                console.warn(`[PreviewServer][AutoBuildFix] ⚠️ Some corrected files are missing! Expected ${appliedCorrections.length}, found ${correctedFiles.length}`);
              }
            } else {
              console.log('[PreviewServer][AutoBuildFix] No applied corrections to verify');
            }
            
            pocketBaseUpdated = await updateProjectZipInPocketBase(projectId, projectPath, appliedCorrections, userToken);
            // ZIP update is done silently, no user message needed
          } catch (pbError) {
            console.warn('[PreviewServer][AutoBuildFix] Failed to update PocketBase:', pbError?.message || pbError);
            // ZIP update failure is logged but not shown to user
          }
        }
        
        autoBuildFixInProgress = false;
        const correctedFilesList = Array.from(new Set(appliedCorrections.map(c => c.file).filter(Boolean)));
        const correctedFilesWithContent = [];
        for (const relPath of correctedFilesList) {
          const fullPath = path.join(projectPath, relPath);
          if (fs.existsSync(fullPath)) {
            try {
              const content = await fs.promises.readFile(fullPath, 'utf-8');
              correctedFilesWithContent.push({ filePath: relPath.replace(/\\/g, '/'), content });
            } catch (e) { /* skip */ }
          }
        }
        if (shouldStream) {
          sendSse({
            type: 'process_complete',
            status: 'success',
            message: message,
            output: buildOutput,
            attempts: attempt,
            statistics: {
              initialErrors: initialErrorCount,
              correctionsApplied: correctionsApplied,
              correctionsFailed: correctionsFailed,
              errorsFixed: correctionsApplied
            },
            pocketBaseUpdated: pocketBaseUpdated,
            correctedFiles: correctedFilesList,
            correctedFilesWithContent
          });
          return res.end();
        }
        return res.json({
          success: true,
          message: message,
          output: buildOutput,
          attempts: attempt,
          statistics: {
            initialErrors: initialErrorCount,
            correctionsApplied: correctionsApplied,
            correctionsFailed: correctionsFailed,
            errorsFixed: correctionsApplied
          },
          pocketBaseUpdated: pocketBaseUpdated,
          correctedFiles: correctedFilesList,
          correctedFilesWithContent,
          reminder: true
        });

      } catch (buildError) {
        console.error(`[PreviewServer][AutoBuildFix] Build failed (attempt ${attempt}):`, buildError.message);
        if (shouldStream) {
          sendSse({ type: 'build_failed', message: `Build falló en el intento ${attempt}.`, output: buildError.message || '' });
        }
        
        // Get full error output (stdout + stderr)
        const fullErrorOutput = buildError.fullOutput || buildError.stderr || buildError.stdout || buildError.message || '';
        const errorMessage = fullErrorOutput;
        const errorOutput = errorMessage.toLowerCase();
        
        // Debug: Log what we're parsing
        console.log(`[PreviewServer][AutoBuildFix] Error output length: ${fullErrorOutput.length}`);
        console.log(`[PreviewServer][AutoBuildFix] Error output preview (first 800 chars):`);
        console.log(fullErrorOutput.substring(0, 800));
        
        // Check for disk full errors
        const hasNoSpaceLeft = errorOutput.includes('no space left on device') || 
                              errorOutput.includes('there is not enough space');
        
        if (process.platform === 'win32' && hasNoSpaceLeft) {
          autoBuildFixInProgress = false;
          return fail(500, {
            success: false,
            error: 'El servidor local no tiene espacio suficiente. Libera espacio en disco y vuelve a intentarlo.',
            code: 'disk_full',
            details: errorMessage,
            reminder: true
          });
        }

        // Parse errors from build output (use full output including stdout and stderr)
        console.log(`[PreviewServer][AutoBuildFix] Parsing errors from output...`);
        const errors = parseBuildErrors(fullErrorOutput);
        console.log(`[PreviewServer][AutoBuildFix] Parsed ${errors.length} errors from build output`);

        if (attempt === 1) {
          initialErrorCount = errors.length;
          console.log(`[PreviewServer][AutoBuildFix] Initial error count: ${initialErrorCount}`);
        }

        // Check if errors changed
        // Normalize errors for comparison (sort by file and line to avoid order issues)
        const normalizeErrors = (errs) => {
          return errs.map(e => ({
            file: e.file || '',
            line: e.line || 0,
            column: e.column || 0,
            message: e.message || ''
          })).sort((a, b) => {
            if (a.file !== b.file) return a.file.localeCompare(b.file);
            if (a.line !== b.line) return a.line - b.line;
            return a.column - b.column;
          });
        };
        
        const normalizedCurrent = normalizeErrors(errors);
        const normalizedLast = normalizeErrors(lastErrors);
        const errorsChanged = JSON.stringify(normalizedCurrent) !== JSON.stringify(normalizedLast);
        
        console.log(`[PreviewServer][AutoBuildFix] Error comparison: ${normalizedCurrent.length} current vs ${normalizedLast.length} last, changed: ${errorsChanged}`);
        
        lastErrors = errors;

        if (attempt > 1 && !errorsChanged && normalizedCurrent.length > 0) {
          console.log('[PreviewServer][AutoBuildFix] Same errors as previous attempt, stopping to avoid infinite loop');
          
          // ✅ CRÍTICO: Update ZIP in PocketBase if corrections were applied (even if not all errors were fixed)
          let pocketBaseUpdated = false;
          if (projectId && projectId !== 'local-project' && totalCorrectionsApplied > 0 && appliedCorrections.length > 0) {
            try {
              console.log(`[PreviewServer][AutoBuildFix] ⚠️ CRITICAL: Errors persist but ${totalCorrectionsApplied} correction(s) were applied, updating ZIP in PocketBase...`);
              await new Promise(resolve => setTimeout(resolve, 1000)); // Wait longer for file writes
              pocketBaseUpdated = await updateProjectZipInPocketBase(projectId, projectPath, appliedCorrections, userToken);
              if (pocketBaseUpdated) {
                console.log(`[PreviewServer][AutoBuildFix] ✅ ZIP updated successfully with ${totalCorrectionsApplied} applied corrections before stopping`);
                await new Promise(resolve => setTimeout(resolve, 500)); // Wait for ZIP commit
              } else {
                console.error(`[PreviewServer][AutoBuildFix] ❌ FAILED to update ZIP before stopping - ${totalCorrectionsApplied} correction(s) may be lost!`);
              }
            } catch (pbError) {
              console.error(`[PreviewServer][AutoBuildFix] ❌ ERROR updating ZIP before stopping:`, pbError?.message || pbError);
              console.error(`[PreviewServer][AutoBuildFix] ⚠️ CRITICAL: ${totalCorrectionsApplied} correction(s) were applied but ZIP update failed!`);
            }
          }
          
          // Format remaining errors for detailed response
          const remainingErrorsDetails = errors.map(err => {
            const location = err.file && err.line ? `${err.file}:${err.line}:${err.column || 0}` : err.file || 'Desconocido';
            return `• ${location} - ${err.message || 'Error desconocido'}`;
          }).join('\n');
          
          let errorMessage = `❌ Los errores persisten después de ${attempt} intentos.\n\n📊 Estadísticas:\n• Errores encontrados inicialmente: ${initialErrorCount}\n• Correcciones aplicadas: ${totalCorrectionsApplied}\n• Correcciones fallidas: ${totalCorrectionsFailed}\n• Errores restantes: ${errors.length}\n\n🚨 Errores que requieren atención manual:\n${remainingErrorsDetails}`;
          
          // ZIP update messages removed - updates happen silently
          
          autoBuildFixInProgress = false;
          const correctedFilesList = Array.from(new Set(appliedCorrections.map(c => c.file).filter(Boolean)));
          const correctedFilesWithContent = [];
          for (const relPath of correctedFilesList) {
            const fullPath = path.join(projectPath, relPath);
            if (fs.existsSync(fullPath)) {
              try {
                const content = await fs.promises.readFile(fullPath, 'utf-8');
                correctedFilesWithContent.push({ filePath: relPath.replace(/\\/g, '/'), content });
              } catch (e) { /* skip */ }
            }
          }
          if (shouldStream) {
            sendSse({
              type: 'process_complete',
              status: 'error',
              message: errorMessage,
              errors: errors,
              attempts: attempt,
              pocketBaseUpdated: pocketBaseUpdated,
              correctedFiles: correctedFilesList,
              correctedFilesWithContent,
              statistics: {
                initialErrors: initialErrorCount,
                correctionsApplied: totalCorrectionsApplied,
                correctionsFailed: totalCorrectionsFailed,
                remainingErrors: errors.length,
                remainingErrorsDetails: errors
              }
            });
            return res.end();
          }
          return fail(500, {
            success: false,
            error: errorMessage,
            code: 'persistent_errors',
            details: errorMessage,
            errors: errors,
            attempts: attempt,
            pocketBaseUpdated: pocketBaseUpdated,
            correctedFiles: correctedFilesList,
            correctedFilesWithContent,
            reminder: true,
            statistics: {
              initialErrors: initialErrorCount,
              correctionsApplied: totalCorrectionsApplied,
              correctionsFailed: totalCorrectionsFailed,
              remainingErrors: errors.length,
              remainingErrorsDetails: errors
            }
          });
        }

        // If no errors parsed or no more attempts, return error
        if (errors.length === 0 || attempt >= maxAttempts) {
          // ✅ CRÍTICO: Update ZIP in PocketBase if corrections were applied (even if build failed)
          let pocketBaseUpdated = false;
          if (projectId && projectId !== 'local-project' && totalCorrectionsApplied > 0 && appliedCorrections.length > 0) {
            try {
              console.log(`[PreviewServer][AutoBuildFix] ⚠️ CRITICAL: Max attempts reached but ${totalCorrectionsApplied} correction(s) were applied, updating ZIP in PocketBase...`);
              await new Promise(resolve => setTimeout(resolve, 1000)); // Wait longer for file writes
              pocketBaseUpdated = await updateProjectZipInPocketBase(projectId, projectPath, appliedCorrections, userToken);
              if (pocketBaseUpdated) {
                console.log(`[PreviewServer][AutoBuildFix] ✅ ZIP updated successfully with ${totalCorrectionsApplied} applied corrections after max attempts`);
                await new Promise(resolve => setTimeout(resolve, 500)); // Wait for ZIP commit
              } else {
                console.error(`[PreviewServer][AutoBuildFix] ❌ FAILED to update ZIP after max attempts - ${totalCorrectionsApplied} correction(s) may be lost!`);
              }
            } catch (pbError) {
              console.error(`[PreviewServer][AutoBuildFix] ❌ ERROR updating ZIP after max attempts:`, pbError?.message || pbError);
              console.error(`[PreviewServer][AutoBuildFix] ⚠️ CRITICAL: ${totalCorrectionsApplied} correction(s) were applied but ZIP update failed!`);
            }
          }
          
          let errorMsg;
          if (attempt >= maxAttempts) {
            // Format remaining errors for detailed response
            const remainingErrorsDetails = lastErrors.length > 0 ? lastErrors.map(err => {
              const location = err.file && err.line ? `${err.file}:${err.line}:${err.column || 0}` : err.file || 'Desconocido';
              return `• ${location} - ${err.message || 'Error desconocido'}`;
            }).join('\n') : 'No se pudieron identificar errores específicos.';
            
            errorMsg = `❌ Build falló después de ${maxAttempts} intentos.\n\n📊 Estadísticas:\n• Errores encontrados inicialmente: ${initialErrorCount}\n• Correcciones aplicadas: ${totalCorrectionsApplied}\n• Correcciones fallidas: ${totalCorrectionsFailed}\n• Errores finales: ${lastErrors.length}\n\n🚨 Errores restantes que requieren atención manual:\n${remainingErrorsDetails}`;
          } else {
            errorMsg = `❌ El build falló pero no se pudieron identificar errores específicos.\n\n📊 Información:\n• Intentos realizados: ${attempt}\n• Errores iniciales detectados: ${initialErrorCount}\n• Correcciones aplicadas: ${totalCorrectionsApplied}\n\n💡 Recomendación: Revisa manualmente la salida del build para identificar el problema.`;
          }
          
          // ZIP update messages removed - updates happen silently
          
          autoBuildFixInProgress = false;
          return fail(500, {
            success: false,
            error: errorMsg,
            code: 'build_failed',
            details: errorMessage,
            output: errorMessage,
            attempts: attempt,
            pocketBaseUpdated: pocketBaseUpdated,
            reminder: true,
            statistics: {
              initialErrors: initialErrorCount,
              correctionsApplied: totalCorrectionsApplied,
              correctionsFailed: totalCorrectionsFailed,
              finalErrors: lastErrors.length,
              remainingErrorsDetails: lastErrors
            }
          });
        }

        // Send errors to AI for fixing
        console.log(`[PreviewServer][AutoBuildFix] Sending ${errors.length} errors to AI model for fixing...`);
        const fixResult = await sendErrorsToAI(errors, attempt, selectedModel, projectPath);

        if (!fixResult.success) {
          console.warn('[PreviewServer][AutoBuildFix] AI fix failed:', fixResult.error);
          // Continue to next attempt anyway
        } else {
          console.log(`[PreviewServer][AutoBuildFix] AI provided ${fixResult.corrections?.length || 0} corrections`);
          // Update counters
          if (fixResult.applied !== undefined) {
            totalCorrectionsApplied += fixResult.applied;
          }
          if (fixResult.failed !== undefined) {
            totalCorrectionsFailed += fixResult.failed;
          }
          // Store applied corrections for later verification
          if (fixResult.applied > 0 && fixResult.corrections) {
            appliedCorrections.push(...fixResult.corrections.filter((c, idx) => idx < fixResult.applied));
            
            // ✅ CRÍTICO: Update ZIP after each attempt where corrections were applied
            // This ensures that even if the next attempt fails, the corrections are saved
            if (projectId && fixResult.applied > 0) {
              try {
                console.log(`[PreviewServer][AutoBuildFix] ⚠️ CRITICAL: ${fixResult.applied} correction(s) applied in attempt ${attempt}, updating ZIP in PocketBase NOW...`);
                
                // ✅ Wait longer to ensure all file writes are flushed to disk
                await new Promise(resolve => setTimeout(resolve, 1000)); // Increased from 300ms to 1000ms
                
                // ✅ Verify that corrected files exist and have been written
                if (fixResult.corrections && fixResult.corrections.length > 0) {
                  const appliedCorrectionsToVerify = fixResult.corrections.slice(0, fixResult.applied);
                  let allFilesExist = true;
                  for (const correction of appliedCorrectionsToVerify) {
                    const filePath = path.join(projectPath, correction.file);
                    if (!fs.existsSync(filePath)) {
                      console.warn(`[PreviewServer][AutoBuildFix] ⚠️ Corrected file does not exist: ${filePath}`);
                      allFilesExist = false;
                    } else {
                      // Verify file has content
                      try {
                        const fileContent = await fs.readFile(filePath, 'utf8');
                        if (!fileContent || fileContent.trim().length === 0) {
                          console.warn(`[PreviewServer][AutoBuildFix] ⚠️ Corrected file is empty: ${filePath}`);
                          allFilesExist = false;
                        }
                      } catch (readErr) {
                        console.warn(`[PreviewServer][AutoBuildFix] ⚠️ Could not read corrected file: ${filePath}`, readErr.message);
                        allFilesExist = false;
                      }
                    }
                  }
                  if (!allFilesExist) {
                    console.warn(`[PreviewServer][AutoBuildFix] ⚠️ Some corrected files are missing or empty, waiting additional 500ms...`);
                    await new Promise(resolve => setTimeout(resolve, 500));
                  }
                }
                
                // ✅ Update ZIP with all applied corrections so far
                const zipUpdated = await updateProjectZipInPocketBase(projectId, projectPath, appliedCorrections, userToken);
                if (zipUpdated) {
                  console.log(`[PreviewServer][AutoBuildFix] ✅ ZIP updated successfully after attempt ${attempt} (${fixResult.applied} corrections applied, ${appliedCorrections.length} total)`);
                  
                  // ✅ Wait a bit more to ensure ZIP update is fully committed
                  await new Promise(resolve => setTimeout(resolve, 500));
                } else {
                  console.error(`[PreviewServer][AutoBuildFix] ❌ FAILED to update ZIP after attempt ${attempt} - corrections may be lost!`);
                  console.error(`[PreviewServer][AutoBuildFix] This is critical - ${fixResult.applied} correction(s) were applied but not saved to ZIP`);
                }
              } catch (pbError) {
                console.error(`[PreviewServer][AutoBuildFix] ❌ ERROR updating ZIP after attempt ${attempt}:`, pbError?.message || pbError);
                console.error(`[PreviewServer][AutoBuildFix] Stack:`, pbError?.stack?.substring(0, 500));
                console.error(`[PreviewServer][AutoBuildFix] ⚠️ CRITICAL: ${fixResult.applied} correction(s) were applied but ZIP update failed - corrections may be lost!`);
                // Continue anyway - don't fail the whole process if ZIP update fails
                // But log it as an error so it's visible
              }
            }
          }
        }

        // Wait before next attempt
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Max attempts reached
    // ✅ CRÍTICO: Update ZIP one final time if corrections were applied (even if process failed)
    let finalZipUpdated = false;
    if (projectId && projectId !== 'local-project' && totalCorrectionsApplied > 0 && appliedCorrections.length > 0) {
      try {
        console.log(`[PreviewServer][AutoBuildFix] ⚠️ CRITICAL: Max attempts reached but ${totalCorrectionsApplied} correction(s) were applied, updating ZIP one final time...`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for file writes
        finalZipUpdated = await updateProjectZipInPocketBase(projectId, projectPath, appliedCorrections, userToken);
        if (finalZipUpdated) {
          console.log(`[PreviewServer][AutoBuildFix] ✅ ZIP updated successfully before returning error (${totalCorrectionsApplied} corrections saved)`);
        } else {
          console.error(`[PreviewServer][AutoBuildFix] ❌ FAILED to update ZIP before returning error - ${totalCorrectionsApplied} correction(s) may be lost!`);
        }
      } catch (finalPbError) {
        console.error(`[PreviewServer][AutoBuildFix] ❌ ERROR updating ZIP before returning error:`, finalPbError?.message || finalPbError);
        console.error(`[PreviewServer][AutoBuildFix] ⚠️ CRITICAL: ${totalCorrectionsApplied} correction(s) were applied but final ZIP update failed!`);
      }
    }
    
    const finalErrorCount = lastErrors.length;
    const remainingErrorsDetails = lastErrors.map(err => {
      const location = err.file && err.line ? `${err.file}:${err.line}:${err.column || 0}` : err.file || 'Desconocido';
      return `• ${location} - ${err.message || 'Error desconocido'}`;
    }).join('\n');
    
    const errorMsg = `❌ Build falló después de ${maxAttempts} intentos de corrección.\n\n📊 Estadísticas:\n• Errores encontrados inicialmente: ${initialErrorCount}\n• Correcciones aplicadas: ${totalCorrectionsApplied}\n• Correcciones fallidas: ${totalCorrectionsFailed}\n• Errores finales: ${finalErrorCount}\n• Intentos realizados: ${maxAttempts}\n\n🚨 Errores restantes que requieren atención manual:\n${remainingErrorsDetails || 'No se pudieron identificar errores específicos.'}`;
    
    autoBuildFixInProgress = false;
    return fail(500, {
      success: false,
      error: errorMsg,
      code: 'max_attempts_reached',
      details: lastErrors.map(e => e.message).join('; '),
      attempts: maxAttempts,
      reminder: true,
      pocketBaseUpdated: finalZipUpdated, // ✅ Indicate if ZIP was updated
      statistics: {
        initialErrors: initialErrorCount,
        correctionsApplied: totalCorrectionsApplied,
        correctionsFailed: totalCorrectionsFailed,
        finalErrors: finalErrorCount,
        remainingErrorsDetails: lastErrors
      }
    });

  } catch (error) {
    console.error('[PreviewServer][AutoBuildFix] Error:', error);
    
    // ✅ CRÍTICO: Update ZIP if corrections were applied before the error
    let errorZipUpdated = false;
    if (projectId && projectId !== 'local-project' && totalCorrectionsApplied > 0 && appliedCorrections && appliedCorrections.length > 0) {
      try {
        console.log(`[PreviewServer][AutoBuildFix] ⚠️ CRITICAL: Error occurred but ${totalCorrectionsApplied} correction(s) were applied, updating ZIP before returning error...`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for file writes
        errorZipUpdated = await updateProjectZipInPocketBase(projectId, projectPath, appliedCorrections, userToken);
        if (errorZipUpdated) {
          console.log(`[PreviewServer][AutoBuildFix] ✅ ZIP updated successfully before returning error (${totalCorrectionsApplied} corrections saved)`);
        } else {
          console.error(`[PreviewServer][AutoBuildFix] ❌ FAILED to update ZIP before returning error - ${totalCorrectionsApplied} correction(s) may be lost!`);
        }
      } catch (errorPbError) {
        console.error(`[PreviewServer][AutoBuildFix] ❌ ERROR updating ZIP before returning error:`, errorPbError?.message || errorPbError);
        console.error(`[PreviewServer][AutoBuildFix] ⚠️ CRITICAL: ${totalCorrectionsApplied} correction(s) were applied but ZIP update failed!`);
      }
    }
    
    autoBuildFixInProgress = false;
    return fail(500, {
      success: false,
      error: 'Error interno al ejecutar Auto Build Fix: ' + (error?.message || String(error)),
      details: error?.message || String(error),
      reminder: true,
      pocketBaseUpdated: errorZipUpdated, // ✅ Indicate if ZIP was updated
      correctionsApplied: totalCorrectionsApplied || 0 // ✅ Include corrections count
    });
  }
});

app.post('/api/list-files', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const { includeContent = true } = req.body || {};
    const projectPath = currentProjectBasePath;

    if (!fs.existsSync(projectPath)) {
      return res.status(404).json({ error: 'No hay proyecto activo.' });
    }

    const excludedPrefixes = ['node_modules', '.git', 'dist', 'build', '.next'];
    const fileMap = {};

    const readDirectoryRecursively = async (currentPath, relativePath) => {
      let entries = [];
      try {
        entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
      } catch (readErr) {
        if (readErr && (readErr.code === 'EPERM' || readErr.code === 'EACCES')) {
          console.warn('[PreviewServer][list-files] Skipping directory (EPERM/EACCES):', currentPath);
          return;
        }
        throw readErr;
      }
      for (const dirent of entries) {
        if (excludedPrefixes.includes(dirent.name)) continue;
        const entryAbsolutePath = path.join(currentPath, dirent.name);
        const entryRelativePathRaw = path.join(relativePath, dirent.name);
        const entryRelativePath = entryRelativePathRaw.replace(/\\/g, '/');

        try {
          if (dirent.isFile()) {
            if (includeContent) {
              try {
                const content = await fs.promises.readFile(entryAbsolutePath, 'utf-8');
                fileMap[entryRelativePath] = content;
              } catch {
                fileMap[entryRelativePath] = '';
              }
            } else {
              fileMap[entryRelativePath] = '';
            }
          } else if (dirent.isDirectory()) {
            fileMap[entryRelativePath.endsWith('/') ? entryRelativePath.slice(0, -1) : entryRelativePath] = '';
            await readDirectoryRecursively(entryAbsolutePath, entryRelativePath);
          }
        } catch (entryErr) {
          if (entryErr && (entryErr.code === 'EPERM' || entryErr.code === 'EACCES')) {
            console.warn('[PreviewServer][list-files] Skipping entry (EPERM/EACCES):', entryRelativePath);
            continue;
          }
          throw entryErr;
        }
      }
    };

    await readDirectoryRecursively(projectPath, '');

    return res.json({ files: fileMap });
  } catch (error) {
    console.error('[PreviewServer][list-files] Error:', error);
    return res.status(500).json({ error: 'Error interno al listar archivos.' });
  }
});

// Endpoint to reset error notification de-duplication for a project
app.post('/api/reset-error-notifications', (req, res) => {
  try {
    const body = req.body || {};
    const projectId = body.projectId || 'unknown';
    console.log(`[Errors] Reset error notifications requested for project: ${projectId}`);

    // Clear in-memory de-duplication structures so next matching error is broadcast again
    try {
      loggedErrors.clear();
      errorLogTimes.clear();
    } catch (e) {
      console.warn('[Errors] Failed to clear dedup structures:', e?.message || e);
    }

    // Optionally clear stored project errors list to avoid growth
    try {
      if (projectId && projectErrors.has(projectId)) {
        projectErrors.set(projectId, []);
      }
    } catch (e) {
      console.warn('[Errors] Failed to reset projectErrors for project:', projectId, e?.message || e);
    }

    return res.json({ success: true });
  } catch (e) {
    console.error('[Errors] reset-error-notifications failed:', e);
    return res.status(500).json({ success: false, error: e?.message || 'unknown error' });
  }
});

// ConfiguraciÃ³n de multer para manejar archivos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsBaseDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 4056 * 1024 * 1024 // 4GB límite (cubre apps con node_modules incluido)
  },
  fileFilter: (req, file, cb) => {
    console.log('[INFO] Checking file:', file.originalname, file.mimetype); // Changed from emoji to text
    if (file.mimetype === 'application/zip' || file.originalname.endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos ZIP'), false);
    }
  }
});

// Almacenar informaciÃ³n del proyecto activo
let currentProject = null;

// Estado del build de Electron (para post-build: actualizar ZIP en PB o descargar local)
let electronBuildState = {
  inProgress: false,
  complete: false,
  success: false,
  error: null,
  isLocalProject: false,
  zipUpdatedInPB: false,
  zipUpdateError: null,
  projectId: null,
  pocketBaseInstallerDownloadUrl: null // New field
};

// Track logged errors to prevent duplicates
const loggedErrors = new Set();

// Track when errors were logged to enable cleanup
const errorLogTimes = new Map();

// Track project errors
const projectErrors = new Map();

// Crear directorios necesarios
fs.ensureDirSync(uploadsBaseDir);
// PROJECTS_DIR debe terminar en current-project (ej. C:\...\VisorVistaPrevia\projects\current-project)
const envProjectsDir = process.env.PROJECTS_DIR ? path.resolve(process.env.PROJECTS_DIR) : null;
const endsWithCurrentProject = envProjectsDir && path.basename(envProjectsDir) === 'current-project';
// When packaged, use a writable user directory instead of the install directory (Program Files is read-only)
const userWritableProjectsDir = path.join(process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir(), 'ZeusIA', 'projects');
const projectsDir = endsWithCurrentProject ? path.dirname(envProjectsDir) : (envProjectsDir || (isPackaged ? userWritableProjectsDir : path.join(baseDir, 'projects')));
const currentProjectBasePath = endsWithCurrentProject ? envProjectsDir : path.join(projectsDir, 'current-project');
// Ruta de instalación del Visor de Vista Previa (C:\Users\...\AppData\Local\ZEUS\VisorVistaPrevia\projects\current-project)
const installedPreviewPath = path.join(process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir(), 'ZEUS', 'VisorVistaPrevia', 'projects', 'current-project');
fs.ensureDirSync(projectsDir);
fs.ensureDirSync(currentProjectBasePath);
console.log('[PreviewServer] projectsDir:', projectsDir, '| current-project:', currentProjectBasePath);
// Create auto-build-fix storage directory for internal storage
const autoBuildFixStorageDir = path.join(projectsDir, 'auto-build-fix');
fs.ensureDirSync(autoBuildFixStorageDir);
console.log('[PreviewServer] Auto-build-fix storage directory initialized:', autoBuildFixStorageDir);

// Detecta la raíz real del proyecto dentro de currentProjectBasePath
// (algunos ZIPs extraen una carpeta intermedia, ej: current-project/mi-app/package.json)
function detectProjectRoot(basePath) {
  if (!fs.existsSync(basePath)) return basePath;
  // Si hay package.json directamente, usar basePath
  if (fs.existsSync(path.join(basePath, 'package.json'))) return basePath;
  // Buscar en subdirectorios de primer nivel
  try {
    const entries = fs.readdirSync(basePath);
    for (const entry of entries) {
      const full = path.join(basePath, entry);
      if (fs.statSync(full).isDirectory() && !entry.startsWith('.')) {
        if (fs.existsSync(path.join(full, 'package.json'))) {
          console.log('[PreviewServer] Detected project root inside subdirectory:', full);
          return full;
        }
      }
    }
  } catch (e) {
    console.warn('[PreviewServer] Error detecting project root:', e.message);
  }
  return basePath;
}

// Función para limpiar el proyecto actual (robusta, no lanza excepciones)
async function cleanupCurrentProject(options = {}) {
  const { skipDirectoryRemoval = false } = options;
  console.log('[Cleanup] Starting cleanup process...', skipDirectoryRemoval ? '(skipping directory removal)' : '');
  
  // If cleanup is already in progress, wait for it to complete
  let waitCount = 0;
  while (cleanupInProgress && waitCount < 30) { // Wait up to 30 seconds
    console.log(`[Cleanup] Another cleanup already in progress, waiting... (${waitCount + 1}/30)`);
    await sleep(1000);
    waitCount++;
  }
  
  if (cleanupInProgress) {
    console.log('[Cleanup] Previous cleanup still in progress, forcing reset');
    cleanupInProgress = false;
  }
  
  cleanupInProgress = true;
  
  try {
    if (currentProject) {
      console.log(`[Cleanup] Cleaning previous project: ${currentProject.projectId}`);
      const pathToClean = currentProjectBasePath;
      const processToKill = currentProject.serverInfo ? currentProject.serverInfo.process : null;
      const portToFree = currentProject.serverInfo ? currentProject.serverInfo.port : null;

      // Clear logged errors for this project to prevent memory leaks
      loggedErrors.clear();
      errorLogTimes.clear();

      try {
        if (processToKill && processToKill.pid) {
          console.log(`[Cleanup] Attempting to terminate development server process (PID: ${processToKill.pid}) for project ${currentProject.projectId}`);
          const pid = processToKill.pid;
          let processTerminated = false;

          if (os.platform() === 'win32') {
            // On Windows, use taskkill with force flag
            await new Promise((resolve) => {
              exec(`taskkill /PID ${pid} /T /F`, (err) => {
                if (err) {
                  console.warn(`[Cleanup] taskkill failed for PID ${pid}:`, err.message);
                } else {
                  console.log(`[Cleanup] taskkill command executed successfully for PID ${pid}.`);
                }
                resolve();
              });
            });

            // Actively check if process is terminated
            for (let i = 0; i < 10; i++) { // Check up to 10 times (10 * 500ms = 5 seconds)
              await sleep(500);
              try {
                // Try to get process info, if it throws, process is likely dead
                process.kill(pid, 0); // Check if process exists
                console.log(`[Cleanup] Process ${pid} still running, waiting...`);
              } catch (e) {
                if (e.code === 'ESRCH') { // ESRCH means no such process
                  console.log(`[Cleanup] Process ${pid} terminated.`);
                  processTerminated = true;
                  break;
                }
              }
            }
          } else {
            // On Unix-like systems, try multiple signals and active check
            try {
              processToKill.kill('SIGTERM');
              await sleep(500);
              if (!processToKill.killed) {
                processToKill.kill('SIGKILL');
                await sleep(500);
              }
            } catch (e) {
              console.warn(`[Cleanup] Error sending kill signal:`, e.message);
            }

            // Actively check if process is terminated
            for (let i = 0; i < 10; i++) { // Check up to 10 times (10 * 500ms = 5 seconds)
              await sleep(500);
              try {
                process.kill(pid, 0); // Check if process exists
                console.log(`[Cleanup] Process ${pid} still running, waiting...`);
              } catch (e) {
                if (e.code === 'ESRCH') { // ESRCH means no such process
                  console.log(`[Cleanup] Process ${pid} terminated.`);
                  processTerminated = true;
                  break;
                }
              }
            }
          }
          if (!processTerminated) {
            console.warn(`[Cleanup] Process ${pid} might still be running after multiple checks. This could indicate a zombie process or external interference.`);
          } else {
            console.log(`[Cleanup] Process ${pid} confirmed terminated.`);
          }
          console.log(`[Cleanup] Development server process termination attempt completed.`);
        } else {
          console.log(`[Cleanup] No active process found for termination for project ${currentProject.projectId}.`);
        }
      } catch (killErr) {
        console.warn('[Cleanup] Error terminating dev server process:', killErr?.message || killErr);
      }

      // Wait for processes to close (increased duration, but now with active checking)
      console.log('[Cleanup] Final wait for processes to close (2 seconds)...');
      await sleep(2000);

      // Extra step: ensure the dev server port is freed (best-effort)
      try {
        if (portToFree) {
          console.log(`[Cleanup] Ensuring port ${portToFree} is free...`);
          await freePort(portToFree);
        }
      } catch (e) {
        console.warn(`[Cleanup] Could not ensure port is free: ${e?.message || e}`);
      }

      // Extra step for PocketBase projects: ensure port 8090 is free
      try {
        const pocketBasePath = path.join(pathToClean, 'pocket-base');
        if (fs.existsSync(pocketBasePath)) {
            console.log('[Cleanup] PocketBase project detected. Ensuring port 8090 is free...');
            await freePort(8090);
        }
      } catch (e) {
          console.warn(`[Cleanup] Could not ensure PocketBase port is free: ${e?.message || e}`);
      }

      // Extra step for projects with PB_Datos folder: ensure port 3002 is free
      try {
        const pbDatosPath = path.join(pathToClean, 'PB_Datos');
        if (fs.existsSync(pbDatosPath)) {
            console.log('[Cleanup] PB_Datos folder detected. Ensuring port 8742 is free...');
            await freePort(8742);
        }
      } catch (e) {
          console.warn(`[Cleanup] Could not ensure port 8742 is free: ${e?.message || e}`);
      }

      // Intentar detener Gradle (si es app móvil) para liberar locks del directorio android
      try {
        console.log('[Cleanup] Attempting to stop Gradle daemons...');
        await tryStopGradleDaemons(pathToClean);
        console.log('[Cleanup] Gradle daemons stop attempt completed.');
      } catch (e) {
        console.warn('[Cleanup] Could not stop Gradle daemons:', e?.message || e);
      }

      // Quitar atributos de solo lectura en Windows
      if (os.platform() === 'win32') {
        try {
          console.log('[Cleanup] Removing read-only attributes on Windows...');
          await new Promise((resolve) => {
            exec(`attrib -R "${pathToClean}" /S /D`, (err, stdout, stderr) => {
              if (err) {
                console.warn('[Cleanup] Warning while removing read-only attributes:', err.message);
              }
              resolve();
            });
          });
        } catch (e) {
          console.warn('[Cleanup] Warning removing read-only attributes:', e?.message || e);
        }
      }

      // Try to remove the directory directly first (unless skipDirectoryRemoval is true)
      if (!skipDirectoryRemoval) {
        try {
          if (fs.existsSync(pathToClean)) {
            console.log(`[Cleanup] Attempting direct removal of: ${pathToClean}`);
            fs.removeSync(pathToClean);
            console.log(`[Cleanup] Directory removed directly: ${pathToClean}`);
          } else {
            console.log(`[Cleanup] Project folder does not exist: ${pathToClean}`);
          }
        } catch (directErr) {
          console.warn(`[Cleanup] Direct removal failed: ${directErr.message}`);
          // If direct removal fails, try the trash approach
          try {
            const trashDir = path.join(projectsDir, '_trash');
            fs.ensureDirSync(trashDir);
            const trashTarget = path.join(trashDir, `current-project_${Date.now()}_${Math.floor(Math.random() * 10000)}`);
            
            if (fs.existsSync(pathToClean)) {
              console.log(`[Cleanup] Moving folder to temporary trash: ${trashTarget}`);
              fs.renameSync(pathToClean, trashTarget);
              console.log(`[Cleanup] Folder moved to temporary trash: ${trashTarget}`);
              
              // Try to remove from trash
              try {
                console.log(`[Cleanup] Removing from trash: ${trashTarget}`);
                fs.removeSync(trashTarget);
                console.log(`[Cleanup] Directory removed from trash: ${trashTarget}`);
              } catch (trashRemoveErr) {
                console.warn(`[Cleanup] Failed to remove from trash: ${trashRemoveErr.message}`);
              }
            }
          } catch (renameErr) {
            console.warn('[Cleanup] Could not move to temporary trash:', renameErr?.message || renameErr);
            
            // Last resort: try robust removal with more retries
            console.log('[Cleanup] Trying robust removal as last resort (10 retries)...');
            try {
              await robustRemove(pathToClean, 10, 1000);
              console.log(`[Cleanup] Robust removal successful: ${pathToClean}`);
            } catch (finalErr) {
              console.error(`[Cleanup] Final error removing ${pathToClean}:`, finalErr);
              console.log('[Cleanup] Will attempt deletion on next app start.');
            }
          }
        }
      } else {
        console.log('[Cleanup] Skipping directory removal (skipDirectoryRemoval=true)');
      }
    } else {
      console.log('[Cleanup] No current project to clean, performing preventive cleanup...');
      // Limpieza preventiva por si quedó residuo
      try {
        const pathToClean = currentProjectBasePath;
        if (fs.existsSync(pathToClean)) {
          console.log(`[Cleanup] Found residual project folder, removing: ${pathToClean}`);
          try {
            fs.removeSync(pathToClean);
            console.log(`[Cleanup] Residual directory removed directly: ${pathToClean}`);
          } catch (directErr) {
            console.warn(`[Cleanup] Direct removal of residual failed: ${directErr.message}`);
            await robustRemove(pathToClean, 10, 1000);
            console.log(`[Cleanup] Residual directory removed with robust method: ${pathToClean}`);
          }
        } else {
          console.log(`[Cleanup] No residual project folder found at: ${pathToClean}`);
        }
      } catch (err) {
        console.warn('[Cleanup] Error in preventive cleanup:', err?.message || err);
      }
    }
    
    // Clean up any trash directories older than 1 hour
    try {
      const trashDir = path.join(projectsDir, '_trash');
      if (fs.existsSync(trashDir)) {
        const oneHourAgo = Date.now() - 3600000;
        const items = fs.readdirSync(trashDir);
        for (const item of items) {
          const itemPath = path.join(trashDir, item);
          try {
            const stats = fs.statSync(itemPath);
            if (stats.mtime.getTime() < oneHourAgo) {
              fs.removeSync(itemPath);
              console.log(`[Cleanup] Old trash item removed: ${itemPath}`);
            }
          } catch (e) {
            console.warn(`[Cleanup] Error removing old trash item ${itemPath}:`, e.message);
          }
        }
      }
    } catch (e) {
      console.warn('[Cleanup] Error cleaning up old trash:', e.message);
    }
    
    // Clean up error logs for the current project
    try {
      const logsDir = logsBaseDir;
      if (fs.existsSync(logsDir)) {
        const logFiles = fs.readdirSync(logsDir);
        // Filter log files that match the current project ID
        if (currentProject && currentProject.projectId) {
          const projectId = currentProject.projectId;
          const projectLogFiles = logFiles.filter(file => 
            file.includes(projectId) && (file.endsWith('.log') || file.endsWith('.json'))
          );
          
          console.log(`[Cleanup] Found ${projectLogFiles.length} log files for project ${projectId}`);
          
          for (const logFile of projectLogFiles) {
            try {
              const logFilePath = path.join(logsDir, logFile);
              fs.removeSync(logFilePath);
              console.log(`[Cleanup] Removed log file: ${logFile}`);
            } catch (logErr) {
              console.warn(`[Cleanup] Failed to remove log file ${logFile}:`, logErr.message);
            }
          }
        }
        
        // Also clean up any old log files (older than 24 hours)
        const oneDayAgo = Date.now() - 86400000;
        const oldLogFiles = logFiles.filter(file => {
          if (!file.endsWith('.log') && !file.endsWith('.json')) return false;
          try {
            const stats = fs.statSync(path.join(logsDir, file));
            return stats.mtime.getTime() < oneDayAgo;
          } catch (e) {
            return false;
          }
        });
        
        console.log(`[Cleanup] Found ${oldLogFiles.length} old log files to remove`);
        
        for (const logFile of oldLogFiles) {
          try {
            const logFilePath = path.join(logsDir, logFile);
            fs.removeSync(logFilePath);
            console.log(`[Cleanup] Removed old log file: ${logFile}`);
          } catch (logErr) {
            console.warn(`[Cleanup] Failed to remove old log file ${logFile}:`, logErr.message);
          }
        }
      }
    } catch (logCleanupErr) {
      console.warn('[Cleanup] Error during log cleanup:', logCleanupErr.message);
    }
    
    // Ensure the current-project directory exists (empty) so the server stays ready for next uploads
    try {
      const pathToEnsure = currentProjectBasePath;
      fs.ensureDirSync(pathToEnsure);
      console.log(`[Cleanup] Ensured empty project directory exists: ${pathToEnsure}`);
    } catch (e) {
      console.warn('[Cleanup] Warning ensuring empty project directory:', e?.message || e);
    }

    console.log('[Cleanup] Cleanup process completed.');
    return true;
  } catch (err) {
    console.warn('[Cleanup] Cleanup process failed:', err?.message || err);
    return false;
  } finally {
    cleanupInProgress = false;
  }
}

// Función de borrado robusto con reintentos
async function robustRemove(dirPath, maxRetries = 5, retryDelay = 500) {
  console.log(`[RobustRemove] Starting removal of ${dirPath} (maxRetries: ${maxRetries})`);

  // First, try to change permissions if on Unix-like system
  if (os.platform() !== 'win32') {
    try {
      exec(`chmod -R 777 "${dirPath}"`, (err) => {
        if (err) {
          console.warn(`[RobustRemove] Warning changing permissions: ${err.message}`);
        }
      });
      await sleep(500);
    } catch (e) {
      console.warn('[RobustRemove] Warning during chmod operation:', e.message);
    }
  }

  // On Windows, try to close any open handles using handle.exe if available
  if (os.platform() === 'win32') {
    try {
      // Try to find and close handles using handle.exe (Sysinternals)
      await new Promise((resolve) => {
        exec(`handle.exe "${dirPath}" /accepteula`, (err, stdout) => {
          if (!err && stdout) {
            // Parse PIDs from handle.exe output and kill them
            const pidMatches = stdout.match(/pid:\s*(\d+)/gi);
            const pids = [...new Set(pidMatches?.map(m => m.match(/\d+/)[0]) || [])];
            if (pids.length > 0) {
              console.log(`[RobustRemove] Found processes with handles: ${pids.join(', ')}`);
              pids.forEach(pid => {
                exec(`taskkill /PID ${pid} /F`, (killErr) => {
                  if (killErr) {
                    console.warn(`[RobustRemove] Could not kill PID ${pid}:`, killErr.message);
                  } else {
                    console.log(`[RobustRemove] Killed PID ${pid} holding handle.`);
                  }
                });
              });
            }
          }
          resolve();
        });
      });
      await sleep(1000);
    } catch (e) {
      console.warn('[RobustRemove] handle.exe not available or failed:', e.message);
    }
  }

  // Retry loop with increasing delays
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (!fs.existsSync(dirPath)) {
        console.log(`[RobustRemove] Directory no longer exists: ${dirPath}`);
        return;
      }

      // On Windows, use cmd's rmdir as fallback (often more aggressive)
      if (os.platform() === 'win32' && attempt > 1) {
        await new Promise((resolve, reject) => {
          // Use /q for quiet, /s for recursive
          exec(`rmdir /s /q "${dirPath}"`, (cmdErr) => {
            if (cmdErr) {
              reject(cmdErr);
            } else {
              resolve();
            }
          });
        });
        console.log(`[RobustRemove] Directory ${dirPath} removed via rmdir (attempt ${attempt}).`);
        return;
      }

      fs.removeSync(dirPath);
      console.log(`[RobustRemove] Directory ${dirPath} removed successfully (attempt ${attempt}).`);
      return;
    } catch (err) {
      console.warn(`[RobustRemove] Attempt ${attempt}/${maxRetries} failed:`, err.message);
      if (attempt < maxRetries) {
        const delay = retryDelay * Math.pow(1.5, attempt - 1); // Exponential backoff
        console.log(`[RobustRemove] Waiting ${Math.round(delay)}ms before retry...`);
        await sleep(delay);
      }
    }
  }

  // Final fallback: schedule deletion on next reboot (Windows only)
  if (os.platform() === 'win32') {
    try {
      console.log(`[RobustRemove] Scheduling deletion for next reboot...`);
      exec(`reg add "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce" /v DeleteOnReboot /t REG_SZ /d "cmd /c rmdir /s /q \\"${dirPath}\\"" /f`, (regErr) => {
        if (regErr) {
          console.warn('[RobustRemove] Could not schedule reboot deletion:', regErr.message);
        }
      });
    } catch (e) {
      console.warn('[RobustRemove] Failed to schedule reboot deletion:', e.message);
    }
  }

  // If all attempts failed, throw the last error
  throw new Error(`Could not remove ${dirPath} after ${maxRetries} attempts`);
}

// Función para dar un pequeÃ±o respiro al sistema
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function freePort(port) {
  return new Promise((resolve) => {
    exec(`netstat -ano | findstr :${port}`, (err, stdout, stderr) => {
      if (err) {
        // No process found on port, or netstat failed
        return resolve();
      }
      const lines = stdout.split('\n');
      const pids = [];
      lines.forEach(line => {
        const match = line.match(/LISTENING\s+(\d+)/);
        if (match && match[1]) {
          pids.push(match[1]);
        }
      });

      if (pids.length > 0) {
        console.log(`[freePort] Found processes on port ${port} with PIDs: ${pids.join(', ')}`);
        const killPromises = pids.map(pid => {
          return new Promise(killResolve => {
            // Use /T flag to kill child processes as well, preventing orphaned processes
            exec(`taskkill /PID ${pid} /T /F`, (killErr) => {
              if (killErr) {
                console.warn(`[freePort] Failed to kill PID ${pid}:`, killErr.message);
              } else {
                console.log(`[freePort] Killed process with PID ${pid} on port ${port}.`);
              }
              killResolve();
            });
          });
        });
        Promise.all(killPromises).then(() => {
          // Add a small delay to ensure processes are fully terminated
          setTimeout(resolve, 500);
        });
      } else {
        resolve();
      }
    });
  });
}

// Function to check if a port is already in use
function isPortInUse(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          resolve(true); // Port is in use
        } else {
          resolve(false); // Other error, assume not in use for this purpose
        }
      })
      .once('listening', () => {
        tester.once('close', () => resolve(false)).close(); // Port is free
      })
      .listen(port);
  });
}

// Mejor esfuerzo: detener Gradle Daemons si existe wrapper en el proyecto
async function tryStopGradleDaemons(projectRoot) {
  try {
    const androidDir = path.join(projectRoot, 'android');
    const gradlewPath = path.join(androidDir, 'gradlew');
    const gradlewBatPath = path.join(androidDir, 'gradlew.bat');
    const hasAndroid = fs.existsSync(androidDir);
    const hasGradlew = fs.existsSync(gradlewPath) || fs.existsSync(gradlewBatPath);
    if (!hasAndroid || !hasGradlew) return;

    await new Promise((resolve) => {
      const cmd = os.platform() === 'win32' ? 'cmd' : (fs.existsSync(gradlewPath) ? gradlewPath : 'sh');
      const args = os.platform() === 'win32' ? ['/c', 'gradlew.bat', '--stop'] : [gradlewPath, '--stop'];
      const p = spawn(cmd, args, { cwd: androidDir, stdio: 'ignore', shell: false });
      // Timeout de seguridad
      const t = setTimeout(() => { try { p.kill(); } catch (_) {} resolve(); }, 7000);
      p.on('close', () => { clearTimeout(t); resolve(); });
      p.on('error', () => { clearTimeout(t); resolve(); });
    });
  } catch (_) {
    // best-effort
  }
}

// Función para extraer información específica del error (usada por saveBuildErrorLog y broadcast WebSocket)
function parseErrorDetails(errorContent) {
  const errorInfo = {
    filePath: null,
    lineNumber: null,
    errorType: null,
    errorMessage: null,
    fullError: null
  };

  try {
    // Asegurar que trabajamos con string (por si errorData viene como objeto)
    let raw = errorContent;
    if (raw && typeof raw === 'object') {
      raw = raw.errorContent != null ? String(raw.errorContent) : (raw.message != null ? String(raw.message) : JSON.stringify(raw));
    } else {
      raw = raw != null ? String(raw) : '';
    }
    errorInfo.fullError = raw;

    if (!raw || !raw.trim()) return errorInfo;

    // Patrones para extraer ruta y línea (orden: más específicos primero)
    const pathLinePatterns = [
      // Webpack/Next: ,-[./path/to/file.tsx:10:5] o [path:line:col]
      { regex: /\s*,-\[([^\]:]+\.(tsx?|jsx?|ts|js)):(\d+):(\d+)\]\s*$/m, pathIdx: 1, lineIdx: 3 },
      { regex: /\[([^\]:]+\.(tsx?|jsx?|ts|js)):(\d+):(\d+)\]\s*$/m, pathIdx: 1, lineIdx: 3 },
      // Tipo TypeScript/Next: path o ./path seguido de :line:col
      { regex: /(\.?\.?\/?[^\s:]+\.(tsx?|jsx?|ts|js)):(\d+):(\d+)/, pathIdx: 1, lineIdx: 3 },
      // Windows: C:\path\file.tsx:line:col
      { regex: /([a-zA-Z]:[\\/][^:]+\.(tsx?|jsx?|ts|js)):(\d+):(\d+)/, pathIdx: 1, lineIdx: 3 },
      // Error in path o path: SyntaxError
      { regex: /(?:Error in|in)\s+['"]?([^'"\s]+\.(tsx?|jsx?|ts|js))['"]?(?:\s|:|\d|$)/, pathIdx: 1, lineIdx: null },
      { regex: /([^:\s]+\.(js|ts|jsx|tsx)):\s*(SyntaxError|Unexpected token)/, pathIdx: 1, lineIdx: null },
      // Module not found: ... in 'path'
      { regex: /Module not found:.*?in\s+['"]([^'"]+)['"]/, pathIdx: 1, lineIdx: null },
      { regex: /Can't resolve\s+[^ ]+\s+in\s+['"]([^'"]+)['"]/, pathIdx: 1, lineIdx: null },
      // Failed to compile: path
      { regex: /Failed to compile.*?['"]?([^'"\s]+\.(js|ts|jsx|tsx))['"]?/, pathIdx: 1, lineIdx: null }
    ];

    for (const { regex, pathIdx, lineIdx } of pathLinePatterns) {
      const match = raw.match(regex);
      if (match && match[pathIdx]) {
        let p = match[pathIdx].replace(/['"`]/g, '').trim();
        // Quitar paréntesis o corchetes que a veces envuelven la ruta en el mensaje de error
        p = p.replace(/^[\s(\[\]]+/, '').replace(/[\s)\]\]]+$/, '');
        p = p.replace(/\\/g, '/').replace(/^\/+/, '');
        // Normalizar a ruta relativa tipo app/..., src/..., components/...
        const relMatch = p.match(/(?:^|\/)(app|src|components|lib|hooks|context|pages)(\/.+)$/);
        if (relMatch) {
          p = (relMatch[1] + relMatch[2]).replace(/\/+/g, '/');
        } else if (p.startsWith('./')) {
          p = p.replace(/^\.\/+/, '');
        }
        errorInfo.filePath = (p && p.trim()) || match[pathIdx].trim().replace(/^[\s(\[\]]+/, '').replace(/[\s)\]\]]+$/, '');
        if (lineIdx != null && match[lineIdx]) {
          const num = parseInt(match[lineIdx], 10);
          if (!isNaN(num)) errorInfo.lineNumber = num;
        }
        break;
      }
    }

    // Tipo de error
    if (raw.includes('Module not found') || raw.includes("Can't resolve")) {
      errorInfo.errorType = 'module_not_found';
      errorInfo.errorMessage = (raw.split('\n').find(l => l.includes('Module not found') || l.includes("Can't resolve")) || raw).trim().slice(0, 300);
    } else if (raw.includes('SyntaxError') || raw.includes('Unexpected token')) {
      errorInfo.errorType = 'syntax_error';
      errorInfo.errorMessage = (raw.split('\n').find(l => l.includes('SyntaxError') || l.includes('Unexpected token')) || raw).trim().slice(0, 300);
    } else if (raw.includes('Failed to compile')) {
      errorInfo.errorType = 'compilation_error';
      errorInfo.errorMessage = (raw.split('\n').find(l => l.includes('Failed to compile')) || 'Failed to compile').trim().slice(0, 300);
    }

    if (!errorInfo.errorMessage && raw.trim()) {
      errorInfo.errorMessage = raw.trim().slice(0, 500);
    }

    return errorInfo;
  } catch (error) {
    console.error('Error parsing error details:', error);
    return errorInfo;
  }
}

// Función para extraer archivo ZIP
function extractZip(zipPath, extractPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) {
        // Log zip extraction errors
        logZipError(zipPath, extractPath, err);
        return reject(err);
      }

      let extractedCount = 0;
      let directoryCount = 0;
      
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        // ✅ CRÍTICO: Verificar si es un directorio de múltiples formas
        // Algunos ZIPs tienen directorios que no terminan con /
        const isDirectory = /\/$/.test(entry.fileName) || 
                           entry.uncompressedSize === 0 && !entry.fileName.includes('.');
        
        if (isDirectory) {
          // Es un directorio
          const dirPath = path.join(extractPath, entry.fileName);
          try {
            fs.ensureDirSync(dirPath);
            directoryCount++;
            if (directoryCount <= 5 || directoryCount % 50 === 0) {
              console.log(`[ExtractZip] Creating directory: ${entry.fileName}`);
            }
          } catch (dirErr) {
            // Si ya existe como directorio, está bien, continuar
            if (dirErr.code !== 'EEXIST') {
              console.warn(`[ExtractZip] Warning creating directory ${entry.fileName}:`, dirErr.message);
            }
          }
          zipfile.readEntry();
        } else {
          // Es un archivo
          const filePath = path.join(extractPath, entry.fileName);
          
          // ✅ CRÍTICO: Verificar que la ruta de destino no sea un directorio existente
          try {
            const stats = fs.statSync(filePath);
            if (stats.isDirectory()) {
              console.warn(`[ExtractZip] Skipping ${entry.fileName}: path is already a directory`);
              zipfile.readEntry();
              return;
            }
          } catch (statErr) {
            // El archivo no existe, está bien, continuar
          }
          
          zipfile.openReadStream(entry, (err, readStream) => {
            if (err) {
              // Log zip extraction errors pero no detener la extracción completa
              console.error(`[ExtractZip] Error opening read stream for ${entry.fileName}:`, err.message);
              logZipError(zipPath, extractPath, err, entry.fileName);
              // Continuar con la siguiente entrada en lugar de rechazar
              zipfile.readEntry();
              return;
            }

            try {
              fs.ensureDirSync(path.dirname(filePath));
            } catch (dirErr) {
              // Si hay error creando el directorio padre, loguear y continuar
              console.warn(`[ExtractZip] Warning creating parent directory for ${entry.fileName}:`, dirErr.message);
            }

            const writeStream = fs.createWriteStream(filePath);
            readStream.pipe(writeStream);

            writeStream.on('close', () => {
              extractedCount++;
              if (extractedCount <= 10 || extractedCount % 100 === 0) {
                console.log(`[ExtractZip] Extracted file ${extractedCount}: ${entry.fileName}`);
              }
              zipfile.readEntry();
            });
            
            writeStream.on('error', (writeErr) => {
              // ✅ CRÍTICO: Manejar errores EISDIR sin detener la extracción completa
              if (writeErr.code === 'EISDIR') {
                console.warn(`[ExtractZip] Skipping ${entry.fileName}: path is a directory (EISDIR)`);
                logZipError(zipPath, extractPath, writeErr, entry.fileName);
                // Continuar con la siguiente entrada en lugar de rechazar
                zipfile.readEntry();
              } else {
                // Para otros errores, loguear pero también continuar para no detener toda la extracción
                console.error(`[ExtractZip] Error writing file ${entry.fileName}:`, writeErr.message);
                logZipError(zipPath, extractPath, writeErr, entry.fileName);
                // Continuar con la siguiente entrada
                zipfile.readEntry();
              }
            });
          });
        }
      });

      zipfile.on('end', () => {
        console.log(`[ExtractZip] ✅ ZIP extraction completed: ${extractedCount} files, ${directoryCount} directories`);
        resolve();
      });
      
      zipfile.on('error', (zipErr) => {
        // Log general zip errors
        logZipError(zipPath, extractPath, zipErr);
        reject(zipErr);
      });
    });
  });
}

// Function to log ZIP extraction errors
function logZipError(zipPath, extractPath, error, fileName = null) {
  try {
    // ✅ CRÍTICO: No intentar crear directorio de logs si estamos en un snapshot (pkg)
    // En su lugar, solo loguear a la consola
    if (typeof process.pkg !== 'undefined') {
      console.error('[logZipError] Cannot create log file in snapshot. Error:', error.message, fileName ? `File: ${fileName}` : '');
      return;
    }
    
    const logsDir = path.join(__dirname, 'logs');
    fs.ensureDirSync(logsDir);
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFileName = `zip-extraction-error-${timestamp}.log`;
    const logFilePath = path.join(logsDir, logFileName);
    
    const errorContext = {
      timestamp: new Date().toISOString(),
      zipPath: zipPath,
      extractPath: extractPath,
      fileName: fileName,
      errorMessage: error.message,
      errorStack: error.stack,
      platform: process.platform
    };
    
    fs.writeFileSync(logFilePath, JSON.stringify(errorContext, null, 2));
    console.log(`ZIP extraction error saved to: ${logFilePath}`);
  } catch (err) {
    console.error('Failed to save zip extraction error log:', err);
  }
}

// Función para ejecutar comandos npm
function runNpmCommand(projectPath, command) {
  return new Promise((resolve, reject) => {
    const npmProcess = spawn('npm', command.split(' '), {
      cwd: projectPath,
      stdio: 'pipe',
      shell: true
    });

    let output = '';
    let errorOutput = '';

    npmProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    npmProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    npmProcess.on('close', (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        // Combine stdout and stderr for full error context
        // Next.js build errors can appear in both stdout and stderr
        const fullOutput = `${output}\n${errorOutput}`.trim();
        
        // Log npm errors to file
        logNpmError(projectPath, command, output, errorOutput, code);
        
        // Create error with full output (stdout + stderr) for better error parsing
        const error = new Error(`Command failed with code ${code}: ${fullOutput}`);
        error.stdout = output;
        error.stderr = errorOutput;
        error.fullOutput = fullOutput;
        reject(error);
      }
    });
  });
}

// Function to log npm errors to a file
function logNpmError(projectPath, command, stdout, stderr, exitCode) {
  try {
    const logsDir = path.join(baseDir, 'logs');
    
    // Check if we can write to logs directory (pkg snapshot issue)
    try {
      fs.ensureDirSync(logsDir);
    } catch (mkdirErr) {
      console.warn('[WARN] Cannot create logs directory (pkg snapshot):', mkdirErr.message);
      return; // Skip logging if we can't create directory
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFileName = `npm-error-${timestamp}.log`;
    const logFilePath = path.join(logsDir, logFileName);
    
    const errorContext = {
      timestamp: new Date().toISOString(),
      command: command,
      projectPath: projectPath,
      exitCode: exitCode,
      stdout: stdout,
      stderr: stderr,
      nodeVersion: process.version,
      platform: process.platform
    };
    
    fs.writeFileSync(logFilePath, JSON.stringify(errorContext, null, 2));
    console.log(`NPM error saved to: ${logFilePath}`);
  } catch (err) {
    console.error('Failed to save npm error log:', err);
  }
}

// Function to clean npm config before running Capacitor commands
async function cleanNpmConfig() {
  return new Promise((resolve, reject) => {
    console.log('[npm-clean] Cleaning problematic npm config...');
    
    // Run npm config delete for deprecated configs
    const configsToDelete = ['python', 'msvs_version', 'msbuild_path', 'node_gyp'];
    let completed = 0;
    const total = configsToDelete.length;
    
    configsToDelete.forEach(config => {
      const npmProcess = spawn('npm', ['config', 'delete', config], {
        stdio: 'pipe',
        shell: true
      });
      
      npmProcess.on('close', (code) => {
        completed++;
        if (code === 0 || code === 1) { // 0 = deleted, 1 = didn't exist
          console.log(`[npm-clean] Config '${config}' cleaned`);
        }
        if (completed === total) {
          resolve();
        }
      });
      
      npmProcess.on('error', (error) => {
        console.warn(`[npm-clean] Error cleaning config '${config}':`, error.message);
        completed++;
        if (completed === total) {
          resolve();
        }
      });
    });
  });
}

// Function to check system dependencies for Capacitor
function checkCapacitorDependencies() {
  return new Promise((resolve) => {
    const results = {
      java: { installed: false, version: null, error: null },
      androidSdk: { installed: false, path: null, error: null }
    };

    // Check Java
    exec('java -version', (error, stdout, stderr) => {
      if (!error) {
        // Java is installed, extract version
        const versionMatch = stderr.match(/version "([^"]+)"/) || stderr.match(/java version "([^"]+)"/);
        if (versionMatch) {
          results.java.installed = true;
          results.java.version = versionMatch[1];
          console.log(`[cap-check] Java found: ${results.java.version}`);
        }
      } else {
        results.java.error = 'Java no encontrado en PATH';
        console.warn('[cap-check] Java not found:', error.message);
      }

      // Check Android SDK
      const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
      if (androidHome && fs.existsSync(androidHome)) {
        results.androidSdk.installed = true;
        results.androidSdk.path = androidHome;
        console.log(`[cap-check] Android SDK found at: ${androidHome}`);
      } else {
        results.androidSdk.error = 'ANDROID_HOME no configurado o directorio no existe';
        console.warn('[cap-check] Android SDK not found');
      }

      resolve(results);
    });
  });
}

// Function to run npm command with better error handling
function runNpmCommand(projectPath, command) {
  return new Promise((resolve, reject) => {
    console.log(`[runNpmCommand] Running: ${command} in ${projectPath}`);
    
    // Clean environment variables to avoid npm warnings
    const cleanEnv = { ...process.env };
    delete cleanEnv.npm_config_python;
    delete cleanEnv.npm_config_msvs_version;
    delete cleanEnv.npm_config_msbuild_path;
    delete cleanEnv.npm_config_node_gyp;
    
    // Also clean npm config for this session
    cleanEnv.npm_config_loglevel = 'error'; // Only show errors, not warnings
    
    // Determine if this is an npx command or npm command
    let commandArgs;
    if (command.startsWith('npx ')) {
      // For npx commands, run npx directly
      commandArgs = command.split(' ');
      commandArgs[0] = 'npx'; // Ensure we use npx from PATH
    } else {
      // For npm commands, use npm
      commandArgs = ['npm', ...command.split(' ')];
    }
    
    // For npm install, check if we should ignore scripts to avoid infinite loops
    if (command.includes('install') && !command.includes('--ignore-scripts')) {
      // Check package.json for potentially problematic postinstall scripts
      try {
        const pkgJsonPath = path.join(projectPath, 'package.json');
        if (fs.existsSync(pkgJsonPath)) {
          const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
          const postinstall = pkg.scripts?.postinstall;
          
          // If postinstall contains npm install, it might cause a loop
          if (postinstall && typeof postinstall === 'string' && postinstall.includes('npm install')) {
            console.warn(`[runNpmCommand] ⚠️ Detected potentially problematic postinstall script. Adding --ignore-scripts to prevent infinite loop.`);
            // Add --ignore-scripts flag to prevent postinstall from running
            if (!commandArgs.includes('--ignore-scripts')) {
              commandArgs.push('--ignore-scripts');
            }
          }
        }
      } catch (pkgError) {
        console.warn(`[runNpmCommand] Could not check package.json for postinstall scripts:`, pkgError.message);
      }
    }
    
    const npmProcess = spawn(commandArgs[0], commandArgs.slice(1), {
      cwd: projectPath,
      stdio: 'pipe',
      shell: true,
      env: cleanEnv
    });

    let output = '';
    let errorOutput = '';
    let lastOutputTime = Date.now();
    let lastOutputHash = '';
    let repeatedOutputCount = 0;
    const skipLoopDetection = /\bcap\s+(add|sync)\s+android\b/i.test(command);
    const MAX_REPEATED_OUTPUT = 30; // Número de outputs IDÉNTICOS consecutivos antes de marcar loop
    const REPEAT_WINDOW_MS = 1500; // Considerar "rápido" si llegan dentro de este intervalo
    const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos timeout
    let timeoutId = null;

    // Set a timeout to kill the process if it takes too long
    timeoutId = setTimeout(() => {
      if (npmProcess && !npmProcess.killed) {
        console.error(`[runNpmCommand] ⚠️ Command timeout after ${TIMEOUT_MS / 1000} seconds. Killing process...`);
        npmProcess.kill('SIGTERM');
        setTimeout(() => {
          if (!npmProcess.killed) {
            npmProcess.kill('SIGKILL');
          }
        }, 5000);
        reject(new Error(`Command timeout after ${TIMEOUT_MS / 1000} seconds. Possible infinite loop detected.`));
      }
    }, TIMEOUT_MS);

    npmProcess.stdout.on('data', (data) => {
      const dataStr = data.toString();
      output += dataStr;
      console.log(`[npm stdout] ${dataStr.trim()}`);

      // Detect EXACTAMENTE el mismo chunk repetido muchas veces en una ventana
      // corta (señal fiable de un bucle real). Antes era demasiado agresivo:
      // contaba cualquier output llegando en <2s como candidato, lo que disparaba
      // falsos positivos con npm install al instalar muchas dependencias rápido.
      if (!skipLoopDetection) {
        const now = Date.now();
        // Hash ligero del chunk (primeras + últimas líneas) para detectar
        // repetición textual real y no "salida frecuente".
        const trimmed = dataStr.trim();
        const hash = trimmed.length > 200
          ? trimmed.slice(0, 100) + '|' + trimmed.slice(-100)
          : trimmed;
        if (hash === lastOutputHash && now - lastOutputTime < REPEAT_WINDOW_MS) {
          repeatedOutputCount++;
          if (repeatedOutputCount >= MAX_REPEATED_OUTPUT) {
            console.error(`[runNpmCommand] ⚠️ Detected real infinite loop (${repeatedOutputCount} identical outputs). Killing process...`);
            if (timeoutId) clearTimeout(timeoutId);
            npmProcess.kill('SIGTERM');
            setTimeout(() => {
              if (!npmProcess.killed) {
                npmProcess.kill('SIGKILL');
              }
            }, 2000);
            reject(new Error('Infinite loop detected in npm command. Process terminated.'));
          }
        } else {
          repeatedOutputCount = 0;
          lastOutputHash = hash;
        }
        lastOutputTime = now;
      }
    });

    npmProcess.stderr.on('data', (data) => {
      const dataStr = data.toString();
      errorOutput += dataStr;
      
      // Filter out known npm config warnings that are not actual errors
      const isDeprecatedConfigWarning = 
        dataStr.includes('Unknown user config "python"') ||
        dataStr.includes('Unknown user config "msvs_version"') ||
        dataStr.includes('Unknown user config "msbuild_path"') ||
        dataStr.includes('Unknown user config "node_gyp"') ||
        dataStr.includes('This will stop working in the next major version');
      
      if (!isDeprecatedConfigWarning) {
        console.warn(`[npm stderr] ${dataStr.trim()}`);
      } else {
        console.log(`[npm] Filtered deprecated config warning: ${dataStr.trim().split('\n')[0]}`);
      }
    });

    npmProcess.on('close', (code) => {
      if (timeoutId) clearTimeout(timeoutId);
      console.log(`[runNpmCommand] Command exited with code: ${code}`);
      
      if (code === 0) {
        resolve(output);
      } else {
        // Filter out deprecated config warnings from error output
        const filteredErrorOutput = errorOutput
          .split('\n')
          .filter(line => 
            !line.includes('Unknown user config "python"') &&
            !line.includes('Unknown user config "msvs_version"') &&
            !line.includes('Unknown user config "msbuild_path"') &&
            !line.includes('Unknown user config "node_gyp"') &&
            !line.includes('This will stop working in the next major version')
          )
          .join('\n')
          .trim();
        
        // Log npm errors to file
        logNpmError(projectPath, command, output, filteredErrorOutput, code);
        reject(new Error(`Command failed with code ${code}: ${filteredErrorOutput || output}`));
      }
    });

    npmProcess.on('error', (error) => {
      if (timeoutId) clearTimeout(timeoutId);
      console.error(`[runNpmCommand] Process error:`, error);
      reject(error);
    });
  });
}

// Función para iniciar servidor de desarrollo
// Función para inyectar el selector de componentes en Next.js
function injectComponentSelector(projectPath, previewServerPort) {
  try {
    // Verificar si es App Router (tiene carpeta app) o Pages Router (tiene carpeta pages)
    const isAppRouter = fs.existsSync(path.join(projectPath, 'app')) || fs.existsSync(path.join(projectPath, 'src', 'app'));
    const isPagesRouter = fs.existsSync(path.join(projectPath, 'pages'));

    if (isAppRouter) {
      // Manejar App Router - inyectar en layout.tsx
      const possibleLayouts = [
        path.join(projectPath, 'app', 'layout.tsx'),
        path.join(projectPath, 'app', 'layout.js'),
        path.join(projectPath, 'src', 'app', 'layout.tsx'),
        path.join(projectPath, 'src', 'app', 'layout.js')
      ];

      let layoutPath = null;
      for (const layoutFile of possibleLayouts) {
        if (fs.existsSync(layoutFile)) {
          layoutPath = layoutFile;
          break;
        }
      }

      if (layoutPath) {
        let content = fs.readFileSync(layoutPath, 'utf8');

        // Verificar si ya está inyectado
        if (!content.includes('inspector-client.js')) {
          // Agregar import de Script si no existe
          if (!content.includes('import Script from')) {
            content = content.replace(
              /import.*from 'next\/font\/google'/,
              "$&\nimport Script from 'next/script'"
            );
          }

          // Inyectar el script antes del cierre de </body>
          if (content.includes('</body>')) {
            content = content.replace(
              '</body>',
              `        <Script src="http://localhost:${previewServerPort}/inspector-client.js" strategy="afterInteractive" />\n      </body>`
            );
          } else {
            // Si no hay </body>, agregar despuÃ©s de {children}
            content = content.replace(
              '{children}',
              `{children}\n        <Script src="http://localhost:${previewServerPort}/inspector-client.js" strategy="afterInteractive" />`
            );
          }

          fs.writeFileSync(layoutPath, content);
          console.log(`[${projectPath}] Inspector cliente inyectado en layout.tsx (App Router)`);
        }
      }
    } else if (isPagesRouter) {
      // Manejar Pages Router - inyectar en _document.js
      const possibleDocuments = [
        path.join(projectPath, 'pages', '_document.js'),
        path.join(projectPath, 'pages', '_document.tsx'),
        path.join(projectPath, 'src', 'pages', '_document.js'),
        path.join(projectPath, 'src', 'pages', '_document.tsx')
      ];

      let documentPath = null;
      for (const docPath of possibleDocuments) {
        if (fs.existsSync(docPath)) {
          documentPath = docPath;
          break;
        }
      }

      const scriptTag = `<script src="http://localhost:${previewServerPort}/inspector-client.js"></script>`;

      // Si no existe _document, crear uno
      if (!documentPath) {
        const pagesDir = fs.existsSync(path.join(projectPath, 'src', 'pages'))
          ? path.join(projectPath, 'src', 'pages')
          : path.join(projectPath, 'pages');

        fs.ensureDirSync(pagesDir);
        documentPath = path.join(pagesDir, '_document.js');

        const documentContent = `import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html>
      <Head />
      <body>
        <Main />
        <NextScript />
        ${scriptTag}
      </body>
    </Html>
  )
}`;

        fs.writeFileSync(documentPath, documentContent);
        console.log(`[${projectPath}] Inspector cliente inyectado en _document.js (Pages Router)`);
      } else {
        // Modificar _document existente
        let content = fs.readFileSync(documentPath, 'utf8');

        // Verificar si ya está inyectado
        if (!content.includes('inspector-client.js')) {
          // Buscar el cierre de </body> e inyectar antes
          if (content.includes('</body>')) {
            content = content.replace(
              '</body>',
              `        ${scriptTag}\n      </body>`
            );
          } else if (content.includes('<NextScript />')) {
            content = content.replace(
              '<NextScript />',
              `<NextScript />\n        ${scriptTag}`
            );
          }

          fs.writeFileSync(documentPath, content);
          console.log(`[${projectPath}] Inspector cliente inyectado en _document existente (Pages Router)`);
        }
      }
    }
  } catch (error) {
    console.error(`Error inyectando selector de componentes: ${error.message}`);
  }
}

function startDevServer(projectPath, projectId, previewServerPort) {
  return (async () => {
    // Liberar puerto 3000 antes de iniciar (evita EADDRINUSE al renderizar otra app)
    const port = 3000;
    console.log(`[Dev] Comprobando y liberando puerto ${port} si está en uso...`);
    try {
      await freePort(port);
      await sleep(1500);
    } catch (e) {
      console.warn('[Dev] freePort no crítico:', e && e.message ? e.message : e);
    }

    return new Promise((resolve, reject) => {
    console.log(`[Debug] Injecting component selector with port: ${previewServerPort}`);
    injectComponentSelector(projectPath, previewServerPort);

    // Determinar el puerto para la aplicación. Por defecto, 3000.
    let portNum = port;
    const pocketBasePath = path.join(projectPath, 'pocket-base');
    try {
      if (fs.existsSync(pocketBasePath) && fs.lstatSync(pocketBasePath).isDirectory()) {
        console.log('[INFO] "pocket-base" folder found. Using port 3000.');
      } else {
        // Si no hay pocket-base, pero es un proyecto Next.js, aún así intentar 3000.
        // Si 3000 está en uso, Next.js suele encontrar el siguiente disponible.
        console.log('[INFO] "pocket-base" folder not found. Attempting to use port 3000 for Next.js app.');
      }
    } catch (e) {
      console.log('[INFO] Error checking pocket-base folder. Attempting to use port 3000 for Next.js app.');
    }

    // Determinar cómo arrancar el dev server para respetar el puerto seleccionado
    let devProcess;
    try {
      const pkgJsonPath = path.join(projectPath, 'package.json');
      const pkg = fs.existsSync(pkgJsonPath) ? JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')) : {};
      const hasPocketBase = fs.existsSync(pocketBasePath) && fs.lstatSync(pocketBasePath).isDirectory();
      const devScript = (pkg.scripts && pkg.scripts.dev) ? String(pkg.scripts.dev) : '';
      const usesNext = !!(pkg.dependencies && pkg.dependencies.next) || (devScript && (/next\s+dev/.test(devScript) || /react-scripts\s+start/.test(devScript)));

      if (hasPocketBase) {
        // Caso pocket-base: respetar el script definido por el proyecto (concurrently y otros servicios)
        console.log('[Dev] pocket-base presente: usando "npm run dev" (el proyecto controla puertos internos).');

        // Leer .env del proyecto para obtener sus variables locales de PocketBase
        const projectEnvPath = path.join(projectPath, '.env');
        const projectEnv = {};
        try {
          if (fs.existsSync(projectEnvPath)) {
            const envContent = fs.readFileSync(projectEnvPath, 'utf8');
            envContent.split(/\r?\n/).forEach(line => {
              const eqIdx = line.indexOf('=');
              if (eqIdx > 0 && !line.trim().startsWith('#')) {
                const key = line.slice(0, eqIdx).trim();
                let value = line.slice(eqIdx + 1).trim();
                if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                  value = value.slice(1, -1);
                }
                projectEnv[key] = value;
              }
            });
            console.log('[Dev] .env del proyecto leído. Variables PB encontradas:', Object.keys(projectEnv).filter(k => /PB|POCKETBASE/i.test(k)).join(', '));
          }
        } catch (envErr) {
          console.warn('[Dev] No se pudo leer .env del proyecto:', envErr.message);
        }

        // Determinar la URL local de PocketBase del proyecto
        const localPbUrl = projectEnv.NEXT_PUBLIC_PB_URL || projectEnv.NEXT_PUBLIC_POCKETBASE_URL || projectEnv.POCKETBASE_URL || projectEnv.PB_URL;
        const localPbEmail = projectEnv.PB_ADMIN_EMAIL || projectEnv.POCKETBASE_ADMIN_EMAIL || projectEnv.POCKETBASE_EMAIL;
        const localPbPassword = projectEnv.PB_ADMIN_PASSWORD || projectEnv.POCKETBASE_ADMIN_PASSWORD || projectEnv.POCKETBASE_PASSWORD;

        const nodeModulesBinPath = path.join(projectPath, 'node_modules', '.bin');
        const newEnv = {
          ...process.env,
          CHOKIDAR_USEPOLLING: 'true',
          PATH: `${nodeModulesBinPath}${path.delimiter}${process.env.PATH}`
        };

        // Sobrescribir con las variables locales del proyecto SI existen,
        // para evitar que las globales de Zeus (remoto) dominen sobre el .env local.
        if (localPbUrl) {
          newEnv.NEXT_PUBLIC_POCKETBASE_URL = localPbUrl;
          newEnv.POCKETBASE_URL = localPbUrl;
          newEnv.NEXT_PUBLIC_PB_URL = localPbUrl;
          console.log('[Dev] Usando URL de PocketBase local del proyecto:', localPbUrl);
        }
        if (localPbEmail) {
          newEnv.PB_ADMIN_EMAIL = localPbEmail;
          newEnv.POCKETBASE_ADMIN_EMAIL = localPbEmail;
          newEnv.POCKETBASE_EMAIL = localPbEmail;
          console.log('[Dev] Usando PB_ADMIN_EMAIL del proyecto:', localPbEmail);
        }
        if (localPbPassword) {
          newEnv.PB_ADMIN_PASSWORD = localPbPassword;
          newEnv.POCKETBASE_ADMIN_PASSWORD = localPbPassword;
          newEnv.POCKETBASE_PASSWORD = localPbPassword;
          console.log('[Dev] Usando PB_ADMIN_PASSWORD del proyecto.');
        }

        devProcess = spawn('npm', ['run', 'dev'], {
          cwd: projectPath,
          stdio: 'pipe',
          shell: true,
          env: newEnv
        });
      } else if (usesNext) {
        // Proyecto Next/React: forzar puerto elegido invocando Next/React directamente
        console.log(`[Dev] Iniciando Next/React en puerto ${portNum}.`);
        const command = pkg.dependencies && pkg.dependencies.next ? 'npx' : 'npm';
        const args = pkg.dependencies && pkg.dependencies.next ? ['next', 'dev', '-p', portNum.toString()] : ['run', 'dev'];
        
        // Si es un proyecto React, necesitamos pasar el puerto de forma diferente
        if (pkg.dependencies && pkg.dependencies.react-scripts) {
          args.push('--', '--port', portNum.toString());
        }

        devProcess = spawn(command, args, {
          cwd: projectPath,
          stdio: 'pipe',
          shell: true,
          env: { ...process.env, CHOKIDAR_USEPOLLING: 'true' }
        });
      } else {
        console.error(`[ERROR] Project type not recognized or not a Next.js/React project. Cannot start dev server.`);
        throw new Error('Unsupported project type. Please upload a Next.js or React project.');
      }
    } catch (e) {
      console.warn('[Dev] Error determinando comando de arranque, usando fallback npm run dev -- --port', portNum, e?.message || e);
      devProcess = spawn('npm', ['run', 'dev', '--', '--port', portNum.toString()], {
        cwd: projectPath,
        stdio: 'pipe',
        shell: true,
        env: { ...process.env, CHOKIDAR_USEPOLLING: 'true' }
      });
    }

    let serverStarted = false;
    let errorBuffer = ''; // Buffer to collect error output
    let lastErrorLogged = null; // Track last logged error to prevent duplicates

    devProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`[${projectId}] ${output}`);

      // Check for build errors in stdout as well
      // Expanded error detection to catch more types of errors including syntax errors
      if (output.includes('Module not found') || 
          output.includes('Failed to compile') || 
          output.includes('Build Error') ||
          output.includes("Can't resolve") ||
          output.includes('Syntax Error') ||
          output.includes('Unterminated string constant') ||
          output.includes('Unexpected token') ||
          output.includes('Parsing error') ||
          output.includes('CompileError') ||
          output.includes('Error:')) {
        
        // Create a hash of the error to prevent duplicates
        const errorSignature = `${projectId}-${output.substring(0, 200)}`;
        const errorHash = crypto.createHash('md5').update(errorSignature).digest('hex');
        if (!loggedErrors.has(errorHash)) {
          loggedErrors.add(errorHash);
          errorLogTimes.set(errorHash, Date.now());
          console.log(`[${projectId}] Build error detected in stdout. Saving error log...`);
          saveBuildErrorLog(projectId, output, projectPath);
          
          // Clean up old error logs (older than 1 hour)
          const oneHourAgo = Date.now() - 3600000;
          for (const [hash, timestamp] of errorLogTimes.entries()) {
            if (timestamp < oneHourAgo) {
              loggedErrors.delete(hash);
              errorLogTimes.delete(hash);
            }
          }
        }
      }

      if (output.includes('ready') || output.includes('Local:') || output.includes(`localhost:${portNum}`)) {
        if (!serverStarted) {
          serverStarted = true;
          console.log(`[SUCCESS] Development server started for project ${projectId} on port ${portNum}`);
          resolve({ port: portNum, process: devProcess, url: `http://localhost:${portNum}` });
        }
      }
    });

    devProcess.stderr.on('data', (data) => {
      const errorChunk = data.toString();
      console.error(`[${projectId}] Error: ${errorChunk}`);
      
      // Collect error output for potential logging
      errorBuffer += errorChunk;

      // Check for build errors and log them
      // Expanded error detection for stderr as well
      if (errorChunk.includes('Module not found') || 
          errorChunk.includes('Failed to compile') || 
          errorChunk.includes('Build Error') ||
          errorChunk.includes('Error:') ||
          errorChunk.includes('ERR!') ||
          errorChunk.includes("Can't resolve") ||
          errorChunk.includes('Syntax Error') ||
          errorChunk.includes('Unterminated string constant') ||
          errorChunk.includes('Unexpected token') ||
          errorChunk.includes('Parsing error') ||
          errorChunk.includes('CompileError')) {
        
        // Create a hash of the error to prevent duplicates
        const errorSignature = `${projectId}-${errorBuffer.substring(0, 200)}`;
        const errorHash = crypto.createHash('md5').update(errorSignature).digest('hex');
        if (!loggedErrors.has(errorHash)) {
          loggedErrors.add(errorHash);
          errorLogTimes.set(errorHash, Date.now());
          console.log(`[${projectId}] Build error detected. Saving error log...`);
          saveBuildErrorLog(projectId, errorBuffer, projectPath);
          
          // Clean up old error logs (older than 1 hour)
          const oneHourAgo = Date.now() - 3600000;
          for (const [hash, timestamp] of errorLogTimes.entries()) {
            if (timestamp < oneHourAgo) {
              loggedErrors.delete(hash);
              errorLogTimes.delete(hash);
            }
          }
        }
      }
    });

    devProcess.on('close', async (code) => {
      console.log(`[${projectId}] Dev server closed with code ${code}`);
      
      // If the process exited with an error code and we haven't resolved yet, log the error
      if (code !== 0 && !serverStarted) {
        // Create a hash of the error to prevent duplicates
        const errorSignature = `${projectId}-${errorBuffer.substring(0, 200)}`;
        const errorHash = crypto.createHash('md5').update(errorSignature).digest('hex');
        if (!loggedErrors.has(errorHash)) {
          loggedErrors.add(errorHash);
          errorLogTimes.set(errorHash, Date.now());
          console.log(`[${projectId}] Dev server exited with error code. Saving final error log...`);
          saveBuildErrorLog(projectId, errorBuffer, projectPath);
          
          // Clean up old error logs (older than 1 hour)
          const oneHourAgo = Date.now() - 3600000;
          for (const [hash, timestamp] of errorLogTimes.entries()) {
            if (timestamp < oneHourAgo) {
              loggedErrors.delete(hash);
              errorLogTimes.delete(hash);
            }
          }
        }
        reject(new Error(`Dev server exited with code ${code}`));
      }
      
      // Removed: if (currentProject && currentProject.projectId === projectId) {
      // Removed:   await cleanupCurrentProject();
      // Removed: }
    });

    setTimeout(() => {
      if (!serverStarted) {
        console.error(`[${projectId}] Timeout: The server did not start within 120 seconds.`);
        // Save error log on timeout
        const errorSignature = `${projectId}-${errorBuffer.substring(0, 200)}`;
        const errorHash = crypto.createHash('md5').update(errorSignature).digest('hex');
        if (!loggedErrors.has(errorHash)) {
          loggedErrors.add(errorHash);
          errorLogTimes.set(errorHash, Date.now());
          saveBuildErrorLog(projectId, errorBuffer, projectPath);
          
          // Clean up old error logs (older than 1 hour)
          const oneHourAgo = Date.now() - 3600000;
          for (const [hash, timestamp] of errorLogTimes.entries()) {
            if (timestamp < oneHourAgo) {
              loggedErrors.delete(hash);
              errorLogTimes.delete(hash);
            }
          }
        }
        }
        devProcess.kill();
        reject(new Error('Server startup timeout'));
      
    }, 120000);
  });
  })();
}

// Function to save build errors to a temporary file
function saveBuildErrorLog(projectId, errorData, projectPath) {
  try {
    const logsDir = path.join(baseDir, 'logs');
    
    // Check if we can write to logs directory (pkg snapshot issue)
    try {
      fs.ensureDirSync(logsDir);
    } catch (mkdirErr) {
      console.warn('[WARN] Cannot create logs directory (pkg snapshot):', mkdirErr.message);
      return; // Skip logging if we can't create directory
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFileName = `build-error-${projectId}-${timestamp}.log`;
    const logFilePath = path.join(logsDir, logFileName);
    
    // Parse error details
    const errorDetails = parseErrorDetails(errorData);
    
    // Gather additional context information
    const errorContext = {
      timestamp: new Date().toISOString(),
      projectId: projectId,
      projectPath: projectPath,
      errorDetails: errorDetails,
      errorRaw: errorData,
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch
    };
    
    // Write the error log
    fs.writeFileSync(logFilePath, JSON.stringify(errorContext, null, 2));
    console.log(`[${projectId}] Build error saved to: ${logFilePath}`);
    
    // También crear versión legible
    const readableLogFileName = `build-error-${projectId}-${timestamp}-readable.log`;
    const readableLogFilePath = path.join(logsDir, readableLogFileName);
    
    const readableContent = `
BUILD ERROR REPORT
==================

Timestamp: ${new Date().toISOString()}
Project ID: ${projectId}
Project Path: ${projectPath}

ERROR SUMMARY:
--------------
File: ${errorDetails.filePath || 'Unknown'}
Line: ${errorDetails.lineNumber || 'Unknown'}
Type: ${errorDetails.errorType || 'Unknown'}
Message: ${errorDetails.errorMessage || 'See details below'}

ERROR DETAILS:
--------------
${errorData}
`;
    
    fs.writeFileSync(readableLogFilePath, readableContent);
    console.log(`[${projectId}] Human-readable build error saved to: ${readableLogFilePath}`);

    // ✅ CORRECCIÓN: Broadcast con errorDetails incluidos
    if (wss) {
      try {
        const message = JSON.stringify({
          type: 'build_error',
          projectId: projectId,
          errorContent: errorData,
          errorDetails: errorDetails // ← Asegúrate de que esto se envía
        });
        
        console.log(`[${projectId}] Broadcasting WebSocket message:`, {
          type: 'build_error',
          projectId: projectId,
          hasErrorDetails: !!errorDetails,
          filePath: errorDetails.filePath
        });
        
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(message);
          }
        });
        console.log(`[${projectId}] Broadcasted build error to frontend.`);
      } catch (readErr) {
        console.error(`[${projectId}] Failed to broadcast error log:`, readErr);
      }
    }
    
    // Store error in projectErrors map
    if (!projectErrors.has(projectId)) {
      projectErrors.set(projectId, []);
    }
    
    projectErrors.get(projectId).push({
      id: logFileName,
      timestamp: new Date().toISOString(),
      errorDetails: errorDetails,
      errorRaw: errorData,
      logFilePath: logFilePath,
      readableLogFilePath: readableLogFilePath
    });
    
  } catch (err) {
    console.error(`[${projectId}] Failed to save build error log:`, err);
  }
}


// Middleware para manejar errores de multer
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    console.log('[ERROR] Multer Error:', error.message); // Changed from emoji to text
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'El archivo es demasiado grande (máximo 4GB)' });
    }
    return res.status(400).json({ error: `Error de carga: ${error.message}` });
  }
  if (error) {
    console.log('[ERROR] General Error:', error.message); // Changed from emoji to text
    return res.status(400).json({ error: error.message });
  }
  next();
});

// Middleware para manejar errores generales
app.use((err, req, res, next) => {
    const logFilePath = path.join(__dirname, 'server_errors.log');
    const timestamp = new Date().toISOString();
    const errorData = `Timestamp: ${timestamp}
Error: ${err.message}
Stack: ${err.stack}

---

`;

    fs.appendFileSync(logFilePath, errorData);
    console.error('Unhandled error caught and logged:', err);

    // Send a generic error response to the client
    res.status(500).send('An internal server error occurred. Details have been logged.');
});



// Endpoint para subir imágenes individuales (para el editor de propiedades)
app.post('/api/upload-image', upload.single('file'), async (req, res) => {
  console.log('[UPLOAD-IMAGE] Received image upload request');

  if (!req.file) {
    console.log('[UPLOAD-IMAGE] ERROR: No file provided');
    return res.status(400).json({ error: 'No se proporcionó archivo' });
  }

  try {
    const projectId = req.body.projectId || req.query.projectId || 'default';
    const uploadsDir = uploadsBaseDir;
    fs.ensureDirSync(uploadsDir);

    // Generar nombre único
    const timestamp = Date.now();
    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileName = `${timestamp}-${safeName}`;
    const destPath = path.join(uploadsDir, fileName);

    // Mover archivo desde tmp de multer al destino final
    fs.copyFileSync(req.file.path, destPath);
    fs.removeSync(req.file.path);

    console.log(`[UPLOAD-IMAGE] SUCCESS: ${fileName} saved to ${destPath}`);

    res.json({
      success: true,
      data: {
        fileName,
        originalName: req.file.originalname,
        url: `/uploads/${fileName}`,
        size: req.file.size,
        mimetype: req.file.mimetype
      }
    });
  } catch (error) {
    console.error('[UPLOAD-IMAGE] ERROR:', error);
    res.status(500).json({ error: 'Error al guardar la imagen', details: error.message });
  }
});

// Endpoint para subir y procesar aplicación Next.js
app.post('/api/upload', upload.single('zipFile'), async (req, res) => {
  console.log('[UPLOAD] Received upload request');

  if (!req.file) {
    console.log('[ERROR] No ZIP file provided in request.');
    return res.status(400).json({ error: 'No se proporcionó archivo ZIP' });
  }

  console.log('[SUCCESS] ZIP file received:', req.file.originalname);
  
  // Mutex: evitar cargas concurrentes que bloquean limpieza
  if (uploadInProgress) {
    console.warn('[WARN] Upload rejected: render already in progress');
    return res.status(409).json({ error: 'Ya hay un render en curso. Intenta nuevamente en unos segundos.' });
  }

  // ✅ LIMPIEZA TOTAL: Resetear el proyecto actual antes de procesar el nuevo
  currentProject = null;
  console.log('[UPLOAD] Estado currentProject reseteado.');
  
  // Wait for any ongoing cleanup to complete before starting new upload
  let cleanupWaitCount = 0;
  while (cleanupInProgress && cleanupWaitCount < 20) { // Wait up to 20 seconds
    console.log(`[UPLOAD] Waiting for cleanup to complete... (${cleanupWaitCount + 1}/20)`);
    await sleep(1000);
    cleanupWaitCount++;
  }
  
  if (cleanupInProgress) {
    console.error('[UPLOAD] Cleanup did not complete in time, proceeding anyway');
  }
  
  uploadInProgress = true;

  // Limpiar proyecto anterior antes de empezar
  console.log('[UPLOAD] Cleaning previous project before starting new upload');
  await cleanupCurrentProject().catch((e) => {
    console.warn('[UPLOAD] cleanupCurrentProject() non-fatal error:', e?.message || e);
  });
  console.log('[SUCCESS] Previous project cleaned (if existed).');

  // Usar projectId de PocketBase si se proporciona, de lo contrario generar uno nuevo
  // ✅ BUSQUEDA ROBUSTA: Intentar obtener el ID de múltiples fuentes
  const projectId = req.body.existingProjectId || 
                    req.query.projectId || 
                    req.headers['x-project-id'] || 
                    uuidv4();
                    
  console.log(`[UPLOAD] 🆔 Identificador detectado: ${projectId} (Fuente: ${req.body.existingProjectId ? 'Body' : req.query.projectId ? 'Query' : req.headers['x-project-id'] ? 'Header' : 'Generado'})`);

  const zipPath = req.file.path;
  const projectPath = currentProjectBasePath;
  console.log(`[PROCESS] Starting processing for project ${projectId}. ZIP at: ${zipPath}, Extraction path: ${projectPath}`);

  try {
    // Limpieza preventiva siempre, aunque no haya currentProject (por si quedó residuo de un crash)
    try {
      await robustRemove(projectPath);
    } catch (preCleanErr) {
      console.warn(`[UPLOAD] Could not pre-clean ${projectPath}:`, preCleanErr.message);
    }

    await extractZip(zipPath, projectPath);
    console.log(`[SUCCESS] ZIP extracted for project ${projectId}`);
    
    // Log extracted contents to debug structure
    try {
      const extractedContents = fs.readdirSync(projectPath);
      console.log(`[DEBUG] Extracted contents in ${projectPath}:`, extractedContents);
      
      // Check if package.json is in root
      const hasPackageJson = extractedContents.includes('package.json');
      console.log(`[DEBUG] Has package.json in root?`, hasPackageJson);
      
      // If not in root, check if there's a single subdirectory
      if (!hasPackageJson && extractedContents.length === 1) {
        const subDir = path.join(projectPath, extractedContents[0]);
        const subDirStats = fs.statSync(subDir);
        if (subDirStats.isDirectory()) {
          console.log(`[DEBUG] Found single subdirectory: ${extractedContents[0]}, checking contents...`);
          const subDirContents = fs.readdirSync(subDir);
          console.log(`[DEBUG] Subdirectory contents:`, subDirContents);
        }
      }
    } catch (debugErr) {
      console.error(`[DEBUG] Error reading extracted contents:`, debugErr);
    }
    
    fs.removeSync(zipPath); // Limpiar ZIP después de extraer
    console.log(`[CLEAN] Temporary ZIP removed: ${zipPath}`);

    // Responder inmediatamente
    res.status(202).json({
      success: true,
      projectId,
      message: 'Proyecto recibido, iniciando despliegue.'
    });
    console.log(`[RESPONSE] 202 response sent for project ${projectId}.`);

    // Iniciar proceso de instalación y despliegue en segundo segundo plano
    (async () => {
      let actualProjectPath = projectPath;
      try {
        let packageJsonPath = path.join(projectPath, 'package.json');
        console.log(`[SEARCH] Looking for package.json at: ${packageJsonPath}`);

        if (!fs.existsSync(packageJsonPath)) {
          console.log('[WARN] package.json not found in root, searching in subdirectories.');
          const items = fs.readdirSync(projectPath);
          const subDirs = items.filter(item => fs.statSync(path.join(projectPath, item)).isDirectory());
          for (const subDir of subDirs) {
            const subPackageJsonPath = path.join(projectPath, subDir, 'package.json');
            if (fs.existsSync(subPackageJsonPath)) {
              packageJsonPath = subPackageJsonPath;
              actualProjectPath = path.join(projectPath, subDir);
              console.log(`[SUCCESS] package.json found in subdirectory: ${actualProjectPath}`);
              break;
            }
          }
        }

        if (!fs.existsSync(packageJsonPath)) {
          console.error('[ERROR] Error: package.json not found after searching.');
          throw new Error('No se encontró package.json');
        }

        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        console.log('[SUCCESS] package.json loaded.');
        if (!packageJson.dependencies || !packageJson.dependencies.next) {
          console.error('[ERROR] Error: Not a Next.js project.');
          throw new Error('No es un proyecto Next.js');
        }
        console.log('[SUCCESS] Project verified as Next.js.');

        currentProject = {
          projectId,
          path: path.resolve(actualProjectPath),
          status: 'installing',
          createdAt: new Date(),
          errorLogged: false
        };
        console.log(`[STATUS] Project ${projectId} status updated to 'installing'.`);

        console.log(`[INSTALL] Running npm install in ${actualProjectPath}`);
        await runNpmCommand(actualProjectPath, 'install');
        console.log(`[SUCCESS] npm install completed.`);
        
        // Check if project uses concurrently and install it if needed
        try {
          const pkgJsonPath = path.join(actualProjectPath, 'package.json');
          const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
          const devScript = (pkg.scripts && pkg.scripts.dev) ? String(pkg.scripts.dev) : '';
          
          if (devScript.includes('concurrently')) {
            console.log(`[INSTALL] Project uses concurrently, ensuring it's installed...`);
            try {
              await runNpmCommand(actualProjectPath, 'install concurrently --save-dev');
              console.log(`[SUCCESS] concurrently installed successfully.`);
            } catch (concurrentlyError) {
              console.warn(`[WARN] Failed to install concurrently:`, concurrentlyError.message);
            }
          }
        } catch (checkError) {
          console.warn(`[WARN] Could not check for concurrently dependency:`, checkError.message);
        }
        
        console.log(`[INSTALL] Running npm audit fix --force in ${actualProjectPath}`);
        try {
          await runNpmCommand(actualProjectPath, 'audit fix --force');
          console.log(`[SUCCESS] npm audit fix --force completed.`);
        } catch (auditError) {
          console.warn(`[WARN] npm audit fix failed, continuing with deployment:`, auditError.message);
          // Continue with deployment even if audit fix fails
        }

        currentProject.status = 'starting';
        console.log(`[STATUS] Project ${projectId} status updated to 'starting'.`);

        console.log(`[START] Starting development server for ${projectId}`);
        const serverInfo = await startDevServer(actualProjectPath, projectId, previewPort);
        console.log(`[SUCCESS] Development server started for ${projectId} at ${serverInfo.url}`);

        currentProject.status = 'ready';
        currentProject.serverInfo = serverInfo;
        console.log(`[READY] Project ${projectId} ready and URL assigned.`);

      } catch (error) {
        console.error(`[ERROR] Error in project deployment ${projectId}:`, error);
        if (currentProject) {
          currentProject.status = 'error';
          currentProject.error = error.message;
          console.error(`[ERROR] Project ${projectId} status updated to 'error': ${error.message}`);
        }
      } finally {
        uploadInProgress = false;
      }
    })();

  } catch (error) {
    console.error('[ERROR] Error processing ZIP:', error);
    res.status(500).json({
      error: 'Error procesando archivo ZIP',
      details: error.message
    });
    uploadInProgress = false;
  }
});





// Endpoint para verificar el estado de un proyecto
app.get('/api/project-status/:id', (req, res) => {
  const projectId = req.params.id;

  if (!currentProject || currentProject.projectId !== projectId) {
    return res.status(404).json({ error: 'Proyecto no encontrado' });
  }

  res.json({
    projectId: currentProject.projectId,
    status: currentProject.status,
    url: currentProject.serverInfo ? currentProject.serverInfo.url : null,
    error: currentProject.error || null
  });
});

// Endpoint para servir el script del selector de componentes
app.get('/component-selector.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.sendFile(path.join(__dirname, 'public', 'component-selector.js'));
});

// Endpoint para detener y limpiar el proyecto actual
app.delete('/api/project/:id', async (req, res) => {
  const projectId = req.params.id;
  console.log(`[DELETE] Received request to delete project: ${projectId}`);
  
    // Check if we're already cleaning up
  if (cleanupInProgress) {
    console.log(`[DELETE] Cleanup already in progress for project ${projectId}`);
    return res.status(202).json({ 
      success: true, 
      message: 'Limpieza en progreso',
      reminder: true 
    });
  }
  
  try {
    if (currentProject && currentProject.projectId === projectId) {
      console.log(`[DELETE] Project ${projectId} found, initiating cleanup...`);
      // Clean up error logs for this specific project
      cleanupProjectErrorLogs(projectId);
      const ok = await cleanupCurrentProject();
      if (ok) {
        console.log(`[DELETE] Project ${projectId} deleted successfully`);
        return res.json({ 
          success: true, 
          message: 'Proyecto detenido y eliminado',
          reminder: true 
        });
      } else {
        console.log(`[DELETE] Cleanup failed for project ${projectId}`);
        return res.status(500).json({ 
          error: 'Error al limpiar el proyecto',
          reminder: true 
        });
      }
    } else {
      console.log(`[DELETE] Project ${projectId} not found in current project, checking if cleanup needed...`);
      // Even if the project doesn't match, we might still need to clean up residual files
      const pathToClean = currentProjectBasePath;
      if (fs.existsSync(pathToClean)) {
        console.log(`[DELETE] Found residual files, performing cleanup...`);
        // Clean up error logs for this project if we have an ID
        if (projectId) {
          cleanupProjectErrorLogs(projectId);
        }
        await cleanupCurrentProject();
        console.log(`[DELETE] Residual files cleaned up`);
        return res.json({ 
          success: true, 
          message: 'Archivos residuales eliminados',
          reminder: true 
        });
      }
      // If we have a project ID but no current project, still clean up its logs
      if (projectId) {
        cleanupProjectErrorLogs(projectId);
        return res.json({ 
          success: true, 
          message: 'Logs del proyecto eliminados',
          reminder: true 
        });
      }
      return res.status(404).json({ error: 'Proyecto no encontrado' });
    }
  } catch (err) {
    console.error(`[DELETE] Error deleting project ${projectId}:`, err);
    // Ensure cleanup flag is reset
    cleanupInProgress = false;
    currentProject = null;
    return res.status(500).json({ error: 'Error al eliminar proyecto', details: err.message });
  }
});

// Endpoint para obtener el proyecto activo actual
app.get('/api/current-project', (req, res) => {
  if (currentProject && currentProject.status === 'ready') {
    res.json({
      projectId: currentProject.projectId,
      previewUrl: currentProject.serverInfo.url,
      projectPath: currentProject.path // Exponer la ruta real del proyecto
    });
  } else {
    res.status(404).json({ error: 'No hay ningÃºn proyecto activo' });
  }
});

// Function to check if a project is a mobile app
function isMobileApp(projectPath) {
  try {
    console.log(`[MobileAppCheck] Checking if project at ${projectPath} is a mobile app`);
    
    // Check if package.json exists and has Capacitor dependencies
    const packageJsonPath = path.join(projectPath, 'package.json');
    console.log(`[MobileAppCheck] Looking for package.json at ${packageJsonPath}`);
    
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      console.log(`[MobileAppCheck] package.json found, checking for Capacitor dependencies`);

      // Helper: search a dependency in deps, devDeps, and peerDeps
      function hasDep(name) {
        return (
          (packageJson.dependencies && packageJson.dependencies[name] !== undefined) ||
          (packageJson.devDependencies && packageJson.devDependencies[name] !== undefined) ||
          (packageJson.peerDependencies && packageJson.peerDependencies[name] !== undefined)
        );
      }

      const hasCapacitorCore = hasDep('@capacitor/core');
      const hasCapacitorCli = hasDep('@capacitor/cli');
      const hasCapacitorAndroid = hasDep('@capacitor/android');

      // Also check for Capacitor scripts
      const hasCapacitorScripts = packageJson.scripts && (
        packageJson.scripts['cap'] ||
        packageJson.scripts['cap-add-android'] ||
        packageJson.scripts['build-apk']
      );

      console.log(`[MobileAppCheck] Dependencies - Core: ${hasCapacitorCore}, CLI: ${hasCapacitorCli}, Android: ${hasCapacitorAndroid}`);
      console.log(`[MobileAppCheck] Scripts - Cap: ${!!packageJson.scripts?.cap}, Build APK: ${!!packageJson.scripts?.['build-apk']}`);

      const isMobile = hasCapacitorCore || hasCapacitorCli || hasCapacitorAndroid || hasCapacitorScripts;
      console.log(`[MobileAppCheck] Project is mobile app: ${isMobile}`);

      // If it's not detected as mobile, let's log the package.json for debugging
      if (!isMobile) {
        console.log(`[MobileAppCheck] Full package.json dependencies:`, packageJson.dependencies);
        console.log(`[MobileAppCheck] Full package.json devDependencies:`, packageJson.devDependencies);
        console.log(`[MobileAppCheck] Full package.json scripts:`, packageJson.scripts);
      }

      return isMobile;
    }
    
    // Check for Capacitor config files
    const capacitorConfigTs = path.join(projectPath, 'capacitor.config.ts');
    const capacitorConfigJs = path.join(projectPath, 'capacitor.config.js');
    
    const hasConfigTs = fs.existsSync(capacitorConfigTs);
    const hasConfigJs = fs.existsSync(capacitorConfigJs);
    
    console.log(`[MobileAppCheck] Checking for Capacitor config files - TS: ${hasConfigTs}, JS: ${hasConfigJs}`);
    
    return hasConfigTs || hasConfigJs;
  } catch (error) {
    console.error('[ERROR] Error checking if project is mobile app:', error);
    return false;
  }
}

// Endpoint to check if current project is a mobile app
app.get('/api/is-mobile-app', (req, res) => {
  let projectPath = currentProject?.path;
  if (!projectPath) {
    const fallbackPath = currentProjectBasePath;
    if (fs.existsSync(fallbackPath)) {
      projectPath = fallbackPath;
      console.log('[is-mobile-app] Using fallback project path:', projectPath);
    } else {
      return res.status(404).json({ error: 'No project loaded' });
    }
  }

  const isMobile = isMobileApp(projectPath);
  res.json({ isMobileApp: isMobile });
});

// Endpoint to check if current project is a desktop/Electron app
app.get('/api/is-desktop-app', (req, res) => {
  let projectPath = currentProject?.path;
  if (!projectPath) {
    const fallbackPath = currentProjectBasePath;
    if (fs.existsSync(fallbackPath)) {
      projectPath = fallbackPath;
      console.log('[is-desktop-app] Using fallback project path:', projectPath);
    } else {
      return res.status(404).json({ error: 'No project loaded' });
    }
  }

  const isDesktop = isDesktopApp(projectPath);
  res.json({ isDesktopApp: isDesktop });
});

// Function to check if a project is a desktop/Electron app
function isDesktopApp(projectPath) {
  try {
    const packageJsonPath = path.join(projectPath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) return false;
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const scripts = packageJson.scripts || {};
    return !!(scripts['electron:dev'] || scripts['electron:build']);
  } catch (e) {
    return false;
  }
}

// Helper: determina si es proyecto local (no guardado en PocketBase)
function isLocalElectronProject(projectId) {
  if (!projectId || typeof projectId !== 'string') return true;
  const lower = projectId.toLowerCase();
  if (lower === 'local-project' || lower === 'current-project') return true;
  // IDs de PocketBase suelen ser ~15 caracteres alfanuméricos
  if (projectId.length < 10) return true;
  return false;
}

// Helper: busca el archivo instalador (.exe) de Electron en la carpeta dist (recursivamente)
function findInstallerFile(distPath) {
  try {
    if (!fs.existsSync(distPath)) return null;
    const entries = fs.readdirSync(distPath, { withFileTypes: true });
    for (const e of entries) {
      const fullPath = path.join(distPath, e.name);
      if (e.isFile() && e.name.endsWith('.exe') && e.name.includes('Setup')) return fullPath;
      if (e.isDirectory()) {
        const found = findInstallerFile(fullPath); // Recursive call
        if (found) return found;
      }
    }
  } catch (e) {
    console.warn(`[findInstallerFile] Error reading directory ${distPath}: ${e.message}`);
  }
  return null;
}

// Function to upload the Electron installer file directly to PocketBase
// Returns { success: boolean, pbRecordId?: string, fileName?: string, error?: string }
async function uploadElectronInstallerToPocketBase(projectId, projectPath, userToken) {
  console.log(`[UPLOAD-INSTALLER] Iniciando subida del instalador para projectId: ${projectId} desde projectPath: ${projectPath}`);
  
  const distPath = path.join(projectPath, 'dist');
  const installerFullPath = findInstallerFile(distPath);

  if (!installerFullPath || !fs.existsSync(installerFullPath)) {
    console.error('[UPLOAD-INSTALLER] ❌ No se encontró el archivo instalador (.exe) en la carpeta dist.');
    return { success: false, error: 'Instalador no encontrado en dist' };
  }

  let installerSize = 0;
  try {
    const stats = fs.statSync(installerFullPath);
    installerSize = stats.size;
  } catch (e) {
    console.error(`[UPLOAD-INSTALLER] Error al obtener el tamaño del instalador ${installerFullPath}: ${e.message}`);
    return { success: false, error: 'No se pudo obtener tamaño del instalador' };
  }
  console.log(`[UPLOAD-INSTALLER] Instalador encontrado: ${installerFullPath}, tamaño: ${installerSize} bytes.`);

  if (installerSize === 0) {
    console.error('[UPLOAD-INSTALLER] ❌ El archivo instalador está vacío.');
    return { success: false, error: 'Archivo instalador vacío' };
  }

  // PocketBase authentication and upload logic (reusing existing helpers)
  const pocketBaseUrl = process.env.POCKETBASE_URL || process.env.NEXT_PUBLIC_POCKETBASE_URL || 'https://zeus-basedatos.fly.dev';
  const superuserToken = process.env.PB_SUPERUSER_TOKEN || process.env.POCKETBASE_ADMIN_TOKEN || process.env.PB_ADMIN_TOKEN || process.env.ADMIN_TOKEN;
  const adminEmail = process.env.POCKETBASE_ADMIN_EMAIL || process.env.POCKETBASE_EMAIL || process.env.NEXT_PUBLIC_POCKETBASE_EMAIL;
  const adminPass = process.env.POCKETBASE_ADMIN_PASSWORD || process.env.POCKETBASE_PASSWORD || process.env.NEXT_PUBLIC_POCKETBASE_PASSWORD;

  // Prefiere token de admin/superuser para asegurar permisos de actualización; userToken solo como último recurso
  let token = superuserToken || null;

  // Intentar admin auth si no hay superuser
  if (!token && adminEmail && adminPass) {
    if (!PocketBase) {
      try {
        const pbModule = await import('pocketbase');
        PocketBase = pbModule.default || pbModule;
        console.log('[UPLOAD-INSTALLER] PocketBase SDK loaded successfully.');
      } catch (e) {
        console.warn('[UPLOAD-INSTALLER] ⚠️ PocketBase SDK no disponible (usando auth basado en fetch):', e.message);
        PocketBase = null;
      }
    }

    if (PocketBase) {
      try {
        const pb = new PocketBase(pocketBaseUrl);
        await pb.admins.authWithPassword(adminEmail, adminPass); // Prefer admin auth for server-side
        token = pb.authStore.token;
        console.log('[UPLOAD-INSTALLER] ✅ Autenticación admin de PocketBase exitosa (SDK).');
      } catch (e) {
        console.error('[UPLOAD-INSTALLER] ❌ Falló la autenticación admin de PocketBase (SDK):', e.message);
      }
    }

    if (!token) {
      try {
        const adminAuthUrl = `${pocketBaseUrl}/api/admins/auth-with-password`;
        const adminAuthResponse = await fetch(adminAuthUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identity: adminEmail, password: adminPass })
        });
        if (adminAuthResponse.ok) {
          const adminAuthData = await adminAuthResponse.json();
          token = adminAuthData.token || adminAuthData.accessToken;
          console.log('[UPLOAD-INSTALLER] ✅ Autenticación admin de PocketBase exitosa (fetch).');
        } else {
          const errText = await adminAuthResponse.text().catch(() => 'Error desconocido.');
          console.error(`[UPLOAD-INSTALLER] ❌ Falló la autenticación admin de PocketBase (fetch). Estado: ${adminAuthResponse.status}, Error: ${errText}`);
        }
      } catch (e) {
        console.error('[UPLOAD-INSTALLER] ❌ Error de red durante la autenticación de PocketBase:', e.message);
      }
    }
  }

  // Último recurso: userToken si no hay tokens admin
  if (!token && userToken) {
    token = userToken;
    console.log('[UPLOAD-INSTALLER] ⚠️ Usando userToken como último recurso para subir instalador.');
  }

  if (!token) {
    console.error('[UPLOAD-INSTALLER] ❌ No se pudo obtener un token para PocketBase.');
    return { success: false, error: 'Token PocketBase no disponible' };
  }

  // Upload the installer file
  try {
    // Comprimir el .exe en un ZIP temporal antes de subir
    let archiver;
    try {
      archiver = require('archiver');
    } catch (e) {
      console.error('[UPLOAD-INSTALLER] ❌ No se pudo cargar archiver para comprimir instalador:', e.message);
      return { success: false, error: 'Archiver no disponible en servidor' };
    }

    const zipFileName = `${path.basename(installerFullPath).replace(/\.exe$/i, '') || 'installer'}.zip`;
    const tempZipPath = path.join(os.tmpdir(), zipFileName);

    const zipResult = await new Promise((resolve) => {
      try {
        const output = fs.createWriteStream(tempZipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => {
          resolve({ ok: true, size: archive.pointer() });
        });
        output.on('error', (err) => resolve({ ok: false, error: err }));
        archive.on('error', (err) => resolve({ ok: false, error: err }));

        archive.pipe(output);
        archive.file(installerFullPath, { name: path.basename(installerFullPath) });
        archive.finalize();
      } catch (err) {
        resolve({ ok: false, error: err });
      }
    });

    if (!zipResult.ok) {
      console.error('[UPLOAD-INSTALLER] ❌ Error al crear ZIP del instalador:', zipResult.error?.message || zipResult.error);
      return { success: false, error: 'No se pudo comprimir instalador' };
    }
    console.log(`[UPLOAD-INSTALLER] ZIP creado para instalador. Nombre: ${zipFileName}, tamaño: ${zipResult.size} bytes.`);

    const installerBuffer = fs.readFileSync(tempZipPath);
    
    let FormDataClass;
    let useNativeFormData = false;

    // Check if native FormData is available (Node 18+)
    if (typeof globalThis.FormData !== 'undefined' && typeof globalThis.Blob !== 'undefined') {
      FormDataClass = globalThis.FormData;
      useNativeFormData = true;
      console.log('[UPLOAD-INSTALLER] Usando FormData nativo (Node 18+).');
    } else {
      // Fallback a formdata-node package
      try {
        const { FormData } = require('formdata-node');
        FormDataClass = FormData;
        console.log('[UPLOAD-INSTALLER] Usando formdata-node package.');
      } catch (e) {
        console.error('[UPLOAD-INSTALLER] ❌ FormData no disponible. Instala formdata-node package o usa Node 18+');
        return { success: false, error: 'FormData no disponible en servidor' };
      }
    }
    
    const formData = new FormDataClass();
    
    if (useNativeFormData) {
      const blob = new globalThis.Blob([installerBuffer], { type: 'application/octet-stream' });
      formData.append('project_installer', blob, zipFileName);
    } else {
      formData.append('project_installer', installerBuffer, {
        filename: zipFileName,
        contentType: 'application/octet-stream'
      });
    }
    // Reafirmar metadatos mínimos por si el modelo de datos los requiere en PATCH
    if (projectPath) {
      formData.append('path', projectPath);
      formData.append('path_local', projectPath);
    }
    if (projectId) {
      formData.append('name', `Electron Project - ${path.basename(projectPath || projectId)}`);
    }

    const headers = { 'Authorization': `Bearer ${token}` };
    
    // Only get headers with boundary if not using native FormData
    // Native FormData handles Content-Type automatically with fetch
    if (!useNativeFormData && formData.getHeaders) {
      Object.assign(headers, formData.getHeaders()); // Añadir headers con boundary de FormData
    }

    let resolvedRecordId = await resolvePocketBaseProjectRecordId(pocketBaseUrl, token, projectId, projectPath);
    // Remove the unused and problematic effectiveRecordId redeclaration
    // const effectiveRecordId = resolvedRecordId || projectId;
        
        let projectExists = !!resolvedRecordId;

        if (!projectExists) {
            console.log(`[UPLOAD-INSTALLER] Proyecto con ID '${projectId}' (o ruta) no encontrado en PocketBase. Intentando crear (POST) un nuevo registro.`);
            const createUrl = `${pocketBaseUrl}/api/collections/projects/records`;
            
            // Add fields for new project creation. 'name' y 'path' son suficientes aquí.
            formData.append('name', `Electron Project - ${path.basename(projectPath)}`);
            formData.append('path', projectPath);

            console.log(`[UPLOAD-INSTALLER] Intentando crear (POST) un nuevo proyecto en PocketBase en URL: ${createUrl}`);
            const createRes = await fetch(createUrl, {
                method: 'POST',
                headers: headers,
                body: formData
            });

            if (createRes.ok) {
                const createData = await createRes.json().catch(() => ({}));
                resolvedRecordId = createData.id; // Get the newly created PocketBase record ID
                console.log(`[UPLOAD-INSTALLER] ✅ Nuevo registro de proyecto creado exitosamente en PocketBase. ID: ${resolvedRecordId}`);
                return {
                  success: true,
                  pbRecordId: resolvedRecordId,
                  fileName: zipFileName
                };
            } else {
                const createErrText = await createRes.text().catch(() => 'Error desconocido.');
                console.error(`[UPLOAD-INSTALLER] ❌ Falló la creación del nuevo registro de proyecto. Estado: ${createRes.status}, Error: ${createErrText}`);
                return { success: false, error: `Falló creación de registro: ${createRes.status}` };
            }
        } else {
            console.log(`[UPLOAD-INSTALLER] Proyecto con ID de PocketBase '${resolvedRecordId}' encontrado. Intentando actualizar (PATCH).`);

            // Prefer PocketBase SDK if disponible
            if (PocketBase) {
              try {
                const pb = new PocketBase(pocketBaseUrl);
                pb.authStore.save(token, null);
                const updateRes = await pb.collection('projects').update(resolvedRecordId, formData);
                if (updateRes?.id) {
                  console.log('[UPLOAD-INSTALLER] ✅ Instalador subido vía PocketBase SDK.');
                  return {
                    success: true,
                    pbRecordId: resolvedRecordId,
                    fileName: zipFileName
                  };
                }
              } catch (sdkErr) {
                const sdkData = sdkErr?.data || sdkErr?.response?.data;
                console.error('[UPLOAD-INSTALLER] ⚠️ Falló actualización con SDK, se intentará con fetch:', sdkErr?.message || sdkErr);
                if (sdkData) console.error('[UPLOAD-INSTALLER][SDK] Detalle de error:', JSON.stringify(sdkData).substring(0,500));
              }
            }

            const updateUrl = `${pocketBaseUrl}/api/collections/projects/records/${resolvedRecordId}`;
            const uploadRes = await fetch(updateUrl, {
                method: 'PATCH',
                headers: headers,
                body: formData
            });

            if (uploadRes.ok) {
                console.log('[UPLOAD-INSTALLER] ✅ Instalador de Electron subido y actualizado en PocketBase.');
                return {
                  success: true,
                  pbRecordId: resolvedRecordId,
                  fileName: zipFileName
                };
            } else {
                let errText = await uploadRes.text().catch(() => 'Error desconocido.');
                let errJson = null;
                try { errJson = JSON.parse(errText); } catch (_) {}
                if (errJson?.data) {
                  console.error('[UPLOAD-INSTALLER][FETCH] Detalle de error data:', JSON.stringify(errJson.data).substring(0,500));
                }
                console.error(`[UPLOAD-INSTALLER] ❌ Falló la subida del instalador. Estado: ${uploadRes.status}, Error: ${errText}`);
                return { success: false, error: `Falló subida instalador: ${uploadRes.status}` };
            }
        }
    } catch (error) {
      console.error('[UPLOAD-INSTALLER] ❌ Error general:', error.message);
      return { success: false, error: error.message };
    }
    finally {
      try { fs.unlinkSync(tempZipPath); } catch (_) {}
    }
  }


// Endpoint to run Electron commands (electron:dev, electron:build) on the local preview server
app.post('/api/run-electron-command', async (req, res) => {
  const { command, projectId: reqProjectId, userToken, projectPath: reqProjectPath } = req.body || {};

  // Prefer currentProject.path (ya validado e instalado) y usar request como fallback
  let projectPath = currentProject?.path ? path.resolve(currentProject.path) : (reqProjectPath ? path.resolve(reqProjectPath) : null);
  let projectPathSource = currentProject?.path ? 'currentProject' : (reqProjectPath ? 'request' : 'none');

  if (!projectPath || !fs.existsSync(projectPath)) {
    let fallbackPath = path.resolve(currentProjectBasePath);
    if (fs.existsSync(fallbackPath)) {
      projectPath = fallbackPath;
      projectPathSource = 'currentProjectBasePath';
    } else if (fs.existsSync(installedPreviewPath)) {
      projectPath = installedPreviewPath;
      projectPathSource = 'installedPreviewPath';
    } else {
      console.error('[run-electron-command] No proyecto:', { projectsDir, fallbackPath, installedPreviewPath });
      return res.status(404).json({ error: 'No hay proyecto cargado en el servidor de vista previa.' });
    }
  }
  projectPath = path.resolve(projectPath);

  const allowedCommands = ['npm run electron:dev', 'npm run electron:build'];
  if (!command || !allowedCommands.includes(command)) {
    return res.status(400).json({ error: 'Comando no permitido. Usa: npm run electron:dev o npm run electron:build' });
  }

  if (!isDesktopApp(projectPath)) {
    return res.status(400).json({ error: 'El proyecto actual no es una aplicación de escritorio (Electron).' });
  }

  const projectId = reqProjectId || currentProject?.projectId || null;

  // Si no hay currentProject, inicializarlo con la ruta proporcionada
  if (!currentProject) {
    currentProject = {
      projectId: projectId || 'local-project',
      path: projectPath,
      status: 'ready',
      createdAt: new Date(),
      errorLogged: false,
      serverInfo: null
    };
    console.log('[run-electron-command] currentProject inicializado desde request');
  }

  // Asegurar que el dev server esté corriendo antes de levantar Electron
  if (!currentProject.serverInfo) {
    try {
      console.log('[run-electron-command] No hay dev server activo. Iniciando startDevServer...');
      const serverInfo = await startDevServer(projectPath, projectId || 'local-project', previewPort);
      currentProject.serverInfo = serverInfo;
      console.log('[run-electron-command] Dev server iniciado en', serverInfo?.url || 'desconocido');
    } catch (e) {
      console.error('[run-electron-command] ❌ No se pudo iniciar el dev server antes de Electron:', e?.message || e);
      return res.status(500).json({ error: 'No se pudo iniciar el servidor de desarrollo', details: e?.message || String(e) });
    }
  }

  const isLocalProject = isLocalElectronProject(projectId);

  try {
    const isDev = command.includes('electron:dev');
    console.log(`[run-electron-command] Ejecutando en local: ${command} (proyecto: ${projectPath}, source: ${projectPathSource}, projectId: ${projectId}, isLocal: ${isLocalProject})`);

    if (isDev) {
      // electron:dev: NO ejecutar npm run (el package.json puede tener concurrently con next dev).
      // El preview server YA tiene next dev en 3000. Solo lanzamos: wait-on + electron.
      const isWin = process.platform === 'win32';
      const shellCmd = 'npx wait-on http://localhost:8741 && npx electron .';
      const proc = spawn(isWin ? 'cmd' : 'sh', [isWin ? '/c' : '-c', shellCmd], {
        cwd: projectPath,
        detached: false,
        stdio: 'inherit',
        shell: false
      });
      proc.on('exit', (code, signal) => {
        console.log(`[run-electron-command] electron:dev proceso finalizado (code=${code}, signal=${signal})`);
      });
      console.log('[run-electron-command] electron:dev iniciado (PID:', proc.pid, ') - salida visible en esta terminal.');
      return res.json({
        success: true,
        message: 'electron:dev iniciado. La ventana de Electron debería abrirse en tu PC (salida visible en la terminal del servidor de vista previa).',
        runningInBackground: false
      });
    } else {
      // electron:build - salida visible en la terminal, al terminar: actualizar ZIP en PB o permitir descarga local
      electronBuildState.inProgress = true;
      electronBuildState.complete = false;
      electronBuildState.success = false;
      electronBuildState.error = null;
      electronBuildState.isLocalProject = isLocalProject;
      electronBuildState.zipUpdatedInPB = false;
      electronBuildState.zipUpdateError = null;
      electronBuildState.projectId = projectId || currentProject?.projectId;

      const proc = spawn('npm', ['run', 'electron:build'], {
        cwd: projectPath,
        detached: false,
        stdio: 'inherit',
        shell: true
      });

      proc.on('close', async (code, signal) => {
        electronBuildState.inProgress = false;
        electronBuildState.complete = true;
        electronBuildState.success = code === 0;
        electronBuildState.error = code !== 0 ? `Build falló (código ${code}${signal ? ', señal ' + signal : ''})` : null;

        if (code === 0) {
          const distPath = path.join(projectPath, 'dist');
          const installerFullPath = findInstallerFile(distPath);
          if (installerFullPath) {
            electronBuildState.installerAvailableForDownload = true;
            electronBuildState.installerFullPath = installerFullPath;
            console.log('[DEBUG-ELECTRON-BUILD] ✅ Instalador disponible para descarga local.');
            // Exponer URL local de descarga y saltar subida a PocketBase
            const relativeDownload = '/api/download-electron-installer';
            const absDownload = previewPort ? `http://127.0.0.1:${previewPort}${relativeDownload}` : relativeDownload;
            electronBuildState.pocketBaseInstallerDownloadUrl = absDownload;
            electronBuildState.zipUpdatedInPB = false;
            electronBuildState.zipUpdateError = 'Uploads to PocketBase deshabilitados (usar descarga local)';
            console.log(`[DEBUG-ELECTRON-BUILD] ⏩ Subida a PocketBase omitida; disponible en ${absDownload}`);
            return;
          } else {
            electronBuildState.installerAvailableForDownload = false;
            electronBuildState.installerFullPath = null;
            console.warn('[DEBUG-ELECTRON-BUILD] ⚠️ Instalador no encontrado en la carpeta dist para descarga local.');
          }

          let effectiveProjectId = projectId || currentProject?.projectId;
          // Si el ID es 'current-project' o 'local-project', intentar usar el ID real si está disponible
          if ((effectiveProjectId === 'current-project' || effectiveProjectId === 'local-project') && currentProject?.projectId) {
            const pbId = currentProject.projectId;
            if (pbId && pbId !== 'current-project' && pbId.toLowerCase() !== 'local-project' && pbId.length >= 10) {
              effectiveProjectId = pbId;
            }
          }

          if (effectiveProjectId && effectiveProjectId !== 'current-project' && effectiveProjectId.toLowerCase() !== 'local-project' && effectiveProjectId.length >= 10) {
            try {
              console.log('[DEBUG-ELECTRON-BUILD] Intentando subir instalador Electron a PocketBase directamente desde Preview Server...');
              const uploadResult = await uploadElectronInstallerToPocketBase(effectiveProjectId, projectPath, userToken);
              if (uploadResult?.success) {
                electronBuildState.zipUpdatedInPB = true;
                electronBuildState.zipUpdateError = null;
                console.log('[DEBUG-ELECTRON-BUILD] ✅ Instalador Electron subido exitosamente a PocketBase.');

                // Construct PocketBase download URL
                const pocketBaseUrl = process.env.POCKETBASE_URL || process.env.NEXT_PUBLIC_POCKETBASE_URL || 'https://zeus-basedatos.fly.dev';
                const collectionName = 'projects'; // Assuming collection is named 'projects'
                const fieldName = 'project_installer';
                const pbRecordIdForUrl = uploadResult.pbRecordId || await resolvePocketBaseProjectRecordId(pocketBaseUrl, userToken, effectiveProjectId, projectPath);

                if (pbRecordIdForUrl && (uploadResult.fileName || electronBuildState.installerFullPath)) {
                    const fileName = uploadResult.fileName || path.basename(electronBuildState.installerFullPath);
                    electronBuildState.pocketBaseInstallerDownloadUrl = `${pocketBaseUrl}/api/files/${collectionName}/${pbRecordIdForUrl}/${fieldName}/${fileName}`;
                    console.log(`[DEBUG-ELECTRON-BUILD] ✅ PocketBase download URL: ${electronBuildState.pocketBaseInstallerDownloadUrl}`);
                } else {
                    console.warn('[DEBUG-ELECTRON-BUILD] ⚠️ No se pudo construir la URL de descarga de PocketBase. Faltan datos.');
                }
              } else {
                electronBuildState.zipUpdatedInPB = false;
                electronBuildState.zipUpdateError = uploadResult?.error || 'Fallo al subir instalador Electron a PocketBase.';
                console.error('[DEBUG-ELECTRON-BUILD] ❌ Fallo al subir instalador Electron a PocketBase.', uploadResult?.error || '');
              }
            } catch (uploadErr) {
              electronBuildState.zipUpdatedInPB = false;
              electronBuildState.zipUpdateError = `Excepción al subir instalador: ${uploadErr.message}`;
              console.error('[DEBUG-ELECTRON-BUILD] ❌ Excepción al intentar subir instalador Electron:', uploadErr);
            }
          } else {
            console.log('[DEBUG-ELECTRON-BUILD] No hay projectId válido para actualizar en PocketBase. El instalador no se subirá automáticamente.');
            electronBuildState.zipUpdatedInPB = false;
            electronBuildState.zipUpdateError = 'No projectId válido para PocketBase';
          }


        }
      });

      console.log('[run-electron-command] electron:build ejecutándose (PID:', proc.pid, ') - la salida se muestra en esta terminal.');
      return res.json({
        success: true,
        message: 'electron:build iniciado. La salida se muestra en la terminal. Al terminar: ' + (isLocalProject ? 'podrás descargar el ZIP' : 'se actualizará el ZIP en PocketBase') + '.',
        runningInBackground: false
      });
    }
  } catch (err) {
    console.error('[run-electron-command] Error:', err.message);
    electronBuildState.inProgress = false;
    electronBuildState.complete = true;
    electronBuildState.success = false;
    electronBuildState.error = err.message;
    return res.status(500).json({
      error: 'Error al ejecutar el comando',
      details: err.message
    });
  }
});

// Estado del build de Electron (para polling del frontend)
app.get('/api/electron-build-status', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json(electronBuildState);
});

// Ruta de instalación del Visor de Vista Previa (donde se construye la app Electron)
// Descargar instalador de Electron (dist/*Setup*.exe) tras electron:build
app.get('/api/download-electron-installer', async (req, res) => {
  console.log('[download-electron-installer] Petición recibida');
  
  let projectPath = currentProject?.path ? path.resolve(currentProject.path) : null;
  if (!projectPath || !fs.existsSync(projectPath)) {
    let fallbackPath = path.resolve(currentProjectBasePath);
    if (fs.existsSync(fallbackPath)) {
      projectPath = fallbackPath;
    } else if (fs.existsSync(installedPreviewPath)) {
      projectPath = installedPreviewPath;
    } else {
      console.error('[download-electron-installer] No proyecto:', { currentProjectPath: currentProject?.path, projectsDir, fallbackPath, installedPreviewPath });
      return res.status(404).json({ error: 'No hay proyecto cargado' });
    }
  }
  
  const distPath = path.join(projectPath, 'dist');
  if (!fs.existsSync(distPath)) {
    console.error('[download-electron-installer] No dist:', { projectPath, distPath });
    return res.status(404).json({ error: 'No existe la carpeta dist. Ejecuta electron:build primero.' });
  }
  
  try {
    // Buscar instalador: *Setup*.exe (ej. MixStation Dual Setup 0.1.0.exe)
    function findInstaller(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const fullPath = path.join(dir, e.name);
        if (e.isFile() && e.name.endsWith('.exe') && e.name.includes('Setup')) return fullPath;
        if (e.isDirectory()) {
          const found = findInstaller(fullPath);
          if (found) return found;
        }
      }
      return null;
    }
    
    const installerPath = findInstaller(distPath);
    if (!installerPath) {
      console.error('[download-electron-installer] No se encontró instalador en:', distPath);
      return res.status(404).json({ error: 'No se encontró el instalador. Ejecuta electron:build primero.' });
    }
    
    const installer = path.basename(installerPath);
    const stats = fs.statSync(installerPath);
    
    console.log('[download-electron-installer] Enviando archivo:', {
      installer,
      path: installerPath,
      size: stats.size,
      modified: stats.mtime
    });
    
    // Headers simples y directos para local
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${installer}"`);
    res.setHeader('Content-Length', stats.size);
    
    // Enviar archivo directamente
    const stream = fs.createReadStream(installerPath);
    stream.pipe(res);
    
  } catch (err) {
    console.error('[download-electron-installer] Error:', err?.message || err);
    if (!res.headersSent) res.status(500).json({ error: 'Error al descargar instalador', details: err?.message });
  }
});

// Descargar ZIP del proyecto (incluyendo dist/) para proyectos locales
app.get('/api/download-project-zip', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  let projectPath = currentProject?.path ? path.resolve(currentProject.path) : null;
  if (!projectPath || !fs.existsSync(projectPath)) {
    let fallbackPath = path.resolve(currentProjectBasePath);
    if (fs.existsSync(fallbackPath)) {
      projectPath = fallbackPath;
    } else if (fs.existsSync(installedPreviewPath)) {
      projectPath = installedPreviewPath;
    } else {
      return res.status(404).json({ error: 'No hay proyecto cargado' });
    }
  }

  let archiver;
  try { archiver = require('archiver'); } catch (e) {
    return res.status(500).json({ error: 'No se puede crear el ZIP (archiver no disponible)' });
  }

  try {
    const archiveName = `project_${currentProject?.projectId || 'current-project'}_${Date.now()}.zip`;
    const tempZipPath = path.join(os.tmpdir(), archiveName);
    const output = fs.createWriteStream(tempZipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.pipe(output);
    output.on('close', () => {
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${archiveName}"`);
      const readStream = fs.createReadStream(tempZipPath);
      readStream.pipe(res);
      readStream.on('end', () => { try { fs.unlinkSync(tempZipPath); } catch (_) {} });
      readStream.on('error', () => { try { fs.unlinkSync(tempZipPath); } catch (_) {} });
    });
    archive.on('error', (err) => {
      try { fs.unlinkSync(tempZipPath); } catch (_) {}
      if (!res.headersSent) res.status(500).json({ error: 'Error al crear ZIP', details: err.message });
    });
    // Incluir todo (incluyendo dist/) - mismo comportamiento que save-archive de Next.js
    archive.directory(projectPath, '');
    await archive.finalize();
  } catch (err) {
    console.error('[download-project-zip] Error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Error al crear ZIP', details: err.message });
  }
});

// Endpoint to build APK for mobile apps
app.post('/api/build-apk', async (req, res) => {
  // Allow client to send explicit projectPath
  let projectPath = req.body?.projectPath || currentProject?.path;
  if (!projectPath) {
    const fallbackPath = currentProjectBasePath;
    if (fs.existsSync(fallbackPath)) {
      projectPath = fallbackPath;
      console.log('[build-apk] Using fallback project path:', projectPath);
    } else {
      return res.status(404).json({ error: 'No project loaded' });
    }
  }

  // Check if it's a mobile app
  const isMobile = isMobileApp(projectPath);
  if (!isMobile) {
    return res.status(400).json({ error: 'Current project is not a mobile app' });
  }

  try {
    console.log(`[BUILD] Building APK for project ${currentProject?.projectId || 'current-project'}`);

    const androidPath = path.join(projectPath, 'android');

    // 1) Add Android platform if missing
    if (!fs.existsSync(androidPath)) {
      console.log('[BUILD] Android platform not found. Adding with npx cap add android...');
      try {
        await runNpmCommand(projectPath, 'run cap add android');
      } catch (addErr) {
        console.warn('[BUILD] cap add android failed, trying npx cap add android...', addErr?.message || addErr);
        try {
          await runNpmCommand(projectPath, 'npx cap add android');
        } catch (addErr2) {
          return res.status(500).json({
            error: 'No se pudo añadir la plataforma Android. Asegúrate de tener Capacitor instalado y ejecuta "npx cap add android" manualmente.',
            details: addErr2.message || String(addErr2)
          });
        }
      }
    }

    // Verify android folder now exists
    if (!fs.existsSync(androidPath)) {
      return res.status(500).json({
        error: 'La carpeta android no existe después de intentar añadir la plataforma. Ejecuta "npx cap add android" manualmente en el proyecto.'
      });
    }

    // 1.5) Ensure debug signing config exists in android/app/build.gradle to avoid "Missing options" error
    const appBuildGradlePath = path.join(androidPath, 'app', 'build.gradle');
    if (fs.existsSync(appBuildGradlePath)) {
      let gradleContent = fs.readFileSync(appBuildGradlePath, 'utf8');

      // Clean any malformed signingConfig inside signingConfigs block from previous attempts
      gradleContent = gradleContent.replace(
        /(signingConfigs\s*\{[\s\S]*?debug\s*\{)([\s\S]*?)(\n\s*\})/,
        (match, open, body, close) => {
          const cleanedBody = body.replace(/\s*signingConfig\s+signingConfigs\.debug\s*,?/g, '');
          return open + cleanedBody + close;
        }
      );

      const debugStorePath = process.platform === 'win32'
        ? "file(System.getenv('USERPROFILE') + '/.android/debug.keystore')"
        : "file(System.getenv('HOME') + '/.android/debug.keystore')";
      const signingBlock = `
    signingConfigs {
        debug {
            storeFile ${debugStorePath}
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }`;

      // Insert signingConfigs before buildTypes if not present
      if (!gradleContent.includes('signingConfigs')) {
        console.log('[BUILD] Adding debug signingConfig to app/build.gradle...');
        if (gradleContent.includes('buildTypes')) {
          gradleContent = gradleContent.replace(
            /(\s+buildTypes\s*\{)/,
            signingBlock + '\n$1'
          );
        } else {
          gradleContent = gradleContent.replace(
            /(\}\s*\}\s*)$/,
            signingBlock + '\n    buildTypes {\n        debug {\n            signingConfig signingConfigs.debug\n        }\n    }\n$1'
          );
        }
      }

      // Ensure buildTypes { debug { ... } } references the signing config
      const buildTypesRegex = /(buildTypes\s*\{)([\s\S]*?)(\n\s*\})/;
      const buildTypesMatch = gradleContent.match(buildTypesRegex);
      if (buildTypesMatch) {
        let buildTypesBody = buildTypesMatch[2];
        if (!buildTypesBody.includes('signingConfig')) {
          buildTypesBody = buildTypesBody.replace(
            /(debug\s*\{)([\s\S]*?)(\n\s*\})/,
            (match, open, body, close) => {
              return open + body + '\n            signingConfig signingConfigs.debug' + close;
            }
          );
          gradleContent = gradleContent.replace(buildTypesRegex, buildTypesMatch[1] + buildTypesBody + buildTypesMatch[3]);
        }
      }

      fs.writeFileSync(appBuildGradlePath, gradleContent, 'utf8');
      console.log('[BUILD] app/build.gradle updated with debug signing config.');
    }

    // 2) Build the Next.js app for static export
    console.log('[BUILD] Building Next.js app for static export...');
    await runNpmCommand(projectPath, 'run build');

    // 3) Copy web assets to Android project
    console.log('[BUILD] Copying web assets to Android project...');
    try {
      await runNpmCommand(projectPath, 'run cap copy');
    } catch (copyErr) {
      console.warn('[BUILD] cap copy failed, trying npx cap sync...', copyErr?.message || copyErr);
      await runNpmCommand(projectPath, 'npx cap sync android');
    }

    // 4) Build the Android APK using Gradle
    console.log('[BUILD] Building Android APK with Gradle...');
    const isWindows = process.platform === 'win32';
    const gradleCmd = isWindows ? 'gradlew.bat' : './gradlew';
    const gradlePath = path.join(androidPath, isWindows ? 'gradlew.bat' : 'gradlew');

    if (!fs.existsSync(gradlePath)) {
      return res.status(500).json({
        error: `No se encontró Gradle wrapper (${gradleCmd}) en la carpeta android. Asegúrate de que la plataforma Android se añadió correctamente.`,
        gradlePath
      });
    }

    const gradleProcess = spawn(gradleCmd, ['assembleDebug'], {
      cwd: androidPath,
      stdio: 'pipe',
      shell: true
    });

    let output = '';
    let errorOutput = '';

    gradleProcess.stdout.on('data', (data) => {
      const chunk = data.toString();
      output += chunk;
      console.log('[GRADLE stdout]', chunk);
    });

    gradleProcess.stderr.on('data', (data) => {
      const chunk = data.toString();
      errorOutput += chunk;
      console.error('[GRADLE stderr]', chunk);
    });

    await new Promise((resolve, reject) => {
      gradleProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Gradle build failed with code ${code}: ${errorOutput || output}`));
        }
      });
    });

    // Look for the APK path
    const apkPath = path.join(projectPath, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');

    if (fs.existsSync(apkPath)) {
      const stats = fs.statSync(apkPath);
      res.json({
        success: true,
        message: 'APK built successfully',
        apkPath: apkPath,
        fileSize: stats.size,
        buildOutput: output
      });
    } else {
      res.status(500).json({
        error: 'APK build completed but file not found',
        buildOutput: output
      });
    }
  } catch (error) {
    console.error(`[ERROR] Error building APK for project ${currentProject?.projectId || 'current-project'}:`, error);
    res.status(500).json({
      error: 'Failed to build APK',
      details: error.message || String(error)
    });
  }
});

// Endpoint to download APK
app.get('/api/download-apk', (req, res) => {
  console.log('[APK Download] Request received, method:', req.method);

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Allow explicit project path or APK path via query param
  let projectPath = req.query?.project || currentProject?.path;
  if (!projectPath) {
    const fallbackPath = currentProjectBasePath;
    if (fs.existsSync(fallbackPath)) {
      projectPath = fallbackPath;
      console.log('[APK Download] Using fallback project path:', projectPath);
    } else {
      console.error('[APK Download] No project loaded');
      return res.status(404).json({ error: 'No project loaded' });
    }
  }

  console.log('[APK Download] Current project path:', projectPath);
  console.log('[APK Download] Current project ID:', currentProject?.projectId || 'current-project');

  try {
    // If the query param is already a direct APK path, use it immediately
    let foundApkPath = null;
    if (projectPath.endsWith('.apk') && fs.existsSync(projectPath)) {
      foundApkPath = projectPath;
      console.log('[APK Download] Using direct APK path from query param:', foundApkPath);
    } else {
      // Check if it's a mobile app before searching
      const isMobile = isMobileApp(projectPath);
      if (!isMobile) {
        console.error('[APK Download] Project is not a mobile app');
        return res.status(400).json({ error: 'Current project is not a mobile app' });
      }

      // Try to find the APK in the default location
      const apkPath = path.join(projectPath, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
      console.log('[APK Download] Looking for APK at:', apkPath);

      if (fs.existsSync(apkPath)) {
        foundApkPath = apkPath;
      } else {
        const alternativePaths = [
          path.join(projectPath, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'),
          path.join(projectPath, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'),
        ];

        for (const altPath of alternativePaths) {
          if (fs.existsSync(altPath)) {
            foundApkPath = altPath;
            console.log(`[APK Download] Found APK in alternative location: ${altPath}`);
            break;
          }
        }
      }
    }
    
    if (foundApkPath && fs.existsSync(foundApkPath)) {
      // Get file stats for headers
      const stats = fs.statSync(foundApkPath);
      console.log(`[APK Download] APK file found: ${foundApkPath} (${stats.size} bytes)`);
      
      // Set headers for file download BEFORE streaming
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Disposition', 'attachment; filename="app-debug.apk"');
      res.setHeader('Content-Length', stats.size);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      
      // If it's a HEAD request, just send headers and end
      if (req.method === 'HEAD') {
        console.log('[APK Download] HEAD request - sending headers only');
        return res.end();
      }
      
      console.log('[APK Download] Headers set, starting file stream...');
      
      // Stream the file
      const fileStream = fs.createReadStream(foundApkPath);
      
      fileStream.on('error', (error) => {
        console.error('[APK Download] Error streaming APK file:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Error downloading APK file', details: error.message });
        } else {
          // If headers were sent, we can't send JSON, just end the response
          res.end();
        }
      });
      
      fileStream.on('end', () => {
        console.log('[APK Download] APK file streamed successfully');
        if (!res.headersSent) {
          res.end();
        }
      });
      
      // Handle client disconnect (but don't log it as an error - it's normal when download completes)
      req.on('close', () => {
        if (fileStream && !fileStream.destroyed) {
          console.log('[APK Download] Client disconnected, cleaning up stream');
          fileStream.destroy();
        }
      });
      
      // Handle response finish
      res.on('finish', () => {
        console.log('[APK Download] Response finished successfully');
      });
      
      res.on('error', (err) => {
        console.error('[APK Download] Response error:', err);
        if (fileStream && !fileStream.destroyed) {
          fileStream.destroy();
        }
      });
      
      // Pipe the file to response
      fileStream.pipe(res);
      
      // Ensure the stream completes
      fileStream.on('end', () => {
        console.log('[APK Download] File stream ended, response should be complete');
      });
      
    } else {
      console.error(`[APK Download] APK file not found. Searched path: ${apkPath}`);
      res.status(404).json({ 
        error: 'APK file not found',
        searchedPath: apkPath,
        projectPath: currentProject.path,
        message: 'El archivo APK no se encontró. Asegúrate de que el build se haya completado correctamente.'
      });
    }
  } catch (error) {
    console.error('[APK Download] Error downloading APK:', error);
    console.error('[APK Download] Error stack:', error.stack);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error downloading APK file', details: error.message });
    }
  }
});

// Endpoint para generar etiquetas de componentes
app.post('/api/component-selector', (req, res) => {
  const { projectId, selector, componentName } = req.body;

  if (!projectId || !selector) {
    return res.status(400).json({ error: 'ProjectId y selector son requeridos' });
  }

  // Generar ID Ãºnico para el componente
  const componentId = uuidv4();
  const componentTag = `<component id="${componentId}" selector="${selector}" name="${componentName || 'Componente'}" />`;

  res.json({
    success: true,
    componentId,
    componentTag,
    selector,
    componentName: componentName || 'Componente'
  });
});

// Endpoint para recibir componentes seleccionados visualmente
app.post('/api/visual-selector', (req, res) => {
  const { selector, action, data } = req.body;

  // Extraer datos de la estructura anidada si existe
  const componentData = data || {};
  const actualSelector = selector;
  const { componentName, tagName, className, id, textContent, position } = componentData;

  if (!actualSelector) {
    return res.status(400).json({ error: 'Selector es requerido' });
  }

  // Generar ID Ãºnico para el componente
  const componentId = uuidv4();
  const timestamp = new Date().toISOString();

  const componentInfo = {
    id: componentId,
    selector: actualSelector,
    componentName: componentName || tagName || 'Componente',
    tagName,
    className,
    elementId: id,
    textContent,
    position,
    timestamp,
    componentTag: `<component id="${componentId}" selector="${actualSelector}" name="${componentName || tagName || 'Componente'}" />`
  };

  console.log('Componente seleccionado visualmente:', componentInfo);
  console.log('Action:', action);
  console.log('Data received:', componentData);

  res.json({
    success: true,
    message: 'Componente seleccionado exitosamente',
    component: componentInfo
  });
});

// Endpoint para actualizar un archivo específico en el proyecto activo
app.post('/api/update-file', async (req, res) => {
  console.log('[UPDATE] Received request to update file');
  console.log('  - Body received:', JSON.stringify(req.body, null, 2));
  console.log('  - Current project status:', JSON.stringify(currentProject, null, 2));


  const { filePath, content, projectId } = req.body;

  if (!filePath || content === undefined) {
    console.log('[ERROR] filePath or content missing in body.');
    return res.status(400).json({ error: 'filePath y content son requeridos' });
  }

  if (!currentProject) {
    console.log('[ERROR] No current project (currentProject is null).');
    return res.status(404).json({ error: 'Proyecto no encontrado o ID no coincide' });
  }

  if (currentProject.projectId !== projectId) {
    console.log(`[ERROR] ProjectId does not match. Expected: ${currentProject.projectId}, Received: ${projectId}`);
    return res.status(404).json({ error: 'El ID del proyecto no coincide' });
  }

  if (currentProject.status !== 'ready') {
    console.log(`[ERROR] Project is not ready. Current status: ${currentProject.status}`);
    return res.status(409).json({ error: 'El proyecto no está listo para recibir actualizaciones' });
  }

  const absoluteFilePath = path.join(currentProject.path, filePath);
  console.log(`[UPDATE] Updating file: ${absoluteFilePath}`);

  try {
    await fs.ensureDir(path.dirname(absoluteFilePath));
    await fs.writeFile(absoluteFilePath, content);

    console.log(`[SUCCESS] File updated successfully: ${absoluteFilePath}`);
    res.json({ success: true, message: `Archivo ${filePath} actualizado.` });
  } catch (error) {
    console.error(`[ERROR] Error updating file ${absoluteFilePath}:`, error);
    res.status(500).json({ error: 'Error al escribir en el archivo', details: error.message });
  }
});

// Endpoint para reiniciar el servidor de desarrollo
app.post('/api/restart-server', async (req, res) => {
  console.log('[RESTART] Received request to restart development server');
  const { projectId } = req.body;

  console.log(`[RESTART] Request for project: ${projectId}`);
  console.log(`[RESTART] Current project state: ${currentProject ? JSON.stringify(currentProject.status) : 'null'}`);


  if (!currentProject || currentProject.projectId !== projectId) {
    console.warn(`[RESTART] Project ${projectId} not found or ID mismatch. Current: ${currentProject ? currentProject.projectId : 'none'}`);
    return res.status(404).json({ error: 'Proyecto no encontrado o ID no coincide' });
  }

  try {
    console.log(`[STOP] Initiating full cleanup and stop for project ${projectId}`);
    // Use cleanupCurrentProject to ensure the process is fully terminated and resources are freed
    await cleanupCurrentProject();
    console.log(`[STOP] Cleanup completed for project ${projectId}.`);

    console.log(`[START] Restarting development server for project ${projectId}`);
    currentProject.status = 'starting';
    const serverInfo = await startDevServer(currentProject.path, projectId, previewPort);

    currentProject.status = 'ready';
    currentProject.serverInfo = serverInfo;

    console.log(`[SUCCESS] Server restarted successfully at ${serverInfo.url}`);
    res.json({ success: true, message: 'Servidor reiniciado', url: serverInfo.url });

  } catch (error) {
    console.error(`[ERROR] Error restarting server for ${projectId}:`, error);
    if (currentProject) {
      currentProject.status = 'error';
      currentProject.error = error.message;
    }
    res.status(500).json({ error: 'Error al reiniciar el servidor', details: error.message });
  }
});

// Endpoint para limpiar todos los logs de error
app.delete('/api/cleanup-logs', (req, res) => {
  console.log('[LOG_CLEANUP] Received request to clean all error logs');
  try {
    cleanupErrorLogs();
    return res.json({ success: true, message: 'Todos los logs de error han sido eliminados' });
  } catch (err) {
    console.error('[LOG_CLEANUP] Error cleaning error logs:', err);
    return res.status(500).json({ error: 'Error al limpiar los logs de error', details: err.message });
  }
});

// Endpoint para limpiar logs de error de un proyecto específico
app.delete('/api/cleanup-logs/:projectId', (req, res) => {
  const projectId = req.params.projectId;
  console.log(`[LOG_CLEANUP] Received request to clean error logs for project: ${projectId}`);
  try {
    cleanupProjectErrorLogs(projectId);
    return res.json({ success: true, message: `Logs de error del proyecto ${projectId} han sido eliminados` });
  } catch (err) {
    console.error(`[LOG_CLEANUP] Error cleaning error logs for project ${projectId}:`, err);
    return res.status(500).json({ error: 'Error al limpiar los logs de error', details: err.message });
  }
});

// PÃ¡gina principal con interfaz
app.get('/', (req, res) => {
  res.sendFile(path.join(baseDir, 'public', 'index.html'));
});

// Iniciar servidor
const startServer = (port) => {
    const server = app.listen(port, () => {
    previewPort = server.address().port;
    console.log(`[START] Preview server running on http://localhost:${previewPort}`); // Changed from emoji to text
    console.log('[INFO] Upload a ZIP file with your Next.js application to begin'); // Changed from emoji to text
  });

  // Initialize WebSocket Server (ANTES del return para que se ejecute)
  wss = new WebSocket.Server({ server });

  wss.on('connection', ws => {
      console.log('[WSS] Client connected');
      
      // Manejar mensajes del cliente
      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          console.log('[WSS] Message received from client:', data.type || 'unknown');
          
          // Responder a peticiones de ping
          if (data.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          }
        } catch (err) {
          console.warn('[WSS] Error parsing client message:', err.message);
        }
      });
      
      ws.on('error', (error) => {
        console.warn('[WSS] WebSocket client error:', error.message);
      });
      
      ws.on('close', (code, reason) => {
        console.log(`[WSS] Client disconnected. Code: ${code}, Reason: ${reason || 'none'}`);
      });
      
      // Enviar mensaje de bienvenida
      try {
        ws.send(JSON.stringify({ 
          type: 'connected', 
          message: 'Connected to preview server',
          timestamp: Date.now()
        }));
      } catch (sendErr) {
        console.warn('[WSS] Error sending welcome message:', sendErr.message);
      }
  });

  wss.on('error', error => {
      console.error('[WSS] WebSocket Server Error:', error);
  });

  wss.on('close', () => {
      console.log('[WSS] WebSocket Server closed.');
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[WARN] Port ${port} in use. Trying next port...`);
      if (port === 8744) {
        startServer(8745);
      } else {
        console.error(`[ERROR] Both ports (8744 and 8745) are in use. Could not start preview server.`);
        process.exit(1);
      }
    } else {
      console.error('[ERROR] Error starting preview server:', err);
      process.exit(1);
    }
  });

  return server;
};


app.post('/api/generate-zeus-id', async (req, res) => {
    const { componentName, componentCode } = req.body;
    console.log(`Generating Zeus ID for component: ${componentName}`);
    // In a real scenario, you would interact with a service to generate a Zeus ID
    // For now, we'll simulate it
    const zeusId = `zeus-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    res.json({ zeusId });
});

// Add a new endpoint for triggering upload and deploy without stopping the project
const http = require('http'); // Import the http module

// ... (código existente)

app.post('/api/trigger-upload-and-deploy', async (req, res) => {
    console.log('Received request to trigger upload and deploy (via internal /api/restart-server call).');
    try {
        if (!currentProject || !currentProject.projectId) {
            return res.status(400).json({ message: 'No hay un proyecto activo para reiniciar.' });
        }

        const internalFetch = async (options) => {
            return new Promise((resolve, reject) => {
                const req = http.request(options, (res) => {
                    let data = '';
                    res.on('data', (chunk) => data += chunk);
                    res.on('end', () => resolve({
                        ok: res.statusCode >= 200 && res.statusCode < 300,
                        status: res.statusCode,
                        json: () => Promise.resolve(JSON.parse(data))
                    }));
                });
                req.on('error', reject);
                if (options.body) req.write(options.body);
                req.end();
            });
        };

        const restartResponse = await internalFetch({
            hostname: 'localhost',
            port: process.env.PORT || 8744, // Use the server's own port
            path: '/api/restart-server',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ projectId: currentProject.projectId })
        });

        if (!restartResponse.ok) {
            throw new Error(`HTTP error! status: ${restartResponse.status}`);
        }

        const restartData = await restartResponse.json();
        res.json({ message: 'Project restart triggered successfully.', details: restartData });

    } catch (error) {
        console.error('Error triggering project restart:', error);
        res.status(500).json({ message: 'Failed to trigger project restart', error: error.message });
    }
});

// Función para iniciar Cloudflare Tunnel automáticamente
let tunnelProcess = null;
let tunnelUrl = null;
// Variable global para almacenar el token del usuario (registrado por la aplicación)
let registeredUserToken = null;

// Función para enviar la URL del túnel a la API de ZEUS
async function sendTunnelUrlToZeusAPI(url) {
  try {
    // Intentar obtener el token del usuario desde:
    // 1. Token registrado por la aplicación (prioridad)
    // 2. Variables de entorno
    const userToken = registeredUserToken || process.env.USER_TOKEN || process.env.ZEUS_USER_TOKEN;
    
    if (!userToken) {
      console.log('[TUNNEL] No hay token de usuario configurado. La URL del túnel no se enviará automáticamente a ZEUS.');
      console.log('[TUNNEL] La aplicación puede registrar su token en /api/register-token para habilitar el envío automático.');
      return;
    }

    // Determinar la URL de la API de ZEUS
    // Si el visor está en el ordenador del usuario, siempre usar la URL de producción
    // porque el visor local necesita conectarse a ZEUS en Vercel, no a localhost
    const zeusApiUrl = process.env.NEXT_PUBLIC_API_URL || 
                       process.env.ZEUS_API_URL || 
                       'https://zeus-ia.com';

    console.log(`[TUNNEL] Enviando URL del túnel a ZEUS API: ${zeusApiUrl}/api/preview-viewer/tunnel-url`);

    const response = await fetch(`${zeusApiUrl}/api/preview-viewer/tunnel-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userToken}`
      },
      body: JSON.stringify({ tunnelUrl: url })
    });

    if (response.ok) {
      const data = await response.json();
      console.log(`[TUNNEL] ✅ URL del túnel enviada exitosamente a ZEUS: ${data.message}`);
    } else {
      const error = await response.text();
      console.warn(`[TUNNEL] ⚠️ Error al enviar URL del túnel a ZEUS: ${response.status} ${error}`);
    }
  } catch (error) {
    console.warn(`[TUNNEL] ⚠️ Error al enviar URL del túnel a ZEUS: ${error.message}`);
  }
}

function startCloudflareTunnel(port) {
  if (process.env.DISABLE_TUNNEL === 'true') {
    console.log('[TUNNEL] Túnel desactivado (DISABLE_TUNNEL=true). No se iniciará cloudflared.');
    return;
  }
  const { spawn } = require('child_process');
  // Buscar cloudflared.exe en la raíz del directorio base (prioridad)
  let cloudflaredPath = path.join(baseDir, 'cloudflared.exe');
  
  // Si no está en la raíz, buscar en public (por si se copió allí)
  if (!fs.existsSync(cloudflaredPath)) {
    const cloudflaredInPublic = path.join(baseDir, 'public', 'cloudflared.exe');
    if (fs.existsSync(cloudflaredInPublic)) {
      cloudflaredPath = cloudflaredInPublic;
    }
  }
  
  // Verificar si cloudflared existe
  if (!fs.existsSync(cloudflaredPath)) {
    console.log('[TUNNEL] cloudflared.exe no encontrado. El túnel no se iniciará automáticamente.');
    console.log('[TUNNEL] Para habilitar el túnel, coloca cloudflared.exe en la misma carpeta que preview-server.exe');
    return;
  }

  console.log('[TUNNEL] Iniciando Cloudflare Tunnel...');
  
  try {
    tunnelProcess = spawn(cloudflaredPath, ['tunnel', '--url', `http://localhost:${port}`], {
      cwd: baseDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false
    });

    let outputBuffer = '';
    let errorBuffer = '';
    
    // Función para buscar y procesar la URL del túnel
    const processTunnelUrl = (text) => {
      // Buscar la URL del túnel en el texto (puede aparecer en stdout o stderr)
      const urlMatch = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (urlMatch && !tunnelUrl) {
        tunnelUrl = urlMatch[0];
        console.log(`[TUNNEL] ✅ Tunnel URL detectada: ${tunnelUrl}`);
        
        // Guardar la URL en un archivo para que la aplicación la pueda leer
        const tunnelUrlPath = path.join(isPackaged ? path.join(process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir(), 'ZeusIA') : baseDir, 'tunnel-url.txt');
        fs.writeFileSync(tunnelUrlPath, tunnelUrl, 'utf8');
        
        // También exponer la URL en un endpoint del servidor
        app.get('/api/tunnel-url', (req, res) => {
          res.json({ url: tunnelUrl, ok: true });
        });
        
        // Endpoint para verificar el estado del túnel
        app.get('/api/tunnel-status', (req, res) => {
          res.json({ 
            connected: !!tunnelUrl && tunnelProcess !== null,
            tunnelUrl: tunnelUrl,
            processRunning: tunnelProcess !== null,
            ok: true
          });
        });
        
        // Enviar automáticamente la URL a la API de ZEUS si hay un token de usuario
        // Esto permite que la aplicación en Vercel obtenga la URL automáticamente
        sendTunnelUrlToZeusAPI(tunnelUrl);
      }
    };
    
    tunnelProcess.stdout.on('data', (data) => {
      const output = data.toString();
      outputBuffer += output;
      console.log('[TUNNEL]', output.trim());
      
      // Buscar la URL del túnel en la salida estándar
      processTunnelUrl(output);
    });

    tunnelProcess.stderr.on('data', (data) => {
      const error = data.toString();
      // Log raw error data for detailed debugging
      console.error('[TUNNEL STDERR RAW]', error);
      errorBuffer += error;
      
      // Los errores de Cloudflare Tunnel son comunes durante la conexión inicial
      // Solo mostrar errores críticos, ignorar los de reconexión y certificados (normales en quick tunnels)
      const errorText = error.trim();
      if (errorText.includes('ERR') && !errorText.includes('Retrying')) {
        // Filtrar errores comunes que no son críticos:
        // - context canceled: normal durante reconexiones
        // - control stream encountered a failure: normal durante reconexiones
        // - Cannot determine default origin certificate: normal en quick tunnels (no necesitan certificado)
        if (!errorText.includes('context canceled') && 
            !errorText.includes('control stream encountered a failure') &&
            !errorText.includes('Cannot determine default origin certificate') &&
            !errorText.includes('origincert')) {
          console.log('[TUNNEL]', errorText);
        }
      }
      
      // Buscar la URL del túnel también en stderr (a veces aparece ahí)
      processTunnelUrl(error);
    });

    tunnelProcess.on('error', (error) => {
      console.error('[TUNNEL] Error al iniciar tunnel:', error.message);
    });

    tunnelProcess.on('exit', (code) => {
      console.log(`[TUNNEL] Tunnel terminado con código ${code}`);
      const allOutput = (outputBuffer + errorBuffer).toLowerCase();
      if (code !== 0 && (allOutput.includes('unmarshal') || allOutput.includes('invalid character'))) {
        console.log('[TUNNEL] ℹ️ Error conocido de cloudflared: Cloudflare devolvió HTML en vez de JSON.');
        console.log('[TUNNEL] ℹ️ Suele deberse a rate limiting. Espera ~1 hora e inténtalo de nuevo.');
        console.log('[TUNNEL] ℹ️ El visor funciona sin túnel en localhost.');
      }
      tunnelProcess = null;
      tunnelUrl = null;
    });

    // Esperar un poco para que el túnel se establezca
    setTimeout(() => {
      if (!tunnelUrl) {
        console.log('[TUNNEL] ⚠️ No se detectó la URL del túnel aún. Puede tardar unos segundos más.');
      }
    }, 5000);

  } catch (error) {
    console.error('[TUNNEL] Error al iniciar tunnel:', error.message);
  }
}

// Función para que la aplicación registre su token y el visor pueda enviar la URL del túnel automáticamente
app.post('/api/register-token', (req, res) => {
  try {
    const { token } = req.body;
    if (token && typeof token === 'string') {
      registeredUserToken = token;
      console.log('[TUNNEL] Token de usuario registrado. La URL del túnel se enviará automáticamente a ZEUS cuando esté disponible.');
      res.json({ ok: true, message: 'Token registrado correctamente' });
      
      // Si ya hay una URL del túnel, enviarla inmediatamente
      if (tunnelUrl) {
        sendTunnelUrlToZeusAPI(tunnelUrl);
      }
    } else {
      res.status(400).json({ error: 'Token inválido' });
    }
  } catch (error) {
    console.error('[TUNNEL] Error al registrar token:', error);
    res.status(500).json({ error: 'Error al registrar token' });
  }
});

// ✅ NUEVO: Función para iniciar servicios adicionales (restart-api.bat)
function startAdditionalServices() {
  const { spawn } = require('child_process');
  
  console.log('[START] Iniciando servicios adicionales...');

  // 1. Ejecutar restart-api.bat
  // Este archivo ahora genera un VBScript para iniciar la API de Python de forma invisible
  const restartApiBatPath = path.join(baseDir, 'public', 'restart-api.bat');
  if (fs.existsSync(restartApiBatPath)) {
    console.log(`[START] Ejecutando: ${restartApiBatPath}`);
    try {
      // En Windows, usar 'start /min' o simplemente ejecutar el bat. 
      // El bat mismo se encargará de lanzar el VBS invisible.
      const batProcess = spawn('cmd.exe', ['/c', restartApiBatPath], {
        cwd: path.dirname(restartApiBatPath),
        detached: true,
        stdio: 'ignore',
        shell: false, // Cambiado a false para evitar ventana extra de shell
        windowsHide: true // Ocultar ventana en Windows
      });
      batProcess.unref();
      console.log(`[START] ✅ restart-api.bat invocado (la API se iniciará de forma invisible)`);
    } catch (e) {
      console.error(`[ERROR] No se pudo ejecutar restart-api.bat: ${e.message}`);
    }
  } else {
    console.warn(`[WARN] No se encontró restart-api.bat en: ${restartApiBatPath}`);
  }
}

(async () => {
  const PREVIEW_SERVER_PORT = 8744;
  if (await isPortInUse(PREVIEW_SERVER_PORT)) {
    console.log(`[INFO] Preview server already running on port ${PREVIEW_SERVER_PORT}. Skipping start.`);
  } else {
    const server = startServer(PREVIEW_SERVER_PORT);
    
    // Iniciar servicios adicionales y el túnel después de que el servidor esté listo
    server.on('listening', async () => {
      const actualPort = server.address().port;
      console.log(`[INFO] Servidor iniciado en puerto ${actualPort}.`);
      
      // Iniciar servicios adicionales (restart-api.bat y Uvicorn)
      startAdditionalServices();
      
      // Esperar un segundo para asegurar que el servidor esté completamente listo antes de iniciar el túnel
      setTimeout(() => {
        startCloudflareTunnel(actualPort);
      }, 1000);
      
      // ✅ NUEVO: Verificar si hay un proyecto actual y mostrar información sobre cómo refrescarlo
      const currentProjectPath = currentProjectBasePath;
      if (fs.existsSync(currentProjectPath)) {
        try {
          // Verificar si hay un package.json para confirmar que es un proyecto válido
          const packageJsonPath = path.join(currentProjectPath, 'package.json');
          if (fs.existsSync(packageJsonPath)) {
            console.log('[Startup] ✅ Proyecto encontrado en:', currentProjectPath);
            console.log('[Startup] 💡 Para refrescar el proyecto desde PocketBase, llama a:');
            console.log('[Startup]    GET http://localhost:' + actualPort + '/api/refresh-project-from-pocketbase?projectId=YOUR_PROJECT_ID');
            console.log('[Startup]    O POST http://localhost:' + actualPort + '/api/refresh-project-from-pocketbase con { projectId: "YOUR_PROJECT_ID" }');
            if (currentProject && currentProject.projectId) {
              console.log('[Startup]    Proyecto actual detectado:', currentProject.projectId);
              console.log('[Startup]    Puedes usar: GET http://localhost:' + actualPort + '/api/refresh-project-from-pocketbase (sin projectId)');
            }
          }
        } catch (checkError) {
          console.warn('[Startup] ⚠️ Error verificando proyecto actual:', checkError.message);
        }
      } else {
        console.log('[Startup] ℹ️ No hay proyecto actual. Sube un proyecto para comenzar.');
      }
    });
  }
})();

// Limpiar proyectos al cerrar el servidor
process.on('SIGINT', async () => {
  console.log('\n[SHUTDOWN] Closing server and cleaning projects...');
  
  // Detener el túnel si está corriendo
  if (tunnelProcess) {
    console.log('[SHUTDOWN] Deteniendo túnel...');
    tunnelProcess.kill();
    tunnelProcess = null;
  }
  
  try {
    await cleanupCurrentProject();
    console.log('[SHUTDOWN] Cleanup completed');
  } catch (err) {
    console.error('[SHUTDOWN] Error during cleanup:', err);
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n[SHUTDOWN] Server terminated, cleaning projects...');
  
  // Detener el túnel si está corriendo
  if (tunnelProcess) {
    console.log('[SHUTDOWN] Deteniendo túnel...');
    tunnelProcess.kill();
    tunnelProcess = null;
  }
  
  try {
    await cleanupCurrentProject();
    console.log('[SHUTDOWN] Cleanup completed');
  } catch (err) {
    console.error('[SHUTDOWN] Error during cleanup:', err);
  }
  process.exit(0);
});

process.on('exit', () => {
  console.log('[SHUTDOWN] Process exiting, ensuring cleanup...');
  // Force cleanup flag reset
  cleanupInProgress = false;
});

// Función para limpiar todos los logs de error
function cleanupErrorLogs() {
  try {
    const logsDir = path.join(__dirname, 'logs');
    if (fs.existsSync(logsDir)) {
      const logFiles = fs.readdirSync(logsDir);
      console.log(`[LogCleanup] Found ${logFiles.length} log files to remove`);
      
      for (const logFile of logFiles) {
        try {
          // Only remove log files (not the README.md)
          if (logFile.endsWith('.log') || logFile.endsWith('.json')) {
            const logFilePath = path.join(logsDir, logFile);
            fs.removeSync(logFilePath);
            console.log(`[LogCleanup] Removed log file: ${logFile}`);
          }
        } catch (logErr) {
          console.warn(`[LogCleanup] Failed to remove log file ${logFile}:`, logErr.message);
        }
      }
      console.log('[LogCleanup] All error logs cleaned up');
    }
  } catch (err) {
    console.warn('[LogCleanup] Error during log cleanup:', err.message);
  }
}

// Función para limpiar logs de error de un proyecto específico
function cleanupProjectErrorLogs(projectId) {
  try {
    const logsDir = path.join(__dirname, 'logs');
    if (fs.existsSync(logsDir) && projectId) {
      const logFiles = fs.readdirSync(logsDir);
      const projectLogFiles = logFiles.filter(file => 
        file.includes(projectId) && (file.endsWith('.log') || file.endsWith('.json'))
      );
      
      console.log(`[LogCleanup] Found ${projectLogFiles.length} log files for project ${projectId}`);
      
      for (const logFile of projectLogFiles) {
        try {
          const logFilePath = path.join(logsDir, logFile);
          fs.removeSync(logFilePath);
          console.log(`[LogCleanup] Removed log file: ${logFile}`);
        } catch (logErr) {
          console.warn(`[LogCleanup] Failed to remove log file ${logFile}:`, logErr.message);
        }
      }
      console.log(`[LogCleanup] Error logs for project ${projectId} cleaned up`);
    }
  } catch (err) {
    console.warn('[LogCleanup] Error during project log cleanup:', err.message);
  }
}

// Endpoint to get project errors
// Endpoint to get project errors with structured data
app.get('/api/project-errors/:projectId', (req, res) => {
  const projectId = req.params.projectId;
  
  try {
    const logsDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(logsDir)) {
      return res.json({ errors: [] });
    }

    const logFiles = fs.readdirSync(logsDir);
    const projectErrorFiles = logFiles.filter(file => 
      file.includes(projectId) && file.endsWith('.log') && !file.includes('-readable.log')
    );

    const errors = [];
    
    for (const file of projectErrorFiles) {
      const filePath = path.join(logsDir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const errorData = JSON.parse(content);
        
        errors.push({
          id: file,
          name: file,
          path: filePath,
          readablePath: filePath.replace('.log', '-readable.log'),
          timestamp: errorData.timestamp,
          errorDetails: errorData.errorDetails,
          errorRaw: errorData.errorRaw
        });
      } catch (e) {
        console.error(`Error reading error file ${file}:`, e);
      }
    }

    // Ordenar por fecha (más reciente primero)
    errors.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    res.json({ errors });
  } catch (error) {
    console.error('Error obtaining project errors:', error);
    res.status(500).json({ error: 'Error obtaining project errors' });
  }
});

// Endpoint to clear project errors
app.delete('/api/project-errors/:projectId', (req, res) => {
  const projectId = req.params.projectId;
  
  if (projectErrors.has(projectId)) {
    projectErrors.delete(projectId);
  }
  
  res.json({ success: true });
});

// Test endpoint to simulate an error
app.post('/api/test-error/:projectId', (req, res) => {
  const projectId = req.params.projectId;
  const errorData = 'Test error message';
  const projectPath = __dirname; // Use the current directory
  
  // Save the error
  saveBuildErrorLog(projectId, errorData, projectPath);
  
  res.json({ success: true, message: 'Test error created' });
});

// Endpoint to add Android platform to current project
app.post('/api/cap-add-android', async (req, res) => {
  console.log('[cap-add-android] Received request to add Android platform');
  
  try {
    // Check if there's an active project
    let projectPath = currentProject?.path;
    if (!projectPath) {
      const fallbackPath = currentProjectBasePath;
      if (fs.existsSync(fallbackPath)) {
        projectPath = fallbackPath;
        console.log('[cap-add-android] Using fallback project path:', projectPath);
      } else {
        return res.status(400).json({ 
          error: 'No hay proyecto activo. Suba un proyecto primero.',
          code: 'no_active_project'
        });
      }
    }
    console.log(`[cap-add-android] Adding Android platform to project at: ${projectPath}`);
    
    // Verify Capacitor is initialized
    const capacitorConfigPath = path.join(projectPath, 'capacitor.config.json');
    const capacitorConfigTsPath = path.join(projectPath, 'capacitor.config.ts');
    const capacitorConfigJsPath = path.join(projectPath, 'capacitor.config.js');
    
    const hasCapacitorConfig = fs.existsSync(capacitorConfigPath) || 
                              fs.existsSync(capacitorConfigTsPath) || 
                              fs.existsSync(capacitorConfigJsPath);
    
    if (!hasCapacitorConfig) {
      return res.status(400).json({
        error: 'Capacitor no está inicializado en este proyecto. Ejecute "npx cap init" primero.',
        code: 'capacitor_not_initialized'
      });
    }
    
    // Check for @capacitor/core and @capacitor/cli
    const packageJsonPath = path.join(projectPath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      return res.status(400).json({
        error: 'package.json no encontrado.',
        code: 'no_package_json'
      });
    }
    
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const hasCapacitorCore = packageJson.dependencies && packageJson.dependencies['@capacitor/core'];
    const hasCapacitorCli = packageJson.dependencies && packageJson.dependencies['@capacitor/cli'];
    
    if (!hasCapacitorCore || !hasCapacitorCli) {
      return res.status(400).json({
        error: 'Dependencias de Capacitor no encontradas. Instale @capacitor/core y @capacitor/cli.',
        code: 'missing_capacitor_deps'
      });
    }
    
    console.log('[cap-add-android] Ejecutando: npx cap add android');
    
    // Clean npm config first to avoid deprecated warnings
    await cleanNpmConfig();
    
    // Check system dependencies first
    console.log('[cap-add-android] Verificando dependencias del sistema...');
    const depsCheck = await checkCapacitorDependencies();
    
    if (!depsCheck.java.installed) {
      return res.status(400).json({
        error: 'Java JDK no está instalado. Necesitas Java 11 o superior para desarrollar apps Android.',
        code: 'java_not_found',
        details: depsCheck.java.error
      });
    }
    
    if (!depsCheck.androidSdk.installed) {
      return res.status(400).json({
        error: 'Android SDK no está instalado o configurado. Instala Android Studio y configura ANDROID_HOME.',
        code: 'android_sdk_not_found',
        details: depsCheck.androidSdk.error
      });
    }
    
    console.log('[cap-add-android] Dependencias verificadas correctamente');
    
    // Execute npx cap add android
    try {
      const result = await runNpmCommand(projectPath, 'npx cap add android');
      
      console.log('[cap-add-android] Comando ejecutado exitosamente');
      
      // Check if Android platform was actually added
      const androidPlatformPath = path.join(projectPath, 'android');
      const androidAdded = fs.existsSync(androidPlatformPath);
      
      if (androidAdded) {
        console.log('[cap-add-android] Android platform added successfully');
        
        // Update the project ZIP in PocketBase to include the new android folder
        console.log('[cap-add-android] Android platform added - ZIP update needed in PocketBase');
        
        res.json({
          success: true,
          message: 'Plataforma Android añadida exitosamente',
          stdout: result,
          androidPath: androidPlatformPath,
          zipUpdateRequired: true,
          projectId: currentProject?.projectId || null,
          projectPath: projectPath,
          note: 'El proyecto tiene Android añadido. Guarda el proyecto en el editor para actualizar el ZIP en PocketBase.'
        });
      } else {
        console.warn('[cap-add-android] Android platform directory not found after command');
        res.status(500).json({
          error: 'El comando se ejecutó pero no se creó el directorio android.',
          code: 'android_not_created',
          stdout: result
        });
      }
    } catch (capError) {
      console.error('[cap-add-android] Capacitor command failed:', capError.message);
      
      // Parse the error message to provide better feedback
      let errorMessage = capError.message;
      let errorCode = 'capacitor_command_failed';
      
      // Check for specific Capacitor/Android errors
      if (errorMessage.includes('JAVA_HOME') || errorMessage.includes('java')) {
        errorMessage = 'Java JDK no está instalado o configurado correctamente. Necesitas Java 11 o superior.';
        errorCode = 'java_not_found';
      } else if (errorMessage.includes('ANDROID_HOME') || errorMessage.includes('ANDROID_SDK') || errorMessage.includes('Android SDK')) {
        errorMessage = 'Android SDK no está instalado o configurado. Instala Android Studio y configura ANDROID_HOME.';
        errorCode = 'android_sdk_not_found';
      } else if (errorMessage.includes('gradle') || errorMessage.includes('Gradle')) {
        errorMessage = 'Gradle no está configurado correctamente. Verifica tu instalación de Android Studio.';
        errorCode = 'gradle_error';
      } else if (errorMessage.includes('Command failed')) {
        // Extract the actual error from stderr
        const stderrMatch = errorMessage.match(/Command failed with code \d+: ([\s\S]*)/);
        if (stderrMatch && stderrMatch[1]) {
          errorMessage = stderrMatch[1].trim();
        }
      }
      
      res.status(500).json({
        error: errorMessage,
        code: errorCode,
        details: capError.message
      });
    }
    
  } catch (error) {
    console.error('[cap-add-android] Error:', error.message);
    
    let errorMessage = error.message;
    let errorCode = 'internal_error';
    
    // Specific error handling
    if (error.message.includes('ENOENT') || error.message.includes('command not found')) {
      errorMessage = 'Node.js o npx no están disponibles en el sistema.';
      errorCode = 'nodejs_not_found';
    } else if (error.message.includes('Java') || error.message.includes('JAVA_HOME')) {
      errorMessage = 'Java JDK no está instalado o configurado correctamente.';
      errorCode = 'java_not_found';
    } else if (error.message.includes('Android SDK')) {
      errorMessage = 'Android SDK no está instalado o configurado.';
      errorCode = 'android_sdk_not_found';
    }
    
    res.status(500).json({
      error: errorMessage,
      code: errorCode,
      details: error.message
    });
  }
});

// Endpoint to refresh project from PocketBase when corrections are made
// Supports both GET (with projectId as query param) and POST (with projectId in body)
app.get('/api/refresh-project-from-pocketbase', async (req, res) => {
  // Handle GET request with projectId as query parameter
  const projectId = req.query.projectId;
  
  // If no projectId provided, try to get it from currentProject
  let finalProjectId = projectId;
  if (!finalProjectId && currentProject && currentProject.projectId) {
    finalProjectId = currentProject.projectId;
    console.log('[RefreshProject] No projectId provided, using current project:', finalProjectId);
  }
  
  if (!finalProjectId) {
    return res.status(400).json({ 
      error: 'projectId is required as query parameter (e.g., ?projectId=xxx) or there must be an active project',
      success: false,
      hint: 'Call this endpoint with ?projectId=YOUR_PROJECT_ID or ensure a project is currently active'
    });
  }
  
  // Create a mock request body for the POST handler logic
  req.body = { projectId: finalProjectId, userToken: req.query.userToken || null };
  // Continue to POST handler logic below
});

app.post('/api/refresh-project-from-pocketbase', async (req, res) => {
  console.log('[RefreshProject] ========================================');
  console.log('[RefreshProject] Received request to refresh project from PocketBase');
  
  // Log baseDir information for debugging
  console.log('[RefreshProject] baseDir:', baseDir);
  console.log('[RefreshProject] isPackaged:', isPackaged);
  console.log('[RefreshProject] process.execPath:', process.execPath);
  console.log('[RefreshProject] __dirname:', __dirname);
  
  try {
    const { projectId, userToken } = req.body;
    
    if (!projectId) {
      return res.status(400).json({ 
        error: 'projectId is required',
        success: false 
      });
    }
    
    console.log('[RefreshProject] Project ID:', projectId);
    if (userToken) {
      console.log('[RefreshProject] User token provided, length:', userToken.length);
    } else {
      console.log('[RefreshProject] No user token provided, will use admin credentials');
    }
    
    // Get PocketBase configuration
    const pocketBaseUrl = process.env.POCKETBASE_URL || process.env.NEXT_PUBLIC_POCKETBASE_URL || 'https://zeus-basedatos.fly.dev';
    
    // Check for admin token first (preferred method)
    const adminToken = process.env.PB_SUPERUSER_TOKEN || process.env.POCKETBASE_ADMIN_TOKEN || process.env.PB_ADMIN_TOKEN || process.env.ADMIN_TOKEN;
    const adminEmail = process.env.POCKETBASE_ADMIN_EMAIL || process.env.POCKETBASE_EMAIL || process.env.NEXT_PUBLIC_POCKETBASE_EMAIL;
    const adminPass = process.env.POCKETBASE_ADMIN_PASSWORD || process.env.POCKETBASE_PASSWORD || process.env.NEXT_PUBLIC_POCKETBASE_PASSWORD;
    
    console.log('[RefreshProject] PocketBase URL:', pocketBaseUrl);
    console.log('[RefreshProject] Admin token:', adminToken ? '***SET***' : 'NOT SET');
    console.log('[RefreshProject] Admin email:', adminEmail ? adminEmail.substring(0, 3) + '***' : 'NOT SET');
    console.log('[RefreshProject] Admin password:', adminPass ? '***SET***' : 'NOT SET');
    
    // Initialize PocketBase SDK
    let pb = null;
    let token = null;
    
    try {
      // If admin token is available, use it directly
      if (adminToken) {
        console.log('[RefreshProject] Using admin token directly...');
        token = adminToken;
        console.log('[RefreshProject] ✅ Using provided admin token');
      } else if (adminEmail && adminPass) {
        // Fallback to email/password authentication
        // Try to load PocketBase SDK using dynamic import
        if (!PocketBase) {
          try {
            const pbModule = await import('pocketbase');
            PocketBase = pbModule.default || pbModule;
            console.log('[RefreshProject] PocketBase SDK loaded successfully');
          } catch (e) {
            console.warn('[RefreshProject] ⚠️ PocketBase SDK not available:', e.message);
            PocketBase = null;
          }
        }
        
        if (PocketBase) {
          // Use PocketBase SDK
          const baseUrl = pocketBaseUrl.replace(/\/$/, '');
          pb = new PocketBase(baseUrl);
          
          console.log('[RefreshProject] Attempting PocketBase authentication with email/password...');
          
          try {
            // Try user authentication first
            await pb.collection('users').authWithPassword(adminEmail, adminPass);
            token = pb.authStore.token;
            console.log('[RefreshProject] ✅ PocketBase user authentication successful');
          } catch (userAuthError) {
            // Try admin authentication
            try {
              await pb.admins.authWithPassword(adminEmail, adminPass);
              token = pb.authStore.token;
              console.log('[RefreshProject] ✅ PocketBase admin authentication successful');
            } catch (adminAuthError) {
              console.error('[RefreshProject] ❌ PocketBase authentication failed (both user and admin)');
              throw new Error('PocketBase authentication failed');
            }
          }
        } else {
          // Fallback to fetch-based authentication
          console.log('[RefreshProject] Using fetch-based authentication...');
          const authUrl = `${pocketBaseUrl}/api/collections/users/auth-with-password`;
          
          try {
            const authResponse = await fetch(authUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ identity: adminEmail, password: adminPass })
            });
            
            if (authResponse.ok) {
              const authData = await authResponse.json();
              token = authData.token;
              console.log('[RefreshProject] ✅ Fetch-based user authentication successful');
            } else {
              // Try admin authentication
              const adminAuthUrl = `${pocketBaseUrl}/api/admins/auth-with-password`;
              const adminAuthResponse = await fetch(adminAuthUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identity: adminEmail, password: adminPass })
              });
              
              if (adminAuthResponse.ok) {
                const adminAuthData = await adminAuthResponse.json();
                token = adminAuthData.token;
                console.log('[RefreshProject] ✅ Fetch-based admin authentication successful');
              } else {
                throw new Error('PocketBase authentication failed');
              }
            }
          } catch (fetchError) {
            console.error('[RefreshProject] ❌ Fetch-based authentication error:', fetchError.message);
            throw fetchError;
          }
        }
      } else {
        throw new Error('PocketBase credentials not configured. Set POCKETBASE_ADMIN_TOKEN or POCKETBASE_ADMIN_EMAIL/POCKETBASE_ADMIN_PASSWORD');
      }
      
      if (!token) {
        throw new Error('No token available for PocketBase');
      }
      
      // Get project record from PocketBase
      console.log('[RefreshProject] Fetching project record from PocketBase...');
      const projectUrl = `${pocketBaseUrl}/api/collections/projects/records/${projectId}`;
      const projectResponse = await fetch(projectUrl, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!projectResponse.ok) {
        if (projectResponse.status === 404) {
          console.warn('[RefreshProject] ⚠️ Proyecto no encontrado en PocketBase (404). Puede ser un proyecto local o un ID inválido:', projectId);
          return res.status(404).json({
            success: false,
            error: 'Project not found in PocketBase',
            message: 'El proyecto no existe en PocketBase. Puede ser un proyecto local o el ID no es válido.',
            projectId: projectId
          });
        }
        throw new Error(`Failed to fetch project: ${projectResponse.statusText}`);
      }
      
      const projectRecord = await projectResponse.json();
      console.log('[RefreshProject] Project record fetched:', projectRecord.name || 'Untitled');
      console.log('[RefreshProject] Project archive name:', projectRecord.project_archive);
      
      if (!projectRecord.project_archive) {
        throw new Error('Project archive not found in PocketBase');
      }
      
      // Download the zip file from PocketBase
      console.log('[RefreshProject] Downloading project archive...');
      const archiveUrl = `${pocketBaseUrl}/api/files/projects/${projectId}/${projectRecord.project_archive}`;
      console.log('[RefreshProject] Archive download URL:', archiveUrl);
      // Agregar timestamp para evitar cache
      const archiveUrlWithCache = `${archiveUrl}?t=${Date.now()}`;
      const zipResponse = await fetch(archiveUrlWithCache, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Cache-Control': 'no-cache'
        }
      });
      
      if (!zipResponse.ok) {
        throw new Error(`Failed to download project archive: ${zipResponse.statusText}`);
      }
      
      // Save zip to temporary file
      const tempZipPath = path.join(os.tmpdir(), `project_${projectId}_refresh_${Date.now()}.zip`);
      const zipBuffer = await zipResponse.arrayBuffer();
      const zipSize = zipBuffer.byteLength;
      console.log('[RefreshProject] Zip file size:', zipSize, 'bytes');
      
      if (zipSize === 0) {
        throw new Error('Downloaded ZIP file is empty');
      }
      
      fs.writeFileSync(tempZipPath, Buffer.from(zipBuffer));
      console.log('[RefreshProject] Zip file downloaded and saved to:', tempZipPath);
      
      // Verify the zip file was written correctly
      const zipStats = fs.statSync(tempZipPath);
      console.log('[RefreshProject] Zip file stats - Size:', zipStats.size, 'bytes, Exists:', fs.existsSync(tempZipPath));
      
      if (zipStats.size === 0) {
        throw new Error('ZIP file written to disk is empty');
      }
      
      // Extract zip to current-project directory
      const extractPath = currentProjectBasePath;
      
      console.log('[RefreshProject] ========================================');
      console.log('[RefreshProject] EXTRACTION PATH CONFIGURATION:');
      console.log('[RefreshProject] baseDir:', baseDir);
      console.log('[RefreshProject] extractPath (full):', extractPath);
      console.log('[RefreshProject] extractPath (normalized):', path.normalize(extractPath));
      console.log('[RefreshProject] Extract path exists before extraction:', fs.existsSync(extractPath));
      
      // Verify the path matches expected location
      const expectedPath = path.join(process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir(), 'ZEUS', 'VisorVistaPrevia', 'projects', 'current-project');
      console.log('[RefreshProject] Expected path (if installed):', expectedPath);
      console.log('[RefreshProject] Paths match:', path.normalize(extractPath) === path.normalize(expectedPath));
      console.log('[RefreshProject] ========================================');
      
      // Ensure the extract path exists (don't remove if it exists, as it might be in use)
      fs.ensureDirSync(extractPath);
      
      // Check what's in the directory before extraction
      try {
        const beforeFiles = fs.readdirSync(extractPath);
        console.log('[RefreshProject] Files in extract path before extraction:', beforeFiles.length, 'items');
        if (beforeFiles.length > 0) {
          console.log('[RefreshProject] Sample files before:', beforeFiles.slice(0, 5).join(', '));
        }
      } catch (readErr) {
        console.warn('[RefreshProject] Could not read extract path before extraction:', readErr.message);
      }
      
      // Extract the zip file directly (will overwrite existing files)
      // This is safer than removing the directory which might be locked by the dev server
      console.log('[RefreshProject] Extracting zip (will overwrite existing files)...');
      try {
        await extractZip(tempZipPath, extractPath);
        console.log('[RefreshProject] ✅ Project extracted successfully');
      } catch (extractError) {
        console.error('[RefreshProject] ❌ Error during ZIP extraction:', extractError.message);
        console.error('[RefreshProject] Extract error stack:', extractError.stack);
        throw new Error(`Failed to extract ZIP file: ${extractError.message}`);
      }
      
      // Verify files were extracted
      try {
        const afterFiles = fs.readdirSync(extractPath);
        console.log('[RefreshProject] Files in extract path after extraction:', afterFiles.length, 'items');
        if (afterFiles.length > 0) {
          console.log('[RefreshProject] Sample files after:', afterFiles.slice(0, 10).join(', '));
        } else {
          console.warn('[RefreshProject] ⚠️ WARNING: Extract path is empty after extraction!');
        }
        
        // Check for key files
        const keyFiles = ['package.json', 'app', 'pages', 'src'];
        const foundKeyFiles = keyFiles.filter(key => {
          const keyPath = path.join(extractPath, key);
          return fs.existsSync(keyPath);
        });
        console.log('[RefreshProject] Key files/directories found:', foundKeyFiles.join(', '));
        
        if (foundKeyFiles.length === 0 && afterFiles.length > 0) {
          console.warn('[RefreshProject] ⚠️ WARNING: No key files found, but directory is not empty. Check if ZIP structure is correct.');
        }
        
        // Verificar contenido de archivos clave para confirmar que los cambios están presentes
        const keyFilePaths = [
          path.join(extractPath, 'app', 'page.tsx'),
          path.join(extractPath, 'app', 'page.js'),
          path.join(extractPath, 'pages', 'index.tsx'),
          path.join(extractPath, 'pages', 'index.js')
        ];
        
        for (const keyFilePath of keyFilePaths) {
          if (fs.existsSync(keyFilePath)) {
            try {
              const fileContent = fs.readFileSync(keyFilePath, 'utf8');
              const fileSize = fileContent.length;
              const lineCount = fileContent.split('\n').length;
              console.log(`[RefreshProject] ✅ Verificado archivo: ${path.relative(extractPath, keyFilePath)} (${fileSize} chars, ${lineCount} líneas)`);
              
              // Buscar indicadores de cambios recientes (por ejemplo, clases de Tailwind CSS rojas)
              if (fileContent.includes('bg-red') || fileContent.includes('text-red') || fileContent.includes('border-red')) {
                console.log(`[RefreshProject] ✅ Archivo contiene cambios de color rojo detectados`);
              }
              
              // Mostrar una muestra del contenido (primeras 200 caracteres)
              const preview = fileContent.substring(0, 200).replace(/\n/g, '\\n');
              console.log(`[RefreshProject] Preview del archivo: ${preview}...`);
              break; // Solo verificar el primer archivo encontrado
            } catch (readErr) {
              console.warn(`[RefreshProject] ⚠️ No se pudo leer archivo ${keyFilePath}:`, readErr.message);
            }
          }
        }
      } catch (readErr) {
        console.error('[RefreshProject] ❌ Error reading extract path after extraction:', readErr.message);
      }
      
      // Clean up temporary zip file
      try {
        fs.removeSync(tempZipPath);
        console.log('[RefreshProject] Temporary zip file cleaned up');
      } catch (cleanupError) {
        console.warn('[RefreshProject] Warning: Could not clean up temporary zip file:', cleanupError.message);
      }
      
      // Update currentProject if it exists
      if (currentProject) {
        currentProject.path = extractPath;
        currentProject.projectId = projectId;
        console.log('[RefreshProject] Updated currentProject reference');
        
        // Si hay un servidor de desarrollo corriendo, reiniciarlo para asegurar que los cambios se apliquen
        if (currentProject.serverInfo && currentProject.serverInfo.process) {
          try {
            console.log('[RefreshProject] 🔄 Reiniciando servidor de desarrollo para aplicar cambios...');
            
            // Guardar información del proyecto antes de limpiar
            const savedProjectId = currentProject.projectId;
            const savedPath = currentProject.path;
            
            // Limpiar el proyecto actual (esto detendrá el servidor)
            // IMPORTANTE: No eliminar el directorio porque acabamos de extraer los archivos ahí
            await cleanupCurrentProject({ skipDirectoryRemoval: true });
            console.log('[RefreshProject] ✅ Servidor de desarrollo detenido (directorio preservado)');
            
            // Esperar un momento para asegurar que el proceso se haya terminado completamente
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Reiniciar el servidor de desarrollo
            console.log('[RefreshProject] 🚀 Reiniciando servidor de desarrollo...');
            currentProject.status = 'starting';
            const serverInfo = await startDevServer(savedPath, savedProjectId, previewPort);
            
            currentProject.status = 'ready';
            currentProject.serverInfo = serverInfo;
            console.log('[RefreshProject] ✅ Servidor de desarrollo reiniciado en:', serverInfo.url);
            
            // Notificar a clientes WebSocket después de que el servidor se haya reiniciado
            // Esperar más tiempo para que Next.js termine de compilar después del reinicio
            console.log('[RefreshProject] ⏳ Programando notificación WebSocket en 8 segundos (después del reinicio)...');
            setTimeout(() => {
              console.log('[RefreshProject] 🔍 Verificando conexiones WebSocket...');
              console.log('[RefreshProject] 📊 Estado del WebSocket Server:', {
                wssExists: !!wss,
                clientsExists: !!(wss && wss.clients),
                clientsSize: wss && wss.clients ? wss.clients.size : 0
              });
              
              if (wss && wss.clients && wss.clients.size > 0) {
                try {
                  const notification = {
                    type: 'project-refreshed',
                    projectId: projectId,
                    timestamp: Date.now(),
                    message: 'Project files updated from PocketBase. Please reload the page.',
                    forceReload: true, // Indicar que debe forzar recarga
                    waitBeforeReload: 3000 // Esperar 3 segundos adicionales en el cliente para asegurar que Next.js terminó de compilar
                  };
                  
                  const notificationStr = JSON.stringify(notification);
                  console.log('[RefreshProject] 📤 Preparando notificación WebSocket:', notification);
                  
                  let sentCount = 0;
                  let closedCount = 0;
                  let errorCount = 0;
                  
                  wss.clients.forEach((client, index) => {
                    console.log(`[RefreshProject] 🔍 Cliente ${index + 1}: estado=${client.readyState} (OPEN=${WebSocket.OPEN})`);
                    if (client.readyState === WebSocket.OPEN) {
                      try {
                        client.send(notificationStr);
                        sentCount++;
                        console.log(`[RefreshProject] ✅ Notificación enviada a cliente ${index + 1}`);
                      } catch (sendErr) {
                        errorCount++;
                        console.warn(`[RefreshProject] ⚠️ Error enviando notificación WebSocket a cliente ${index + 1}:`, sendErr.message);
                      }
                    } else {
                      closedCount++;
                      console.log(`[RefreshProject] ⚠️ Cliente ${index + 1} no está en estado OPEN (estado: ${client.readyState})`);
                    }
                  });
                  
                  if (sentCount > 0) {
                    console.log(`[RefreshProject] ✅ Notificación WebSocket enviada a ${sentCount} de ${wss.clients.size} clientes (${closedCount} cerrados, ${errorCount} errores)`);
                    console.log(`[RefreshProject] ⏱️ Tiempo total: 6s en servidor + 3s en cliente = 9s total`);
                  } else {
                    console.warn(`[RefreshProject] ⚠️ No se pudo enviar notificación a ningún cliente`);
                    console.warn(`[RefreshProject] 📊 Resumen: ${wss.clients.size} clientes conectados, ${closedCount} cerrados, ${errorCount} errores`);
                  }
                } catch (wsErr) {
                  console.warn('[RefreshProject] ⚠️ Error en notificación WebSocket:', wsErr.message);
                  console.warn('[RefreshProject] 📄 Stack:', wsErr.stack);
                }
              } else {
                console.log('[RefreshProject] ⚠️ No hay clientes WebSocket conectados para notificar');
                console.log('[RefreshProject] 💡 Asegúrate de que el cliente hot-reload esté conectado y suscrito al proyecto');
              }
            }, 8000); // Esperar 8 segundos para que Next.js termine de compilar después del reinicio
            
            console.log('[RefreshProject] ✅ Servidor reiniciado. Los cambios deberían estar aplicados.');
          } catch (restartErr) {
            console.error('[RefreshProject] ❌ Error al reiniciar servidor de desarrollo:', restartErr.message);
            console.error('[RefreshProject] 📄 Stack:', restartErr.stack);
            
            // Si falla el reinicio, intentar al menos tocar archivos como fallback
            try {
              console.log('[RefreshProject] ⚠️ Intentando método alternativo: tocar archivos...');
              const touchFiles = [
                path.join(extractPath, 'app', 'page.tsx'),
                path.join(extractPath, 'app', 'layout.tsx'),
                path.join(extractPath, 'app', 'page.js'),
                path.join(extractPath, 'app', 'layout.js'),
                path.join(extractPath, 'pages', 'index.tsx'),
                path.join(extractPath, 'pages', 'index.js'),
                path.join(extractPath, 'package.json')
              ];
              
              for (const touchFile of touchFiles) {
                if (fs.existsSync(touchFile)) {
                  const now = new Date();
                  fs.utimesSync(touchFile, now, now);
                  console.log('[RefreshProject] ✅ Archivo tocado:', touchFile);
                  break;
                }
              }
            } catch (touchErr) {
              console.warn('[RefreshProject] ⚠️ Error al tocar archivos (fallback):', touchErr.message);
            }
          }
        } else {
          console.log('[RefreshProject] No hay servidor de desarrollo corriendo, los cambios estarán disponibles en el próximo despliegue');
        }
      }
      
      console.log('[RefreshProject] ========================================');
      return res.json({
        success: true,
        message: 'Project refreshed from PocketBase successfully',
        projectId: projectId,
        projectPath: extractPath,
        autoReload: currentProject && currentProject.serverInfo ? true : false
      });
      
    } catch (error) {
      console.error('[RefreshProject] ❌ Error:', error.message);
      console.error('[RefreshProject] Stack:', error.stack);
      return res.status(500).json({
        success: false,
        error: 'Failed to refresh project from PocketBase',
        details: error.message
      });
    }
  } catch (error) {
    console.error('[RefreshProject] ❌ Unexpected error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Unexpected error',
      details: error.message
    });
  }
});
