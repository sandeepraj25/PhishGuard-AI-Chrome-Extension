"""Regional dataset labeling CLI.

  label    Interactive (or scripted with --answers) labeling of candidate URLs.
           Shows the URL, registered domain, rules score and brand match, then asks:
             [p] phishing  [l] legitimate  [s] skip  [u] undo last  [q] quit
           Every decision is APPENDED to labels.jsonl (never rewritten): who, when, what, region, language.
  export   Resolve the label log (latest label per URL per labeler, conflicts flagged), write
           ml/datasets/regional/regional_urls.csv and regenerate DATASHEET.md with live statistics.

Candidate input: CSV with at least a `url` column; optional `region`, `language`, `source`.
Sources of candidates: CT candidates (/v1/admin/ct-candidates), confirmed reports
(/v1/admin/reports/export -> import_reviews.py), crawler output, or a hand-made list.

Examples:
  python ml/scripts/label_cli.py label --input candidates.csv --labeler alice --region IN --language hi
  python ml/scripts/label_cli.py label --input c.csv --labeler bot --answers plsp    # scripted (tests)
  python ml/scripts/label_cli.py export
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import _common  # noqa: F401
from phishguard_ml.features import default_engine
from phishguard_ml.paths import ML
from phishguard_ml.rules import rules_score

DATASET_DIR = ML / "datasets" / "regional"
LABELS = DATASET_DIR / "labels.jsonl"
KEYS = {"p": 1, "l": 0}


def load_candidates(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as fh:
        rows = [r for r in csv.DictReader(fh) if r.get("url")]
    if not rows:
        raise SystemExit(f"no rows with a 'url' column in {path}")
    return rows


def already_labeled(labels: Path, labeler: str) -> set[str]:
    if not labels.exists():
        return set()
    done = set()
    for line in labels.read_text(encoding="utf-8").splitlines():
        rec = json.loads(line)
        if rec["labeler"] != labeler:
            continue
        if rec["label"] is None:  # undo record
            done.discard(rec["url"])
        else:
            done.add(rec["url"])
    return done


def describe(url: str) -> str:
    f, d = default_engine().extract(url)
    brand = f"{d.brand_name} via {d.kind} (official: {d.official_domain})" if d.brand else "none"
    return f"  domain: {d.registered_domain}\n  rules score: {rules_score(f):.0f}/100\n  brand match: {brand}"


def append(labels: Path, rec: dict) -> None:
    labels.parent.mkdir(parents=True, exist_ok=True)
    with labels.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(rec, ensure_ascii=False) + "\n")


def cmd_label(args: argparse.Namespace) -> int:
    rows = load_candidates(args.input)
    done = already_labeled(args.labels, args.labeler)
    pending = [r for r in rows if r["url"].strip() not in done]
    answers = list(args.answers) if args.answers is not None else None
    history: list[int] = []  # indexes into `pending` that were labeled, for undo
    labeled = 0
    i = 0

    def ask(prompt: str) -> str:
        if answers is not None:
            key = answers.pop(0) if answers else "q"
            print(f"> {key}")
            return key
        return input(prompt).strip().lower()[:1]

    while True:
        if i >= len(pending):
            # End of the list: still allow an undo of the last decision.
            key = ask("\nend of list — [u]ndo last or [q]uit > ") if history else "q"
        else:
            url = pending[i]["url"].strip()
            print(f"\n[{i + 1}/{len(pending)}] {url}\n{describe(url)}")
            key = ask("[p]hishing [l]egit [s]kip [u]ndo [q]uit > ")
        if key == "q":
            break
        if key == "u":
            if history:
                i = history.pop()  # go back and show that URL again
                undo_url = pending[i]["url"].strip()
                append(args.labels, {"url": undo_url, "label": None, "labeler": args.labeler,
                                     "labeled_at": dt.datetime.now(dt.timezone.utc).isoformat(), "undo": True})
                labeled -= 1
                print(f"  undid label for {undo_url}")
            continue
        if i >= len(pending):
            continue
        if key in KEYS:
            row = pending[i]
            url = row["url"].strip()
            _, d = default_engine().extract(url)
            append(args.labels, {
                "url": url, "registered_domain": d.registered_domain, "label": KEYS[key],
                "brand": d.brand, "region": row.get("region") or args.region,
                "language": row.get("language") or args.language,
                "source": row.get("source") or args.source, "labeler": args.labeler,
                "labeled_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            })
            history.append(i)
            labeled += 1
        i += 1  # 'p', 'l' and 's' (skip) all move on
    print(f"\nlabeled {labeled} URLs -> {args.labels}")
    return 0


def resolve_labels(labels: Path) -> tuple[list[dict], list[str]]:
    """Latest decision per (url, labeler); then majority across labelers. Ties = conflict (excluded)."""
    latest: dict[tuple[str, str], dict | None] = {}
    for line in labels.read_text(encoding="utf-8").splitlines():
        rec = json.loads(line)
        latest[(rec["url"], rec["labeler"])] = rec if rec["label"] is not None else None
    by_url: dict[str, list[dict]] = defaultdict(list)
    for (url, _), rec in latest.items():
        if rec is not None:
            by_url[url].append(rec)
    out, conflicts = [], []
    for url, recs in sorted(by_url.items()):
        votes = Counter(r["label"] for r in recs)
        if len(votes) > 1 and votes.most_common(2)[0][1] == votes.most_common(2)[1][1]:
            conflicts.append(url)
            continue
        label = votes.most_common(1)[0][0]
        first = min(recs, key=lambda r: r["labeled_at"])
        out.append({**first, "label": label, "labelers": len(recs), "agreement": votes[label] / len(recs)})
    return out, conflicts


DATASHEET = """# Regional phishing URL dataset — datasheet

