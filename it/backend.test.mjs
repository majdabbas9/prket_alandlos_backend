// Integration tests for the deployed main backend (/api/* on the API Worker).
//
// The catalog and store info are live data that change at any time, so these tests never assert
// specific names, counts, prices, ids or ordering of real content. They check that things work:
// status codes, response shape, filter/sort/pagination invariants, auth, validation and 404s.
//
// Writes (only with ADMIN_USERNAME / ADMIN_PASSWORD) touch nothing that already exists:
//  - throwaway products are created and deleted again (deleting a product also deletes its
//    images, so the uploaded test photo is removed from R2 too); `after` cleans up leftovers
//  - one store-info field is changed and put back to its original value
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request, waitUntilReady, login, hasCredentials, makePng } from './lib.mjs';

const needsCredentials = { skip: !hasCredentials && 'ADMIN_USERNAME / ADMIN_PASSWORD not set' };
const RUN_ID = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
const MISSING_ID = `prod_it-does-not-exist-${RUN_ID}`;
const DETAIL_FIELDS = ['woodType', 'finish', 'thickness', 'plankSize', 'tag'];
const INFO_STRING_FIELDS = [
  'lang',
  'storeOpeningTime',
  'email',
  'phone',
  'whatsappLink',
  'location',
  'description',
  'showroomEyebrow',
  'showroomTitle',
  'showroomDescription',
  'contactEyebrow',
  'contactTitle',
  'contactDescription',
];
const IMMUTABLE = /max-age=31536000/;

const isDate = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value));

