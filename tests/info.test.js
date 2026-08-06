const request = require('supertest');
const app = require('../app');
const Info = require('../src/models/Info');

const mockStorage = new Map();
jest.mock('../src/cloudManager/R2', () => {
  const getObject = jest.fn(async (key, bucketName) => {
    const storageKey = `${bucketName}:${key}`;
    if (mockStorage.has(storageKey)) {
      return {
        Body: [Buffer.from(mockStorage.get(storageKey), 'utf8')]
      };
    }
    throw new Error('NoSuchKey');
  });
  const putObject = jest.fn(async (key, body, contentType, bucketName) => {
    const storageKey = `${bucketName}:${key}`;
    mockStorage.set(storageKey, body.toString('utf8'));
    return { success: true };
  });
  const deleteObject = jest.fn(async (key, bucketName) => {
    const storageKey = `${bucketName}:${key}`;
    mockStorage.delete(storageKey);
    return { success: true };
  });
  const ObjectExists = jest.fn(async (key, bucketName) => {
    const storageKey = `${bucketName}:${key}`;
    return mockStorage.has(storageKey);
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

describe('Info Model & API Endpoints', () => {
  afterEach(() => {
    mockStorage.clear();
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
    test('creates and returns default store information in R2 when file does not exist', async () => {
      const res = await request(app).get('/api/info');
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('email');
      expect(res.body.data).toHaveProperty('showPrice');

      // Verify that R2 mock storage now holds the created default info file
      const stored = mockStorage.get('prket-andlos:info/info.json');
      expect(stored).toBeDefined();
      const parsed = JSON.parse(stored);
      expect(parsed.email).toBe(Info.getDefaults().email);
    });
  });

  describe('POST /api/info', () => {
    test('updates store information successfully in R2 bucket prket-andlos', async () => {
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

      // Verify that subsequent GET /api/info returns the R2 stored data
      const getRes = await request(app).get('/api/info');
      expect(getRes.statusCode).toBe(200);
      expect(getRes.body.data.email).toBe('newemail@prket.com');
      expect(getRes.body.data.location).toBe('New Location');
    });
  });
});