_Auto-generated by `ml/scripts/label_cli.py export` on {now}. Do not edit the statistics by hand._

## Motivation
Global phishing feeds under-represent Indian banks, UPI apps, couriers and government portals, and
lures written in Hindi, Portuguese, Indonesian and Spanish. This dataset collects labeled URLs for
those regions to train and, above all, to **evaluate** PhishGuard on the users it is meant to protect.

## Composition (live statistics)
- Rows: **{rows}** ({phish} phishing, {legit} legitimate); conflicts excluded: {conflicts}
- Labelers: {labelers}; rows with ≥2 labelers: {multi}; mean agreement: {agreement}
- By region: {regions}
- By language: {languages}
- By source: {sources}
- Top impersonated brands (phishing rows): {brands}

## Collection process
Candidates come from (1) Certificate Transparency domains with a brand signal, (2) user "Report mistake"
submissions confirmed in the admin review queue, (3) crawler output, (4) hand-collected lists.
Only URLs and registered domains are stored — no page content, no user identifiers.

## Labeling
Labelers use `label_cli.py label`. Guidelines: label **phishing** only if the page/URL impersonates a
brand or requests credentials/payment under false pretences; parked or empty domains are **skipped**,
not labeled legitimate. Every decision is appended to `labels.jsonl` with labeler id and timestamp;
undo writes a retraction record. Final label = majority over each labeler's latest decision; ties are
excluded and listed as conflicts for adjudication.

## Splits
Use `phishguard_ml.split.time_domain_split` (grouped by registered domain, ordered by first seen).

## Licence
**Not yet decided** (see docs/HUMAN_TODO.md). Candidate URLs derived from third-party feeds inherit
those feeds' terms (docs/data_licenses.md). Until decided: internal use only.

## Known limitations
- Small and young; labels reflect labelers' judgement at labeling time (sites change).
- Selection bias toward what CT brand matching and user reports surface.
"""


def fmt(c: Counter) -> str:
    return ", ".join(f"{k or 'unknown'} {v}" for k, v in c.most_common()) or "—"


def cmd_export(args: argparse.Namespace) -> int:
    if not args.labels.exists():
        raise SystemExit(f"no labels at {args.labels}")
    rows, conflicts = resolve_labels(args.labels)
    out = args.out_dir / "regional_urls.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    cols = ["url", "label", "first_seen", "source", "registered_domain", "domain_age_days", "cert_age_days",
            "region", "language", "brand", "labelers", "agreement"]
    with out.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        for r in rows:
            w.writerow([r["url"], r["label"], r["labeled_at"][:10], f"regional:{r.get('source') or 'manual'}",
                        r["registered_domain"], -1.0, -1.0, r.get("region") or "", r.get("language") or "",
                        r.get("brand") or "", r["labelers"], f"{r['agreement']:.2f}"])
    agree = [r["agreement"] for r in rows]
    sheet = DATASHEET.format(
        now=dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), rows=len(rows),
        phish=sum(r["label"] for r in rows), legit=sum(1 - r["label"] for r in rows), conflicts=len(conflicts),
        labelers=len({json.loads(l)["labeler"] for l in args.labels.read_text(encoding="utf-8").splitlines()}),
        multi=sum(1 for r in rows if r["labelers"] > 1),
        agreement=f"{sum(agree) / len(agree):.2f}" if agree else "—",
        regions=fmt(Counter(r.get("region") for r in rows)), languages=fmt(Counter(r.get("language") for r in rows)),
        sources=fmt(Counter(r.get("source") for r in rows)),
        brands=fmt(Counter(r.get("brand") for r in rows if r["label"] == 1 and r.get("brand"))))
    (args.out_dir / "DATASHEET.md").write_text(sheet, encoding="utf-8")
    if conflicts:
        (args.out_dir / "conflicts.txt").write_text("\n".join(conflicts) + "\n", encoding="utf-8")
    print(f"exported {len(rows)} rows ({len(conflicts)} conflicts) -> {out}")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    lab = sub.add_parser("label")
    lab.add_argument("--input", type=Path, required=True)
    lab.add_argument("--labeler", required=True)
    lab.add_argument("--region", default="")
    lab.add_argument("--language", default="")
    lab.add_argument("--source", default="manual")
    lab.add_argument("--labels", type=Path, default=LABELS)
    lab.add_argument("--answers", default=None, help="scripted answers, e.g. 'plsq' (for tests/automation)")
    ex = sub.add_parser("export")
    ex.add_argument("--labels", type=Path, default=LABELS)
    ex.add_argument("--out-dir", type=Path, default=DATASET_DIR)
    args = ap.parse_args(argv)
    return cmd_label(args) if args.cmd == "label" else cmd_export(args)


if __name__ == "__main__":
    sys.exit(main())
