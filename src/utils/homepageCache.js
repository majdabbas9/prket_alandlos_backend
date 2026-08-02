let cache = null; // Should be an object like: { buffer: Buffer, contentType: string }

/**
 * Gets the cached homepage image data.
 * @returns {{buffer: Buffer, contentType: string}|null}
 */
function get() {
  return cache;
}

/**
 * Sets the cached homepage image data.
 * @param {Buffer} buffer 
 * @param {string} contentType 
 */
function set(buffer, contentType) {
  cache = { buffer, contentType };
}

/**
 * Clears the cache.
 */
function clear() {
  cache = null;
}

module.exports = {
  get,
  set,
  clear
};
