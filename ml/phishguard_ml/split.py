"""Train/validation/test split by TIME and by REGISTERED DOMAIN.

Why both:
* Time: the model will see tomorrow's phishing, so test on data newer than training data.
  A random split lets the model "see the future" (same campaign in train and test).
* Domain: phishing campaigns reuse one domain for many URLs. If example-kyc.xyz/a is in
  train and example-kyc.xyz/b in test, the model memorises the domain -> inflated recall.

Algorithm:
1. Each registered domain gets the date of its EARLIEST record.
2. Domains are ordered by that date; the newest `test_frac` of domains (by row count) -> test,
   the next newest `val_frac` -> validation, the rest -> train. A domain lives in exactly one split.
3. Result: every test domain was first seen after every train domain (no domain leakage, no
   time leakage). Rows of a domain can still span time, which matches deployment.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from .data import UrlRecord


@dataclass
class Split:
    train: list[UrlRecord]
    val: list[UrlRecord]
    test: list[UrlRecord]
    train_end: str
    test_start: str

    def summary(self) -> dict:
        def stats(rs: list[UrlRecord]) -> dict:
            return {"rows": len(rs), "phishing": sum(r.label for r in rs),
                    "domains": len({r.registered_domain for r in rs}),
                    "first_seen_min": min((r.first_seen for r in rs), default=""),
                    "first_seen_max": max((r.first_seen for r in rs), default="")}
        return {"train": stats(self.train), "val": stats(self.val), "test": stats(self.test),
                "method": "grouped-by-registered-domain + time-ordered (domain first_seen)"}


def time_domain_split(records: list[UrlRecord], val_frac: float = 0.15, test_frac: float = 0.2) -> Split:
    by_domain: dict[str, list[UrlRecord]] = defaultdict(list)
    for r in records:
        by_domain[r.registered_domain].append(r)
    order = sorted(by_domain, key=lambda d: (min(r.first_seen for r in by_domain[d]), d))
    total = len(records)
    test_rows = val_rows = 0
    test_d: list[str] = []
    val_d: list[str] = []
    i = len(order) - 1
    while i >= 0 and test_rows < test_frac * total:
        test_d.append(order[i])
        test_rows += len(by_domain[order[i]])
        i -= 1
    while i >= 0 and val_rows < val_frac * total:
        val_d.append(order[i])
        val_rows += len(by_domain[order[i]])
        i -= 1
    train_d = order[: i + 1]
    pick = lambda ds: [r for d in ds for r in by_domain[d]]
    train, val, test = pick(train_d), pick(val_d), pick(test_d)
    first = lambda d: min(r.first_seen for r in by_domain[d])
    return Split(train, val, test, train_end=first(train_d[-1]) if train_d else "",
                 test_start=first(test_d[-1]) if test_d else "")


def assert_no_leakage(s: Split) -> None:
    tr = {r.registered_domain for r in s.train}
    va = {r.registered_domain for r in s.val}
    te = {r.registered_domain for r in s.test}
    if tr & te or tr & va or va & te:
        raise AssertionError("registered domain appears in more than one split")
