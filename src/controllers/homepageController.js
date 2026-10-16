const fs = require('fs');
const Homepage = require('../models/Homepage');
const sendImage = require('../utils/sendImage');
const logger = require('../utils/logger').getLogger(__filename);

const IMMUTABLE = 'public, max-age=31536000, immutable';

const removeTempUpload = (filePath) => {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') logger.error({ err, filePath }, 'Error removing temp upload file');
  }
};

// Local variable to store current homepage model instance in memory
let currentHomepage = new Homepage();

// Created at startup (utils/ensureDefaults), so missing means it was deleted from R2 since
const notFound = (res) => {
  logger.warn('Homepage image not found on R2');
  return res.status(404).json({ success: false, error: 'Homepage image not found' });
};

// 1. GET Homepage Image (returns the actual image file binary, or JSON metadata if ?info=true)
exports.getHomepageImage = async (req, res) => {
  logger.info({ query: req.query }, 'GET /api/homepage-image - Fetching homepage image');
  try {
    // If client specifically requests JSON metadata (e.g. ?info=true or ?json=true)
    if (req.query.info === 'true' || req.query.json === 'true') {
      const metadata = await Homepage.getMetadata(currentHomepage.key);
      if (!metadata) return notFound(res);
      currentHomepage = metadata;
      logger.info({ key: currentHomepage.key }, 'Returning homepage image JSON metadata to client');
      // Clients read the current version from here, so it must never be served stale
      res.setHeader('Cache-Control', 'no-cache');
      return res.status(200).json({
        success: true,
        data: currentHomepage.toJSON(),
      });
    }

    const image = await Homepage.getImage(currentHomepage.key);
    if (!image) return notFound(res);
    logger.info(
      { contentType: image.contentType, sizeBytes: image.contentLength },
      'Streaming homepage image from R2',
    );
    // A versioned URL (?v=<etag>) points at exactly one upload, so it can be cached for good
    return req.query.v ? sendImage(req, res, image, IMMUTABLE) : sendImage(req, res, image);
  } catch (error) {
    logger.error({ err: error }, 'Error fetching/serving homepage image');
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve or initialize homepage image',
    });
  }
};

// 2. POST Update Homepage Image with sharp processing (resizing width to 1600 if needed)
exports.updateHomepageImage = async (req, res) => {
  logger.info(
    { file: req.file ? req.file.originalname : null },
    'POST /api/homepage-image - Updating homepage image',
  );
  try {
    if (!req.file) {
      logger.warn('Homepage image update attempt without file payload');
      return res.status(400).json({
        success: false,
        error: 'Image is required. Upload a file using form-data field "image".',
      });
    }

    const originalFilePath = req.file.path;
    logger.info({ originalFilePath }, 'Updating homepage image with uploaded file');
    try {
      currentHomepage = await Homepage.updateImage(originalFilePath, currentHomepage.key);
    } finally {
      // Clean up the temp upload even when processing fails, so it never lingers in uploads/
      removeTempUpload(originalFilePath);
    }

    logger.info({ data: currentHomepage.toJSON() }, 'Homepage image updated successfully');
    return res.status(200).json({
      success: true,
      message: 'Homepage image updated successfully',
      data: currentHomepage.toJSON(),
    });
  } catch (error) {
    logger.error({ err: error }, 'Error updating homepage image');
    return res.status(500).json({
      success: false,
      error: 'Failed to process and update homepage image',
    });
  }
};
