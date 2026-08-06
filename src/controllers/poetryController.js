const Poetry = require('../models/Poetry');
const {
  uploadFileToDrive,
  uploadThumbnailToDrive,
  getFileStream,
  deleteFileFromDrive,
} = require('../config/googleDrive');
const { getRedis } = require('../config/redis');

// Helper to generate a consistent cache key for poetry lists
const generateListCacheKey = (query) => {
  return `poetry:list:${JSON.stringify(query)}`;
};
const { ALLOWED_AUDIO_TYPES } = require('../middleware/upload');
const { v4: uuidv4 } = require('uuid');

const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

// ── Helpers ───────────────────────────────────────────────────────────────
const safeFilename = (originalName) => {
  const ext = originalName.split('.').pop();
  return `${uuidv4()}.${ext}`;
};

// ── @desc    Create a new poetry ──────────────────────────────────────────
// ── @route   POST /api/poetry
// ── @access  Admin
const createPoetry = async (req, res) => {
  try {
    const { title, description, content, type, language, tags, isFeatured, duration } = req.body;

    if (!title || !type) {
      return res.status(400).json({ success: false, message: 'Title and type are required' });
    }

    let driveFileId = null;
    let driveThumbnailFileId = null;
    let thumbnailUrl = null;

    // ── Upload main media file (audio / video) ───────────────────────────
    const mediaFile = req.files?.media?.[0];
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
      isPublished: true,
      driveFileId,         // stored in DB, never returned in public responses
      driveThumbnailFileId,
      thumbnailUrl,        // safe to expose (public thumbnail)
      duration: duration ? Number(duration) : null,
    });

    // Invalidate caches
    const redis = getRedis();
    if (redis) {
      const keys = await redis.keys('poetry:list:*');
      if (keys.length > 0) await redis.del(...keys);
    }

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

// ── @desc    Get all poetries (paginated, filterable) ─────────────────────
// ── @route   GET /api/poetry
// ── @access  Public
const getAllPoetrys = async (req, res) => {
  try {
    const redis = getRedis();
    const cacheKey = generateListCacheKey(req.query);

    if (redis) {
      const cached = await redis.get(cacheKey);
      if (cached) return res.json(cached); // cached response has success, data, pagination
    }

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
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } },
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

    if (redis) {
      // Cache for 10 minutes
      await redis.setex(cacheKey, 600, responseData);
    }

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

    const redis = getRedis();
    const cacheKey = `poetry:detail:${idOrSlug}`;

    if (redis) {
      const cached = await redis.get(cacheKey);
      if (cached) return res.json({ success: true, data: cached });
    }

    const query = isObjectId ? { _id: idOrSlug } : { slug: idOrSlug };

    const poetry = await Poetry.findOneAndUpdate(
      { ...query, isPublished: true },
      { $inc: { views: 1 } },
      { new: true }
    ).select('-driveFileId -driveThumbnailFileId');

    if (!poetry) {
      return res.status(404).json({ success: false, message: 'Poetry not found' });
    }

    if (redis) {
      await redis.setex(cacheKey, 3600, poetry); // Cache for 1 hour
    }

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
    const allowed = ['title', 'description', 'content', 'language', 'tags', 'isFeatured', 'isPublished', 'duration'];
    const updates = {};
    allowed.forEach((field) => {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    });

    // Handle new thumbnail upload
    const thumbnailFile = req.files?.thumbnail?.[0];
    if (thumbnailFile) {
      const poetry = await Poetry.findById(req.params.id).select('+driveThumbnailFileId');
      if (poetry?.driveThumbnailFileId) {
        await deleteFileFromDrive(poetry.driveThumbnailFileId).catch(() => {});
      }
      const result = await uploadThumbnailToDrive(
        thumbnailFile.buffer,
        thumbnailFile.mimetype,
        safeFilename(thumbnailFile.originalname),
        DRIVE_FOLDER_ID
      );
      updates.driveThumbnailFileId = result.fileId;
      updates.thumbnailUrl = result.publicUrl;
    }

    const poetry = await Poetry.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    ).select('-driveFileId -driveThumbnailFileId');

    if (!poetry) {
      return res.status(404).json({ success: false, message: 'Poetry not found' });
    }

    // Invalidate caches
    const redis = getRedis();
    if (redis) {
      await redis.del(`poetry:detail:${poetry._id}`, `poetry:detail:${poetry.slug}`);
      const listKeys = await redis.keys('poetry:list:*');
      if (listKeys.length > 0) await redis.del(...listKeys);
    }

    res.json({ success: true, message: 'Poetry updated', data: poetry });
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
    const redis = getRedis();
    if (redis) {
      await redis.del(`poetry:detail:${poetry._id}`, `poetry:detail:${poetry.slug}`);
      const listKeys = await redis.keys('poetry:list:*');
      if (listKeys.length > 0) await redis.del(...listKeys);
    }

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
    const redis = getRedis();
    if (redis) {
      await redis.del(`poetry:detail:${poetry._id}`, `poetry:detail:${poetry.slug}`);
    }

    res.json({ success: true, data: { likes: poetry.likes } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  createPoetry,
  getAllPoetrys,
  getPoetryById,
  streamFile,
  updatePoetry,
  deletePoetry,
  likePoetry,
};
