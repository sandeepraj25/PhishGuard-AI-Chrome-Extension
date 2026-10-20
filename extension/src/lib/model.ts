/**
 * ONNX Runtime Web wrapper. We import the "wasm bundle" build (onnxruntime-web/wasm), whose JS
 * glue is bundled statically: MV3 service workers forbid dynamic import(), and MV3 forbids
 * remotely hosted code. The .wasm binary is shipped in the package under /ort/.
 */
import * as ort from 'onnxruntime-web/wasm';

let configured = false;

export function configureOrt(opts: { wasmUrl: string; proxy?: boolean }): void {
  if (configured) return;
  ort.env.wasm.numThreads = 1; // threads need SharedArrayBuffer + cross-origin isolation
  ort.env.wasm.proxy = opts.proxy ?? false;
  ort.env.wasm.wasmPaths = { wasm: opts.wasmUrl };
  ort.env.logLevel = 'error';
  configured = true;
}

export class OnnxBinaryClassifier {
  private constructor(
    private readonly session: ort.InferenceSession,
    private readonly inputName: string,
    private readonly numFeatures: number,
  ) {}

  static async load(bytes: ArrayBuffer, numFeatures: number): Promise<OnnxBinaryClassifier> {
    const session = await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ['wasm'] });
    return new OnnxBinaryClassifier(session, session.inputNames[0], numFeatures);
  }

  /** Probability of class 1 (phishing). */
  async predict(features: ArrayLike<number>): Promise<number> {
    if (features.length !== this.numFeatures) throw new Error(`expected ${this.numFeatures} features`);
    const input = new ort.Tensor('float32', Float32Array.from(features), [1, this.numFeatures]);
    const out = await this.session.run({ [this.inputName]: input });
    const probs = out['probabilities'] ?? out[this.session.outputNames[1]];
    return Number((probs.data as Float32Array)[1]);
  }
}

export { ort };
