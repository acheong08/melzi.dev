import { test, expect, type Page } from '@playwright/test';
import { mockResearchApi } from './research-api-mock';
import { STORAGE_KEY } from '../src/lib/research/persistence';

async function open(page: Page) {
  await page.goto('/');
  await expect(page.locator('.story-track')).toHaveAttribute('data-scroll-ready', 'true');
  await page.getByRole('button', { name: 'Help shape Melzi', exact: true }).click();
}
async function choose(page: Page, name: string) {
  await page.getByRole('radio', { name, exact: true }).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
}
async function finalStep(page: Page) {
  await choose(page, 'A side project'); await choose(page, 'Exploring an idea');
  await choose(page, 'Not a problem'); await choose(page, 'Nothing yet, just sharing feedback');
}
const thanks = (page: Page) => page.getByRole('heading', { name: 'Thanks for helping shape Melzi.', exact: true });
const status = (page: Page) => page.locator('.save-note');
const local = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);

test('visiting creates no credential or server record; first partial answer saves losslessly and reloads', async ({ page }) => {
  const api = await mockResearchApi(page); await open(page);
  expect(api.requests).toHaveLength(0); expect(await local(page)).toBeNull();
  await page.getByRole('radio', { name: 'Something else', exact: true }).check();
  await page.getByRole('textbox', { name: 'What are you working on? (optional)' }).fill('  unfinished details  ');
  expect((await local(page)).answers.contextDetails).toBe('  unfinished details  ');
  await expect(status(page)).toHaveText('Saved');
  const creation = api.requests.find(r => r.method === 'POST')!;
  expect(creation.token).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(creation.challenge).toBeUndefined();
  expect(creation.hash).toBeUndefined(); expect(api.challengeLoads).toBe(0);
  await expect(page.locator('.verification')).toHaveCount(0);
  expect(creation.body).toMatchObject({ schemaVersion: 4, completed: false, expectedRevision: 0, answers: { context: 'other', contextDetails: '  unfinished details  ', stage: '', stackTools: [], email: '' } });
  await page.reload(); await expect(page.locator('.story-track')).toHaveAttribute('data-scroll-ready', 'true'); await page.getByRole('button', { name: 'Help shape Melzi', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'What are you working on? (optional)' })).toHaveValue('  unfinished details  ');
  expect(api.requests.some(r => r.method === 'GET')).toBe(true);
  expect(api.requests.filter(r => r.method === 'GET').every(r => r.hash === undefined)).toBe(true);
});

test('offline final submission stays pending through reload and succeeds only after reconnect', async ({ page, context }) => {
  const api = await mockResearchApi(page); await open(page); await finalStep(page); await expect(status(page)).toHaveText('Saved');
  await context.setOffline(true);
  await page.getByRole('textbox', { name: 'Anything you currently use that you absolutely HATE?' }).fill('Offline printer');
  await page.getByRole('button', { name: 'Submit feedback', exact: true }).click();
  await expect(page.getByText('Submission pending.', { exact: false })).toBeVisible(); await expect(thanks(page)).toHaveCount(0);
  expect((await local(page)).completed).toBe(true);
  // Load application assets while keeping the restored controller offline and API unavailable.
  api.status = 503;
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }));
  await context.setOffline(false); await page.reload();
  await expect(page.locator('.story-track')).toHaveAttribute('data-scroll-ready', 'true');
  await page.getByRole('button', { name: 'Help shape Melzi', exact: true }).click();
  await expect(page.getByText('Submission pending.', { exact: false })).toBeVisible(); await expect(thanks(page)).toHaveCount(0);
  api.status = 0;
  await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, value: true }); window.dispatchEvent(new Event('online')); });
  await expect(thanks(page)).toBeVisible();
});

