"""URL normalisation + parsing. Mirrors wasm/src/url.cpp exactly (not urllib!)."""
from __future__ import annotations

from dataclasses import dataclass

_HEX = "0123456789ABCDEF"


def normalize_url(raw: str | bytes) -> str:
    data = raw.encode("utf-8") if isinstance(raw, str) else raw
    b, e = 0, len(data)
    while b < e and data[b] <= 0x20:
        b += 1
    while e > b and data[e - 1] <= 0x20:
        e -= 1
    out = []
    for c in data[b:e]:
        if c >= 0x80:
            out.append("%" + _HEX[c >> 4] + _HEX[c & 0xF])
        else:
            out.append(chr(c))
    return "".join(out)


def to_lower_ascii(s: str) -> str:
    return "".join(chr(ord(c) + 32) if "A" <= c <= "Z" else c for c in s)


@dataclass
class ParsedUrl:
    normalized: str = ""
    scheme: str = ""
    host: str = ""
    port: str = ""
    path: str = ""
    query: str = ""
    has_query: bool = False
    has_at: bool = False


def _is_scheme_char(c: str, first: bool) -> bool:
    alpha = ("a" <= c <= "z") or ("A" <= c <= "Z")
    if first:
        return alpha
    return alpha or ("0" <= c <= "9") or c in "+.-"


def parse_url(raw: str | bytes) -> ParsedUrl:
    u = ParsedUrl()
    u.normalized = s = normalize_url(raw)
    rest = s
    sep = s.find("://")
    if sep > 0 and all(_is_scheme_char(s[i], i == 0) for i in range(sep)):
        u.scheme = to_lower_ascii(s[:sep])
        rest = s[sep + 3 :]

    auth_end = len(rest)
    for i, c in enumerate(rest):
        if c in "/?#":
            auth_end = i
            break
    authority, remainder = rest[:auth_end], rest[auth_end:]

    at = authority.rfind("@")
    u.has_at = at != -1
    host_port = authority[at + 1 :] if u.has_at else authority

    if host_port.startswith("["):
        close = host_port.find("]")
        if close == -1:
            host = host_port
        else:
            host = host_port[: close + 1]
            if close + 1 < len(host_port) and host_port[close + 1] == ":":
                u.port = host_port[close + 2 :]
    else:
        colon = host_port.rfind(":")
        if colon != -1:
            host, u.port = host_port[:colon], host_port[colon + 1 :]
        else:
            host = host_port
    host = to_lower_ascii(host)
    while host.endswith("."):
        host = host[:-1]
    u.host = host

    h = remainder.find("#")
    if h != -1:
        remainder = remainder[:h]
    q = remainder.find("?")
    if q != -1:
        u.has_query = True
        u.query = remainder[q + 1 :]
        u.path = remainder[:q]
    else:
        u.path = remainder
    return u


def split_non_empty(s: str, sep: str) -> list[str]:
    return [p for p in s.split(sep) if p]


def is_ip_host(host: str) -> bool:
    if not host:
        return False
    if host[0] == "[":
        return True
    if all("0" <= c <= "9" for c in host):
        return True
    parts = host.split(".")
    if len(parts) != 4:
        return False
    return all(0 < len(p) <= 3 and all("0" <= c <= "9" for c in p) for p in parts)
