"""Deterministic log2 / entropy. Mirrors wasm/src/detmath.cpp operation-for-operation.

Only frexp (exact) and + - * / (IEEE-754 correctly rounded) are used, in the same order
as the C++ code, so results are bit-identical to the WASM extractor.
"""
from __future__ import annotations

import math

_INV_LN2 = 1.4426950408889634


def det_log2(x: float) -> float:
    m, e = math.frexp(x)
    y = m * 2.0
    e -= 1
    t = (y - 1.0) / (y + 1.0)
    t2 = t * t
    s = 0.0
    term = t
    for k in range(25):
        s += term / float(2 * k + 1)
        term *= t2
    ln = 2.0 * s
    return float(e) + ln * _INV_LN2


def shannon_entropy(s: str) -> float:
    if not s:
        return 0.0
    counts = [0] * 256
    for ch in s:
        counts[ord(ch)] += 1
    n = float(len(s))
    h = 0.0
    for b in range(256):
        c = counts[b]
        if c == 0:
            continue
        p = float(c) / n
        h -= p * det_log2(p)
    return h
