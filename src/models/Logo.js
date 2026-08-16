const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const R2 = require('../cloudManager/R2');
const logger = require('../utils/logger').getLogger(__filename);
const cacheManager = require('../utils/cacheManager');

const LOGO_KEY = 'logo/logoImage';
const LOCAL_LOGO_PATH = path.join(__dirname, '../../uploads/logo/12.jpg');
const DEFAULT_PARKET_LOGO_URL = 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?q=80&w=800&auto=format&fit=crop';

/**
 * Class representing Logo image model and logic.
 */
class Logo {
  /**
   * @param {Object} [data={}]
   */
  constructor(data = {}) {
    const defaults = Logo.getDefaults();
    const merged = { ...defaults, ...data };

    this.key = merged.key || LOGO_KEY;
    this.width = merged.width || 800;
    this.height = merged.height || 800;
    this.mimeType = merged.mimeType || 'image/jpeg';
    this.size = merged.size !== undefined ? merged.size : null;
    this.logoUrl = merged.logoUrl || '/uploads/logo/12.jpg';
    this.filename = merged.filename || '12.jpg';
    this.updatedAt = merged.updatedAt || new Date().toISOString();
  }

  /**
   * Returns default values for logo image metadata.
   * @returns {Object}
   */
  static getDefaults() {
    return (process.env.NODE_ENV === 'test') ? {
      key: LOGO_KEY,
      width: 800,
      height: 800,
      mimeType: 'image/jpeg',
      logoUrl: '/uploads/logo/12.jpg',
      filename: '12.jpg',
      updatedAt: new Date().toISOString()
    } : {
      key: LOGO_KEY,
      width: 800,
      height: 800,
      mimeType: 'image/jpeg',
      size: 13300,
      logoUrl: '/uploads/logo/12.jpg',
      filename: '12.jpg',
      updatedAt: '2026-08-01T13:19:03.175Z'
    };
  }

  /**
   * Load local default logo image (or download from internet / sharp fallback).
   * @returns {Promise<{buffer: Buffer, width: number, height: number, mimeType: string, size: number}>}
   */
  static async downloadOrGenerateParketLogoImage() {
    let imageBuffer = null;
    if (fs.existsSync(LOCAL_LOGO_PATH)) {
      try {
        logger.info({ path: LOCAL_LOGO_PATH }, 'Reading default logo image from local disk');
        imageBuffer = fs.readFileSync(LOCAL_LOGO_PATH);
      } catch (readErr) {
        logger.error({ err: readErr, path: LOCAL_LOGO_PATH }, 'Error reading local logo file');
      }
    }

    if (!imageBuffer) {
      logger.info({ url: DEFAULT_PARKET_LOGO_URL }, 'Downloading default parket logo image from internet URL');
      try {
        const response = await fetch(DEFAULT_PARKET_LOGO_URL);
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          imageBuffer = Buffer.from(arrayBuffer);
          logger.info({ sizeBytes: imageBuffer.length }, 'Successfully downloaded default parket logo image');
        } else {
          logger.warn({ status: response.status }, 'Failed to fetch default parket logo image from internet URL');
        }
      } catch (fetchErr) {
        logger.error({ err: fetchErr }, 'Error fetching parket logo image from internet');
      }
    }

    if (!imageBuffer) {
      logger.info('Generating fallback parket logo image buffer using sharp generator');
      imageBuffer = await sharp({
        create: {
          width: 800,
          height: 800,
          channels: 4,
          background: { r: 184, g: 115, b: 51, alpha: 1 }
        }
      }).jpeg().toBuffer();
    }

    let sharpPipeline = sharp(imageBuffer).rotate();
    const meta = await sharp(imageBuffer).metadata();

    const processedBuffer = await sharpPipeline.toBuffer();
    const processedMeta = await sharp(processedBuffer).metadata();

