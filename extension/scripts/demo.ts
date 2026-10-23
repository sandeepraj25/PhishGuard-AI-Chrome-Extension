/**
 * Manual test lab: opens a VISIBLE Chromium window with the built extension loaded, the fictional
 * test sites (*.test) and a local in-memory backend, so you can try every feature by hand.
 *
 *   npm run build && npm run demo            (close the browser window to stop)
 *   npm run demo -- --check                  (no window: visits every scenario and prints a report)
 *
 * Nothing here touches the internet: *.test pages are served from tests/fixtures/sites, and the
 * backend runs in this process with demo data only.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

import { adminRoutes } from '../../backend/src/api/admin';
import { licenseRoutes } from '../../backend/src/api/license';
import { teamsRoutes } from '../../backend/src/api/teams';
import { buildApp } from '../../backend/src/app';
import { serveDashboard } from '../../backend/src/dashboard';
import { MemoryStore } from '../../backend/src/db/memoryStore';
import { issueLicense } from '../../backend/src/lib/license';
import { rebuildBloom } from '../../backend/src/workers/bloomBuilder';
import { DEMO, seedDemo } from '../../backend/src/tools/seed_demo';
import { PAGES } from '../tests/fixtures/pages';

const here = dirname(fileURLToPath(import.meta.url));
const EXT = resolve(here, '../dist');
const SITES = resolve(here, '../tests/fixtures/sites');
const CHECK = process.argv.includes('--check');
const SECRET = 'demo-only-license-signing-secret-0123456789';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

if (!existsSync(resolve(EXT, 'manifest.json'))) {
  console.error('extension/dist is missing — run `npm run build` first.');
  process.exit(1);
}

// ---- local backend with demo data ------------------------------------------------------------
const store = new MemoryStore();
const KNOWN_BAD = 'account-verify-examplebank.test';
await store.upsertKnownBad(KNOWN_BAD, sha(KNOWN_BAD), 'demo', new Date());
await rebuildBloom(store);
await seedDemo(store);
const lid = 'demo-licence';
const exp = new Date(Date.now() + 30 * 86_400_000);
const licenseKey = issueLicense({ lid, plan: 'pro', exp: Math.floor(exp.getTime() / 1000) }, SECRET);
await store.insertLicense({
  id: lid,
  keyHash: sha(licenseKey),
  plan: 'pro',
  status: 'active',
  seats: 1,
  expiresAt: exp,
  paddleSubscriptionId: null,
  paddleCustomerId: null,
  orgId: null,
});
const app = await buildApp({
  store,
  logLevel: 'warn',
  plugins: [
    adminRoutes(store, 'demo-admin-token'),
    teamsRoutes(store),
    serveDashboard(),
    licenseRoutes({
      store,
      signingSecret: SECRET,
      paddleWebhookSecret: '',
      paddleClientToken: '',
      paddleEnvironment: 'sandbox',
    }),
  ],
});
await app.listen({ port: 8787, host: '127.0.0.1' });
const api = 'http://127.0.0.1:8787';

// ---- start page ------------------------------------------------------------------------------
const scenarios: [string, string, string][] = [
  [
    'http://www.examplebank.test/login',
    'Real ExampleBank login',
    'Click the password box and type: no warning should appear.',
  ],
  [
    'http://examplebank.test.verify-account.test/secure/login.php',
    'Brand in a fake address',
    'Click the password box: red warning with 3 reasons. Try Esc, Tab and every button.',
  ],
  [
    'http://examp1ebank.test/login',
    'Typo / look-alike address',
    'Warning says it imitates ExampleBank. Click "I trust this site", reload: no more warning.',
  ],
  [
    'http://www.cedarlabs.test/members',
    'Form sends password elsewhere (Pro, page model)',
    'Normal-looking address, but the form posts to another site.',
  ],
  [
    'http://my-portal.test/auth/login',
    'Looks like ExampleBank (Pro, visual model)',
    'The logo is a picture; only the visual model can tell. Wait a second after clicking.',
  ],
  [`http://${KNOWN_BAD}/login`, 'Known phishing site', 'Replaced by the red block page before it loads.'],
  ['http://www.example-shop.test/checkout', 'Legit card checkout', 'Type in the card box: no warning.'],
  ['http://news.example.test/article/123', 'Page with no login', 'Nothing happens while you simply browse.'],
];
const startHtml = `<!doctype html><meta charset="utf-8"><title>PhishGuard test lab</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:760px;margin:32px auto;padding:0 16px}li{margin:14px 0}
a{font-weight:600}small{color:#555;display:block}code{background:#eef;padding:1px 4px}</style>
<h1>PhishGuard test lab</h1>
<p>All brands and sites here are fictional (<code>.test</code>). The extension is set to <b>Pro</b> and talks to a local
server, so every layer runs. Open the extension popup from the puzzle icon in the toolbar (pin it).</p>
<ol>${scenarios.map(([u, t, h]) => `<li><a href="${u}" target="_blank">${t}</a><small>${h}</small></li>`).join('')}</ol>
<h2>More to try</h2>
<ul>
<li>Popup → Plan → <i>Remove licence</i> to see the Free plan (page and visual checks stop), then paste this key to re-activate:<br><code style="word-break:break-all">${licenseKey}</code></li>
<li>Popup → <i>Report mistake</i> on any warned site, then see it in the review queue: <a href="${api}/v1/admin/reports" target="_blank">${api}/v1/admin/reports</a> (needs header <code>authorization: Bearer demo-admin-token</code>; easiest with curl).</li>
<li>Teams dashboard with demo data: <a href="${api}/dashboard/" target="_blank">${api}/dashboard/</a> — token <code>${DEMO.dashboardToken}</code> (run <code>npm --prefix ../dashboard run build</code> first if it says not built).</li>
</ul>`;

// ---- browser ---------------------------------------------------------------------------------
const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: CHECK,
  viewport: null,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--start-maximized'],
});
await context.route(/\.test(:\d+)?\//, async (route) => {
  const url = route.request().url();
  if (url.startsWith('http://start.phishguard.test/'))
    return route.fulfill({ contentType: 'text/html', body: startHtml });
  const file = PAGES[url];
  if (!file) return route.fulfill({ status: 404, contentType: 'text/plain', body: `No test page for ${url}` });
  return route.fulfill({ contentType: 'text/html', body: readFileSync(resolve(SITES, file)) });
});
const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
for (let i = 0; i < 50 && !(await sw.evaluate(() => typeof chrome !== 'undefined' && !!chrome.storage?.local)); i++) {
  await new Promise((r) => setTimeout(r, 100));
}
await sw.evaluate(
  async ({ apiBase, key, expiresAt }) => {
    await chrome.storage.local.set({
      settings: { apiBase, plan: 'pro', licenseKey: key, licenseExpiresAt: expiresAt, licenseCheckedAt: Date.now() },
    });
  },
  { apiBase: api, key: licenseKey, expiresAt: exp.toISOString() },
);
// Load the fresh known-bad list from the local server into the extension.
await sw.evaluate(async (apiBase) => {
  const r = await fetch(`${apiBase}/v1/bloom`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  await chrome.storage.local.set({ bloom: btoa(bin), bloomEtag: r.headers.get('etag') ?? '' });
}, api);

const page = context.pages()[0] ?? (await context.newPage());
await page.goto('http://start.phishguard.test/');

if (CHECK) {
  // Automatic walk-through: what a tester would see for each scenario.
  let failures = 0;
  const expectWarn: Record<string, boolean | 'block'> = {
    'Real ExampleBank login': false,
    'Brand in a fake address': true,
    'Typo / look-alike address': true,
    'Form sends password elsewhere (Pro, page model)': true,
    'Looks like ExampleBank (Pro, visual model)': true,
    'Known phishing site': 'block',
    'Legit card checkout': false,
    'Page with no login': false,
  };
  for (const [url, title] of scenarios) {
    const tab = await context.newPage();
    await tab.bringToFront();
    await tab.goto(url).catch(() => undefined);
    let outcome: string;
    if (expectWarn[title] === 'block') {
      await tab.waitForURL(/block\.html/, { timeout: 15_000 }).catch(() => undefined);
      outcome = tab.url().includes('block.html') ? 'block page' : 'NOT blocked';
    } else {
      const field = (await tab.locator('#pass').count())
        ? '#pass'
        : (await tab.locator('#card').count())
          ? '#card'
          : '#search';
      await tab.click(field);
      const shown = await tab
        .getByTestId('phishguard-overlay')
        .waitFor({ timeout: 8_000 })
        .then(
          () => true,
          () => false,
        );
      const reasons = shown ? await tab.getByTestId('phishguard-reasons').locator('li').allInnerTexts() : [];
      outcome = shown ? `WARNING: ${reasons.join(' | ')}` : 'no warning';
    }
    const want = expectWarn[title];
    const ok =
      want === 'block' ? outcome === 'block page' : want ? outcome.startsWith('WARNING') : outcome === 'no warning';
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${title}\n      ${outcome}`);
    await tab.close();
  }
  await context.close();
  await app.close();
  console.log(failures ? `\n${failures} scenario(s) failed` : '\nAll scenarios behaved as expected.');
  process.exit(failures ? 1 : 0);
}
console.log(`\nPhishGuard test lab is open. Local server: ${api}\nClose the browser window to stop.\n`);
await new Promise<void>((done) => context.on('close', () => done()));
await app.close();
process.exit(0);
