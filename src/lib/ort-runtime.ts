import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url';

/**
 * Where ONNX Runtime Web loads its WebAssembly from: the app's own build,
 * never a CDN. Vite copies the file out of node_modules/onnxruntime-web into
 * `assets/` with a content hash, so it always matches the installed library
 * and nothing is committed. The default `onnxruntime-web` import already
 * bundles the matching JavaScript glue (the JSEP build), so only the `.wasm`
 * is fetched. Shared by the background model (bg-model.ts) and the depth
 * model (ai-depth.ts).
 */
export const ORT_WASM_PATHS = { wasm: ortWasmUrl };
