/**
 * Phishing-feed ingestion. Every 15 minutes: download each enabled feed, reduce every URL to its
 * registered domain (same WASM extractor as the extension), skip never-block domains, upsert into
 * known_bad_domains with the earliest first_seen per source, then rebuild the Bloom filter.
 */
import { fillEnv, type FeedConfig } from '../config';
import type { Store } from '../db/store';
import { sha256Hex } from '../lib/hash';

export interface FeedEntry {
  url: string;
  seenAt: Date;
}

export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export function parseFeed(format: FeedConfig['format'], body: string, now: Date): FeedEntry[] {
  switch (format) {
    case 'text':
      return body
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
        .map((url) => ({ url, seenAt: now }));
    case 'phishtank-json': {
      const rows = JSON.parse(body) as { url: string; submission_time?: string }[];
      return rows.map((r) => {
        const t = r.submission_time ? new Date(r.submission_time) : now;
        return { url: r.url, seenAt: Number.isNaN(t.getTime()) ? now : t };
      });
    }
    case 'csv-url-column': {
      const [header, ...lines] = body.split('\n').filter((l) => l.trim());
      const col = header.split(',').findIndex((h) => h.trim().toLowerCase() === 'url');
      if (col < 0) throw new Error('csv feed has no "url" column');
      return lines.map((l) => ({ url: l.split(',')[col].trim(), seenAt: now }));
    }
  }
}

export interface IngestDeps {
  store: Store;
  registeredDomain: (url: string) => string;
  neverBlock: Set<string>;
  fetcher: Fetcher;
  commercialMode: boolean;
  now?: () => Date;
  log?: (msg: string) => void;
}

export interface IngestStats {
  feed: string;
  urls: number;
  domains: number;
  inserted: number;
  skippedNeverBlock: number;
  error?: string;
}

export async function ingestFeed(feed: FeedConfig, deps: IngestDeps): Promise<IngestStats | null> {
  if (!feed.enabled) return null;
  if (deps.commercialMode && !feed.commercialUseAllowed) return null; // licence gate
  const url = fillEnv(feed.url);
  if (!url) return null; // required key not configured
  const stats: IngestStats = { feed: feed.name, urls: 0, domains: 0, inserted: 0, skippedNeverBlock: 0 };
  try {
    const res = await deps.fetcher(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const entries = parseFeed(feed.format, await res.text(), (deps.now ?? (() => new Date()))());
    stats.urls = entries.length;
    const earliest = new Map<string, Date>();
    for (const e of entries) {
      const d = deps.registeredDomain(e.url).toLowerCase();
      if (!d) continue;
      if (deps.neverBlock.has(d)) {
        stats.skippedNeverBlock++;
        continue;
      }
      const prev = earliest.get(d);
      if (!prev || e.seenAt < prev) earliest.set(d, e.seenAt);
    }
    stats.domains = earliest.size;
    for (const [d, at] of earliest) {
      if ((await deps.store.upsertKnownBad(d, sha256Hex(d), feed.name, at)) === 'inserted') stats.inserted++;
    }
  } catch (e) {
    stats.error = String(e);
  }
  deps.log?.(`feed ${feed.name}: ${JSON.stringify(stats)}`);
  return stats;
}
