const { getAuthUrl, exchangeCodeForTokens, isAuthorized } = require('../config/googleDrive');

// ── @desc    Check authorization status ───────────────────────────────────
// ── @route   GET /api/auth/status
// ── @access  Admin
const getStatus = (req, res) => {
  res.json({
    success: true,
    authorized: isAuthorized(),
    message: isAuthorized()
      ? '✅ Google Drive is authorized and ready.'
      : '⚠️  Google Drive is NOT authorized. Visit GET /api/auth/google to authorize.',
  });
};

// ── @desc    Redirect admin to Google OAuth consent screen ────────────────
// ── @route   GET /api/auth/google
// ── @access  Admin (requires X-Admin-Key header)
const initiateAuth = (req, res) => {
  const url = getAuthUrl();
  console.log('\n🔑 Redirecting admin to Google OAuth consent screen...');
  res.redirect(url);
};

// ── @desc    Handle OAuth callback — exchange code for tokens ─────────────
// ── @route   GET /api/auth/google/callback
// ── @access  Google (called by Google after user grants permission)
const handleCallback = async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    console.error('OAuth error:', error);
    return res.status(400).send(`
      <html><body style="font-family:sans-serif;padding:2rem;background:#0a0812;color:#f0eafa">
        <h2>❌ Authorization failed</h2>
        <p>${error}</p>
        <p>Please close this window and try again from <code>GET /api/auth/google</code></p>
      </body></html>
    `);
  }

  if (!code) {
    return res.status(400).send('Missing authorization code.');
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    console.log('✅ Google Drive authorized successfully! Tokens saved to file.');

    res.send(`
      <html>
        <head>
          <title>Kathanak — Drive Authorized</title>
          <meta http-equiv="refresh" content="3;url=${process.env.FRONTEND_URL || 'http://localhost:3000'}/admin" />
        </head>
        <body style="
          font-family: 'Inter', sans-serif;
          display: flex; flex-direction: column; align-items: center;
          justify-content: center; min-height: 100vh;
          background: #0a0812; color: #f0eafa; text-align: center; padding: 2rem;
        ">
          <div style="
            background: rgba(34,197,94,0.1); border: 1px solid rgba(34,197,94,0.3);
            border-radius: 16px; padding: 3rem 2rem; max-width: 480px;
          ">
            <div style="font-size:3rem;margin-bottom:1rem">✅</div>
            <h1 style="font-size:1.5rem;margin-bottom:0.5rem">Google Drive Authorized!</h1>
            <p style="color:#7a6f9b;margin-bottom:1.5rem">
              Your refresh token has been saved securely. You can now upload audio and video poetries.
            </p>
            <p style="font-size:0.85rem;margin-top:1rem;color:#4ade80">
              Redirecting back to admin dashboard in 3 seconds...
            </p>
            <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/admin" style="display:inline-block; margin-top:1rem; color:#f0eafa; text-decoration:underline; font-size:0.8rem">
              Click here if you are not redirected
            </a>
          </div>
          <script>
            setTimeout(() => {
              window.location.href = '${process.env.FRONTEND_URL || 'http://localhost:3000'}/admin';
            }, 3000);
          </script>
        </body>
      </html>
    `);
  } catch (err) {
    console.error('Token exchange error:', err);
    res.status(500).send(`
      <html><body style="font-family:sans-serif;padding:2rem;background:#0a0812;color:#f0eafa">
        <h2>❌ Token exchange failed</h2>
        <pre style="color:#f87171">${err.message}</pre>
        <p>Please close this window and try again.</p>
      </body></html>
    `);
  }
};

module.exports = { getStatus, initiateAuth, handleCallback };
