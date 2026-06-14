import express from 'express';
import { createServer } from 'http';
import * as os from 'os';
import cors from 'cors';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// Importación dinámica para máxima compatibilidad
const WebSocket = require('ws');
const pty = require('node-pty');

// Lógica de búsqueda de carpeta de trabajo priorizando DATA_PATH en api/.env
// Esta función lee el .env en cada llamada para detectar cambios en tiempo real
function resolveDataPath() {
    try {
        // 1) Priorizar DATA_PATH configurado en el .env de la API
        const envPath = process.env.ZEUS_API_ENV_PATH
            ? path.resolve(process.env.ZEUS_API_ENV_PATH)
            : path.join(__dirname, '..', 'api', '.env');
        if (fs.existsSync(envPath)) {
            const envContent = fs.readFileSync(envPath, 'utf8');
            const match = envContent.match(/^DATA_PATH\s*=\s*"([^"]+)"/m);
            if (match) {
                const rawValue = match[1];
                // Si viene escapado como C:\\ruta\\dir, lo convertimos a C:\ruta\dir
                const unescapedValue = rawValue.replace(/\\\\/g, '\\').trim();
                const resolved = path.isAbsolute(unescapedValue)
                    ? path.normalize(unescapedValue)
                    : path.resolve(__dirname, '..', 'api', unescapedValue);
                if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
                    console.log(`\x1b[32m[TERMINAL] Usando DATA_PATH desde .env: ${resolved}\x1b[0m`);
                    return resolved;
                }
            }
        }

        // 2) Fallback: búsqueda por api/data en estructura del proyecto
        let current = __dirname;
        // Subir hasta 5 niveles buscando la carpeta 'api/data'
        for (let i = 0; i < 5; i++) {
            const apiDataPath = path.join(current, 'api', 'data');
            if (fs.existsSync(apiDataPath) && fs.statSync(apiDataPath).isDirectory()) {
                console.log(`\x1b[32m[TERMINAL] ¡CARPETA ENCONTRADA! Usando: ${apiDataPath}\x1b[0m`);
                return apiDataPath;
            }

            // Si ya estamos dentro de /api, buscar /data
            if (current.endsWith('api')) {
                const dataPath = path.join(current, 'data');
                if (fs.existsSync(dataPath) && fs.statSync(dataPath).isDirectory()) {
                    return dataPath;
                }
            }

            const parent = path.dirname(current);
            if (parent === current) break;
            current = parent;
        }

    } catch (e) {
        console.error('[TERMINAL] Error buscando carpeta de datos:', e);
    }
    console.warn('\x1b[33m[TERMINAL] No se encontró api/data, usando carpeta por defecto\x1b[0m');
    return process.cwd();
}

const app = express();
app.use(cors());

const server = createServer(app);
const wss = new WebSocket.WebSocketServer({ server });

const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';

/** Puerto WebSocket del terminal (misma convención que en el webview / CSP). */
const PORT = Number(process.env.ZEUS_TERMINAL_PORT) || 3351;

/**
 * Mata procesos que siguen en LISTEN en `port` (p. ej. terminal-server colgado tras recargar la extensión).
 * No mata el proceso actual.
 */
