import numpy as np

from phishguard_ml.data import UrlRecord
from phishguard_ml.metrics import recall_at_fpr
from phishguard_ml.rules import combined_score, hard_rule_floor, rules_score
from phishguard_ml.features import default_engine
from phishguard_ml.split import assert_no_leakage, time_domain_split


def _recs():
    out = []
    for d in range(50):
        for k in range(3):
            out.append(UrlRecord(f"https://site{d}.com/p{k}", d % 2, f"2025-{1 + d % 12:02d}-{1 + k:02d}", "t",
                                 f"site{d}.com"))
    return out


def test_split_is_domain_disjoint_and_time_ordered():
    s = time_domain_split(_recs(), val_frac=0.2, test_frac=0.2)
    assert_no_leakage(s)
    first = lambda rs: {r.registered_domain: min(x.first_seen for x in rs if x.registered_domain == r.registered_domain)
                        for r in rs}
    assert max(first(s.train).values()) <= min(first(s.test).values())
    assert len(s.train) + len(s.val) + len(s.test) == 150


def test_recall_at_fpr_strict_threshold():
    y = np.array([0] * 1000 + [1] * 10)
    scores = np.concatenate([np.arange(1000) / 10.0, np.full(10, 99.95)])
    r = recall_at_fpr(y, scores, 0.001)
    assert r["allowed_false_positives"] == 1
    assert r["actual_fpr"] <= 0.001
    assert r["recall"] == 1.0


def test_rules_and_floor():
    e = default_engine()
    f, _ = e.extract("https://xn--exmplebank-0qi.com/login")
    assert hard_rule_floor(f) == 75.0
    assert combined_score(0.01, f) == 75.0
    clean, _ = e.extract("https://www.examplebank.test/")
    assert rules_score(clean) == 0.0
