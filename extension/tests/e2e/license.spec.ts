/**
 * Licence gating end to end: Free does not run the page model; activating a real key through a
 * live backend (Paddle webhook -> key -> /v1/license/validate) turns it on.
 */
import { createHmac } from 'node:crypto';

import { licenseRoutes } from '../../../backend/src/api/license';
import { buildApp } from '../../../backend/src/app';
import { MemoryStore } from '../../../backend/src/db/memoryStore';
import { expect, test } from './fixtures';

const MISMATCH = 'http://www.cedarlabs.test/members';
const SECRET = 'e2e-license-signing-secret-at-least-32-chars';
const HOOK = 'e2e-paddle-webhook-secret';
let app: Awaited<ReturnType<typeof buildApp>>;
let base = '';
let key = '';

test.beforeAll(async () => {
  const store = new MemoryStore();
  app = await buildApp({
    store,
    logLevel: 'silent',
    plugins: [
      licenseRoutes({
        store,
        signingSecret: SECRET,
        paddleWebhookSecret: HOOK,
        paddleClientToken: '',
        paddleEnvironment: 'sandbox',
      }),
    ],
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  // Simulate Paddle: signed subscription.activated webhook, then claim the key.
  const ends = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const raw = JSON.stringify({
    event_type: 'subscription.activated',
    data: {
      id: 'sub_e2e',
      status: 'active',
      custom_data: { claim_token: 'e2e-claim-token-0123456789' },
      items: [{ price: { id: 'pri_x' }, quantity: 1 }],
      current_billing_period: { ends_at: ends },
    },
  });
  const ts = Math.floor(Date.now() / 1000);
  const h1 = createHmac('sha256', HOOK).update(`${ts}:${raw}`).digest('hex');
  await fetch(`${base}/v1/paddle/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'paddle-signature': `ts=${ts};h1=${h1}` },
    body: raw,
  });
  key = ((await (await fetch(`${base}/v1/license/claim?token=e2e-claim-token-0123456789`)).json()) as { key: string })
    .key;
});
test.afterAll(async () => app.close());

async function verdictFor(sw: import('@playwright/test').Worker, url: string) {
  return sw.evaluate(async (u) => {
    const all = (await chrome.storage.session.get(null)) as Record<
      string,
      { url: string; layers: string[]; score: number }
    >;
    return Object.values(all).find((x) => x.url === u);
  }, url);
}

test('Free plan: Layer 1 only — the form-mismatch page is not caught; Pro after activation: it is', async ({
  context,
  sw,
}) => {
  await sw.evaluate(async (apiBase) => chrome.storage.local.set({ settings: { apiBase } }), base);
  const page = await context.newPage();
  await page.goto(MISMATCH);
  await page.click('#pass');
  await page.waitForTimeout(2500);
  await expect(page.getByTestId('phishguard-overlay')).toHaveCount(0);
  expect((await verdictFor(sw, MISMATCH))?.layers).toEqual(['url']);

  // Activate through the popup UI.
  const extId = new URL(sw.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/src/popup/popup.html`);
  await popup.locator('#plan-box summary').click();
  await popup.fill('#license-key', key);
  await popup.click('#activate');
  await expect(popup.locator('#license-status')).toHaveText('Pro is active. Thank you!', { timeout: 10_000 });
  await expect(popup.locator('#plan-name')).toHaveText('Pro');

  await page.goto(MISMATCH);
  await page.click('#pass');
  await expect(page.getByTestId('phishguard-overlay')).toBeVisible({ timeout: 20_000 });
  expect((await verdictFor(sw, MISMATCH))?.layers).toEqual(['url', 'page']);
});

test('an invalid key is rejected and the plan stays Free', async ({ context, sw }) => {
  await sw.evaluate(async (apiBase) => chrome.storage.local.set({ settings: { apiBase } }), base);
  const extId = new URL(sw.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/src/popup/popup.html`);
  await popup.locator('#plan-box summary').click();
  await popup.fill('#license-key', 'PG1.forged.signature');
  await popup.click('#activate');
  await expect(popup.locator('#license-status')).toContainText('Not activated');
  await expect(popup.locator('#plan-name')).toHaveText('Free');
});
