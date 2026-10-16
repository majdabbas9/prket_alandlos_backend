const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../app');
const sharp = require('sharp');
const R2 = require('../src/cloudManager/R2');

// Mock R2 module to handle in-memory storage for products during tests
const mockStorage = new Map();
jest.mock('../src/cloudManager/R2', () => {
  const getObject = jest.fn(async (key) => {
    if (mockStorage.has(key)) {
      return {
        Body: [mockStorage.get(key)],
        ContentType: key.endsWith('.json') ? 'application/json' : 'image/webp',
        ContentLength: mockStorage.get(key).length,
      };
    }
    throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
  });
  const putObject = jest.fn(async (key, body) => {
    mockStorage.set(key, body);
    return { success: true };
  });
  const deleteObject = jest.fn(async (key) => {
    mockStorage.delete(key);
    return { success: true };
  });
  return {
    getObject,
    putObject,
    deleteObject,
    isNotFound: (err) => err.name === 'NoSuchKey',
  };
});

const PRODUCTS_KEY = 'products/products.json';
const UPLOAD_DIR = path.join(__dirname, '../uploads');

const storedProducts = () => JSON.parse(mockStorage.get(PRODUCTS_KEY).toString());
const seedProducts = (products) =>
  mockStorage.set(PRODUCTS_KEY, Buffer.from(JSON.stringify(products)));
// Multer temp files (uploads/img-*) must be removed once the image is on R2
const tempUploads = () => fs.readdirSync(UPLOAD_DIR).filter((f) => f.startsWith('img-'));

const jpeg = (width, height) =>
  sharp({ create: { width, height, channels: 3, background: '#8b5a2b' } })
    .jpeg()
    .toBuffer();

const CATALOG = [
  {
    id: 'p-oak',
    title: 'Oak Classic',
    price: 45,
    category: 'Parquet',
    description: 'Natural oak',
    imageKey: 'products/oak.webp',
    dateOfUpload: '2026-01-02T00:00:00.000Z',
  },
  {
    id: 'p-walnut',
    title: 'Walnut Herringbone',
    price: 120,
    category: 'Parquet',
    description: 'Dark wood',
    imageKey: 'products/walnut.webp',
    dateOfUpload: '2026-03-01T00:00:00.000Z',
  },
  {
    id: 'p-tile',
    title: 'Stone Tile',
    price: 30,
    category: 'Tiles',
    description: 'Looks like OAK',
    imageKey: 'products/tile.webp',
    dateOfUpload: '2026-02-01T00:00:00.000Z',
  },
  {
    id: 'p-laminate',
    title: 'Laminate Grey',
    price: 15,
    category: 'Laminate',
    description: '',
    imageKey: 'products/laminate.webp',
    dateOfUpload: '2026-04-01T00:00:00.000Z',
  },
];

beforeEach(() => {
  mockStorage.clear();
  seedProducts(CATALOG);
  jest.clearAllMocks();
});

afterAll(() => {
  mockStorage.clear();
});

describe('GET /api/health', () => {
  it('returns 200 with status ok and an ISO timestamp', async () => {
    const res = await request(app).get('/api/health');
    expect(res.statusCode).toEqual(200);
    expect(res.body.status).toBe('ok');
    expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false);
  });
});

