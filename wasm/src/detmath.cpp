#include "phishguard/detmath.h"

#include <cmath>

namespace pg {

double detLog2(double x) {
  // x = m * 2^e with m in [0.5, 1). Shift to y in [1, 2).
  int e = 0;
  double m = std::frexp(x, &e);
  double y = m * 2.0;
  e -= 1;
  // ln(y) = 2 * atanh(t), t = (y-1)/(y+1) in [0, 1/3]. 25 odd terms: error < (1/3)^51.
  double t = (y - 1.0) / (y + 1.0);
  double t2 = t * t;
  double sum = 0.0;
  double term = t;
  for (int k = 0; k < 25; ++k) {
    sum += term / static_cast<double>(2 * k + 1);
    term *= t2;
  }
  const double kInvLn2 = 1.4426950408889634;
  double ln = 2.0 * sum;
  return static_cast<double>(e) + ln * kInvLn2;
}

double shannonEntropy(const std::string& s) {
  if (s.empty()) return 0.0;
  size_t counts[256] = {0};
  for (unsigned char c : s) counts[c]++;
  double n = static_cast<double>(s.size());
  double h = 0.0;
  for (int b = 0; b < 256; ++b) {  // fixed order 0..255, mirrored in Python
    if (counts[b] == 0) continue;
    double p = static_cast<double>(counts[b]) / n;
    h -= p * detLog2(p);
  }
  return h;
}

}  // namespace pg
