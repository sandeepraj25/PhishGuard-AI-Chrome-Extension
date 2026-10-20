/**
 * Extension + real backend (in-memory store). Verifies the known-bad flow end to end and the
 * privacy contract on the wire: /v1/check only ever receives 4-byte hash prefixes.
 */
import { createHash } from 'node:crypto';

import { buildApp } from '../../../backend/src/app';
import { MemoryStore } from '../../../backend/src/db/memoryStore';
import { rebuildBloom } from '../../../backend/src/workers/bloomBuilder';
import { expect, test } from './fixtures';

const BAD = 'account-verify-examplebank.test';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

let app: Awaited<ReturnType<typeof buildApp>>;
let store: MemoryStore;
let base = '';
const checkBodies: unknown[] = [];

test.beforeAll(async () => {
  store = new MemoryStore();
  await store.upsertKnownBad(BAD, sha(BAD), 'e2e', new Date());
  await rebuildBloom(store);
  app = await buildApp({ store, logLevel: 'silent' });
  app.addHook('preHandler', async (req: { url: string; body: unknown }) => {
    if (req.url === '/v1/check') checkBodies.push(req.body);
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});
test.afterAll(async () => app.close());

test('confirmed known-bad site is replaced by the block page; only a hash prefix is sent', async ({ context, sw }) => {
  await sw.evaluate(async (apiBase) => chrome.storage.local.set({ settings: { apiBase } }), base);
  const page = await context.newPage();
  await page.goto(`http://${BAD}/login`).catch(() => undefined); // navigation is interrupted by the redirect
  await expect(page.getByTestId('phishguard-block')).toBeVisible({ timeout: 15_000 });
  expect(page.url()).toContain('block.html');
  await expect(page.locator('#domain')).toHaveText(BAD);

  expect(checkBodies.length).toBeGreaterThan(0);
  for (const body of checkBodies) {
    expect(Object.keys(body as object)).toEqual(['prefixes']);
    for (const p of (body as { prefixes: string[] }).prefixes) expect(p).toMatch(/^[0-9a-f]{8}$/);
  }
  expect(JSON.stringify(checkBodies)).not.toContain('examplebank');
});

test('offline: an unconfirmed Bloom hit warns (score >= 80) instead of blocking', async ({ context, sw }) => {
  await sw.evaluate(async () => chrome.storage.local.set({ settings: { apiBase: 'http://127.0.0.1:9' } }));
  const page = await context.newPage();
  await page.goto(`http://${BAD}/login`);
  await page.click('#pass');
  const overlay = page.getByTestId('phishguard-overlay');
  await expect(overlay).toBeVisible({ timeout: 15_000 });
  const score = Number((await page.getByTestId('phishguard-score').innerText()).match(/(\d+)\/100/)?.[1]);
  expect(score).toBeGreaterThanOrEqual(80);
  await expect(page.locator('[data-reason="known_bad_unconfirmed"]')).toHaveCount(1);
});

test('"Report mistake" sends only the registered domain to the review queue', async ({ context, sw }) => {
  await sw.evaluate(async (apiBase) => chrome.storage.local.set({ settings: { apiBase } }), base);
  const page = await context.newPage();
  await page.goto('http://examp1ebank.test/login');
  await page.click('#pass');
  await expect(page.getByTestId('phishguard-overlay')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Report mistake' }).click();
  await expect(page.getByRole('status')).toContainText('report was sent', { timeout: 10_000 });
  const pending = await store.listReports('pending', 10);
  expect(pending.map((r) => r.registeredDomain)).toContain('examp1ebank.test');
  expect(JSON.stringify(pending)).not.toContain('/login');
});
