/**
 * Risk scoring: model probability + hard rules + user context -> 0..100 score and band.
 * rulesScore / hardRuleFloor mirror ml/phishguard_ml/rules.py (tested with shared vectors).
 */
import { BLOOM_ONLY_FLOOR, CAUTION_MAX, SAFE_MAX, SEEN_BEFORE_BONUS, TRUSTED_CAP } from './config';
import { F } from './features';
import type { Band, KnownBadState } from './types';

/** Rule points per feature; also used as "contributions" for reasons when no model is loaded. */
export function ruleContributions(f: ArrayLike<number>): Map<number, number> {
  const c = new Map<number, number>();
  const add = (i: number, pts: number) => pts > 0 && c.set(i, (c.get(i) ?? 0) + pts);
  if (f[F.brand_in_host_not_official]) add(F.brand_in_host_not_official, 45);
  if (f[F.homoglyph_brand_match]) add(F.homoglyph_brand_match, 45);
  const ed = f[F.min_brand_edit_distance];
  if (ed === 1) add(F.min_brand_edit_distance, 35);
  else if (ed === 2) add(F.min_brand_edit_distance, 25);
  if (f[F.brand_in_path]) add(F.brand_in_path, 20);
  if (f[F.is_mixed_script]) add(F.is_mixed_script, 30);
  if (f[F.is_punycode]) add(F.is_punycode, 10);
  if (f[F.is_ip_host]) add(F.is_ip_host, 30);
  if (f[F.has_at_symbol]) add(F.has_at_symbol, 20);
  if (f[F.is_risky_tld]) add(F.is_risky_tld, 10);
  add(F.suspicious_token_count, Math.min(15, 5 * f[F.suspicious_token_count]));
  if (f[F.has_nonstandard_port]) add(F.has_nonstandard_port, 10);
  if (f[F.num_subdomains] >= 3) add(F.num_subdomains, 10);
  const age = f[F.domain_age_days];
  if (age >= 0 && age < 30) add(F.domain_age_days, 20);
  return c;
}

export function rulesScore(f: ArrayLike<number>): number {
  let s = 0;
  for (const v of ruleContributions(f).values()) s += v;
  return Math.max(0, Math.min(100, s));
}

export function hardRuleFloor(f: ArrayLike<number>): number {
  if (f[F.homoglyph_brand_match] && f[F.is_mixed_script]) return 75;
  if (f[F.brand_in_host_not_official] && f[F.has_at_symbol]) return 70;
  return 0;
}

export function bandOf(score: number): Band {
  if (score <= SAFE_MAX) return 'safe';
  if (score <= CAUTION_MAX) return 'caution';
  return 'warning';
}

export interface ScoreInput {
  features: ArrayLike<number>;
  /** Combined model probability (Layer 1, or the max/blend with Layers 2-3), null = no model. */
  modelProb: number | null;
  knownBad: KnownBadState;
  trusted: boolean;
  seenBefore: boolean;
  /** Extra floors from page/visual layers (e.g. confirmed form-action mismatch). */
  extraFloor?: number;
}

export function finalScore(inp: ScoreInput): number {
  if (inp.knownBad === 'confirmed') return 100; // spec: known-bad list -> 100 (block page)
  const base = inp.modelProb === null ? rulesScore(inp.features) : 100 * inp.modelProb;
  let score = Math.max(base, hardRuleFloor(inp.features), inp.extraFloor ?? 0);
  if (inp.knownBad === 'bloom-only') score = Math.max(score, BLOOM_ONLY_FLOOR); // D7
  if (inp.seenBefore) score = Math.max(0, score - SEEN_BEFORE_BONUS);
  if (inp.trusted) score = Math.min(score, TRUSTED_CAP);
  return Math.round(Math.max(0, Math.min(100, score)));
}
