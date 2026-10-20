import csv
import json
import subprocess
import sys
from pathlib import Path

ML = Path(__file__).resolve().parents[1]
SCRIPTS = ML / "scripts"


def run(*args: str, cwd: Path = ML) -> str:
    res = subprocess.run([sys.executable, *args], capture_output=True, text=True, cwd=cwd, check=True)
    return res.stdout


def test_label_cli_scripted_labeling_undo_and_export(tmp_path):
    cands = tmp_path / "cands.csv"
    with cands.open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["url", "region", "language"])
        w.writerow(["https://examplebank-kyc.test/login", "IN", "hi"])
        w.writerow(["https://www.examplebank.test/", "IN", "en"])
        w.writerow(["https://parked-domain.test/", "IN", ""])
        w.writerow(["https://examp1ebank.test/", "BR", "pt"])
    labels = tmp_path / "labels.jsonl"
    # alice: phish, legit, skip, then labels the 4th as legit by mistake, undoes, relabels as phish
    run(str(SCRIPTS / "label_cli.py"), "label", "--input", str(cands), "--labeler", "alice", "--labels", str(labels),
        "--answers", "plslup", )
    # bob disagrees on the first URL only -> tie -> conflict
    run(str(SCRIPTS / "label_cli.py"), "label", "--input", str(cands), "--labeler", "bob", "--labels", str(labels),
        "--answers", "lq")
    recs = [json.loads(l) for l in labels.read_text().splitlines()]
    assert any(r.get("undo") for r in recs)
    out_dir = tmp_path / "regional"
    run(str(SCRIPTS / "label_cli.py"), "export", "--labels", str(labels), "--out-dir", str(out_dir))
    rows = list(csv.DictReader((out_dir / "regional_urls.csv").open()))
    by_url = {r["url"]: r for r in rows}
    assert "https://examplebank-kyc.test/login" not in by_url  # alice phish vs bob legit -> conflict
    assert by_url["https://www.examplebank.test/"]["label"] == "0"
    assert by_url["https://examp1ebank.test/"]["label"] == "1"   # undo + relabel honoured
    assert by_url["https://examp1ebank.test/"]["region"] == "BR"
    assert "https://parked-domain.test/" not in by_url           # skipped
    sheet = (out_dir / "DATASHEET.md").read_text()
    assert "Rows: **2**" in sheet and "conflicts excluded: 1" in sheet
    assert (out_dir / "conflicts.txt").read_text().strip() == "https://examplebank-kyc.test/login"


def test_eval_leadtime_on_backend_format(tmp_path):
    data = tmp_path / "leadtime_export.csv"
    data.write_text("domain,our_first_seen,feed,feed_first_seen\n"
                    "a.test,2026-10-01T00:00:00.000Z,openphish-community,2026-10-01T06:00:00.000Z\n"
                    "a.test,2026-10-01T00:00:00.000Z,phishtank,2026-10-01T03:00:00.000Z\n"
                    "b.test,2026-10-01T00:00:00.000Z,phishtank,2026-09-30T23:00:00.000Z\n"
                    "c.test,2026-10-01T00:00:00.000Z,,\n")
    out = run(str(SCRIPTS / "eval_leadtime.py"), "--data", str(data))
    assert "50% of 2 domains" in out
    res = json.loads((ML / "results" / "leadtime.json").read_text())
    assert res["vs_earliest_feed"]["median_hours_ahead"] == 1.0  # (3 + -1) / 2
    assert res["never_in_feeds"] == 1
    # restore the committed sample result
    run(str(SCRIPTS / "eval_leadtime.py"))


def test_import_reviews(tmp_path):
    export = tmp_path / "reviews.csv"
    export.write_text("registered_domain,label,kind,score,reason_ids,model_version,reported_at\n"
                      "fp.test,0,false_positive,70,x,m,2026-10-02T00:00:00.000Z\n"
                      "pending.test,,false_positive,70,x,m,2026-10-02T00:00:00.000Z\n")
    out = tmp_path / "rows.csv"
    run(str(SCRIPTS / "import_reviews.py"), str(export), "--out", str(out))
    rows = list(csv.DictReader(out.open()))
    assert [(r["url"], r["label"], r["source"]) for r in rows] == [("https://fp.test/", "0", "user-report")]
