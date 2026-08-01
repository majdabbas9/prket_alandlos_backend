const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const uploadsDir = path.join(__dirname, '../../uploads');
const logoDir = path.join(__dirname, '../../uploads/logo');
const dataFilePath = path.join(__dirname, '../data/logo.json');

const VALID_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.avif'];

// Helper to locate the actual logo file on disk inside uploads/logo
const getActualLogoFilePath = () => {
  if (!fs.existsSync(logoDir)) {
    return null;
  }

  // 1. Check if logo.json exists and points to a valid file on disk
  if (fs.existsSync(dataFilePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(dataFilePath, 'utf8'));
      if (data.logoUrl && data.logoUrl.startsWith('/uploads/')) {
        const relativePath = data.logoUrl.replace(/^\/uploads\//, '');
        const targetPath = path.join(uploadsDir, relativePath);
        if (fs.existsSync(targetPath)) {
          return targetPath;
        }
      }
    } catch (e) {
      // Fallback to directory scan
    }
  }

  // 2. Scan uploads/logo folder for valid image files
  try {
    const files = fs.readdirSync(logoDir);
    const imageFiles = files.filter((file) => {
      const ext = path.extname(file).toLowerCase();
      return VALID_EXTENSIONS.includes(ext);
    });

    if (imageFiles.length === 0) {
      return null;
    }

    // Sort by modification time (most recent first)
    const sorted = imageFiles
      .map((file) => {
        const filePath = path.join(logoDir, file);
        const stat = fs.statSync(filePath);
        return { file, filePath, mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);

    return sorted[0].filePath;
  } catch (error) {
    console.error('Error scanning logo directory:', error);
    return null;
  }
};

// 1. GET /api/logo - Returns the actual logo file binary directly from uploads/logo
exports.getLogo = async (req, res) => {
  const filePath = getActualLogoFilePath();

  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({
      success: false,
      error: 'Logo image file not found in uploads/logo directory'
    });
  }

  // If client specifically requests JSON metadata (?info=true or ?json=true)
  if (req.query.info === 'true' || req.query.json === 'true') {
    const filename = path.basename(filePath);
    const stat = fs.statSync(filePath);
    return res.status(200).json({
      success: true,
      data: {
        logoUrl: `/uploads/logo/${filename}`,
        filename,
        size: stat.size,
        updatedAt: stat.mtime.toISOString()
      }
    });
  }

  // Send the actual image file binary directly
  return res.sendFile(filePath);
};

// 2. GET /api/logo/:filename - Returns a specific file from uploads/logo folder
exports.getLogoByName = async (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(logoDir, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      success: false,
      error: `File ${filename} not found in uploads/logo directory`
    });
  }

  return res.sendFile(filePath);
};

// 3. POST /api/logo - Update or upload logo image file into uploads/logo directory
exports.updateLogo = async (req, res) => {
  try {
    const uploadedFile = req.file || (req.files && (req.files.image?.[0] || req.files.logo?.[0]));
    let updatedLogoUrl = req.body ? req.body.logoUrl || req.body.imageUrl : null;
    let width = null;
    let height = null;
    let mimeType = 'image/jpeg';
    let size = null;
    let filename = null;

    if (!fs.existsSync(logoDir)) {
      fs.mkdirSync(logoDir, { recursive: true });
    }

    if (uploadedFile) {
      const originalFilePath = uploadedFile.path;
      const fileExt = path.extname(uploadedFile.originalname).toLowerCase() || '.jpg';
      filename = `logo-${Date.now()}${fileExt}`;
      const outputFilePath = path.join(logoDir, filename);

      try {
        const metadata = await sharp(originalFilePath).metadata();
        width = metadata.width || null;
        height = metadata.height || null;
        mimeType = `image/${metadata.format || 'jpeg'}`;
      } catch (err) {
        console.warn('Could not extract image metadata via sharp:', err.message);
      }

      fs.renameSync(originalFilePath, outputFilePath);

      const fileStats = fs.statSync(outputFilePath);
      size = fileStats.size;
      updatedLogoUrl = `/uploads/logo/${filename}`;
    }

    if (!updatedLogoUrl || typeof updatedLogoUrl !== 'string' || !updatedLogoUrl.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Logo image is required. Upload a file using form-data field "image" or "logo", or provide a "logoUrl" string.'
      });
    }

    const cleanUrl = updatedLogoUrl.trim();
    filename = filename || path.basename(cleanUrl);

    const newLogoData = {
      logoUrl: cleanUrl,
      filename,
      width,
      height,
      mimeType,
      size,
      updatedAt: new Date().toISOString()
    };

    const dirPath = path.dirname(dataFilePath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    fs.writeFileSync(dataFilePath, JSON.stringify(newLogoData, null, 2), 'utf8');

    return res.status(200).json({
      success: true,
      message: 'Logo image updated successfully',
      data: newLogoData
    });
  } catch (error) {
    console.error('Error updating logo image:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to process and update logo image: ' + error.message
    });
  }
};
