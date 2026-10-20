/**
 * SHARED by extension/ and backend/ (both import this file).
 * Loader for wasm/phishguard.wasm (C++ feature extractor).
 *
 * The module is a WASI "reactor" with plain C exports (see wasm/src/capi.cpp), so we only
 * need a tiny WASI shim: the C++ code never does real I/O. Unknown WASI imports are stubbed
 * with ENOSYS so the same loader works for both the Emscripten and zig builds.
 * Works in the service worker, the offscreen document and Node (unit + parity tests).
 */

export const NUM_URL_FEATURES = 26;

export interface MatchDetails {
  registered_domain: string;
  brand: string;
  brand_name: string;
  official_domain: string;
  kind: '' | 'homoglyph' | 'host' | 'edit' | 'path';
  matched: string;
  edit_distance: number;
}

export interface SharedData {
  psl: string;
  brands: string;
  confusables: string;
  suspiciousTokens: string;
  riskyTlds: string;
}

interface Exports {
  memory: WebAssembly.Memory;
  _initialize?: () => void;
  pg_alloc(n: number): number;
  pg_free(p: number): void;
  pg_num_features(): number;
  pg_init(...args: number[]): number;
  pg_extract(url: number, len: number, age: number, cert: number, out: number): void;
  pg_registered_domain(url: number, len: number): void;
  pg_result_ptr(): number;
  pg_result_len(): number;
  pg_bloom_load(p: number, n: number): number;
  pg_bloom_contains(p: number, n: number): number;
  pg_bloom_items(): number;
  pg_edit_distance(a: number, al: number, b: number, bl: number, k: number): number;
  pg_skeleton(p: number, n: number): void;
}

const WASI_ENOSYS = 52;

function wasiImports(module: WebAssembly.Module, getMemory: () => WebAssembly.Memory): WebAssembly.Imports {
  const impl: Record<string, (...a: number[]) => number> = {
    // fd_write(fd, iovs, iovsLen, nwrittenPtr): report everything as written, discard it.
    fd_write: (_fd, iovs, iovsLen, nwritten) => {
      const view = new DataView(getMemory().buffer);
      let total = 0;
      for (let i = 0; i < iovsLen; i++) total += view.getUint32(iovs + i * 8 + 4, true);
      view.setUint32(nwritten, total, true);
      return 0;
    },
    fd_close: () => 0,
    fd_seek: () => WASI_ENOSYS,
    environ_sizes_get: (countPtr, sizePtr) => {
      const view = new DataView(getMemory().buffer);
      view.setUint32(countPtr, 0, true);
      view.setUint32(sizePtr, 0, true);
      return 0;
    },
    environ_get: () => 0,
    proc_exit: (code) => {
      throw new Error(`wasm called proc_exit(${code})`);
    },
  };
  const wasi: Record<string, (...a: number[]) => number> = {};
  for (const imp of WebAssembly.Module.imports(module)) {
    if (imp.module !== 'wasi_snapshot_preview1' || imp.kind !== 'function') {
      throw new Error(`unexpected wasm import ${imp.module}.${imp.name}`);
    }
    wasi[imp.name] = impl[imp.name] ?? (() => WASI_ENOSYS);
  }
  return { wasi_snapshot_preview1: wasi };
}

export class FeatureExtractor {
  private readonly enc = new TextEncoder();
  private readonly dec = new TextDecoder();

  private constructor(private readonly ex: Exports) {}

  static async create(wasmBytes: BufferSource, data: SharedData): Promise<FeatureExtractor> {
    const module = await WebAssembly.compile(wasmBytes);
    // The WASI shim needs the memory, which only exists after instantiation.
    const holder: { memory?: WebAssembly.Memory } = {};
    const instance = await WebAssembly.instantiate(
      module,
      wasiImports(module, () => {
        if (!holder.memory) throw new Error('memory not ready');
        return holder.memory;
      }),
    );
    const ex = instance.exports as unknown as Exports;
    holder.memory = ex.memory;
    ex._initialize?.();
    const fx = new FeatureExtractor(ex);
    const args: number[] = [];
    const ptrs: number[] = [];
    for (const text of [data.psl, data.brands, data.confusables, data.suspiciousTokens, data.riskyTlds]) {
      const [p, n] = fx.copyIn(text);
      args.push(p, n);
      ptrs.push(p);
    }
    const ok = ex.pg_init(...args);
    ptrs.forEach((p) => ex.pg_free(p));
    if (ok !== 1) throw new Error('pg_init failed: shared data could not be parsed');
    if (ex.pg_num_features() !== NUM_URL_FEATURES) throw new Error('feature count mismatch');
    return fx;
  }

  /** Copies bytes into WASM memory. Caller must pg_free the pointer. */
  private copyIn(input: string | Uint8Array): [number, number] {
    const bytes = typeof input === 'string' ? this.enc.encode(input) : input;
    const p = this.ex.pg_alloc(bytes.length);
    new Uint8Array(this.ex.memory.buffer, p, bytes.length).set(bytes);
    return [p, bytes.length];
  }

  private readResult(): string {
    const p = this.ex.pg_result_ptr();
    const n = this.ex.pg_result_len();
    return this.dec.decode(new Uint8Array(this.ex.memory.buffer, p, n).slice());
  }

  private withString<T>(s: string, fn: (p: number, n: number) => T): T {
    const [p, n] = this.copyIn(s);
    try {
      return fn(p, n);
    } finally {
      this.ex.pg_free(p);
    }
  }

  extract(url: string, domainAgeDays = -1, certAgeDays = -1): { features: Float64Array; details: MatchDetails } {
    const out = this.ex.pg_alloc(NUM_URL_FEATURES * 8);
    try {
      this.withString(url, (p, n) => this.ex.pg_extract(p, n, domainAgeDays, certAgeDays, out));
      // Copy out before freeing: memory may grow (and detach views) on later calls.
      const features = new Float64Array(this.ex.memory.buffer.slice(out, out + NUM_URL_FEATURES * 8));
      return { features, details: JSON.parse(this.readResult()) as MatchDetails };
    } finally {
      this.ex.pg_free(out);
    }
  }

  registeredDomain(url: string): string {
    this.withString(url, (p, n) => this.ex.pg_registered_domain(p, n));
    return this.readResult();
  }

  loadBloom(bytes: Uint8Array): boolean {
    const [p, n] = this.copyIn(bytes);
    try {
      return this.ex.pg_bloom_load(p, n) === 1;
    } finally {
      this.ex.pg_free(p);
    }
  }

  bloomContains(domain: string): boolean {
    return this.withString(domain, (p, n) => this.ex.pg_bloom_contains(p, n)) === 1;
  }

  bloomItems(): number {
    return this.ex.pg_bloom_items();
  }

  editDistance(a: string, b: string, k = 2): number {
    return this.withString(a, (pa, na) => this.withString(b, (pb, nb) => this.ex.pg_edit_distance(pa, na, pb, nb, k)));
  }

  skeleton(label: string): string {
    this.withString(label, (p, n) => this.ex.pg_skeleton(p, n));
    return this.readResult();
  }
}
