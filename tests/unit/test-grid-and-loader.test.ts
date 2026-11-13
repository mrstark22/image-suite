/**
 * The image loader (finding 10 on #68) and decoding in strips (#16, design
 * section 5). The raster test grid it also covered was replaced by the
 * calibration cards (#40), tested in calibration-cards.test.ts.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { decodeImageFile, DPI_HEADER_BYTES } from '../../src/lib/image-loader';
import type { Pipeline } from '../../src/lib/pipeline-client';
import { PipelineEngine, TooLargeError } from '../../src/lib/pipeline-engine';
import { decodeInStrips } from '../../src/workers/decode';
import { RustWasmEngine, type WasmExports } from '../../src/wasm/wasm-bridge';
import { createDocument } from '../../src/lib/document';
import { nativeTarget } from '../../src/lib/render-target';
import { labelOf, labelledImage } from '../helpers/documents';
import { loadWasm } from '../helpers/wasm';

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

    // At the file's own size: no reduction is asked for.
    expect(decodeFile).toHaveBeenCalledWith('source-x', file, null);
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
