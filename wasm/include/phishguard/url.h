// URL normalisation + parsing. Deliberately simple and fully specified so that the
// Python mirror (ml/phishguard_ml/urlparse.py) produces identical results.
// We do NOT use WHATWG URL parsing here: the browser already gives us a canonical URL;
// this parser only has to be stable and identical across languages.
#pragma once
#include <string>
#include <vector>

namespace pg {

struct ParsedUrl {
  std::string normalized;  // trimmed, bytes >= 0x80 percent-encoded
  std::string scheme;      // lower-case, empty if absent
  std::string host;        // lower-case, trailing dots removed
  std::string port;        // raw digits after ':' (may be empty)
  std::string path;        // from first '/' up to '?' or '#'
  std::string query;       // after '?' up to '#', without '?'
  bool hasQuery = false;
  bool hasAt = false;      // '@' present in the authority
};

std::string normalizeUrl(const std::string& raw);
ParsedUrl parseUrl(const std::string& raw);

std::vector<std::string> splitNonEmpty(const std::string& s, char sep);
std::vector<std::string> split(const std::string& s, char sep);  // keeps empty parts
std::string toLowerAscii(std::string s);
bool isIpHost(const std::string& host);

}  // namespace pg