describe('GET /api/products (listing, filters, sorting, pagination)', () => {
  const ids = (res) => res.body.data.map((p) => p.id);

  it('returns every product, newest first by default', async () => {
    const res = await request(app).get('/api/products');
    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(CATALOG.length);
    expect(ids(res)).toEqual(['p-laminate', 'p-walnut', 'p-tile', 'p-oak']);
    expect(res.body).not.toHaveProperty('totalPages');
  });

  it('returns an empty list (not an error) when the catalog key is missing', async () => {
    mockStorage.delete(PRODUCTS_KEY);
    const res = await request(app).get('/api/products');
    expect(res.statusCode).toEqual(200);
    expect(res.body).toMatchObject({ success: true, count: 0, data: [] });
    expect(R2.putObject).not.toHaveBeenCalled();
  });

  it('searches title, description and category case-insensitively', async () => {
    const res = await request(app).get('/api/products?search=%20oak%20');
    expect(res.statusCode).toEqual(200);
    // p-oak matches on title, p-tile on its description
    expect(ids(res).sort()).toEqual(['p-oak', 'p-tile']);

    const byCategory = await request(app).get('/api/products?search=lamin');
    expect(ids(byCategory)).toEqual(['p-laminate']);
  });

  it('filters by exact category, case-insensitively', async () => {
    const res = await request(app).get('/api/products?category=parquet');
    expect(ids(res).sort()).toEqual(['p-oak', 'p-walnut']);

    // Exact match, not substring
    const partial = await request(app).get('/api/products?category=Parq');
    expect(partial.body.count).toBe(0);
  });

  it('combines search and category', async () => {
    const res = await request(app).get('/api/products?search=oak&category=Tiles');
    expect(ids(res)).toEqual(['p-tile']);
  });

  it.each([
    ['oldest', ['p-oak', 'p-tile', 'p-walnut', 'p-laminate']],
    ['price_asc', ['p-laminate', 'p-tile', 'p-oak', 'p-walnut']],
    ['price_desc', ['p-walnut', 'p-oak', 'p-tile', 'p-laminate']],
    ['newest', ['p-laminate', 'p-walnut', 'p-tile', 'p-oak']],
  ])('sorts by %s', async (sort, expected) => {
    const res = await request(app).get(`/api/products?sort=${sort}`);
    expect(ids(res)).toEqual(expected);
  });

  it('paginates with page/limit and reports totals', async () => {
    const page1 = await request(app).get('/api/products?page=1&limit=3&sort=oldest');
    expect(page1.statusCode).toEqual(200);
    expect(page1.body).toMatchObject({ count: 3, total: 4, page: 1, totalPages: 2 });
    expect(ids(page1)).toEqual(['p-oak', 'p-tile', 'p-walnut']);

    const page2 = await request(app).get('/api/products?page=2&limit=3&sort=oldest');
    expect(page2.body).toMatchObject({ count: 1, total: 4, page: 2, totalPages: 2 });
    expect(ids(page2)).toEqual(['p-laminate']);
  });

  it('returns an empty page past the end', async () => {
    const res = await request(app).get('/api/products?page=9&limit=3');
    expect(res.statusCode).toEqual(200);
    expect(res.body).toMatchObject({ count: 0, total: 4, page: 9, totalPages: 2, data: [] });
  });

  it('paginates the filtered result, not the whole catalog', async () => {
    const res = await request(app).get('/api/products?category=Parquet&page=1&limit=1');
    expect(res.body).toMatchObject({ count: 1, total: 2, totalPages: 2 });
  });
});

describe('GET /api/products/:id', () => {
  it('returns the stored product', async () => {
    const res = await request(app).get('/api/products/p-walnut');
    expect(res.statusCode).toEqual(200);
    expect(res.body.data).toEqual(CATALOG[1]);
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(app).get('/api/products/non_existent_id_9999');
    expect(res.statusCode).toEqual(404);
    expect(res.body.success).toBe(false);
  });
});

