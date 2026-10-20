#include "phishguard/features.h"

#include <algorithm>
#include <cstdlib>

#include "phishguard/detmath.h"
#include "phishguard/json.h"
#include "phishguard/url.h"

namespace pg {

namespace {

constexpr size_t kLongToken = 5;  // tokens this long match as substrings; shorter ones need a whole part
constexpr int kMaxEdit = 2;

std::string jsonEscape(const std::string& s) {
  std::string out;
  for (unsigned char c : s) {
    if (c == '"' || c == '\\') { out += '\\'; out += static_cast<char>(c); }
    else if (c < 0x20) { static const char* h = "0123456789abcdef"; out += "\\u00"; out += h[c >> 4]; out += h[c & 15]; }
    else out += static_cast<char>(c);
  }
  return out;
}

size_t countChar(const std::string& s, char ch) { return static_cast<size_t>(std::count(s.begin(), s.end(), ch)); }

size_t countDigits(const std::string& s) {
  return static_cast<size_t>(std::count_if(s.begin(), s.end(), [](char c) { return c >= '0' && c <= '9'; }));
}

// Splits every label on '-' and returns the non-empty parts.
std::vector<std::string> labelParts(const std::vector<std::string>& labels) {
  std::vector<std::string> parts;
  for (const auto& l : labels)
    for (auto& p : splitNonEmpty(l, '-')) parts.push_back(p);
  return parts;
}

bool tokenHit(const std::string& token, const std::string& joined, const std::vector<std::string>& parts) {
  if (token.size() >= kLongToken) return joined.find(token) != std::string::npos;
  return std::find(parts.begin(), parts.end(), token) != parts.end();
}

bool loadStringArray(const JsonValue* arr, std::vector<std::string>& out) {
  if (arr == nullptr || !arr->isArray()) return false;
  for (const auto& v : arr->arr) {
    if (!v.isString()) return false;
    out.push_back(toLowerAscii(v.str));
  }
  return true;
}

}  // namespace

std::string MatchDetails::toJson() const {
  return std::string("{\"registered_domain\":\"") + jsonEscape(registeredDomain) + "\",\"brand\":\"" +
         jsonEscape(brandId) + "\",\"brand_name\":\"" + jsonEscape(brandName) + "\",\"official_domain\":\"" +
         jsonEscape(officialDomain) + "\",\"kind\":\"" + jsonEscape(kind) + "\",\"matched\":\"" +
         jsonEscape(matchedText) + "\",\"edit_distance\":" + std::to_string(editDistance) + "}";
}

bool FeatureEngine::load(const std::string& pslText, const std::string& brandsJson, const std::string& confusablesJson,
                         const std::string& tokensJson, const std::string& tldsJson) {
  psl_.load(pslText);
  if (psl_.size() == 0) return false;

  JsonValue conf;
  if (!parseJson(confusablesJson, conf) || conf.get("map") == nullptr || !conf.get("map")->isObject()) return false;
  confusables_.clear();
  for (const auto& kv : conf.get("map")->obj) {
    if (!kv.second.isString()) return false;
    confusables_[static_cast<uint32_t>(std::strtoul(kv.first.c_str(), nullptr, 16))] = kv.second.str;
  }

  JsonValue brands;
  if (!parseJson(brandsJson, brands) || brands.get("brands") == nullptr || !brands.get("brands")->isArray()) return false;
  brands_.clear();
  for (const auto& b : brands.get("brands")->arr) {
    Brand br;
    if (b.get("id") == nullptr || b.get("name") == nullptr) return false;
    br.id = b.get("id")->str;
    br.name = b.get("name")->str;
    std::vector<std::string> officials;
    if (!loadStringArray(b.get("tokens"), br.tokens) || !loadStringArray(b.get("official_domains"), officials)) return false;
    for (const auto& t : br.tokens) br.tokenSkeletons.push_back(skeletonAscii(t, confusables_));
    br.official.insert(officials.begin(), officials.end());
    br.primaryDomain = officials.empty() ? "" : officials.front();
    brands_.push_back(std::move(br));
  }

  JsonValue toks, tlds;
  suspiciousTokens_.clear();
  riskyTlds_.clear();
  if (!parseJson(tokensJson, toks) || !loadStringArray(toks.get("tokens"), suspiciousTokens_)) return false;
  // De-duplicate while keeping order so each token counts once.
  std::vector<std::string> uniq;
  for (auto& t : suspiciousTokens_)
    if (std::find(uniq.begin(), uniq.end(), t) == uniq.end()) uniq.push_back(t);
  suspiciousTokens_ = uniq;
  std::vector<std::string> tldList;
  if (!parseJson(tldsJson, tlds) || !loadStringArray(tlds.get("tlds"), tldList)) return false;
  riskyTlds_.insert(tldList.begin(), tldList.end());
  return true;
}

std::string FeatureEngine::registeredDomain(const std::string& url) const {
  return psl_.registeredDomain(parseUrl(url).host);
}

void FeatureEngine::extract(const std::string& url, double domainAgeDays, double certAgeDays, double* f,
                            MatchDetails* details) const {
  const ParsedUrl u = parseUrl(url);
  const std::string& s = u.normalized;
  const std::string& host = u.host;
  const std::string lowerUrl = toLowerAscii(s);
  const std::string pathQuery = u.path + (u.hasQuery ? "?" + u.query : std::string());
  const std::string lowerPathQuery = toLowerAscii(pathQuery);
  const bool ip = isIpHost(host);
  const std::vector<std::string> labels = host.empty() ? std::vector<std::string>() : split(host, '.');
  const std::string reg = psl_.registeredDomain(host);

  f[0] = static_cast<double>(s.size());
  f[1] = static_cast<double>(host.size());
  f[2] = static_cast<double>(pathQuery.size());
  f[3] = static_cast<double>(countChar(host, '.'));
  f[4] = (ip || host.empty()) ? 0.0
                              : static_cast<double>(labels.size() - split(reg, '.').size());
  f[5] = static_cast<double>(countChar(host, '-'));
  f[6] = static_cast<double>(countDigits(host));
  f[7] = s.empty() ? 0.0 : static_cast<double>(countDigits(s)) / static_cast<double>(s.size());
  f[8] = shannonEntropy(host);
  f[9] = shannonEntropy(s);

  size_t sus = 0;
  for (const auto& t : suspiciousTokens_)
    if (lowerUrl.find(t) != std::string::npos) ++sus;
  f[10] = static_cast<double>(sus);

  const std::string tld = (ip || labels.empty()) ? std::string() : labels.back();
  f[11] = riskyTlds_.count(tld) ? 1.0 : 0.0;
  f[12] = static_cast<double>(tld.size());

  bool puny = false, mixed = false;
  for (const auto& l : labels) {
    if (l.size() >= 4 && l.compare(0, 4, "xn--") == 0) puny = true;
    if (isMixedScript(labelCodePoints(l))) mixed = true;
  }
  f[13] = puny ? 1.0 : 0.0;
  f[14] = mixed ? 1.0 : 0.0;
  f[15] = ip ? 1.0 : 0.0;
  f[16] = u.hasAt ? 1.0 : 0.0;
  f[17] = static_cast<double>(splitNonEmpty(u.path, '/').size());
  f[18] = static_cast<double>(splitNonEmpty(u.query, '&').size());
  f[19] = (!u.port.empty() && u.port != "80" && u.port != "443") ? 1.0 : 0.0;

  // ---- Brand features -------------------------------------------------------------
  // "Core" labels = host labels without the public suffix (subdomains + registrable label).
  std::vector<std::string> core;
  if (!ip && !labels.empty()) {
    size_t sfx = psl_.suffixLabelCount(labels);
    size_t keep = sfx >= labels.size() ? labels.size() : labels.size() - sfx;
    core.assign(labels.begin(), labels.begin() + static_cast<long>(keep));
  }
  const std::string coreJoined = joinLabels(core, 0);
  const std::vector<std::string> parts = labelParts(core);
  std::vector<std::string> skelLabels;
  for (const auto& l : core) skelLabels.push_back(skeleton(labelCodePoints(l), confusables_));
  const std::string skelJoined = joinLabels(skelLabels, 0);
  const std::vector<std::string> skelParts = labelParts(skelLabels);

  bool brandHost = false, brandPath = false, homoglyph = false, anyOfficial = false;
  int minEdit = kMaxEdit + 1;
  MatchDetails dHomo, dHost, dEdit, dPath;

  for (const auto& b : brands_) {
    if (b.official.count(reg)) { anyOfficial = true; continue; }
    bool rawHit = false, skelHit = false;
    for (size_t ti = 0; ti < b.tokens.size(); ++ti) {
      const std::string& tok = b.tokens[ti];
      if (tokenHit(tok, coreJoined, parts)) {
        rawHit = true;
        if (dHost.kind.empty()) dHost = {reg, b.id, b.name, b.primaryDomain, "host", tok, 0};
      }
      if (tokenHit(b.tokenSkeletons[ti], skelJoined, skelParts)) skelHit = true;
      if (tok.size() >= kLongToken && lowerPathQuery.find(tok) != std::string::npos) {
        brandPath = true;
        if (dPath.kind.empty()) dPath = {reg, b.id, b.name, b.primaryDomain, "path", tok, 3};
      }
      if (tok.size() >= kLongToken) {
        for (const auto& p : parts) {
          if (p.size() < 4) continue;
          int d = boundedEditDistance(p, tok, kMaxEdit);
          if (d < minEdit) {
            minEdit = d;
            dEdit = {reg, b.id, b.name, b.primaryDomain, "edit", p, d};
          }
        }
      }
    }
    if (rawHit) brandHost = true;
    if (skelHit && !rawHit) {
      homoglyph = true;
      if (dHomo.kind.empty()) dHomo = {reg, b.id, b.name, b.primaryDomain, "homoglyph", skelJoined, 0};
    }
  }
  if (anyOfficial) minEdit = kMaxEdit + 1;

  f[20] = brandHost ? 1.0 : 0.0;
  f[21] = brandPath ? 1.0 : 0.0;
  f[22] = static_cast<double>(minEdit);
  f[23] = homoglyph ? 1.0 : 0.0;
  f[24] = domainAgeDays;
  f[25] = certAgeDays;

  if (details != nullptr) {
    if (homoglyph) *details = dHomo;
    else if (brandHost) *details = dHost;
    else if (minEdit <= kMaxEdit) *details = dEdit;
    else if (brandPath) *details = dPath;
    else *details = MatchDetails();
    details->registeredDomain = reg;
  }
}

}  // namespace pg
