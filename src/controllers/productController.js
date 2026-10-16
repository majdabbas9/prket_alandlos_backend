const fs = require('fs');
const logger = require('../utils/logger').getLogger(__filename);
const Product = require('../models/Product');
const R2 = require('../cloudManager/R2');
const { isProductImageKey } = require('../utils/imageKeys');
const cacheManager = require('../utils/cacheManager');
const sendImage = require('../utils/sendImage');

const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'prket-andlos';

// Picks the optional catalog attributes (woodType, finish, ...) present in a request body
const pickDetails = (body = {}) =>
  Object.fromEntries(
    Product.DETAIL_FIELDS.filter((f) => body[f] !== undefined).map((f) => [f, body[f]]),
  );
const PRODUCTS_KEY = 'products/products.json';

// Helper function to save products data to R2 and cache
const saveProductsData = async (products) => {
  try {
    const jsonString = JSON.stringify(products, null, 2);
    const buffer = Buffer.from(jsonString, 'utf8');

    logger.info(
      { bucket: BUCKET_NAME, key: PRODUCTS_KEY, count: products.length },
      'Pushing products data to R2',
    );
    await R2.putObject(PRODUCTS_KEY, buffer, 'application/json', BUCKET_NAME);
    await cacheManager.set(cacheManager.KEYS.PRODUCTS, products);
    logger.info(
      { bucket: BUCKET_NAME, key: PRODUCTS_KEY },
      'Successfully pushed products data to R2',
    );
    return true;
  } catch (error) {
    logger.error(
      { err: error, bucket: BUCKET_NAME, key: PRODUCTS_KEY },
      'Error saving products data to R2',
    );
    return false;
  }
};

// Helper function to read products data from cache or R2.
// Throws on R2 errors - never fall back to [] here, or a following save would wipe the catalog.
const readProductsData = async () => {
  const cached = await cacheManager.get(cacheManager.KEYS.PRODUCTS);
  if (cached) {
    logger.info('Serving products from cache');
    return cached;
  }

  let response;
  try {
    response = await R2.getObject(PRODUCTS_KEY, BUCKET_NAME);
  } catch (error) {
    if (!R2.isNotFound(error)) throw error;
    // Created at startup (utils/ensureDefaults), so this only happens if it was deleted since
    logger.warn({ bucket: BUCKET_NAME, key: PRODUCTS_KEY }, 'Products key missing on R2');
    return [];
  }

  const chunks = [];
  for await (const chunk of response.Body) {
    chunks.push(chunk);
  }
  const content = Buffer.concat(chunks).toString('utf8');
  const products = JSON.parse(content || '[]');
  await cacheManager.set(cacheManager.KEYS.PRODUCTS, products);
  logger.info({ count: products.length }, 'Successfully retrieved products from R2');
  return products;
};

// Deletes a product's image and thumbnail from R2; failures are logged, never thrown
const deleteProductImages = async (product) => {
  const keys = [...new Set([product.imageKey, product.thumbKey].filter(Boolean))];
  await Promise.all(
    keys.map(async (key) => {
      try {
        await R2.deleteObject(key, BUCKET_NAME);
        logger.info({ key }, 'Deleted product image from R2');
      } catch (err) {
        logger.error({ err, key }, 'Failed to delete product image from R2');
      }
    }),
  );
};

// Multer temp files live in uploads/; remove them whether or not the upload to R2 succeeded
const removeTempUpload = (file) => {
  if (!file) return;
  try {
    fs.unlinkSync(file.path);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.warn({ err, path: file.path }, 'Failed to delete temp local upload file');
    }
  }
};

// Client-supplied keys may only point at product images (they are later deleted with the product)
const invalidImageKey = (res, imageKey) => {
  logger.warn({ imageKey }, 'Rejected image key outside products/');
  return res.status(400).json({
    success: false,
    error: 'imageKey must be a product image key (products/<name>.webp|jpg|png|gif|avif)',
  });
};

// Responds 500 when products could not be read from R2
const handleReadError = (res, error) => {
  logger.error({ err: error }, 'Error reading products data');
  return res.status(500).json({ success: false, error: 'Internal Server Error' });
};

