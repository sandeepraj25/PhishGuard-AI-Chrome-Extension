# Things only you can do

Grouped by urgency. Each item says where the code expects the result.

## Before any real-world numbers can be quoted
- [ ] **Get real data.** Run `ml/scripts/download_tranco.py`, `download_openphish.py`, `download_phishtank.py` on a machine with internet, then `clean_dedupe.py`, `train_url.py --host-only`, `eval_url.py --host-only`, `make readme`. Until then every number in the README is from the synthetic sample.
- [ ] **Add a legitimate URL source with real paths** (e.g. a Common Crawl sample) so path features stop being leaky and `--host-only` is no longer needed.
- [ ] **Label regional data** (v2 labeling CLI) — Indian banks/UPI/couriers/government look-alikes in Hindi and English, plus pt/id/es.
- [ ] **Verify the official domains in `shared/brands.json`**, especially the new RBI `*.bank.in` domains and the government portals. A wrong official domain means false warnings on a real bank.

## Accounts and keys (put them in `.env`, never in code — template: `.env.example`)
- [ ] `PHISHTANK_APP_KEY` — free PhishTank registration.
- [ ] `OPENPHISH_PREMIUM_URL` — only if you buy a commercial OpenPhish feed.
- [ ] `GOOGLE_SAFE_BROWSING_API_KEY` — optional cross-check (not used by default).
- [ ] Paddle account (v3): `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, three price IDs per tier; decide Tier 1/2/3 countries (PLAN.md decision 5).
- [ ] Razorpay (only if chosen for India): `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`.
- [ ] `LICENSE_SIGNING_SECRET` — long random string for signing license keys (v3).
- [ ] Cloud hosting for the backend (any container host + managed Postgres + Redis); set `VITE_API_BASE` when building the extension.
- [ ] Chrome Web Store developer account (one-time fee) and, for CI publishing, `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`, `CWS_EXTENSION_ID`.

## Build steps this sandbox could not run
- [ ] **Run `wasm/build_emscripten.sh` once** with emsdk installed. This build sandbox had no Emscripten, so the shipped WASM was built with the zig fallback (`wasm/build_zig.sh`, same C exports). After building with emcc, re-run `make parity` — it must still report 0 mismatches.
- [ ] Build C++ tests with **real GoogleTest** (`cmake -S wasm -B wasm/build` without `-DPG_USE_MINIGTEST=ON`; CMake fetches it). The sandbox had no GitHub access and used the vendored gtest-compatible shim.
- [ ] `docker compose up --build` (no Docker daemon in the sandbox; the backend was tested against local Postgres 16 and Redis 7 binaries instead).
- [ ] Regenerate `shared/confusables.json` from the official Unicode `confusables.txt`: `python ml/scripts/build_confusables.py --confusables confusables.txt`.
- [ ] Update `shared/public_suffix_list.dat` from publicsuffix.org (snapshot is from 2025-04) and remove overrides that upstream now contains.

## Legal / policy
- [ ] Re-check every feed licence in `docs/data_licenses.md`. **Blocking:** OpenPhish community feed is non-commercial; the default Tranco list includes CC BY-NC data; confirm PhishTank allows redistributing a derived Bloom filter.
- [ ] Have the privacy policy draft (`docs/privacy_policy.md`) reviewed and host it at a public URL (the Web Store requires one).
- [ ] Decide the data-retention period for reports (default in code: kept until reviewed; suggest 12 months).

## Store listing
- [ ] Review `docs/store_listing.md`, make screenshots (use the ExampleBank fixtures, never a real brand), record the demo GIF and replace `docs/demo-placeholder.png`.
- [ ] Fill the Web Store "privacy practices" form using `docs/permissions.md` and `docs/privacy.md`.
