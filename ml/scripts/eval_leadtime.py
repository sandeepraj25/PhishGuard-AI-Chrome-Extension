"""Lead time: how many hours BEFORE public feeds did our system (CT discovery) see a domain?

Input: CSV from the backend (GET /v1/admin/leadtime.csv) or the synthetic sample:
  domain, our_first_seen, feed, feed_first_seen      (feed empty = never listed by any feed)
For each domain we compare our first_seen with the EARLIEST feed appearance (and per feed).
Positive hours = we were earlier. Writes ml/results/leadtime.json.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
from collections import defaultdict
from pathlib import Path

import numpy as np

import _common  # noqa: F401
from phishguard_ml.meta import run_meta
from phishguard_ml.paths import DATA, RESULTS


def parse(ts: str) -> dt.datetime:
    return dt.datetime.fromisoformat(ts.replace("Z", "+00:00"))


def stats(hours: list[float]) -> dict:
    if not hours:
        return {"n": 0}
    a = np.array(hours)
    return {"n": int(len(a)), "median_hours_ahead": float(np.median(a)), "p25": float(np.percentile(a, 25)),
            "p75": float(np.percentile(a, 75)), "p90": float(np.percentile(a, 90)),
            "fraction_before_feed": float(np.mean(a > 0))}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, default=DATA / "leadtime" / "leadtime_sample.csv")
    args = ap.parse_args()
    ours: dict[str, dt.datetime] = {}
    feeds: dict[str, dict[str, dt.datetime]] = defaultdict(dict)
    with args.data.open(newline="") as fh:
        for row in csv.DictReader(fh):
            ours[row["domain"]] = parse(row["our_first_seen"])
            if row["feed"]:
                feeds[row["domain"]][row["feed"]] = parse(row["feed_first_seen"])
    earliest = [(ours[d] , min(f.values())) for d, f in feeds.items() if f]
    overall = [(feed_t - our_t).total_seconds() / 3600 for our_t, feed_t in earliest]
    per_feed: dict[str, list[float]] = defaultdict(list)
    for d, f in feeds.items():
        for name, t in f.items():
            per_feed[name].append((t - ours[d]).total_seconds() / 3600)
    kind = "synthetic-sample" if "sample" in args.data.name else "real"
    s = stats(overall)
    result = {**run_meta("ml/scripts/eval_leadtime.py", args.data, kind),
              "domains_seen_by_us": len(ours), "domains_also_in_feeds": len(earliest),
              "never_in_feeds": len(ours) - len(earliest), "vs_earliest_feed": s,
              "per_feed": {k: stats(v) for k, v in sorted(per_feed.items())}}
    result["summary_line"] = (
        f"median {s.get('median_hours_ahead', float('nan')):.1f} h ahead of the earliest public feed "
        f"(p25 {s.get('p25', float('nan')):.1f} h, p90 {s.get('p90', float('nan')):.1f} h); "
        f"{100 * s.get('fraction_before_feed', 0):.0f}% of {s['n']} domains seen before any feed ({kind}).")
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "leadtime.json").write_text(json.dumps(result, indent=2) + "\n")
    print(result["summary_line"])


if __name__ == "__main__":
    main()
