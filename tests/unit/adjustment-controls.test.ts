/**
 * Adjustment controls do what their labels say (#22; design section 7, #22 rows).
 *
 * - Reset All in the adjustments panel (and Reset Adjustments in the tool
 *   subheader) restores every tone, colour and detail setting, including CLAHE,
 *   sharpening and the adaptive threshold. Edit > Reset All restores every step.
 * - Auto Levels sets the black and white points from the image's histogram,
 *   checked against an independent sort-based percentile and, through the
 *   WASM pipeline, by the spread of the result.
 *
 * Sharpening before the threshold is tested in prepare-source.test.ts.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { useDocumentStore } from '../../src/store/documentStore';
import {
  DEFAULT_COLOR,
  DEFAULT_DEPTH,
  DEFAULT_DETAIL,
  DEFAULT_TONAL,
  DEFAULT_VECTOR,
  defaultSteps,
  resetAdjustments,
  resetAll,
  setColor,
  setCrop,
  setDepth,
  setDetail,
  setDither,
  setScale,
  setTonal,
  setVector,
} from '../../src/lib/document';
import { combine } from '../../src/lib/adjustment-edits';
import { AUTO_LEVELS_CLIP, autoLevelPoints, autoLevels } from '../../src/lib/auto-levels';
import type { DocumentUpdate } from '../../src/types/document';
import { currentDoc, decodedImage, resetStores } from '../helpers/documents';
import { loadWasm, runPipeline, type Wasm } from '../helpers/wasm';

const store = () => useDocumentStore.getState();

/** Every tone, colour and detail setting away from its default, and the other steps changed too. */
const EVERYTHING_ADJUSTED: DocumentUpdate = combine(
  setScale(0.1),
  setCrop({ x: 4, y: 3, width: 20, height: 15 }),
  setTonal({
    exposure: 0.5,
    brightness: 10,
    contrast: 20,
    midtones: 5,
    highlights: -10,
    shadows: 15,
    whites: 5,
    blacks: -5,
    clarity: 30,
    gamma: 1.2,
    blackPoint: 10,
    whitePoint: 240,
    invert: true,
    grayscaleMode: 'average',
  }),
  setColor({ hue: 10, saturation: 20, lightness: 5, vibrance: 10, temperature: 5, tint: -5 }),
  setDetail({
    clahe: true,
    claheClipLimit: 4,
    claheGridSize: 12,
    unsharpStrength: 40,
    unsharpRadiusMm: 0.5,
    adaptiveThreshold: true,
    adaptiveBlockMm: 2.5,
    adaptiveConstant: 5,
  }),
  setDither({ algorithm: 'atkinson', serpentine: false, matrixScale: 2 }),
  setVector({ shapes: 'centerline', invert: true }),
  setDepth({ invertZ: true })
);

/** Keys of `actual` whose value equals the default's: settings the fixture fails to move. */
function unchangedKeys(actual: object, defaults: object): string[] {
  const a = actual as Record<string, unknown>;
  return Object.entries(defaults)
    .filter(([key, value]) => a[key] === value)
    .map(([key]) => key);
}

function openAdjusted() {
  store().open(decodedImage(40, 30));
  store().edit(EVERYTHING_ADJUSTED);
  const adjusted = currentDoc();
  // The fixture moves every adjustment, so a reset that misses one would show.
  expect(unchangedKeys(adjusted.steps.tonal, DEFAULT_TONAL)).toEqual([]);
  expect(unchangedKeys(adjusted.steps.color, DEFAULT_COLOR)).toEqual([]);
  expect(unchangedKeys(adjusted.steps.detail, DEFAULT_DETAIL)).toEqual([]);
  return adjusted;
}

beforeEach(() => resetStores());

describe('Reset All', () => {
  it('in the adjustments panel restores every tone, colour and detail setting, CLAHE, sharpening and threshold included', () => {
    const adjusted = openAdjusted();
    store().edit(resetAdjustments);
    const reset = currentDoc();
    expect(reset.steps.tonal).toEqual(DEFAULT_TONAL);
    expect(reset.steps.color).toEqual(DEFAULT_COLOR);
    expect(reset.steps.detail).toEqual(DEFAULT_DETAIL);
    expect(reset.steps.detail.clahe).toBe(false);
    expect(reset.steps.detail.unsharpStrength).toBe(0);
    expect(reset.steps.detail.adaptiveThreshold).toBe(false);
    // What the panel does not show is left alone.
    expect(reset.steps.crop).toEqual(adjusted.steps.crop);
    expect(reset.steps.dither).toEqual(adjusted.steps.dither);
    expect(reset.vector).toEqual(adjusted.vector);
    expect(reset.depth).toEqual(adjusted.depth);
    expect(reset.mmPerPx).toBe(adjusted.mmPerPx);
  });

  it('in the Edit menu restores every step and workflow setting to its default and keeps the scale', () => {
    const adjusted = openAdjusted();
    store().edit(resetAll);
    const reset = currentDoc();
    expect(reset.steps).toEqual(defaultSteps());
    expect(reset.vector).toEqual(DEFAULT_VECTOR);
    expect(reset.depth).toEqual(DEFAULT_DEPTH);
    expect(reset.mmPerPx).toBe(adjusted.mmPerPx);
  });
});

