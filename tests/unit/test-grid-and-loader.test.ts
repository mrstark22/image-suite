/**
 * The raster test grid (review finding 5 on #68), the image loader (finding
 * 10) and decoding in strips (#16, design section 5).
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { openTestGridRaster, MAX_TEST_GRID_PIXELS } from '../../src/lib/test-grid-document';
import { testGridSizePx, type TestGridOptions } from '../../src/lib/test-grid-generator';
import { decodeImageFile, DPI_HEADER_BYTES } from '../../src/lib/image-loader';
import type { Pipeline } from '../../src/lib/pipeline-client';
import { PipelineEngine, TooLargeError } from '../../src/lib/pipeline-engine';
import { decodeInStrips } from '../../src/workers/decode';
import { RustWasmEngine, type WasmExports } from '../../src/wasm/wasm-bridge';
import { useDocumentStore } from '../../src/store/documentStore';
import { useRenderStore } from '../../src/store/renderStore';
import { createDocument, setScale } from '../../src/lib/document';
import { dpiOf } from '../../src/lib/document-size';
import { nativeTarget } from '../../src/lib/render-target';
import { currentDoc, labelOf, labelledImage, openPhoto, resetStores } from '../helpers/documents';
import { startTestPipeline, type TestPipeline } from '../helpers/pipeline';
import { loadWasm } from '../helpers/wasm';

const store = () => useDocumentStore.getState();

const GRID: TestGridOptions = { rows: 5, cols: 5, boxSizeMm: 20, gapMm: 2, dpi: 300, type: 'power-matrix' };

describe('raster test grid', () => {
  let pipeline: TestPipeline;
  beforeAll(async () => {
    pipeline = await startTestPipeline();
  });
  afterAll(() => pipeline.stop());

  beforeEach(() => {
    resetStores();
    // The reviewer's case: a 6000 px photo sized to 100 mm, so 1524 DPI.
    openPhoto();
    store().edit(setScale(100 / 6000));
    expect(dpiOf(currentDoc())).toBeCloseTo(1524, 6);
  });

  it("is generated at its own DPI, not the open image's, and opens with its size set to match", async () => {
    await openTestGridRaster(GRID, 'grid.png', pipeline.api as unknown as Pipeline);
    const expected = testGridSizePx(GRID);
    expect([currentDoc().source.widthPx, currentDoc().source.heightPx]).toEqual([expected.width, expected.height]);
    expect(dpiOf(currentDoc())).toBeCloseTo(300, 9);
    // 5 boxes of 20 mm, 4 gaps of 2 mm and 5 mm margins: 118 mm.
    expect((expected.width / 300) * 25.4).toBeCloseTo(118, 0);
  });

  it('is held at full size by the pipeline, and previewed within 2048 px like any other image', async () => {
    const options = { ...GRID, dpi: 1200 };
    await openTestGridRaster(options, 'grid.png', pipeline.api as unknown as Pipeline);
    await pipeline.settled();
    const size = testGridSizePx(options);
    expect(Math.max(size.width, size.height)).toBeGreaterThan(2048);
    expect([currentDoc().source.widthPx, currentDoc().source.heightPx]).toEqual([size.width, size.height]);
    const source = useRenderStore.getState().source!;
    expect(Math.max(source.width, source.height)).toBe(2048);
    expect(useRenderStore.getState().processed?.byteLength).toBe(source.width * source.height * 4);
  });

  it('refuses a grid over the pixel limit before allocating it, and keeps the open image', async () => {
    const huge: TestGridOptions = { rows: 15, cols: 15, boxSizeMm: 50, gapMm: 20, dpi: 300, type: 'power-matrix' };
    const size = testGridSizePx(huge);
    expect(size.width * size.height).toBeGreaterThan(MAX_TEST_GRID_PIXELS);
    const before = currentDoc();
    const putSource = vi.fn();

    await expect(openTestGridRaster(huge, 'grid.png', { putSource } as unknown as Pipeline)).rejects.toThrow(/megapixels/);
    expect(putSource).not.toHaveBeenCalled();
    expect(store().doc).toBe(before);
  });
});

describe('image loader', () => {
  it('reads only the header of the file for its DPI, and hands the file to the worker to decode', async () => {
    // A PNG signature and a pHYs chunk at 300 DPI, followed by megabytes of data.
    const head = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 9, ...'pHYs'.split('').map((c) => c.charCodeAt(0)), 0, 0, 0x2e, 0x23, 0, 0, 0x2e, 0x23, 1, 0, 0, 0, 0];
    const bytes = new Uint8Array(4 * 1024 * 1024);
    bytes.set(head);
    const file = new File([bytes], 'big.png', { type: 'image/png' });
    const sliceSpy = vi.spyOn(file, 'slice');
    const wholeSpy = vi.spyOn(file, 'arrayBuffer');
    const decodeFile = vi.fn(async () => ({ widthPx: 6000, heightPx: 4000, hasAlpha: true }));

    const loaded = await decodeImageFile(file, 'source-x', { decodeFile } as unknown as Pipeline);

    expect(decodeFile).toHaveBeenCalledWith('source-x', file);
    expect(sliceSpy).toHaveBeenCalledWith(0, DPI_HEADER_BYTES);
    expect(wholeSpy).not.toHaveBeenCalled();
    expect(loaded).toMatchObject({ sourceId: 'source-x', name: 'big.png', widthPx: 6000, heightPx: 4000, hasAlpha: true });
    expect(loaded.fileDpi).toBeCloseTo(299.9994, 3);
  });
});

describe('decoding in strips', () => {
  let engine: PipelineEngine;
  beforeAll(async () => {
    const wasm = await loadWasm({ fresh: true });
    engine = new PipelineEngine(RustWasmEngine.fromExports(wasm.exports as unknown as WasmExports));
  });
  afterEach(() => vi.unstubAllGlobals());

  /**
   * Stands in for createImageBitmap and OffscreenCanvas: the "bitmap" is a
   * labelled image, and drawing it at (0, -y) on a band-sized canvas puts its
   * rows from y onwards into the band, as the browser would. Records each
   * canvas created and whether the bitmap was closed.
   */
  function stubBrowser(width: number, height: number, alphaAt: [number, number] | null = null) {
    const pixels = new Uint8Array(labelledImage(width, height));
    if (alphaAt) pixels[(alphaAt[1] * width + alphaAt[0]) * 4 + 3] = 128;
    const canvases: Array<{ width: number; height: number }> = [];
    const state = { closed: false };
    vi.stubGlobal('createImageBitmap', async () => ({ width, height, close: () => (state.closed = true) }));
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        private band: Uint8ClampedArray;
        constructor(public width: number, public height: number) {
          canvases.push({ width, height });
          this.band = new Uint8ClampedArray(width * height * 4);
        }
        getContext() {
          return {
            clearRect: () => this.band.fill(0),
            drawImage: (_bitmap: unknown, x: number, y: number) => {
              const from = -y;
              const rows = Math.min(this.height, height - from);
              this.band.set(pixels.subarray(from * width * 4, (from + rows) * width * 4));
              expect(x).toBe(0);
            },
            getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: this.band.subarray(0, w * h * 4) }),
          };
        }
      }
    );
    return { canvases, state };
  }

  function docFor(sourceId: string, width: number, height: number) {
    return createDocument('d', { sourceId, name: 'x', widthPx: width, heightPx: height, format: 'rgba8', hasAlpha: false, fileDpi: null });
  }

  it('decodes in bands of at most 4 megapixels, every row in its place, and closes the bitmap', async () => {
    // 3000 px wide: 1333 rows per band, so 4000 rows take 4 bands.
    const { canvases, state } = stubBrowser(3000, 4000);
    const info = await decodeInStrips(engine, 'strips', new File([], 'a.png'));
    expect(info).toEqual({ widthPx: 3000, heightPx: 4000, hasAlpha: false });
    expect(canvases).toEqual([{ width: 3000, height: 1333 }]);
    expect(3000 * 1333).toBeLessThanOrEqual(4_000_000);
    expect(state.closed).toBe(true);

    const doc = docFor('strips', 3000, 4000);
    const out = new Uint8Array(engine.render(doc, nativeTarget(doc), 'source').pixels);
    let mismatches = 0;
    for (const y of [0, 1332, 1333, 2666, 3999]) {
      for (const x of [0, 1500, 2999]) {
        const [r, g, b] = labelOf(x, y);
        const i = (y * 3000 + x) * 4;
        if (out[i] !== r || out[i + 1] !== g || out[i + 2] !== b) mismatches++;
      }
    }
    expect(mismatches).toBe(0);
  });

  it('reports transparency found in any band', async () => {
    stubBrowser(100, 50_000, [7, 45_000]);
    expect((await decodeInStrips(engine, 'alpha', new File([], 'a.png'))).hasAlpha).toBe(true);
  });

  it('says clearly when the browser cannot decode the file, and holds nothing', async () => {
    vi.stubGlobal('createImageBitmap', async () => {
      throw new Error('decode error');
    });
    await expect(decodeInStrips(engine, 'bad', new File([], 'broken.heic'))).rejects.toThrow(/could not decode "broken.heic"/);
    expect(engine.hasSource('bad')).toBe(false);
  });

  it('refuses an image over 150 MP without allocating it, and closes the bitmap', async () => {
    const { state } = stubBrowser(1, 1);
    vi.stubGlobal('createImageBitmap', async () => ({ width: 15000, height: 10001, close: () => (state.closed = true) }));
    await expect(decodeInStrips(engine, 'huge', new File([], 'huge.png'))).rejects.toThrow(TooLargeError);
    expect(engine.hasSource('huge')).toBe(false);
    expect(state.closed).toBe(true);
  });
});
