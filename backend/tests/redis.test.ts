import { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app';
import { MemoryStore } from '../src/db/memoryStore';
import { withLock } from '../src/workers/lock';
import { TEST_REDIS_URL } from './helpers';

describe.skipIf(!TEST_REDIS_URL)('Redis integration', () => {
  it('rate limit state is shared through Redis across app instances', async () => {
    const redis = new Redis(TEST_REDIS_URL);
    await redis.flushdb();
    const a = await buildApp({ store: new MemoryStore(), redis, logLevel: 'silent', checkRateLimitPerMinute: 2 });
    const b = await buildApp({ store: new MemoryStore(), redis, logLevel: 'silent', checkRateLimitPerMinute: 2 });
    const hit = (app: typeof a) =>
      app.inject({ method: 'POST', url: '/v1/check', payload: { prefixes: ['00000000'] } });
    expect((await hit(a)).statusCode).toBe(200);
    expect((await hit(b)).statusCode).toBe(200);
    expect((await hit(a)).statusCode).toBe(429);
    await a.close();
    await b.close();
    redis.disconnect();
  });

  it('withLock runs a job only once at a time', async () => {
    const redis = new Redis(TEST_REDIS_URL);
    let runs = 0;
    const slow = () => new Promise<void>((r) => setTimeout(() => ((runs += 1), r()), 100));
    await Promise.all([withLock(redis, 't', 5000, slow), withLock(redis, 't', 5000, slow)]);
    expect(runs).toBe(1);
    redis.disconnect();
  });
});
