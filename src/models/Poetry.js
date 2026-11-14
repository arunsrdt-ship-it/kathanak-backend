const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const poetrySchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
    },

    slug: {
      type: String,
      unique: true,
      lowercase: true,
      trim: true,
    },

    description: {
      type: String,
      trim: true,
      maxlength: [1000, 'Description cannot exceed 1000 characters'],
    },

    // ── Text content (for read-only poetry type) ──────────────────────────
    content: {
      type: String,
      default: null,
    },

    // ── Media type ────────────────────────────────────────────────────────
    type: {
      type: String,
      enum: ['text', 'audio', 'video'],
      required: [true, 'Poetry type is required'],
    },

    // ── Google Drive file IDs (INTERNAL ONLY — never returned in API) ─────
    driveFileId: {
      type: String,
      default: null,
      select: false, // excluded from all queries by default
    },

    driveThumbnailFileId: {
      type: String,
      default: null,
      select: false, // excluded from all queries by default
    },

    // ── Public thumbnail URL (safe to expose — thumbnail only) ───────────
    thumbnailUrl: {
      type: String,
      default: null,
    },

    // ── Language / category ───────────────────────────────────────────────
    language: {
      type: String,
      enum: ['hindi', 'english', 'urdu', 'other'],
      default: 'hindi',
    },

    tags: {
      type: [String],
      default: [],
    },

    // ── Visibility ────────────────────────────────────────────────────────
    isFeatured: {
      type: Boolean,
      default: false,
    },

    isPublished: {
      type: Boolean,
      default: true,
    },

    // ── Stats ─────────────────────────────────────────────────────────────
    views: {
      type: Number,
      default: 0,
    },

    likes: {
      type: Number,
      default: 0,
    },

    // ── Duration (for audio/video in seconds) ─────────────────────────────
    duration: {
      type: Number,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ── Auto-generate slug from title before saving ───────────────────────────
poetrySchema.pre('save', async function (next) {
  if (this.isModified('title') || this.isNew) {
    let baseSlug = this.title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();

    // Hindi/Urdu titles may not contain Latin characters; ensure every entry
    // still gets a usable, unique URL slug.
    if (!baseSlug) baseSlug = `poem-${uuidv4().slice(0, 8)}`;

    // Ensure uniqueness
    let slug = baseSlug;
    let count = 1;
    while (await mongoose.model('Poetry').exists({ slug, _id: { $ne: this._id } })) {
      slug = `${baseSlug}-${count}`;
      count++;
    }
    this.slug = slug;
  }
  next();
});

// ── Index for fast queries ────────────────────────────────────────────────
poetrySchema.index({ type: 1, isPublished: 1 });
poetrySchema.index({ isFeatured: 1 });
poetrySchema.index({ tags: 1 });
poetrySchema.index({ createdAt: -1 });

// ── Virtual: hasMedia ─────────────────────────────────────────────────────
poetrySchema.virtual('hasMedia').get(function () {
  return this.type !== 'text';
});

const Poetry = mongoose.model('Poetry', poetrySchema);

module.exports = Poetry;
