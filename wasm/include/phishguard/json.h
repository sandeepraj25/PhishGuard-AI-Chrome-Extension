// Minimal JSON reader used to load shared/*.json inside WASM.
// Supports objects, arrays, strings (with \uXXXX + surrogate pairs), numbers, true/false/null.
// No exceptions (WASM build uses -fno-exceptions): parse() returns false on error.
#pragma once
#include <string>
#include <utility>
#include <vector>

namespace pg {

struct JsonValue {
  enum class Type { Null, Bool, Number, String, Array, Object };
  Type type = Type::Null;
  bool b = false;
  double num = 0.0;
  std::string str;
  std::vector<JsonValue> arr;
  std::vector<std::pair<std::string, JsonValue>> obj;

  // Returns nullptr when this is not an object or the key is missing.
  const JsonValue* get(const std::string& key) const;
  bool isString() const { return type == Type::String; }
  bool isArray() const { return type == Type::Array; }
  bool isObject() const { return type == Type::Object; }
};

// Parses `text` into `out`. Returns false (and leaves `out` unspecified) on malformed input.
bool parseJson(const std::string& text, JsonValue& out);

}  // namespace pg
