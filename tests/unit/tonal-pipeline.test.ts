/**
 * Tests for the tonal stage and the detail filters, run through the real
 * WebAssembly pipeline and compared with an independent TypeScript reference
 * (`tests/helpers/tonal-reference.ts`).
 *
 * Tests marked `it.fails` record defects that are known and tracked. They pass
 * while the defect exists. When a defect is fixed the test starts failing:
 * change `it.fails` to `it` in the same commit as the fix.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildTonalLUT } from '../helpers/tonal-reference';
import { DEFAULT_TONAL } from '../../src/lib/document';
import type { TonalAdjustments } from '../../src/types/image';
import { grayImage, loadWasm, redChannel, runPipeline, type PipelineOptions, type Wasm } from '../helpers/wasm';

let wasm: Wasm;
beforeAll(async () => {
  wasm = await loadWasm();
});

/** Runs a 256-level grey ramp through the WASM tonal stage and returns its lookup table. */
function wasmLut(options: PipelineOptions): Uint8Array {
  return redChannel(runPipeline(wasm, grayImage(256, 1, (x) => x), 256, 1, options));
}

function tsLut(overrides: Partial<TonalAdjustments>): Uint8Array {
  return buildTonalLUT({ ...DEFAULT_TONAL, ...overrides });
}

/** Slope of the tone curve across the midtones (1 means unchanged). */
function midtoneSlope(lut: Uint8Array): number {
  return (lut[160] - lut[96]) / 64;
}

const SLIDERS: Array<{ name: keyof TonalAdjustments & keyof PipelineOptions; values: number[] }> = [
  { name: 'exposure', values: [-3, -1, 1, 3] },
  { name: 'brightness', values: [-100, -40, 40, 100] },
  { name: 'contrast', values: [-100, -40, 40, 100] },
  { name: 'midtones', values: [-100, -40, 40, 100] },
  { name: 'highlights', values: [-100, -40, 40, 100] },
  { name: 'shadows', values: [-100, -40, 40, 100] },
  { name: 'whites', values: [-100, -40, 40, 100] },
  { name: 'blacks', values: [-100, -40, 40, 100] },
  { name: 'clarity', values: [-100, -40, 40, 100] },
  { name: 'gamma', values: [0.1, 0.5, 2, 3] },
];

describe('tonal lookup table', () => {
  it('is the identity at default settings, in Rust and in the reference', () => {
    const identity = Array.from({ length: 256 }, (_, i) => i);
    expect(Array.from(tsLut({}))).toEqual(identity);
    expect(Array.from(wasmLut({}))).toEqual(identity);
  });

  for (const { name, values } of SLIDERS) {
    it(`${name}: the reference and Rust agree within one level`, () => {
      for (const value of values) {
        const ts = tsLut({ [name]: value });
        const rust = wasmLut({ [name]: value });
        for (let i = 0; i < 256; i++) {
          expect(Math.abs(ts[i] - rust[i]), `${name}=${value}, input ${i}`).toBeLessThanOrEqual(1);
        }
      }
    });

    it(`${name}: the curve never reverses (a lighter input is never darker)`, () => {
      for (const value of values) {
        const rust = wasmLut({ [name]: value });
        for (let i = 1; i < 256; i++) {
          expect(rust[i], `${name}=${value}, input ${i}`).toBeGreaterThanOrEqual(rust[i - 1]);
        }
      }
    });
  }

  it('combined settings: the reference and Rust agree within one level', () => {
    const combo = { exposure: 0.5, contrast: 30, shadows: 40, highlights: -30, gamma: 1.4, blackPoint: 12, whitePoint: 240 };
    const ts = tsLut(combo);
    const rust = wasmLut(combo);
    for (let i = 0; i < 256; i++) expect(Math.abs(ts[i] - rust[i])).toBeLessThanOrEqual(1);
  });

  it('levels map the black point to 0 and the white point to 255', () => {
    const lut = wasmLut({ blackPoint: 40, whitePoint: 200 });
    expect(lut[40]).toBe(0);
    expect(lut[20]).toBe(0);
    expect(lut[200]).toBe(255);
    expect(lut[230]).toBe(255);
    expect(lut[120]).toBeGreaterThan(100);
    expect(lut[120]).toBeLessThan(150);
  });

  it('invert mirrors the table', () => {
    const lut = wasmLut({ invert: true });
    for (let i = 0; i < 256; i++) expect(lut[i]).toBe(255 - i);
  });

  it('positive contrast steepens the midtones and negative contrast flattens them', () => {
    expect(midtoneSlope(wasmLut({ contrast: 60 }))).toBeGreaterThan(1.1);
    expect(midtoneSlope(wasmLut({ contrast: -60 }))).toBeLessThan(0.9);
  });

  it('raising the midtones lightens mid-grey', () => {
    expect(wasmLut({ midtones: 50 })[128]).toBeGreaterThan(128);
    expect(wasmLut({ midtones: -50 })[128]).toBeLessThan(128);
  });

  it('exposure and brightness move mid-grey in the direction of their sign', () => {
    expect(wasmLut({ exposure: 1 })[100]).toBeGreaterThan(100);
    expect(wasmLut({ exposure: -1 })[100]).toBeLessThan(100);
    expect(wasmLut({ brightness: 50 })[100]).toBeGreaterThan(100);
    expect(wasmLut({ brightness: -50 })[100]).toBeLessThan(100);
  });

  // Known defect, issue #35: the clarity term has the wrong sign, so positive
  // clarity flattens the midtones. Clarity should raise midtone contrast.
  it.fails('positive clarity steepens the midtones and negative clarity flattens them (issue #35)', () => {
    expect(midtoneSlope(wasmLut({ clarity: 100 }))).toBeGreaterThan(1);
    expect(midtoneSlope(wasmLut({ clarity: -100 }))).toBeLessThan(1);
    expect(midtoneSlope(tsLut({ clarity: 100 }))).toBeGreaterThan(1);
  });
});