    return {
      buffer: processedBuffer,
      width: processedMeta.width || 800,
      height: processedMeta.height || 800,
      mimeType: `image/${processedMeta.format || 'jpeg'}`,
      size: processedBuffer.length
    };
  }

  /**
   * Checks if key exists on R2. If not, fetches parket logo image from internet, uploads to R2.
   * Gets image buffer and metadata (from cache or R2).
   * @param {string} [key=LOGO_KEY]
   * @returns {Promise<{buffer: Buffer, contentType: string, metadata: Logo}>}
   */
  static async getImageData(key = LOGO_KEY) {
    logger.info({ key }, 'Checking logo image data availability');
    let keyExists = false;
    if (typeof R2.ObjectExists === 'function') {
      try {
        keyExists = await R2.ObjectExists(key);
      } catch (checkErr) {
        logger.warn({ err: checkErr, key }, 'Error checking R2 object existence for logo');
        keyExists = false;
      }
    }

    if (!keyExists) {
      logger.info({ key }, 'Logo image key not found on R2. Creating key with image from internet about parket logo');
      const defaultImg = await Logo.downloadOrGenerateParketLogoImage();
      await R2.putObject(key, defaultImg.buffer, defaultImg.mimeType);

      const logoModel = new Logo({
        key,
        width: defaultImg.width,
        height: defaultImg.height,
        mimeType: defaultImg.mimeType,
        size: defaultImg.size,
        updatedAt: new Date().toISOString()
      });

      await cacheManager.set(cacheManager.KEYS.LOGO_IMAGE, { buffer: defaultImg.buffer, contentType: defaultImg.mimeType });

      return {
        buffer: defaultImg.buffer,
        contentType: defaultImg.mimeType,
        metadata: logoModel
      };
    }

    // Key exists on R2 - check cache first
    const cached = await cacheManager.get(cacheManager.KEYS.LOGO_IMAGE);
    let buffer;
    let contentType;

    if (cached) {
      logger.info({ key }, 'Serving logo image from cache');
      buffer = cached.buffer;
      contentType = cached.contentType;
    } else {
      logger.info({ key }, 'Retrieving logo image from R2');
      const response = await R2.getObject(key);
      contentType = response.ContentType || 'image/jpeg';

      const chunks = [];
      for await (const chunk of response.Body) {
        chunks.push(chunk);
      }
      buffer = Buffer.concat(chunks);

      await cacheManager.set(cacheManager.KEYS.LOGO_IMAGE, { buffer, contentType });
      logger.info({ key, contentType, sizeBytes: buffer.length }, 'Logo image retrieved from R2 and cached');
    }

    const logoModel = new Logo({
      key,
      mimeType: contentType,
      size: buffer.length
    });

    return {
      buffer,
      contentType,
      metadata: logoModel
    };
  }

  /**
   * Process uploaded logo image file using sharp, upload to R2 and update cache.
   * @param {string} originalFilePath
   * @param {string} [key=LOGO_KEY]
   * @returns {Promise<Logo>}
   */
  static async updateImage(originalFilePath, key = LOGO_KEY) {
    logger.info({ originalFilePath, key }, 'Processing and uploading logo image');
    const image = sharp(originalFilePath);
    const metadata = await image.metadata();

    const origWidth = metadata.width || 800;
    const origHeight = metadata.height || 800;

    let sharpPipeline = sharp(originalFilePath).rotate();
    const buffer = await sharpPipeline.toBuffer();
    const processedMeta = await sharp(buffer).metadata();

    const width = processedMeta.width || origWidth;
    const height = processedMeta.height || origHeight;
    const mimeType = `image/${processedMeta.format || 'jpeg'}`;
    const size = buffer.length;

    await R2.putObject(key, buffer, mimeType);
    await cacheManager.set(cacheManager.KEYS.LOGO_IMAGE, { buffer, contentType: mimeType });
    logger.info({ key, width, height, mimeType, size }, 'Logo image processed and updated successfully');
    return new Logo({
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
      logoUrl: this.logoUrl,
      filename: this.filename,
      width: this.width,
      height: this.height,
      mimeType: this.mimeType,
      size: this.size,
      updatedAt: this.updatedAt
    };
  }
}

module.exports = Logo;
