import { test, expect } from '@playwright/test';
import { access, readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const root = resolve('build');
const staticOrigin = 'https://melzi-static.test';
const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2' };

test('static production build ships a self-only CSP and only the stealth notice', async ({ page }) => {
  try { await access(resolve(root, 'index.html')); }
  catch { throw new Error('Build the static site before this test: npm run build'); }
  const errors: string[] = [], apiCalls: string[] = [];
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
  await page.route('**/v1/draft', route => { apiCalls.push(route.request().url()); return route.fulfill({ status: 404, body: '' }); });
  await page.goto(`${staticOrigin}/`);
  await expect(page.locator('.wordmark')).toHaveText('Melzi');
  const csp = await page.locator('meta[http-equiv="content-security-policy"]').getAttribute('content');
  const directives = new Map(csp!.split(';').map(part => { const [name, ...sources] = part.trim().split(/\s+/); return [name, sources]; }));
  expect(directives.get('connect-src')).toEqual(["'self'"]);
  expect(directives.get('frame-src')).toEqual(["'none'"]);
  expect(directives.get('script-src')).not.toContain("'unsafe-inline'");
  expect(directives.get('script-src')).not.toContain('https:');
  const text = await page.evaluate(() => document.body.textContent ?? '');
  expect(text).not.toMatch(/Batteries-included|Isolated replica|Threat intel|Hetzner|Help shape Melzi|What are you working on|How much of a problem is infrastructure work/);
  expect(await page.locator('[data-diagram], .story-track, dialog').count()).toBe(0);
  expect(apiCalls).toEqual([]);
  expect(errors).toEqual([]);
});
