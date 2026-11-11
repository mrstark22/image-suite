/**
 * Steps 1 to 3 of the pipeline (#16, design section 2): crop, flatten onto
 * white, resample in linear light. Compared with an independent reference
 * written here: a direct 2D area average using the exact sRGB curves, not the
 * module's separable weights or lookup tables.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { srgbToLinear, linearToSrgb, flattenOnWhite } from '../helpers/reference';
import { loadWasm, prepareSource, grayImage, redChannel, runPipeline, type Rect, type Wasm } from '../helpers/wasm';

let wasm: Wasm;
beforeAll(async () => {
  wasm = await loadWasm();
});

const toLinear = srgbToLinear;
const toSrgb = linearToSrgb;
const flattenRef = flattenOnWhite;

/** Deterministic pseudo-random RGBA with varied alpha. */
function noiseImage(w: number, h: number, seed = 1, opaque = false): Uint8Array {
  let s = seed;
  const next = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s & 255;
  };
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < out.length; i++) out[i] = (i & 3) === 3 && opaque ? 255 : next();
  return out;
}

/** Reference: area average in linear light of the flattened crop, for a shrink. */
function referenceShrink(src: Uint8Array, w: number, crop: Rect, dw: number, dh: number): Uint8Array {
  const out = new Uint8Array(dw * dh * 4);
  const sx = crop.width / dw;
  const sy = crop.height / dh;
  for (let oy = 0; oy < dh; oy++) {
    for (let ox = 0; ox < dw; ox++) {
      const x0 = ox * sx, x1 = Math.min(crop.width, (ox + 1) * sx);
      const y0 = oy * sy, y1 = Math.min(crop.height, (oy + 1) * sy);
      const acc = [0, 0, 0];
      let area = 0;
      for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
        const hy = Math.min(y1, y + 1) - Math.max(y0, y);
        for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
          const hx = Math.min(x1, x + 1) - Math.max(x0, x);
          const i = ((crop.y + y) * w + crop.x + x) * 4;
          for (let c = 0; c < 3; c++) acc[c] += toLinear(flattenRef(src[i + c], src[i + 3])) * hx * hy;
          area += hx * hy;
        }
      }
      for (let c = 0; c < 3; c++) out[(oy * dw + ox) * 4 + c] = toSrgb(acc[c] / area);
      out[(oy * dw + ox) * 4 + 3] = 255;
    }
  }
  return out;
}

