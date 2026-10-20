import pg from 'pg';

import type {
  BloomVersion,
  CrawlResult,
  CtCandidate,
  ApiKeyRow,
  KnownBadRow,
  OrgRow,
  WarningEvent,
  LicenseRow,
  RdapEntry,
  ReportInput,
  ReportRow,
  Store,
} from './store';

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

  async getCtIndex(logUrl: string) {
    const r = await this.pool.query<{ next_index: string }>('SELECT next_index FROM ct_log_state WHERE log_url = $1', [
      logUrl,
    ]);
    return r.rows[0] ? Number(r.rows[0].next_index) : null;
  }

  async setCtIndex(logUrl: string, next: number) {
    await this.pool.query(
      `INSERT INTO ct_log_state (log_url, next_index) VALUES ($1, $2)
       ON CONFLICT (log_url) DO UPDATE SET next_index = $2, updated_at = now()`,
      [logUrl, next],
    );
  }

  async upsertCtCandidate(c: Omit<CtCandidate, 'verdict'>) {
    const r = await this.pool.query<{ inserted: boolean }>(
      `INSERT INTO ct_candidates (domain, first_seen, cert_names, brand, signal, log_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (domain) DO UPDATE SET
         first_seen = LEAST(ct_candidates.first_seen, EXCLUDED.first_seen),
         cert_names = (SELECT array_agg(DISTINCT n) FROM unnest(ct_candidates.cert_names || EXCLUDED.cert_names) n)
       RETURNING (xmax = 0) AS inserted`,
      [c.domain, c.firstSeen, c.certNames, c.brand, c.signal, c.logUrl],
    );
    return r.rows[0].inserted ? ('inserted' as const) : ('updated' as const);
  }

  async listCtCandidates(limit: number): Promise<CtCandidate[]> {
    const r = await this.pool.query('SELECT * FROM ct_candidates ORDER BY first_seen DESC LIMIT $1', [limit]);
    return r.rows.map((x) => ({
      domain: x.domain,
      firstSeen: x.first_seen,
      certNames: x.cert_names,
      brand: x.brand,
      signal: x.signal,
      logUrl: x.log_url,
      verdict: x.verdict,
    }));
  }

  async enqueueCrawl(domain: string) {
    await this.pool.query('INSERT INTO crawl_queue (domain) VALUES ($1) ON CONFLICT DO NOTHING', [domain]);
  }

  async takeCrawlJobs(limit: number, maxAttempts: number) {
    // SKIP LOCKED lets several crawler replicas take disjoint jobs without blocking each other.
    const r = await this.pool.query<{ domain: string }>(
      `UPDATE crawl_queue SET attempts = attempts + 1, updated_at = now()
       WHERE domain IN (SELECT domain FROM crawl_queue WHERE status = 'pending' AND attempts < $2
                        ORDER BY enqueued_at LIMIT $1 FOR UPDATE SKIP LOCKED)
       RETURNING domain`,
      [limit, maxAttempts],
    );
    return r.rows.map((x) => x.domain);
  }

  async finishCrawl(c: CrawlResult) {
    await this.pool.query(
      `INSERT INTO crawl_results (domain, fetched_at, http_status, final_url, html, screenshot_path, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (domain) DO UPDATE SET fetched_at = $2, http_status = $3, final_url = $4, html = $5,
         screenshot_path = $6, error = $7`,
      [c.domain, c.fetchedAt, c.httpStatus, c.finalUrl, c.html, c.screenshotPath, c.error],
    );
    await this.pool.query(
      `UPDATE crawl_queue SET status = CASE WHEN $2::text IS NULL THEN 'done'
                                            WHEN attempts >= 3 THEN 'failed' ELSE 'pending' END,
                              updated_at = now() WHERE domain = $1`,
      [c.domain, c.error],
    );
  }

  async getCrawlResult(domain: string): Promise<CrawlResult | null> {
    const r = await this.pool.query('SELECT * FROM crawl_results WHERE domain = $1', [domain]);
    const x = r.rows[0];
    return x
      ? {
          domain: x.domain,
          fetchedAt: x.fetched_at,
          httpStatus: x.http_status,
          finalUrl: x.final_url,
          html: x.html,
          screenshotPath: x.screenshot_path,
          error: x.error,
        }
      : null;
  }

  async recordSighting(domain: string, source: string, at: Date) {
    await this.pool.query(
      `INSERT INTO domain_sightings (domain, source, first_seen) VALUES ($1, $2, $3)
       ON CONFLICT (domain, source) DO UPDATE SET first_seen = LEAST(domain_sightings.first_seen, EXCLUDED.first_seen)`,
      [domain, source, at],
    );
  }

  private static toLicense(x: Record<string, unknown>): LicenseRow {
    return {
      id: x.id as string,
      keyHash: x.key_hash as string,
      plan: x.plan as LicenseRow['plan'],
      status: x.status as LicenseRow['status'],
      seats: x.seats as number,
      expiresAt: x.expires_at as Date,
      paddleSubscriptionId: (x.paddle_subscription_id as string | null) ?? null,
      paddleCustomerId: (x.paddle_customer_id as string | null) ?? null,
      orgId: (x.org_id as string | null) ?? null,
    };
  }

  async insertLicense(l: LicenseRow) {
    await this.pool.query(
      `INSERT INTO licenses (id, key_hash, plan, status, seats, expires_at, paddle_subscription_id, paddle_customer_id, org_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [l.id, l.keyHash, l.plan, l.status, l.seats, l.expiresAt, l.paddleSubscriptionId, l.paddleCustomerId, l.orgId],
    );
  }

  async updateLicense(id: string, patch: Partial<Omit<LicenseRow, 'id' | 'keyHash'>>) {
    const cols: Record<string, string> = {
      plan: 'plan',
      status: 'status',
      seats: 'seats',
      expiresAt: 'expires_at',
      paddleSubscriptionId: 'paddle_subscription_id',
      paddleCustomerId: 'paddle_customer_id',
      orgId: 'org_id',
    };
    const entries = Object.entries(patch).filter(([k]) => k in cols);
    if (!entries.length) return;
    const sets = entries.map(([k], i) => `${cols[k]} = $${i + 2}`).join(', ');
    await this.pool.query(`UPDATE licenses SET ${sets}, updated_at = now() WHERE id = $1`, [
      id,
      ...entries.map(([, v]) => v),
    ]);
  }

  async licenseById(id: string) {
    const r = await this.pool.query('SELECT * FROM licenses WHERE id = $1', [id]);
    return r.rows[0] ? PgStore.toLicense(r.rows[0]) : null;
  }

  async licenseBySubscription(sub: string) {
    const r = await this.pool.query('SELECT * FROM licenses WHERE paddle_subscription_id = $1', [sub]);
    return r.rows[0] ? PgStore.toLicense(r.rows[0]) : null;
  }

  async savePickup(h: string, key: string) {
    await this.pool.query(
      'INSERT INTO license_pickup (claim_token_hash, license_key) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [h, key],
    );
  }

  async takePickup(h: string) {
    const r = await this.pool.query<{ license_key: string }>(
      'DELETE FROM license_pickup WHERE claim_token_hash = $1 RETURNING license_key',
      [h],
    );
    return r.rows[0]?.license_key ?? null;
  }

  private static toOrg(x: Record<string, unknown>): OrgRow {
    return {
      id: x.id as string,
      name: x.name as string,
      seats: x.seats as number,
      orgKeyHash: x.org_key_hash as string,
      dashboardTokenHash: x.dashboard_token_hash as string,
    };
  }

  async insertOrg(o: OrgRow) {
    await this.pool.query(
      'INSERT INTO orgs (id, name, seats, org_key_hash, dashboard_token_hash) VALUES ($1, $2, $3, $4, $5)',
      [o.id, o.name, o.seats, o.orgKeyHash, o.dashboardTokenHash],
    );
  }

  async orgByKeyHash(h: string) {
    const r = await this.pool.query('SELECT * FROM orgs WHERE org_key_hash = $1', [h]);
    return r.rows[0] ? PgStore.toOrg(r.rows[0]) : null;
  }

  async orgByDashboardHash(h: string) {
    const r = await this.pool.query('SELECT * FROM orgs WHERE dashboard_token_hash = $1', [h]);
    return r.rows[0] ? PgStore.toOrg(r.rows[0]) : null;
  }

  async enrollDevice(orgId: string, deviceHash: string, seats: number, label: string | null) {
    // Serialise enrolments per org with an advisory lock so two devices cannot take the last seat.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [orgId]);
      const exists = await client.query('SELECT 1 FROM org_devices WHERE org_id = $1 AND device_hash = $2', [
        orgId,
        deviceHash,
      ]);
      if (exists.rowCount) {
        await client.query('COMMIT');
        return true;
      }
      const n = await client.query<{ n: string }>('SELECT count(*) AS n FROM org_devices WHERE org_id = $1', [orgId]);
      if (Number(n.rows[0].n) >= seats) {
        await client.query('COMMIT');
        return false;
      }
      await client.query('INSERT INTO org_devices (org_id, device_hash, label) VALUES ($1, $2, $3)', [
        orgId,
        deviceHash,
        label,
      ]);
      await client.query('COMMIT');
      return true;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async deviceLabels(orgId: string) {
    const r = await this.pool.query<{ device_hash: string; label: string | null }>(
      'SELECT device_hash, label FROM org_devices WHERE org_id = $1',
      [orgId],
    );
    return new Map(r.rows.map((x) => [x.device_hash, x.label]));
  }

  async insertWarningEvents(events: WarningEvent[]) {
    for (const e of events) {
      await this.pool.query(
        `INSERT INTO warning_events (org_id, device_hash, occurred_at, band, score, brand, reason_ids, layers, action)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [e.orgId, e.deviceHash, e.occurredAt, e.band, e.score, e.brand, e.reasonIds, e.layers, e.action],
      );
    }
  }

  async warningEvents(orgId: string, since: Date): Promise<WarningEvent[]> {
    const r = await this.pool.query(
      'SELECT * FROM warning_events WHERE org_id = $1 AND occurred_at >= $2 ORDER BY occurred_at',
      [orgId, since],
    );
    return r.rows.map((x) => ({
      orgId: x.org_id,
      deviceHash: x.device_hash,
      occurredAt: x.occurred_at,
      band: x.band,
      score: x.score,
      brand: x.brand,
      reasonIds: x.reason_ids,
      layers: x.layers,
      action: x.action,
    }));
  }

  async insertApiKey(k: ApiKeyRow) {
    await this.pool.query(
      'INSERT INTO api_keys (id, key_hash, name, requests_per_min, revoked) VALUES ($1, $2, $3, $4, $5)',
      [k.id, k.keyHash, k.name, k.requestsPerMin, k.revoked],
    );
  }

  async apiKeyByHash(h: string): Promise<ApiKeyRow | null> {
    const r = await this.pool.query('SELECT * FROM api_keys WHERE key_hash = $1', [h]);
    const x = r.rows[0];
    return x
      ? { id: x.id, keyHash: x.key_hash, name: x.name, requestsPerMin: x.requests_per_min, revoked: x.revoked }
      : null;
  }

  async newDetections(since: Date, limit: number) {
    const r = await this.pool.query(
      `SELECT c.domain, c.first_seen, c.brand, c.signal, (k.domain IS NOT NULL) AS listed
       FROM ct_candidates c LEFT JOIN known_bad_domains k ON k.domain = c.domain
       WHERE c.first_seen >= $1 AND c.verdict <> 'legit' ORDER BY c.first_seen LIMIT $2`,
      [since, limit],
    );
    return r.rows.map((x) => ({
      domain: x.domain,
      firstSeen: x.first_seen,
      brand: x.brand,
      signal: x.signal,
      listed: x.listed,
    }));
  }

  async addErrorCounts(rows: { day: string; component: string; code: string; version: string; count: number }[]) {
    for (const x of rows) {
      await this.pool.query(
        `INSERT INTO error_counts (day, component, code, version, count) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (day, component, code, version) DO UPDATE SET count = error_counts.count + EXCLUDED.count`,
        [x.day, x.component, x.code, x.version, x.count],
      );
    }
  }

  async errorCounts(sinceDay: string) {
    const r = await this.pool.query(
      "SELECT to_char(day, 'YYYY-MM-DD') AS day, component, code, version, count FROM error_counts WHERE day >= $1 ORDER BY day",
      [sinceDay],
    );
    return r.rows as { day: string; component: string; code: string; version: string; count: number }[];
  }

  async close() {
    await this.pool.end();
  }
}
