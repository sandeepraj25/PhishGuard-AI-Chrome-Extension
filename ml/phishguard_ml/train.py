"""Featurise, train LightGBM, export ONNX + tree JSON (for TreeSHAP in the extension)."""
from __future__ import annotations

import json
from pathlib import Path

import lightgbm as lgb
import numpy as np

from .data import UrlRecord
from .features import FEATURE_NAMES, default_engine
from .urlparse import parse_url

LGB_PARAMS = {
    "objective": "binary",
    "learning_rate": 0.05,
    "num_leaves": 31,
    "min_data_in_leaf": 20,
    "feature_fraction": 0.9,
    "bagging_fraction": 0.9,
    "bagging_freq": 1,
    "lambda_l2": 1.0,
    "verbose": -1,
    "seed": 42,
    "deterministic": True,
    "num_threads": 1,
}


def host_only_url(url: str) -> str:
    """Drop path/query so legit-without-path data (Tranco) cannot leak through path features."""
    u = parse_url(url)
    scheme = u.scheme or "http"
    port = f":{u.port}" if u.port else ""
    return f"{scheme}://{u.host}{port}/"


def featurize(records: list[UrlRecord], host_only: bool = False) -> tuple[np.ndarray, np.ndarray]:
    eng = default_engine()
    X = np.zeros((len(records), len(FEATURE_NAMES)), dtype=np.float64)
    y = np.zeros(len(records), dtype=np.int32)
    for i, r in enumerate(records):
        url = host_only_url(r.url) if host_only else r.url
        f, _ = eng.extract(url, r.domain_age_days, r.cert_age_days)
        X[i] = f
        y[i] = r.label
    return X, y


def train_lgbm(Xtr: np.ndarray, ytr: np.ndarray, Xva: np.ndarray, yva: np.ndarray,
               rounds: int = 600, params: dict | None = None) -> lgb.Booster:
    p = dict(LGB_PARAMS, **(params or {}))
    dtr = lgb.Dataset(Xtr, ytr, feature_name=FEATURE_NAMES, free_raw_data=False)
    dva = lgb.Dataset(Xva, yva, reference=dtr)
    return lgb.train(p, dtr, num_boost_round=rounds, valid_sets=[dva],
                     callbacks=[lgb.early_stopping(50, verbose=False), lgb.log_evaluation(0)])


def export_onnx(booster: lgb.Booster, path: Path) -> int:
    """Convert to ONNX (ai.onnx.ml TreeEnsembleClassifier). Output 'probabilities' [N,2]."""
    import onnx
    import onnxmltools
    from onnxmltools.convert.common.data_types import FloatTensorType

    model = onnxmltools.convert_lightgbm(booster, initial_types=[("input", FloatTensorType([None, len(FEATURE_NAMES)]))],
                                         zipmap=False, target_opset=15)
    # The converter fixes the batch dimension of the 'label' output to 1; make it symbolic so
    # ONNX Runtime does not warn (or fail, on stricter backends) for batches > 1.
    for out in model.graph.output:
        dims = out.type.tensor_type.shape.dim
        if dims:
            dims[0].ClearField("dim_value")
            dims[0].dim_param = "N"
    model.doc_string = "PhishGuard URL model (LightGBM). Input: float32[N,26] per shared/feature_spec.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    onnx.save(model, str(path))
    return path.stat().st_size


def export_trees(booster: lgb.Booster, path: Path) -> int:
    """Flatten LightGBM trees into compact arrays for TreeSHAP in TypeScript.

    Per tree: f (split feature, -1 for leaf), t (threshold), l/r (children), v (leaf value),
    c (cover = number of training rows reaching the node). Decision: x <= t goes left.
    """
    dump = booster.dump_model()
    trees = []
    for info in dump["tree_info"]:
        f: list[int] = []
        t: list[float] = []
        l: list[int] = []
        r: list[int] = []
        v: list[float] = []
        c: list[int] = []

        def walk(node: dict) -> int:
            idx = len(f)
            f.append(-1); t.append(0.0); l.append(-1); r.append(-1); v.append(0.0); c.append(0)
            if "split_index" in node:
                if node.get("decision_type", "<=") != "<=":
                    raise ValueError("only numeric <= splits are supported")
                f[idx] = node["split_feature"]
                t[idx] = node["threshold"]
                c[idx] = node["internal_count"]
                l[idx] = walk(node["left_child"])
                r[idx] = walk(node["right_child"])
            else:
                v[idx] = node["leaf_value"]
                c[idx] = node.get("leaf_count", 0)
            return idx

        walk(info["tree_structure"])
        trees.append({"f": f, "t": t, "l": l, "r": r, "v": v, "c": c})
    doc = {"version": 1, "feature_names": FEATURE_NAMES, "objective": "binary", "trees": trees}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
    return path.stat().st_size