test('lost acknowledgement retries the identical mutation before sending newer answers', async ({ page }) => {
  const api = await mockResearchApi(page); api.loseNextAck = true; await open(page);
  await page.getByRole('radio', { name: 'Something else', exact: true }).check();
  await page.getByRole('textbox', { name: 'What are you working on? (optional)' }).fill('Original');
  await expect(status(page)).toHaveText('Saved on this device, retrying');
  await page.getByRole('textbox', { name: 'What are you working on? (optional)' }).fill('Newer local edit');
  await expect(status(page)).toHaveText('Saved');
  const writes = api.requests.filter(r => r.body);
  expect(writes.length).toBeGreaterThanOrEqual(3);
  expect(writes[1].body).toEqual(writes[0].body);
  expect(writes[1].rawBody).toBe(writes[0].rawBody); expect(writes[1].hash).toBe(writes[0].hash);
  expect(api.challengeLoads).toBe(0);
  expect(writes[2].method).toBe('PUT'); expect(writes[2].body!.answers.contextDetails).toBe('Newer local edit');
});

test('reload replays a persisted unacknowledged mutation, not a new creation', async ({ page }) => {
  const api = await mockResearchApi(page); api.loseNextAck = true; await open(page);
  await page.getByRole('radio', { name: 'A side project', exact: true }).check();
  await expect(status(page)).toHaveText('Saved on this device, retrying');
  const original = api.requests.find(r => r.body)!.body;
  await page.reload(); await expect(page.locator('.story-track')).toHaveAttribute('data-scroll-ready', 'true'); await page.getByRole('button', { name: 'Help shape Melzi', exact: true }).click();
  await expect(status(page)).toHaveText('Saved');
  expect(api.requests.filter(r => r.body)[1].body).toEqual(original); expect(api.records.size).toBe(1);
});

test('final success waits for acknowledgement and Back returns to an unfinished draft', async ({ page }) => {
  const api = await mockResearchApi(page); await open(page); await finalStep(page); await expect(status(page)).toHaveText('Saved');
  api.holdFinal = true; await page.getByRole('button', { name: 'Submit feedback', exact: true }).click();
  await expect(page.getByText('Submission pending.', { exact: false })).toBeVisible(); await expect(thanks(page)).toHaveCount(0);
  await expect.poll(() => !!api.releaseFinal).toBe(true); api.releaseFinal!(); await expect(thanks(page)).toBeVisible();
  await page.getByRole('button', { name: 'Back to edit', exact: true }).click(); await expect(thanks(page)).toHaveCount(0);
  await expect(status(page)).toHaveText('Saved'); expect([...api.records.values()][0].completed).toBe(false);
});

for (const code of [404, 410]) test(`${code} preserves local answers and requires an explicit new session`, async ({ page }) => {
  const api = await mockResearchApi(page); await open(page); await choose(page, 'A side project'); await expect(status(page)).toHaveText('Saved');
  const token = (await local(page)).token; api.status = code;
  await page.getByRole('radio', { name: 'Exploring an idea', exact: true }).check();
  await expect(status(page)).toHaveText('Saved session unavailable');
  expect((await local(page)).answers.context).toBe('side-project'); expect((await local(page)).token).toBe(token);
  api.status = 0; await page.getByRole('button', { name: 'Start a fresh session with these answers' }).click(); await expect(status(page)).toHaveText('Saved');
  expect((await local(page)).token).not.toBe(token); expect((await local(page)).answers.stage).toBe('idea');
});

test('revision conflicts pause writes and explicit reload adopts server answers', async ({ page }) => {
  const api = await mockResearchApi(page); await open(page); await choose(page, 'A side project'); await expect(status(page)).toHaveText('Saved');
  const record = [...api.records.values()][0]; record.revision++; record.answers.context = 'startup';
  await page.getByRole('radio', { name: 'Exploring an idea', exact: true }).check();
  await expect(status(page)).toHaveText('Save paused: draft conflict'); expect((await local(page)).answers.context).toBe('side-project');
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Reload saved draft' }).click();
  await expect(status(page)).toHaveText('Saved'); expect((await local(page)).answers.context).toBe('startup');
});

test('storage events pause writes rather than silently overwriting another tab', async ({ page }) => {
  await mockResearchApi(page); await open(page); await choose(page, 'A side project'); await expect(status(page)).toHaveText('Saved');
  await page.evaluate(key => { const value = JSON.parse(localStorage.getItem(key)!); value.answers.context = 'startup'; const raw = JSON.stringify(value); localStorage.setItem(key, raw); window.dispatchEvent(new StorageEvent('storage', { key, newValue: raw })); }, STORAGE_KEY);
  await expect(status(page)).toHaveText('Save paused: draft conflict');
  await page.getByRole('radio', { name: 'Exploring an idea', exact: true }).check();
  expect((await local(page)).answers.context).toBe('startup');
});

