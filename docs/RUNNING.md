# Running, testing and publishing PhishGuard

Written for Windows, macOS and Linux. Commands are typed in the VS Code terminal (**Terminal → New Terminal**).

---

## Part 1 — One-time setup

1. **Install the tools**
   - [Node.js 20 or newer](https://nodejs.org) (LTS). Check: `node -v`
   - [Git](https://git-scm.com) and [VS Code](https://code.visualstudio.com)
   - Python 3.11+ — only needed for the ML scripts and the real-website check. Then:
     `pip install lightgbm onnx onnxruntime onnxmltools skl2onnx numpy pandas scikit-learn pytest`
   - Google Chrome (for trying the extension in your own browser).

2. **Get the code**
   - From the zip: unzip `phishguard-ai.zip`, or with history: `git clone phishguard-ai.bundle phishguard-ai`.
   - VS Code → **File → Open Folder…** → choose `phishguard-ai`.
   - VS Code asks to install the **recommended extensions** (ESLint, Prettier, Playwright, Vitest, Python…). Click **Install**.

3. **Install the packages** — **Terminal → Run Task… → `1. Install everything`**.
   This installs the extension, backend and dashboard packages and the Chromium browser used by the tests.

> You do **not** need Emscripten, CMake, Docker or Python just to build and test the extension: the
> compiled WASM and model files are already in `extension/public/`.

---

## Part 2 — Try it in your own Chrome

1. **Run Task → `2. Build extension`** (or `Ctrl+Shift+B`). This creates `extension/dist`.
2. In Chrome open `chrome://extensions`, switch on **Developer mode** (top right).
3. Click **Load unpacked** and choose the folder `phishguard-ai/extension/dist`.
4. Pin the shield icon from the puzzle-piece menu.

After every code change: build again, then click the **↻ reload** arrow on the PhishGuard card in `chrome://extensions`.

**Important:** with the current model you will see **false warnings on some real sites** (for example Google
sign-in and GitHub). The model was trained on synthetic data — see Part 5. Use the test lab below to check features.

### Where to see what the extension is doing

| Part | How to open its DevTools |
|---|---|
| Service worker (scoring, block page, licence) | `chrome://extensions` → PhishGuard → **service worker** link |
| Content script (warning overlay) | DevTools of the web page → Console → choose "PhishGuard AI" in the context drop-down |
| Offscreen document (page + visual models) | `chrome://extensions` → PhishGuard → **Inspect views: offscreen.html** (appears after the first password check) |
| Popup | Right-click the shield icon → **Inspect popup** |
| Stored data (trusted list, settings) | Service-worker DevTools → **Application → Storage** |

---

## Part 3 — Test every feature by hand (test lab)

**Run Task → `3. Open test lab (manual testing)`**

A Chromium window opens with:
- the extension loaded and set to **Pro** (so all three layers run),
- fictional test sites (`*.test`, the fictional brand "ExampleBank") — nothing goes to the internet,
- a local server on `http://127.0.0.1:8787` with demo data.

The start page lists each scenario and what you should see:

| Scenario | What should happen |
|---|---|
| Real ExampleBank login | No warning while typing a password |
| Brand in a fake address | Red warning with 3 reasons. Try `Esc`, `Tab`, and every button |
| Typo look-alike (`examp1ebank`) | Warning; "I trust this site" stops it next time |
| Form sends password elsewhere | Warning from the page model (Pro) |
| Looks like ExampleBank (logo is a picture) | Warning from the visual model (Pro) |
| Known phishing site | Red block page before the page loads |
| Card checkout / page with no login | No warning |

Also on the start page: a licence key to test **Remove licence / Activate**, the **Teams dashboard**
(token is shown), and how to see **Report mistake** entries.

Close the window to stop. **Run Task → `4. Quick self-check`** does the same walk-through without a
window and prints PASS/FAIL for each scenario.

---

## Part 4 — Automated tests

| Task | What it runs | Needs |
|---|---|---|
| `5. Unit tests (extension)` | 28 tests: scoring, reasons, TreeSHAP, WASM, page features, licence, image prep | Node |
| `6. End-to-end tests (browser)` | 19 tests with the real extension in Chromium (some Teams tests are Linux-only and skip elsewhere) | Node + task 1 |
| `7. Backend tests (in-memory)` | API, workers, licences, Teams, feed API | Node |
| `8. Real-website check` | Launch gate: false warnings on real sites | Python |

You can also run single tests from the **Testing** panel (flask icon) thanks to the Playwright and Vitest extensions.
The Postgres/Redis versions of the backend tests run when `TEST_DATABASE_URL` / `TEST_REDIS_URL` are set
(see the Makefile) — easiest with `docker compose up postgres redis`.

---

## Part 5 — Before you publish (do these in order)

The packager (`npm run package`) **refuses to build a store upload** until steps 1–3 are done.

1. **Train on real data.** Follow the README section "Real data instead of the synthetic sample"
   (Tranco + PhishTank/OpenPhish → `clean_dedupe.py` → `train_url.py --host-only` → `eval_url.py`).
   Check the feed licences first (`docs/data_licenses.md`): the free OpenPhish feed is non-commercial.
2. **Pass the real-website gate.** `python ml/scripts/check_real_sites.py` must print **PASS** (≤ 1% false
   warnings). Add the sites your users visit most to `shared/real_legit_sample.txt` — more is better.
   Retrain the page model on crawled + labeled pages, and the visual model with pretrained weights and a gallery of
   real official login pages (`docs/HUMAN_TODO.md`), or ship v1 as **Free only** (URL layer) first.
3. **Deploy the backend** (any container host + managed Postgres + Redis, `docker compose` file included) on an
   **https** address. Without it the extension still works offline, but cannot confirm known phishing sites,
   receive reports or validate Pro licences.
4. **Build the WASM with Emscripten once** (`wasm/build_emscripten.sh`) and re-run `make parity` (must be 0 mismatches).
5. **Host the privacy policy** (`docs/privacy_policy.md`, after legal review) at a public URL.
6. **Bump the version** in `extension/public/manifest.json` for every upload (`0.1.0` → `0.1.1`…).
7. **Package:** **Run Task → `9. Package for Chrome Web Store`** and enter your server URL.
   Output: `extension/release/phishguard-<version>.zip`.

## Part 6 — Publishing on the Chrome Web Store

1. Register a developer account at [the developer dashboard](https://chrome.google.com/webstore/devconsole):
   choose a dedicated email (it cannot be changed later), accept the agreement and pay the one-time registration
   fee. ([Google's guide](https://developer.chrome.com/docs/webstore/register))
2. **New item** → upload the zip.
3. **Store listing:** copy from `docs/store_listing.md`. Screenshots: use the test lab (fictional ExampleBank), never a real brand.
4. **Privacy practices:** single purpose, data-use disclosures and **permission justifications** — copy from
   `docs/permissions.md`. Expect extra review for `<all_urls>`; explain it is needed for the password-moment
   check on every site and for the visual check's screenshot.
5. **Visibility:** publish first as **Unlisted** or to **trusted testers**, use it yourself for a week, watch
   "Report mistake" and the error counters (`/v1/admin/errors`), then switch to Public.
6. Each update: fix → test (tasks 4–8) → bump version → package → upload.
