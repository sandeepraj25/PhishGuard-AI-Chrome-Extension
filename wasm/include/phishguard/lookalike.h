// Look-alike domain helpers: punycode decoding, script detection, homoglyph skeletons
// and banded edit distance. Mirrored exactly in ml/phishguard_ml/lookalike.py.
#pragma once
#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

namespace pg {

// RFC 3492 decode of the part after "xn--". Returns false on malformed input or overflow.
bool punycodeDecode(const std::string& input, std::vector<uint32_t>& out);

// Code points of a host label: punycode-decoded for "xn--" labels (raw bytes on failure),
// raw bytes otherwise.
std::vector<uint32_t> labelCodePoints(const std::string& label);

enum class Script { None, Latin, Greek, Cyrillic, Hebrew, Arabic, Devanagari, Bengali, Thai, Han, Kana, Hangul, Other };
// Script of a letter code point; digits, '-', '_' and other ASCII symbols give Script::None.
Script scriptOf(uint32_t cp);
// True if the letters in `cps` come from more than one script.
bool isMixedScript(const std::vector<uint32_t>& cps);

using ConfusableMap = std::unordered_map<uint32_t, std::string>;

// Skeleton: map each code point through `map` (ASCII is lower-cased, unmapped non-ASCII -> '?'),
// then apply ASCII rules 0->o, 1->l, and left-to-right "rn"->"m", "vv"->"w".
std::string skeleton(const std::vector<uint32_t>& cps, const ConfusableMap& map);
std::string skeletonAscii(const std::string& s, const ConfusableMap& map);

// Levenshtein distance capped at k+1. Only cells within k of the diagonal are computed and
// the loop stops as soon as a whole row exceeds k. Time O(k * min(|a|,|b|)), space O(|b|).
int boundedEditDistance(const std::string& a, const std::string& b, int k);

}  // namespace pg
