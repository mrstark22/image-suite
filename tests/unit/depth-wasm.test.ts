/**
 * The relief core (`src/wasm/src/depth.rs`, #44, #45), through the bridge's
 * `depthAt`. Each test checks a defining property: exact distances, each
 * bevel's formula, the peak after smoothing, and that every option changes
 * the heightmap.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DEFAULT_DEPTH } from '../../src/lib/document';
import type { DepthConfig } from '../../src/types/depth';
import { depthMap, grayImage, loadWasm, type Wasm } from '../helpers/wasm';

let wasm: Wasm;
beforeAll(async () => {
  wasm = await loadWasm();
});

const cfg = (partial: Partial<DepthConfig>): DepthConfig => ({ ...DEFAULT_DEPTH, smoothingMm: 0, ...partial });

/** Black where `inside`, white elsewhere. */
const shapeImage = (w: number, h: number, inside: (x: number, y: number) => boolean) =>
  grayImage(w, h, (x, y) => (inside(x, y) ? 0 : 255));

/** Brute-force distance from each inside pixel to the nearest outside pixel, between centres. */
function bruteDistance(w: number, h: number, inside: (x: number, y: number) => boolean): Float64Array {
  const outs: [number, number][] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!inside(x, y)) outs.push([x, y]);
  const d = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      let best = Infinity;
      for (const [ox, oy] of outs) best = Math.min(best, (ox - x) ** 2 + (oy - y) ** 2);
      d[y * w + x] = Math.sqrt(best);
    }
  }
  return d;
}

const differs = (a: Uint16Array, b: Uint16Array) => a.some((v, i) => v !== b[i]);

