// No cloud calls: platform identity, ARM, PostgreSQL, and adapter inputs are mocked.
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { HttpRequest } from '@azure/functions';
import type { Pool } from 'pg';
import { armTarget, identityTarget, createAzureControl } from './azure-control.ts';
import { azureDatabaseSecret, poolFromSecret } from './database.ts';
import { createAdmission } from './admission.ts';
import { createHousekeeping } from './housekeeping.ts';
import { allowedOrigins, createAzureHttpHandler } from '../azure/http-adapter.ts';
import { createMigrationHandler } from '../azure/migration-adapter.ts';
import { createVerificationHandler } from '../azure/verification-adapter.ts';
import { emptyAnswers } from '../../src/lib/research/form.ts';

const RESOURCE = '/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/research/providers/Microsoft.Web/sites/research-api';
const TOKEN = Buffer.alloc(32, 7).toString('base64url');
const TOKEN_HASH = createHash('sha256').update(Buffer.from(TOKEN, 'base64url')).digest('hex');
const PG = { PGHOST: 'research.postgres.database.azure.com', PGDATABASE: 'melzi_research', PGPORT: '5432', PGUSER: 'melzi_research_app', PGPASSWORD: 'synthetic-app-password' };
function request(method = 'GET', options: { path?: string; headers?: Record<string, string>; body?: string | Uint8Array } = {}) {
  return new HttpRequest({ method, url: 'https://research-api.azurewebsites.net' + (options.path ?? '/api/v1/draft'),
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...options.headers },
    ...(options.body === undefined ? {} : { body: typeof options.body === 'string' ? { string: options.body } : { bytes: options.body } }) });
}
function cloudControl(options: { state?: string; deny?: boolean; transient?: boolean; badToken?: boolean } = {}) {
  let clock = 1_800_000_000_000, state = 'Running', rejected = false;
  const calls: { url: URL; init: RequestInit }[] = [];
  const env = { API_RESOURCE_ID: RESOURCE, IDENTITY_ENDPOINT: 'http://169.254.130.1:8081/msi/token', IDENTITY_HEADER: 'synthetic-private-header' };
  const control = createAzureControl({ env: () => env, now: () => clock, fetch: (async (input, init) => {
    const url = new URL(String(input)); calls.push({ url, init: init! });
    expect(init?.redirect).toBe('error'); expect(init?.signal).toBeInstanceOf(AbortSignal);
    if (url.hostname === '169.254.130.1') {
      expect(url.searchParams.get('resource')).toBe('https://management.azure.com/');
      expect(new Headers(init?.headers).get('X-IDENTITY-HEADER')).toBe(env.IDENTITY_HEADER);
      return Response.json({ access_token: 'synthetic-arm-bearer', expires_on: Math.floor((clock + (options.badToken ? -1000 : 3600000)) / 1000), token_type: 'Bearer' });
    }
    expect(url.origin).toBe('https://management.azure.com');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic-arm-bearer');
    expect(new Headers(init?.headers).get('X-IDENTITY-HEADER')).toBeNull();
    expect(url.href).not.toContain('synthetic');
    if (options.deny) return new Response('sensitive upstream error', { status: 403 });
    if (options.transient && !rejected) { rejected = true; return new Response('private', { status: 503 }); }
    if (init?.method === 'POST') { state = url.pathname.endsWith('/stop') ? 'Stopped' : 'Running'; return new Response(null, { status: 200 }); }
    return Response.json({ properties: { state: options.state ?? state } });
  }) as typeof fetch });
  return { control, calls, advance: () => { clock += 300000; } };
}