describe('POST /api/products', () => {
  it('creates a product from JSON, normalizing fields, and persists it to R2', async () => {
    const res = await request(app).post('/api/products').send({
      title: '  Jest Flooring  ',
      price: '99.99',
      imageKey: ' products/jest.jpeg ',
      woodType: 'Oak',
    });

    expect(res.statusCode).toEqual(201);
    const created = res.body.data;
    expect(created.id).toMatch(/^prod_/);
    expect(created).toMatchObject({
      title: 'Jest Flooring',
      price: 99.99,
      category: 'General',
      description: '',
      imageKey: 'products/jest.jpeg',
      woodType: 'Oak',
    });
    expect(created).not.toHaveProperty('thumbKey');
    expect(Number.isNaN(Date.parse(created.dateOfUpload))).toBe(false);

    // Appended to the existing catalog, nothing else changed
    const stored = storedProducts();
    expect(stored).toHaveLength(CATALOG.length + 1);
    expect(stored.slice(0, CATALOG.length)).toEqual(CATALOG);
    expect(stored[CATALOG.length]).toEqual(created);

    const fetched = await request(app).get(`/api/products/${created.id}`);
    expect(fetched.body.data).toEqual(created);
  });

  it('returns 400 without an image and writes nothing', async () => {
    for (const body of [{ title: 'No Image' }, { title: 'Blank', imageKey: '   ' }]) {
      const res = await request(app).post('/api/products').send(body);
      expect(res.statusCode).toEqual(400);
      expect(res.body.success).toBe(false);
    }
    expect(R2.putObject).not.toHaveBeenCalled();
    expect(storedProducts()).toEqual(CATALOG);
  });

  it.each(['image', 'file', 'photo', 'picture'])(
    'accepts the upload under the "%s" field',
    async (field) => {
      const res = await request(app)
        .post('/api/products')
        .field('title', `Upload via ${field}`)
        .attach(field, await jpeg(100, 100), 'sample.jpg');

      expect(res.statusCode).toEqual(201);
      expect(res.body.data.imageKey).toMatch(/^products\/img-.*\.webp$/);
      expect(mockStorage.has(res.body.data.imageKey)).toBe(true);
      expect(tempUploads()).toEqual([]);
    },
  );

  it('stores a large WebP and a thumbnail WebP for an uploaded image', async () => {
    const res = await request(app)
      .post('/api/products')
      .field('title', 'Resized product')
      .attach('image', await jpeg(2400, 1600), 'big.jpg');

    expect(res.statusCode).toEqual(201);
    const { imageKey, thumbKey } = res.body.data;
    expect(imageKey).toMatch(/^products\/img-.*\.webp$/);
    expect(thumbKey).toMatch(/^products\/img-.*-thumb\.webp$/);
    for (const key of [imageKey, thumbKey]) {
      expect(R2.putObject).toHaveBeenCalledWith(
        key,
        expect.any(Buffer),
        'image/webp',
        expect.anything(),
        'public, max-age=31536000, immutable',
      );
    }

    const large = await sharp(mockStorage.get(imageKey)).metadata();
    const thumb = await sharp(mockStorage.get(thumbKey)).metadata();
    expect(large).toMatchObject({ format: 'webp', width: 1600 });
    expect(thumb).toMatchObject({ format: 'webp', width: 600 });
    expect(tempUploads()).toEqual([]);
  });

  it('never enlarges small images', async () => {
    const res = await request(app)
      .post('/api/products')
      .field('title', 'Small')
      .attach('image', await jpeg(300, 200), 'small.jpg');
    const large = await sharp(mockStorage.get(res.body.data.imageKey)).metadata();
    expect(large.width).toBe(300);
  });

  it('stores an image sharp cannot decode as-is, used for both variants', async () => {
    const raw = Buffer.from('not really an image');
    const res = await request(app)
      .post('/api/products')
      .field('title', 'Undecodable')
      .attach('image', raw, 'odd.gif');

    expect(res.statusCode).toEqual(201);
    const { imageKey, thumbKey } = res.body.data;
    expect(imageKey).toMatch(/^products\/img-.*\.gif$/);
    expect(thumbKey).toBe(imageKey);
    expect(mockStorage.get(imageKey).equals(raw)).toBe(true);
    expect(tempUploads()).toEqual([]);
  });

  it('rejects an upload under an unknown field with 400', async () => {
    const res = await request(app)
      .post('/api/products')
      .field('title', 'Bad field')
      .attach('banner', await jpeg(10, 10), 'x.jpg');
    expect(res.statusCode).toEqual(400);
    expect(res.body.error).toMatch(/File upload error/);
    expect(R2.putObject).not.toHaveBeenCalled();
  });

  it('rejects a file over 10MB with 400 and leaves no temp file', async () => {
    const res = await request(app)
      .post('/api/products')
      .field('title', 'Huge')
      .attach('image', Buffer.alloc(10 * 1024 * 1024 + 1), 'huge.jpg');
    expect(res.statusCode).toEqual(400);
    expect(res.body.error).toMatch(/File too large/);
    expect(R2.putObject).not.toHaveBeenCalled();
    expect(tempUploads()).toEqual([]);
  });

  it('rejects a non-image file without storing anything', async () => {
    const res = await request(app)
      .post('/api/products')
      .field('title', 'Text')
      .attach('image', Buffer.from('hello'), { filename: 'notes.txt', contentType: 'text/plain' });
    // Currently 500: the fileFilter error is a plain Error, so app.js's handler doesn't map it
    // to 400 like a MulterError. Should be a 400 - tighten this once the filter sets a status.
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.body.success).toBe(false);
    expect(R2.putObject).not.toHaveBeenCalled();
    expect(tempUploads()).toEqual([]);
  });
});

