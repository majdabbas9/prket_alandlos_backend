const request = require('supertest');
const app = require('../app');
const fs = require('fs');
const path = require('path');
const Info = require('../src/models/Info');

const dataFilePath = path.join(__dirname, '../src/data/info.json');

describe('Info Model & API Endpoints', () => {
  let backupData;

  beforeAll(() => {
    if (fs.existsSync(dataFilePath)) {
      backupData = fs.readFileSync(dataFilePath, 'utf8');
    }
  });

  afterAll(() => {
    if (backupData !== undefined) {
      fs.writeFileSync(dataFilePath, backupData, 'utf8');
    } else if (fs.existsSync(dataFilePath)) {
      fs.unlinkSync(dataFilePath);
    }
  });

  describe('Info Unit Tests', () => {
    test('instantiates with default values', () => {
      const info = new Info();
      const defaults = Info.getDefaults();

      expect(info.showPrice).toBe(defaults.showPrice);
      expect(info.email).toBe(defaults.email);
      expect(info.phone).toBe(defaults.phone);
      expect(info.location).toBe(defaults.location);
      expect(info.stats).toEqual(defaults.stats);
    });

    test('instantiates with custom values', () => {
      const custom = {
        email: 'custom@example.com',
        phone: '+123456789',
        showPrice: false
      };
      const info = new Info(custom);

      expect(info.email).toBe('custom@example.com');
      expect(info.phone).toBe('+123456789');
      expect(info.showPrice).toBe(false);
    });

    test('updates fields correctly', () => {
      const info = new Info();
      info.update({
        email: 'updated@example.com',
        showPrice: 'false',
        contactTitle: 'New Contact Title'
      });

      expect(info.email).toBe('updated@example.com');
      expect(info.showPrice).toBe(false);
      expect(info.contactTitle).toBe('New Contact Title');
    });

    test('serializes to JSON correctly', () => {
      const info = new Info({ heroTitle: 'Hero Title Test' });
      const json = info.toJSON();

      expect(json.heroTitle).toBe('Hero Title Test');
      expect(json.email).toBe(Info.getDefaults().email);
      expect(json).not.toBeInstanceOf(Info);
    });

    test('parses from string or object via fromJSON', () => {
      const rawString = JSON.stringify({ email: 'str@example.com' });
      const fromStr = Info.fromJSON(rawString);
      expect(fromStr.email).toBe('str@example.com');

      const invalidStr = Info.fromJSON('invalid json string');
      expect(invalidStr.email).toBe(Info.getDefaults().email);
    });
  });

  describe('GET /api/info', () => {
    test('returns store information data', async () => {
      const res = await request(app).get('/api/info');
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('email');
      expect(res.body.data).toHaveProperty('showPrice');
    });
  });

  describe('POST /api/info', () => {
    test('updates store information successfully', async () => {
      const updatePayload = {
        email: 'newemail@prket.com',
        showPrice: false,
        location: 'New Location'
      };

      const res = await request(app)
        .post('/api/info')
        .send(updatePayload);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe('newemail@prket.com');
      expect(res.body.data.showPrice).toBe(false);
      expect(res.body.data.location).toBe('New Location');
    });
  });
});
