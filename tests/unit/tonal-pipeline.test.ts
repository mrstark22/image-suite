/**
 * Tests for the tonal stage and the detail filters, run through the real
 * WebAssembly pipeline and compared with the TypeScript fast path.
 *
 * Tests marked `it.fails` record defects that are known and tracked. They pass
 * while the defect exists. When a defect is fixed the test starts failing:
 * change `it.fails` to `it` in the same commit as the fix.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildTonalLUT } from '../../src/lib/fast-tonal';
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
  it('is the identity at default settings, in both implementations', () => {
    const identity = Array.from({ length: 256 }, (_, i) => i);
    expect(Array.from(tsLut({}))).toEqual(identity);
    expect(Array.from(wasmLut({}))).toEqual(identity);
  });

  for (const { name, values } of SLIDERS) {
    it(`${name}: TypeScript and Rust agree within one level`, () => {
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

  it('combined settings: TypeScript and Rust agree within one level', () => {
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

  it('overshoots on both sides of an edge by the amount the formula predicts', () => {
    // Vertical edge: 100 on the left, 200 on the right. Radius 1 gives a 3-tap Gaussian.
    const W = 16;
    const img = grayImage(W, 8, (x) => (x < 8 ? 100 : 200));
    const amount = 1;
    const out = redChannel(runPipeline(wasm, img, W, 8, { sharpen: { amount, radius: 1 } }));

    const sigma = 1 * 0.6 + 0.3;
    const w = Math.exp(-1 / (2 * sigma * sigma));
    const blurredDarkSide = (100 * (1 + w) + 200 * w) / (1 + 2 * w);
    const blurredBrightSide = (200 * (1 + w) + 100 * w) / (1 + 2 * w);
    const row = 4 * W;

    expect(out[row + 7]).toBe(Math.round(100 + (100 - blurredDarkSide) * amount));
    expect(out[row + 8]).toBe(Math.round(200 + (200 - blurredBrightSide) * amount));
    expect(out[row + 7]).toBeLessThan(100);
    expect(out[row + 8]).toBeGreaterThan(200);
    // Two or more pixels from the edge nothing changes.
    expect(out[row + 5]).toBe(100);
    expect(out[row + 10]).toBe(200);
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
