/**
 * Layer 3 visual scorer: screenshot (PNG) + login-form rectangle -> embedding -> gallery decision.
 * Runs in the offscreen document's worker. Decision rule and threshold come from the gallery file
 * written by ml/scripts/train_visual.py (rule chosen on validation data):
 *   nn    : nearest neighbour against embeddings of official login pages
 *   proto : softmax over learned brand prototypes (+ "other")
 */
import * as ort from 'onnxruntime-web/wasm';

import { cropResizeRGB, loginCrop, toTensorCHW, type Rect, VISUAL_SIZE } from './visualprep';

export interface VisualGallery {
  version: number;
  size: number;
  rule: 'nn' | 'proto';
  threshold: number;
  scale: number;
  prototypes: number[][]; // brands in order, then "other"
  brands: { id: string; name: string; official_domains: string[]; embeddings: number[][] }[];
}

export interface VisualRequest {
  png: ArrayBuffer;
  form: Rect; // CSS px, relative to the viewport
  viewport: { width: number; height: number };
  dpr: number;
}

export interface VisualResult {
  brand: string;
  brandName: string;
  officialDomains: string[];
  confidence: number;
  match: boolean;
  latencyMs: number;
}

const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};
const norm = (v: number[]) => {
  const n = Math.sqrt(dot(v, v)) || 1;
  return v.map((x) => x / n);
};

export function decide(emb: ArrayLike<number>, g: VisualGallery): { index: number; confidence: number } {
  if (g.rule === 'nn') {
    let best = -1;
    let conf = -Infinity;
    g.brands.forEach((b, i) => {
      for (const e of b.embeddings) {
        const s = dot(emb, e);
        if (s > conf) {
          conf = s;
          best = i;
        }
      }
    });
    return { index: best, confidence: conf };
  }
  const logits = g.prototypes.map((p) => g.scale * dot(emb, norm(p)));
  const m = Math.max(...logits);
  const ex = logits.map((l) => Math.exp(l - m));
  const z = ex.reduce((a, b) => a + b, 0);
  const arg = logits.indexOf(m);
  return arg < g.brands.length ? { index: arg, confidence: ex[arg] / z } : { index: -1, confidence: 0 };
}

export class VisualScorer {
  private constructor(
    private readonly session: ort.InferenceSession,
    private readonly gallery: VisualGallery,
  ) {}

  static async create(onnx: ArrayBuffer, gallery: VisualGallery): Promise<VisualScorer> {
    if (gallery.size !== VISUAL_SIZE)
      throw new Error(`gallery size ${gallery.size} != preprocessing size ${VISUAL_SIZE}`);
    const session = await ort.InferenceSession.create(new Uint8Array(onnx), { executionProviders: ['wasm'] });
    return new VisualScorer(session, gallery);
  }

  /** Decode PNG -> RGBA via OffscreenCanvas (lossless, so pixels match the training renders). */
  static async decode(png: ArrayBuffer): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }> {
    const bmp = await createImageBitmap(new Blob([png], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2d context unavailable');
    ctx.drawImage(bmp, 0, 0);
    return { rgba: ctx.getImageData(0, 0, bmp.width, bmp.height).data, width: bmp.width, height: bmp.height };
  }

  async score(req: VisualRequest): Promise<VisualResult> {
    const t0 = performance.now();
    const img = await VisualScorer.decode(req.png);
    const rect = loginCrop(req.form, req.viewport, req.dpr, img);
    const tensor = toTensorCHW(cropResizeRGB(img.rgba, img.width, rect));
    const out = await this.session.run({ input: new ort.Tensor('float32', tensor, [1, 3, VISUAL_SIZE, VISUAL_SIZE]) });
    const emb = out.embedding.data as Float32Array;
    const { index, confidence } = decide(emb, this.gallery);
    const b = index >= 0 ? this.gallery.brands[index] : null;
    return {
      brand: b?.id ?? '',
      brandName: b?.name ?? '',
      officialDomains: b?.official_domains ?? [],
      confidence,
      match: !!b && confidence >= this.gallery.threshold,
      latencyMs: performance.now() - t0,
    };
  }
}
