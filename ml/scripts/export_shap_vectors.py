"""Export LightGBM pred_contrib test vectors so the TypeScript TreeSHAP can be checked
against the reference implementation. Output: extension/tests/fixtures/shap_vectors.json
"""
from __future__ import annotations

import json
import random

import lightgbm as lgb

import _common  # noqa: F401
from phishguard_ml.data import read_records
from phishguard_ml.paths import MODELS, REPO
from phishguard_ml.rules import hard_rule_floor, rules_score
from phishguard_ml.train import featurize


def main() -> None:
    booster = lgb.Booster(model_file=str(MODELS / "url_model.txt"))
    recs = read_records()
    random.Random(3).shuffle(recs)
    rows = recs[:60] + [r for r in recs if r.label == 1][:20] + [r for r in recs if r.domain_age_days >= 0][:20]
    X, _ = featurize(rows)
    contrib = booster.predict(X, pred_contrib=True)
    raw = booster.predict(X, raw_score=True)
    out = {"x": X.tolist(), "contrib": contrib.tolist(), "raw": raw.tolist(),
           "rules": [rules_score(list(r)) for r in X], "floor": [hard_rule_floor(list(r)) for r in X]}
    path = REPO / "extension/tests/fixtures/shap_vectors.json"
    path.write_text(json.dumps(out), encoding="utf-8")
    print(f"wrote {len(rows)} vectors to {path}")


if __name__ == "__main__":
    main()