for (const mode of ['corrupt', 'denied', 'full']) test(`${mode} local storage never claims reload safety or creates an unpersisted credential`, async ({ page }) => {
  const api = await mockResearchApi(page);
  await page.addInitScript(({ key, mode }) => {
    if (mode === 'corrupt') localStorage.setItem(key, '{broken');
    if (mode === 'denied') Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Denied', 'SecurityError'); } });
    if (mode === 'full') Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); };
  }, { key: STORAGE_KEY, mode });
  await open(page); await page.getByRole('radio', { name: 'A side project', exact: true }).check();
  await expect(status(page)).toHaveText('Not saved on this device'); await expect(page.locator('.save-warning')).toBeVisible();
  expect(api.requests).toHaveLength(0); await expect(page.getByRole('button', { name: 'Download answers' })).toBeVisible();
});

test('closing the modal does not stop saving; clear local never deletes the remote record', async ({ page }) => {
  const api = await mockResearchApi(page); await open(page); await page.getByRole('radio', { name: 'A side project', exact: true }).check();
  await page.keyboard.press('Escape'); await expect.poll(() => api.records.size).toBe(1);
  await page.getByRole('button', { name: 'Help shape Melzi', exact: true }).click();
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Clear local draft' }).click();
  expect(await local(page)).toBeNull(); expect(api.records.size).toBe(1);
  await page.getByRole('radio', { name: 'Something else', exact: true }).check(); await expect(status(page)).toHaveText('Saved'); expect(api.records.size).toBe(2);
});

test('HTTP network preview keeps local answers across reload without insecure API traffic or errors', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const api = await mockResearchApi(page);
  await page.goto(process.env.RESEARCH_INSECURE_TEST_URL || 'http://100.64.0.3:4174/');
  await expect(page.locator('.story-track')).toHaveAttribute('data-scroll-ready', 'true');
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
  await page.getByRole('button', { name: 'Help shape Melzi', exact: true }).click();
  await page.getByRole('radio', { name: 'Something else', exact: true }).check();
  await expect(page.locator('.save-warning')).toContainText('HTTPS and secure browser cryptography');
  await page.getByRole('textbox', { name: 'What are you working on? (optional)' }).fill('Kept in this HTTP browser origin');
  const before = await local(page); expect(before.answers.contextDetails).toBe('Kept in this HTTP browser origin'); expect(before.pending).toBeNull();
  await page.reload(); await expect(page.locator('.story-track')).toHaveAttribute('data-scroll-ready', 'true');
  await page.getByRole('button', { name: 'Help shape Melzi', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Something else', exact: true })).toBeChecked();
  await expect(page.getByRole('textbox', { name: 'What are you working on? (optional)' })).toHaveValue('Kept in this HTTP browser origin');
  await expect(page.locator('.save-warning')).toContainText('saved on this device only');
  await expect(status(page)).not.toHaveText('Saving');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  expect((await local(page)).token).toBe(before.token); expect(api.requests).toHaveLength(0); expect(api.challengeLoads).toBe(0); expect(errors).toEqual([]);
});

for (const code of [429, 503]) test(`${code} explains temporary server limits without claiming final success`, async ({ page }) => {
  const api = await mockResearchApi(page); await open(page); await finalStep(page); await expect(status(page)).toHaveText('Saved');
  api.status = code; api.retryAfter = '1';
  await page.getByRole('button', { name: 'Submit feedback', exact: true }).click();
  await expect(page.locator('.save-warning')).toContainText(code === 429 ? 'temporarily disabled by a service limit' : 'temporarily unavailable');
  await expect(thanks(page)).toHaveCount(0); expect((await local(page)).completed).toBe(true);
  expect(api.challengeLoads).toBe(0); api.status = 0;
  await expect(thanks(page)).toBeVisible(); await expect(page.locator('.save-warning')).toHaveCount(0);
});
