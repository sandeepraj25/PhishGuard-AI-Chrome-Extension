# PhishGuard AI — Build Plan

**Status:** v1, v2 and v3 complete (see section 6).

This file is the working plan. It is updated at the end of every phase.

## 1. Repository structure

```
phishguard-ai/
├── PLAN.md                  this file
├── README.md                problem, architecture, results (from ml/results/*.json only)
├── docker-compose.yml       postgres, redis, backend api, workers
├── .env.example             every secret/account value, never real keys
├── shared/                  data shared by ML, WASM, extension and backend
│   ├── brands.json          global + regional brands with official domains
│   ├── public_suffix_list.dat   PSL snapshot (MPL-2.0) for registered-domain logic
│   ├── suspicious_tokens.json   tokens used by the URL feature extractor
│   ├── risky_tlds.json      hand-curated TLD list (not learned from data → no leakage)
│   ├── confusables.json     homoglyph → skeleton map (subset of Unicode confusables)
│   └── feature_spec.json    ordered feature names + version (single source of truth)
├── wasm/                    C++17 feature extractor
│   ├── include/ src/        url parsing, PSL, features, skeleton, punycode,
│   │                        banded edit distance, bloom filter, C ABI exports
│   ├── tests/               GoogleTest unit tests
│   ├── tools/               native CLI used by the parity test
│   ├── build_emscripten.sh  canonical build (emcc -sSTANDALONE_WASM)
│   └── build_zig.sh         fallback build used in CI/sandbox without emsdk
├── ml/
│   ├── phishguard_ml/       python package: features.py (mirror of C++), data, split, train
│   ├── scripts/             download_*.py, make_sample_data.py, train_url.py, eval_url.py,
│   │                        export_onnx.py, parity_test.py, eval_leadtime.py,
│   │                        eval_robustness.py, retrain.py, build_bloom.py
│   ├── data/                (gitignored) raw + processed data
│   ├── datasets/regional/   exported regional dataset + datasheet (v2)
│   ├── models/              exported .onnx + tree JSON for explanations
│   ├── results/             *.json written by eval scripts (README reads these)
│   └── tests/               pytest
├── extension/               MV3, TypeScript, Vite
│   ├── src/background/      service worker: scoring, bloom, hash-prefix check, storage
│   ├── src/content/         Password Moment Guard + overlay (Shadow DOM)
│   ├── src/offscreen/       ONNX Runtime Web host for page/visual models
│   ├── src/popup/           popup UI
│   ├── src/lib/             wasm loader, TreeSHAP, reasons, scoring, messages
│   ├── public/              manifest.json, block page, icons, model + data files
│   └── tests/               vitest unit tests + Playwright e2e with local fixtures
├── backend/                 TypeScript + Fastify
│   ├── src/api/             /check, /report, /license, /feed, /teams (by phase)
│   ├── src/workers/         feed ingest, RDAP, CT log poller, crawler, retrain trigger
│   ├── src/db/              migrations + repositories (Postgres, plus in-memory for tests)
│   └── tests/
├── dashboard/               Teams admin dashboard (v4)
└── docs/                    architecture, privacy, permissions, data_licenses,
                             interview_notes, HUMAN_TODO, store listing, privacy policy
```

## 2. Phase checklist

### v1 — MVP
- [x] C++ feature extractor: URL parsing, PSL registered domain, 26 URL features
- [x] C++ lookalike: homoglyph skeleton, punycode decode + mixed-script, banded edit distance (k=2), length-bucketed brand index
- [x] C++ Bloom filter (same hashing as Python builder)
- [x] GoogleTest unit tests (`-Wall -Wextra -Werror`)
- [x] WASM build + TS loader
- [x] Parity test: Python vs native C++ vs WASM on 1,000 URLs, bit-exact
- [x] ML: download scripts (Tranco, OpenPhish, PhishTank), clean/dedupe with first_seen
- [x] ML: sample-data generator (clearly synthetic) so the pipeline runs offline
- [x] ML: grouped-by-registered-domain + time split, LightGBM, ONNX export, size check
- [x] ML: eval_url.py → precision, recall, PR-AUC, recall@0.1%FPR vs rules-only baseline
- [x] Extension: SW scoring (Layer 1 + rules), Bloom + hash-prefix confirm, block page
- [x] Extension: Password Moment Guard overlay (Shadow DOM, a11y, dismissible)
- [x] Extension: popup (score, reasons, trusted list, report)
- [x] Extension: TreeSHAP reasons → templates (top 3)
- [x] Backend: POST /check, POST /report, rate limiting
- [x] Backend: feed-ingest worker (15 min) → rebuild Bloom file; RDAP worker with cache
- [x] Playwright e2e: overlay on ExampleBank phish fixture, none on legit fixture
- [x] Docs + commit "phase v1 complete"

