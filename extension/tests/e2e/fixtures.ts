/**
 * Playwright fixture: launches Chromium with the unpacked extension from dist/ and serves the
 * local test pages through request interception, so fictional hosts like examplebank.test
 * work without DNS or a web server (and without a non-standard port that would change features).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, test as base, type BrowserContext, type Worker } from '@playwright/test';

import { PAGES } from '../fixtures/pages';

const here = dirname(fileURLToPath(import.meta.url));
const EXT = resolve(here, '../../dist');
const SITES = resolve(here, '../fixtures/sites');

export { PAGES };

if (!existsSync(resolve(EXT, 'manifest.json'))) {
  throw new Error('extension/dist is missing: run `npm run build` before the e2e tests');
}

export const test = base.extend<{ context: BrowserContext; sw: Worker }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    });
    await context.route(/\.test(:\d+)?\//, async (route) => {
      const url = route.request().url();
      const file = PAGES[url];
      if (!file) return route.fulfill({ status: 404, body: 'not a fixture' });
      return route.fulfill({ status: 200, contentType: 'text/html', body: readFileSync(resolve(SITES, file)) });
    });
    await use(context);
    await context.close();
  },
  sw: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    // Right after start-up the extension APIs may not be bound yet: wait until they are.
    for (let i = 0; i < 50; i++) {
      if (await sw.evaluate(() => typeof chrome !== 'undefined' && !!chrome.storage?.local)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await use(sw);
  },
});

export const expect = test.expect;

/** Read this tab's stored verdict from chrome.storage.session inside the service worker. */
export async function storedVerdicts(sw: Worker): Promise<Record<string, { score: number; url: string }>> {
  return sw.evaluate(
    async () => (await chrome.storage.session.get(null)) as Record<string, { score: number; url: string }>,
  );
}

/** Mark this browser as Pro (as if the licence server had confirmed it a moment ago). */
export async function enablePro(sw: Worker): Promise<void> {
  await sw.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    const exp = new Date(Date.now() + 30 * 86_400_000).toISOString();
    await chrome.storage.local.set({
      settings: {
        ...(settings ?? {}),
        plan: 'pro',
        licenseKey: 'PG1.test',
        licenseExpiresAt: exp,
        licenseCheckedAt: Date.now(),
      },
    });
  });
}