function assertProductShape(p) {
  const where = `product ${JSON.stringify(p?.id)}`;
  assert.equal(typeof p.id, 'string', where);
  assert.ok(p.id.length > 0, where);
  assert.equal(typeof p.title, 'string', where);
  assert.equal(typeof p.price, 'number', where);
  assert.ok(Number.isFinite(p.price), `${where}: price is not finite`);
  assert.equal(typeof p.category, 'string', where);
  assert.equal(typeof p.description, 'string', where);
  assert.equal(typeof p.imageKey, 'string', where);
  assert.ok(isDate(p.dateOfUpload), `${where}: dateOfUpload`);
  if (p.updatedAt !== undefined) assert.ok(isDate(p.updatedAt), `${where}: updatedAt`);
  if (p.thumbKey !== undefined) assert.equal(typeof p.thumbKey, 'string', where);
  for (const f of DETAIL_FIELDS) {
    if (p[f] !== undefined) assert.equal(typeof p[f], 'string', `${where}: ${f}`);
  }
  for (const f of ['imageUrl', 'thumbUrl']) {
    if (p[f] !== undefined) assert.match(p[f], /^https?:\/\//, `${where}: ${f}`);
  }
}

async function listProducts(query = '') {
  const res = await request('GET', `/api/products${query}`);
  assert.equal(res.status, 200, `GET /api/products${query}`);
  assert.equal(res.body.success, true);
  assert.ok(Array.isArray(res.body.data));
  assert.equal(res.body.count, res.body.data.length);
  return res.body;
}

function assertSorted(values, cmp, label) {
  for (let i = 1; i < values.length; i++) {
    assert.ok(cmp(values[i - 1], values[i]) <= 0, `${label}: out of order at index ${i}`);
  }
}

before(async () => {
  await waitUntilReady(
    'GET',
    '/api/health',
    (res) => res.status === 200 && res.body?.status === 'ok',
  );
});

// ---------------------------------------------------------------- health / routing

test('health reports ok', async () => {
  const res = await request('GET', '/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.ok(isDate(res.body.timestamp));
});

test('unknown endpoint returns 404 JSON', async () => {
  const res = await request('GET', '/api/does-not-exist');
  assert.equal(res.status, 404);
  assert.equal(res.body.success, false);
  assert.equal(typeof res.body.error, 'string');
});

// ---------------------------------------------------------------- products (read)

test('lists products with a valid shape and unique ids', async () => {
  const { data } = await listProducts();
  data.forEach(assertProductShape);
  assert.equal(new Set(data.map((p) => p.id)).size, data.length, 'duplicate product ids');
});

test('sorts products', async () => {
  const byDate = (p) => Date.parse(p.dateOfUpload);
  const cases = {
    newest: [byDate, (a, b) => b - a],
    oldest: [byDate, (a, b) => a - b],
    price_asc: [(p) => p.price, (a, b) => a - b],
    price_desc: [(p) => p.price, (a, b) => b - a],
  };
  for (const [sort, [key, cmp]] of Object.entries(cases)) {
    const { data } = await listProducts(`?sort=${sort}`);
    assertSorted(data.map(key), cmp, sort);
  }
  // Default order is newest first
  const { data } = await listProducts();
  assertSorted(data.map(byDate), cases.newest[1], 'default');
});

test('search only returns matching products', async (t) => {
  const all = (await listProducts()).data;
  const source = all.find((p) => p.title.trim().length >= 3);
  if (!source) return t.skip('no product with a searchable title');

  const term = source.title.trim().slice(0, 3);
  const { data } = await listProducts(`?search=${encodeURIComponent(term)}`);
  const needle = term.toLowerCase();
  for (const p of data) {
    assert.ok(
      [p.title, p.description, p.category].some((v) => v?.toLowerCase().includes(needle)),
      `"${p.id}" does not match "${term}"`,
    );
  }
  assert.ok(
    data.some((p) => p.id === source.id),
    'the product the term came from is missing',
  );

  const none = await listProducts(`?search=it-no-match-${RUN_ID}`);
  assert.equal(none.count, 0);
});

test('category filter only returns that category (case-insensitive)', async (t) => {
  const all = (await listProducts()).data;
  const source = all.find((p) => p.category);
  if (!source) return t.skip('no products yet');

  const category = source.category;
  // Query in a different case where that round-trips cleanly
  const upper = category.toUpperCase();
  const query = upper.toLowerCase() === category.toLowerCase() ? upper : category;
  const { data } = await listProducts(`?category=${encodeURIComponent(query)}`);
  assert.ok(data.length > 0);
  for (const p of data) assert.equal(p.category.toLowerCase(), category.toLowerCase(), p.id);
  assert.ok(data.some((p) => p.id === source.id));

  const none = await listProducts(`?category=it-no-such-category-${RUN_ID}`);
  assert.equal(none.count, 0);
});

test('paginates products consistently', async () => {
  const all = await listProducts();
  const limit = 2;
  const first = await listProducts(`?page=1&limit=${limit}`);
  assert.equal(first.page, 1);
  assert.ok(first.count <= limit);
  assert.equal(typeof first.total, 'number');
  assert.equal(first.totalPages, Math.ceil(first.total / limit));
  assert.equal(first.count, Math.min(limit, first.total));
  // The first page is the head of the unpaginated list
  if (first.total === all.count) {
    assert.deepEqual(
      first.data.map((p) => p.id),
      all.data.slice(0, limit).map((p) => p.id),
    );
  }

  // A page past the end is empty, not an error
  const past = await listProducts(`?page=${first.totalPages + 1}&limit=${limit}`);
  assert.equal(past.count, 0);
  assert.equal(past.total, first.total);

  // Pagination applies after filtering
  const filtered = await listProducts(`?search=it-no-match-${RUN_ID}&page=1&limit=${limit}`);
  assert.equal(filtered.total, 0);
  assert.equal(filtered.totalPages, 0);
});

test('product detail matches the list entry', async (t) => {
  const { data } = await listProducts();
  if (data.length === 0) return t.skip('no products yet');
  const res = await request('GET', `/api/products/${encodeURIComponent(data[0].id)}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assertProductShape(res.body.data);
  assert.deepEqual(res.body.data, data[0]);
});

test('unknown product id returns 404', async () => {
  const res = await request('GET', `/api/products/${MISSING_ID}`);
  assert.equal(res.status, 404);
  assert.equal(res.body.success, false);
});

test('serves a product photo from R2 with caching headers', async (t) => {
  const { data } = await listProducts();
  const product = data.find((p) => p.imageKey?.startsWith('products/'));
  if (!product) return t.skip('no products with an image yet');

  for (const key of new Set([product.imageKey, product.thumbKey].filter(Boolean))) {
    const path = `/api/products/photo?key=${encodeURIComponent(key)}`;
    const res = await request('GET', path);
    assert.equal(res.status, 200, key);
    assert.match(res.headers.get('content-type'), /^image\//);
    assert.ok(res.body.byteLength > 0);
    assert.match(res.headers.get('cache-control') || '', IMMUTABLE);

    // ETag round-trip: an unchanged image answers 304
    const etag = res.headers.get('etag');
    assert.ok(etag, 'photo response should carry an ETag');
    const cached = await request('GET', path, { headers: { 'If-None-Match': etag } });
    assert.equal(cached.status, 304);
  }
});

test('product photo without a key returns 400', async () => {
  const res = await request('GET', '/api/products/photo');
  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
});

test('missing product photo returns 404', async () => {
  const res = await request('GET', `/api/products/photo?key=products/it-missing-${RUN_ID}.webp`);
  assert.equal(res.status, 404);
  assert.equal(res.body.success, false);
});

// ---------------------------------------------------------------- store info (read)

for (const lang of ['en', 'ar', 'he']) {
  test(`store info (${lang}) has the expected shape`, async () => {
    const res = await request('GET', `/api/info?lang=${lang}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    const info = res.body.data;
    assert.equal(info.lang, lang);
    assert.equal(typeof info.showPrice, 'boolean');
    for (const f of INFO_STRING_FIELDS) assert.equal(typeof info[f], 'string', f);
    assert.ok(Array.isArray(info.stats));
  });
}

test('store info lang is normalized and defaults to English', async () => {
  const upper = await request('GET', '/api/info?lang=AR');
  assert.equal(upper.status, 200);
  assert.equal(upper.body.data.lang, 'ar');

  const none = await request('GET', '/api/info');
  assert.equal(none.status, 200);
  assert.equal(none.body.data.lang, 'en');
});

test('unsupported info language returns 400', async () => {
  const res = await request('GET', '/api/info?lang=xx');
  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
});

// ---------------------------------------------------------------- homepage image / logo (read)

test('homepage image metadata, image and versioned URL', async () => {
  const meta = await request('GET', '/api/homepage-image?info=true');
  assert.equal(meta.status, 200);
  assert.equal(meta.body.success, true);
  const { key, mimeType, size, version, updatedAt } = meta.body.data;
  assert.equal(typeof key, 'string');
  assert.match(mimeType, /^image\//);
  assert.ok(Number.isInteger(size) && size > 0);
  assert.equal(typeof version, 'string');
  assert.ok(isDate(updatedAt));
  // Clients read the current version from here, so it must not be cached
  assert.match(meta.headers.get('cache-control') || '', /no-cache/);

  const img = await request('GET', '/api/homepage-image');
  assert.equal(img.status, 200);
  assert.match(img.headers.get('content-type'), /^image\//);
  assert.ok(img.body.byteLength > 0);

  // Only the ETag is checked here: fetch adds Cache-Control: no-cache to conditional requests,
  // which makes Express answer 200 instead of 304 (browsers don't; tests/homepage.test.js
  // covers the 304). Product photos are answered by the Worker, which does return 304.
  assert.ok(img.headers.get('etag'), 'homepage image should carry an ETag');

  const versioned = await request('GET', `/api/homepage-image?v=${encodeURIComponent(version)}`);
  assert.equal(versioned.status, 200);
  assert.match(versioned.headers.get('cache-control') || '', IMMUTABLE);
});

test('logo metadata and image (and its aliases)', async () => {
  const meta = await request('GET', '/api/logo?info=true');
  assert.equal(meta.status, 200);
  assert.equal(meta.body.success, true);
  assert.equal(typeof meta.body.data.key, 'string');
  assert.match(meta.body.data.mimeType, /^image\//);
  assert.ok(Number.isInteger(meta.body.data.size) && meta.body.data.size > 0);

  for (const path of ['/api/logo', '/api/logo-image', '/api/logo/12.jpg']) {
    const img = await request('GET', path);
    assert.equal(img.status, 200, path);
    assert.match(img.headers.get('content-type'), /^image\//, path);
    assert.ok(img.body.byteLength > 0, path);
  }
});

// ---------------------------------------------------------------- auth

const WRITE_ROUTES = [
  ['POST', '/api/products', { title: 'it', imageKey: 'products/it.webp' }],
  ['PUT', `/api/products/${MISSING_ID}`, { title: 'it' }],
  ['DELETE', `/api/products/${MISSING_ID}`],
  ['POST', '/api/info', { phone: '000' }],
  ['POST', '/api/homepage-image', {}],
  ['POST', '/api/logo', { logoUrl: '/uploads/logo/12.jpg' }],
];

test('writes are rejected without a token', async () => {
  for (const [method, path, body] of WRITE_ROUTES) {
    const res = await request(method, path, { body });
    assert.equal(res.status, 401, `${method} ${path}`);
    assert.equal(res.body.success, false);
  }
});

test('writes are rejected with an invalid token (validated by the admin backend)', async () => {
  // 401 (not 500) proves the backend reached the admin backend through auth.internal
  for (const [method, path, body] of WRITE_ROUTES) {
    const res = await request(method, path, { token: 'not-a-jwt', body });
    assert.equal(res.status, 401, `${method} ${path}`);
    assert.equal(res.body.success, false);
  }
});

// ---------------------------------------------------------------- admin (writes)

let token;
const getToken = async () => (token ??= await login());
const createdIds = new Set();
let infoRestore; // { lang, field, value } while a store-info field is changed

after(async () => {
  if (!hasCredentials || (createdIds.size === 0 && !infoRestore)) return;
  let auth;
  try {
    auth = await getToken();
  } catch (err) {
    console.error(`Cleanup: login failed: ${err.message}`);
    return;
  }
  // Clean up anything a failed test left behind
  for (const id of createdIds) {
    try {
      await request('DELETE', `/api/products/${id}`, { token: auth });
    } catch (err) {
      console.error(`Failed to clean up test product ${id}: ${err.message}`);
    }
  }
  if (infoRestore) {
    const { lang, field, value } = infoRestore;
    try {
      await request('POST', '/api/info', { token: auth, body: { lang, [field]: value } });
    } catch (err) {
      console.error(`Failed to restore store info ${lang}.${field}: ${err.message}`);
    }
  }
});

test(
  'admin writes with invalid input are rejected without changing anything',
  needsCredentials,
  async () => {
    const auth = await getToken();

    const noImage = await request('POST', '/api/products', {
      token: auth,
      body: { title: 'IT product without image' },
    });
    assert.equal(noImage.status, 400);
    assert.equal(noImage.body.success, false);

    const put = await request('PUT', `/api/products/${MISSING_ID}`, {
      token: auth,
      body: { price: 1 },
    });
    assert.equal(put.status, 404);
    const del = await request('DELETE', `/api/products/${MISSING_ID}`, { token: auth });
    assert.equal(del.status, 404);

    const badLang = await request('POST', '/api/info', {
      token: auth,
      body: { lang: 'xx', phone: '000' },
    });
    assert.equal(badLang.status, 400);

    for (const path of ['/api/homepage-image', '/api/logo']) {
      const noFile = await request('POST', path, { token: auth, body: {} });
      assert.equal(noFile.status, 400, path);
      assert.equal(noFile.body.success, false);
    }
  },
);

test('admin can create, find, update and delete a product', needsCredentials, async () => {
  const auth = await getToken();
  // Points at an image key that doesn't exist, so deleting the product removes no real image
  const imageKey = `products/it-${RUN_ID}.webp`;
  const title = `IT test product ${RUN_ID}`;

  const created = await request('POST', '/api/products', {
    token: auth,
    body: {
      title,
      price: '1.5',
      category: `it-test-${RUN_ID}`,
      description: 'created by CI',
      woodType: 'Oak',
      imageKey,
    },
  });
  if (created.body?.data?.id) createdIds.add(created.body.data.id);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const product = created.body.data;
  assertProductShape(product);
  assert.equal(product.title, title);
  assert.equal(product.price, 1.5);
  assert.equal(product.woodType, 'Oak');
  assert.equal(product.imageKey, imageKey);

  const fetched = await request('GET', `/api/products/${product.id}`);
  assert.equal(fetched.status, 200);
  assert.deepEqual(fetched.body.data, product);

  const found = await listProducts(`?category=${encodeURIComponent(product.category)}`);
  assert.deepEqual(
    found.data.map((p) => p.id),
    [product.id],
  );

  const updated = await request('PUT', `/api/products/${product.id}`, {
    token: auth,
    body: { price: 2 },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.price, 2);
  assert.equal(updated.body.data.title, title);
  assert.equal(updated.body.data.woodType, 'Oak');
  assert.ok(isDate(updated.body.data.updatedAt));

  const deleted = await request('DELETE', `/api/products/${product.id}`, { token: auth });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.data.id, product.id);
  createdIds.delete(product.id);

  const gone = await request('GET', `/api/products/${product.id}`);
  assert.equal(gone.status, 404);
  const notListed = await listProducts(`?category=${encodeURIComponent(product.category)}`);
  assert.equal(notListed.count, 0);
});

test(
  'admin can upload a product photo, and deleting the product removes it',
  needsCredentials,
  async () => {
    const auth = await getToken();
    const form = new FormData();
    form.append('title', `IT upload ${RUN_ID}`);
    form.append('price', '1');
    form.append('category', `it-test-${RUN_ID}`);
    form.append('image', new Blob([makePng()], { type: 'image/png' }), 'it.png');

    const created = await request('POST', '/api/products', { token: auth, form });
    if (created.body?.data?.id) createdIds.add(created.body.data.id);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const { id, imageKey, thumbKey } = created.body.data;
    assert.match(imageKey, /^products\/.+\.webp$/);
    assert.match(thumbKey, /^products\/.+-thumb\.webp$/);

    for (const key of [imageKey, thumbKey]) {
      const photo = await request('GET', `/api/products/photo?key=${encodeURIComponent(key)}`);
      assert.equal(photo.status, 200, key);
      assert.equal(photo.headers.get('content-type'), 'image/webp');
      assert.ok(photo.body.byteLength > 0);
    }

    const deleted = await request('DELETE', `/api/products/${id}`, { token: auth });
    assert.equal(deleted.status, 200);
    createdIds.delete(id);

    for (const key of [imageKey, thumbKey]) {
      const photo = await request('GET', `/api/products/photo?key=${encodeURIComponent(key)}`);
      assert.equal(photo.status, 404, `${key} was not removed from R2`);
    }
  },
);

test('admin can update store info, which is then restored', needsCredentials, async () => {
  const auth = await getToken();
  // A language-specific field, so the change doesn't propagate to the other languages
  const lang = 'en';
  const field = 'storeOpeningTime';
  const original = (await request('GET', `/api/info?lang=${lang}`)).body.data;
  const changed = `${original[field]} [it ${RUN_ID}]`;

  infoRestore = { lang, field, value: original[field] };
  const res = await request('POST', '/api/info', {
    token: auth,
    body: { lang, [field]: changed },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.data, { ...original, [field]: changed });

  const read = await request('GET', `/api/info?lang=${lang}`);
  assert.equal(read.body.data[field], changed);

  const restored = await request('POST', '/api/info', {
    token: auth,
    body: { lang, [field]: original[field] },
  });
  assert.equal(restored.status, 200);
  infoRestore = undefined;

  const final = await request('GET', `/api/info?lang=${lang}`);
  assert.deepEqual(final.body.data, original);
});
