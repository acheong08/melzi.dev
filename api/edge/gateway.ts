import { AwsClient } from 'aws4fetch';
import { MAX_REQUEST_BYTES } from '../../src/lib/research/persistence-contract.ts';

/**
 * Deploy ONLY this default handler at api.melzi.dev. The ADMISSION binding must
 * point to the exported SQLite-backed AdmissionGate class, with a stable
 * namespace across deployments. Never enable fail-open/passThroughOnException.
 * ALLOWED_ORIGINS and TURNSTILE_HOSTNAMES are JSON arrays, not CSV. Origins must
 * be exact HTTPS origins; hostnames are bare DNS names. LAMBDA_URL is the AWS
 * Function URL root in us-east-1 (no path/query). AWS credentials belong only to
 * a principal scoped to this AWS_IAM Function URL. TURNSTILE_SECRET must be a
 * production secret; known Cloudflare dummy secrets/tokens are rejected.
 * ADMISSION_* limits below are bounded positive integer strings, optional.
 */
export interface Env {
  ALLOWED_ORIGINS: string;
  TURNSTILE_HOSTNAMES: string;
  TURNSTILE_SECRET: string;
  LAMBDA_URL: string;
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  ADMISSION: AdmissionNamespace;
  IP_BURST?: { limit(input: { key: string }): Promise<{ success: boolean }> };
  ADMISSION_DAILY_LIMIT?: string;
  ADMISSION_MINUTE_LIMIT?: string;
  ADMISSION_CREATION_DAILY_LIMIT?: string;
  ADMISSION_IP_MINUTE_LIMIT?: string;
  ADMISSION_IP_DAILY_LIMIT?: string;
  ADMISSION_SESSION_MINUTE_LIMIT?: string;
}
interface AdmissionNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}
interface SqlCursor<T> { toArray(): T[] }
interface SqlStorage {
  exec<T = Record<string, unknown>>(query: string, ...bindings: (string | number)[]): SqlCursor<T>;
}
interface ObjectContext {
  storage: { sql: SqlStorage; transactionSync<T>(callback: () => T): T };
}
interface AwsOptions {
  accessKeyId: string;
  secretAccessKey: string;
  service: 'lambda';
  region: 'us-east-1';
  retries: 0;
}
interface SignedClient { fetch(input: string, init: RequestInit): Promise<Response> }
interface Dependencies {
  fetch?: typeof fetch;
  createAwsClient?: (options: AwsOptions) => SignedClient;
  now?: () => number;
}
const API_PATH = '/v1/draft';
const OBJECT_NAME = 'melzi-research-v1';
const TOKEN = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const encoder = new TextEncoder();

