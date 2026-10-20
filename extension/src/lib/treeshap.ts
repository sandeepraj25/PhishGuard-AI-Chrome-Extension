/**
 * Exact TreeSHAP (Lundberg et al., "Consistent Individualized Feature Attribution for Tree
 * Ensembles", Algorithm 2) for the LightGBM trees exported by ml/phishguard_ml/train.py.
 *
 * Why here and not in ONNX: ONNX tree operators return scores, not attributions. Reasons in
 * the warning UI need per-feature contributions, so we evaluate SHAP on the same trees.
 * Complexity per prediction: O(T * L * D^2) for T trees, L leaves, depth D (D <= ~12 here).
 * Verified against LightGBM pred_contrib in tests/unit/treeshap.test.ts.
 */

export interface FlatTree {
  f: number[]; // split feature, -1 = leaf
  t: number[]; // threshold (x <= t goes left)
  l: number[];
  r: number[];
  v: number[]; // leaf value
  c: number[]; // cover (training rows reaching the node)
}

export interface TreeModel {
  version: number;
  feature_names: string[];
  trees: FlatTree[];
}

interface PathEl {
  d: number; // feature index (-1 for the root placeholder)
  z: number; // zero fraction
  o: number; // one fraction
  w: number; // permutation weight
}

function extend(path: PathEl[], depth: number, z: number, o: number, d: number): void {
  path[depth] = { d, z, o, w: depth === 0 ? 1 : 0 };
  for (let i = depth - 1; i >= 0; i--) {
    path[i + 1].w += (o * path[i].w * (i + 1)) / (depth + 1);
    path[i].w = (z * path[i].w * (depth - i)) / (depth + 1);
  }
}

function unwind(path: PathEl[], depth: number, idx: number): void {
  const o = path[idx].o;
  const z = path[idx].z;
  let next = path[depth].w;
  for (let i = depth - 1; i >= 0; i--) {
    if (o !== 0) {
      const tmp = path[i].w;
      path[i].w = (next * (depth + 1)) / ((i + 1) * o);
      next = tmp - (path[i].w * z * (depth - i)) / (depth + 1);
    } else {
      path[i].w = (path[i].w * (depth + 1)) / (z * (depth - i));
    }
  }
  for (let i = idx; i < depth; i++) {
    path[i].d = path[i + 1].d;
    path[i].z = path[i + 1].z;
    path[i].o = path[i + 1].o;
  }
}

function unwoundSum(path: PathEl[], depth: number, idx: number): number {
  const o = path[idx].o;
  const z = path[idx].z;
  let next = path[depth].w;
  let total = 0;
  for (let i = depth - 1; i >= 0; i--) {
    if (o !== 0) {
      const tmp = (next * (depth + 1)) / ((i + 1) * o);
      total += tmp;
      next = path[i].w - tmp * z * ((depth - i) / (depth + 1));
    } else if (z !== 0) {
      total += path[i].w / z / ((depth - i) / (depth + 1));
    }
  }
  return total;
}

function recurse(
  tree: FlatTree,
  x: ArrayLike<number>,
  phi: Float64Array,
  node: number,
  parent: PathEl[],
  depth: number,
  pz: number,
  po: number,
  pd: number,
): void {
  const path = parent.slice(0, depth).map((e) => ({ ...e }));
  extend(path, depth, pz, po, pd);
  if (tree.f[node] < 0) {
    for (let i = 1; i <= depth; i++) {
      const w = unwoundSum(path, depth, i);
      phi[path[i].d] += w * (path[i].o - path[i].z) * tree.v[node];
    }
    return;
  }
  const feat = tree.f[node];
  const goLeft = x[feat] <= tree.t[node];
  const hot = goLeft ? tree.l[node] : tree.r[node];
  const cold = goLeft ? tree.r[node] : tree.l[node];
  const cover = tree.c[node];
  let iz = 1;
  let io = 1;
  let d = depth;
  let k = 0;
  for (; k <= d; k++) if (path[k].d === feat) break;
  if (k !== d + 1) {
    iz = path[k].z;
    io = path[k].o;
    unwind(path, d, k);
    d -= 1;
  }
  recurse(tree, x, phi, hot, path, d + 1, (tree.c[hot] / cover) * iz, io, feat);
  recurse(tree, x, phi, cold, path, d + 1, (tree.c[cold] / cover) * iz, 0, feat);
}

/** Cover-weighted mean leaf value of a tree = its contribution to the expected value. */
function expectedValue(tree: FlatTree, node = 0): number {
  if (tree.f[node] < 0) return tree.v[node];
  const c = tree.c[node];
  return (
    (tree.c[tree.l[node]] / c) * expectedValue(tree, tree.l[node]) +
    (tree.c[tree.r[node]] / c) * expectedValue(tree, tree.r[node])
  );
}

export function predictRaw(model: TreeModel, x: ArrayLike<number>): number {
  let sum = 0;
  for (const t of model.trees) {
    let n = 0;
    while (t.f[n] >= 0) n = x[t.f[n]] <= t.t[n] ? t.l[n] : t.r[n];
    sum += t.v[n];
  }
  return sum;
}

/** SHAP values in log-odds space. phi.length = #features; sum(phi) + bias = raw score. */
export function treeShap(model: TreeModel, x: ArrayLike<number>): { phi: Float64Array; bias: number } {
  const phi = new Float64Array(model.feature_names.length);
  let bias = 0;
  for (const tree of model.trees) {
    if (tree.f[0] < 0) {
      bias += tree.v[0];
      continue;
    }
    recurse(tree, x, phi, 0, [], 0, 1, 1, -1);
    bias += expectedValue(tree);
  }
  return { phi, bias };
}

export const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));
