"""Convert shared/public_suffix_list.dat (UTF-8, MPL-2.0) to shared/psl_ascii.txt.

Each rule is converted to its ASCII (punycode) form because the extractor only sees
ASCII hosts (browsers give us punycoded hosts). Output: one rule per line, ICANN and
PRIVATE sections both included. Comments and blank lines are dropped.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def to_ascii_label(label: str) -> str:
    if label.isascii():
        return label.lower()
    return "xn--" + label.lower().encode("punycode").decode("ascii")


def convert(src: Path, dst: Path) -> int:
    rules: list[str] = []
    for raw in src.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("//"):
            continue
        rule = line.split()[0]
        prefix = ""
        if rule.startswith("!"):
            prefix, rule = "!", rule[1:]
        rules.append(prefix + ".".join(to_ascii_label(p) if p != "*" else "*" for p in rule.split(".")))
    dst.write_text("\n".join(rules) + "\n", encoding="ascii")
    return len(rules)


if __name__ == "__main__":
    src = ROOT / "shared" / "public_suffix_list.dat"
    merged = ROOT / "ml" / "data" / "_psl_merged.dat"
    merged.parent.mkdir(parents=True, exist_ok=True)
    merged.write_text(src.read_text(encoding="utf-8") + "\n" +
                      (ROOT / "shared" / "psl_overrides.txt").read_text(encoding="utf-8"), encoding="utf-8")
    n = convert(merged, ROOT / "shared" / "psl_ascii.txt")
    print(f"wrote {n} rules")
