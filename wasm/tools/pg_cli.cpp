// Native CLI used by the parity test and for debugging.
//   pg_cli features <shared_dir>   stdin: "url\tdomain_age\tcert_age" per line
//                                  stdout: 26 features as hex IEEE-754 bit patterns, tab, details JSON
//   pg_cli bloom <file.bin>        stdin: one domain per line; stdout: 1/0
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>

#include "phishguard/features.h"

static std::string readFile(const std::string& path) {
  std::ifstream in(path, std::ios::binary);
  std::stringstream ss;
  ss << in.rdbuf();
  return ss.str();
}

int main(int argc, char** argv) {
  if (argc < 3) {
    std::fprintf(stderr, "usage: pg_cli features <shared_dir> | pg_cli bloom <file>\n");
    return 2;
  }
  std::string mode = argv[1];
  if (mode == "features") {
    std::string d = argv[2];
    pg::FeatureEngine eng;
    if (!eng.load(readFile(d + "/psl_ascii.txt"), readFile(d + "/brands.json"), readFile(d + "/confusables.json"),
                  readFile(d + "/suspicious_tokens.json"), readFile(d + "/risky_tlds.json"))) {
      std::fprintf(stderr, "failed to load shared data from %s\n", d.c_str());
      return 1;
    }
    std::string line;
    double f[pg::kNumUrlFeatures];
    while (std::getline(std::cin, line)) {
      std::string url = line, a = "-1", c = "-1";
      size_t t1 = line.find('\t');
      if (t1 != std::string::npos) {
        url = line.substr(0, t1);
        size_t t2 = line.find('\t', t1 + 1);
        a = line.substr(t1 + 1, t2 == std::string::npos ? std::string::npos : t2 - t1 - 1);
        if (t2 != std::string::npos) c = line.substr(t2 + 1);
      }
      pg::MatchDetails det;
      eng.extract(url, std::strtod(a.c_str(), nullptr), std::strtod(c.c_str(), nullptr), f, &det);
      for (int i = 0; i < pg::kNumUrlFeatures; ++i) {
        uint64_t bits;
        std::memcpy(&bits, &f[i], sizeof bits);
        std::printf("%016llx%s", static_cast<unsigned long long>(bits), i + 1 < pg::kNumUrlFeatures ? " " : "");
      }
      std::printf("\t%s\n", det.toJson().c_str());
    }
    return 0;
  }
  if (mode == "bloom") {
    std::string data = readFile(argv[2]);
    pg::BloomFilter bf;
    if (!bf.deserialize(reinterpret_cast<const uint8_t*>(data.data()), data.size())) {
      std::fprintf(stderr, "bad bloom file\n");
      return 1;
    }
    std::string line;
    while (std::getline(std::cin, line)) std::printf("%d\n", bf.mightContain(line) ? 1 : 0);
    return 0;
  }
  return 2;
}
