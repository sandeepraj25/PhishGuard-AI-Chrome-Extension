/**
 * Parity runner: reads "url\tdomain_age\tcert_age" lines on stdin and prints the WASM
 * features in the same format as `pg_cli features` (hex IEEE-754 bits, tab, details JSON).
 */
import { readFileSync } from 'node:fs';

import { nodeExtractor } from './node_wasm';

const fx = await nodeExtractor();
const lines = readFileSync(0, 'utf8').split('\n');
if (lines.length && lines[lines.length - 1] === '') lines.pop();
const out: string[] = [];
const buf = new DataView(new ArrayBuffer(8));
for (const line of lines) {
  const [url = '', age = '-1', cert = '-1'] = line.split('\t');
  const { features, details } = fx.extract(url, Number(age), Number(cert));
  const hex = Array.from(features, (v) => {
    buf.setFloat64(0, v);
    return buf.getBigUint64(0).toString(16).padStart(16, '0');
  });
  // Re-serialise details with the same key order as the C++ toJson().
  out.push(`${hex.join(' ')}\t${JSON.stringify(details)}`);
}
process.stdout.write(out.join('\n') + (out.length ? '\n' : ''));
