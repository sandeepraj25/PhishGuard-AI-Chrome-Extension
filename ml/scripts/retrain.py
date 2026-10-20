"""Weekly retraining with a promotion gate.

1. Train a CANDIDATE URL model on the latest data (+ reviewed reports / regional labels via --extra)
   into ml/models/candidates/<timestamp>/ (nothing shipped yet).
2. Evaluate the candidate AND the current production model on the SAME, newest test split
   (comparing on different splits would be meaningless).
3. Promote only if recall at 0.1% FPR does not drop (and PR-AUC does not drop by more than
   --max-prauc-drop). Promotion copies the candidate into ml/models and extension/public/models.
4. Always write ml/results/retrain_latest.json (and a timestamped copy) with the decision.

Scheduled weekly by .github/workflows/retrain.yml; can also be run by hand.
Exit code: 0 promoted, 3 rejected (so CI can tell them apart), 1 error.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort

import _common  # noqa: F401
from phishguard_ml.data import PROCESSED, dataset_kind, read_records
from phishguard_ml.meta import run_meta
from phishguard_ml.metrics import summarize
from phishguard_ml.paths import EXTENSION_PUBLIC, ML, MODELS, RESULTS
from phishguard_ml.split import time_domain_split
from phishguard_ml.train import featurize


def evaluate(model: Path, X: np.ndarray, y: np.ndarray) -> dict:
    sess = ort.InferenceSession(str(model), providers=["CPUExecutionProvider"])
    scores = 100.0 * sess.run(None, {"input": X.astype(np.float32)})[1][:, 1]
    m = summarize(y, scores, [60.0])
    return {"pr_auc": m["pr_auc"], "recall_at_0.1pct_fpr": m["recall_at_0.1pct_fpr"]["recall"],
            "allowed_false_positives": m["recall_at_0.1pct_fpr"]["allowed_false_positives"]}


def gate(cand: dict, prod: dict | None, max_prauc_drop: float) -> tuple[bool, str]:
    if prod is None:
        return True, "no production model yet"
    if cand["recall_at_0.1pct_fpr"] < prod["recall_at_0.1pct_fpr"]:
        return False, (f"recall@0.1%FPR dropped {prod['recall_at_0.1pct_fpr']:.4f} -> "
                       f"{cand['recall_at_0.1pct_fpr']:.4f}")
    if cand["pr_auc"] < prod["pr_auc"] - max_prauc_drop:
        return False, f"PR-AUC dropped {prod['pr_auc']:.4f} -> {cand['pr_auc']:.4f}"
    return True, "candidate is at least as good on the newest test split"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, default=PROCESSED)
    ap.add_argument("--extra", type=Path, action="append", default=[])
    ap.add_argument("--host-only", action="store_true")
    ap.add_argument("--models-dir", type=Path, default=MODELS, help="where the production model lives")
    ap.add_argument("--install-dir", type=Path, default=EXTENSION_PUBLIC / "models")
    ap.add_argument("--results-dir", type=Path, default=RESULTS)
    ap.add_argument("--max-prauc-drop", type=float, default=0.005)
    ap.add_argument("--candidate-params", default="", help="JSON LightGBM overrides (testing the gate)")
    args = ap.parse_args()

    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    cand_dir = args.models_dir / "candidates" / stamp
    cmd = [sys.executable, str(ML / "scripts" / "train_url.py"), "--data", str(args.data), "--out-dir", str(cand_dir),
           "--no-install"] + [x for e in args.extra for x in ("--extra", str(e))] + (["--host-only"] if args.host_only else [])
    env_params = {"PHISHGUARD_LGB_OVERRIDES": args.candidate_params} if args.candidate_params else {}
    subprocess.run(cmd, check=True, env={**os.environ, **env_params}, capture_output=True)

    records = read_records(args.data)
    for e in args.extra:
        records += read_records(e)
    test = time_domain_split(records).test
    X, y = featurize(test, args.host_only)
    cand = evaluate(cand_dir / "url_model.onnx", X, y)
    prod_path = args.models_dir / "url_model.onnx"
    prod = evaluate(prod_path, X, y) if prod_path.exists() else None
    promote, why = gate(cand, prod, args.max_prauc_drop)

    if promote:
        for name in ("url_model.onnx", "url_trees.json", "url_model.txt"):
            shutil.copy(cand_dir / name, args.models_dir / name)
        args.install_dir.mkdir(parents=True, exist_ok=True)
        for name in ("url_model.onnx", "url_trees.json"):
            shutil.copy(cand_dir / name, args.install_dir / name)
    result = {**run_meta("ml/scripts/retrain.py", args.data, dataset_kind(records)), "candidate_dir": str(cand_dir),
              "test_rows": int(len(y)), "candidate": cand, "production": prod, "promoted": promote, "reason": why}
    args.results_dir.mkdir(parents=True, exist_ok=True)
    for name in ("retrain_latest.json", f"retrain_{stamp}.json"):
        (args.results_dir / name).write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"promoted": promote, "reason": why, "candidate": cand, "production": prod}))
    return 0 if promote else 3


if __name__ == "__main__":
    sys.exit(main())
