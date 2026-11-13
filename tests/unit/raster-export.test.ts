/**
 * Full-resolution raster export (#17, design section 6). The real pipeline
 * runs in this process; the files are decoded by independent decoders
 * (tests/helpers/png-decode.ts and bmp-decode.ts).
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { useDocumentStore } from '../../src/store/documentStore';
import { useRenderStore } from '../../src/store/renderStore';
import { setCrop, setDither, setScale, setTonal } from '../../src/lib/document';
import { physicalSize } from '../../src/lib/document-size';
import { exportPlan, nativeTarget } from '../../src/lib/render-target';
import { cancelRasterExport, exportRaster } from '../../src/lib/raster-export';
import type { ImageDocument } from '../../src/types/document';
import type { ExportProgress, RasterExport } from '../../src/types/worker-messages';
import { currentDoc, greyscale, labelledImage, resetStores } from '../helpers/documents';
import { loadPixels, startTestPipeline, type TestPipeline } from '../helpers/pipeline';
import { decodePng } from '../helpers/png-decode';
import { decodeBmp } from '../helpers/bmp-decode';

const store = () => useDocumentStore.getState();
const render = () => useRenderStore.getState();

let pipeline: TestPipeline;
beforeAll(async () => {
  pipeline = await startTestPipeline();
});
afterAll(() => pipeline.stop());

beforeEach(() => {
  resetStores();
});

/** 0.0847 mm per pixel is 299.9 DPI: 11,806.4 pixels per metre, so the file rounds it. */
const MM_PER_PX = 0.0847;

async function openLabelled(width: number, height: number, mmPerPx: number | null = MM_PER_PX) {
  store().open(await loadPixels(pipeline.api, labelledImage(width, height), width, height, 'photo.png'), mmPerPx);
  // The greyscale path at native resolution; the dithered export is tested below and in photo-engraving.test.ts.
  greyscale();
  await pipeline.settled();
}

/** The `final` stage of `doc` at its native target, rendered through the preview's code path. */
async function nativeFinal(doc: ImageDocument): Promise<Uint8Array> {
  const res = await pipeline.api.renderPreview({ doc, target: nativeTarget(doc), haveSourceKey: null });
  return new Uint8Array(res.final.pixels);
}

async function exported(format: 'png' | 'bmp'): Promise<RasterExport> {
  const file = await exportRaster(currentDoc(), format);
  if (!file) throw new Error('The export was cancelled');
  return file;
}

