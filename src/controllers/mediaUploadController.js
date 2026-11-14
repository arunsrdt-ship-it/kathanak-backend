const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { createResumableUploadSession } = require('../config/googleDrive');
const {
  ALLOWED_AUDIO_TYPES,
  ALLOWED_VIDEO_TYPES,
  MAX_AUDIO_SIZE,
  MAX_VIDEO_SIZE,
} = require('../middleware/upload');

const createMediaUploadSession = async (req, res) => {
  try {
    const { fileName, mimeType, fileSize, type } = req.body || {};
    const isAudio = type === 'audio';
    const isVideo = type === 'video';
    const maxSize = isAudio ? MAX_AUDIO_SIZE : isVideo ? MAX_VIDEO_SIZE : 0;
    const allowedTypes = isAudio ? ALLOWED_AUDIO_TYPES : ALLOWED_VIDEO_TYPES;

    if (!isAudio && !isVideo) {
      return res.status(400).json({ success: false, message: 'Type must be audio or video' });
    }
    if (!fileName || typeof fileName !== 'string' || !mimeType || !allowedTypes.includes(mimeType)) {
      return res.status(400).json({ success: false, message: `Unsupported ${type} file type` });
    }
    if (!Number.isSafeInteger(fileSize) || fileSize < 1 || fileSize > maxSize) {
      return res.status(400).json({
        success: false,
        message: `${type === 'audio' ? 'Audio' : 'Video'} files must be under ${maxSize / (1024 * 1024)} MB`,
      });
    }

    const originalName = path.basename(fileName).replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 100) || 'media';
    const extension = path.extname(originalName);
    const driveFileName = `${uuidv4()}${extension}`;
    const sessionUrl = await createResumableUploadSession(
      driveFileName,
      mimeType,
      fileSize,
      process.env.GOOGLE_DRIVE_FOLDER_ID
    );

    res.json({ success: true, data: { sessionUrl } });
  } catch (error) {
    console.error('createMediaUploadSession error:', error);
    res.status(502).json({
      success: false,
      message: 'Could not prepare the Google Drive upload. Check the Drive connection and try again.',
    });
  }
};

module.exports = { createMediaUploadSession };
