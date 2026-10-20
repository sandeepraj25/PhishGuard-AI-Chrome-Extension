import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { predictRaw, treeShap, type TreeModel } from '../../src/lib/treeshap';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const model = JSON.parse(readFileSync(resolve(root, 'public/models/url_trees.json'), 'utf8')) as TreeModel;
const vectors = JSON.parse(readFileSync(resolve(root, 'tests/fixtures/shap_vectors.json'), 'utf8')) as {
  x: number[][];
  contrib: number[][];
  raw: number[];
};

describe('TreeSHAP vs LightGBM pred_contrib', () => {
  it('raw score matches', () => {
    vectors.x.forEach((x, i) => expect(predictRaw(model, x)).toBeCloseTo(vectors.raw[i], 9));
  });

  it('per-feature SHAP values and bias match', () => {
    vectors.x.forEach((x, i) => {
      const { phi, bias } = treeShap(model, x);
      const ref = vectors.contrib[i];
      for (let j = 0; j < phi.length; j++) expect(phi[j]).toBeCloseTo(ref[j], 6);
      expect(bias).toBeCloseTo(ref[ref.length - 1], 6);
      // Local accuracy: contributions + bias = raw prediction.
      expect(phi.reduce((a, b) => a + b, 0) + bias).toBeCloseTo(vectors.raw[i], 6);
    });
  });
});
