#include "phishguard/lookalike.h"

#include <algorithm>

namespace pg {

namespace {
constexpr uint32_t kBase = 36, kTMin = 1, kTMax = 26, kSkew = 38, kDamp = 700;
constexpr uint32_t kInitialBias = 72, kInitialN = 128;
constexpr uint32_t kMaxInt = 0x7FFFFFFF;  // same bound as the Python mirror

uint32_t adapt(uint32_t delta, uint32_t numPoints, bool first) {
  delta = first ? delta / kDamp : delta / 2;
  delta += delta / numPoints;
  uint32_t k = 0;
  while (delta > ((kBase - kTMin) * kTMax) / 2) {
    delta /= kBase - kTMin;
    k += kBase;
  }
  return k + (kBase - kTMin + 1) * delta / (delta + kSkew);
}

int digitValue(char c) {
  if (c >= 'a' && c <= 'z') return c - 'a';
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= '0' && c <= '9') return c - '0' + 26;
  return -1;
}
}  // namespace

bool punycodeDecode(const std::string& input, std::vector<uint32_t>& out) {
  out.clear();
  size_t delim = input.rfind('-');
  size_t pos = 0;
  if (delim != std::string::npos) {
    for (size_t j = 0; j < delim; ++j) {
      unsigned char c = static_cast<unsigned char>(input[j]);
      if (c >= 0x80) return false;
      out.push_back(c);
    }
    pos = delim + 1;
  }
  uint32_t n = kInitialN, i = 0, bias = kInitialBias;
  while (pos < input.size()) {
    uint32_t oldi = i, w = 1;
    for (uint32_t k = kBase;; k += kBase) {
      if (pos >= input.size()) return false;
      int d = digitValue(input[pos++]);
      if (d < 0) return false;
      uint32_t digit = static_cast<uint32_t>(d);
      if (digit > (kMaxInt - i) / w) return false;
      i += digit * w;
      uint32_t t = k <= bias ? kTMin : (k >= bias + kTMax ? kTMax : k - bias);
      if (digit < t) break;
      if (w > kMaxInt / (kBase - t)) return false;
      w *= kBase - t;
    }
    uint32_t len = static_cast<uint32_t>(out.size()) + 1;
    bias = adapt(i - oldi, len, oldi == 0);
    if (i / len > kMaxInt - n) return false;
    n += i / len;
    i %= len;
    if (n > 0x10FFFF) return false;
    out.insert(out.begin() + i, n);
    ++i;
  }
  return true;
}

std::vector<uint32_t> labelCodePoints(const std::string& label) {
  std::vector<uint32_t> cps;
  if (label.size() > 4 && label.compare(0, 4, "xn--") == 0 && punycodeDecode(label.substr(4), cps)) return cps;
  cps.clear();
  for (unsigned char c : label) cps.push_back(c);
  return cps;
}

Script scriptOf(uint32_t cp) {
  if ((cp >= 'a' && cp <= 'z') || (cp >= 'A' && cp <= 'Z')) return Script::Latin;
  if (cp < 0x80) return Script::None;
  if (cp >= 0x00C0 && cp <= 0x024F && cp != 0xD7 && cp != 0xF7) return Script::Latin;
  if (cp >= 0x0370 && cp <= 0x03FF) return Script::Greek;
  if (cp >= 0x0400 && cp <= 0x052F) return Script::Cyrillic;
  if (cp >= 0x0590 && cp <= 0x05FF) return Script::Hebrew;
  if (cp >= 0x0600 && cp <= 0x06FF) return Script::Arabic;
  if (cp >= 0x0900 && cp <= 0x097F) return Script::Devanagari;
  if (cp >= 0x0980 && cp <= 0x09FF) return Script::Bengali;
  if (cp >= 0x0E00 && cp <= 0x0E7F) return Script::Thai;
  if (cp >= 0x4E00 && cp <= 0x9FFF) return Script::Han;
  if (cp >= 0x3040 && cp <= 0x30FF) return Script::Kana;
  if (cp >= 0xAC00 && cp <= 0xD7AF) return Script::Hangul;
  return Script::Other;
}

bool isMixedScript(const std::vector<uint32_t>& cps) {
  Script seen = Script::None;
  for (uint32_t cp : cps) {
    Script s = scriptOf(cp);
    if (s == Script::None) continue;
    if (seen == Script::None) seen = s;
    else if (s != seen) return true;
  }
  return false;
}

static std::string replaceAll(const std::string& s, const std::string& from, const std::string& to) {
  std::string out;
  size_t i = 0;
  while (i < s.size()) {
    if (s.compare(i, from.size(), from) == 0) {
      out += to;
      i += from.size();
    } else {
      out += s[i++];
    }
  }
  return out;
}

std::string skeleton(const std::vector<uint32_t>& cps, const ConfusableMap& map) {
  std::string out;
  for (uint32_t cp : cps) {
    if (cp < 0x80) {
      char c = static_cast<char>(cp);
      if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
      if (c == '0') c = 'o';
      else if (c == '1') c = 'l';
      out += c;
      continue;
    }
    auto it = map.find(cp);
    out += (it != map.end()) ? it->second : std::string("?");
  }
  out = replaceAll(out, "rn", "m");
  out = replaceAll(out, "vv", "w");
  return out;
}

std::string skeletonAscii(const std::string& s, const ConfusableMap& map) {
  std::vector<uint32_t> cps;
  for (unsigned char c : s) cps.push_back(c);
  return skeleton(cps, map);
}

int boundedEditDistance(const std::string& a, const std::string& b, int k) {
  const int n = static_cast<int>(a.size()), m = static_cast<int>(b.size());
  const int inf = k + 1;
  if (std::abs(n - m) > k) return inf;
  std::vector<int> prev(m + 1, inf), cur(m + 1, inf);
  for (int j = 0; j <= std::min(m, k); ++j) prev[j] = j;
  for (int i = 1; i <= n; ++i) {
    std::fill(cur.begin(), cur.end(), inf);
    const int lo = std::max(1, i - k), hi = std::min(m, i + k);
    if (i <= k) cur[0] = i;
    int rowMin = cur[0];
    for (int j = lo; j <= hi; ++j) {
      int cost = (a[i - 1] == b[j - 1]) ? 0 : 1;
      int v = std::min({prev[j - 1] + cost, prev[j] + 1, cur[j - 1] + 1});
      cur[j] = std::min(v, inf);
      rowMin = std::min(rowMin, cur[j]);
    }
    if (rowMin > k) return inf;  // every alignment already costs more than k
    std::swap(prev, cur);
  }
  return std::min(prev[m], inf);
}

}  // namespace pg
