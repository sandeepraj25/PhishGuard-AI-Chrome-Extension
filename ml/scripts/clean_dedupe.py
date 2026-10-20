"""Merge raw sources into ml/data/processed/urls.csv.

Steps (each one is a decision worth explaining in an interview):
1. Normalise: strip whitespace, drop URLs > 2048 bytes or with control characters,
   convert Unicode host labels to punycode (the extension only ever sees punycoded hosts).
2. De-duplicate by normalised URL, keeping the EARLIEST first_seen (needed for the time split
   and for lead-time measurement).
3. Label conflicts: if a registered domain appears in both classes we keep the phishing
   records and drop the legitimate ones for that domain (free-hosting / compromised sites).
4. Tranco gives bare domains -> "https://<domain>/". This makes path features leaky; the
   script prints a warning and training must be run with --host-only unless a legit URL source
   with real paths (e.g. Common Crawl) is added.
"""
from __future__ import annotations

import argparse
import csv
import glob
from pathlib import Path

import _common  # noqa: F401
from phishguard_ml.data import PROCESSED, UrlRecord, write_records
from phishguard_ml.features import default_engine
from phishguard_ml.paths import DATA


def to_ascii_host_url(url: str) -> str | None:
    url = url.strip()
    if not url or len(url.encode("utf-8")) > 2048 or any(ord(c) < 0x20 or ord(c) == 0x7F for c in url):
        return None
    if "://" not in url:
        url = "http://" + url
    scheme, rest = url.split("://", 1)
    cut = min([i for i in (rest.find("/"), rest.find("?"), rest.find("#")) if i != -1], default=len(rest))
    authority, tail = rest[:cut], rest[cut:]
    try:
        labels = []
        for label in authority.split("."):
            if label.isascii():
                labels.append(label.lower())
            else:
                labels.append("xn--" + label.lower().encode("punycode").decode("ascii"))
    except UnicodeError:
        return None
    return f"{scheme.lower()}://{'.'.join(labels)}{tail}"


def load_raw(raw: Path) -> list[UrlRecord]:
    recs: list[UrlRecord] = []
    for path in sorted(glob.glob(str(raw / "tranco_*.csv"))):
        date = Path(path).stem.split("_", 1)[1]
        for line in Path(path).read_text(encoding="utf-8").splitlines():
            if "," in line:
                recs.append(UrlRecord(f"https://{line.split(',', 1)[1].strip()}/", 0, date, "tranco"))
    for name in ("openphish", "phishtank"):
        p = raw / f"{name}.csv"
        if p.exists():
            with p.open(newline="", encoding="utf-8") as fh:
                for row in csv.DictReader(fh):
                    recs.append(UrlRecord(row["url"], 1, row["first_seen"][:10], name))
    return recs


def clean(records: list[UrlRecord]) -> list[UrlRecord]:
    eng = default_engine()
    best: dict[str, UrlRecord] = {}
    for r in records:
        u = to_ascii_host_url(r.url)
        if u is None:
            continue
        r.url = u
        r.registered_domain = eng.registered_domain(u)
        prev = best.get(u)
        if prev is None or r.first_seen < prev.first_seen or (r.label == 1 and prev.label == 0):
            best[u] = r
    phish_domains = {r.registered_domain for r in best.values() if r.label == 1}
    return [r for r in best.values() if r.label == 1 or r.registered_domain not in phish_domains]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", type=Path, default=DATA / "raw")
    ap.add_argument("--out", type=Path, default=PROCESSED)
    args = ap.parse_args()
    recs = clean(load_raw(args.raw))
    if any(r.source == "tranco" for r in recs):
        print("WARNING: legit URLs from Tranco have no paths -> train with --host-only (see interview notes)")
    write_records(args.out, sorted(recs, key=lambda r: (r.first_seen, r.url)))
    print(f"wrote {len(recs)} records to {args.out}")


if __name__ == "__main__":
    main()