describe('Azure managed identity and exact-scope ARM control', () => {
  for (const endpoint of ['https://evil.example/msi/token', 'http://10.0.0.1/msi/token', 'http://localhost.evil/msi/token', 'http://user:password@localhost/msi/token', 'http://localhost/msi/token?resource=evil', 'http://localhost/not-msi', 'http://169.255.1.1/msi/token', 'http://localhost/msi/token#fragment']) {
    test(`rejects unsafe identity endpoint ${endpoint.split('?')[0]}`, () => expect(() => identityTarget(endpoint)).toThrow());
  }
  for (const endpoint of ['http://localhost:8081/msi/token', 'http://127.0.0.1:80/msi/token', 'http://[::1]:8081/msi/token', 'http://169.254.129.1:8081/msi/token']) {
    test(`accepts platform-local identity endpoint ${endpoint}`, () => expect(identityTarget(endpoint).searchParams.get('api-version')).toBe('2019-08-01'));
  }
  test('rejects alternate ARM hosts, slots, query injection and malformed IDs', () => {
    for (const id of ['https://evil.example/' + RESOURCE, RESOURCE + '/slots/other', RESOURCE + '?x=1', RESOURCE.replace('/sites/', '/sites/%2F'), RESOURCE.replace('11111111-', 'wrong-')]) expect(() => armTarget({ API_RESOURCE_ID: id })).toThrow();
    expect(armTarget({ API_RESOURCE_ID: RESOURCE }).hostname).toBe('management.azure.com');
  });
  test('stop/start use fixed resource scope, confirm distinct states, and cache identity briefly', async () => {
    const t = cloudControl(); await t.control.stop(); await t.control.start();
    expect(t.calls.filter(c => c.url.pathname === '/msi/token')).toHaveLength(1);
    expect(t.calls.filter(c => c.init.method === 'POST').map(c => c.url.pathname)).toEqual([RESOURCE + '/stop', RESOURCE + '/start']);
    t.advance(); await t.control.stop(); expect(t.calls.filter(c => c.url.pathname === '/msi/token')).toHaveLength(2);
  });
  test('one transient retry is bounded and authorization failures are never retried', async () => {
    const t = cloudControl({ transient: true }); await t.control.stop();
    expect(t.calls.filter(c => c.init.method === 'POST')).toHaveLength(2);
    const denied = cloudControl({ deny: true }); await expect(denied.control.stop()).rejects.toThrow('Azure app control failed');
    expect(denied.calls.filter(c => c.init.method === 'POST')).toHaveLength(1);
  });
  test('a Running state does not prove a successful stop', async () => {
    await expect(cloudControl({ state: 'Running' }).control.stop()).rejects.toThrow('Azure app control failed');
  });
  test('expired MI response never reaches ARM', async () => {
    const t = cloudControl({ badToken: true }); await expect(t.control.stop()).rejects.toThrow('Azure app control failed'); expect(t.calls).toHaveLength(1);
  });
  test('redirect rejection and transport errors expose no header, token, or raw upstream diagnostics', async () => {
    let calls = 0;
    const control = createAzureControl({ env: () => ({ API_RESOURCE_ID: RESOURCE, IDENTITY_ENDPOINT: 'http://localhost/msi/token', IDENTITY_HEADER: 'private-header' }), fetch: (async (_url, init) => {
      calls++; expect(init?.redirect).toBe('error'); return new Response('private-header private-password', { status: 302, headers: { location: 'https://evil.example' } });
    }) as typeof fetch });
    try { await control.stop(); throw new Error('expected failure'); } catch (error) { expect((error as Error).message).toBe('Azure app control failed'); }
    expect(calls).toBe(1);
  });
  test('invalid resource or injected identity header makes no fetch', async () => {
    for (const env of [{ API_RESOURCE_ID: 'bad' }, { API_RESOURCE_ID: RESOURCE, IDENTITY_ENDPOINT: 'http://localhost/msi/token', IDENTITY_HEADER: 'bad\r\nheader' }]) {
      let fetched = false;
      const control = createAzureControl({ env: () => env, fetch: (async () => { fetched = true; throw new Error('secret'); }) as typeof fetch });
      await expect(control.stop()).rejects.toThrow('Azure app control failed'); expect(fetched).toBe(false);
    }
  });
});

