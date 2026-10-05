import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { handler as verify } from '../backend/verify.js';
import { readBody } from './http-adapter.js';
const ACTIONS = new Set(['probe', 'quotaSnapshot', 'armQuota', 'prepareRollover', 'restoreSnapshot', 'expireFixture', 'cleanupFixture', 'cleanupAbandonedRun']);
const KEYS = new Set(['action', 'runId', 'tokenHash', 'fixtureProof', 'inspectOnly', 'snapshot', 'expected']);
export function createVerificationHandler(invoke: typeof verify = verify) {
  return async (request: HttpRequest): Promise<HttpResponseInit> => {
    const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
    try {
      if (request.method !== 'POST' || !/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) throw new Error('Invalid verification request');
      const event = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, 16384)));
      if (!event || typeof event !== 'object' || Array.isArray(event) || !ACTIONS.has(event.action) || Object.keys(event).some(key => !KEYS.has(key))) throw new Error('Invalid verification request');
      const result = await invoke(event);
      return { status: result.ok ? 200 : 400, headers, jsonBody: result };
    } catch { return { status: 400, headers, jsonBody: { ok: false, error: 'verification_failed' } }; }
  };
}
