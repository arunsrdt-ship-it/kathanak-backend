const SiteConfig = require('../models/SiteConfig');
const { getRedis, getCacheKey } = require('../config/redis');

// ── @desc  Get site config ────────────────────────────────────────────────
// ── @route GET /api/config
// ── @access Public
const getConfig = async (req, res) => {
  try {
    const redis = getRedis();
    if (redis) {
      const cached = await redis.get(getCacheKey('site:config'));
      if (cached) return res.json({ success: true, data: cached });
    }

    let config = await SiteConfig.findOne({ key: 'main' });
    if (!config) {
      config = await SiteConfig.create({ key: 'main' }); // create with defaults
    }

    if (redis) await redis.set(getCacheKey('site:config'), config);

    res.json({ success: true, data: config });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── @desc  Update site config ─────────────────────────────────────────────
// ── @route PATCH /api/config
// ── @access Admin
const updateConfig = async (req, res) => {
  try {
    const allowed = [
      'heroTagline','heroHindi','heroTitle','heroSubtitle','heroDescription',
      'siteTitle','siteSubtitle','siteDescription','aboutText','contactEmail',
    ];
    const updates = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    const config = await SiteConfig.findOneAndUpdate(
      { key: 'main' },
      updates,
      { new: true, upsert: true }
    );

    const redis = getRedis();
    if (redis) await redis.del(getCacheKey('site:config')); // Invalidate cache

    res.json({ success: true, data: config });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getConfig, updateConfig };
