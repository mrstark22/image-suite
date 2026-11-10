/**
 * Property tests for the dither algorithms the rebuild keeps:
 * Floyd-Steinberg, Jarvis-Judice-Ninke, Atkinson and Bayer 2/4/8.
 *
 * These check what each algorithm is supposed to do (tone, kernel, pattern),
 * not just that the output is black and white.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DITHER, grayImage, loadWasm, redChannel, runPipeline, whiteFraction, type Wasm } from '../helpers/wasm';

let wasm: Wasm;
beforeAll(async () => {
  wasm = await loadWasm();
});

const f = Math.fround;

type Kernel = Array<[dx: number, dy: number, weight: number]>;

const FLOYD_STEINBERG: Kernel = [
  [1, 0, 7 / 16],
  [-1, 1, 3 / 16],
  [0, 1, 5 / 16],
  [1, 1, 1 / 16],
];

const ATKINSON: Kernel = [
  [1, 0, 1 / 8],
  [2, 0, 1 / 8],
  [-1, 1, 1 / 8],
  [0, 1, 1 / 8],
  [1, 1, 1 / 8],
  [0, 2, 1 / 8],
];

const JARVIS: Kernel = [
  [1, 0, 7 / 48],
  [2, 0, 5 / 48],
  [-2, 1, 3 / 48],
  [-1, 1, 5 / 48],
  [0, 1, 7 / 48],
  [1, 1, 5 / 48],
  [2, 1, 3 / 48],
  [-2, 2, 1 / 48],
  [-1, 2, 3 / 48],
  [0, 2, 5 / 48],
  [1, 2, 3 / 48],
  [2, 2, 1 / 48],
];

/**
 * Independent reference error diffusion, written from the published kernels.
 * Arithmetic is rounded to 32-bit floats at each step so it matches the Rust
 * implementation bit for bit.
 */
function referenceErrorDiffusion(
  gray: Uint8Array,
  width: number,
  height: number,
  kernel: Kernel,
  serpentine: boolean
): Uint8Array {
  const buf = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    // Same luma expression as the Rust code; for a grey pixel it is ~the grey level.
    const v = gray[i];
    buf[i] = f(f(f(f(0.299) * v) + f(f(0.587) * v)) + f(f(0.114) * v));
  }
  const out = new Uint8Array(gray.length);
  for (let y = 0; y < height; y++) {
    const reverse = serpentine && y % 2 === 1;
    for (let step = 0; step < width; step++) {
      const x = reverse ? width - 1 - step : step;
      const i = y * width + x;
      const oldVal = buf[i];
      const newVal = oldVal >= 128 ? 255 : 0;
      out[i] = newVal;
      const err = f(oldVal - newVal);
      for (const [dx, dy, w] of kernel) {
        const nx = x + (reverse ? -dx : dx);
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const n = ny * width + nx;
          buf[n] = f(buf[n] + f(err * f(w)));
        }
      }
    }
  }
  return out;
}

const BAYER_2 = [
  [0, 2],
  [3, 1],
];

const BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** Builds the 2n x 2n Bayer matrix from the n x n one (the standard recursion). */
function nextBayer(m: number[][]): number[][] {
  const n = m.length;
  const out: number[][] = Array.from({ length: n * 2 }, () => new Array<number>(n * 2).fill(0));
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = m[y][x] * 4;
      out[y][x] = v;
      out[y][x + n] = v + 2;
      out[y + n][x] = v + 3;
      out[y + n][x + n] = v + 1;
    }
  }
  return out;
}

function referenceBayer(gray: Uint8Array, width: number, height: number, matrix: number[][], scale: number): Uint8Array {
  const n = matrix.length;
  const out = new Uint8Array(gray.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = ((matrix[Math.floor(y / scale) % n][Math.floor(x / scale) % n] + 0.5) * 255) / (n * n);
      out[y * width + x] = gray[y * width + x] >= t ? 255 : 0;
    }
  }
  return out;
}

/** A deterministic pseudo-random grey image, so kernel tests cover varied values. */
function noiseImage(width: number, height: number): Uint8Array {
  let s = 12345;
  return grayImage(width, height, () => {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    return s % 256;
  });
}

const ERROR_DIFFUSION = [
  { name: 'Floyd-Steinberg', code: DITHER.floydSteinberg, kernel: FLOYD_STEINBERG },
  { name: 'Atkinson', code: DITHER.atkinson, kernel: ATKINSON },
  { name: 'Jarvis-Judice-Ninke', code: DITHER.jarvis, kernel: JARVIS },
];

const ORDERED = [
  { name: 'Bayer 2x2', code: DITHER.bayer2, matrix: BAYER_2 },
  { name: 'Bayer 4x4', code: DITHER.bayer4, matrix: BAYER_4 },
  { name: 'Bayer 8x8', code: DITHER.bayer8, matrix: nextBayer(BAYER_4) },
];

const ALL = [...ERROR_DIFFUSION, ...ORDERED];

describe('error diffusion matches the published kernels', () => {
  for (const algo of ERROR_DIFFUSION) {
    for (const serpentine of [false, true]) {
      it(`${algo.name}, ${serpentine ? 'serpentine' : 'raster'} scan`, () => {
        const w = 37;
        const h = 23;
        const img = noiseImage(w, h);
        const actual = redChannel(runPipeline(wasm, img, w, h, { dither: algo.code, serpentine }));
        const expected = referenceErrorDiffusion(redChannel(img), w, h, algo.kernel, serpentine);
        expect(Array.from(actual)).toEqual(Array.from(expected));
      });
    }
  }

  it('the kernel weights sum to 1 for Floyd-Steinberg and Jarvis, and 3/4 for Atkinson', () => {
    const sum = (k: Kernel) => k.reduce((a, [, , w]) => a + w, 0);
    expect(sum(FLOYD_STEINBERG)).toBeCloseTo(1, 12);
    expect(sum(JARVIS)).toBeCloseTo(1, 12);
    expect(sum(ATKINSON)).toBeCloseTo(0.75, 12);
  });
});

