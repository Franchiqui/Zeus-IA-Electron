const express = require('express');
const router = express.Router();
const charController = require('../controllers/charController');

/**
 * @swagger
 * /files/{name}/lines/{lineNumber}/chars:
 *   get:
 *     summary: Ver caracteres específicos
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
 *         name: startCharIndex
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: endCharIndex
 *         required: true
 *         schema:
 *           type: integer
 */
router.get('/files/:name/lines/:lineNumber/chars', charController.getChars);

/**
 * @swagger
 * /files/{name}/lines/{lineNumber}/chars/list:
 *   get:
 *     summary: Listar todos los caracteres de una línea
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
 */
router.get('/files/:name/lines/:lineNumber/chars/list', charController.listChars);

/**
 * @swagger
 * /files/{name}/lines/{lineNumber}/chars:
 *   post:
 *     summary: Insertar caracteres
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *       - in: path
 *         name: lineNumber
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
 *               position:
 *                 type: integer
 *               content:
 *                 type: string
 */
router.post('/files/:name/lines/:lineNumber/chars', charController.insertChars);

/**
 * @swagger
 * /files/{name}/lines/{lineNumber}/chars:
 *   put:
 *     summary: Sustituir caracteres
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *       - in: path
 *         name: lineNumber
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
 *               startCharIndex:
 *                 type: integer
 *               endCharIndex:
 *                 type: integer
 *               content:
 *                 type: string
 */
router.put('/files/:name/lines/:lineNumber/chars', charController.replaceChars);

/**
 * @swagger
 * /files/{name}/lines/{lineNumber}/chars:
 *   delete:
 *     summary: Borrar caracteres
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
 *         name: startCharIndex
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: endCharIndex
 *         required: true
 *         schema:
 *           type: integer
 */
router.delete('/files/:name/lines/:lineNumber/chars', charController.deleteChars);

module.exports = router;