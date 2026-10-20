"""Download the PhishTank verified-online dump (JSON) using your application key.

Requires PHISHTANK_APP_KEY in the environment (.env). PhishTank terms: see docs/data_licenses.md
(registration required; redistribution and commercial use restricted — check before shipping).
Output: ml/data/raw/phishtank.csv (url,first_seen) using `submission_time` as first_seen.
"""
from __future__ import annotations

import csv
import json
import os
import sys
import urllib.request

import _common  # noqa: F401
from phishguard_ml.paths import DATA


def main() -> None:
    key = os.environ.get("PHISHTANK_APP_KEY")
    if not key:
        sys.exit("PHISHTANK_APP_KEY is not set (see .env.example and docs/HUMAN_TODO.md)")
    url = f"https://data.phishtank.com/data/{key}/online-valid.json"
    req = urllib.request.Request(url, headers={"User-Agent": "phishtank/phishguard-research"})
    with urllib.request.urlopen(req, timeout=120) as resp:  # noqa: S310
        entries = json.loads(resp.read())
    out = DATA / "raw" / "phishtank.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["url", "first_seen"])
        for e in entries:
            w.writerow([e["url"], e["submission_time"]])
    print(f"wrote {len(entries)} URLs to {out}")


if __name__ == "__main__":
    main()
