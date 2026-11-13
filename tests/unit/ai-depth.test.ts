/**
 * AI depth (#43): failures are reported and nothing is substituted; the
 * estimate is cached only for exactly the same image; the model file is
 * checked against its pinned SHA-256. The real model is not run here: the
 * worker takes a synthetic estimator in its place.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RustWasmEngine, type WasmExports } from '../../src/wasm/wasm-bridge';
import { PipelineWorkerApi } from '../../src/workers/pipeline-api';
import { setPipeline, type Pipeline } from '../../src/lib/pipeline-client';
import { connectSchedulers, createSchedulers } from '../../src/lib/schedulers';
import { DEPTH_MODEL, loadModelBytes, modelInputSize, type DepthEstimator } from '../../src/lib/ai-depth';
import { sha256Hex } from '../../src/lib/model-file';
import { readFileSync } from 'fs';
import { join } from 'path';
import { setDepth } from '../../src/lib/document';
import { previewTarget } from '../../src/lib/render-target';
import { useDocumentStore } from '../../src/store/documentStore';
import { useRenderStore } from '../../src/store/renderStore';
import { useUIStore } from '../../src/store/uiStore';
import { currentDoc, resetStores } from '../helpers/documents';
import { loadPixels } from '../helpers/pipeline';
import { grayImage, loadWasm } from '../helpers/wasm';

const store = () => useDocumentStore.getState();
const render = () => useRenderStore.getState();

async function workerWith(estimator: DepthEstimator) {
  const wasm = await loadWasm({ fresh: true });
  return new PipelineWorkerApi(async () => RustWasmEngine.fromExports(wasm.exports as unknown as WasmExports), null, undefined, estimator);
}

/** A stand-in for the model: depth is distance from the top edge, nearer lower down. */
function synthetic(calls: Uint8Array[]): DepthEstimator {
  return async (rgba, width, height) => {
    calls.push(rgba.slice());
    return Float32Array.from({ length: width * height }, (_, i) => Math.floor(i / width) + rgba[i * 4] / 255);
  };
}

describe('AI depth in the worker', () => {
  beforeEach(() => {
    resetStores();
    useUIStore.getState().setJob('relief');
  });
  afterEach(() => setPipeline(null));

  it('a failing model is reported to the user, and no heightmap is shown or substituted', async () => {
    const api = await workerWith(async () => {
      throw new Error('The AI depth model could not be downloaded (network blocked).');
    });
    setPipeline(api as unknown as Pipeline);
    const schedulers = createSchedulers(() => api as unknown as Pipeline);
    const disconnect = connectSchedulers(schedulers, () => api as unknown as Pipeline);
    try {
      const img = grayImage(64, 48, (x, y) => x * 3 + y);
      store().open(await loadPixels(api, img.buffer as ArrayBuffer, 64, 48), 0.1);
      await schedulers.relief.whenIdle();
      expect(render().depthHeightMap).not.toBeNull();
      store().edit(setDepth({ source: 'ai-estimation' }));
      await schedulers.relief.whenIdle();
      expect(render().depthHeightMap).toBeNull();
      expect(render().relief.error).toMatch(/network blocked/);
      expect(render().errorMessage).toMatch(/network blocked/);
      // The export fails the same way rather than writing another heightmap.
      await expect(api.exportHeightmap(currentDoc(), null)).rejects.toThrow(/network blocked/);
    } finally {
      disconnect();
    }
  });

  it('two different images of the same size never share an estimate; the same image does', async () => {
    const calls: Uint8Array[] = [];
    const api = await workerWith(synthetic(calls));
    const a = grayImage(90, 60, (x) => x * 2);
    // The same as `a` except for one pixel at the bottom: the old key read only the top row.
    const b = a.slice();
    b.set([255, 255, 255], (59 * 90 + 45) * 4);
    const run = async (img: Uint8Array) => {
      store().open(await loadPixels(api, img.buffer.slice(0) as ArrayBuffer, 90, 60), 0.1);
      const doc = setDepth({ source: 'ai-estimation', detail: 0 })(currentDoc());
      return api.renderRelief({ doc, target: previewTarget(doc), haveSourceKey: null });
    };
    await run(a);
    await run(b);
    expect(calls).toHaveLength(2);
    expect(calls[0].some((v, i) => v !== calls[1][i])).toBe(true);
    await run(b);
    expect(calls).toHaveLength(2);
  });

  it('the model sees the image at its aspect ratio, sides in multiples of 14', () => {
    expect(modelInputSize(3000, 1500)).toEqual({ widthPx: 518, heightPx: 266 });
    expect(modelInputSize(400, 1200)).toEqual({ widthPx: 168, heightPx: 518 });
  });
});

describe('the model file', () => {
  const signal = new AbortController().signal;
  const fetching = (fn: (url: string, init?: RequestInit) => Promise<Response>) => fn as unknown as typeof fetch;

  it('a blocked network fails with a message naming the depth model, after reporting the download', async () => {
    const phases: string[] = [];
    const blocked = fetching(async () => Promise.reject(new TypeError('Failed to fetch')));
    await expect(loadModelBytes((p) => phases.push(p.phase), signal, blocked)).rejects.toThrow(/Could not download the AI depth model/);
    expect(phases).toEqual(['downloading']);
  });

  it('a file that is not the pinned one is refused', async () => {
    const wrong = fetching(async () => new Response(new Uint8Array(1000)));
    await expect(loadModelBytes(() => undefined, signal, wrong)).rejects.toThrow(/AI depth model download was incomplete/);
  });

  it('a cancelled download says so', async () => {
    const abort = new AbortController();
    const hanging = fetching(
      (_url, init) =>
        new Promise((_, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    );
    const loading = loadModelBytes(() => undefined, abort.signal, hanging);
    await new Promise((r) => setTimeout(r, 0));
    abort.abort();
    await expect(loading).rejects.toThrow(/cancelled/);
  });

  it('is self-hosted, pinned to a checksum, and Apache-2.0', () => {
    expect(DEPTH_MODEL.file.parts).toEqual(['/models/depth-anything-v2-small-q8.onnx']);
    expect(DEPTH_MODEL.file.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(DEPTH_MODEL.origin).toMatch(/\/resolve\/[0-9a-f]{40}\//);
    expect(DEPTH_MODEL.licence).toBe('Apache-2.0');
  });

  it('the committed model file is the pinned one', async () => {
    const bytes = readFileSync(join(__dirname, '../../public', DEPTH_MODEL.file.parts[0]));
    expect(bytes.length).toBe(DEPTH_MODEL.file.bytes);
    expect(await sha256Hex(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer)).toBe(DEPTH_MODEL.file.sha256);
  });
});
