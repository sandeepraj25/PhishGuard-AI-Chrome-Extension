"""Feature parity test: Python vs native C++ vs WASM, bit-exact, on >= 1,000 URLs.

Inputs: a seeded random sample from ml/data/processed/urls.csv plus every edge case in
ml/data/processed/edge_cases.txt (Unicode, punycode, IPs, ports, garbage).
Compares the IEEE-754 bit pattern of every feature and the match-details JSON.
Exit code 1 on ANY mismatch. Writes ml/results/parity.json.

Requires: wasm/build/pg_cli (cmake build) and extension/node_modules (npm install).
"""
from __future__ import annotations

import argparse
import json
import random
import struct
import subprocess
import sys

import _common  # noqa: F401
from phishguard_ml.data import PROCESSED, read_records
from phishguard_ml.features import FEATURE_NAMES, default_engine
from phishguard_ml.paths import REPO, RESULTS


def python_lines(rows: list[tuple[str, float, float]]) -> list[str]:
    eng = default_engine()
    out = []
    for url, age, cert in rows:
        f, d = eng.extract(url, age, cert)
        hexes = " ".join(struct.pack(">d", x).hex() for x in f)
        out.append(hexes + "\t" + json.dumps(d.to_dict(), separators=(",", ":"), ensure_ascii=False))
    return out


def run(cmd: list[str], stdin: str, cwd=None) -> list[str]:
    res = subprocess.run(cmd, input=stdin.encode("utf-8"), capture_output=True, cwd=cwd, check=True)
    return res.stdout.decode("utf-8").rstrip("\n").split("\n")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=1000)
    ap.add_argument("--seed", type=int, default=1)
    args = ap.parse_args()

    edge = (PROCESSED.parent / "edge_cases.txt").read_text(encoding="utf-8").split("\n")[:-1]
    records = read_records()
    random.Random(args.seed).shuffle(records)
    rows = [(e, -1.0, -1.0) for e in edge]
    rows += [(r.url, r.domain_age_days, r.cert_age_days) for r in records[: max(0, args.n - len(rows))]]
    stdin = "".join(f"{u}\t{a!r}\t{c!r}\n" for u, a, c in rows)

    py = python_lines(rows)
    native = run([str(REPO / "wasm/build/pg_cli"), "features", str(REPO / "shared")], stdin)
    wasm = run(["npx", "tsx", "scripts/wasm_features.ts"], stdin, cwd=REPO / "extension")

    mismatches = []
    for i, (u, _, _) in enumerate(rows):
        for name, other in (("native", native), ("wasm", wasm)):
            a_feat, a_det = py[i].split("\t", 1)
            b_feat, b_det = other[i].split("\t", 1)
            if a_feat != b_feat or json.loads(a_det) != json.loads(b_det):
                diff = [FEATURE_NAMES[j] for j, (x, y) in enumerate(zip(a_feat.split(), b_feat.split())) if x != y]
                mismatches.append({"url": u, "impl": name, "features": diff,
                                   "details_equal": json.loads(a_det) == json.loads(b_det)})
    result = {"urls": len(rows), "edge_cases": len(edge), "features": len(FEATURE_NAMES),
              "implementations": ["python", "native-cpp", "wasm"], "mismatches": len(mismatches),
              "examples": mismatches[:20]}
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "parity.json").write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in result.items() if k != "examples"}))
    for m in mismatches[:10]:
        print("MISMATCH", m)
    return 1 if mismatches or len(rows) < 1000 else 0


if __name__ == "__main__":
    sys.exit(main())
