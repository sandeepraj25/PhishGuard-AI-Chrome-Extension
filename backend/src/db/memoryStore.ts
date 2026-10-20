import type {
  BloomVersion,
  CrawlResult,
  CtCandidate,
  KnownBadRow,
  LicenseRow,
  RdapEntry,
  ReportInput,
  ReportRow,
  Store,
} from './store';

export class MemoryStore implements Store {
  private bad = new Map<string, KnownBadRow>();
  private seen = new Map<string, Date>(); // key: domain\0source
  private reports: ReportRow[] = [];
  private rdap = new Map<string, RdapEntry>();
  private blooms: BloomVersion[] = [];
  private ctIndex = new Map<string, number>();
  private ct = new Map<string, CtCandidate>();
  private crawlQ = new Map<string, { status: string; attempts: number }>();
  private crawlRes = new Map<string, CrawlResult>();
  private licenses = new Map<string, LicenseRow>();
  private pickups = new Map<string, string>();

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
  async getCtIndex(logUrl: string) {
    return this.ctIndex.get(logUrl) ?? null;
  }
  async setCtIndex(logUrl: string, next: number) {
    this.ctIndex.set(logUrl, next);
  }
  async upsertCtCandidate(c: Omit<CtCandidate, 'verdict'>) {
    const prev = this.ct.get(c.domain);
    if (!prev) {
      this.ct.set(c.domain, { ...c, verdict: 'unreviewed' });
      return 'inserted' as const;
    }
    if (c.firstSeen < prev.firstSeen) prev.firstSeen = c.firstSeen;
    prev.certNames = [...new Set([...prev.certNames, ...c.certNames])].slice(0, 50);
    return 'updated' as const;
  }
  async listCtCandidates(limit: number) {
    return [...this.ct.values()].sort((a, b) => b.firstSeen.getTime() - a.firstSeen.getTime()).slice(0, limit);
  }
  async enqueueCrawl(domain: string) {
    if (!this.crawlQ.has(domain)) this.crawlQ.set(domain, { status: 'pending', attempts: 0 });
  }
  async takeCrawlJobs(limit: number, maxAttempts: number) {
    const out: string[] = [];
    for (const [d, j] of this.crawlQ) {
      if (out.length >= limit) break;
      if (j.status === 'pending' && j.attempts < maxAttempts) {
        j.attempts++;
        out.push(d);
      }
    }
    return out;
  }
  async finishCrawl(r: CrawlResult) {
    this.crawlRes.set(r.domain, r);
    const j = this.crawlQ.get(r.domain);
    if (j) j.status = r.error ? (j.attempts >= 3 ? 'failed' : 'pending') : 'done';
  }
  async getCrawlResult(domain: string) {
    return this.crawlRes.get(domain) ?? null;
  }
  async recordSighting(domain: string, source: string, at: Date) {
    const key = `${domain}\0${source}`;
    const prev = this.seen.get(key);
    if (!prev || at < prev) this.seen.set(key, at);
  }
  async insertLicense(l: LicenseRow) {
    this.licenses.set(l.id, { ...l });
  }
  async updateLicense(id: string, patch: Partial<Omit<LicenseRow, 'id' | 'keyHash'>>) {
    const l = this.licenses.get(id);
    if (l) Object.assign(l, patch);
  }
  async licenseById(id: string) {
    const l = this.licenses.get(id);
    return l ? { ...l } : null;
  }
  async licenseBySubscription(sub: string) {
    const l = [...this.licenses.values()].find((x) => x.paddleSubscriptionId === sub);
    return l ? { ...l } : null;
  }
  async savePickup(h: string, key: string) {
    this.pickups.set(h, key);
  }
  async takePickup(h: string) {
    const k = this.pickups.get(h) ?? null;
    this.pickups.delete(h);
    return k;
  }
  async close() {}
}
