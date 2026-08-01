const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const upload = require('../middleware/upload');

// 1. GET photo by URL parameter (?url=...) - must be registered before /:id
router.get('/photo', productController.getPhotoByUrl);

// 2. GET all products (supports ?search=, ?category=, ?sort=, ?page=, ?limit=)
router.get('/', productController.getAllProducts);

// 3. GET single product by ID
router.get('/:id', productController.getProductById);

// 4. POST add new product (accepts JSON body or multipart form-data with file field 'image')
router.post('/', upload.single('image'), productController.addProduct);

// 5. PUT update product by ID
router.put('/:id', upload.single('image'), productController.updateProduct);

// 6. DELETE product by ID
router.delete('/:id', productController.deleteProduct);

module.exports = router;
