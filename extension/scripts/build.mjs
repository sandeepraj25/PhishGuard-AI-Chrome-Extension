// Two Vite builds: (1) SW + pages as ES modules, (2) content script as a classic IIFE.
import { execSync } from 'node:child_process';
import { build } from 'vite';

execSync('node scripts/sync_shared.mjs', { stdio: 'inherit' });
await build({ configFile: 'vite.config.ts', logLevel: 'warn' });
await build({ configFile: 'vite.content.config.ts', logLevel: 'warn' });
// Vite also emits a hashed copy of the ORT wasm it found via `new URL(..., import.meta.url)`.
// We point ORT at /ort/ explicitly (configureOrt), so that copy is dead weight (14 MB): drop it.
import { readdirSync, rmSync } from 'node:fs';
for (const f of readdirSync('dist/assets')) if (/^ort-wasm.*\.wasm$/.test(f)) rmSync(`dist/assets/${f}`);
console.log('built dist/');
