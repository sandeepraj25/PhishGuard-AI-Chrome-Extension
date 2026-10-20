#include "phishguard/psl.h"

#include "phishguard/url.h"

namespace pg {

std::string joinLabels(const std::vector<std::string>& labels, size_t from) {
  std::string out;
  for (size_t i = from; i < labels.size(); ++i) {
    if (i > from) out += '.';
    out += labels[i];
  }
  return out;
}

void PublicSuffixList::load(const std::string& text) {
  normal_.clear();
  wildcard_.clear();
  exception_.clear();
  for (auto line : split(text, '\n')) {
    while (!line.empty() && (line.back() == '\r' || line.back() == ' ')) line.pop_back();
    if (line.empty() || line.rfind("//", 0) == 0) continue;
    line = toLowerAscii(line);
    if (line[0] == '!') exception_.insert(line.substr(1));
    else if (line.rfind("*.", 0) == 0) wildcard_.insert(line.substr(2));
    else normal_.insert(line);
  }
}

size_t PublicSuffixList::suffixLabelCount(const std::vector<std::string>& labels) const {
  const size_t n = labels.size();
  if (n == 0) return 0;
  // 1) Exception rules win over everything: suffix is the exception minus its first label.
  for (size_t i = 0; i < n; ++i)
    if (exception_.count(joinLabels(labels, i))) return n - i - 1;
  // 2) Longest matching normal or wildcard rule (smallest start index i).
  for (size_t i = 0; i < n; ++i) {
    if (normal_.count(joinLabels(labels, i))) return n - i;
    if (i + 1 < n && wildcard_.count(joinLabels(labels, i + 1))) return n - i;
  }
  // 3) Default rule "*": the last label is the suffix.
  return 1;
}

std::string PublicSuffixList::registeredDomain(const std::string& host) const {
  if (host.empty() || isIpHost(host)) return host;
  auto labels = split(host, '.');
  size_t sfx = suffixLabelCount(labels);
  if (sfx >= labels.size()) return host;  // host is itself a public suffix
  return joinLabels(labels, labels.size() - sfx - 1);
}

}  // namespace pg
