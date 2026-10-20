/**
 * Layer 2 page features — the ONLY implementation (no Python mirror to drift):
 *   collectRaw(document, url)  : DOM-only, runs in the content script and on jsdom in training.
 *   finalizePageFeatures(raw)  : needs registered domains + brand list, runs in the offscreen
 *                                document and in training (extension/scripts/page_features.ts).
 * Raw signals contain hostnames and short text samples; they are passed only between the
 * extension's own contexts and never leave the device.
 */
import { fieldKind } from '../content/detect';

export const PAGE_FEATURES = [
  'num_password_fields',
  'num_card_fields',
  'num_otp_fields',
  'num_forms',
  'num_inputs',
  'form_action_external',
  'form_action_to_official',
  'form_action_unusual_scheme',
  'form_get_with_password',
  'external_resource_ratio',
  'external_link_ratio',
  'null_link_ratio',
  'num_links',
  'brand_in_title_not_official',
  'brand_in_text_not_official',
  'num_brands_mentioned',
  'resources_from_brand_domain',
  'num_iframes',
  'hidden_iframes',
  'urgency_phrase_count',
  'context_menu_blocked',
  'autocomplete_off_password',
  'text_length',
] as const;
export type PageFeatureName = (typeof PAGE_FEATURES)[number];
export const P = Object.fromEntries(PAGE_FEATURES.map((n, i) => [n, i])) as Record<PageFeatureName, number>;

const MAX_HOSTS = 300;
const TEXT_SAMPLE = 5000;

export interface RawForm {
  actionHost: string; // '' when the action is the page itself
  actionScheme: string; // 'http', 'https', 'mailto', 'javascript', 'data', ...
  method: string;
  password: number;
  card: number;
  otp: number;
}

export interface RawPageSignals {
  pageUrl: string;
  pageHost: string;
  title: string;
  siteName: string;
  text: string; // lower-cased, whitespace-collapsed visible-ish text sample
  forms: RawForm[];
  orphanSensitive: { password: number; card: number; otp: number }; // sensitive inputs outside forms
  inputs: number;
  linkHosts: string[]; // '' for same-page / null links
  nullLinks: number;
  resourceHosts: string[];
  iframes: number;
  hiddenIframes: number;
  contextMenuBlocked: boolean;
  autocompleteOffPassword: boolean;
}

function hostOf(href: string | null, base: string): { host: string; scheme: string } {
  if (!href) return { host: '', scheme: '' };
  try {
    const u = new URL(href, base);
    return { host: u.hostname.toLowerCase(), scheme: u.protocol.replace(':', '') };
  } catch {
    return { host: '', scheme: '' };
  }
}

function visibleText(doc: Document): string {
  const body = doc.body;
  if (!body) return '';
  const clone = body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('script, style, noscript, template').forEach((n) => n.remove());
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, TEXT_SAMPLE);
}

function isHiddenFrame(f: Element): boolean {
  const w = f.getAttribute('width');
  const h = f.getAttribute('height');
  const style = (f.getAttribute('style') ?? '').replace(/\s+/g, '').toLowerCase();
  return (
    (w !== null && Number(w) <= 1) ||
    (h !== null && Number(h) <= 1) ||
    f.hasAttribute('hidden') ||
    style.includes('display:none') ||
    style.includes('visibility:hidden') ||
    /(^|;)(width|height):[01](px)?(;|$)/.test(style)
  );
}

