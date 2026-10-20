import { Redis } from 'ioredis';

import { adminRoutes } from './api/admin';
import { licenseRoutes } from './api/license';
import { buildApp } from './app';
import { loadConfig } from './config';
import { MemoryStore } from './db/memoryStore';
import { migrate } from './db/migrate';
import { PgStore } from './db/pgStore';
import type { Store } from './db/store';

const cfg = loadConfig();
let store: Store;
if (cfg.databaseUrl) {
  const pgStore = PgStore.connect(cfg.databaseUrl);
  await migrate(pgStore.pool);
  store = pgStore;
} else {
  console.warn('DATABASE_URL not set: using in-memory store (demo only, data is lost on restart)');
  store = new MemoryStore();
}
const redis = cfg.redisUrl ? new Redis(cfg.redisUrl, { maxRetriesPerRequest: 2 }) : null;
const app = await buildApp({
  store,
  redis,
  checkRateLimitPerMinute: cfg.checkRateLimitPerMinute,
  reportRateLimitPerMinute: cfg.reportRateLimitPerMinute,
  logLevel: cfg.logLevel,
  plugins: [
    ...(process.env.ADMIN_TOKEN ? [adminRoutes(store, process.env.ADMIN_TOKEN)] : []),
    ...(process.env.LICENSE_SIGNING_SECRET
      ? [
          licenseRoutes({
            store,
            signingSecret: process.env.LICENSE_SIGNING_SECRET,
            paddleWebhookSecret: process.env.PADDLE_WEBHOOK_SECRET ?? '',
            paddleClientToken: process.env.PADDLE_CLIENT_TOKEN ?? '',
            paddleEnvironment: process.env.PADDLE_ENVIRONMENT === 'production' ? 'production' : 'sandbox',
            teamsPriceIds: (process.env.PADDLE_TEAMS_PRICE_IDS ?? '').split(',').filter(Boolean),
          }),
        ]
      : []),
  ],
});
await app.listen({ port: cfg.port, host: cfg.host });

const shutdown = async () => {
  await app.close();
  await store.close();
  redis?.disconnect();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
