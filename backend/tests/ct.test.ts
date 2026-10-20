import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app';
import { adminRoutes } from '../src/api/admin';
import { BACKEND_ROOT, REPO_ROOT } from '../src/config';
import { MemoryStore } from '../src/db/memoryStore';
import { certNames, readTlv } from '../src/lib/der';
import { domainExtractor } from '../src/lib/domains';
import { brandSignalFromFeatures, parseLeaf, pollLog } from '../src/workers/ct';
import { crawlOnce } from '../src/workers/crawler';

const fxP = domainExtractor(resolve(REPO_ROOT, 'extension/public/wasm/phishguard.wasm'), resolve(REPO_ROOT, 'shared'));
const cert = (name: string) => new Uint8Array(readFileSync(resolve(BACKEND_ROOT, `tests/fixtures/ct/${name}.der`)));

function tbsOf(der: Uint8Array): Uint8Array {
  const outer = readTlv(der, 0);
  if (!outer) throw new Error('bad cert');
  const tbs = readTlv(der, outer.start);
  if (!tbs) throw new Error('bad tbs');
  return der.subarray(outer.start, tbs.end);
}

/** Build an RFC 6962 MerkleTreeLeaf for an x509 or precert entry. */
function leaf(der: Uint8Array, kind: 'x509' | 'precert', ts: Date): string {
  const body = kind === 'precert' ? tbsOf(der) : der;
  const head = new Uint8Array(12 + (kind === 'precert' ? 32 : 0) + 3);
  const v = new DataView(head.buffer);
  v.setBigUint64(2, BigInt(ts.getTime()));
  v.setUint16(10, kind === 'precert' ? 1 : 0);
  const p = head.length - 3;
  head[p] = body.length >> 16;
  head[p + 1] = (body.length >> 8) & 0xff;
  head[p + 2] = body.length & 0xff;
  return Buffer.concat([head, body]).toString('base64');
}

describe('DER parsing', () => {
  it('reads SAN dNSNames, CN and notBefore from a certificate and from a bare TBSCertificate', () => {
    const der = cert('brand_host');
    for (const [bytes, isTbs] of [
      [der, false],
      [tbsOf(der), true],
    ] as const) {
      const n = certNames(bytes, isTbs);
      expect(n?.dnsNames).toEqual(['examplebank-login.test', 'www.examplebank-login.test']);
      expect(n?.commonName).toBe('examplebank-login.test');
      expect(n?.notBefore?.getUTCFullYear()).toBeGreaterThanOrEqual(2026);
    }
  });

  it('never throws on garbage input', () => {
    let seed = 7;
    for (let i = 0; i < 500; i++) {
      const junk = Uint8Array.from({ length: 1 + (i % 300) }, () => (seed = (seed * 1103515245 + 12345) & 0xff));
      expect(() => certNames(junk, i % 2 === 0)).not.toThrow();
    }
    expect(parseLeaf(Buffer.from([1, 2, 3]).toString('base64'))).toBeNull();
  });
});

