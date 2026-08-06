const express = require('express');
const router = express.Router();
const homepageController = require('../controllers/homepageController');
const upload = require('../middleware/upload');

// GET homepage image details
router.get('/', homepageController.getHomepageImage);

// POST update homepage image (supports file upload field 'image', 'file', etc. or body 'imageUrl')
router.post('/', upload.flexibleSingle(), homepageController.updateHomepageImage);

module.exports = router;
