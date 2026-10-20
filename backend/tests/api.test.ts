import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/app';
import { MemoryStore } from '../src/db/memoryStore';
import { sha256Hex } from '../src/lib/hash';
import { rebuildBloom } from '../src/workers/bloomBuilder';

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

async function setup(limits = { check: 120, report: 10 }) {
  const store = new MemoryStore();
  app = await buildApp({
    store,
    logLevel: 'silent',
    checkRateLimitPerMinute: limits.check,
    reportRateLimitPerMinute: limits.report,
  });
  return { store, app };
}

const report = {
  registeredDomain: 'examplebank.test',
  kind: 'false_positive',
  score: 72,
  reasonIds: ['brand_in_host_not_official'],
  modelVersion: 'url-test',
  extensionVersion: '0.1.0',
};

describe('POST /v1/check', () => {
  it('returns every full hash for the prefix (client compares locally)', async () => {
    const { store, app } = await setup();
    const h = sha256Hex('evil-bank.test');
    await store.upsertKnownBad('evil-bank.test', h, 'test', new Date());
    const res = await app.inject({
      method: 'POST',
      url: '/v1/check',
      payload: { prefixes: [h.slice(0, 8), 'deadbeef'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().matches).toEqual({ [h.slice(0, 8)]: [h], deadbeef: [] });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('rejects anything that is not a 4-byte hex prefix (no domains, no full hashes)', async () => {
    const { app } = await setup();
    for (const prefixes of [['evil.com'], [sha256Hex('evil.com')], ['ABCDEF12'], [], Array(21).fill('00000000')]) {
      const res = await app.inject({ method: 'POST', url: '/v1/check', payload: { prefixes } });
      expect(res.statusCode).toBe(400);
    }
  });

  it('is rate limited per client', async () => {
    const { app } = await setup({ check: 3, report: 10 });
    const codes = [];
    for (let i = 0; i < 5; i++) {
      codes.push(
        (await app.inject({ method: 'POST', url: '/v1/check', payload: { prefixes: ['00000000'] } })).statusCode,
      );
    }
    expect(codes).toEqual([200, 200, 200, 429, 429]);
  });
});

describe('POST /v1/report', () => {
  it('queues a report for review', async () => {
    const { store, app } = await setup();
    const res = await app.inject({ method: 'POST', url: '/v1/report', payload: report });
    expect(res.statusCode).toBe(202);
    const pending = await store.listReports('pending', 10);
    expect(pending).toHaveLength(1);
    expect(pending[0].registeredDomain).toBe('examplebank.test');
  });

  it('refuses full URLs (privacy: registered domain only)', async () => {
    const { app } = await setup();
    for (const registeredDomain of ['https://examplebank.test/login', 'examplebank.test/login?x=1', 'a b.test']) {
      const res = await app.inject({ method: 'POST', url: '/v1/report', payload: { ...report, registeredDomain } });
      expect(res.statusCode).toBe(400);
    }
  });

  it('has a stricter rate limit', async () => {
    const { app } = await setup({ check: 100, report: 2 });
    const codes = [];
    for (let i = 0; i < 3; i++)
      codes.push((await app.inject({ method: 'POST', url: '/v1/report', payload: report })).statusCode);
    expect(codes).toEqual([202, 202, 429]);
  });
});

describe('GET /v1/bloom', () => {
  it('404 before the first build, then serves the file with an ETag and honours If-None-Match', async () => {
    const { store, app } = await setup();
    expect((await app.inject({ method: 'GET', url: '/v1/bloom' })).statusCode).toBe(404);
    await store.upsertKnownBad('evil-bank.test', sha256Hex('evil-bank.test'), 'test', new Date());
    await rebuildBloom(store);
    const res = await app.inject({ method: 'GET', url: '/v1/bloom' });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.subarray(0, 4).toString()).toBe('PGBF');
    const again = await app.inject({
      method: 'GET',
      url: '/v1/bloom',
      headers: { 'if-none-match': res.headers.etag as string },
    });
    expect(again.statusCode).toBe(304);
  });
});

describe('CORS for the extension', () => {
  it('answers preflight requests', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'OPTIONS', url: '/v1/check' });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});