/** Reference: bilinear in linear light of the flattened crop, for an enlargement. */
function referenceEnlarge(src: Uint8Array, w: number, crop: Rect, dw: number, dh: number): Uint8Array {
  const out = new Uint8Array(dw * dh * 4);
  const at = (x: number, y: number, c: number) => {
    const i = ((crop.y + y) * w + crop.x + x) * 4;
    return toLinear(flattenRef(src[i + c], src[i + 3]));
  };
  for (let oy = 0; oy < dh; oy++) {
    const fy = Math.min(crop.height - 1, Math.max(0, ((oy + 0.5) * crop.height) / dh - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(crop.height - 1, y0 + 1), ty = fy - y0;
    for (let ox = 0; ox < dw; ox++) {
      const fx = Math.min(crop.width - 1, Math.max(0, ((ox + 0.5) * crop.width) / dw - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(crop.width - 1, x0 + 1), tx = fx - x0;
      for (let c = 0; c < 3; c++) {
        const top = at(x0, y0, c) * (1 - tx) + at(x1, y0, c) * tx;
        const bottom = at(x0, y1, c) * (1 - tx) + at(x1, y1, c) * tx;
        out[(oy * dw + ox) * 4 + c] = toSrgb(top * (1 - ty) + bottom * ty);
      }
      out[(oy * dw + ox) * 4 + 3] = 255;
    }
  }
  return out;
}

function worstDifference(a: Uint8Array, b: Uint8Array): number {
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  return worst;
}

describe('prepare_source', () => {
  it('shrinking matches a linear-light area average within 1 level, for uneven ratios and an offset crop', () => {
    const w = 41, h = 29;
    const src = noiseImage(w, h, 7);
    for (const [crop, dw, dh] of [
      [{ x: 0, y: 0, width: 41, height: 29 }, 10, 7],
      [{ x: 5, y: 3, width: 30, height: 22 }, 13, 9],
      [{ x: 11, y: 2, width: 17, height: 25 }, 4, 11],
    ] as Array<[Rect, number, number]>) {
      const out = prepareSource(wasm, src, w, h, crop, dw, dh);
      expect(worstDifference(out, referenceShrink(src, w, crop, dw, dh)), JSON.stringify(crop)).toBeLessThanOrEqual(1);
    }
  });

  it('enlarging matches bilinear interpolation in linear light within 1 level', () => {
    const src = noiseImage(9, 7, 3);
    const crop = { x: 1, y: 1, width: 6, height: 5 };
    const out = prepareSource(wasm, src, 9, 7, crop, 17, 13);
    expect(worstDifference(out, referenceEnlarge(src, 9, crop, 17, 13))).toBeLessThanOrEqual(1);
  });

  it('a one-pixel black and white checkerboard halved is 188, not 128', () => {
    const board = grayImage(64, 64, (x, y) => ((x + y) % 2 === 0 ? 0 : 255));
    const out = prepareSource(wasm, board, 64, 64, { x: 0, y: 0, width: 64, height: 64 }, 32, 32);
    for (const v of redChannel(out)) expect(Math.abs(v - 188)).toBeLessThanOrEqual(1);
  });

  it('at the same size it is exactly the crop flattened onto white, and opaque', () => {
    const w = 23, h = 17;
    const src = noiseImage(w, h, 11);
    const crop = { x: 4, y: 6, width: 12, height: 9 };
    const out = prepareSource(wasm, src, w, h, crop, 12, 9);
    for (let y = 0; y < 9; y++) {
      for (let x = 0; x < 12; x++) {
        const i = ((crop.y + y) * w + crop.x + x) * 4;
        const o = (y * 12 + x) * 4;
        for (let c = 0; c < 3; c++) expect(out[o + c]).toBe(flattenRef(src[i + c], src[i + 3]));
        expect(out[o + 3]).toBe(255);
      }
    }
  });

  it('transparent black becomes white before resampling, so edges do not darken', () => {
    // A white-on-transparent image: opaque white left half, transparent black right half.
    const w = 8, h = 4;
    const src = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const left = i % w < 4;
      src.set(left ? [255, 255, 255, 255] : [0, 0, 0, 0], i * 4);
    }
    const out = prepareSource(wasm, src, w, h, { x: 0, y: 0, width: w, height: h }, 3, 2);
    expect(Array.from(redChannel(out))).toEqual([255, 255, 255, 255, 255, 255]);
  });

  it('returns null for a crop outside the source, and try_allocate returns null instead of trapping', () => {
    const e = wasm.exports;
    const ptr = e.allocate(16);
    try {
      expect(e.prepare_source(ptr, 2, 2, 1, 1, 2, 2, 1, 1)).toBe(0);
      expect(e.prepare_source(ptr, 2, 2, 0, 0, 2, 2, 0, 1)).toBe(0);
    } finally {
      e.deallocate(ptr, 16);
    }
    // More than a 32-bit address space can reserve: refused, and the module still works.
    expect(e.try_allocate(0x80000000)).toBe(0);
    const ok = e.try_allocate(64);
    expect(ok).not.toBe(0);
    e.deallocate(ok, 64);
  });
});

describe('step order (#22)', () => {
  it('sharpening runs before the adaptive threshold, so it changes the thresholded result', () => {
    // A soft ramp between two greys: sharpening steepens it, which moves pixels across the local mean.
    const img = grayImage(48, 16, (x, y) => 110 + 30 * Math.tanh((x - 24) / 6) + ((x * 7 + y * 3) % 5));
    const adaptive = { block: 15, c: 2 };
    const thresholdOnly = runPipeline(wasm, img, 48, 16, { adaptive });
    const sharpenedFirst = runPipeline(wasm, img, 48, 16, { adaptive, sharpen: { amount: 2, radius: 3 } });
    expect(sharpenedFirst).not.toEqual(thresholdOnly);
    // The output is still binary: the threshold ran last.
    expect(redChannel(sharpenedFirst).every((v) => v === 0 || v === 255)).toBe(true);
  });
});