describe('raster export at full resolution', () => {
  it('exports a 3000x2000 source as 3000x2000 PNG and BMP files carrying the document DPI', async () => {
    await openLabelled(3000, 2000);
    // An adjustment, so the file is the `final` stage, not the source.
    store().edit(setTonal({ contrast: 30 }));
    const doc = currentDoc();
    const expected = await nativeFinal(doc);
    const ppm = Math.round(1000 / MM_PER_PX);
    expect(ppm).toBe(11806);

    const png = decodePng(new Uint8Array((await exported('png')).bytes));
    expect([png.width, png.height]).toEqual([3000, 2000]);
    expect(png.bitDepth).toBe(8);
    expect(png.colorType).toBe(2); // RGB: the image has colour, and no transparency after flattening
    expect(png.phys).toEqual({ x: ppm, y: ppm, unit: 1 });
    expect(png.chunkTypes.indexOf('pHYs')).toBeLessThan(png.chunkTypes.indexOf('IDAT'));
    let mismatches = 0;
    for (let i = 0, s = 0; i < expected.length; i += 4, s += 3) {
      if (png.samples[s] !== expected[i] || png.samples[s + 1] !== expected[i + 1] || png.samples[s + 2] !== expected[i + 2]) {
        mismatches++;
      }
    }
    expect(mismatches).toBe(0);

    const bmp = decodeBmp((await exported('bmp')).bytes);
    expect([bmp.width, bmp.height]).toEqual([3000, 2000]);
    expect(bmp.pixelsPerMetreX).toBe(ppm);
    expect(bmp.pixelsPerMetreY).toBe(ppm);
    mismatches = 0;
    for (let i = 0, s = 0; i < expected.length; i += 4, s += 3) {
      if (bmp.pixels[s] !== expected[i] || bmp.pixels[s + 1] !== expected[i + 1] || bmp.pixels[s + 2] !== expected[i + 2]) {
        mismatches++;
      }
    }
    expect(mismatches).toBe(0);

    // The physical size the file gives is the document's, within the rounding to whole pixels per metre.
    const size = physicalSize(doc)!;
    expect(Math.abs((3000 / ppm) * 1000 - size.widthMm)).toBeLessThan(size.widthMm * (0.5 / ppm));
    expect(Math.abs((2000 / ppm) * 1000 - size.heightMm)).toBeLessThan(size.heightMm * (0.5 / ppm));
  });

  it('writes what the Export panel shows: the plan for a crop is the crop at full resolution', async () => {
    await openLabelled(1500, 1000, 25.4 / 600);
    store().edit(setCrop({ x: 101, y: 37, width: 1234, height: 567 }));
    const doc = currentDoc();
    const plan = exportPlan(doc);
    expect(plan.target).toEqual({ widthPx: 1234, heightPx: 567 });
    expect(plan.dpi).toBeCloseTo(600, 9);
    expect(plan.widthMm).toBeCloseTo(physicalSize(doc)!.widthMm, 9);
    expect(plan.heightMm).toBeCloseTo(physicalSize(doc)!.heightMm, 9);

    const file = await exported('png');
    expect([file.widthPx, file.heightPx]).toEqual([1234, 567]);
    const png = decodePng(new Uint8Array(file.bytes));
    expect([png.width, png.height]).toEqual([1234, 567]);
    // 600 DPI is 23,622.0 pixels per metre.
    expect(png.phys).toEqual({ x: Math.round(plan.pxPerMm * 1000), y: Math.round(plan.pxPerMm * 1000), unit: 1 });
    expect(png.phys!.x).toBe(23622);
  });

  it('writes a dithered image as 1-bit black and white at the dot grid, bit for bit (#39)', async () => {
    // 640 px at 254 DPI is 64 mm: at the default 0.1 mm line interval, 640 dots.
    await openLabelled(640, 480, 25.4 / 254);
    store().edit(setDither({ algorithm: 'floyd-steinberg' }));
    const expected = await nativeFinal(currentDoc());
    const png = decodePng(new Uint8Array((await exported('png')).bytes));
    expect([png.width, png.height, png.bitDepth, png.colorType]).toEqual([640, 480, 1, 0]);
    expect(png.phys).toEqual({ x: 10000, y: 10000, unit: 1 });
    let mismatches = 0;
    for (let i = 0; i < png.samples.length; i++) if (png.samples[i] * 255 !== expected[i * 4]) mismatches++;
    expect(mismatches).toBe(0);
  });

  it('refuses while the size is not set, and works once it is set', async () => {
    await openLabelled(200, 100, null);
    await expect(exportRaster(currentDoc(), 'png')).rejects.toThrow(/Set the size/);
    expect(() => pipeline.api.exportRaster(currentDoc(), 'png')).toThrow(/Set the size/);
    expect(render().exportProgress).toBeNull();
    store().edit(setScale(0.1));
    const png = decodePng(new Uint8Array((await exported('png')).bytes));
    expect([png.width, png.height]).toEqual([200, 100]);
    expect(png.phys!.x).toBe(10000);
  });

  it('refuses while background removal (preview-sized) is applied, rather than leave it out', async () => {
    await openLabelled(200, 100);
    const source = render().source!;
    expect(render().replaceSourcePixels(source.buffer.slice(0), source)).toBe(true);
    await expect(exportRaster(currentDoc(), 'png')).rejects.toThrow(/Background removal/);
    render().restoreSource();
    await expect(exportRaster(currentDoc(), 'png')).resolves.not.toBeNull();
  });
});

