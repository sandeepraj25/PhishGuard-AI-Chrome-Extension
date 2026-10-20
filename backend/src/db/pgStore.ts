import pg from 'pg';

import type { BloomVersion, KnownBadRow, RdapEntry, ReportInput, ReportRow, Store } from './store';

export class PgStore implements Store {
  constructor(readonly pool: pg.Pool) {}

  static connect(url: string): PgStore {
    return new PgStore(new pg.Pool({ connectionString: url, max: 10 }));
  }

  async upsertKnownBad(domain: string, fullHash: string, source: string, at: Date) {
    await this.pool.query(
      `INSERT INTO domain_sightings (domain, source, first_seen) VALUES ($1, $2, $3)
       ON CONFLICT (domain, source) DO UPDATE SET first_seen = LEAST(domain_sightings.first_seen, EXCLUDED.first_seen)`,
      [domain, source, at],
    );
    const res = await this.pool.query<{ inserted: boolean }>(
      `INSERT INTO known_bad_domains (domain, full_hash, prefix, first_seen, last_seen, sources)
       VALUES ($1, $2, $3, $4, $4, ARRAY[$5])
       ON CONFLICT (domain) DO UPDATE SET
         first_seen = LEAST(known_bad_domains.first_seen, EXCLUDED.first_seen),
         last_seen  = GREATEST(known_bad_domains.last_seen, EXCLUDED.last_seen),
         sources    = CASE WHEN $5 = ANY(known_bad_domains.sources) THEN known_bad_domains.sources
                           ELSE array_append(known_bad_domains.sources, $5) END,
         active     = TRUE
       RETURNING (xmax = 0) AS inserted`,
      [domain, fullHash, fullHash.slice(0, 8), at, source],
    );
    return res.rows[0].inserted ? ('inserted' as const) : ('updated' as const);
  }

  async hashesForPrefix(prefix: string) {
    const r = await this.pool.query<{ full_hash: string }>(
      'SELECT full_hash FROM known_bad_domains WHERE prefix = $1 AND active',
      [prefix],
    );
    return r.rows.map((x) => x.full_hash);
  }

  async activeDomains() {
    const r = await this.pool.query<{ domain: string }>(
      'SELECT domain FROM known_bad_domains WHERE active ORDER BY domain',
    );
    return r.rows.map((x) => x.domain);
  }

  async knownBad(domain: string): Promise<KnownBadRow | null> {
    const r = await this.pool.query('SELECT * FROM known_bad_domains WHERE domain = $1', [domain]);
    const x = r.rows[0];
    return x
      ? {
          domain: x.domain,
          fullHash: x.full_hash,
          prefix: x.prefix,
          firstSeen: x.first_seen,
          lastSeen: x.last_seen,
          sources: x.sources,
        }
      : null;
  }

  async sightings(domain: string) {
    const r = await this.pool.query<{ source: string; first_seen: Date }>(
      'SELECT source, first_seen FROM domain_sightings WHERE domain = $1',
      [domain],
    );
    return r.rows.map((x) => ({ source: x.source, firstSeen: x.first_seen }));
  }

  async allSightings() {
    const r = await this.pool.query<{ domain: string; source: string; first_seen: Date }>(
      'SELECT domain, source, first_seen FROM domain_sightings',
    );
    return r.rows.map((x) => ({ domain: x.domain, source: x.source, firstSeen: x.first_seen }));
  }

  async insertReport(r: ReportInput) {
    const res = await this.pool.query<{ id: string }>(
      `INSERT INTO reports (registered_domain, kind, score, reason_ids, model_version, extension_version, comment)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [r.registeredDomain, r.kind, r.score, r.reasonIds, r.modelVersion, r.extensionVersion, r.comment ?? null],
    );
    return Number(res.rows[0].id);
  }

  async listReports(status: ReportRow['status'], limit: number): Promise<ReportRow[]> {
    const r = await this.pool.query('SELECT * FROM reports WHERE status = $1 ORDER BY created_at, id LIMIT $2', [
      status,
      limit,
    ]);
    return r.rows.map((x) => ({
      id: Number(x.id),
      registeredDomain: x.registered_domain,
      kind: x.kind,
      score: x.score,
      reasonIds: x.reason_ids,
      modelVersion: x.model_version,
      extensionVersion: x.extension_version,
      comment: x.comment ?? undefined,
      status: x.status,
      reviewerLabel: x.reviewer_label,
      createdAt: x.created_at,
    }));
  }

  async reviewReport(id: number, status: 'confirmed' | 'rejected', label: number) {
    const r = await this.pool.query(
      'UPDATE reports SET status = $2, reviewer_label = $3, reviewed_at = now() WHERE id = $1',
      [id, status, label],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async getRdap(domain: string): Promise<RdapEntry | null> {
    const r = await this.pool.query('SELECT * FROM rdap_cache WHERE domain = $1', [domain]);
    const x = r.rows[0];
    return x ? { domain: x.domain, registeredAt: x.registered_at, status: x.status, fetchedAt: x.fetched_at } : null;
  }

  async putRdap(e: RdapEntry) {
    await this.pool.query(
      `INSERT INTO rdap_cache (domain, registered_at, status, fetched_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (domain) DO UPDATE SET registered_at = $2, status = $3, fetched_at = $4`,
      [e.domain, e.registeredAt, e.status, e.fetchedAt],
    );
  }

  async domainsMissingRdap(limit: number) {
    const r = await this.pool.query<{ domain: string }>(
      `SELECT k.domain FROM known_bad_domains k LEFT JOIN rdap_cache c ON c.domain = k.domain
       WHERE c.domain IS NULL ORDER BY k.first_seen DESC LIMIT $1`,
      [limit],
    );
    return r.rows.map((x) => x.domain);
  }

  async saveBloom(v: Omit<BloomVersion, 'createdAt'>) {
    await this.pool.query('INSERT INTO bloom_versions (etag, items, bytes) VALUES ($1, $2, $3)', [
      v.etag,
      v.items,
      Buffer.from(v.bytes),
    ]);
    // Keep only the latest 5 versions.
    await this.pool.query(
      'DELETE FROM bloom_versions WHERE id NOT IN (SELECT id FROM bloom_versions ORDER BY id DESC LIMIT 5)',
    );
  }

  async latestBloom(): Promise<BloomVersion | null> {
    const r = await this.pool.query('SELECT * FROM bloom_versions ORDER BY id DESC LIMIT 1');
    const x = r.rows[0];
    return x ? { etag: x.etag, items: x.items, bytes: new Uint8Array(x.bytes), createdAt: x.created_at } : null;
  }

  async close() {
    await this.pool.end();
  }
}
