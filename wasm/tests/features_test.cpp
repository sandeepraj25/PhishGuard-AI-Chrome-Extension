#include "gtest/gtest.h"
#include "test_util.h"

namespace {
struct Result {
  double f[pg::kNumUrlFeatures];
  pg::MatchDetails d;
};
Result run(const std::string& url) {
  Result r;
  engine().extract(url, -1, -1, r.f, &r.d);
  return r;
}
enum F { kUrlLen = 0, kHostLen, kPathLen, kDots, kSub, kHyph, kDigH, kDigRatio, kHEnt, kUEnt, kSus, kRiskyTld,
         kTldLen, kPuny, kMixed, kIp, kAt, kSegs, kParams, kPort, kBrandHost, kBrandPath, kEdit, kHomo, kAge, kCert };
}  // namespace

TEST(Features, EngineLoads) {
  EXPECT_GT(engine().brands().size(), 10u);
  EXPECT_GT(engine().psl().size(), 9000u);
}

TEST(Features, OfficialDomainIsClean) {
  auto r = run("https://login.examplebank.test/signin");
  EXPECT_EQ(r.f[kBrandHost], 0.0);
  EXPECT_EQ(r.f[kHomo], 0.0);
  EXPECT_EQ(r.f[kEdit], 3.0);
  EXPECT_EQ(r.f[kSub], 1.0);
  EXPECT_EQ(r.d.registeredDomain, "examplebank.test");
}

TEST(Features, BrandInSubdomainOfOtherSite) {
  auto r = run("http://examplebank.test.secure-login.xyz/verify/account");
  EXPECT_EQ(r.f[kBrandHost], 1.0);
  EXPECT_EQ(r.f[kRiskyTld], 1.0);
  EXPECT_EQ(r.f[kEdit], 0.0);
  EXPECT_GE(r.f[kSus], 3.0);  // secure, login, verify, account
  EXPECT_EQ(r.d.brandId, "examplebank");
  EXPECT_EQ(r.d.kind, "host");
  EXPECT_EQ(r.d.registeredDomain, "secure-login.xyz");
}

TEST(Features, TypoSquat) {
  auto r = run("https://examp1ebank.com/");
  EXPECT_EQ(r.f[kBrandHost], 0.0);
  EXPECT_EQ(r.f[kHomo], 1.0);  // 1 -> l in the skeleton
  EXPECT_EQ(r.f[kEdit], 1.0);
  EXPECT_EQ(r.d.kind, "homoglyph");
}

TEST(Features, EditDistanceTwo) {
  auto r = run("https://exanplebamk.com/");
  EXPECT_EQ(r.f[kEdit], 2.0);
  EXPECT_EQ(r.d.kind, "edit");
  EXPECT_EQ(r.d.brandId, "examplebank");
}

TEST(Features, PunycodeHomoglyph) {
  // "exаmplebank" with Cyrillic 'а' -> xn--exmplebank-... ; compute label via the encoder used in Python tests.
  auto r = run("https://xn--exmplebank-0qi.com/");  // decoded: e x а m p l e b a n k (Cyrillic a at index 2)
  EXPECT_EQ(r.f[kPuny], 1.0);
  EXPECT_EQ(r.f[kMixed], 1.0);
  EXPECT_EQ(r.f[kHomo], 1.0);
}

TEST(Features, BrandInPathOnly) {
  auto r = run("https://files.example.org/examplebank/login.php?x=1&y=2");
  EXPECT_EQ(r.f[kBrandHost], 0.0);
  EXPECT_EQ(r.f[kBrandPath], 1.0);
  EXPECT_EQ(r.f[kSegs], 2.0);
  EXPECT_EQ(r.f[kParams], 2.0);
  EXPECT_EQ(r.d.kind, "path");
}

TEST(Features, IpAndPortAndAt) {
  auto r = run("http://user@192.168.10.5:8080/x");
  EXPECT_EQ(r.f[kIp], 1.0);
  EXPECT_EQ(r.f[kPort], 1.0);
  EXPECT_EQ(r.f[kAt], 1.0);
  EXPECT_EQ(r.f[kSub], 0.0);
  EXPECT_EQ(r.f[kTldLen], 0.0);
}

TEST(Features, ShortTokenNeedsWholePart) {
  // "ups" is a 3-letter token: must not fire inside "groups".
  EXPECT_EQ(run("https://groups.example.com/").f[kBrandHost], 0.0);
  EXPECT_EQ(run("https://ups-tracking.example.com/").f[kBrandHost], 1.0);
}

TEST(Features, AgesPassThrough) {
  double f[pg::kNumUrlFeatures];
  engine().extract("https://a.com/", 3.0, 1.5, f, nullptr);
  EXPECT_EQ(f[kAge], 3.0);
  EXPECT_EQ(f[kCert], 1.5);
}

TEST(Features, EmptyAndGarbageInputDoNotCrash) {
  for (const char* s : {"", "://", "http://", "@@@", "http://[", "xn--", "http://xn--/", "http://a..b/"}) {
    auto r = run(s);
    EXPECT_GE(r.f[kUrlLen], 0.0);
  }
}
