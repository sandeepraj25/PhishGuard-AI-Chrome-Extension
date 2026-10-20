#include "phishguard/json.h"

#include <cstdlib>

namespace pg {

const JsonValue* JsonValue::get(const std::string& key) const {
  if (type != Type::Object) return nullptr;
  for (const auto& kv : obj)
    if (kv.first == key) return &kv.second;
  return nullptr;
}

namespace {

class Parser {
 public:
  explicit Parser(const std::string& s) : s_(s) {}

  bool parseDocument(JsonValue& out) {
    if (!parseValue(out, 0)) return false;
    skipWs();
    return pos_ == s_.size();
  }

 private:
  static constexpr int kMaxDepth = 64;  // guards against stack exhaustion
  const std::string& s_;
  size_t pos_ = 0;

  void skipWs() {
    while (pos_ < s_.size() && (s_[pos_] == ' ' || s_[pos_] == '\n' || s_[pos_] == '\r' || s_[pos_] == '\t')) ++pos_;
  }

  bool consume(char c) {
    skipWs();
    if (pos_ < s_.size() && s_[pos_] == c) {
      ++pos_;
      return true;
    }
    return false;
  }

  bool literal(const char* word) {
    size_t i = 0;
    while (word[i] != '\0') {
      if (pos_ + i >= s_.size() || s_[pos_ + i] != word[i]) return false;
      ++i;
    }
    pos_ += i;
    return true;
  }

  bool parseValue(JsonValue& v, int depth) {
    if (depth > kMaxDepth) return false;
    skipWs();
    if (pos_ >= s_.size()) return false;
    char c = s_[pos_];
    if (c == '{') return parseObject(v, depth);
    if (c == '[') return parseArray(v, depth);
    if (c == '"') {
      v.type = JsonValue::Type::String;
      return parseString(v.str);
    }
    if (c == 't') { v.type = JsonValue::Type::Bool; v.b = true; return literal("true"); }
    if (c == 'f') { v.type = JsonValue::Type::Bool; v.b = false; return literal("false"); }
    if (c == 'n') { v.type = JsonValue::Type::Null; return literal("null"); }
    return parseNumber(v);
  }

  bool parseNumber(JsonValue& v) {
    size_t start = pos_;
    if (pos_ < s_.size() && (s_[pos_] == '-' || s_[pos_] == '+')) ++pos_;
    while (pos_ < s_.size()) {
      char c = s_[pos_];
      if ((c >= '0' && c <= '9') || c == '.' || c == 'e' || c == 'E' || c == '-' || c == '+') ++pos_;
      else break;
    }
    if (pos_ == start) return false;
    std::string tok = s_.substr(start, pos_ - start);
    char* end = nullptr;
    v.type = JsonValue::Type::Number;
    v.num = std::strtod(tok.c_str(), &end);
    return end != nullptr && *end == '\0';
  }

  static void appendUtf8(std::string& out, unsigned cp) {
    if (cp < 0x80) {
      out += static_cast<char>(cp);
    } else if (cp < 0x800) {
      out += static_cast<char>(0xC0 | (cp >> 6));
      out += static_cast<char>(0x80 | (cp & 0x3F));
    } else if (cp < 0x10000) {
      out += static_cast<char>(0xE0 | (cp >> 12));
      out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
      out += static_cast<char>(0x80 | (cp & 0x3F));
    } else {
      out += static_cast<char>(0xF0 | (cp >> 18));
      out += static_cast<char>(0x80 | ((cp >> 12) & 0x3F));
      out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
      out += static_cast<char>(0x80 | (cp & 0x3F));
    }
  }

  bool readHex4(unsigned& out) {
    if (pos_ + 4 > s_.size()) return false;
    out = 0;
    for (int i = 0; i < 4; ++i) {
      char c = s_[pos_++];
      out <<= 4;
      if (c >= '0' && c <= '9') out |= static_cast<unsigned>(c - '0');
      else if (c >= 'a' && c <= 'f') out |= static_cast<unsigned>(c - 'a' + 10);
      else if (c >= 'A' && c <= 'F') out |= static_cast<unsigned>(c - 'A' + 10);
      else return false;
    }
    return true;
  }

  bool parseString(std::string& out) {
    ++pos_;  // opening quote
    out.clear();
    while (pos_ < s_.size()) {
      char c = s_[pos_++];
      if (c == '"') return true;
      if (c != '\\') { out += c; continue; }
      if (pos_ >= s_.size()) return false;
      char e = s_[pos_++];
      switch (e) {
        case '"': out += '"'; break;
        case '\\': out += '\\'; break;
        case '/': out += '/'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'n': out += '\n'; break;
        case 'r': out += '\r'; break;
        case 't': out += '\t'; break;
        case 'u': {
          unsigned cp = 0;
          if (!readHex4(cp)) return false;
          // Combine UTF-16 surrogate pairs into one code point.
          if (cp >= 0xD800 && cp <= 0xDBFF && pos_ + 6 <= s_.size() && s_[pos_] == '\\' && s_[pos_ + 1] == 'u') {
            pos_ += 2;
            unsigned lo = 0;
            if (!readHex4(lo)) return false;
            cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
          }
          appendUtf8(out, cp);
          break;
        }
        default: return false;
      }
    }
    return false;
  }

  bool parseArray(JsonValue& v, int depth) {
    ++pos_;
    v.type = JsonValue::Type::Array;
    if (consume(']')) return true;
    while (true) {
      JsonValue item;
      if (!parseValue(item, depth + 1)) return false;
      v.arr.push_back(std::move(item));
      if (consume(',')) continue;
      return consume(']');
    }
  }

  bool parseObject(JsonValue& v, int depth) {
    ++pos_;
    v.type = JsonValue::Type::Object;
    if (consume('}')) return true;
    while (true) {
      skipWs();
      if (pos_ >= s_.size() || s_[pos_] != '"') return false;
      std::string key;
      if (!parseString(key)) return false;
      if (!consume(':')) return false;
      JsonValue item;
      if (!parseValue(item, depth + 1)) return false;
      v.obj.emplace_back(std::move(key), std::move(item));
      if (consume(',')) continue;
      return consume('}');
    }
  }
};

}  // namespace

bool parseJson(const std::string& text, JsonValue& out) {
  out = JsonValue();
  Parser p(text);
  return p.parseDocument(out);
}

}  // namespace pg
