#include <cmath>

#include "gtest/gtest.h"
#include "phishguard/bloom.h"
#include "phishguard/detmath.h"
#include "phishguard/json.h"
#include "phishguard/lookalike.h"
#include "phishguard/url.h"
#include "test_util.h"

// ---------- deterministic math ----------
TEST(DetMath, Log2MatchesLibmClosely) {
  for (double x : {1e-9, 0.001, 0.1, 0.25, 0.3, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 10.0, 1234.5}) {
    EXPECT_NEAR(pg::detLog2(x), std::log2(x), 1e-13 * (1.0 + std::fabs(std::log2(x))));
  }
  EXPECT_EQ(pg::detLog2(1.0), 0.0);
  EXPECT_EQ(pg::detLog2(8.0), 3.0);
}

TEST(DetMath, Entropy) {
  EXPECT_EQ(pg::shannonEntropy(""), 0.0);
  EXPECT_EQ(pg::shannonEntropy("aaaa"), 0.0);
  EXPECT_NEAR(pg::shannonEntropy("ab"), 1.0, 1e-15);
  EXPECT_NEAR(pg::shannonEntropy("abcd"), 2.0, 1e-15);
}

// ---------- JSON ----------
TEST(Json, ParsesNestedAndUnicode) {
  pg::JsonValue v;
  ASSERT_TRUE(pg::parseJson(R"({"a":[1,2.5,true,null],"s":"xé😀"})", v));
  ASSERT_TRUE(v.get("a") != nullptr);
  EXPECT_EQ(v.get("a")->arr.size(), 4u);
  EXPECT_EQ(v.get("s")->str, std::string("x\xC3\xA9\xF0\x9F\x98\x80"));
}

TEST(Json, RejectsMalformed) {
  pg::JsonValue v;
  EXPECT_FALSE(pg::parseJson("{\"a\":", v));
  EXPECT_FALSE(pg::parseJson("[1,2", v));
  EXPECT_FALSE(pg::parseJson("{} trailing", v));
}

// ---------- URL parsing ----------
TEST(Url, ParsesComponents) {
  auto u = pg::parseUrl("  HTTPS://user:pw@Login.ExampleBank.test.evil.com.:8443/a/b/?x=1&y=2#frag ");
  EXPECT_EQ(u.scheme, "https");
  EXPECT_EQ(u.host, "login.examplebank.test.evil.com");
  EXPECT_EQ(u.port, "8443");
  EXPECT_EQ(u.path, "/a/b/");
  EXPECT_EQ(u.query, "x=1&y=2");
  EXPECT_TRUE(u.hasAt);
}

TEST(Url, NoSchemeAndIpv6) {
  auto u = pg::parseUrl("example.com/path");
  EXPECT_EQ(u.scheme, "");
  EXPECT_EQ(u.host, "example.com");
  auto v = pg::parseUrl("http://[::1]:8080/x");
  EXPECT_EQ(v.host, "[::1]");
  EXPECT_EQ(v.port, "8080");
}

TEST(Url, PercentEncodesNonAscii) {
  EXPECT_EQ(pg::normalizeUrl("http://a.com/\xC3\xA9"), "http://a.com/%C3%A9");
}

TEST(Url, IpDetection) {
  EXPECT_TRUE(pg::isIpHost("192.168.0.1"));
  EXPECT_TRUE(pg::isIpHost("3232235777"));
  EXPECT_TRUE(pg::isIpHost("[::1]"));
  EXPECT_FALSE(pg::isIpHost("1.2.3"));
  EXPECT_FALSE(pg::isIpHost("example.com"));
}

// ---------- PSL ----------
TEST(Psl, RegisteredDomain) {
  const auto& psl = engine().psl();
  EXPECT_EQ(psl.registeredDomain("a.b.example.co.uk"), "example.co.uk");
  EXPECT_EQ(psl.registeredDomain("www.onlinesbi.sbi"), "onlinesbi.sbi");
  EXPECT_EQ(psl.registeredDomain("login.examplebank.test"), "examplebank.test");
  EXPECT_EQ(psl.registeredDomain("evil.web.app"), "evil.web.app");   // private suffix
  EXPECT_EQ(psl.registeredDomain("axis.bank.in"), "axis.bank.in");   // local override
  EXPECT_EQ(psl.registeredDomain("co.uk"), "co.uk");                 // host is a suffix
  EXPECT_EQ(psl.registeredDomain("10.0.0.1"), "10.0.0.1");
}

TEST(Psl, WildcardAndException) {
  const auto& psl = engine().psl();
  // "*.ck" with exception "!www.ck"
  EXPECT_EQ(psl.registeredDomain("a.b.ck"), "a.b.ck");
  EXPECT_EQ(psl.registeredDomain("www.ck"), "www.ck");
  EXPECT_EQ(psl.registeredDomain("x.www.ck"), "www.ck");
}

