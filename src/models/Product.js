const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const R2 = require('../cloudManager/R2');
const logger = require('../utils/logger').getLogger(__filename);

const BUCKET_NAME = 'prket-andlos'; // Using the bucket name from user instructions

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
    this.dateOfUpload = data.dateOfUpload || new Date().toISOString();

    if (data.updatedAt) {
      this.updatedAt = data.updatedAt;
    }
  }

  /**
   * Upload an image to R2 under products/ key
   * @param {string} localFilePath Path to the local file
   * @param {string} mimeType Content type of the image
   * @param {string} originalFilename Original file name to extract extension
   * @returns {Promise<string>} The R2 object key
   */
  static async uploadImage(localFilePath, mimeType, originalFilename) {
    logger.info({ localFilePath, originalFilename }, 'Uploading product image to R2');

    try {
      const ext = path.extname(originalFilename) || '.jpeg';
      const filename = `img-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
      const r2Key = `products/${filename}`;

      const fileBuffer = fs.readFileSync(localFilePath);

      await R2.putObject(r2Key, fileBuffer, mimeType, BUCKET_NAME);
      logger.info({ r2Key }, 'Product image uploaded to R2 successfully');

      return r2Key;
    } catch (error) {
      logger.error({ err: error, localFilePath }, 'Failed to upload product image to R2');
      throw error;
    }
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
      imageKey: this.imageKey,
      dateOfUpload: this.dateOfUpload,
      ...(this.updatedAt && { updatedAt: this.updatedAt })
    };
  }
}

module.exports = Product;
