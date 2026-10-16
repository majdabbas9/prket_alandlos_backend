const fs = require('fs');
const sharp = require('sharp');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const R2 = require('../cloudManager/R2');
const logger = require('../utils/logger').getLogger(__filename);

const BUCKET_NAME = 'prket-andlos'; // Using the bucket name from user instructions

// Product image keys are unique per upload and never rewritten, so caches may keep them forever
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const LARGE_WIDTH = 1600;
const THUMB_WIDTH = 600;
// Optional free-text catalog attributes shown on the product cards; omitted from JSON when empty
const DETAIL_FIELDS = ['woodType', 'finish', 'thickness', 'plankSize', 'tag'];

class Product {
  /**
   * @param {Object} [data={}]
   */
  constructor(data = {}) {
    this.id = data.id || `prod_${uuidv4()}`;
    this.title = data.title ? String(data.title).trim() : 'Untitled Product';
    this.price = data.price !== undefined ? Number(data.price) : 0;
    this.category = data.category ? String(data.category).trim() : 'General';
    this.description = data.description ? String(data.description).trim() : '';
    this.imageKey = data.imageKey ? String(data.imageKey).trim() : '';
    this.thumbKey = data.thumbKey ? String(data.thumbKey).trim() : '';
    for (const field of DETAIL_FIELDS) {
      this[field] = data[field] ? String(data[field]).trim() : '';
    }
    this.dateOfUpload = data.dateOfUpload || new Date().toISOString();

    if (data.updatedAt) {
      this.updatedAt = data.updatedAt;
    }
  }

  /**
   * Upload a product image to R2 under products/ as two WebP variants: a large one for
   * the detail view and a small thumbnail for product cards. Keys are unique per upload,
   * so both are stored with an immutable Cache-Control. Files sharp can't decode are
   * uploaded as-is and used for both variants.
   * @param {string} localFilePath Path to the local file
   * @param {string} mimeType Content type of the image
   * @param {string} originalFilename Original file name to extract extension
   * @returns {Promise<{imageKey: string, thumbKey: string}>} The R2 object keys
   */
  static async uploadImage(localFilePath, mimeType, originalFilename) {
    logger.info({ localFilePath, originalFilename }, 'Uploading product image to R2');

    try {
      const baseName = `img-${Date.now()}-${Math.round(Math.random() * 1e9)}`;

      let variants;
      try {
        variants = await Product.resizeImage(fs.readFileSync(localFilePath));
      } catch (err) {
        logger.warn({ err, localFilePath }, 'Could not resize product image, uploading original');
      }

      if (!variants) {
        const ext = path.extname(originalFilename) || '.jpeg';
        const r2Key = `products/${baseName}${ext}`;
        const fileBuffer = fs.readFileSync(localFilePath);
        await R2.putObject(r2Key, fileBuffer, mimeType, BUCKET_NAME, IMMUTABLE_CACHE_CONTROL);
        logger.info({ r2Key }, 'Product image uploaded to R2 successfully');
        return { imageKey: r2Key, thumbKey: r2Key };
      }

      const imageKey = `products/${baseName}.webp`;
      const thumbKey = `products/${baseName}-thumb.webp`;
      await Promise.all([
        R2.putObject(imageKey, variants.large, 'image/webp', BUCKET_NAME, IMMUTABLE_CACHE_CONTROL),
        R2.putObject(thumbKey, variants.thumb, 'image/webp', BUCKET_NAME, IMMUTABLE_CACHE_CONTROL),
      ]);
      logger.info(
        {
          imageKey,
          thumbKey,
          largeBytes: variants.large.length,
          thumbBytes: variants.thumb.length,
        },
        'Product image variants uploaded to R2 successfully',
      );
      return { imageKey, thumbKey };
    } catch (error) {
      logger.error({ err: error, localFilePath }, 'Failed to upload product image to R2');
      throw error;
    }
  }

  /**
   * Encodes an image as the large and thumbnail WebP variants (EXIF-rotated, never enlarged).
   * @param {Buffer} input
   * @returns {Promise<{large: Buffer, thumb: Buffer}>}
   */
  static async resizeImage(input) {
    const variant = (width, quality) =>
      sharp(input)
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality })
        .toBuffer();
    const [large, thumb] = await Promise.all([variant(LARGE_WIDTH, 82), variant(THUMB_WIDTH, 75)]);
    return { large, thumb };
  }

  /**
   * Public URL of an R2 key on the bucket's public domain, or undefined when
   * R2_PUBLIC_URL is unset (clients then go through /api/products/photo).
   * @param {string} key
   * @returns {string|undefined}
   */
  static publicUrl(key) {
    const base = process.env.R2_PUBLIC_URL;
    if (!base || !key) return undefined;
    return `${base.replace(/\/+$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  /**
   * Product as returned to API clients: stored fields plus image URLs when a public domain is set.
   * @param {Object} product stored product JSON
   * @returns {Object}
   */
  static withImageUrls(product) {
    const imageUrl = Product.publicUrl(product.imageKey);
    if (!imageUrl) return product;
    return {
      ...product,
      imageUrl,
      thumbUrl: Product.publicUrl(product.thumbKey || product.imageKey),
    };
  }

  /**
   * Pushes the entire products JSON array to R2 bucket under products/products.json
   * @param {Array} products Array of product objects
   */
  static async syncProductsData(products) {
    logger.info({ count: products.length }, 'Syncing products JSON data to R2');
    try {
      const r2Key = 'products/products.json';
      const jsonData = JSON.stringify(products, null, 2);
      const buffer = Buffer.from(jsonData, 'utf8');

      await R2.putObject(r2Key, buffer, 'application/json', BUCKET_NAME);
      logger.info({ r2Key }, 'Products JSON data synced to R2 successfully');
    } catch (error) {
      logger.error({ err: error }, 'Failed to sync products JSON data to R2');
      throw error;
    }
  }

  toJSON() {
    return {
      id: this.id,
      title: this.title,
      price: this.price,
      category: this.category,
      description: this.description,
      ...Object.fromEntries(DETAIL_FIELDS.filter((f) => this[f]).map((f) => [f, this[f]])),
      imageKey: this.imageKey,
      ...(this.thumbKey && { thumbKey: this.thumbKey }),
      dateOfUpload: this.dateOfUpload,
      ...(this.updatedAt && { updatedAt: this.updatedAt }),
    };
  }
}

Product.IMMUTABLE_CACHE_CONTROL = IMMUTABLE_CACHE_CONTROL;
Product.DETAIL_FIELDS = DETAIL_FIELDS;

module.exports = Product;
