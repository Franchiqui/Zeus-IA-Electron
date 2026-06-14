const express = require('express');
const router = express.Router();
const structureController = require('../controllers/structureController');

/**
 * @swagger
 * /structure:
 *   post:
 *     summary: Create a complete folder/file structure
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               structure:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     type:
 *                       type: string
 *                       enum: [folder, file]
 *                     name:
 *                       type: string
 *                     path:
 *                       type: string
 *                     content:
 *                       type: string
 *                       description: File content (only for files)
 *                     extension:
 *                       type: string
 *                       description: File extension (only for files)
 *               planName:
 *                 type: string
 *                 description: Nombre del plan donde guardar la tarea (opcional)
 *               saveToPlan:
 *                 type: boolean
 *                 description: Guardar en plan en lugar de ejecutar (opcional)
 *             required:
 *               - structure
 *     responses:
 *       201:
 *         description: Structure created successfully
 */
router.post('/structure', structureController.createStructure);

/**
 * @swagger
 * /structure/execute:
 *   post:
 *     summary: Execute the prepared structure creation
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               planName:
 *                 type: string
 *                 description: Nombre del plan donde guardar la tarea (opcional)
 *               saveToPlan:
 *                 type: boolean
 *                 description: Guardar en plan en lugar de ejecutar (opcional)
 *     responses:
 *       200:
 *         description: Structure executed successfully
 */
router.post('/structure/execute', structureController.executeStructure);

/**
 * @swagger
 * /structure/tree:
 *   get:
 *     summary: Get the created structure tree
 *     responses:
 *       200:
 *         description: Structure tree
 */
router.get('/structure/tree', structureController.getStructureTree);

/**
 * @swagger
 * /structure/save:
 *   post:
 *     summary: Save structure to a physical JSON file in data folder
 */
router.post('/structure/save', structureController.saveStructureToFile);

/**
 * @swagger
 * /structure/list:
 *   get:
 *     summary: List all saved structure JSON files
 */
router.get('/structure/list', structureController.listSavedStructures);

/**
 * @swagger
 * /structure/load:
 *   get:
 *     summary: Load structure from a specific JSON file
 *     parameters:
 *       - in: query
 *         name: fileName
 *         schema:
 *           type: string
 */
router.get('/structure/load', structureController.loadStructureFromFile);

module.exports = router;
