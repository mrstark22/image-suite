/**
 * The resolution-independent pipeline (#16, design sections 2 and 7): one
 * `render` for every target and stage, with lengths stored in millimetres.
 * Rendering at preview size must match a native render scaled down to it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { RustWasmEngine } from '../../src/wasm/wasm-bridge';
import { PipelineEngine, MAX_SOURCE_PIXELS, TooLargeError } from '../../src/lib/pipeline-engine';
import { nativeTarget, previewTarget, pxPerMmOf } from '../../src/lib/render-target';
import { nearestOddAtLeast3, toRunParams } from '../../src/lib/run-params';
import { createDocument, DEFAULT_DETAIL, setColor, setCrop, setDetail, setDither, setTonal } from '../../src/lib/document';
import type { ImageDocument } from '../../src/types/document';
import { loadWasm, prepareSource, redChannel } from '../helpers/wasm';
import { areaDownscale, photoLike, shadedDrawing } from '../helpers/reference';

let engine: PipelineEngine;
let wasm: Awaited<ReturnType<typeof loadWasm>>;

beforeAll(async () => {
  wasm = await loadWasm();
  engine = new PipelineEngine(RustWasmEngine.fromExports(wasm.exports as never));
});

// A 1200 x 900 photo-like source sized to 120 mm wide (254 DPI). The preview
// target is capped at 300 px, a quarter of the native width.
const W = 1200;
const H = 900;
const PREVIEW_EDGE = 300;
const SOURCE = photoLike(W, H, 5);

function photoDoc(pixels: Uint8Array = SOURCE): ImageDocument {
  const doc = createDocument('doc', {
    sourceId: 'photo',
    name: 'photo.png',
    widthPx: W,
    heightPx: H,
    format: 'rgba8',
    hasAlpha: false,
    fileDpi: null,
  }, 120 / W);
  engine.putSource('photo', pixels.slice().buffer, W, H);
  return doc;
}

/** Mean and 99th percentile of the absolute differences of the colour channels. */
function differences(a: Uint8Array, b: Uint8Array): { mean: number; p99: number } {
  const diffs: number[] = [];
  for (let i = 0; i < a.length; i++) if ((i & 3) !== 3) diffs.push(Math.abs(a[i] - b[i]));
  diffs.sort((x, y) => x - y);
  const mean = diffs.reduce((s, d) => s + d, 0) / diffs.length;
  return { mean, p99: diffs[Math.floor(diffs.length * 0.99)] };
}

/** Preview render, and native render scaled down to the preview's size. */
function previewAndScaledNative(doc: ImageDocument, stage: 'prepared' | 'final') {
  const pt = previewTarget(doc, PREVIEW_EDGE);
  const nt = nativeTarget(doc);
  const preview = engine.render(doc, pt, stage);
  const native = engine.render(doc, nt, stage);
  const scaled = areaDownscale(new Uint8Array(native.pixels), nt.widthPx, nt.heightPx, pt.widthPx, pt.heightPx);
  return { preview: new Uint8Array(preview.pixels), scaled, pt };
}

describe('render targets and units', () => {
  it('the preview target caps the longest edge and never enlarges; the native target is the crop', () => {
    const doc = photoDoc();
    expect(previewTarget(doc, 300)).toEqual({ widthPx: 300, heightPx: 225 });
    expect(previewTarget(doc, 2048)).toEqual({ widthPx: W, heightPx: H });
    const cropped = setCrop({ x: 100, y: 50, width: 801, height: 400 })(doc);
    expect(nativeTarget(cropped)).toEqual({ widthPx: 801, heightPx: 400 });
    expect(previewTarget(cropped, 300)).toEqual({ widthPx: 300, heightPx: 150 });
    // 801 px at 0.1 mm/px is 80.1 mm; 300 px across it.
    expect(pxPerMmOf(cropped, previewTarget(cropped, 300))).toBeCloseTo(300 / 80.1, 9);
  });

  it('toRunParams converts mm to pixels of the target, with odd adaptive blocks of at least 3', () => {
    const steps = setDetail({ unsharpStrength: 80, unsharpRadiusMm: 0.25, adaptiveThreshold: true, adaptiveBlockMm: 1.3 })(photoDoc()).steps;
    const target = { widthPx: 100, heightPx: 100 };
    for (const pxPerMm of [0.5, 2, 11.811, 40]) {
      const p = toRunParams(steps, pxPerMm, target, 'final');
      expect(p.sharpenRadius).toBeCloseTo(0.25 * pxPerMm, 9);
      expect(p.sharpenAmount).toBeCloseTo(0.8, 9);
      expect(p.adaptiveBlock).toBe(nearestOddAtLeast3(1.3 * pxPerMm));
      expect(p.adaptiveBlock % 2).toBe(1);
      expect(p.adaptiveBlock).toBeGreaterThanOrEqual(3);
    }
    // 1.3 mm at 300 DPI is 15.35 px: block 15, as before the change to mm.
    expect(toRunParams(steps, 300 / 25.4, target, 'final').adaptiveBlock).toBe(15);
    // Size not set: both length-based steps are off.
    const unsized = toRunParams(steps, null, target, 'final');
    expect([unsized.sharpenAmount, unsized.enableAdaptive]).toEqual([0, false]);
    // The prepared stage never dithers.
    const dithered = setDither({ algorithm: 'floyd-steinberg' })(photoDoc()).steps;
    expect(toRunParams(dithered, 2, target, 'prepared').ditherAlgorithm).toBe('none');
    expect(toRunParams(dithered, 2, target, 'final').ditherAlgorithm).toBe('floyd-steinberg');
  });
});

