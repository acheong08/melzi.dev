import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { DraftPersistence, parseLocalDraft, finalValidation, STORAGE_KEY } from '../src/lib/research/persistence';
import { emptyAnswers } from '../src/lib/research/form';
import type { SaveRequest } from '../src/lib/research/persistence-contract';

const answer = { ...emptyAnswers(), context: 'side-project' };
const final = { ...answer, stage: 'idea', burden: 'none', email: 'valid@example.com' };
const success = (request: SaveRequest) => new Response(JSON.stringify({ revision: request.expectedRevision + 1, completed: request.completed, savedAt: '2026-10-01T00:00:00.000Z', expiresAt: '2026-11-01T00:00:00.000Z' }), { status: 200 });
function setup(handler?: typeof fetch, securityProvider?: 'azure' | 'aws' | 'turnstile', capabilities: { crypto?: Crypto; secureContext?: () => boolean } = {}) {
  let raw: string | null = null, online = true, now = Date.now(), challenges = 0;
  const calls: { method: string; body: SaveRequest; token: string; durable: string | null; rawBody: string; headers: Record<string, string> }[] = [];
  const storage = { getItem: () => raw, setItem: (_: string, value: string) => { raw = value; }, removeItem: () => { raw = null; } };
  const fetcher: typeof fetch = async (url, init) => {
    const body = JSON.parse(init!.body as string);
    calls.push({ method: init!.method!, body, token: (init!.headers as Record<string, string>).Authorization, durable: raw, rawBody: init!.body as string, headers: init!.headers as Record<string, string> });
    return handler ? handler(url, init) : success(body);
  };
  const controller = new DraftPersistence({ storage, fetch: fetcher, online: () => online, securityProvider, challenge: async () => { challenges++; return `fresh-challenge-${challenges}`; }, now: () => now, debounceMs: 60000, maxWaitMs: 60000, timeoutMs: 20, ...capabilities });
  controller.hydrate();
  return { controller, calls, storage, raw: () => raw, challenges: () => challenges, online: (value: boolean) => { online = value; }, advance: (ms: number) => { now += ms; } };
}

test('credential and exact pending body are durable before any request, including creation before final', async () => {
  const t = setup(); t.controller.update(final, 'hate', true); await t.controller.flush();
  expect(t.calls[0].method).toBe('POST'); expect(t.calls[0].body.completed).toBe(false);
  expect(JSON.parse(t.calls[0].durable!).pending.request).toEqual(t.calls[0].body);
  expect(JSON.parse(t.calls[0].durable!).token).toBe(t.calls[0].token.replace('Bearer ', ''));
  expect(t.controller.view.submitted).toBe(false);
  await t.controller.flush(); expect(t.calls[1].method).toBe('PUT'); expect(t.calls[1].body.completed).toBe(true);
  expect(t.controller.view.submitted).toBe(true); t.controller.clearLocal();
});

test('single-flight acknowledgement never replaces newer local edits', async () => {
  let release!: (response: Response) => void;
  const t = setup(() => new Promise(resolve => { release = resolve; }));
  t.controller.update(answer, 'context'); const request = t.controller.flush();
  await expect.poll(() => !!release).toBe(true);
  t.controller.update({ ...answer, contextDetails: 'Newer local text' }, 'stage');
  await t.controller.flush(); expect(t.calls).toHaveLength(1);
  release(success(t.calls[0].body)); await request;
  expect(t.controller.view.draft!.answers.contextDetails).toBe('Newer local text');
  expect(t.controller.view.state).toBe('saving'); t.controller.clearLocal();
});

test('clearing a session isolates a late response and next edit creates a new credential', async () => {
  let release!: (response: Response) => void;
  const t = setup(() => new Promise(resolve => { release = resolve; }));
  t.controller.update(answer, 'context'); const request = t.controller.flush();
  await expect.poll(() => !!release).toBe(true); const oldToken = t.controller.view.draft!.token;
  t.controller.clearLocal(); t.controller.update({ ...answer, context: 'other' }, 'context');
  const newToken = t.controller.view.draft!.token; expect(newToken).not.toBe(oldToken);
  release(success(t.calls[0].body)); await request;
  expect(t.controller.view.draft).toMatchObject({ token: newToken, revision: null, answers: { context: 'other' } });
  t.controller.clearLocal();
});

