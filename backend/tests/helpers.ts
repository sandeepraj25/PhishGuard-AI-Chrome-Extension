import pg from 'pg';

import { MemoryStore } from '../src/db/memoryStore';
import { migrate } from '../src/db/migrate';
import { PgStore } from '../src/db/pgStore';
import type { Store } from '../src/db/store';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? '';
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? '';

/** Fresh Postgres schema per call (drops everything) — integration tests only. */
export async function freshPgStore(): Promise<PgStore> {
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool);
  return new PgStore(pool);
}

export const storeFactories: [string, () => Promise<Store>][] = [
  ['memory', async () => new MemoryStore()],
  ...(TEST_DATABASE_URL ? [['postgres', freshPgStore] as [string, () => Promise<Store>]] : []),
];

export function fakeFetcher(routes: Record<string, { status?: number; body: string }>) {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    const r = routes[url];
    if (!r) return { ok: false, status: 404, text: async () => '' };
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, text: async () => r.body };
  };
  return { fetcher, calls };
}