### v2 — Smarter detection
- [x] DOM feature extractor (content script) incl. multilingual urgency phrases (en, hi, pt, id, es)
- [x] Page model (LightGBM → ONNX) in offscreen document, only on pages with sensitive fields
- [x] CT log worker (RFC 6962 get-entries polling) → brand-token flagging → crawl queue
- [x] Lead-time tracker + eval_leadtime.py
- [x] Regional labeling CLI + export with datasheet
- [x] Report-mistake → review queue → retraining export
- [x] e2e: form-action mismatch fixture; commit "phase v2 complete"

### v3 — Pro
- [x] Visual embedding model (MobileNetV3-small family), reference gallery, grey-zone only
- [x] eval_robustness.py (homoglyph swaps, extra subdomains, typos, brand-in-path)
- [x] License validation API, Paddle webhook behind env vars, Tier 1/2/3 price IDs
- [x] Feature gating in extension (Free: Layer 1 + Guard + reasons + regional; Pro: Layers 2–3)
- [x] Weekly retrain job with promotion gate (recall@0.1%FPR must not drop)
- [x] e2e visual look-alike fixture; commit "phase v3 complete"

### v4 — Scale
- [ ] Orgs, seats, warning-event ingestion (no URLs, no history)
- [ ] Admin dashboard with seeded demo data
- [ ] Enterprise managed-install docs (ExtensionInstallForcelist + managed storage schema)
- [ ] Threat-feed API with API keys + rate limits
- [ ] Score-drift report + PII-free error logging
- [ ] commit "phase v4 complete"

## 3. Key design decisions (made now, can be changed)

| # | Decision | Choice | Why |
|---|----------|--------|-----|
| D1 | Backend language | **TypeScript + Fastify** | Same language as the extension, so hashing, PSL handling and message types are shared and tested once. The workload is I/O bound (HTTP, Postgres, Redis, CT log polling), where Node is fine. Go would win on raw CPU for CT parsing, but one toolchain matters more for a small team. |
| D2 | WASM interface | Plain `extern "C"` exports, WASI "reactor" module | Same `.wasm` interface whether built with `emcc -sSTANDALONE_WASM` or with `zig c++ -target wasm32-wasi`. The extension ships a ~40-line WASI shim. No Emscripten JS glue → nothing remote, nothing `eval`-like. |
| D3 | Bit-exact features | Deterministic `log2` implemented with `frexp` + fixed series in both C++ and Python; C++ built with `-ffp-contract=off` | `std::log2` (musl/wasi-libc) and Python's `math.log2` (glibc) can differ in the last bit. Using only +, −, ×, ÷ (which IEEE-754 rounds identically everywhere) makes entropy identical. |
| D4 | Registered domain | Bundled Public Suffix List (ICANN + private sections), same file for Python, C++, TS | Private suffixes (e.g. hosting platforms) matter for phishing: `evil.web.app` must be its own site. |
| D5 | Explanations | ONNX Runtime Web does the scoring; exact **TreeSHAP** in TypeScript on the dumped tree JSON produces reasons | ONNX tree operators do not output SHAP values. A TS TreeSHAP is ~150 lines and is unit-tested against LightGBM `pred_contrib` values exported from Python. |
| D6 | Domain age privacy | Client never sends a domain to our server. Age comes only from (a) metadata attached to a hash-prefix match, or (b) an **opt-in** setting that queries public RDAP directly from the device | Keeps the "only 4-byte hash prefix leaves the device" rule absolute. |
| D7 | Bloom false positives | Bloom hit → confirm with `/check` (hash prefix → full hashes, compared locally). Offline → bloom hit scores as high risk (≥ 80) but not the 100 block page | A Bloom filter can say "maybe" wrongly; blocking a real site on a false positive is worse than a strong warning. |
| D8 | ORT Web in service worker | Use the ORT "wasm bundle" build with statically imported glue; `numThreads = 1`. If Chrome still blocks it, Layer 1 runs in the offscreen document too | Service workers forbid dynamic `import()`. Verified empirically in Playwright. |
| D9 | Offscreen reason | `WORKERS`; the offscreen page runs ORT in a dedicated Web Worker (`ort.env.wasm.proxy = true`) | Honest reason for store review; inference never blocks the offscreen page. |
| D10 | CT ingestion | Poll RFC 6962 logs (`get-sth`, `get-entries`) directly instead of a third-party certstream service | No dependency on a free community websocket; log list is config. |
| D11 | Test framework for C++ | GoogleTest via `find_package` → `FetchContent`; a tiny vendored gtest-compatible shim is used only when neither is reachable (this sandbox has no GitHub access) | Same test source compiles with real GoogleTest on your machine. |