test('429 honors Retry-After even when the user retries or edits', async () => {
  const t = setup(async () => new Response('{}', { status: 429, headers: { 'Retry-After': '30' } }));
  t.controller.update(answer, 'context'); await t.controller.flush(); expect(t.controller.view.state).toBe('retrying');
  t.controller.update({ ...answer, contextDetails: 'More typing' }, 'context');
  await t.controller.flush(); t.controller.retry(); expect(t.calls).toHaveLength(1);
  t.advance(30001); await t.controller.flush(); expect(t.calls).toHaveLength(2);
  expect(t.calls[1].body).toEqual(t.calls[0].body); t.controller.clearLocal();
});

test('request timeout keeps the same mutation pending instead of claiming success', async () => {
  const t = setup((_url, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('timed out')))));
  t.controller.update(answer, 'context'); await t.controller.flush();
  expect(t.controller.view.state).toBe('retrying'); expect(t.controller.view.submitted).toBe(false);
  expect(t.controller.view.draft!.pending!.request).toEqual(t.calls[0].body); t.controller.clearLocal();
});

test('validation and storage hydration reject corruption while keeping old local drafts and clamping hidden steps', () => {
  const t = setup(); t.online(false); t.controller.update(answer, 'context');
  const draft = JSON.parse(t.raw()!); draft.createdAt = '2020-01-01T00:00:00Z'; draft.updatedAt = draft.createdAt; draft.step = 'stack';
  const parsed = parseLocalDraft(JSON.stringify(draft)); expect(parsed.answers.context).toBe('side-project'); expect(parsed.step).toBe('context');
  expect(() => parseLocalDraft(JSON.stringify({ ...draft, answers: { context: 'other' } }))).toThrow();
  expect(() => parseLocalDraft(JSON.stringify({ ...draft, token: 'not-a-secure-token' }))).toThrow();
  expect(() => parseLocalDraft(JSON.stringify({ ...draft, pending: { method: 'POST', request: { ...draft, mutationId: 'bad', expectedRevision: 0 } } }))).toThrow();
  expect(finalValidation({ ...final, email: 'invalid' })).toBe('contact');
  expect(finalValidation({ ...final, email: 'valid@example.com' })).toBeNull();
  expect(finalValidation({ ...final, email: 'valid@example.com', burden: '' })).toBe('burden');
  expect(finalValidation({ ...final, email: 'valid@example.com', context: 'startup' })).toBe('role');
  t.controller.clearLocal();
});

test('invalid final responses stay drafts and unfinished emails still autosave', async () => {
  const t = setup(); t.controller.update({ ...final, email: 'partial@' }, 'contact'); await t.controller.flush();
  expect(t.calls[0].body.answers.email).toBe('partial@'); expect(t.calls[0].body.completed).toBe(false);
  t.controller.update({ ...final, email: 'partial@' }, 'hate', true); await t.controller.flush();
  expect(t.calls).toHaveLength(1); expect(t.controller.view.submitted).toBe(false); t.controller.clearLocal();
});

test('another tab is detected before a write even without a storage event', () => {
  const t = setup(); t.controller.update(answer, 'context');
  const other = JSON.parse(t.raw()!); other.answers.context = 'startup'; t.storage.setItem(STORAGE_KEY, JSON.stringify(other));
  t.controller.update({ ...answer, contextDetails: 'My edit' }, 'context');
  expect(t.controller.view.state).toBe('conflict'); expect(JSON.parse(t.raw()!).answers.context).toBe('startup'); t.controller.clearLocal();
});

test('explicit AWS mode hashes exact UTF-8 JSON bytes for POST and PUT without challenges', async () => {
  const t = setup(undefined, 'aws');
  t.controller.update({ ...answer, contextDetails: '  Café ☕, 日本語, "quotes" and\nnewlines  ' }, 'context');
  await t.controller.flush(); t.controller.update({ ...answer, stack: 'Emoji 👩🏽‍💻 and tabs\there' }, 'stage'); await t.controller.flush();
  expect(t.calls.map(call => call.method)).toEqual(['POST', 'PUT']);
  for (const call of t.calls) {
    expect(call.headers['x-amz-content-sha256']).toBe(createHash('sha256').update(call.rawBody, 'utf8').digest('hex'));
    expect(call.rawBody).toBe(JSON.stringify(JSON.parse(call.durable!).pending.request));
    expect(call.headers['X-Turnstile-Token']).toBeUndefined();
  }
  expect(t.challenges()).toBe(0); t.controller.clearLocal();
});

