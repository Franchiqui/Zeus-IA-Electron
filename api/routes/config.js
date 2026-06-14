const express = require('express');
const router = express.Router();
const configController = require('../controllers/configController');

// Actualizar DATA_PATH
router.post('/config/data-path', configController.updateDataPath);

// Obtener DATA_PATH actual
router.get('/config/data-path', configController.getDataPath);

module.exports = router;