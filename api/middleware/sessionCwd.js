// Middleware Express: ancla cada request a un cwd de sesión.
// Lee X-Zeus-Session (header) o ?sessionId= (query) y deja req.sessionCwd.
// No bloquea si falta; los controllers deciden cómo responder.
const sessionRegistry = require('../sessionRegistry');

function extractSessionId(req) {
  if (!req) return null;
  const h = req.headers && req.headers['x-zeus-session'];
  if (h) return h;
  if (req.query && req.query.sessionId) return req.query.sessionId;
  return null;
}

// Helper para usar dentro de controllers/handlers que pueden no tener el
// middleware ejecutado (ej. rutas registradas con controladores directos).
function getSessionCwd(req) {
  if (!req) return null;
  if (req.sessionCwd) return req.sessionCwd;
  const sid = extractSessionId(req);
  return sid ? sessionRegistry.resolveSessionCwd(sid) : null;
}

function sessionCwdMiddleware(req, res, next) {
  const sid = extractSessionId(req);
  req.sessionId = sid || null;
  req.sessionCwd = sid ? sessionRegistry.resolveSessionCwd(sid) : null;
  next();
}

module.exports = { sessionCwdMiddleware, getSessionCwd, extractSessionId };