const express = require('express');
const router = express.Router();
const infoController = require('../controllers/infoController');
const auth = require('../middleware/auth');
const { normalizeLang } = require('../utils/languages');

// Resolve the lang field (GET query / POST body); empty or missing defaults to English
const resolveLang = (req, res, next) => {
  const raw = req.method === 'GET' ? req.query.lang : (req.body ? req.body.lang : undefined);
  req.lang = normalizeLang(raw);
  next();
};

// GET store info
router.get('/', resolveLang, infoController.getInfo);

// POST update store info
router.post('/', auth, resolveLang, infoController.updateInfo);

module.exports = router;
