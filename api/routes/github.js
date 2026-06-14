const express = require('express');
const router = express.Router();
const githubController = require('../controllers/githubController');

router.post('/create-repo', githubController.createRepo);
router.post('/update-repo', githubController.updateRepo);
router.post('/clone-repo', githubController.cloneRepo);
router.get('/repos', githubController.listRepos);
router.post('/delete-repo', githubController.deleteRepo);
router.post('/sync-local', githubController.syncLocal);
router.post('/check-linked', githubController.checkLinked);
router.post('/remove-remote', githubController.removeRemote);

module.exports = router;
