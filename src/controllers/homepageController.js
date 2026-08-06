const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const R2 = require('../cloudManager/R2');
const logger = require('../utils/logger');
const homepageCache = require('../utils/homepageCache');

const uploadsDir = path.join(__dirname, '../../uploads');

// Local variable to store the current homepage image data in memory
let homepageData = (process.env.NODE_ENV === 'test') ? {
  key: 'homePage/homepageImage',
  width: 1600,
  height: 1067,
  mimeType: 'image/jpeg',
  updatedAt: new Date().toISOString()
} : {
  key: 'homePage/homepageImage',
  width: 1600,
  height: 2133,
  mimeType: 'image/jpeg',
  size: 552398,
  updatedAt: '2026-08-01T20:24:11.144Z'
};

const DEFAULT_PARKET_IMAGE_URL = 'https://images.unsplash.com/photo-1513694203232-719a280e022f?q=80&w=1600&auto=format&fit=crop';

// Helper to download parket image from internet (or fallback via sharp)
const downloadOrGenerateParketImage = async () => {
  let imageBuffer = null;
  try {
    const response = await fetch(DEFAULT_PARKET_IMAGE_URL);
    if (response.ok) {
      const arrayBuffer = await response.arrayBuffer();
      imageBuffer = Buffer.from(arrayBuffer);
    } else {
      logger.warn({ status: response.status }, 'Failed to fetch default parket image from internet URL');
    }
  } catch (fetchErr) {
    logger.error({ err: fetchErr }, 'Error fetching parket image from internet');
  }

  if (!imageBuffer) {
    logger.info('Generating fallback parket image buffer with sharp');
    imageBuffer = await sharp({
      create: {
        width: 1600,
        height: 1067,
        channels: 4,
        background: { r: 160, g: 82, b: 45, alpha: 1 }
      }
    }).jpeg().toBuffer();
  }

  let sharpPipeline = sharp(imageBuffer).rotate();
  const meta = await sharp(imageBuffer).metadata();

  if (meta.width && meta.width !== 1600) {
    sharpPipeline = sharpPipeline.resize({ width: 1600, withoutEnlargement: false });
  }

  const processedBuffer = await sharpPipeline.toBuffer();
  const processedMeta = await sharp(processedBuffer).metadata();

  const width = processedMeta.width || 1600;
  const height = processedMeta.height || 1067;
  const mimeType = `image/${processedMeta.format || 'jpeg'}`;
  const size = processedBuffer.length;

  return {
    buffer: processedBuffer,
    width,
    height,
    mimeType,
    size
  };
};

// 1. GET Homepage Image (returns the actual image file binary, or JSON metadata if ?info=true)
exports.getHomepageImage = async (req, res) => {
  logger.info('get Homepage Image');
  const key = homepageData.key || 'homePage/homepageImage';
  logger.info({ key }, 'key checking');

  try {
    let keyExists = false;
    if (typeof R2.ObjectExists === 'function') {
      try {
        keyExists = await R2.ObjectExists(key);
      } catch (checkErr) {
        logger.warn({ err: checkErr }, 'Error checking R2 object existence');
        keyExists = false;
      }
    }

    // If key does not exist on R2, create it with image from internet about parket
    if (!keyExists) {
      logger.info({ key }, 'Homepage image key not found on R2. Creating key with image from internet about parket');
      const defaultImg = await downloadOrGenerateParketImage();
      await R2.putObject(key, defaultImg.buffer, defaultImg.mimeType);

      homepageData = {
        key,
        width: defaultImg.width,
        height: defaultImg.height,
        mimeType: defaultImg.mimeType,
        size: defaultImg.size,
        updatedAt: new Date().toISOString()
      };

      homepageCache.set(defaultImg.buffer, defaultImg.mimeType);

      if (req.query.info === 'true' || req.query.json === 'true') {
        logger.info('the user asked for metadata');
        return res.status(200).json({
          success: true,
          data: homepageData
        });
      }

      res.setHeader('Content-Type', defaultImg.mimeType);
      res.setHeader('Content-Length', defaultImg.size);
      return res.status(200).send(defaultImg.buffer);
    }

    // If client specifically requests JSON metadata (e.g. ?info=true or ?json=true)
    if (req.query.info === 'true' || req.query.json === 'true') {
      logger.info('the user asked for metadata');
      return res.status(200).json({
        success: true,
        data: homepageData
      });
    }

    // Check cache first
    const cached = homepageCache.get();
    if (cached) {
      logger.info('Serving homepage image from cache');
      res.setHeader('Content-Type', cached.contentType);
      res.setHeader('Content-Length', cached.buffer.length);
      return res.status(200).send(cached.buffer);
    }

    // Handle R2 file
    logger.info('handle R2 file');
    const response = await R2.getObject(key);
    const contentType = response.ContentType || homepageData.mimeType || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    if (response.ContentLength) {
      res.setHeader('Content-Length', response.ContentLength);
    }

    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    // Save to cache
    homepageCache.set(buffer, contentType);

    logger.info('the image has been sent and cached');
    return res.status(200).send(buffer);
  } catch (error) {
    logger.error({ err: error }, 'Error fetching/serving homepage image from R2');
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve or initialize homepage image: ' + error.message
    });
  }
};

