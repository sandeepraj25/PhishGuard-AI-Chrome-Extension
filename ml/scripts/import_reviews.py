"""Turn the admin review-queue export into training rows.

  curl -H "authorization: Bearer $ADMIN_TOKEN" "$API/v1/admin/reports/export?status=confirmed" > reviews.csv
  python ml/scripts/import_reviews.py reviews.csv          # -> ml/data/extra/reviewed_reports.csv
  python ml/scripts/train_url.py --extra ml/data/extra/reviewed_reports.csv

Only CONFIRMED reports (a human set reviewer label 0/1) are imported. Reports carry only the
registered domain, so rows are host-only URLs ("https://<domain>/"); train with --host-only or
keep them as a small, separately-weighted slice.
"""
from __future__ import annotations

import argparse
import csv
from pathlib import Path

import _common  # noqa: F401
from phishguard_ml.data import UrlRecord, write_records
from phishguard_ml.paths import DATA


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("export_csv", type=Path)
    ap.add_argument("--out", type=Path, default=DATA / "extra" / "reviewed_reports.csv")
    args = ap.parse_args()
    recs: dict[str, UrlRecord] = {}
    with args.export_csv.open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            if row["label"] not in ("0", "1"):
                continue
            d = row["registered_domain"].strip().lower()
            recs[d] = UrlRecord(f"https://{d}/", int(row["label"]), row["reported_at"][:10], "user-report", d)
    write_records(args.out, sorted(recs.values(), key=lambda r: (r.first_seen, r.url)))
    print(f"imported {len(recs)} reviewed reports -> {args.out}")


if __name__ == "__main__":
    main()
