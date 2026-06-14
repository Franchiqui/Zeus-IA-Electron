const express = require('express');
const router = express.Router();
const lineController = require('../controllers/lineController');

/**
 * @swagger
 * /files/{name}/lines:
 *   get:
 *     summary: Ver líneas específicas
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *       - in: query
 *         name: path
 *         required: true
 *       - in: query
 *         name: startLine
 *         schema:
 *           type: integer
 *       - in: query
 *         name: endLine
 *         schema:
 *           type: integer
 */
router.get('/files/:name/lines', lineController.getLines);

/**
 * @swagger
 * /files/{name}/lines/list:
 *   get:
 *     summary: Listar todas las líneas
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *       - in: query
 *         name: path
 *         required: true
 */
router.get('/files/:name/lines/list', lineController.listLines);

/**
 * @swagger
 * /files/{name}/lines:
 *   post:
 *     summary: Insertar línea(s)
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               path:
 *                 type: string
 *               lineNumber:
 *                 type: integer
 *               content:
 *                 type: string
 */
router.post('/files/:name/lines', lineController.insertLines);

router.put('/files/:name/lines/:lineNumber', lineController.replaceLines);

/**
 * @swagger
 * /files/{name}/lines/{lineNumber}:
 *   delete:
 *     summary: Borrar línea(s)
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *       - in: path
 *         name: lineNumber
 *         required: true
 *       - in: query
 *         name: path
 *         required: true
 *       - in: query
 *         name: numLines
 *         schema:
 *           type: integer
 */
router.delete('/files/:name/lines/:lineNumber', lineController.deleteLines);

module.exports = router;