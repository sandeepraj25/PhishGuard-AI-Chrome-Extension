import type { BloomVersion, KnownBadRow, RdapEntry, ReportInput, ReportRow, Store } from './store';

export class MemoryStore implements Store {
  private bad = new Map<string, KnownBadRow>();
  private seen = new Map<string, Date>(); // key: domain\0source
  private reports: ReportRow[] = [];
  private rdap = new Map<string, RdapEntry>();
  private blooms: BloomVersion[] = [];

  async upsertKnownBad(domain: string, fullHash: string, source: string, at: Date) {
    const key = `${domain}\0${source}`;
    const prevSeen = this.seen.get(key);
    if (!prevSeen || at < prevSeen) this.seen.set(key, at);
    const row = this.bad.get(domain);
    if (!row) {
      this.bad.set(domain, {
        domain,
        fullHash,
        prefix: fullHash.slice(0, 8),
        firstSeen: at,
        lastSeen: at,
        sources: [source],
      });
      return 'inserted' as const;
    }
    if (at < row.firstSeen) row.firstSeen = at;
    if (at > row.lastSeen) row.lastSeen = at;
    if (!row.sources.includes(source)) row.sources.push(source);
    return 'updated' as const;
  }
  async hashesForPrefix(prefix: string) {
    return [...this.bad.values()].filter((r) => r.prefix === prefix).map((r) => r.fullHash);
  }
  async activeDomains() {
    return [...this.bad.keys()].sort();
  }
  async knownBad(domain: string) {
    return this.bad.get(domain) ?? null;
  }
  async sightings(domain: string) {
    return [...this.seen.entries()]
      .filter(([k]) => k.split('\0')[0] === domain)
      .map(([k, firstSeen]) => ({ source: k.split('\0')[1], firstSeen }));
  }
  async allSightings() {
    return [...this.seen.entries()].map(([k, firstSeen]) => {
      const [domain, source] = k.split('\0');
      return { domain, source, firstSeen };
    });
  }
  async insertReport(r: ReportInput) {
    const id = this.reports.length + 1;
    this.reports.push({ ...r, id, status: 'pending', reviewerLabel: null, createdAt: new Date() });
    return id;
  }
  async listReports(status: ReportRow['status'], limit: number) {
    return this.reports.filter((r) => r.status === status).slice(0, limit);
  }
  async reviewReport(id: number, status: 'confirmed' | 'rejected', label: number) {
    const r = this.reports.find((x) => x.id === id);
    if (!r) return false;
    r.status = status;
    r.reviewerLabel = label;
    return true;
  }
  async getRdap(domain: string) {
    return this.rdap.get(domain) ?? null;
  }
  async putRdap(e: RdapEntry) {
    this.rdap.set(e.domain, e);
  }
  async domainsMissingRdap(limit: number) {
    return [...this.bad.keys()].filter((d) => !this.rdap.has(d)).slice(0, limit);
  }
  async saveBloom(v: Omit<BloomVersion, 'createdAt'>) {
    this.blooms.push({ ...v, createdAt: new Date() });
  }
  async latestBloom() {
    return this.blooms.at(-1) ?? null;
  }
  async close() {}
}
