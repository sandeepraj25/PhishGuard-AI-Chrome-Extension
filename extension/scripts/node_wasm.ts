/** Node helper: build a FeatureExtractor from the repo's shared/ files (tests + parity). */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FeatureExtractor } from '../src/lib/wasm';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(here, '../..');

export function sharedText(name: string): string {
  return readFileSync(resolve(REPO, 'shared', name), 'utf8');
}

export async function nodeExtractor(): Promise<FeatureExtractor> {
  const wasm = readFileSync(resolve(REPO, 'extension/public/wasm/phishguard.wasm'));
  return FeatureExtractor.create(wasm, {
    psl: sharedText('psl_ascii.txt'),
    brands: sharedText('brands.json'),
    confusables: sharedText('confusables.json'),
    suspiciousTokens: sharedText('suspicious_tokens.json'),
    riskyTlds: sharedText('risky_tlds.json'),
  });
}
