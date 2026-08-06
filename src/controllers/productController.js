const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger').getLogger(__filename);

const dataFilePath = path.join(__dirname, '../data/products.json');
const uploadsDir = path.join(__dirname, '../../uploads');
const productsDir = path.join(__dirname, '../../uploads/products');

// Helper function to read products from JSON file
const readProductsFromFile = () => {
  try {
    if (!fs.existsSync(dataFilePath)) {
      logger.info({ dataFilePath }, 'Products file does not exist yet');
      return [];
    }
    const fileData = fs.readFileSync(dataFilePath, 'utf8');
    const products = JSON.parse(fileData || '[]');
    logger.info({ count: products.length }, 'Successfully read products from JSON file');
    return products;
  } catch (error) {
    logger.error({ err: error, dataFilePath }, 'Error reading products file');
    return [];
  }
};

// Helper function to save products to JSON file
const saveProductsToFile = (products) => {
  try {
    const dirPath = path.dirname(dataFilePath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    fs.writeFileSync(dataFilePath, JSON.stringify(products, null, 2), 'utf8');
    logger.info({ count: products.length, dataFilePath }, 'Successfully saved products to JSON file');
  } catch (error) {
    logger.error({ err: error, dataFilePath }, 'Error writing products file');
  }
};

// 1. GET all products (Supports filtering, searching, sorting, pagination)
exports.getAllProducts = (req, res) => {
  logger.info({ query: req.query }, 'GET /api/products - Fetching all products');
  let products = readProductsFromFile();

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
exports.getProductById = (req, res) => {
  const { id } = req.params;
  logger.info({ productId: id }, 'GET /api/products/:id - Fetching product by ID');
  const products = readProductsFromFile();
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
exports.addProduct = (req, res) => {
  logger.info({ body: req.body, file: req.file ? req.file.originalname : null }, 'POST /api/products - Adding new product');
  const { title, price, category, description } = req.body;
  let imageUrl = req.body.imageUrl;

  // If a file was uploaded via multer
  if (req.file) {
    logger.info({ uploadedFile: req.file.filename, originalName: req.file.originalname }, 'Processing uploaded product image file');
    const originalFilePath = req.file.path;
    const filename = req.file.filename;
    const destPath = path.join(productsDir, filename);

    if (!fs.existsSync(productsDir)) {
      fs.mkdirSync(productsDir, { recursive: true });
    }
    fs.renameSync(originalFilePath, destPath);
    imageUrl = `/uploads/products/${filename}`;
    logger.info({ destPath, imageUrl }, 'Moved product image to products directory');
  }

  if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.trim()) {
    logger.warn('Product addition failed: missing imageUrl or file');
    return res.status(400).json({
      success: false,
      error: 'Image is required. Provide an "imageUrl" string or upload a file using field name "image".'
    });
  }

  const cleanUrl = imageUrl.trim();

  // If it's a remote URL, validate format
  if (!cleanUrl.startsWith('/uploads/')) {
    try {
      new URL(cleanUrl);
    } catch (err) {
      logger.warn({ cleanUrl }, 'Invalid remote imageUrl format provided');
      return res.status(400).json({
        success: false,
        error: 'imageUrl must be a valid URL or an uploaded file path (/uploads/...)'
      });
    }
  }

  const newProduct = {
    id: `prod_${uuidv4()}`,
    title: title ? String(title).trim() : 'Untitled Product',
    price: price ? Number(price) : 0,
    category: category ? String(category).trim() : 'General',
    description: description ? String(description).trim() : '',
    imageUrl: cleanUrl,
    dateOfUpload: new Date().toISOString()
  };

  const currentProducts = readProductsFromFile();
  currentProducts.push(newProduct);
  saveProductsToFile(currentProducts);

  logger.info({ newProductId: newProduct.id, title: newProduct.title }, 'Product added successfully');
  return res.status(201).json({
    success: true,
    message: 'Product added successfully',
    data: newProduct
  });
};

// 4. PUT update product by ID
exports.updateProduct = (req, res) => {
  const { id } = req.params;
  logger.info({ productId: id, body: req.body, hasFile: !!req.file }, 'PUT /api/products/:id - Updating product');
  const products = readProductsFromFile();
  const productIndex = products.findIndex((p) => p.id === id);

  if (productIndex === -1) {
    logger.warn({ productId: id }, 'Product update failed: product not found');
    return res.status(404).json({
      success: false,
      error: `Product with ID '${id}' not found`
    });
  }

  const existing = products[productIndex];
  const { title, price, category, description } = req.body;
  let imageUrl = req.body.imageUrl;

  if (req.file) {
    logger.info({ uploadedFile: req.file.filename }, 'Updating product with new image file upload');
    const originalFilePath = req.file.path;
    const filename = req.file.filename;
    const destPath = path.join(productsDir, filename);

    if (!fs.existsSync(productsDir)) {
      fs.mkdirSync(productsDir, { recursive: true });
    }
    fs.renameSync(originalFilePath, destPath);
    imageUrl = `/uploads/products/${filename}`;

    // Clean up previous product image file if stored locally in /uploads/
    if (existing.imageUrl && existing.imageUrl.startsWith('/uploads/')) {
      const prevRelativePath = existing.imageUrl.replace(/^\/uploads\//, '');
      const prevFilePath = path.join(uploadsDir, prevRelativePath);
      if (fs.existsSync(prevFilePath) && prevFilePath !== destPath) {
        try {
          fs.unlinkSync(prevFilePath);
          logger.info({ prevFilePath }, 'Deleted previous product image file from disk');
        } catch (delErr) {
          logger.error({ err: delErr, prevFilePath }, 'Error deleting previous product image file');
        }
      }
    }
  }

  const updatedProduct = {
    ...existing,
    title: title !== undefined ? String(title).trim() : existing.title,
    price: price !== undefined ? Number(price) : existing.price,
    category: category !== undefined ? String(category).trim() : existing.category,
    description: description !== undefined ? String(description).trim() : existing.description,
    imageUrl: imageUrl ? String(imageUrl).trim() : existing.imageUrl,
    updatedAt: new Date().toISOString()
  };

  products[productIndex] = updatedProduct;
  saveProductsToFile(products);

  logger.info({ productId: id, title: updatedProduct.title }, 'Product updated successfully');
  return res.status(200).json({
    success: true,
    message: 'Product updated successfully',
    data: updatedProduct
  });
};

// 5. DELETE product by ID
exports.deleteProduct = (req, res) => {
  const { id } = req.params;
  logger.info({ productId: id }, 'DELETE /api/products/:id - Deleting product');
  const products = readProductsFromFile();
  const productIndex = products.findIndex((p) => p.id === id);

  if (productIndex === -1) {
    logger.warn({ productId: id }, 'Product deletion failed: product not found');
    return res.status(404).json({
      success: false,
      error: `Product with ID '${id}' not found`
    });
  }

  const deletedProduct = products[productIndex];

  // If local file, attempt to delete from disk
  if (deletedProduct.imageUrl && deletedProduct.imageUrl.startsWith('/uploads/')) {
    const relativePath = deletedProduct.imageUrl.replace(/^\/uploads\//, '');
    const filePath = path.join(uploadsDir, relativePath);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        logger.info({ filePath }, 'Deleted product image file from disk');
      } catch (err) {
        logger.error({ err, filePath }, 'Failed to delete product image file from disk');
      }
    }
  }

  products.splice(productIndex, 1);
  saveProductsToFile(products);

  logger.info({ productId: id, title: deletedProduct.title }, 'Product deleted successfully');
  return res.status(200).json({
    success: true,
    message: `Product '${id}' deleted successfully`,
    data: deletedProduct
  });
};

// 6. GET photo based on photo URL parameter (?url=...)
exports.getPhotoByUrl = async (req, res) => {
  const targetUrl = req.query.url;
  logger.info({ targetUrl }, 'GET /api/products/photo - Proxying/serving product photo by URL');

  if (!targetUrl || typeof targetUrl !== 'string') {
    logger.warn('Product photo request missing valid url parameter');
    return res.status(400).json({
      success: false,
      error: 'A valid "url" query parameter is required (e.g., /api/products/photo?url=...)'
    });
  }

  // Handle local uploaded files
  if (targetUrl.startsWith('/uploads/')) {
    const relativePath = targetUrl.replace(/^\/uploads\//, '');
    const localFilePath = path.join(uploadsDir, relativePath);
    if (fs.existsSync(localFilePath)) {
      logger.info({ localFilePath }, 'Serving local uploaded product photo file');
      return res.sendFile(localFilePath);
    } else {
      logger.warn({ localFilePath }, 'Local uploaded photo file not found on server');
      return res.status(404).json({
        success: false,
        error: 'Uploaded photo file not found on server'
      });
    }
  }

  try {
    const parsedUrl = new URL(targetUrl);
    logger.info({ remoteUrl: parsedUrl.toString() }, 'Fetching remote image via HTTP proxy');
    const response = await fetch(parsedUrl.toString());

    if (!response.ok) {
      logger.warn({ status: response.status, remoteUrl: parsedUrl.toString() }, 'Failed to fetch remote image');
      return res.status(response.status).json({
        success: false,
        error: `Failed to fetch image from remote server (Status: ${response.status})`
      });
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await response.arrayBuffer());

    logger.info({ contentType, sizeBytes: buffer.length }, 'Successfully fetched remote image and serving buffer');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.status(200).send(buffer);
  } catch (error) {
    logger.error({ err: error, targetUrl }, 'Error fetching photo by URL, executing 302 fallback redirect');
    return res.redirect(302, targetUrl);
  }
};

