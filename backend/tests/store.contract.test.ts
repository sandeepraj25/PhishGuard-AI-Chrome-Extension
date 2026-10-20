import { afterEach, describe, expect, it } from 'vitest';

import type { Store } from '../src/db/store';
import { sha256Hex } from '../src/lib/hash';
import { storeFactories } from './helpers';

describe.each(storeFactories)('Store contract (%s)', (_name, make) => {
  let store: Store | null = null;
  afterEach(async () => {
    await store?.close();
    store = null;
  });

  it('upsert keeps earliest first_seen and merges sources', async () => {
    store = await make();
    const h = sha256Hex('bad.test');
    expect(await store.upsertKnownBad('bad.test', h, 'feedA', new Date('2026-10-02T00:00:00Z'))).toBe('inserted');
    expect(await store.upsertKnownBad('bad.test', h, 'feedB', new Date('2026-10-01T00:00:00Z'))).toBe('updated');
    const row = await store.knownBad('bad.test');
    expect(row?.firstSeen.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(row?.sources.sort()).toEqual(['feedA', 'feedB']);
    expect(await store.hashesForPrefix(h.slice(0, 8))).toEqual([h]);
    expect((await store.sightings('bad.test')).length).toBe(2);
  });

  it('reports go through the review queue', async () => {
    store = await make();
    const id = await store.insertReport({
      registeredDomain: 'x.test',
      kind: 'false_positive',
      score: 70,
      reasonIds: ['a'],
      modelVersion: 'm',
      extensionVersion: 'e',
    });
    expect((await store.listReports('pending', 10)).map((r) => r.id)).toEqual([id]);
    expect(await store.reviewReport(id, 'confirmed', 0)).toBe(true);
    expect(await store.listReports('pending', 10)).toEqual([]);
    expect((await store.listReports('confirmed', 10))[0].reviewerLabel).toBe(0);
  });

  it('bloom versions and rdap cache round-trip', async () => {
    store = await make();
    await store.saveBloom({ etag: 'e1', items: 1, bytes: new Uint8Array([1, 2, 3]) });
    expect(Array.from((await store.latestBloom())?.bytes ?? [])).toEqual([1, 2, 3]);
    const at = new Date('2026-01-01T00:00:00Z');
    await store.putRdap({ domain: 'a.test', registeredAt: at, status: 'ok', fetchedAt: at });
    expect((await store.getRdap('a.test'))?.registeredAt?.toISOString()).toBe(at.toISOString());
  });
});
