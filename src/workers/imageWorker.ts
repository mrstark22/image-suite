import * as Comlink from 'comlink';
import { RustWasmEngine } from '../wasm/wasm-bridge';
import { PipelineWorkerApi } from './pipeline-api';
import { decodeInStrips } from './decode';
import type { MaskModel } from '../lib/background';

/** The one image worker (design section 5). Its API is `PipelineWorkerApi`. */
const api = new PipelineWorkerApi(async () => {
  const core = new RustWasmEngine();
  if (!(await core.init())) throw new Error('The WebAssembly module did not load.');
  return core;
}, decodeInStrips);

// Background removal's model (#49), loaded only when first used: the runtime
// and the model download are not needed until then.
let isnet: Promise<MaskModel> | null = null;
api.setMaskModel({
  inputSize: { widthPx: 1024, heightPx: 1024 },
  async predict(rgba, onProgress) {
    isnet ??= import('../lib/bg-model').then((m) => m.createIsnetModel());
    return (await isnet).predict(rgba, onProgress);
  },
});

Comlink.expose(api);
