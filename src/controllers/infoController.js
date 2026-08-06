const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const Info = require('../models/Info');

const dataFilePath = path.join(__dirname, '../data/info.json');

// Helper to read info metadata
const readInfoData = () => {
  try {
    if (!fs.existsSync(dataFilePath)) {
      logger.info('info.json file not found, returning default Store Info instance');
      return new Info();
    }
    const content = fs.readFileSync(dataFilePath, 'utf8');
    return Info.fromJSON(content);
  } catch (error) {
    logger.error({ err: error }, 'Error reading info.json file');
    return new Info();
  }
};

// Helper to save info metadata
const saveInfoData = (infoInstance) => {
  try {
    const dirPath = path.dirname(dataFilePath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    const dataToSave = infoInstance instanceof Info ? infoInstance.toJSON() : infoInstance;
    fs.writeFileSync(dataFilePath, JSON.stringify(dataToSave, null, 2), 'utf8');
    logger.info('Successfully saved store info data to info.json');
    return true;
  } catch (error) {
    logger.error({ err: error }, 'Error writing info.json file');
    return false;
  }
};

// GET /api/info
exports.getInfo = (req, res) => {
  logger.info('GET /api/info - Fetching store information');
  const infoObj = readInfoData();
  return res.status(200).json({
    success: true,
    data: infoObj.toJSON()
  });
};

// POST /api/info
exports.updateInfo = (req, res) => {
  logger.info({ body: req.body }, 'POST /api/info - Updating store information');
  try {
    const currentInfo = readInfoData();
    currentInfo.update(req.body);

    const saved = saveInfoData(currentInfo);
    if (!saved) {
      logger.warn('Failed to save updated store info to info.json');
      return res.status(500).json({
        success: false,
        error: 'Failed to write updated info data'
      });
    }

    logger.info('POST /api/info - Store information updated successfully');
    return res.status(200).json({
      success: true,
      message: 'Store information updated successfully',
      data: currentInfo.toJSON()
    });
  } catch (error) {
    logger.error({ err: error }, 'Error updating store information');
    return res.status(500).json({
      success: false,
      error: 'Failed to update store information: ' + error.message
    });
  }
};


