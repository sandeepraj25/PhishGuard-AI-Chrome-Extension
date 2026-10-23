/**
 * Teams end to end:
 *  1. Enterprise policy (Chromium reads /etc/chromium/policies/managed/*.json on Linux) gives the
 *     extension an org key + server URL via chrome.storage.managed — the real managed-install path.
 *  2. A warning on the phishing fixture becomes a Teams event (no URL, no domain) on the backend.
 *  3. The admin dashboard, served by the backend, shows the seeded demo data.
 * Skipped on Windows/macOS and when the policy directory is not writable (needs root on Linux).
 */
import { createHash } from 'node:crypto';
import { accessSync, constants, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

import { adminRoutes } from '../../../backend/src/api/admin';
import { teamsRoutes } from '../../../backend/src/api/teams';
import { buildApp } from '../../../backend/src/app';
import { serveDashboard } from '../../../backend/src/dashboard';
import { MemoryStore } from '../../../backend/src/db/memoryStore';
import { DEMO, seedDemo } from '../../../backend/src/tools/seed_demo';
import { expect, PAGES, test } from './fixtures';
import { readFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const EXT = resolve(here, '../../dist');
const POLICY_DIR = '/etc/chromium/policies/managed';
const POLICY_FILE = `${POLICY_DIR}/phishguard-e2e.json`;

/** Chrome's id for an unpacked extension: sha256(absolute path), first 32 hex digits mapped to a-p. */
const unpackedId = (path: string) =>
  [...createHash('sha256').update(path).digest('hex').slice(0, 32)]
    .map((c) => String.fromCharCode(97 + parseInt(c, 16)))
    .join('');

function policyWritable(): boolean {
  // Chromium reads this directory only on Linux (Windows/macOS use the registry / profiles).
  if (process.platform !== 'linux') return false;
  try {
    mkdirSync(POLICY_DIR, { recursive: true });
    accessSync(POLICY_DIR, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

let app: Awaited<ReturnType<typeof buildApp>>;
let store: MemoryStore;
let base = '';

test.beforeAll(async () => {
  store = new MemoryStore();
  await seedDemo(store);
  app = await buildApp({
    store,
    logLevel: 'silent',
    plugins: [adminRoutes(store, 'e2e-admin-token-000'), teamsRoutes(store), serveDashboard()],
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});
test.afterAll(async () => {
  await app.close();
  rmSync(POLICY_FILE, { force: true });
});

test('managed policy enrols the browser; a warning reaches the org as an event without any URL', async () => {
  test.skip(!policyWritable(), 'policy directory not writable');
  writeFileSync(
    POLICY_FILE,
    JSON.stringify({
      '3rdparty': {
        extensions: { [unpackedId(EXT)]: { orgKey: DEMO.orgKey, apiBase: base, userLabel: 'e2e-employee' } },
      },
    }),
  );
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  try {
    await context.route(/\.test(:\d+)?\//, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: readFileSync(resolve(here, '../fixtures/sites', PAGES[route.request().url()] ?? 'plain_article.html')),
      }),
    );
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    expect(new URL(sw.url()).host).toBe(unpackedId(EXT));
    for (let i = 0; i < 50 && !(await sw.evaluate(() => !!chrome.storage?.managed)); i++)
      await new Promise((r) => setTimeout(r, 100));
    expect(await sw.evaluate(async () => (await chrome.storage.managed.get('orgKey')).orgKey)).toBe(DEMO.orgKey);

    const before = (await store.warningEvents(DEMO.orgId, new Date(0))).length;
    const page = await context.newPage();
    await page.goto('http://examplebank.test.verify-account.test/secure/login.php');
    await page.click('#pass');
    await expect(page.getByTestId('phishguard-overlay')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Leave this site' }).click();
    await expect
      .poll(async () => (await store.warningEvents(DEMO.orgId, new Date(0))).length, { timeout: 10_000 })
      .toBeGreaterThan(before);
    const events = await store.warningEvents(DEMO.orgId, new Date(Date.now() - 60_000));
    const mine = events.filter((e) => e.action === 'left').at(-1);
    expect(mine).toMatchObject({ band: 'warning', brand: 'examplebank', layers: expect.arrayContaining(['url']) });
    expect(JSON.stringify(events)).not.toMatch(/verify-account|https?:/);
    expect([...(await store.deviceLabels(DEMO.orgId)).values()]).toContain('e2e-employee');
  } finally {
    await context.close();
  }
});

test('admin dashboard shows the seeded demo data', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(`${base}/dashboard/`);
  await page.fill('#token', 'not-a-token');
  await page.click('button[type=submit]');
  await expect(page.locator('#signin-error')).toContainText('not recognised');
  await page.fill('#token', DEMO.dashboardToken);
  await page.click('button[type=submit]');
  await expect(page.locator('#org-name')).toHaveText(DEMO.name);
  await expect(page.locator('#heatmap tbody tr')).toHaveCount(await store.deviceLabels(DEMO.orgId).then((m) => m.size));
  await expect(page.locator('#heatmap thead th')).toHaveCount(10); // name + 8 weeks + total
  await expect(page.locator('#headline')).toContainText('PhishGuard warned your team');
  await expect(page.locator('#brands li').first()).toBeVisible();
  await page.screenshot({ path: resolve(here, '../../test-results/dashboard.png'), fullPage: true });
});
