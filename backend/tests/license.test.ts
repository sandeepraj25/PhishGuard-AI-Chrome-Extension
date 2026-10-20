import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app';
import { licenseRoutes, loadPricing, tierFor } from '../src/api/license';
import { MemoryStore } from '../src/db/memoryStore';
import { issueLicense, verifyLicense, verifyPaddleSignature } from '../src/lib/license';

const SECRET = 'test-signing-secret-that-is-long-enough-1234';
const HOOK = 'pdl_ntfset_test_webhook_secret';
const NOW = new Date('2026-10-20T00:00:00Z');

function signed(body: object, ts = Math.floor(NOW.getTime() / 1000)) {
  const raw = JSON.stringify(body);
  const h1 = createHmac('sha256', HOOK).update(`${ts}:${raw}`).digest('hex');
  return { raw, header: `ts=${ts};h1=${h1}` };
}

async function setup() {
  const store = new MemoryStore();
  const app = await buildApp({
    store,
    logLevel: 'silent',
    plugins: [
      licenseRoutes({
        store,
        signingSecret: SECRET,
        paddleWebhookSecret: HOOK,
        paddleClientToken: 'test_client_token',
        paddleEnvironment: 'sandbox',
        env: { PADDLE_PRICE_TIER3_MONTHLY: 'pri_tier3', PADDLE_PRICE_TIER1_MONTHLY: 'pri_tier1' },
        now: () => NOW,
      }),
    ],
  });
  return { store, app };
}

const subscription = (status: string, endsAt = '2026-11-20T00:00:00Z', extra: object = {}) => ({
  event_type: status === 'canceled' ? 'subscription.canceled' : 'subscription.activated',
  data: {
    id: 'sub_123',
    status,
    customer_id: 'ctm_1',
    custom_data: { claim_token: 'claim-token-abcdefghijklmnop' },
    items: [{ price: { id: 'pri_tier3' }, quantity: 1 }],
    current_billing_period: { ends_at: endsAt },
    ...extra,
  },
});

describe('licence keys', () => {
  it('sign/verify round trip; tampering is detected', () => {
    const key = issueLicense({ lid: 'abc', plan: 'pro', exp: 2_000_000_000 }, SECRET);
    expect(verifyLicense(key, SECRET)).toMatchObject({ ok: true, payload: { lid: 'abc', plan: 'pro' } });
    const [p, body, sig] = key.split('.');
    const forged = `${p}.${Buffer.from(JSON.stringify({ lid: 'abc', plan: 'teams', exp: 2e9 })).toString('base64url')}.${sig}`;
    expect(verifyLicense(forged, SECRET)).toEqual({ ok: false, reason: 'signature' });
    expect(verifyLicense(key, 'another-secret-another-secret-123456')).toEqual({ ok: false, reason: 'signature' });
    expect(verifyLicense('garbage', SECRET)).toEqual({ ok: false, reason: 'format' });
    void body;
    expect(() => issueLicense({ lid: 'x', plan: 'pro', exp: 1 }, 'short')).toThrow();
  });

  it('Paddle signature: valid, wrong secret, replayed (too old)', () => {
    const { raw, header } = signed({ a: 1 });
    const now = Math.floor(NOW.getTime() / 1000);
    expect(verifyPaddleSignature(header, raw, HOOK, now)).toBe(true);
    expect(verifyPaddleSignature(header, raw + ' ', HOOK, now)).toBe(false);
    expect(verifyPaddleSignature(header, raw, 'other', now)).toBe(false);
    expect(verifyPaddleSignature(header, raw, HOOK, now + 3600)).toBe(false);
    expect(verifyPaddleSignature(undefined, raw, HOOK, now)).toBe(false);
  });
});

