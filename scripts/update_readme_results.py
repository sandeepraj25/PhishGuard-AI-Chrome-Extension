"""Regenerate the results table in README.md from ml/results/*.json (and nothing else).

The table lives between <!-- RESULTS:START --> and <!-- RESULTS:END -->. Missing result files
render as "[TBD — run ml/scripts/eval_*.py]". Run after any eval script:
    python scripts/update_readme_results.py
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "ml" / "results"
TBD = "[TBD — run ml/scripts/eval_*.py]"


def load(name: str) -> dict | None:
    p = RES / name
    return json.loads(p.read_text()) if p.exists() else None


def pct(x: float | None) -> str:
    return TBD if x is None else f"{100 * x:.1f}%"


def url_rows(ev: dict | None) -> list[str]:
    if not ev:
        return [f"| Layer 1 URL model | {TBD} | {TBD} | {TBD} | {TBD} |"]
    rows = []
    for key, label in (("rules_baseline", "Rules-only baseline"), ("model_onnx", "Layer 1 URL model (ONNX)"),
                       ("combined_shipped", "Shipped score (model + hard rules)")):
        m = ev[key]
        t = m["at_threshold"]["60.0"]
        r01 = m["recall_at_0.1pct_fpr"]
        rows.append(f"| {label} | {m['pr_auc']:.3f} | {pct(r01['recall'])} (≤{r01['allowed_false_positives']} FP of "
                    f"{r01['negatives']}) | {pct(t['precision'])} | {pct(t['recall'])} |")
    return rows


def main() -> None:
    ev = load("url_eval.json")
    train = load("url_train.json")
    parity = load("parity.json")
    lines = []
    kind = (ev or train or {}).get("dataset", "unknown")
    if kind == "synthetic-sample":
        lines.append("> ⚠️ **Synthetic sample data.** These numbers come from `ml/scripts/make_sample_data.py` "
                     "(template-generated URLs) and only prove the pipeline runs end to end. They say **nothing** about "
                     "real-world accuracy. Re-run with real data (docs/HUMAN_TODO.md) before quoting any number.")
        lines.append("")
    lines.append("| Model | PR-AUC | Recall @ 0.1% FPR | Precision (score > 60) | Recall (score > 60) |")
    lines.append("|---|---|---|---|---|")
    lines += url_rows(ev)
    lines.append("")
    if ev:
        lines.append(f"Test split: {ev['test_split']['rows']} URLs ({ev['test_split']['phishing']} phishing), "
                     f"{ev['test_split']['domains']} registered domains, first seen "
                     f"{ev['test_split']['first_seen_min']} → {ev['test_split']['first_seen_max']}; no domain overlaps "
                     f"with training. Source: `ml/results/url_eval.json` (commit {ev['git_commit']}).")
    if train:
        lines.append(f"URL model size: ONNX {train['model_bytes']['onnx'] / 1024:.0f} KB, {train['num_trees']} trees; "
                     f"ONNX vs LightGBM max |Δp| = {train['onnx_vs_lightgbm']['max_abs_diff']:.1e}. "
                     "Source: `ml/results/url_train.json`.")
    if parity:
        lines.append(f"Feature parity (Python vs native C++ vs WASM): {parity['urls']} URLs × {parity['features']} "
                     f"features, **{parity['mismatches']} mismatches**. Source: `ml/results/parity.json`.")
    extra = {
        "page_eval.json": "Layer 2 page model", "leadtime.json": "Lead time vs public feeds",
        "visual_eval.json": "Layer 3 visual model", "robustness.json": "Robustness (scripted attacks)",
        "drift.json": "Score drift",
    }
    for f, label in extra.items():
        d = load(f)
        if d is not None and "summary_line" in d:
            lines.append(f"{label}: {d['summary_line']} Source: `ml/results/{f}`.")
    block = "\n".join(lines)
    readme = (ROOT / "README.md").read_text()
    start, end = "<!-- RESULTS:START -->", "<!-- RESULTS:END -->"
    a, b = readme.index(start) + len(start), readme.index(end)
    (ROOT / "README.md").write_text(readme[:a] + "\n" + block + "\n" + readme[b:])
    print("README results updated")


if __name__ == "__main__":
    main()
