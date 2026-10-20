/**
 * Pro plan: pricing tiers, Paddle checkout page + webhook, licence validation and one-time key pickup.
 * Secrets: LICENSE_SIGNING_SECRET, PADDLE_WEBHOOK_SECRET, PADDLE_CLIENT_TOKEN (all from .env).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { BACKEND_ROOT } from '../config';
import type { LicenseRow, Store } from '../db/store';
import { issueLicense, newId, verifyLicense, verifyPaddleSignature } from '../lib/license';

export interface PricingConfig {
  defaultTier: string;
  tiers: Record<string, { priceIdEnv: string; countries: string[] }>;
}

export const loadPricing = (): PricingConfig =>
  JSON.parse(readFileSync(resolve(BACKEND_ROOT, 'config/pricing.json'), 'utf8')) as PricingConfig;

export function tierFor(country: string, cfg: PricingConfig): string {
  const c = country.toUpperCase();
  return Object.entries(cfg.tiers).find(([, t]) => t.countries.includes(c))?.[0] ?? cfg.defaultTier;
}

export interface LicenseOptions {
  store: Store;
  signingSecret: string;
  paddleWebhookSecret: string;
  paddleClientToken: string;
  paddleEnvironment: 'sandbox' | 'production';
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  /** Paddle price id -> plan. Prices not listed are treated as 'pro'. */
  teamsPriceIds?: string[];
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const GRACE_MS = 3 * 86_400_000; // keep working for 3 days after a missed renewal (bank delays)
const VALID_STATUSES = new Set(['active', 'trialing', 'past_due']);

interface PaddleEvent {
  event_type: string;
  data: {
    id: string; // subscription id
    status: LicenseRow['status'];
    customer_id?: string;
    custom_data?: { claim_token?: string; org_id?: string } | null;
    items?: { price?: { id?: string }; quantity?: number }[];
    current_billing_period?: { ends_at?: string } | null;
  };
}

export function licenseRoutes(o: LicenseOptions) {
  const env = o.env ?? process.env;
  const now = o.now ?? (() => new Date());
  const pricing = loadPricing();

  return async (app: FastifyInstance): Promise<void> => {
    app.get('/v1/pricing', async (req) => {
      // Country comes from the client (navigator.language region) or a CDN header; no IP geolocation.
      const q =
        (req.query as { country?: string }).country ?? (req.headers['cf-ipcountry'] as string | undefined) ?? '';
      const tier = tierFor(q, pricing);
      return { country: q.toUpperCase(), tier, priceId: env[pricing.tiers[tier].priceIdEnv] || null };
    });

    app.post(
      '/v1/license/validate',
      { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
      async (req, reply) => {
        const body = z.object({ key: z.string().min(10).max(2000) }).safeParse(req.body);
        if (!body.success) return reply.code(400).send({ valid: false, reason: 'bad_request' });
        const v = verifyLicense(body.data.key, o.signingSecret);
        if (!v.ok) return { valid: false, reason: v.reason };
        const row = await o.store.licenseById(v.payload.lid);
        if (!row || row.keyHash !== sha(body.data.key.trim())) return { valid: false, reason: 'unknown' };
        const live = VALID_STATUSES.has(row.status) && row.expiresAt.getTime() + GRACE_MS > now().getTime();
        if (!live) return { valid: false, reason: row.status === 'canceled' ? 'canceled' : 'expired' };
        return {
          valid: true,
          plan: row.plan,
          seats: row.seats,
          expiresAt: new Date(row.expiresAt.getTime() + GRACE_MS).toISOString(),
          features: { layer2: true, layer3: true, teams: row.plan === 'teams' },
        };
      },
    );

    app.get('/v1/license/claim', async (req, reply) => {
      const token = (req.query as { token?: string }).token ?? '';
      if (token.length < 16) return reply.code(400).send({ error: 'bad token' });
      const key = await o.store.takePickup(sha(token));
      return key ? { key } : reply.code(404).send({ error: 'not ready or already claimed' });
    });

    // Paddle needs the exact raw body for the signature. A nested scope keeps this custom JSON
    // parser away from every other route.
    await app.register(async (scope) => {
      scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
        try {
          done(null, { raw: body as string, json: JSON.parse(body as string) as unknown });
        } catch (e) {
          done(e as Error, undefined);
        }
      });
      scope.post('/v1/paddle/webhook', async (req, reply) => {
        const { raw, json } = req.body as { raw: string; json: PaddleEvent };
        const ok = verifyPaddleSignature(
          req.headers['paddle-signature'] as string | undefined,
          raw,
          o.paddleWebhookSecret,
          Math.floor(now().getTime() / 1000),
        );
        if (!ok) return reply.code(401).send({ error: 'bad signature' });
        const ev = json;
        if (!ev.event_type?.startsWith('subscription.')) return { ignored: ev.event_type };
        const d = ev.data;
        const priceId = d.items?.[0]?.price?.id ?? '';
        const plan: LicenseRow['plan'] = o.teamsPriceIds?.includes(priceId) ? 'teams' : 'pro';
        const seats = Math.max(1, d.items?.[0]?.quantity ?? 1);
        const ends = d.current_billing_period?.ends_at
          ? new Date(d.current_billing_period.ends_at)
          : new Date(now().getTime() + 31 * 86_400_000);
        const existing = await o.store.licenseBySubscription(d.id);
        if (existing) {
          await o.store.updateLicense(existing.id, { status: d.status, seats, expiresAt: ends, plan });
          return { updated: existing.id };
        }
        if (!VALID_STATUSES.has(d.status)) return { ignored: 'inactive subscription' };
        const lid = newId();
        const key = issueLicense({ lid, plan, exp: Math.floor(ends.getTime() / 1000), seats }, o.signingSecret);
        await o.store.insertLicense({
          id: lid,
          keyHash: sha(key),
          plan,
          status: d.status,
          seats,
          expiresAt: ends,
          paddleSubscriptionId: d.id,
          paddleCustomerId: d.customer_id ?? null,
          orgId: d.custom_data?.org_id ?? null,
        });
        if (d.custom_data?.claim_token) await o.store.savePickup(sha(d.custom_data.claim_token), key);
        return { created: lid };
      });
    });

    app.get('/checkout', async (req, reply) => {
      const country = ((req.query as { country?: string }).country ?? '')
        .toUpperCase()
        .replace(/[^A-Z]/g, '')
        .slice(0, 2);
      const tier = tierFor(country, pricing);
      const priceId = env[pricing.tiers[tier].priceIdEnv] ?? '';
      reply.type('text/html').header('cache-control', 'no-store');
      return checkoutPage(priceId, o.paddleClientToken, o.paddleEnvironment);
    });
  };
}

