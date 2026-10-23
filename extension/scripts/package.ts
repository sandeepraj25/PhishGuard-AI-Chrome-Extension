/**
 * Builds the Chrome Web Store upload: release/phishguard-<version>.zip (contents of dist/).
 *
 *   VITE_API_BASE=https://api.yourdomain.com npm run package
 *
 * Refuses to package when a launch check fails (see docs/RUNNING.md, "Before you publish"):
 *   - ml/results/real_sites.json missing or failing the false-warning gate
 *   - models trained only on synthetic data
 *   - server URL pointing at localhost / http
 * `--allow-unsafe` packages anyway, for an UNLISTED / trusted-testers upload only.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { zipSync } from 'fflate';

const here = dirname(fileURLToPath(import.meta.url));
const ext = resolve(here, '..');
const repo = resolve(ext, '..');
const unsafe = process.argv.includes('--allow-unsafe');
const problems: string[] = [];

const apiBase = process.env.VITE_API_BASE ?? '';
if (!apiBase)
  problems.push(
    'VITE_API_BASE is empty: no known-bad confirmation, no reports, no Pro. (OK only for an offline-only release.)',
  );
else if (!apiBase.startsWith('https://') || /localhost|127\.0\.0\.1/.test(apiBase))
  problems.push(`VITE_API_BASE must be a public https URL (got ${apiBase}).`);

const gatePath = resolve(repo, 'ml/results/real_sites.json');
if (!existsSync(gatePath))
  problems.push('ml/results/real_sites.json is missing: run python ml/scripts/check_real_sites.py');
else {
  const gate = JSON.parse(readFileSync(gatePath, 'utf8')) as { passes_gate: boolean; summary_line: string };
  if (!gate.passes_gate) problems.push(`Real-website gate fails: ${gate.summary_line}`);
}
const models = JSON.parse(readFileSync(resolve(ext, 'public/models/manifest.json'), 'utf8')) as Record<
  string,
  { dataset?: string }
>;
for (const [name, m] of Object.entries(models)) {
  if ((m.dataset ?? '').includes('synthetic'))
    problems.push(`The ${name} model was trained on synthetic data (${m.dataset}).`);
}

if (problems.length) {
  console.error(
    `\n${unsafe ? 'WARNING' : 'NOT PACKAGED'} — launch checks failed:\n${problems.map((p) => `  - ${p}`).join('\n')}\n`,
  );
  if (!unsafe) {
    console.error(
      'Fix these first (docs/RUNNING.md). For an unlisted test upload only: npm run package -- --allow-unsafe\n',
    );
    process.exit(1);
  }
}

execSync('npx tsc --noEmit && node scripts/build.mjs', { cwd: ext, stdio: 'inherit', env: process.env });
const manifest = JSON.parse(readFileSync(resolve(ext, 'dist/manifest.json'), 'utf8')) as { version: string };

const files: Record<string, Uint8Array> = {};
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files[relative(resolve(ext, 'dist'), p).split('\\').join('/')] = readFileSync(p);
  }
};
walk(resolve(ext, 'dist'));
mkdirSync(resolve(ext, 'release'), { recursive: true });
const out = resolve(
  ext,
  `release/phishguard-${manifest.version}${unsafe && problems.length ? '-UNSAFE-test-only' : ''}.zip`,
);
writeFileSync(out, zipSync(files, { level: 9 }));
console.log(
  `\n${out}\n${Object.keys(files).length} files, ${(statSync(out).size / 1024 / 1024).toFixed(1)} MB. Upload it at https://chrome.google.com/webstore/devconsole`,
);
