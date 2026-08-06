const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger').getLogger(__filename);
const Product = require('../models/Product');
const R2 = require('../cloudManager/R2');
const cacheManager = require('../utils/cacheManager');

const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'prket-andlos';
const PRODUCTS_KEY = 'products/products.json';
const uploadsDir = path.join(__dirname, '../../uploads');

// Helper function to save products data to R2 and cache
const saveProductsData = async (products) => {
  try {
    const jsonString = JSON.stringify(products, null, 2);
    const buffer = Buffer.from(jsonString, 'utf8');

    logger.info({ bucket: BUCKET_NAME, key: PRODUCTS_KEY, count: products.length }, 'Pushing products data to R2');
    await R2.putObject(PRODUCTS_KEY, buffer, 'application/json', BUCKET_NAME);
    cacheManager.set(cacheManager.KEYS.PRODUCTS, products);
    logger.info({ bucket: BUCKET_NAME, key: PRODUCTS_KEY }, 'Successfully pushed products data to R2');
    return true;
  } catch (error) {
    logger.error({ err: error, bucket: BUCKET_NAME, key: PRODUCTS_KEY }, 'Error saving products data to R2');
    return false;
  }
};

// Helper function to read products data from cache or R2
const readProductsData = async () => {
  try {
    const cached = cacheManager.get(cacheManager.KEYS.PRODUCTS);
    if (cached) {
      logger.info('Serving products from cache');
      return cached;
    }

    let exists = false;
    if (typeof R2.ObjectExists === 'function') {
      try {
        exists = await R2.ObjectExists(PRODUCTS_KEY, BUCKET_NAME);
      } catch (err) {
        logger.warn({ err, key: PRODUCTS_KEY }, 'Error checking R2 object existence for products');
      }
    }

    if (!exists) {
      logger.info({ bucket: BUCKET_NAME, key: PRODUCTS_KEY }, 'Products key not found on R2, initializing empty products list');
      const initialProducts = [];
      await saveProductsData(initialProducts);
      return initialProducts;
    }

    const response = await R2.getObject(PRODUCTS_KEY, BUCKET_NAME);
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    const content = Buffer.concat(chunks).toString('utf8');
    const products = JSON.parse(content || '[]');
    cacheManager.set(cacheManager.KEYS.PRODUCTS, products);
    logger.info({ count: products.length }, 'Successfully retrieved products from R2');
    return products;
  } catch (error) {
    logger.error({ err: error }, 'Error reading products data');
    return [];
  }
};

// 1. GET all products (Supports filtering, searching, sorting, pagination)
exports.getAllProducts = async (req, res) => {
  logger.info({ query: req.query }, 'GET /api/products - Fetching all products');
  let products = await readProductsData();

  const { search, category, sort = 'newest', page, limit } = req.query;

  // Filter by search query (title, description, category)
  if (search) {
    const query = search.trim().toLowerCase();
    products = products.filter(
      (p) =>
        (p.title && p.title.toLowerCase().includes(query)) ||
        (p.description && p.description.toLowerCase().includes(query)) ||
        (p.category && p.category.toLowerCase().includes(query))
    );
    logger.info({ searchQuery: query, matches: products.length }, 'Filtered products by search query');
  }

  // Filter by specific category
  if (category) {
    const catQuery = category.trim().toLowerCase();
    products = products.filter(
      (p) => p.category && p.category.toLowerCase() === catQuery
    );
    logger.info({ categoryQuery: catQuery, matches: products.length }, 'Filtered products by category');
  }

  // Sorting
  products.sort((a, b) => {
    if (sort === 'oldest') {
      return new Date(a.dateOfUpload) - new Date(b.dateOfUpload);
    }
    if (sort === 'price_asc') {
      return (Number(a.price) || 0) - (Number(b.price) || 0);
    }
    if (sort === 'price_desc') {
      return (Number(b.price) || 0) - (Number(a.price) || 0);
    }
    // Default: newest
    return new Date(b.dateOfUpload) - new Date(a.dateOfUpload);
  });

  // Pagination support
  if (page && limit) {
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 10;
    const startIndex = (pageNum - 1) * limitNum;
    const endIndex = pageNum * limitNum;
    const paginatedProducts = products.slice(startIndex, endIndex);

    logger.info({ page: pageNum, limit: limitNum, count: paginatedProducts.length, total: products.length }, 'Returning paginated products');
    return res.status(200).json({
      success: true,
      count: paginatedProducts.length,
      total: products.length,
      page: pageNum,
      totalPages: Math.ceil(products.length / limitNum),
      data: paginatedProducts
    });
  }

  logger.info({ count: products.length }, 'Returning all products');
  return res.status(200).json({
    success: true,
    count: products.length,
    data: products
  });
};

