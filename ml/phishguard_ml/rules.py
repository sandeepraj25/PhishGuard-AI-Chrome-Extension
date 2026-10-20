"""Rules-only risk score (0-100). Used as (a) the evaluation baseline and (b) the fallback
when the model cannot load. Mirrored in extension/src/lib/scoring.ts.
"""
from __future__ import annotations

from .features import FEATURE_NAMES

IDX = {n: i for i, n in enumerate(FEATURE_NAMES)}


def rules_score(f: list[float]) -> float:
    s = 0.0
    if f[IDX["brand_in_host_not_official"]]:
        s += 45
    if f[IDX["homoglyph_brand_match"]]:
        s += 45
    ed = f[IDX["min_brand_edit_distance"]]
    if ed == 1:
        s += 35
    elif ed == 2:
        s += 25
    if f[IDX["brand_in_path"]]:
        s += 20
    if f[IDX["is_mixed_script"]]:
        s += 30
    if f[IDX["is_punycode"]]:
        s += 10
    if f[IDX["is_ip_host"]]:
        s += 30
    if f[IDX["has_at_symbol"]]:
        s += 20
    if f[IDX["is_risky_tld"]]:
        s += 10
    s += min(15.0, 5.0 * f[IDX["suspicious_token_count"]])
    if f[IDX["has_nonstandard_port"]]:
        s += 10
    if f[IDX["num_subdomains"]] >= 3:
        s += 10
    age = f[IDX["domain_age_days"]]
    if 0 <= age < 30:
        s += 20
    return max(0.0, min(100.0, s))


def hard_rule_floor(f: list[float]) -> float:
    """Minimum score forced by unambiguous signals, applied on top of the model score."""
    if f[IDX["homoglyph_brand_match"]] and f[IDX["is_mixed_script"]]:
        return 75.0  # Unicode look-alike of a brand: never let the model talk us out of it
    if f[IDX["brand_in_host_not_official"]] and f[IDX["has_at_symbol"]]:
        return 70.0
    return 0.0


def combined_score(model_prob: float, f: list[float]) -> float:
    """Shipped score before user-specific adjustments (trusted list, known-bad list)."""
    return max(100.0 * model_prob, hard_rule_floor(f))
