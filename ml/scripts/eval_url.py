"""Evaluate the Layer-1 URL model on the held-out (newer, domain-disjoint) test split.

Reports precision/recall at the extension's score bands (>30 caution, >60 warning), PR-AUC,
recall at 0.1% and 1% FPR — for (a) the rules-only baseline, (b) the ONNX model as shipped,
(c) the shipped combined score (model + hard-rule floors).
Writes ml/results/url_eval.json. Usage: python ml/scripts/eval_url.py [--host-only]
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort

import _common  # noqa: F401
from phishguard_ml.data import PROCESSED, dataset_kind, read_records
from phishguard_ml.meta import run_meta
from phishguard_ml.metrics import summarize
from phishguard_ml.paths import MODELS, RESULTS
from phishguard_ml.rules import combined_score, rules_score
from phishguard_ml.split import assert_no_leakage, time_domain_split
from phishguard_ml.train import featurize

THRESHOLDS = [30.0, 60.0]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, default=PROCESSED)
    ap.add_argument("--model", type=Path, default=MODELS / "url_model.onnx")
    ap.add_argument("--host-only", action="store_true")
    ap.add_argument("--out", type=Path, default=RESULTS / "url_eval.json")
    args = ap.parse_args()

    records = read_records(args.data)
    split = time_domain_split(records)
    assert_no_leakage(split)
    X, y = featurize(split.test, args.host_only)

    sess = ort.InferenceSession(str(args.model), providers=["CPUExecutionProvider"])
    prob = sess.run(None, {"input": X.astype(np.float32)})[1][:, 1]
    model_scores = 100.0 * prob
    baseline = np.array([rules_score(list(row)) for row in X])
    combined = np.array([combined_score(float(p), list(row)) for p, row in zip(prob, X)])

    result = {
        **run_meta("ml/scripts/eval_url.py", args.data, dataset_kind(records)),
        "warning": ("Synthetic sample data: these numbers measure the pipeline, not real-world accuracy."
                    if dataset_kind(records) == "synthetic-sample" else ""),
        "host_only": args.host_only,
        "test_split": split.summary()["test"],
        "rules_baseline": summarize(y, baseline, THRESHOLDS),
        "model_onnx": summarize(y, model_scores, THRESHOLDS),
        "combined_shipped": summarize(y, combined, THRESHOLDS),
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    for name in ("rules_baseline", "model_onnx", "combined_shipped"):
        r = result[name]
        print(f"{name:18s} PR-AUC={r['pr_auc']:.4f}  recall@0.1%FPR={r['recall_at_0.1pct_fpr']['recall']:.4f} "
              f"(allowed FP={r['recall_at_0.1pct_fpr']['allowed_false_positives']})  "
              f">60: P={r['at_threshold']['60.0']['precision']:.3f} R={r['at_threshold']['60.0']['recall']:.3f}")


if __name__ == "__main__":
    main()
