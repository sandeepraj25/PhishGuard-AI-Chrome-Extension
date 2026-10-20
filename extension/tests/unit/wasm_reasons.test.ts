import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { REPO, nodeExtractor } from '../../scripts/node_wasm';
import { F, URL_FEATURES } from '../../src/lib/features';
import { presentTokens, topReasons } from '../../src/lib/reasons';
import { ruleContributions } from '../../src/lib/scoring';
import type { FeatureExtractor } from '../../src/lib/wasm';

let fx: FeatureExtractor;
beforeAll(async () => {
  fx = await nodeExtractor();
});

describe('WASM feature extractor', () => {
  it('extracts brand features and details', () => {
    const { features, details } = fx.extract('http://examplebank.test.secure-login.xyz/verify');
    expect(features[F.brand_in_host_not_official]).toBe(1);
    expect(details.brand).toBe('examplebank');
    expect(details.registered_domain).toBe('secure-login.xyz');
  });
  it('registered domain uses the PSL', () => {
    expect(fx.registeredDomain('https://a.b.example.co.uk/x')).toBe('example.co.uk');
  });
  it('banded edit distance and skeleton are exposed', () => {
    expect(fx.editDistance('examp1ebank', 'examplebank')).toBe(1);
    expect(fx.editDistance('kitten', 'sitting')).toBe(3);
    expect(fx.skeleton('xn--80ak6aa92e')).toBe('apple'); // Cyrillic look-alike of "apple"
  });
  it('loads the bundled Bloom filter and finds the fixture domain', () => {
    const bytes = readFileSync(resolve(REPO, 'extension/public/data/known_bad.bloom'));
    expect(fx.loadBloom(new Uint8Array(bytes))).toBe(true);
    expect(fx.bloomContains('account-verify-examplebank.test')).toBe(true);
    expect(fx.bloomContains('examplebank.test')).toBe(false);
    expect(fx.bloomItems()).toBeGreaterThan(0);
  });
  it('survives many calls without leaking memory views', () => {
    for (let i = 0; i < 2000; i++) fx.extract(`https://site${i}.example.com/path/${'x'.repeat(i % 300)}`);
    expect(fx.extract('https://ok.com/').features.length).toBe(26);
  });
});

describe('reasons', () => {
  it('only states facts that are true for the URL, max 3, one per evidence group', () => {
    const url = 'http://user@examplebank.test.verify.xn--exmplebank-0qi.xyz/login';
    const { features, details } = fx.extract(url);
    const contrib = ruleContributions(features);
    const tokens = presentTokens(url, ['login', 'verify', 'kyc']);
    const r = topReasons(contrib, { url, features, details, suspiciousTokens: tokens }, URL_FEATURES);
    expect(r.length).toBeLessThanOrEqual(3);
    expect(new Set(r.map((x) => x.id)).size).toBe(r.length);
    const brandish = r.filter((x) =>
      ['brand_in_host_not_official', 'homoglyph_brand_match', 'min_brand_edit_distance'].includes(x.id),
    );
    expect(brandish.length).toBeLessThanOrEqual(1);
  });
  it('a positive contribution without a true condition produces no reason', () => {
    const { features, details } = fx.extract('https://www.examplebank.test/');
    const fake = new Float64Array(26).fill(1); // pretend every feature pushed towards phishing
    const r = topReasons(
      fake,
      { url: 'https://www.examplebank.test/', features, details, suspiciousTokens: [] },
      URL_FEATURES,
    );
    expect(r).toEqual([]);
  });
});
