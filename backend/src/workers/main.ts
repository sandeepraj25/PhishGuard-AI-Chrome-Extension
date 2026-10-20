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
import { readFileSync } from 'node:fs';

import { brandSignalFromFeatures, pollLog, type CtLog } from './ct';
import { crawlOnce, defaultHtmlFetcher, playwrightScreenshotter } from './crawler';
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

const ctLogs = (JSON.parse(readFileSync(resolve(BACKEND_ROOT, 'config/ct_logs.json'), 'utf8')) as { logs: CtLog[] })
  .logs;
const brandSignal = (domain: string) => {
  const { features, details } = fx.extract(`https://${domain}/`);
  return brandSignalFromFeatures(features, details);
};
const screenshotter = process.env.CRAWL_SCREENSHOT_DIR
  ? await playwrightScreenshotter(process.env.CRAWL_SCREENSHOT_DIR)
  : null;

async function ctCycle(): Promise<void> {
  await withLock(redis, 'ct-poll', 55_000, async () => {
    for (const ctLog of ctLogs.filter((l) => l.enabled)) {
      await pollLog(ctLog, { store, fetcher, registeredDomain: (u) => fx.registeredDomain(u), brandSignal, log });
    }
  });
}

async function crawlCycle(): Promise<void> {
  await withLock(redis, 'crawl', 55_000, async () =>
    log(`crawled ${(await crawlOnce(store, defaultHtmlFetcher, screenshotter)).length}`),
  );
}

void feedCycle();
setInterval(() => void ctCycle().catch((e) => log(`ct cycle failed: ${e}`)), 60_000);
setInterval(() => void crawlCycle().catch((e) => log(`crawl cycle failed: ${e}`)), 30_000);
setInterval(() => void feedCycle().catch((e) => log(`feed cycle failed: ${e}`)), 15 * 60_000);
setInterval(() => void rdapCycle().catch((e) => log(`rdap cycle failed: ${e}`)), 60_000);
