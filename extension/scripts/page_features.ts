/**
 * Training-time page featuriser. Uses the SAME collectRaw/finalizePageFeatures code as the
 * extension (src/lib/pagefeatures.ts), on jsdom instead of a live DOM.
 *   npx tsx scripts/page_features.ts <in.jsonl> <out.csv>
 * Input rows: {"url", "html", "label", "first_seen", "source"}.
 */
import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

import { JSDOM, VirtualConsole } from 'jsdom';

import {
  collectRaw,
  finalizePageFeatures,
  flattenUrgency,
  PAGE_FEATURES,
  type BrandEntry,
} from '../src/lib/pagefeatures';
import { nodeExtractor, sharedText } from './node_wasm';

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) throw new Error('usage: page_features.ts <in.jsonl> <out.csv>');

const fx = await nodeExtractor();
const brands = (JSON.parse(sharedText('brands.json')) as { brands: BrandEntry[] }).brands;
const urgencyPhrases = flattenUrgency(JSON.parse(sharedText('urgency_phrases.json')));
const ctx = { registeredDomain: (u: string) => fx.registeredDomain(u), brands, urgencyPhrases };
const quiet = new VirtualConsole(); // ignore page console output / CSS parse errors

const lines = [['url', 'label', 'first_seen', 'source', 'registered_domain', ...PAGE_FEATURES].join(',')];
const csv = (s: string) => `"${s.replace(/"/g, '""')}"`;
let n = 0;
for await (const line of createInterface({ input: createReadStream(inPath) })) {
  if (!line.trim()) continue;
  const row = JSON.parse(line) as { url: string; html: string; label: number; first_seen: string; source: string };
  // No script execution, no subresource loading: features are computed from markup only.
  const dom = new JSDOM(row.html, { url: row.url, virtualConsole: quiet });
  const { features } = finalizePageFeatures(collectRaw(dom.window.document, row.url), ctx);
  lines.push(
    [csv(row.url), row.label, row.first_seen, row.source, fx.registeredDomain(row.url), ...features].join(','),
  );
  dom.window.close();
  n++;
}
writeFileSync(outPath, lines.join('\n') + '\n');
console.log(`featurised ${n} pages -> ${outPath}`);
