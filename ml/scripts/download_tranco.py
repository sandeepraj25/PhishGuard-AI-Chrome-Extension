"""Download the Tranco top-sites list (legitimate domains).

Tranco: https://tranco-list.eu — research-oriented ranking, free to use (see docs/data_licenses.md).
Output: ml/data/raw/tranco_<date>.csv  (rank,domain)
Tranco lists bare domains, not URLs. clean_dedupe.py turns each into "https://<domain>/" and
WARNS that path-based features are then leaky (legit URLs have no path). See interview notes.
"""
from __future__ import annotations

import argparse
import datetime as dt
import io
import urllib.request
import zipfile

import _common  # noqa: F401
from phishguard_ml.paths import DATA

URL = "https://tranco-list.eu/top-1m.csv.zip"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--top", type=int, default=100_000, help="keep only the top N domains")
    args = ap.parse_args()
    out = DATA / "raw" / f"tranco_{dt.date.today().isoformat()}.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(URL, timeout=60) as resp:  # noqa: S310 (fixed https URL)
        blob = resp.read()
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        lines = zf.read("top-1m.csv").decode("utf-8").splitlines()[: args.top]
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {len(lines)} domains to {out}")


if __name__ == "__main__":
    main()
