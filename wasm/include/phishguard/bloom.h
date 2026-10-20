// Bloom filter for known-bad registered domains.
//
// File format (little-endian), shared with ml/scripts/build_bloom.py and backend/src/lib/bloom.ts:
//   "PGBF" | u32 version=1 | u64 m (bits) | u32 k (hashes) | u32 n (items) | ceil(m/8) bytes
// Bit index i of the j-th hash: (h1 + j*h2) mod m  (Kirsch–Mitzenmacher double hashing),
// h1 = FNV-1a-64(key), h2 = FNV-1a-64 with a different offset basis, forced odd.
#pragma once
#include <cstdint>
#include <string>
#include <vector>

namespace pg {

uint64_t fnv1a64(const std::string& s, uint64_t basis);

class BloomFilter {
 public:
  static constexpr uint64_t kBasis1 = 0xcbf29ce484222325ULL;
  static constexpr uint64_t kBasis2 = 0x84222325cbf29ce4ULL;

  BloomFilter() = default;
  BloomFilter(uint64_t mBits, uint32_t k);

  // Optimal m and k for n items at false-positive rate p: m = -n ln p / (ln 2)^2, k = (m/n) ln 2.
  static BloomFilter forCapacity(uint32_t n, double p);

  void add(const std::string& key);
  bool mightContain(const std::string& key) const;

  bool deserialize(const uint8_t* data, size_t len);
  std::vector<uint8_t> serialize() const;

  uint64_t bits() const { return m_; }
  uint32_t hashes() const { return k_; }
  uint32_t items() const { return n_; }
  bool loaded() const { return m_ > 0; }

 private:
  uint64_t m_ = 0;
  uint32_t k_ = 0;
  uint32_t n_ = 0;
  std::vector<uint8_t> bits_;
};

}  // namespace pg
