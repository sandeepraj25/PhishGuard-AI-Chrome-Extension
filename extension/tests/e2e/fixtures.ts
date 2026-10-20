/**
 * Playwright fixture: launches Chromium with the unpacked extension from dist/ and serves the
 * local test pages through request interception, so fictional hosts like examplebank.test
 * work without DNS or a web server (and without a non-standard port that would change features).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, test as base, type BrowserContext, type Worker } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const EXT = resolve(here, '../../dist');
const SITES = resolve(here, '../fixtures/sites');

/** URL -> fixture file. All brands are fictional; all hosts use the reserved .test TLD. */
export const PAGES: Record<string, string> = {
  'http://www.examplebank.test/login': 'examplebank_login.html',
  'http://examplebank.test.verify-account.test/secure/login.php': 'examplebank_phish.html',
  'http://examp1ebank.test/login': 'examplebank_phish.html',
  'http://account-verify-examplebank.test/login': 'examplebank_phish.html',
  'http://www.example-shop.test/checkout': 'shop_checkout.html',
  'http://news.example.test/article/123': 'plain_article.html',
  'http://www.cedarlabs.test/members': 'members_form_mismatch.html',
  'http://portal.cedarlabs.test/members/': 'members_ok.html',
};

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
