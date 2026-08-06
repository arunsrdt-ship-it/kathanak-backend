# Poetry Platform — Backend API

Node.js + Express + MongoDB backend.  
Large media files (audio/video) are uploaded to **your personal Google Drive** using **OAuth 2.0** — sign in with your Google account once, and it works forever. No service account, no JSON key file.

---

## 🚀 Quick Start

```bash
cd backend
npm install
cp .env.example .env   # then fill in your values (see below)
npm run dev
```

---

## 🔑 Google Drive OAuth 2.0 Setup (~3 minutes)

> You just need a Google Cloud project to get a **Client ID** and **Client Secret**.
> No service account, no JSON key file downloads.

### Step 1 — Create a Google Cloud Project

1. Go to [https://console.cloud.google.com](https://console.cloud.google.com)
2. Click **"New Project"** → name it (e.g., `kathanak-poetry`) → **Create**

### Step 2 — Enable Google Drive API

1. In your project, go to **APIs & Services → Library**
2. Search **Google Drive API** → click **Enable**

### Step 3 — Create OAuth 2.0 Credentials

1. Go to **APIs & Services → Credentials**
2. Click **"Create Credentials" → OAuth client ID**
3. If prompted, click **"Configure Consent Screen"** first:
   - Choose **External** → Fill in App name (e.g., "Kathanak") → Save & Continue
   - On Scopes page → click Save & Continue (no changes needed)
   - On Test Users page → **Add your own Gmail address** → Save & Continue
4. Back at Create Credentials → **Application type: Web application**
5. Under **"Authorized redirect URIs"**, click **Add URI** and enter:
   ```
   http://localhost:5000/api/auth/google/callback
   ```
6. Click **Create** — you'll get your **Client ID** and **Client Secret**

### Step 4 — Update Your `.env`

```env
GOOGLE_CLIENT_ID=your_client_id_here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your_secret_here
GOOGLE_REDIRECT_URI=http://localhost:5000/api/auth/google/callback
GOOGLE_DRIVE_FOLDER_ID=your_drive_folder_id   (see Step 5)
```

### Step 5 — Create a Drive Folder

1. Go to [https://drive.google.com](https://drive.google.com)
2. Create a new folder (e.g., `Poetry Platform Files`)
3. Copy the folder ID from the URL:
   ```
   https://drive.google.com/drive/folders/THIS_IS_YOUR_FOLDER_ID
   ```
4. Paste it into `GOOGLE_DRIVE_FOLDER_ID` in your `.env`

### Step 6 — Authorize (One-Time)

1. Start the server:
   ```bash
   npm run dev
   ```
2. Open this URL in your browser (**replace `your_key`** with your `ADMIN_API_KEY`):
   ```
   http://localhost:5000/api/auth/google?key=your_admin_key_here
   ```
3. Sign in with your Google account → Grant permission to manage Drive files
4. You'll see a ✅ success page — **you're done!**

> The refresh token is saved to `google-tokens.json` (gitignored).  
> You **never need to do this again** unless you revoke access in your Google account.

---

## 📡 API Reference

### Base URL
```
http://localhost:5000/api
```

### Auth (Admin)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/auth/status` | Admin | Check if Drive is authorized |
| `GET` | `/auth/google?key=<ADMIN_KEY>` | Admin | Initiate OAuth (open in browser) |
| `GET` | `/auth/google/callback` | Google | OAuth callback (called by Google) |

### Poetry

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/poetry` | Public | List poetries (filterable, paginated) |
| `GET` | `/poetry/:idOrSlug` | Public | Get a single poetry |
| `POST` | `/poetry` | Admin | Create poetry (multipart upload) |
| `PATCH` | `/poetry/:id` | Admin | Update a poetry |
| `DELETE` | `/poetry/:id` | Admin | Delete a poetry |
| `POST` | `/poetry/:id/like` | Public | Like a poetry |

### File Proxy

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/files/:poetryId` | Stream audio/video (Google Drive URL hidden) |

### Feedback

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/feedback` | Public | Submit feedback |
| `GET` | `/feedback` | Admin | List all feedback |

---

### Query Parameters — `GET /poetry`

| Param | Example | Description |
|-------|---------|-------------|
| `type` | `audio` | `text`, `audio`, or `video` |
| `language` | `hindi` | Filter by language |
| `tag` | `love` | Filter by tag |
| `featured` | `true` | Featured only |
| `search` | `raat` | Search title/tags |
| `page` | `1` | Page number |
| `limit` | `12` | Items per page (max 50) |
| `sort` | `-createdAt` | Sort field |

---

### Creating a Poetry — `POST /poetry`

`multipart/form-data` with header `X-Admin-Key: your_key`:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | ✅ | Title |
| `type` | string | ✅ | `text`, `audio`, `video` |
| `description` | string | | Short description |
| `content` | string | text type | Full poem text |
| `language` | string | | `hindi`, `english`, `urdu`, `other` |
| `tags` | JSON string | | e.g. `["love","rain"]` |
| `isFeatured` | boolean | | |
| `duration` | number | | Seconds |
| `media` | file | audio/video | The media file |
| `thumbnail` | file | | Cover image |

---

## 🔒 Security

- `driveFileId` is `select: false` in Mongoose — **never returned** in any API response
- `/api/files/:poetryId` **proxies** Drive content — clients never see Drive URLs
- Thumbnails are the **only** files with public Drive access
- All write endpoints require `X-Admin-Key` header
- OAuth tokens are stored in `google-tokens.json` (gitignored, never committed)

---

## 📁 Structure

```
backend/
├── server.js
├── .env.example
├── google-tokens.json       ← created after first OAuth login (gitignored)
└── src/
    ├── app.js
    ├── config/
    │   ├── db.js
    │   └── googleDrive.js   ← OAuth 2.0 auth + Drive helpers
    ├── models/
    │   ├── Poetry.js
    │   └── Feedback.js
    ├── middleware/
    │   ├── upload.js
    │   └── adminAuth.js
    ├── controllers/
    │   ├── authController.js      ← OAuth flow handler
    │   ├── poetryController.js
    │   └── feedbackController.js
    └── routes/
        ├── authRoutes.js
        ├── poetryRoutes.js
        ├── feedbackRoutes.js
        └── fileRoutes.js
```
