/**
 * RDAP domain-age lookup with caching (server side, for domains already in our system:
 * feed/CT/report domains — never for user browsing; see decision D6).
 * Bootstrap: IANA's RDAP DNS registry (https://data.iana.org/rdap/dns.json) maps TLDs to
 * RDAP base URLs. Cache: success 30 days (registration date never changes), failures 1 day.
 */
import type { RdapEntry, Store } from '../db/store';
import type { Fetcher } from './feeds';

const BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json';
const OK_TTL = 30 * 86_400_000;
const FAIL_TTL = 86_400_000;

export class RdapClient {
  private bootstrap: Map<string, string> | null = null;
  private bootstrapAt = 0;

  constructor(
    private readonly store: Store,
    private readonly fetcher: Fetcher,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async baseFor(tld: string): Promise<string | null> {
    if (!this.bootstrap || this.now().getTime() - this.bootstrapAt > 86_400_000) {
      const res = await this.fetcher(BOOTSTRAP_URL);
      if (!res.ok) throw new Error(`bootstrap HTTP ${res.status}`);
      const body = JSON.parse(await res.text()) as { services: [string[], string[]][] };
      const map = new Map<string, string>();
      for (const [tlds, urls] of body.services) {
        const https = urls.find((u) => u.startsWith('https://')) ?? urls[0];
        for (const t of tlds) map.set(t.toLowerCase(), https.endsWith('/') ? https : `${https}/`);
      }
      this.bootstrap = map;
      this.bootstrapAt = this.now().getTime();
    }
    return this.bootstrap.get(tld) ?? null;
  }

  static parseRegistration(body: { events?: { eventAction?: string; eventDate?: string }[] }): Date | null {
    const ev = body.events?.find((e) => e.eventAction === 'registration');
    const t = ev?.eventDate ? new Date(ev.eventDate) : null;
    return t && !Number.isNaN(t.getTime()) ? t : null;
  }

  /** Domain age in days, or null if unknown. Uses and fills the cache. */
  async ageDays(domain: string): Promise<number | null> {
    const now = this.now();
    const cached = await this.store.getRdap(domain);
    if (cached) {
      const ttl = cached.status === 'ok' ? OK_TTL : FAIL_TTL;
      if (now.getTime() - cached.fetchedAt.getTime() < ttl) {
        return cached.registeredAt ? (now.getTime() - cached.registeredAt.getTime()) / 86_400_000 : null;
      }
    }
    const entry: RdapEntry = { domain, registeredAt: null, status: 'error', fetchedAt: now };
    try {
      const tld = domain.slice(domain.lastIndexOf('.') + 1);
      const base = await this.baseFor(tld);
      if (!base) entry.status = 'unsupported_tld';
      else {
        const res = await this.fetcher(`${base}domain/${encodeURIComponent(domain)}`);
        if (res.status === 404) entry.status = 'not_found';
        else if (res.ok) {
          entry.registeredAt = RdapClient.parseRegistration(JSON.parse(await res.text()));
          entry.status = entry.registeredAt ? 'ok' : 'not_found';
        }
      }
    } catch {
      entry.status = 'error';
    }
    await this.store.putRdap(entry);
    return entry.registeredAt ? (now.getTime() - entry.registeredAt.getTime()) / 86_400_000 : null;
  }
}

/** Worker step: enrich up to `batch` known-bad domains that have no RDAP entry yet. */
export async function rdapEnrich(store: Store, client: RdapClient, batch = 20): Promise<number> {
  const domains = await store.domainsMissingRdap(batch);
  for (const d of domains) await client.ageDays(d);
  return domains.length;
}
