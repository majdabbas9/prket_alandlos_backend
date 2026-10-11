const Homepage = require('../src/models/Homepage');
const Logo = require('../src/models/Logo');
const R2 = require('../src/cloudManager/R2');
const { ensureDefaults, DEFAULTS } = require('../src/utils/ensureDefaults');

// Mock R2 with an in-memory store that implements the conditional put
const mockStorage = new Map();
jest.mock('../src/cloudManager/R2', () => {
  const notFound = () => Object.assign(new Error('NotFound'), { name: 'NotFound' });
  return {
    headObject: jest.fn(async (key) => {
      if (!mockStorage.has(key)) throw notFound();
      return { ContentLength: mockStorage.get(key).body.length };
    }),
    putObjectIfAbsent: jest.fn(async (key, body, contentType) => {
      if (mockStorage.has(key)) return false;
      mockStorage.set(key, { body, contentType });
      return true;
    }),
    isNotFound: (err) => err.name === 'NotFound',
  };
});

const r2Outage = () =>
  Object.assign(new Error('Service Unavailable'), {
    name: 'InternalError',
    $metadata: { httpStatusCode: 503 },
  });

const ALL_KEYS = DEFAULTS.map((d) => d.key);
const headObjectImpl = R2.headObject.getMockImplementation();

describe('ensureDefaults (startup bootstrap)', () => {
  beforeEach(() => {
    mockStorage.clear();
    jest.clearAllMocks();
    R2.headObject.mockImplementation(headObjectImpl);
    // Avoid downloading images from the internet
    jest
      .spyOn(Homepage, 'downloadOrGenerateParketImage')
      .mockResolvedValue({ buffer: Buffer.from('home'), mimeType: 'image/jpeg' });
    jest
      .spyOn(Logo, 'downloadOrGenerateParketLogoImage')
      .mockResolvedValue({ buffer: Buffer.from('logo'), mimeType: 'image/jpeg' });
  });

  it('covers products, every info language and both images', () => {
    expect(ALL_KEYS).toEqual(
      expect.arrayContaining([
        'products/products.json',
        'info/info.json',
        'info/info-ar.json',
        'info/info-he.json',
        'homePage/homepageImage',
        'logo/logoImage',
      ]),
    );
  });

  it('creates every missing object with its default content', async () => {
    const status = await ensureDefaults({ retryDelayMs: 0 });

    for (const key of ALL_KEYS) expect(status[key]).toBe('created');
    expect(JSON.parse(mockStorage.get('products/products.json').body)).toEqual([]);
    expect(JSON.parse(mockStorage.get('info/info-ar.json').body).lang).toBe('ar');
    expect(mockStorage.get('homePage/homepageImage').body.toString()).toBe('home');
    expect(mockStorage.get('logo/logoImage').body.toString()).toBe('logo');
  });

  it('leaves existing objects untouched', async () => {
    const products = { body: Buffer.from('[{"id":"real"}]'), contentType: 'application/json' };
    mockStorage.set('products/products.json', products);

    const status = await ensureDefaults({ retryDelayMs: 0 });

    expect(status['products/products.json']).toBe('exists');
    expect(R2.putObjectIfAbsent).not.toHaveBeenCalledWith(
      'products/products.json',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(mockStorage.get('products/products.json')).toBe(products);
  });

  it('does not download images that already exist', async () => {
    mockStorage.set('homePage/homepageImage', { body: Buffer.from('real') });
    mockStorage.set('logo/logoImage', { body: Buffer.from('real') });

    await ensureDefaults({ retryDelayMs: 0 });

    expect(Homepage.downloadOrGenerateParketImage).not.toHaveBeenCalled();
    expect(Logo.downloadOrGenerateParketLogoImage).not.toHaveBeenCalled();
  });

  it('throws without writing anything when R2 keeps failing', async () => {
    R2.headObject.mockImplementation(async () => {
      throw r2Outage();
    });

    await expect(ensureDefaults({ retryDelayMs: 0 })).rejects.toThrow('Service Unavailable');
    expect(R2.putObjectIfAbsent).not.toHaveBeenCalled();
    expect(R2.headObject).toHaveBeenCalledTimes(ALL_KEYS.length * 3);
  });

  it('retries transient R2 errors before giving up', async () => {
    R2.headObject.mockImplementationOnce(async () => {
      throw r2Outage();
    });

    const status = await ensureDefaults({ retryDelayMs: 0 });

    for (const key of ALL_KEYS) expect(status[key]).toBe('created');
  });
});
