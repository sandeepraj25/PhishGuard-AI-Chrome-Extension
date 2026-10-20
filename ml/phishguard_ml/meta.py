"""Run metadata attached to every result JSON so numbers are traceable to code + data."""
from __future__ import annotations

import datetime as dt
import hashlib
import subprocess
from pathlib import Path

from .paths import REPO


def git_commit() -> str:
    try:
        out = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=REPO, capture_output=True, text=True, check=True)
        dirty = subprocess.run(["git", "status", "--porcelain"], cwd=REPO, capture_output=True, text=True).stdout.strip()
        return out.stdout.strip() + ("-dirty" if dirty else "")
    except (subprocess.CalledProcessError, FileNotFoundError):
        return "unknown"


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def run_meta(script: str, data_path: Path, dataset_kind: str) -> dict:
    data_path = data_path.resolve()
    rel = str(data_path.relative_to(REPO)) if data_path.is_relative_to(REPO) else str(data_path)
    return {"script": script, "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "git_commit": git_commit(), "dataset": dataset_kind, "data_file": rel,
            "data_sha256": file_sha256(data_path)}
