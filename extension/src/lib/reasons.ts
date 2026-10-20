/**
 * Turn per-feature contributions (SHAP values or rule points) into at most three plain-language
 * reasons. Each template also checks the feature VALUE, so we never show a reason that is not
 * literally true for this URL (a positive SHAP value alone is not enough).
 */
import { F } from './features';
import type { Reason } from './types';
import type { MatchDetails } from './wasm';

export interface ReasonContext {
  url: string;
  features: ArrayLike<number>;
  details: MatchDetails;
  suspiciousTokens: string[];
}

type Template = (ctx: ReasonContext) => string | null;

const tld = (ctx: ReasonContext): string => {
  const host = ctx.details.registered_domain;
  const i = host.lastIndexOf('.');
  return i >= 0 ? host.slice(i + 1) : host;
};

const brandLabel = (d: MatchDetails): string => d.brand_name.replace(/\s*\(.*\)$/, '');

export const TEMPLATES: Partial<Record<number, Template>> = {
  [F.brand_in_host_not_official]: ({ features, details }) =>
    features[F.brand_in_host_not_official] && details.kind === 'host'
      ? `Contains "${details.matched}" but is not ${details.official_domain}`
      : null,
  [F.homoglyph_brand_match]: ({ features, details }) =>
    features[F.homoglyph_brand_match] && details.brand
      ? `Uses look-alike characters to imitate ${brandLabel(details)} (${details.official_domain})`
      : null,
  [F.min_brand_edit_distance]: ({ features, details }) =>
    features[F.min_brand_edit_distance] > 0 && features[F.min_brand_edit_distance] <= 2 && details.kind === 'edit'
      ? `"${details.matched}" is spelled almost like ${brandLabel(details)}, but this is not ${details.official_domain}`
      : null,
  [F.brand_in_path]: ({ features, details }) =>
    features[F.brand_in_path] && details.kind === 'path'
      ? `Mentions ${brandLabel(details)} in the link, but the site is ${details.registered_domain}`
      : null,
  [F.is_mixed_script]: ({ features }) =>
    features[F.is_mixed_script] ? 'Mixes letters from different alphabets in the web address' : null,
  [F.is_punycode]: ({ features }) =>
    features[F.is_punycode] ? 'Web address uses disguised international characters (xn--)' : null,
  [F.is_ip_host]: ({ features }) => (features[F.is_ip_host] ? 'Uses a raw IP address instead of a website name' : null),
  [F.has_at_symbol]: ({ features }) =>
    features[F.has_at_symbol] ? 'Web address contains "@", which can hide the real site' : null,
  [F.is_risky_tld]: (ctx) =>
    ctx.features[F.is_risky_tld] ? `Ends in ".${tld(ctx)}", a domain ending often used by scam sites` : null,
  [F.suspicious_token_count]: ({ features, suspiciousTokens }) =>
    features[F.suspicious_token_count] >= 1 && suspiciousTokens.length
      ? `Link uses words scammers like: ${suspiciousTokens
          .slice(0, 3)
          .map((t) => `"${t}"`)
          .join(', ')}`
      : null,
  [F.num_subdomains]: ({ features }) =>
    features[F.num_subdomains] >= 3
      ? `Unusually many parts in the site name (${features[F.num_subdomains]} sub-domains)`
      : null,
  [F.num_hyphens_host]: ({ features }) =>
    features[F.num_hyphens_host] >= 2 ? 'Site name has many hyphens, common in fake sites' : null,
  [F.num_digits_host]: ({ features }) => (features[F.num_digits_host] >= 3 ? 'Site name contains many numbers' : null),
  [F.host_entropy]: ({ features }) => (features[F.host_entropy] >= 3.8 ? 'Site name looks randomly generated' : null),
  [F.url_length]: ({ features }) => (features[F.url_length] >= 100 ? 'Very long, complicated web address' : null),
  [F.has_nonstandard_port]: ({ features }) =>
    features[F.has_nonstandard_port] ? 'Uses an unusual network port' : null,
  [F.domain_age_days]: ({ features }) => {
    const a = features[F.domain_age_days];
    if (a < 0 || a > 180) return null;
    const days = Math.max(0, Math.round(a));
    return `Domain registered ${days} day${days === 1 ? '' : 's'} ago`;
  },
  [F.cert_age_days]: ({ features }) => {
    const a = features[F.cert_age_days];
    if (a < 0 || a > 30) return null;
    const days = Math.max(0, Math.round(a));
    return `Security certificate issued only ${days} day${days === 1 ? '' : 's'} ago`;
  },
};

/** Features that describe the same evidence: show at most one reason per group. */
const GROUPS: number[][] = [
  [F.brand_in_host_not_official, F.homoglyph_brand_match, F.min_brand_edit_distance],
  [F.is_punycode, F.is_mixed_script],
];

export function topReasons(
  contributions: ArrayLike<number> | Map<number, number>,
  ctx: ReasonContext,
  names: readonly string[],
  extra: Reason[] = [],
  max = 3,
): Reason[] {
  const entries: [number, number][] =
    contributions instanceof Map
      ? [...contributions.entries()]
      : Array.from(contributions as ArrayLike<number>, (w, i) => [i, w] as [number, number]);
  const ranked = entries.filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]);
  const urlReasons: Reason[] = [];
  const usedGroups = new Set<number>();
  for (const [i, w] of ranked) {
    const g = GROUPS.findIndex((grp) => grp.includes(i));
    if (g >= 0 && usedGroups.has(g)) continue;
    const text = TEMPLATES[i]?.(ctx);
    if (!text) continue;
    if (g >= 0) usedGroups.add(g);
    urlReasons.push({ id: names[i], text, weight: w });
  }
  // Merge URL reasons with reasons from other layers (page, visual, known-bad) by weight.
  // Weights are SHAP log-odds for both models, and large constants for hard evidence.
  return [...extra, ...urlReasons].sort((a, b) => b.weight - a.weight).slice(0, max);
}

/** Which suspicious tokens appear in the URL (for the reason text only). */
export function presentTokens(url: string, tokens: string[]): string[] {
  const lower = url.toLowerCase();
  return tokens.filter((t) => lower.includes(t));
}