describe('relief core', () => {
  it('tone: height is the grey level, light high, over the full 16-bit range', () => {
    const img = grayImage(64, 4, (x) => 40 + x * 3);
    const { heights, source } = depthMap(wasm, img, 64, 4, cfg({ source: 'tonal-height' }));
    expect(source).toBe('tonal-height');
    expect(heights[0]).toBe(0);
    expect(heights[63]).toBe(65535);
    for (let x = 0; x < 64; x++) expect(heights[x] / 65535).toBeCloseTo(x / 63, 3);
  });

  it('the distance transform is exact: it matches brute force on test shapes', () => {
    const w = 61;
    const h = 47;
    const shapes: Array<(x: number, y: number) => boolean> = [
      (x, y) => (x - 30) ** 2 + (y - 23) ** 2 < 400, // a disc
      (x, y) => (x - 30) ** 2 + (y - 23) ** 2 < 441 && (x - 30) ** 2 + (y - 23) ** 2 > 64, // a ring
      (x, y) => Math.abs(x - 2 * y) < 9 && x > 3 && x < 57, // a slanted bar, where a chamfer is worst
    ];
    for (const inside of shapes) {
      const brute = bruteDistance(w, h, inside);
      const max = Math.max(...brute);
      // A chamfer bevel wider than any distance: height is distance / the largest distance.
      const { heights } = depthMap(wasm, shapeImage(w, h, inside), w, h, cfg({ source: 'distance-transform', bevelStyle: 'chamfer', bevelWidthMm: 1000 }));
      for (let i = 0; i < w * h; i++) {
        expect(Math.abs((heights[i] / 65535) * max - brute[i])).toBeLessThan(max / 65535 + 1e-6);
      }
    }
  });

  it('each bevel profile follows its formula on a square', () => {
    const w = 60;
    const inside = (x: number, y: number) => x >= 10 && x < 50 && y >= 10 && y < 50;
    const brute = bruteDistance(w, w, inside);
    const formulas = {
      chamfer: (t: number) => t,
      round: (t: number) => Math.sqrt(1 - (1 - t) ** 2),
      cove: (t: number) => 1 - Math.sqrt(1 - t * t),
    };
    for (const [bevelStyle, f] of Object.entries(formulas)) {
      const { heights } = depthMap(wasm, shapeImage(w, w, inside), w, w, cfg({ source: 'distance-transform', bevelStyle: bevelStyle as DepthConfig['bevelStyle'], bevelWidthMm: 8 }));
      for (let i = 0; i < w * w; i++) {
        const expected = brute[i] === 0 ? 0 : f(Math.min(brute[i] / 8, 1));
        expect(Math.abs(heights[i] / 65535 - expected), bevelStyle).toBeLessThan(1e-4);
      }
    }
  });

  it('smoothing does not lower the peak: a 3 px stroke still reaches the full depth', () => {
    const inside = (x: number) => x >= 19 && x < 22;
    const plain = depthMap(wasm, shapeImage(40, 40, inside), 40, 40, cfg({ source: 'distance-transform', bevelWidthMm: 3 })).heights;
    const smooth = depthMap(wasm, shapeImage(40, 40, inside), 40, 40, cfg({ source: 'distance-transform', bevelWidthMm: 3, smoothingMm: 2 })).heights;
    expect(Math.max(...smooth)).toBe(65535);
    expect(differs(plain, smooth)).toBe(true);
  });

  it('polarity picks which part is the shape, and invert flips every height', () => {
    const inside = (x: number, y: number) => x >= 8 && x < 24 && y >= 8 && y < 24;
    const img = shapeImage(32, 32, inside);
    const dark = depthMap(wasm, img, 32, 32, cfg({ source: 'distance-transform', bevelWidthMm: 4 })).heights;
    const light = depthMap(wasm, img, 32, 32, cfg({ source: 'distance-transform', bevelWidthMm: 4, shapeIsLight: true })).heights;
    const centre = 16 * 32 + 16;
    expect(dark[centre]).toBe(65535);
    expect(light[centre]).toBe(0);
    // The frame is the shape now: it rises away from the square (the image border is not an edge).
    expect(light[7 * 32 + 16]).toBeLessThan(light[3 * 32 + 16]);
    expect(light[0]).toBe(65535);
    const inverted = depthMap(wasm, img, 32, 32, cfg({ source: 'distance-transform', bevelWidthMm: 4, invertZ: true })).heights;
    for (let i = 0; i < dark.length; i++) expect(inverted[i]).toBe(65535 - dark[i]);
  });

  it('automatic reads a logo as a shape and a photo as tone', () => {
    const logo = shapeImage(32, 32, (x, y) => (x - 16) ** 2 + (y - 16) ** 2 < 100);
    const auto = depthMap(wasm, logo, 32, 32, cfg({ source: 'auto' }));
    expect(auto.source).toBe('distance-transform');
    expect(auto.heights).toEqual(depthMap(wasm, logo, 32, 32, cfg({ source: 'distance-transform' })).heights);
    const photo = grayImage(32, 32, (x, y) => 60 + x * 3 + y * 2);
    expect(depthMap(wasm, photo, 32, 32, cfg({ source: 'auto' })).source).toBe('tonal-height');
  });

  it('AI source: the estimate is resampled and normalised, near high, with the image detail added', () => {
    const est = { values: new Float32Array([0, 1, 2, 3]), width: 2, height: 2 };
    const img = grayImage(8, 8, (x, y) => ((x + y) % 2 ? 90 : 160));
    const plain = depthMap(wasm, img, 8, 8, cfg({ source: 'ai-estimation', detail: 0 }), 1, est).heights;
    expect(plain[0]).toBe(0);
    expect(plain[63]).toBe(65535);
    expect(plain[7]).toBeLessThan(plain[56]); // the estimate's 1 top right, 2 bottom left
    const detailed = depthMap(wasm, img, 8, 8, cfg({ source: 'ai-estimation', detail: 80 }), 1, est).heights;
    expect(differs(plain, detailed)).toBe(true);
    expect(() => depthMap(wasm, img, 8, 8, cfg({ source: 'ai-estimation' }))).toThrow(/estimate/);
  });

  it('every shape option changes the heightmap (#44)', () => {
    const inside = (x: number, y: number) => (x - 24) ** 2 + (y - 24) ** 2 < 300 && !(x > 20 && x < 28);
    const img = grayImage(48, 48, (x, y) => (inside(x, y) ? 20 : 235) + ((x * 7 + y * 3) % 11));
    const base = cfg({ source: 'distance-transform', bevelWidthMm: 4, smoothingMm: 0.5 });
    const est = { values: Float32Array.from({ length: 36 }, (_, i) => (i % 6) * (i / 6)), width: 6, height: 6 };
    const run = (c: DepthConfig) => depthMap(wasm, img, 48, 48, c, 1, est).heights;
    const ref = run(base);
    const changes: Array<[string, Partial<DepthConfig>]> = [
      ['source tone', { source: 'tonal-height' }],
      ['source AI', { source: 'ai-estimation' }],
      ['bevel style', { bevelStyle: 'chamfer' }],
      ['bevel width', { bevelWidthMm: 9 }],
      ['polarity', { shapeIsLight: true }],
      ['smoothing', { smoothingMm: 1.5 }],
      ['invert', { invertZ: true }],
    ];
    for (const [name, change] of changes) expect(differs(ref, run({ ...base, ...change })), name).toBe(true);
    const ai = { ...base, source: 'ai-estimation' as const };
    expect(differs(run(ai), run({ ...ai, detail: 90 })), 'detail').toBe(true);
    // View settings are not inputs of the core: the same heightmap.
    for (const view of [{ viewMode: 'heightmap' }, { material: 'brass' }, { lightAngle: 10 }, { exaggeration: 4 }, { maxDepthMm: 7 }] as const) {
      expect(differs(ref, run({ ...base, ...view })), JSON.stringify(view)).toBe(false);
    }
  });
});
