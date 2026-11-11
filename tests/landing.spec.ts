import { test, expect } from '@playwright/test';

const headline = 'Building in stealth.';
const note = "We're an early-stage company working on infrastructure and security. More to share soon.";
const leaked = ['Batteries-included', 'Testable', 'Secure', 'Isolated replica', 'Threat intel', 'CVEs', 'Honeypots', 'Inventory', 'Exposed endpoints', 'Fix vulnerabilities', 'Block attacks', 'AWS', 'Azure', 'Hetzner', 'Homelab', 'Your application stack', 'Test on a replica', 'We protect the stack', 'auth, storage, databases and secrets'];

test('landing page shows only the stealth notice', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.wordmark')).toHaveText('Melzi');
  await expect(page.locator('h1')).toHaveText(headline);
  await expect(page.locator('.note')).toHaveText(note);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  const text = await page.locator('main').textContent();
  for (const term of leaked) expect(text).not.toContain(term);
  expect(await page.locator('[data-diagram], .story-track, dialog').count()).toBe(0);
  expect(errors).toEqual([]);
});

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
  test(`stealth page fits without overflow at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('.note')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight + 1)).toBe(false);
    expect(errors).toEqual([]);
  });
}

test('stealth page is server-rendered without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('.wordmark')).toHaveText('Melzi');
  await expect(page.locator('h1')).toHaveText(headline);
  await expect(page.locator('.note')).toHaveText(note);
  await context.close();
});

test('removed routes no longer resolve', async ({ page }) => {
  for (const path of ['/qgraph/', '/research/']) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
  }
});
