// Isolated runner: bun test ./edge/gateway.test.ts
// No network, cloud credentials, or local server are used.
import { describe, test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { AdmissionGate, createGateway, type Env } from './gateway.ts';

const NOW = Date.parse('2026-10-01T12:00:10Z');
const TOKEN = Buffer.alloc(32, 7).toString('base64url');
const UUID = '6cfc1820-9096-4cac-b60d-a7df59412294';
const writeBody = { mutationId: UUID, expectedRevision: 0, schemaVersion: 4, answers: {}, step: 'context', completed: false };
const jsonResponse = (body: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...extra } });
function harness(options: { admission?: Response | Error; turnstile?: unknown | Error; upstream?: Response | Error; burst?: boolean } = {}) {
  const events: string[] = [];
  const upstream: { url: string; init: RequestInit }[] = [];
  const verification: RequestInit[] = [];
  const reservations: Record<string, unknown>[] = [];
  const signing: unknown[] = [];
  const env: Env = {
    ALLOWED_ORIGINS: JSON.stringify(['https://melzi.dev']),
    TURNSTILE_HOSTNAMES: JSON.stringify(['melzi.dev']),
    TURNSTILE_SECRET: 'production-secret-placeholder-not-real',
    LAMBDA_URL: 'https://example.lambda-url.us-east-1.on.aws/',
    AWS_ACCESS_KEY_ID: 'example-access-id-not-real',
    AWS_SECRET_ACCESS_KEY: 'example-secret-not-real',
    ADMISSION: {
      idFromName(name: string) { expect(name).toBe('melzi-research-v1'); return name; },
      get() { return { async fetch(request: Request) {
        events.push('reserve');
        reservations.push(await request.json() as Record<string, unknown>);
        if (options.admission instanceof Error) throw options.admission;
        return options.admission?.clone() ?? jsonResponse({ allowed: true });
      } }; }
    }
  };
  if (options.burst !== undefined) env.IP_BURST = { async limit() { events.push('burst'); return { success: options.burst! }; } };
  const gateway = createGateway({
    now: () => NOW,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
      events.push('verify');
      verification.push(init!);
      if (options.turnstile instanceof Error) throw options.turnstile;
      return jsonResponse(options.turnstile ?? { success: true, action: 'research-draft', hostname: 'melzi.dev', challenge_ts: new Date(NOW - 1_000).toISOString() });
    }) as typeof fetch,
    createAwsClient(settings) {
      signing.push(settings);
      return { async fetch(url, init) {
        events.push('aws');
        upstream.push({ url, init });
        if (options.upstream instanceof Error) throw options.upstream;
        return options.upstream?.clone() ?? jsonResponse({ revision: 1, savedAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + 86_400_000).toISOString(), completed: false });
      } };
    }
  });
  return { env, gateway, events, upstream, verification, reservations, signing };
}
function request(method = 'GET', options: { headers?: Record<string, string>; body?: string | ReadableStream<Uint8Array>; url?: string } = {}) {
  const headers = new Headers({ Origin: 'https://melzi.dev', Authorization: `Bearer ${TOKEN}`, 'CF-Connecting-IP': '203.0.113.5' });
  if (method === 'POST' || method === 'PUT') headers.set('Content-Type', 'application/json');
  if (method === 'POST') headers.set('X-Turnstile-Token', 'opaque-production-challenge');
  for (const [name, value] of Object.entries(options.headers ?? {})) headers.set(name, value);
  const body = options.body ?? (method === 'POST' || method === 'PUT' ? JSON.stringify(writeBody) : undefined);
  return new Request(options.url ?? 'https://api.melzi.dev/v1/draft', { method, headers, body, ...(body instanceof ReadableStream ? { duplex: 'half' } : {}) } as RequestInit);
}

