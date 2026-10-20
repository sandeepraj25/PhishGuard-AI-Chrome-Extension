"""Dataset I/O helpers. Canonical processed file: ml/data/processed/urls.csv with columns
url, label (1 = phishing, 0 = legitimate), first_seen (ISO date), source, registered_domain,
domain_age_days, cert_age_days.
"""
from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path

from .paths import DATA

PROCESSED = DATA / "processed" / "urls.csv"
COLUMNS = ["url", "label", "first_seen", "source", "registered_domain", "domain_age_days", "cert_age_days"]


@dataclass
class UrlRecord:
    url: str
    label: int
    first_seen: str
    source: str
    registered_domain: str = ""
    domain_age_days: float = -1.0
    cert_age_days: float = -1.0


def write_records(path: Path, records: list[UrlRecord]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(COLUMNS)
        for r in records:
            w.writerow([r.url, r.label, r.first_seen, r.source, r.registered_domain, r.domain_age_days, r.cert_age_days])


def read_records(path: Path = PROCESSED) -> list[UrlRecord]:
    with path.open(newline="", encoding="utf-8") as fh:
        return [
            UrlRecord(row["url"], int(row["label"]), row["first_seen"], row["source"], row["registered_domain"],
                      float(row["domain_age_days"]), float(row["cert_age_days"]))
            for row in csv.DictReader(fh)
        ]


def dataset_kind(records: list[UrlRecord]) -> str:
    """'synthetic-sample' if any record came from the generator, else 'real'."""
    return "synthetic-sample" if any(r.source.startswith("synthetic") for r in records) else "real"
