const express = require('express');
const router = express.Router();
const adminAuth = require('../middleware/adminAuth');
const { submitFeedback, getAllFeedback, deleteFeedback } = require('../controllers/feedbackController');

router.post('/', submitFeedback);
router.get('/', adminAuth, getAllFeedback);
router.delete('/:id', adminAuth, deleteFeedback);

module.exports = router;
