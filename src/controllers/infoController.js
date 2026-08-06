const logger = require('../utils/logger');
const Info = require('../models/Info');
const R2 = require('../cloudManager/R2');

const BUCKET_NAME = process.env.R2_INFO_BUCKET_NAME || process.env.R2_BUCKET_NAME || 'prket-andlos';
const INFO_KEY = 'info/info.json';

// Helper to save info metadata to R2
const saveInfoData = async (infoInstance) => {
  try {
    const dataToSave = infoInstance instanceof Info ? infoInstance.toJSON() : infoInstance;
    const jsonString = JSON.stringify(dataToSave, null, 2);
    const buffer = Buffer.from(jsonString, 'utf8');

    await R2.putObject(INFO_KEY, buffer, 'application/json', BUCKET_NAME);
    logger.info({ bucket: BUCKET_NAME, key: INFO_KEY }, 'Successfully pushed info data to R2');
    return true;
  } catch (error) {
    logger.error({ err: error }, 'Error pushing info data to R2');
    return false;
  }
};

// Helper to read info metadata from R2 (checks if key exists; if not, creates key & pushes default data)
const readInfoData = async () => {
  try {
    if (!(await R2.ObjectExists(INFO_KEY, BUCKET_NAME))) {
      logger.info('info key not found creating a new one')
      await saveInfoData(new Info());
    }
    const response = await R2.getObject(INFO_KEY, BUCKET_NAME);
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    const content = Buffer.concat(chunks).toString('utf8');
    logger.info({ bucket: BUCKET_NAME, key: INFO_KEY }, 'Successfully retrieved info data from R2');
    return Info.fromJSON(content);
  } catch (error) {
    logger.error(error);
    throw error;
  }
};

// GET /api/info
exports.getInfo = async (req, res) => {
  logger.info('GET /api/info - Fetching store information');
  const infoObj = await readInfoData();
  return res.status(200).json({
    success: true,
    data: infoObj.toJSON()
  });
};

// POST /api/info
exports.updateInfo = async (req, res) => {
  logger.info({ body: req.body }, 'POST /api/info - Updating store information');
  try {
    const currentInfo = await readInfoData();
    currentInfo.update(req.body);

    const saved = await saveInfoData(currentInfo);
    if (!saved) {
      logger.warn('Failed to save updated store info to R2');
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
