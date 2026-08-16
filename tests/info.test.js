const request = require('supertest');
const app = require('../app');
const Info = require('../src/models/Info');
const cacheManager = require('../src/utils/cacheManager');
const R2 = require('../src/cloudManager/R2');

const mockCache = new Map();
jest.mock('../src/utils/cacheManager', () => {
  return {
    KEYS: {
      HOMEPAGE_IMAGE: 'homepage_image',
      LOGO_IMAGE: 'logo_image',
      STORE_INFO: 'store_info',
      PRODUCTS: 'products'
    },
    init: jest.fn().mockResolvedValue(),
    get: jest.fn(async (key) => {
      const val = mockCache.get(key);
      return val ? JSON.parse(val) : null;
    }),
    set: jest.fn(async (key, value) => {
      mockCache.set(key, JSON.stringify(value));
    }),
    clear: jest.fn(async (key) => {
      if (key) mockCache.delete(key);
      else mockCache.clear();
    }),
    has: jest.fn(async (key) => mockCache.has(key))
  };
});

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
  afterEach(async () => {
    mockStorage.clear();
    await cacheManager.clear();
    jest.clearAllMocks();
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

    test('serves store info from cache on subsequent requests without calling R2.getObject', async () => {
      // First request populates cache
      await request(app).get('/api/info');
      expect(R2.getObject).not.toHaveBeenCalled(); // First request called ObjectExists and created default, then set cache

      // Reset getObject call count
      R2.getObject.mockClear();

      // Second GET request should hit the in-memory cache
      const res = await request(app).get('/api/info');
      expect(res.statusCode).toBe(200);
      expect(res.body.data.email).toBe(Info.getDefaults().email);
      expect(R2.getObject).not.toHaveBeenCalled();
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

  describe('cacheManager Utility Tests', () => {
    test('gets, sets and clears cacheManager', async () => {
      expect(await cacheManager.get(cacheManager.KEYS.STORE_INFO)).toBeNull();

      const sampleInfo = new Info({ email: 'cache@test.com' });
      await cacheManager.set(cacheManager.KEYS.STORE_INFO, sampleInfo);
      
      const retrieved = await cacheManager.get(cacheManager.KEYS.STORE_INFO);
      expect(retrieved.email).toBe(sampleInfo.email);

      await cacheManager.clear(cacheManager.KEYS.STORE_INFO);
      expect(await cacheManager.get(cacheManager.KEYS.STORE_INFO)).toBeNull();
    });
  });
});

