/** Loads bundled assets via chrome.runtime.getURL (everything ships inside the package). */
import type { EngineAssets } from '../lib/engine';
import type { TreeModel } from '../lib/treeshap';

const url = (p: string) => chrome.runtime.getURL(p);

async function text(p: string): Promise<string> {
  const r = await fetch(url(p));
  if (!r.ok) throw new Error(`missing asset ${p}`);
  return r.text();
}

async function bytes(p: string): Promise<ArrayBuffer | null> {
  const r = await fetch(url(p));
  return r.ok ? r.arrayBuffer() : null;
}

export async function loadEngineAssets(storedBloom: Uint8Array | null): Promise<EngineAssets> {
  const [wasm, psl, brands, confusables, suspiciousTokens, riskyTlds, onnx, treesText, bundledBloom, manifest] =
    await Promise.all([
      bytes('wasm/phishguard.wasm'),
      text('data/psl_ascii.txt'),
      text('data/brands.json'),
      text('data/confusables.json'),
      text('data/suspicious_tokens.json'),
      text('data/risky_tlds.json'),
      bytes('models/url_model.onnx'),
      text('models/url_trees.json').catch(() => ''),
      bytes('data/known_bad.bloom'),
      text('models/manifest.json').catch(() => '{}'),
    ]);
  if (!wasm) throw new Error('feature extractor wasm missing');
  const modelVersion = (JSON.parse(manifest) as { url?: { version?: string } }).url?.version ?? 'unknown';
  return {
    wasm,
    shared: { psl, brands, confusables, suspiciousTokens, riskyTlds },
    onnx,
    trees: treesText ? (JSON.parse(treesText) as TreeModel) : null,
    bloom: storedBloom ?? (bundledBloom ? new Uint8Array(bundledBloom) : null),
    modelVersion,
  };
}
