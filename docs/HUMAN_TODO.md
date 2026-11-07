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

## Phase v2 operations
- [ ] Set `ADMIN_TOKEN` (long random) and review the report queue regularly (`/v1/admin/reports`).
- [ ] Refresh `backend/config/ct_logs.json` from Chrome's log list every ~6 months (logs are temporal shards). Logs that only speak the newer static-ct-api need a tile client (not built).
- [ ] Run the crawler in an **isolated** container/VM (no credentials, egress-only). Install Playwright there and set `CRAWL_SCREENSHOT_DIR` if you want screenshots (needed for Layer 3 gallery building).
- [ ] Recruit regional labelers (Hindi/English for India; pt-BR; id; es) and decide the dataset licence (`ml/datasets/regional/README.md`).
- [ ] Replace the synthetic page dataset with crawled + labeled pages and re-run `make pages`.

## Phase v3 (Pro)
- [ ] **Capture the real reference gallery**: official login pages of the brands you protect (your own screenshots of the official sites, at 1280x800), then build the gallery with the same pipeline. The shipped gallery uses fictional brands only.
- [ ] Use **pretrained weights** for the visual backbone (ImageNet MobileNetV3-small) — the build machine could not download them; training from scratch on synthetic pages is only a demonstration.
- [ ] Paddle: create the product + three monthly prices (Tier 1/2/3), set `PADDLE_*` env vars, `PADDLE_CLIENT_TOKEN`, webhook URL `https://<api>/v1/paddle/webhook`, and decide Tier countries in `backend/config/pricing.json`.
- [ ] Email the licence key to customers as a backup to the on-screen pickup (needs your email provider).
- [ ] Add GitHub secrets for the weekly retrain workflow (`PHISHTANK_APP_KEY`, `OPENPHISH_PREMIUM_URL`, `ADMIN_TOKEN`, repo variable `API_BASE`).

## Phase v4 (Teams, feed API)
- [ ] Publish the extension to get its Web Store id, then follow `docs/enterprise.md` for force-install + policy.
- [ ] Decide whether Teams licences go through Paddle (Teams price IDs in `PADDLE_TEAMS_PRICE_IDS`) or invoicing; org creation is currently an admin API call.
- [ ] Decide who may get threat-feed API keys and on what terms (feed licences in `docs/data_licenses.md` may limit redistribution of domains that came from third-party feeds — the feed API only serves our own CT detections).
- [ ] Data-protection review for Teams (employee monitoring rules differ by country; India's DPDP Act, GDPR in the EU). Consider leaving `userLabel` empty by default.

## Legal / policy
- [ ] Re-check every feed licence in `docs/data_licenses.md`. **Blocking:** OpenPhish community feed is non-commercial; the default Tranco list includes CC BY-NC data; confirm PhishTank allows redistributing a derived Bloom filter.
- [ ] Have the privacy policy draft (`docs/privacy_policy.md`) reviewed and host it at a public URL (the Web Store requires one).
- [ ] Decide the data-retention period for reports (default in code: kept until reviewed; suggest 12 months).

## Store listing
- [ ] Review `docs/store_listing.md`. Screenshots and the demo GIF are generated by `extension/scripts/screenshots.ts` (fictional ExampleBank only).
- [ ] Fill the Web Store "privacy practices" form using `docs/permissions.md` and `docs/privacy.md`.
