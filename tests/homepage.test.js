const request = require('supertest');
const app = require('../app');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Mock R2 module
const mockStorage = new Map();
jest.mock('../src/cloudManager/R2', () => {
  const { Readable } = require('stream');
  const notFound = () => Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
  const getObject = jest.fn(async (key) => {
    if (mockStorage.has(key)) {
      return {
        Body: Readable.from([mockStorage.get(key)]),
        ContentType: 'image/png',
        ContentLength: mockStorage.get(key).length,
        ETag: `"etag-${mockStorage.get(key).length}"`,
        LastModified: new Date('2026-01-01T00:00:00Z'),
      };
    }
    throw notFound();
  });
  const headObject = jest.fn(async (key) => {
    if (mockStorage.has(key)) {
      return {
        ContentType: 'image/png',
        ContentLength: mockStorage.get(key).length,
        ETag: `"etag-${mockStorage.get(key).length}"`,
        LastModified: new Date('2026-01-01T00:00:00Z'),
      };
    }
    throw notFound();
  });
  const putObject = jest.fn(async (key, body) => {
    mockStorage.set(key, body);
    return { ETag: `"etag-${body.length}"` };
  });
  const deleteObject = jest.fn(async (key) => {
    mockStorage.delete(key);
    return { success: true };
  });
  return {
    getObject,
    headObject,
    putObject,
    deleteObject,
    isNotFound: (err) => err.name === 'NoSuchKey',
  };
});

const homepageDataPath = path.join(__dirname, '../src/data/homepage.json');

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
        background: { r: 184, g: 115, b: 51, alpha: 1 },
      },
    })
      .png()
      .toFile(testImagePath);

    // Populate mockStorage with an initial dummy image for GET request
    const dummyImageBuffer = await sharp({
      create: {
        width: 1600,
        height: 1067,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
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

    it('should stream the image with caching headers', async () => {
      const res = await request(app).get('/api/homepage-image');
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('public, max-age=300');
      expect(res.headers['etag']).toBeDefined();
      expect(Number(res.headers['content-length'])).toBe(
        mockStorage.get('homePage/homepageImage').length,
      );
    });

    it('should return 304 when the client already has the current image', async () => {
      const first = await request(app).get('/api/homepage-image');
      const res = await request(app)
        .get('/api/homepage-image')
        .set('If-None-Match', first.headers['etag']);
      expect(res.statusCode).toBe(304);
    });

    it('should return JSON metadata for ?info=true without downloading the image', async () => {
      const R2 = require('../src/cloudManager/R2');
      R2.getObject.mockClear();
      const res = await request(app).get('/api/homepage-image?info=true');
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.key).toBe('homePage/homepageImage');
      expect(res.body.data.size).toBe(mockStorage.get('homePage/homepageImage').length);
      expect(R2.getObject).not.toHaveBeenCalled();
    });

    it('should expose a version for cache-busting and never let the metadata go stale', async () => {
      const res = await request(app).get('/api/homepage-image?info=true');
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.body.data.version).toBe(
        `etag-${mockStorage.get('homePage/homepageImage').length}`,
      );
      expect(res.body.data.updatedAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('should cache a versioned image URL for good', async () => {
      const res = await request(app).get('/api/homepage-image?v=etag-1');
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    });

    it('should return 404 without creating anything when the image is missing on R2', async () => {
      const R2 = require('../src/cloudManager/R2');
      const saved = mockStorage.get('homePage/homepageImage');
      mockStorage.delete('homePage/homepageImage');
      R2.putObject.mockClear();

      const res = await request(app).get('/api/homepage-image');
      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      const meta = await request(app).get('/api/homepage-image?info=true');
      expect(meta.statusCode).toBe(404);
      expect(R2.putObject).not.toHaveBeenCalled();

      mockStorage.set('homePage/homepageImage', saved);
    });
  });

  describe('POST /api/homepage-image', () => {
    it('should upload image file and resize width to 1600px', async () => {
      const res = await request(app).post('/api/homepage-image').attach('image', testImagePath);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.key).toBe('homePage/homepageImage');
      expect(res.body.data.width).toBe(1600);
      expect(res.body.data.height).toBe(800); // 2400x1200 scaled to width 1600 maintains 2:1 aspect ratio
      // A new upload gets a new version, so versioned URLs of the old image stop matching
      expect(res.body.data.version).toBe(
        `etag-${mockStorage.get('homePage/homepageImage').length}`,
      );
      const R2 = require('../src/cloudManager/R2');
      expect(R2.putObject).toHaveBeenLastCalledWith(
        'homePage/homepageImage',
        expect.any(Buffer),
        'image/png',
        undefined,
        'public, max-age=300',
      );

      // Verify the uploaded file actually exists in mocked R2 storage and is retrievable via GET
      const getRes = await request(app).get('/api/homepage-image');
      expect(getRes.statusCode).toBe(200);
      expect(getRes.headers['content-type']).toBe('image/png');
      expect(Number(getRes.headers['content-length'])).toBeGreaterThan(0);
    });

    it('should return 400 Bad Request when no image file is provided', async () => {
      const res = await request(app).post('/api/homepage-image').send({});

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Image is required');
    });
  });
});
