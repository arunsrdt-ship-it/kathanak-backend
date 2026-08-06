const express = require('express');
const router = express.Router();
const { streamFile } = require('../controllers/poetryController');

// GET /api/files/:poetryId
// Proxies the Google Drive file stream — hides Drive URL from client
router.get('/:poetryId', streamFile);

module.exports = router;
