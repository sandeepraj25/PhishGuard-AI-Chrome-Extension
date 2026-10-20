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

  it('v2: CT index, candidates (earliest first_seen), crawl queue with retries, sightings', async () => {
    store = await make();
    expect(await store.getCtIndex('log')).toBeNull();
    await store.setCtIndex('log', 42);
    expect(await store.getCtIndex('log')).toBe(42);
    const c = { domain: 'c.test', certNames: ['c.test'], brand: 'examplebank', signal: 'host' as const, logUrl: 'log' };
    expect(await store.upsertCtCandidate({ ...c, firstSeen: new Date('2026-10-02T00:00:00Z') })).toBe('inserted');
    expect(
      await store.upsertCtCandidate({ ...c, firstSeen: new Date('2026-10-01T00:00:00Z'), certNames: ['www.c.test'] }),
    ).toBe('updated');
    const [cand] = await store.listCtCandidates(5);
    expect(cand.firstSeen.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(cand.certNames.sort()).toEqual(['c.test', 'www.c.test']);
    await store.enqueueCrawl('c.test');
    await store.enqueueCrawl('c.test'); // idempotent
    expect(await store.takeCrawlJobs(5, 3)).toEqual(['c.test']);
    await store.finishCrawl({
      domain: 'c.test',
      fetchedAt: new Date(),
      httpStatus: null,
      finalUrl: null,
      html: null,
      screenshotPath: null,
      error: 'timeout',
    });
    expect(await store.takeCrawlJobs(5, 3)).toEqual(['c.test']); // retried
    await store.finishCrawl({
      domain: 'c.test',
      fetchedAt: new Date(),
      httpStatus: 200,
      finalUrl: 'https://c.test/',
      html: '<p>x</p>',
      screenshotPath: null,
      error: null,
    });
    expect(await store.takeCrawlJobs(5, 3)).toEqual([]); // done
    expect((await store.getCrawlResult('c.test'))?.html).toBe('<p>x</p>');
    await store.recordSighting('c.test', 'ct', new Date('2026-10-03T00:00:00Z'));
    await store.recordSighting('c.test', 'ct', new Date('2026-10-01T00:00:00Z'));
    expect((await store.sightings('c.test'))[0].firstSeen.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('v3: licences and one-time key pickup', async () => {
    store = await make();
    const lic = {
      id: 'lid1',
      keyHash: 'k'.repeat(64),
      plan: 'pro' as const,
      status: 'active' as const,
      seats: 1,
      expiresAt: new Date('2026-12-01T00:00:00Z'),
      paddleSubscriptionId: 'sub_1',
      paddleCustomerId: 'ctm_1',
      orgId: null,
    };
    await store.insertLicense(lic);
    expect((await store.licenseBySubscription('sub_1'))?.id).toBe('lid1');
    await store.updateLicense('lid1', { status: 'canceled', seats: 3 });
    expect(await store.licenseById('lid1')).toMatchObject({ status: 'canceled', seats: 3, plan: 'pro' });
    await store.savePickup('h'.repeat(64), 'PG1.key');
    expect(await store.takePickup('h'.repeat(64))).toBe('PG1.key');
    expect(await store.takePickup('h'.repeat(64))).toBeNull();
  });
});
