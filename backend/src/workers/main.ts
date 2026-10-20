/**
 * Worker process: feed ingest + Bloom rebuild every 15 minutes, RDAP enrichment every minute.
 * Later phases add the CT-log poller, crawler and retraining trigger here.
 */
import { resolve } from 'node:path';

import { Redis } from 'ioredis';

import { BACKEND_ROOT, loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { PgStore } from '../db/pgStore';
import { domainExtractor, loadNeverBlock } from '../lib/domains';
import { rebuildBloom } from './bloomBuilder';
import { ingestFeed } from './feeds';
import { withLock } from './lock';
import { RdapClient, rdapEnrich } from './rdap';

const cfg = loadConfig();
if (!cfg.databaseUrl) throw new Error('workers need DATABASE_URL');
const store = PgStore.connect(cfg.databaseUrl);
await migrate(store.pool);
const redis = cfg.redisUrl ? new Redis(cfg.redisUrl) : null;
const fx = await domainExtractor(cfg.wasmPath, cfg.sharedDir);
const neverBlock = loadNeverBlock(resolve(BACKEND_ROOT, 'config/never_block.txt'));
const fetcher = (url: string) => fetch(url, { headers: { 'user-agent': 'PhishGuard-feed-worker/0.1' } });
const rdap = new RdapClient(store, fetcher);
const log = (m: string) => console.log(`[worker] ${new Date().toISOString()} ${m}`);

async function feedCycle(): Promise<void> {
  await withLock(redis, 'feed-ingest', 10 * 60_000, async () => {
    for (const feed of cfg.feeds) {
      await ingestFeed(feed, {
        store,
        registeredDomain: (u) => fx.registeredDomain(u),
        neverBlock,
        fetcher,
        commercialMode: cfg.commercialMode,
        log,
      });
    }
    log(`bloom: ${JSON.stringify(await rebuildBloom(store))}`);
  });
}

async function rdapCycle(): Promise<void> {
  await withLock(redis, 'rdap', 55_000, async () => log(`rdap enriched ${await rdapEnrich(store, rdap)}`));
}

void feedCycle();
setInterval(() => void feedCycle().catch((e) => log(`feed cycle failed: ${e}`)), 15 * 60_000);
setInterval(() => void rdapCycle().catch((e) => log(`rdap cycle failed: ${e}`)), 60_000);
