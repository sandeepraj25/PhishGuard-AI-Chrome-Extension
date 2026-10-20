// minigtest: a tiny GoogleTest-compatible subset (TEST, EXPECT_*, ASSERT_*).
// Used ONLY when real GoogleTest is unavailable (offline build sandbox). The test sources
// are written against the real GoogleTest API, so they compile unchanged with it.
#pragma once
#include <cmath>
#include <functional>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

namespace minigtest {
struct TestCase { std::string name; std::function<void()> fn; };
inline std::vector<TestCase>& registry() { static std::vector<TestCase> r; return r; }
inline bool& currentFailed() { static bool f = false; return f; }
struct Registrar {
  Registrar(const char* suite, const char* name, std::function<void()> fn) {
    registry().push_back({std::string(suite) + "." + name, std::move(fn)});
  }
};
template <typename T> std::string show(const T& v) { std::ostringstream ss; ss << v; return ss.str(); }
inline std::string show(const std::string& v) { return "\"" + v + "\""; }
inline void fail(const char* file, int line, const std::string& msg) {
  currentFailed() = true;
  std::cerr << file << ":" << line << ": Failure\n  " << msg << "\n";
}
inline int runAll() {
  int failed = 0;
  for (auto& t : registry()) {
    currentFailed() = false;
    std::cout << "[ RUN      ] " << t.name << "\n";
    t.fn();
    std::cout << (currentFailed() ? "[  FAILED  ] " : "[       OK ] ") << t.name << "\n";
    if (currentFailed()) ++failed;
  }
  std::cout << "[==========] " << registry().size() << " tests, " << failed << " failed\n";
  return failed == 0 ? 0 : 1;
}
}  // namespace minigtest

namespace testing { inline void InitGoogleTest(int*, char**) {} }
#define RUN_ALL_TESTS() ::minigtest::runAll()

#define TEST(suite, name)                                                                   \
  static void suite##_##name##_impl();                                                     \
  static ::minigtest::Registrar suite##_##name##_reg(#suite, #name, suite##_##name##_impl); \
  static void suite##_##name##_impl()

#define MG_CMP(a, b, op, fatal)                                                                       \
  do {                                                                                                \
    auto&& _va = (a); auto&& _vb = (b);                                                               \
    if (!(_va op _vb)) {                                                                              \
      ::minigtest::fail(__FILE__, __LINE__, std::string(#a " " #op " " #b "\n  left: ") +             \
                        ::minigtest::show(_va) + "\n  right: " + ::minigtest::show(_vb));             \
      if (fatal) return;                                                                              \
    }                                                                                                 \
  } while (0)

#define EXPECT_EQ(a, b) MG_CMP(a, b, ==, false)
#define EXPECT_NE(a, b) MG_CMP(a, b, !=, false)
#define EXPECT_LT(a, b) MG_CMP(a, b, <, false)
#define EXPECT_LE(a, b) MG_CMP(a, b, <=, false)
#define EXPECT_GT(a, b) MG_CMP(a, b, >, false)
#define EXPECT_GE(a, b) MG_CMP(a, b, >=, false)
#define ASSERT_EQ(a, b) MG_CMP(a, b, ==, true)
#define ASSERT_NE(a, b) MG_CMP(a, b, !=, true)
#define ASSERT_GT(a, b) MG_CMP(a, b, >, true)
#define EXPECT_TRUE(c) MG_CMP(static_cast<bool>(c), true, ==, false)
#define EXPECT_FALSE(c) MG_CMP(static_cast<bool>(c), false, ==, false)
#define ASSERT_TRUE(c) MG_CMP(static_cast<bool>(c), true, ==, true)
#define ASSERT_FALSE(c) MG_CMP(static_cast<bool>(c), false, ==, true)
#define EXPECT_STREQ(a, b) MG_CMP(std::string(a), std::string(b), ==, false)
#define EXPECT_NEAR(a, b, tol) MG_CMP(std::fabs((a) - (b)) <= (tol), true, ==, false)
#define EXPECT_DOUBLE_EQ(a, b) EXPECT_NEAR(a, b, 1e-12 * (1.0 + std::fabs(b)))
