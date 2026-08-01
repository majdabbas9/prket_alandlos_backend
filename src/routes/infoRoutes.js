const express = require('express');
const router = express.Router();
const infoController = require('../controllers/infoController');

// GET store info
router.get('/', infoController.getInfo);

// POST update store info
router.post('/', infoController.updateInfo);

module.exports = router;
