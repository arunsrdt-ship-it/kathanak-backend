const express = require('express');
const router = express.Router();
const adminAuth = require('../middleware/adminAuth');
const { getConfig, updateConfig } = require('../controllers/configController');

router.get('/',  getConfig);
router.patch('/', adminAuth, updateConfig);

module.exports = router;
