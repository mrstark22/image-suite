import * as Comlink from 'comlink';
import { RustWasmEngine } from '../wasm/wasm-bridge';
import { PipelineWorkerApi } from './pipeline-api';
import { decodeInStrips } from './decode';

/** The one image worker (design section 5). Its API is `PipelineWorkerApi`. */
const api = new PipelineWorkerApi(async () => {
  const core = new RustWasmEngine();
  if (!(await core.init())) throw new Error('The WebAssembly module did not load.');
  return core;
}, decodeInStrips);

Comlink.expose(api);
