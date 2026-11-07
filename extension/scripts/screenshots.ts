/**
 * Regenerates the README screenshots and demo GIF frames from the REAL built extension, using the
 * fictional ExampleBank test sites only.
 *   npm run build && npx tsx scripts/screenshots.ts     -> docs/screenshots/*.png (+ frames for the GIF)
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

import { PAGES } from '../tests/fixtures/pages';

const here = dirname(fileURLToPath(import.meta.url));
const EXT = resolve(here, '../dist');
const SITES = resolve(here, '../tests/fixtures/sites');
const OUT = resolve(here, '../../docs/screenshots');
mkdirSync(resolve(OUT, 'frames'), { recursive: true });

const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1100, height: 680 },
  deviceScaleFactor: 1,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
await context.route(/\.test(:\d+)?\//, (route) => {
  const file = PAGES[route.request().url()];
  return file
    ? route.fulfill({ contentType: 'text/html', body: readFileSync(resolve(SITES, file)) })
    : route.fulfill({ status: 404, body: '' });
});
const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
for (let i = 0; i < 50 && !(await sw.evaluate(() => typeof chrome !== 'undefined' && !!chrome.storage?.local)); i++) {
  await new Promise((r) => setTimeout(r, 100));
}
const extId = new URL(sw.url()).host;
// Pro mode (as if the licence server had confirmed it) so all three layers and reasons show.
await sw.evaluate(async () => {
  const exp = new Date(Date.now() + 30 * 86_400_000).toISOString();
  await chrome.storage.local.set({
    settings: { plan: 'pro', licenseKey: 'PG1.screenshot', licenseExpiresAt: exp, licenseCheckedAt: Date.now() },
  });
});

// 1) Warning overlay — with frames for the GIF: page, typing ID, click password, overlay.
const PHISH = 'http://examplebank.test.verify-account.test/secure/login.php';
const page = await context.newPage();
await page.goto(PHISH);
await page.waitForTimeout(500);
let f = 0;
const frame = async (n = 1) => {
  for (let i = 0; i < n; i++)
    await page.screenshot({ path: resolve(OUT, `frames/${String(f++).padStart(3, '0')}.png`) });
};
await frame(4);
await page.click('#user');
for (const ch of 'rahul.k') {
  await page.keyboard.type(ch);
  await frame();
}
await frame(2);
await page.click('#pass');
await page.getByTestId('phishguard-overlay').waitFor();
await page.waitForTimeout(300);
await frame(14);
await page.screenshot({ path: resolve(OUT, 'warning.png') });

// 2) Popup for the same tab (popup page opened in a tab; its "active tab" points at the fixture).
const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id ?? -1, PHISH);
const popup = await context.newPage();
await popup.setViewportSize({ width: 360, height: 430 });
await popup.addInitScript((id) => {
  chrome.tabs.query = (async () => [{ id }]) as unknown as typeof chrome.tabs.query;
}, tabId);
await popup.goto(`chrome-extension://${extId}/src/popup/popup.html`);
await popup.locator('#reasons li').first().waitFor();
await popup.waitForTimeout(500); // let the risk bar's fill animation finish
await popup.screenshot({ path: resolve(OUT, 'popup.png') });

// 3) Block page (rendered directly with the parameters the service worker passes).
const block = await context.newPage();
await block.goto(
  `chrome-extension://${extId}/src/block/block.html?u=${encodeURIComponent('http://account-verify-examplebank.test/login')}&d=account-verify-examplebank.test`,
);
await block.screenshot({ path: resolve(OUT, 'block.png') });

// 4) The real site: no warning.
const legit = await context.newPage();
await legit.goto('http://www.examplebank.test/login');
await legit.click('#pass');
await legit.keyboard.type('••••••');
await legit.waitForTimeout(1500);
await legit.screenshot({ path: resolve(OUT, 'legit.png') });

await context.close();
console.log(`screenshots written to ${OUT} (${f} GIF frames)`);
