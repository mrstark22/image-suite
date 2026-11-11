/**
 * Physical size (design section 1, the #15 rows). Size is stored once, as
 * `mmPerPx`; width, height and DPI are derived from it and the crop. The
 * size tests use a 6000x4000 image previewed at 2048x1365: part 1 tested only
 * at scale 1 and shipped a wrong DPI because of it. The tests that check
 * pixels render through the real pipeline (#16).
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
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
import { cropRectOf, dpiOf, exportResolution, mmPerPxForLength, physicalSize } from '../../src/lib/document-size';
import { previewBoxToSource, type PreviewSource } from '../../src/lib/crop';
import { previewTarget, pxPerMmOf } from '../../src/lib/render-target';
import { nearestOddAtLeast3, toRunParams } from '../../src/lib/run-params';
import { currentDoc, labelledImage, openPhoto, PHOTO, previewMismatches, resetStores } from '../helpers/documents';
import { loadPixels, startTestPipeline, type TestPipeline } from '../helpers/pipeline';
import { loadWasm, runPipeline, grayImage } from '../helpers/wasm';

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
    const target = previewTarget(currentDoc());
    expect(target).toEqual({ widthPx: 2048, heightPx: 1365 });
    expect(pxPerMmOf(currentDoc(), target)).toBeCloseTo(2048 / 508, 9);
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

describe('crop followed by other edits (#15), rendered', () => {
  // A 1200x800 labelled image: its crops render at 1:1, so every pixel can be checked.
  let pipeline: TestPipeline;
  beforeAll(async () => {
    pipeline = await startTestPipeline();
  });
  afterAll(() => pipeline.stop());

  async function openLabelled(width: number, height: number) {
    resetStores();
    store().open(await loadPixels(pipeline.api, labelledImage(width, height), width, height));
    await pipeline.settled();
  }

  it('keeps the crop and the scale after size, tone, detail and dither edits; the size and the preview follow the crop', async () => {
    await openLabelled(1200, 800);
    store().edit(setScale(25.4 / 300));
    store().edit(setCrop({ x: 300, y: 200, width: 600, height: 400 }));
    const crop = currentDoc().steps.crop;

    const check = async (mmPerPx: number) => {
      await pipeline.settled();
      expect(currentDoc().steps.crop).toEqual(crop);
      expect(currentDoc().mmPerPx).toBe(mmPerPx);
      expect(physicalSize(currentDoc())!.widthMm).toBeCloseTo(600 * mmPerPx, 9);
      expect(physicalSize(currentDoc())!.heightMm).toBeCloseTo(400 * mmPerPx, 9);
      // The preview's source render is exactly the cropped pixels.
      expect(previewMismatches(300, 200, 600, 400)).toBe(0);
      expect(useRenderStore.getState().processed?.byteLength).toBe(600 * 400 * 4);
    };

    // Size: setting a width of 200 mm for the 600 px crop.
    store().edit(setScale(mmPerPxForLength(600, 200, 'mm')));
    await check(200 / 600);

    // Tone, with a gesture as a slider makes it.
    const token = store().beginGesture();
    store().updateGesture(token, setTonal({ contrast: 30 }));
    store().endGesture(token);
    store().edit(resetTonal);
    await check(200 / 600);

    store().edit(setDetail({ unsharpStrength: 50, adaptiveThreshold: true }));
    await check(200 / 600);

    store().edit(setDither({ ...DEFAULT_DITHER, algorithm: 'floyd-steinberg' }));
    store().edit(setVector({ threshold: 90 }));
    await check(200 / 600);
  });

  it('is undone and redone, preview pixels included', async () => {
    await openLabelled(1200, 800);
    store().edit(setCrop({ x: 300, y: 200, width: 600, height: 400 }));
    store().edit(setCrop({ x: 600, y: 400, width: 300, height: 200 }));
    await pipeline.settled();
    expect(previewMismatches(600, 400, 300, 200)).toBe(0);

    store().undo();
    await pipeline.settled();
    expect(previewMismatches(300, 200, 600, 400)).toBe(0);
    store().undo();
    await pipeline.settled();
    expect(previewMismatches(0, 0, 1200, 800)).toBe(0);
    store().redo();
    await pipeline.settled();
    expect(previewMismatches(300, 200, 600, 400)).toBe(0);
  });

  it('crops at scale 1: a 30x20 image shows exactly the chosen pixels', async () => {
    await openLabelled(30, 20);
    store().edit(setCrop({ x: 4, y: 3, width: 10, height: 7 }));
    await pipeline.settled();
    expect(currentDoc().steps.crop).toEqual({ x: 4, y: 3, width: 10, height: 7 });
    expect(previewMismatches(4, 3, 10, 7)).toBe(0);
  });

  it('a 6000x4000 photo renders a 2048x1365 preview from the full source, and a crop of it at up to 2048 px', async () => {
    resetStores();
    store().open(await loadPixels(pipeline.api, labelledImage(6000, 4000), 6000, 4000));
    await pipeline.settled();
    expect([useRenderStore.getState().source?.width, useRenderStore.getState().source?.height]).toEqual([2048, 1365]);
    // A 3000x4000 half is rendered from the source at 1536x2048, not cut from the whole-image preview at 1024x1365.
    store().edit(setCrop({ x: 3000, y: 0, width: 3000, height: 4000 }));
    await pipeline.settled();
    const source = useRenderStore.getState().source!;
    expect([source.width, source.height]).toEqual([1536, 2048]);
    expect(source.crop).toEqual({ x: 3000, y: 0, width: 3000, height: 4000 });
    expect(useRenderStore.getState().processed?.byteLength).toBe(1536 * 2048 * 4);
  });
});

describe('crop is stored in source pixels', () => {
  /** The preview's source render of `crop` of the photo, as the worker sizes it. */
  function renderOf(crop: { x: number; y: number; width: number; height: number }): PreviewSource {
    store().edit(setCrop(crop));
    const target = previewTarget(currentDoc());
    return { key: '', sourceId: '', crop: cropRectOf(currentDoc()), buffer: new ArrayBuffer(0), width: target.widthPx, height: target.heightPx };
  }

  it('a box drawn on the 2048 px preview becomes the matching box of the 6000 px source', () => {
    const source = renderOf({ x: 0, y: 0, width: 6000, height: 4000 });
    expect([source.width, source.height]).toEqual([2048, 1365]);
    // The right half of the preview is the right half of the source.
    expect(previewBoxToSource(source, { x: 1024, y: 0, width: 1024, height: 1365 })).toEqual({
      x: 3000,
      y: 0,
      width: 3000,
      height: 4000,
    });
  });

  it('a second box is drawn on the cropped preview and lands inside the first crop', () => {
    const source = renderOf({ x: 3000, y: 0, width: 3000, height: 4000 });
    expect([source.width, source.height]).toEqual([1536, 2048]);
    const rect = previewBoxToSource(source, { x: 0, y: 0, width: 768, height: 2048 })!;
    expect(rect).toEqual({ x: 3000, y: 0, width: 1500, height: 4000 });
    // Drawn past the edge: clipped to the current crop, never outside it.
    const sx = 3000 / 1536;
    const sy = 4000 / 2048;
    expect(previewBoxToSource(source, { x: 1400, y: -50, width: 500, height: 100 })).toEqual({
      x: 3000 + Math.round(1400 * sx),
      y: 0,
      width: 6000 - (3000 + Math.round(1400 * sx)),
      height: Math.round(50 * sy),
    });
    expect(previewBoxToSource(source, { x: 2000, y: 2100, width: 10, height: 10 })).toBeNull();
  });
});