test('explicit Turnstile mode obtains fresh challenge tokens outside an unchanged retry payload', async () => {
  let attempts = 0;
  const t = setup(async (_url, init) => { if (++attempts === 1) throw new Error('lost acknowledgement'); return success(JSON.parse(init!.body as string)); }, 'turnstile');
  t.controller.update(answer, 'context'); await t.controller.flush(); t.advance(5000); await t.controller.flush();
  expect(t.challenges()).toBe(2); expect(t.calls[0].rawBody).toBe(t.calls[1].rawBody);
  expect(t.calls[0].headers['X-Turnstile-Token']).not.toBe(t.calls[1].headers['X-Turnstile-Token']);
  expect(t.calls[0].headers['x-amz-content-sha256']).toBeUndefined();
  expect(t.controller.view.state).toBe('saved'); t.controller.clearLocal();
});

function cryptoWith(overrides: Partial<Crypto>): Crypto {
  return { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto), randomUUID: globalThis.crypto.randomUUID.bind(globalThis.crypto), subtle: globalThis.crypto.subtle, ...overrides } as Crypto;
}
for (const missing of ['randomUUID', 'subtle'] as const) test(`missing ${missing} blocks transport without blocking durable local edits`, async () => {
  const t = setup(undefined, undefined, { crypto: cryptoWith({ [missing]: undefined }), secureContext: () => true });
  t.controller.update(answer, 'context'); await t.controller.flush();
  expect(t.calls).toHaveLength(0); expect(t.challenges()).toBe(0);
  expect(t.controller.view.state).toBe('invalid'); expect(t.controller.view.warning).toContain('HTTPS and secure browser cryptography');
  expect(Reflect.get(t.controller, 'active')).toBe(false); expect(Reflect.get(t.controller, 'timer')).toBeUndefined();
  t.controller.update({ ...answer, contextDetails: 'Local-only edit' }, 'context');
  expect(parseLocalDraft(t.raw()!).answers.contextDetails).toBe('Local-only edit');
  t.controller.retry(); t.controller.connectionChanged(); await t.controller.flush();
  expect(t.calls).toHaveLength(0); expect(t.controller.view.draft!.pending).toBeNull(); t.controller.clearLocal();
});

test('insecure contexts block transport even when injected crypto supports all methods', async () => {
  const t = setup(undefined, 'turnstile', { secureContext: () => false });
  t.controller.update(answer, 'context'); await t.controller.flush();
  expect(t.calls).toHaveLength(0); expect(t.challenges()).toBe(0); expect(t.controller.view.state).toBe('invalid');
  expect(parseLocalDraft(t.raw()!).answers.context).toBe('side-project'); expect(Reflect.get(t.controller, 'active')).toBe(false);
  t.controller.clearLocal();
});

test('a throwing UUID generator is contained by finally and never sticks in Saving', async () => {
  const t = setup(undefined, undefined, { crypto: cryptoWith({ randomUUID: () => { throw new Error('Crypto unavailable'); } }), secureContext: () => true });
  t.controller.update(answer, 'context'); await expect(t.controller.flush()).resolves.toBeUndefined();
  expect(t.controller.view.state).toBe('invalid'); expect(Reflect.get(t.controller, 'active')).toBe(false);
  expect(Reflect.get(t.controller, 'timer')).toBeUndefined(); expect(t.calls).toHaveLength(0);
  t.controller.update({ ...answer, contextDetails: 'Still editable' }, 'context');
  expect(parseLocalDraft(t.raw()!).answers.contextDetails).toBe('Still editable'); t.controller.clearLocal();
});