describe('Azure PostgreSQL configuration', () => {
  test('uses verified default trust and exact server hostname, never RDS CA material', async () => {
    const pool = poolFromSecret(azureDatabaseSecret(PG), 'azure');
    expect(pool.options.ssl).toEqual({ rejectUnauthorized: true, servername: PG.PGHOST });
    expect(pool.options.max).toBe(1); expect(pool.options.connectionTimeoutMillis).toBe(2000); await pool.end();
  });
  test('rejects non-Azure host, wrong database, missing password and NUL secrets', () => {
    for (const override of [{ PGHOST: 'evil.example' }, { PGDATABASE: 'postgres' }, { PGPASSWORD: '' }, { PGPASSWORD: 'bad\0password' }, { PGPORT: '80' }]) expect(() => azureDatabaseSecret({ ...PG, ...override })).toThrow('Invalid Azure database configuration');
  });
});

function apiHarness() {
  let admitted = 0, stopped = 0;
  const queries: { sql: string; values: unknown[] }[] = [];
  const pool = { async query(sql: string, values: unknown[] = []) { queries.push({ sql, values }); return { rows: [], rowCount: 0 }; } } as unknown as Pool;
  const handler = createAzureHttpHandler({ origins: 'https://melzi.dev,https://www.melzi.dev', getPool: async () => pool,
    reserve: async () => { admitted++; }, stop: async () => { stopped++; return true; } });
  return { handler, queries, counts: () => ({ admitted, stopped }) };
}
describe('Azure public adapter counts before validating and trusts only Bearer', () => {
  for (const authorization of ['', TOKEN, `Basic ${TOKEN}`, `Bearer ${TOKEN}=`, `Bearer ${TOKEN} extra`, `Bearer ${TOKEN.slice(0, -1)}B`]) {
    test('rejects malformed/noncanonical credential before private reads: ' + authorization.slice(0, 6), async () => {
      const t = apiHarness(); const result = await t.handler(request('GET', { headers: { authorization, 'x-melzi-session': TOKEN } }));
      expect(result.status).toBe(401); expect(t.counts()).toEqual({ admitted: 1, stopped: 0 }); expect(t.queries).toHaveLength(0);
    });
  }
  test('spoofed internal owner headers cannot select another token', async () => {
    const t = apiHarness(); const result = await t.handler(request('GET', { headers: { 'x-melzi-session': Buffer.alloc(32, 9).toString('base64url'), 'x-ms-client-principal': 'spoofed' } }));
    expect(result.status).toBe(404); expect(t.queries.every(query => query.values[0] === TOKEN_HASH)).toBe(true);
    expect(new Headers(result.headers).get('access-control-allow-origin')).toBeNull();
  });
  test('exact CORS allows configured origin and rejects lookalikes after admission', async () => {
    const t = apiHarness();
    const allowed = await t.handler(request('GET', { headers: { origin: 'https://melzi.dev' } }));
    expect(new Headers(allowed.headers).get('access-control-allow-origin')).toBe('https://melzi.dev');
    const before = t.queries.length;
    const denied = await t.handler(request('GET', { headers: { origin: 'https://melzi.dev.evil.example' } }));
    expect(denied.status).toBe(403); expect(new Headers(denied.headers).get('access-control-allow-origin')).toBeNull();
    expect(t.queries).toHaveLength(before); expect(t.counts().admitted).toBe(2);
  });
  test('all executed routing failures are counted, even if native routing normally prevents invocation', async () => {
    const t = apiHarness(); expect((await t.handler(request('GET', { path: '/api/unknown' }))).status).toBe(404);
    expect((await t.handler(request('DELETE'))).status).toBe(404); expect(t.counts().admitted).toBe(2);
  });
  test('invalid JSON, content type, UTF8 and oversized streamed bodies cannot bypass admission', async () => {
    const cases = [request('POST', { body: '{' }), request('POST', { body: '{}', headers: { 'content-type': 'text/plain' } }),
      request('POST', { body: new Uint8Array([255]) }), request('POST', { body: ' '.repeat(65537) })];
    const t = apiHarness();
    for (const [index, input] of cases.entries()) expect((await t.handler(input)).status).toBe(index === 3 ? 413 : 400);
    expect(t.counts()).toEqual({ admitted: 4, stopped: 0 }); expect(t.queries).toHaveLength(0);
  });
  test('origin configuration rejects wildcard, credentials, HTTP and path components', () => {
    for (const origin of ['*', 'http://melzi.dev', 'https://user:pass@melzi.dev', 'https://melzi.dev/', 'https://melzi.dev/path']) expect(() => allowedOrigins(origin)).toThrow();
  });
  test('entry owns authenticated-header preflight without Bearer but still reserves admission', async () => {
    const t = apiHarness();
    const result = await t.handler(request('OPTIONS', { headers: { authorization: '', origin: 'https://melzi.dev', 'access-control-request-method': 'PUT', 'access-control-request-headers': 'authorization,content-type' } }));
    expect(result.status).toBe(204); expect(result.body).toBe(''); expect(t.counts().admitted).toBe(1); expect(t.queries).toHaveLength(0);
    const headers = new Headers(result.headers);
    expect(headers.get('access-control-allow-origin')).toBe('https://melzi.dev');
    expect(headers.get('access-control-allow-headers')).toBe('Authorization, Content-Type'); expect(headers.get('access-control-expose-headers')).toBe('Retry-After');
    const invalid = await t.handler(request('OPTIONS', { headers: { origin: 'https://melzi.dev', 'access-control-request-method': 'DELETE' } }));
    expect(invalid.status).toBe(400); expect(t.counts().admitted).toBe(2);
  });
  test('raw-byte idempotency survives Azure body adaptation', async () => {
    let existing = false; let receipt: { payload_hash: unknown; result: unknown } | undefined;
    const now = new Date(), expires = new Date(now.getTime() + 86400000);
    const saved = { revision: 1, updated_at: now, expires_at: expires, completed: false };
    const client = { async query(sql: string, values: unknown[] = []) {
      if (sql.startsWith('SELECT revision,')) return { rows: existing ? [{ ...saved, window_started_at: now, window_writes: 1 }] : [], rowCount: existing ? 1 : 0 };
      if (sql.startsWith('SELECT payload_hash')) return { rows: receipt ? [receipt] : [], rowCount: receipt ? 1 : 0 };
      if (sql.startsWith('SELECT 1 FROM melzi_research.retired_sessions')) return { rows: [], rowCount: 0 };
      if (sql.startsWith('INSERT INTO melzi_research.drafts')) { existing = true; return { rows: [saved], rowCount: 1 }; }
      if (sql.startsWith('INSERT INTO melzi_research.receipts')) receipt = { payload_hash: values[2], result: JSON.parse(values[3] as string) };
      return { rows: [], rowCount: 1 };
    }, release() {} };
    const handler = createAzureHttpHandler({ origins: 'https://melzi.dev', getPool: async () => ({ connect: async () => client }) as unknown as Pool, reserve: async () => {}, stop: async () => false });
    const bytes = JSON.stringify({ schemaVersion: 4, answers: emptyAnswers(), step: 'context', completed: false, expectedRevision: 0, mutationId: '462468e4-df28-4ad1-bcd3-34cd95e404aa' });
    expect((await handler(request('POST', { body: bytes }))).status).toBe(201);
    expect(receipt?.payload_hash).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect((await handler(request('POST', { body: bytes }))).status).toBe(200);
    expect((await handler(request('POST', { body: bytes + '\n' }))).status).toBe(409);
  });
});

