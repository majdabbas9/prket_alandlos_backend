const { createClient } = require('redis');
const logger = require('./logger').getLogger(__filename);

// Images are not cached here - they stream straight from R2 (see utils/sendImage.js)
const KEYS = {
  STORE_INFO: 'store_info',
  STORE_INFO_AR: 'store_info_ar',
  STORE_INFO_HE: 'store_info_he',
  PRODUCTS: 'products',
};

// Every cache call falls back to R2 on failure, so a slow cache must not hold requests up
const KV_TIMEOUT_MS = 5000;

/**
 * Cloudflare Workers KV over HTTP (CACHE_URL). On Cloudflare Containers, the API Worker
 * intercepts requests to CACHE_URL and serves them from its KV binding:
 *   GET /<key> -> 200 value | 404, HEAD /<key> -> 200 | 404, PUT /<key>, DELETE /<key>, DELETE /
 */
function kvDriver(baseUrl) {
  const call = async (method, key = '', body) => {
    const res = await fetch(`${baseUrl}/${encodeURIComponent(key)}`, {
      method,
      body,
      signal: AbortSignal.timeout(KV_TIMEOUT_MS),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Cache ${method} /${key} failed: HTTP ${res.status}`);
    return res;
  };
  return {
    name: 'kv',
    connect: async () => {
      await call('HEAD', KEYS.PRODUCTS);
    },
    get: async (key) => {
      const res = await call('GET', key);
      return res ? res.text() : null;
    },
    set: async (key, value) => {
      await call('PUT', key, value);
    },
    del: async (key) => {
      await call('DELETE', key);
    },
    flushAll: async () => {
      await call('DELETE');
    },
    exists: async (key) => ((await call('HEAD', key)) ? 1 : 0),
    quit: async () => {},
  };
}

function redisDriver(url) {
  const client = createClient({
    url,
    // Fail commands immediately while Redis is down instead of queueing them
    // until a reconnect - callers fall back to R2, so a dead cache only costs speed.
    disableOfflineQueue: true,
  });
  client.on('error', (err) => logger.error({ err }, 'Redis Client Error'));
  client.on('connect', () => logger.info('Redis Client Connected'));
  return {
    name: 'redis',
    connect: () => client.connect(),
    get: (key) => client.get(key),
    set: (key, value) => client.set(key, value),
    del: (key) => client.del(key),
    flushAll: () => client.flushAll(),
    exists: (key) => client.exists(key),
    quit: () => client.quit(),
  };
}

let driver;

/**
 * Connects the cache: Workers KV when CACHE_URL is set (Cloudflare), otherwise Redis at REDIS_URL.
 */
async function init() {
  const cacheUrl = process.env.CACHE_URL?.replace(/\/+$/, '');
  const candidate = cacheUrl ? kvDriver(cacheUrl) : redisDriver(process.env.REDIS_URL);
  await candidate.connect();
  driver = candidate;
  logger.info({ driver: driver.name }, `Cache connected (${driver.name})`);
}

/**
 * Gets cached data for a specific key.
 * @param {string} key
 * @returns {Promise<any|null>}
 */
async function get(key) {
  if (!key || !driver) return null;
  try {
    const value = await driver.get(key);
    if (value) {
      logger.info({ cacheKey: key, hit: true }, `Cache hit for key '${key}'`);
      return JSON.parse(value);
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
  if (!key || !driver) return;
  try {
    const strValue = JSON.stringify(value);
    await driver.set(key, strValue);
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
  if (!driver) return;
  try {
    if (key) {
      await driver.del(key);
      logger.info({ cacheKey: key }, `Cleared cache key '${key}'`);
    } else {
      await driver.flushAll();
      logger.info('Cleared entire cache');
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
  if (!key || !driver) return false;
  try {
    const exists = await driver.exists(key);
    const result = exists === 1;
    logger.info({ cacheKey: key, exists: result }, `Checked cache existence for key '${key}'`);
    return result;
  } catch (err) {
    logger.error({ err, cacheKey: key }, `Error checking existence of cache key '${key}'`);
    return false;
  }
}

/**
 * Closes the cache connection (scripts; the server keeps it open).
 */
async function close() {
  if (!driver) return;
  await driver.quit();
  driver = undefined;
}

module.exports = {
  KEYS,
  init,
  get,
  set,
  clear,
  has,
  close,
};
