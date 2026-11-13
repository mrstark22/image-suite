/**
 * The worker gives WASM memory back and recovers from a trap by replacing
 * the instance (#69, design section 5): the same document renders again.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ENGINE_RESTARTED_ERROR, PipelineWorkerApi } from '../../src/workers/pipeline-api';
import { RustWasmEngine, type WasmExports } from '../../src/wasm/wasm-bridge';
import { createDocument, setScale, setTonal } from '../../src/lib/document';
import { nativeTarget, previewTarget } from '../../src/lib/render-target';
import type { ImageDocument } from '../../src/types/document';
import { labelledImage, labelOf } from '../helpers/documents';
import { decodes, fakeDecoder, fakeImageFile } from '../helpers/fake-files';
import { loadWasm } from '../helpers/wasm';

/** The cores handed out, in order, so a test can reach into the one in use. */
let cores: RustWasmEngine[] = [];
const loadCore = async () => {
  const wasm = await loadWasm({ fresh: true });
  const core = RustWasmEngine.fromExports(wasm.exports as unknown as WasmExports);
  cores.push(core);
  return core;
};

beforeEach(() => {
  cores = [];
  decodes.clear();
});

/** Makes the module trap, as a bug or an out-of-memory abort inside a step would: a read far outside its memory. */
function trap(core: RustWasmEngine): never {
  core.wasm.prepare_source(0xffff_fff0, 2, 2, 0, 0, 2, 2, 2, 2);
  throw new Error('The module did not trap');
}

/** Index of the first byte where two renders differ, or -1: large arrays are compared without printing them. */
function firstDifference(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) return Math.min(a.length, b.length);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return -1;
}

const docOf = (sourceId: string, widthPx: number, heightPx: number): ImageDocument =>
  setScale(0.1)(createDocument('d', { sourceId, name: 'x.png', widthPx, heightPx, format: 'rgba8', hasAlpha: false, fileDpi: null }));

const renderOf = async (api: PipelineWorkerApi, doc: ImageDocument) =>
  new Uint8Array((await api.renderPreview({ doc, target: previewTarget(doc), haveSourceKey: null })).final.pixels);

describe('recovering from a trap (#69)', () => {
  it('a trap inside a step fails that request, replaces the instance, and the same document renders again', async () => {
    const api = new PipelineWorkerApi(loadCore, fakeDecoder);
    const file = fakeImageFile(64, 48);
    await api.decodeFile('s', file);
    const doc = setTonal({ contrast: 20 })(docOf('s', 64, 48));
    const before = await renderOf(api, doc);
    expect(api.instancesStarted).toBe(1);

    // A real trap: inside the step the module reads outside its memory, and stops.
    const first = cores[0];
    first.processInPlace = () => trap(first);
    await expect(renderOf(api, doc)).rejects.toThrow(ENGINE_RESTARTED_ERROR);

    // The next request runs on a new instance, holding the source decoded again from the file.
    const after = await renderOf(api, doc);
    expect(api.instancesStarted).toBe(2);
    expect(decodes.get(file.name)).toBe(2);
    expect(after).toEqual(before);
    // And so does everything else: the trace and a full-resolution export.
    expect((await api.traceDocument({ doc, target: previewTarget(doc) })).dimensions).toEqual({ width: 64, height: 48 });
    expect((await api.exportRaster(doc, 'png')).widthPx).toBe(64);
    expect(api.instancesStarted).toBe(2);
  });

  it('generated pixels, which have no file, are carried into the new instance', async () => {
    const api = new PipelineWorkerApi(loadCore, fakeDecoder);
    await api.putSource('grid', labelledImage(40, 30), 40, 30);
    const doc = docOf('grid', 40, 30);
    const before = await renderOf(api, doc);
    const first = cores[0];
    first.processInPlace = () => trap(first);
    await expect(renderOf(api, doc)).rejects.toThrow(ENGINE_RESTARTED_ERROR);
    expect(await renderOf(api, doc)).toEqual(before);
    expect(api.instancesStarted).toBe(2);
    const px = before;
    expect([px[0], px[1], px[2]]).toEqual(labelOf(0, 0));
  });
});

describe('giving memory back after a large run (#69)', () => {
  it('a run that leaves WASM memory far above the steady state replaces the instance; the document renders the same', async () => {
    // A low threshold stands in for 256 MB: a full-resolution export of 6 MP grows memory by tens of megabytes.
    const api = new PipelineWorkerApi(loadCore, fakeDecoder, 8 * 1024 * 1024);
    const file = fakeImageFile(3000, 2000);
    await api.decodeFile('s', file);
    const doc = docOf('s', 3000, 2000);
    const before = await renderOf(api, doc);
    expect(api.instancesStarted).toBe(1);
    const grownFrom = cores[0].wasm.memory.buffer.byteLength;

    // An unsharp mask at full resolution needs scratch memory well beyond the preview's.
    const sharpened = { ...doc, steps: { ...doc.steps, detail: { ...doc.steps.detail, unsharpStrength: 100 } } };
    const exported = await api.exportRaster(sharpened, 'png');
    expect([exported.widthPx, exported.heightPx]).toEqual([nativeTarget(doc).widthPx, nativeTarget(doc).heightPx]);
    expect(cores[0].wasm.memory.buffer.byteLength).toBeGreaterThan(grownFrom + 8 * 1024 * 1024);

    const after = await renderOf(api, doc);
    expect(api.instancesStarted).toBe(2);
    expect(decodes.get(file.name)).toBe(2);
    expect(firstDifference(after, before)).toBe(-1);
    // The new instance holds the source and the preview cache, not the export's high-water mark.
    expect(cores[1].wasm.memory.buffer.byteLength).toBeLessThan(cores[0].wasm.memory.buffer.byteLength);
  }, 60_000);

  it('ordinary preview renders do not replace the instance', async () => {
    const api = new PipelineWorkerApi(loadCore, fakeDecoder);
    await api.decodeFile('s', fakeImageFile(800, 600));
    const doc = docOf('s', 800, 600);
    for (const contrast of [0, 10, 20, 30]) await renderOf(api, setTonal({ contrast })(doc));
    await api.traceDocument({ doc, target: previewTarget(doc) });
    expect(api.instancesStarted).toBe(1);
  });
});
