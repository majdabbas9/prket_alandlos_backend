// The auth middleware is bypassed when NODE_ENV === 'test', so every other suite runs without
// it. This suite switches NODE_ENV for its duration to exercise the real token check, against a
// fake admin backend (global.fetch), and to prove every write route is actually protected.
const request = require('supertest');
const app = require('../app');
const R2 = require('../src/cloudManager/R2');

jest.mock('../src/cloudManager/R2', () => {
  const fail = () => {
    throw new Error('R2 must not be reached in auth tests');
  };
  return {
    getObject: jest.fn(async () => {
      throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
    }),
    headObject: jest.fn(fail),
    putObject: jest.fn(fail),
    deleteObject: jest.fn(fail),
    isNotFound: (err) => err.name === 'NoSuchKey',
  };
});

const VALIDATE_URL = `${process.env.ADMIN_BACKEND_URL || 'http://localhost:5001'}/auth/validate`;
const realFetch = global.fetch;

const WRITE_ROUTES = [
  ['post', '/api/products'],
  ['put', '/api/products/some-id'],
  ['delete', '/api/products/some-id'],
  ['post', '/api/info'],
  ['post', '/api/homepage-image'],
  ['post', '/api/logo'],
  ['post', '/api/logo-image'],
];

// Fake admin backend: "good" is an admin's token, "viewer" a valid token for a non-admin role
const adminBackend = jest.fn(async (url, { headers }) => {
  const role = { 'Bearer good': 'admin', 'Bearer viewer': 'viewer' }[headers.Authorization];
  const ok = Boolean(role);
  return new Response(
    JSON.stringify(
      ok
        ? { success: true, data: { username: 'someone', role } }
        : { success: false, message: 'Invalid token' },
    ),
    { status: ok ? 200 : 401, headers: { 'Content-Type': 'application/json' } },
  );
});

describe('auth middleware (NODE_ENV != test)', () => {
  beforeAll(() => {
    process.env.NODE_ENV = 'development';
  });

  afterAll(() => {
    process.env.NODE_ENV = 'test';
    global.fetch = realFetch;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = adminBackend;
  });

  it.each(WRITE_ROUTES)('%s %s returns 401 without a token', async (method, path) => {
    const res = await request(app)[method](path).send({ title: 'x' });
    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
    expect(adminBackend).not.toHaveBeenCalled();
    expect(R2.putObject).not.toHaveBeenCalled();
  });

  it('returns 401 for a non-Bearer Authorization header', async () => {
    const res = await request(app).post('/api/info').set('Authorization', 'Basic abc').send({});
    expect(res.statusCode).toBe(401);
    expect(adminBackend).not.toHaveBeenCalled();
  });

  it.each(WRITE_ROUTES)(
    '%s %s returns 401 when the admin backend rejects the token',
    async (method, path) => {
      const res = await request(app)[method](path).set('Authorization', 'Bearer bad').send({});
      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBe('Invalid token');
      expect(R2.putObject).not.toHaveBeenCalled();
    },
  );

  it('validates the token against the admin backend and lets a valid one through', async () => {
    // A valid token reaches the controller, which rejects the bad lang with 400
    const res = await request(app)
      .post('/api/info')
      .set('Authorization', 'Bearer good')
      .send({ lang: 'xx' });

    expect(res.statusCode).toBe(400);
    expect(adminBackend).toHaveBeenCalledTimes(1);
    const [url, init] = adminBackend.mock.calls[0];
    expect(url).toBe(VALIDATE_URL);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ token: 'good' });
  });

  it.each(WRITE_ROUTES)(
    '%s %s returns 403 for a valid token without the admin role',
    async (method, path) => {
      const res = await request(app)[method](path).set('Authorization', 'Bearer viewer').send({});
      expect(res.statusCode).toBe(403);
      expect(R2.putObject).not.toHaveBeenCalled();
    },
  );

  it('still checks tokens when NODE_ENV is test outside Jest', async () => {
    process.env.NODE_ENV = 'test';
    const workerId = process.env.JEST_WORKER_ID;
    delete process.env.JEST_WORKER_ID;
    try {
      const res = await request(app).post('/api/info').send({});
      expect(res.statusCode).toBe(401);
    } finally {
      process.env.JEST_WORKER_ID = workerId;
      process.env.NODE_ENV = 'development';
    }
  });

  it('returns 500 (not 200) when the admin backend is unreachable', async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const res = await request(app)
      .delete('/api/products/some-id')
      .set('Authorization', 'Bearer good');
    expect(res.statusCode).toBe(500);
    expect(res.body.success).toBe(false);
    expect(R2.putObject).not.toHaveBeenCalled();
  });

  it.each([
    '/api/health',
    '/api/products',
    '/api/products/some-id',
    '/api/info',
    '/api/products/photo?key=products/x.webp',
  ])('GET %s needs no token', async (path) => {
    const res = await request(app).get(path);
    expect(res.statusCode).not.toBe(401);
    expect(adminBackend).not.toHaveBeenCalled();
  });
});
