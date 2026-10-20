"""Bloom filter with the same hashing and file format as wasm/src/bloom.cpp."""
from __future__ import annotations

import math
import struct

MASK64 = (1 << 64) - 1
BASIS1 = 0xCBF29CE484222325
BASIS2 = 0x84222325CBF29CE4
PRIME = 0x100000001B3


def fnv1a64(s: str, basis: int) -> int:
    h = basis
    for c in s.encode("utf-8"):
        h ^= c
        h = (h * PRIME) & MASK64
    return h


class BloomFilter:
    def __init__(self, m_bits: int, k: int) -> None:
        self.m = m_bits
        self.k = k
        self.n = 0
        self.bits = bytearray((m_bits + 7) // 8)

    @classmethod
    def for_capacity(cls, n: int, p: float) -> "BloomFilter":
        n = max(n, 1)
        ln2 = 0.6931471805599453
        m = math.ceil(-n * math.log(p) / (ln2 * ln2))
        k = max(1, round(m / n * ln2))
        return cls(m, k)

    def _indexes(self, key: str):
        h1 = fnv1a64(key, BASIS1)
        h2 = fnv1a64(key, BASIS2) | 1
        for j in range(self.k):
            yield ((h1 + j * h2) & MASK64) % self.m

    def add(self, key: str) -> None:
        for idx in self._indexes(key):
            self.bits[idx >> 3] |= 1 << (idx & 7)
        self.n += 1

    def __contains__(self, key: str) -> bool:
        return all(self.bits[idx >> 3] & (1 << (idx & 7)) for idx in self._indexes(key))

    def serialize(self) -> bytes:
        return b"PGBF" + struct.pack("<IQII", 1, self.m, self.k, self.n) + bytes(self.bits)

    @classmethod
    def deserialize(cls, data: bytes) -> "BloomFilter":
        if data[:4] != b"PGBF":
            raise ValueError("bad magic")
        version, m, k, n = struct.unpack("<IQII", data[4:24])
        if version != 1 or len(data) != 24 + (m + 7) // 8:
            raise ValueError("bad bloom header")
        bf = cls(m, k)
        bf.n = n
        bf.bits = bytearray(data[24:])
        return bf
