const R2 = require('../cloudManager/R2');
const Homepage = require('../models/Homepage');
const Logo = require('../models/Logo');
const { LANGUAGES } = require('./languages');
const logger = require('./logger').getLogger(__filename);

const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'prket-andlos';
const INFO_BUCKET_NAME = process.env.R2_INFO_BUCKET_NAME || BUCKET_NAME;

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

const json = (value) => ({
  body: Buffer.from(JSON.stringify(value, null, 2), 'utf8'),
  contentType: 'application/json',
});

const image = async (generate) => {
  const img = await generate();
  return { body: img.buffer, contentType: img.mimeType };
};

/**
 * Every R2 object the API expects to exist, with a builder for its default content.
 * Builders only run when the object is missing (images are downloaded/generated).
 */
const DEFAULTS = [
  { key: 'products/products.json', bucket: BUCKET_NAME, build: async () => json([]) },
  ...Object.values(LANGUAGES).map((entry) => ({
    key: entry.r2Key,
    bucket: INFO_BUCKET_NAME,
    build: async () => json(new entry.InfoClass().toJSON()),
  })),
  {
    key: 'homePage/homepageImage',
    bucket: BUCKET_NAME,
    build: () => image(() => Homepage.downloadOrGenerateParketImage()),
  },
  {
    key: 'logo/logoImage',
    bucket: BUCKET_NAME,
    build: () => image(() => Logo.downloadOrGenerateParketLogoImage()),
  },
];

/**
 * Creates `key` with its default content if (and only if) R2 reports it missing.
 * Any other R2 error is thrown, so a flaky R2 can never cause real data to be replaced.
 */
async function ensureObject({ key, bucket, build }) {
  try {
    await R2.headObject(key, bucket);
    return 'exists';
  } catch (err) {
    if (!R2.isNotFound(err)) throw err;
  }

  logger.info({ key }, 'R2 object missing at startup, creating default');
  const { body, contentType } = await build();
  // Conditional write: if another instance created it meanwhile, theirs is kept
  const created = await R2.putObjectIfAbsent(key, body, contentType, bucket);
  return created ? 'created' : 'exists';
}

async function ensureObjectWithRetry(item, delayMs) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await ensureObject(item);
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS) throw err;
      logger.warn({ err, key: item.key, attempt }, 'Failed to ensure R2 object, retrying');
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
}

/**
 * Makes sure every object the API reads exists in R2, creating defaults for missing ones.
 * Runs once at startup so request handlers never have to check existence or write on GET.
 * @param {{retryDelayMs?: number}} [options]
 * @returns {Promise<Object<string, 'exists'|'created'>>} status per key
 * @throws if any object could not be verified/created after retries
 */
async function ensureDefaults({ retryDelayMs = RETRY_DELAY_MS } = {}) {
  // allSettled so every key finishes its retries and all failures get logged
  const results = await Promise.allSettled(
    DEFAULTS.map((item) => ensureObjectWithRetry(item, retryDelayMs)),
  );
  const failed = results
    .map((r, i) => ({ key: DEFAULTS[i].key, result: r }))
    .filter(({ result }) => result.status === 'rejected');
  for (const { key, result } of failed) {
    logger.error({ err: result.reason, key }, 'Could not verify R2 object at startup');
  }
  if (failed.length) throw failed[0].result.reason;

  const status = Object.fromEntries(results.map((r, i) => [DEFAULTS[i].key, r.value]));
  logger.info({ status }, 'R2 defaults verified');
  return status;
}

module.exports = { ensureDefaults, DEFAULTS };