for (const reason of ['insecure', 'missing-subtle'] as const) test(`${reason} hydration and explicit reload never send a credential GET`, async () => {
  const original = setup(); original.controller.update(answer, 'context'); await original.controller.flush();
  let requests = 0;
  const restored = new DraftPersistence({ storage: original.storage, fetch: async () => { requests++; throw new Error('Must not fetch'); }, online: () => true, secureContext: () => reason !== 'insecure', crypto: reason === 'missing-subtle' ? cryptoWith({ subtle: undefined }) : globalThis.crypto });
  restored.hydrate(); await restored.reloadSaved();
  expect(requests).toBe(0); expect(restored.view.state).toBe('invalid'); expect(restored.view.warning).toContain('HTTPS');
  expect(restored.view.draft!.answers.context).toBe('side-project'); expect(Reflect.get(restored, 'checking')).toBe(false);
  restored.clearLocal(); original.controller.clearLocal();
});

test('transport checks do not overwrite storage or conflict warnings', async () => {
  const t = setup(undefined, undefined, { secureContext: () => false });
  t.controller.update(answer, 'context'); t.controller.storageChanged('{another-tab}');
  const conflict = t.controller.view.warning; await t.controller.flush();
  expect(t.controller.view.state).toBe('conflict'); expect(t.controller.view.warning).toBe(conflict); t.controller.clearLocal();
  t.storage.setItem = () => { throw new Error('Quota exceeded'); };
  t.controller.update(answer, 'context'); const storageWarning = t.controller.view.warning; await t.controller.flush();
  expect(t.controller.view.state).toBe('storage'); expect(t.controller.view.warning).toBe(storageWarning); expect(t.calls).toHaveLength(0); t.controller.clearLocal();
});

test('Azure is the default and preserves Bearer credentials without AWS or challenge headers', async () => {
  const t = setup(); t.controller.update(answer, 'context'); await t.controller.flush();
  t.controller.update({ ...answer, contextDetails: 'An Azure draft' }, 'stage'); await t.controller.flush();
  expect(t.calls.map(call => call.method)).toEqual(['POST', 'PUT']);
  for (const call of t.calls) {
    expect(/^Bearer [A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(call.headers.Authorization)).toBe(true);
    expect(call.headers['x-amz-content-sha256']).toBeUndefined(); expect(call.headers['X-Turnstile-Token']).toBeUndefined();
    expect(call.rawBody).toBe(JSON.stringify(JSON.parse(call.durable!).pending.request));
  }
  expect(t.challenges()).toBe(0); t.controller.clearLocal();
});

for (const response of ['html', 'unknown-json'] as const) test(`Azure platform ${response} 403 preserves the pending mutation and retries with backoff`, async () => {
  let attempts = 0;
  const t = setup(async (_url, init) => {
    if (++attempts === 1) return response === 'html' ? new Response('<html>This web app is stopped.</html>', { status: 403, headers: { 'Content-Type': 'text/html', 'Retry-After': '30' } }) : new Response(JSON.stringify({ error: 'platform_unavailable' }), { status: 403, headers: { 'Content-Type': 'application/json', 'Retry-After': '30' } });
    return success(JSON.parse(init!.body as string));
  }, 'azure');
  t.controller.update(answer, 'context'); await t.controller.flush();
  expect(t.controller.view.state).toBe('retrying'); expect(t.controller.view.warning).toContain('temporarily unavailable');
  expect(t.controller.view.submitted).toBe(false); expect(t.controller.view.draft!.pending!.request).toEqual(t.calls[0].body);
  t.controller.update({ ...answer, contextDetails: 'Still editable during outage' }, 'context'); await t.controller.flush();
  expect(t.calls).toHaveLength(1); expect(parseLocalDraft(t.raw()!).answers.contextDetails).toBe('Still editable during outage');
  t.advance(30001); await t.controller.flush(); expect(t.calls[1].rawBody).toBe(t.calls[0].rawBody);
  await t.controller.flush(); expect(t.controller.view.state).toBe('saved'); t.controller.clearLocal();
});

for (const code of ['origin_not_allowed', 'forbidden']) test(`Azure explicit API ${code} 403 is terminal`, async () => {
  const t = setup(async () => new Response(JSON.stringify({ error: code }), { status: 403, headers: { 'Content-Type': 'application/json' } }), 'azure');
  t.controller.update(answer, 'context'); await t.controller.flush();
  expect(t.controller.view.state).toBe('invalid'); expect(t.controller.view.warning).toContain('not allowed');
  t.advance(60000); t.controller.retry(); await t.controller.flush(); expect(t.calls).toHaveLength(1);
  expect(Reflect.get(t.controller, 'timer')).toBeUndefined(); t.controller.clearLocal();
});
