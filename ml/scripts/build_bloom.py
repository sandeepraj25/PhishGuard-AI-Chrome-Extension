"""Build the bundled known-bad Bloom filter (extension/public/data/known_bad.bloom).

Keys are registered domains (eTLD+1), lower-case. Default source: phishing rows in the
processed dataset; add more with --extra (one domain per line). The backend feed worker
rebuilds the same format every 15 minutes (backend/src/lib/bloom.ts).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import _common  # noqa: F401
from phishguard_ml.bloom import BloomFilter
from phishguard_ml.data import PROCESSED, read_records
from phishguard_ml.paths import EXTENSION_PUBLIC, RESULTS

SHARED_HOSTING = {"web.app", "firebaseapp.com", "github.io", "blogspot.com"}  # never block a whole platform


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, default=PROCESSED)
    ap.add_argument("--extra", type=Path, default=None)
    ap.add_argument("--fp-rate", type=float, default=0.001)
    ap.add_argument("--out", type=Path, default=EXTENSION_PUBLIC / "data" / "known_bad.bloom")
    args = ap.parse_args()
    domains = {r.registered_domain for r in read_records(args.data) if r.label == 1 and r.registered_domain}
    if args.extra:
        domains |= {d.strip().lower() for d in args.extra.read_text().splitlines() if d.strip()}
    domains -= SHARED_HOSTING
    bf = BloomFilter.for_capacity(len(domains), args.fp_rate)
    for d in sorted(domains):
        bf.add(d)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_bytes(bf.serialize())
    info = {"items": len(domains), "bits": bf.m, "hashes": bf.k, "bytes": args.out.stat().st_size,
            "target_fp_rate": args.fp_rate}
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "bloom_build.json").write_text(json.dumps(info, indent=2) + "\n")
    print(info)


if __name__ == "__main__":
    main()
