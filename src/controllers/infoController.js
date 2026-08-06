const logger = require('../utils/logger').getLogger(__filename);
const Info = require('../models/Info');
const R2 = require('../cloudManager/R2');
const cacheManager = require('../utils/cacheManager');

const BUCKET_NAME = process.env.R2_INFO_BUCKET_NAME || process.env.R2_BUCKET_NAME || 'prket-andlos';
const INFO_KEY = 'info/info.json';

// Helper to save info metadata to R2 and update in-memory cache
const saveInfoData = async (infoInstance) => {
  try {
    const dataToSave = infoInstance instanceof Info ? infoInstance.toJSON() : infoInstance;
    const jsonString = JSON.stringify(dataToSave, null, 2);
    const buffer = Buffer.from(jsonString, 'utf8');

    logger.info({ bucket: BUCKET_NAME, key: INFO_KEY, sizeBytes: buffer.length }, 'Pushing store info data to R2');
    await R2.putObject(INFO_KEY, buffer, 'application/json', BUCKET_NAME);
    logger.info({ bucket: BUCKET_NAME, key: INFO_KEY }, 'Successfully pushed info data to R2');

    const infoObj = infoInstance instanceof Info ? infoInstance : new Info(infoInstance);
    cacheManager.set(cacheManager.KEYS.STORE_INFO, infoObj);
    return true;
  } catch (error) {
    logger.error({ err: error, bucket: BUCKET_NAME, key: INFO_KEY }, 'Error pushing info data to R2');
    return false;
  }
};

// Helper to read info metadata from R2 (checks cache first; if miss, checks if key exists in R2 or creates standard defaults)
const readInfoData = async () => {
  try {
    const cached = cacheManager.get(cacheManager.KEYS.STORE_INFO);
    if (cached) {
      logger.info('Serving store info from cache');
      return cached;
    }

    if (!(await R2.ObjectExists(INFO_KEY, BUCKET_NAME))) {
      logger.info({ bucket: BUCKET_NAME, key: INFO_KEY }, 'info key not found creating a new default one');
      const defaultInfo = new Info();
      await saveInfoData(defaultInfo);
      return defaultInfo;
    }
    const response = await R2.getObject(INFO_KEY, BUCKET_NAME);
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    const content = Buffer.concat(chunks).toString('utf8');
    logger.info({ bucket: BUCKET_NAME, key: INFO_KEY, sizeBytes: content.length }, 'Successfully retrieved info data from R2');

    const infoObj = Info.fromJSON(content);
    cacheManager.set(cacheManager.KEYS.STORE_INFO, infoObj);
    return infoObj;
  } catch (error) {
    logger.error({ err: error }, 'Error reading store info data');
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

    logger.info({ data: currentInfo.toJSON() }, 'POST /api/info - Store information updated successfully');
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

