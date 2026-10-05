import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { createHandler, type HandlerDependencies } from '../backend/handler.js';
import { createAdmission } from '../backend/admission.js';
import { database } from '../backend/database.js';
import { ApiFailure } from '../backend/validation.js';
import { MAX_REQUEST_BYTES } from '../../src/lib/research/persistence-contract.js';

export function allowedOrigins(value: string | undefined): Set<string> {
  if (!value) throw new Error('Missing allowed origins');
  const values = value.split(',').map(value => value.trim());
  if (!values.length || values.length > 12) throw new Error('Invalid allowed origins');
  for (const origin of values) {
    let url: URL;
    try { url = new URL(origin); } catch { throw new Error('Invalid allowed origin'); }
    if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) throw new Error('Invalid allowed origin');
  }
  return new Set(values);
}
export function bearerCredential(headers: Record<string, string>): string | undefined {
  // The byte-canonical 256-bit credential is checked again by credentialHash.
  return /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(headers.authorization ?? '')?.[1];
}
export async function readBody(request: HttpRequest, limit = MAX_REQUEST_BYTES): Promise<Uint8Array> {
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new ApiFailure(413, 'too_large', 'The response is too large.');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel().catch(() => {});
        throw new ApiFailure(413, 'too_large', 'The response is too large.');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks, length);
  } catch (error) {
    if (error instanceof ApiFailure) throw error;
    throw new ApiFailure(400, 'invalid_body', 'The request body could not be read.');
  } finally { reader.releaseLock(); }
}

export function createAzureHttpHandler(dependencies: HandlerDependencies & { origins?: string } = {}) {
  const origins = allowedOrigins(dependencies.origins ?? process.env.ALLOWED_ORIGINS);
  const admission = createAdmission({ provider: 'azure' });
  const core = createHandler({
    getPool: async () => {
      if (process.env.PGUSER !== 'melzi_research_app') throw new Error('Restricted database role required');
      return database();
    },
    reserve: admission.reserveInvocation, stop: admission.stopOnDependencyFailure,
    ...dependencies,
    countEveryInvocation: true,
    credential: bearerCredential,
    validateHeaders: headers => {
      if (headers.origin !== undefined && !origins.has(headers.origin)) throw new ApiFailure(403, 'origin_not_allowed', 'This origin is not allowed.');
    },
    preflight: headers => {
      const requested = headers['access-control-request-headers'] ?? '';
      if (!headers.origin || !['GET', 'POST', 'PUT'].includes(headers['access-control-request-method'] ?? '') ||
          requested.length > 256 || requested.split(',').some(value => value.trim() && !['authorization', 'content-type'].includes(value.trim().toLowerCase()))) {
        throw new ApiFailure(400, 'invalid_preflight', 'This preflight request is not allowed.');
      }
    }
  });
  return async (request: HttpRequest): Promise<HttpResponseInit> => {
    // No incoming x-melzi-* / x-ms-* headers are passed into the shared core.
    const headers: Record<string, string> = {};
    for (const name of ['authorization', 'content-type', 'content-length', 'origin', 'access-control-request-method', 'access-control-request-headers']) {
      const value = request.headers.get(name);
      if (value !== null) headers[name] = value;
    }
    let path = '';
    try { path = new URL(request.url).pathname; } catch { /* Core counts and rejects malformed routes. */ }
    const result = await core({
      rawPath: path === '/api/v1/draft' ? '/v1/draft' : path,
      requestContext: { http: { method: request.method } }, headers,
      readBody: () => readBody(request)
    });
    const origin = headers.origin;
    return { status: result.statusCode, body: result.body, headers: {
      ...result.headers, vary: 'Origin',
      ...(origin && origins.has(origin) ? {
        'access-control-allow-origin': origin,
        'access-control-expose-headers': 'Retry-After',
        ...(request.method === 'OPTIONS' && result.statusCode === 204 ? {
          'access-control-allow-methods': 'GET, POST, PUT',
          'access-control-allow-headers': 'Authorization, Content-Type',
          'access-control-max-age': '600'
        } : {})
      } : {})
    } };
  };
}