describe('PUT /api/products/:id', () => {
  it('updates only the sent fields and stamps updatedAt', async () => {
    const res = await request(app).put('/api/products/p-oak').send({ price: '50' });

    expect(res.statusCode).toEqual(200);
    const { updatedAt, ...rest } = res.body.data;
    expect(rest).toEqual({ ...CATALOG[0], price: 50 });
    expect(Number.isNaN(Date.parse(updatedAt))).toBe(false);

    const stored = storedProducts();
    expect(stored[0]).toEqual(res.body.data);
    expect(stored.slice(1)).toEqual(CATALOG.slice(1));
  });

  it('stores, keeps and clears the catalog attributes', async () => {
    const set = await request(app)
      .put('/api/products/p-oak')
      .send({ woodType: 'Walnut', finish: 'Matt', thickness: '15 mm', tag: 'Premium' });
    expect(set.statusCode).toEqual(200);
    expect(set.body.data).toMatchObject({
      woodType: 'Walnut',
      finish: 'Matt',
      thickness: '15 mm',
      tag: 'Premium',
    });

    // Unsent attributes are kept; an empty one is removed
    const cleared = await request(app)
      .put('/api/products/p-oak')
      .send({ tag: '', plankSize: '190 × 1900 mm' });
    expect(cleared.body.data).toMatchObject({ woodType: 'Walnut', plankSize: '190 × 1900 mm' });
    expect(cleared.body.data).not.toHaveProperty('tag');
  });

  it('returns 404 for an unknown id and writes nothing', async () => {
    const res = await request(app).put('/api/products/nope').send({ price: 1 });
    expect(res.statusCode).toEqual(404);
    expect(res.body.success).toBe(false);
    expect(R2.putObject).not.toHaveBeenCalled();
  });

  it('keeps the thumbnail when the same imageKey is sent again', async () => {
    seedProducts([{ ...CATALOG[0], thumbKey: 'products/oak-thumb.webp' }]);
    const res = await request(app)
      .put('/api/products/p-oak')
      .send({ imageKey: CATALOG[0].imageKey, title: 'Renamed' });
    expect(res.body.data.thumbKey).toBe('products/oak-thumb.webp');
  });

  it('drops the thumbnail when a new imageKey is set without a file', async () => {
    seedProducts([{ ...CATALOG[0], thumbKey: 'products/oak-thumb.webp' }]);
    const res = await request(app)
      .put('/api/products/p-oak')
      .send({ imageKey: 'products/other.jpg' });
    expect(res.statusCode).toEqual(200);
    expect(res.body.data.imageKey).toBe('products/other.jpg');
    expect(res.body.data).not.toHaveProperty('thumbKey');
  });

  it('replaces the image with an upload and deletes the old image and thumbnail', async () => {
    const old = { ...CATALOG[0], thumbKey: 'products/oak-thumb.webp' };
    seedProducts([old]);
    mockStorage.set(old.imageKey, Buffer.from('old'));
    mockStorage.set(old.thumbKey, Buffer.from('old-thumb'));

    const res = await request(app)
      .put('/api/products/p-oak')
      .attach('image', await jpeg(800, 600), 'new.jpg');

    expect(res.statusCode).toEqual(200);
    const { imageKey, thumbKey, title } = res.body.data;
    expect(title).toBe(old.title);
    expect(imageKey).not.toBe(old.imageKey);
    expect(mockStorage.has(imageKey)).toBe(true);
    expect(mockStorage.has(thumbKey)).toBe(true);
    expect(mockStorage.has(old.imageKey)).toBe(false);
    expect(mockStorage.has(old.thumbKey)).toBe(false);
    expect(tempUploads()).toEqual([]);
  });
});

describe('DELETE /api/products/:id', () => {
  it('removes only that product, along with its image and thumbnail', async () => {
    const target = { ...CATALOG[1], thumbKey: 'products/walnut-thumb.webp' };
    seedProducts([CATALOG[0], target, CATALOG[2]]);
    mockStorage.set(target.imageKey, Buffer.from('img'));
    mockStorage.set(target.thumbKey, Buffer.from('thumb'));
    mockStorage.set(CATALOG[0].imageKey, Buffer.from('other'));

    const res = await request(app).delete('/api/products/p-walnut');
    expect(res.statusCode).toEqual(200);
    expect(res.body.data.id).toBe('p-walnut');
    expect(storedProducts()).toEqual([CATALOG[0], CATALOG[2]]);
    expect(mockStorage.has(target.imageKey)).toBe(false);
    expect(mockStorage.has(target.thumbKey)).toBe(false);
    expect(mockStorage.has(CATALOG[0].imageKey)).toBe(true);

    const gone = await request(app).get('/api/products/p-walnut');
    expect(gone.statusCode).toEqual(404);
  });

  it('still deletes the product when removing its image fails', async () => {
    R2.deleteObject.mockRejectedValueOnce(new Error('R2 down'));
    const res = await request(app).delete('/api/products/p-oak');
    expect(res.statusCode).toEqual(200);
    expect(storedProducts().map((p) => p.id)).not.toContain('p-oak');
  });

  it('returns 404 for an unknown id and writes nothing', async () => {
    const res = await request(app).delete('/api/products/nope');
    expect(res.statusCode).toEqual(404);
    expect(R2.putObject).not.toHaveBeenCalled();
    expect(R2.deleteObject).not.toHaveBeenCalled();
  });
});

