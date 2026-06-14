const express = require('express');
const router = express.Router();
const commandController = require('../controllers/commandController');

/**
 * @swagger
 * /commands/run:
 *   post:
 *     summary: Ejecutar comando en la terminal
 *     description: Ejecuta un comando del sistema de forma secuencial.
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               command:
 *                 type: string
 *               path:
 *                 type: string
 */
router.post('/run', commandController.runCommand);

module.exports = router;
