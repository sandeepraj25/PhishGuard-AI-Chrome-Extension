import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app';
import { adminRoutes } from '../src/api/admin';
import { errorRoutes } from '../src/api/errors';
import { feedRoutes } from '../src/api/feed';
import { summarize, teamsRoutes, weekStart } from '../src/api/teams';
import { MemoryStore } from '../src/db/memoryStore';
import { WindowLimiter } from '../src/lib/windowLimiter';
import { DEMO, seedDemo } from '../src/tools/seed_demo';

const ADMIN = { authorization: 'Bearer admin-token-for-tests-123' };
const NOW = new Date('2026-10-20T10:00:00Z');

async function setup() {
  const store = new MemoryStore();
  const app = await buildApp({
    store,
    logLevel: 'silent',
    plugins: [
      adminRoutes(store, 'admin-token-for-tests-123'),
      teamsRoutes(store, () => NOW),
      feedRoutes(store, new WindowLimiter(null)),
      errorRoutes(store),
    ],
  });
  return { store, app };
}

const event = (over: object = {}) => ({
  occurredAt: '2026-10-19T09:00:00.000Z',
  band: 'warning',
  score: 88,
  brand: 'sbi',
  reasonIds: ['brand_in_host_not_official'],
  layers: ['url'],
  action: 'left',
  ...over,
});

describe('Teams', () => {
  it('org creation returns secrets once; events need the org key; seats are enforced', async () => {
    const { app } = await setup();
    const org = (
      await app.inject({ method: 'POST', url: '/v1/admin/orgs', headers: ADMIN, payload: { name: 'Acme', seats: 2 } })
    ).json();
    expect(org.orgKey).toMatch(/^org_/);
    const send = (deviceId: string, key = org.orgKey, events = [event()]) =>
      app.inject({
        method: 'POST',
        url: '/v1/teams/events',
        headers: { 'x-org-key': key },
        payload: { deviceId, events },
      });
    expect((await send('device-aaaaaaaaaaaaaaaa', 'wrong')).statusCode).toBe(401);
    expect((await send('device-aaaaaaaaaaaaaaaa')).statusCode).toBe(202);
    expect((await send('device-bbbbbbbbbbbbbbbb')).statusCode).toBe(202);
    expect((await send('device-cccccccccccccccc')).statusCode).toBe(402); // third device, 2 seats
    expect((await send('device-aaaaaaaaaaaaaaaa')).statusCode).toBe(202); // existing device still fine
    await app.close();
  });

  it('rejects anything that looks like browsing data', async () => {
    const { app } = await setup();
    const org = (
      await app.inject({ method: 'POST', url: '/v1/admin/orgs', headers: ADMIN, payload: { name: 'Acme', seats: 5 } })
    ).json();
    for (const bad of [
      { url: 'https://evil.test/' },
      { brand: 'https://evil.test/' },
      { reasonIds: ['visited evil.test'] },
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/teams/events',
        headers: { 'x-org-key': org.orgKey },
        payload: { deviceId: 'device-aaaaaaaaaaaaaaaa', events: [event(bad)] },
      });
      if ('url' in bad) {
        // Unknown fields are dropped by the schema and never stored.
        expect(res.statusCode).toBe(202);
      } else expect(res.statusCode).toBe(400);
    }
    await app.close();
  });

  it('summary: per-person per-week counts, top brands, actions — with the dashboard token only', async () => {
    const { store, app } = await setup();
    const seeded = await seedDemo(store, NOW);
    expect((await app.inject({ method: 'GET', url: '/v1/teams/summary' })).statusCode).toBe(401);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/teams/summary?weeks=8',
      headers: { authorization: `Bearer ${DEMO.dashboardToken}` },
    });
    const s = res.json();
    expect(s.weeks).toHaveLength(8);
    expect(s.weeks[7]).toBe(weekStart(NOW));
    expect(s.org).toMatchObject({ name: DEMO.name, seats: 25, devices: 12 });
    expect(s.totals.events).toBe(seeded.events);
    const sumCells = s.perUser.reduce(
      (a: number, u: { counts: number[] }) => a + u.counts.reduce((x, y) => x + y, 0),
      0,
    );
    expect(sumCells).toBe(seeded.events);
    expect(s.topBrands.length).toBeGreaterThan(0);
    expect(JSON.stringify(s)).not.toMatch(/https?:\/\//);
    await app.close();
  });

  it('weekStart is Monday UTC', () => {
    expect(weekStart(new Date('2026-10-20T10:00:00Z'))).toBe('2026-10-19');
    expect(weekStart(new Date('2026-10-19T00:00:00Z'))).toBe('2026-10-19');
    expect(weekStart(new Date('2026-10-25T23:59:00Z'))).toBe('2026-10-19');
    expect(summarize([], new Map(), ['2026-10-19']).totals.events).toBe(0);
  });
});

describe('Threat-feed API', () => {
  it('needs an API key, returns new detections, enforces the per-key rate limit', async () => {
    const { store, app } = await setup();
    await store.upsertCtCandidate({
      domain: 'examplebank-login.test',
      firstSeen: new Date('2026-10-19T00:00:00Z'),
      certNames: [],
      brand: 'examplebank',
      signal: 'host',
      logUrl: 'l',
    });
    const key = (
      await app.inject({
        method: 'POST',
        url: '/v1/admin/api-keys',
        headers: ADMIN,
        payload: { name: 'partner', requestsPerMin: 2 },
      })
    ).json().key;
    expect((await app.inject({ method: 'GET', url: '/v1/feed/domains' })).statusCode).toBe(401);
    const get = () =>
      app.inject({ method: 'GET', url: '/v1/feed/domains?since=2026-10-18T00:00:00Z', headers: { 'x-api-key': key } });
    const first = await get();
    expect(first.json()).toMatchObject({
      count: 1,
      domains: [{ domain: 'examplebank-login.test', brand: 'examplebank', on_blocklist: false }],
    });
    expect((await get()).statusCode).toBe(200);
    expect((await get()).statusCode).toBe(429);
    await app.close();
  });
});

describe('Error counters', () => {
  it('accept only codes and counts', async () => {
    const { store, app } = await setup();
    const ok = await app.inject({
      method: 'POST',
      url: '/v1/errors',
      payload: { component: 'sw', version: '0.1.0', counts: { wasm_load_failed: 2 } },
    });
    expect(ok.statusCode).toBe(204);
    const bad = await app.inject({
      method: 'POST',
      url: '/v1/errors',
      payload: { component: 'sw', version: '0.1.0', counts: { 'TypeError at https://x.test/': 1 } },
    });
    expect(bad.statusCode).toBe(400);
    expect((await store.errorCounts('2000-01-01'))[0]).toMatchObject({
      component: 'sw',
      code: 'wasm_load_failed',
      count: 2,
    });
    await app.close();
  });
});
