/** Feature indices (must match shared/feature_spec.json; checked in tests/unit/scoring.test.ts). */
export const URL_FEATURES = [
  'url_length',
  'host_length',
  'path_length',
  'num_dots_host',
  'num_subdomains',
  'num_hyphens_host',
  'num_digits_host',
  'digit_ratio_url',
  'host_entropy',
  'url_entropy',
  'suspicious_token_count',
  'is_risky_tld',
  'tld_length',
  'is_punycode',
  'is_mixed_script',
  'is_ip_host',
  'has_at_symbol',
  'num_path_segments',
  'num_query_params',
  'has_nonstandard_port',
  'brand_in_host_not_official',
  'brand_in_path',
  'min_brand_edit_distance',
  'homoglyph_brand_match',
  'domain_age_days',
  'cert_age_days',
] as const;

export type UrlFeatureName = (typeof URL_FEATURES)[number];
export const F = Object.fromEntries(URL_FEATURES.map((n, i) => [n, i])) as Record<UrlFeatureName, number>;
