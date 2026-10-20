/**
 * Distributed lock so that, with several worker replicas, each periodic job runs once.
 * Redis SET key value NX PX ttl; release only if we still own it (compare-and-delete in Lua).
 */
import { randomUUID } from 'node:crypto';

import type { Redis } from 'ioredis';

const RELEASE = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

export async function withLock<T>(
  redis: Redis | null,
  name: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  if (!redis) return fn(); // single process: no lock needed
  const token = randomUUID();
  const ok = await redis.set(`pg-lock:${name}`, token, 'PX', ttlMs, 'NX');
  if (ok !== 'OK') return null;
  try {
    return await fn();
  } finally {
    await redis.eval(RELEASE, 1, `pg-lock:${name}`, token);
  }
}
