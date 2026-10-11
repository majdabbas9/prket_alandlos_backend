const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const sharp = require('sharp');
const R2 = require('../cloudManager/R2');
const logger = require('../utils/logger').getLogger(__filename);

const LOGO_KEY = 'logo/logoImage';
const LOCAL_LOGO_PATH = path.join(__dirname, '../../uploads/logo/12.jpg');
const DEFAULT_PARKET_LOGO_URL =
  'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?q=80&w=800&auto=format&fit=crop';

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
    return process.env.NODE_ENV === 'test'
      ? {
          key: LOGO_KEY,
          width: 800,
          height: 800,
          mimeType: 'image/jpeg',
          logoUrl: '/uploads/logo/12.jpg',
          filename: '12.jpg',
          updatedAt: new Date().toISOString(),
        }
      : {
          key: LOGO_KEY,
          width: 800,
          height: 800,
          mimeType: 'image/jpeg',
          size: 13300,
          logoUrl: '/uploads/logo/12.jpg',
          filename: '12.jpg',
          updatedAt: '2026-08-01T13:19:03.175Z',
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
      logger.info(
        { url: DEFAULT_PARKET_LOGO_URL },
        'Downloading default parket logo image from internet URL',
      );
      try {
        const response = await fetch(DEFAULT_PARKET_LOGO_URL);
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          imageBuffer = Buffer.from(arrayBuffer);
          logger.info(
            { sizeBytes: imageBuffer.length },
            'Successfully downloaded default parket logo image',
          );
        } else {
          logger.warn(
            { status: response.status },
            'Failed to fetch default parket logo image from internet URL',
          );
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
          background: { r: 184, g: 115, b: 51, alpha: 1 },
        },
      })
        .jpeg()
        .toBuffer();
    }

    const processedBuffer = await sharp(imageBuffer).rotate().toBuffer();
    const processedMeta = await sharp(processedBuffer).metadata();

    return {
      buffer: processedBuffer,
      width: processedMeta.width || 800,
      height: processedMeta.height || 800,
      mimeType: `image/${processedMeta.format || 'jpeg'}`,
      size: processedBuffer.length,
    };
  }

  /**
   * Loads the default logo image and uploads it to R2 under `key`.
   * Used the first time the logo is requested and the key is missing.
   * @param {string} key
   * @returns {Promise<{buffer: Buffer, width: number, height: number, mimeType: string, size: number}>}
   */
  static async createDefaultImage(key) {
    logger.info(
      { key },
      'Logo image key not found on R2. Creating key with image from internet about parket logo',
    );
    const defaultImg = await Logo.downloadOrGenerateParketLogoImage();
    await R2.putObject(key, defaultImg.buffer, defaultImg.mimeType);
    return defaultImg;
  }

  /**
   * Opens the logo image on R2 as a stream (bootstrapping a default logo if missing).
   * @param {string} [key=LOGO_KEY]
   * @returns {Promise<{body: Readable, contentType: string, contentLength?: number, etag?: string, lastModified?: Date}>}
   */
  static async getImage(key = LOGO_KEY) {
    try {
      const response = await R2.getObject(key);
      return {
        body: response.Body,
        contentType: response.ContentType || 'image/jpeg',
        contentLength: response.ContentLength,
        etag: response.ETag,
        lastModified: response.LastModified,
      };
    } catch (err) {
      if (!R2.isNotFound(err)) throw err;
    }

    const defaultImg = await Logo.createDefaultImage(key);
    return {
      body: Readable.from([defaultImg.buffer]),
      contentType: defaultImg.mimeType,
      contentLength: defaultImg.size,
    };
  }

  /**
   * Reads logo metadata from R2 without downloading the image
   * (bootstrapping a default logo if missing).
   * @param {string} [key=LOGO_KEY]
   * @returns {Promise<Logo>}
   */
  static async getMetadata(key = LOGO_KEY) {
    try {
      const head = await R2.headObject(key);
      return new Logo({
        key,
        mimeType: head.ContentType || 'image/jpeg',
        size: head.ContentLength,
      });
    } catch (err) {
      if (!R2.isNotFound(err)) throw err;
    }

    const defaultImg = await Logo.createDefaultImage(key);
    return new Logo({
      key,
      width: defaultImg.width,
      height: defaultImg.height,
      mimeType: defaultImg.mimeType,
      size: defaultImg.size,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Process uploaded logo image file using sharp, upload to R2.
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
    logger.info(
      { key, width, height, mimeType, size },
      'Logo image processed and updated successfully',
    );
    return new Logo({
      key,
      width,
      height,
      mimeType,
      size,
      updatedAt: new Date().toISOString(),
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
      updatedAt: this.updatedAt,
    };
  }
}

module.exports = Logo;
