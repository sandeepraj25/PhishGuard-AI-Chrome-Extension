"""Public Suffix List lookup. Mirrors wasm/src/psl.cpp."""
from __future__ import annotations

from .urlparse import is_ip_host, to_lower_ascii


class PublicSuffixList:
    def __init__(self, text: str) -> None:
        self.normal: set[str] = set()
        self.wildcard: set[str] = set()
        self.exception: set[str] = set()
        for line in text.split("\n"):
            line = line.rstrip("\r ")
            if not line or line.startswith("//"):
                continue
            line = to_lower_ascii(line)
            if line[0] == "!":
                self.exception.add(line[1:])
            elif line.startswith("*."):
                self.wildcard.add(line[2:])
            else:
                self.normal.add(line)

    def suffix_label_count(self, labels: list[str]) -> int:
        n = len(labels)
        if n == 0:
            return 0
        for i in range(n):
            if ".".join(labels[i:]) in self.exception:
                return n - i - 1
        for i in range(n):
            if ".".join(labels[i:]) in self.normal:
                return n - i
            if i + 1 < n and ".".join(labels[i + 1 :]) in self.wildcard:
                return n - i
        return 1

    def registered_domain(self, host: str) -> str:
        if not host or is_ip_host(host):
            return host
        labels = host.split(".")
        sfx = self.suffix_label_count(labels)
        if sfx >= len(labels):
            return host
        return ".".join(labels[len(labels) - sfx - 1 :])