// 1. GET all products (Supports filtering, searching, sorting, pagination)
exports.getAllProducts = async (req, res) => {
  logger.info({ query: req.query }, 'GET /api/products - Fetching all products');
  let products;
  try {
    products = await readProductsData();
  } catch (error) {
    return handleReadError(res, error);
  }

  const { search, category, sort = 'newest', page, limit } = req.query;

  // Repeated or bracketed params (?search=a&search=b, ?category[x]=1) parse as arrays/objects;
  // calling string methods on them would throw outside any try/catch and crash the process
  if (
    (search !== undefined && typeof search !== 'string') ||
    (category !== undefined && typeof category !== 'string')
  ) {
    logger.warn({ query: req.query }, 'Rejected non-string search/category query parameter');
    return res.status(400).json({
      success: false,
      error: 'The "search" and "category" query parameters must be single strings',
    });
  }

  // Filter by search query (title, description, category)
  if (search) {
    const query = search.trim().toLowerCase();
    products = products.filter(
      (p) =>
        (p.title && p.title.toLowerCase().includes(query)) ||
        (p.description && p.description.toLowerCase().includes(query)) ||
        (p.category && p.category.toLowerCase().includes(query)),
    );
    logger.info(
      { searchQuery: query, matches: products.length },
      'Filtered products by search query',
    );
  }

  // Filter by specific category
  if (category) {
    const catQuery = category.trim().toLowerCase();
    products = products.filter((p) => p.category && p.category.toLowerCase() === catQuery);
    logger.info(
      { categoryQuery: catQuery, matches: products.length },
      'Filtered products by category',
    );
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

    logger.info(
      { page: pageNum, limit: limitNum, count: paginatedProducts.length, total: products.length },
      'Returning paginated products',
    );
    return res.status(200).json({
      success: true,
      count: paginatedProducts.length,
      total: products.length,
      page: pageNum,
      totalPages: Math.ceil(products.length / limitNum),
      data: paginatedProducts.map(Product.withImageUrls),
    });
  }

  logger.info({ count: products.length }, 'Returning all products');
  return res.status(200).json({
    success: true,
    count: products.length,
    data: products.map(Product.withImageUrls),
  });
};

// 2. GET product by ID
exports.getProductById = async (req, res) => {
  const { id } = req.params;
  logger.info({ productId: id }, 'GET /api/products/:id - Fetching product by ID');
  let products;
  try {
    products = await readProductsData();
  } catch (error) {
    return handleReadError(res, error);
  }
  const product = products.find((p) => p.id === id);

  if (!product) {
    logger.warn({ productId: id }, 'Product not found by ID');
    return res.status(404).json({
      success: false,
      error: `Product with ID '${id}' not found`,
    });
  }

  logger.info({ productId: id, title: product.title }, 'Found product by ID');
  return res.status(200).json({
    success: true,
    data: Product.withImageUrls(product),
  });
};

// 3. POST add new product (supports JSON or multipart upload)
exports.addProduct = async (req, res) => {
  logger.info(
    { body: req.body, file: req.file ? req.file.originalname : null },
    'POST /api/products - Adding new product',
  );
  const { title, price, category, description } = req.body;
  let imageKey = req.body ? req.body.imageKey || req.body.imageUrl || req.body.image : undefined;
  let thumbKey;
  if (
    !req.file &&
    imageKey !== undefined &&
    (typeof imageKey !== 'string' || !isProductImageKey(imageKey.trim()))
  ) {
    return invalidImageKey(res, imageKey);
  }
  try {
    // If a file was uploaded via multer
    if (req.file) {
      ({ imageKey, thumbKey } = await Product.uploadImage(
        req.file.path,
        req.file.mimetype,
        req.file.originalname,
      ));
      logger.info(
        {
          uploadedFile: req.file.filename,
          originalName: req.file.originalname,
          imageKey: imageKey,
        },
        'Processing uploaded product image file',
      );
    }

    if (!imageKey || typeof imageKey !== 'string' || !imageKey.trim()) {
      logger.warn('Product addition failed: missing imageKey or file');
      return res.status(400).json({
        success: false,
        error:
          'Image is required. Provide an "imageKey" or "imageUrl" string, or upload a file using field name "file" or "image".',
      });
    }

    const newProductInstance = new Product({
      title,
      price,
      category,
      description,
      ...pickDetails(req.body),
      imageKey: imageKey.trim(),
      thumbKey,
    });

    const newProduct = newProductInstance.toJSON();
    const currentProducts = await readProductsData();
    currentProducts.push(newProduct);

    // Save & sync to R2
    await saveProductsData(currentProducts);

    logger.info(
      { newProductId: newProduct.id, title: newProduct.title },
      'Product added successfully',
    );
    return res.status(201).json({
      success: true,
      message: 'Product added successfully',
      data: Product.withImageUrls(newProduct),
    });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ success: false, error: error.message });
    logger.error({ err: error }, 'Error adding product');
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  } finally {
    removeTempUpload(req.file);
  }
};

