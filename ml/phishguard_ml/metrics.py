"""Evaluation metrics. All functions are deterministic and take plain numpy arrays."""
from __future__ import annotations

import numpy as np
from sklearn.metrics import average_precision_score, precision_score, recall_score


def recall_at_fpr(y: np.ndarray, scores: np.ndarray, fpr: float) -> dict:
    """Recall when the threshold is set so that at most `fpr` of legitimate rows are flagged.

    A row is flagged when score > threshold (strict), so ties never add false positives.
    With n_neg negatives only floor(fpr * n_neg) false positives are allowed; for small test
    sets this is very few, so we report that number too (it says how noisy the estimate is).
    """
    neg = np.sort(scores[y == 0])[::-1]
    pos = scores[y == 1]
    allowed = int(np.floor(fpr * len(neg)))
    threshold = float(neg[allowed]) if allowed < len(neg) else float("-inf")
    return {"fpr_target": fpr, "threshold": threshold, "allowed_false_positives": allowed,
            "negatives": int(len(neg)), "actual_fpr": float(np.mean(neg > threshold)) if len(neg) else 0.0,
            "recall": float(np.mean(pos > threshold)) if len(pos) else 0.0}


def summarize(y: np.ndarray, scores: np.ndarray, thresholds: list[float]) -> dict:
    """scores are 0-100 risk scores."""
    at_threshold: dict[str, dict[str, float]] = {}
    out = {"pr_auc": float(average_precision_score(y, scores)),
           "recall_at_0.1pct_fpr": recall_at_fpr(y, scores, 0.001),
           "recall_at_1pct_fpr": recall_at_fpr(y, scores, 0.01),
           "at_threshold": at_threshold}
    for t in thresholds:
        pred = (scores > t).astype(int)
        at_threshold[str(t)] = {
            "precision": float(precision_score(y, pred, zero_division=0)),
            "recall": float(recall_score(y, pred, zero_division=0)),
            "fpr": float(np.mean(pred[y == 0])) if np.any(y == 0) else 0.0,
        }
    return out
