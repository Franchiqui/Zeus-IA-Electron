const express = require('express');
const router = express.Router();
const fileController = require('../controllers/fileController');
const lineController = require('../controllers/lineController');
const charController = require('../controllers/charController');

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
 * /files/*:
 *   get:
 *     summary: Ver archivo o listar carpeta por ruta completa (tolerante)
 *     description: |
 *       Resuelve la ruta completa enviada en la URL (ej. /api/files/app/page.tsx).
 *       Si la ruta apunta a un archivo, devuelve su contenido; si apunta a una
 *       carpeta, devuelve el listado. Pensado para ser tolerante con la IA, que a
 *       veces envía la ruta completa en la URL en lugar de separar `name` y `path`.
 *     parameters:
 *       - in: path
 *         name: fullPath
 *         schema:
 *           type: string
 *         description: Ruta relativa del archivo o carpeta
 *     responses:
 *       200:
 *         description: Contenido del archivo o listado de la carpeta
 *       404:
 *         description: Ruta no encontrada
 */
// Catch-all: se registra DESPUÉS de '/:name' para no interferir con él.
// Atrapa rutas multi-segmento como /api/files/app/page.tsx que la IA envía mal.
// Rutas de líneas anidadas bajo /files/:name/lines — deben ir ANTES del wildcard /*
router.get('/:name/lines/list', lineController.listLines);
router.get('/:name/lines', lineController.getLines);
router.post('/:name/lines', lineController.insertLines);
router.put('/:name/lines/:lineNumber', lineController.replaceLines);
router.delete('/:name/lines/:lineNumber', lineController.deleteLines);
// Rutas de caracteres anidadas bajo /files/:name/lines/:lineNumber/chars
router.get('/:name/lines/:lineNumber/chars/list', charController.listChars);
router.get('/:name/lines/:lineNumber/chars', charController.getChars);
router.post('/:name/lines/:lineNumber/chars', charController.insertChars);
router.put('/:name/lines/:lineNumber/chars', charController.replaceChars);
router.delete('/:name/lines/:lineNumber/chars', charController.deleteChars);

router.get('/*', fileController.resolveByPath);

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