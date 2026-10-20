#!/usr/bin/env bash
# Canonical WASM build with Emscripten (requires emsdk activated: `source emsdk_env.sh`).
# -sSTANDALONE_WASM produces a WASI-style module with no JS glue, so the extension loads it
# with the same tiny WASI shim as the zig fallback build. Output: extension/public/wasm/phishguard.wasm
set -euo pipefail
cd "$(dirname "$0")"
OUT=../extension/public/wasm
mkdir -p "$OUT"
emcc -std=c++17 -Os -flto -fno-exceptions -fno-rtti -ffp-contract=off -Wall -Wextra -Werror \
  -Iinclude src/*.cpp src/capi.cpp \
  -sSTANDALONE_WASM=1 --no-entry -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=4MB \
  -sEXPORTED_FUNCTIONS="$(sed "s/^/_/" exports.txt | paste -sd, -)" \
  -o "$OUT/phishguard.wasm"
ls -l "$OUT/phishguard.wasm"
