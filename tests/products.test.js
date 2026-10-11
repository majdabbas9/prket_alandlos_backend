const request = require('supertest');
const app = require('../app');
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

  describe('404 Handler', () => {
    it('should return 404 for undefined endpoints', async () => {
      const res = await request(app).get('/api/unknown-endpoint');
      expect(res.statusCode).toEqual(404);
      expect(res.body.error).toBe('Endpoint not found');
    });
  });
});
