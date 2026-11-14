const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

// ── Token storage path (local file, gitignored) ───────────────────────────
const TOKEN_PATH = path.resolve(process.env.GOOGLE_TOKEN_PATH || './google-tokens.json');

// ── Build OAuth2 client ───────────────────────────────────────────────────
const getOAuth2Client = () => {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/auth/google/callback'
  );
  return client;
};

// ── Load stored tokens from file ──────────────────────────────────────────
const loadTokens = () => {
  if (fs.existsSync(TOKEN_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    } catch {
      return null;
    }
  }
  return null;
};

// ── Save tokens to file ───────────────────────────────────────────────────
const saveTokens = (tokens) => {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
};

// ── Get an authenticated OAuth2 client with stored tokens ─────────────────
const getAuthenticatedClient = () => {
  const tokens = loadTokens();

  if (!tokens || !tokens.refresh_token) {
    throw new Error(
      '🔑 Google Drive is not authorized yet.\n' +
      'Please visit GET /api/auth/google (with your X-Admin-Key header) to authorize.\n' +
      'You only need to do this once.'
    );
  }

  const auth = getOAuth2Client();
  auth.setCredentials(tokens);

  // Auto-refresh access token when it expires
  auth.on('tokens', (newTokens) => {
    const existing = loadTokens() || {};
    const merged = { ...existing, ...newTokens };
    saveTokens(merged);
    console.log('🔄 Google tokens auto-refreshed and saved.');
  });

  return auth;
};

// ── Get a Drive client instance ───────────────────────────────────────────
const getDriveClient = () => {
  const auth = getAuthenticatedClient();
  return google.drive({ version: 'v3', auth });
};

// ── Generate the Google OAuth authorization URL ───────────────────────────
const getAuthUrl = () => {
  const auth = getOAuth2Client();
  return auth.generateAuthUrl({
    access_type: 'offline',       // gets a refresh_token
    prompt: 'consent',            // always show consent to ensure refresh_token is returned
    scope: ['https://www.googleapis.com/auth/drive'],
  });
};

// ── Exchange auth code for tokens ─────────────────────────────────────────
const exchangeCodeForTokens = async (code) => {
  const auth = getOAuth2Client();
  const { tokens } = await auth.getToken(code);
  saveTokens(tokens);
  return tokens;
};

// ── Check if already authorized ──────────────────────────────────────────
const isAuthorized = () => {
  const tokens = loadTokens();
  return !!(tokens && tokens.refresh_token);
};

// ── Upload a file to Google Drive ─────────────────────────────────────────
const { Readable } = require('stream');
const { v4: uuidv4 } = require('uuid');

const uploadFileToDrive = async (fileBuffer, mimeType, fileName, folderId) => {
  const drive = getDriveClient();

  const readable = new Readable();
  readable.push(fileBuffer);
  readable.push(null);

  const response = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType, body: readable },
    fields: 'id',
  });

  return response.data.id; // Internal file ID only — never exposed to clients
};

// Create a Google Drive resumable upload session. The media bytes are uploaded
// by the browser directly to Drive, so large files never pass through Render.
const createResumableUploadSession = async (fileName, mimeType, fileSize, folderId) => {
  if (!folderId) throw new Error('GOOGLE_DRIVE_FOLDER_ID is not configured');

  const auth = getAuthenticatedClient();
  const { token } = await auth.getAccessToken();
  if (!token) throw new Error('Unable to get a Google Drive access token');

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
        'X-Upload-Content-Length': String(fileSize),
      },
      body: JSON.stringify({ name: fileName, mimeType, parents: [folderId] }),
    }
  );

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`Google Drive could not start the upload (${response.status}): ${details.slice(0, 300)}`);
  }

  const sessionUrl = response.headers.get('location');
  if (!sessionUrl || !sessionUrl.startsWith('https://www.googleapis.com/upload/drive/v3/files?')) {
    throw new Error('Google Drive returned an invalid upload session URL');
  }

  return sessionUrl;
};

// ── Get a readable stream for a Drive file (for proxying) ─────────────────
const getFileStream = async (fileId, rangeHeader = null) => {
  const drive = getDriveClient();

  const meta = await drive.files.get({
    fileId,
    fields: 'mimeType, size, name',
  });

  const requestOptions = { responseType: 'stream' };
  if (rangeHeader) {
    requestOptions.headers = { Range: rangeHeader };
  }

  const streamResponse = await drive.files.get(
    { fileId, alt: 'media' },
    requestOptions
  );

  return {
    stream: streamResponse.data,
    mimeType: meta.data.mimeType,
    size: meta.data.size,
    name: meta.data.name,
  };
};

// ── Delete a file from Google Drive ──────────────────────────────────────
const deleteFileFromDrive = async (fileId) => {
  const drive = getDriveClient();
  await drive.files.delete({ fileId });
};

// ── Upload a thumbnail (made publicly readable for <img> display) ─────────
const uploadThumbnailToDrive = async (fileBuffer, mimeType, fileName, folderId) => {
  const drive = getDriveClient();

  const readable = new Readable();
  readable.push(fileBuffer);
  readable.push(null);

  const response = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType, body: readable },
    fields: 'id',
  });

  const fileId = response.data.id;

  // Thumbnails are the ONLY files made public (safe — they're just cover images)
  await drive.permissions.create({
    fileId,
    requestBody: { role: 'reader', type: 'anyone' },
  });

  return {
    fileId,
    publicUrl: `https://lh3.googleusercontent.com/d/${fileId}`,
  };
};

module.exports = {
  getAuthUrl,
  exchangeCodeForTokens,
  isAuthorized,
  uploadFileToDrive,
  createResumableUploadSession,
  getFileStream,
  deleteFileFromDrive,
  uploadThumbnailToDrive,
};
