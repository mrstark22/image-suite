/**
 * Physical size (design section 1, the #15 rows). Size is stored once, as
 * `mmPerPx`; width, height and DPI are derived from it and the crop. The
 * tests use a 6000x4000 image previewed at 2048x1365: part 1 tested only at
 * scale 1 and shipped a wrong DPI because of it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useDocumentStore } from '../../src/store/documentStore';
import { useRenderStore } from '../../src/store/renderStore';
import {
  DEFAULT_DETAIL,
  DEFAULT_DITHER,
  resetTonal,
  setCrop,
  setDetail,
  setDither,
  setScale,
  setTonal,
  setVector,
} from '../../src/lib/document';
import {
  cropRectOf,
  detailRunParams,
  dpiOf,
  exportResolution,
  mmPerPxForLength,
  nearestOddAtLeast3,
  physicalSize,
  pxPerMmAt,
} from '../../src/lib/document-size';
import { previewBoxToSource } from '../../src/lib/crop';
import { currentDoc, decodedImage, openPhoto, PHOTO, previewMismatches, resetStores } from '../helpers/documents';
import { loadWasm, runPipeline, grayImage, type Wasm } from '../helpers/wasm';
import type { DetailRunParams } from '../../src/types/image';

const store = () => useDocumentStore.getState();

beforeEach(() => {
  resetStores();
  openPhoto();
});

describe('size derivation', () => {
  const crops = [
    null,
    { x: 0, y: 0, width: 3000, height: 2000 },
    { x: 1234, y: 567, width: 4321, height: 1111 },
    { x: 5999, y: 3999, width: 1, height: 1 },
  ];
  const scales = [25.4 / 300, 0.1, 25.4 / 72, 0.0254];

  it.each(crops.flatMap((crop) => scales.map((mmPerPx) => [crop, mmPerPx] as const)))(
    'crop %j at %f mm/px: width, height and DPI follow the formulas',
    (crop, mmPerPx) => {
      store().edit(setScale(mmPerPx));
      store().edit(setCrop(crop));
      const doc = currentDoc();
      const w = crop?.width ?? PHOTO.widthPx;
      const h = crop?.height ?? PHOTO.heightPx;

      const size = physicalSize(doc)!;
      expect(size.widthMm).toBeCloseTo(w * mmPerPx, 9);
      expect(size.heightMm).toBeCloseTo(h * mmPerPx, 9);
      expect(dpiOf(doc)).toBeCloseTo(25.4 / mmPerPx, 9);
      // Cropping keeps the scale.
      expect(doc.mmPerPx).toBe(mmPerPx);
    }
  );

  it('the uncropped 6000x4000 photo at 300 DPI is 508 x 338.67 mm, from the file size, not the preview', () => {
    store().edit(setScale(25.4 / 300));
    const size = physicalSize(currentDoc())!;
    expect(size.widthMm).toBeCloseTo(508, 9);
    expect(size.heightMm).toBeCloseTo(338.667, 3);
    expect(cropRectOf(currentDoc())).toEqual({ x: 0, y: 0, width: 6000, height: 4000 });
  });

  it('setting a width of 100 mm on the whole photo gives 1524 DPI and a height of 66.67 mm', () => {
    const doc = currentDoc();
    store().edit(setScale(mmPerPxForLength(cropRectOf(doc).width, 100, 'mm')));
    expect(dpiOf(currentDoc())).toBeCloseTo(1524, 9);
    expect(physicalSize(currentDoc())!.heightMm).toBeCloseTo(66.667, 3);
  });

  it('setting the size applies to the current crop: 4 inches across a 3000 px crop is 750 DPI', () => {
    store().edit(setCrop({ x: 0, y: 0, width: 3000, height: 2000 }));
    store().edit(setScale(mmPerPxForLength(3000, 4, 'in')));
    expect(dpiOf(currentDoc())).toBeCloseTo(750, 9);
    // Removing the crop keeps the scale: the whole photo is twice as wide.
    store().edit(setCrop(null));
    expect(physicalSize(currentDoc())!.widthMm).toBeCloseTo(8 * 25.4, 9);
  });

  it('cropping halves the width in millimetres and keeps the DPI', () => {
    store().edit(setScale(0.1));
    store().edit(setCrop({ x: 3000, y: 0, width: 3000, height: 4000 }));
    expect(physicalSize(currentDoc())!.widthMm).toBeCloseTo(300, 9);
    expect(dpiOf(currentDoc())).toBeCloseTo(254, 9);
  });

  it('the preview has its own pixels per mm: 2048 px across 508 mm', () => {
    store().edit(setScale(25.4 / 300));
    const source = useRenderStore.getState().source!;
    expect(source.width).toBe(2048);
    expect(pxPerMmAt(currentDoc(), source.width)).toBeCloseTo(2048 / 508, 9);
  });

  it('the size is not set until it is set, whatever the file claims', () => {
    resetStores();
    openPhoto(72);
    expect(currentDoc().mmPerPx).toBeNull();
    expect(physicalSize(currentDoc())).toBeNull();
    expect(dpiOf(currentDoc())).toBeNull();
  });

  it('rejects a scale that is not a positive number', () => {
    expect(() => setScale(0)).toThrow(RangeError);
    expect(() => setScale(-1)).toThrow(RangeError);
    expect(() => setScale(Number.NaN)).toThrow(RangeError);
  });
});

describe('crop followed by other edits (#15)', () => {
  it('keeps the crop and the scale after size, tone, detail and dither edits, and the size follows the crop', () => {
    store().edit(setScale(25.4 / 300));
    store().edit(setCrop({ x: 1500, y: 1000, width: 3000, height: 2000 }));
    const crop = currentDoc().steps.crop;

    const check = (mmPerPx: number) => {
      expect(currentDoc().steps.crop).toEqual(crop);
      expect(currentDoc().mmPerPx).toBe(mmPerPx);
      expect(physicalSize(currentDoc())!.widthMm).toBeCloseTo(3000 * mmPerPx, 9);
      expect(physicalSize(currentDoc())!.heightMm).toBeCloseTo(2000 * mmPerPx, 9);
      // The preview still shows the crop: preview x 512..1536, y 341..1024 (of 2048 x 1365).
      expect(previewMismatches(512, 341, 1024, 683)).toBe(0);
    };

    // Size: setting a width of 200 mm for the 3000 px crop.
    store().edit(setScale(mmPerPxForLength(3000, 200, 'mm')));
    check(200 / 3000);

    // Tone, with a gesture as a slider makes it.
    const token = store().beginGesture();
    store().updateGesture(token, setTonal({ contrast: 30 }));
    store().endGesture(token);
    store().edit(resetTonal);
    check(200 / 3000);

    store().edit(setDetail({ unsharpStrength: 50, adaptiveThreshold: true }));
    check(200 / 3000);

    store().edit(setDither({ ...DEFAULT_DITHER, algorithm: 'floyd-steinberg' }));
    store().edit(setVector({ threshold: 90 }));
    check(200 / 3000);
  });

  it('is undone and redone, preview pixels included', () => {
    store().edit(setCrop({ x: 1500, y: 1000, width: 3000, height: 2000 }));
    store().edit(setCrop({ x: 3000, y: 2000, width: 1500, height: 1000 }));
    expect(previewMismatches(1024, 683, 512, 341)).toBe(0);

    store().undo();
    expect(previewMismatches(512, 341, 1024, 683)).toBe(0);
    store().undo();
    expect(previewMismatches(0, 0, 2048, 1365)).toBe(0);
    store().redo();
    expect(previewMismatches(512, 341, 1024, 683)).toBe(0);
  });
});

describe('crop is stored in source pixels', () => {
  it('a box drawn on the 2048 px preview becomes the matching box of the 6000 px source', () => {
    const source = useRenderStore.getState().source!;
    // The right half of the preview is the right half of the source.
    expect(previewBoxToSource(source, { x: 1024, y: 0, width: 1024, height: 1365 })).toEqual({
      x: 3000,
      y: 0,
      width: 3000,
      height: 4000,
    });
  });

  it('a second box is drawn on the cropped preview and lands inside the first crop', () => {
    store().edit(setCrop({ x: 3000, y: 0, width: 3000, height: 4000 }));
    const source = useRenderStore.getState().source!;
    expect(source.width).toBe(1024);
    expect(source.height).toBe(1365);
    const rect = previewBoxToSource(source, { x: 0, y: 0, width: 512, height: 1365 })!;
    expect(rect).toEqual({ x: 3000, y: 0, width: 1500, height: 4000 });
    // Drawn past the edge: clipped to the current crop, never outside it.
    expect(previewBoxToSource(source, { x: 900, y: -50, width: 500, height: 100 })).toEqual({
      x: 3000 + Math.round(900 * (3000 / 1024)),
      y: 0,
      width: 6000 - (3000 + Math.round(900 * (3000 / 1024))),
      height: Math.round(50 * (4000 / 1365)),
    });
    expect(previewBoxToSource(source, { x: 2000, y: 2000, width: 10, height: 10 })).toBeNull();
  });

  it('crops at scale 1 too: a 30x20 image shows exactly the chosen pixels', () => {
    resetStores();
    store().open(decodedImage(30, 20));
    store().edit(setCrop({ x: 4, y: 3, width: 10, height: 7 }));
    expect(currentDoc().steps.crop).toEqual({ x: 4, y: 3, width: 10, height: 7 });
    expect(previewMismatches(4, 3, 10, 7)).toBe(0);
  });
});

describe('size not set', () => {
  const OFF: DetailRunParams = detailRunParams(DEFAULT_DETAIL, null);

  function runDetail(wasm: Wasm, image: Uint8Array, w: number, h: number, p: DetailRunParams) {
    return runPipeline(wasm, image, w, h, {
      sharpen: { amount: p.unsharpStrength / 100, radius: p.unsharpRadiusPx },
      adaptive: p.adaptiveThreshold ? { block: p.adaptiveBlockPx, c: p.adaptiveConstant } : undefined,
    });
  }

  it.each([
    ['sharpening', { ...DEFAULT_DETAIL, unsharpStrength: 150 }],
    ['the adaptive threshold', { ...DEFAULT_DETAIL, adaptiveThreshold: true }],
  ])('skips %s: the output equals running without it, and setting the size enables it', async (_, settings) => {
    const wasm = await loadWasm();
    const w = 64;
    const h = 48;
    const image = grayImage(w, h, (x, y) => 128 + 60 * Math.sin(x / 3) * Math.cos(y / 5));
    const neither = runDetail(wasm, image, w, h, OFF);

    const unsizedParams = detailRunParams(settings, null);
    expect(unsizedParams.unsharpStrength).toBe(0);
    expect(unsizedParams.adaptiveThreshold).toBe(false);
    const unsized = runDetail(wasm, image, w, h, unsizedParams);
    expect(Buffer.from(unsized).equals(Buffer.from(neither))).toBe(true);

    const sized = runDetail(wasm, image, w, h, detailRunParams(settings, 300 / 25.4));
    expect(Buffer.from(sized).equals(Buffer.from(neither))).toBe(false);
  });

  it('export refuses while the size is not set, and works once it is set', () => {
    expect(() => exportResolution(currentDoc(), 2048)).toThrow(/Set the size/);
    store().edit(setScale(25.4 / 300));
    // The preview-sized file carries the DPI that keeps the document's 508 mm width.
    const { dpi } = exportResolution(currentDoc(), 2048);
    expect(dpi).toBeCloseTo(2048 / (508 / 25.4), 9);
    expect((2048 / dpi) * 25.4).toBeCloseTo(508, 9);
  });

  it('converts lengths from mm to pixels of the image being run', () => {
    // 0.13 mm and 1.3 mm at 300 DPI are the old 1.5 px and 15 px defaults.
    const at300 = detailRunParams({ ...DEFAULT_DETAIL, unsharpStrength: 10, adaptiveThreshold: true }, 300 / 25.4);
    expect(at300.unsharpRadiusPx).toBeCloseTo(1.535, 3);
    expect(at300.adaptiveBlockPx).toBe(15);
    // On the 2048 px preview of a 508 mm photo the same lengths are fewer pixels.
    const preview = detailRunParams({ ...DEFAULT_DETAIL, adaptiveThreshold: true }, 2048 / 508);
    expect(preview.adaptiveBlockPx).toBe(5);
    expect(preview.unsharpRadiusPx).toBeCloseTo(0.13 * (2048 / 508), 9);
  });

  it('rounds the adaptive block to the nearest odd integer, at least 3', () => {
    expect([0, 1, 2.9, 3, 3.9, 4.1, 5, 6.2, 14.9, 15.2, 16.1].map(nearestOddAtLeast3)).toEqual([
      3, 3, 3, 3, 3, 5, 5, 7, 15, 15, 17,
    ]);
  });
});
