"""Build shared/confusables.json: code point -> ASCII skeleton string.

Two sources are merged:
1. A curated table of the most abused Cyrillic / Greek / Latin look-alikes (always included).
2. If a Unicode `confusables.txt` file is passed with --confusables, every entry whose
   target is plain ASCII letters/digits is added (UTS #39 data, Unicode licence).
3. Latin letters with diacritics (U+00C0..U+024F) are folded with NFKD (e.g. "é" -> "e").

Run:  python ml/scripts/build_confusables.py [--confusables path/to/confusables.txt]
The output is shared by Python, C++ and TypeScript, so all three skeletons are identical.
"""
from __future__ import annotations

import argparse
import json
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# Curated look-alikes (subset of UTS #39 confusables, lower case only: hosts are lower-cased).
CURATED: dict[int, str] = {
    # Cyrillic
    0x0430: "a", 0x0435: "e", 0x043E: "o", 0x0440: "p", 0x0441: "c", 0x0443: "y", 0x0445: "x",
    0x0456: "i", 0x0458: "j", 0x0455: "s", 0x04BB: "h", 0x0501: "d", 0x051B: "q", 0x051D: "w",
    0x04CF: "l", 0x0457: "i", 0x0491: "r", 0x044C: "b", 0x0432: "b", 0x043D: "h", 0x0442: "t",
    0x043C: "m", 0x043A: "k", 0x0433: "r", 0x0438: "u", 0x043F: "n", 0x0454: "e", 0x0451: "e",
    # Greek
    0x03BF: "o", 0x03B1: "a", 0x03BD: "v", 0x03B9: "i", 0x03BA: "k", 0x03C1: "p", 0x03C5: "u",
    0x03C7: "x", 0x03B5: "e", 0x03C4: "t", 0x03B7: "n", 0x03C9: "w", 0x03B2: "b", 0x03B3: "y",
    # Latin look-alikes outside ASCII
    0x0131: "i", 0x0251: "a", 0x0261: "g", 0x0269: "i", 0x026A: "i", 0x1D0F: "o", 0x0280: "r",
    0x01C3: "l", 0x0142: "l", 0x00F8: "o", 0x0111: "d", 0x0127: "h", 0x00DF: "ss", 0x00E6: "ae",
    0x0153: "oe", 0x00F0: "d", 0x00FE: "p",
    # Fullwidth digits/letters are handled by NFKD below
}


def fold_latin() -> dict[int, str]:
    out: dict[int, str] = {}
    for cp in list(range(0x00C0, 0x0250)) + list(range(0xFF10, 0xFF1A)) + list(range(0xFF41, 0xFF5B)):
        ch = chr(cp)
        base = "".join(c for c in unicodedata.normalize("NFKD", ch) if not unicodedata.combining(c))
        base = base.lower()
        if base and base.isascii() and base.isalnum():
            out[cp] = base
    return out


def from_uts39(path: Path) -> dict[int, str]:
    out: dict[int, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        parts = [p.strip() for p in line.split(";")]
        if len(parts) < 2:
            continue
        src = parts[0].split()
        if len(src) != 1:
            continue
        target = "".join(chr(int(h, 16)) for h in parts[1].split()).lower()
        if target.isascii() and target.isalnum():
            out[int(src[0], 16)] = target
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--confusables", type=Path, default=None)
    ap.add_argument("--out", type=Path, default=ROOT / "shared" / "confusables.json")
    args = ap.parse_args()
    table: dict[int, str] = {}
    if args.confusables:
        table.update(from_uts39(args.confusables))
    table.update(fold_latin())
    table.update(CURATED)
    # Never remap ASCII here; ASCII rules (0->o, 1->l, rn->m, vv->w) live in code.
    table = {k: v for k, v in table.items() if k >= 0x80}
    doc = {
        "version": 1,
        "source": "curated+nfkd" + ("+uts39" if args.confusables else ""),
        "notes": "Keys are hex code points (lower case, no prefix). Values are ASCII skeleton strings.",
        "map": {format(k, "x"): v for k, v in sorted(table.items())},
    }
    args.out.write_text(json.dumps(doc, indent=1, ensure_ascii=True) + "\n", encoding="utf-8")
    print(f"wrote {len(table)} entries to {args.out}")


if __name__ == "__main__":
    main()
