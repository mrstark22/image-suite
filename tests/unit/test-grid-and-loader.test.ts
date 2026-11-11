/**
 * The raster test grid (review finding 5 on #68) and the image loader
 * (finding 10).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openTestGridRaster, MAX_TEST_GRID_PIXELS, type GridPreviewMaker } from '../../src/lib/test-grid-document';
import { testGridSizePx, type TestGridOptions } from '../../src/lib/test-grid-generator';
import { canvas2d, decodeImageFile, DPI_HEADER_BYTES, previewSizeFor } from '../../src/lib/image-loader';
import { useDocumentStore } from '../../src/store/documentStore';
import { setScale } from '../../src/lib/document';
import { dpiOf } from '../../src/lib/document-size';
import { currentDoc, openPhoto, resetStores } from '../helpers/documents';
import { sourcePixels } from '../../src/lib/source-registry';

const store = () => useDocumentStore.getState();

/** A preview maker that records what it was asked for and returns a blank preview of the capped size. */
function recordingPreview() {
  const calls: Array<{ width: number; height: number; bytes: number }> = [];
  const make: GridPreviewMaker = async (rgba, width, height) => {
    calls.push({ width, height, bytes: rgba.byteLength });
    const size = previewSizeFor(width, height);
    return { preview: new ArrayBuffer(size.width * size.height * 4), previewWidth: size.width, previewHeight: size.height };
  };
  return { calls, make };
}

const GRID: TestGridOptions = { rows: 5, cols: 5, boxSizeMm: 20, gapMm: 2, dpi: 300, type: 'power-matrix' };

describe('raster test grid', () => {
  beforeEach(() => {
    resetStores();
    // The reviewer's case: a 6000 px photo sized to 100 mm, so 1524 DPI.
    openPhoto();
    store().edit(setScale(100 / 6000));
    expect(dpiOf(currentDoc())).toBeCloseTo(1524, 6);
  });

  it("is generated at its own DPI, not the open image's, and opens with its size set to match", async () => {
    const { calls, make } = recordingPreview();
    await openTestGridRaster(GRID, 'grid.png', make);

    const expected = testGridSizePx(GRID);
    expect(calls).toEqual([{ ...expected, bytes: expected.width * expected.height * 4 }]);
    expect(currentDoc().source.widthPx).toBe(expected.width);
    expect(dpiOf(currentDoc())).toBeCloseTo(300, 9);
    // 5 boxes of 20 mm, 4 gaps of 2 mm and 5 mm margins: 118 mm.
    expect((expected.width / 300) * 25.4).toBeCloseTo(118, 0);
  });

  it('keeps the preview within 2048 px however large the grid, through the same path as a loaded file', async () => {
    // Stand-ins for the browser APIs the default preview path uses.
    vi.stubGlobal('ImageData', class {
      constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
    });
    vi.stubGlobal('createImageBitmap', async (img: { width: number; height: number }) => ({
      width: img.width,
      height: img.height,
      close: () => {},
    }));
    vi.stubGlobal('document', {
      createElement: () => ({
        getContext: () => ({
          drawImage: () => {},
          getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        }),
      }),
    });
    try {
      const options = { ...GRID, dpi: 1200 };
      await openTestGridRaster(options, 'grid.png');
      const size = testGridSizePx(options);
      expect(Math.max(size.width, size.height)).toBeGreaterThan(2048);
      const doc = currentDoc();
      expect([doc.source.widthPx, doc.source.heightPx]).toEqual([size.width, size.height]);
      const pixels = sourcePixels(doc.source.sourceId)!;
      expect(Math.max(pixels.previewWidth, pixels.previewHeight)).toBe(2048);
      expect(pixels.preview.byteLength).toBe(pixels.previewWidth * pixels.previewHeight * 4);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('refuses a grid over the pixel limit before allocating it, and keeps the open image', async () => {
    const huge: TestGridOptions = { rows: 15, cols: 15, boxSizeMm: 50, gapMm: 20, dpi: 300, type: 'power-matrix' };
    const size = testGridSizePx(huge);
    expect(size.width * size.height).toBeGreaterThan(MAX_TEST_GRID_PIXELS);
    const before = currentDoc();
    const { calls, make } = recordingPreview();

    await expect(openTestGridRaster(huge, 'grid.png', make)).rejects.toThrow(/megapixels/);
    expect(calls).toEqual([]);
    expect(store().doc).toBe(before);
  });
});

describe('image loader', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('says clearly when the browser has no 2D canvas at all', () => {
    expect(typeof OffscreenCanvas).toBe('undefined');
    expect(typeof document).toBe('undefined');
    expect(() => canvas2d(10, 10)).toThrow(/no 2D canvas/);
  });

  it('falls back to a DOM canvas without OffscreenCanvas, and reads only the header of the file for its DPI', async () => {
    const drawn: number[][] = [];
    const fakeCtx = {
      drawImage: (_: unknown, x: number, y: number, w: number, h: number) => drawn.push([x, y, w, h]),
      getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255) }),
    };
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx }),
    });
    vi.stubGlobal('createImageBitmap', async () => ({ width: 6000, height: 4000, close: () => {} }));

    // A PNG signature and a pHYs chunk at 300 DPI, followed by megabytes of data.
    const head = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 9, ...'pHYs'.split('').map((c) => c.charCodeAt(0)), 0, 0, 0x2e, 0x23, 0, 0, 0x2e, 0x23, 1, 0, 0, 0, 0];
    const bytes = new Uint8Array(4 * 1024 * 1024);
    bytes.set(head);
    const file = new File([bytes], 'big.png', { type: 'image/png' });
    const sliceSpy = vi.spyOn(file, 'slice');
    const wholeSpy = vi.spyOn(file, 'arrayBuffer');

    const decoded = await decodeImageFile(file);

    expect(sliceSpy).toHaveBeenCalledWith(0, DPI_HEADER_BYTES);
    expect(wholeSpy).not.toHaveBeenCalled();
    expect(decoded.fileDpi).toBeCloseTo(299.9994, 3);
    expect([decoded.widthPx, decoded.heightPx]).toEqual([6000, 4000]);
    expect([decoded.previewWidth, decoded.previewHeight]).toEqual([2048, 1365]);
    expect(drawn).toEqual([[0, 0, 2048, 1365]]);
  });
});
