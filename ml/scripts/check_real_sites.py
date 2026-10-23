"""Launch gate: how many REAL legitimate URLs would get a warning?

Scores every URL in shared/real_legit_sample.txt (and --extra files, one URL per line) exactly as
the extension does for a first visit with no backend: URL model + hard rules + bundled Bloom
filter (a Bloom hit offline scores >= 80). Writes ml/results/real_sites.json.

Exit code 1 if the false-warning rate is above --max-rate (default 1%) — do not publish then.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort

import _common  # noqa: F401
from phishguard_ml.bloom import BloomFilter
from phishguard_ml.features import default_engine
from phishguard_ml.meta import run_meta
from phishguard_ml.paths import EXTENSION_PUBLIC, MODELS, RESULTS, SHARED
from phishguard_ml.rules import combined_score

BLOOM_ONLY_FLOOR = 80.0  # extension/src/lib/config.ts
WARN_ABOVE = 30.0        # overlay threshold


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--extra", type=Path, action="append", default=[])
    ap.add_argument("--max-rate", type=float, default=0.01)
    args = ap.parse_args()
    files = [SHARED / "real_legit_sample.txt", *args.extra]
    urls = [l.strip() for f in files for l in f.read_text(encoding="utf-8").splitlines() if l.strip() and not l.startswith("#")]
    eng = default_engine()
    X = np.array([eng.extract(u)[0] for u in urls], dtype=np.float32)
    sess = ort.InferenceSession(str(MODELS / "url_model.onnx"), providers=["CPUExecutionProvider"])
    probs = sess.run(None, {"input": X})[1][:, 1]
    bloom = BloomFilter.deserialize((EXTENSION_PUBLIC / "data" / "known_bad.bloom").read_bytes())
    rows = []
    for u, p, x in zip(urls, probs, X):
        dom = eng.registered_domain(u)
        score = combined_score(float(p), list(x))
        in_bloom = dom in bloom
        if in_bloom:
            score = max(score, BLOOM_ONLY_FLOOR)
        rows.append({"url": u, "domain": dom, "score": round(score, 1), "bloom_hit": in_bloom})
    warned = [r for r in rows if r["score"] > WARN_ABOVE]
    rate = len(warned) / len(rows)
    result = {**run_meta("ml/scripts/check_real_sites.py", files[0], "real (hand-picked legit URLs)"),
              "urls": len(rows), "warned": len(warned), "false_warning_rate": rate, "max_rate": args.max_rate,
              "passes_gate": rate <= args.max_rate,
              "warned_urls": sorted(warned, key=lambda r: -r["score"]),
              "summary_line": (f"{len(warned)} of {len(rows)} hand-picked real legitimate URLs would show a warning "
                               f"({100 * rate:.1f}%; launch gate is ≤ {100 * args.max_rate:.0f}%) — "
                               f"{'PASS' if rate <= args.max_rate else 'FAIL: do not publish this model'}.")}
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "real_sites.json").write_text(json.dumps(result, indent=2) + "\n")
    print(result["summary_line"])
    for r in result["warned_urls"]:
        print(f"  {r['score']:5.1f}  bloom={r['bloom_hit']}  {r['url']}")
    return 0 if result["passes_gate"] else 1


if __name__ == "__main__":
    sys.exit(main())
