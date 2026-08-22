const request = require('supertest');
const app = require('../app');
const Info = require('../src/models/Info');
const EnglishInfo = require('../src/models/EnglishInfo');
const ArabicInfo = require('../src/models/ArabicInfo');
const HebrewInfo = require('../src/models/HebrewInfo');
const cacheManager = require('../src/utils/cacheManager');
const R2 = require('../src/cloudManager/R2');

const mockCache = new Map();
jest.mock('../src/utils/cacheManager', () => {
  return {
    KEYS: {
      HOMEPAGE_IMAGE: 'homepage_image',
      LOGO_IMAGE: 'logo_image',
      STORE_INFO: 'store_info',
      STORE_INFO_AR: 'store_info_ar',
      STORE_INFO_HE: 'store_info_he',
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
    test('Info is abstract and cannot be instantiated directly', () => {
      expect(() => new Info()).toThrow(/abstract/);
    });

    test('Info.getDefaults throws for the abstract base class', () => {
      expect(() => Info.getDefaults()).toThrow(/abstract/);
    });

    test('EnglishInfo instantiates with default values', () => {
      const info = new EnglishInfo();
      const defaults = EnglishInfo.getDefaults();

      expect(info.lang).toBe('en');
      expect(info.showPrice).toBe(defaults.showPrice);
      expect(info.email).toBe(defaults.email);
      expect(info.phone).toBe(defaults.phone);
      expect(info.location).toBe(defaults.location);
      expect(info.stats).toEqual(defaults.stats);
    });

    test('EnglishInfo instantiates with custom values', () => {
      const custom = {
        email: 'custom@example.com',
        phone: '+123456789',
        showPrice: false
      };
      const info = new EnglishInfo(custom);

      expect(info.email).toBe('custom@example.com');
      expect(info.phone).toBe('+123456789');
      expect(info.showPrice).toBe(false);
    });

    test('updates fields correctly', () => {
      const info = new EnglishInfo();
      info.update({
        email: 'updated@example.com',
        showPrice: 'false',
        contactTitle: 'New Contact Title'
      });

      expect(info.email).toBe('updated@example.com');
      expect(info.showPrice).toBe(false);
      expect(info.contactTitle).toBe('New Contact Title');
    });

    test('update ignores the lang field', () => {
      const info = new ArabicInfo();
      info.update({ lang: 'en', email: 'updated@example.com' });

      expect(info.lang).toBe('ar');
      expect(info.email).toBe('updated@example.com');
    });

    test('serializes to JSON correctly', () => {
      const info = new EnglishInfo({ heroTitle: 'Hero Title Test' });
      const json = info.toJSON();

      expect(json.lang).toBe('en');
      expect(json.heroTitle).toBe('Hero Title Test');
      expect(json.email).toBe(EnglishInfo.getDefaults().email);
      expect(json).not.toBeInstanceOf(Info);
    });

    test('parses from string or object via fromJSON', () => {
      const rawString = JSON.stringify({ email: 'str@example.com' });
      const fromStr = EnglishInfo.fromJSON(rawString);
      expect(fromStr).toBeInstanceOf(EnglishInfo);
      expect(fromStr.email).toBe('str@example.com');
      expect(fromStr.lang).toBe('en');

      const invalidStr = EnglishInfo.fromJSON('invalid json string');
      expect(invalidStr.email).toBe(EnglishInfo.getDefaults().email);
    });

    test('ArabicInfo instantiates with Arabic default values', () => {
      const info = new ArabicInfo();

      expect(info.lang).toBe('ar');
      expect(info.location).toBe('ألاندلوس باركيه كفر كنا');
      expect(info.description).toBe('ألاندلوس باركيه كفر كنا');
      expect(info.showroomTitle).toBe('موقف سيارات!');
      expect(info.storeOpeningTime).toBe('الأحد — الجمعة 10:00 صباحًا — 6:00 مساءً');
      expect(info.stats[0].label).toBe('سنوات من الخبرة');
      expect(info.stats[3].label).toBe('متوسط التقييم');

      // Neutral fields identical across languages
      expect(info.email).toBe(EnglishInfo.getDefaults().email);
      expect(info.phone).toBe(EnglishInfo.getDefaults().phone);
      expect(info.whatsappLink).toBe(EnglishInfo.getDefaults().whatsappLink);
      expect(info.showPrice).toBe(EnglishInfo.getDefaults().showPrice);
    });

    test('HebrewInfo instantiates with Hebrew default values', () => {
      const info = new HebrewInfo();

      expect(info.lang).toBe('he');
      expect(info.location).toBe('אלנדלוס פרקט כפר כנא');
      expect(info.storeOpeningTime).toBe('ראשון — שישי 10:00 — 18:00');
      expect(info.stats[0].label).toBe('שנות ניסיון');
      expect(info.stats[3].label).toBe('דירוג ממוצע');

      // Neutral fields identical across languages
      expect(info.email).toBe(EnglishInfo.getDefaults().email);
      expect(info.phone).toBe(EnglishInfo.getDefaults().phone);
      expect(info.whatsappLink).toBe(EnglishInfo.getDefaults().whatsappLink);
      expect(info.showPrice).toBe(EnglishInfo.getDefaults().showPrice);
    });

    test('ArabicInfo.fromJSON builds an ArabicInfo with Arabic defaults fill-in', () => {
      const fromJson = ArabicInfo.fromJSON('{"email":"x@y.com"}');

      expect(fromJson).toBeInstanceOf(ArabicInfo);
      expect(fromJson.email).toBe('x@y.com');
      expect(fromJson.lang).toBe('ar');
      expect(fromJson.description).toBe('ألاندلوس باركيه كفر كنا');
    });

    test('HebrewInfo.fromJSON falls back to Hebrew defaults on invalid input', () => {
      const fromJson = HebrewInfo.fromJSON('not json');

      expect(fromJson).toBeInstanceOf(HebrewInfo);
      expect(fromJson.lang).toBe('he');
      expect(fromJson.email).toBe(EnglishInfo.getDefaults().email);
    });
  });

  describe('GET /api/info', () => {
    test('creates and returns default store information in R2 when file does not exist', async () => {
      const res = await request(app).get('/api/info');
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.lang).toBe('en');
      expect(res.body.data).toHaveProperty('email');
      expect(res.body.data).toHaveProperty('showPrice');

      // Verify that R2 mock storage now holds the created default info file
      const stored = mockStorage.get('prket-andlos:info/info.json');
      expect(stored).toBeDefined();
      const parsed = JSON.parse(stored);
      expect(parsed.lang).toBe('en');
      expect(parsed.email).toBe(EnglishInfo.getDefaults().email);
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
      expect(res.body.data.email).toBe(EnglishInfo.getDefaults().email);
      expect(R2.getObject).not.toHaveBeenCalled();
    });

    test('returns Arabic store info and creates only the Arabic R2 file when ?lang=ar', async () => {
      const res = await request(app).get('/api/info?lang=ar');
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.lang).toBe('ar');
      expect(res.body.data.description).toBe('ألاندلوس باركيه كفر كنا');

      expect(mockStorage.get('prket-andlos:info/info-ar.json')).toBeDefined();
      expect(mockStorage.has('prket-andlos:info/info.json')).toBe(false);
    });

    test('returns Hebrew store info and creates only the Hebrew R2 file when ?lang=he', async () => {
      const res = await request(app).get('/api/info?lang=he');
      expect(res.statusCode).toBe(200);
      expect(res.body.data.lang).toBe('he');
      expect(res.body.data.location).toBe('אלנדלוס פרקט כפר כנא');

      const stored = mockStorage.get('prket-andlos:info/info-he.json');
      expect(stored).toBeDefined();
      expect(JSON.parse(stored).lang).toBe('he');
      expect(mockStorage.has('prket-andlos:info/info.json')).toBe(false);
    });

    test('serves Arabic store info from cache on subsequent requests', async () => {
      // First request populates cache
      await request(app).get('/api/info?lang=ar');
      R2.getObject.mockClear();

      // Second GET request should hit the in-memory cache
      const res = await request(app).get('/api/info?lang=ar');
      expect(res.statusCode).toBe(200);
      expect(res.body.data.lang).toBe('ar');
      expect(R2.getObject).not.toHaveBeenCalled();
    });

    test('normalizes lang case and whitespace', async () => {
      const res = await request(app).get('/api/info?lang=AR');
      expect(res.statusCode).toBe(200);
      expect(res.body.data.lang).toBe('ar');
    });

    test('rejects unsupported language with 400', async () => {
      const res = await request(app).get('/api/info?lang=fr');
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/Unsupported language "fr"/);
      expect(mockStorage.size).toBe(0);
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

    test('updates the Arabic doc and propagates shared email to other languages', async () => {
      const res = await request(app)
        .post('/api/info')
        .send({ lang: 'ar', email: 'ar@prket.com', location: 'كفر كنا' });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.lang).toBe('ar');
      expect(res.body.data.email).toBe('ar@prket.com');

      // Arabic doc has the update
      const arDoc = JSON.parse(mockStorage.get('prket-andlos:info/info-ar.json'));
      expect(arDoc.lang).toBe('ar');
      expect(arDoc.email).toBe('ar@prket.com');
      expect(arDoc.location).toBe('كفر كنا');

      // Shared email propagated; language-specific fields stay their own defaults
      const enDoc = JSON.parse(mockStorage.get('prket-andlos:info/info.json'));
      expect(enDoc.email).toBe('ar@prket.com');
      expect(enDoc.location).toBe(EnglishInfo.getDefaults().location);

      const heDoc = JSON.parse(mockStorage.get('prket-andlos:info/info-he.json'));
      expect(heDoc.email).toBe('ar@prket.com');
      expect(heDoc.location).toBe(HebrewInfo.getDefaults().location);

      // Arabic GET returns the update; English GET serves the propagated doc
      const getAr = await request(app).get('/api/info?lang=ar');
      expect(getAr.body.data.email).toBe('ar@prket.com');
      expect(getAr.body.data.location).toBe('كفر كنا');

      const getEn = await request(app).get('/api/info');
      expect(getEn.body.data.email).toBe('ar@prket.com');
      expect(getEn.body.data.location).toBe(EnglishInfo.getDefaults().location);
    });

    test('updates the Hebrew doc and propagates shared phone to other languages', async () => {
      const res = await request(app)
        .post('/api/info')
        .send({ lang: 'he', phone: '055-1234567' });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.lang).toBe('he');
      expect(res.body.data.phone).toBe('055-1234567');

      const heDoc = JSON.parse(mockStorage.get('prket-andlos:info/info-he.json'));
      expect(heDoc.phone).toBe('055-1234567');
      expect(heDoc.location).toBe(HebrewInfo.getDefaults().location);

      const enDoc = JSON.parse(mockStorage.get('prket-andlos:info/info.json'));
      expect(enDoc.phone).toBe('055-1234567');
      expect(enDoc.email).toBe(EnglishInfo.getDefaults().email);

      const arDoc = JSON.parse(mockStorage.get('prket-andlos:info/info-ar.json'));
      expect(arDoc.phone).toBe('055-1234567');
      expect(arDoc.location).toBe(ArabicInfo.getDefaults().location);
    });

    test('propagates showPrice/email/phone/whatsappLink changes to all languages', async () => {
      const res = await request(app)
        .post('/api/info')
        .send({
          lang: 'ar',
          email: 'shared@prket.com',
          phone: '055-5555555',
          whatsappLink: 'wa.me/shared',
          showPrice: true
        });

      expect(res.statusCode).toBe(200);

      const enDoc = JSON.parse(mockStorage.get('prket-andlos:info/info.json'));
      const arDoc = JSON.parse(mockStorage.get('prket-andlos:info/info-ar.json'));
      const heDoc = JSON.parse(mockStorage.get('prket-andlos:info/info-he.json'));

      for (const doc of [enDoc, arDoc, heDoc]) {
        expect(doc.email).toBe('shared@prket.com');
        expect(doc.phone).toBe('055-5555555');
        expect(doc.whatsappLink).toBe('wa.me/shared');
        expect(doc.showPrice).toBe(true);
      }

      // Language-specific fields stay distinct
      expect(enDoc.lang).toBe('en');
      expect(enDoc.location).toBe(EnglishInfo.getDefaults().location);
      expect(arDoc.lang).toBe('ar');
      expect(arDoc.location).toBe(ArabicInfo.getDefaults().location);
      expect(heDoc.lang).toBe('he');
      expect(heDoc.location).toBe(HebrewInfo.getDefaults().location);
    });

    test('treats empty lang as English', async () => {
      const res = await request(app)
        .post('/api/info')
        .send({ lang: '', email: 'e@x.com' });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.lang).toBe('en');

      const stored = mockStorage.get('prket-andlos:info/info.json');
      expect(stored).toBeDefined();
      expect(JSON.parse(stored).email).toBe('e@x.com');
    });

    test('rejects unsupported language with 400 without writing to R2', async () => {
      const res = await request(app)
        .post('/api/info')
        .send({ lang: 'xx', email: 'xx@prket.com' });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/Unsupported language "xx"/);
      expect(mockStorage.size).toBe(0);
    });
  });

  describe('cacheManager Utility Tests', () => {
    test('gets, sets and clears cacheManager for all languages', async () => {
      expect(await cacheManager.get(cacheManager.KEYS.STORE_INFO)).toBeNull();

      const sampleEn = new EnglishInfo({ email: 'cache@test.com' });
      await cacheManager.set(cacheManager.KEYS.STORE_INFO, sampleEn);

      const retrievedEn = await cacheManager.get(cacheManager.KEYS.STORE_INFO);
      expect(retrievedEn.email).toBe(sampleEn.email);
      expect(retrievedEn.lang).toBe('en');

      const sampleAr = new ArabicInfo({ email: 'cache-ar@test.com' });
      await cacheManager.set(cacheManager.KEYS.STORE_INFO_AR, sampleAr);

      const retrievedAr = await cacheManager.get(cacheManager.KEYS.STORE_INFO_AR);
      expect(retrievedAr.email).toBe(sampleAr.email);
      expect(retrievedAr.lang).toBe('ar');

      const sampleHe = new HebrewInfo({ email: 'cache-he@test.com' });
      await cacheManager.set(cacheManager.KEYS.STORE_INFO_HE, sampleHe);

      const retrievedHe = await cacheManager.get(cacheManager.KEYS.STORE_INFO_HE);
      expect(retrievedHe.email).toBe(sampleHe.email);
      expect(retrievedHe.lang).toBe('he');

      await cacheManager.clear(cacheManager.KEYS.STORE_INFO);
      expect(await cacheManager.get(cacheManager.KEYS.STORE_INFO)).toBeNull();
      await cacheManager.clear(cacheManager.KEYS.STORE_INFO_AR);
      expect(await cacheManager.get(cacheManager.KEYS.STORE_INFO_AR)).toBeNull();
      await cacheManager.clear(cacheManager.KEYS.STORE_INFO_HE);
      expect(await cacheManager.get(cacheManager.KEYS.STORE_INFO_HE)).toBeNull();
    });
  });
});
