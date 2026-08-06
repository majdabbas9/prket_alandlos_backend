const express = require('express');
const router = express.Router();
const logoController = require('../controllers/logoController');
const upload = require('../middleware/upload');

// GET actual logo image file directly
router.get('/', logoController.getLogo);

// GET specific file from uploads/logo folder by filename (e.g., /api/logo/12.jpg)
router.get('/:filename', logoController.getLogoByName);

// POST update/upload logo image
router.post('/', upload.flexibleSingle(), logoController.updateLogo);

module.exports = router;