/** Our website's checkout page (not the extension): loads Paddle.js, then shows the licence key once. */
function checkoutPage(priceId: string, clientToken: string, environment: string): string {
  const cfg = JSON.stringify({ priceId, clientToken, environment });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PhishGuard Pro</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 16px}
code{display:block;word-break:break-all;background:#f2f4f7;padding:12px;border-radius:8px}button{font:inherit;padding:10px 16px}</style></head>
<body><h1>PhishGuard Pro</h1><p>Page-level and visual look-alike detection. Cancel any time.</p>
<button id="buy">Continue to secure checkout</button><div id="out" role="status" aria-live="polite"></div>
<script src="https://cdn.paddle.com/paddle/v2/paddle.js"></script>
<script>
const cfg = ${cfg};
const out = document.getElementById('out');
if (!cfg.priceId || !cfg.clientToken) { out.textContent = 'Checkout is not configured yet.'; document.getElementById('buy').disabled = true; }
const claim = Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2,'0')).join('');
Paddle.Environment.set(cfg.environment);
Paddle.Initialize({ token: cfg.clientToken, eventCallback: async (e) => {
  if (e.name !== 'checkout.completed') return;
  out.textContent = 'Payment received. Fetching your licence key…';
  for (let i = 0; i < 30; i++) {
    const r = await fetch('/v1/license/claim?token=' + claim);
    if (r.ok) { const { key } = await r.json(); out.innerHTML = '<p>Your licence key (shown once — copy it now, then paste it in the PhishGuard popup):</p><code></code>'; out.querySelector('code').textContent = key; return; }
    await new Promise(res => setTimeout(res, 2000));
  }
  out.textContent = 'Your key is taking longer than usual. Please contact support with your receipt.';
}});
document.getElementById('buy').onclick = () => Paddle.Checkout.open({ items: [{ priceId: cfg.priceId, quantity: 1 }], customData: { claim_token: claim } });
</script></body></html>`;
}
