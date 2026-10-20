// Deterministic math shared with ml/phishguard_ml/detmath.py.
//
// Why: std::log2 comes from the C library (musl/wasi-libc in WASM, glibc natively,
// CPython's libm in training). Libraries may round the last bit differently, which
// would break bit-exact feature parity. These functions use only frexp (exact) and
// + - * / (correctly rounded by IEEE-754 everywhere), in a fixed order.
// Build with -ffp-contract=off so the compiler never fuses a*b+c into one FMA.
#pragma once
#include <cstddef>
#include <cstdint>
#include <string>

namespace pg {

// log2(x) for x > 0. Accurate to ~1e-15 relative; identical bits on every platform.
double detLog2(double x);

// Shannon entropy in bits over the byte histogram of `s`.
double shannonEntropy(const std::string& s);

}  // namespace pg
