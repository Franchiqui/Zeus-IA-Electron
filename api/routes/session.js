// Rutas de sesión de workspace (cwd por sesión, estilo F:\Agent).
const express = require('express');
const sessionRegistry = require('../sessionRegistry');
const router = express.Router();

// Crear sesión y marcarla como activa.
// Body: { cwd: string, projectId?: string }
// Resp: { sessionId, cwd, projectId, createdAt }
router.post('/', (req, res) => {
  const { cwd, projectId } = req.body || {};
  if (!cwd) return res.status(400).json({ error: 'cwd es requerido' });
  try {
    const s = sessionRegistry.createSession({ cwd, projectId });
    res.status(201).json(s);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Resolver sessionId -> { cwd, projectId } (lo usa Next.js 8741).
router.get('/resolve', (req, res) => {
  const sid = req.query.sessionId;
  const s = sessionRegistry.getSession(sid);
  if (!s) return res.status(404).json({ error: 'Sesión no encontrada' });
  res.json({ sessionId: sid, cwd: s.cwd, projectId: s.projectId, createdAt: s.createdAt });
});

// Sesión activa actual (para rehydrate al boot del frontend).
router.get('/active', (_req, res) => {
  const sid = sessionRegistry.getActiveSessionId();
  if (!sid) return res.json({ sessionId: null, cwd: null, projectId: null });
  const s = sessionRegistry.getSession(sid);
  res.json({ sessionId: sid, cwd: (s && s.cwd) || null, projectId: (s && s.projectId) || null });
});

// Marcar una sesión existente como activa.
router.post('/active/:id', (req, res) => {
  const ok = sessionRegistry.setActiveSessionId(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Sesión no encontrada' });
  res.json({ success: true, sessionId: req.params.id });
});

// Eliminar sesión.
router.delete('/:id', (req, res) => {
  const ok = sessionRegistry.deleteSession(req.params.id);
  res.json({ success: ok });
});

// Mover el cwd de una sesión existente (equivalente a session.workspace.move).
router.post('/:id/cwd', (req, res) => {
  try {
    const s = sessionRegistry.setSessionCwd(req.params.id, req.body && req.body.cwd);
    if (!s) return res.status(404).json({ error: 'Sesión no encontrada' });
    res.json({ sessionId: req.params.id, cwd: s.cwd, projectId: s.projectId });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;