function freeListeningPidsOnPort(port: number): void {
    const self = process.pid;
    try {
        if (process.platform === 'win32') {
            const out = execSync('netstat -ano', { encoding: 'utf8', windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
            const pids = new Set<string>();
            const tag = `:${port}`;
            for (const line of out.split(/\r?\n/)) {
                if (!line.includes(tag)) {
                    continue;
                }
                if (!/LISTENING|EN ESCUCHA/i.test(line)) {
                    continue;
                }
                const parts = line.trim().split(/\s+/);
                const last = parts[parts.length - 1];
                if (/^\d+$/.test(last) && Number(last) !== self) {
                    pids.add(last);
                }
            }
            for (const pid of pids) {
                try {
                    execSync(`taskkill /F /T /PID ${pid}`, { windowsHide: true, stdio: 'ignore' });
                } catch {
                    /* proceso ya terminado o sin permiso */
                }
            }
        } else {
            const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null || true`, {
                encoding: 'utf8',
                maxBuffer: 1024 * 1024
            });
            for (const pid of out
                .split(/\s+/)
                .map((s) => s.trim())
                .filter((s) => /^\d+$/.test(s))) {
                if (Number(pid) === self) {
                    continue;
                }
                try {
                    execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
                } catch {
                    /* noop */
                }
            }
        }
    } catch {
        /* netstat/lsof no disponible o sin permisos */
    }
}

wss.on('connection', (ws: any) => {
    console.log('[TERMINAL] Nueva conexión WebSocket establecida');
    const connectionCwd = resolveDataPath();
    console.log(`[TERMINAL] CWD para esta conexión: ${connectionCwd}`);

    const shellArgs = os.platform() === 'win32' ? ['-NoLogo'] : [];
    const ptyOptions: any = {
        name: 'xterm-color',
        cols: 80,
        rows: 24,
        cwd: connectionCwd,
        env: process.env
    };
    if (os.platform() === 'win32') {
        ptyOptions.useConpty = false;
    }
    const ptyProcess = pty.spawn(shell, shellArgs, ptyOptions);

    ptyProcess.onData((data: string) => {
        if (ws.readyState === 1) {
            // Send JSON-formatted message
            ws.send(JSON.stringify({
                type: 'output',
                data: data
            }));
        }
    });

    ptyProcess.onExit(({ exitCode, signal }: any) => {
        console.log(`[TERMINAL] PTY cerrado (exitCode=${exitCode}, signal=${signal})`);
    });

    ws.on('message', (message: any) => {
        const raw = message.toString();
        // El cliente xterm envía JSON para sincronizar columnas/filas con el PTY (FitAddon).
        // La librería `ws` no tiene evento nativo `resize` en el socket.
        if (raw.length > 0 && raw.charCodeAt(0) === 123) {
            try {
                const parsed = JSON.parse(raw) as { type?: string; cols?: number; rows?: number };
                if (parsed.type === 'zeus-resize' && parsed.cols && parsed.rows) {
                    ptyProcess.resize(parsed.cols, parsed.rows);
                    return;
                }
            } catch {
                /* no es JSON de control; se envía al shell */
            }
        }
        ptyProcess.write(raw);
    });

    ws.on('close', () => {
        console.log('[TERMINAL] Conexión cerrada');
        try {
            ptyProcess.kill();
        } catch (e) {
            console.error('[TERMINAL] Error al matar PTY:', e);
        }
    });

    ws.on('error', (err: any) => console.error('[TERMINAL] Error:', err));
});

async function startListening(): Promise<void> {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        freeListeningPidsOnPort(PORT);
        await new Promise((r) => setTimeout(r, 350));

        try {
            await new Promise<void>((resolve, reject) => {
                const onErr = (err: NodeJS.ErrnoException) => {
                    server.removeListener('error', onErr);
                    reject(err);
                };
                server.once('error', onErr);
                server.listen(PORT, () => {
                    server.removeListener('error', onErr);
                    resolve();
                });
            });
            console.log(
                `\n\x1b[32m[ZEUS TERMINAL SERVER] Real terminal running on ws://localhost:${PORT}\x1b[0m\n`
            );
            return;
        } catch (e) {
            const err = e as NodeJS.ErrnoException;
            if (err.code === 'EADDRINUSE' && attempt < maxAttempts) {
                console.warn(`[ZEUS TERMINAL] Puerto ${PORT} ocupado (intento ${attempt}/${maxAttempts}), liberando de nuevo...`);
                continue;
            }
            console.error('[ZEUS TERMINAL] No se pudo abrir el puerto', PORT, ':', err);
            process.exit(1);
        }
    }
}

void startListening();
