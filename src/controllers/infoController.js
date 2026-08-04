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
        location: "Amman, Jordan",
        description: "Premium wood flooring, crafted with patience. Sustainably sourced hardwoods finished by hand for floors that last generations.",
        showroomEyebrow: "Visit Our Showroom",
        showroomTitle: "Come feel the grain for yourself",
        showroomDescription: "Our showroom is a tactile library of every finish and pattern we craft. Walk on the floors, talk to our makers, and find the one that feels like home.",
        stats: [
          { value: "30+", label: "Years of Craft" },
          { value: "1,200", label: "Floors Installed" },
          { value: "9", label: "Wood Collections" },
          { value: "4.9", label: "Average Rating" }
        ]
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
      location: "Amman, Jordan",
      description: "Premium wood flooring, crafted with patience. Sustainably sourced hardwoods finished by hand for floors that last generations.",
      showroomEyebrow: "Visit Our Showroom",
      showroomTitle: "Come feel the grain for yourself",
      showroomDescription: "Our showroom is a tactile library of every finish and pattern we craft. Walk on the floors, talk to our makers, and find the one that feels like home.",
      stats: [
        { value: "30+", label: "Years of Craft" },
        { value: "1,200", label: "Floors Installed" },
        { value: "9", label: "Wood Collections" },
        { value: "4.9", label: "Average Rating" }
      ]
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
    const { showPrice, storeOpeningTime, email, phone, whatsappLink, location, stats, description, showroomEyebrow, showroomTitle, showroomDescription } = req.body;

    // Update with new values if provided, or retain current ones
    const updatedData = {
      showPrice: typeof showPrice === 'boolean' ? showPrice : (showPrice === 'true' ? true : (showPrice === 'false' ? false : currentData.showPrice)),
      storeOpeningTime: storeOpeningTime !== undefined ? String(storeOpeningTime) : currentData.storeOpeningTime,
      email: email !== undefined ? String(email) : currentData.email,
      phone: phone !== undefined ? String(phone) : currentData.phone,
      whatsappLink: whatsappLink !== undefined ? String(whatsappLink) : currentData.whatsappLink,
      location: location !== undefined ? String(location) : currentData.location,
      description: description !== undefined ? String(description) : currentData.description,
      showroomEyebrow: showroomEyebrow !== undefined ? String(showroomEyebrow) : currentData.showroomEyebrow,
      showroomTitle: showroomTitle !== undefined ? String(showroomTitle) : currentData.showroomTitle,
      showroomDescription: showroomDescription !== undefined ? String(showroomDescription) : currentData.showroomDescription,
      stats: stats !== undefined ? stats : currentData.stats
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
