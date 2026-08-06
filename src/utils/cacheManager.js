const logger = require('./logger').getLogger(__filename);

const cache = new Map();

const KEYS = {
  HOMEPAGE_IMAGE: 'homepage_image',
  LOGO_IMAGE: 'logo_image',
  STORE_INFO: 'store_info',
  PRODUCTS: 'products'
};

/**
 * Gets cached data for a specific key.
 * @param {string} key
 * @returns {any|null}
 */
function get(key) {
  if (!key) return null;
  const value = cache.get(key) || null;
  if (value) {
    logger.info({ cacheKey: key, hit: true }, `Cache hit for key '${key}'`);
  } else {
    logger.info({ cacheKey: key, hit: false }, `Cache miss for key '${key}'`);
  }
  return value;
}

/**
 * Sets cached data for a specific key.
 * @param {string} key
 * @param {any} value
 */
function set(key, value) {
  if (!key) return;
  cache.set(key, value);
  logger.info({ cacheKey: key }, `Set cache entry for key '${key}'`);
}

/**
 * Deletes a specific key or clears all cache if no key is provided.
 * @param {string} [key]
 */
function clear(key) {
  if (key) {
    cache.delete(key);
    logger.info({ cacheKey: key }, `Cleared cache key '${key}'`);
  } else {
    cache.clear();
    logger.info('Cleared entire in-memory cache');
  }
}

/**
 * Checks if a key exists in cache.
 * @param {string} key
 * @returns {boolean}
 */
function has(key) {
  if (!key) return false;
  const exists = cache.has(key);
  logger.info({ cacheKey: key, exists }, `Checked cache existence for key '${key}'`);
  return exists;
}

module.exports = {
  KEYS,
  get,
  set,
  clear,
  has
};

