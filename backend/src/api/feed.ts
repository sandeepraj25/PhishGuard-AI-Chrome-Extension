/**
 * Threat-feed API: our newly detected phishing-candidate domains (CT discovery), for partners.
 * Auth: X-API-Key (stored hashed); per-key rate limit (fixed window, Redis-backed when available).
 */
import { createHash } from 'node:crypto';

import type { FastifyInstance } from 'fastify';

import type { Store } from '../db/store';
import type { WindowLimiter } from '../lib/windowLimiter';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export function feedRoutes(store: Store, limiter: WindowLimiter) {
  return async (app: FastifyInstance): Promise<void> => {
    app.get('/v1/feed/domains', async (req, reply) => {
      const raw = req.headers['x-api-key'];
      const key = typeof raw === 'string' ? await store.apiKeyByHash(sha(raw)) : null;
      if (!key || key.revoked) return reply.code(401).send({ error: 'invalid API key' });
      if (!(await limiter.hit(key.id, key.requestsPerMin))) {
        return reply.code(429).header('retry-after', '60').send({ error: 'rate limit exceeded' });
      }
      const q = req.query as { since?: string; limit?: string };
      const since = q.since ? new Date(q.since) : new Date(Date.now() - 86_400_000);
      if (Number.isNaN(since.getTime())) return reply.code(400).send({ error: 'bad since' });
      const limit = Math.min(1000, Math.max(1, Number(q.limit ?? 500)));
      const rows = await store.newDetections(since, limit);
      return {
        generated_at: new Date().toISOString(),
        count: rows.length,
        next_since: rows.length ? rows[rows.length - 1].firstSeen.toISOString() : since.toISOString(),
        domains: rows.map((r) => ({
          domain: r.domain,
          first_seen: r.firstSeen.toISOString(),
          brand: r.brand,
          signal: r.signal,
          on_blocklist: r.listed,
        })),
      };
    });
  };
}
