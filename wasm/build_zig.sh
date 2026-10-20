#!/usr/bin/env bash
# Fallback WASM build using `zig c++` (clang + wasi-libc + libc++), for machines/CI without emsdk.
# Produces a WASI reactor module with the same C exports as build_emscripten.sh.
#   pip install ziglang   # provides `python3 -m ziglang`
set -euo pipefail
cd "$(dirname "$0")"
OUT=../extension/public/wasm
mkdir -p "$OUT"
ZIG="${ZIG:-python3 -m ziglang}"
EXPORT_FLAGS=$(sed 's/^/-Wl,--export=/' exports.txt | paste -sd' ' -)
# shellcheck disable=SC2086
$ZIG c++ -target wasm32-wasi -mexec-model=reactor -std=c++17 -Os -fno-exceptions -fno-rtti \
  -ffp-contract=off -Wall -Wextra -Werror -Iinclude src/*.cpp \
  $EXPORT_FLAGS -Wl,--strip-all -Wl,--gc-sections -o "$OUT/phishguard.wasm"
ls -l "$OUT/phishguard.wasm"
