const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const dataFilePath = path.join(__dirname, '../data/info.json');

// Helper to read info metadata
const readInfoData = () => {
  try {
    if (!fs.existsSync(dataFilePath)) {
      return {
        showPrice: true,
        storeOpeningTime: "9:00 AM - 10:00 PM",
        email: "info@prketalandlos.com",
        phone: "+962790000000",
        whatsappLink: "https://wa.me/962790000000",
        location: "Amman, Jordan"
      };
    }
    const content = fs.readFileSync(dataFilePath, 'utf8');
    return JSON.parse(content || '{}');
  } catch (error) {
    logger.error({ err: error }, 'Error reading info.json');
    return {
      showPrice: true,
      storeOpeningTime: "9:00 AM - 10:00 PM",
      email: "info@prketalandlos.com",
      phone: "+962790000000",
      whatsappLink: "https://wa.me/962790000000",
      location: "Amman, Jordan"
    };
  }
};

// Helper to save info metadata
const saveInfoData = (data) => {
  try {
    const dirPath = path.dirname(dataFilePath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    logger.error({ err: error }, 'Error writing info.json');
    return false;
  }
};

// GET /api/info
exports.getInfo = (req, res) => {
  const data = readInfoData();
  return res.status(200).json({
    success: true,
    data
  });
};

// POST /api/info
exports.updateInfo = (req, res) => {
  try {
    const currentData = readInfoData();
    const { showPrice, storeOpeningTime, email, phone, whatsappLink, location } = req.body;

    // Update with new values if provided, or retain current ones
    const updatedData = {
      showPrice: typeof showPrice === 'boolean' ? showPrice : (showPrice === 'true' ? true : (showPrice === 'false' ? false : currentData.showPrice)),
      storeOpeningTime: storeOpeningTime !== undefined ? String(storeOpeningTime) : currentData.storeOpeningTime,
      email: email !== undefined ? String(email) : currentData.email,
      phone: phone !== undefined ? String(phone) : currentData.phone,
      whatsappLink: whatsappLink !== undefined ? String(whatsappLink) : currentData.whatsappLink,
      location: location !== undefined ? String(location) : currentData.location
    };

    const saved = saveInfoData(updatedData);
    if (!saved) {
      return res.status(500).json({
        success: false,
        error: 'Failed to write updated info data'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Store information updated successfully',
      data: updatedData
    });
  } catch (error) {
    logger.error({ err: error }, 'Error updating info');
    return res.status(500).json({
      success: false,
      error: 'Failed to update store information: ' + error.message
    });
  }
};