class Failure extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly retryAfter?: number) {
    super(message);
  }
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function stringList(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.length || parsed.length > 20 || parsed.some(v => typeof v !== 'string' || !v || v.length > 253)) throw new Error('Invalid allowlist');
  return parsed as string[];
}
function origins(env: Env): Set<string> {
  const result = stringList(env.ALLOWED_ORIGINS);
  for (const origin of result) {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) throw new Error('Invalid origin');
  }
  return new Set(result);
}
function configuration(env: Env) {
  const url = new URL(env.LAMBDA_URL);
  if (url.protocol !== 'https:' || !/^[a-z0-9]+\.lambda-url\.us-east-1\.on\.aws$/.test(url.hostname) || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid upstream');
  const hostnames = stringList(env.TURNSTILE_HOSTNAMES);
  if (hostnames.some(host => !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(host))) throw new Error('Invalid hostname');
  if (!env.TURNSTILE_SECRET || env.TURNSTILE_SECRET.length > 512 || /^[123]x0{10,}/.test(env.TURNSTILE_SECRET)) throw new Error('Invalid challenge configuration');
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY || !env.ADMISSION) throw new Error('Missing upstream configuration');
  url.pathname = API_PATH;
  return { url: url.toString(), hostnames: new Set(hostnames) };
}
function response(status: number, value: unknown, origin?: string, retryAfter?: number): Response {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff' });
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Expose-Headers', 'Retry-After');
  }
  if (retryAfter !== undefined) headers.set('Retry-After', String(Math.max(1, Math.min(86_400, Math.ceil(retryAfter)))));
  return new Response(status === 204 ? null : JSON.stringify(value), { status, headers });
}
function fail(error: unknown, origin?: string): Response {
  const known = error instanceof Failure ? error : new Failure(503, 'unavailable', 'Saving is temporarily unavailable.');
  return response(known.status, { error: known.code, message: known.message }, origin, known.retryAfter);
}
function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Failure(503, 'unavailable', 'Saving is temporarily unavailable.')), ms);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}
async function boundedBody(stream: ReadableStream<Uint8Array> | null, maximum: number): Promise<Uint8Array> {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 8_000);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (timedOut) throw new Failure(503, 'unavailable', 'Saving is temporarily unavailable.');
      if (done) break;
      length += value.byteLength;
      if (length > maximum) throw new Failure(413, 'payload_too_large', 'The request is too large.');
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let position = 0;
    for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
    return bytes;
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}
function json(bytes: Uint8Array): unknown {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Failure(400, 'invalid_request', 'A valid JSON object is required.'); }
}
async function digest(value: string | Uint8Array): Promise<string> {
  const input = typeof value === 'string' ? encoder.encode(value) : value;
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', input as BufferSource));
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function createGateway(dependencies: Dependencies = {}) {
  const http = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
  const makeSigner = dependencies.createAwsClient ?? ((options: AwsOptions) => new AwsClient(options));
  const now = dependencies.now ?? Date.now;
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      let allowedOrigin: string | undefined;
      try {
        const url = new URL(request.url);
        if (url.protocol !== 'https:' || url.hostname !== 'api.melzi.dev' || url.port || url.search) throw new Failure(404, 'not_found', 'Not found.');
        if (url.pathname === '/health' && request.method === 'GET') return response(200, { ok: true });
        if (url.pathname !== API_PATH) throw new Failure(404, 'not_found', 'Not found.');
        const origin = request.headers.get('Origin');
        const allowlist = origins(env);
        if (!origin || !allowlist.has(origin)) throw new Failure(403, 'origin_not_allowed', 'This origin is not allowed.');
        allowedOrigin = origin;
        if (request.method === 'OPTIONS') {
          const method = request.headers.get('Access-Control-Request-Method');
          const requestedHeaders = (request.headers.get('Access-Control-Request-Headers') ?? '').split(',').map(header => header.trim().toLowerCase()).filter(Boolean);
          if (!method || !['GET', 'POST', 'PUT'].includes(method) || requestedHeaders.some(header => !['authorization', 'content-type', 'x-turnstile-token'].includes(header))) throw new Failure(403, 'preflight_not_allowed', 'This request is not allowed.');
          const result = response(204, null, origin);
          result.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT');
          result.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Turnstile-Token');
          result.headers.set('Access-Control-Max-Age', '600');
          result.headers.set('Vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers');
          return result;
        }
        if (!['GET', 'POST', 'PUT'].includes(request.method)) throw new Failure(405, 'method_not_allowed', 'This method is not allowed.');
        const authorization = request.headers.get('Authorization') ?? '';
        const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
        if (!TOKEN.test(token)) throw new Failure(401, 'invalid_session', 'A valid session credential is required.');
        const config = configuration(env);
        const contentLength = request.headers.get('Content-Length');
        if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_REQUEST_BYTES)) throw new Failure(413, 'payload_too_large', 'The request is too large.');
        let bytes: Uint8Array | undefined;
        let payload: Record<string, unknown> | undefined;
        if (request.method === 'GET') {
          if (request.body !== null || (contentLength !== null && Number(contentLength) !== 0)) throw new Failure(400, 'invalid_request', 'GET requests must not contain a body.');
        } else {
          if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type') ?? '')) throw new Failure(415, 'unsupported_media_type', 'Use application/json.');
          bytes = await within(boundedBody(request.body, MAX_REQUEST_BYTES), 8_000);
          const parsed = json(bytes);
          if (!object(parsed) || typeof parsed.mutationId !== 'string' || !UUID.test(parsed.mutationId) || !Number.isSafeInteger(parsed.expectedRevision) || (parsed.expectedRevision as number) < 0 || (request.method === 'POST' && parsed.expectedRevision !== 0)) throw new Failure(400, 'invalid_request', 'A mutation ID and valid expected revision are required.');
          payload = parsed;
        }
        const ip = request.headers.get('CF-Connecting-IP');
        if (!ip || ip.length > 64 || !/^[0-9a-fA-F:.]+$/.test(ip)) throw new Failure(503, 'unavailable', 'Saving is temporarily unavailable.');
        const [ipHash, tokenHash] = await Promise.all([digest(`melzi-ip-v1:${ip}`), digest(token)]);
        if (env.IP_BURST) {
          const burst = await within(env.IP_BURST.limit({ key: ipHash }), 2_000);
          if (burst.success !== true) throw new Failure(429, 'rate_limited', 'Please wait before trying again.', 60);
        }
        if (request.method === 'POST') {
          const challenge = request.headers.get('X-Turnstile-Token') ?? '';
          if (!challenge) throw new Failure(403, 'challenge_required', 'Please complete the security check.');
          if (challenge.length > 2_048 || /DUMMY\.TOKEN/i.test(challenge)) throw new Failure(403, 'challenge_failed', 'Please complete the security check again.');
          let verification: unknown;
          try {
            const check = await http('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
              method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5_000),
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: challenge, idempotency_key: payload!.mutationId })
            });
            if (!check.ok) throw new Error('Challenge service unavailable');
            verification = json(await within(boundedBody(check.body, 8_192), 5_000));
          } catch { throw new Failure(503, 'challenge_unavailable', 'The security check is temporarily unavailable.'); }
          if (!object(verification) || verification.success !== true || verification.action !== 'research-draft' || typeof verification.hostname !== 'string' || !config.hostnames.has(verification.hostname) || typeof verification.challenge_ts !== 'string') throw new Failure(403, 'challenge_failed', 'Please complete the security check again.');
          const challengeTime = Date.parse(verification.challenge_ts);
          if (!Number.isFinite(challengeTime) || now() - challengeTime > 330_000 || challengeTime - now() > 60_000) throw new Failure(403, 'challenge_failed', 'Please complete the security check again.');
        }
        const gate = env.ADMISSION.get(env.ADMISSION.idFromName(OBJECT_NAME));
        const admittedResponse = await within(gate.fetch(new Request('https://admission.internal/reserve', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ipHash, tokenHash, creation: request.method === 'POST', ...(request.method === 'POST' ? { creationMutationId: payload!.mutationId } : {}) })
        })), 3_000);
        let admission: unknown;
        try { admission = json(await within(boundedBody(admittedResponse.body, 1_024), 3_000)); }
        catch { throw new Failure(503, 'unavailable', 'Saving is temporarily unavailable.'); }
        if (admittedResponse.status === 403 && object(admission) && admission.allowed === false && admission.reason === 'challenge_reused') throw new Failure(403, 'challenge_failed', 'Please complete the security check again.');
        if (admittedResponse.status === 429 && object(admission) && admission.allowed === false && Number.isInteger(admission.retryAfter) && (admission.retryAfter as number) > 0) throw new Failure(429, 'rate_limited', 'Saving has reached its temporary limit. Your answers remain on this device.', admission.retryAfter as number);
        if (!admittedResponse.ok || !object(admission) || admission.allowed !== true) throw new Failure(503, 'unavailable', 'Saving is temporarily unavailable.');
        // No incoming header is forwarded. SigV4 owns Authorization; the separate
        // owner capability is set here and included by aws4fetch in SignedHeaders.
        const headers = new Headers({ 'Accept': 'application/json', 'X-Melzi-Session': token });
        headers.set('X-Amz-Content-Sha256', await digest(bytes ?? new Uint8Array()));
        if (bytes) headers.set('Content-Type', 'application/json');
        const signer = makeSigner({ accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY, service: 'lambda', region: 'us-east-1', retries: 0 });
        let upstream: Response;
        let result: unknown;
        try {
          upstream = await within(signer.fetch(config.url, { method: request.method, headers, ...(bytes ? { body: bytes as BodyInit } : {}), redirect: 'error', signal: AbortSignal.timeout(8_000) }), 8_000);
          // Never surface HTML errors, AWS diagnostic headers, or exception bodies.
          if (![200, 201, 400, 401, 404, 409, 410, 413, 429].includes(upstream.status) || !/^application\/json(?:\s*;|$)/i.test(upstream.headers.get('Content-Type') ?? '')) {
            void upstream.body?.cancel().catch(() => {});
            throw new Error('Invalid upstream response');
          }
          result = json(await within(boundedBody(upstream.body, MAX_REQUEST_BYTES), 8_000));
          if (!object(result)) throw new Error('Invalid upstream response');
          if (!upstream.ok) {
            if (typeof result.error !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(result.error) || typeof result.message !== 'string' || result.message.length > 300) throw new Error('Invalid upstream error');
            result = { error: result.error, message: result.message, ...(Number.isSafeInteger(result.revision) && (result.revision as number) >= 0 ? { revision: result.revision } : {}) };
          }
        } catch { throw new Failure(503, 'unavailable', 'Saving is temporarily unavailable.'); }
        const retry = upstream.headers.get('Retry-After');
        return response(upstream.status, result, origin, upstream.status === 429 && retry && /^\d+$/.test(retry) ? Number(retry) : undefined);
      } catch (error) { return fail(error, allowedOrigin); }
    }
  };
}
export default createGateway();

