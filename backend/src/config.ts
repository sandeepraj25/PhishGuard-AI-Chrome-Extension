/** Environment configuration. Secrets come only from the environment (.env), never from code. */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BACKEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = resolve(BACKEND_ROOT, '..');

export interface FeedConfig {
  name: string;
  format: 'text' | 'phishtank-json' | 'csv-url-column';
  /** URL; "${ENV_VAR}" placeholders are filled from the environment. */
  url: string;
  enabled: boolean;
  commercialUseAllowed: boolean;
  note?: string;
}

export interface Config {
  port: number;
  host: string;
  databaseUrl: string; // '' -> in-memory store (tests / local demo only)
  redisUrl: string; // '' -> in-memory rate limiting
  wasmPath: string;
  sharedDir: string;
  checkRateLimitPerMinute: number;
  reportRateLimitPerMinute: number;
  feeds: FeedConfig[];
  commercialMode: boolean; // if true, feeds with commercialUseAllowed=false are skipped
  logLevel: string;
}

export function fillEnv(template: string, env: NodeJS.ProcessEnv = process.env): string | null {
  let missing = false;
  const out = template.replace(/\$\{([A-Z0-9_]+)\}/g, (_, k: string) => {
    const v = env[k];
    if (!v) missing = true;
    return v ?? '';
  });
  return missing ? null : out;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const feedsFile = env.FEEDS_CONFIG ?? resolve(BACKEND_ROOT, 'config/feeds.json');
  const feeds = (JSON.parse(readFileSync(feedsFile, 'utf8')) as { feeds: FeedConfig[] }).feeds;
  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? '0.0.0.0',
    databaseUrl: env.DATABASE_URL ?? '',
    redisUrl: env.REDIS_URL ?? '',
    wasmPath: env.WASM_PATH ?? resolve(REPO_ROOT, 'extension/public/wasm/phishguard.wasm'),
    sharedDir: env.SHARED_DIR ?? resolve(REPO_ROOT, 'shared'),
    checkRateLimitPerMinute: Number(env.CHECK_RATE_LIMIT ?? 120),
    reportRateLimitPerMinute: Number(env.REPORT_RATE_LIMIT ?? 10),
    feeds,
    commercialMode: env.COMMERCIAL_MODE === 'true',
    logLevel: env.LOG_LEVEL ?? 'info',
  };
}