export function collectRaw(doc: Document, pageUrl: string): RawPageSignals {
  const pageHost = hostOf(pageUrl, pageUrl).host;
  const forms: RawForm[] = [];
  for (const form of Array.from(doc.querySelectorAll('form'))) {
    const action = form.getAttribute('action');
    const { host, scheme } = action && action.trim() ? hostOf(action.trim(), pageUrl) : { host: '', scheme: '' };
    const counts = { password: 0, card: 0, otp: 0 };
    for (const input of Array.from(form.querySelectorAll('input'))) {
      const k = fieldKind(input);
      if (k) counts[k]++;
    }
    forms.push({
      actionHost: host,
      actionScheme: scheme,
      method: (form.getAttribute('method') ?? 'get').toLowerCase(),
      ...counts,
    });
  }
  const orphanSensitive = { password: 0, card: 0, otp: 0 };
  const allInputs = Array.from(doc.querySelectorAll('input'));
  for (const input of allInputs) {
    if (input.closest('form')) continue;
    const k = fieldKind(input);
    if (k) orphanSensitive[k]++;
  }

  const linkHosts: string[] = [];
  let nullLinks = 0;
  for (const a of Array.from(doc.querySelectorAll('a[href]')).slice(0, MAX_HOSTS)) {
    const href = (a.getAttribute('href') ?? '').trim();
    if (href === '' || href.startsWith('#') || href.toLowerCase().startsWith('javascript:')) {
      nullLinks++;
      linkHosts.push('');
      continue;
    }
    linkHosts.push(hostOf(href, pageUrl).host);
  }
  const resourceHosts: string[] = [];
  for (const el of Array.from(
    doc.querySelectorAll('script[src], img[src], link[href][rel~="stylesheet"], link[href][rel~="icon"]'),
  ).slice(0, MAX_HOSTS)) {
    const h = hostOf(el.getAttribute('src') ?? el.getAttribute('href'), pageUrl).host;
    if (h) resourceHosts.push(h);
  }
  const iframes = Array.from(doc.querySelectorAll('iframe'));
  const ctx = `${doc.body?.getAttribute('oncontextmenu') ?? ''}${doc.documentElement.getAttribute('oncontextmenu') ?? ''}`;
  return {
    pageUrl,
    pageHost,
    title: (doc.title ?? '').toLowerCase().slice(0, 300),
    siteName: (doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content') ?? '')
      .toLowerCase()
      .slice(0, 100),
    text: visibleText(doc),
    forms,
    orphanSensitive,
    inputs: allInputs.length,
    linkHosts,
    nullLinks,
    resourceHosts,
    iframes: iframes.length,
    hiddenIframes: iframes.filter(isHiddenFrame).length,
    contextMenuBlocked: /return\s+false|preventdefault/i.test(ctx),
    autocompleteOffPassword: allInputs.some(
      (i) =>
        (i.getAttribute('type') ?? '').toLowerCase() === 'password' &&
        (i.getAttribute('autocomplete') ?? '').toLowerCase() === 'off',
    ),
  };
}

// ---------------------------------------------------------------------------------------------

export interface BrandEntry {
  id: string;
  name: string;
  tokens: string[];
  official_domains: string[];
}

export interface FinalizeContext {
  registeredDomain(hostOrUrl: string): string;
  brands: BrandEntry[];
  urgencyPhrases: string[];
}

export interface PageDetails {
  formActionDomain: string;
  brandInTitle: string; // brand id
  brandName: string;
  officialDomain: string;
  urgencyPhrases: string[];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function mentions(token: string, text: string): boolean {
  if (token.length >= 5) return text.includes(token);
  return new RegExp(`(^|[^a-z0-9])${escapeRe(token)}([^a-z0-9]|$)`).test(text);
}

export function finalizePageFeatures(
  raw: RawPageSignals,
  ctx: FinalizeContext,
): { features: number[]; details: PageDetails } {
  const f = new Array<number>(PAGE_FEATURES.length).fill(0);
  const reg = (h: string) => (h ? ctx.registeredDomain(`http://${h}/`) : '');
  const pageReg = reg(raw.pageHost);
  const official = new Map<string, BrandEntry>();
  for (const b of ctx.brands) for (const d of b.official_domains) official.set(d, b);
  const pageBrandIds = new Set(ctx.brands.filter((b) => b.official_domains.includes(pageReg)).map((b) => b.id));

  const sens = raw.forms.filter((fm) => fm.password + fm.card + fm.otp > 0);
  f[P.num_password_fields] = raw.forms.reduce((a, x) => a + x.password, 0) + raw.orphanSensitive.password;
  f[P.num_card_fields] = raw.forms.reduce((a, x) => a + x.card, 0) + raw.orphanSensitive.card;
  f[P.num_otp_fields] = raw.forms.reduce((a, x) => a + x.otp, 0) + raw.orphanSensitive.otp;
  f[P.num_forms] = raw.forms.length;
  f[P.num_inputs] = raw.inputs;

  let formActionDomain = '';
  for (const fm of sens) {
    if (['mailto', 'javascript', 'data'].includes(fm.actionScheme)) f[P.form_action_unusual_scheme] = 1;
    if (fm.actionHost && /^\d+\.\d+\.\d+\.\d+$|^\[/.test(fm.actionHost)) f[P.form_action_unusual_scheme] = 1;
    if (fm.password > 0 && fm.method === 'get') f[P.form_get_with_password] = 1;
    const actionReg = reg(fm.actionHost);
    if (actionReg && actionReg !== pageReg) {
      f[P.form_action_external] = 1;
      formActionDomain ||= actionReg;
      if (official.has(actionReg)) f[P.form_action_to_official] = 1;
    }
  }

  const resRegs = raw.resourceHosts.map(reg);
  f[P.external_resource_ratio] = resRegs.length ? resRegs.filter((r) => r !== pageReg).length / resRegs.length : 0;
  const linkRegs = raw.linkHosts.filter((h) => h).map(reg);
  f[P.num_links] = raw.linkHosts.length;
  f[P.external_link_ratio] = raw.linkHosts.length
    ? linkRegs.filter((r) => r !== pageReg).length / raw.linkHosts.length
    : 0;
  f[P.null_link_ratio] = raw.linkHosts.length ? raw.nullLinks / raw.linkHosts.length : 0;

  const titleText = `${raw.title} ${raw.siteName}`;
  let brandInTitle: BrandEntry | null = null;
  const mentioned = new Set<string>();
  for (const b of ctx.brands) {
    if (pageBrandIds.has(b.id)) continue;
    const inTitle =
      b.tokens.some((t) => mentions(t, titleText)) || mentions(b.name.toLowerCase().split(' (')[0], titleText);
    const inText = b.tokens.some((t) => mentions(t, raw.text));
    if (inTitle && !brandInTitle) brandInTitle = b;
    if (inTitle) f[P.brand_in_title_not_official] = 1;
    if (inText) f[P.brand_in_text_not_official] = 1;
    if (inTitle || inText) mentioned.add(b.id);
  }
  f[P.num_brands_mentioned] = mentioned.size;
  f[P.resources_from_brand_domain] = resRegs.some(
    (r) => official.has(r) && !pageBrandIds.has(official.get(r)?.id ?? ''),
  )
    ? 1
    : 0;
  f[P.num_iframes] = raw.iframes;
  f[P.hidden_iframes] = raw.hiddenIframes;
  const hay = `${titleText} ${raw.text}`;
  const found = ctx.urgencyPhrases.filter((p) => hay.includes(p));
  f[P.urgency_phrase_count] = found.length;
  f[P.context_menu_blocked] = raw.contextMenuBlocked ? 1 : 0;
  f[P.autocomplete_off_password] = raw.autocompleteOffPassword ? 1 : 0;
  f[P.text_length] = raw.text.length;

  return {
    features: f,
    details: {
      formActionDomain,
      brandInTitle: brandInTitle?.id ?? '',
      brandName: brandInTitle?.name.replace(/\s*\(.*\)$/, '') ?? '',
      officialDomain: brandInTitle?.official_domains[0] ?? '',
      urgencyPhrases: found.slice(0, 3),
    },
  };
}

export function flattenUrgency(json: { languages: Record<string, string[]> }): string[] {
  return [
    ...new Set(
      Object.values(json.languages)
        .flat()
        .map((p) => p.toLowerCase()),
    ),
  ];
}
