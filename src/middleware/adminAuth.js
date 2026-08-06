/**
 * Admin API Key middleware.
 * Protects write (POST, PUT, PATCH, DELETE) endpoints.
 * The frontend / admin panel must send:  X-Admin-Key: <ADMIN_API_KEY>
 */
const adminAuth = (req, res, next) => {
  const key = req.headers['x-admin-key'] || req.headers['authorization']?.replace('Bearer ', '');

  if (!process.env.ADMIN_API_KEY) {
    console.warn('⚠️  ADMIN_API_KEY is not set in .env — all admin routes are unprotected!');
    return next();
  }

  if (!key || key !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized: Invalid or missing admin key',
    });
  }

  next();
};

module.exports = adminAuth;
