// Registro de sesiones de workspace (estilo F:\Agent _sessions).
// Map autoritativo en memoria del proceso Express (8742), persistido a JSON
// en ZEUS_USER_DATA/zeus-sessions.json para sobrevivir reinicios.
// Cada sesion ancla un cwd; las operaciones de archivo se resuelven contra él.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// sid -> { cwd, projectId, createdAt }
const sessions = new Map();
let activeSessionId = null;

function persistPath() {
  const base = process.env.ZEUS_USER_DATA || path.join(__dirname, '..');
  return path.join(base, 'zeus-sessions.json');
}

let persistTimer = null;
function persist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      const data = {
        activeSessionId,
        sessions: Array.from(sessions.entries())
      };
      fs.writeFileSync(persistPath(), JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('[sessionRegistry] persist error:', e.message);
    }
  }, 50);
}

function isValidCwd(cwd) {
  try {
    const resolved = path.resolve(cwd);
    if (!path.isAbsolute(resolved)) return null;
    if (!fs.existsSync(resolved)) return null;
    if (!fs.statSync(resolved).isDirectory()) return null;
    return resolved;
  } catch {
    return null;
  }
}

function loadSessions() {
  try {
    const p = persistPath();
    if (!fs.existsSync(p)) return;
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    sessions.clear();
    for (const [sid, v] of data.sessions || []) {
      const resolved = isValidCwd(v && v.cwd);
      if (resolved) {
        sessions.set(sid, { cwd: resolved, projectId: (v && v.projectId) || null, createdAt: v && v.createdAt });
      }
    }
    if (data.activeSessionId && sessions.has(data.activeSessionId)) {
      activeSessionId = data.activeSessionId;
    } else if (sessions.size) {
      activeSessionId = sessions.keys().next().value;
    } else {
      activeSessionId = null;
    }
    console.log(`[sessionRegistry] cargadas ${sessions.size} sesión(es), activa=${activeSessionId}`);
  } catch (e) {
    console.error('[sessionRegistry] load error:', e.message);
  }
}

function createSession({ cwd, projectId } = {}) {
  if (!cwd || typeof cwd !== 'string') throw new Error('cwd es requerido');
  const resolved = isValidCwd(cwd);
  if (!resolved) throw new Error(`cwd inválido o inexistente: ${cwd}`);
  const sid = crypto.randomUUID();
  const entry = { cwd: resolved, projectId: projectId || null, createdAt: Date.now() };
  sessions.set(sid, entry);
  activeSessionId = sid;
  persist();
  return { sessionId: sid, ...entry };
}

function getSession(sid) {
  return sid ? (sessions.get(sid) || null) : null;
}

function resolveSessionCwd(sid) {
  const s = getSession(sid);
  return s ? s.cwd : null;
}

function setSessionCwd(sid, cwd) {
  const s = getSession(sid);
  if (!s) return null;
  const resolved = isValidCwd(cwd);
  if (!resolved) throw new Error(`cwd inválido o inexistente: ${cwd}`);
  s.cwd = resolved;
  persist();
  return s;
}

function deleteSession(sid) {
  const had = sessions.delete(sid);
  if (activeSessionId === sid) {
    activeSessionId = sessions.size ? sessions.keys().next().value : null;
  }
  if (had) persist();
  return had;
}

function getActiveSessionId() {
  return activeSessionId;
}

function setActiveSessionId(sid) {
  if (sid && sessions.has(sid)) {
    activeSessionId = sid;
    persist();
    return true;
  }
  return false;
}

function getActiveCwd() {
  return activeSessionId ? resolveSessionCwd(activeSessionId) : null;
}

// Cargar al requerir el módulo
loadSessions();

module.exports = {
  createSession,
  getSession,
  resolveSessionCwd,
  setSessionCwd,
  deleteSession,
  getActiveSessionId,
  setActiveSessionId,
  getActiveCwd,
  loadSessions
};