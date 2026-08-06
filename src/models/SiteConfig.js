const mongoose = require('mongoose');

const siteConfigSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'main', unique: true }, // singleton doc

    // ── Hero Section Content ──────────────────────────────────────────────
    heroTagline:    { type: String, default: 'Welcome to my world of words' },
    heroHindi:      { type: String, default: 'शब्दों में' },
    heroTitle:      { type: String, default: 'Emotions' },
    heroSubtitle:   { type: String, default: 'find their Voice' },
    heroDescription:{ type: String, default: 'A personal collection of original poetries — crafted in Hindi, Urdu & English. Listen, watch, or read. Let the words touch your heart.' },

    // ── Site Meta ─────────────────────────────────────────────────────────
    siteTitle:      { type: String, default: 'Kathanak' },
    siteSubtitle:   { type: String, default: 'शब्दों का संसार' },
    siteDescription:{ type: String, default: 'A personal poetry platform' },

    // ── About Section ─────────────────────────────────────────────────────
    aboutText:      { type: String, default: '' },
    contactEmail:   { type: String, default: 'hello@kathanak.in' },
  },
  { timestamps: true }
);

const SiteConfig = mongoose.model('SiteConfig', siteConfigSchema);
module.exports = SiteConfig;
