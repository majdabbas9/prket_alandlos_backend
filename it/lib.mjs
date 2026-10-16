// Shared helpers for the post-deploy integration tests (it/*.test.mjs). They run against the
// live API Worker, using only Node built-ins (node:test + fetch), so no npm install. Run by
// .github/workflows/integration-tests.yml after each publish run deploys to dev.
//   API_URL                          backend Worker URL (default: dev's workers.dev URL)
//   AUTH_URL                         admin backend Worker URL, for logging in (default: dev's)
//   ADMIN_USERNAME / ADMIN_PASSWORD  admin credentials; tests that need a token skip without them
//   IT_READY_TIMEOUT_MS              how long to wait for a cold API to answer (default 240000)

import { deflateSync } from 'node:zlib';

export const API_URL = (
  process.env.API_URL || 'https://prket-alandlos-backend.majd-abbas222.workers.dev'
).replace(/\/+$/, '');
export const AUTH_URL = (
  process.env.AUTH_URL || 'https://prket-alandlos-auth.majd-abbas222.workers.dev'
).replace(/\/+$/, '');
export const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
export const hasCredentials = Boolean(ADMIN_USERNAME && ADMIN_PASSWORD);

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * fetch against API_URL (or baseUrl); returns { status, headers, body } with body parsed as JSON
 * when it is JSON. `body` is sent as JSON, `form` (a FormData) as multipart.
 */
export async function request(
  method,
  path,
  { body, form, token, headers = {}, baseUrl = API_URL } = {},
) {
  const init = { method, headers: { ...headers }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) };
  if (token) init.headers.Authorization = `Bearer ${token}`;
  if (form !== undefined) {
    init.body = form;
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${baseUrl}${path}`, init);
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  return {
    status: res.status,
    headers: res.headers,
    body: isJson ? await res.json() : await res.arrayBuffer(),
  };
}

/**
 * Containers sleep after 15 min idle and a fresh deploy rolls them, so the first requests
 * can fail or hang while one cold-starts. Polls until `isReady(res)` holds.
 */
export async function waitUntilReady(
  method,
  path,
  isReady,
  { timeoutMs = Number(process.env.IT_READY_TIMEOUT_MS) || 240_000, body } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let last = 'no response';
  while (Date.now() < deadline) {
    try {
      const res = await request(method, path, { body });
      if (res.status === 503 && res.body?.error === 'Service temporarily unavailable') {
        throw new Error(
          'API is switched off (Power workflow) - turn it on before running the tests',
        );
      }
      if (isReady(res)) return;
      last = `HTTP ${res.status}`;
    } catch (err) {
      if (err.message.startsWith('API is switched off')) throw err;
      last = err.message;
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  throw new Error(`${method} ${path} not ready after ${timeoutMs / 1000}s (last: ${last})`);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** A valid solid-colour RGB PNG built with Node built-ins only (the IT has no npm install). */
export function makePng(width = 64, height = 48) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([len, typed, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit, truecolour, no interlace
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x8b)]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(Array(height).fill(row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Logs in as the admin (on the admin backend Worker) and returns the JWT. */
export async function login() {
  const res = await request('POST', '/auth/login', {
    baseUrl: AUTH_URL,
    body: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
  });
  if (res.status !== 200 || !res.body?.token) {
    throw new Error(`Admin login failed (HTTP ${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.token;
}
