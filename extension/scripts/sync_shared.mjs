// Copies shared data and the ORT wasm binary into public/ before a build.
// These copies are generated (gitignored); the source of truth is /shared and node_modules.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ext = resolve(here, '..');
const repo = resolve(ext, '..');
const pub = resolve(ext, 'public');
mkdirSync(resolve(pub, 'data'), { recursive: true });
mkdirSync(resolve(pub, 'ort'), { recursive: true });
for (const f of [
  'psl_ascii.txt',
  'brands.json',
  'confusables.json',
  'suspicious_tokens.json',
  'risky_tlds.json',
  'urgency_phrases.json',
]) {
  copyFileSync(resolve(repo, 'shared', f), resolve(pub, 'data', f));
}
copyFileSync(
  resolve(ext, 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm'),
  resolve(pub, 'ort/ort-wasm-simd-threaded.wasm'),
);
for (const required of [
  'wasm/phishguard.wasm',
  'models/url_model.onnx',
  'models/page_model.onnx',
  'data/known_bad.bloom',
]) {
  if (!existsSync(resolve(pub, required))) {
    console.error(`missing public/${required} — run wasm/build_*.sh and the ml scripts first (see README)`);
    process.exit(1);
  }
}
console.log('shared data synced');
