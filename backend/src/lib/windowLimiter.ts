/**
 * Fixed-window rate limiter keyed by an arbitrary id (API key id). Redis INCR + PEXPIRE when
 * available (shared across replicas), in-memory otherwise.
 */
import type { Redis } from 'ioredis';

export class WindowLimiter {
  private mem = new Map<string, { n: number; reset: number }>();

  constructor(
    private readonly redis: Redis | null,
    private readonly windowMs = 60_000,
  ) {}

  /** Returns true if the request is allowed. */
  async hit(id: string, limit: number, now = Date.now()): Promise<boolean> {
    const window = Math.floor(now / this.windowMs);
    if (this.redis) {
      const key = `pg-kl:${id}:${window}`;
      const n = await this.redis.incr(key);
      if (n === 1) await this.redis.pexpire(key, this.windowMs);
      return n <= limit;
    }
    const e = this.mem.get(id);
    if (!e || e.reset !== window) {
      this.mem.set(id, { n: 1, reset: window });
      return limit >= 1;
    }
    e.n++;
    return e.n <= limit;
  }
}
