"""Page-model dataset helpers. Features are computed by the extension's TypeScript code
(extension/scripts/page_features.ts) so training and inference share one implementation."""
from __future__ import annotations

import csv
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .paths import SHARED

PAGE_FEATURE_NAMES: list[str] = [f["name"] for f in json.loads(
    (SHARED / "page_feature_spec.json").read_text(encoding="utf-8"))["page_features"]]


@dataclass
class PageRecord:
    url: str
    label: int
    first_seen: str
    source: str
    registered_domain: str
    features: list[float]


def read_page_features(path: Path) -> list[PageRecord]:
    with path.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        missing = [n for n in PAGE_FEATURE_NAMES if n not in (reader.fieldnames or [])]
        if missing:
            raise ValueError(f"feature CSV is missing columns {missing} — re-run page_features.ts")
        return [PageRecord(r["url"], int(r["label"]), r["first_seen"], r["source"], r["registered_domain"],
                           [float(r[n]) for n in PAGE_FEATURE_NAMES]) for r in reader]


def matrix(records: list[PageRecord]) -> tuple[np.ndarray, np.ndarray]:
    return (np.array([r.features for r in records], dtype=np.float64),
            np.array([r.label for r in records], dtype=np.int32))
