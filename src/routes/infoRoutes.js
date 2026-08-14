const express = require('express');
const router = express.Router();
const infoController = require('../controllers/infoController');
const auth = require('../middleware/auth');

// GET store info
router.get('/', infoController.getInfo);

// POST update store info
router.post('/', auth, infoController.updateInfo);

module.exports = router;
