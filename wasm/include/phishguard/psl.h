// Public Suffix List lookup (https://publicsuffix.org/list/ algorithm).
// Rules come from shared/psl_ascii.txt (one rule per line, ASCII/punycode form).
#pragma once
#include <string>
#include <unordered_set>
#include <vector>

namespace pg {

class PublicSuffixList {
 public:
  // Loads newline-separated rules. Lines starting with "//" and blank lines are ignored.
  void load(const std::string& text);
  size_t size() const { return normal_.size() + wildcard_.size() + exception_.size(); }

  // Number of trailing labels that form the public suffix (at least 1 for non-empty input).
  size_t suffixLabelCount(const std::vector<std::string>& labels) const;

  // eTLD+1, e.g. "a.b.example.co.uk" -> "example.co.uk". IP hosts and hosts that are
  // themselves a public suffix are returned unchanged.
  std::string registeredDomain(const std::string& host) const;

 private:
  std::unordered_set<std::string> normal_;     // "co.uk"
  std::unordered_set<std::string> wildcard_;   // "*.ck" stored as "ck"
  std::unordered_set<std::string> exception_;  // "!www.ck" stored as "www.ck"
};

std::string joinLabels(const std::vector<std::string>& labels, size_t from);

}  // namespace pg
