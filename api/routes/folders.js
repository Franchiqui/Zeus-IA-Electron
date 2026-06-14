const express = require('express');
const router = express.Router();
const folderController = require('../controllers/folderController');

/**
 * @swagger
 * /folders:
 *   post:
 *     summary: Crear una carpeta
 *     description: Crea una nueva carpeta en la ruta especificada
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
 *                 example: "mi_carpeta"
 *                 description: Nombre de la carpeta a crear
 *               path:
 *                 type: string
 *                 example: "mi_proyecto"
 *                 description: Ruta donde se creará la carpeta
 *               planName:
 *                 type: string
 *                 example: "mi_plan"
 *                 description: Nombre del plan donde guardar la tarea (opcional)
 *               saveToPlan:
 *                 type: boolean
 *                 example: false
 *                 description: Guardar en plan en lugar de ejecutar (opcional)
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - path
 *             properties:
 *               name:
 *                 type: string
 *               path:
 *                 type: string
 *               planName:
 *                 type: string
 *                 description: Nombre del plan donde guardar la tarea (opcional)
 *               saveToPlan:
 *                 type: boolean
 *                 description: Guardar en plan en lugar de ejecutar (opcional)
 *     responses:
 *       201:
 *         description: Carpeta creada exitosamente
 *       400:
 *         description: Faltan parámetros requeridos
 *       500:
 *         description: Error interno del servidor
 */
router.post('/', folderController.createFolder);

/**
 * @swagger
 * /folders:
 *   get:
 *     summary: Listar carpetas
 *     description: Obtiene la lista de carpetas en la ruta especificada
 *     parameters:
 *       - in: query
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Ruta donde listar carpetas
 *         example: "mi_proyecto"
 *     responses:
 *       200:
 *         description: Lista de carpetas obtenida exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 folders:
 *                   type: array
 *                   items:
 *                     type: string
 *       404:
 *         description: Ruta no encontrada
 */
router.get('/', folderController.listFolders);

/**
 * @swagger
 * /folders/{name}:
 *   put:
 *     summary: Actualizar carpeta
 *     description: Renombra una carpeta existente
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: Nombre actual de la carpeta
 *         example: "mi_carpeta"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - newName
 *               - path
 *             properties:
 *               newName:
 *                 type: string
 *                 example: "nuevo_nombre"
 *                 description: Nuevo nombre de la carpeta
 *               path:
 *                 type: string
 *                 example: "mi_proyecto"
 *                 description: Ruta donde está la carpeta
 *               planName:
 *                 type: string
 *                 example: "mi_plan"
 *                 description: Nombre del plan donde guardar la tarea (opcional)
 *               saveToPlan:
 *                 type: boolean
 *                 example: false
 *                 description: Guardar en plan en lugar de ejecutar (opcional)
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             required:
 *               - newName
 *               - path
 *             properties:
 *               newName:
 *                 type: string
 *               path:
 *                 type: string
 *               planName:
 *                 type: string
 *                 description: Nombre del plan donde guardar la tarea (opcional)
 *               saveToPlan:
 *                 type: boolean
 *                 description: Guardar en plan en lugar de ejecutar (opcional)
 *     responses:
 *       200:
 *         description: Carpeta actualizada exitosamente
 *       400:
 *         description: Faltan parámetros requeridos
 *       404:
 *         description: Carpeta no encontrada
 *       500:
 *         description: Error interno del servidor
 */
router.put('/:name', folderController.updateFolder);

/**
 * @swagger
 * /folders/{name}:
 *   delete:
 *     summary: Borrar carpeta
 *     description: Elimina una carpeta existente
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: Nombre de la carpeta a borrar
 *         example: "mi_carpeta"
 *       - in: query
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Ruta donde está la carpeta
 *         example: "mi_proyecto"
 *       - in: query
 *         name: planName
 *         schema:
 *           type: string
 *         description: Nombre del plan donde guardar la tarea (opcional)
 *         example: "mi_plan"
 *       - in: query
 *         name: saveToPlan
 *         schema:
 *           type: boolean
 *         description: Guardar en plan en lugar de ejecutar (opcional)
 *         example: false
 *     responses:
 *       200:
 *         description: Carpeta borrada exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 name:
 *                   type: string
 *                 path:
 *                   type: string
 *       400:
 *         description: Faltan parámetros requeridos
 *       404:
 *         description: Carpeta no encontrada
 *       500:
 *         description: Error interno del servidor
 */
router.delete('/:name', folderController.deleteFolder);

module.exports = router;