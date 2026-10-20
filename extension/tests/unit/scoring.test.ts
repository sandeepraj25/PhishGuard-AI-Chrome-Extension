import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { F, URL_FEATURES } from '../../src/lib/features';
import { bandOf, finalScore, hardRuleFloor, rulesScore } from '../../src/lib/scoring';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const spec = JSON.parse(readFileSync(resolve(root, 'shared/feature_spec.json'), 'utf8')) as {
  url_features: { name: string }[];
};
const vectors = JSON.parse(readFileSync(resolve(root, 'extension/tests/fixtures/shap_vectors.json'), 'utf8')) as {
  x: number[][];
  rules: number[];
  floor: number[];
};

describe('feature order', () => {
  it('matches shared/feature_spec.json', () => {
    expect([...URL_FEATURES]).toEqual(spec.url_features.map((f) => f.name));
  });
});

describe('rules mirror ml/phishguard_ml/rules.py', () => {
  it('rulesScore and hardRuleFloor match Python on 100 vectors', () => {
    vectors.x.forEach((x, i) => {
      expect(rulesScore(x)).toBeCloseTo(vectors.rules[i], 9);
      expect(hardRuleFloor(x)).toBe(vectors.floor[i]);
    });
  });
});

describe('finalScore', () => {
  const clean = new Array(26).fill(0);
  clean[F.min_brand_edit_distance] = 3;
  clean[F.domain_age_days] = -1;
  clean[F.cert_age_days] = -1;
  const base = { features: clean, knownBad: 'no' as const, trusted: false, seenBefore: false };

  it('bands follow the spec thresholds', () => {
    expect(bandOf(0)).toBe('safe');
    expect(bandOf(30)).toBe('safe');
    expect(bandOf(31)).toBe('caution');
    expect(bandOf(60)).toBe('caution');
    expect(bandOf(61)).toBe('warning');
  });
  it('confirmed known-bad is always 100, even if trusted', () => {
    expect(finalScore({ ...base, modelProb: 0, knownBad: 'confirmed', trusted: true })).toBe(100);
  });
  it('unconfirmed bloom hit is floored at 80 (D7)', () => {
    expect(finalScore({ ...base, modelProb: 0.1, knownBad: 'bloom-only' })).toBe(80);
  });
  it('trusted caps the score and seen-before lowers it', () => {
    expect(finalScore({ ...base, modelProb: 0.9, trusted: true })).toBe(5);
    expect(finalScore({ ...base, modelProb: 0.5, seenBefore: true })).toBe(25);
  });
  it('falls back to rules without a model', () => {
    const f = [...clean];
    f[F.is_ip_host] = 1;
    expect(finalScore({ ...base, features: f, modelProb: null })).toBe(30);
  });
  it('hard-rule floor overrides a low model probability', () => {
    const f = [...clean];
    f[F.homoglyph_brand_match] = 1;
    f[F.is_mixed_script] = 1;
    expect(finalScore({ ...base, features: f, modelProb: 0.01 })).toBe(75);
  });
});
