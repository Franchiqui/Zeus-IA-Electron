const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config({ path: './.env' });

// Importar rutas
const charsRouter = require('./routes/chars');
const commandsRouter = require('./routes/commands');
const configRouter = require('./routes/config');
const filesRouter = require('./routes/files');
const foldersRouter = require('./routes/folders');
const historyRouter = require('./routes/history');
const linesRouter = require('./routes/lines');
const planRouter = require('./routes/plan');
const schemaRouter = require('./routes/schema');
const structureRouter = require('./routes/structure');
const gitRouter = require('./routes/git');
const githubRouter = require('./routes/github');

const app = express();
const PORT = process.env.PORT || 8742;

// Middlewares
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Servir archivos estáticos (uploads, etc.)
app.use('/uploads', express.static('uploads'));
app.use('/public', express.static('public'));

// Montar rutas de la API
app.use('/api/chars', charsRouter);
app.use('/api/commands', commandsRouter);
app.use('/api/config', configRouter);
app.use('/api/files', filesRouter);
app.use('/api/folders', foldersRouter);
app.use('/api/history', historyRouter);
app.use('/api/lines', linesRouter);
app.use('/api/plan', planRouter);
app.use('/api/schema', schemaRouter);
app.use('/api/structure', structureRouter);
app.use('/api/git', gitRouter);
app.use('/api/github', githubRouter);

// Ruta de prueba para verificar el estado del servidor
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Zeus Model API Plan integrado correctamente' });
});

// Alias y endpoints adicionales que espera la app
// Cada ruta se registra en su propio try/catch para que un error no afecte a las demás

try {
  const planController = require('./controllers/planController');
  
  try {
    app.get('/api/plans/list', planController.getPlansList);
    console.log('✓ GET /api/plans/list registrado');
  } catch (e) {
    console.error('✗ Error registrando /api/plans/list:', e.message);
  }
  
  try {
    app.get('/api/data', planController.explorerData);
    console.log('✓ GET /api/data registrado');
  } catch (e) {
    console.error('✗ Error registrando /api/data:', e.message);
  }
  
  try {
    app.get('/api/plan/tasks', planController.listTasks);
    console.log('✓ GET /api/plan/tasks registrado');
  } catch (e) {
    console.error('✗ Error registrando /api/plan/tasks:', e.message);
  }
  
} catch (err) {
  console.error('Error al cargar planController:', err.message);
}

try {
  const structureController = require('./controllers/structureController');
  
  try {
    app.get('/api/structure/list', structureController.listSavedStructures);
    console.log('✓ GET /api/structure/list registrado');
  } catch (e) {
    console.error('✗ Error registrando /api/structure/list:', e.message);
  }
  
} catch (err) {
  console.error('Error al cargar structureController:', err.message);
}

// Middleware de errores global: captura cualquier error no manejado y devuelve JSON
app.use((err, req, res, next) => {
  console.error('[API ERROR]', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor Express corriendo en el puerto ${PORT}`);
  console.log('Rutas de plan y corrección activas en /api/plan');
});

module.exports = app;