// 2. GET product by ID
exports.getProductById = async (req, res) => {
  const { id } = req.params;
  logger.info({ productId: id }, 'GET /api/products/:id - Fetching product by ID');
  const products = await readProductsData();
  const product = products.find((p) => p.id === id);

  if (!product) {
    logger.warn({ productId: id }, 'Product not found by ID');
    return res.status(404).json({
      success: false,
      error: `Product with ID '${id}' not found`
    });
  }

  logger.info({ productId: id, title: product.title }, 'Found product by ID');
  return res.status(200).json({
    success: true,
    data: product
  });
};

// 3. POST add new product (supports JSON or multipart upload)
exports.addProduct = async (req, res) => {
  logger.info({ body: req.body, file: req.file ? req.file.originalname : null }, 'POST /api/products - Adding new product');
  const { title, price, category, description } = req.body;
  let imageKey = req.body ? (req.body.imageKey || req.body.imageUrl || req.body.image) : undefined;
  try {
    // If a file was uploaded via multer
    if (req.file) {
      imageKey = await Product.uploadImage(req.file.path, req.file.mimetype, req.file.originalname);
      logger.info({ uploadedFile: req.file.filename, originalName: req.file.originalname, imageKey: imageKey }, 'Processing uploaded product image file');
      // Cleanup local temp file since it's uploaded to R2
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {
        logger.warn({ err: e, path: req.file.path }, 'Failed to delete temp local upload file');
      }
    }

    if (!imageKey || typeof imageKey !== 'string' || !imageKey.trim()) {
      logger.warn('Product addition failed: missing imageKey or file');
      return res.status(400).json({
        success: false,
        error: 'Image is required. Provide an "imageKey" or "imageUrl" string, or upload a file using field name "file" or "image".'
      });
    }

    const newProductInstance = new Product({
      title,
      price,
      category,
      description,
      imageKey: imageKey.trim()
    });

    const newProduct = newProductInstance.toJSON();
    const currentProducts = await readProductsData();
    currentProducts.push(newProduct);

    // Save & sync to R2
    await saveProductsData(currentProducts);

    logger.info({ newProductId: newProduct.id, title: newProduct.title }, 'Product added successfully');
    return res.status(201).json({
      success: true,
      message: 'Product added successfully',
      data: newProduct
    });
  } catch (error) {
    logger.error({ err: error }, 'Error adding product');
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};

// 4. PUT update product by ID
exports.updateProduct = async (req, res) => {
  const { id } = req.params;
  logger.info({ productId: id, body: req.body, hasFile: !!req.file }, 'PUT /api/products/:id - Updating product');
  const products = await readProductsData();
  const productIndex = products.findIndex((p) => p.id === id);

  if (productIndex === -1) {
    logger.warn({ productId: id }, 'Product update failed: product not found');
    return res.status(404).json({
      success: false,
      error: `Product with ID '${id}' not found`
    });
  }

  try {
    const existing = products[productIndex];
    const { title, price, category, description } = req.body;
    let imageKey = req.body ? (req.body.imageKey || req.body.imageUrl || req.body.image) : undefined;

    if (req.file) {
      logger.info({ uploadedFile: req.file.filename }, 'Updating product with new image file upload to R2');
      imageKey = await Product.uploadImage(req.file.path, req.file.mimetype, req.file.originalname);

      // Clean up local temp file
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) { }

      // Delete previous image from R2 if it was an R2 key
      if (existing.imageKey) {
        try {
          await R2.deleteObject(existing.imageKey, BUCKET_NAME);
          logger.info({ prevKey: existing.imageKey }, 'Deleted previous product image from R2');
        } catch (delErr) {
          logger.error({ err: delErr, prevKey: existing.imageKey }, 'Error deleting previous product image from R2');
        }
      }
    }

    const updatedProduct = new Product({
      ...existing,
      title: title !== undefined ? title : existing.title,
      price: price !== undefined ? price : existing.price,
      category: category !== undefined ? category : existing.category,
      description: description !== undefined ? description : existing.description,
      imageKey: imageKey ? imageKey.trim() : existing.imageKey,
      updatedAt: new Date().toISOString()
    }).toJSON();

    products[productIndex] = updatedProduct;
    await saveProductsData(products);

    logger.info({ productId: id, title: updatedProduct.title }, 'Product updated successfully');
    return res.status(200).json({
      success: true,
      message: 'Product updated successfully',
      data: updatedProduct
    });
  } catch (error) {
    logger.error({ err: error }, 'Error updating product');
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};

// 5. DELETE product by ID
exports.deleteProduct = async (req, res) => {
  const { id } = req.params;
  logger.info({ productId: id }, 'DELETE /api/products/:id - Deleting product');
  const products = await readProductsData();
  const productIndex = products.findIndex((p) => p.id === id);

  if (productIndex === -1) {
    logger.warn({ productId: id }, 'Product deletion failed: product not found');
    return res.status(404).json({
      success: false,
      error: `Product with ID '${id}' not found`
    });
  }

  const deletedProduct = products[productIndex];

  try {
    // Delete image from R2 if present
    if (deletedProduct.imageKey) {
      try {
        await R2.deleteObject(deletedProduct.imageKey, BUCKET_NAME);
        logger.info({ key: deletedProduct.imageKey }, 'Deleted product image from R2');
      } catch (err) {
        logger.error({ err, key: deletedProduct.imageKey }, 'Failed to delete product image from R2');
      }
    }

    products.splice(productIndex, 1);
    await saveProductsData(products);

    logger.info({ productId: id, title: deletedProduct.title }, 'Product deleted successfully');
    return res.status(200).json({
      success: true,
      message: `Product '${id}' deleted successfully`,
      data: deletedProduct
    });
  } catch (error) {
    logger.error({ err: error }, 'Error deleting product');
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};

// 6. GET photo based on photo URL or key parameter (?url=...)
exports.getPhotoByUrl = async (req, res) => {
  const targetUrl = req.query.url || req.query.key;
  logger.info({ targetUrl }, 'GET /api/products/photo - Proxying/serving product photo');

  if (!targetUrl || typeof targetUrl !== 'string') {
    logger.warn('Product photo request missing valid url parameter');
    return res.status(400).json({
      success: false,
      error: 'A valid "url" or "key" query parameter is required'
    });
  }
  logger.info({ key: targetUrl }, 'Fetching image from R2');
  try {
    const response = await R2.getObject(targetUrl, BUCKET_NAME);
    const contentType = response.ContentType || 'image/jpeg';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');

    // Stream the S3 readable stream to express response
    response.Body.pipe(res);
    logger.info({ key: targetUrl, contentType }, 'Successfully streaming image from R2');
    return;
  } catch (error) {
    logger.error({ err: error, key: targetUrl }, 'Failed to fetch image from R2');
    return res.status(404).json({
      success: false,
      error: 'Image not found in storage'
    });
  }
};
