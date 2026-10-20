# Interview notes — PhishGuard AI

Written in plain English, with a real-life example for each idea, plus time/space complexity. Use the "30-second answer" first in an interview, then go deeper if asked.

All numbers quoted here (Bloom size, tree count, test-set sizes) come from `ml/results/*.json` written by the scripts; re-run `make all` and update them if they change. They were produced on the **synthetic sample**, so they describe the pipeline, not real-world accuracy.

---

## 1. The 30-second pitch

"Phishing sites live for a few hours, so blocklists are always late. PhishGuard runs a small machine-learning model **inside the browser**, stays silent while you browse, and warns you **at the moment you focus a password or card field**, with three plain reasons like *'Contains examplebank but is not examplebank.test'*. Privacy: the server only ever sees a 4-byte hash prefix. The URL feature code is written once in C++, compiled to WebAssembly, and a parity test proves the browser computes exactly the same features as the Python training code."

---

## 2. Design decisions and trade-offs

| Decision | Why | Trade-off / what I gave up |
|---|---|---|
| Warn at the **password moment**, not on page load | Real life: a smoke alarm that beeps every time you make toast gets unplugged. Fewer, well-timed warnings get read. | Users who never type anything are only protected by the block page for known-bad sites. |
| **On-device** scoring | Privacy; works offline; no server cost per page view. | Model must be small (≈600 KB) and we cannot use huge models. |
| **C++ → WASM** feature extractor | One implementation for browser + backend; fast; a strong parity story. | Extra build toolchain (Emscripten/zig); a Python mirror must be kept in sync (enforced by the parity test). |
| **LightGBM** for Layer 1 | Tabular features, fast inference, handles mixed scales, built-in exact SHAP. | Less expressive than a character-level neural net on raw URLs; needs hand-made features. |
| **ONNX Runtime Web** for inference, **TypeScript TreeSHAP** for reasons | ONNX tree operators output scores, not explanations. | Two code paths over the same trees → unit test checks TreeSHAP against LightGBM `pred_contrib` (6 decimals). |
| **Hash-prefix** known-bad check (Safe-Browsing style) | Server cannot tell which site you visited: one prefix matches many domains. | One extra round-trip on a Bloom hit; offline we fall back to "warn" (≥ 80) instead of "block". |
| **Bloom filter** locally | 4,146 domains in ~7.5 KB at 0.1 % false-positive rate; check is O(k). | False positives possible → always confirm online before blocking (decision D7). |
| **Split by registered domain AND time** | Real life: you cannot study for an exam using the answer sheet. A random split puts URLs from the same phishing campaign in both train and test. | Smaller, harder test set; numbers look worse but are honest. |
| **Fastify (TypeScript)** backend | Same language as the extension → shared WASM loader, hashing, Bloom format. | Go would be faster for heavy CT-log parsing; Node is enough for I/O-bound work. |
| Reasons must be **literally true** | A reason template checks the feature value, not only the SHAP sign. A positive SHAP value for "host length" on a short host would produce a false statement. | Sometimes fewer than 3 reasons are shown. |

---

## 3. Algorithms with complexity

### 3.1 Bloom filter
- **What:** a bit array of `m` bits and `k` hash functions. Add: set `k` bits. Check: all `k` bits set → "maybe present"; any bit 0 → "definitely absent".
- **Real-life example:** a bouncer with a list of *initials* of banned people. If your initials are not on it you are definitely fine; if they are, he checks your full ID (our server round-trip).
- **Sizing:** `m = −n·ln p / (ln 2)²`, `k = (m/n)·ln 2`. For n = 4,146, p = 0.001 → m ≈ 59.6 k bits (7.5 KB), k = 10.
- **Hashing:** Kirsch–Mitzenmacher double hashing: index_j = (h1 + j·h2) mod m with two FNV-1a-64 hashes; h2 forced odd so it never collapses to one bit.
- **Time:** O(k) per add/check, independent of n. **Space:** O(m) bits ≈ 1.44·log₂(1/p) bits per item (~14.4 bits/item at 0.1 %).
- **Same format in C++, Python and TypeScript**, tested with a shared vector (FNV-1a("a") = 0xaf63dc4c8601ec8c) and cross-reading files.

### 3.2 Banded (bounded) edit distance
- **What:** Levenshtein distance, but we only care whether it is ≤ k (k = 2). Compute only DP cells within k of the diagonal and stop early when a whole row is > k.
- **Real-life example:** checking whether "examp1ebank" is a typo of "examplebank" — you don't need the exact distance to "microsoft", only "is it within 2?".
- **Time:** O(k · min(n, m)) instead of O(n·m). **Space:** O(m) (two rows).
- **Pre-filter:** if |len(a) − len(b)| > k, answer immediately (distance ≥ length difference). Only brand tokens ≥ 5 chars and host parts ≥ 4 chars are compared, so "ups" does not match every 3-letter word.
- **Interview gotcha:** a transposition ("el"→"le") costs **2** in Levenshtein, 1 in Damerau–Levenshtein. I first wrote a test expecting 2 for a transposition plus a deletion — it was 3. Fix was the test, and a note: Damerau would catch swaps at distance 1 (possible improvement).
- **Correctness check:** 2,000 random short strings compared against the full O(n·m) DP (`wasm/tests/core_test.cpp`).

