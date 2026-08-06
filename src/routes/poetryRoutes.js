const express = require('express');
const router = express.Router();
const adminAuth = require('../middleware/adminAuth');
const { uploadPoetryFiles, validateFileSizes } = require('../middleware/upload');
const {
  createPoetry,
  getAllPoetrys,
  getPoetryById,
  streamFile,
  updatePoetry,
  deletePoetry,
  likePoetry,
} = require('../controllers/poetryController');

// ── Public routes ─────────────────────────────────────────────────────────
router.get('/', getAllPoetrys);
router.get('/:idOrSlug', getPoetryById);
router.post('/:id/like', likePoetry);

// ── Admin routes (require X-Admin-Key header) ─────────────────────────────
router.post(
  '/',
  adminAuth,
  uploadPoetryFiles,
  validateFileSizes,
  createPoetry
);

router.patch(
  '/:id',
  adminAuth,
  uploadPoetryFiles,
  validateFileSizes,
  updatePoetry
);

router.delete('/:id', adminAuth, deletePoetry);

module.exports = router;