/** An RGBA image with the given channel values, in order, three per pixel. */
function rgbaOf(channelValues: number[]): Uint8Array {
  const pixels = Math.ceil(channelValues.length / 3);
  const out = new Uint8Array(pixels * 4);
  for (let p = 0; p < pixels; p++) {
    for (let c = 0; c < 3; c++) out[p * 4 + c] = channelValues[(p * 3 + c) % channelValues.length];
    out[p * 4 + 3] = 255;
  }
  return out;
}

/** Deterministic pseudo-random values in [0, 1). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * Reference: sort the R, G and B samples; the black point is the lowest value
 * with more than `clip` of the samples at or below it, the white point the
 * highest with more than `clip` at or above it.
 */
function referencePoints(rgba: Uint8Array, clip: number): { blackPoint: number; whitePoint: number } {
  const samples: number[] = [];
  for (let i = 0; i < rgba.length; i += 4) samples.push(rgba[i], rgba[i + 1], rgba[i + 2]);
  samples.sort((a, b) => a - b);
  const n = samples.length;
  const limit = clip * n;
  // Count at or below v exceeds limit: the sample at index floor(limit) (0-based).
  const blackPoint = samples[Math.floor(limit)];
  const whitePoint = samples[n - 1 - Math.floor(limit)];
  return { blackPoint, whitePoint };
}

describe('Auto Levels', () => {
  let wasm: Wasm;
  beforeAll(async () => {
    wasm = await loadWasm();
  });

  it('sets the black and white points to the histogram percentiles of a low-contrast image', () => {
    // 2000 pixels spread evenly over 60..180, plus a 0.2% sprinkle of pure black and
    // white: under the clip, so they must not hold the window open.
    const values: number[] = [];
    for (let i = 0; i < 6000; i++) values.push(60 + Math.round((i * 120) / 5999));
    for (let i = 0; i < 12; i++) values[i * 500] = i % 2 ? 255 : 0;
    const img = rgbaOf(values);
    const points = autoLevelPoints(img);
    expect(points).toEqual(referencePoints(img, AUTO_LEVELS_CLIP));
    // The spread is 60..180; the clip trims under one level of the ramp at each end.
    expect(points!.blackPoint).toBeGreaterThanOrEqual(60);
    expect(points!.blackPoint).toBeLessThanOrEqual(62);
    expect(points!.whitePoint).toBeLessThanOrEqual(180);
    expect(points!.whitePoint).toBeGreaterThanOrEqual(178);
  });

  it('matches a sort-based percentile on random images with different ranges and colour casts', () => {
    const rand = lcg(22);
    for (const [lo, hi] of [
      [0, 255],
      [30, 90],
      [100, 250],
      [5, 40],
    ]) {
      const w = 64;
      const h = 48;
      const img = new Uint8Array(w * h * 4);
      for (let i = 0; i < w * h; i++) {
        // A colour cast: red covers the top three quarters of the range and blue the
        // bottom three quarters, so one channel alone gives the wrong points.
        const t = rand();
        img[i * 4] = Math.round(lo + (hi - lo) * (0.25 + 0.75 * t));
        img[i * 4 + 1] = Math.round(lo + (hi - lo) * t);
        img[i * 4 + 2] = Math.round(lo + (hi - lo) * 0.75 * t);
        img[i * 4 + 3] = 255;
      }
      expect(autoLevelPoints(img), `range ${lo}..${hi}`).toEqual(referencePoints(img, AUTO_LEVELS_CLIP));
    }
  });

  it('stretches the image to the full range through the WASM pipeline', () => {
    const rand = lcg(7);
    const w = 80;
    const h = 60;
    const img = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const v = Math.round(70 + 100 * rand());
      img.set([v, v, v, 255], i * 4);
    }
    store().open(decodedImage(w, h));
    store().edit(autoLevels(img));
    const { blackPoint, whitePoint } = currentDoc().steps.tonal;
    const out = runPipeline(wasm, img, w, h, { blackPoint, whitePoint });
    const reds = Array.from({ length: w * h }, (_, i) => out[i * 4]).sort((a, b) => a - b);
    const clipped = Math.floor(AUTO_LEVELS_CLIP * reds.length);
    // The clipped tails go to 0 and 255; the rest spans the whole range.
    expect(reds[clipped]).toBeLessThanOrEqual(1);
    expect(reds[reds.length - 1 - clipped]).toBeGreaterThanOrEqual(254);
  });

  it('changes only the black and white points, as one undoable edit', () => {
    const img = rgbaOf([50, 100, 150, 200]);
    store().open(decodedImage(4, 3));
    store().edit(setTonal({ contrast: 25, gamma: 1.4 }));
    const before = currentDoc();
    store().edit(autoLevels(img));
    const after = currentDoc();
    expect(after.steps.tonal).toEqual({ ...before.steps.tonal, blackPoint: 50, whitePoint: 200 });
    expect(after.steps.color).toEqual(before.steps.color);
    expect(after.steps.detail).toEqual(before.steps.detail);
    store().undo();
    expect(currentDoc()).toEqual(before);
  });

  it('leaves the document unchanged on an image with no spread', () => {
    store().open(decodedImage(4, 3));
    const before = store();
    store().edit(autoLevels(rgbaOf([128])));
    expect(autoLevelPoints(rgbaOf([128]))).toBeNull();
    expect(store().doc).toBe(before.doc);
    expect(store().past).toBe(before.past);
  });
});
