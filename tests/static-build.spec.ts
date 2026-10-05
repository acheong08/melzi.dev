import { test, expect } from '@playwright/test';
import { access, readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import type { RemoteDraft, SaveRequest, SaveResult } from '../src/lib/research/persistence-contract';

const root = resolve('build');
const staticOrigin = 'https://melzi-static.test';
const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2' };

test('static production CSP permits Azure cross-origin autosave with only the configured HTTPS API origin', async ({ page }) => {
  try { await access(resolve(root, 'index.html')); }
  catch { throw new Error('Build the Azure static site before this test: VITE_RESEARCH_SECURITY_PROVIDER=azure VITE_RESEARCH_API_URL=https://api.melzi.test/api npm run build'); }
  const errors: string[] = [], apiOrigins: string[] = [];
  let saved: RemoteDraft | undefined, apiCalls = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /content security policy|refused to execute|refused to connect/i.test(message.text())) errors.push(message.text()); });
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.route(`${staticOrigin}/**`, async route => {
    const url = new URL(route.request().url());
    let path = decodeURIComponent(url.pathname); if (path.endsWith('/')) path += 'index.html';
    const file = resolve(root, '.' + path);
    if (!file.startsWith(root + sep)) return route.fulfill({ status: 404, body: 'Not found' });
    try { return await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] || 'application/octet-stream', headers: { 'content-security-policy': "frame-ancestors 'none'", 'x-frame-options': 'DENY' } }); }
    catch { return route.fulfill({ status: 404, body: 'Not found' }); }
  });
  // Intercept every configured API origin. No request reaches a live Azure app.
  await page.route('**/v1/draft', async route => {
    const request = route.request();
    const cors = {
      'access-control-allow-origin': staticOrigin,
      'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-expose-headers': 'Retry-After',
      'cache-control': 'no-store', 'vary': 'Origin'
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    apiCalls++; apiOrigins.push(new URL(request.url()).origin);
    const headers = request.headers();
    expect(/^Bearer [A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(headers.authorization ?? '')).toBe(true);
    expect(headers['x-amz-content-sha256']).toBeUndefined(); expect(headers['x-turnstile-token']).toBeUndefined();
    if (request.method() === 'GET') return route.fulfill({ status: saved ? 200 : 404, headers: cors, json: saved ?? { error: 'not_found' } });
    const body = request.postDataJSON() as SaveRequest;
    const result: SaveResult = { revision: body.expectedRevision + 1, savedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(), completed: body.completed };
    saved = { schemaVersion: 4, answers: body.answers, step: body.step, ...result };
    return route.fulfill({ status: 200, headers: cors, json: result });
  });
  await page.goto(`${staticOrigin}/`);
  await expect(page.locator('.story-track')).toHaveAttribute('data-scroll-ready', 'true');
  const csp = await page.locator('meta[http-equiv="content-security-policy"]').getAttribute('content');
  const directives = new Map(csp!.split(';').map(part => { const [name, ...sources] = part.trim().split(/\s+/); return [name, sources]; }));
  const connect = directives.get('connect-src')!;
  expect(connect).toHaveLength(2); expect(connect).toContain("'self'");
  const apiOrigin = connect.find(value => value !== "'self'")!;
  expect(new URL(apiOrigin).protocol).toBe('https:'); expect(new URL(apiOrigin).origin).toBe(apiOrigin);
  expect(apiOrigin).not.toContain('*'); expect(apiOrigin).not.toBe(staticOrigin); expect(connect).not.toContain('https:');
  if (process.env.VITE_RESEARCH_API_URL) expect(apiOrigin).toBe(new URL(process.env.VITE_RESEARCH_API_URL).origin);
  expect(directives.get('script-src')).not.toContain("'unsafe-inline'");
  expect(directives.get('script-src')).not.toContain('https:');
  expect(directives.get('frame-src')).toEqual(["'none'"]);
  expect(apiCalls).toBe(0);
  await page.getByRole('button', { name: 'Help shape Melzi' }).click();
  await page.getByLabel('A side project', { exact: true }).check();
  await expect.poll(() => saved?.answers.context).toBe('side-project');
  await expect(page.locator('.save-note')).toHaveText('Saved');
  await page.reload(); await expect(page.locator('.story-track')).toHaveAttribute('data-scroll-ready', 'true');
  await page.getByRole('button', { name: 'Help shape Melzi' }).click();
  await expect(page.getByLabel('A side project', { exact: true })).toBeChecked();
  expect(apiOrigins.length).toBeGreaterThanOrEqual(2); expect(apiOrigins.every(origin => origin === apiOrigin)).toBe(true);
  expect(errors).toEqual([]);
  await page.goto(`${staticOrigin}/privacy/`);
  await expect(page.getByRole('heading', { name: 'How we use your answers' })).toBeVisible();
  expect(errors).toEqual([]);
});
