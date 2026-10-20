import { JSDOM } from 'jsdom';
import { beforeAll, describe, expect, it } from 'vitest';

import { nodeExtractor, sharedText } from '../../scripts/node_wasm';
import {
  collectRaw,
  finalizePageFeatures,
  flattenUrgency,
  P,
  PAGE_FEATURES,
  type BrandEntry,
} from '../../src/lib/pagefeatures';
import { pageFloor, pageReasons } from '../../src/lib/pagereasons';
import type { FeatureExtractor } from '../../src/lib/wasm';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
let fx: FeatureExtractor;
let ctx: Parameters<typeof finalizePageFeatures>[1];
beforeAll(async () => {
  fx = await nodeExtractor();
  ctx = {
    registeredDomain: (u) => fx.registeredDomain(u),
    brands: (JSON.parse(sharedText('brands.json')) as { brands: BrandEntry[] }).brands,
    urgencyPhrases: flattenUrgency(JSON.parse(sharedText('urgency_phrases.json'))),
  };
});

const feats = (html: string, url: string) =>
  finalizePageFeatures(collectRaw(new JSDOM(html, { url }).window.document, url), ctx);

describe('page features', () => {
  it('feature list matches shared/page_feature_spec.json', () => {
    const spec = JSON.parse(readFileSync(resolve(root, 'shared/page_feature_spec.json'), 'utf8')) as {
      page_features: { name: string }[];
    };
    expect([...PAGE_FEATURES]).toEqual(spec.page_features.map((f) => f.name));
  });

  it('detects a password form posting to another registered domain + brand in title', () => {
    const html = readFileSync(resolve(root, 'extension/tests/fixtures/sites/members_form_mismatch.html'), 'utf8');
    const { features, details } = feats(html, 'http://www.cedarlabs.test/members');
    expect(features[P.num_password_fields]).toBe(1);
    expect(features[P.form_action_external]).toBe(1);
    expect(details.formActionDomain).toBe('attacker-example.test');
    expect(features[P.brand_in_title_not_official]).toBe(1);
    expect(details.brandInTitle).toBe('examplebank');
    expect(features[P.urgency_phrase_count]).toBeGreaterThanOrEqual(1);
    expect(pageFloor(features)).toBe(70);
    const reasons = pageReasons(new Float64Array(features.length), features, details, PAGE_FEATURES);
    expect(reasons[0].text).toBe('Form sends your password to a different site (attacker-example.test)');
  });

  it('the official site naming itself is not a brand mismatch; same-site action is not external', () => {
    const html = readFileSync(resolve(root, 'extension/tests/fixtures/sites/examplebank_login.html'), 'utf8');
    const { features } = feats(html, 'http://www.examplebank.test/login');
    expect(features[P.brand_in_title_not_official]).toBe(0);
    expect(features[P.form_action_external]).toBe(0);
    expect(pageFloor(features)).toBe(0);
  });

  it('SSO to an official domain is flagged as such; hidden iframes, mailto actions, multilingual urgency', () => {
    const html = `<title>Sign in</title><body oncontextmenu="return false">
      <form action="https://accounts.google.com/auth" method="post"><input type="password"></form>
      <form action="mailto:x@y.test"><input autocomplete="cc-number"></form>
      <iframe src="https://t.test/" width="1" height="1"></iframe>
      <p>आपका खाता ब्लॉक कर दिया जाएगा — sua conta será bloqueada</p></body>`;
    const { features } = feats(html, 'https://shop.example.test/login');
    expect(features[P.form_action_to_official]).toBe(1);
    expect(features[P.form_action_unusual_scheme]).toBe(1);
    expect(features[P.hidden_iframes]).toBe(1);
    expect(features[P.context_menu_blocked]).toBe(1);
    expect(features[P.urgency_phrase_count]).toBeGreaterThanOrEqual(2);
  });

  it('short brand tokens need word boundaries ("ups" is not in "groups")', () => {
    const { features } = feats('<title>Our groups and setups</title><body></body>', 'https://a.test/');
    expect(features[P.brand_in_title_not_official]).toBe(0);
  });
});