function budgetModel(options: { count?: number; closed?: boolean; prior?: boolean; failCommit?: boolean; failUnlock?: boolean } = {}) {
  const state = { count: options.count ?? 0, observed: 0, closed: options.closed ?? false, prior: options.prior ?? false, lock: false, destroyed: false };
  const events: string[] = [];
  const result = (rows: unknown[] = [], rowCount = rows.length) => ({ rows, rowCount });
  const pool = { async query(sql: string) {
    if (sql.includes('observed_invocations')) { state.observed++; events.push('observed'); return result(); }
    if (sql.startsWith('INSERT INTO melzi_research.daily_budget')) {
      events.push('reserve'); if (state.count >= 10000 || state.closed) return result();
      return result([{ day: '2026-10-04', requests: ++state.count, retry_after: 3600 }]);
    }
    if (sql.includes('AS retry_after')) return result([{ day: '2026-10-04', retry_after: 3600 }]);
    if (sql.includes('WITH expired AS') || sql.startsWith('DELETE FROM')) return result([], 1);
    throw new Error('Unexpected mocked pool query');
  }, async connect() {
    let closed: boolean | undefined, prior: boolean | undefined;
    return { async query(sql: string) {
      if (sql === 'BEGIN') { events.push('begin'); return result(); }
      if (sql === 'COMMIT') { events.push('commit'); if (options.failCommit) throw new Error('sensitive'); if (closed !== undefined) state.closed = closed; if (prior !== undefined) state.prior = prior; return result(); }
      if (sql === 'ROLLBACK') { events.push('rollback'); closed = undefined; prior = undefined; return result(); }
      if (sql.includes('pg_try_advisory_lock')) { const acquired = !state.lock; state.lock ||= acquired; return result([{ acquired }]); }
      if (sql.includes('pg_advisory_unlock')) { if (options.failUnlock) throw new Error('sensitive'); state.lock = false; return result([{ unlocked: true }]); }
      if (sql.startsWith('SET ') || sql.startsWith('RESET ')) return result();
      if (sql.includes('SET auto_closed = true')) { if (state.count < 10000) return result(); closed = true; events.push('mark'); return result([{}]); }
      if (sql.startsWith('SELECT 1 FROM melzi_research.daily_budget')) return state.closed || state.count >= 10000 ? result([{}]) : result();
      if (sql.includes('SET auto_closed = false')) { if (!state.prior) return result(); prior = false; return result([{}]); }
      throw new Error('Unexpected mocked transaction');
    }, release(error?: Error) { if (error) { state.destroyed = true; state.lock = false; } } };
  } } as unknown as Pool;
  return { state, events, pool };
}
describe('Azure quota commit-before-self-stop and private timer recovery', () => {
  test('cutoff marker is committed before stop and observed attempts continue beyond capped requests', async () => {
    const t = budgetModel({ count: 9999 }); let stopped = 0;
    const admission = createAdmission({ provider: 'azure', log: () => {}, appControl: { start: async () => {}, stop: async () => {
      stopped++; expect(t.state.closed).toBe(true); expect(t.state.lock).toBe(true); expect(t.events.at(-1)).toBe('commit');
    } } });
    await expect(admission.reserveInvocation(t.pool)).rejects.toMatchObject({ status: 429 });
    await expect(admission.reserveInvocation(t.pool)).rejects.toMatchObject({ status: 429 });
    expect(t.state.count).toBe(10000); expect(t.state.observed).toBe(2); expect(stopped).toBe(2); expect(t.state.lock).toBe(false);
  });
  test('failed ARM stop keeps its committed marker and is retried even when already closed', async () => {
    const t = budgetModel({ count: 10000, closed: true }); let calls = 0;
    const admission = createAdmission({ provider: 'azure', log: () => {}, appControl: { start: async () => {}, stop: async () => { calls++; throw new Error('private'); } } });
    await expect(admission.reserveInvocation(t.pool)).rejects.toMatchObject({ status: 429 });
    await expect(admission.reserveInvocation(t.pool)).rejects.toMatchObject({ status: 429 });
    expect(calls).toBe(2); expect(t.state.closed).toBe(true); expect(t.state.observed).toBe(2);
  });
  test('uncertain quota commit never calls ARM and uncertain unlock destroys the connection', async () => {
    const t = budgetModel({ count: 9999, failCommit: true, failUnlock: true }); let stopped = false;
    const admission = createAdmission({ provider: 'azure', log: () => {}, appControl: { start: async () => {}, stop: async () => { stopped = true; } } });
    await expect(admission.reserveInvocation(t.pool)).rejects.toMatchObject({ status: 429 }); expect(stopped).toBe(false); expect(t.state.destroyed).toBe(true);
  });
  test('timer preclears committed marker before start and stops again after ambiguous start', async () => {
    const t = budgetModel({ prior: true }); const events: string[] = [];
    const housekeeping = createHousekeeping({ provider: 'azure', getPool: async () => t.pool, log: () => {}, appControl: {
      start: async () => { expect(t.state.prior).toBe(false); expect(t.state.lock).toBe(true); events.push('start'); throw new Error('private'); },
      stop: async () => { events.push('stop'); }
    } });
    const result = await housekeeping.handler({ source: 'aws.events', 'detail-type': 'Scheduled Event' });
    expect(result.reopen).toBe('manual_recovery_required'); expect(events).toEqual(['start', 'stop']); expect(t.state.prior).toBe(false);
    expect((await housekeeping.handler({ source: 'aws.events', 'detail-type': 'Scheduled Event' })).reopen).toBe('not_needed');
  });
  test('current-day marker prevents reopening an older stop', async () => {
    const t = budgetModel({ count: 10000, closed: true, prior: true }); let started = false;
    const housekeeping = createHousekeeping({ provider: 'azure', getPool: async () => t.pool, log: () => {}, appControl: { start: async () => { started = true; }, stop: async () => {} } });
    expect((await housekeeping.handler({ source: 'aws.events', 'detail-type': 'Scheduled Event' })).reopen).toBe('current_day_closed'); expect(started).toBe(false);
  });
});

