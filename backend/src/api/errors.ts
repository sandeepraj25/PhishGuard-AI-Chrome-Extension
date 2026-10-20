/** PII-free error counters from the extension: codes only (no messages, stacks, URLs or ids). */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { Store } from '../db/store';

const Body = z.object({
  component: z.enum(['sw', 'content', 'offscreen', 'popup']),
  version: z.string().regex(/^[0-9.]{1,20}$/),
  counts: z.record(z.string().regex(/^[a-z0-9_]{1,40}$/), z.number().int().min(1).max(10_000)),
});

export function errorRoutes(store: Store) {
  return async (app: FastifyInstance): Promise<void> => {
    app.post('/v1/errors', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
      const b = Body.safeParse(req.body);
      if (!b.success || Object.keys(b.data.counts).length > 50)
        return reply.code(400).send({ error: 'bad error report' });
      const day = new Date().toISOString().slice(0, 10);
      await store.addErrorCounts(
        Object.entries(b.data.counts).map(([code, count]) => ({
          day,
          component: b.data.component,
          code,
          version: b.data.version,
          count,
        })),
      );
      return reply.code(204).send();
    });
  };
}