// 4. PUT update product by ID
exports.updateProduct = async (req, res) => {
  const { id } = req.params;
  logger.info(
    { productId: id, body: req.body, hasFile: !!req.file },
    'PUT /api/products/:id - Updating product',
  );
  let products;
  try {
    products = await readProductsData();
  } catch (error) {
    removeTempUpload(req.file);
    return handleReadError(res, error);
  }
  const productIndex = products.findIndex((p) => p.id === id);

  if (productIndex === -1) {
    removeTempUpload(req.file);
    logger.warn({ productId: id }, 'Product update failed: product not found');
    return res.status(404).json({
      success: false,
      error: `Product with ID '${id}' not found`,
    });
  }

  try {
    const existing = products[productIndex];
    const { title, price, category, description } = req.body;
    let imageKey = req.body ? req.body.imageKey || req.body.imageUrl || req.body.image : undefined;
    if (
      !req.file &&
      imageKey !== undefined &&
      (typeof imageKey !== 'string' || !isProductImageKey(imageKey.trim()))
    ) {
      return invalidImageKey(res, imageKey);
    }
    // A new imageKey given without a file has no generated thumbnail
    let thumbKey = imageKey && imageKey.trim() !== existing.imageKey ? '' : existing.thumbKey;

    if (req.file) {
      logger.info(
        { uploadedFile: req.file.filename },
        'Updating product with new image file upload to R2',
      );
      ({ imageKey, thumbKey } = await Product.uploadImage(
        req.file.path,
        req.file.mimetype,
        req.file.originalname,
      ));

      // Delete previous image and thumbnail from R2
      await deleteProductImages(existing);
    }

    const updatedProduct = new Product({
      ...existing,
      title: title !== undefined ? title : existing.title,
      price: price !== undefined ? price : existing.price,
      category: category !== undefined ? category : existing.category,
      description: description !== undefined ? description : existing.description,
      ...pickDetails(req.body),
      imageKey: imageKey ? imageKey.trim() : existing.imageKey,
      thumbKey,
      updatedAt: new Date().toISOString(),
    }).toJSON();

    products[productIndex] = updatedProduct;
    await saveProductsData(products);

    logger.info({ productId: id, title: updatedProduct.title }, 'Product updated successfully');
    return res.status(200).json({
      success: true,
      message: 'Product updated successfully',
      data: Product.withImageUrls(updatedProduct),
    });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ success: false, error: error.message });
    logger.error({ err: error }, 'Error updating product');
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  } finally {
    removeTempUpload(req.file);
  }
};

// 5. DELETE product by ID
exports.deleteProduct = async (req, res) => {
  const { id } = req.params;
  logger.info({ productId: id }, 'DELETE /api/products/:id - Deleting product');
  let products;
  try {
    products = await readProductsData();
  } catch (error) {
    return handleReadError(res, error);
  }
  const productIndex = products.findIndex((p) => p.id === id);

  if (productIndex === -1) {
    logger.warn({ productId: id }, 'Product deletion failed: product not found');
    return res.status(404).json({
      success: false,
      error: `Product with ID '${id}' not found`,
    });
  }

  const deletedProduct = products[productIndex];

  try {
    await deleteProductImages(deletedProduct);

    products.splice(productIndex, 1);
    await saveProductsData(products);

    logger.info({ productId: id, title: deletedProduct.title }, 'Product deleted successfully');
    return res.status(200).json({
      success: true,
      message: `Product '${id}' deleted successfully`,
      data: deletedProduct,
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

  // Only product images: without this, any object in the bucket could be read by key
  if (!isProductImageKey(targetUrl)) {
    logger.warn({ targetUrl }, 'Product photo request without a valid product image key');
    return res.status(400).json({
      success: false,
      error: 'A valid "url" or "key" query parameter is required',
    });
  }
  logger.info({ key: targetUrl }, 'Fetching image from R2');
  let response;
  try {
    response = await R2.getObject(targetUrl, BUCKET_NAME);
  } catch (error) {
    if (!R2.isNotFound(error)) {
      logger.error({ err: error, key: targetUrl }, 'Failed to fetch image from R2');
      return res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
    logger.warn({ key: targetUrl }, 'Product image not found in R2');
    return res.status(404).json({
      success: false,
      error: 'Image not found in storage',
    });
  }

  // Product image keys are unique per upload, so the browser can keep them for good
  return sendImage(
    req,
    res,
    {
      body: response.Body,
      contentType: response.ContentType || 'image/jpeg',
      contentLength: response.ContentLength,
      etag: response.ETag,
      lastModified: response.LastModified,
    },
    Product.IMMUTABLE_CACHE_CONTROL,
  );
};
