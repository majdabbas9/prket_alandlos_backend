const fs = require('fs');
const Homepage = require('../models/Homepage');
const logger = require('../utils/logger').getLogger(__filename);

// Local variable to store current homepage model instance in memory
let currentHomepage = new Homepage();

// 1. GET Homepage Image (returns the actual image file binary, or JSON metadata if ?info=true)
exports.getHomepageImage = async (req, res) => {
  logger.info({ query: req.query }, 'GET /api/homepage-image - Fetching homepage image');
  try {
    const { buffer, contentType, metadata } = await Homepage.getImageData(currentHomepage.key);
    currentHomepage = metadata;

    // If client specifically requests JSON metadata (e.g. ?info=true or ?json=true)
    if (req.query.info === 'true' || req.query.json === 'true') {
      logger.info({ key: currentHomepage.key }, 'Returning homepage image JSON metadata to client');
      return res.status(200).json({
        success: true,
        data: currentHomepage.toJSON()
      });
    }

    res.setHeader('Content-Type', contentType);
    if (buffer.length) {
      res.setHeader('Content-Length', buffer.length);
    }

    logger.info({ contentType, sizeBytes: buffer.length }, 'Serving homepage image binary file');
    return res.status(200).send(buffer);
  } catch (error) {
    logger.error({ err: error }, 'Error fetching/serving homepage image');
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve or initialize homepage image: ' + error.message
    });
  }
};

// 2. POST Update Homepage Image with sharp processing (resizing width to 1600 if needed)
exports.updateHomepageImage = async (req, res) => {
  logger.info({ file: req.file ? req.file.originalname : null }, 'POST /api/homepage-image - Updating homepage image');
  try {
    if (!req.file) {
      logger.warn('Homepage image update attempt without file payload');
      return res.status(400).json({
        success: false,
        error: 'Image is required. Upload a file using form-data field "image".'
      });
    }

    const originalFilePath = req.file.path;
    logger.info({ originalFilePath }, 'Updating homepage image with uploaded file');
    const updatedHomepage = await Homepage.updateImage(originalFilePath, currentHomepage.key);
    currentHomepage = updatedHomepage;

    // Clean up original uploaded temporary file
    if (fs.existsSync(originalFilePath)) {
      try {
        fs.unlinkSync(originalFilePath);
        logger.info({ originalFilePath }, 'Successfully cleaned up temporary upload file');
      } catch (unlinkErr) {
        logger.error({ err: unlinkErr, originalFilePath }, 'Error removing temp upload file');
      }
    }

    logger.info({ data: currentHomepage.toJSON() }, 'Homepage image updated successfully');
    return res.status(200).json({
      success: true,
      message: 'Homepage image updated successfully',
      data: currentHomepage.toJSON()
    });
  } catch (error) {
    logger.error({ err: error }, 'Error updating homepage image');
    return res.status(500).json({
      success: false,
      error: 'Failed to process and update homepage image: ' + error.message
    });
  }
};

