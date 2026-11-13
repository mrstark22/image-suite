/**
 * The one ONNX Runtime Web setup in the app, shared by the background model
 * (bg-model.ts) and the depth model (ai-depth.ts).
 *
 * Both use the CPU-only build (`onnxruntime-web/wasm`): its WebAssembly is
 * `ort-wasm-simd-threaded.wasm` (about 11 MB), not the 27.8 MB JSEP build
 * that also carries WebGPU. Vite copies the file out of
 * node_modules/onnxruntime-web into `assets/` with a content hash, so it is
 * served by the app, never a CDN, and always matches the installed library.
 *
 * The runtime is imported only when a model is first used, so opening the app
 * does not download it.
 */
export type Ort = typeof import('onnxruntime-web/wasm');

let ortPromise: Promise<Ort> | null = null;

export function loadOrt(): Promise<Ort> {
  ortPromise ??= (async () => {
    const ort = await import('onnxruntime-web/wasm');
    const wasmUrl = (await import('onnxruntime-web/ort-wasm-simd-threaded.wasm?url')).default;
    ort.env.wasm.wasmPaths = { wasm: wasmUrl };
    // Threads need a cross-origin isolated page (see vercel.json and vite.config.ts).
    ort.env.wasm.numThreads =
      typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    return ort;
  })();
  ortPromise.catch(() => (ortPromise = null));
  return ortPromise;
}
