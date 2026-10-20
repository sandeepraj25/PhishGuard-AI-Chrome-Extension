# One-command workflows. `make all` rebuilds every generated artifact from source and runs all tests.
PY ?= python3
PG_TEST_DB ?= postgres://postgres@127.0.0.1:55432/phishguard_test
PG_TEST_REDIS ?= redis://127.0.0.1:56379/1

.PHONY: all shared wasm wasm-test wasm-emscripten data train eval parity bloom pages leadtime visual robustness drift dashboard ext ext-test e2e backend-test ml-test readme test lint

all: shared wasm data train eval bloom parity pages leadtime visual robustness drift dashboard ext test readme

shared:            ## regenerate derived shared data (PSL ASCII + confusables)
	$(PY) ml/scripts/build_psl.py
	$(PY) ml/scripts/build_confusables.py

wasm:              ## native build + C++ unit tests + WASM (zig fallback; use wasm-emscripten if emsdk is installed)
	cmake -S wasm -B wasm/build -DCMAKE_BUILD_TYPE=Release $(if $(MINIGTEST),-DPG_USE_MINIGTEST=ON,)
	cmake --build wasm/build -j
	./wasm/build/pg_tests
	./wasm/build_zig.sh

wasm-emscripten:
	./wasm/build_emscripten.sh

data:              ## synthetic sample data (replace with download_* + clean_dedupe.py for real data)
	$(PY) ml/scripts/make_sample_data.py

train:
	$(PY) ml/scripts/train_url.py
	$(PY) ml/scripts/export_shap_vectors.py

eval:
	$(PY) ml/scripts/eval_url.py

bloom:
	$(PY) ml/scripts/build_bloom.py --extra extension/tests/fixtures/known_bad_extra.txt

parity:
	$(PY) ml/scripts/parity_test.py

pages:             ## Layer 2: synthetic pages -> TS featuriser (jsdom) -> LightGBM -> ONNX -> eval
	$(PY) ml/scripts/make_sample_pages.py
	cd extension && npx tsx scripts/page_features.ts ../ml/data/pages/pages.jsonl ../ml/data/pages/page_features.csv
	$(PY) ml/scripts/train_page.py
	$(PY) ml/scripts/eval_page.py

visual:            ## Layer 3: fictional-brand pages -> Playwright render + TS crop -> train -> int8 ONNX + gallery
	$(PY) ml/scripts/make_visual_pages.py --official 20 --clones 250 --generic 2000 --decoys 80
	cd extension && npx tsx scripts/render_visual.ts ../ml/data/visual/pages.jsonl ../ml/data/visual
	$(PY) ml/scripts/train_visual.py
	$(PY) ml/scripts/make_visual_fixture.py

robustness:
	$(PY) ml/scripts/eval_robustness.py

drift:
	$(PY) ml/scripts/drift_report.py

dashboard:
	cd dashboard && npm run build

retrain:           ## candidate model + promotion gate (weekly in CI)
	$(PY) ml/scripts/retrain.py

leadtime:          ## lead time vs public feeds (sample data; real data: GET /v1/admin/leadtime.csv)
	$(PY) ml/scripts/make_sample_leadtime.py
	$(PY) ml/scripts/eval_leadtime.py

ext:
	cd extension && npm run build

ml-test:
	$(PY) -m mypy ml/phishguard_ml --ignore-missing-imports
	$(PY) -m pytest -q ml/tests

ext-test:
	cd extension && npx vitest run

e2e:
	cd extension && npx playwright test

backend-test:
	cd backend && TEST_DATABASE_URL=$(PG_TEST_DB) TEST_REDIS_URL=$(PG_TEST_REDIS) npx vitest run

lint:
	cd extension && npx eslint src tests scripts && npx prettier --check . && npx tsc --noEmit
	cd backend && npx eslint src tests && npx prettier --check . && npx tsc --noEmit
	cd dashboard && npx tsc --noEmit

test: ml-test ext-test backend-test e2e lint

readme:
	$(PY) scripts/update_readme_results.py
