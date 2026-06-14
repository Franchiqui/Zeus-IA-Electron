const express = require('express');
const router = express.Router();
const schemaController = require('../controllers/schemaController');

/**
 * @swagger
 * /schema:
 *   get:
 *     summary: Generate complete directory schema from DATA_PATH
 *     description: Returns a detailed schema of all files and folders in the DATA_PATH directory
 *     responses:
 *       200:
 *         description: Schema generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 dataPath:
 *                   type: string
 *                   description: The DATA_PATH directory that was scanned
 *                 schema:
 *                   type: object
 *                   description: Complete directory schema with file previews
 *                 generatedAt:
 *                   type: string
 *                   format: date-time
 */
router.get('/schema', schemaController.generateSchema);

/**
 * @swagger
 * /schema/simple:
 *   get:
 *     summary: Generate simplified directory schema
 *     description: Returns a simplified schema with only folder structure and file names (no content previews)
 *     responses:
 *       200:
 *         description: Simple schema generated successfully
 */
router.get('/schema/simple', schemaController.getSimpleSchema);

module.exports = router;
