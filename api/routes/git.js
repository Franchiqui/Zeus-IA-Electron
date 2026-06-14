const express = require('express');
const router = express.Router();
const gitController = require('../controllers/gitController');

// GET
router.get('/is-repo', gitController.isRepo);
router.get('/status', gitController.status);
router.get('/log', gitController.log);
router.get('/branches', gitController.branches);
router.get('/diff', gitController.diff);
router.get('/remote-url', gitController.remoteUrl);

// POST
router.post('/add', gitController.add);
router.post('/unstage', gitController.unstage);
router.post('/commit', gitController.commit);
router.post('/push', gitController.push);
router.post('/pull', gitController.pull);
router.post('/checkout', gitController.checkout);
router.post('/branch', gitController.createBranch);
router.post('/init', gitController.init);
router.post('/config', gitController.setConfig);

module.exports = router;