describe('preview against a downscaled native render', () => {
  /** Tone, colour and sharpening, as in a typical photo job. */
  const adjusted = (doc: ImageDocument) =>
    setDetail({ unsharpStrength: 80, unsharpRadiusMm: 0.5 })(
      setColor({ saturation: -30, temperature: 15 })(setTonal({ contrast: 25, shadows: 20, gamma: 1.15, blackPoint: 8 })(doc))
    );

  it('stage prepared, with tone, colour and sharpening: mean difference at most 1 level, 99th percentile at most 6', () => {
    // Detail the preview can resolve: texture 40 native px (10 preview px) apart, no per-pixel noise.
    const doc = adjusted(photoDoc(photoLike(W, H, 5, { noise: false, texturePeriodPx: 40 })));
    const { preview, scaled } = previewAndScaledNative(doc, 'prepared');
    const d = differences(preview, scaled);
    console.info(`prepared, resolvable detail: mean ${d.mean.toFixed(3)} levels, p99 ${d.p99} levels`);
    expect(d.mean).toBeLessThanOrEqual(1.0);
    expect(d.p99).toBeLessThanOrEqual(6);
  });

  it('with detail finer than a preview pixel the difference grows, as it must: mean at most 1.6, p99 at most 9', () => {
    // Per-pixel noise (a quarter of a preview pixel) and stripes 3.6 preview px apart. Tone curves
    // and sharpening do not commute with averaging, so detail the preview cannot resolve renders
    // differently. Measured: mean 1.45, p99 8. The same adjustments on resolvable detail stay
    // within the design's bounds (test above); with no adjustments the two agree to 0.002 levels.
    const doc = adjusted(photoDoc());
    const { preview, scaled } = previewAndScaledNative(doc, 'prepared');
    const d = differences(preview, scaled);
    console.info(`prepared, sub-preview-pixel detail: mean ${d.mean.toFixed(3)} levels, p99 ${d.p99} levels`);
    expect(d.mean).toBeLessThanOrEqual(1.6);
    expect(d.p99).toBeLessThanOrEqual(9);
  });

  it('with no adjustments the two agree to rounding', () => {
    const { preview, scaled } = previewAndScaledNative(photoDoc(), 'prepared');
    const d = differences(preview, scaled);
    expect(d.mean).toBeLessThanOrEqual(0.01);
    expect(d.p99).toBe(0);
  });

  it('sharpening with the radius in mm has the same effect at both resolutions (#16)', () => {
    // A 0.5 mm radius is 5 native px and 1.25 preview px. Before sigma was made proportional to
    // the radius (it had a constant 0.3 px), this measured a mean of 1.11 levels.
    const doc = setDetail({ unsharpStrength: 80, unsharpRadiusMm: 0.5 })(photoDoc(photoLike(W, H, 5, { noise: false, texturePeriodPx: 40 })));
    const { preview, scaled } = previewAndScaledNative(doc, 'prepared');
    const d = differences(preview, scaled);
    console.info(`sharpening only: mean ${d.mean.toFixed(3)} levels, p99 ${d.p99} levels`);
    expect(d.mean).toBeLessThanOrEqual(0.6);
    expect(d.p99).toBeLessThanOrEqual(3);
  });

  it('adaptive threshold with the block in mm: at most 2% of pixels differ after downscaling and thresholding again', () => {
    // A line drawing under uneven light, strokes 0.8 mm (2 preview px) wide.
    const doc = setDetail({ ...DEFAULT_DETAIL, adaptiveThreshold: true, adaptiveBlockMm: 4, adaptiveConstant: 10 })(
      photoDoc(shadedDrawing(W, H, 8))
    );
    const { preview, scaled } = previewAndScaledNative(doc, 'prepared');
    const a = redChannel(preview);
    const b = redChannel(scaled).map((v) => (v >= 128 ? 255 : 0));
    const differing = a.reduce((n, v, i) => n + (v !== b[i] ? 1 : 0), 0) / a.length;
    console.info(`adaptive threshold: ${(differing * 100).toFixed(2)}% of pixels differ`);
    expect(differing).toBeLessThanOrEqual(0.02);
    // And the threshold did its job: both ink and paper are present on the dark side.
    expect(a.some((v) => v === 0) && a.some((v) => v === 255)).toBe(true);
  });

  it('a dither keeps the mean density of blocks of the same physical size, within what its dot count allows', () => {
    // The design estimated 2 levels over blocks 16 preview px across. Measured, the cross-resolution
    // difference is larger, and nearly all of it is the preview's own dither: a 16 x 16 block holds
    // only 256 dots, and Floyd-Steinberg's tone error over a block that small is about 3.5 levels at
    // either resolution. At native resolution the same physical block holds 4096 dots and the error
    // is under 1 level. The inputs also differ slightly at hard edges: the native dither keeps the
    // mean of encoded values, while resampling averages linear light (whether dithering should
    // work in linear light is #39). So the bound is set per part, and the total follows from them.
    const doc = setDither({ algorithm: 'floyd-steinberg' })(
      setColor({ saturation: -100 })(photoDoc(photoLike(W, H, 5, { noise: false, texturePeriodPx: 40 })))
    );
    const pt = previewTarget(doc, PREVIEW_EDGE);
    const nt = nativeTarget(doc);
    const k = nt.widthPx / pt.widthPx;
    const channel = (target: typeof pt, stage: 'prepared' | 'final') => redChannel(new Uint8Array(engine.render(doc, target, stage).pixels));
    const preview = { input: channel(pt, 'prepared'), dither: channel(pt, 'final'), w: pt.widthPx, scale: 1 };
    const native = { input: channel(nt, 'prepared'), dither: channel(nt, 'final'), w: nt.widthPx, scale: k };
    const mean = (img: Uint8Array, w: number, x0: number, y0: number, n: number) => {
      let sum = 0;
      for (let y = y0; y < y0 + n; y++) for (let x = x0; x < x0 + n; x++) sum += img[y * w + x];
      return sum / (n * n);
    };

    for (const [block, worstTotal] of [[16, 4.5], [32, 3]] as const) {
      const worst = { input: 0, previewOwn: 0, nativeOwn: 0, total: 0 };
      let totalSum = 0;
      let count = 0;
      for (let by = 0; by + block <= pt.heightPx; by += block) {
        for (let bx = 0; bx + block <= pt.widthPx; bx += block) {
          const at = (r: typeof preview, img: Uint8Array) => mean(img, r.w, bx * r.scale, by * r.scale, block * r.scale);
          const pIn = at(preview, preview.input), pOut = at(preview, preview.dither);
          const nIn = at(native, native.input), nOut = at(native, native.dither);
          worst.input = Math.max(worst.input, Math.abs(pIn - nIn));
          worst.previewOwn = Math.max(worst.previewOwn, Math.abs(pOut - pIn));
          worst.nativeOwn = Math.max(worst.nativeOwn, Math.abs(nOut - nIn));
          worst.total = Math.max(worst.total, Math.abs(pOut - nOut));
          totalSum += Math.abs(pOut - nOut);
          count++;
        }
      }
      const f = (v: number) => v.toFixed(2);
      console.info(
        `dither, blocks of ${block} preview px: inputs differ by ${f(worst.input)}, preview dither vs its input ${f(worst.previewOwn)}, ` +
          `native dither vs its input ${f(worst.nativeOwn)}; total worst ${f(worst.total)}, mean ${f(totalSum / count)} levels`
      );
      expect(worst.input, 'the two renders agree before dithering').toBeLessThanOrEqual(1.5);
      expect(worst.nativeOwn, 'the native dither keeps its tone').toBeLessThanOrEqual(1);
      expect(worst.total).toBeLessThanOrEqual(worstTotal);
      expect(totalSum / count).toBeLessThanOrEqual(1.5);
    }
  });
});

