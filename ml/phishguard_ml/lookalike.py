"""Punycode, scripts, skeletons, banded edit distance. Mirrors wasm/src/lookalike.cpp."""
from __future__ import annotations

_BASE, _TMIN, _TMAX, _SKEW, _DAMP = 36, 1, 26, 38, 700
_INITIAL_BIAS, _INITIAL_N = 72, 128
_MAX_INT = 0x7FFFFFFF


def _adapt(delta: int, num_points: int, first: bool) -> int:
    delta = delta // _DAMP if first else delta // 2
    delta += delta // num_points
    k = 0
    while delta > ((_BASE - _TMIN) * _TMAX) // 2:
        delta //= _BASE - _TMIN
        k += _BASE
    return k + (_BASE - _TMIN + 1) * delta // (delta + _SKEW)


def _digit(c: str) -> int:
    if "a" <= c <= "z":
        return ord(c) - 97
    if "A" <= c <= "Z":
        return ord(c) - 65
    if "0" <= c <= "9":
        return ord(c) - 48 + 26
    return -1


def punycode_decode(inp: str) -> list[int] | None:
    out: list[int] = []
    delim = inp.rfind("-")
    pos = 0
    if delim != -1:
        for ch in inp[:delim]:
            if ord(ch) >= 0x80:
                return None
            out.append(ord(ch))
        pos = delim + 1
    n, i, bias = _INITIAL_N, 0, _INITIAL_BIAS
    while pos < len(inp):
        oldi, w = i, 1
        k = _BASE
        while True:
            if pos >= len(inp):
                return None
            d = _digit(inp[pos])
            pos += 1
            if d < 0:
                return None
            if d > (_MAX_INT - i) // w:
                return None
            i += d * w
            t = _TMIN if k <= bias else (_TMAX if k >= bias + _TMAX else k - bias)
            if d < t:
                break
            if w > _MAX_INT // (_BASE - t):
                return None
            w *= _BASE - t
            k += _BASE
        length = len(out) + 1
        bias = _adapt(i - oldi, length, oldi == 0)
        if i // length > _MAX_INT - n:
            return None
        n += i // length
        i %= length
        if n > 0x10FFFF:
            return None
        out.insert(i, n)
        i += 1
    return out


def label_code_points(label: str) -> list[int]:
    if len(label) > 4 and label.startswith("xn--"):
        cps = punycode_decode(label[4:])
        if cps is not None:
            return cps
    return [ord(c) for c in label]


_RANGES = [
    (0x0370, 0x03FF, "greek"), (0x0400, 0x052F, "cyrillic"), (0x0590, 0x05FF, "hebrew"),
    (0x0600, 0x06FF, "arabic"), (0x0900, 0x097F, "devanagari"), (0x0980, 0x09FF, "bengali"),
    (0x0E00, 0x0E7F, "thai"), (0x4E00, 0x9FFF, "han"), (0x3040, 0x30FF, "kana"), (0xAC00, 0xD7AF, "hangul"),
]


def script_of(cp: int) -> str | None:
    if 0x61 <= cp <= 0x7A or 0x41 <= cp <= 0x5A:
        return "latin"
    if cp < 0x80:
        return None
    if 0x00C0 <= cp <= 0x024F and cp not in (0xD7, 0xF7):
        return "latin"
    for lo, hi, name in _RANGES:
        if lo <= cp <= hi:
            return name
    return "other"


def is_mixed_script(cps: list[int]) -> bool:
    seen: str | None = None
    for cp in cps:
        s = script_of(cp)
        if s is None:
            continue
        if seen is None:
            seen = s
        elif s != seen:
            return True
    return False


def skeleton(cps: list[int], cmap: dict[int, str]) -> str:
    out = []
    for cp in cps:
        if cp < 0x80:
            c = chr(cp)
            if "A" <= c <= "Z":
                c = chr(cp + 32)
            if c == "0":
                c = "o"
            elif c == "1":
                c = "l"
            out.append(c)
        else:
            out.append(cmap.get(cp, "?"))
    s = "".join(out)
    # str.replace scans left to right without overlaps, same as the C++ replaceAll.
    return s.replace("rn", "m").replace("vv", "w")


def skeleton_ascii(s: str, cmap: dict[int, str]) -> str:
    return skeleton([ord(c) for c in s], cmap)


def bounded_edit_distance(a: str, b: str, k: int) -> int:
    """Levenshtein distance capped at k+1, computing only the diagonal band of width 2k+1."""
    n, m = len(a), len(b)
    inf = k + 1
    if abs(n - m) > k:
        return inf
    prev = [inf] * (m + 1)
    for j in range(min(m, k) + 1):
        prev[j] = j
    for i in range(1, n + 1):
        cur = [inf] * (m + 1)
        lo, hi = max(1, i - k), min(m, i + k)
        if i <= k:
            cur[0] = i
        row_min = cur[0]
        for j in range(lo, hi + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            v = min(prev[j - 1] + cost, prev[j] + 1, cur[j - 1] + 1)
            cur[j] = min(v, inf)
            row_min = min(row_min, cur[j])
        if row_min > k:
            return inf
        prev = cur
    return min(prev[m], inf)
