/// <reference lib="webworker" />
/** Dedicated inference worker (runs inside the offscreen document). */
import { configureOrt } from '../lib/model';
import { flattenUrgency, type BrandEntry } from '../lib/pagefeatures';
import { PageScorer } from '../lib/pagescore';
import type { TreeModel } from '../lib/treeshap';
import { VisualScorer, type VisualGallery, type VisualRequest } from '../lib/visualscore';
import { FeatureExtractor } from '../lib/wasm';

let base = '';
let pageScorer: Promise<PageScorer> | null = null;
let visualScorer: Promise<VisualScorer> | null = null;

async function initVisual(): Promise<VisualScorer> {
  configureOrt({ wasmUrl: `${base}ort/ort-wasm-simd-threaded.wasm`, proxy: false });
  const [onnx, gallery] = await Promise.all([
    get('models/visual_model.onnx').then((r) => r.arrayBuffer()),
    get('models/visual_gallery.json').then(async (r) => (await r.json()) as VisualGallery),
  ]);
  return VisualScorer.create(onnx, gallery);
}

const get = async (p: string) => {
  const r = await fetch(base + p);
  if (!r.ok) throw new Error(`missing ${p}`);
  return r;
};

async function initPage(): Promise<PageScorer> {
  configureOrt({ wasmUrl: `${base}ort/ort-wasm-simd-threaded.wasm`, proxy: false });
  const txt = async (p: string) => (await get(p)).text();
  const [wasm, psl, brands, confusables, toks, tlds, urgency, onnx, trees] = await Promise.all([
    get('wasm/phishguard.wasm').then((r) => r.arrayBuffer()),
    txt('data/psl_ascii.txt'),
    txt('data/brands.json'),
    txt('data/confusables.json'),
    txt('data/suspicious_tokens.json'),
    txt('data/risky_tlds.json'),
    txt('data/urgency_phrases.json'),
    get('models/page_model.onnx').then((r) => r.arrayBuffer()),
    txt('models/page_trees.json').then((t) => JSON.parse(t) as TreeModel),
  ]);
  const fx = await FeatureExtractor.create(wasm, { psl, brands, confusables, suspiciousTokens: toks, riskyTlds: tlds });
  return PageScorer.create(onnx, trees, {
    registeredDomain: (u) => fx.registeredDomain(u),
    brands: (JSON.parse(brands) as { brands: BrandEntry[] }).brands,
    urgencyPhrases: flattenUrgency(JSON.parse(urgency)),
  });
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as { id: number; kind: string; assetBase?: string; raw?: unknown };
  try {
    if (msg.kind === 'init') {
      base = msg.assetBase ?? '';
      return;
    }
    if (msg.kind === 'ping') return self.postMessage({ id: msg.id, ok: true, pong: true });
    if (msg.kind === 'page') {
      pageScorer ??= initPage();
      const page = await (await pageScorer).score(msg.raw as Parameters<PageScorer['score']>[0]);
      return self.postMessage({ id: msg.id, ok: true, page });
    }
    if (msg.kind === 'visual') {
      visualScorer ??= initVisual();
      const req = (msg as unknown as { req: Omit<VisualRequest, 'png'> & { pngDataUrl: string } }).req;
      const png = await (await fetch(req.pngDataUrl)).arrayBuffer();
      const visual = await (await visualScorer).score({ ...req, png });
      return self.postMessage({ id: msg.id, ok: true, visual });
    }
    self.postMessage({ id: msg.id, ok: false, error: `unknown request ${msg.kind}` });
  } catch (err) {
    if (msg.kind === 'page') pageScorer = null;
    if (msg.kind === 'visual') visualScorer = null;
    self.postMessage({ id: msg.id, ok: false, error: String(err) });
  }
};
