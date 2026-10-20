/** Layer 2 scorer: raw DOM signals -> features -> ONNX probability -> TreeSHAP reasons. */
import { OnnxBinaryClassifier } from './model';
import {
  finalizePageFeatures,
  PAGE_FEATURES,
  type FinalizeContext,
  type PageDetails,
  type RawPageSignals,
} from './pagefeatures';
import { pageFloor, pageReasons } from './pagereasons';
import { treeShap, type TreeModel } from './treeshap';
import type { Reason } from './types';

export interface PageScore {
  prob: number;
  reasons: Reason[];
  floor: number;
  details: PageDetails;
  features: number[];
}

export class PageScorer {
  constructor(
    private readonly model: OnnxBinaryClassifier,
    private readonly trees: TreeModel | null,
    private readonly ctx: FinalizeContext,
  ) {}

  static async create(onnx: ArrayBuffer, trees: TreeModel | null, ctx: FinalizeContext): Promise<PageScorer> {
    return new PageScorer(await OnnxBinaryClassifier.load(onnx, PAGE_FEATURES.length), trees, ctx);
  }

  async score(raw: RawPageSignals): Promise<PageScore> {
    const { features, details } = finalizePageFeatures(raw, this.ctx);
    const prob = await this.model.predict(features);
    const contrib = this.trees ? treeShap(this.trees, features).phi : new Float64Array(features.length);
    return {
      prob,
      reasons: pageReasons(contrib, features, details, PAGE_FEATURES),
      floor: pageFloor(features),
      details,
      features,
    };
  }
}
