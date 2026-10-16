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
        ContentType: 'application/json',
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

describe('Prket Alandlos Backend API Tests', () => {
  beforeAll(() => {
    mockStorage.clear();
  });

  afterAll(() => {
    mockStorage.clear();
  });

  describe('GET /api/health', () => {
    it('should return 200 OK with service status', async () => {
      const res = await request(app).get('/api/health');
      expect(res.statusCode).toEqual(200);
      expect(res.body).toHaveProperty('status', 'ok');
      expect(res.body).toHaveProperty('service');
    });
  });

  describe('GET /api/products', () => {
    it('should return a list of products', async () => {
      const res = await request(app).get('/api/products');
      expect(res.statusCode).toEqual(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should filter products by search query', async () => {
      const res = await request(app).get('/api/products?search=Tiles');
      expect(res.statusCode).toEqual(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should support pagination', async () => {
      const res = await request(app).get('/api/products?page=1&limit=1');
      expect(res.statusCode).toEqual(200);
      expect(res.body.success).toBe(true);
      expect(res.body).toHaveProperty('page', 1);
      expect(res.body).toHaveProperty('totalPages');
      expect(res.body.data.length).toBeLessThanOrEqual(1);
    });
  });

  describe('POST, GET by ID, PUT & DELETE /api/products', () => {
    let createdProductId;

    it('should create a new product when valid payload is sent', async () => {
      const newProduct = {
        title: 'Jest Test Flooring',
        price: 99.99,
        category: 'Parquet',
        description: 'Created by automated test',
        imageKey: 'products/test-image-key.jpeg',
      };

      const res = await request(app).post('/api/products').send(newProduct);

      expect(res.statusCode).toEqual(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data.title).toBe(newProduct.title);

      createdProductId = res.body.data.id;
    });

    it('should create a product with file upload using field "file"', async () => {
      const buffer = Buffer.from('fake image content');
      const res = await request(app)
        .post('/api/products')
        .field('title', 'Product with file field')
        .field('price', '49.99')
        .attach('file', buffer, 'sample.jpg');

      expect(res.statusCode).toEqual(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.title).toBe('Product with file field');
    });

    it('should create a product with file upload using field "image"', async () => {
      const buffer = Buffer.from('fake image content');
      const res = await request(app)
        .post('/api/products')
        .field('title', 'Product with image field')
        .field('price', '59.99')
        .attach('image', buffer, 'sample.jpg');

      expect(res.statusCode).toEqual(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.title).toBe('Product with image field');
    });

    it('should fail with 400 when imageKey is missing', async () => {
      const res = await request(app).post('/api/products').send({ title: 'No Image Product' });

      expect(res.statusCode).toEqual(400);
      expect(res.body.success).toBe(false);
    });

    it('should fetch single product by ID', async () => {
      expect(createdProductId).toBeDefined();
      const res = await request(app).get(`/api/products/${createdProductId}`);
      expect(res.statusCode).toEqual(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(createdProductId);
    });

    it('should update product by ID', async () => {
      expect(createdProductId).toBeDefined();
      const res = await request(app)
        .put(`/api/products/${createdProductId}`)
        .send({ price: 120.0 });

      expect(res.statusCode).toEqual(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.price).toBe(120.0);
    });

    it('should store, update and clear the catalog attributes', async () => {
      expect(createdProductId).toBeDefined();
      const set = await request(app)
        .put(`/api/products/${createdProductId}`)
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
        .put(`/api/products/${createdProductId}`)
        .send({ tag: '', plankSize: '190 × 1900 mm' });
      expect(cleared.body.data).toMatchObject({ woodType: 'Walnut', plankSize: '190 × 1900 mm' });
      expect(cleared.body.data).not.toHaveProperty('tag');
    });

    it('should delete product by ID', async () => {
      expect(createdProductId).toBeDefined();
      const res = await request(app).delete(`/api/products/${createdProductId}`);
      expect(res.statusCode).toEqual(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /api/products/:id (Invalid ID)', () => {
    it('should return 404 for non-existent product ID', async () => {
      const res = await request(app).get('/api/products/non_existent_id_9999');
      expect(res.statusCode).toEqual(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('R2 read failures', () => {
    const PRODUCTS_KEY = 'products/products.json';
    const existing = [{ id: 'keep-me', title: 'Existing product', imageKey: 'products/x.jpg' }];
    const r2Outage = () =>
      Object.assign(new Error('Service Unavailable'), {
        name: 'InternalError',
        $metadata: { httpStatusCode: 503 },
      });

    beforeEach(() => {
      mockStorage.set(PRODUCTS_KEY, Buffer.from(JSON.stringify(existing)));
      R2.getObject.mockImplementationOnce(async () => {
        throw r2Outage();
      });
      R2.putObject.mockClear();
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
      expect(R2.putObject).not.toHaveBeenCalledWith(
        PRODUCTS_KEY,
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
      expect(JSON.parse(mockStorage.get(PRODUCTS_KEY).toString())).toEqual(existing);
    });

    it('DELETE /api/products/:id returns 500 when the read fails', async () => {
      const res = await request(app).delete('/api/products/keep-me');
      expect(res.statusCode).toEqual(500);
      expect(JSON.parse(mockStorage.get(PRODUCTS_KEY).toString())).toEqual(existing);
    });
  });

  describe('Product image variants', () => {
    const IMMUTABLE = 'public, max-age=31536000, immutable';
    let productId;
    let imageKey;
    let thumbKey;

    afterEach(() => {
      delete process.env.R2_PUBLIC_URL;
    });

    it('stores a large WebP and a thumbnail WebP for an uploaded image', async () => {
      const jpeg = await sharp({
        create: { width: 2400, height: 1600, channels: 3, background: '#8b5a2b' },
      })
        .jpeg()
        .toBuffer();
      R2.putObject.mockClear();

      const res = await request(app)
        .post('/api/products')
        .field('title', 'Resized product')
        .attach('image', jpeg, 'big.jpg');

      expect(res.statusCode).toEqual(201);
      ({ id: productId, imageKey, thumbKey } = res.body.data);
      expect(imageKey).toMatch(/^products\/img-.*\.webp$/);
      expect(thumbKey).toMatch(/^products\/img-.*-thumb\.webp$/);
      expect(R2.putObject).toHaveBeenCalledWith(
        imageKey,
        expect.any(Buffer),
        'image/webp',
        expect.anything(),
        IMMUTABLE,
      );

      const large = await sharp(mockStorage.get(imageKey)).metadata();
      const thumb = await sharp(mockStorage.get(thumbKey)).metadata();
      expect(large).toMatchObject({ format: 'webp', width: 1600 });
      expect(thumb).toMatchObject({ format: 'webp', width: 600 });
    });

    it('adds public image URLs when R2_PUBLIC_URL is set', async () => {
      process.env.R2_PUBLIC_URL = 'https://images.example.com/';
      const res = await request(app).get(`/api/products/${productId}`);
      expect(res.body.data.imageUrl).toBe(`https://images.example.com/${imageKey}`);
      expect(res.body.data.thumbUrl).toBe(`https://images.example.com/${thumbKey}`);
    });

    it('omits image URLs when R2_PUBLIC_URL is unset', async () => {
      const res = await request(app).get(`/api/products/${productId}`);
      expect(res.body.data).not.toHaveProperty('imageUrl');
      expect(res.body.data).not.toHaveProperty('thumbUrl');
    });

    it('serves photos with an immutable Cache-Control', async () => {
      const res = await request(app)
        .get(`/api/products/photo?key=${thumbKey}`)
        .responseType('blob');
      expect(res.statusCode).toEqual(200);
      expect(res.headers['cache-control']).toBe(IMMUTABLE);
    });

    it('returns 404 for a missing photo', async () => {
      const res = await request(app).get('/api/products/photo?key=products/missing.webp');
      expect(res.statusCode).toEqual(404);
    });

    it('drops the thumbnail when a new imageKey is set without a file', async () => {
      const res = await request(app)
        .put(`/api/products/${productId}`)
        .send({ imageKey: 'products/other.jpg' });
      expect(res.statusCode).toEqual(200);
      expect(res.body.data.imageKey).toBe('products/other.jpg');
      expect(res.body.data).not.toHaveProperty('thumbKey');
    });

    it('deletes both the image and the thumbnail with the product', async () => {
      const jpeg = await sharp({
        create: { width: 800, height: 600, channels: 3, background: '#8b5a2b' },
      })
        .jpeg()
        .toBuffer();
      const created = await request(app)
        .post('/api/products')
        .field('title', 'To delete')
        .attach('image', jpeg, 'small.jpg');
      const { id, imageKey: img, thumbKey: thumb } = created.body.data;

      const res = await request(app).delete(`/api/products/${id}`);
      expect(res.statusCode).toEqual(200);
      expect(mockStorage.has(img)).toBe(false);
      expect(mockStorage.has(thumb)).toBe(false);
    });
  });

  describe('404 Handler', () => {
    it('should return 404 for undefined endpoints', async () => {
      const res = await request(app).get('/api/unknown-endpoint');
      expect(res.statusCode).toEqual(404);
      expect(res.body.error).toBe('Endpoint not found');
    });
  });
});
