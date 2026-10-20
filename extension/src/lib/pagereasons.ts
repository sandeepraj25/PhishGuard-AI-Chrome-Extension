/** Plain-language reasons for Layer 2 (page) features. Same rule as URL reasons: the feature
 * VALUE must make the sentence true; SHAP only ranks. */
import { P, type PageDetails } from './pagefeatures';
import type { Reason } from './types';

type T = (f: ArrayLike<number>, d: PageDetails) => string | null;

const what = (f: ArrayLike<number>) =>
  f[P.num_password_fields] > 0
    ? 'your password'
    : f[P.num_card_fields] > 0
      ? 'your card details'
      : 'your one-time code';

export const PAGE_TEMPLATES: Partial<Record<number, T>> = {
  [P.form_action_external]: (f, d) =>
    f[P.form_action_external] && !f[P.form_action_to_official] && d.formActionDomain
      ? `Form sends ${what(f)} to a different site (${d.formActionDomain})`
      : null,
  [P.form_action_unusual_scheme]: (f) =>
    f[P.form_action_unusual_scheme] ? `Form sends ${what(f)} to an unusual place (an email address or raw IP)` : null,
  [P.form_get_with_password]: (f) =>
    f[P.form_get_with_password] ? 'Form would put your password inside the web address' : null,
  [P.brand_in_title_not_official]: (f, d) =>
    f[P.brand_in_title_not_official] && d.brandName
      ? `Page calls itself ${d.brandName}, but this is not ${d.officialDomain}`
      : null,
  [P.resources_from_brand_domain]: (f) =>
    f[P.resources_from_brand_domain] ? "Copies images or code from another company's official site" : null,
  [P.urgency_phrase_count]: (f, d) =>
    f[P.urgency_phrase_count] >= 1 && d.urgencyPhrases.length
      ? `Uses pressure tactics: “${d.urgencyPhrases[0]}”`
      : null,
  [P.hidden_iframes]: (f) => (f[P.hidden_iframes] >= 1 ? 'Contains hidden frames' : null),
  [P.null_link_ratio]: (f) =>
    f[P.null_link_ratio] >= 0.5 && f[P.num_links] >= 3 ? 'Most links on the page lead nowhere' : null,
  [P.context_menu_blocked]: (f) => (f[P.context_menu_blocked] ? 'Blocks right-click, a trick to hide the page' : null),
};

const GROUPS = [[P.brand_in_title_not_official, P.brand_in_text_not_official, P.num_brands_mentioned]];

/**
 * Hard evidence: directly verifiable facts that are always shown first, regardless of SHAP rank.
 * ("Your password would be sent to attacker.test" matters more than "many links lead nowhere".)
 */
const PINNED = [P.form_action_external, P.form_action_unusual_scheme];

export function pageReasons(
  contrib: ArrayLike<number>,
  f: ArrayLike<number>,
  d: PageDetails,
  names: readonly string[],
): Reason[] {
  const top = Math.max(0, ...Array.from(contrib));
  const ranked = Array.from(contrib, (w, i) => [i, w] as [number, number])
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1]);
  const out: Reason[] = [];
  const used = new Set<number>();
  for (const i of PINNED) {
    const text = PAGE_TEMPLATES[i]?.(f, d);
    // Weight just above the strongest SHAP value so merging with URL reasons keeps it on top.
    if (text) out.push({ id: `page_${names[i]}`, text, weight: top + 1 });
  }
  for (const [i, w] of ranked) {
    if (PINNED.includes(i)) continue;
    const g = GROUPS.findIndex((grp) => grp.includes(i));
    if (g >= 0 && used.has(g)) continue;
    const text = PAGE_TEMPLATES[i]?.(f, d);
    if (!text) continue;
    if (g >= 0) used.add(g);
    out.push({ id: `page_${names[i]}`, text, weight: w });
  }
  return out;
}

/** Hard floor: a password form posting to an unrelated site while the page claims to be a brand. */
export function pageFloor(f: ArrayLike<number>): number {
  if (
    f[P.form_action_external] &&
    !f[P.form_action_to_official] &&
    f[P.brand_in_title_not_official] &&
    f[P.num_password_fields] > 0
  )
    return 70;
  if (f[P.form_action_unusual_scheme] && f[P.num_password_fields] + f[P.num_card_fields] > 0) return 65;
  return 0;
}
