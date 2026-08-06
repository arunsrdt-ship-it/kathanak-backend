const express = require('express');
const router = express.Router();
const adminAuth = require('../middleware/adminAuth');
const { getStatus, initiateAuth, handleCallback } = require('../controllers/authController');

// GET /api/auth/status — check if Drive is authorized (admin only)
router.get('/status', adminAuth, getStatus);

// GET /api/auth/google — redirect to Google consent screen (admin only)
// Open this URL in a browser: http://localhost:5000/api/auth/google
// with header: X-Admin-Key: <your_key>
// OR add ?key=<your_key> to the URL for easy browser access
router.get('/google', (req, res, next) => {
  // Allow key as query param for easy browser testing
  if (req.query.key && req.query.key === process.env.ADMIN_API_KEY) {
    return next();
  }
  // Fall through to adminAuth middleware
  adminAuth(req, res, next);
}, initiateAuth);

// GET /api/auth/google/callback — Google redirects here after user grants permission
// This route is PUBLIC (called by Google's servers)
router.get('/google/callback', handleCallback);

module.exports = router;
