const { createClient } = require('redis');
const logger = require('./logger').getLogger(__filename);

const KEYS = {
  HOMEPAGE_IMAGE: 'homepage_image',
  LOGO_IMAGE: 'logo_image',
  STORE_INFO: 'store_info',
  PRODUCTS: 'products'
};

let redisClient;

/**
 * Initializes the Redis client connection.
 */
async function init() {
  redisClient = createClient({
    url: process.env.REDIS_URL
  });

  redisClient.on('error', (err) => logger.error({ err }, 'Redis Client Error'));
  redisClient.on('connect', () => logger.info('Redis Client Connected'));

  await redisClient.connect();
}

/**
 * Gets cached data for a specific key.
 * @param {string} key
 * @returns {Promise<any|null>}
 */
async function get(key) {
  if (!key || !redisClient) return null;
  try {
    const value = await redisClient.get(key);
    if (value) {
      logger.info({ cacheKey: key, hit: true }, `Cache hit for key '${key}'`);
      return JSON.parse(value, (k, v) => {
        if (v !== null && typeof v === 'object' && v.type === 'Buffer' && Array.isArray(v.data)) {
          return Buffer.from(v.data);
        }
        return v;
      });
    } else {
      logger.info({ cacheKey: key, hit: false }, `Cache miss for key '${key}'`);
      return null;
    }
  } catch (err) {
    logger.error({ err, cacheKey: key }, `Error getting cache key '${key}'`);
    return null;
  }
}

/**
 * Sets cached data for a specific key.
 * @param {string} key
 * @param {any} value
 */
async function set(key, value) {
  if (!key || !redisClient) return;
  try {
    const strValue = JSON.stringify(value);
    await redisClient.set(key, strValue);
    logger.info({ cacheKey: key }, `Set cache entry for key '${key}'`);
  } catch (err) {
    logger.error({ err, cacheKey: key }, `Error setting cache key '${key}'`);
  }
}

/**
 * Deletes a specific key or clears all cache if no key is provided.
 * @param {string} [key]
 */
async function clear(key) {
  if (!redisClient) return;
  try {
    if (key) {
      await redisClient.del(key);
      logger.info({ cacheKey: key }, `Cleared cache key '${key}'`);
    } else {
      await redisClient.flushAll();
      logger.info('Cleared entire Redis cache');
    }
  } catch (err) {
    logger.error({ err, cacheKey: key }, `Error clearing cache key '${key}' or all cache`);
  }
}

/**
 * Checks if a key exists in cache.
 * @param {string} key
 * @returns {Promise<boolean>}
 */
async function has(key) {
  if (!key || !redisClient) return false;
  try {
    const exists = await redisClient.exists(key);
    const result = exists === 1;
    logger.info({ cacheKey: key, exists: result }, `Checked cache existence for key '${key}'`);
    return result;
  } catch (err) {
    logger.error({ err, cacheKey: key }, `Error checking existence of cache key '${key}'`);
    return false;
  }
}

/**
 * Returns the client for testing or advanced usage
 */
function getClient() {
  return redisClient;
}

module.exports = {
  KEYS,
  init,
  get,
  set,
  clear,
  has,
  getClient
};
