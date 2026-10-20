// URL feature extractor. The order of the output vector is defined by
// shared/feature_spec.json and mirrored in ml/phishguard_ml/features.py.
#pragma once
#include <string>
#include <unordered_set>
#include <vector>

#include "phishguard/bloom.h"
#include "phishguard/lookalike.h"
#include "phishguard/psl.h"

namespace pg {

constexpr int kNumUrlFeatures = 26;

struct Brand {
  std::string id;
  std::string name;
  std::vector<std::string> tokens;
  std::vector<std::string> tokenSkeletons;
  std::unordered_set<std::string> official;
  std::string primaryDomain;  // first official domain, used in explanations
};

// Which brand rule fired, used to build human-readable reasons.
struct MatchDetails {
  std::string registeredDomain;
  std::string brandId;
  std::string brandName;
  std::string officialDomain;
  std::string kind;  // "homoglyph" | "host" | "edit" | "path" | ""
  std::string matchedText;
  int editDistance = 3;
  std::string toJson() const;
};

class FeatureEngine {
 public:
  // Each argument is the full text of the corresponding shared/ file.
  bool load(const std::string& pslText, const std::string& brandsJson, const std::string& confusablesJson,
            const std::string& tokensJson, const std::string& tldsJson);

  // Fills `out` (size kNumUrlFeatures). domainAgeDays / certAgeDays: -1 when unknown.
  void extract(const std::string& url, double domainAgeDays, double certAgeDays, double* out,
               MatchDetails* details) const;

  std::string registeredDomain(const std::string& url) const;
  const PublicSuffixList& psl() const { return psl_; }
  const ConfusableMap& confusables() const { return confusables_; }
  const std::vector<Brand>& brands() const { return brands_; }

 private:
  PublicSuffixList psl_;
  std::vector<Brand> brands_;
  ConfusableMap confusables_;
  std::vector<std::string> suspiciousTokens_;
  std::unordered_set<std::string> riskyTlds_;
};

}  // namespace pg
