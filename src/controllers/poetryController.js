const Poetry = require('../models/Poetry');
const {
  uploadFileToDrive,
  uploadThumbnailToDrive,
  getFileStream,
  deleteFileFromDrive,
} = require('../config/googleDrive');
const {
  getCacheKey,
  getCached,
  setCached,
  deleteCached,
  deleteCachedPattern,
} = require('../config/redis');

// Helper to generate a consistent cache key for poetry lists
const generateListCacheKey = (query) => {
  return getCacheKey(`poetry:list:${JSON.stringify(query)}`);
};
const { ALLOWED_AUDIO_TYPES, ALLOWED_VIDEO_TYPES } = require('../middleware/upload');
const { v4: uuidv4 } = require('uuid');

const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── Helpers ───────────────────────────────────────────────────────────────
const safeFilename = (originalName) => {
  const ext = originalName.split('.').pop();
  return `${uuidv4()}.${ext}`;
};

const mediaFileMatchesType = (type, mimeType) => (
  type === 'audio'
    ? ALLOWED_AUDIO_TYPES.includes(mimeType)
    : type === 'video' && ALLOWED_VIDEO_TYPES.includes(mimeType)
);

// ── @desc    Create a new poetry ──────────────────────────────────────────
// ── @route   POST /api/poetry
// ── @access  Admin
const createPoetry = async (req, res) => {
  try {
    const { title, description, content, type, language, tags, isFeatured, isPublished, duration } = req.body;

    if (!title || !type) {
      return res.status(400).json({ success: false, message: 'Title and type are required' });
    }
    if (type === 'text' && !content?.trim()) {
      return res.status(400).json({ success: false, message: 'Poem text is required for written entries' });
    }
    if (!['text', 'audio', 'video'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Type must be text, audio, or video' });
    }

    let driveFileId = null;
    let driveThumbnailFileId = null;
    let thumbnailUrl = null;

    // ── Upload main media file (audio / video) ───────────────────────────
    const mediaFile = req.files?.media?.[0];
    if (type !== 'text' && !mediaFile) {
      return res.status(400).json({ success: false, message: `A ${type} file is required` });
    }
    if (mediaFile && type !== 'text' && !mediaFileMatchesType(type, mediaFile.mimetype)) {
      return res.status(400).json({
        success: false,
        message: `The uploaded file is not a supported ${type} format.`,
      });
    }
    if (mediaFile && type !== 'text') {
      driveFileId = await uploadFileToDrive(
        mediaFile.buffer,
        mediaFile.mimetype,
        safeFilename(mediaFile.originalname),
        DRIVE_FOLDER_ID
      );
    }

    // ── Upload thumbnail ─────────────────────────────────────────────────
    const thumbnailFile = req.files?.thumbnail?.[0];
    if (thumbnailFile) {
      const result = await uploadThumbnailToDrive(
        thumbnailFile.buffer,
        thumbnailFile.mimetype,
        safeFilename(thumbnailFile.originalname),
        DRIVE_FOLDER_ID
      );
      driveThumbnailFileId = result.fileId;
      thumbnailUrl = result.publicUrl;
    }

    // ── Parse tags ───────────────────────────────────────────────────────
    let parsedTags = [];
    if (tags) {
      parsedTags = typeof tags === 'string' ? JSON.parse(tags) : tags;
    }

    // ── Save to DB ───────────────────────────────────────────────────────
    const poetry = await Poetry.create({
      title,
      description,
      content: type === 'text' ? content : null,
      type,
      language: language || 'hindi',
      tags: parsedTags,
      isFeatured: isFeatured === 'true' || isFeatured === true,
      isPublished: isPublished === undefined ? true : isPublished === 'true' || isPublished === true,
      driveFileId,         // stored in DB, never returned in public responses
      driveThumbnailFileId,
      thumbnailUrl: thumbnailUrl || req.body.thumbnailUrl || null, // safe to expose (public thumbnail)
      duration: duration ? Number(duration) : null,
    });

    // Invalidate caches
    await deleteCachedPattern(getCacheKey('poetry:list:*'));

    // Return without driveFileId (it's select:false on the model)
    res.status(201).json({
      success: true,
      message: 'Poetry created successfully',
      data: poetry,
    });
  } catch (error) {
    console.error('createPoetry error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Admin list includes drafts, unlike the public archive endpoint.
const getAdminPoetrys = async (req, res) => {
  try {
    const { page = 1, limit = 100, search, type } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 100));
    const filter = {};

    if (type) filter.type = type;
    if (search) {
      filter.$or = [
        { title: { $regex: escapeRegex(search), $options: 'i' } },
        { description: { $regex: escapeRegex(search), $options: 'i' } },
        { type: { $regex: escapeRegex(search), $options: 'i' } },
      ];
    }

    const [poetries, total] = await Promise.all([
      Poetry.find(filter)
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .select('-driveFileId -driveThumbnailFileId'),
      Poetry.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: poetries,
      pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    console.error('getAdminPoetrys error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const getAdminPoetryById = async (req, res) => {
  try {
    const poetry = await Poetry.findById(req.params.id)
      .select('-driveFileId -driveThumbnailFileId');
    if (!poetry) {
      return res.status(404).json({ success: false, message: 'Poetry not found' });
    }
    res.json({ success: true, data: poetry });
  } catch (error) {
    console.error('getAdminPoetryById error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── @desc    Get all poetries (paginated, filterable) ─────────────────────
// ── @route   GET /api/poetry
// ── @access  Public
const getAllPoetrys = async (req, res) => {
  try {
    const cacheKey = generateListCacheKey(req.query);
    const cached = await getCached(cacheKey);
    if (cached) return res.json(cached); // cached response has success, data, pagination

    const {
      type,
      language,
      tag,
      featured,
      page = 1,
      limit = 12,
      search,
      sort = '-createdAt',
    } = req.query;

    const filter = { isPublished: true };

    if (type) filter.type = type;
    if (language) filter.language = language;
    if (tag) filter.tags = { $in: [tag] };
    if (featured === 'true') filter.isFeatured = true;
    if (search) {
      filter.$or = [
        { title: { $regex: escapeRegex(search), $options: 'i' } },
        { description: { $regex: escapeRegex(search), $options: 'i' } },
        { tags: { $in: [new RegExp(escapeRegex(search), 'i')] } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [poetries, total] = await Promise.all([
      Poetry.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .select('-driveFileId -driveThumbnailFileId'), // explicit exclusion as extra safety
      Poetry.countDocuments(filter),
    ]);

    const responseData = {
      success: true,
      data: poetries,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum),
      },
    };

    // Cache for 10 minutes; a cache outage won't fail the response.
    await setCached(cacheKey, responseData, 600);

    res.json(responseData);
  } catch (error) {
    console.error('getAllPoetrys error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── @desc    Get single poetry by ID or slug ──────────────────────────────
// ── @route   GET /api/poetry/:idOrSlug
// ── @access  Public
const getPoetryById = async (req, res) => {
  try {
    const { idOrSlug } = req.params;
    const isObjectId = /^[a-f\d]{24}$/i.test(idOrSlug);

    const cacheKey = getCacheKey(`poetry:detail:${idOrSlug}`);
    const cached = await getCached(cacheKey);
    if (cached) return res.json({ success: true, data: cached });

    const query = isObjectId ? { _id: idOrSlug } : { slug: idOrSlug };

    const poetry = await Poetry.findOneAndUpdate(
      { ...query, isPublished: true },
      { $inc: { views: 1 } },
      { new: true }
    ).select('-driveFileId -driveThumbnailFileId');

    if (!poetry) {
      return res.status(404).json({ success: false, message: 'Poetry not found' });
    }

    await setCached(cacheKey, poetry, 3600); // Cache for 1 hour

    res.json({ success: true, data: poetry });
  } catch (error) {
    console.error('getPoetryById error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── @desc    Stream a media file (audio/video) via proxy ─────────────────
// ── @route   GET /api/files/:poetryId
// ── @access  Public (but hides Google Drive URL)
const streamFile = async (req, res) => {
  try {
    const { poetryId } = req.params;

    // Fetch driveFileId explicitly (select:false means we must opt in)
    const poetry = await Poetry.findOne({
      _id: poetryId,
      isPublished: true,
    }).select('+driveFileId');

    if (!poetry || !poetry.driveFileId) {
      return res.status(404).json({ success: false, message: 'Media not found' });
    }

    // ── Range support (enables seeking in audio/video players) ───────────
    const range = req.headers.range;

    const { stream, mimeType, size } = await getFileStream(poetry.driveFileId, range);

    if (range && size) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : Number(size) - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=31536000',
      });
    } else {
      res.setHeader('Content-Type', mimeType);
      if (size) res.setHeader('Content-Length', size);
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      res.setHeader('Accept-Ranges', 'bytes');
    }

    stream.pipe(res);

    stream.on('error', (err) => {
      console.error('Stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: 'Stream failed' });
      }
    });
  } catch (error) {
    console.error('streamFile error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── @desc    Update a poetry ──────────────────────────────────────────────
// ── @route   PATCH /api/poetry/:id
// ── @access  Admin
const updatePoetry = async (req, res) => {
  try {
    const poetry = await Poetry.findById(req.params.id)
      .select('+driveFileId +driveThumbnailFileId');
    if (!poetry) {
      return res.status(404).json({ success: false, message: 'Poetry not found' });
    }

    const allowed = [
      'title', 'description', 'content', 'type', 'language',
      'isFeatured', 'isPublished', 'duration', 'thumbnailUrl',
    ];
    const updates = {};
    allowed.forEach((field) => {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    });
    if (req.body.tags !== undefined) {
      updates.tags = typeof req.body.tags === 'string'
        ? JSON.parse(req.body.tags)
        : req.body.tags;
    }
    for (const field of ['isFeatured', 'isPublished']) {
      if (updates[field] !== undefined) {
        updates[field] = updates[field] === true || updates[field] === 'true';
      }
    }
    if (updates.duration !== undefined) {
      updates.duration = updates.duration === '' ? null : Number(updates.duration);
    }

    if (updates.title && updates.title.trim() !== poetry.title) {
      const baseSlug = updates.title.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim() || `poem-${uuidv4().slice(0, 8)}`;
      let slug = baseSlug;
      let suffix = 1;
      while (await Poetry.exists({ slug, _id: { $ne: poetry._id } })) {
        slug = `${baseSlug}-${suffix++}`;
      }
      updates.slug = slug;
    }

    const oldMediaId = poetry.driveFileId;
    const oldThumbnailId = poetry.driveThumbnailFileId;
    const oldSlug = poetry.slug;
    let newMediaId = null;
    let newThumbnailId = null;

    const mediaFile = req.files?.media?.[0];
    const nextType = updates.type || poetry.type;
    if (nextType !== 'text' && nextType !== poetry.type && !mediaFile) {
      return res.status(400).json({
        success: false,
        message: 'Upload a new media file when changing the entry type.',
      });
    }
    if (nextType !== 'text' && !mediaFile && !poetry.driveFileId) {
      return res.status(400).json({
        success: false,
        message: 'An audio or video entry needs a media file.',
      });
    }
    if (mediaFile && nextType !== 'text' && !mediaFileMatchesType(nextType, mediaFile.mimetype)) {
      return res.status(400).json({
        success: false,
        message: `The uploaded file is not a supported ${nextType} format.`,
      });
    }
    if (mediaFile && nextType !== 'text') {
      newMediaId = await uploadFileToDrive(
        mediaFile.buffer,
        mediaFile.mimetype,
        safeFilename(mediaFile.originalname),
        DRIVE_FOLDER_ID
      );
      updates.driveFileId = newMediaId;
    } else if (nextType === 'text') {
      updates.driveFileId = null;
    }

    const thumbnailFile = req.files?.thumbnail?.[0];
    if (thumbnailFile) {
      const result = await uploadThumbnailToDrive(
        thumbnailFile.buffer,
        thumbnailFile.mimetype,
        safeFilename(thumbnailFile.originalname),
        DRIVE_FOLDER_ID
      );
      newThumbnailId = result.fileId;
      updates.driveThumbnailFileId = result.fileId;
      updates.thumbnailUrl = result.publicUrl;
    }

    if (nextType === 'text') updates.content = req.body.content ?? poetry.content;
    const updatedPoetry = await Poetry.findByIdAndUpdate(
      req.params.id, updates, { new: true, runValidators: true }
    ).select('-driveFileId -driveThumbnailFileId');

    if (oldMediaId && (updates.driveFileId === null || newMediaId)) {
      await deleteFileFromDrive(oldMediaId).catch((err) =>
        console.warn('Drive delete warning (replaced media):', err.message)
      );
    }
    if (oldThumbnailId && newThumbnailId) {
      await deleteFileFromDrive(oldThumbnailId).catch((err) =>
        console.warn('Drive delete warning (replaced thumbnail):', err.message)
      );
    }

    // Invalidate caches
    await deleteCached(
      getCacheKey(`poetry:detail:${updatedPoetry._id}`),
      getCacheKey(`poetry:detail:${updatedPoetry.slug}`),
      getCacheKey(`poetry:detail:${oldSlug}`)
    );
    await deleteCachedPattern(getCacheKey('poetry:list:*'));

    res.json({ success: true, message: 'Poetry updated', data: updatedPoetry });
  } catch (error) {
    console.error('updatePoetry error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── @desc    Delete a poetry ──────────────────────────────────────────────
// ── @route   DELETE /api/poetry/:id
// ── @access  Admin
const deletePoetry = async (req, res) => {
  try {
    const poetry = await Poetry.findById(req.params.id).select('+driveFileId +driveThumbnailFileId');

    if (!poetry) {
      return res.status(404).json({ success: false, message: 'Poetry not found' });
    }

    // Delete files from Google Drive
    if (poetry.driveFileId) {
      await deleteFileFromDrive(poetry.driveFileId).catch((err) =>
        console.warn('Drive delete warning (media):', err.message)
      );
    }
    if (poetry.driveThumbnailFileId) {
      await deleteFileFromDrive(poetry.driveThumbnailFileId).catch((err) =>
        console.warn('Drive delete warning (thumbnail):', err.message)
      );
    }

    await poetry.deleteOne();

    // Invalidate caches
    await deleteCached(
      getCacheKey(`poetry:detail:${poetry._id}`),
      getCacheKey(`poetry:detail:${poetry.slug}`)
    );
    await deleteCachedPattern(getCacheKey('poetry:list:*'));

    res.json({ success: true, message: 'Poetry deleted successfully' });
  } catch (error) {
    console.error('deletePoetry error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── @desc    Like a poetry ────────────────────────────────────────────────
// ── @route   POST /api/poetry/:id/like
// ── @access  Public
const likePoetry = async (req, res) => {
  try {
    const poetry = await Poetry.findByIdAndUpdate(
      req.params.id,
      { $inc: { likes: 1 } },
      { new: true }
    ).select('-driveFileId -driveThumbnailFileId');

    if (!poetry) {
      return res.status(404).json({ success: false, message: 'Poetry not found' });
    }

    // Invalidate detail cache, but maybe leave list caches alone to avoid thrashing just for likes
    await deleteCached(
      getCacheKey(`poetry:detail:${poetry._id}`),
      getCacheKey(`poetry:detail:${poetry.slug}`)
    );

    res.json({ success: true, data: { likes: poetry.likes } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  createPoetry,
  getAdminPoetrys,
  getAdminPoetryById,
  getAllPoetrys,
  getPoetryById,
  streamFile,
  updatePoetry,
  deletePoetry,
  likePoetry,
};
