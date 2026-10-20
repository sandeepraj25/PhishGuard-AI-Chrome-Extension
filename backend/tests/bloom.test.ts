import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../src/config';
import { domainExtractor } from '../src/lib/domains';
import { BASIS1, BloomFilter, fnv1a64 } from '../src/lib/bloom';

describe('Bloom filter (TS) is compatible with C++/WASM and Python', () => {
  it('shared FNV-1a vector', () => {
    expect(fnv1a64('a', BASIS1)).toBe(0xaf63dc4c8601ec8cn);
  });

  it('reads the Python-built bundled filter', () => {
    const bytes = readFileSync(resolve(REPO_ROOT, 'extension/public/data/known_bad.bloom'));
    const bf = BloomFilter.deserialize(new Uint8Array(bytes));
    expect(bf.has('account-verify-examplebank.test')).toBe(true);
    expect(bf.has('examplebank.test')).toBe(false);
  });

  it('a TS-built filter is read correctly by the WASM extractor', async () => {
    const bf = BloomFilter.forCapacity(500, 0.001);
    for (let i = 0; i < 500; i++) bf.add(`bad${i}.test`);
    const fx = await domainExtractor(
      resolve(REPO_ROOT, 'extension/public/wasm/phishguard.wasm'),
      resolve(REPO_ROOT, 'shared'),
    );
    expect(fx.loadBloom(bf.serialize())).toBe(true);
    for (let i = 0; i < 500; i++) expect(fx.bloomContains(`bad${i}.test`)).toBe(true);
    let fp = 0;
    for (let i = 0; i < 5000; i++) fp += fx.bloomContains(`good${i}.test`) ? 1 : 0;
    expect(fp).toBeLessThan(25); // expected ~5 at p = 0.001
    expect(BloomFilter.deserialize(bf.serialize()).n).toBe(500);
  });

  it('rejects corrupt files', () => {
    expect(() => BloomFilter.deserialize(new Uint8Array(30))).toThrow();
  });
});
