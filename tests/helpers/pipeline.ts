/**
 * Runs the app's pipeline in the test process: the worker's API class over the
 * committed WASM binary, installed as the app's pipeline, with the app's
 * schedulers connected to the stores.
 */
import { RustWasmEngine, type WasmExports } from '../../src/wasm/wasm-bridge';
import { PipelineWorkerApi } from '../../src/workers/pipeline-api';
import { setPipeline, type Pipeline } from '../../src/lib/pipeline-client';
import { connectSchedulers, createSchedulers, type Schedulers } from '../../src/lib/schedulers';
import { newSourceId } from '../../src/store/documentStore';
import type { LoadedSource } from '../../src/lib/image-loader';
import { loadWasm } from './wasm';

export interface TestPipeline {
  api: PipelineWorkerApi;
  schedulers: Schedulers;
  /** Resolves once every scheduler has nothing in flight and nothing due. */
  settled(): Promise<void>;
  /** Disconnects the schedulers and uninstalls the pipeline. */
  stop(): void;
}

/**
 * Installs an in-process pipeline over a fresh WASM instance and connects the
 * schedulers. `wrap` can stand between the schedulers and the worker (to hold
 * replies, for example).
 */
export async function startTestPipeline(wrap: (p: Pipeline) => Pipeline = (p) => p): Promise<TestPipeline> {
  const wasm = await loadWasm({ fresh: true });
  const api = new PipelineWorkerApi(async () => RustWasmEngine.fromExports(wasm.exports as unknown as WasmExports));
  const pipeline = wrap(api as unknown as Pipeline);
  setPipeline(pipeline);
  const schedulers = createSchedulers(() => pipeline);
  const disconnect = connectSchedulers(schedulers, () => pipeline);
  const all = [schedulers.preview, schedulers.trace, schedulers.relief];
  return {
    api,
    schedulers,
    settled: async () => {
      // A commit can make another scheduler due, so wait until a pass finds all idle.
      for (let i = 0; i < 10; i++) {
        await Promise.all(all.map((s) => s.whenIdle()));
        await new Promise((r) => setTimeout(r, 0));
      }
    },
    stop: () => {
      disconnect();
      setPipeline(null);
    },
  };
}

/** Loads `rgba` (`width` x `height`) into the pipeline as a new source, ready for `open`. */
export async function loadPixels(
  api: PipelineWorkerApi,
  rgba: ArrayBuffer,
  width: number,
  height: number,
  name = 'test.png',
  fileDpi: number | null = null
): Promise<LoadedSource> {
  const sourceId = newSourceId();
  const info = await api.putSource(sourceId, rgba, width, height);
  return { sourceId, file: null, name, fileDpi, ...info };
}
