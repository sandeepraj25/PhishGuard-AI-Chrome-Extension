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

export interface LicenseRow {
  id: string;
  keyHash: string;
  plan: 'pro' | 'teams';
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'paused';
  seats: number;
  expiresAt: Date;
  paddleSubscriptionId: string | null;
  paddleCustomerId: string | null;
  orgId: string | null;
}

export interface OrgRow {
  id: string;
  name: string;
  seats: number;
  orgKeyHash: string;
  dashboardTokenHash: string;
}

export interface WarningEvent {
  orgId: string;
  deviceHash: string;
  occurredAt: Date;
  band: 'caution' | 'warning' | 'blocked';
  score: number;
  brand: string | null;
  reasonIds: string[];
  layers: string[];
  action: string | null;
}

export interface ApiKeyRow {
  id: string;
  keyHash: string;
  name: string;
  requestsPerMin: number;
  revoked: boolean;
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

  // v3: licences
  insertLicense(l: LicenseRow): Promise<void>;
  updateLicense(id: string, patch: Partial<Omit<LicenseRow, 'id' | 'keyHash'>>): Promise<void>;
  licenseById(id: string): Promise<LicenseRow | null>;
  licenseBySubscription(subscriptionId: string): Promise<LicenseRow | null>;
  savePickup(claimTokenHash: string, key: string): Promise<void>;
  takePickup(claimTokenHash: string): Promise<string | null>;

  // v4: Teams, feed API, monitoring
  insertOrg(o: OrgRow): Promise<void>;
  orgByKeyHash(h: string): Promise<OrgRow | null>;
  orgByDashboardHash(h: string): Promise<OrgRow | null>;
  /** Registers a device; returns false if the org has no free seat left. */
  enrollDevice(orgId: string, deviceHash: string, seats: number, label: string | null): Promise<boolean>;
  deviceLabels(orgId: string): Promise<Map<string, string | null>>;
  insertWarningEvents(events: WarningEvent[]): Promise<void>;
  warningEvents(orgId: string, since: Date): Promise<WarningEvent[]>;
  insertApiKey(k: ApiKeyRow): Promise<void>;
  apiKeyByHash(h: string): Promise<ApiKeyRow | null>;
  newDetections(
    since: Date,
    limit: number,
  ): Promise<{ domain: string; firstSeen: Date; brand: string; signal: string; listed: boolean }[]>;
  addErrorCounts(
    rows: { day: string; component: string; code: string; version: string; count: number }[],
  ): Promise<void>;
  errorCounts(
    sinceDay: string,
  ): Promise<{ day: string; component: string; code: string; version: string; count: number }[]>;
  latestBloom(): Promise<BloomVersion | null>;

  close(): Promise<void>;
}
