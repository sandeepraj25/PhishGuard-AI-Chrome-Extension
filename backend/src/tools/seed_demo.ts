/**
 * Seeds a DEMO organisation with synthetic warning events (8 weeks, 12 people) so the Teams
 * dashboard has something to show. Every value is generated; nothing is real.
 *   DATABASE_URL=... npx tsx src/tools/seed_demo.ts      (prints the demo credentials)
 */
import { createHash } from 'node:crypto';

import type { Store, WarningEvent } from '../db/store';
import { weekStart } from '../api/teams';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export const DEMO = {
  orgId: 'demo-org',
  name: 'Example Corp (demo data)',
  seats: 25,
  orgKey: 'org_demo_key_for_local_testing_only_0001',
  dashboardToken: 'dash_demo_token_for_local_testing_only_0001',
};

const BRANDS = [
  'sbi',
  'hdfcbank',
  'paytm',
  'microsoft',
  'indiapost',
  'examplebank',
  'icicibank',
  'phonepe',
  'incometax',
  'dhl',
];
const REASONS = [
  'brand_in_host_not_official',
  'homoglyph_brand_match',
  'page_form_action_external',
  'is_risky_tld',
  'suspicious_token_count',
  'visual_brand_lookalike',
];

export async function seedDemo(store: Store, now = new Date(), seed = 42): Promise<typeof DEMO & { events: number }> {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
  await store.insertOrg({
    id: DEMO.orgId,
    name: DEMO.name,
    seats: DEMO.seats,
    orgKeyHash: sha(DEMO.orgKey),
    dashboardTokenHash: sha(DEMO.dashboardToken),
  });
  const events: WarningEvent[] = [];
  const start = new Date(weekStart(now)).getTime() - 7 * 7 * 86_400_000;
  for (let u = 1; u <= 12; u++) {
    const device = sha(`demo-device-${u}`);
    await store.enrollDevice(DEMO.orgId, device, DEMO.seats, `employee-${String(u).padStart(2, '0')}`);
    const risk = rnd() * 3; // some people get targeted more
    for (let w = 0; w < 8; w++) {
      const n = Math.floor(rnd() * risk * (w === 5 ? 3 : 1)); // a campaign spike in week 6
      for (let i = 0; i < n; i++) {
        const score = 35 + Math.floor(rnd() * 65);
        events.push({
          orgId: DEMO.orgId,
          deviceHash: device,
          occurredAt: new Date(start + w * 7 * 86_400_000 + Math.floor(rnd() * 6 * 86_400_000)),
          band: score === 100 ? 'blocked' : score > 60 ? 'warning' : 'caution',
          score,
          brand: rnd() < 0.85 ? pick(BRANDS) : null,
          reasonIds: [pick(REASONS), pick(REASONS)].filter((v, k, a) => a.indexOf(v) === k),
          layers: rnd() < 0.3 ? ['url', 'page'] : ['url'],
          action: pick(['left', 'left', 'left', 'dismissed', 'trusted', 'reported']),
        });
      }
    }
  }
  await store.insertWarningEvents(events);
  return { ...DEMO, events: events.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { PgStore } = await import('../db/pgStore');
  const { migrate } = await import('../db/migrate');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  const store = PgStore.connect(process.env.DATABASE_URL);
  await migrate(store.pool);
  const r = await seedDemo(store);
  console.log(`seeded ${r.events} demo events. Dashboard token (demo only): ${r.dashboardToken}`);
  await store.close();
}
