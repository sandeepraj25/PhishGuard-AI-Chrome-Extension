/**
 * Fastify app factory. Logging is configured so request logs contain only method + route +
 * status: no IP addresses, no bodies (bodies contain hash prefixes or report data).
 */
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';

import { publicRoutes } from './api/routes';
import type { Store } from './db/store';

export interface AppDeps {
  store: Store;
  redis?: Redis | null;
  checkRateLimitPerMinute?: number;
  reportRateLimitPerMinute?: number;
  logLevel?: string;
  /** Extra route plugins added by later phases (license, teams, feed API). */
  plugins?: ((app: FastifyInstance) => Promise<void>)[];
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: deps.logLevel ?? 'info',
      serializers: {
        req: (req) => ({ method: req.method, url: req.routeOptions?.url ?? 'unknown' }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    },
    trustProxy: true,
    bodyLimit: 16 * 1024,
  });

  await app.register(rateLimit, {
    global: false,
    redis: deps.redis ?? undefined,
    nameSpace: 'pg-rl:',
    // The limiter needs a per-client key; it lives only in Redis/memory with a 1-minute TTL.
    keyGenerator: (req) => req.ip,
  });

  // Extension service workers call us cross-origin (chrome-extension://...). No credentials.
  app.addHook('onSend', async (req, reply) => {
    reply.header('access-control-allow-origin', '*');
    reply.header('access-control-allow-headers', 'content-type, if-none-match, authorization, x-api-key');
    reply.header('access-control-allow-methods', 'GET, POST, OPTIONS');
    reply.header('access-control-expose-headers', 'etag');
    if (req.method === 'OPTIONS') reply.code(204);
  });
  app.options('/*', async (_req, reply) => reply.code(204).send());

  await app.register(publicRoutes, {
    store: deps.store,
    checkRateLimitPerMinute: deps.checkRateLimitPerMinute ?? 120,
    reportRateLimitPerMinute: deps.reportRateLimitPerMinute ?? 10,
  });
  for (const p of deps.plugins ?? []) await app.register(p);
  return app;
}
