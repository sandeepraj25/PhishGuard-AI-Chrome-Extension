/**
 * Registered-domain extraction on the server uses the SAME C++/WASM extractor as the extension
 * (shared/ts/wasm-loader.ts), so client and server always agree on what "the site" is.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { FeatureExtractor } from '../../../shared/ts/wasm-loader';

let instance: Promise<FeatureExtractor> | null = null;

export function domainExtractor(wasmPath: string, sharedDir: string): Promise<FeatureExtractor> {
  if (!instance) {
    const t = (f: string) => readFileSync(resolve(sharedDir, f), 'utf8');
    instance = FeatureExtractor.create(readFileSync(wasmPath), {
      psl: t('psl_ascii.txt'),
      brands: t('brands.json'),
      confusables: t('confusables.json'),
      suspiciousTokens: t('suspicious_tokens.json'),
      riskyTlds: t('risky_tlds.json'),
    });
  }
  return instance;
}

export function loadNeverBlock(path: string): Set<string> {
  return new Set(
    readFileSync(path, 'utf8')
      .split('\n')
      .map((l) => l.trim().toLowerCase())
      .filter((l) => l && !l.startsWith('#')),
  );
}
