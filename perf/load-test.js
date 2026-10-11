#!/usr/bin/env node
/**
 * Performance / load test for the deployed Prket Alandlos API.
 *
 * Only issues GET requests, so it is safe to run against production.
 *
 * Usage:
 *   npm run perf
 *   BASE_URL=http://localhost:8080 REQUESTS=100 CONCURRENCY=20 npm run perf
 *   npm run perf -- --endpoint "homepage image"   # one endpoint, by name
 *   npm run perf -- --endpoint /api/info?lang=ar  # one endpoint, by path
 *   npm run perf -- --list                        # list endpoint names
 *
 * Env vars:
 *   BASE_URL      target API (default: the deployed Cloudflare worker)
 *   REQUESTS      requests per endpoint (default 50)
 *   CONCURRENCY   parallel in-flight requests per endpoint (default 10)
 *   WARMUP        warm-up requests per endpoint, not measured (default 2)
 *   TIMEOUT_MS    per-request timeout (default 10000)
 *   MAX_P95_MS    fail if any endpoint's p95 exceeds this (default 2000)
 *   MAX_ERROR_PCT fail if any endpoint's error rate exceeds this (default 1)
 */

const BASE_URL = (
  process.env.BASE_URL || 'https://prket-alandlos-api.majd-abbas222.workers.dev'
).replace(/\/+$/, '');
const REQUESTS = parseInt(process.env.REQUESTS, 10) || 50;
const CONCURRENCY = parseInt(process.env.CONCURRENCY, 10) || 10;
const WARMUP = process.env.WARMUP !== undefined ? parseInt(process.env.WARMUP, 10) : 2;
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS, 10) || 10000;
const MAX_P95_MS = parseInt(process.env.MAX_P95_MS, 10) || 2000;
const MAX_ERROR_PCT =
  process.env.MAX_ERROR_PCT !== undefined ? Number(process.env.MAX_ERROR_PCT) : 1;

const ENDPOINTS = [
  { name: 'products list', path: '/api/products' },
  { name: 'products paginated', path: '/api/products?page=1&limit=10' },
  { name: 'products search', path: '/api/products?search=parquet&sort=newest' },
  { name: 'product by id', path: '/api/products/:id' },
  { name: 'info (en)', path: '/api/info?lang=en' },
  { name: 'info (ar)', path: '/api/info?lang=ar' },
  { name: 'info (he)', path: '/api/info?lang=he' },
  { name: 'homepage meta', path: '/api/homepage-image?info=true' },
  { name: 'homepage image', path: '/api/homepage-image' },
  { name: 'logo meta', path: '/api/logo?info=true' },
  { name: 'logo image', path: '/api/logo' },
  { name: '404 handler', path: '/api/does-not-exist', expectStatus: 404 },
];

async function timedRequest(url, expectStatus) {
  const start = process.hrtime.bigint();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = await res.arrayBuffer();
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const ok = expectStatus ? res.status === expectStatus : res.ok;
    return { ms, ok, status: res.status, bytes: body.byteLength };
  } catch (err) {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    return { ms, ok: false, status: err.name === 'TimeoutError' ? 'timeout' : 'error', bytes: 0 };
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function runEndpoint({ name, path, expectStatus }) {
  const url = BASE_URL + path;

  for (let i = 0; i < WARMUP; i++) await timedRequest(url, expectStatus);

  const results = [];
  let issued = 0;
  const wallStart = process.hrtime.bigint();
  const worker = async () => {
    while (issued < REQUESTS) {
      issued++;
      results.push(await timedRequest(url, expectStatus));
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, REQUESTS) }, worker));
  const wallMs = Number(process.hrtime.bigint() - wallStart) / 1e6;

  const latencies = results.map((r) => r.ms).sort((a, b) => a - b);
  const errors = results.filter((r) => !r.ok);
  const statusCounts = {};
  for (const e of errors) statusCounts[e.status] = (statusCounts[e.status] || 0) + 1;

  return {
    name,
    path,
    count: results.length,
    rps: results.length / (wallMs / 1000),
    min: latencies[0],
    avg: latencies.reduce((a, b) => a + b, 0) / latencies.length,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
    max: latencies[latencies.length - 1],
    errorCount: errors.length,
    errorPct: (errors.length / results.length) * 100,
    statusCounts,
    avgKb: results.reduce((a, r) => a + r.bytes, 0) / results.length / 1024,
  };
}

