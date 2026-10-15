import { Container, getContainer } from '@cloudflare/containers';

export { ContainerProxy } from '@cloudflare/containers';

interface Env {
  BACKEND: DurableObjectNamespace<Backend>;
  // The same bucket the backend reads over the S3 API, bound directly for serving images
  BUCKET: R2Bucket;
  // The backend's cache (products, store info), reached from the container through CACHE_HOST
  CACHE: KVNamespace;
  R2_BUCKET_NAME: string;
  // Public domain of the R2 bucket; when set, clients load product images from it directly
  R2_PUBLIC_URL?: string;
  // The admin backend Worker (prket_alandlos_admin_backend), which validates admin tokens
  AUTH_URL: string;
  ACCESS_KEY_ID: string;
  SECRET_ACCESS_KEY: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  // "true" = API switched off (set by prket_alandlos_infra's power.yml)
  API_DISABLED?: string;
}

const ENV_FINGERPRINT_KEY = 'envFingerprint';

async function fingerprint(vars: Record<string, string> | undefined): Promise<string> {
  const json = JSON.stringify(Object.entries(vars ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// The backend's cacheManager talks to CACHE_URL; requests to this fake host are served
// from the CACHE KV namespace (see handleCache), so the cache needs no server of its own.
const CACHE_HOST = 'cache.internal';
// Cache keys are fixed names (cacheManager.KEYS in src/utils/cacheManager.js)
const CACHE_KEY = /^[a-z0-9_]{1,64}$/;

/**
 * cache.internal protocol (src/utils/cacheManager.js):
 *   GET /<key> -> 200 value | 404, HEAD /<key> -> 200 | 404, PUT /<key> (body = value),
 *   DELETE /<key>, DELETE / (every key)
 * KV is eventually consistent across locations, but the container and this handler always
 * run in the same one, where a write is visible to the next read straight away.
 */
async function handleCache(request: Request, env: Env): Promise<Response> {
  const key = decodeURIComponent(new URL(request.url).pathname.slice(1));
  if (request.method === 'DELETE' && key === '') {
    let cursor: string | undefined;
    do {
      const page = await env.CACHE.list({ cursor });
      await Promise.all(page.keys.map(({ name }) => env.CACHE.delete(name)));
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return new Response(null, { status: 204 });
  }
  if (!CACHE_KEY.test(key)) return new Response('Invalid cache key', { status: 400 });

  switch (request.method) {
    case 'GET':
    case 'HEAD': {
      const value = await env.CACHE.get(key, 'stream');
      if (value === null) return new Response(null, { status: 404 });
      return new Response(request.method === 'HEAD' ? null : value, {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    case 'PUT':
      await env.CACHE.put(key, await request.text());
      return new Response(null, { status: 204 });
    case 'DELETE':
      await env.CACHE.delete(key);
      return new Response(null, { status: 204 });
    default:
      return new Response(null, { status: 405 });
  }
}

/**
 * The backend container (server.js on port 8080).
 * A running container keeps the env vars it was started with, so new Worker secrets (rotated
 * R2 keys) would never reach it while it stays warm. It records a hash of its env on start;
 * the first request after a deploy restarts it if that env has changed.
 */
export class Backend extends Container<Env> {
  defaultPort = 8080;
  // Stay warm for a while after the last request; the cache (KV) survives restarts.
  sleepAfter = '15m';
  enableInternet = true; // R2, AUTH_URL

  private envChecked?: Promise<void>;

  // Must be an assignment, not a `static outboundByHost = ...` field: the library registers
  // handlers through an inherited static setter, and an ES2022 class field defines an own
  // property that skips it - cache.internal then leaks to the internet and fails.
  static {
    this.outboundByHost = {
      [CACHE_HOST]: (req: Request, env: Env) => handleCache(req, env),
    };
  }

  constructor(ctx: DurableObjectState<{}>, env: Env) {
    super(ctx, env);
    this.envVars = {
      NODE_ENV: 'production',
      PORT: String(this.defaultPort),
      CACHE_URL: `http://${CACHE_HOST}`,
      ACCESS_KEY_ID: env.ACCESS_KEY_ID,
      SECRET_ACCESS_KEY: env.SECRET_ACCESS_KEY,
      R2_BUCKET_NAME: env.R2_BUCKET_NAME,
      R2_ENDPOINT: `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      ...(env.R2_PUBLIC_URL && { R2_PUBLIC_URL: env.R2_PUBLIC_URL }),
      ADMIN_BACKEND_URL: env.AUTH_URL,
    };
  }

  override async onStart(): Promise<void> {
    await this.ctx.storage.put(ENV_FINGERPRINT_KEY, await fingerprint(this.envVars));
  }

  override async fetch(request: Request): Promise<Response> {
    // Env only changes with a new Worker version, which gets a fresh Durable Object instance
    this.envChecked ??= (async () => {
      if (!this.ctx.container?.running) return;
      const started = await this.ctx.storage.get<string>(ENV_FINGERPRINT_KEY);
      if (started === (await fingerprint(this.envVars))) return;
      console.log('Container env changed since it started, restarting it');
      await this.destroy();
    })();
    await this.envChecked;
    return super.fetch(request);
  }
}

// Product image keys are unique per upload and never rewritten (see src/models/Product.js)
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const PHOTO_PATH = '/api/products/photo';

/**
 * Serves GET /api/products/photo?key=products/... straight from R2, so image requests never
 * wake the backend container or pass through Express. Returns null for keys it doesn't
 * handle, which then go to the container as before.
 */
async function servePhoto(request: Request, env: Env): Promise<Response | null> {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key') ?? searchParams.get('url');
  if (!key || !key.startsWith('products/') || key.endsWith('.json')) return null;

  const object = await env.BUCKET.get(key, { onlyIf: request.headers });
  if (!object) {
    return Response.json(
      { success: false, error: 'Image not found in storage' },
      { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } },
    );
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  headers.set('Last-Modified', object.uploaded.toUTCString());
  headers.set('Cache-Control', IMMUTABLE_CACHE_CONTROL);
  headers.set('Access-Control-Allow-Origin', '*');
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'image/jpeg');

  // No body means the If-None-Match / If-Modified-Since precondition matched
  if (!('body' in object)) return new Response(null, { status: 304, headers });
  headers.set('Content-Length', String(object.size));
  return new Response(request.method === 'HEAD' ? null : object.body, { headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Switched off: never wake the container. A running one gets no traffic and
    // shuts down gracefully once sleepAfter elapses; nothing is deleted.
    if (env.API_DISABLED === 'true') {
      return Response.json({ error: 'Service temporarily unavailable' }, { status: 503, headers: { 'Retry-After': '3600' } });
    }
    const { pathname } = new URL(request.url);
    if (pathname === PHOTO_PATH && (request.method === 'GET' || request.method === 'HEAD')) {
      const photo = await servePhoto(request, env);
      if (photo) return photo;
    }
    return getContainer(env.BACKEND).fetch(request);
  },
} satisfies ExportedHandler<Env>;
