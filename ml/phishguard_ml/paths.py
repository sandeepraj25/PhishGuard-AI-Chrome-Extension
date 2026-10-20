from __future__ import annotations

from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SHARED = REPO / "shared"
ML = REPO / "ml"
DATA = ML / "data"
MODELS = ML / "models"
RESULTS = ML / "results"
EXTENSION_PUBLIC = REPO / "extension" / "public"