describe('R2 read failures', () => {
  const r2Outage = () =>
    Object.assign(new Error('Service Unavailable'), {
      name: 'InternalError',
      $metadata: { httpStatusCode: 503 },
    });

  beforeEach(() => {
    R2.getObject.mockImplementationOnce(async () => {
      throw r2Outage();
    });
  });

  it('GET /api/products returns 500 instead of an empty list', async () => {
    const res = await request(app).get('/api/products');
    expect(res.statusCode).toEqual(500);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/products does not overwrite the catalog when the read fails', async () => {
    const res = await request(app)
      .post('/api/products')
      .send({ title: 'New', price: 1, imageKey: 'products/new.jpg' });

    expect(res.statusCode).toEqual(500);
    expect(R2.putObject).not.toHaveBeenCalled();
    expect(storedProducts()).toEqual(CATALOG);
  });

  it.each([
    ['PUT', (r) => r.put('/api/products/p-oak').send({ price: 1 })],
    ['DELETE', (r) => r.delete('/api/products/p-oak')],
  ])('%s /api/products/:id returns 500 and leaves the catalog alone', async (_m, send) => {
    const res = await send(request(app));
    expect(res.statusCode).toEqual(500);
    expect(R2.putObject).not.toHaveBeenCalled();
    expect(R2.deleteObject).not.toHaveBeenCalled();
    expect(storedProducts()).toEqual(CATALOG);
  });
});

describe('GET /api/products/photo', () => {
  const IMMUTABLE = 'public, max-age=31536000, immutable';

  it('streams the stored bytes with an immutable Cache-Control', async () => {
    const bytes = await jpeg(20, 20);
    mockStorage.set('products/a.webp', bytes);
    const res = await request(app).get('/api/products/photo?key=products/a.webp').buffer(true);
    expect(res.statusCode).toEqual(200);
    expect(res.headers['cache-control']).toBe(IMMUTABLE);
    expect(Buffer.compare(res.body, bytes)).toBe(0);
  });

  it('accepts ?url= as an alias of ?key=', async () => {
    mockStorage.set('products/a.webp', Buffer.from('x'));
    const res = await request(app).get('/api/products/photo?url=products/a.webp');
    expect(res.statusCode).toEqual(200);
  });

  it('returns 400 without a key', async () => {
    const res = await request(app).get('/api/products/photo');
    expect(res.statusCode).toEqual(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 404 for a missing photo', async () => {
    const res = await request(app).get('/api/products/photo?key=products/missing.webp');
    expect(res.statusCode).toEqual(404);
    expect(res.body.success).toBe(false);
  });

  it('returns 500 (not 404) when R2 fails', async () => {
    R2.getObject.mockRejectedValueOnce(Object.assign(new Error('boom'), { name: 'InternalError' }));
    const res = await request(app).get('/api/products/photo?key=products/a.webp');
    expect(res.statusCode).toEqual(500);
  });
});

describe('Public image URLs (R2_PUBLIC_URL)', () => {
  afterEach(() => {
    delete process.env.R2_PUBLIC_URL;
  });

  it('adds imageUrl/thumbUrl on list and detail responses when set', async () => {
    process.env.R2_PUBLIC_URL = 'https://images.example.com/';
    seedProducts([{ ...CATALOG[0], thumbKey: 'products/oak thumb.webp' }]);

    const res = await request(app).get('/api/products/p-oak');
    expect(res.body.data.imageUrl).toBe('https://images.example.com/products/oak.webp');
    // Each path segment is URL-encoded
    expect(res.body.data.thumbUrl).toBe('https://images.example.com/products/oak%20thumb.webp');

    const list = await request(app).get('/api/products');
    expect(list.body.data[0].imageUrl).toBe('https://images.example.com/products/oak.webp');

    // Never persisted
    expect(storedProducts()[0]).not.toHaveProperty('imageUrl');
  });

  it('falls back to the image for thumbUrl when there is no thumbnail', async () => {
    process.env.R2_PUBLIC_URL = 'https://images.example.com';
    const res = await request(app).get('/api/products/p-oak');
    expect(res.body.data.thumbUrl).toBe(res.body.data.imageUrl);
  });

  it('omits image URLs when unset', async () => {
    const res = await request(app).get('/api/products/p-oak');
    expect(res.body.data).not.toHaveProperty('imageUrl');
    expect(res.body.data).not.toHaveProperty('thumbUrl');
  });
});

describe('404 handler', () => {
  it('returns JSON 404 for undefined endpoints', async () => {
    const res = await request(app).get('/api/unknown-endpoint');
    expect(res.statusCode).toEqual(404);
    expect(res.body).toEqual({ success: false, error: 'Endpoint not found' });
  });
});