describe('gateway admission and proxy boundaries', () => {
  for (const method of ['GET', 'POST', 'PUT']) {
    test(`${method} reserves before exactly one upstream attempt`, async () => {
      const h = harness();
      const result = await h.gateway.fetch(request(method), h.env);
      expect(result.status).toBe(200);
      expect(h.events).toEqual(method === 'POST' ? ['verify', 'reserve', 'aws'] : ['reserve', 'aws']);
      expect(h.upstream).toHaveLength(1);
      expect(h.upstream[0].url).toBe('https://example.lambda-url.us-east-1.on.aws/v1/draft');
      expect(h.upstream[0].init.redirect).toBe('error');
      expect(h.upstream[0].init.signal).toBeInstanceOf(AbortSignal);
      expect(h.signing[0]).toMatchObject({ service: 'lambda', region: 'us-east-1', retries: 0 });
      expect(h.reservations[0]).toMatchObject({ creation: method === 'POST' });
      expect(h.reservations[0].ipHash).toMatch(/^[a-f0-9]{64}$/);
      expect(h.reservations[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(h.reservations)).not.toContain(TOKEN);
      expect(JSON.stringify(h.reservations)).not.toContain('203.0.113.5');
      expect(result.headers.get('Cache-Control')).toBe('no-store');
      expect(result.headers.get('Access-Control-Allow-Origin')).toBe('https://melzi.dev');
    });
  }
  test('only the real bearer becomes the internal owner header; no ambient headers survive', async () => {
    const h = harness();
    await h.gateway.fetch(request('PUT', { headers: { 'X-Melzi-Session': 'forged', 'X-Forwarded-For': '127.0.0.1', Cookie: 'private=value', 'X-Amz-Security-Token': 'forged', 'CF-IPCountry': 'ZZ' } }), h.env);
    const headers = new Headers(h.upstream[0].init.headers);
    expect(headers.get('X-Melzi-Session')).toBe(TOKEN);
    expect([...headers.keys()].sort()).toEqual(['accept', 'content-type', 'x-amz-content-sha256', 'x-melzi-session']);
    expect(headers.has('Authorization')).toBe(false); // aws4fetch supplies SigV4, not browser auth.
  });
  for (const [label, change, status] of [
    ['wrong origin', { headers: { Origin: 'https://evil.example' } }, 403],
    ['opaque origin', { headers: { Origin: 'null' } }, 403],
    ['missing credential', { headers: { Authorization: '' } }, 401],
    ['noncanonical credential', { headers: { Authorization: `Bearer ${'A'.repeat(42)}B` } }, 401],
    ['credential too long', { headers: { Authorization: `Bearer ${TOKEN}A` } }, 401],
    ['query route', { url: 'https://api.melzi.dev/v1/draft?origin=evil' }, 404],
    ['unrecognized path', { url: 'https://api.melzi.dev/admin' }, 404],
    ['alternate hostname', { url: 'https://example.workers.dev/v1/draft' }, 404]
  ] as const) {
    test(`${label} never invokes AWS`, async () => {
      const h = harness();
      const result = await h.gateway.fetch(request('GET', change), h.env);
      expect(result.status).toBe(status);
      expect(h.events).toEqual([]);
      expect(result.headers.get('Cache-Control')).toBe('no-store');
    });
  }
  test('preflight and health need no AWS, challenge, or owner credential', async () => {
    const h = harness();
    const preflight = await h.gateway.fetch(request('OPTIONS', { headers: { Authorization: '', 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization, content-type' } }), h.env);
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Max-Age')).toBe('600');
    expect(preflight.headers.get('Access-Control-Allow-Headers')).toBe('Authorization, Content-Type, X-Turnstile-Token');
    const bad = await h.gateway.fetch(request('OPTIONS', { headers: { 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'x-melzi-session' } }), h.env);
    expect(bad.status).toBe(403);
    expect((await h.gateway.fetch(new Request('https://api.melzi.dev/health'), h.env)).status).toBe(200);
    expect(h.events).toEqual([]);
  });
  test('unsupported methods fail before reservation', async () => {
    const h = harness();
    expect((await h.gateway.fetch(request('DELETE'), h.env)).status).toBe(405);
    expect(h.events).toEqual([]);
  });
  for (const admission of [new Error('storage failed'), jsonResponse({ allowed: true }, 503), jsonResponse({ allowed: false }), jsonResponse({})]) {
    test('admission failure/malformed response fails closed', async () => {
      const h = harness({ admission });
      expect((await h.gateway.fetch(request(), h.env)).status).toBe(503);
      expect(h.events).toEqual(['reserve']);
    });
  }
  test('quota denial includes retry hint, never invokes AWS', async () => {
    const h = harness({ admission: jsonResponse({ allowed: false, retryAfter: 120 }, 429) });
    const result = await h.gateway.fetch(request(), h.env);
    expect(result.status).toBe(429);
    expect(result.headers.get('Retry-After')).toBe('120');
    expect(h.upstream).toHaveLength(0);
  });
  test('optional local burst denial runs before challenge verification', async () => {
    const h = harness({ burst: false });
    expect((await h.gateway.fetch(request('POST'), h.env)).status).toBe(429);
    expect(h.events).toEqual(['burst']);
  });
  test('an ambiguous upstream failure is not internally retried or refunded', async () => {
    const h = harness({ upstream: new Error('connection dropped') });
    expect((await h.gateway.fetch(request('PUT'), h.env)).status).toBe(503);
    expect(h.events).toEqual(['reserve', 'aws']);
    expect((await h.gateway.fetch(request('PUT'), h.env)).status).toBe(503);
    expect(h.events).toEqual(['reserve', 'aws', 'reserve', 'aws']);
  });
  test('real aws4fetch signs the owner header and performs no retry on HTTP 500', async () => {
    const originalFetch = globalThis.fetch;
    const signedRequests: Request[] = [];
    try {
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        if (!(input instanceof Request)) throw new Error('Expected a signed request');
        signedRequests.push(input);
        return jsonResponse({ internal: 'upstream failure' }, 500);
      }) as typeof fetch;
      const h = harness();
      const actual = createGateway();
      const result = await actual.fetch(request('PUT'), h.env);
      expect(result.status).toBe(503);
      expect(h.events).toEqual(['reserve']);
      expect(signedRequests).toHaveLength(1);
      const signed = signedRequests[0];
      expect(signed.headers.get('Authorization')).toStartWith('AWS4-HMAC-SHA256 ');
      expect(signed.headers.get('Authorization')).toContain('x-melzi-session');
      expect(signed.headers.get('X-Melzi-Session')).toBe(TOKEN);
      expect(signed.headers.get('X-Amz-Content-Sha256')).toBe(new Bun.CryptoHasher('sha256').update(JSON.stringify(writeBody)).digest('hex'));
      expect(signed.redirect).toBe('error');
      expect(await signed.json()).toEqual(writeBody);
    } finally { globalThis.fetch = originalFetch; }
  });
  test('AWS diagnostic headers and unrecognized error payload fields are not exposed', async () => {
    const h = harness({ upstream: jsonResponse({ error: 'conflict', message: 'Reload the current draft.', revision: 4, internal: 'should-not-leak' }, 409, { 'X-Amzn-RequestId': 'private', 'Set-Cookie': 'secret=value' }) });
    const result = await h.gateway.fetch(request('PUT'), h.env);
    expect(result.status).toBe(409);
    expect(await result.json()).toEqual({ error: 'conflict', message: 'Reload the current draft.', revision: 4 });
    expect(result.headers.has('X-Amzn-RequestId')).toBe(false);
    expect(result.headers.has('Set-Cookie')).toBe(false);
  });
  test('HTML upstream failures are replaced by a generic error', async () => {
    const h = harness({ upstream: new Response('<h1>internal AWS diagnostics</h1>', { status: 502 }) });
    const result = await h.gateway.fetch(request(), h.env);
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain('diagnostics');
  });
  test('oversized successful upstream JSON fails closed', async () => {
    const h = harness({ upstream: jsonResponse({ body: 'a'.repeat(65_536) }) });
    expect((await h.gateway.fetch(request(), h.env)).status).toBe(503);
  });
  test('invalid or dummy production configuration cannot reach AWS', async () => {
    for (const override of [
      { LAMBDA_URL: 'https://attacker.example/' }, { LAMBDA_URL: 'https://example.lambda-url.us-east-1.on.aws/other' },
      { LAMBDA_URL: 'https://example.lambda-url.us-east-1.on.aws/?redirect=x' },
      { TURNSTILE_SECRET: '1x0000000000000000000000000000000AA' }, { ALLOWED_ORIGINS: '*' }
    ]) {
      const h = harness();
      expect((await h.gateway.fetch(request(), { ...h.env, ...override })).status).toBe(503);
      expect(h.events).toEqual([]);
    }
  });
});

describe('body bounds and challenge validation', () => {
  test('actual streaming byte limit overrides a dishonest Content-Length', async () => {
    let cancelled = false;
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { pulls++; controller.enqueue(new Uint8Array(32_769)); },
      cancel() { cancelled = true; }
    }, { highWaterMark: 0 });
    const h = harness();
    const result = await h.gateway.fetch(request('PUT', { body: stream, headers: { 'Content-Length': '1' } }), h.env);
    expect(result.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(pulls).toBe(2);
    expect(h.events).toEqual([]);
  });
  test('exactly 65536 UTF-8 bytes are accepted, the next byte is rejected', async () => {
    const base = JSON.stringify({ ...writeBody, padding: '' });
    const body = JSON.stringify({ ...writeBody, padding: 'a'.repeat(65_536 - new TextEncoder().encode(base).byteLength) });
    const h = harness();
    expect((await h.gateway.fetch(request('PUT', { body }), h.env)).status).toBe(200);
    const large = harness();
    expect((await large.gateway.fetch(request('PUT', { body: `${body} ` }), large.env)).status).toBe(413);
    expect(large.events).toEqual([]);
  });
  for (const [body, contentType, status] of [['{', 'application/json', 400], ['[]', 'application/json', 400], ['{}', 'application/json', 400], [JSON.stringify(writeBody), 'text/plain', 415], [JSON.stringify({ ...writeBody, mutationId: 'not-uuid' }), 'application/json', 400]] as const) {
    test('invalid write is rejected without admission', async () => {
      const h = harness();
      expect((await h.gateway.fetch(request('PUT', { body, headers: { 'Content-Type': contentType } }), h.env)).status).toBe(status);
      expect(h.events).toEqual([]);
    });
  }
  test('Siteverify receives the mutation ID for safe verification retries', async () => {
    const h = harness();
    await h.gateway.fetch(request('POST'), h.env);
    expect(JSON.parse(h.verification[0].body as string)).toEqual({ secret: h.env.TURNSTILE_SECRET, response: 'opaque-production-challenge', idempotency_key: UUID });
    expect(h.verification[0].redirect).toBe('error');
    expect(h.verification[0].signal).toBeInstanceOf(AbortSignal);
  });
  test('missing challenge is distinguished from failed challenge', async () => {
    const h = harness();
    const result = await h.gateway.fetch(request('POST', { headers: { 'X-Turnstile-Token': '' } }), h.env);
    expect(result.status).toBe(403);
    expect(await result.json()).toMatchObject({ error: 'challenge_required' });
    expect(h.events).toEqual([]);
  });
  for (const turnstile of [
    { success: false, 'error-codes': ['timeout-or-duplicate'] },
    { success: true, action: 'wrong-action', hostname: 'melzi.dev', challenge_ts: new Date(NOW).toISOString() },
    { success: true, action: 'research-draft', hostname: 'evil.example', challenge_ts: new Date(NOW).toISOString() },
    { success: true, action: 'research-draft', hostname: 'melzi.dev', challenge_ts: new Date(NOW - 600_000).toISOString() },
    { success: true, action: 'research-draft', hostname: 'melzi.dev', challenge_ts: new Date(NOW + 600_000).toISOString() },
    { success: true, action: 'research-draft', hostname: 'melzi.dev' }
  ]) {
    test('wrong action/hostname, expired/replayed or malformed verification is denied', async () => {
      const h = harness({ turnstile });
      const result = await h.gateway.fetch(request('POST'), h.env);
      expect(result.status).toBe(403);
      expect(await result.json()).toMatchObject({ error: 'challenge_failed' });
      expect(h.events).toEqual(['verify']);
    });
  }
  test('Turnstile unavailability and dummy tokens fail closed', async () => {
    const h = harness({ turnstile: new Error('unreachable') });
    expect((await h.gateway.fetch(request('POST'), h.env)).status).toBe(503);
    expect(h.events).toEqual(['verify']);
    const dummy = harness();
    expect((await dummy.gateway.fetch(request('POST', { headers: { 'X-Turnstile-Token': 'XXXX.DUMMY.TOKEN.XXXX' } }), dummy.env)).status).toBe(403);
    expect(dummy.events).toEqual([]);
  });
});

function realGate(overrides: Partial<Env> = {}) {
  const db = new Database(':memory:');
  let timestamp = NOW;
  const sql = { exec<T>(query: string, ...bindings: (string | number)[]) { return { toArray: () => db.query(query).all(...bindings) as T[] }; } };
  // Cloudflare exec executes immediately, whereas the wrapper above is lazy;
  // materialize here to preserve DDL/update semantics and transaction ordering.
  const actualSql = { exec<T>(query: string, ...bindings: (string | number)[]) { const rows = sql.exec<T>(query, ...bindings).toArray(); return { toArray: () => rows }; } };
  const ctx = { storage: { sql: actualSql, transactionSync<T>(callback: () => T): T { return db.transaction(callback)(); } } };
  const gate = new AdmissionGate(ctx, overrides, () => timestamp);
  const reserve = (ip = 'a'.repeat(64), token = 'b'.repeat(64), creation = false, creationMutationId = UUID) => gate.fetch(new Request('https://admission.internal/reserve', { method: 'POST', body: JSON.stringify({ ipHash: ip, tokenHash: token, creation, ...(creation ? { creationMutationId } : {}) }) }));
  return { db, ctx, gate, reserve, setTime(value: number) { timestamp = value; } };
}
describe('SQLite admission transactions', () => {
  test('global daily cap is exact across concurrent requests and survives object reconstruction', async () => {
    const h = realGate({ ADMISSION_DAILY_LIMIT: '3' });
    const results = await Promise.all(Array.from({ length: 20 }, () => h.reserve()));
    expect(results.filter(result => result.status === 200)).toHaveLength(3);
    expect(results.filter(result => result.status === 429)).toHaveLength(17);
    const recreated = new AdmissionGate(h.ctx, { ADMISSION_DAILY_LIMIT: '3' }, () => NOW);
    expect((await recreated.fetch(new Request('https://admission.internal/reserve', { method: 'POST', body: JSON.stringify({ ipHash: 'c'.repeat(64), tokenHash: 'd'.repeat(64), creation: false }) }))).status).toBe(429);
    h.db.close();
  });
  for (const [setting, limit] of [['ADMISSION_MINUTE_LIMIT', '2'], ['ADMISSION_IP_MINUTE_LIMIT', '2'], ['ADMISSION_IP_DAILY_LIMIT', '2'], ['ADMISSION_SESSION_MINUTE_LIMIT', '2']] as const) {
    test(`${setting} is enforced transactionally`, async () => {
      const h = realGate({ [setting]: limit });
      expect((await h.reserve()).status).toBe(200);
      expect((await h.reserve()).status).toBe(200);
      expect((await h.reserve()).status).toBe(429);
      expect(h.db.query("SELECT count FROM counters WHERE key='global:day'").get()).toEqual({ count: 2 });
      h.db.close();
    });
  }
  test('creation cap does not block existing-draft saves, but shares the total budget', async () => {
    const h = realGate({ ADMISSION_CREATION_DAILY_LIMIT: '1', ADMISSION_DAILY_LIMIT: '2' });
    expect((await h.reserve(undefined, undefined, true)).status).toBe(200);
    expect((await h.reserve(undefined, undefined, true)).status).toBe(429);
    expect((await h.reserve()).status).toBe(200);
    expect((await h.reserve()).status).toBe(429);
    h.db.close();
  });
  test('a cached challenge retry stays bound to one owner and every retry counts', async () => {
    const h = realGate();
    expect((await h.reserve(undefined, undefined, true)).status).toBe(200);
    expect((await h.reserve(undefined, undefined, true)).status).toBe(200);
    const switched = await h.reserve(undefined, 'c'.repeat(64), true);
    expect(switched.status).toBe(403);
    expect(await switched.json()).toMatchObject({ reason: 'challenge_reused' });
    expect(h.db.query("SELECT count FROM counters WHERE key='global:day'").get()).toEqual({ count: 2 });
    h.db.close();
  });
  test('minute and UTC day boundaries reset only their own windows', async () => {
    const h = realGate({ ADMISSION_MINUTE_LIMIT: '1', ADMISSION_DAILY_LIMIT: '2' });
    expect((await h.reserve()).status).toBe(200);
    expect((await h.reserve()).status).toBe(429);
    h.setTime(NOW + 60_000);
    expect((await h.reserve()).status).toBe(200);
    h.setTime(NOW + 120_000);
    expect((await h.reserve()).status).toBe(429);
    h.setTime(Date.parse('2026-10-02T00:00:00Z'));
    expect((await h.reserve()).status).toBe(200);
    h.db.close();
  });
  test('failed counter writes roll back all permits and return unavailable', async () => {
    const h = realGate();
    h.db.exec("CREATE TRIGGER reject_session BEFORE INSERT ON counters WHEN NEW.key LIKE 'session:%' BEGIN SELECT RAISE(ABORT, 'simulated quota failure'); END");
    expect((await h.reserve()).status).toBe(503);
    expect(h.db.query('SELECT count(*) AS n FROM counters').get()).toEqual({ n: 0 });
    h.db.close();
  });
  test('expiry cleanup deletes at most 100 rows per minute', async () => {
    const h = realGate();
    const insert = h.db.query('INSERT INTO counters VALUES (?, ?, ?, ?)');
    for (let n = 0; n < 250; n++) insert.run(`old:${n}`, 0, 1, NOW - 1);
    await h.reserve();
    expect(h.db.query("SELECT count(*) AS n FROM counters WHERE key LIKE 'old:%'").get()).toEqual({ n: 150 });
    await h.reserve();
    expect(h.db.query("SELECT count(*) AS n FROM counters WHERE key LIKE 'old:%'").get()).toEqual({ n: 150 });
    h.setTime(NOW + 60_000);
    await h.reserve();
    expect((h.db.query("SELECT count(*) AS n FROM counters WHERE key LIKE 'old:%'").get() as { n: number }).n).toBeLessThanOrEqual(53);
    h.db.close();
  });
  test('bad quota settings fail closed at construction', () => {
    for (const value of ['0', '-1', 'NaN', '100001', '2.5']) expect(() => realGate({ ADMISSION_DAILY_LIMIT: value })).toThrow();
  });
  test('raw identifiers and malformed coordinator requests are rejected', async () => {
    const h = realGate();
    const bad = await h.gate.fetch(new Request('https://admission.internal/reserve', { method: 'POST', body: JSON.stringify({ ipHash: '203.0.113.1', tokenHash: TOKEN, creation: false }) }));
    expect(bad.status).toBe(400);
    expect(h.db.query('SELECT count(*) AS n FROM counters').get()).toEqual({ n: 0 });
    h.db.close();
  });
});
