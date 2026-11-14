const path = require('path');
const { createHmac, timingSafeEqual } = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { createResumableUploadSession } = require('../config/googleDrive');
const {
  ALLOWED_AUDIO_TYPES,
  ALLOWED_VIDEO_TYPES,
  MAX_AUDIO_SIZE,
  MAX_VIDEO_SIZE,
} = require('../middleware/upload');

const UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024;
const DRIVE_CHUNK_ALIGNMENT = 256 * 1024;
const UPLOAD_TOKEN_TTL_MS = 6 * 60 * 60 * 1000;

const getUploadTokenSecret = () => process.env.ADMIN_API_KEY || process.env.GOOGLE_CLIENT_SECRET;

const createUploadToken = (payload) => {
  const secret = getUploadTokenSecret();
  if (!secret) throw new Error('ADMIN_API_KEY or GOOGLE_CLIENT_SECRET must be configured');

  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${signature}`;
};

const readUploadToken = (token) => {
  if (!token || typeof token !== 'string') return null;
  const [encodedPayload, signature, extra] = token.split('.');
  const secret = getUploadTokenSecret();
  if (!secret || !encodedPayload || !signature || extra !== undefined) return null;

  const expected = createHmac('sha256', secret).update(encodedPayload).digest();
  let supplied;
  try {
    supplied = Buffer.from(signature, 'base64url');
  } catch {
    return null;
  }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (payload.expiresAt < Date.now()) return null;
    if (!Number.isSafeInteger(payload.fileSize) || !payload.mimeType) return null;
    if (!payload.sessionUrl?.startsWith('https://www.googleapis.com/upload/drive/v3/files?')) return null;
    return payload;
  } catch {
    return null;
  }
};

const getDriveUploadOffset = (response) => {
  const range = response.headers.get('range');
  const lastReceived = range?.match(/bytes=0-(\d+)/)?.[1];
  return lastReceived ? Number(lastReceived) + 1 : null;
};

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

    const uploadToken = createUploadToken({
      sessionUrl,
      mimeType,
      fileSize,
      expiresAt: Date.now() + UPLOAD_TOKEN_TTL_MS,
    });
    res.json({ success: true, data: { uploadToken } });
  } catch (error) {
    console.error('createMediaUploadSession error:', error);
    res.status(502).json({
      success: false,
      message: 'Could not prepare the Google Drive upload. Check the Drive connection and try again.',
    });
  }
};

const uploadMediaChunk = async (req, res) => {
  const upload = readUploadToken(req.get('x-upload-token'));
  if (!upload) {
    return res.status(401).json({ success: false, message: 'Upload session expired or invalid. Start the upload again.' });
  }

  const contentRange = req.get('content-range') || '';
  const match = contentRange.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
  if (!match || !Buffer.isBuffer(req.body)) {
    return res.status(400).json({ success: false, message: 'Invalid upload chunk request' });
  }

  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  const chunkLength = end - start + 1;
  if (
    total !== upload.fileSize ||
    start % DRIVE_CHUNK_ALIGNMENT !== 0 ||
    chunkLength < 1 ||
    chunkLength > UPLOAD_CHUNK_SIZE ||
    (chunkLength % DRIVE_CHUNK_ALIGNMENT !== 0 && end !== upload.fileSize - 1) ||
    req.body.length !== chunkLength
  ) {
    return res.status(400).json({ success: false, message: 'Upload chunk size or range is invalid' });
  }

  try {
    const driveResponse = await fetch(upload.sessionUrl, {
      method: 'PUT',
      redirect: 'manual',
      headers: {
        'Content-Length': String(req.body.length),
        'Content-Range': contentRange,
        'Content-Type': upload.mimeType,
      },
      body: req.body,
    });

    if (driveResponse.status === 308) {
      let nextOffset = getDriveUploadOffset(driveResponse);
      if (nextOffset === null) {
        // Google omits Range when it has not confirmed any bytes. Query the
        // resumable session so the browser can safely retry from the right byte.
        const statusResponse = await fetch(upload.sessionUrl, {
          method: 'PUT',
          redirect: 'manual',
          headers: {
            'Content-Length': '0',
            'Content-Range': `bytes */${upload.fileSize}`,
            'Content-Type': upload.mimeType,
          },
          body: Buffer.alloc(0),
        });
        if (statusResponse.status === 200 || statusResponse.status === 201) {
          const uploadedFile = await statusResponse.json();
          if (!uploadedFile.id) throw new Error('Google Drive returned no file ID after upload');
          return res.json({ success: true, data: { complete: true, fileId: uploadedFile.id } });
        }
        if (statusResponse.status !== 308) {
          return res.status(502).json({ success: false, message: 'Could not confirm the Google Drive upload position.' });
        }
        nextOffset = getDriveUploadOffset(statusResponse) ?? 0;
      }
      return res.json({
        success: true,
        data: { complete: false, nextOffset },
      });
    }

    if (driveResponse.status === 200 || driveResponse.status === 201) {
      const uploadedFile = await driveResponse.json();
      if (!uploadedFile.id) throw new Error('Google Drive returned no file ID after upload');
      return res.json({ success: true, data: { complete: true, fileId: uploadedFile.id } });
    }

    const details = await driveResponse.text().catch(() => '');
    console.error(`Google Drive chunk upload failed (${driveResponse.status}):`, details.slice(0, 500));
    return res.status(502).json({
      success: false,
      message: `Google Drive rejected an upload chunk (${driveResponse.status}). Please retry the upload.`,
    });
  } catch (error) {
    console.error('uploadMediaChunk error:', error);
    return res.status(502).json({ success: false, message: 'Could not forward this chunk to Google Drive. Please retry.' });
  }
};

module.exports = { createMediaUploadSession, uploadMediaChunk, UPLOAD_CHUNK_SIZE };
