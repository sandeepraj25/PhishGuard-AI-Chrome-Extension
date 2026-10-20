/**
 * Storage interface. Two implementations: PgStore (production) and MemoryStore (unit tests
 * and the zero-dependency local demo). Both are covered by the same contract test.
 */
export interface KnownBadRow {
  domain: string;
  fullHash: string;
  prefix: string;
  firstSeen: Date;
  lastSeen: Date;
  sources: string[];
}

export interface ReportInput {
  registeredDomain: string;
  kind: 'false_positive' | 'false_negative';
  score: number;
  reasonIds: string[];
  modelVersion: string;
  extensionVersion: string;
  comment?: string;
}

export interface ReportRow extends ReportInput {
  id: number;
  status: 'pending' | 'confirmed' | 'rejected';
  reviewerLabel: number | null;
  createdAt: Date;
}

export interface RdapEntry {
  domain: string;
  registeredAt: Date | null;
  status: 'ok' | 'not_found' | 'error' | 'unsupported_tld';
  fetchedAt: Date;
}

export interface BloomVersion {
  etag: string;
  items: number;
  bytes: Uint8Array;
  createdAt: Date;
}

export interface CtCandidate {
  domain: string;
  firstSeen: Date;
  certNames: string[];
  brand: string;
  signal: 'host' | 'homoglyph' | 'edit';
  logUrl: string;
  verdict: 'unreviewed' | 'phishing' | 'legit';
}

export interface CrawlResult {
  domain: string;
  fetchedAt: Date;
  httpStatus: number | null;
  finalUrl: string | null;
  html: string | null;
  screenshotPath: string | null;
  error: string | null;
}

export interface Store {
  upsertKnownBad(domain: string, fullHash: string, source: string, seenAt: Date): Promise<'inserted' | 'updated'>;
  hashesForPrefix(prefix: string): Promise<string[]>;
  activeDomains(): Promise<string[]>;
  knownBad(domain: string): Promise<KnownBadRow | null>;
  sightings(domain: string): Promise<{ source: string; firstSeen: Date }[]>;
  allSightings(): Promise<{ domain: string; source: string; firstSeen: Date }[]>;

  insertReport(r: ReportInput): Promise<number>;
  listReports(status: ReportRow['status'], limit: number): Promise<ReportRow[]>;
  reviewReport(id: number, status: 'confirmed' | 'rejected', label: number): Promise<boolean>;

  getRdap(domain: string): Promise<RdapEntry | null>;
  putRdap(e: RdapEntry): Promise<void>;
  domainsMissingRdap(limit: number): Promise<string[]>;

  saveBloom(v: Omit<BloomVersion, 'createdAt'>): Promise<void>;

  // v2: Certificate Transparency + crawling
  getCtIndex(logUrl: string): Promise<number | null>;
  setCtIndex(logUrl: string, next: number): Promise<void>;
  upsertCtCandidate(c: Omit<CtCandidate, 'verdict'>): Promise<'inserted' | 'updated'>;
  listCtCandidates(limit: number): Promise<CtCandidate[]>;
  enqueueCrawl(domain: string): Promise<void>;
  takeCrawlJobs(limit: number, maxAttempts: number): Promise<string[]>;
  finishCrawl(result: CrawlResult): Promise<void>;
  getCrawlResult(domain: string): Promise<CrawlResult | null>;
  recordSighting(domain: string, source: string, at: Date): Promise<void>;
  latestBloom(): Promise<BloomVersion | null>;

  close(): Promise<void>;
}