const LIMITS = [
  ['ADMISSION_DAILY_LIMIT', 10_000, 100_000],
  ['ADMISSION_MINUTE_LIMIT', 100, 10_000],
  ['ADMISSION_CREATION_DAILY_LIMIT', 500, 100_000],
  ['ADMISSION_IP_MINUTE_LIMIT', 60, 10_000],
  ['ADMISSION_IP_DAILY_LIMIT', 2_000, 100_000],
  ['ADMISSION_SESSION_MINUTE_LIMIT', 30, 1_000]
] as const;
type LimitName = typeof LIMITS[number][0];
function limits(env: Partial<Env>): Record<LimitName, number> {
  return Object.fromEntries(LIMITS.map(([name, fallback, maximum]) => {
    const raw = env[name];
    if (raw !== undefined && (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > maximum)) throw new Error('Invalid admission configuration');
    return [name, raw === undefined ? fallback : Number(raw)];
  })) as Record<LimitName, number>;
}

/** Binding-only coordinator. Never route public requests to this class. */
export class AdmissionGate {
  private readonly sql: SqlStorage;
  private readonly settings: Record<LimitName, number>;
  private nextCleanup = 0;
  constructor(private readonly ctx: ObjectContext, env: Partial<Env>, private readonly now: () => number = Date.now) {
    this.sql = ctx.storage.sql;
    this.settings = limits(env);
    this.sql.exec('CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, bucket INTEGER NOT NULL, count INTEGER NOT NULL, expires_at INTEGER NOT NULL)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS counters_expiry ON counters(expires_at)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS creation_proofs (mutation_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, expires_at INTEGER NOT NULL)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS creation_proofs_expiry ON creation_proofs(expires_at)');
  }
  async fetch(request: Request): Promise<Response> {
    try {
      if (request.method !== 'POST' || new URL(request.url).pathname !== '/reserve') return response(404, { allowed: false });
      const input = json(await boundedBody(request.body, 1_024));
      if (!object(input) || typeof input.ipHash !== 'string' || !HASH.test(input.ipHash) || typeof input.tokenHash !== 'string' || !HASH.test(input.tokenHash) || typeof input.creation !== 'boolean') return response(400, { allowed: false });
      if (input.creation && (typeof input.creationMutationId !== 'string' || !UUID.test(input.creationMutationId))) return response(400, { allowed: false });
      const timestamp = this.now();
      const day = Math.floor(timestamp / 86_400_000);
      const minute = Math.floor(timestamp / 60_000);
      const endDay = (day + 1) * 86_400_000;
      const endMinute = (minute + 1) * 60_000;
      const rules: { key: string; bucket: number; limit: number; expires: number }[] = [
        { key: 'global:day', bucket: day, limit: this.settings.ADMISSION_DAILY_LIMIT, expires: endDay },
        { key: 'global:minute', bucket: minute, limit: this.settings.ADMISSION_MINUTE_LIMIT, expires: endMinute },
        { key: `ip:day:${input.ipHash}`, bucket: day, limit: this.settings.ADMISSION_IP_DAILY_LIMIT, expires: endDay },
        { key: `ip:minute:${input.ipHash}`, bucket: minute, limit: this.settings.ADMISSION_IP_MINUTE_LIMIT, expires: endMinute },
        { key: `session:minute:${input.tokenHash}`, bucket: minute, limit: this.settings.ADMISSION_SESSION_MINUTE_LIMIT, expires: endMinute }
      ];
      if (input.creation) rules.push({ key: 'create:day', bucket: day, limit: this.settings.ADMISSION_CREATION_DAILY_LIMIT, expires: endDay });
      const decision = this.ctx.storage.transactionSync(() => {
        if (timestamp >= this.nextCleanup) {
          this.sql.exec('DELETE FROM counters WHERE key IN (SELECT key FROM counters WHERE expires_at <= ? LIMIT 100)', timestamp);
          this.sql.exec('DELETE FROM creation_proofs WHERE mutation_id IN (SELECT mutation_id FROM creation_proofs WHERE expires_at <= ? LIMIT 100)', timestamp);
        }
        // Siteverify retries can reuse a cached success. Bind that idempotency
        // UUID to one owner so it cannot mint many sessions with one challenge.
        if (input.creation) {
          const proof = this.sql.exec<{ token_hash: string; expires_at: number }>('SELECT token_hash, expires_at FROM creation_proofs WHERE mutation_id = ?', input.creationMutationId as string).toArray()[0];
          if (proof && proof.expires_at > timestamp && proof.token_hash !== input.tokenHash) return { allowed: false, reason: 'challenge_reused' };
        }
        const rows = this.sql.exec<{ key: string; bucket: number; count: number }>(`SELECT key, bucket, count FROM counters WHERE key IN (${rules.map(() => '?').join(',')})`, ...rules.map(rule => rule.key)).toArray();
        const existing = new Map(rows.map(row => [row.key, row]));
        let retryAfter = 0;
        for (const rule of rules) {
          const row = existing.get(rule.key);
          if (row && row.bucket === rule.bucket && row.count >= rule.limit) retryAfter = Math.max(retryAfter, Math.ceil((rule.expires - timestamp) / 1_000));
        }
        if (retryAfter > 0) return { allowed: false, retryAfter };
        for (const rule of rules) {
          const row = existing.get(rule.key);
          if (row?.bucket === rule.bucket) {
            // Do not rewrite the expiry index on each count increment.
            this.sql.exec('UPDATE counters SET count = ? WHERE key = ?', row.count + 1, rule.key);
          } else {
            this.sql.exec('INSERT INTO counters (key, bucket, count, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET bucket = excluded.bucket, count = excluded.count, expires_at = excluded.expires_at', rule.key, rule.bucket, 1, rule.expires);
          }
        }
        if (input.creation) this.sql.exec('INSERT INTO creation_proofs (mutation_id, token_hash, expires_at) VALUES (?, ?, ?) ON CONFLICT(mutation_id) DO UPDATE SET token_hash = excluded.token_hash, expires_at = excluded.expires_at', input.creationMutationId as string, input.tokenHash as string, timestamp + 600_000);
        return { allowed: true };
      });
      this.nextCleanup = Math.max(this.nextCleanup, endMinute);
      return response(decision.allowed ? 200 : 'reason' in decision ? 403 : 429, decision);
    } catch { return response(503, { allowed: false }); }
  }
}
