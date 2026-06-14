const express = require('express');
const router = express.Router();
const planController = require('../controllers/planController');

// Rutas para planes
router.get('/list', planController.getPlansList);
router.get('/', planController.listPlans);
router.post('/', planController.createPlan);

// Rutas para guardar plan
router.post('/save', planController.savePlan);

// Rutas para tareas
router.get('/tasks', planController.listTasks);
router.post('/tasks/create', planController.createTask);
router.post('/tasks/save', planController.saveTask);
router.get('/tasks/:name', planController.getTask);
router.put('/tasks/:id', planController.updateTask);
router.delete('/tasks/:id', planController.deleteTask);

// Rutas para carpetas y archivos en tareas
router.post('/tasks/:id/folders', planController.createTaskFolder);
router.get('/tasks/:id/folders', planController.listTaskFolders);
router.post('/tasks/:id/files', planController.createTaskFile);
router.get('/tasks/:id/files', planController.listTaskFiles);

// Ejecución de planes
router.post('/execute', planController.executePlan);
router.post('/execute-task', planController.executePlanTask);

// Rutas con parámetros (deben ir al final)
router.get('/:name', planController.getPlan);
router.put('/:name', planController.updatePlan);
router.delete('/:name', planController.deletePlan);

module.exports = router;