describe('the engine', () => {
  it('stage source is prepare_source of the crop at the target, cached or not', () => {
    const doc = setCrop({ x: 30, y: 20, width: 600, height: 450 })(photoDoc());
    const pt = previewTarget(doc, PREVIEW_EDGE);
    const expected = prepareSource(wasm, SOURCE, W, H, { x: 30, y: 20, width: 600, height: 450 }, pt.widthPx, pt.heightPx);
    expect(new Uint8Array(engine.render(doc, pt, 'source').pixels)).toEqual(expected);
    expect(new Uint8Array(engine.render(doc, pt, 'source', { cache: true }).pixels)).toEqual(expected);
    // A cached render is left untouched by the steps run on a copy of it.
    engine.render(setTonal({ invert: true })(doc), pt, 'final', { cache: true });
    expect(new Uint8Array(engine.render(doc, pt, 'source', { cache: true }).pixels)).toEqual(expected);
  });

  it('a cached and an uncached render of the same stage are identical', () => {
    const doc = setDither({ algorithm: 'atkinson' })(setTonal({ contrast: 30 })(photoDoc()));
    const pt = previewTarget(doc, PREVIEW_EDGE);
    expect(engine.render(doc, pt, 'final', { cache: true }).pixels).toEqual(engine.render(doc, pt, 'final').pixels);
  });

  it('reports pixels per mm of the target, and null while the size is not set', () => {
    const doc = photoDoc();
    expect(engine.render(doc, previewTarget(doc, PREVIEW_EDGE), 'source').pxPerMm).toBeCloseTo(300 / 120, 9);
    expect(engine.render({ ...doc, mmPerPx: null }, previewTarget(doc, PREVIEW_EDGE), 'source').pxPerMm).toBeNull();
  });

  it('detects transparency when a source is loaded', () => {
    const rgba = new Uint8Array(4 * 4 * 4).fill(255);
    expect(engine.putSource('opaque', rgba.slice().buffer, 4, 4).hasAlpha).toBe(false);
    rgba[4 * 7 + 3] = 254;
    expect(engine.putSource('alpha', rgba.slice().buffer, 4, 4).hasAlpha).toBe(true);
  });

  it('refuses to render a document whose source it does not hold, and an image over the ceiling', () => {
    const doc = photoDoc();
    engine.putSource('other', new Uint8Array(16).buffer, 2, 2);
    expect(() => engine.render(doc, previewTarget(doc, PREVIEW_EDGE), 'final')).toThrow(/not loaded/);
    expect(() => engine.beginSource('huge', 15000, 10001)).toThrow(TooLargeError);
    expect(15000 * 10001).toBeGreaterThan(MAX_SOURCE_PIXELS);
    expect(engine.hasSource('huge')).toBe(false);
  });
});

