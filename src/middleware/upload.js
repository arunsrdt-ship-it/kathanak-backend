const multer = require('multer');

// ── Allowed MIME types ────────────────────────────────────────────────────
const ALLOWED_AUDIO_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/flac', 'audio/m4a', 'audio/mp4', 'audio/x-m4a'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-msvideo', 'video/mpeg'];
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const ALL_ALLOWED = [...ALLOWED_AUDIO_TYPES, ...ALLOWED_VIDEO_TYPES, ...ALLOWED_IMAGE_TYPES];

// ── File size limits ──────────────────────────────────────────────────────
const MAX_AUDIO_SIZE = 100 * 1024 * 1024;  // 100 MB
const MAX_VIDEO_SIZE = 500 * 1024 * 1024;  // 500 MB
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;   // 10 MB

// ── Memory storage (files buffered in RAM, then streamed to Google Drive) ─
const storage = multer.memoryStorage();

// ── File filter ───────────────────────────────────────────────────────────
const fileFilter = (req, file, cb) => {
  if (ALL_ALLOWED.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `Unsupported file type: ${file.mimetype}. ` +
        `Allowed types: audio (mp3/wav/ogg/aac/flac/m4a), video (mp4/webm/mov/avi), image (jpg/png/webp/gif)`
      ),
      false
    );
  }
};

// ── Main upload instance (handles both media + thumbnail in one request) ──
const upload = multer({
  storage,
  fileFilter,
  limits: {
    // Use the largest limit here; per-file validation done in middleware below
    fileSize: MAX_VIDEO_SIZE,
    files: 2, // max 2 files per request: media + thumbnail
  },
});

// ── Per-file size validator middleware ────────────────────────────────────
const validateFileSizes = (req, res, next) => {
  const files = req.files || {};

  if (files.media && files.media[0]) {
    const media = files.media[0];
    const isAudio = ALLOWED_AUDIO_TYPES.includes(media.mimetype);
    const isVideo = ALLOWED_VIDEO_TYPES.includes(media.mimetype);

    if (isAudio && media.size > MAX_AUDIO_SIZE) {
      return res.status(400).json({
        success: false,
        message: `Audio files must be under ${MAX_AUDIO_SIZE / (1024 * 1024)} MB`,
      });
    }
    if (isVideo && media.size > MAX_VIDEO_SIZE) {
      return res.status(400).json({
        success: false,
        message: `Video files must be under ${MAX_VIDEO_SIZE / (1024 * 1024)} MB`,
      });
    }
  }

  if (files.thumbnail && files.thumbnail[0]) {
    if (files.thumbnail[0].size > MAX_IMAGE_SIZE) {
      return res.status(400).json({
        success: false,
        message: `Thumbnail images must be under ${MAX_IMAGE_SIZE / (1024 * 1024)} MB`,
      });
    }
  }

  next();
};

// ── Exported upload configurations ────────────────────────────────────────
module.exports = {
  // For creating a poetry with optional media + thumbnail
  uploadPoetryFiles: upload.fields([
    { name: 'media', maxCount: 1 },
    { name: 'thumbnail', maxCount: 1 },
  ]),
  validateFileSizes,

  // Helper sets
  ALLOWED_AUDIO_TYPES,
  ALLOWED_VIDEO_TYPES,
  ALLOWED_IMAGE_TYPES,
};
