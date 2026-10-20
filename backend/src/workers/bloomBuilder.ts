import { createHash } from 'node:crypto';

import type { Store } from '../db/store';
import { BloomFilter } from '../lib/bloom';

/** Rebuild the known-bad Bloom filter from the active domain list and store a new version. */
export async function rebuildBloom(
  store: Store,
  fpRate = 0.001,
): Promise<{ items: number; etag: string; bytes: number }> {
  const domains = await store.activeDomains();
  const bf = BloomFilter.forCapacity(domains.length, fpRate);
  for (const d of domains) bf.add(d);
  const bytes = bf.serialize();
  const etag = createHash('sha256').update(bytes).digest('hex').slice(0, 32);
  const latest = await store.latestBloom();
  if (latest?.etag !== etag) await store.saveBloom({ etag, items: domains.length, bytes });
  return { items: domains.length, etag, bytes: bytes.length };
}
