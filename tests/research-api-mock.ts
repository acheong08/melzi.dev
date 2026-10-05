import type { Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import type { RemoteDraft, SaveRequest, SaveResult } from '../src/lib/research/persistence-contract';

export async function mockResearchApi(page: Page, provider: 'azure' | 'aws' | 'turnstile' = 'azure') {
  const state = {
    requests: [] as { method: string; token: string; body?: SaveRequest; challenge?: string; hash?: string; rawBody: string | null }[],
    challengeLoads: 0,
    records: new Map<string, RemoteDraft>(), mutations: new Map<string, { body: string; result: SaveResult }>(),
    status: 0, retryAfter: '1', loseNextAck: false, holdFinal: false,
    releaseFinal: undefined as (() => void) | undefined
  };
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', route => { state.challengeLoads++; return route.fulfill({ contentType: 'application/javascript', body: `window.turnstile={render:(container,options)=>{container.innerHTML='<span>Verification ready</span>';setTimeout(()=>options.callback('mock-turnstile-'+Math.random()),0);return 'mock-widget';},remove:()=>{}};` }); });
  await page.route('**/v1/draft', async route => {
    const request = route.request(), method = request.method();
    const token = request.headers().authorization?.replace('Bearer ', '') ?? '';
    const body = method === 'GET' ? undefined : request.postDataJSON() as SaveRequest;
    state.requests.push({ method, token, body, challenge: request.headers()['x-turnstile-token'], hash: request.headers()['x-amz-content-sha256'], rawBody: request.postData() });
    const fail = (status: number, error: string) => route.fulfill({ status, contentType: 'application/json', headers: { 'Retry-After': state.retryAfter }, body: JSON.stringify({ error, message: error }) });
    if (state.status) return fail(state.status, 'mock_error');
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return fail(401, 'credential');
    const record = state.records.get(token);
    if (method === 'GET') return record ? route.fulfill({ json: record }) : fail(404, 'not_found');
    if (provider === 'turnstile' && method === 'POST' && !request.headers()['x-turnstile-token']) return fail(403, 'challenge_required');
    if (provider === 'aws' && request.headers()['x-amz-content-sha256'] !== createHash('sha256').update(request.postData()!, 'utf8').digest('hex')) return fail(403, 'payload_hash_mismatch');
    if (provider !== 'turnstile' && request.headers()['x-turnstile-token']) return fail(400, 'unexpected_challenge');
    if (provider === 'azure' && request.headers()['x-amz-content-sha256']) return fail(400, 'unexpected_aws_hash');
    const key = `${token}:${body!.mutationId}`, prior = state.mutations.get(key);
    if (prior) return prior.body === JSON.stringify(body) ? route.fulfill({ json: prior.result }) : fail(409, 'mutation_conflict');
    if ((method === 'POST' && record) || (method === 'PUT' && record?.revision !== body!.expectedRevision)) return fail(409, 'revision_conflict');
    if (state.holdFinal && body!.completed) await new Promise<void>(resolve => { state.releaseFinal = resolve; });
    const result = { revision: body!.expectedRevision + 1, savedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + (body!.completed ? 365 : 30) * 86400000).toISOString(), completed: body!.completed };
    state.records.set(token, { schemaVersion: 4, answers: body!.answers, step: body!.step, ...result });
    state.mutations.set(key, { body: JSON.stringify(body), result });
    if (state.loseNextAck) { state.loseNextAck = false; return route.abort('failed'); }
    return route.fulfill({ json: result });
  });
  return state;
}
