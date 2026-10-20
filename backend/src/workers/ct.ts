/**
 * Certificate Transparency discovery (RFC 6962 polling).
 *
 * Every publicly trusted TLS certificate is logged in CT logs within minutes of issuance, often
 * before a phishing site goes live. We poll each log's get-sth / get-entries, extract DNS names,
 * reduce them to registered domains (same WASM extractor as the extension), and keep ONLY domains
 * that carry a brand signal (brand token in host, homoglyph of a brand, or edit distance 1).
 * Each candidate is stored with first_seen = CT entry timestamp and queued for crawling.
 */
import type { CtCandidate, Store } from '../db/store';
import { certNames } from '../lib/der';
import type { Fetcher } from './feeds';

export interface CtLog {
  name: string;
  url: string; // base URL ending in '/', e.g. https://ct.example/logs/2026h2/
  enabled: boolean;
}

export interface LeafEntry {
  timestamp: Date;
  entryType: 'x509' | 'precert';
  der: Uint8Array; // certificate (x509) or TBSCertificate (precert)
}

const b64 = (s: string) => Uint8Array.from(Buffer.from(s, 'base64'));

/** MerkleTreeLeaf: version(1)=0 | leaf_type(1)=0 | timestamp(8, ms) | entry_type(2) | entry */
export function parseLeaf(leafInputB64: string): LeafEntry | null {
  const b = b64(leafInputB64);
  if (b.length < 15 || b[0] !== 0 || b[1] !== 0) return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const timestamp = new Date(Number(view.getBigUint64(2)));
  const entryType = view.getUint16(10);
  let p = 12;
  if (entryType === 1)
    p += 32; // precert: issuer_key_hash
  else if (entryType !== 0) return null;
  if (p + 3 > b.length) return null;
  const len = (b[p] << 16) | (b[p + 1] << 8) | b[p + 2];
  p += 3;
  if (p + len > b.length) return null;
  return { timestamp, entryType: entryType === 1 ? 'precert' : 'x509', der: b.subarray(p, p + len) };
}

export interface DomainSignal {
  brand: string;
  signal: CtCandidate['signal'];
}

export interface CtDeps {
  store: Store;
  fetcher: Fetcher;
  registeredDomain: (url: string) => string;
  /** Returns a brand signal for a registered domain, or null (see brandSignalFromFeatures). */
  brandSignal: (domain: string) => DomainSignal | null;
  batchSize?: number;
  maxBatchesPerRun?: number;
  log?: (m: string) => void;
}

export interface CtRunStats {
  log: string;
  from: number;
  to: number;
  entries: number;
  names: number;
  candidates: number;
  error?: string;
}

async function getJson<T>(fetcher: Fetcher, url: string): Promise<T> {
  const res = await fetcher(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return JSON.parse(await res.text()) as T;
}

export async function pollLog(log: CtLog, deps: CtDeps): Promise<CtRunStats> {
  const stats: CtRunStats = { log: log.name, from: 0, to: 0, entries: 0, names: 0, candidates: 0 };
  try {
    const sth = await getJson<{ tree_size: number }>(deps.fetcher, `${log.url}ct/v1/get-sth`);
    let next = await deps.store.getCtIndex(log.url);
    if (next === null) next = Math.max(0, sth.tree_size - (deps.batchSize ?? 256)); // start near the head
    stats.from = next;
    const batch = deps.batchSize ?? 256;
    for (let i = 0; i < (deps.maxBatchesPerRun ?? 20) && next < sth.tree_size; i++) {
      const end = Math.min(sth.tree_size - 1, next + batch - 1);
      const body = await getJson<{ entries: { leaf_input: string }[] }>(
        deps.fetcher,
        `${log.url}ct/v1/get-entries?start=${next}&end=${end}`,
      );
      if (!body.entries?.length) break;
      for (const e of body.entries) {
        stats.entries++;
        const leaf = parseLeaf(e.leaf_input);
        if (!leaf) continue;
        const names = certNames(leaf.der, leaf.entryType === 'precert');
        if (!names) continue;
        const all = new Set([...names.dnsNames, ...(names.commonName ? [names.commonName] : [])]);
        const domains = new Map<string, string[]>();
        for (const n of all) {
          stats.names++;
          const host = n.replace(/^\*\./, '');
          const reg = deps.registeredDomain(`https://${host}/`);
          if (!reg) continue;
          domains.set(reg, [...(domains.get(reg) ?? []), n]);
        }
        for (const [domain, certNamesForDomain] of domains) {
          const sig =
            deps.brandSignal(domain) ??
            certNamesForDomain.map((n) => deps.brandSignal(n.replace(/^\*\./, ''))).find(Boolean);
          if (!sig) continue;
          await deps.store.upsertCtCandidate({
            domain,
            firstSeen: leaf.timestamp,
            certNames: certNamesForDomain,
            brand: sig.brand,
            signal: sig.signal,
            logUrl: log.url,
          });
          await deps.store.recordSighting(domain, 'ct', leaf.timestamp); // our first_seen, for lead time
          await deps.store.enqueueCrawl(domain);
          stats.candidates++;
        }
      }
      next += body.entries.length; // logs may return fewer entries than asked for
      await deps.store.setCtIndex(log.url, next);
    }
    stats.to = next;
  } catch (e) {
    stats.error = String(e);
  }
  deps.log?.(`ct ${log.name}: ${JSON.stringify(stats)}`);
  return stats;
}

/** Brand signal from the URL feature vector (indices from shared/feature_spec.json). */
export function brandSignalFromFeatures(
  features: ArrayLike<number>,
  details: { brand: string; kind: string },
): DomainSignal | null {
  const BRAND_IN_HOST = 20;
  const MIN_EDIT = 22;
  const HOMOGLYPH = 23;
  if (!details.brand) return null;
  if (features[HOMOGLYPH]) return { brand: details.brand, signal: 'homoglyph' };
  if (features[BRAND_IN_HOST]) return { brand: details.brand, signal: 'host' };
  if (features[MIN_EDIT] === 1) return { brand: details.brand, signal: 'edit' };
  return null;
}