### 3.3 Homoglyph skeleton mapping
- **What:** map every character to a "prototype" (Cyrillic 'а' → 'a', '0' → 'o', '1' → 'l', "rn" → "m", "vv" → "w"), on both the host and the brand token, then compare.
- **Real-life example:** reading a handwritten note where "rn" and "m" look the same — you normalise both to one shape before comparing.
- **Steps:** punycode-decode `xn--` labels (RFC 3492) → map code points via `shared/confusables.json` → ASCII rules → substring/part match against brand skeletons.
- **Time:** O(L) per label with hash-map lookups (L = label length); brand comparison O(B·L) for B tokens (B ≈ 150). **Space:** O(size of map) ≈ 354 entries.
- **Mixed-script detection** (Latin + Cyrillic in one label) is O(L) and is a very strong signal.

### 3.4 Public Suffix List lookup
- Labels from the right; exceptions (`!www.ck`) win, then the longest normal/wildcard rule, else the default `*`. Hash-set lookups.
- **Time:** O(D²) for D labels (D ≤ ~5 in practice, each candidate suffix join is O(D)); **space** O(rules) ≈ 9.7 k rules.
- **Bug found:** the bundled 2025 PSL snapshot did not contain `bank.in`, so every Indian `*.bank.in` site would collapse into one "registered domain" (`bank.in`) — a trusted-list or known-bad entry would affect *all* banks. Fixed with `shared/psl_overrides.txt` and a unit test.

### 3.5 LightGBM inference and TreeSHAP
- **Inference:** for T trees of depth D, walk root → leaf: **O(T·D)** time, O(1) extra space. Here T = 266 (early-stopped), D ≤ ~12.
- **TreeSHAP (exact, path-dependent):** **O(T·L·D²)** for L leaves per tree. Computed only when a warning is shown.
- **Local accuracy check:** Σ SHAP + expected value = raw score (tested).

### 3.6 Deterministic log2 (parity)
- `std::log2` (wasi-libc/musl) and CPython's `math.log2` (glibc) can differ in the last bit → entropy features differ → model sees different inputs. Built `detLog2` from `frexp` + a fixed 25-term atanh series using only + − × ÷, compiled with `-ffp-contract=off`. Result: 0 mismatches across Python, native C++ and WASM on 1,000 URLs.

---

## 4. Mistakes found and fixed (good interview stories)

1. **Label leakage from data sources.** Tranco gives bare domains (`https://site.com/`), phishing feeds give full URLs with paths. A model would learn "has a path ⇒ phishing". Fix: `--host-only` mode for training/eval when legit data has no paths, a warning in `clean_dedupe.py`, and a recommendation to add a legit source with real paths.
2. **Campaign leakage in the split.** Random split → same phishing domain in train and test → inflated recall. Fix: group by registered domain and order by first-seen time (`ml/phishguard_ml/split.py`, with a unit test asserting no overlap).
3. **Training/serving skew risk.** Libm `log2` differences (above) → deterministic log2 + bit-exact parity test in CI.
4. **Block page never loaded.** The service worker redirected to `block.html`, but Vite emits it at `src/block/block.html`. Only the full-stack e2e test (real backend + real extension) caught it.
5. **PSL missing `bank.in`** (above).
6. **ONNX export:** the converter fixed the batch dimension of the `label` output to 1 → runtime warnings for batches. Fixed by making it symbolic after conversion.
7. **14 MB duplicated in the package:** Vite also emitted a hashed copy of the ONNX Runtime wasm it saw via `new URL(..., import.meta.url)`; we point ORT at `/ort/` explicitly, so the build removes the dead copy.
8. **Flaky e2e:** evaluating in the service worker immediately after start-up — `chrome.storage` was not bound yet. Fixed by waiting for the APIs in the fixture.
9. **Synthetic data is too easy.** PR-AUC 1.000 on the synthetic sample only shows the model learned the generator's templates. The README says so in a warning box generated from the result JSON's `dataset` field.

---

## 5. Likely interview questions (short answers)

- **Why not just use Google Safe Browsing?** It is list-based (late for new domains) and gives no explanation. We use a list too (Bloom + prefix check) but add an on-device model and reasons.
- **What is recall at 0.1 % FPR and why use it?** Set the threshold so only 1 in 1,000 legit sites is flagged, then measure how many phishing sites are caught. Users uninstall tools that cry wolf, so we care about the low-FPR end of the curve. With 3,071 legit test URLs only 3 false positives are allowed, so the estimate is noisy — we report that count next to the number.
- **How do you stop a phishing page hiding your overlay?** Shadow DOM (page CSS cannot reach it), capture-phase key handling, and a MutationObserver that re-inserts the overlay while it should be open.
- **Service worker can die — what breaks?** Nothing durable: all state is in `chrome.storage`; the engine is a lazily rebuilt cache; timers are `chrome.alarms`.
- **Cold start cost?** WASM (88 KB) + ONNX model (~600 KB) + ORT wasm (14 MB) load once per service-worker start. Next step: a custom minimal ORT build with only the tree-ensemble operators.

---

## 6. What I would do next

1. Real data: license feeds, add a legit URL source **with paths** (e.g. Common Crawl), and re-run everything; publish only those numbers.
2. Damerau–Levenshtein (transpositions cost 1) and keyboard-adjacency typos.
3. Custom ONNX Runtime build with only the ML operators to cut the 14 MB runtime.
4. Calibrate probabilities (isotonic regression on the validation split) so "score 70" means ~70 % risk.
5. Measure warning click-through and false-positive reports per 1,000 warnings (privacy-preserving, aggregate only).