describe('ordered dithering matches the standard Bayer matrices', () => {
  for (const algo of ORDERED) {
    for (const scale of [1, 3]) {
      it(`${algo.name} at scale ${scale}`, () => {
        const w = 41;
        const h = 29;
        const img = noiseImage(w, h);
        const actual = redChannel(runPipeline(wasm, img, w, h, { dither: algo.code, ditherScale: scale }));
        const expected = referenceBayer(redChannel(img), w, h, algo.matrix, scale);
        expect(Array.from(actual)).toEqual(Array.from(expected));
      });
    }
  }
});

describe('tone is preserved on flat greys', () => {
  const SIZE = 128;
  const levels = [16, 32, 64, 96, 128, 160, 192, 224, 240];

  // Maximum allowed |white fraction - grey/255|.
  // Error diffusion that passes on all of its error is accurate to well under 1%.
  // Ordered dithering can only show (n*n + 1) tones, so it is accurate to half a step.
  const tolerance: Record<string, number> = {
    'Floyd-Steinberg': 0.01,
    'Jarvis-Judice-Ninke': 0.01,
    'Bayer 2x2': 1 / 8 + 0.005,
    'Bayer 4x4': 1 / 32 + 0.005,
    'Bayer 8x8': 1 / 128 + 0.005,
  };

  for (const algo of ALL.filter((a) => a.name !== 'Atkinson')) {
    it(`${algo.name} keeps mean density within ${tolerance[algo.name].toFixed(3)}`, () => {
      for (const g of levels) {
        const out = runPipeline(wasm, grayImage(SIZE, SIZE, () => g), SIZE, SIZE, {
          dither: algo.code,
          serpentine: true,
        });
        expect(Math.abs(whiteFraction(out) - g / 255), `grey ${g}`).toBeLessThanOrEqual(tolerance[algo.name]);
      }
    });
  }

  it('Atkinson is accurate at mid-grey and clips towards the ends, as the algorithm intends', () => {
    const density = (g: number) =>
      whiteFraction(
        runPipeline(wasm, grayImage(SIZE, SIZE, () => g), SIZE, SIZE, { dither: DITHER.atkinson, serpentine: true })
      );
    // Atkinson discards a quarter of the error, which deepens shadows and
    // brightens highlights while leaving mid-grey alone.
    expect(Math.abs(density(128) - 128 / 255)).toBeLessThanOrEqual(0.02);
    expect(density(32)).toBeLessThan(32 / 255);
    expect(density(224)).toBeGreaterThan(224 / 255);
    for (const g of levels) {
      expect(Math.abs(density(g) - g / 255), `grey ${g}`).toBeLessThanOrEqual(0.13);
    }
  });

  for (const algo of ALL) {
    it(`${algo.name} is monotonic: a lighter grey never gives a darker result`, () => {
      let previous = -1;
      for (let g = 0; g <= 255; g += 15) {
        const d = whiteFraction(
          runPipeline(wasm, grayImage(64, 64, () => g), 64, 64, { dither: algo.code, serpentine: true })
        );
        expect(d, `grey ${g}`).toBeGreaterThanOrEqual(previous - 0.005);
        previous = d;
      }
    });
  }
});

describe('pure white and pure black stay clean at the neutral threshold', () => {
  for (const algo of ALL) {
    it(algo.name, () => {
      const white = runPipeline(wasm, grayImage(48, 48, () => 255), 48, 48, { dither: algo.code, serpentine: true });
      const black = runPipeline(wasm, grayImage(48, 48, () => 0), 48, 48, { dither: algo.code, serpentine: true });
      expect(whiteFraction(white)).toBe(1);
      expect(whiteFraction(black)).toBe(0);
    });
  }
});

describe('output format', () => {
  const sizes: Array<[number, number]> = [
    [1, 1],
    [1, 7],
    [7, 1],
    [2, 3],
    [13, 17],
    [65, 33],
  ];

  for (const algo of ALL) {
    it(`${algo.name} gives strictly black or white pixels with alpha untouched, at odd sizes`, () => {
      for (const [w, h] of sizes) {
        const img = grayImage(w, h, (x, y) => ((x + y) * 255) / Math.max(1, w + h - 2));
        for (let i = 3; i < img.length; i += 4) img[i] = 200;
        const out = runPipeline(wasm, img, w, h, { dither: algo.code, serpentine: true });
        expect(out.length).toBe(w * h * 4);
        for (let i = 0; i < out.length; i += 4) {
          expect(out[i] === 0 || out[i] === 255).toBe(true);
          expect(out[i + 1]).toBe(out[i]);
          expect(out[i + 2]).toBe(out[i]);
          expect(out[i + 3]).toBe(200);
        }
      }
    });
  }

  it('inverted burn is the exact complement of the normal output', () => {
    const img = noiseImage(32, 32);
    const normal = runPipeline(wasm, img, 32, 32, { dither: DITHER.floydSteinberg, serpentine: true });
    const inverted = runPipeline(wasm, img, 32, 32, {
      dither: DITHER.floydSteinberg,
      serpentine: true,
      invertedBurn: true,
    });
    for (let i = 0; i < normal.length; i += 4) expect(inverted[i]).toBe(255 - normal[i]);
  });
});
