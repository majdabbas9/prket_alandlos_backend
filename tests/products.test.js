const request = require('supertest');
const app = require('../app');
const fs = require('fs');
const path = require('path');

const dataFilePath = path.join(__dirname, '../src/data/products.json');

describe('Prket Alandlos Backend API Tests', () => {
  let backupData;

  beforeAll(() => {
    if (fs.existsSync(dataFilePath)) {
      backupData = fs.readFileSync(dataFilePath, 'utf8');
    }
  });

  afterAll(() => {
    if (backupData) {
      fs.writeFileSync(dataFilePath, backupData, 'utf8');
    }
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
        imageUrl: 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7'
      };

      const res = await request(app)
        .post('/api/products')
        .send(newProduct);

      expect(res.statusCode).toEqual(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data.title).toBe(newProduct.title);

      createdProductId = res.body.data.id;
    });

    it('should fail with 400 when imageUrl is missing', async () => {
      const res = await request(app)
        .post('/api/products')
        .send({ title: 'No Image Product' });

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
        .send({ price: 120.00 });

      expect(res.statusCode).toEqual(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.price).toBe(120.00);
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

  describe('404 Handler', () => {
    it('should return 404 for undefined endpoints', async () => {
      const res = await request(app).get('/api/unknown-endpoint');
      expect(res.statusCode).toEqual(404);
      expect(res.body.error).toBe('Endpoint not found');
    });
  });
});
