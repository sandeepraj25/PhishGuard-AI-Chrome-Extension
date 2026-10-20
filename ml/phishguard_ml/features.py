"""URL features. Mirrors wasm/src/features.cpp exactly; see shared/feature_spec.json.

Any change here must be made in the C++ code too; ml/scripts/parity_test.py fails otherwise.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from .detmath import shannon_entropy
from .lookalike import bounded_edit_distance, is_mixed_script, label_code_points, skeleton, skeleton_ascii
from .paths import SHARED
from .psl import PublicSuffixList
from .urlparse import is_ip_host, parse_url, split_non_empty, to_lower_ascii

LONG_TOKEN = 5
MAX_EDIT = 2

FEATURE_SPEC = json.loads((SHARED / "feature_spec.json").read_text(encoding="utf-8"))
FEATURE_NAMES: list[str] = [f["name"] for f in FEATURE_SPEC["url_features"]]
NUM_FEATURES = len(FEATURE_NAMES)


@dataclass
class Brand:
    id: str
    name: str
    tokens: list[str]
    token_skeletons: list[str]
    official: set[str]
    primary_domain: str


@dataclass
class MatchDetails:
    registered_domain: str = ""
    brand: str = ""
    brand_name: str = ""
    official_domain: str = ""
    kind: str = ""
    matched: str = ""
    edit_distance: int = 3

    def to_dict(self) -> dict:
        return dict(self.__dict__)


@dataclass
class FeatureEngine:
    psl: PublicSuffixList
    brands: list[Brand]
    confusables: dict[int, str]
    suspicious_tokens: list[str]
    risky_tlds: set[str] = field(default_factory=set)

    @classmethod
    def from_dir(cls, shared: Path = SHARED) -> "FeatureEngine":
        psl = PublicSuffixList((shared / "psl_ascii.txt").read_text(encoding="ascii"))
        conf = json.loads((shared / "confusables.json").read_text(encoding="utf-8"))
        cmap = {int(k, 16): v for k, v in conf["map"].items()}
        brands = []
        for b in json.loads((shared / "brands.json").read_text(encoding="utf-8"))["brands"]:
            tokens = [to_lower_ascii(t) for t in b["tokens"]]
            officials = [to_lower_ascii(d) for d in b["official_domains"]]
            brands.append(Brand(b["id"], b["name"], tokens, [skeleton_ascii(t, cmap) for t in tokens],
                                set(officials), officials[0] if officials else ""))
        toks: list[str] = []
        for t in json.loads((shared / "suspicious_tokens.json").read_text(encoding="utf-8"))["tokens"]:
            t = to_lower_ascii(t)
            if t not in toks:
                toks.append(t)
        tlds = {to_lower_ascii(t) for t in json.loads((shared / "risky_tlds.json").read_text(encoding="utf-8"))["tlds"]}
        return cls(psl, brands, cmap, toks, tlds)

    def registered_domain(self, url: str) -> str:
        return self.psl.registered_domain(parse_url(url).host)

    def extract(self, url: str, domain_age: float = -1.0, cert_age: float = -1.0) -> tuple[list[float], MatchDetails]:
        u = parse_url(url)
        s, host = u.normalized, u.host
        lower_url = to_lower_ascii(s)
        path_query = u.path + ("?" + u.query if u.has_query else "")
        lower_pq = to_lower_ascii(path_query)
        ip = is_ip_host(host)
        labels = host.split(".") if host else []
        reg = self.psl.registered_domain(host)

        f = [0.0] * NUM_FEATURES
        f[0] = float(len(s))
        f[1] = float(len(host))
        f[2] = float(len(path_query))
        f[3] = float(host.count("."))
        f[4] = 0.0 if (ip or not host) else float(len(labels) - len(reg.split(".")))
        f[5] = float(host.count("-"))
        f[6] = float(sum(1 for c in host if "0" <= c <= "9"))
        f[7] = 0.0 if not s else float(sum(1 for c in s if "0" <= c <= "9")) / float(len(s))
        f[8] = shannon_entropy(host)
        f[9] = shannon_entropy(s)
        f[10] = float(sum(1 for t in self.suspicious_tokens if t in lower_url))
        tld = "" if (ip or not labels) else labels[-1]
        f[11] = 1.0 if tld in self.risky_tlds else 0.0
        f[12] = float(len(tld))
        f[13] = 1.0 if any(len(l) >= 4 and l.startswith("xn--") for l in labels) else 0.0
        f[14] = 1.0 if any(is_mixed_script(label_code_points(l)) for l in labels) else 0.0
        f[15] = 1.0 if ip else 0.0
        f[16] = 1.0 if u.has_at else 0.0
        f[17] = float(len(split_non_empty(u.path, "/")))
        f[18] = float(len(split_non_empty(u.query, "&")))
        f[19] = 1.0 if (u.port and u.port != "80" and u.port != "443") else 0.0

        core: list[str] = []
        if not ip and labels:
            sfx = self.psl.suffix_label_count(labels)
            keep = len(labels) if sfx >= len(labels) else len(labels) - sfx
            core = labels[:keep]
        core_joined = ".".join(core)
        parts = [p for l in core for p in split_non_empty(l, "-")]
        skel_labels = [skeleton(label_code_points(l), self.confusables) for l in core]
        skel_joined = ".".join(skel_labels)
        skel_parts = [p for l in skel_labels for p in split_non_empty(l, "-")]

        def hit(token: str, joined: str, ps: list[str]) -> bool:
            return (token in joined) if len(token) >= LONG_TOKEN else (token in ps)

        brand_host = brand_path = homoglyph = any_official = False
        min_edit = MAX_EDIT + 1
        d_homo = d_host = d_edit = d_path = None
        for b in self.brands:
            if reg in b.official:
                any_official = True
                continue
            raw_hit = skel_hit = False
            for tok, skel_tok in zip(b.tokens, b.token_skeletons):
                if hit(tok, core_joined, parts):
                    raw_hit = True
                    if d_host is None:
                        d_host = MatchDetails(reg, b.id, b.name, b.primary_domain, "host", tok, 0)
                if hit(skel_tok, skel_joined, skel_parts):
                    skel_hit = True
                if len(tok) >= LONG_TOKEN and tok in lower_pq:
                    brand_path = True
                    if d_path is None:
                        d_path = MatchDetails(reg, b.id, b.name, b.primary_domain, "path", tok, 3)
                if len(tok) >= LONG_TOKEN:
                    for p in parts:
                        if len(p) < 4:
                            continue
                        d = bounded_edit_distance(p, tok, MAX_EDIT)
                        if d < min_edit:
                            min_edit = d
                            d_edit = MatchDetails(reg, b.id, b.name, b.primary_domain, "edit", p, d)
            if raw_hit:
                brand_host = True
            if skel_hit and not raw_hit:
                homoglyph = True
                if d_homo is None:
                    d_homo = MatchDetails(reg, b.id, b.name, b.primary_domain, "homoglyph", skel_joined, 0)
        if any_official:
            min_edit = MAX_EDIT + 1

        f[20] = 1.0 if brand_host else 0.0
        f[21] = 1.0 if brand_path else 0.0
        f[22] = float(min_edit)
        f[23] = 1.0 if homoglyph else 0.0
        f[24] = float(domain_age)
        f[25] = float(cert_age)

        if homoglyph:
            det = d_homo
        elif brand_host:
            det = d_host
        elif min_edit <= MAX_EDIT:
            det = d_edit
        elif brand_path:
            det = d_path
        else:
            det = None
        det = MatchDetails(**det.to_dict()) if det else MatchDetails()
        det.registered_domain = reg
        return f, det


@lru_cache(maxsize=1)
def default_engine() -> FeatureEngine:
    return FeatureEngine.from_dir(SHARED)