describe('export progress, pausing the preview, and cancelling', () => {
  it('reports preparing, processing and encoding in order, and clears when done', async () => {
    await openLabelled(1200, 1000);
    const seen: ExportProgress[] = [];
    const unsubscribe = useRenderStore.subscribe((s) => {
      if (s.exportProgress) seen.push(s.exportProgress);
    });
    try {
      await exported('png');
    } finally {
      unsubscribe();
    }
    expect(render().exportProgress).toBeNull();
    const stages = seen.map((p) => p.stage).filter((s, i, all) => s !== all[i - 1]);
    expect(stages).toEqual(['preparing', 'processing', 'encoding']);
    const encoding = seen.filter((p) => p.stage === 'encoding').map((p) => p.fraction);
    // 1200 x 1000 RGB is several chunks of rows.
    expect(encoding.length).toBeGreaterThan(2);
    for (let i = 1; i < encoding.length; i++) expect(encoding[i]).toBeGreaterThan(encoding[i - 1]);
    expect(encoding[encoding.length - 1]).toBe(1);
  });

  it('pauses the preview while exporting and renders the latest document once it ends', async () => {
    await openLabelled(600, 400);
    const versionBefore = render().previewVersion;
    let edited = false;
    const unsubscribe = useRenderStore.subscribe((s) => {
      if (!edited && s.exportProgress?.stage === 'processing') {
        edited = true;
        store().edit(setTonal({ invert: true }));
      }
    });
    const exportingDoc = currentDoc();
    let file: RasterExport | null;
    try {
      file = await exportRaster(exportingDoc, 'png');
    } finally {
      unsubscribe();
    }
    expect(edited).toBe(true);
    // Nothing was committed while the export ran.
    expect(render().previewVersion).toBe(versionBefore);
    // The file is the document as it was when the export started: not inverted.
    const png = decodePng(new Uint8Array(file!.bytes));
    const expected = await nativeFinal(exportingDoc);
    expect(png.samples[0]).toBe(expected[0]);

    await pipeline.settled();
    expect(render().previewVersion).toBeGreaterThan(versionBefore);
    const inverted = await nativeFinal(currentDoc());
    expect(new Uint8Array(render().processed!)[0]).toBe(inverted[0]);
    expect(inverted[0]).toBe(255 - expected[0]);
  });

  it('stops at the next boundary when cancelled, and the next export works', async () => {
    await openLabelled(1200, 1000);
    let encodingSeen = 0;
    const unsubscribe = useRenderStore.subscribe((s) => {
      if (s.exportProgress?.stage === 'encoding') {
        encodingSeen++;
        if (encodingSeen === 1) cancelRasterExport();
      }
    });
    try {
      await expect(exportRaster(currentDoc(), 'png')).resolves.toBeNull();
    } finally {
      unsubscribe();
    }
    // Cancelled at the first boundary after the request: no more chunks were encoded.
    expect(encodingSeen).toBe(1);
    expect(render().exportProgress).toBeNull();

    const png = decodePng(new Uint8Array((await exported('png')).bytes));
    expect([png.width, png.height]).toEqual([1200, 1000]);
  });

  it('frees the WASM memory of the render', async () => {
    await openLabelled(800, 600);
    await exported('png');
    const instance = (pipeline.api as unknown as { instance(): Promise<{ core: { wasm: { memory: WebAssembly.Memory } } }> }).instance();
    const pages = (await instance).core.wasm.memory.buffer.byteLength;
    // A leak of one 800 x 600 render per export would grow memory over repeated exports.
    for (let i = 0; i < 6; i++) await exported('png');
    expect((await instance).core.wasm.memory.buffer.byteLength).toBe(pages);
    // The same instance throughout: nothing here is large enough to have it replaced.
    expect(pipeline.api.instancesStarted).toBe(1);
  });
});
