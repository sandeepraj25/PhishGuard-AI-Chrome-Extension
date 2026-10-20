/** Applies db/migrations/*.sql in order, once each, inside a transaction per file. */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function migrate(pool: pg.Pool): Promise<string[]> {
  await pool.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())',
  );
  const done = new Set(
    (await pool.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
  );
  const applied: string[] = [];
  for (const file of readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    if (done.has(file)) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(readFileSync(resolve(DIR, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      applied.push(file);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
  return applied;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  migrate(pool)
    .then((a) => console.log(a.length ? `applied: ${a.join(', ')}` : 'up to date'))
    .finally(() => pool.end());
}
