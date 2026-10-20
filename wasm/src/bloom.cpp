#include "phishguard/bloom.h"

#include <cmath>

namespace pg {

uint64_t fnv1a64(const std::string& s, uint64_t basis) {
  uint64_t h = basis;
  for (unsigned char c : s) {
    h ^= c;
    h *= 0x100000001b3ULL;  // wraps mod 2^64, same as the Python/TS mirrors
  }
  return h;
}

BloomFilter::BloomFilter(uint64_t mBits, uint32_t k) : m_(mBits), k_(k), bits_((mBits + 7) / 8, 0) {}

BloomFilter BloomFilter::forCapacity(uint32_t n, double p) {
  if (n == 0) n = 1;
  const double ln2 = 0.6931471805599453;
  double m = std::ceil(-static_cast<double>(n) * std::log(p) / (ln2 * ln2));
  uint32_t k = static_cast<uint32_t>(std::max(1.0, std::round(m / n * ln2)));
  return BloomFilter(static_cast<uint64_t>(m), k);
}

void BloomFilter::add(const std::string& key) {
  uint64_t h1 = fnv1a64(key, kBasis1), h2 = fnv1a64(key, kBasis2) | 1ULL;
  for (uint32_t j = 0; j < k_; ++j) {
    uint64_t idx = (h1 + static_cast<uint64_t>(j) * h2) % m_;
    bits_[idx >> 3] |= static_cast<uint8_t>(1u << (idx & 7));
  }
  ++n_;
}

bool BloomFilter::mightContain(const std::string& key) const {
  if (m_ == 0) return false;
  uint64_t h1 = fnv1a64(key, kBasis1), h2 = fnv1a64(key, kBasis2) | 1ULL;
  for (uint32_t j = 0; j < k_; ++j) {
    uint64_t idx = (h1 + static_cast<uint64_t>(j) * h2) % m_;
    if (!(bits_[idx >> 3] & (1u << (idx & 7)))) return false;
  }
  return true;
}

static uint64_t readLe(const uint8_t* p, int bytes) {
  uint64_t v = 0;
  for (int i = bytes - 1; i >= 0; --i) v = (v << 8) | p[i];
  return v;
}

static void writeLe(std::vector<uint8_t>& out, uint64_t v, int bytes) {
  for (int i = 0; i < bytes; ++i) out.push_back(static_cast<uint8_t>((v >> (8 * i)) & 0xFF));
}

bool BloomFilter::deserialize(const uint8_t* data, size_t len) {
  const size_t header = 4 + 4 + 8 + 4 + 4;
  if (len < header || data[0] != 'P' || data[1] != 'G' || data[2] != 'B' || data[3] != 'F') return false;
  if (readLe(data + 4, 4) != 1) return false;
  uint64_t m = readLe(data + 8, 8);
  uint32_t k = static_cast<uint32_t>(readLe(data + 16, 4));
  uint32_t n = static_cast<uint32_t>(readLe(data + 20, 4));
  if (m == 0 || k == 0 || k > 64 || len != header + (m + 7) / 8) return false;
  m_ = m;
  k_ = k;
  n_ = n;
  bits_.assign(data + header, data + len);
  return true;
}

std::vector<uint8_t> BloomFilter::serialize() const {
  std::vector<uint8_t> out = {'P', 'G', 'B', 'F'};
  writeLe(out, 1, 4);
  writeLe(out, m_, 8);
  writeLe(out, k_, 4);
  writeLe(out, n_, 4);
  out.insert(out.end(), bits_.begin(), bits_.end());
  return out;
}

}  // namespace pg
