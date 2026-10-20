#pragma once
#include <fstream>
#include <sstream>
#include <string>

#include "phishguard/features.h"

inline std::string readShared(const std::string& name) {
  std::ifstream in(std::string(PG_SHARED_DIR) + "/" + name, std::ios::binary);
  std::stringstream ss;
  ss << in.rdbuf();
  return ss.str();
}

inline const pg::FeatureEngine& engine() {
  static pg::FeatureEngine e;
  static bool loaded = e.load(readShared("psl_ascii.txt"), readShared("brands.json"), readShared("confusables.json"),
                              readShared("suspicious_tokens.json"), readShared("risky_tlds.json"));
  (void)loaded;
  return e;
}