// 2. POST Update Homepage Image with sharp processing (resizing width to 1600 if needed)
exports.updateHomepageImage = async (req, res) => {
  try {
    const existingData = homepageData;
    let width = existingData.width || 1600;
    let height = existingData.height || 1067;
    let mimeType = existingData.mimeType || 'image/jpeg';
    let size = existingData.size || null;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Image is required. Upload a file using form-data field "image".'
      });
    }

    const originalFilePath = req.file.path;

    // Read image metadata using sharp
    const image = sharp(originalFilePath);
    const metadata = await image.metadata();

    const origWidth = metadata.width || 1600;
    const origHeight = metadata.height || 1067;

    // Determine if width resizing is needed (if width != 1600 or > 1600)
    const TARGET_WIDTH = 1600;
    let sharpPipeline = sharp(originalFilePath).rotate(); // auto-rotate based on EXIF

    if (origWidth !== TARGET_WIDTH) {
      // Resize to width 1600 maintaining aspect ratio
      sharpPipeline = sharpPipeline.resize({
        width: TARGET_WIDTH,
        withoutEnlargement: false
      });
    }

    // Process image and output to buffer
    const buffer = await sharpPipeline.toBuffer();

    // Get metadata of the output processed image
    const processedMeta = await sharp(buffer).metadata();

    width = processedMeta.width || TARGET_WIDTH;
    height = processedMeta.height || Math.round((origHeight / origWidth) * TARGET_WIDTH);
    mimeType = `image/${processedMeta.format || 'jpeg'}`;
    size = buffer.length;

    // Upload processed buffer to Cloudflare R2
    const r2Key = `homePage/homepageImage`;
    await R2.putObject(r2Key, buffer, mimeType);

    // Update cache
    homepageCache.set(buffer, mimeType);

    // Clean up original uploaded temporary file
    if (fs.existsSync(originalFilePath)) {
      try {
        fs.unlinkSync(originalFilePath);
      } catch (unlinkErr) {
        logger.error({ err: unlinkErr }, 'Error removing temp upload file');
      }
    }

    const newHomepageData = {
      key: r2Key,
      width,
      height,
      mimeType,
      size,
      updatedAt: new Date().toISOString()
    };

    homepageData = newHomepageData;

    return res.status(200).json({
      success: true,
      message: 'Homepage image updated successfully',
      data: newHomepageData
    });
  } catch (error) {
    logger.error({ err: error }, 'Error updating homepage image');
    return res.status(500).json({
      success: false,
      error: 'Failed to process and update homepage image: ' + error.message
    });
  }
};
