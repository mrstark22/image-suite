import { loadPinnedModel, ModelDownloadCancelledError, type PinnedModelFile } from './model-file';
import { loadOrt, type Ort } from './ort-runtime';

/**
 * AI depth estimation (#43): Depth Anything V2 Small, run with ONNX Runtime
 * Web on the CPU (its WebAssembly backend, bundled with the app).
 *
 * The model file is self-hosted with the app (`public/models`) and pinned by
 * its SHA-256; the shared loader (`model-file.ts`) downloads it once with
 * progress, checks it and caches it in IndexedDB, and checks a cached copy
 * again. Any failure (network, check, runtime, unexpected output) is thrown
 * to the caller. Nothing is substituted for the model's estimate.
 *
 * Licence: Depth Anything V2 *Small* is Apache-2.0 (the Base, Large and
 * Giant models are CC-BY-NC-4.0 and are not used). The ONNX conversion is by
 * onnx-community, under the same licence. See docs/plan.md.
 */
export const DEPTH_MODEL = {
  name: 'Depth Anything V2 Small',
  licence: 'Apache-2.0',
  /** Where the self-hosted copy came from: onnx-community's conversion at a fixed revision. */
  origin:
    'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/4472b7362082ad9968fee890ca0f1e5aca36b93d/onnx/model_quantized.onnx',
  file: {
    parts: ['/models/depth-anything-v2-small-q8.onnx'],
    bytes: 27_258_801,
    sha256: 'fcf51f1b230362b28690bb9d1809bf0431f29cad20534e3f589bd7285547f20d',
    name: 'the AI depth model',
  } satisfies PinnedModelFile,
} as const;

/** Name the backend actually in use, for the UI. */
export const DEPTH_BACKEND_LABEL = 'on this device’s processor (WebAssembly)';

/** The model's input is a multiple of this patch size on each side. */
const PATCH = 14;
/** Longest edge of the model's input, in pixels (the size it was trained at). */
const INPUT_EDGE = 518;

/** The model's input size for an image of `width` x `height`: aspect kept, sides multiples of 14, longest 518. */
export function modelInputSize(width: number, height: number): { widthPx: number; heightPx: number } {
  const scale = INPUT_EDGE / Math.max(width, height);
  const side = (v: number) => Math.max(PATCH, Math.round((v * scale) / PATCH) * PATCH);
  return { widthPx: side(width), heightPx: side(height) };
}

/** Progress of producing an estimate. `fraction` is null when unknown. */
export interface DepthModelProgress {
  phase: 'downloading' | 'loading' | 'estimating';
  fraction: number | null;
}

/**
 * Estimates depth for an RGBA8 image already at `modelInputSize`; returns
 * `width * height` values, larger nearer. Throws on any failure.
 */
export type DepthEstimator = (
  rgba: Uint8Array,
  width: number,
  height: number,
  onProgress: (p: DepthModelProgress) => void,
  signal: AbortSignal
) => Promise<Float32Array>;

/** Thrown when the user cancelled the model download. */
export class DownloadCancelledError extends Error {
  constructor() {
    super('The AI model download was cancelled.');
    this.name = 'DownloadCancelledError';
  }
}

/**
 * The model file's bytes, through the shared pinned-model loader, with its
 * progress as a fraction. `fetchImpl` is replaced in tests.
 */
export async function loadModelBytes(
  onProgress: (p: DepthModelProgress) => void,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch
): Promise<ArrayBuffer> {
  try {
    return await loadPinnedModel(
      DEPTH_MODEL.file,
      (p) => onProgress({ phase: 'downloading', fraction: p.stage === 'downloading' ? p.loadedBytes / p.totalBytes : null }),
      fetchImpl,
      signal
    );
  } catch (err) {
    if (err instanceof ModelDownloadCancelledError) throw new DownloadCancelledError();
    throw err;
  }
}

type Session = import('onnxruntime-web/wasm').InferenceSession;

/** The session, shared by concurrent requests; cleared after a failure so the next request tries again. */
let sessionPromise: Promise<{ ort: Ort; session: Session }> | null = null;

async function createSession(
  onProgress: (p: DepthModelProgress) => void,
  signal: AbortSignal
): Promise<{ ort: Ort; session: Session }> {
  const bytes = await loadModelBytes(onProgress, signal);
  onProgress({ phase: 'loading', fraction: null });
  const ort = await loadOrt();
  try {
    const session = await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ['wasm'] });
    return { ort, session };
  } catch (err) {
    throw new Error(`The AI depth model could not be started (${err instanceof Error ? err.message : String(err)}).`);
  }
}

/** ImageNet mean and standard deviation, as the model was trained with. */
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

/** The browser's estimator: Depth Anything V2 Small on ONNX Runtime Web. */
export const estimateDepth: DepthEstimator = async (rgba, width, height, onProgress, signal) => {
  sessionPromise ??= createSession(onProgress, signal);
  let ort: Ort;
  let session: Session;
  try {
    ({ ort, session } = await sessionPromise);
  } catch (err) {
    sessionPromise = null;
    throw err;
  }
  onProgress({ phase: 'estimating', fraction: null });
  const plane = width * height;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) input[c * plane + i] = (rgba[i * 4 + c] / 255 - MEAN[c]) / STD[c];
  }
  const feeds = { [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, height, width]) };
  const out = (await session.run(feeds))[session.outputNames[0]];
  const dims = out.dims.slice(-2);
  if (dims[0] !== height || dims[1] !== width || out.data.length !== plane) {
    throw new Error(`The AI depth model returned ${out.dims.join(' × ')}, not ${height} × ${width}.`);
  }
  return Float32Array.from(out.data as Float32Array);
};
