import * as ort from 'onnxruntime-web';
import { ORT_WASM_PATHS } from './ort-runtime';
import type { MaskModel, ModelProgress } from './background';
import { loadPinnedModel, type PinnedModelFile } from './model-file';

/**
 * The background removal model (#49): ISNet "general use" (DIS, Qin et al.
 * 2022), Apache-2.0, converted to half-precision weights with the extra side
 * outputs removed (scripts/derive-bg-model.py). Self-hosted from
 * `public/models/`, pinned by SHA-256. See docs/background-removal.md.
 */
export const ISNET_FILE: PinnedModelFile = {
  parts: ['/models/isnet-general-use-fp16.onnx.part0', '/models/isnet-general-use-fp16.onnx.part1'],
  bytes: 90_661_254,
  sha256: '1e00f2f0b23dea1b687ff90652263144fdb98af942aaa0cae8630c49159b18f0',
};

/** ISNet's fixed input size. */
const SIZE = 1024;

if (ort.env) {
  // Served by the app, shared with the relief's depth model (src/lib/ort-runtime.ts).
  ort.env.wasm.wasmPaths = ORT_WASM_PATHS;
  ort.env.wasm.numThreads = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
}

/**
 * The model's input: RGB as floats, channel-planar, `x / 255 - 0.5` (ISNet's
 * training normalisation, mean 0.5 and standard deviation 1).
 */
export function isnetInput(rgba: Uint8Array, pixels: number): Float32Array {
  const out = new Float32Array(3 * pixels);
  for (let i = 0; i < pixels; i++) {
    out[i] = rgba[i * 4] / 255 - 0.5;
    out[pixels + i] = rgba[i * 4 + 1] / 255 - 0.5;
    out[2 * pixels + i] = rgba[i * 4 + 2] / 255 - 0.5;
  }
  return out;
}

/** ISNet's output is already a sigmoid probability; it is stored in a byte. */
export function probabilityBytes(p: Float32Array | Uint16Array | ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(p.length);
  for (let i = 0; i < p.length; i++) out[i] = Math.round(Math.min(1, Math.max(0, p[i] as number)) * 255);
  return out;
}

/**
 * ISNet run with ONNX Runtime Web: WebGPU when the browser has it, else
 * WebAssembly (the same model either way). The session is created once.
 */
export function createIsnetModel(file: PinnedModelFile = ISNET_FILE): MaskModel {
  let session: Promise<ort.InferenceSession> | null = null;
  const load = (onProgress: (p: ModelProgress) => void) => {
    session ??= (async () => {
      const bytes = await loadPinnedModel(file, onProgress);
      onProgress({ stage: 'starting', loadedBytes: file.bytes, totalBytes: file.bytes });
      try {
        return await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ['webgpu', 'wasm'] });
      } catch (err) {
        throw new Error(`The background removal model could not be started: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
    // A failed load is tried again next time, not remembered.
    session.catch(() => (session = null));
    return session;
  };
  return {
    inputSize: { widthPx: SIZE, heightPx: SIZE },
    async predict(rgba, onProgress) {
      const s = await load(onProgress);
      onProgress({ stage: 'running', loadedBytes: file.bytes, totalBytes: file.bytes });
      const input = new ort.Tensor('float32', isnetInput(rgba, SIZE * SIZE), [1, 3, SIZE, SIZE]);
      let data: ArrayLike<number>;
      try {
        const out = await s.run({ [s.inputNames[0]]: input });
        data = out[s.outputNames[0]].data as Float32Array;
      } catch (err) {
        throw new Error(`The background removal model failed to run: ${err instanceof Error ? err.message : String(err)}`);
      }
      onProgress({ stage: 'done', loadedBytes: file.bytes, totalBytes: file.bytes });
      return probabilityBytes(data);
    },
  };
}
