const request = require('supertest');
const app = require('../app');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

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
      expect(res.body.data).toHaveProperty('imageUrl');
    });
  });

  describe('POST /api/homepage-image', () => {
    it('should update homepage image with a valid imageUrl string', async () => {
      const newUrl = 'https://images.pexels.com/photos/6523303/pexels-photo-6523303.jpeg?w=1600';
      const res = await request(app)
        .post('/api/homepage-image')
        .send({ imageUrl: newUrl });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.imageUrl).toBe(newUrl);
    });

    it('should upload image file and resize width to 1600px', async () => {
      const res = await request(app)
        .post('/api/homepage-image')
        .attach('image', testImagePath);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.imageUrl).toMatch(/^\/uploads\/homepage-\d+\.png$/);
      expect(res.body.data.width).toBe(1600);
      expect(res.body.data.height).toBe(800); // 2400x1200 scaled to width 1600 maintains 2:1 aspect ratio

      // Verify the uploaded file actually exists on disk
      const filename = path.basename(res.body.data.imageUrl);
      const savedFilePath = path.join(uploadsDir, filename);
      expect(fs.existsSync(savedFilePath)).toBe(true);

      // Verify sharp dimensions of saved file directly
      const savedMeta = await sharp(savedFilePath).metadata();
      expect(savedMeta.width).toBe(1600);

      // Clean up uploaded file from disk after test
      if (fs.existsSync(savedFilePath)) {
        fs.unlinkSync(savedFilePath);
      }
    });

    it('should return 400 Bad Request when no image file or URL is provided', async () => {
      const res = await request(app)
        .post('/api/homepage-image')
        .send({});

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Image is required');
    });

    it('should return 400 Bad Request when invalid imageUrl string is provided', async () => {
      const res = await request(app)
        .post('/api/homepage-image')
        .send({ imageUrl: 'not-a-valid-url' });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('must be a valid HTTP/HTTPS URL');
    });
  });
});
