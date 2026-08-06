const request = require('supertest');
const app = require('../app');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Mock R2 module
const mockStorage = new Map();
jest.mock('../src/cloudManager/R2', () => {
  const getObject = jest.fn(async (key) => {
    if (mockStorage.has(key)) {
      return {
        Body: [mockStorage.get(key)],
        ContentType: 'image/png',
        ContentLength: mockStorage.get(key).length,
      };
    }
    throw new Error('NoSuchKey');
  });
  const putObject = jest.fn(async (key, body, contentType) => {
    mockStorage.set(key, body);
    return { success: true };
  });
  const deleteObject = jest.fn(async (key) => {
    mockStorage.delete(key);
    return { success: true };
  });
  const ObjectExists = jest.fn(async (key) => {
    return mockStorage.has(key);
  });
  return {
    getObject,
    putObject,
    deleteObject,
    ObjectExists,
    getImage: getObject,
    uploadImage: putObject,
    deleteImage: deleteObject,
  };
});

const logoDataPath = path.join(__dirname, '../src/data/logo.json');

describe('Logo API Endpoints (/api/logo)', () => {
  let backupData;
  let testImagePath;

  beforeAll(async () => {
    if (fs.existsSync(logoDataPath)) {
      backupData = fs.readFileSync(logoDataPath, 'utf8');
    }

    testImagePath = path.join(__dirname, 'temp_test_logo.png');
    await sharp({
      create: {
        width: 400,
        height: 400,
        channels: 4,
        background: { r: 50, g: 100, b: 200, alpha: 1 }
      }
    })
      .png()
      .toFile(testImagePath);

    const dummyImageBuffer = await sharp({
      create: {
        width: 800,
        height: 800,
        channels: 4,
        background: { r: 100, g: 150, b: 200, alpha: 1 }
      }
    }).png().toBuffer();
    mockStorage.set('logo/logoImage', dummyImageBuffer);
  });

  afterAll(() => {
    if (backupData) {
      fs.writeFileSync(logoDataPath, backupData, 'utf8');
    }

    if (fs.existsSync(testImagePath)) {
      fs.unlinkSync(testImagePath);
    }
    mockStorage.clear();
  });

  describe('GET /api/logo', () => {
    it('should return the actual logo image file binary directly', async () => {
      const res = await request(app).get('/api/logo');
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/image\/(jpeg|png|webp|avif|gif|svg)/);
      expect(res.body).toBeInstanceOf(Buffer);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('should return the file binary when /api/logo/12.jpg is called', async () => {
      const res = await request(app).get('/api/logo/12.jpg');
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/image\/(jpeg|png|webp|avif|gif|svg)/);
      expect(res.body).toBeInstanceOf(Buffer);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('should return JSON metadata when ?info=true query parameter is passed', async () => {
      const res = await request(app).get('/api/logo?info=true');
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('logoUrl');
    });

    it('should work on /api/logo-image endpoint alias', async () => {
      const res = await request(app).get('/api/logo-image');
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/image\/(jpeg|png|webp|avif|gif|svg)/);
    });

    it('should create default parket logo image on R2 if key does not exist', async () => {
      mockStorage.clear();
      const res = await request(app).get('/api/logo');
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/image\/(jpeg|png|webp|avif|gif)/);
      expect(mockStorage.has('logo/logoImage')).toBe(true);
    });
  });

  describe('POST /api/logo', () => {
    it('should update logo image with a valid logoUrl string', async () => {
      const newUrl = '/uploads/logo/12.jpg';
      const res = await request(app)
        .post('/api/logo')
        .send({ logoUrl: newUrl });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.logoUrl).toBe(newUrl);
    });

    it('should upload a new logo file and save it in R2 storage', async () => {
      const res = await request(app)
        .post('/api/logo')
        .attach('logo', testImagePath);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.key).toBe('logo/logoImage');

      const getRes = await request(app).get('/api/logo');
      expect(getRes.statusCode).toBe(200);
      expect(getRes.headers['content-type']).toBe('image/png');
    });

    it('should return 400 Bad Request when no image file or logoUrl is provided', async () => {
      const res = await request(app)
        .post('/api/logo')
        .send({});

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Logo image is required');
    });
  });
});
