const request = require('supertest');
const app = require('../app');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const logoDataPath = path.join(__dirname, '../src/data/logo.json');
const logoUploadsDir = path.join(__dirname, '../uploads/logo');

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
  });

  afterAll(() => {
    if (backupData) {
      fs.writeFileSync(logoDataPath, backupData, 'utf8');
    } else if (fs.existsSync(logoDataPath)) {
      fs.unlinkSync(logoDataPath);
    }

    if (fs.existsSync(testImagePath)) {
      fs.unlinkSync(testImagePath);
    }
  });

  describe('GET /api/logo', () => {
    it('should return the actual logo image file binary directly', async () => {
      const res = await request(app).get('/api/logo');
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/image\/(jpeg|png|webp|avif|gif|svg)/);
      // Ensure body is non-empty buffer (actual binary file content)
      expect(res.body).toBeInstanceOf(Buffer);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('should return the actual file by filename when /api/logo/12.jpg is called', async () => {
      const res = await request(app).get('/api/logo/12.jpg');
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/jpeg');
      expect(res.body).toBeInstanceOf(Buffer);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('should return JSON metadata when ?info=true query parameter is passed', async () => {
      const res = await request(app).get('/api/logo?info=true');
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('logoUrl');
      expect(res.body.data.logoUrl).toContain('/uploads/logo/');
    });

    it('should also work on /api/logo-image endpoint alias', async () => {
      const res = await request(app).get('/api/logo-image');
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/image\/(jpeg|png|webp|avif|gif|svg)/);
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

    it('should upload a new logo file and save it in uploads/logo directory', async () => {
      const res = await request(app)
        .post('/api/logo')
        .attach('logo', testImagePath);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.logoUrl).toMatch(/^\/uploads\/logo\/logo-\d+\.png$/);

      const savedFilename = path.basename(res.body.data.logoUrl);
      const savedFilePath = path.join(logoUploadsDir, savedFilename);
      expect(fs.existsSync(savedFilePath)).toBe(true);

      if (fs.existsSync(savedFilePath)) {
        fs.unlinkSync(savedFilePath);
      }
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