## 4. Environment limits found in this build sandbox (affects what can be verified here)

- Network: only the npm and PyPI registries are reachable. GitHub, Tranco, OpenPhish, PhishTank,
  unicode.org and Emscripten downloads are blocked.
  - Emscripten is **not installed** here → the WASM is built with the zig fallback (same C ABI).
    `wasm/build_emscripten.sh` is written and must be run once on your machine (HUMAN_TODO).
  - Real phishing/legit data cannot be downloaded here → the pipeline runs on a **synthetic
    sample** dataset. Every result JSON records `"dataset": "synthetic-sample"`, and the README
    shows that label next to the numbers. These numbers say nothing about real-world accuracy.
  - The Unicode confusables file cannot be downloaded → a curated subset (Cyrillic, Greek,
    Latin look-alikes, digits) ships in `shared/confusables.json`; `ml/scripts/build_confusables.py`
    regenerates the full map from `confusables.txt` when you have it.
- No Docker daemon → backend tests run against local Postgres/Redis binaries (or in-memory
  repositories); docker-compose.yml is written but not run here.
- Chromium for Playwright is pre-installed, so e2e tests with the real unpacked extension do run.

## 5. Decisions I need from you (defaults are already applied — change any)

1. **Backend**: Fastify (default) or Go?
2. **Domain age (D6)**: keep opt-in direct RDAP from the device (default), or never fetch age client-side?
3. **Offline Bloom hit (D7)**: warning at ≥ 80 (default) or full block?
4. **Payments**: spec names Paddle; `.env.example` also has Razorpay placeholders. Paddle only (default)?
5. **Pricing tiers**: which countries go in Tier 1 / 2 / 3? Default draft in `backend/config/pricing.json` (India in Tier 3).
6. **Visual model weights**: pretrained ImageNet weights cannot be downloaded here. Default: train a
   small MobileNetV3-small-style network from scratch on rendered fictional-brand pages and document
   that you should swap in pretrained weights. OK?
7. **Feeds for commercial use**: see docs/data_licenses.md — some feeds forbid commercial use without a
   paid licence. You decide which to license.

## 6. Phase log

### v1 — complete
- C++ extractor: 29 unit tests; WASM 88 KB (zig build); parity Python = C++ = WASM on 1,000 URLs, 0 mismatches.
- ML: synthetic sample → grouped+time split → LightGBM → ONNX (+ tree JSON for TreeSHAP); eval vs rules baseline written to `ml/results/url_eval.json`.
- Extension: Layer 1 in the service worker (ORT Web works there with the wasm-bundle build, so D8 fallback was not needed), Password Moment Guard, popup, block page, Bloom + hash-prefix check.
- Backend: `/v1/check`, `/v1/report`, `/v1/bloom`, rate limiting (Redis), feed-ingest + Bloom rebuild + RDAP workers; Postgres store contract tests.
- Tests: pytest 25, vitest 17 (extension) + 27 (backend, incl. Postgres + Redis), Playwright e2e 10 (incl. full stack with a live backend).

### v2 — complete
- Layer 2 page model: 23 DOM features implemented once in TypeScript (content script + jsdom for training), LightGBM → ONNX, served from an offscreen document's dedicated worker; only at the password moment.
- CT worker (RFC 6962 polling, own DER parser for pre-certificates), brand-signal filtering, crawl queue + crawler.
- Lead-time tracker: `domain_sightings` + `/v1/admin/leadtime.csv` + `ml/scripts/eval_leadtime.py`.
- Regional labeling CLI (append-only log, undo, multi-labeler majority, conflicts) + export with auto-generated datasheet.
- Review queue: admin API (bearer token), export → `import_reviews.py` → `train_url.py --extra`.

### v3 — complete
- Layer 3 visual model: MobileNetV3-small (width 0.75, 160 px, trained from scratch on fictional-brand pages), int8 ONNX 887 KB, gallery + rule chosen on validation; grey zone 20–70 only; one TS preprocessing implementation for training and runtime.
- Robustness eval (5 scripted attacks) → `ml/results/robustness.json`.
- Pro plan: signed licence keys, Paddle webhook (HMAC, replay window), one-time key pickup, region tiers, popup activation, daily revalidation with 14-day offline grace; Layers 2–3 gated.
- Weekly retrain with promotion gate (`ml/scripts/retrain.py`, `.github/workflows/retrain.yml`).
- Decision changes: host permission is now `<all_urls>` (needed by `captureVisibleTab`); decision 6 applied (from-scratch visual model).
