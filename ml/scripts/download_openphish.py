"""Fetch the OpenPhish community feed and append new URLs with first_seen = now (UTC).

Community feed terms: free for NON-COMMERCIAL use only (see docs/data_licenses.md).
Commercial use needs a paid OpenPhish licence -> controlled by OPENPHISH_FEED_URL in .env.
Output: ml/data/raw/openphish.csv (url,first_seen) — appended, de-duplicated by URL.
"""
from __future__ import annotations

import csv
import datetime as dt
import os
import urllib.request

import _common  # noqa: F401
from phishguard_ml.paths import DATA

DEFAULT_URL = "https://openphish.com/feed.txt"


def main() -> None:
    url = os.environ.get("OPENPHISH_FEED_URL", DEFAULT_URL)
    out = DATA / "raw" / "openphish.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    seen: set[str] = set()
    if out.exists():
        with out.open(newline="", encoding="utf-8") as fh:
            seen = {row["url"] for row in csv.DictReader(fh)}
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    with urllib.request.urlopen(url, timeout=60) as resp:  # noqa: S310
        lines = [ln.strip() for ln in resp.read().decode("utf-8", "replace").splitlines() if ln.strip()]
    new = [ln for ln in lines if ln not in seen]
    write_header = not out.exists()
    with out.open("a", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        if write_header:
            w.writerow(["url", "first_seen"])
        for ln in new:
            w.writerow([ln, now])
    print(f"{len(lines)} in feed, {len(new)} new -> {out}")


if __name__ == "__main__":
    main()
