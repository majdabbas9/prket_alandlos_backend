const fs = require('fs');
const Logo = require('../models/Logo');
const logger = require('../utils/logger').getLogger(__filename);

// Local variable to store current logo model instance in memory
let currentLogo = new Logo();

// 1. GET Logo Image (returns the actual image file binary, or JSON metadata if ?info=true or ?json=true)
exports.getLogo = async (req, res) => {
  logger.info({ query: req.query }, 'GET /api/logo - Fetching logo');
  try {
    const { buffer, contentType, metadata } = await Logo.getImageData(currentLogo.key);
    currentLogo = metadata;

    // If client specifically requests JSON metadata (e.g. ?info=true or ?json=true)
    if (req.query.info === 'true' || req.query.json === 'true') {
      logger.info({ key: currentLogo.key }, 'Returning logo JSON metadata to client');
      return res.status(200).json({
        success: true,
        data: currentLogo.toJSON()
      });
    }

    res.setHeader('Content-Type', contentType);
    if (buffer.length) {
      res.setHeader('Content-Length', buffer.length);
    }

    logger.info({ contentType, sizeBytes: buffer.length }, 'Serving logo binary file');
    return res.status(200).send(buffer);
  } catch (error) {
    logger.error({ err: error }, 'Error fetching/serving logo');
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve or initialize logo: ' + error.message
    });
  }
};

// 2. GET /api/logo/:filename - Fetch logo by filename (alias/compatibility endpoint)
exports.getLogoByName = async (req, res) => {
  logger.info({ filename: req.params.filename }, 'GET /api/logo/:filename - Fetching logo by filename');
  return exports.getLogo(req, res);
};

// 3. POST Update Logo Image
exports.updateLogo = async (req, res) => {
  logger.info({ hasFile: !!req.file, hasFiles: !!req.files, body: req.body }, 'POST /api/logo - Updating logo');
  try {
    const uploadedFile = req.file || (req.files && (req.files.image?.[0] || req.files.logo?.[0]));

    if (!uploadedFile && (!req.body || (!req.body.logoUrl && !req.body.imageUrl))) {
      logger.warn('Logo update failed: missing logo file or logoUrl payload');
      return res.status(400).json({
        success: false,
        error: 'Logo image is required. Upload a file using form-data field "image" or "logo", or provide a "logoUrl" string.'
      });
    }

    if (uploadedFile) {
      const originalFilePath = uploadedFile.path;
      logger.info({ originalFilePath }, 'Updating logo with uploaded file');
      const updatedLogo = await Logo.updateImage(originalFilePath, currentLogo.key);
      currentLogo = updatedLogo;

      if (fs.existsSync(originalFilePath)) {
        try {
          fs.unlinkSync(originalFilePath);
          logger.info({ originalFilePath }, 'Successfully cleaned up temporary logo upload file');
        } catch (unlinkErr) {
          logger.error({ err: unlinkErr, originalFilePath }, 'Error removing temp logo upload file');
        }
      }
    } else if (req.body && (req.body.logoUrl || req.body.imageUrl)) {
      const newUrl = (req.body.logoUrl || req.body.imageUrl).trim();
      currentLogo = new Logo({
        key: currentLogo.key,
        logoUrl: newUrl,
        filename: newUrl.split('/').pop() || '12.jpg',
        updatedAt: new Date().toISOString()
      });
    }

    logger.info({ data: currentLogo.toJSON() }, 'Logo image updated successfully');
    return res.status(200).json({
      success: true,
      message: 'Logo image updated successfully',
      data: currentLogo.toJSON()
    });
  } catch (error) {
    logger.error({ err: error }, 'Error updating logo image');
    return res.status(500).json({
      success: false,
      error: 'Failed to process and update logo image: ' + error.message
    });
  }
};