describe('pricing tiers', () => {
  it('maps countries to tiers with a default', () => {
    const cfg = loadPricing();
    expect(tierFor('IN', cfg)).toBe('tier3');
    expect(tierFor('us', cfg)).toBe('tier1');
    expect(tierFor('ZZ', cfg)).toBe(cfg.defaultTier);
  });
  it('GET /v1/pricing returns the env price id for the tier', async () => {
    const { app } = await setup();
    expect((await app.inject({ method: 'GET', url: '/v1/pricing?country=IN' })).json()).toEqual({
      country: 'IN',
      tier: 'tier3',
      priceId: 'pri_tier3',
    });
    expect((await app.inject({ method: 'GET', url: '/v1/pricing?country=FR' })).json().priceId).toBe('pri_tier1');
    await app.close();
  });
});

describe('Paddle webhook -> licence -> claim -> validate', () => {
  it('full lifecycle including cancellation', async () => {
    const { app } = await setup();
    const bad = await app.inject({
      method: 'POST',
      url: '/v1/paddle/webhook',
      headers: { 'content-type': 'application/json', 'paddle-signature': 'ts=1;h1=00' },
      payload: JSON.stringify(subscription('active')),
    });
    expect(bad.statusCode).toBe(401);

    const ev = signed(subscription('active'));
    const created = await app.inject({
      method: 'POST',
      url: '/v1/paddle/webhook',
      headers: { 'content-type': 'application/json', 'paddle-signature': ev.header },
      payload: ev.raw,
    });
    expect(created.json().created).toBeTruthy();

    const claim = await app.inject({ method: 'GET', url: '/v1/license/claim?token=claim-token-abcdefghijklmnop' });
    const key = claim.json().key as string;
    expect(key.startsWith('PG1.')).toBe(true);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/license/claim?token=claim-token-abcdefghijklmnop' })).statusCode,
    ).toBe(404); // once

    const valid = await app.inject({ method: 'POST', url: '/v1/license/validate', payload: { key } });
    expect(valid.json()).toMatchObject({ valid: true, plan: 'pro', features: { layer2: true, layer3: true } });

    const cancel = signed(subscription('canceled'));
    await app.inject({
      method: 'POST',
      url: '/v1/paddle/webhook',
      headers: { 'content-type': 'application/json', 'paddle-signature': cancel.header },
      payload: cancel.raw,
    });
    expect((await app.inject({ method: 'POST', url: '/v1/license/validate', payload: { key } })).json()).toEqual({
      valid: false,
      reason: 'canceled',
    });

    // A well-formed key that was never issued by us
    const foreign = issueLicense({ lid: 'nope', plan: 'pro', exp: 2e9 }, SECRET);
    expect(
      (await app.inject({ method: 'POST', url: '/v1/license/validate', payload: { key: foreign } })).json(),
    ).toEqual({ valid: false, reason: 'unknown' });
    await app.close();
  });

  it('expired subscriptions stop validating after the grace period', async () => {
    const { app } = await setup();
    const ev = signed(subscription('active', '2026-10-01T00:00:00Z'));
    await app.inject({
      method: 'POST',
      url: '/v1/paddle/webhook',
      headers: { 'content-type': 'application/json', 'paddle-signature': ev.header },
      payload: ev.raw,
    });
    const key = (
      await app.inject({ method: 'GET', url: '/v1/license/claim?token=claim-token-abcdefghijklmnop' })
    ).json().key;
    expect((await app.inject({ method: 'POST', url: '/v1/license/validate', payload: { key } })).json()).toEqual({
      valid: false,
      reason: 'expired',
    });
    await app.close();
  });

  it('other JSON routes still parse normally next to the raw-body webhook parser', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/license/validate',
      payload: { key: 'PG1.x.y-not-valid' },
    });
    expect(res.json()).toEqual({ valid: false, reason: 'signature' });
    expect(
      (await app.inject({ method: 'POST', url: '/v1/check', payload: { prefixes: ['00000000'] } })).statusCode,
    ).toBe(200);
    await app.close();
  });
});
