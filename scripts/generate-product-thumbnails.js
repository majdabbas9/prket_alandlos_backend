/**
 * One-off backfill: gives every product that has no thumbKey the same resized WebP variants
 * new uploads get (large + thumbnail), and points the product at them.
 *
 *   node scripts/generate-product-thumbnails.js           # dry run, changes nothing
 *   node scripts/generate-product-thumbnails.js --apply   # uploads variants, rewrites products.json
 *
 * Uses the R2 credentials from .env - that is the production bucket. Original images are left
 * in R2 (their keys are printed) so nothing a running client still references disappears.
 * Afterwards the `products` cache key is refreshed if the cache is reachable (CACHE_URL or REDIS_URL).
 */
require('dotenv').config();
const R2 = require('../src/cloudManager/R2');
const Product = require('../src/models/Product');
const cacheManager = require('../src/utils/cacheManager');

const PRODUCTS_KEY = 'products/products.json';
const apply = process.argv.includes('--apply');

const readBody = async (key) => {
  const response = await R2.getObject(key);
  const chunks = [];
  for await (const chunk of response.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
};

const readProducts = async () => JSON.parse((await readBody(PRODUCTS_KEY)).toString('utf8'));

async function main() {
  const products = await readProducts();
  const todo = products.filter((p) => p.imageKey && !p.thumbKey);
  console.log(`${products.length} products, ${todo.length} without a thumbnail`);
  if (!apply) {
    todo.forEach((p) => console.log(`  would process ${p.id} (${p.imageKey})`));
    console.log('Dry run - pass --apply to upload variants and update products.json');
    return;
  }

  // id -> { from, imageKey, thumbKey }
  const done = new Map();
  for (const product of todo) {
    try {
      const original = await readBody(product.imageKey);
      const variants = await Product.resizeImage(original);
      const baseName = `img-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const imageKey = `products/${baseName}.webp`;
      const thumbKey = `products/${baseName}-thumb.webp`;
      const cache = Product.IMMUTABLE_CACHE_CONTROL;
      await R2.putObject(imageKey, variants.large, 'image/webp', undefined, cache);
      await R2.putObject(thumbKey, variants.thumb, 'image/webp', undefined, cache);
      done.set(product.id, { from: product.imageKey, imageKey, thumbKey });
      console.log(
        `  ${product.id}: ${original.length} B -> large ${variants.large.length} B, thumb ${variants.thumb.length} B`,
      );
    } catch (err) {
      console.error(`  ${product.id}: skipped (${err.message})`);
    }
  }
  if (done.size === 0) return;

  // Re-read right before writing so edits made while resizing are kept; a product whose
  // image changed meanwhile keeps its new image.
  const latest = await readProducts();
  let updated = 0;
  for (const product of latest) {
    const result = done.get(product.id);
    if (result && product.imageKey === result.from && !product.thumbKey) {
      product.imageKey = result.imageKey;
      product.thumbKey = result.thumbKey;
      updated++;
    }
  }
  await R2.putObject(
    PRODUCTS_KEY,
    Buffer.from(JSON.stringify(latest, null, 2), 'utf8'),
    'application/json',
  );
  console.log(`Updated ${updated} products in ${PRODUCTS_KEY}`);
  console.log('Previous originals left in R2:');
  done.forEach(({ from }) => console.log(`  ${from}`));

  try {
    // node-redis retries a failed connect forever, so give up after a few seconds
    await Promise.race([
      cacheManager.init(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), 5000)),
    ]);
    await cacheManager.set(cacheManager.KEYS.PRODUCTS, latest);
    console.log('Refreshed products cache');
    await cacheManager.close();
  } catch (err) {
    console.warn(
      `Could not refresh the cache (${err.message}) - delete its "products" key or restart Redis`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
