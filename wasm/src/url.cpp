#include "phishguard/url.h"

namespace pg {

std::string toLowerAscii(std::string s) {
  for (auto& c : s)
    if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
  return s;
}

std::string normalizeUrl(const std::string& raw) {
  size_t b = 0, e = raw.size();
  while (b < e && static_cast<unsigned char>(raw[b]) <= 0x20) ++b;
  while (e > b && static_cast<unsigned char>(raw[e - 1]) <= 0x20) --e;
  static const char* kHex = "0123456789ABCDEF";
  std::string out;
  out.reserve(e - b);
  for (size_t i = b; i < e; ++i) {
    unsigned char c = static_cast<unsigned char>(raw[i]);
    if (c >= 0x80) {
      out += '%';
      out += kHex[c >> 4];
      out += kHex[c & 0xF];
    } else {
      out += static_cast<char>(c);
    }
  }
  return out;
}

static bool isSchemeChar(char c, bool first) {
  bool alpha = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
  if (first) return alpha;
  return alpha || (c >= '0' && c <= '9') || c == '+' || c == '.' || c == '-';
}

ParsedUrl parseUrl(const std::string& raw) {
  ParsedUrl u;
  u.normalized = normalizeUrl(raw);
  const std::string& s = u.normalized;

  std::string rest = s;
  size_t sep = s.find("://");
  if (sep != std::string::npos && sep > 0) {
    bool ok = true;
    for (size_t i = 0; i < sep; ++i)
      if (!isSchemeChar(s[i], i == 0)) { ok = false; break; }
    if (ok) {
      u.scheme = toLowerAscii(s.substr(0, sep));
      rest = s.substr(sep + 3);
    }
  }

  size_t authEnd = rest.find_first_of("/?#");
  if (authEnd == std::string::npos) authEnd = rest.size();
  std::string authority = rest.substr(0, authEnd);
  std::string remainder = rest.substr(authEnd);

  size_t at = authority.rfind('@');
  u.hasAt = at != std::string::npos;
  std::string hostPort = u.hasAt ? authority.substr(at + 1) : authority;

  std::string host;
  if (!hostPort.empty() && hostPort[0] == '[') {
    size_t close = hostPort.find(']');
    if (close == std::string::npos) {
      host = hostPort;
    } else {
      host = hostPort.substr(0, close + 1);
      if (close + 1 < hostPort.size() && hostPort[close + 1] == ':') u.port = hostPort.substr(close + 2);
    }
  } else {
    size_t colon = hostPort.rfind(':');
    if (colon != std::string::npos) {
      host = hostPort.substr(0, colon);
      u.port = hostPort.substr(colon + 1);
    } else {
      host = hostPort;
    }
  }
  host = toLowerAscii(host);
  while (!host.empty() && host.back() == '.') host.pop_back();
  u.host = host;

  size_t hash = remainder.find('#');
  if (hash != std::string::npos) remainder = remainder.substr(0, hash);
  size_t q = remainder.find('?');
  if (q != std::string::npos) {
    u.hasQuery = true;
    u.query = remainder.substr(q + 1);
    u.path = remainder.substr(0, q);
  } else {
    u.path = remainder;
  }
  return u;
}

std::vector<std::string> split(const std::string& s, char sep) {
  std::vector<std::string> out;
  size_t start = 0;
  while (true) {
    size_t p = s.find(sep, start);
    if (p == std::string::npos) {
      out.push_back(s.substr(start));
      return out;
    }
    out.push_back(s.substr(start, p - start));
    start = p + 1;
  }
}

std::vector<std::string> splitNonEmpty(const std::string& s, char sep) {
  std::vector<std::string> out;
  for (auto& part : split(s, sep))
    if (!part.empty()) out.push_back(part);
  return out;
}

bool isIpHost(const std::string& host) {
  if (host.empty()) return false;
  if (host[0] == '[') return true;  // bracketed IPv6 literal
  bool allDigits = true;
  for (char c : host)
    if (c < '0' || c > '9') { allDigits = false; break; }
  if (allDigits) return true;  // integer form, e.g. http://3232235777/
  auto parts = split(host, '.');
  if (parts.size() != 4) return false;
  for (auto& p : parts) {
    if (p.empty() || p.size() > 3) return false;
    for (char c : p)
      if (c < '0' || c > '9') return false;
  }
  return true;
}

}  // namespace pg
