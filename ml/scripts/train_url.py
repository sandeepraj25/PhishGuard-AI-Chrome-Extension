"""Train the Layer-1 URL model (LightGBM), export ONNX + tree JSON, check size and ONNX agreement.

Usage: python ml/scripts/train_url.py [--host-only] [--data ml/data/processed/urls.csv]
Writes: ml/models/url_model.{txt,onnx}, ml/models/url_trees.json, copies both to
extension/public/models/, and ml/results/url_train.json.
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import numpy as np
import onnxruntime as ort

import _common  # noqa: F401
from phishguard_ml.data import PROCESSED, dataset_kind, read_records
from phishguard_ml.features import FEATURE_NAMES
from phishguard_ml.meta import git_commit, run_meta
from phishguard_ml.paths import EXTENSION_PUBLIC, MODELS, RESULTS
from phishguard_ml.split import assert_no_leakage, time_domain_split
from phishguard_ml.train import export_onnx, export_trees, featurize, train_lgbm


def try_quantize(src: Path) -> dict:
    """Dynamic quantisation only touches MatMul/Gemm weights; tree ensembles have none.
    We still run it and report sizes so the result is measured, not assumed."""
    from onnxruntime.quantization import QuantType, quantize_dynamic

    dst = src.with_name(src.stem + ".quant.onnx")
    try:
        quantize_dynamic(str(src), str(dst), weight_type=QuantType.QInt8)
        q = dst.stat().st_size
        dst.unlink()
        return {"attempted": True, "fp32_bytes": src.stat().st_size, "quantized_bytes": q,
                "note": "tree ensemble has no MatMul weights; quantisation does not shrink it"}
    except Exception as exc:  # noqa: BLE001 - report whatever the quantiser says
        return {"attempted": True, "error": str(exc)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, default=PROCESSED)
    ap.add_argument("--host-only", action="store_true", help="ignore path/query (use with Tranco legit data)")
    ap.add_argument("--out-dir", type=Path, default=MODELS)
    ap.add_argument("--no-install", action="store_true", help="do not copy into extension/public/models")
    args = ap.parse_args()

    records = read_records(args.data)
    split = time_domain_split(records)
    assert_no_leakage(split)
    Xtr, ytr = featurize(split.train, args.host_only)
    Xva, yva = featurize(split.val, args.host_only)
    booster = train_lgbm(Xtr, ytr, Xva, yva)

    out = args.out_dir
    out.mkdir(parents=True, exist_ok=True)
    booster.save_model(str(out / "url_model.txt"))
    onnx_bytes = export_onnx(booster, out / "url_model.onnx")
    trees_bytes = export_trees(booster, out / "url_trees.json")

    # Agreement: ONNX (float32, what ships) vs LightGBM (float64) on the validation set.
    sess = ort.InferenceSession(str(out / "url_model.onnx"), providers=["CPUExecutionProvider"])
    onnx_p = sess.run(None, {"input": Xva.astype(np.float32)})[1][:, 1]
    lgb_p = booster.predict(Xva)
    diff = np.abs(onnx_p - lgb_p)

    if not args.no_install:
        dst = EXTENSION_PUBLIC / "models"
        dst.mkdir(parents=True, exist_ok=True)
        shutil.copy(out / "url_model.onnx", dst / "url_model.onnx")
        shutil.copy(out / "url_trees.json", dst / "url_trees.json")
        manifest_path = dst / "manifest.json"
        manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
        manifest["url"] = {"version": f"url-{run_meta('', args.data, '')['generated_at'][:10]}-{git_commit()}",
                           "features": len(FEATURE_NAMES), "dataset": dataset_kind(records)}
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")

    gain = booster.feature_importance("gain")
    result = {
        **run_meta("ml/scripts/train_url.py", args.data, dataset_kind(records)),
        "host_only": args.host_only,
        "split": split.summary(),
        "best_iteration": booster.best_iteration,
        "num_trees": booster.num_trees(),
        "model_bytes": {"onnx": onnx_bytes, "trees_json": trees_bytes},
        "quantization": try_quantize(out / "url_model.onnx"),
        "onnx_vs_lightgbm": {"rows": int(len(diff)), "max_abs_diff": float(diff.max()),
                              "rows_diff_gt_1e-4": int((diff > 1e-4).sum())},
        "feature_importance_gain": {n: float(g) for n, g in sorted(zip(FEATURE_NAMES, gain), key=lambda x: -x[1])},
    }
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "url_train.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: result[k] for k in ("dataset", "best_iteration", "model_bytes", "onnx_vs_lightgbm")}, indent=1))


if __name__ == "__main__":
    main()
