/**
 * Bloom filter writer/reader. Same hashing and file format as wasm/src/bloom.cpp and
 * ml/phishguard_ml/bloom.py (shared test vector: FNV-1a-64("a") = 0xaf63dc4c8601ec8c).
 */
const MASK = (1n << 64n) - 1n;
const PRIME = 0x100000001b3n;
export const BASIS1 = 0xcbf29ce484222325n;
export const BASIS2 = 0x84222325cbf29ce4n;

export function fnv1a64(s: string, basis: bigint): bigint {
  let h = basis;
  for (const b of new TextEncoder().encode(s)) {
    h ^= BigInt(b);
    h = (h * PRIME) & MASK;
  }
  return h;
}

export class BloomFilter {
  readonly bits: Uint8Array;
  n = 0;

  constructor(
    readonly m: number,
    readonly k: number,
  ) {
    this.bits = new Uint8Array(Math.ceil(m / 8));
  }

  /** m = -n ln p / (ln 2)^2, k = (m / n) ln 2 */
  static forCapacity(n: number, p: number): BloomFilter {
    const items = Math.max(1, n);
    const ln2 = 0.6931471805599453;
    const m = Math.ceil((-items * Math.log(p)) / (ln2 * ln2));
    return new BloomFilter(m, Math.max(1, Math.round((m / items) * ln2)));
  }

  private *indexes(key: string): Generator<number> {
    const h1 = fnv1a64(key, BASIS1);
    const h2 = fnv1a64(key, BASIS2) | 1n;
    const m = BigInt(this.m);
    for (let j = 0n; j < BigInt(this.k); j++) yield Number(((h1 + j * h2) & MASK) % m);
  }

  add(key: string): void {
    for (const i of this.indexes(key)) this.bits[i >> 3] |= 1 << (i & 7);
    this.n++;
  }

  has(key: string): boolean {
    for (const i of this.indexes(key)) if (!(this.bits[i >> 3] & (1 << (i & 7)))) return false;
    return true;
  }

  serialize(): Uint8Array {
    const out = new Uint8Array(24 + this.bits.length);
    const v = new DataView(out.buffer);
    out.set([0x50, 0x47, 0x42, 0x46]); // "PGBF"
    v.setUint32(4, 1, true);
    v.setBigUint64(8, BigInt(this.m), true);
    v.setUint32(16, this.k, true);
    v.setUint32(20, this.n, true);
    out.set(this.bits, 24);
    return out;
  }

  static deserialize(data: Uint8Array): BloomFilter {
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (String.fromCharCode(...data.subarray(0, 4)) !== 'PGBF' || v.getUint32(4, true) !== 1) {
      throw new Error('bad bloom header');
    }
    const bf = new BloomFilter(Number(v.getBigUint64(8, true)), v.getUint32(16, true));
    if (data.length !== 24 + bf.bits.length) throw new Error('bad bloom length');
    bf.n = v.getUint32(20, true);
    bf.bits.set(data.subarray(24));
    return bf;
  }
}