// ---------- look-alikes ----------
TEST(Punycode, DecodesKnownVectors) {
  std::vector<uint32_t> cps;
  ASSERT_TRUE(pg::punycodeDecode("mnchen-3ya", cps));  // "münchen"
  ASSERT_EQ(cps.size(), 7u);
  EXPECT_EQ(cps[1], 0xFCu);
  ASSERT_TRUE(pg::punycodeDecode("80ak6aa92e", cps));  // Cyrillic "аррӏе"
  EXPECT_EQ(cps.size(), 5u);
  EXPECT_FALSE(pg::punycodeDecode("99999999999999999", cps));  // overflow guarded
  EXPECT_FALSE(pg::punycodeDecode("ab!c", cps));
}

TEST(Script, MixedDetection) {
  EXPECT_FALSE(pg::isMixedScript(pg::labelCodePoints("examplebank")));
  // "pаypal" with Cyrillic 'а' (U+0430)
  std::vector<uint32_t> mixed = {'p', 0x430, 'y', 'p', 'a', 'l'};
  EXPECT_TRUE(pg::isMixedScript(mixed));
  std::vector<uint32_t> allCyr = {0x430, 0x440};
  EXPECT_FALSE(pg::isMixedScript(allCyr));
}

TEST(Skeleton, MapsHomoglyphs) {
  const auto& map = engine().confusables();
  std::vector<uint32_t> cps = {'p', 0x430, 'y', 'p', 0x430, 'l'};
  EXPECT_EQ(pg::skeleton(cps, map), "paypal");
  EXPECT_EQ(pg::skeletonAscii("paypa1", map), "paypal");
  EXPECT_EQ(pg::skeletonAscii("rnicrosoft", map), "microsoft");
  EXPECT_EQ(pg::skeletonAscii("vvhatsapp", map), "whatsapp");
}

TEST(EditDistance, Bounded) {
  EXPECT_EQ(pg::boundedEditDistance("examplebank", "examplebank", 2), 0);
  EXPECT_EQ(pg::boundedEditDistance("exarnplebank", "examplebank", 2), 2);
  EXPECT_EQ(pg::boundedEditDistance("examp1ebank", "examplebank", 2), 1);
  EXPECT_EQ(pg::boundedEditDistance("kitten", "sitting", 2), 3);   // true distance 3 -> capped at k+1
  EXPECT_EQ(pg::boundedEditDistance("abc", "abcdef", 2), 3);       // length gap > k
  EXPECT_EQ(pg::boundedEditDistance("", "ab", 2), 2);
  EXPECT_EQ(pg::boundedEditDistance("paypal", "paypla", 2), 2);
}

TEST(EditDistance, MatchesFullDpWhenSmall) {
  // Brute-force full Levenshtein for random short strings and compare with the banded version.
  auto full = [](const std::string& a, const std::string& b) {
    std::vector<std::vector<int>> d(a.size() + 1, std::vector<int>(b.size() + 1));
    for (size_t i = 0; i <= a.size(); ++i) d[i][0] = static_cast<int>(i);
    for (size_t j = 0; j <= b.size(); ++j) d[0][j] = static_cast<int>(j);
    for (size_t i = 1; i <= a.size(); ++i)
      for (size_t j = 1; j <= b.size(); ++j)
        d[i][j] = std::min({d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] != b[j - 1])});
    return d[a.size()][b.size()];
  };
  unsigned seed = 12345;
  auto rnd = [&]() { seed = seed * 1103515245u + 12345u; return (seed >> 16) & 0x7FFF; };
  for (int t = 0; t < 2000; ++t) {
    std::string a, b;
    int la = rnd() % 8, lb = rnd() % 8;
    for (int i = 0; i < la; ++i) a += static_cast<char>('a' + rnd() % 3);
    for (int i = 0; i < lb; ++i) b += static_cast<char>('a' + rnd() % 3);
    int expected = std::min(full(a, b), 3);
    ASSERT_EQ(pg::boundedEditDistance(a, b, 2), expected);
  }
}

// ---------- Bloom ----------
TEST(Bloom, NoFalseNegativesAndRoundTrip) {
  auto bf = pg::BloomFilter::forCapacity(1000, 0.001);
  for (int i = 0; i < 1000; ++i) bf.add("bad" + std::to_string(i) + ".test");
  for (int i = 0; i < 1000; ++i) EXPECT_TRUE(bf.mightContain("bad" + std::to_string(i) + ".test"));
  int fp = 0;
  for (int i = 0; i < 10000; ++i) fp += bf.mightContain("good" + std::to_string(i) + ".test");
  EXPECT_LT(fp, 50);  // expected ~10 at p=0.001
  auto bytes = bf.serialize();
  pg::BloomFilter back;
  ASSERT_TRUE(back.deserialize(bytes.data(), bytes.size()));
  EXPECT_EQ(back.items(), 1000u);
  EXPECT_TRUE(back.mightContain("bad7.test"));
}

TEST(Bloom, RejectsCorruptFile) {
  pg::BloomFilter bf;
  uint8_t junk[30] = {'P', 'G', 'B', 'X'};
  EXPECT_FALSE(bf.deserialize(junk, sizeof junk));
}

TEST(Fnv, KnownVector) {
  // FNV-1a 64 of "a" with the standard offset basis.
  EXPECT_EQ(pg::fnv1a64("a", pg::BloomFilter::kBasis1), 0xaf63dc4c8601ec8cULL);
}
