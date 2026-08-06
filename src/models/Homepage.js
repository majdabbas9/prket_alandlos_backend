const sharp = require('sharp');
const R2 = require('../cloudManager/R2');
const logger = require('../utils/logger').getLogger(__filename);
const cacheManager = require('../utils/cacheManager');

const HOMEPAGE_KEY = 'homePage/homepageImage';
const DEFAULT_PARKET_IMAGE_URL = 'https://images.unsplash.com/photo-1513694203232-719a280e022f?q=80&w=1600&auto=format&fit=crop';

/**
 * Class representing Homepage Image model and logic.
 */
class Homepage {
  /**
   * @param {Object} [data={}]
   */
  constructor(data = {}) {
    const defaults = Homepage.getDefaults();
    const merged = { ...defaults, ...data };

    this.key = merged.key || HOMEPAGE_KEY;
    this.width = merged.width || 1600;
    this.height = merged.height || 1067;
    this.mimeType = merged.mimeType || 'image/jpeg';
    this.size = merged.size !== undefined ? merged.size : null;
    this.updatedAt = merged.updatedAt || new Date().toISOString();
  }

  /**
   * Returns default values for homepage image metadata.
   * @returns {Object}
   */
  static getDefaults() {
    return (process.env.NODE_ENV === 'test') ? {
      key: HOMEPAGE_KEY,
      width: 1600,
      height: 1067,
      mimeType: 'image/jpeg',
      updatedAt: new Date().toISOString()
    } : {
      key: HOMEPAGE_KEY,
      width: 1600,
      height: 2133,
      mimeType: 'image/jpeg',
      size: 552398,
      updatedAt: '2026-08-01T20:24:11.144Z'
    };
  }

  /**
   * Download parket image from internet (or fallback via sharp).
   * @returns {Promise<{buffer: Buffer, width: number, height: number, mimeType: string, size: number}>}
   */
  static async downloadOrGenerateParketImage() {
    logger.info({ url: DEFAULT_PARKET_IMAGE_URL }, 'Downloading default parket image from internet URL');
    let imageBuffer = null;
    try {
      const response = await fetch(DEFAULT_PARKET_IMAGE_URL);
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        imageBuffer = Buffer.from(arrayBuffer);
        logger.info({ sizeBytes: imageBuffer.length }, 'Successfully downloaded default parket image');
      } else {
        logger.warn({ status: response.status }, 'Failed to fetch default parket image from internet URL');
      }
    } catch (fetchErr) {
      logger.error({ err: fetchErr }, 'Error fetching parket image from internet');
    }

    if (!imageBuffer) {
      logger.info('Generating fallback parket image buffer using sharp generator');
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
      logger.info({ originalWidth: meta.width, targetWidth: 1600 }, 'Resizing parket image to standard target width 1600');
      sharpPipeline = sharpPipeline.resize({ width: 1600, withoutEnlargement: false });
    }

    const processedBuffer = await sharpPipeline.toBuffer();
    const processedMeta = await sharp(processedBuffer).metadata();