async function resolveProductId() {
  try {
    const res = await fetch(`${BASE_URL}/api/products?limit=1`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = await res.json();
    const list = Array.isArray(data) ? data : data.products || data.data || data.items || [];
    return list[0] && list[0].id;
  } catch {
    return undefined;
  }
}

// Colors only when printing to a terminal (keeps CI logs / redirected output clean)
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
const green = paint(32);
const red = paint(31);
const dim = paint(2);
const bold = paint(1);

const ms = (n) => `${n.toFixed(0)} ms`;
const verdict = (failed) => (failed ? red('FAIL') : green('PASS'));

// Pass/fail checks for one endpoint; returns human-readable failure reasons
function checkThresholds(s) {
  const reasons = [];
  if (s.p95 > MAX_P95_MS) reasons.push(`p95 ${ms(s.p95)} is over the ${ms(MAX_P95_MS)} limit`);
  if (s.errorPct > MAX_ERROR_PCT) {
    const byStatus = Object.entries(s.statusCounts)
      .map(([status, n]) => `${n}x ${status}`)
      .join(', ');
    reasons.push(
      `${s.errorCount} of ${s.count} requests failed (${s.errorPct.toFixed(1)}%, ` +
        `limit ${MAX_ERROR_PCT}%): ${byStatus}`,
    );
  }
  return reasons;
}

function printEndpointReport(s, reasons) {
  const row = (label, value) => console.log(`    ${dim(label.padEnd(15))}${value}`);
  console.log(`\n${verdict(reasons.length)}  ${bold(s.name)}  ${dim(s.path)}`);
  row(
    'Response time',
    `median ${ms(s.p50)}  ·  p95 ${ms(s.p95)} ${dim(`(limit ${ms(MAX_P95_MS)})`)}`,
  );
  row(
    '',
    dim(
      `fastest ${ms(s.min)}  ·  average ${ms(s.avg)}  ·  p99 ${ms(s.p99)}  ·  slowest ${ms(s.max)}`,
    ),
  );
  row('Throughput', `${s.rps.toFixed(1)} requests/sec`);
  row(
    'Errors',
    `${s.errorCount} of ${s.count} ${dim(`(${s.errorPct.toFixed(1)}%, limit ${MAX_ERROR_PCT}%)`)}`,
  );
  row('Response size', `${s.avgKb.toFixed(1)} KB ${dim('average body')}`);
  for (const r of reasons) console.log(`    ${red('x ' + r)}`);
}

function printSummaryTable(rows) {
  const header =
    'endpoint'.padEnd(20) +
    'median'.padStart(9) +
    'p95'.padStart(9) +
    'req/s'.padStart(8) +
    'errors'.padStart(10) +
    'size'.padStart(10) +
    '  result';
  console.log(`\n${bold('Summary')}`);
  console.log(dim(header));
  for (const { s, reasons } of rows) {
    console.log(
      s.name.padEnd(20) +
        ms(s.p50).padStart(9) +
        ms(s.p95).padStart(9) +
        s.rps.toFixed(1).padStart(8) +
        `${s.errorCount}/${s.count}`.padStart(10) +
        `${s.avgKb.toFixed(1)} KB`.padStart(10) +
        `  ${verdict(reasons.length)}`,
    );
  }
}

// Parse --endpoint <name|path> (also -e, --endpoint=<value>) and --list
function parseArgs(argv) {
  const args = { endpoint: undefined, list: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--list' || arg === '-l') args.list = true;
    else if (arg === '--endpoint' || arg === '-e') args.endpoint = argv[++i];
    else if (arg.startsWith('--endpoint=')) args.endpoint = arg.slice('--endpoint='.length);
  }
  return args;
}

// Match a known endpoint by name or path (case-insensitive); any other value
// starting with "/" is tested as an ad-hoc path
function selectEndpoints(filter) {
  if (!filter) return ENDPOINTS;
  const needle = filter.toLowerCase();
  const match = ENDPOINTS.find(
    (e) => e.name.toLowerCase() === needle || e.path.toLowerCase() === needle,
  );
  if (match) return [match];
  if (filter.startsWith('/')) return [{ name: filter.slice(0, 20), path: filter }];
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.list) {
    for (const e of ENDPOINTS) console.log(`${e.name.padEnd(20)} ${e.path}`);
    return;
  }

  const selected = selectEndpoints(args.endpoint);
  if (!selected) {
    console.error(`Unknown endpoint "${args.endpoint}". Use --list to see names, or pass a path.`);
    process.exit(1);
  }

  console.log(`${bold('Performance test')} → ${BASE_URL}`);
  console.log(
    dim(
      `${REQUESTS} requests per endpoint, ${CONCURRENCY} at a time (+${WARMUP} warm-up). ` +
        `Pass if p95 ≤ ${ms(MAX_P95_MS)} and errors ≤ ${MAX_ERROR_PCT}%.\n`,
    ),
  );

  const needsId = selected.some((e) => e.path.includes(':id'));
  const productId = needsId ? await resolveProductId() : undefined;
  const endpoints = selected.filter((e) => {
    if (!e.path.includes(':id')) return true;
    if (productId === undefined) {
      console.log(`(skipping "${e.name}": no products found)\n`);
      return false;
    }
    e.path = e.path.replace(':id', encodeURIComponent(productId));
    return true;
  });

  if (endpoints.length === 0) {
    console.error('No endpoints left to test.');
    process.exit(1);
  }

  const summaries = [];
  for (const endpoint of endpoints) {
    process.stdout.write(`running ${endpoint.name}... `);
    const s = await runEndpoint(endpoint);
    summaries.push(s);
    console.log(dim('done'));
  }

  const rows = summaries.map((s) => ({ s, reasons: checkThresholds(s) }));
  for (const { s, reasons } of rows) printEndpointReport(s, reasons);
  if (rows.length > 1) printSummaryTable(rows);

  console.log(
    dim(
      '\nmedian = half the requests were faster than this · ' +
        'p95 = 95% were faster (the pass/fail check) · size = average response body',
    ),
  );

  const failed = rows.filter((r) => r.reasons.length).length;
  if (failed) {
    console.log(red(`\n${failed} of ${rows.length} endpoint(s) failed.`));
    process.exit(1);
  }
  console.log(green(`\nAll ${rows.length} endpoint(s) passed.`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
