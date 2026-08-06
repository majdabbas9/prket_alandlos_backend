const multer = require('multer');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger').getLogger(__filename);

const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  logger.info({ uploadDir }, 'Creating uploads directory');
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname).toLowerCase();
    const generatedFilename = `img-${uniqueSuffix}${ext}`;
    logger.info({ originalname: file.originalname, generatedFilename }, 'Generated temporary upload filename');
    cb(null, generatedFilename);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp|svg|avif/;
  const extName = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimeType = allowedTypes.test(file.mimetype);

  if (extName && mimeType) {
    logger.info({ originalname: file.originalname, mimetype: file.mimetype }, 'File upload validation passed');
    return cb(null, true);
  }

  logger.warn({ originalname: file.originalname, mimetype: file.mimetype }, 'File upload rejected: invalid file type');
  cb(new Error('Only image files (jpg, jpeg, png, gif, webp, svg, avif) are allowed!'));
};

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter
});

module.exports = upload;