describe('adaptive threshold', () => {
  const SIZE = 40;

  it('turns a flat image white when the constant is positive (nothing is darker than its surroundings)', () => {
    const out = redChannel(runPipeline(wasm, grayImage(SIZE, SIZE, () => 100), SIZE, SIZE, { adaptive: { block: 15, c: 2 } }));
    expect(out.every((v) => v === 255)).toBe(true);
  });

  it('turns a flat image black when the constant is negative', () => {
    const out = redChannel(runPipeline(wasm, grayImage(SIZE, SIZE, () => 100), SIZE, SIZE, { adaptive: { block: 15, c: -5 } }));
    expect(out.every((v) => v === 0)).toBe(true);
  });

  it('keeps a dark mark on an unevenly lit background and drops the lighting gradient', () => {
    // Background brightens from 80 to 160 left to right (about 2 levels per pixel);
    // a mark 40 levels darker than its surroundings sits in the middle.
    const background = (x: number) => 80 + (x / (SIZE - 1)) * 80;
    const inMark = (x: number, y: number) => x >= 18 && x < 22 && y >= 18 && y < 22;
    const img = grayImage(SIZE, SIZE, (x, y) => background(x) - (inMark(x, y) ? 40 : 0));
    const out = redChannel(runPipeline(wasm, img, SIZE, SIZE, { adaptive: { block: 15, c: 8 } }));

    // A global threshold could not do this: the mark (about 80) is lighter than
    // the dark side of the background, yet only the mark comes out black.
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        expect(out[y * SIZE + x], `pixel ${x},${y}`).toBe(inMark(x, y) ? 0 : 255);
      }
    }
  });
});

describe('unsharp mask', () => {
  it('leaves a flat image unchanged', () => {
    const out = redChannel(runPipeline(wasm, grayImage(16, 16, () => 137), 16, 16, { sharpen: { amount: 1.5, radius: 2 } }));
    expect(out.every((v) => v === 137)).toBe(true);
  });

  /**
   * Reference unsharp mask of one row of a vertical edge (every row is the
   * same, so the vertical pass leaves it unchanged): a Gaussian of sigma
   * `0.8 * radius` reaching ceil(3 * sigma) pixels each side,
   * renormalised at the borders.
   */
  function referenceRow(row: number[], amount: number, radius: number): number[] {
    const sigma = 0.8 * radius;
    const extent = Math.max(1, Math.ceil(3 * sigma));
    return row.map((orig, x) => {
      let sum = 0;
      let weights = 0;
      for (let d = -extent; d <= extent; d++) {
        const nx = x + d;
        if (nx < 0 || nx >= row.length) continue;
        const w = Math.exp(-(d * d) / (2 * sigma * sigma));
        sum += row[nx] * w;
        weights += w;
      }
      return Math.max(0, Math.min(255, Math.round(orig + (orig - sum / weights) * amount)));
    });
  }

  it('matches the formula across an edge, with the kernel reaching ceil(3 sigma)', () => {
    const W = 64;
    const edge = (x: number) => (x < 32 ? 100 : 200);
    for (const radius of [1, 2.5, 8, 15]) {
      const img = grayImage(W, 6, edge);
      const out = redChannel(runPipeline(wasm, img, W, 6, { sharpen: { amount: 1, radius } }));
      const expected = referenceRow(Array.from({ length: W }, (_, x) => edge(x)), 1, radius);
      const row = Array.from(out.subarray(3 * W, 4 * W));
      const worst = Math.max(...row.map((v, x) => Math.abs(v - expected[x])));
      expect(worst, `radius ${radius}`).toBeLessThanOrEqual(1);
      expect(row[31]).toBeLessThan(100);
      expect(row[32]).toBeGreaterThan(200);
    }
  });

  it('a radius over 5 px reaches further than 5 px from an edge (no clamp; #16)', () => {
    const W = 64;
    const img = grayImage(W, 6, (x) => (x < 32 ? 100 : 200));
    const out = redChannel(runPipeline(wasm, img, W, 6, { sharpen: { amount: 1, radius: 12 } }));
    // 10 px from the edge: a kernel clamped at 5 px would leave these unchanged.
    expect(out[3 * W + 22]).toBeLessThan(100);
    expect(out[3 * W + 42]).toBeGreaterThan(200);
  });

  it('a larger amount gives a larger overshoot', () => {
    const img = grayImage(16, 8, (x) => (x < 8 ? 100 : 200));
    const dark = (amount: number) => redChannel(runPipeline(wasm, img, 16, 8, { sharpen: { amount, radius: 1 } }))[4 * 16 + 7];
    expect(dark(2)).toBeLessThan(dark(1));
    expect(dark(1)).toBeLessThan(dark(0.5));
  });
});

describe('CLAHE', () => {
  it('leaves a flat image flat when its size divides evenly by the grid', () => {
    const out = redChannel(runPipeline(wasm, grayImage(64, 64, () => 255), 64, 64, { clahe: { clip: 2.5, grid: 8 } }));
    expect(new Set(out).size).toBe(1);
  });

  // Known defect, issue #36: when the image size is not divisible by the grid,
  // a sliver tile along the bottom and right edges is mis-equalised and darkens.
  it.fails('keeps pure white pure white when the size does not divide by the grid (issue #36)', () => {
    const out = redChannel(runPipeline(wasm, grayImage(400, 300, () => 255), 400, 300, { clahe: { clip: 2.5, grid: 8 } }));
    expect(Math.min(...out)).toBe(255);
  });
});
