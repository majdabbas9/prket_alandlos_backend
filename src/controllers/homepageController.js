const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const dataFilePath = path.join(__dirname, '../data/homepage.json');
const uploadsDir = path.join(__dirname, '../../uploads');

// Helper to read homepage metadata
const readHomepageData = () => {
  try {
    if (!fs.existsSync(dataFilePath)) {
      return {
        imageUrl: 'https://images.pexels.com/photos/6523303/pexels-photo-6523303.jpeg?auto=compress&cs=tinysrgb&w=1600',
        width: 1600,
        height: 1067,
        mimeType: 'image/jpeg',
        updatedAt: new Date().toISOString()
      };
    }
    const content = fs.readFileSync(dataFilePath, 'utf8');
    return JSON.parse(content || '{}');
  } catch (error) {
    console.error('Error reading homepage.json:', error);
    return {
      imageUrl: 'https://images.pexels.com/photos/6523303/pexels-photo-6523303.jpeg?auto=compress&cs=tinysrgb&w=1600',
      width: 1600,
      height: 1067,
      mimeType: 'image/jpeg',
      updatedAt: new Date().toISOString()
    };
  }
};

// Helper to save homepage metadata
const saveHomepageData = (data) => {
  try {
    const dirPath = path.dirname(dataFilePath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('Error writing homepage.json:', error);
  }
};

// 1. GET Homepage Image (returns the actual image file binary, or JSON metadata if ?info=true)
exports.getHomepageImage = async (req, res) => {
  const data = readHomepageData();

  // If client specifically requests JSON metadata (e.g. ?info=true or ?json=true)
  if (req.query.info === 'true' || req.query.json === 'true') {
    return res.status(200).json({
      success: true,
      data
    });
  }

  const imageUrl = data.imageUrl;

  // Handle local uploaded files
  if (imageUrl && imageUrl.startsWith('/uploads/')) {
    const filename = path.basename(imageUrl);
    const localFilePath = path.join(uploadsDir, filename);
    if (fs.existsSync(localFilePath)) {
      return res.sendFile(localFilePath);
    } else {
      return res.status(404).json({
        success: false,
        error: 'Homepage image file not found on server'
      });
    }
  }

  // Handle remote image URLs
  try {
    const parsedUrl = new URL(imageUrl);
    const response = await fetch(parsedUrl.toString());

    if (!response.ok) {
      return res.redirect(302, imageUrl);
    }

    const contentType = response.headers.get('content-type') || data.mimeType || 'image/jpeg';
    const buffer = Buffer.from(await response.arrayBuffer());

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.status(200).send(buffer);
  } catch (error) {
    console.error('Error fetching/serving homepage image file:', error.message);
    return res.redirect(302, imageUrl);
  }
};

// 2. POST Update Homepage Image with sharp processing (resizing width to 1600 if needed)
exports.updateHomepageImage = async (req, res) => {
  try {
    const existingData = readHomepageData();
    let updatedImageUrl = req.body ? req.body.imageUrl : null;
    let width = existingData.width || 1600;
    let height = existingData.height || 1067;
    let mimeType = existingData.mimeType || 'image/jpeg';
    let size = existingData.size || null;

    if (req.file) {
      const originalFilePath = req.file.path;
      const fileExt = path.extname(req.file.originalname).toLowerCase() || '.jpg';
      const outputFilename = `homepage-${Date.now()}${fileExt}`;
      const outputFilePath = path.join(uploadsDir, outputFilename);

      // Read image metadata using sharp
      const image = sharp(originalFilePath);
      const metadata = await image.metadata();

      const origWidth = metadata.width || 1600;
      const origHeight = metadata.height || 1067;

      // Determine if width resizing is needed (if width != 1600 or > 1600)
      const TARGET_WIDTH = 1600;
      let sharpPipeline = sharp(originalFilePath).rotate(); // auto-rotate based on EXIF

      if (origWidth !== TARGET_WIDTH) {
        // Resize to width 1600 maintaining aspect ratio
        sharpPipeline = sharpPipeline.resize({
          width: TARGET_WIDTH,
          withoutEnlargement: false
        });
      }

      // Process image and save to destination path
      await sharpPipeline.toFile(outputFilePath);

      // Get metadata of the output processed image
      const processedMeta = await sharp(outputFilePath).metadata();
      const fileStats = fs.statSync(outputFilePath);

      width = processedMeta.width || TARGET_WIDTH;
      height = processedMeta.height || Math.round((origHeight / origWidth) * TARGET_WIDTH);
      mimeType = `image/${processedMeta.format || 'jpeg'}`;
      size = fileStats.size;

      // Clean up original uploaded temporary file if different from outputFilePath
      if (originalFilePath !== outputFilePath && fs.existsSync(originalFilePath)) {
        try {
          fs.unlinkSync(originalFilePath);
        } catch (unlinkErr) {
          console.error('Error removing temp upload file:', unlinkErr);
        }
      }

      // Clean up previous homepage image file if stored locally in /uploads/
      if (existingData.imageUrl && existingData.imageUrl.startsWith('/uploads/')) {
        const prevFilename = path.basename(existingData.imageUrl);
        const prevFilePath = path.join(uploadsDir, prevFilename);
        if (fs.existsSync(prevFilePath) && prevFilePath !== outputFilePath) {
          try {
            fs.unlinkSync(prevFilePath);
          } catch (delErr) {
            console.error('Error deleting previous homepage image file:', delErr);
          }
        }
      }

      updatedImageUrl = `/uploads/${outputFilename}`;
    }

    if (!updatedImageUrl || typeof updatedImageUrl !== 'string' || !updatedImageUrl.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Image is required. Upload a file using form-data field "image" or provide an "imageUrl" string.'
      });
    }

    const cleanUrl = updatedImageUrl.trim();
    if (!cleanUrl.startsWith('/uploads/')) {
      try {
        new URL(cleanUrl);
      } catch (urlErr) {
        return res.status(400).json({
          success: false,
          error: 'imageUrl must be a valid HTTP/HTTPS URL or an uploaded file path (/uploads/...)'
        });
      }
    }

    const newHomepageData = {
      imageUrl: cleanUrl,
      width,
      height,
      mimeType,
      size,
      updatedAt: new Date().toISOString()
    };

    saveHomepageData(newHomepageData);

    return res.status(200).json({
      success: true,
      message: 'Homepage image updated successfully',
      data: newHomepageData
    });
  } catch (error) {
    console.error('Error updating homepage image:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to process and update homepage image: ' + error.message
    });
  }
};