describe('the Adjust histogram (prepared stage)', () => {
  it('counts the tones the dither receives, not the dithered 0 and 255', () => {
    const doc = setDither({ algorithm: 'floyd-steinberg' })(setTonal({ contrast: 20 })(photoDoc()));
    const pt = previewTarget(doc, PREVIEW_EDGE);
    const prepared = new Uint8Array(engine.render(doc, pt, 'prepared').pixels);
    const expected = new Uint32Array(256);
    for (let i = 0; i < prepared.length; i += 4) {
      const l = Math.min(255, Math.floor((2126 * prepared[i] + 7152 * prepared[i + 1] + 722 * prepared[i + 2] + 5000) / 10000));
      expected[l]++;
    }
    const final = new Uint8Array(engine.render(doc, pt, 'final').pixels);
    // The final render is dithered: only black and white.
    expect(final.every((v, i) => (i & 3) === 3 || v === 0 || v === 255)).toBe(true);
    const hist = engine.core.preparedHistogram();
    expect(Array.from(hist.luma)).toEqual(Array.from(expected));
    // A photo spreads over the midtones.
    let mid = 0;
    for (let i = 64; i < 192; i++) mid += hist.luma[i];
    expect(mid / (pt.widthPx * pt.heightPx)).toBeGreaterThan(0.3);
  });
});