describe('size not set', () => {
  const target = { widthPx: 64, heightPx: 48 };

  it.each([
    ['sharpening', { ...DEFAULT_DETAIL, unsharpStrength: 150 }],
    ['the adaptive threshold', { ...DEFAULT_DETAIL, adaptiveThreshold: true }],
  ])('skips %s: the output equals running without it, and setting the size enables it', async (_, settings) => {
    const wasm = await loadWasm();
    const image = grayImage(target.widthPx, target.heightPx, (x, y) => 128 + 60 * Math.sin(x / 3) * Math.cos(y / 5));
    const run = (detail: typeof settings, pxPerMm: number | null) => {
      const p = toRunParams({ ...currentDoc().steps, detail }, pxPerMm, target, 'final');
      return runPipeline(wasm, image, target.widthPx, target.heightPx, {
        sharpen: { amount: p.sharpenAmount, radius: p.sharpenRadius },
        adaptive: p.enableAdaptive ? { block: p.adaptiveBlock, c: p.adaptiveC } : undefined,
      });
    };
    const neither = run(DEFAULT_DETAIL, null);

    const unsizedParams = toRunParams({ ...currentDoc().steps, detail: settings }, null, target, 'final');
    expect(unsizedParams.sharpenAmount).toBe(0);
    expect(unsizedParams.enableAdaptive).toBe(false);
    expect(Buffer.from(run(settings, null)).equals(Buffer.from(neither))).toBe(true);
    expect(Buffer.from(run(settings, 300 / 25.4)).equals(Buffer.from(neither))).toBe(false);
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
    const steps = { ...currentDoc().steps, detail: { ...DEFAULT_DETAIL, unsharpStrength: 10, adaptiveThreshold: true } };
    // 0.13 mm and 1.3 mm at 300 DPI are the old 1.5 px and 15 px defaults.
    const at300 = toRunParams(steps, 300 / 25.4, { widthPx: 6000, heightPx: 4000 }, 'final');
    expect(at300.sharpenRadius).toBeCloseTo(1.535, 3);
    expect(at300.adaptiveBlock).toBe(15);
    // On the 2048 px preview of a 508 mm photo the same lengths are fewer pixels.
    const preview = toRunParams(steps, 2048 / 508, { widthPx: 2048, heightPx: 1365 }, 'final');
    expect(preview.adaptiveBlock).toBe(5);
    expect(preview.sharpenRadius).toBeCloseTo(0.13 * (2048 / 508), 9);
  });

  it('rounds the adaptive block to the nearest odd integer, at least 3', () => {
    expect([0, 1, 2.9, 3, 3.9, 4.1, 5, 6.2, 14.9, 15.2, 16.1].map(nearestOddAtLeast3)).toEqual([
      3, 3, 3, 3, 3, 5, 5, 7, 15, 15, 17,
    ]);
  });
});
