// cacheManager's Workers KV driver (CACHE_URL), against an in-memory fake of the Worker's
// cache.internal handler. The Redis driver is covered by running the server locally.
const cacheManager = require('../src/utils/cacheManager');

const store = new Map();
const calls = [];

function fakeWorker(url, { method, body }) {
  const key = decodeURIComponent(new URL(url).pathname.slice(1));
  calls.push(`${method} /${key}`);
  const respond = (status, text = null) => Promise.resolve(new Response(text, { status }));
  if (method === 'GET') return store.has(key) ? respond(200, store.get(key)) : respond(404);
  if (method === 'HEAD') return respond(store.has(key) ? 200 : 404);
  if (method === 'PUT') return (store.set(key, body), respond(204));
  if (method === 'DELETE') return (key ? store.delete(key) : store.clear(), respond(204));
  return respond(405);
}

describe('cacheManager (Workers KV driver)', () => {
  beforeAll(async () => {
    process.env.CACHE_URL = 'http://cache.internal/';
    global.fetch = jest.fn(fakeWorker);
    await cacheManager.init();
  });

  afterAll(async () => {
    await cacheManager.close();
    delete process.env.CACHE_URL;
  });

  beforeEach(() => {
    store.clear();
    calls.length = 0;
  });

  test('init checks the cache is reachable, without the trailing slash', () => {
    expect(global.fetch).toHaveBeenCalledWith('http://cache.internal/products', expect.anything());
  });

  test('round-trips JSON values', async () => {
    expect(await cacheManager.get(cacheManager.KEYS.PRODUCTS)).toBeNull();
    await cacheManager.set(cacheManager.KEYS.PRODUCTS, [{ id: 'p1' }]);
    expect(store.get('products')).toBe('[{"id":"p1"}]');
    expect(await cacheManager.get(cacheManager.KEYS.PRODUCTS)).toEqual([{ id: 'p1' }]);
    expect(await cacheManager.has(cacheManager.KEYS.PRODUCTS)).toBe(true);
  });

  test('clears one key or everything', async () => {
    await cacheManager.set('store_info', { lang: 'en' });
    await cacheManager.set('products', []);
    await cacheManager.clear('store_info');
    expect(await cacheManager.has('store_info')).toBe(false);
    expect(await cacheManager.has('products')).toBe(true);
    await cacheManager.clear();
    expect(store.size).toBe(0);
    expect(calls).toContain('DELETE /');
  });

  test('a failing cache reads as a miss and never throws', async () => {
    global.fetch.mockImplementationOnce(() => Promise.resolve(new Response(null, { status: 500 })));
    expect(await cacheManager.get('products')).toBeNull();
    global.fetch.mockImplementationOnce(() => Promise.reject(new Error('timeout')));
    await expect(cacheManager.set('products', [])).resolves.toBeUndefined();
  });
});
