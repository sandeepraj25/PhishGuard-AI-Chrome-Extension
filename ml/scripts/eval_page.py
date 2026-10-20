"""Evaluate the Layer-2 page model on the newer, domain-disjoint test split.
Writes ml/results/page_eval.json (with a one-line summary for the README)."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort

import _common  # noqa: F401
from phishguard_ml.meta import run_meta
from phishguard_ml.metrics import summarize
from phishguard_ml.pages import matrix, read_page_features
from phishguard_ml.paths import DATA, MODELS, RESULTS
from phishguard_ml.split import assert_no_leakage, time_domain_split


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, default=DATA / "pages" / "page_features.csv")
    args = ap.parse_args()
    recs = read_page_features(args.data)
    split = time_domain_split(recs)
    assert_no_leakage(split)
    X, y = matrix(split.test)
    sess = ort.InferenceSession(str(MODELS / "page_model.onnx"), providers=["CPUExecutionProvider"])
    scores = 100.0 * sess.run(None, {"input": X.astype(np.float32)})[1][:, 1]
    m = summarize(y, scores, [30.0, 60.0])
    kind = "synthetic-sample" if any(r.source.startswith("synthetic") for r in recs) else "real"
    r01 = m["recall_at_0.1pct_fpr"]
    result = {**run_meta("ml/scripts/eval_page.py", args.data, kind), "test_split": split.summary()["test"],
              "model_onnx": m,
              "summary_line": (f"PR-AUC {m['pr_auc']:.3f}, recall@0.1%FPR {100 * r01['recall']:.1f}% "
                               f"(≤{r01['allowed_false_positives']} FP of {r01['negatives']}) on {len(y)} {kind} pages.")}
    (RESULTS / "page_eval.json").write_text(json.dumps(result, indent=2) + "\n")
    print(result["summary_line"])


if __name__ == "__main__":
    main()