describe('temporary function-key-protected adapters', () => {
  test('migration permits only fixed migrate action and passes app/admin roles separately', async () => {
    let invoked = 0;
    const migrate = createMigrationHandler({ env: () => ({ ...PG, PGUSER: 'migration_admin', PG_APP_PASSWORD: 'synthetic-new-app-password' }), migrate: async (master, app) => {
      invoked++; expect(master.username).toBe('migration_admin'); expect(app.username).toBe('melzi_research_app'); expect(app.password).not.toBe(master.password); return { ok: true, schema: 'melzi_research' };
    } });
    expect((await migrate(request('POST', { body: '{"action":"migrate","sql":"DROP DATABASE"}' }))).status).toBe(400);
    expect((await migrate(request('POST', { body: '{"action":"migrate"}' }))).status).toBe(200); expect(invoked).toBe(1);
  });
  test('migration failures never return master passwords or raw SQL errors', async () => {
    const migrate = createMigrationHandler({ env: () => ({ ...PG, PGUSER: 'migration_admin', PG_APP_PASSWORD: 'synthetic' }), migrate: async () => { throw new Error('private-password SQL diagnostic'); } });
    const result = await migrate(request('POST', { body: '{"action":"migrate"}' })); expect(result.status).toBe(503); expect(JSON.stringify(result)).not.toContain('private-password');
  });
  test('Azure verification permits armQuota, not proxy quotaStop or arbitrary SQL', async () => {
    let called = 0;
    const verify = createVerificationHandler(async event => { called++; expect(event.action).toBe('armQuota'); return { ok: true }; });
    expect((await verify(request('POST', { body: '{"action":"quotaStop"}' }))).status).toBe(400);
    expect((await verify(request('POST', { body: '{"action":"armQuota","sql":"DROP"}' }))).status).toBe(400);
    expect((await verify(request('POST', { body: '{"action":"armQuota"}' }))).status).toBe(200); expect(called).toBe(1);
  });
});
