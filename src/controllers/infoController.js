const logger = require('../utils/logger').getLogger(__filename);
const Info = require('../models/Info');
const R2 = require('../cloudManager/R2');
const cacheManager = require('../utils/cacheManager');
const { LANGUAGES, SUPPORTED_LANGS, isSupportedLang } = require('../utils/languages');

const BUCKET_NAME = process.env.R2_INFO_BUCKET_NAME || process.env.R2_BUCKET_NAME || 'prket-andlos';

// Fields shared across all languages: a change to any of them propagates to every language
const SHARED_FIELDS = ['showPrice', 'email', 'phone', 'whatsappLink'];

// Helper to save info metadata to R2 and update in-memory cache
const saveInfoData = async (infoInstance, lang = 'en') => {
  try {
    const entry = LANGUAGES[lang];
    const dataToSave = infoInstance instanceof Info ? infoInstance.toJSON() : infoInstance;
    const jsonString = JSON.stringify(dataToSave, null, 2);
    const buffer = Buffer.from(jsonString, 'utf8');

    logger.info({ bucket: BUCKET_NAME, key: entry.r2Key, sizeBytes: buffer.length }, 'Pushing store info data to R2');
    await R2.putObject(entry.r2Key, buffer, 'application/json', BUCKET_NAME);
    logger.info({ bucket: BUCKET_NAME, key: entry.r2Key }, 'Successfully pushed info data to R2');

    const infoObj = infoInstance instanceof Info ? infoInstance : new entry.InfoClass(infoInstance);
    await cacheManager.set(entry.cacheKey, infoObj);
    return true;
  } catch (error) {
    logger.error({ err: error, bucket: BUCKET_NAME }, 'Error pushing info data to R2');
    return false;
  }
};

// Helper to read info metadata from R2 (checks cache first; if miss, checks if key exists in R2 or creates standard defaults)
const readInfoData = async (lang = 'en') => {
  try {
    const entry = LANGUAGES[lang];
    const cached = await cacheManager.get(entry.cacheKey);
    if (cached) {
      logger.info({ lang }, 'Serving store info from cache');
      return new entry.InfoClass(cached);
    }

    if (!(await R2.ObjectExists(entry.r2Key, BUCKET_NAME))) {
      logger.info({ bucket: BUCKET_NAME, key: entry.r2Key }, 'info key not found creating a new default one');
      const defaultInfo = new entry.InfoClass();
      await saveInfoData(defaultInfo, lang);
      return defaultInfo;
    }
    const response = await R2.getObject(entry.r2Key, BUCKET_NAME);
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    const content = Buffer.concat(chunks).toString('utf8');
    logger.info({ bucket: BUCKET_NAME, key: entry.r2Key, sizeBytes: content.length }, 'Successfully retrieved info data from R2');

    const infoObj = entry.InfoClass.fromJSON(content);
    await cacheManager.set(entry.cacheKey, infoObj);
    return infoObj;
  } catch (error) {
    logger.error({ err: error }, 'Error reading store info data');
    throw error;
  }
};

// Helper to propagate shared-field changes from the updated doc to all other languages (best-effort)
const propagateSharedFields = async (updatedInfo, updateData, targetLang) => {
  const data = updateData || {};
  const sharedUpdates = {};
  for (const field of SHARED_FIELDS) {
    if (data[field] !== undefined) {
      sharedUpdates[field] = updatedInfo[field];
    }
  }
  if (Object.keys(sharedUpdates).length === 0) return;

  for (const lang of SUPPORTED_LANGS) {
    if (lang === targetLang) continue;
    try {
      const info = await readInfoData(lang);
      info.update(sharedUpdates);
      await saveInfoData(info, lang);
      logger.info({ lang, sharedUpdates }, 'Propagated shared fields to language');
    } catch (error) {
      logger.error({ err: error, lang, sharedUpdates }, 'Failed to propagate shared fields to language');
    }
  }
};

// GET /api/info
exports.getInfo = async (req, res) => {
  logger.info({ lang: req.lang }, 'GET /api/info - Fetching store information');
  if (!isSupportedLang(req.lang)) {
    return res.status(400).json({
      success: false,
      error: `Unsupported language "${req.lang}". Supported: ${SUPPORTED_LANGS.join(', ')}`
    });
  }
  const infoObj = await readInfoData(req.lang);
  return res.status(200).json({
    success: true,
    data: infoObj.toJSON()
  });
};

// POST /api/info
exports.updateInfo = async (req, res) => {
  logger.info({ lang: req.lang, body: req.body }, 'POST /api/info - Updating store information');
  try {
    if (!isSupportedLang(req.lang)) {
      return res.status(400).json({
        success: false,
        error: `Unsupported language "${req.lang}". Supported: ${SUPPORTED_LANGS.join(', ')}`
      });
    }
    const currentInfo = await readInfoData(req.lang);
    currentInfo.update(req.body);

    const saved = await saveInfoData(currentInfo, req.lang);
    if (!saved) {
      logger.warn('Failed to save updated store info to R2');
      return res.status(500).json({
        success: false,
        error: 'Failed to write updated info data'
      });
    }

    await propagateSharedFields(currentInfo, req.body, req.lang);

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
