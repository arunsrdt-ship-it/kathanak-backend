const express = require('express');
const router = express.Router();
const adminAuth = require('../middleware/adminAuth');
const { uploadPoetryFiles, validateFileSizes } = require('../middleware/upload');
const { createMediaUploadSession, uploadMediaChunk, UPLOAD_CHUNK_SIZE } = require('../controllers/mediaUploadController');
const {
  createPoetry,
  getAdminPoetrys,
  getAdminPoetryById,
  getAllPoetrys,
  getPoetryById,
  streamFile,
  updatePoetry,
  deletePoetry,
  likePoetry,
} = require('../controllers/poetryController');

// ── Public routes ─────────────────────────────────────────────────────────
router.get('/admin', adminAuth, getAdminPoetrys);
router.get('/admin/:id', adminAuth, getAdminPoetryById);
router.post('/upload-session', adminAuth, createMediaUploadSession);
router.put(
  '/upload-session/chunk',
  adminAuth,
  express.raw({ type: 'application/octet-stream', limit: UPLOAD_CHUNK_SIZE }),
  uploadMediaChunk
);
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
