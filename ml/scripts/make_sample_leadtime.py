"""SYNTHETIC lead-time sample in the same CSV format as the backend export
(GET /v1/admin/leadtime.csv): domain, our_first_seen, feed, feed_first_seen.
Only for exercising eval_leadtime.py — not a measurement of anything."""
from __future__ import annotations

import csv
import datetime as dt
import random

import _common  # noqa: F401
from phishguard_ml.paths import DATA


def main() -> None:
    r = random.Random(5)
    out = DATA / "leadtime" / "leadtime_sample.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    t0 = dt.datetime(2026, 9, 1, tzinfo=dt.timezone.utc)
    with out.open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["domain", "our_first_seen", "feed", "feed_first_seen"])
        for i in range(400):
            ours = t0 + dt.timedelta(minutes=r.randint(0, 30 * 24 * 60))
            for feed in ("openphish-community", "phishtank"):
                if r.random() < 0.35:
                    continue  # this feed never listed it
                # Most CT detections precede feeds by hours; some feeds are faster than us.
                delta_h = r.lognormvariate(1.8, 1.0) if r.random() < 0.8 else -r.lognormvariate(0.5, 1.0)
                w.writerow([f"sample{i}.test", ours.isoformat(), feed, (ours + dt.timedelta(hours=delta_h)).isoformat()])
            if r.random() < 0.15:
                w.writerow([f"unseen{i}.test", ours.isoformat(), "", ""])
    print(f"wrote synthetic lead-time sample to {out}")


if __name__ == "__main__":
    main()
