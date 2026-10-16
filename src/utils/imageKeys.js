// Product images live in R2 under products/ as single-level raster files. Keys from clients are
// checked against this before they are read, stored on a product, or later deleted with it, so a
// request can't point at products.json, info/, logo/ or any other object in the bucket.
const PRODUCT_IMAGE_KEY = /^products\/[A-Za-z0-9][A-Za-z0-9._-]*\.(webp|jpe?g|png|gif|avif)$/i;

const isProductImageKey = (key) =>
  typeof key === 'string' && PRODUCT_IMAGE_KEY.test(key) && !key.includes('..');

module.exports = { isProductImageKey };
