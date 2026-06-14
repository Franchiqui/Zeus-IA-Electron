const express = require('express');
const router = express.Router();
const fileController = require('../controllers/fileController');

/**
 * @swagger
 * /files:
 *   post:
 *     summary: Crear archivo
 *     description: Crea un archivo. Usa application/json para enviar código con formato.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - path
 *             properties:
 *               name:
 *                 type: string
 *                 example: "miApp"
 *               extension:
 *                 type: string
 *                 example: "js"
 *               path:
 *                 type: string
 *                 example: "mi_proyecto"
 *               content:
 *                 type: string
 *                 description: "Código del archivo. Usa \\n para saltos de línea"
 *                 example: "class MiApp {\n  constructor() {\n    this.nombre = 'App';\n  }\n}\n\nmodule.exports = MiApp;"
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - path
 *             properties:
 *               name:
 *                 type: string
 *               extension:
 *                 type: string
 *               path:
 *                 type: string
 *               content:
 *                 type: string
 *     responses:
 *       201:
 *         description: Archivo creado exitosamente
 *       400:
 *         description: Faltan parámetros requeridos
 *       500:
 *         description: Error interno
 */
router.post('/', fileController.createFile);

/**
 * @swagger
 * /files/{name}:
 *   get:
 *     summary: Ver archivo
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: Nombre del archivo (incluyendo extensión)
 *       - in: query
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Ruta donde está el archivo
 *     responses:
 *       200:
 *         description: Contenido del archivo
 *       404:
 *         description: Archivo no encontrado
 */
router.get('/:name', fileController.getFile);

/**
 * @swagger
 * /files:
 *   get:
 *     summary: Listar archivos
 *     parameters:
 *       - in: query
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Ruta donde listar archivos
 *     responses:
 *       200:
 *         description: Lista de archivos
 */
router.get('/', fileController.listFiles);

/**
 * @swagger
 * /files/{name}:
 *   put:
 *     summary: Actualizar archivo
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               path:
 *                 type: string
 *               content:
 *                 type: string
 *               newName:
 *                 type: string
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               path:
 *                 type: string
 *               content:
 *                 type: string
 *               newName:
 *                 type: string
 *     responses:
 *       200:
 *         description: Archivo actualizado
 *       404:
 *         description: Archivo no encontrado
 */
router.put('/:name', fileController.updateFile);

/**
 * @swagger
 * /files/{name}:
 *   delete:
 *     summary: Borrar archivo
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: Nombre del archivo a borrar
 *       - in: query
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Ruta donde está el archivo
 *     responses:
 *       200:
 *         description: Archivo borrado exitosamente
 *       404:
 *         description: Archivo no encontrado
 */
router.delete('/:name', fileController.deleteFile);

module.exports = router;