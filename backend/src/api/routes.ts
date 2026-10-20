import type { FastifyInstance } from 'fastify';

import { PREFIX_RE } from '../lib/hash';
import type { Store } from '../db/store';
import { CheckBody, ReportBody } from './schemas';

export interface RouteOptions {
  store: Store;
  checkRateLimitPerMinute: number;
  reportRateLimitPerMinute: number;
}

export async function publicRoutes(app: FastifyInstance, opts: RouteOptions): Promise<void> {
  const { store } = opts;

  /**
   * Hash-prefix lookup (Safe-Browsing style). The client sends 4-byte prefixes of
   * SHA-256(registered domain) and gets back every full hash with that prefix; it compares
   * locally. With ~4 billion possible prefixes the server cannot tell which domain was visited.
   * Nothing about the request is stored.
   */
  app.post(
    '/v1/check',
    { config: { rateLimit: { max: opts.checkRateLimitPerMinute, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const parsed = CheckBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message });
      const matches: Record<string, string[]> = {};
      for (const p of new Set(parsed.data.prefixes)) {
        if (!PREFIX_RE.test(p)) continue;
        matches[p] = await store.hashesForPrefix(p);
      }
      reply.header('cache-control', 'no-store');
      return { matches, ttlSeconds: 900 };
    },
  );

  app.post(
    '/v1/report',
    { config: { rateLimit: { max: opts.reportRateLimitPerMinute, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const parsed = ReportBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message });
      const id = await store.insertReport(parsed.data);
      return reply.code(202).send({ id, status: 'queued_for_review' });
    },
  );

  app.get('/v1/bloom', async (req, reply) => {
    const latest = await store.latestBloom();
    if (!latest) return reply.code(404).send({ error: 'no bloom filter built yet' });
    const etag = `"${latest.etag}"`;
    reply.header('etag', etag).header('cache-control', 'public, max-age=300');
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    return reply.type('application/octet-stream').send(Buffer.from(latest.bytes));
  });

  app.get('/healthz', async () => ({ ok: true }));
}
