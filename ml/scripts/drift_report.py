"""Model score drift report (Population Stability Index).

Compares the URL model's score distribution and every feature's distribution between a
REFERENCE window (the training split) and a CURRENT window (newest data, default: rows first seen
in the last --days days of the dataset, or a separate --current CSV in the processed format).

PSI = sum over bins of (cur% - ref%) * ln(cur% / ref%), bins = deciles of the reference.
Rule of thumb: < 0.1 stable, 0.1-0.25 watch, > 0.25 investigate / retrain.
Writes ml/results/drift.json. Only aggregate distributions are used — no per-user data.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort

import _common  # noqa: F401
from phishguard_ml.data import PROCESSED, dataset_kind, read_records
from phishguard_ml.features import FEATURE_NAMES
from phishguard_ml.meta import run_meta
from phishguard_ml.paths import MODELS, RESULTS
from phishguard_ml.split import time_domain_split
from phishguard_ml.train import featurize

EPS = 1e-4


def psi(ref: np.ndarray, cur: np.ndarray, bins: int = 10) -> float:
    edges = np.unique(np.quantile(ref, np.linspace(0, 1, bins + 1)))
    if len(edges) < 2:  # constant feature in the reference window
        return float(0.0 if np.all(cur == ref[0]) else 1.0)
    edges[0], edges[-1] = -np.inf, np.inf
    r = np.histogram(ref, edges)[0] / len(ref)
    c = np.histogram(cur, edges)[0] / max(1, len(cur))
    r, c = np.clip(r, EPS, None), np.clip(c, EPS, None)
    return float(np.sum((c - r) * np.log(c / r)))


def status(v: float) -> str:
    return "stable" if v < 0.1 else ("watch" if v < 0.25 else "investigate")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, default=PROCESSED)
    ap.add_argument("--current", type=Path, default=None)
    ap.add_argument("--days", type=int, default=30)
    args = ap.parse_args()
    records = read_records(args.data)
    ref = time_domain_split(records).train
    if args.current:
        cur = read_records(args.current)
    else:
        last = max(dt.date.fromisoformat(r.first_seen[:10]) for r in records)
        cutoff = (last - dt.timedelta(days=args.days)).isoformat()
        cur = [r for r in records if r.first_seen >= cutoff]
    Xr, _ = featurize(ref)
    Xc, _ = featurize(cur)
    sess = ort.InferenceSession(str(MODELS / "url_model.onnx"), providers=["CPUExecutionProvider"])
    sr = sess.run(None, {"input": Xr.astype(np.float32)})[1][:, 1]
    sc = sess.run(None, {"input": Xc.astype(np.float32)})[1][:, 1]
    feats = {n: psi(Xr[:, i], Xc[:, i]) for i, n in enumerate(FEATURE_NAMES)}
    score_psi = psi(sr, sc)
    top = sorted(feats.items(), key=lambda kv: -kv[1])[:5]
    result = {**run_meta("ml/scripts/drift_report.py", args.data, dataset_kind(records)),
              "reference_rows": len(ref), "current_rows": len(cur),
              "score_psi": score_psi, "score_status": status(score_psi),
              "flagged_share_reference": float(np.mean(sr > 0.6)), "flagged_share_current": float(np.mean(sc > 0.6)),
              "feature_psi": feats, "top_drifting_features": [{"feature": k, "psi": v, "status": status(v)} for k, v in top],
              "summary_line": (f"score PSI {score_psi:.3f} ({status(score_psi)}) between the training window "
                               f"({len(ref)} URLs) and the newest {args.days} days ({len(cur)} URLs); most drifted "
                               f"feature: {top[0][0]} (PSI {top[0][1]:.3f}).")}
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "drift.json").write_text(json.dumps(result, indent=2) + "\n")
    print(result["summary_line"])


if __name__ == "__main__":
    main()