describe('CT log polling', () => {
  const base = 'https://ct.test/log/';
  const t0 = new Date('2026-10-01T00:00:00Z');
  const entries = [
    leaf(cert('neutral'), 'x509', t0),
    leaf(cert('brand_host'), 'precert', new Date(t0.getTime() + 60_000)),
    leaf(cert('homoglyph'), 'x509', new Date(t0.getTime() + 120_000)),
    leaf(cert('punycode'), 'precert', new Date(t0.getTime() + 180_000)),
    leaf(cert('wildcard'), 'x509', new Date(t0.getTime() + 240_000)),
  ];

  function fakeLog(size: number) {
    const calls: string[] = [];
    const fetcher = async (url: string) => {
      calls.push(url);
      if (url === `${base}ct/v1/get-sth`)
        return { ok: true, status: 200, text: async () => JSON.stringify({ tree_size: size }) };
      const m = /get-entries\?start=(\d+)&end=(\d+)/.exec(url);
      if (m) {
        // Like real logs, return at most 2 entries per call even if more were asked for.
        const s = Number(m[1]);
        const e = Math.min(Number(m[2]), s + 1, size - 1);
        const body = { entries: entries.slice(s, e + 1).map((l) => ({ leaf_input: l, extra_data: '' })) };
        return { ok: true, status: 200, text: async () => JSON.stringify(body) };
      }
      return { ok: false, status: 404, text: async () => '' };
    };
    return { fetcher, calls };
  }

  it('flags only brand-signal domains, records CT first_seen, queues crawls, and resumes from the saved index', async () => {
    const fx = await fxP;
    const store = new MemoryStore();
    const deps = (size: number) => ({
      store,
      fetcher: fakeLog(size).fetcher,
      registeredDomain: (u: string) => fx.registeredDomain(u),
      brandSignal: (d: string) => {
        const { features, details } = fx.extract(`https://${d}/`);
        return brandSignalFromFeatures(features, details);
      },
      batchSize: 10,
    });
    await store.setCtIndex(base, 0);
    const first = await pollLog({ name: 'test', url: base, enabled: true }, deps(3));
    expect(first).toMatchObject({ from: 0, to: 3, entries: 3, candidates: 2 });
    const second = await pollLog({ name: 'test', url: base, enabled: true }, deps(5));
    expect(second).toMatchObject({ from: 3, to: 5, entries: 2 });

    const cands = Object.fromEntries((await store.listCtCandidates(10)).map((c) => [c.domain, c]));
    expect(Object.keys(cands).sort()).toEqual([
      'examp1ebank.test',
      'examplebank-login.test',
      'secure-examplebank.test',
      'xn--exmplebank-0qi.test',
    ]);
    expect(cands['examplebank-login.test'].signal).toBe('host');
    expect(cands['examp1ebank.test'].signal).toBe('homoglyph');
    expect(cands['xn--exmplebank-0qi.test'].signal).toBe('homoglyph');
    expect(cands['examplebank-login.test'].firstSeen.toISOString()).toBe('2026-10-01T00:01:00.000Z');
    expect(cands['cedarlabs.test']).toBeUndefined();
    expect((await store.sightings('examp1ebank.test'))[0]).toMatchObject({ source: 'ct' });
    expect((await store.takeCrawlJobs(10, 3)).sort()).toEqual(Object.keys(cands).sort());
  });
});

describe('crawler', () => {
  it('stores HTML for queued domains and retries failures', async () => {
    const store = new MemoryStore();
    await store.enqueueCrawl('ok.test');
    await store.enqueueCrawl('down.test');
    const fetchHtml = async (url: string) => {
      if (url.includes('down.test')) throw new Error('ECONNREFUSED');
      return { status: 200, url, text: async () => '<html><title>ExampleBank</title></html>' };
    };
    const res = await crawlOnce(store, fetchHtml, null);
    expect(res.map((r) => [r.domain, r.error === null])).toEqual([
      ['ok.test', true],
      ['down.test', false],
    ]);
    expect((await store.getCrawlResult('ok.test'))?.html).toContain('ExampleBank');
    expect(await store.takeCrawlJobs(10, 3)).toEqual(['down.test']); // still pending, attempt 2
  });
});

describe('admin routes', () => {
  it('require the bearer token; review queue and exports work', async () => {
    const store = new MemoryStore();
    const app = await buildApp({ store, logLevel: 'silent', plugins: [adminRoutes(store, 'test-admin-token-123')] });
    const auth = { authorization: 'Bearer test-admin-token-123' };
    expect((await app.inject({ method: 'GET', url: '/v1/admin/reports' })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/admin/reports', headers: { authorization: 'Bearer wrong' } }))
        .statusCode,
    ).toBe(401);

    const id = await store.insertReport({
      registeredDomain: 'fp.test',
      kind: 'false_positive',
      score: 70,
      reasonIds: ['x'],
      modelVersion: 'm',
      extensionVersion: 'e',
    });
    const pending = await app.inject({ method: 'GET', url: '/v1/admin/reports?status=pending', headers: auth });
    expect(pending.json()).toHaveLength(1);
    const review = await app.inject({
      method: 'POST',
      url: `/v1/admin/reports/${id}/review`,
      headers: auth,
      payload: { status: 'confirmed', label: 0 },
    });
    expect(review.statusCode).toBe(200);
    const csv = await app.inject({ method: 'GET', url: '/v1/admin/reports/export?status=confirmed', headers: auth });
    expect(csv.body.split('\n')[1]).toMatch(/^fp\.test,0,false_positive,70,x,m,/);

    await store.recordSighting('lead.test', 'ct', new Date('2026-10-01T00:00:00Z'));
    await store.upsertKnownBad('lead.test', 'a'.repeat(64), 'openphish-community', new Date('2026-10-01T06:00:00Z'));
    const lt = await app.inject({ method: 'GET', url: '/v1/admin/leadtime.csv', headers: auth });
    expect(lt.body).toContain('lead.test,2026-10-01T00:00:00.000Z,openphish-community,2026-10-01T06:00:00.000Z');
    await app.close();
  });
});