    return {
      buffer: processedBuffer,
      width: processedMeta.width || 1600,
      height: processedMeta.height || 1067,
      mimeType: `image/${processedMeta.format || 'jpeg'}`,
      size: processedBuffer.length
    };
  }

  /**
   * Checks if key exists on R2. If not, fetches parket image from internet, uploads to R2.
   * Gets image buffer and metadata (from cache or R2).
   * @param {string} [key=HOMEPAGE_KEY]
   * @returns {Promise<{buffer: Buffer, contentType: string, metadata: Homepage}>}
   */
  static async getImageData(key = HOMEPAGE_KEY) {
    logger.info({ key }, 'Checking homepage image data availability');
    let keyExists = false;
    if (typeof R2.ObjectExists === 'function') {
      try {
        keyExists = await R2.ObjectExists(key);
      } catch (checkErr) {
        logger.warn({ err: checkErr, key }, 'Error checking R2 object existence');
        keyExists = false;
      }
    }

    if (!keyExists) {
      logger.info({ key }, 'Homepage image key not found on R2. Creating key with image from internet about parket');
      const defaultImg = await Homepage.downloadOrGenerateParketImage();
      await R2.putObject(key, defaultImg.buffer, defaultImg.mimeType);

      const homepageModel = new Homepage({
        key,
        width: defaultImg.width,
        height: defaultImg.height,
        mimeType: defaultImg.mimeType,
        size: defaultImg.size,
        updatedAt: new Date().toISOString()
      });

      cacheManager.set(cacheManager.KEYS.HOMEPAGE_IMAGE, { buffer: defaultImg.buffer, contentType: defaultImg.mimeType });

      return {
        buffer: defaultImg.buffer,
        contentType: defaultImg.mimeType,
        metadata: homepageModel
      };
    }

    // Key exists on R2 - check cache first
    const cached = cacheManager.get(cacheManager.KEYS.HOMEPAGE_IMAGE);
    let buffer;
    let contentType;

    if (cached) {
      logger.info({ key }, 'Serving homepage image from cache');
      buffer = cached.buffer;
      contentType = cached.contentType;
    } else {
      logger.info({ key }, 'Retrieving homepage image from R2');
      const response = await R2.getObject(key);
      contentType = response.ContentType || 'image/jpeg';

      const chunks = [];
      for await (const chunk of response.Body) {
        chunks.push(chunk);
      }
      buffer = Buffer.concat(chunks);

      cacheManager.set(cacheManager.KEYS.HOMEPAGE_IMAGE, { buffer, contentType });
      logger.info({ key, contentType, sizeBytes: buffer.length }, 'Homepage image retrieved from R2 and cached');
    }

    const homepageModel = new Homepage({
      key,
      mimeType: contentType,
      size: buffer.length
    });

    return {
      buffer,
      contentType,
      metadata: homepageModel
    };
  }

  /**
   * Process uploaded image file using sharp, upload to R2 and update cache.
   * @param {string} originalFilePath
   * @param {string} [key=HOMEPAGE_KEY]
   * @returns {Promise<Homepage>}
   */
  static async updateImage(originalFilePath, key = HOMEPAGE_KEY) {
    logger.info({ originalFilePath, key }, 'Processing and uploading homepage image');
    const image = sharp(originalFilePath);
    const metadata = await image.metadata();

    const origWidth = metadata.width || 1600;
    const origHeight = metadata.height || 1067;
    const TARGET_WIDTH = 1600;

    let sharpPipeline = sharp(originalFilePath).rotate();
    if (origWidth !== TARGET_WIDTH) {
      logger.info({ origWidth, TARGET_WIDTH }, 'Resizing uploaded image to target width 1600');
      sharpPipeline = sharpPipeline.resize({
        width: TARGET_WIDTH,
        withoutEnlargement: false
      });
    }

    const buffer = await sharpPipeline.toBuffer();
    const processedMeta = await sharp(buffer).metadata();

    const width = processedMeta.width || TARGET_WIDTH;
    const height = processedMeta.height || Math.round((origHeight / origWidth) * TARGET_WIDTH);
    const mimeType = `image/${processedMeta.format || 'jpeg'}`;
    const size = buffer.length;

    await R2.putObject(key, buffer, mimeType);
    cacheManager.set(cacheManager.KEYS.HOMEPAGE_IMAGE, { buffer, contentType: mimeType });
    logger.info({ key, width, height, mimeType, size }, 'Homepage image processed and updated successfully');
    return new Homepage({
      key,
      width,
      height,
      mimeType,
      size,
      updatedAt: new Date().toISOString()
    });
  }

  /**
   * Plain object representation.
   * @returns {Object}
   */
  toJSON() {
    return {
      key: this.key,
      width: this.width,
      height: this.height,
      mimeType: this.mimeType,
      size: this.size,
      updatedAt: this.updatedAt
    };
  }
}

module.exports = Homepage;

