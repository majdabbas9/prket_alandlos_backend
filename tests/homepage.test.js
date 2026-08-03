const request = require('supertest');
const app = require('../app');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Mock R2 module
const mockStorage = new Map();
jest.mock('../src/cloudManager/R2', () => {
  return {
    getImage: jest.fn(async (key) => {
      if (mockStorage.has(key)) {
        return {
          Body: [mockStorage.get(key)],
          ContentType: 'image/png',
          ContentLength: mockStorage.get(key).length,
        };
      }
      throw new Error('NoSuchKey');
    }),
    uploadImage: jest.fn(async (key, body, contentType) => {
      mockStorage.set(key, body);
      return { success: true };
    }),
    deleteImage: jest.fn(async (key) => {
      mockStorage.delete(key);
      return { success: true };
    }),
  };
});

const homepageDataPath = path.join(__dirname, '../src/data/homepage.json');
const uploadsDir = path.join(__dirname, '../uploads');

describe('Homepage Image API Endpoints', () => {
  let backupData;
  let testImagePath;

  beforeAll(async () => {
    // Backup existing homepage.json data
    if (fs.existsSync(homepageDataPath)) {
      backupData = fs.readFileSync(homepageDataPath, 'utf8');
    }

    // Create a temporary test image file with width 2400px
    testImagePath = path.join(__dirname, 'temp_test_image.png');
    await sharp({
      create: {
        width: 2400,
        height: 1200,
        channels: 4,
        background: { r: 184, g: 115, b: 51, alpha: 1 }
      }
    })
      .png()
      .toFile(testImagePath);

    // Populate mockStorage with an initial dummy image for GET request
    const dummyImageBuffer = await sharp({
      create: {
        width: 1600,
        height: 1067,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 }
      }
    }).png().toBuffer();
    mockStorage.set('homePage/homepageImage', dummyImageBuffer);
  });

  afterAll(() => {
    // Restore backup
    if (backupData) {
      fs.writeFileSync(homepageDataPath, backupData, 'utf8');
    }
    // Clean up test image
    if (fs.existsSync(testImagePath)) {
      fs.unlinkSync(testImagePath);
    }
    mockStorage.clear();
  });

  describe('GET /api/homepage-image', () => {
    it('should return the actual image file binary by default', async () => {
      const res = await request(app).get('/api/homepage-image');
      expect([200, 302]).toContain(res.statusCode);
      if (res.statusCode === 200) {
        expect(res.headers['content-type']).toMatch(/image\/(jpeg|png|webp|avif|gif)/);
      }
    });

    it('should return JSON metadata when ?info=true query parameter is passed', async () => {
      const res = await request(app).get('/api/homepage-image?info=true');
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('key');
    });
  });

  describe('POST /api/homepage-image', () => {
    it('should upload image file and resize width to 1600px', async () => {
      const res = await request(app)
        .post('/api/homepage-image')
        .attach('image', testImagePath);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.key).toBe('homePage/homepageImage');
      expect(res.body.data.width).toBe(1600);
      expect(res.body.data.height).toBe(800); // 2400x1200 scaled to width 1600 maintains 2:1 aspect ratio

      // Verify the uploaded file actually exists in mocked R2 storage and is retrievable via GET
      const getRes = await request(app).get('/api/homepage-image');
      expect(getRes.statusCode).toBe(200);
      expect(getRes.headers['content-type']).toBe('image/png');
      expect(Number(getRes.headers['content-length'])).toBeGreaterThan(0);
    });

    it('should return 400 Bad Request when no image file is provided', async () => {
      const res = await request(app)
        .post('/api/homepage-image')
        .send({});

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Image is required');
    });
  });
});
