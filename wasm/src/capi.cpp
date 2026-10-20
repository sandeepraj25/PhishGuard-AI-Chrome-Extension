// C ABI exported from the WASM module. The JS side (extension/src/lib/wasm.ts) copies
// input bytes into memory from pg_alloc, calls a function, and reads results back.
// All strings are passed as (pointer, length) pairs; nothing is NUL-terminated.
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <string>

#include "phishguard/bloom.h"
#include "phishguard/features.h"
#include "phishguard/lookalike.h"

#if defined(__EMSCRIPTEN__)
#include <emscripten/emscripten.h>
#define PG_EXPORT extern "C" EMSCRIPTEN_KEEPALIVE
#elif defined(__wasm__)
#define PG_EXPORT extern "C" __attribute__((visibility("default")))
#else
#define PG_EXPORT extern "C"
#endif

namespace {
pg::FeatureEngine g_engine;
pg::BloomFilter g_bloom;
std::string g_out;  // last string result; valid until the next call that returns a string

std::string str(const char* p, uint32_t n) { return std::string(p, n); }
}  // namespace

PG_EXPORT void* pg_alloc(uint32_t n) { return std::malloc(n == 0 ? 1 : n); }
PG_EXPORT void pg_free(void* p) { std::free(p); }
PG_EXPORT uint32_t pg_num_features() { return pg::kNumUrlFeatures; }

// Returns 1 on success.
PG_EXPORT int pg_init(const char* psl, uint32_t pslLen, const char* brands, uint32_t brandsLen, const char* conf,
                      uint32_t confLen, const char* toks, uint32_t toksLen, const char* tlds, uint32_t tldsLen) {
  return g_engine.load(str(psl, pslLen), str(brands, brandsLen), str(conf, confLen), str(toks, toksLen),
                       str(tlds, tldsLen))
             ? 1
             : 0;
}

// Writes kNumUrlFeatures doubles to `out`. Match details JSON is available via pg_result_ptr/len.
PG_EXPORT void pg_extract(const char* url, uint32_t urlLen, double domainAge, double certAge, double* out) {
  pg::MatchDetails d;
  g_engine.extract(str(url, urlLen), domainAge, certAge, out, &d);
  g_out = d.toJson();
}

PG_EXPORT void pg_registered_domain(const char* url, uint32_t urlLen) { g_out = g_engine.registeredDomain(str(url, urlLen)); }

PG_EXPORT const char* pg_result_ptr() { return g_out.data(); }
PG_EXPORT uint32_t pg_result_len() { return static_cast<uint32_t>(g_out.size()); }

PG_EXPORT int pg_bloom_load(const uint8_t* data, uint32_t len) { return g_bloom.deserialize(data, len) ? 1 : 0; }
PG_EXPORT int pg_bloom_contains(const char* key, uint32_t len) { return g_bloom.mightContain(str(key, len)) ? 1 : 0; }
PG_EXPORT uint32_t pg_bloom_items() { return g_bloom.items(); }

PG_EXPORT int pg_edit_distance(const char* a, uint32_t aLen, const char* b, uint32_t bLen, int k) {
  return pg::boundedEditDistance(str(a, aLen), str(b, bLen), k);
}

PG_EXPORT void pg_skeleton(const char* label, uint32_t len) {
  g_out = pg::skeleton(pg::labelCodePoints(str(label, len)), g_engine.confusables());
}
