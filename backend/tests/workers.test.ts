import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { BACKEND_ROOT, REPO_ROOT, type FeedConfig } from '../src/config';
import { MemoryStore } from '../src/db/memoryStore';
import { domainExtractor, loadNeverBlock } from '../src/lib/domains';
import { rebuildBloom } from '../src/workers/bloomBuilder';
import { ingestFeed, parseFeed } from '../src/workers/feeds';
import { RdapClient, rdapEnrich } from '../src/workers/rdap';
import { fakeFetcher } from './helpers';

const fxP = domainExtractor(resolve(REPO_ROOT, 'extension/public/wasm/phishguard.wasm'), resolve(REPO_ROOT, 'shared'));
const neverBlock = loadNeverBlock(resolve(BACKEND_ROOT, 'config/never_block.txt'));
const feed = (over: Partial<FeedConfig> = {}): FeedConfig => ({
  name: 'test-feed',
  format: 'text',
  url: 'https://feed.test/list.txt',
  enabled: true,
  commercialUseAllowed: true,
  ...over,
});

describe('parseFeed', () => {
  const now = new Date('2026-10-01T00:00:00Z');
  it('text, phishtank-json and csv formats', () => {
    expect(parseFeed('text', '# c\nhttp://a.test/x\n\nhttp://b.test/\n', now).map((e) => e.url)).toEqual([
      'http://a.test/x',
      'http://b.test/',
    ]);
    const pt = parseFeed(
      'phishtank-json',
      JSON.stringify([{ url: 'http://c.test/', submission_time: '2026-09-30T10:00:00+00:00' }]),
      now,
    );
    expect(pt[0].seenAt.toISOString()).toBe('2026-09-30T10:00:00.000Z');
    expect(parseFeed('csv-url-column', 'id,url\n1,http://d.test/\n', now)[0].url).toBe('http://d.test/');
  });
});

describe('ingestFeed', () => {
  it('reduces URLs to registered domains, skips never-block, keeps earliest first_seen', async () => {
    const fx = await fxP;
    const store = new MemoryStore();
    const { fetcher } = fakeFetcher({
      'https://feed.test/list.txt': {
        body: 'http://login.examplebank-verify.test/a\nhttp://x.examplebank-verify.test/b\nhttps://docs.google.com/forms/abc\nhttp://evil.web.app/p\n',
      },
    });
    const stats = await ingestFeed(feed(), {
      store,
      registeredDomain: (u) => fx.registeredDomain(u),
      neverBlock,
      fetcher,
      commercialMode: false,
      now: () => new Date('2026-10-01T00:00:00Z'),
    });
    expect(stats).toMatchObject({ urls: 4, domains: 2, inserted: 2, skippedNeverBlock: 1 });
    expect(await store.activeDomains()).toEqual(['evil.web.app', 'examplebank-verify.test']);
    const bloom = await rebuildBloom(store);
    expect(bloom.items).toBe(2);
  });

  it('licence gate: commercial mode skips non-commercial feeds; missing keys skip the feed', async () => {
    const store = new MemoryStore();
    const deps = { store, registeredDomain: (u: string) => u, neverBlock, fetcher: fakeFetcher({}).fetcher };
    expect(await ingestFeed(feed({ commercialUseAllowed: false }), { ...deps, commercialMode: true })).toBeNull();
    expect(
      await ingestFeed(feed({ url: 'https://x.test/${NOT_SET_KEY_123}' }), { ...deps, commercialMode: false }),
    ).toBeNull();
  });

  it('records a failed download without throwing', async () => {
    const stats = await ingestFeed(feed(), {
      store: new MemoryStore(),
      registeredDomain: (u) => u,
      neverBlock,
      fetcher: fakeFetcher({ 'https://feed.test/list.txt': { status: 503, body: '' } }).fetcher,
      commercialMode: false,
    });
    expect(stats?.error).toContain('503');
  });
});

describe('RDAP with caching', () => {
  const bootstrap = JSON.stringify({ services: [[['test'], ['https://rdap.registry.test/']]] });
  it('looks up registration date once, then serves from cache', async () => {
    const store = new MemoryStore();
    const { fetcher, calls } = fakeFetcher({
      'https://data.iana.org/rdap/dns.json': { body: bootstrap },
      'https://rdap.registry.test/domain/new-domain.test': {
        body: JSON.stringify({ events: [{ eventAction: 'registration', eventDate: '2026-09-28T00:00:00Z' }] }),
      },
    });
    const client = new RdapClient(store, fetcher, () => new Date('2026-10-01T00:00:00Z'));
    expect(await client.ageDays('new-domain.test')).toBeCloseTo(3, 5);
    expect(await client.ageDays('new-domain.test')).toBeCloseTo(3, 5);
    expect(calls.filter((c) => c.includes('/domain/'))).toHaveLength(1);
  });

  it('unsupported TLD and 404 are cached as failures', async () => {
    const store = new MemoryStore();
    const { fetcher } = fakeFetcher({ 'https://data.iana.org/rdap/dns.json': { body: bootstrap } });
    const client = new RdapClient(store, fetcher);
    expect(await client.ageDays('a.unknowntld')).toBeNull();
    expect((await store.getRdap('a.unknowntld'))?.status).toBe('unsupported_tld');
    expect(await client.ageDays('missing.test')).toBeNull();
    expect((await store.getRdap('missing.test'))?.status).toBe('not_found');
  });

  it('enrich step processes domains without an RDAP entry', async () => {
    const store = new MemoryStore();
    await store.upsertKnownBad('a.test', 'x'.repeat(64), 's', new Date());
    const { fetcher } = fakeFetcher({ 'https://data.iana.org/rdap/dns.json': { body: bootstrap } });
    expect(await rdapEnrich(store, new RdapClient(store, fetcher))).toBe(1);
    expect(await rdapEnrich(store, new RdapClient(store, fetcher))).toBe(0);
  });
});
