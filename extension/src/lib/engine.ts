/**
 * Layer-1 scoring engine used by the service worker: WASM features -> ONNX model -> rules ->
 * known-bad check -> user context -> Verdict with top-3 reasons.
 * Everything here runs on the device. The only network call that can involve the current site
 * is the 4-byte hash-prefix check (api.ts) after a local Bloom-filter hit.
 */
import { checkPrefix } from './api';
import { hashPrefix } from './hash';
import { OnnxBinaryClassifier } from './model';
import { presentTokens, topReasons } from './reasons';
import { bandOf, finalScore, ruleContributions } from './scoring';
import { sigmoid, treeShap, type TreeModel } from './treeshap';
import type { KnownBadState, Reason, Verdict } from './types';
import { FeatureExtractor, NUM_URL_FEATURES, type SharedData } from './wasm';
import { URL_FEATURES } from './features';

export interface EngineAssets {
  wasm: ArrayBuffer;
  shared: SharedData;
  onnx: ArrayBuffer | null;
  trees: TreeModel | null;
  bloom: Uint8Array | null;
  modelVersion: string;
}

export interface VerdictContext {
  trusted: boolean;
  seenBefore: boolean;
  apiBase: string;
  domainAgeDays?: number;
  certAgeDays?: number;
  /** Extra reasons/floor from Layers 2-3 (v2+). */
  extraReasons?: Reason[];
  extraFloor?: number;
  /** Probability from Layers 2-3; combined as max with Layer 1. */
  extraProb?: number | null;
  layers?: string[];
}

export class Engine {
  private knownBadCache = new Map<string, KnownBadState>();
  private suspiciousTokens: string[];

  private constructor(
    readonly fx: FeatureExtractor,
    private readonly model: OnnxBinaryClassifier | null,
    private readonly trees: TreeModel | null,
    readonly modelVersion: string,
    tokensJson: string,
  ) {
    this.suspiciousTokens = (JSON.parse(tokensJson) as { tokens: string[] }).tokens;
  }

  static async create(a: EngineAssets): Promise<Engine> {
    const fx = await FeatureExtractor.create(a.wasm, a.shared);
    if (a.bloom && !fx.loadBloom(a.bloom)) console.warn('[phishguard] bloom filter rejected');
    let model: OnnxBinaryClassifier | null = null;
    if (a.onnx) {
      try {
        model = await OnnxBinaryClassifier.load(a.onnx, NUM_URL_FEATURES);
      } catch (e) {
        console.warn('[phishguard] URL model failed to load, falling back to rules', e);
      }
    }
    return new Engine(fx, model, a.trees, a.modelVersion, a.shared.suspiciousTokens);
  }

  get hasModel(): boolean {
    return this.model !== null;
  }

  registeredDomain(url: string): string {
    return this.fx.registeredDomain(url);
  }

  async knownBad(domain: string, apiBase: string): Promise<KnownBadState> {
    if (!domain || !this.fx.bloomContains(domain)) return 'no';
    const cached = this.knownBadCache.get(domain);
    if (cached && cached !== 'bloom-only') return cached;
    if (!apiBase) return 'bloom-only';
    try {
      const { full, prefix } = await hashPrefix(domain);
      const state: KnownBadState = (await checkPrefix(apiBase, prefix)).includes(full) ? 'confirmed' : 'no';
      this.knownBadCache.set(domain, state);
      return state;
    } catch {
      return 'bloom-only'; // offline or server error: D7
    }
  }

  async verdict(url: string, ctx: VerdictContext): Promise<Verdict> {
    const { features, details } = this.fx.extract(url, ctx.domainAgeDays ?? -1, ctx.certAgeDays ?? -1);
    const domain = details.registered_domain;
    const knownBad = await this.knownBad(domain, ctx.apiBase);

    let urlProb: number | null = null;
    let contributions: Float64Array | Map<number, number>;
    if (this.model) {
      urlProb = await this.model.predict(features);
      contributions = this.trees ? treeShap(this.trees, features).phi : ruleContributions(features);
    } else {
      contributions = ruleContributions(features);
    }
    const prob =
      ctx.extraProb !== undefined && ctx.extraProb !== null ? Math.max(urlProb ?? 0, ctx.extraProb) : urlProb;
    const score = finalScore({
      features,
      modelProb: prob,
      knownBad,
      trusted: ctx.trusted,
      seenBefore: ctx.seenBefore,
      extraFloor: ctx.extraFloor,
    });

    const extra: Reason[] = [...(ctx.extraReasons ?? [])];
    if (knownBad === 'confirmed') extra.push({ id: 'known_bad', text: 'Listed as a known phishing site', weight: 99 });
    else if (knownBad === 'bloom-only')
      extra.push({ id: 'known_bad_unconfirmed', text: 'Matches our list of known phishing sites', weight: 98 });
    let reasons = topReasons(
      contributions,
      { url, features, details, suspiciousTokens: presentTokens(url, this.suspiciousTokens) },
      URL_FEATURES,
      extra,
    );
    if (score > 30 && reasons.length === 0) {
      reasons = [{ id: 'model_overall', text: 'Several small warning signs add up for this address', weight: 0 }];
    }
    if (ctx.trusted) reasons = [{ id: 'trusted', text: 'You marked this site as trusted', weight: 0 }];

    return {
      url,
      registeredDomain: domain,
      score,
      band: bandOf(score),
      reasons,
      knownBad,
      trusted: ctx.trusted,
      source: knownBad === 'confirmed' ? 'known-bad' : this.model ? 'model' : 'rules',
      layers: ctx.layers ?? ['url'],
      modelVersion: this.modelVersion,
      computedAt: Date.now(),
    };
  }

  /** Raw model output for diagnostics/tests. */
  async urlProbability(url: string): Promise<number | null> {
    if (!this.model) return null;
    return this.model.predict(this.fx.extract(url).features);
  }

  shapProbability(url: string): number | null {
    if (!this.trees) return null;
    const { phi, bias } = treeShap(this.trees, this.fx.extract(url).features);
    return sigmoid(phi.reduce((a, b) => a + b, 0) + bias);
  }
}
