"""Train the Layer-2 page model on features from extension/scripts/page_features.ts.

Usage:
  python ml/scripts/make_sample_pages.py                          # or crawler + labeling CLI output
  (cd extension && npx tsx scripts/page_features.ts ../ml/data/pages/pages.jsonl ../ml/data/pages/page_features.csv)
  python ml/scripts/train_page.py
Writes ml/models/page_model.{txt,onnx}, page_trees.json (copied to extension/public/models) and
ml/results/page_train.json.
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import numpy as np
import onnxruntime as ort

import _common  # noqa: F401
from phishguard_ml.meta import git_commit, run_meta
from phishguard_ml.pages import PAGE_FEATURE_NAMES, matrix, read_page_features
from phishguard_ml.paths import DATA, EXTENSION_PUBLIC, MODELS, RESULTS
from phishguard_ml.split import assert_no_leakage, time_domain_split
from phishguard_ml.train import export_onnx, export_trees, train_lgbm

DEFAULT = DATA / "pages" / "page_features.csv"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, default=DEFAULT)
    args = ap.parse_args()
    recs = read_page_features(args.data)
    split = time_domain_split(recs)
    assert_no_leakage(split)
    Xtr, ytr = matrix(split.train)
    Xva, yva = matrix(split.val)
    booster = train_lgbm(Xtr, ytr, Xva, yva, rounds=300, params={"min_data_in_leaf": 10},
                         feature_names=PAGE_FEATURE_NAMES)
    MODELS.mkdir(parents=True, exist_ok=True)
    booster.save_model(str(MODELS / "page_model.txt"))
    onnx_bytes = export_onnx(booster, MODELS / "page_model.onnx", PAGE_FEATURE_NAMES)
    trees_bytes = export_trees(booster, MODELS / "page_trees.json", PAGE_FEATURE_NAMES)
    sess = ort.InferenceSession(str(MODELS / "page_model.onnx"), providers=["CPUExecutionProvider"])
    diff = np.abs(sess.run(None, {"input": Xva.astype(np.float32)})[1][:, 1] - booster.predict(Xva))

    dst = EXTENSION_PUBLIC / "models"
    dst.mkdir(parents=True, exist_ok=True)
    shutil.copy(MODELS / "page_model.onnx", dst / "page_model.onnx")
    shutil.copy(MODELS / "page_trees.json", dst / "page_trees.json")
    kind = "synthetic-sample" if any(r.source.startswith("synthetic") for r in recs) else "real"
    manifest_path = dst / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    meta = run_meta("ml/scripts/train_page.py", args.data, kind)
    manifest["page"] = {"version": f"page-{meta['generated_at'][:10]}-{git_commit()}",
                        "features": len(PAGE_FEATURE_NAMES), "dataset": kind}
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    result = {**meta, "split": split.summary(), "best_iteration": booster.best_iteration,
              "num_trees": booster.num_trees(), "model_bytes": {"onnx": onnx_bytes, "trees_json": trees_bytes},
              "onnx_vs_lightgbm": {"max_abs_diff": float(diff.max()), "rows": int(len(diff))},
              "feature_importance_gain": dict(sorted(zip(PAGE_FEATURE_NAMES, map(float, booster.feature_importance("gain"))),
                                                     key=lambda x: -x[1]))}
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "page_train.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({k: result[k] for k in ("dataset", "best_iteration", "model_bytes", "onnx_vs_lightgbm")}))


if __name__ == "__main__":
    main()
